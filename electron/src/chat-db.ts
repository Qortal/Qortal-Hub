/**
 * Shared SQLite-backed storage for the P2P chat system.
 *
 * Drop-in replacement for ChatStore.  All Electron instances open the same
 * database file (appData/qortal-shared/chat.db).  WAL mode + busy_timeout
 * keep concurrent access safe without any extra coordination.
 *
 * Design notes
 * ─────────────
 * • No raw_json blob — columns are individually indexed and queried.
 * • syncState (authorAddress → contiguous seq) is maintained in-memory for
 *   O(1) hot-path access; rebuilt from DB at startup via a lightweight
 *   (chat_id, author_address, seq) query — no full event scan needed.
 * • readWatermarks are persisted to the DB so they survive restarts.
 * • Trim runs inside the same transaction as the triggering insert so the
 *   table never exceeds CHAT_MAX_EVENTS_PER_CHAT rows per chat.
 * • Bulk inserts (CHAT_SYNC_RESPONSE) use db.transaction() — one fsync.
 */

import Database, { type Database as DB, type Statement } from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { log as loggerLog, error as loggerError } from './logger';
import type { ChatEvent, ChatSummary } from './chat';

// ── Constants (must mirror chat.ts) ──────────────────────────────────────────

const CHAT_MAX_EVENTS_PER_CHAT = 1_000;
const CHAT_MAX_SYNC_EVENTS = 200;

// ── Row shape returned from DB ────────────────────────────────────────────────

interface EventRow {
  id: string;
  chat_id: string;
  event_type: string;
  author_address: string;
  author_pub_key: string;
  seq: number;
  timestamp: number;
  content: string;
  reply_to: string | null;
  target_id: string | null;
  signature: string;
}

function rowToEvent(r: EventRow): ChatEvent {
  const ev: ChatEvent = {
    id: r.id,
    chatId: r.chat_id,
    eventType: r.event_type as ChatEvent['eventType'],
    authorAddress: r.author_address,
    authorPublicKey: r.author_pub_key,
    seq: r.seq,
    timestamp: r.timestamp,
    content: r.content,
    signature: r.signature,
  };
  if (r.reply_to != null) ev.replyTo = r.reply_to;
  if (r.target_id != null) ev.targetId = r.target_id;
  return ev;
}

// ── ChatDatabase ──────────────────────────────────────────────────────────────

export class ChatDatabase {
  private db: DB;

  /** chatId → authorAddress → highest contiguous seq */
  private syncState = new Map<string, Map<string, number>>();
  /** chatId → read watermark timestamp */
  private readWatermarks = new Map<string, number>();
  /**
   * Per-instance dedup gate.  Mirrors what ChatStore's in-memory events array
   * used to do.  Populated at startup from existing DB rows so that events
   * already stored from a previous session are not re-emitted as "new".
   *
   * This is the critical difference from using info.changes from INSERT OR
   * IGNORE: with a shared DB another instance may have written an event first,
   * causing changes=0 for this instance even though this instance has never
   * seen the event and SHOULD emit it to the renderer.
   */
  private seenEventIds = new Set<string>();

