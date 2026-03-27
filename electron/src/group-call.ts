/**
 * Group Call protocol for the Qortal Hub P2P network.
 *
 * Implements fully decentralized group voice call signaling on top of the
 * existing P2P mesh.  All GC_* messages are ephemeral (never stored to disk).
 *
 * Architecture (handled entirely in the renderer):
 *   - Adaptive topology: ≤10 members → single forwarder, 11-50 → hierarchical
 *   - WebRTC DataChannel for audio transport (Opus ~24 kbps)
 *   - P2P GC_AUDIO relay as last-resort fallback
 *   - End-to-end encryption: v2/v3 wire nonce||secretbox(inner); v1 decode fallback in renderer
 *
 * This module handles only the signaling layer:
 *   GC_JOIN / GC_LEAVE       — room membership
 *   GC_TOPOLOGY              — forwarder tree broadcast (with topologyEpoch)
 *   GC_CLUSTER_HEARTBEAT     — per cluster-forwarder liveness (signed)
 *   GC_AUDIO                 — P2P audio relay fallback
 *   GC_KEY / GC_KEY_ROTATE   — room media key distribution
 *   GC_RTC_OFFER/ANSWER/ICE  — WebRTC DataChannel signaling
 *   GC_RTC_RECONNECT         — forwarder asks member to re-offer immediately
 *
 * Security: GC_JOIN, GC_LEAVE, GC_TOPOLOGY, GC_CLUSTER_HEARTBEAT, GC_KEY, GC_KEY_ROTATE, and
 * GC_KEY_REQUEST carry Ed25519 signatures.
 * When this node has no local state for a room, JOIN/LEAVE/TOPOLOGY are relayed
 * without signature verification (cheap path); in-room peers still verify before use.
 */

import * as nodeCrypto from 'crypto';
import { EventEmitter } from 'events';
import { log as loggerLog, error as loggerError, warn as loggerWarn } from './logger';
import type { P2PNetwork } from './p2p-network';
import type { PresenceManager } from './presence';
import { VerifyWorkerPool } from './verify-worker-pool';
import {
  encodeGcAudioBinaryFrame,
  GcAudioBinaryEncodeError,
} from './gc-audio-binary-frame';

// ── Constants ─────────────────────────────────────────────────────────────────

const GC_MAX_HOPS = 3;
const GC_AUDIO_MAX_HOPS = 2;
const GC_JOIN_TTL_MS = 120_000;
/** v3: callSessionId + mediaSessionGeneration + keyCommitment (no topology/key epoch on wire). */
const GC_KEY_MESSAGE_VERSION = 3;

/** Max base64 length for `GC_AUDIO.data` (matches renderer wire + margin; rejects oversize before relay/emit). */
const GC_AUDIO_MAX_BASE64_CHARS = 16_384;
/** After base64 decode; rejects absurd blobs before IPC to renderer. */
const GC_AUDIO_MAX_BINARY_WIRE_BYTES = 12_288;

/** Per-room token bucket: approx bytes (decoded wire) we will relay per wall-clock ms refill. */
const GC_AUDIO_RELAY_BUCKET_MAX = 1_200_000;
const GC_AUDIO_RELAY_REFILL_BYTES_PER_MS = 800;

function isValidGcAudioBase64(data: unknown): data is string {
  return typeof data === 'string' && data.length > 0 && data.length <= GC_AUDIO_MAX_BASE64_CHARS;
}

function isValidGcAudioBuffer(data: Buffer): boolean {
  return data.length > 0 && data.length <= GC_AUDIO_MAX_BINARY_WIRE_BYTES;
}

/** Approximate decoded byte cost for bucket accounting (upper bound from base64 length). */
function gcAudioPayloadApproxBytes(base64: string): number {
  return Math.min(GC_AUDIO_MAX_BASE64_CHARS * 3, Math.ceil((base64.length * 3) / 4));
}

// ── Wire types ────────────────────────────────────────────────────────────────

export type GroupCallMsgType =
  | 'GC_JOIN'
  | 'GC_LEAVE'
  | 'GC_TOPOLOGY'
  | 'GC_CLUSTER_HEARTBEAT'
  | 'GC_AUDIO'
  | 'GC_KEY'
  | 'GC_KEY_ROTATE'
  | 'GC_KEY_REQUEST'
  | 'GC_RTC_OFFER'
  | 'GC_RTC_ANSWER'
  | 'GC_RTC_ICE'
  | 'GC_RTC_RECONNECT';

export const GC_MESSAGE_TYPES = new Set<string>([
  'GC_JOIN', 'GC_LEAVE', 'GC_TOPOLOGY', 'GC_CLUSTER_HEARTBEAT', 'GC_AUDIO',
  'GC_KEY', 'GC_KEY_ROTATE', 'GC_KEY_REQUEST', 'GC_RTC_OFFER', 'GC_RTC_ANSWER', 'GC_RTC_ICE',
  'GC_RTC_RECONNECT',
]);

// ── Envelope shapes ───────────────────────────────────────────────────────────

export interface GcJoinEnvelope {
  type: 'GC_JOIN';
  roomId: string;
  chatId: string;
  fromAddress: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  /** Per logical join session; stable across mesh re-announces from the same client. */
  joinGeneration?: number;
  hopsRemaining?: number;
}

