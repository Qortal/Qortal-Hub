import * as net from 'net';
import * as tls from 'tls';
import * as crypto from 'crypto';
import * as os from 'os';
import { EventEmitter } from 'events';
import { generate as generateCert } from 'selfsigned';
import { log as loggerLog, error as loggerError } from './logger';

export const DEFAULT_P2P_PORT = 62362;
export const DEFAULT_MAX_PEERS = 16;

const MAX_RELAY_HOPS = 10;
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
}

export interface P2PNetworkOptions {
  port?: number;
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
  private peers = new Map<string, PeerRecord>();
  /** id → absolute expiry timestamp */
  private seenMessages = new Map<string, number>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /** TLS transport credentials — generated once per run in start(). */
  private tlsKey = '';
  private tlsCert = '';

  private readonly port: number;
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
    this.scheduleSeenCleanup();
    this.schedulePing();
    for (const addr of this.initialPeers) {
      this.connectToPeer(addr);
    }
    loggerLog(
      `[P2P] Started — listening on port ${this.port}, nodeId: ${this.nodeId}`
    );
  }

  stop(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.pingTimer = null;
    this.cleanupTimer = null;

    for (const peer of this.peers.values()) {
      if (peer.reconnectTimer) clearTimeout(peer.reconnectTimer);
      peer.socket.destroy();
    }
    this.peers.clear();
    this.server?.close();
    this.server = null;
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
      ({ id, host, port, connected, outbound }) => ({
        id,
        host,
        port,
        connected,
        outbound,
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
    for (const addr of this.initialPeers) {
      if (this.connectedCount() >= this.maxPeers) return;
      this.connectToPeer(addr);
    }
  }

  private scheduleReconnect(peer: PeerRecord): void {
    // Use the original dial address, not the re-keyed nodeId, so we connect
    // to the correct TCP destination.
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
      const host = p.dialAddr.split(':')[0];
      if (isPrivateIP(host)) continue;
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
