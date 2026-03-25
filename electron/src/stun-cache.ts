/**
 * SQLite cache for decentralized STUN endpoint scores (qortal-shared/stun-cache.db).
 * Probe results are local observations only — not global reachability guarantees.
 */

import fs from 'fs';
import path from 'path';
import Database, { type Database as DB } from 'better-sqlite3';
import { log as loggerLog, error as loggerError } from './logger';
import { STUN_FIXED_UDP_PORT } from './stun-bootstrap';

/** Tunable scoring weights (telemetry may adjust). */
export const W_CALL_SUCCESS = 5;
export const W_PROBE_SUCCESS = 2;
export const W_OBSERVER = 1;
export const W_FAIL = 3;

/** Target rows to retain in DB (soft cap via prune). */
export const STUN_CACHE_MAX_ROWS = 32;

export interface StunEndpointRow {
  stun_key: string;
  host: string;
  stun_port: number;
  probe_success_at: number | null;
  probe_fail_at: number | null;
  probe_rtt_ewma: number | null;
  probe_fail_streak: number;
  call_success_events: number;
  call_fail_events: number;
  observer_confirmations: number;
  stun_server_capable: number;
  updated_at: number;
}

export interface IceServerOut {
  urls: string;
}

function ipv4Prefix24(host: string): string | null {
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.\d+$/);
  if (!m) return null;
  return `${m[1]}.${m[2]}.${m[3]}`;
}

export class StunCache {
  private db: DB | null = null;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  open(): void {
    if (this.db) return;
    try {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
      const db = new Database(this.dbPath);
      db.pragma('journal_mode = WAL');
      db.pragma('busy_timeout = 5000');
      db.pragma('synchronous = NORMAL');
      db.exec(`
        CREATE TABLE IF NOT EXISTS stun_endpoints (
          stun_key TEXT PRIMARY KEY,
          host TEXT NOT NULL,
          stun_port INTEGER NOT NULL,
          probe_success_at INTEGER,
          probe_fail_at INTEGER,
          probe_rtt_ewma REAL,
          probe_fail_streak INTEGER NOT NULL DEFAULT 0,
          call_success_events INTEGER NOT NULL DEFAULT 0,
          call_fail_events INTEGER NOT NULL DEFAULT 0,
          observer_confirmations INTEGER NOT NULL DEFAULT 0,
          stun_server_capable INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_stun_updated ON stun_endpoints(updated_at);
      `);
      this.db = db;
      loggerLog('[STUN] Opened stun-cache.db');
    } catch (e) {
      loggerError('[STUN] Failed to open stun-cache.db:', e);
      this.db = null;
    }
  }

  close(): void {
    if (!this.db) return;
    try {
      this.db.close();
    } catch {
      /* ignore */
    }
    this.db = null;
  }

  private requireDb(): DB {
    if (!this.db) this.open();
    if (!this.db) throw new Error('stun cache unavailable');
    return this.db;
  }

  computeScore(r: StunEndpointRow): number {
    const recentProbe =
      r.probe_success_at &&
      (!r.probe_fail_at || r.probe_success_at > r.probe_fail_at);
    const probeTerm = recentProbe ? W_PROBE_SUCCESS : 0;
    const failTerm =
      (r.probe_fail_streak ?? 0) * W_FAIL + (r.call_fail_events ?? 0) * W_FAIL;
    return (
      (r.call_success_events ?? 0) * W_CALL_SUCCESS +
      probeTerm +
      (r.observer_confirmations ?? 0) * W_OBSERVER -
      failTerm
    );
  }