export interface GcLeaveEnvelope {
  type: 'GC_LEAVE';
  roomId: string;
  fromAddress: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export interface ClusterDef {
  members: string[];
  forwarder: string;
  standby: string;
  standby2: string;
}

export interface GcTopologyEnvelope {
  type: 'GC_TOPOLOGY';
  roomId: string;
  topologyEpoch: number;
  rootForwarder: string;
  standbyForwarder: string;
  clusters: ClusterDef[];
  /** Root's local ms timestamp — used for heartbeat tracking by peers. */
  lastSeen: number;
  fromAddress: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export interface GcClusterHeartbeatEnvelope {
  type: 'GC_CLUSTER_HEARTBEAT';
  roomId: string;
  topologyEpoch: number;
  /** Must equal fromAddress — the cluster forwarder sending liveness. */
  clusterForwarder: string;
  clusterIndex: number;
  seq: number;
  fromAddress: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export interface GcAudioEnvelope {
  type: 'GC_AUDIO';
  roomId: string;
  toAddress: string;
  /** Base64-encoded encrypted audio packet (v2/v3 or v1 wire, see renderer audioPacketCodec) */
  data: string;
  hopsRemaining?: number;
}

export interface GcKeyEnvelope {
  type: 'GC_KEY';
  roomId: string;
  toAddress: string;
  fromAddress: string;
  fromPublicKey: string;
  /** Base64-encoded nacl.box-encrypted room media key */
  encryptedKey: string;
  keyMessageVersion: number;
  callSessionId: string;
  mediaSessionGeneration: number;
  keyCommitment: string;
  encryptedKeyDigest: string;
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export interface GcKeyRotateEnvelope {
  type: 'GC_KEY_ROTATE';
  roomId: string;
  fromAddress: string;
  fromPublicKey: string;
  /** Base64-encoded encrypted room media keys — map of address → encryptedKey */
  encryptedKeys: Record<string, string>;
  keyMessageVersion: number;
  callSessionId: string;
  mediaSessionGeneration: number;
  keyCommitment: string;
  encryptedKeysDigest: string;
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export interface GcKeyRequestEnvelope {
  type: 'GC_KEY_REQUEST';
  roomId: string;
  toAddress: string;
  fromAddress: string;
  fromPublicKey: string;
  callSessionId: string;
  mediaSessionGeneration: number;
  keyMessageVersion: number;
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export interface GcRtcOfferEnvelope {
  type: 'GC_RTC_OFFER';
  roomId: string;
  fromAddress: string;
  toAddress: string;
  /** SDP offer string */
  sdp: string;
  /** Unique connection id to match answer */
  connId: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export interface GcRtcAnswerEnvelope {
  type: 'GC_RTC_ANSWER';
  roomId: string;
  fromAddress: string;
  toAddress: string;
  sdp: string;
  connId: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  hopsRemaining?: number;
}

export interface GcRtcIceEnvelope {
  type: 'GC_RTC_ICE';
  roomId: string;
  fromAddress: string;
  toAddress: string;
  candidate: unknown;
  connId: string;
  hopsRemaining?: number;
}

export interface GcRtcReconnectEnvelope {
  type: 'GC_RTC_RECONNECT';
  roomId: string;
  fromAddress: string;
  toAddress: string;
  connId: string;
  hopsRemaining?: number;
}

export type GcEnvelope =
  | GcJoinEnvelope | GcLeaveEnvelope | GcTopologyEnvelope | GcClusterHeartbeatEnvelope
  | GcAudioEnvelope | GcKeyEnvelope | GcKeyRotateEnvelope | GcKeyRequestEnvelope
  | GcRtcOfferEnvelope | GcRtcAnswerEnvelope | GcRtcIceEnvelope
  | GcRtcReconnectEnvelope;

// ── Room state ────────────────────────────────────────────────────────────────

interface RoomParticipant {
  publicKey: string;
  joinedAt: number;
}

interface GroupRoom {
  roomId: string;
  chatId: string;
  participants: Map<string, RoomParticipant>;
  topologyEpoch: number;
  topologySignature?: string;
  joinTimestamp?: number;
  /** Main-owned media session id; immutable until room is empty. */
  callSessionId: string;
  /** Bumped only on explicit session-break IPC. */
  mediaSessionGeneration: number;
}

// ── Signature helpers ─────────────────────────────────────────────────────────

function buildTopologySignature(env: Pick<
  GcTopologyEnvelope,
  'topologyEpoch' | 'rootForwarder' | 'standbyForwarder' | 'clusters'
>): string {
  return JSON.stringify({
    topologyEpoch: env.topologyEpoch,
    rootForwarder: env.rootForwarder,
    standbyForwarder: env.standbyForwarder,
    clusters: env.clusters.map((c) => ({
      members: c.members,
      forwarder: c.forwarder,
      standby: c.standby,
      standby2: c.standby2 ?? '',
    })),
  });
}

function sha256Hex(input: string): string {
  return nodeCrypto.createHash('sha256').update(input).digest('hex');
}

function canonicalizeStringMap(map: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(map).sort()) {
    sorted[key] = map[key]!;
  }
  return JSON.stringify(sorted);
}

function buildGcKeyDigest(toAddress: string, encryptedKey: string): string {
  return sha256Hex(JSON.stringify({ encryptedKey, toAddress }));
}

function buildGcKeyRotateDigest(encryptedKeys: Record<string, string>): string {
  return sha256Hex(canonicalizeStringMap(encryptedKeys));
}

function buildGcKeySignedFields(env: GcKeyEnvelope): Record<string, unknown> | null {
  if (env.keyMessageVersion !== GC_KEY_MESSAGE_VERSION) return null;
  if (
    !isNonEmptyString(env.callSessionId) ||
    typeof env.mediaSessionGeneration !== 'number' ||
    !Number.isFinite(env.mediaSessionGeneration) ||
    !isNonEmptyString(env.keyCommitment) ||
    !isNonEmptyString(env.encryptedKeyDigest)
  ) {
    return null;
  }
  return {
    type: env.type,
    roomId: env.roomId,
    toAddress: env.toAddress,
    fromAddress: env.fromAddress,
    fromPublicKey: env.fromPublicKey,
    timestamp: env.timestamp,
    keyMessageVersion: env.keyMessageVersion,
    callSessionId: env.callSessionId,
    mediaSessionGeneration: env.mediaSessionGeneration,
    keyCommitment: env.keyCommitment,
    encryptedKeyDigest: env.encryptedKeyDigest,
  };
}

function buildGcKeyRotateSignedFields(
  env: GcKeyRotateEnvelope
): Record<string, unknown> | null {
  if (env.keyMessageVersion !== GC_KEY_MESSAGE_VERSION) return null;
  if (
    !isNonEmptyString(env.callSessionId) ||
    typeof env.mediaSessionGeneration !== 'number' ||
    !Number.isFinite(env.mediaSessionGeneration) ||
    !isNonEmptyString(env.keyCommitment) ||
    !isNonEmptyString(env.encryptedKeysDigest)
  ) {
    return null;
  }
  return {
    type: env.type,
    roomId: env.roomId,
    fromAddress: env.fromAddress,
    fromPublicKey: env.fromPublicKey,
    timestamp: env.timestamp,
    keyMessageVersion: env.keyMessageVersion,
    callSessionId: env.callSessionId,
    mediaSessionGeneration: env.mediaSessionGeneration,
    keyCommitment: env.keyCommitment,
    encryptedKeysDigest: env.encryptedKeysDigest,
  };
}

function buildGcKeyRequestSignedFields(env: GcKeyRequestEnvelope): Record<string, unknown> {
  return {
    type: env.type,
    roomId: env.roomId,
    toAddress: env.toAddress,
    fromAddress: env.fromAddress,
    fromPublicKey: env.fromPublicKey,
    callSessionId: env.callSessionId,
    mediaSessionGeneration: env.mediaSessionGeneration,
    keyMessageVersion: env.keyMessageVersion,
    timestamp: env.timestamp,
  };
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Shape-only checks for disinterested relay (no Ed25519). */
function isCheapRelayJoinShape(env: GcJoinEnvelope): boolean {
  return (
    isNonEmptyString(env.roomId) &&
    isNonEmptyString(env.chatId) &&
    isNonEmptyString(env.fromAddress) &&
    isNonEmptyString(env.fromPublicKey) &&
    typeof env.signature === 'string' &&
    typeof env.timestamp === 'number' &&
    Number.isFinite(env.timestamp)
  );
}

function isCheapRelayLeaveShape(env: GcLeaveEnvelope): boolean {
  return (
    isNonEmptyString(env.roomId) &&
    isNonEmptyString(env.fromAddress) &&
    isNonEmptyString(env.fromPublicKey) &&
    typeof env.signature === 'string' &&
    typeof env.timestamp === 'number' &&
    Number.isFinite(env.timestamp)
  );
}

function isCheapRelayTopologyShape(env: GcTopologyEnvelope): boolean {
  return (
    isNonEmptyString(env.roomId) &&
    isNonEmptyString(env.fromAddress) &&
    isNonEmptyString(env.fromPublicKey) &&
    typeof env.signature === 'string' &&
    typeof env.timestamp === 'number' &&
    Number.isFinite(env.timestamp) &&
    typeof env.topologyEpoch === 'number' &&
    Number.isFinite(env.topologyEpoch) &&
    typeof env.rootForwarder === 'string' &&
    typeof env.standbyForwarder === 'string' &&
    typeof env.lastSeen === 'number' &&
    Number.isFinite(env.lastSeen) &&
    Array.isArray(env.clusters)
  );
}

function isCheapRelayClusterHeartbeatShape(env: GcClusterHeartbeatEnvelope): boolean {
  return (
    isNonEmptyString(env.roomId) &&
    isNonEmptyString(env.fromAddress) &&
    isNonEmptyString(env.fromPublicKey) &&
    isNonEmptyString(env.clusterForwarder) &&
    typeof env.signature === 'string' &&
    typeof env.timestamp === 'number' &&
    Number.isFinite(env.timestamp) &&
    typeof env.topologyEpoch === 'number' &&
    Number.isFinite(env.topologyEpoch) &&
    typeof env.clusterIndex === 'number' &&
    Number.isFinite(env.clusterIndex) &&
    typeof env.seq === 'number' &&
    Number.isFinite(env.seq)
  );
}

function buildGcClusterHeartbeatSignedFields(
  env: GcClusterHeartbeatEnvelope
): Record<string, unknown> {
  return {
    type: env.type,
    roomId: env.roomId,
    topologyEpoch: env.topologyEpoch,
    clusterForwarder: env.clusterForwarder,
    clusterIndex: env.clusterIndex,
    seq: env.seq,
    fromAddress: env.fromAddress,
    fromPublicKey: env.fromPublicKey,
    timestamp: env.timestamp,
  };
}

/** Jobs waiting on off-thread Ed25519 verification */
type GcVerifyPending =
  | { kind: 'join'; env: GcJoinEnvelope; fromNodeId?: string }
  | { kind: 'leave'; env: GcLeaveEnvelope }
  | { kind: 'topology'; env: GcTopologyEnvelope }
  | { kind: 'cluster_heartbeat'; env: GcClusterHeartbeatEnvelope }
  | { kind: 'key'; env: GcKeyEnvelope }
  | { kind: 'key_rotate'; env: GcKeyRotateEnvelope }
  | { kind: 'key_request'; env: GcKeyRequestEnvelope };

const GC_VERIFY_WORKER_COUNT = 6;
const GC_MAX_PENDING_VERIFY = 4096;
/** Same signed GC_* envelope may arrive on many P2P outer ids; skip re-verify after first success. */
const GC_VERIFIED_SIGNATURE_CACHE_MAX = 4096;
/** Rate-limit stale topology logs (hot path under mesh relay). */
const GC_STALE_TOPOLOGY_LOG_MIN_MS = 5_000;

// ── GroupCallManager ──────────────────────────────────────────────────────────

let _instance: GroupCallManager | null = null;

export function startGroupCallManager(
  p2p: P2PNetwork,
  presence: PresenceManager
): GroupCallManager {
  if (_instance) _instance.stop();
  _instance = new GroupCallManager(p2p, presence);
  _instance.start();
  return _instance;
}

export function stopGroupCallManager(): void {
  if (_instance) { _instance.stop(); _instance = null; }
}

export function getGroupCallManager(): GroupCallManager | null {
  return _instance;
}

export class GroupCallManager extends EventEmitter {
  private p2p: P2PNetwork;
  private presence: PresenceManager;
  private localAddresses = new Set<string>();
  private rooms = new Map<string, GroupRoom>();

  /** Track recent processed message IDs to prevent replay */
  private seenMsgIds = new Set<string>();
  private seenMsgIdTimer: ReturnType<typeof setInterval> | null = null;

  /** Cache address → nodeId learned from GC_JOIN, used as fallback in sendAudio */
  private participantNodeIds = new Map<string, string>();

  private presenceExpiredHandler: (address: string) => void;
  private onP2PMessage!: (payload: { id: string; from: string; data: unknown }) => void;
  private onBinaryGcAudio!: (payload: {
    fromNodeId: string;
    via: string;
    roomId: string;
    toAddress: string;
    ciphertext: Buffer;
    gcHopsRemaining: number;
    p2pHops: number;
  }) => void;
  private onPresenceUpdated: (({ address, online }: { address: string; online: boolean }) => void) | null = null;
  private presenceEvictionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private static readonly PRESENCE_EVICTION_GRACE_MS = 12_000;

  private verifyPool = new VerifyWorkerPool(
    'gcall',
    GC_VERIFY_WORKER_COUNT,
    GC_MAX_PENDING_VERIFY
  );

  /** Verified Ed25519 signatures for signed GC_* envelopes (LRU by insertion order). */
  private verifiedGcSignatures = new Map<string, true>();
  /** In-flight verify promises keyed by type+signature — coalesce duplicate envelopes before cache is warm. */
  private inFlightGcVerify = new Map<string, Promise<void>>();
  private lastStaleTopologyLogAt = 0;

  /** Per-room mesh audio relay budget (outbound + forwarded GC_AUDIO). */
  private relayByteBudgetByRoom = new Map<
    string,
    { tokens: number; lastMs: number }
  >();

  constructor(p2p: P2PNetwork, presence: PresenceManager) {
    super();
    this.p2p = p2p;
    this.presence = presence;

    this.onP2PMessage = ({ id, from, data }: { id: string; from: string; data: unknown }) => {
      if (!data || typeof data !== 'object') return;
      const msg = data as Record<string, unknown>;
      if (!GC_MESSAGE_TYPES.has(msg.type as string)) return;
      if (id && this.seenMsgIds.has(id)) return;
      if (id) this.seenMsgIds.add(id);
      try {
        this.handleIncoming(msg as unknown as GcEnvelope, from);
      } catch (err) {
        loggerError('[GCall] Error handling message:', err);
      }
    };

    this.onBinaryGcAudio = (payload) => {
      try {
        this.handleBinaryGcAudioWire(payload);
      } catch (err) {
        loggerError('[GCall] Error handling binary GC_AUDIO:', err);
      }
    };

    this.presenceExpiredHandler = (address: string) => {
      // Don't start a duplicate grace timer for the same address
      if (this.presenceEvictionTimers.has(address)) return;

      // Only act if this address is actually in an active room
      let inCall = false;
      for (const [, room] of this.rooms) {
        if (room.participants.has(address)) { inCall = true; break; }
      }
      if (!inCall) return;

      loggerLog(`[GCall] Presence offline for ${address} — starting ${GroupCallManager.PRESENCE_EVICTION_GRACE_MS}ms grace timer`);
      const timer = setTimeout(() => {
        this.presenceEvictionTimers.delete(address);
        // If the peer came back online during the grace window, skip eviction
        if (this.presence.isAddressOnline(address)) {
          loggerLog(`[GCall] ${address} recovered — skipping eviction`);
          return;
        }
        for (const [roomId, room] of this.rooms) {
          if (room.participants.has(address)) {
            loggerLog(`[GCall] Grace period expired for ${address} — evicting from ${roomId}`);
            this.handleLeave(roomId, address, true);
          }
        }
      }, GroupCallManager.PRESENCE_EVICTION_GRACE_MS);
      this.presenceEvictionTimers.set(address, timer);
    };

  }

  private logVerifyFailure(job: GcVerifyPending): void {
    if (job.kind === 'join') {
      loggerLog(`[GCall] Dropped GC_JOIN: invalid signature from ${job.env.fromAddress}`);
    } else if (job.kind === 'leave') {
      loggerLog(`[GCall] Dropped GC_LEAVE: invalid signature from ${job.env.fromAddress}`);
    } else if (job.kind === 'topology') {
      loggerLog(`[GCall] Dropped GC_TOPOLOGY: invalid signature from ${job.env.fromAddress}`);
    } else if (job.kind === 'cluster_heartbeat') {
      loggerLog(`[GCall] Dropped GC_CLUSTER_HEARTBEAT: invalid signature from ${job.env.fromAddress}`);
    } else if (job.kind === 'key') {
      loggerLog(`[GCall] Dropped GC_KEY: invalid signature from ${job.env.fromAddress}`);
    } else if (job.kind === 'key_rotate') {
      loggerLog(`[GCall] Dropped GC_KEY_ROTATE: invalid signature from ${job.env.fromAddress}`);
    } else {
      loggerLog(`[GCall] Dropped GC_KEY_REQUEST: invalid signature from ${job.env.fromAddress}`);
    }
  }

  private gcSignatureCacheKey(type: string, signature: string): string {
    return `${type}:${signature}`;
  }

  /** Remember after a successful verify; LRU-evict when over cap. */
  private rememberVerifiedGcSignature(type: string, signature: string): void {
    const key = this.gcSignatureCacheKey(type, signature);
    if (this.verifiedGcSignatures.has(key)) {
      this.verifiedGcSignatures.delete(key);
    }
    while (this.verifiedGcSignatures.size >= GC_VERIFIED_SIGNATURE_CACHE_MAX) {
      const first = this.verifiedGcSignatures.keys().next().value as string | undefined;
      if (first === undefined) break;
      this.verifiedGcSignatures.delete(first);
    }
    this.verifiedGcSignatures.set(key, true);
  }

  private enqueueVerify(
    fields: Record<string, unknown>,
    signature: string,
    fromPublicKey: string,
    fromAddress: string,
    job: GcVerifyPending
  ): void {
    const env = job.env;
    const cacheKey = this.gcSignatureCacheKey(env.type, env.signature);
    if (this.verifiedGcSignatures.has(cacheKey)) {
      return;
    }
    if (this.inFlightGcVerify.has(cacheKey)) {
      return;
    }

    const payload = {
      kind: 'gc' as const,
      fields,
      signature,
      fromPublicKey,
      fromAddress,
    };
    const p = this.verifyPool
      .verify(payload)
      .then((ok) => {
        if (!ok) {
          this.logVerifyFailure(job);
          return;
        }
        this.rememberVerifiedGcSignature(env.type, env.signature);
        try {
          this.applyVerifiedJobSync(job);
        } catch (err) {
          loggerError('[GCall] Error applying verified message:', err);
        }
      })
      .finally(() => {
        this.inFlightGcVerify.delete(cacheKey);
      });
    this.inFlightGcVerify.set(cacheKey, p);
  }

  private applyVerifiedJobSync(job: GcVerifyPending): void {
    switch (job.kind) {
      case 'join':
        this.applyVerifiedJoin(job.env, job.fromNodeId);
        break;
      case 'leave':
        this.applyVerifiedLeave(job.env);
        break;
      case 'topology':
        this.applyVerifiedTopology(job.env);
        break;
      case 'cluster_heartbeat':
        this.applyVerifiedClusterHeartbeat(job.env);
        break;
      case 'key':
        this.applyVerifiedKey(job.env);
        break;
      case 'key_rotate':
        this.applyVerifiedKeyRotate(job.env);
        break;
      case 'key_request':
        this.applyVerifiedKeyRequest(job.env);
        break;
    }
  }

  start(): void {
    // Register P2P listener before verify workers so a worker spawn failure
    // never leaves the manager deaf to GC_* traffic.
    this.onP2PMessage = this.onP2PMessage.bind(this);
    this.p2p.on('message', this.onP2PMessage);
    this.p2p.on('binary-gc-audio', this.onBinaryGcAudio);

    this.verifyPool.start();

    // Hook into presence-updated to detect abrupt disconnects (with grace period)
    // Store reference so stop() can properly remove it.
    this.onPresenceUpdated = ({ address, online }: { address: string; online: boolean }) => {
      if (!online) {
        this.presenceExpiredHandler(address);
      } else {
        // Peer came back online — cancel any pending eviction timer
        const timer = this.presenceEvictionTimers.get(address);
        if (timer !== undefined) {
          loggerLog(`[GCall] ${address} back online — cancelling eviction timer`);
          clearTimeout(timer);
          this.presenceEvictionTimers.delete(address);
        }
      }
    };
    this.presence.on('presence-updated', this.onPresenceUpdated);

    // Periodic cleanup of seen message IDs (every 2 minutes)
    this.seenMsgIdTimer = setInterval(() => {
      if (this.seenMsgIds.size > 10_000) this.seenMsgIds.clear();
    }, 120_000);
    this.seenMsgIdTimer.unref?.();

    loggerLog('[GCall] GroupCallManager started.');
  }

  stop(): void {
    this.verifyPool.stop();

    if (this.onP2PMessage) this.p2p.off('message', this.onP2PMessage);
    if (this.onBinaryGcAudio) this.p2p.off('binary-gc-audio', this.onBinaryGcAudio);
    if (this.onPresenceUpdated) this.presence.off('presence-updated', this.onPresenceUpdated);
    for (const timer of this.presenceEvictionTimers.values()) clearTimeout(timer);
    this.presenceEvictionTimers.clear();
    if (this.seenMsgIdTimer) { clearInterval(this.seenMsgIdTimer); this.seenMsgIdTimer = null; }
    this.participantNodeIds.clear();
    this.rooms.clear();
    this.verifiedGcSignatures.clear();
    this.inFlightGcVerify.clear();
    this.lastStaleTopologyLogAt = 0;
    loggerLog('[GCall] GroupCallManager stopped.');
  }

  setLocalAddresses(addresses: string[]): void {
    this.localAddresses = new Set(addresses);
    loggerLog(`[GCall] Local addresses set: ${[...addresses].join(', ')}`);
  }

  private hasLocalRoomInterest(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  /**
   * Forward JOIN/LEAVE/TOPOLOGY for rooms we are not in, without Ed25519 verify.
   * Matches interested-node behavior for expired GC_JOIN (no relay).
   */
  private relayDisinterestedSignedControl(
    env: GcJoinEnvelope | GcLeaveEnvelope | GcTopologyEnvelope | GcClusterHeartbeatEnvelope
  ): void {
    if ((env.hopsRemaining ?? 0) <= 0) return;
    this.p2p.send(null, {
      ...env,
      hopsRemaining: (env.hopsRemaining ?? 1) - 1,
    });
  }

  // ── Outbound ──────────────────────────────────────────────────────────────

  joinRoom(
    roomId: string,
    chatId: string,
    localAddress: string,
    signature: string,
    publicKey: string,
    timestamp: number,
    joinGeneration?: number
  ): { callSessionId: string; mediaSessionGeneration: number } {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = {
        roomId,
        chatId,
        participants: new Map(),
        topologyEpoch: 0,
        joinTimestamp: timestamp,
        callSessionId: nodeCrypto.randomUUID(),
        mediaSessionGeneration: 1,
      };
      this.rooms.set(roomId, room);
    }
    room.participants.set(localAddress, { publicKey, joinedAt: timestamp });

    const env: GcJoinEnvelope = {
      type: 'GC_JOIN',
      roomId,
      chatId,
      fromAddress: localAddress,
      fromPublicKey: publicKey,
      signature,
      timestamp,
      ...(joinGeneration !== undefined ? { joinGeneration } : {}),
      hopsRemaining: GC_MAX_HOPS,
    };
    this.p2p.send(null, env);
    loggerLog(`[GCall] Sent GC_JOIN for room ${roomId}`);
    return {
      callSessionId: room.callSessionId,
      mediaSessionGeneration: room.mediaSessionGeneration,
    };
  }

  leaveRoom(
    roomId: string,
    localAddress: string,
    signature: string,
    publicKey: string,
    timestamp: number
  ): void {
    if (signature) {
      const env: GcLeaveEnvelope = {
        type: 'GC_LEAVE',
        roomId,
        fromAddress: localAddress,
        fromPublicKey: publicKey,
        signature,
        timestamp,
        hopsRemaining: GC_MAX_HOPS,
      };
      this.p2p.send(null, env);
    } else {
      loggerWarn(
        `[GCall] Missing GC_LEAVE signature for ${localAddress} in ${roomId} — clearing local room only`
      );
      this.participantNodeIds.delete(localAddress);
    }
    this.rooms.delete(roomId);
    this.relayByteBudgetByRoom.delete(roomId);
    loggerLog(
      signature
        ? `[GCall] Sent GC_LEAVE for room ${roomId}`
        : `[GCall] Cleared local room state for ${roomId} without broadcasting GC_LEAVE`
    );
  }

  broadcastTopology(
    roomId: string,
    topology: Omit<GcTopologyEnvelope, 'type' | 'roomId' | 'hopsRemaining'>,
    signature: string,
    publicKey: string,
    timestamp: number
  ): void {
    const env: GcTopologyEnvelope = {
      type: 'GC_TOPOLOGY',
      roomId,
      ...topology,
      fromPublicKey: publicKey,
      signature,
      timestamp,
      hopsRemaining: GC_MAX_HOPS,
    };
    this.p2p.send(null, env);
    loggerLog(`[GCall] Sent GC_TOPOLOGY for room ${roomId} epoch ${topology.topologyEpoch}`);
  }

  sendClusterHeartbeat(
    roomId: string,
    payload: Omit<
      GcClusterHeartbeatEnvelope,
      'type' | 'roomId' | 'hopsRemaining' | 'signature'
    >,
    signature: string
  ): void {
    const env: GcClusterHeartbeatEnvelope = {
      type: 'GC_CLUSTER_HEARTBEAT',
      roomId,
      ...payload,
      signature,
      hopsRemaining: GC_MAX_HOPS,
    };
    this.p2p.send(null, env);
  }

  /**
   * Send local GC_AUDIO from IPC. Returns false if payload invalid or relay budget exhausted.
   */
  sendAudio(roomId: string, toAddress: string, data: Buffer): boolean {
    if (!isValidGcAudioBuffer(data)) {
      loggerWarn('[GCall] sendAudio dropped: invalid or oversize payload');
      return false;
    }
    const cost = data.length;
    if (!this.tryConsumeRelayBudget(roomId, cost)) {
      loggerWarn(`[GCall] sendAudio dropped: relay budget exhausted for room ${roomId}`);
      return false;
    }
    const nodeId =
      this.presence.getNodeIdForAddress(toAddress) ??
      this.participantNodeIds.get(toAddress) ??
      null;

    if (nodeId && this.p2p.canSendBinaryGcAudio(nodeId)) {
      try {
        const wire = encodeGcAudioBinaryFrame({
          p2pHops: 0,
          toNodeId: nodeId,
          fromNodeId: this.p2p.getNodeId(),
          roomId,
          toAddress,
          gcHopsRemaining: GC_AUDIO_MAX_HOPS,
          ciphertext: data,
        });
        if (this.p2p.writeGcAudioBinaryFrame(nodeId, wire)) {
          return true;
        }
      } catch (err) {
        if (err instanceof GcAudioBinaryEncodeError) {
          loggerWarn(`[GCall] sendAudio binary encode failed: ${err.message}`);
        } else {
          loggerError('[GCall] sendAudio binary path error:', err);
        }
      }
    }

    const env: GcAudioEnvelope = {
      type: 'GC_AUDIO',
      roomId,
      toAddress,
      data: data.toString('base64'),
      hopsRemaining: GC_AUDIO_MAX_HOPS,
    };
    if (nodeId) {
      this.p2p.send(nodeId, env);
    } else {
      this.p2p.send(null, env);
    }
    return true;
  }

  private tryConsumeRelayBudget(roomId: string, byteCost: number): boolean {
    if (byteCost <= 0) return true;
    const now = Date.now();
    let b = this.relayByteBudgetByRoom.get(roomId);
    if (!b) {
      b = { tokens: GC_AUDIO_RELAY_BUCKET_MAX, lastMs: now };
      this.relayByteBudgetByRoom.set(roomId, b);
    }
    const dt = now - b.lastMs;
    b.lastMs = now;
    b.tokens = Math.min(
      GC_AUDIO_RELAY_BUCKET_MAX,
      b.tokens + dt * GC_AUDIO_RELAY_REFILL_BYTES_PER_MS
    );
    if (b.tokens < byteCost) return false;
    b.tokens -= byteCost;
    return true;
  }

  sendKey(
    roomId: string,
    toAddress: string,
    encryptedKey: string,
    fromAddress: string,
    signature: string,
    publicKey: string,
    timestamp: number,
    meta: {
      keyMessageVersion: number;
      callSessionId: string;
      mediaSessionGeneration: number;
      keyCommitment: string;
      encryptedKeyDigest: string;
    }
  ): void {
    const env: GcKeyEnvelope = {
      type: 'GC_KEY',
      roomId,
      toAddress,
      fromAddress,
      fromPublicKey: publicKey,
      encryptedKey,
      signature,
      timestamp,
      hopsRemaining: GC_MAX_HOPS,
      ...meta,
    };
    const nodeId = this.presence.getNodeIdForAddress(toAddress);
    if (nodeId) {
      this.p2p.send(nodeId, env);
    } else {
      this.p2p.send(null, env);
    }
  }

  sendKeyRotate(
    roomId: string,
    encryptedKeys: Record<string, string>,
    fromAddress: string,
    signature: string,
    publicKey: string,
    timestamp: number,
    meta: {
      keyMessageVersion: number;
      callSessionId: string;
      mediaSessionGeneration: number;
      keyCommitment: string;
      encryptedKeysDigest: string;
    }
  ): void {
    const env: GcKeyRotateEnvelope = {
      type: 'GC_KEY_ROTATE',
      roomId,
      fromAddress,
      fromPublicKey: publicKey,
      encryptedKeys,
      signature,
      timestamp,
      hopsRemaining: GC_MAX_HOPS,
      ...meta,
    };
    this.p2p.send(null, env);
  }

  sendKeyRequest(
    roomId: string,
    toAddress: string,
    fromAddress: string,
    signature: string,
    publicKey: string,
    timestamp: number,
    callSessionId: string,
    mediaSessionGeneration: number
  ): void {
    const env: GcKeyRequestEnvelope = {
      type: 'GC_KEY_REQUEST',
      roomId,
      toAddress,
      fromAddress,
      fromPublicKey: publicKey,
      callSessionId,
      mediaSessionGeneration,
      keyMessageVersion: GC_KEY_MESSAGE_VERSION,
      signature,
      timestamp,
      hopsRemaining: GC_MAX_HOPS,
    };
    const nodeId = this.presence.getNodeIdForAddress(toAddress);
    if (nodeId) {
      this.p2p.send(nodeId, env);
    } else {
      this.p2p.send(null, env);
    }
  }

  sendRtcSignal(
    roomId: string,
    fromAddress: string,
    toAddress: string,
    type: 'offer' | 'answer' | 'ice' | 'reconnect',
    data: unknown,
    connId: string,
    signature?: string,
    publicKey?: string,
    timestamp?: number
  ): void {
    const nodeId = this.presence.getNodeIdForAddress(toAddress);
    const hops = GC_MAX_HOPS;

    if (type === 'offer') {
      const env: GcRtcOfferEnvelope = {
        type: 'GC_RTC_OFFER',
        roomId, fromAddress, toAddress, connId,
        sdp: data as string,
        fromPublicKey: publicKey ?? '',
        signature: signature ?? '',
        timestamp: timestamp ?? Date.now(),
        hopsRemaining: hops,
      };
      nodeId ? this.p2p.send(nodeId, env) : this.p2p.send(null, env);
    } else if (type === 'answer') {
      const env: GcRtcAnswerEnvelope = {
        type: 'GC_RTC_ANSWER',
        roomId, fromAddress, toAddress, connId,
        sdp: data as string,
        fromPublicKey: publicKey ?? '',
        signature: signature ?? '',
        timestamp: timestamp ?? Date.now(),
        hopsRemaining: hops,
      };
      nodeId ? this.p2p.send(nodeId, env) : this.p2p.send(null, env);
    } else if (type === 'reconnect') {
      const env: GcRtcReconnectEnvelope = {
        type: 'GC_RTC_RECONNECT',
        roomId,
        fromAddress,
        toAddress,
        connId,
        hopsRemaining: hops,
      };
      nodeId ? this.p2p.send(nodeId, env) : this.p2p.send(null, env);
    } else {
      const env: GcRtcIceEnvelope = {
        type: 'GC_RTC_ICE',
        roomId, fromAddress, toAddress, connId,
        candidate: data,
        hopsRemaining: hops,
      };
      nodeId ? this.p2p.send(nodeId, env) : this.p2p.send(null, env);
    }
  }

  // ── Inbound ───────────────────────────────────────────────────────────────

  handleIncoming(env: GcEnvelope, fromNodeId?: string): void {
    if (!GC_MESSAGE_TYPES.has(env.type)) return;

    switch (env.type) {
      case 'GC_JOIN':      return this.handleJoin(env, fromNodeId);
      case 'GC_LEAVE':     return this.handleLeaveEnvelope(env);
      case 'GC_TOPOLOGY':  return this.handleTopology(env);
      case 'GC_CLUSTER_HEARTBEAT': return this.handleClusterHeartbeat(env);
      case 'GC_AUDIO':     return this.handleAudio(env);
      case 'GC_KEY':       return this.handleKey(env);
      case 'GC_KEY_ROTATE': return this.handleKeyRotate(env);
      case 'GC_KEY_REQUEST': return this.handleKeyRequest(env);
      case 'GC_RTC_OFFER': return this.handleRtcOffer(env);
      case 'GC_RTC_ANSWER': return this.handleRtcAnswer(env);
      case 'GC_RTC_ICE':   return this.handleRtcIce(env);
      case 'GC_RTC_RECONNECT': return this.handleRtcReconnect(env);
    }
  }

  private handleJoin(env: GcJoinEnvelope, fromNodeId?: string): void {
    if (!this.hasLocalRoomInterest(env.roomId)) {
      if (
        isCheapRelayJoinShape(env) &&
        Date.now() - env.timestamp <= GC_JOIN_TTL_MS
      ) {
        this.relayDisinterestedSignedControl(env);
      }
      return;
    }

    const now = Date.now();
    if (now - env.timestamp > GC_JOIN_TTL_MS) {
      loggerLog(`[GCall] Dropped GC_JOIN: expired from ${env.fromAddress} (pre-verify)`);
      return;
    }

    this.enqueueVerify(
      {
        type: env.type,
        roomId: env.roomId,
        chatId: env.chatId,
        fromAddress: env.fromAddress,
        fromPublicKey: env.fromPublicKey,
        timestamp: env.timestamp,
        ...(typeof env.joinGeneration === 'number' && Number.isFinite(env.joinGeneration)
          ? { joinGeneration: env.joinGeneration }
          : {}),
      },
      env.signature,
      env.fromPublicKey,
      env.fromAddress,
      { kind: 'join', env, fromNodeId }
    );
  }

  private applyVerifiedJoin(env: GcJoinEnvelope, fromNodeId?: string): void {
    const now = Date.now();
    if (now - env.timestamp > GC_JOIN_TTL_MS) {
      loggerLog(`[GCall] Dropped GC_JOIN: expired from ${env.fromAddress}`);
      return;
    }

    // Cache the address → nodeId mapping for targeted audio delivery.
    if (fromNodeId) {
      this.participantNodeIds.set(env.fromAddress, fromNodeId);
    }

    // Update room state if we are in this room
    for (const [roomId, room] of this.rooms) {
      if (roomId === env.roomId) {
        if (!room.participants.has(env.fromAddress)) {
          room.participants.set(env.fromAddress, {
            publicKey: env.fromPublicKey,
            joinedAt: env.timestamp,
          });
        }
        break;
      }
    }

    // Only notify the renderer when the local client is actively in this room.
    if (this.hasLocalRoomInterest(env.roomId)) {
      this.emit('gcall:participant-joined', {
        roomId: env.roomId,
        chatId: env.chatId,
        address: env.fromAddress,
        publicKey: env.fromPublicKey,
        timestamp: env.timestamp,
        ...(typeof env.joinGeneration === 'number' && Number.isFinite(env.joinGeneration)
          ? { joinGeneration: env.joinGeneration }
          : {}),
      });
    }

    // Relay
    if ((env.hopsRemaining ?? 0) > 0) {
      this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
    }
  }

  private handleLeaveEnvelope(env: GcLeaveEnvelope): void {
    if (!this.hasLocalRoomInterest(env.roomId)) {
      if (isCheapRelayLeaveShape(env)) {
        this.relayDisinterestedSignedControl(env);
      }
      return;
    }

    this.enqueueVerify(
      {
        type: env.type,
        roomId: env.roomId,
        fromAddress: env.fromAddress,
        fromPublicKey: env.fromPublicKey,
        timestamp: env.timestamp,
      },
      env.signature,
      env.fromPublicKey,
      env.fromAddress,
      { kind: 'leave', env }
    );
  }

  private applyVerifiedLeave(env: GcLeaveEnvelope): void {
    this.handleLeave(env.roomId, env.fromAddress, false);

    if ((env.hopsRemaining ?? 0) > 0) {
      this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
    }
  }

  private handleLeave(roomId: string, address: string, isAbrupt: boolean): void {
    const room = this.rooms.get(roomId);
    const hadLocalInterest = Boolean(room);
    if (room) {
      room.participants.delete(address);
      if (room.participants.size === 0) {
        this.rooms.delete(roomId);
        this.relayByteBudgetByRoom.delete(roomId);
      }
    }
    this.participantNodeIds.delete(address);
    if (hadLocalInterest) {
      this.emit('gcall:participant-left', { roomId, address, isAbrupt });
    }
  }

  private handleTopology(env: GcTopologyEnvelope): void {
    if (!this.hasLocalRoomInterest(env.roomId)) {
      if (isCheapRelayTopologyShape(env)) {
        this.relayDisinterestedSignedControl(env);
      }
      return;
    }

    this.enqueueVerify(
      {
        type: env.type,
        roomId: env.roomId,
        topologyEpoch: env.topologyEpoch,
        rootForwarder: env.rootForwarder,
        standbyForwarder: env.standbyForwarder,
        fromAddress: env.fromAddress,
        fromPublicKey: env.fromPublicKey,
        timestamp: env.timestamp,
      },
      env.signature,
      env.fromPublicKey,
      env.fromAddress,
      { kind: 'topology', env }
    );
  }

  private applyVerifiedTopology(env: GcTopologyEnvelope): void {
    // Update local epoch tracking
    const room = this.rooms.get(env.roomId);
    const topologySignature = buildTopologySignature(env);
    let emitFullTopology = true;
    if (room) {
      if (env.topologyEpoch < room.topologyEpoch) {
        const now = Date.now();
        if (now - this.lastStaleTopologyLogAt >= GC_STALE_TOPOLOGY_LOG_MIN_MS) {
          this.lastStaleTopologyLogAt = now;
          loggerLog(`[GCall] Dropped stale GC_TOPOLOGY epoch ${env.topologyEpoch} < ${room.topologyEpoch}`);
        }
        if ((env.hopsRemaining ?? 0) > 0) {
          this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
        }
        return;
      }
      emitFullTopology =
        env.topologyEpoch !== room.topologyEpoch ||
        topologySignature !== room.topologySignature;
      room.topologyEpoch = env.topologyEpoch;
      room.topologySignature = topologySignature;
    }

    if (room && emitFullTopology) {
      this.emit('gcall:topology', {
        roomId: env.roomId,
        topologyEpoch: env.topologyEpoch,
        rootForwarder: env.rootForwarder,
        standbyForwarder: env.standbyForwarder,
        clusters: env.clusters,
        lastSeen: env.lastSeen,
      });
    } else if (room) {
      this.emit('gcall:heartbeat', {
        roomId: env.roomId,
        lastSeen: env.lastSeen,
        rootForwarder: env.rootForwarder,
      });
    }

    if ((env.hopsRemaining ?? 0) > 0) {
      this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
    }
  }

  private handleClusterHeartbeat(env: GcClusterHeartbeatEnvelope): void {
    if (!this.hasLocalRoomInterest(env.roomId)) {
      if (isCheapRelayClusterHeartbeatShape(env)) {
        this.relayDisinterestedSignedControl(env);
      }
      return;
    }

    this.enqueueVerify(
      buildGcClusterHeartbeatSignedFields(env),
      env.signature,
      env.fromPublicKey,
      env.fromAddress,
      { kind: 'cluster_heartbeat', env }
    );
  }

  private applyVerifiedClusterHeartbeat(env: GcClusterHeartbeatEnvelope): void {
    if (env.clusterForwarder !== env.fromAddress) return;

    const room = this.rooms.get(env.roomId);
    if (room) {
      if (env.topologyEpoch < room.topologyEpoch) {
        if ((env.hopsRemaining ?? 0) > 0) {
          this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
        }
        return;
      }
      if (env.topologyEpoch !== room.topologyEpoch) {
        if ((env.hopsRemaining ?? 0) > 0) {
          this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
        }
        return;
      }
    }

    if (this.hasLocalRoomInterest(env.roomId)) {
      this.emit('gcall:cluster-heartbeat', {
        roomId: env.roomId,
        clusterForwarder: env.clusterForwarder,
        topologyEpoch: env.topologyEpoch,
        clusterIndex: env.clusterIndex,
        seq: env.seq,
        timestamp: env.timestamp,
      });
    }

    if ((env.hopsRemaining ?? 0) > 0) {
      this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
    }
  }

  private handleAudio(env: GcAudioEnvelope): void {
    if (!isValidGcAudioBase64(env.data)) {
      loggerWarn('[GCall] GC_AUDIO dropped: invalid or oversize payload');
      return;
    }
    const cost = gcAudioPayloadApproxBytes(env.data);
    if (!this.tryConsumeRelayBudget(env.roomId, cost)) {
      return;
    }
    let raw: Buffer;
    try {
      raw = Buffer.from(env.data, 'base64');
    } catch {
      return;
    }
    if (raw.length > GC_AUDIO_MAX_BINARY_WIRE_BYTES) {
      return;
    }
    this.deliverOrRelayGcAudio(
      env.roomId,
      env.toAddress,
      raw,
      env.hopsRemaining ?? 1
    );
  }

  private handleBinaryGcAudioWire(payload: {
    roomId: string;
    toAddress: string;
    ciphertext: Buffer;
    gcHopsRemaining: number;
  }): void {
    const { roomId, toAddress, ciphertext } = payload;
    if (ciphertext.length > GC_AUDIO_MAX_BINARY_WIRE_BYTES) {
      return;
    }
    const cost = ciphertext.length;
    if (!this.tryConsumeRelayBudget(roomId, cost)) {
      return;
    }
    this.deliverOrRelayGcAudio(
      roomId,
      toAddress,
      ciphertext,
      payload.gcHopsRemaining ?? 1
    );
  }

  /** After relay budget charged; relay uses JSON + base64. */
  private deliverOrRelayGcAudio(
    roomId: string,
    toAddress: string,
    raw: Buffer,
    hopsRemaining: number
  ): void {
    if (!this.localAddresses.has(toAddress)) {
      if ((hopsRemaining ?? 0) > 0) {
        const nodeId = this.presence.getNodeIdForAddress(toAddress);
        if (nodeId) {
          const env: GcAudioEnvelope = {
            type: 'GC_AUDIO',
            roomId,
            toAddress,
            data: raw.toString('base64'),
            hopsRemaining: (hopsRemaining ?? 1) - 1,
          };
          this.p2p.send(nodeId, env);
        }
      }
      return;
    }
    this.emit('gcall:audio', { roomId, data: raw });
  }

  private handleKey(env: GcKeyEnvelope): void {
    if (!this.localAddresses.has(env.toAddress)) {
      if ((env.hopsRemaining ?? 0) > 0) {
        const nodeId = this.presence.getNodeIdForAddress(env.toAddress);
        if (nodeId) {
          this.p2p.send(nodeId, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
        } else {
          this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
        }
      }
      return;
    }
    if (env.keyMessageVersion !== GC_KEY_MESSAGE_VERSION) {
      loggerLog(`[GCall] Dropped GC_KEY: unsupported version ${env.keyMessageVersion}`);
      return;
    }
    if (env.encryptedKeyDigest !== buildGcKeyDigest(env.toAddress, env.encryptedKey)) {
      loggerLog(`[GCall] Dropped GC_KEY: payload digest mismatch from ${env.fromAddress}`);
      return;
    }
    const room = this.rooms.get(env.roomId);
    if (!room) {
      loggerLog(`[GCall] Dropped GC_KEY: unknown room ${env.roomId}`);
      return;
    }
    // Each Electron process allocates its own callSessionId UUID on first joinRoom.
    // The root's UUID is the authoritative session identity; non-root peers adopt it
    // from the first verified key message rather than from their own local UUID.
    if (env.mediaSessionGeneration !== room.mediaSessionGeneration) {
      if (env.mediaSessionGeneration > room.mediaSessionGeneration) {
        // Root has advanced the generation (session-break). Adopt the new session.
        room.callSessionId = env.callSessionId;
        room.mediaSessionGeneration = env.mediaSessionGeneration;
        loggerLog(`[GCall] GC_KEY: adopted session gen ${env.mediaSessionGeneration} from ${env.fromAddress}`);
      } else {
        loggerLog(`[GCall] Dropped GC_KEY: stale session generation from ${env.fromAddress}`);
        return;
      }
    } else if (env.callSessionId !== room.callSessionId) {
      // Same generation, different callSessionId — root's UUID wins; adopt it.
      room.callSessionId = env.callSessionId;
    }
    const fields = buildGcKeySignedFields(env);
    if (!fields) return;
    this.enqueueVerify(
      fields,
      env.signature,
      env.fromPublicKey,
      env.fromAddress,
      { kind: 'key', env }
    );
  }

  private handleKeyRotate(env: GcKeyRotateEnvelope): void {
    let hasLocalRecipient = false;
    for (const localAddr of this.localAddresses) {
      if (env.encryptedKeys[localAddr]) {
        hasLocalRecipient = true;
        break;
      }
    }
    if (!hasLocalRecipient) {
      if ((env.hopsRemaining ?? 0) > 0) {
        this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
      }
      return;
    }
    if (env.keyMessageVersion !== GC_KEY_MESSAGE_VERSION) {
      loggerLog(`[GCall] Dropped GC_KEY_ROTATE: unsupported version ${env.keyMessageVersion}`);
      return;
    }
    if (env.encryptedKeysDigest !== buildGcKeyRotateDigest(env.encryptedKeys)) {
      loggerLog(`[GCall] Dropped GC_KEY_ROTATE: payload digest mismatch from ${env.fromAddress}`);
      return;
    }
    const room = this.rooms.get(env.roomId);
    if (!room) {
      loggerLog(`[GCall] Dropped GC_KEY_ROTATE: unknown room ${env.roomId}`);
      return;
    }
    // Same cross-process session adoption as handleKey: root's callSessionId wins.
    if (env.mediaSessionGeneration !== room.mediaSessionGeneration) {
      if (env.mediaSessionGeneration > room.mediaSessionGeneration) {
        room.callSessionId = env.callSessionId;
        room.mediaSessionGeneration = env.mediaSessionGeneration;
        loggerLog(`[GCall] GC_KEY_ROTATE: adopted session gen ${env.mediaSessionGeneration} from ${env.fromAddress}`);
      } else {
        loggerLog(`[GCall] Dropped GC_KEY_ROTATE: stale session generation from ${env.fromAddress}`);
        return;
      }
    } else if (env.callSessionId !== room.callSessionId) {
      room.callSessionId = env.callSessionId;
    }
    const fields = buildGcKeyRotateSignedFields(env);
    if (!fields) return;
    this.enqueueVerify(
      fields,
      env.signature,
      env.fromPublicKey,
      env.fromAddress,
      { kind: 'key_rotate', env }
    );
  }

  private handleKeyRequest(env: GcKeyRequestEnvelope): void {
    if (!this.localAddresses.has(env.toAddress)) {
      if ((env.hopsRemaining ?? 0) > 0) {
        const nodeId = this.presence.getNodeIdForAddress(env.toAddress);
        if (nodeId) {
          this.p2p.send(nodeId, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
        } else {
          this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
        }
      }
      return;
    }
    if (env.keyMessageVersion !== GC_KEY_MESSAGE_VERSION) {
      loggerLog(`[GCall] Dropped GC_KEY_REQUEST: unsupported version ${env.keyMessageVersion}`);
      return;
    }
    const room = this.rooms.get(env.roomId);
    if (!room) return;
    // Key requesters haven't adopted the root's callSessionId yet — that's exactly
    // why they are requesting the key. Only reject requests from a genuinely stale
    // generation (indicates a leftover request from before a session-break).
    if (env.mediaSessionGeneration < room.mediaSessionGeneration) {
      loggerLog(`[GCall] Dropped GC_KEY_REQUEST: stale session generation`);
      return;
    }
    this.enqueueVerify(
      buildGcKeyRequestSignedFields(env),
      env.signature,
      env.fromPublicKey,
      env.fromAddress,
      { kind: 'key_request', env }
    );
  }

  /**
   * Last-resort session break: bump media session generation for all local subscribers.
   */
  requestSessionBreak(roomId: string): { ok: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room || room.participants.size === 0) {
      return { ok: false, error: 'no-room' };
    }
    let localInRoom = false;
    for (const addr of this.localAddresses) {
      if (room.participants.has(addr)) {
        localInRoom = true;
        break;
      }
    }
    if (!localInRoom) {
      return { ok: false, error: 'not-in-room' };
    }
    room.mediaSessionGeneration = (room.mediaSessionGeneration + 1) >>> 0;
    if (room.mediaSessionGeneration === 0) {
      room.mediaSessionGeneration = 1;
    }
    this.emit('gcall:session-updated', {
      roomId,
      callSessionId: room.callSessionId,
      mediaSessionGeneration: room.mediaSessionGeneration,
    });
    return { ok: true };
  }

  private applyVerifiedKey(env: GcKeyEnvelope): void {
    this.emit('gcall:key', {
      roomId: env.roomId,
      fromAddress: env.fromAddress,
      fromPublicKey: env.fromPublicKey,
      encryptedKey: env.encryptedKey,
      timestamp: env.timestamp,
      keyMessageVersion: env.keyMessageVersion,
      callSessionId: env.callSessionId,
      mediaSessionGeneration: env.mediaSessionGeneration,
      keyCommitment: env.keyCommitment,
      verified: true,
    });
  }

  private applyVerifiedKeyRotate(env: GcKeyRotateEnvelope): void {
    for (const localAddr of this.localAddresses) {
      const encryptedKey = env.encryptedKeys[localAddr];
      if (!encryptedKey) continue;
      this.emit('gcall:key', {
        roomId: env.roomId,
        fromAddress: env.fromAddress,
        fromPublicKey: env.fromPublicKey,
        encryptedKey,
        timestamp: env.timestamp,
        keyMessageVersion: env.keyMessageVersion,
        callSessionId: env.callSessionId,
        mediaSessionGeneration: env.mediaSessionGeneration,
        keyCommitment: env.keyCommitment,
        verified: true,
      });
    }
    if ((env.hopsRemaining ?? 0) > 0) {
      this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
    }
  }

  private applyVerifiedKeyRequest(env: GcKeyRequestEnvelope): void {
    this.emit('gcall:key-request', {
      roomId: env.roomId,
      toAddress: env.toAddress,
      fromAddress: env.fromAddress,
      fromPublicKey: env.fromPublicKey,
      callSessionId: env.callSessionId,
      mediaSessionGeneration: env.mediaSessionGeneration,
      keyMessageVersion: env.keyMessageVersion,
      timestamp: env.timestamp,
      verified: true,
    });
  }

  getKeyMessageVersion(): number {
    return GC_KEY_MESSAGE_VERSION;
  }

  getKeyDigestForTarget(toAddress: string, encryptedKey: string): string {
    return buildGcKeyDigest(toAddress, encryptedKey);
  }

  getKeyRotateDigest(encryptedKeys: Record<string, string>): string {
    return buildGcKeyRotateDigest(encryptedKeys);
  }

  private handleRtcOffer(env: GcRtcOfferEnvelope): void {
    if (this.localAddresses.has(env.toAddress)) {
      this.emit('gcall:rtc-signal', { ...env, type: 'offer' });
      return;
    }
    if ((env.hopsRemaining ?? 0) > 0) {
      const nodeId = this.presence.getNodeIdForAddress(env.toAddress);
      if (nodeId) {
        this.p2p.send(nodeId, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
      } else {
        this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
      }
    }
  }

  private handleRtcAnswer(env: GcRtcAnswerEnvelope): void {
    if (this.localAddresses.has(env.toAddress)) {
      this.emit('gcall:rtc-signal', { ...env, type: 'answer' });
      return;
    }
    if ((env.hopsRemaining ?? 0) > 0) {
      const nodeId = this.presence.getNodeIdForAddress(env.toAddress);
      if (nodeId) {
        this.p2p.send(nodeId, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
      } else {
        this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
      }
    }
  }

  private handleRtcIce(env: GcRtcIceEnvelope): void {
    if (this.localAddresses.has(env.toAddress)) {
      this.emit('gcall:rtc-signal', { ...env, type: 'ice' });
      return;
    }
    if ((env.hopsRemaining ?? 0) > 0) {
      const nodeId = this.presence.getNodeIdForAddress(env.toAddress);
      if (nodeId) {
        this.p2p.send(nodeId, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
      } else {
        this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
      }
    }
  }

  private handleRtcReconnect(env: GcRtcReconnectEnvelope): void {
    if (this.localAddresses.has(env.toAddress)) {
      this.emit('gcall:rtc-signal', { ...env, type: 'reconnect' });
      return;
    }
    if ((env.hopsRemaining ?? 0) > 0) {
      const nodeId = this.presence.getNodeIdForAddress(env.toAddress);
      if (nodeId) {
        this.p2p.send(nodeId, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
      } else {
        this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
      }
    }
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  getRoomParticipants(roomId: string): Array<{ address: string; publicKey: string }> {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return [...room.participants.entries()].map(([address, p]) => ({ address, publicKey: p.publicKey }));
  }
}
