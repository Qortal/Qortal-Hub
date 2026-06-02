import * as net from 'net';
import * as tls from 'tls';
import * as http from 'http';
import * as crypto from 'crypto';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { generate as generateCert } from 'selfsigned';
import { log as loggerLog, error as loggerError } from './logger';
import Database, { type Database as DB, type Statement } from 'better-sqlite3';
import {
  STUN_FIXED_UDP_PORT,
  STUN_WIRE_VERSION,
} from './stun-bootstrap';
import {
  createNatApiClient,
  destroyNatClient,
  mapTcpPort,
  mapUdpPort,
  unmapTcpPort,
  unmapUdpPort,
} from './upnp-nat';
import { isDisabledLegacy } from './feature-flags';

export const DEFAULT_P2P_PORT = 62391;
export const DEFAULT_MAX_PEERS = 16;
export const DEFAULT_API_PORT = 62490;

const MAX_RELAY_HOPS = 4;
const SEEN_MESSAGE_TTL_MS = 60_000;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;
const PING_INTERVAL_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;
/** Max addresses shared in a single peer-exchange message. */
const MAX_PEER_ADDRS = 16;

/** Max bytes for one newline-delimited JSON line (excluding `\n`). */
const MAX_JSON_LINE_BYTES = 256 * 1024;

/** Max bytes buffered while waiting for a complete JSON line. */
const MAX_BINARY_INCOMPLETE_RX_BYTES = MAX_JSON_LINE_BYTES;

/**
 * Pre-concat ceiling: allow buffering up to one max JSON line before `\n`.
 */
const MAX_P2P_RX_BUFFER_HARD_CAP = MAX_JSON_LINE_BYTES;

// ── Types ────────────────────────────────────────────────────────────────────

export type P2PMessageType =
  | 'handshake'
  | 'data'
  | 'relay'
  | 'ping'
  | 'pong'
  | 'peers'
  /** Ask a directly-connected peer to echo back the public IP:port they see
   *  for this socket.  Handled at transport layer only — never gossiped. */
  | 'call-whoami'
  /** Response to call-whoami.  Carries { ip, port, reqId } in data field. */
  | 'call-youare';

export interface P2PMessage {
  /** Unique ID used for deduplication and correlation. */
  id: string;
  type: P2PMessageType;
  /** nodeId of the originating peer. */
  from: string;
  /** nodeId of the intended recipient (omit for broadcast). */
  to?: string;
  data?: unknown;
  /** Number of relay hops so far; enforces MAX_RELAY_HOPS. */
  hops: number;
  timestamp: number;
}

export interface P2PPeerInfo {
  id: string;
  host: string;
  port: number;
  connected: boolean;
  outbound: boolean;
  /** True if the remote peer has at least one active inbound connection,
   *  meaning their port is reachable from the internet. */
  canAcceptInbound: boolean;
  /** Peer's STUN UDP port from handshake, if advertised (decentralized STUN). */
  remoteStunUdpPort?: number;
}

export interface P2PNetworkOptions {
  port?: number;
  apiPort?: number;
  maxPeers?: number;
  initialPeers?: string[];
  /** Path to the shared SQLite database (appData/qortal-shared/chat.db).
   *  When provided, discovered peers are loaded on startup and persisted on
   *  discovery so all Electron instances share the same peer pool. */
  dbPath?: string;
}

// ── Internal peer record ─────────────────────────────────────────────────────

interface PeerRecord extends P2PPeerInfo {
  socket: tls.TLSSocket;
  /** Original TCP "host:port" used to dial this peer — preserved through
   *  re-keying so reconnects always use the correct TCP destination. */
  dialAddr: string;
  reconnectAttempts: number;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  /** Partial-read buffer for newline-delimited JSON records. */
  rxBuffer: Buffer;
  /** Set to true when this peer is intentionally dropped (e.g. duplicate
   *  tie-break).  Prevents onClose from scheduling a reconnect. */
  abortReconnect?: boolean;
  /** Unix-ms timestamp when the handshake completed (peer became connected). */
  connectedAt?: number;
  /** Unix-ms timestamp of the last pong received from this peer. */
  lastPingAt?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Collect every IP address assigned to this machine's network interfaces. */
function buildSelfAddresses(): Set<string> {
  const addrs = new Set<string>();
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      addrs.add(normalizeHost(iface.address));
    }
  }
  return addrs;
}

function normalizeHost(host: string): string {
  if (host === 'localhost' || host === '::1') return '127.0.0.1';
  if (host.startsWith('::ffff:')) return host.slice(7);
  return host;
}

/**
 * Returns true if `host` is a non-routable private/loopback/link-local
 * address that should never be shared in peer exchange.
 * Covers: loopback (127/8), RFC-1918 (10/8, 172.16/12, 192.168/16),
 * and link-local / APIPA (169.254/16).
 */