  upsertProbeResult(
    host: string,
    stunPort: number,
    ok: boolean,
    rttMs?: number
  ): void {
    const key = `${host}:${stunPort}`;
    const now = Date.now();
    const db = this.requireDb();
    const row = db
      .prepare(`SELECT * FROM stun_endpoints WHERE stun_key = ?`)
      .get(key) as StunEndpointRow | undefined;

    if (ok) {
      let ewma = rttMs ?? 200;
      if (row?.probe_rtt_ewma != null && rttMs != null) {
        ewma = row.probe_rtt_ewma * 0.7 + rttMs * 0.3;
      } else if (row?.probe_rtt_ewma != null) {
        ewma = row.probe_rtt_ewma;
      }
      const cs = row?.call_success_events ?? 0;
      const cf = row?.call_fail_events ?? 0;
      const ob = row?.observer_confirmations ?? 0;
      db.prepare(
        `INSERT INTO stun_endpoints (
          stun_key, host, stun_port, probe_success_at, probe_fail_at, probe_rtt_ewma,
          probe_fail_streak, call_success_events, call_fail_events, observer_confirmations,
          stun_server_capable, updated_at
        ) VALUES (?, ?, ?, ?, NULL, ?, 0, ?, ?, ?, 1, ?)
        ON CONFLICT(stun_key) DO UPDATE SET
          probe_success_at = excluded.probe_success_at,
          probe_rtt_ewma = excluded.probe_rtt_ewma,
          probe_fail_streak = 0,
          stun_server_capable = 1,
          updated_at = excluded.updated_at`
      ).run(
        key,
        host,
        stunPort,
        now,
        ewma,
        cs,
        cf,
        ob,
        now
      );
    } else {
      const streak = (row?.probe_fail_streak ?? 0) + 1;
      const cs = row?.call_success_events ?? 0;
      const cf = row?.call_fail_events ?? 0;
      const ob = row?.observer_confirmations ?? 0;
      const ps = row?.probe_success_at ?? null;
      const ew = row?.probe_rtt_ewma ?? null;
      db.prepare(
        `INSERT INTO stun_endpoints (
          stun_key, host, stun_port, probe_success_at, probe_fail_at, probe_rtt_ewma,
          probe_fail_streak, call_success_events, call_fail_events, observer_confirmations,
          stun_server_capable, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
        ON CONFLICT(stun_key) DO UPDATE SET
          probe_fail_at = excluded.probe_fail_at,
          probe_fail_streak = excluded.probe_fail_streak,
          updated_at = excluded.updated_at`
      ).run(
        key,
        host,
        stunPort,
        ps,
        now,
        ew,
        streak,
        cs,
        cf,
        ob,
        now
      );
    }
    this.pruneSoft();
  }

  /** Best-effort: bump success/fail for all keys in bundle (MVP attribution). */
  recordCallBundleOutcome(bundleKeys: string[], success: boolean): void {
    if (bundleKeys.length === 0) return;
    const db = this.requireDb();
    const now = Date.now();
    const stmtOk = db.prepare(
      `UPDATE stun_endpoints SET
        call_success_events = call_success_events + 1,
        updated_at = ?
      WHERE stun_key = ?`
    );
    const stmtFail = db.prepare(
      `UPDATE stun_endpoints SET
        call_fail_events = call_fail_events + 1,
        updated_at = ?
      WHERE stun_key = ?`
    );
    for (const key of bundleKeys) {
      try {
        if (success) stmtOk.run(now, key);
        else stmtFail.run(now, key);
      } catch {
        /* ignore */
      }
    }
  }

  getAllRows(): StunEndpointRow[] {
    try {
      const db = this.requireDb();
      return db
        .prepare(`SELECT * FROM stun_endpoints ORDER BY updated_at DESC LIMIT ?`)
        .all(STUN_CACHE_MAX_ROWS * 2) as StunEndpointRow[];
    } catch {
      return [];
    }
  }

  /**
   * Pick up to `maxOut` stun URLs with score ordering and /24 diversity (IPv4).
   * Emits `STUN_FIXED_UDP_PORT` for every host so legacy rows (old tls+1000 ports in DB)
   * still produce wire-v2 URLs; at most one URL per host (highest score first).
   */
  selectTopIceServers(maxOut: number): IceServerOut[] {
    const rows = this.getAllRows();
    const scored = rows.map((r) => ({ r, score: this.computeScore(r) }));
    scored.sort((a, b) => b.score - a.score);
    const out: IceServerOut[] = [];
    const used24 = new Set<string>();
    const usedHosts = new Set<string>();
    const urlForHost = (host: string): string =>
      `stun:${host}:${STUN_FIXED_UDP_PORT}`;

    for (const { r } of scored) {
      if (out.length >= maxOut) break;
      const hostKey = r.host.toLowerCase();
      if (usedHosts.has(hostKey)) continue;
      const p24 = ipv4Prefix24(r.host);
      if (p24 && used24.has(p24)) continue;
      if (p24) used24.add(p24);
      usedHosts.add(hostKey);
      out.push({ urls: urlForHost(r.host) });
    }
    for (const { r } of scored) {
      if (out.length >= maxOut) break;
      const hostKey = r.host.toLowerCase();
      if (usedHosts.has(hostKey)) continue;
      const url = urlForHost(r.host);
      if (out.some((o) => o.urls === url)) continue;
      usedHosts.add(hostKey);
      out.push({ urls: url });
    }
    return out.slice(0, maxOut);
  }

  private pruneSoft(): void {
    try {
      const db = this.requireDb();
      const n = (
        db.prepare(`SELECT COUNT(*) as c FROM stun_endpoints`).get() as {
          c: number;
        }
      ).c;
      if (n <= STUN_CACHE_MAX_ROWS + 8) return;
      db.prepare(
        `DELETE FROM stun_endpoints WHERE stun_key IN (
          SELECT stun_key FROM stun_endpoints ORDER BY updated_at ASC LIMIT ?
        )`
      ).run(n - STUN_CACHE_MAX_ROWS);
    } catch {
      /* ignore */
    }
  }
}
