import * as net from 'net';
import * as tls from 'tls';
import * as http from 'http';
import * as crypto from 'crypto';
import * as os from 'os';
import { EventEmitter } from 'events';
import { generate as generateCert } from 'selfsigned';
import { log as loggerLog, error as loggerError } from './logger';

export const DEFAULT_P2P_PORT = 62391;
export const DEFAULT_MAX_PEERS = 16;
export const DEFAULT_API_PORT = 62390;

const MAX_RELAY_HOPS = 4;
const SEEN_MESSAGE_TTL_MS = 60_000;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;
const PING_INTERVAL_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;
/** Max addresses shared in a single peer-exchange message. */
const MAX_PEER_ADDRS = 16;

// ── Types ────────────────────────────────────────────────────────────────────

export type P2PMessageType =
  | 'handshake'
  | 'data'
  | 'relay'
  | 'ping'
  | 'pong'
  | 'peers';

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
}

export interface P2PNetworkOptions {
  port?: number;
  apiPort?: number;
  maxPeers?: number;
  initialPeers?: string[];
}

// ── Internal peer record ─────────────────────────────────────────────────────

interface PeerRecord extends P2PPeerInfo {
  socket: tls.TLSSocket;
  /** Original TCP "host:port" used to dial this peer — preserved through
   *  re-keying so reconnects always use the correct TCP destination. */
  dialAddr: string;
  reconnectAttempts: number;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  /** Partial-read buffer for newline-delimited JSON framing. */
  buffer: string;
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

  constructor(options: P2PNetworkOptions = {}) {
    super();
    this.port = options.port ?? DEFAULT_P2P_PORT;
    this.apiPort = options.apiPort ?? DEFAULT_API_PORT;
    this.maxPeers = options.maxPeers ?? DEFAULT_MAX_PEERS;
    this.initialPeers = options.initialPeers ?? [];
    this.nodeId = crypto.randomUUID();
    this.selfAddresses = buildSelfAddresses();
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
    this.startApiServer();
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

    // Best-effort UPnP teardown — unmap the port so we don't leave a stale
    // mapping on the router.  Fire-and-forget (stop() stays synchronous).
    if (this.upnpClient) {
      const client = this.upnpClient;
      this.upnpClient = null;
      client
        .unmap({
          publicPort: this.port,
          privatePort: this.port,
          protocol: 'TCP',
        })
        .catch(() => {
          /* best-effort */
        })
        .finally(() => client.destroy().catch(() => {}));
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
      ({ id, host, port, connected, outbound, canAcceptInbound }) => ({
        id,
        host,
        port,
        connected,
        outbound,
        canAcceptInbound,
      })
    );
  }

  getPort(): number {
    return this.port;
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
      // Dynamic import bridges the ESM-only package into our CommonJS build.
      // Wrapping in new Function() prevents the TypeScript CommonJS compiler
      // from rewriting import() to require() — require() fails on ESM packages.
      const load = new Function('return import("@silentbot1/nat-api")');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { default: NatAPI } = (await load()) as { default: any };

      // Bail out if stop() was called while we were loading the module.
      if (this.upnpStopped) return;

      const client = new NatAPI({
        enableUPNP: true,
        enablePMP: false, // NAT-PMP is less common; skip for simplicity
        autoUpdate: true, // library handles lease renewal automatically
        ttl: 7200, // 2-hour lease; renewed ~10 min before expiry
        description: 'Qortal Hub P2P',
      });

      const result = await client.map({
        publicPort: this.port,
        privatePort: this.port,
        protocol: 'TCP',
        ttl: 7200,
        description: 'Qortal Hub P2P',
      });

      // If stop() raced with the async map() call, tear down and return.
      if (this.upnpStopped) {
        client
          .unmap({
            publicPort: this.port,
            privatePort: this.port,
            protocol: 'TCP',
          })
          .catch(() => {});
        client.destroy().catch(() => {});
        return;
      }

      if (result === false) {
        loggerLog(
          `[P2P] UPnP: mapping failed for port ${this.port}/TCP. ` +
            'Manual port forwarding may be needed for inbound connections.'
        );
        await client.destroy().catch(() => {});
        return;
      }

      this.upnpClient = client;
      loggerLog(`[P2P] UPnP: port ${this.port}/TCP mapped successfully.`);
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
      buffer: '',
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
      buffer: '',
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
      peer.buffer +=
        typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      this.drainBuffer(peer);
    });

    peer.socket.on('close', () => this.onClose(peer));

    peer.socket.on('error', (err) => {
      loggerError(`[P2P] Socket error (${peer.id}): ${err.message}`);
      // 'close' fires after 'error', so reconnect logic lives in onClose
    });
  }

  private drainBuffer(peer: PeerRecord): void {
    let nl: number;
    while ((nl = peer.buffer.indexOf('\n')) !== -1) {
      const raw = peer.buffer.slice(0, nl).trim();
      peer.buffer = peer.buffer.slice(nl + 1);
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
      // Try to deliver directly to the intended recipient
      const target = this.peers.get(msg.to);
      if (target?.connected) {
        this.writeToSocket(target, { ...msg, hops: msg.hops + 1 });
        return;
      }
    }

    // Gossip to all other peers when hops budget allows
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

  private sendHandshake(peer: PeerRecord): void {
    this.writeToSocket(peer, {
      id: crypto.randomUUID(),
      type: 'handshake',
      from: this.nodeId,
      data: {
        port: this.port,
        canAcceptInbound: this.hasInboundPeer(),
      },
      hops: 0,
      timestamp: Date.now(),
    });
  }

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
  instance?.stop();
  instance = null;
}