function isPrivateIP(host: string): boolean {
  if (host.startsWith('127.')) return true; // loopback
  if (host.startsWith('10.')) return true; // RFC-1918 class A
  if (host.startsWith('192.168.')) return true; // RFC-1918 class C
  if (host.startsWith('169.254.')) return true; // link-local / APIPA
  // RFC-1918 class B: 172.16.0.0 – 172.31.255.255
  const m = host.match(/^172\.(\d{1,3})\./);
  if (m) {
    const second = parseInt(m[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

/**
 * Given a list of { ip, port } responses from call-whoami peers, return the
 * most-frequently-seen address (majority vote).  Ties broken by first seen.
 */
function majorityVoteAddr(
  responses: { ip: string; port: number }[]
): { ip: string; port: number } | null {
  if (responses.length === 0) return null;
  const counts = new Map<string, number>();
  for (const r of responses) {
    const key = `${r.ip}:${r.port}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  if (!best) return null;
  const lastColon = best.lastIndexOf(':');
  return {
    ip: best.slice(0, lastColon),
    port: parseInt(best.slice(lastColon + 1), 10),
  };
}

// ── P2PNetwork ───────────────────────────────────────────────────────────────

export class P2PNetwork extends EventEmitter {
  private server: tls.Server | null = null;
  private apiServer: http.Server | null = null;
  private peers = new Map<string, PeerRecord>();
  /** addr → discovery metadata, accumulated for the lifetime of this session. */
  private discoveredPeers = new Map<string, {
    address: string;
    discoveredAt: number;
    /** nodeId of the peer that told us about this address, or 'seed' for
     *  addresses from the initial peer list. */
    source: string;
  }>();
  /** id → absolute expiry timestamp */
  private seenMessages = new Map<string, number>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /** TLS transport credentials — generated once per run in start(). */
  private tlsKey = '';
  private tlsCert = '';

  /** Set permanently to true the first time any inbound peer completes its
   *  handshake.  Once true it never resets — it proves this node's listen
   *  port was reachable at least once during this session. */
  private everHadInbound = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private upnpClient: any = null;
  /** True only if this process mapped STUN UDP via UPnP (must unmap on stop). */
  private ownsStunUdpMapping = false;
  /** Set to true in stop() so a concurrent setupUPnP() knows to tear down immediately. */
  private upnpStopped = false;
  private stopped = false;

  private readonly port: number;
  private readonly apiPort: number;
  private readonly maxPeers: number;
  private readonly initialPeers: string[];
  /** Stable random UUID that uniquely identifies this node instance. Shared
   *  in every handshake and used as the map key after connection is established. */
  readonly nodeId: string;
  /** All IP strings assigned to this machine's network interfaces. */
  private readonly selfAddresses: Set<string>;
  /** Optional shared SQLite DB handle for persisting discovered peers. */
  private peerDb: DB | null = null;
  private stmtInsertPeer: Statement | null = null;

  /**
   * Per-IP inbound connection counter for sliding-window rate limiting.
   * Limits how many new TLS connections a single IP can open per minute,
   * defending against connection-flood spam at the socket level.
   */
  private ipConnCount = new Map<string, { count: number; windowStart: number }>();
  private readonly MAX_INBOUND_PER_IP = 5;
  private readonly IP_WINDOW_MS = 60_000;
  constructor(options: P2PNetworkOptions = {}) {
    super();
    this.port = options.port ?? DEFAULT_P2P_PORT;
    this.apiPort = options.apiPort ?? DEFAULT_API_PORT;
    this.maxPeers = options.maxPeers ?? DEFAULT_MAX_PEERS;
    this.initialPeers = options.initialPeers ?? [];
    this.nodeId = crypto.randomUUID();
    this.selfAddresses = buildSelfAddresses();

    if (options.dbPath) {
      try {
        fs.mkdirSync(path.dirname(options.dbPath), { recursive: true });
        this.peerDb = new Database(options.dbPath);
        this.peerDb.pragma('journal_mode = WAL');
        this.peerDb.pragma('busy_timeout = 5000');
        this.peerDb.pragma('synchronous = NORMAL');
        // Ensure the table exists (chat-db.ts may not have run yet on this instance)
        this.peerDb.exec(`
          CREATE TABLE IF NOT EXISTS discovered_peers (
            address       TEXT PRIMARY KEY,
            discovered_at INTEGER NOT NULL,
            source        TEXT NOT NULL
          )
        `);
        this.stmtInsertPeer = this.peerDb.prepare(`
          INSERT OR IGNORE INTO discovered_peers (address, discovered_at, source)
          VALUES (?, ?, ?)
        `);
        loggerLog('[P2P] Shared peer DB opened for discovered-peer persistence.');
      } catch (err) {
        loggerError('[P2P] Failed to open shared peer DB:', err);
        this.peerDb = null;
        this.stmtInsertPeer = null;
      }
    }
  }

  /** Returns true if `addr` ("host:port") resolves to this node. */
  private isSelfAddr(addr: string): boolean {
    const [rawHost, portStr] = addr.split(':');
    const host = normalizeHost(rawHost);
    const port = parseInt(portStr, 10);
    if (port !== this.port) return false;
    return (
      host === '0.0.0.0' || host === '127.0.0.1' || this.selfAddresses.has(host)
    );
  }

  private clearReconnectTimer(peer: PeerRecord): void {
    if (peer.reconnectTimer) {
      clearTimeout(peer.reconnectTimer);
      peer.reconnectTimer = undefined;
    }
  }

  private removePeerReferences(peer: PeerRecord): void {
    for (const [key, value] of this.peers.entries()) {
      if (value === peer) {
        this.peers.delete(key);
      }
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    await this.generateTLSCredentials();
    await this.listenForInbound();
    this.upnpStopped = false;
    this.stopped = false;
    this.setupUPnP(); // fire-and-forget — UPnP failure must never block startup
    this.scheduleSeenCleanup();
    this.schedulePing();
    if (!isDisabledLegacy) {
      this.startApiServer();
    }

    // Load previously-discovered peers from the shared DB before seeding so
    // all instances share the same bootstrap pool.
    this.loadDiscoveredPeersFromDb();

    for (const addr of this.initialPeers) {
      // Seed the discovery registry with the bootstrap list.
      const [rawHost, portStr] = addr.split(':');
      const host = normalizeHost(rawHost);
      const port = parseInt(portStr, 10);
      if (host && !isNaN(port)) {
        const normalizedAddr = `${host}:${port}`;
        if (!this.discoveredPeers.has(normalizedAddr)) {
          this.discoveredPeers.set(normalizedAddr, {
            address: normalizedAddr,
            discoveredAt: Date.now(),
            source: 'seed',
          });
          this.persistDiscoveredPeer(normalizedAddr, Date.now(), 'seed');
        }
      }
      this.connectToPeer(addr);
    }
    loggerLog(
      `[P2P] Started — listening on port ${this.port}, nodeId: ${this.nodeId}`
    );
  }

  stop(): void {
    // Signal any in-progress setupUPnP() to abort immediately.
    this.upnpStopped = true;
    this.stopped = true;

    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.pingTimer = null;
    this.cleanupTimer = null;

    for (const peer of this.peers.values()) {
      // Mark before destroying so the async 'close' event handler (onClose)
      // sees abortReconnect and does NOT schedule a reconnect attempt.
      peer.abortReconnect = true;
      if (peer.reconnectTimer) clearTimeout(peer.reconnectTimer);
      peer.reconnectTimer = undefined;
      peer.socket.destroy();
    }
    this.peers.clear();
    this.server?.close();
    this.server = null;
    this.apiServer?.closeAllConnections();
    this.apiServer?.close();
    this.apiServer = null;

    // Close shared peer DB handle (best-effort)
    if (this.peerDb) {
      try { this.peerDb.close(); } catch { /* ignore */ }
      this.peerDb = null;
      this.stmtInsertPeer = null;
    }

    // Best-effort UPnP teardown — unmap the port so we don't leave a stale
    // mapping on the router.  Fire-and-forget (stop() stays synchronous).
    if (this.upnpClient) {
      const client = this.upnpClient;
      const unmapStun = this.ownsStunUdpMapping;
      const stunPort = STUN_FIXED_UDP_PORT;
      this.upnpClient = null;
      this.ownsStunUdpMapping = false;
      void unmapTcpPort(client, this.port, this.port)
        .then(() =>
          unmapStun ? unmapUdpPort(client, stunPort, stunPort) : Promise.resolve()
        )
        .finally(() => {
          void destroyNatClient(client);
        });
    }

    loggerLog('[P2P] Stopped.');
  }

  /**
   * Send a message. If `to` is provided and that peer is directly connected,
   * it delivers directly. Otherwise it gossips the message to all connected
   * peers so it can be relayed.
   * Returns the assigned message ID.
   */
  send(to: string | null, data: unknown): string {
    const msg: P2PMessage = {
      id: crypto.randomUUID(),
      type: to ? 'relay' : 'data',
      from: this.nodeId,
      to: to ?? undefined,
      data,
      hops: 0,
      timestamp: Date.now(),
    };
    this.markSeen(msg.id);

    if (to) {
      const peer = this.peers.get(to);
      if (peer?.connected) {
        msg.type = 'data';
        this.writeToSocket(peer, msg);
        return msg.id;
      }
    }

    // No direct connection (or broadcast): gossip to everyone
    this.gossip(msg, null);
    return msg.id;
  }

  /** Attempt to connect to a new peer address ("host:port"). */
  addPeer(addr: string): void {
    if (this.connectedCount() < this.maxPeers) {
      this.connectToPeer(addr);
    }
  }

  getPeers(): P2PPeerInfo[] {
    return Array.from(this.peers.values()).map(
      ({
        id,
        host,
        port,
        connected,
        outbound,
        canAcceptInbound,
        remoteStunUdpPort,
      }) => ({
        id,
        host,
        port,
        connected,
        outbound,
        canAcceptInbound,
        remoteStunUdpPort,
      })
    );
  }

  getPort(): number {
    return this.port;
  }

  /**
   * Map fixed STUN UDP on the existing UPnP client (same gateway as P2P TCP).
   * Call only after this process bound the local STUN UDP socket.
   */
  async mapOwnedStunUdpIfPossible(): Promise<void> {
    if (this.upnpStopped) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const coord = require('./stun-coordinator').getStunCoordinator() as {
      didBindStunUdp(): boolean;
    } | null;
    if (!coord?.didBindStunUdp()) return;
    if (!this.upnpClient) return;
    try {
      const udpRes = await mapUdpPort(this.upnpClient, {
        publicPort: STUN_FIXED_UDP_PORT,
        privatePort: STUN_FIXED_UDP_PORT,
        description: 'Qortal Hub STUN',
      });
      if (this.upnpStopped) return;
      if (udpRes) {
        this.ownsStunUdpMapping = true;
        loggerLog(
          `[P2P] UPnP: port ${STUN_FIXED_UDP_PORT}/UDP mapped successfully.`
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      loggerLog(`[P2P] UPnP: STUN UDP map failed (${msg}).`);
    }
  }

  getNodeId(): string {
    return this.nodeId;
  }

  /** @deprecated Use getNodeId() */
  getPeerId(): string {
    return this.nodeId;
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  connectedCount(): number {
    let n = 0;
    for (const p of this.peers.values()) if (p.connected) n++;
    return n;
  }

  /**
   * Returns connected peers whose listen port is reachable from the internet
   * (canAcceptInbound === true and non-private IP).  Used by the call system
   * to find potential relay candidates.
   */
  getPublicIpPeers(): P2PPeerInfo[] {
    return Array.from(this.peers.values())
      .filter(
        (p) => p.connected && p.canAcceptInbound && !isPrivateIP(p.host)
      )
      .map(({ id, host, port, connected, outbound, canAcceptInbound }) => ({
        id,
        host,
        port,
        connected,
        outbound,
        canAcceptInbound,
      }));
  }

  /**
   * Decentralized STUN: ask up to 3 directly-connected peers to echo back
   * the public IP:port they see for this socket.  Returns the most-commonly
   * reported address (majority vote), or null if no peers are reachable or
   * all time out within 3 seconds.
   */
  askWhoAmI(): Promise<{ ip: string; port: number } | null> {
    return new Promise((resolve) => {
      const peersToAsk: PeerRecord[] = [];
      for (const peer of this.peers.values()) {
        if (!peer.connected) continue;
        peersToAsk.push(peer);
        if (peersToAsk.length >= 3) break;
      }

      if (peersToAsk.length === 0) {
        resolve(null);
        return;
      }

      const responses: { ip: string; port: number }[] = [];

      const finish = (): void => {
        clearTimeout(timer);
        this.off('call-youare', handler);
        resolve(majorityVoteAddr(responses));
      };

      const timer = setTimeout(finish, 3_000);

      const handler = ({ data }: { from: string; data: unknown }): void => {
        const d = data as Record<string, unknown> | null;
        if (d && typeof d.ip === 'string' && typeof d.port === 'number') {
          responses.push({ ip: d.ip, port: d.port });
        }
        if (responses.length >= peersToAsk.length) finish();
      };

      this.on('call-youare', handler);

      for (const peer of peersToAsk) {
        this.writeToSocket(peer, {
          id: crypto.randomUUID(),
          type: 'call-whoami',
          from: this.nodeId,
          hops: 0,
          timestamp: Date.now(),
        });
      }
    });
  }

  /** Returns true if this node has ever successfully accepted an inbound
   *  connection, proving the listen port has been reachable at least once. */
  private hasInboundPeer(): boolean {
    return this.everHadInbound;
  }

  // ── UPnP ────────────────────────────────────────────────────────────────────

  /**
   * Attempt to open an inbound TCP port mapping on the local router via UPnP.
   * This makes the node reachable from the internet without the user needing to
   * configure manual port forwarding.
   *
   * Runs asynchronously after start() so that UPnP unavailability (no router
   * support, firewall, etc.) never delays or blocks the P2P network.
   * On success, the mapping auto-renews until stop() is called.
   */
  private async setupUPnP(): Promise<void> {
    try {
      // Bail out if stop() was called while we were loading the module.
      if (this.upnpStopped) return;

      const client = await createNatApiClient({ description: 'Qortal Hub P2P' });
      if (this.upnpStopped) {
        await destroyNatClient(client);
        return;
      }

      const ok = await mapTcpPort(client, {
        publicPort: this.port,
        privatePort: this.port,
        description: 'Qortal Hub P2P',
      });

      // If stop() raced with the async map() call, tear down and return.
      if (this.upnpStopped) {
        await unmapTcpPort(client, this.port, this.port);
        await destroyNatClient(client);
        return;
      }

      if (!ok) {
        loggerLog(
          `[P2P] UPnP: mapping failed for port ${this.port}/TCP. ` +
            'Manual port forwarding may be needed for inbound connections.'
        );
        await destroyNatClient(client);
        return;
      }

      this.upnpClient = client;
      loggerLog(`[P2P] UPnP: port ${this.port}/TCP mapped successfully.`);
      // STUN UDP (fixed port): mapOwnedStunUdpIfPossible() is also called from setup after coordinator bind;
      // this await covers the common case where TCP map completes after that early attempt (no client yet).
      await this.mapOwnedStunUdpIfPossible();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      loggerLog(
        `[P2P] UPnP: not available (${msg}). ` +
          'Manual port forwarding may be needed for inbound connections.'
      );
    }
  }

  // ── Server ──────────────────────────────────────────────────────────────────

  /** Generate an ephemeral EC P-256 self-signed certificate for TLS transport.
   *  Identity is authenticated at the application layer (Qortal signatures), so
   *  a self-signed cert is sufficient — we just need wire encryption. */
  private async generateTLSCredentials(): Promise<void> {
    const notAfterDate = new Date();
    notAfterDate.setFullYear(notAfterDate.getFullYear() + 10);
    const pems = await generateCert(
      [{ name: 'commonName', value: `qortal-p2p-${this.nodeId}` }],
      {
        keyType: 'ec',
        curve: 'P-256',
        algorithm: 'sha256',
        notAfterDate,
        extensions: [
          { name: 'basicConstraints', cA: false },
          { name: 'keyUsage', digitalSignature: true, keyAgreement: true },
        ],
      }
    );
    this.tlsKey = pems.private;
    this.tlsCert = pems.cert;
  }

  private listenForInbound(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = tls.createServer(
        {
          key: this.tlsKey,
          cert: this.tlsCert,
          // Peers use self-signed certs; identity is verified at app layer.
          requestCert: false,
        },
        (socket) => this.acceptInbound(socket)
      );
      this.server.on('error', (err) => {
        loggerError('[P2P] Server error:', err);
        this.emit('error', err);
        reject(err);
      });
      this.server.listen(this.port, '0.0.0.0', () => resolve());
    });
  }

  private acceptInbound(socket: tls.TLSSocket): void {
    if (this.connectedCount() >= this.maxPeers) {
      socket.destroy();
      return;
    }

    // IP-level sliding-window rate limit: reject IPs that open too many
    // connections in a short window before any P2P/chat logic runs.
    const ip = normalizeHost(socket.remoteAddress ?? '');
    if (ip) {
      const entry = this.ipConnCount.get(ip) ?? { count: 0, windowStart: Date.now() };
      if (Date.now() - entry.windowStart > this.IP_WINDOW_MS) {
        entry.count = 0;
        entry.windowStart = Date.now();
      }
      entry.count++;
      this.ipConnCount.set(ip, entry);
      if (entry.count > this.MAX_INBOUND_PER_IP) {
        loggerLog(`[P2P] Rate-limited inbound from ${ip} (${entry.count} connections in window)`);
        socket.destroy();
        return;
      }
    }

    const tempId = `inbound:${socket.remoteAddress}:${socket.remotePort}`;
    const peer: PeerRecord = {
      id: tempId,
      dialAddr: '',
      host: normalizeHost(socket.remoteAddress ?? ''),
      port: socket.remotePort ?? 0,
      socket,
      connected: false,
      outbound: false,
      canAcceptInbound: false,
      reconnectAttempts: 0,
      rxBuffer: Buffer.alloc(0),
    };
    this.peers.set(tempId, peer);
    this.attachSocketListeners(peer);
    this.sendHandshake(peer);
  }

  // ── Outbound ────────────────────────────────────────────────────────────────

  private connectToPeer(addr: string): void {
    const [rawHost, portStr] = addr.split(':');
    const host = normalizeHost(rawHost);
    const port = parseInt(portStr, 10);
    if (!host || isNaN(port)) return;
    const normalizedAddr = `${host}:${port}`;
    if (this.isSelfAddr(normalizedAddr)) return;

    // Block only if there is already a non-destroyed socket for this dialAddr
    // (connecting or connected). Stale/dead sockets do not block a fresh dial.
    for (const p of this.peers.values()) {
      if (p.dialAddr === normalizedAddr && !p.socket.destroyed) return;
    }

    loggerLog(`[P2P] → Connecting to ${normalizedAddr}`);

    // Create the peer record before tls.connect so the secureConnect callback
    // can close over it as a const.  socket is assigned synchronously on the
    // very next line (tls.connect returns before the callback fires).
    const existing = this.peers.get(normalizedAddr);
    const peer: PeerRecord = {
      id: normalizedAddr,
      dialAddr: normalizedAddr,
      host,
      port,
      socket: null as unknown as tls.TLSSocket, // filled in synchronously below
      connected: false,
      outbound: true,
      canAcceptInbound: false,
      reconnectAttempts: existing?.reconnectAttempts ?? 0,
      rxBuffer: Buffer.alloc(0),
    };

    const socket = tls.connect(
      {
        host,
        port,
        // Self-signed certs on both sides — app-layer signatures handle identity.
        rejectUnauthorized: false,
      },
      () => {
        // Fires on 'secureConnect' — TLS handshake is complete.
        socket.setTimeout(0);
        peer.connected = true;
        peer.reconnectAttempts = 0;
        this.sendHandshake(peer);
        loggerLog(`[P2P] ✓ Connected to ${normalizedAddr}`);
      }
    );
    peer.socket = socket;

    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.on('timeout', () => {
      loggerError(`[P2P] Connect timeout (${normalizedAddr})`);
      socket.destroy();
    });

    this.peers.set(normalizedAddr, peer);
    this.attachSocketListeners(peer);
  }

  // ── Socket lifecycle ─────────────────────────────────────────────────────────

  private attachSocketListeners(peer: PeerRecord): void {
    peer.socket.setKeepAlive(true, 15_000);

    peer.socket.on('data', (chunk: Buffer | string) => {
      const buf =
        typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      if (peer.rxBuffer.length + buf.length > MAX_P2P_RX_BUFFER_HARD_CAP) {
        loggerError(`[P2P] RX buffer hard cap exceeded from ${peer.id}`);
        peer.socket.destroy();
        return;
      }
      peer.rxBuffer = Buffer.concat([peer.rxBuffer, buf]);
      this.drainBuffer(peer);
    });

    peer.socket.on('close', () => this.onClose(peer));

    peer.socket.on('error', (err) => {
      loggerError(`[P2P] Socket error (${peer.id}): ${err.message}`);
      // 'close' fires after 'error', so reconnect logic lives in onClose
    });
  }

  private drainBuffer(peer: PeerRecord): void {
    for (;;) {
      if (peer.rxBuffer.length === 0) return;

      const nl = peer.rxBuffer.indexOf(0x0a);
      if (nl === -1) {
        if (peer.rxBuffer.length > MAX_JSON_LINE_BYTES) {
          loggerError(`[P2P] JSON line exceeds cap (${peer.id})`);
          peer.socket.destroy();
        }
        return;
      }
      if (nl > MAX_JSON_LINE_BYTES) {
        loggerError(`[P2P] JSON line exceeds cap (${peer.id})`);
        peer.socket.destroy();
        return;
      }

      let lineEnd = nl;
      if (lineEnd > 0 && peer.rxBuffer[lineEnd - 1] === 0x0d) {
        lineEnd -= 1;
      }
      const lineBuf = peer.rxBuffer.subarray(0, lineEnd);
      peer.rxBuffer = peer.rxBuffer.subarray(nl + 1);

      const raw = lineBuf.toString('utf8').trim();
      if (!raw) continue;
      try {
        const msg = JSON.parse(raw) as P2PMessage;
        this.dispatch(peer, msg);
      } catch {
        loggerError(`[P2P] Malformed message from ${peer.id}`);
      }
    }
  }

  private onClose(peer: PeerRecord): void {
    const wasConnected = peer.connected;
    peer.connected = false;
    loggerLog(`[P2P] ✗ Disconnected from ${peer.id}`);
    if (wasConnected) this.emit('peer-disconnected', { id: peer.id });

    if (peer.abortReconnect) {
      this.clearReconnectTimer(peer);
      this.removePeerReferences(peer);
      return;
    }

    if (peer.outbound) {
      this.removePeerReferences(peer);
      peer.id = peer.dialAddr;
      this.peers.set(peer.dialAddr, peer);
      this.scheduleReconnect(peer);
    } else {
      this.clearReconnectTimer(peer);
      this.removePeerReferences(peer);
      this.recheckInitialPeers();
    }
  }

  /** Re-attempt connections to initial peers that have no live socket. */
  private recheckInitialPeers(): void {
    if (this.stopped) return;
    for (const addr of this.initialPeers) {
      if (this.connectedCount() >= this.maxPeers) return;
      this.connectToPeer(addr);
    }
  }

  private scheduleReconnect(peer: PeerRecord): void {
    // Don't schedule reconnects after the network has been stopped.
    if (this.stopped) return;
    const target = peer.dialAddr || peer.id;
    peer.reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, peer.reconnectAttempts - 1),
      RECONNECT_MAX_MS
    );
    loggerLog(
      `[P2P] Reconnecting to ${target} in ${delay}ms (attempt ${peer.reconnectAttempts})`
    );
    peer.reconnectTimer = setTimeout(() => {
      peer.reconnectTimer = undefined;
      if (this.connectedCount() < this.maxPeers) {
        this.connectToPeer(target);
      } else {
        this.scheduleReconnect(peer);
      }
    }, delay);
  }

  // ── Message dispatch ─────────────────────────────────────────────────────────

  private dispatch(peer: PeerRecord, msg: P2PMessage): void {
    switch (msg.type) {
      case 'handshake':
        this.handleHandshake(peer, msg);
        break;
      case 'ping':
        this.writeToSocket(peer, {
          id: crypto.randomUUID(),
          type: 'pong',
          from: this.nodeId,
          hops: 0,
          timestamp: Date.now(),
        });
        break;
      case 'pong':
        peer.lastPingAt = Date.now();
        break;
      case 'peers':
        // Point-to-point only — never relay, never deduplicate via seenMessages.
        this.handlePeerList(msg);
        break;
      case 'data':
      case 'relay':
        this.handlePayload(peer, msg);
        break;
      case 'call-whoami':
        // Reply with the public IP:port we observe on this socket.
        if (peer.connected) {
          this.writeToSocket(peer, {
            id: crypto.randomUUID(),
            type: 'call-youare',
            from: this.nodeId,
            to: msg.from,
            data: {
              ip: normalizeHost(peer.socket.remoteAddress ?? ''),
              port: peer.socket.remotePort ?? 0,
              reqId: msg.id,
            },
            hops: 0,
            timestamp: Date.now(),
          });
        }
        break;
      case 'call-youare':
        // Deliver to local awaiter only — never relay.
        if (!msg.to || msg.to === this.nodeId) {
          this.emit('call-youare', { from: msg.from, data: msg.data });
        }
        break;
    }
  }

  private handleHandshake(peer: PeerRecord, msg: P2PMessage): void {
    const remoteNodeId = msg.from;
    const handshakeData =
      msg.data && typeof msg.data === 'object'
        ? (msg.data as Record<string, unknown>)
        : null;
    const advertisedPort =
      typeof handshakeData?.port === 'number' &&
      Number.isInteger(handshakeData.port)
        ? handshakeData.port
        : undefined;
    const advertisedCanAcceptInbound = handshakeData?.canAcceptInbound === true;
    const rawStun = handshakeData?.stunUdpPort;
    const advertisedStunUdp =
      typeof rawStun === 'number' &&
      Number.isInteger(rawStun) &&
      rawStun >= 1 &&
      rawStun <= 65535
        ? rawStun
        : undefined;

    // Reject self-connections: same nodeId means we somehow connected to
    // ourselves (shouldn't happen, but guard it anyway).
    if (remoteNodeId === this.nodeId) {
      loggerLog('[P2P] Dropping self-connection (same nodeId).');
      peer.abortReconnect = true;
      this.clearReconnectTimer(peer);
      peer.socket.destroy();
      this.removePeerReferences(peer);
      return;
    }

    // Also reject by address for local-instance self-connections where the
    // other side hasn't sent a handshake yet.
    if (peer.dialAddr && this.isSelfAddr(peer.dialAddr)) {
      loggerLog('[P2P] Dropping self-connection (self addr).');
      peer.abortReconnect = true;
      this.clearReconnectTimer(peer);
      peer.socket.destroy();
      this.removePeerReferences(peer);
      return;
    }

    if (!peer.dialAddr && advertisedPort) {
      peer.port = advertisedPort;
      peer.dialAddr = `${normalizeHost(peer.host)}:${advertisedPort}`;

      const dialPeer = this.peers.get(peer.dialAddr);
      if (dialPeer && dialPeer !== peer && !dialPeer.connected) {
        this.clearReconnectTimer(dialPeer);
        this.removePeerReferences(dialPeer);
      }
    }

    // Reject duplicates using a deterministic tie-break so both sides agree on
    // which connection to keep, preventing an infinite reconnect loop when both
    // nodes dial each other simultaneously.  Only apply when the existing entry
    // is actually connected — a disconnected entry is a stale reconnect record
    // and should be overwritten, not treated as a live duplicate.
    const existing = this.peers.get(remoteNodeId);
    if (existing && existing !== peer && existing.connected) {
      // The node with the lexicographically higher nodeId keeps its outbound
      // connection; the other side keeps the inbound it received.
      const keepOutbound = this.nodeId > remoteNodeId;
      const keepNew = keepOutbound ? peer.outbound : !peer.outbound;
      if (keepNew) {
        loggerLog(
          `[P2P] Duplicate (${remoteNodeId.slice(0, 8)}…); dropping existing, keeping new.`
        );
        existing.abortReconnect = true;
        this.clearReconnectTimer(existing);
        existing.socket.destroy();
        this.removePeerReferences(existing);
        // fall through to re-key the new peer below
      } else {
        loggerLog(
          `[P2P] Duplicate (${remoteNodeId.slice(0, 8)}…); dropping new, keeping existing.`
        );
        peer.abortReconnect = true;
        this.clearReconnectTimer(peer);
        peer.socket.destroy();
        this.removePeerReferences(peer);
        return;
      }
    }

    this.clearReconnectTimer(peer);
    this.removePeerReferences(peer);
    peer.id = remoteNodeId;
    peer.connected = true;
    peer.canAcceptInbound = advertisedCanAcceptInbound;
    peer.remoteStunUdpPort = advertisedStunUdp;
    peer.connectedAt = Date.now();
    // Latch: once we've successfully accepted an inbound connection our port
    // is proven reachable — remember it for the rest of this session.
    if (!peer.outbound) this.everHadInbound = true;
    this.peers.set(remoteNodeId, peer);
    loggerLog(
      `[P2P] Handshake complete with ${remoteNodeId.slice(0, 8)}… (${peer.dialAddr || peer.host})`
    );
    this.emit('peer-connected', { id: remoteNodeId });
    // Share our known peers so the new connection can discover the rest of
    // the network without relying solely on the seed list.
    this.sendPeerList(peer);
  }

  private handlePayload(peer: PeerRecord, msg: P2PMessage): void {
    if (this.hasSeen(msg.id)) return;
    this.markSeen(msg.id);
    this.routeRelayJsonMessage(peer, msg);
  }

  /** JSON `data`/`relay`: dedup already applied by `handlePayload`. */
  private routeRelayJsonMessage(peer: PeerRecord, msg: P2PMessage): void {
    const forMe = !msg.to || msg.to === this.nodeId;
    if (forMe) {
      this.emit('message', {
        id: msg.id,
        from: msg.from,
        via: peer.id,
        to: msg.to,
        data: msg.data,
      });
    }

    if (msg.to && msg.to !== this.nodeId) {
      const target = this.peers.get(msg.to);
      if (target?.connected) {
        this.writeToSocket(target, { ...msg, hops: msg.hops + 1 });
        return;
      }
    }

    if (msg.hops < MAX_RELAY_HOPS) {
      this.gossip({ ...msg, hops: msg.hops + 1 }, peer.id);
    }
  }

  // ── Peer exchange ─────────────────────────────────────────────────────────────

  /**
   * Send our currently-connected peers' dial addresses to `toPeer` so they can
   * expand their own connection set. Called once per successful handshake.
   * We share at most MAX_PEER_ADDRS addresses, skip peers with no known
   * dial address (inbound-only peers we can't help others reach), and never
   * send the receiving peer its own address back.
   */
  private sendPeerList(toPeer: PeerRecord): void {
    const addrs: string[] = [];
    for (const p of this.peers.values()) {
      if (p === toPeer) continue; // don't send them their own addr
      if (!p.connected) continue; // only share live peers
      if (!p.dialAddr) continue; // can't reach peers with no dial addr
      if (p.dialAddr === toPeer.dialAddr) continue; // same as above by addr
      // Never share private/loopback/link-local addresses — they are
      // unreachable by peers on the public internet and would only generate
      // spurious connection attempts and log noise.
      const [host, portStr] = p.dialAddr.split(':');
      if (isPrivateIP(host)) continue;
      // Only advertise peers on the canonical P2P port. Non-default ports
      // (62392, 62393 …) belong to secondary local instances that are not
      // externally reachable, so sharing them would only waste connection
      // attempts on remote peers.
      if (parseInt(portStr, 10) !== DEFAULT_P2P_PORT) continue;
      addrs.push(p.dialAddr);
      if (addrs.length >= MAX_PEER_ADDRS) break;
    }
    if (addrs.length === 0) return;

    this.writeToSocket(toPeer, {
      id: crypto.randomUUID(),
      type: 'peers',
      from: this.nodeId,
      data: { addrs },
      hops: 0,
      timestamp: Date.now(),
    });
  }

  /**
   * Receive a list of peer addresses from a connected peer and attempt to
   * connect to any we don't already know, up to our maxPeers cap.
   * Addresses are validated and normalised before dialling.
   */
  private handlePeerList(msg: P2PMessage): void {
    if (!msg.data || typeof msg.data !== 'object') return;
    const raw = (msg.data as Record<string, unknown>).addrs;
    if (!Array.isArray(raw)) return;

    // Cap to MAX_PEER_ADDRS to prevent a malicious peer from flooding us.
    const addrs = raw.slice(0, MAX_PEER_ADDRS);

    for (const addr of addrs) {
      if (typeof addr !== 'string') continue;
      if (this.connectedCount() >= this.maxPeers) break;

      // Basic sanity: must be "host:port"
      const colonIdx = addr.lastIndexOf(':');
      if (colonIdx <= 0) continue;
      const host = normalizeHost(addr.slice(0, colonIdx));
      const port = parseInt(addr.slice(colonIdx + 1), 10);
      if (!host || isNaN(port) || port < 1 || port > 65535) continue;

      const normalizedAddr = `${host}:${port}`;
      if (this.isSelfAddr(normalizedAddr)) continue;

      // Record in the discovery registry regardless of whether we can
      // connect right now — first-seen wins, so we never overwrite.
      if (!this.discoveredPeers.has(normalizedAddr)) {
        this.discoveredPeers.set(normalizedAddr, {
          address: normalizedAddr,
          discoveredAt: Date.now(),
          source: msg.from,
        });
        this.persistDiscoveredPeer(normalizedAddr, Date.now(), msg.from);
      }

      // connectToPeer already deduplicates — but skip early if obviously known.
      let alreadyConnected = false;
      for (const p of this.peers.values()) {
        if (p.dialAddr === normalizedAddr && !p.socket.destroyed) {
          alreadyConnected = true;
          break;
        }
      }
      if (alreadyConnected) continue;

      this.connectToPeer(normalizedAddr);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  // ── Peer DB helpers ───────────────────────────────────────────────────────

  /** Load all rows from discovered_peers into the in-memory Map on startup. */
  private loadDiscoveredPeersFromDb(): void {
    if (!this.peerDb) return;
    try {
      const rows = this.peerDb
        .prepare('SELECT address, discovered_at, source FROM discovered_peers')
        .all() as { address: string; discovered_at: number; source: string }[];
      let loaded = 0;
      for (const row of rows) {
        if (!this.discoveredPeers.has(row.address)) {
          this.discoveredPeers.set(row.address, {
            address: row.address,
            discoveredAt: row.discovered_at,
            source: row.source,
          });
          loaded++;
        }
      }
      if (loaded > 0) {
        loggerLog(`[P2P] Loaded ${loaded} discovered peers from shared DB.`);
      }
    } catch (err) {
      loggerError('[P2P] Failed to load discovered peers from DB:', err);
    }
  }

  /**
   * Persist a newly-discovered peer address to the shared DB.
   * Uses INSERT OR IGNORE so the first-discovered record wins across instances.
   * Called off the hot path via setImmediate.
   */
  private persistDiscoveredPeer(address: string, discoveredAt: number, source: string): void {
    if (!this.stmtInsertPeer) return;
    setImmediate(() => {
      try {
        this.stmtInsertPeer!.run(address, discoveredAt, source);
      } catch (err) {
        loggerError('[P2P] Failed to persist discovered peer:', err);
      }
    });
  }

  private sendHandshake(peer: PeerRecord): void {
    const data: Record<string, unknown> = {
      port: this.port,
      canAcceptInbound: this.hasInboundPeer(),
      stunUdpPort: STUN_FIXED_UDP_PORT,
      stunWireVersion: STUN_WIRE_VERSION,
    };
    this.writeToSocket(peer, {
      id: crypto.randomUUID(),
      type: 'handshake',
      from: this.nodeId,
      data,
      hops: 0,
      timestamp: Date.now(),
    });
  }

  /** Fan-out JSON messages to all connected peers. */
  private gossip(msg: P2PMessage, excludeId: string | null): void {
    for (const peer of this.peers.values()) {
      if (!peer.connected || peer.id === excludeId) continue;
      this.writeToSocket(peer, msg);
    }
  }

  private writeToSocket(peer: PeerRecord, msg: P2PMessage): void {
    try {
      if (!peer.socket.destroyed && peer.socket.writable) {
        peer.socket.write(JSON.stringify(msg) + '\n');
      }
    } catch (err) {
      loggerError(`[P2P] Write error to ${peer.id}:`, err);
    }
  }

  private writeBinaryToSocket(peer: PeerRecord, buf: Buffer): boolean {
    try {
      if (!peer.socket.destroyed && peer.socket.writable) {
        peer.socket.write(buf);
        return true;
      }
    } catch (err) {
      loggerError(`[P2P] Binary write error to ${peer.id}:`, err);
    }
    return false;
  }

  private hasSeen(id: string): boolean {
    const expiry = this.seenMessages.get(id);
    if (expiry === undefined) return false;
    if (Date.now() > expiry) {
      this.seenMessages.delete(id);
      return false;
    }
    return true;
  }

  private markSeen(id: string): void {
    this.seenMessages.set(id, Date.now() + SEEN_MESSAGE_TTL_MS);
  }

  private scheduleSeenCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, expiry] of this.seenMessages) {
        if (now > expiry) this.seenMessages.delete(id);
      }
    }, SEEN_MESSAGE_TTL_MS);
    this.cleanupTimer.unref();
  }

  // ── Local HTTP API ────────────────────────────────────────────────────────

  private startApiServer(): void {
    if (isDisabledLegacy) return;
    const now = () => Date.now();

    const connectedPeers = (): PeerRecord[] =>
      Array.from(this.peers.values()).filter((p) => p.connected);

    const formatAge = (ms: number): string => {
      const totalSec = Math.floor(ms / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      return `${mins}m ${secs}s`;
    };

    const sendJson = (
      res: http.ServerResponse,
      body: unknown,
      status = 200
    ): void => {
      const json = JSON.stringify(body, null, 2);
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(json),
      });
      res.end(json);
    };

    this.apiServer = http.createServer((req, res) => {
      const url = req.url ?? '';

      if (url === '/hub/peers/summary') {
        const peers = connectedPeers();
        const inbound = peers.filter((p) => !p.outbound).length;
        const outbound = peers.filter((p) => p.outbound).length;
        sendJson(res, {
          totalConnected: peers.length,
          inbound,
          outbound,
          nodeId: this.nodeId,
          listenAddress: `0.0.0.0:${this.port}`,
        });
        return;
      }

      if (url === '/hub/peers') {
        const t = now();
        const peers = connectedPeers().map((p) => {
          const ageMs = p.connectedAt != null ? t - p.connectedAt : 0;
          const lastPingSec =
            p.lastPingAt != null
              ? Math.floor((t - p.lastPingAt) / 1000)
              : null;
          return {
            nodeId: p.id,
            address: p.dialAddr || `${p.host}:${p.port}`,
            direction: p.outbound ? 'OUTBOUND' : 'INBOUND',
            connectedWhen: p.connectedAt ?? null,
            ageMinutes: Math.floor(ageMs / 60_000),
            age: formatAge(ageMs),
            lastPing: lastPingSec,
            canAcceptInbound: p.canAcceptInbound,
          };
        });
        sendJson(res, peers);
        return;
      }

      if (url === '/hub/peers/discovered') {
        const t = Date.now();
        const result = Array.from(this.discoveredPeers.values()).map((d) => {
          // Derive live connection status from the peers map.
          let status: 'connected' | 'connecting' | 'unreachable' | 'unknown' =
            'unknown';
          for (const p of this.peers.values()) {
            if (p.dialAddr === d.address || p.id === d.address) {
              if (p.connected) { status = 'connected'; break; }
              if (!p.socket.destroyed) { status = 'connecting'; break; }
              status = 'unreachable';
              break;
            }
          }
          return {
            address: d.address,
            discoveredAt: d.discoveredAt,
            discoveredAgo: `${Math.floor((t - d.discoveredAt) / 1000)}s ago`,
            source: d.source,
            status,
          };
        });
        // Sort: connected first, then connecting, then the rest by discovery time desc.
        result.sort((a, b) => {
          const order = { connected: 0, connecting: 1, unknown: 2, unreachable: 3 };
          const diff = order[a.status] - order[b.status];
          return diff !== 0 ? diff : b.discoveredAt - a.discoveredAt;
        });
        sendJson(res, result);
        return;
      }

      sendJson(res, { error: 'Not found' }, 404);
    });

    this.apiServer.listen(this.apiPort, '127.0.0.1', () => {
      loggerLog(
        `[P2P] API server listening on http://127.0.0.1:${this.apiPort}`
      );
    });

    this.apiServer.on('error', (err: NodeJS.ErrnoException) => {
      loggerError(`[P2P] API server error: ${err.message}`);
    });
  }

  private schedulePing(): void {
    this.pingTimer = setInterval(() => {
      const ping: P2PMessage = {
        id: crypto.randomUUID(),
        type: 'ping',
        from: this.nodeId,
        hops: 0,
        timestamp: Date.now(),
      };
      for (const peer of this.peers.values()) {
        if (peer.connected) this.writeToSocket(peer, ping);
      }
    }, PING_INTERVAL_MS);
    this.pingTimer.unref();
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────

let instance: P2PNetwork | null = null;

export function getP2PNetwork(): P2PNetwork | null {
  return instance;
}

export async function startP2PNetwork(
  options: P2PNetworkOptions = {}
): Promise<P2PNetwork> {
  if (instance) {
    instance.stop();
    instance = null;
  }
  instance = new P2PNetwork(options);
  await instance.start();
  return instance;
}

export function stopP2PNetwork(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./stun-coordinator').stopStunCoordinator();
  } catch {
    /* ignore */
  }
  instance?.stop();
  instance = null;
}