  // ── Prepared statements (compiled once, reused on every call) ─────────────
  private stmtInsert: Statement;
  private stmtCountForChat: Statement;
  private stmtTrimOldest: Statement;
  private stmtGetEvents: Statement;
  private stmtGetEventsBefore: Statement;
  private stmtGetKnownChats: Statement;
  private stmtGetLastEvent: Statement;
  private stmtGetSeqsForSync: Statement;
  private stmtGetMissing: Statement;
  private stmtUpsertWatermark: Statement;
  private stmtLoadWatermarks: Statement;
  private stmtLoadSeqsForRebuild: Statement;
  /** Loads just event IDs for the seenEventIds Set — no content columns. */
  private stmtLoadEventIds: Statement;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);

    // Multi-process safety settings
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('synchronous = NORMAL');
    // Reduce write amplification
    this.db.pragma('wal_autocheckpoint = 1000');

    this.initSchema();
    this.stmtInsert = this.db.prepare(`
      INSERT OR IGNORE INTO chat_events
        (id, chat_id, event_type, author_address, author_pub_key,
         seq, timestamp, content, reply_to, target_id, signature)
      VALUES
        (@id, @chat_id, @event_type, @author_address, @author_pub_key,
         @seq, @timestamp, @content, @reply_to, @target_id, @signature)
    `);
    this.stmtCountForChat = this.db.prepare(
      'SELECT COUNT(*) AS cnt FROM chat_events WHERE chat_id = ?'
    );
    // Delete the oldest rows beyond the cap for this chat.
    // Uses the (chat_id, timestamp) index via the subquery.
    this.stmtTrimOldest = this.db.prepare(`
      DELETE FROM chat_events
      WHERE chat_id = ?
        AND id NOT IN (
          SELECT id FROM chat_events
          WHERE chat_id = ?
          ORDER BY timestamp DESC, seq DESC
          LIMIT ${CHAT_MAX_EVENTS_PER_CHAT}
        )
    `);
    this.stmtGetEvents = this.db.prepare(`
      SELECT * FROM chat_events
      WHERE chat_id = ?
      ORDER BY timestamp ASC, seq ASC
      LIMIT ?
    `);
    this.stmtGetEventsBefore = this.db.prepare(`
      SELECT * FROM chat_events
      WHERE chat_id = ? AND timestamp < ?
      ORDER BY timestamp ASC, seq ASC
      LIMIT ?
    `);
    this.stmtGetKnownChats = this.db.prepare(
      'SELECT DISTINCT chat_id FROM chat_events'
    );
    // Last event per chat for summaries
    this.stmtGetLastEvent = this.db.prepare(`
      SELECT * FROM chat_events
      WHERE chat_id = ?
      ORDER BY timestamp DESC, seq DESC
      LIMIT 1
    `);
    // All (author_address, seq) rows for a chat — used by getSyncState rebuild
    this.stmtGetSeqsForSync = this.db.prepare(`
      SELECT author_address, seq
      FROM chat_events
      WHERE chat_id = ?
      ORDER BY author_address, seq
    `);
    // Events an author has beyond what the requester knows
    this.stmtGetMissing = this.db.prepare(`
      SELECT * FROM chat_events
      WHERE chat_id = ? AND author_address = ? AND seq > ?
      ORDER BY seq ASC
      LIMIT ?
    `);
    this.stmtUpsertWatermark = this.db.prepare(`
      INSERT INTO read_watermarks (chat_id, watermark)
      VALUES (?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET watermark = excluded.watermark
        WHERE excluded.watermark > read_watermarks.watermark
    `);
    this.stmtLoadWatermarks = this.db.prepare(
      'SELECT chat_id, watermark FROM read_watermarks'
    );
    // Lightweight startup query — only (chat_id, author_address, seq), no content
    this.stmtLoadSeqsForRebuild = this.db.prepare(`
      SELECT chat_id, author_address, seq
      FROM chat_events
      ORDER BY chat_id, author_address, seq
    `);
    // Load just IDs for the per-instance dedup set — no content columns.
    this.stmtLoadEventIds = this.db.prepare('SELECT id FROM chat_events');
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_events (
        id             TEXT PRIMARY KEY,
        chat_id        TEXT NOT NULL,
        event_type     TEXT NOT NULL,
        author_address TEXT NOT NULL,
        author_pub_key TEXT NOT NULL,
        seq            INTEGER NOT NULL,
        timestamp      INTEGER NOT NULL,
        content        TEXT NOT NULL,
        reply_to       TEXT,
        target_id      TEXT,
        signature      TEXT NOT NULL
      );

      -- Primary read path: getEvents(chatId, limit, beforeTimestamp)
      CREATE INDEX IF NOT EXISTS idx_events_chat_ts
        ON chat_events(chat_id, timestamp);

      -- Sync path: getMissingEvents + getSyncState rebuild
      CREATE INDEX IF NOT EXISTS idx_events_chat_author_seq
        ON chat_events(chat_id, author_address, seq);

      CREATE TABLE IF NOT EXISTS read_watermarks (
        chat_id   TEXT PRIMARY KEY,
        watermark INTEGER NOT NULL
      );

      -- Discovered peers — written by p2p-network.ts, schema defined here
      -- so the table exists whether or not p2p-network opens the DB first.
      CREATE TABLE IF NOT EXISTS discovered_peers (
        address       TEXT PRIMARY KEY,
        discovered_at INTEGER NOT NULL,
        source        TEXT NOT NULL
      );
    `);
  }

  /**
   * Rebuild in-memory caches from DB.
   * Kept async for API compatibility with ChatStore; implementation is sync.
   */
  async loadFromDisk(): Promise<void> {
    try {
      // Rebuild syncState from lightweight (chat_id, author_address, seq) scan
      const seqRows = this.stmtLoadSeqsForRebuild.all() as {
        chat_id: string;
        author_address: string;
        seq: number;
      }[];

      // Group seqs by (chatId, authorAddress)
      const grouped = new Map<string, Map<string, number[]>>();
      for (const row of seqRows) {
        let chatMap = grouped.get(row.chat_id);
        if (!chatMap) {
          chatMap = new Map();
          grouped.set(row.chat_id, chatMap);
        }
        let seqs = chatMap.get(row.author_address);
        if (!seqs) {
          seqs = [];
          chatMap.set(row.author_address, seqs);
        }
        seqs.push(row.seq); // rows come back ordered, no re-sort needed
      }

      for (const [chatId, authorMap] of grouped) {
        const syncMap = new Map<string, number>();
        for (const [author, seqs] of authorMap) {
          syncMap.set(author, computeContiguous(seqs));
        }
        this.syncState.set(chatId, syncMap);
      }

      // Restore watermarks
      const wmRows = this.stmtLoadWatermarks.all() as {
        chat_id: string;
        watermark: number;
      }[];
      for (const r of wmRows) {
        this.readWatermarks.set(r.chat_id, r.watermark);
      }

      const chatCount = grouped.size;
      const eventCount = seqRows.length;
      loggerLog(
        `[ChatDB] Loaded sync state for ${chatCount} chats (${eventCount} event seqs).`
      );

      // Populate the per-instance dedup set from all existing IDs so that
      // events already in the DB (from this or any other instance) are not
      // re-emitted as "new" when they arrive again via P2P sync.
      const idRows = this.stmtLoadEventIds.all() as { id: string }[];
      for (const r of idRows) this.seenEventIds.add(r.id);
      loggerLog(`[ChatDB] Seeded ${idRows.length} event IDs into dedup set.`);
    } catch (err) {
      loggerError('[ChatDB] Failed to rebuild caches:', err);
    }
  }

  /**
   * Insert a ChatEvent. Returns true if new to this instance, false if already seen.
   *
   * "New to this instance" is tracked via the per-instance seenEventIds Set,
   * NOT via info.changes from INSERT OR IGNORE.  This is critical for the
   * shared-DB multi-instance case: another instance may have already written
   * the event to the DB (info.changes = 0), but this instance still needs to
   * emit the event to its renderer.
   *
   * The DB insert is always attempted and is idempotent (INSERT OR IGNORE).
   * Trim runs only when the DB insert actually added a new row.
   */
  insert(event: ChatEvent): boolean {
    // Per-instance dedup: if we've already processed this event ID, skip.
    if (this.seenEventIds.has(event.id)) return false;
    this.seenEventIds.add(event.id);

    const row = {
      id: event.id,
      chat_id: event.chatId,
      event_type: event.eventType,
      author_address: event.authorAddress,
      author_pub_key: event.authorPublicKey,
      seq: event.seq,
      timestamp: event.timestamp,
      content: event.content,
      reply_to: event.replyTo ?? null,
      target_id: event.targetId ?? null,
      signature: event.signature,
    };

    // Persist idempotently. Trim only when this instance is the first to write
    // this event to the DB (info.changes > 0).
    const insertAndTrim = this.db.transaction(() => {
      const info = this.stmtInsert.run(row);
      if (info.changes > 0) {
        const { cnt } = this.stmtCountForChat.get(event.chatId) as {
          cnt: number;
        };
        if (cnt > CHAT_MAX_EVENTS_PER_CHAT) {
          this.stmtTrimOldest.run(event.chatId, event.chatId);
        }
      }
    });

    insertAndTrim();
    this.updateSyncStateIncremental(event.chatId, event.authorAddress, event.seq);
    return true;
  }

  /**
   * Insert multiple events in a single transaction.
   * Returns the number of events that were new to this instance.
   */
  insertBatch(events: ChatEvent[]): number {
    if (events.length === 0) return 0;

    // Split into truly-new (not in seenEventIds) vs already-seen.
    const newEvents = events.filter((e) => !this.seenEventIds.has(e.id));
    if (newEvents.length === 0) return 0;

    // Mark all as seen before the DB work to prevent any race re-entry.
    for (const e of newEvents) this.seenEventIds.add(e.id);

    const batchInsert = this.db.transaction(() => {
      for (const event of newEvents) {
        const row = {
          id: event.id,
          chat_id: event.chatId,
          event_type: event.eventType,
          author_address: event.authorAddress,
          author_pub_key: event.authorPublicKey,
          seq: event.seq,
          timestamp: event.timestamp,
          content: event.content,
          reply_to: event.replyTo ?? null,
          target_id: event.targetId ?? null,
          signature: event.signature,
        };
        this.stmtInsert.run(row); // idempotent INSERT OR IGNORE
        this.updateSyncStateIncremental(event.chatId, event.authorAddress, event.seq);
      }
      // Trim all affected chats once at the end
      const affectedChats = new Set(newEvents.map((e) => e.chatId));
      for (const chatId of affectedChats) {
        const { cnt } = this.stmtCountForChat.get(chatId) as { cnt: number };
        if (cnt > CHAT_MAX_EVENTS_PER_CHAT) {
          this.stmtTrimOldest.run(chatId, chatId);
        }
      }
    });
    batchInsert();
    return newEvents.length;
  }

  /**
   * Returns up to `limit` events for a chat, ordered oldest-first.
   * Optionally filters to events strictly before `beforeTimestamp`.
   */
  getEvents(chatId: string, limit = 50, beforeTimestamp?: number): ChatEvent[] {
    const rows =
      beforeTimestamp != null
        ? (this.stmtGetEventsBefore.all(chatId, beforeTimestamp, limit) as EventRow[])
        : (this.stmtGetEvents.all(chatId, limit) as EventRow[]);
    return rows.map(rowToEvent);
  }

  /**
   * Returns authorAddress → highest contiguous seq for the given chat.
   * Served from in-memory cache — O(1), no DB round-trip.
   */
  getSyncState(chatId: string): Record<string, number> {
    const m = this.syncState.get(chatId);
    return m ? Object.fromEntries(m.entries()) : {};
  }

  /** Returns all chatIds that have at least one stored event. */
  getKnownChatIds(): string[] {
    const rows = this.stmtGetKnownChats.all() as { chat_id: string }[];
    return rows.map((r) => r.chat_id);
  }

  /** Returns a summary for every known chat, sorted by most-recently-updated. */
  getChatSummaries(): ChatSummary[] {
    const chatIds = this.getKnownChatIds();
    const result: ChatSummary[] = [];
    for (const chatId of chatIds) {
      const lastRow = this.stmtGetLastEvent.get(chatId) as EventRow | undefined;
      const lastEvent = lastRow ? rowToEvent(lastRow) : null;
      const watermark = this.readWatermarks.get(chatId) ?? 0;

      // Count events newer than the watermark
      const unreadCount = (
        this.db
          .prepare(
            'SELECT COUNT(*) AS cnt FROM chat_events WHERE chat_id = ? AND timestamp > ?'
          )
          .get(chatId, watermark) as { cnt: number }
      ).cnt;

      result.push({
        chatId,
        lastEvent,
        unreadCount,
        updatedAt: lastEvent?.timestamp ?? 0,
      });
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Returns events this node has that the requester does not, capped at
   * CHAT_MAX_SYNC_EVENTS total across all authors.
   */
  getMissingEvents(
    chatId: string,
    theirSeqs: Record<string, number>
  ): ChatEvent[] {
    const missing: ChatEvent[] = [];
    const remaining = CHAT_MAX_SYNC_EVENTS;

    // Fetch missing per author; the index (chat_id, author_address, seq) serves this
    for (const [author, theirMax] of Object.entries(theirSeqs)) {
      if (missing.length >= remaining) break;
      const rows = this.stmtGetMissing.all(
        chatId,
        author,
        theirMax,
        remaining - missing.length
      ) as EventRow[];
      for (const r of rows) missing.push(rowToEvent(r));
    }

    // Also fetch from authors the requester hasn't mentioned at all
    if (missing.length < remaining) {
      const knownAuthors = new Set(Object.keys(theirSeqs));
      const allAuthors = (
        this.db
          .prepare(
            'SELECT DISTINCT author_address FROM chat_events WHERE chat_id = ?'
          )
          .all(chatId) as { author_address: string }[]
      ).map((r) => r.author_address);

      for (const author of allAuthors) {
        if (missing.length >= remaining) break;
        if (knownAuthors.has(author)) continue;
        const rows = this.stmtGetMissing.all(
          chatId,
          author,
          0, // they have nothing from this author
          remaining - missing.length
        ) as EventRow[];
        for (const r of rows) missing.push(rowToEvent(r));
      }
    }

    return missing;
  }

  /**
   * Advances the read watermark for a chat.
   * Persists to DB so it survives restarts.
   */
  markRead(chatId: string, upToTimestamp: number): void {
    const current = this.readWatermarks.get(chatId) ?? 0;
    if (upToTimestamp <= current) return;
    this.readWatermarks.set(chatId, upToTimestamp);
    this.stmtUpsertWatermark.run(chatId, upToTimestamp);
  }

  /**
   * No-op: SQLite writes are synchronous and durable.
   * Kept for API compatibility with ChatStore.
   */
  flushAllSync(): void {
    // Nothing to flush — every write already committed to WAL
  }

  /** Close the database connection. */
  stopAllTimers(): void {
    try {
      this.db.close();
    } catch {
      // Ignore close errors on shutdown
    }
  }

  // ── Internal sync-state helpers ───────────────────────────────────────────

  /**
   * Incrementally updates the contiguous seq for one author in one chat.
   * Called after every successful insert instead of recomputing the full chat.
   */
  private updateSyncStateIncremental(
    chatId: string,
    authorAddress: string,
    newSeq: number
  ): void {
    let chatMap = this.syncState.get(chatId);
    if (!chatMap) {
      chatMap = new Map();
      this.syncState.set(chatId, chatMap);
    }
    const current = chatMap.get(authorAddress) ?? 0;
    // Only extend the contiguous run if this seq is the next one
    if (newSeq === current + 1) {
      chatMap.set(authorAddress, newSeq);
      // Keep extending if we already have subsequent seqs in the DB
      this.extendContiguous(chatId, authorAddress, newSeq, chatMap);
    }
    // If newSeq > current+1 there's a gap — leave contiguous as-is;
    // if newSeq <= current it's a duplicate or already counted.
  }

  /**
   * After extending the contiguous seq to `from`, check whether the DB has
   * the next seq already (from a previously out-of-order insert) and keep
   * extending the run.
   */
  private extendContiguous(
    chatId: string,
    authorAddress: string,
    from: number,
    chatMap: Map<string, number>
  ): void {
    let next = from + 1;
    const stmtHas = this.db.prepare(
      'SELECT 1 FROM chat_events WHERE chat_id = ? AND author_address = ? AND seq = ? LIMIT 1'
    );
    while (stmtHas.get(chatId, authorAddress, next)) {
      chatMap.set(authorAddress, next);
      next++;
    }
  }
}

// ── Pure helper ───────────────────────────────────────────────────────────────

/**
 * Given a sorted array of seq numbers, return the highest value reachable
 * from the first element without any gap (contiguous prefix).
 * Matches the algorithm in ChatStore.updateSyncState.
 */
function computeContiguous(sortedSeqs: number[]): number {
  if (sortedSeqs.length === 0) return 0;
  // Treat anything before the earliest stored seq as already known
  let contiguous = sortedSeqs[0] - 1;
  for (const s of sortedSeqs) {
    if (s === contiguous + 1) {
      contiguous = s;
    } else {
      break;
    }
  }
  return contiguous;
}
