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
/**
 * Extra wall-clock slack for GC_JOIN vs peer timestamps (honest skew). Effective max age is
 * `GC_JOIN_TTL_MS + GC_JOIN_SKEW_ALLOWANCE_MS`. Replay window widens slightly; mitigated by
 * Ed25519 + verifiedGcSignatures.
 */
const GC_JOIN_SKEW_ALLOWANCE_MS = 90_000;
/** Keep in sync with presence `MAX_FUTURE_SKEW_MS` (reject implausibly future join timestamps). */
const GC_JOIN_MAX_FUTURE_SKEW_MS = 30_000;

/** Max age of GC_JOIN `timestamp` vs local `now` (for tests and diagnostics). */
export const GC_JOIN_MAX_AGE_MS = GC_JOIN_TTL_MS + GC_JOIN_SKEW_ALLOWANCE_MS;

/**
 * Groups-list call hint: treat relayed GC_TOPOLOGY / GC_CLUSTER_HEARTBEAT as liveness if seen within
 * this window (~8 forwarder heartbeats @ 1.5s + mesh slack). Cheap path only (no verify).
 */
const GC_SPECTATOR_MESH_LIVENESS_MAX_AGE_MS = 12_000;

export type GcJoinTimestampRejectReason = 'expired' | 'future';

/** Exported for unit tests. */
export function gcJoinTimestampRejectReason(
  timestamp: number,
  now: number
): GcJoinTimestampRejectReason | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return 'expired';
  if (timestamp - now > GC_JOIN_MAX_FUTURE_SKEW_MS) return 'future';
  if (now - timestamp > GC_JOIN_MAX_AGE_MS) return 'expired';
  return null;
}

/**
 * After same-room rejoin, seed main-process topology epoch so stale mesh GC_TOPOLOGY below what
 * the renderer already saw is ignored. This is a defensive lower bound, not source of truth.
 * Exported for unit tests.
 */
export function mergeRoomTopologyEpochWithFloor(
  currentEpoch: number,
  floor: number | undefined
): number {
  if (floor === undefined || typeof floor !== 'number' || !Number.isFinite(floor)) {
    return currentEpoch;
  }
  const f = Math.max(0, Math.floor(floor));
  return Math.max(currentEpoch, f);
}

/** Remote or relayed GC_LEAVE must never tear down the active local participant. */
export function shouldIgnoreLeaveForLocalAddress(
  localAddresses: ReadonlySet<string>,
  address: string
): boolean {
  return localAddresses.has(address);
}

export function shouldRefreshParticipantFromVerifiedJoin(opts: {
  currentJoinedAt: number | undefined;
  incomingJoinTimestamp: number;
}): boolean {
  if (
    typeof opts.currentJoinedAt !== 'number' ||
    !Number.isFinite(opts.currentJoinedAt)
  ) {
    return true;
  }
  return opts.incomingJoinTimestamp >= opts.currentJoinedAt;
}

export function shouldApplyVerifiedLeaveToParticipant(opts: {
  participantJoinedAt: number | undefined;
  leaveTimestamp: number;
}): boolean {
  if (
    typeof opts.participantJoinedAt !== 'number' ||
    !Number.isFinite(opts.participantJoinedAt)
  ) {
    return true;
  }
  return opts.leaveTimestamp >= opts.participantJoinedAt;
}

/**
 * Strict merge for a single pending KEY/KEY_ROTATE slot: higher `mediaSessionGeneration` wins;
 * if equal, newer `timestamp` wins. Never prefer lower generation even if timestamp is newer.
 * Exported for unit tests.
 */
export function pendingKeyEnvelopeWinsOver(
  incoming: { mediaSessionGeneration: number; timestamp: number },
  existing: { mediaSessionGeneration: number; timestamp: number }
): boolean {
  if (incoming.mediaSessionGeneration > existing.mediaSessionGeneration) return true;
  if (incoming.mediaSessionGeneration < existing.mediaSessionGeneration) return false;
  return incoming.timestamp > existing.timestamp;
}

/**
 * Local recovery must not bump generation ahead of the mesh; otherwise authoritative
 * GC_KEY/GC_KEY_ROTATE from the real root look stale to this process.
 */
export function getLocalSessionBreakMediaSessionGeneration(
  currentGeneration: number
): number {
  const gen = currentGeneration >>> 0;
  return gen === 0 ? 1 : gen;
}

export function shouldDelayPresenceEvictionForHealthyTransport(opts: {
  lastReportAtMs: number | null | undefined;
  healthyPeerAddresses: ReadonlySet<string>;
  address: string;
  nowMs: number;
  staleAfterMs: number;
}): boolean {
  if (!opts.address || !opts.healthyPeerAddresses.has(opts.address)) return false;
  const lastReportAtMs = opts.lastReportAtMs ?? 0;
  if (lastReportAtMs <= 0) return false;
  return opts.nowMs - lastReportAtMs <= opts.staleAfterMs;
}

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
  lastTopology?: {
    topologyEpoch: number;
    rootForwarder: string;
    standbyForwarder: string;
    clusters: ClusterDef[];
    lastSeen?: number | null;
  };
  joinTimestamp?: number;
  /** Main-owned media session id; immutable until room is empty. */
  callSessionId: string;
  /** Bumped only on explicit session-break IPC. */
  mediaSessionGeneration: number;
}

export interface GroupRoomTopologySnapshot {
  topologyEpoch: number;
  rootForwarder: string;
  standbyForwarder: string;
  clusters: ClusterDef[];
  lastSeen?: number | null;
}

export interface GroupRoomParticipantSnapshot extends RoomParticipant {
  address: string;
}

export interface GroupRoomBootstrapState {
  roomId: string;
  chatId: string;
  participants: GroupRoomParticipantSnapshot[];
  topologyEpoch: number;
  lastTopology?: GroupRoomTopologySnapshot;
  callSessionId: string;
  mediaSessionGeneration: number;
  updatedAtMs: number;
  fromRecentCache: boolean;
}

interface RecentRoomState extends GroupRoomBootstrapState {
  cachedAtMs: number;
}

const RECENT_ROOM_STATE_TTL_MS = 20_000;

export function isRecentRoomStateFresh(
  cachedAtMs: number,
  nowMs: number,
  ttlMs = RECENT_ROOM_STATE_TTL_MS
): boolean {
  return nowMs - cachedAtMs <= ttlMs;
}

export function buildGroupRoomBootstrapState(
  room: Pick<
    GroupRoom,
    | 'roomId'
    | 'chatId'
    | 'participants'
    | 'topologyEpoch'
    | 'lastTopology'
    | 'callSessionId'
    | 'mediaSessionGeneration'
  >,
  updatedAtMs: number,
  fromRecentCache: boolean
): GroupRoomBootstrapState {
  return {
    roomId: room.roomId,
    chatId: room.chatId,
    participants: [...room.participants.entries()].map(([address, p]) => ({
      address,
      publicKey: p.publicKey,
      joinedAt: p.joinedAt,
    })),
    topologyEpoch: room.topologyEpoch,
    lastTopology: room.lastTopology
      ? {
          topologyEpoch: room.lastTopology.topologyEpoch,
          rootForwarder: room.lastTopology.rootForwarder,
          standbyForwarder: room.lastTopology.standbyForwarder,
          clusters: room.lastTopology.clusters.map((cluster) => ({
            members: [...cluster.members],
            forwarder: cluster.forwarder,
            standby: cluster.standby,
            standby2: cluster.standby2 ?? '',
          })),
          lastSeen: room.lastTopology.lastSeen,
        }
      : undefined,
    callSessionId: room.callSessionId,
    mediaSessionGeneration: room.mediaSessionGeneration,
    updatedAtMs,
    fromRecentCache,
  };
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

export function chooseMainTopologyAuthority(
  current: {
    topologyEpoch: number;
    rootForwarder: string;
    lastSeen?: number | null;
  },
  incoming: {
    topologyEpoch: number;
    rootForwarder: string;
    lastSeen?: number | null;
  }
): { acceptIncoming: boolean; reason: string } {
  if (incoming.topologyEpoch !== current.topologyEpoch) {
    return {
      acceptIncoming: incoming.topologyEpoch > current.topologyEpoch,
      reason:
        incoming.topologyEpoch > current.topologyEpoch
          ? 'newer-epoch'
          : 'stale-epoch',
    };
  }
  if (incoming.rootForwarder !== current.rootForwarder) {
    const currentRoot = current.rootForwarder.trim();
    const incomingRoot = incoming.rootForwarder.trim();
    if (!currentRoot && incomingRoot) {
      return { acceptIncoming: true, reason: 'rootForwarder-lexical' };
    }
    if (currentRoot && !incomingRoot) {
      return { acceptIncoming: false, reason: 'rootForwarder-lexical' };
    }
    return {
      acceptIncoming: incomingRoot.localeCompare(currentRoot) < 0,
      reason: 'rootForwarder-lexical',
    };
  }
  const incomingSeen = incoming.lastSeen;
  const currentSeen = current.lastSeen;
  if (
    typeof incomingSeen === 'number' &&
    Number.isFinite(incomingSeen) &&
    typeof currentSeen === 'number' &&
    Number.isFinite(currentSeen) &&
    incomingSeen !== currentSeen
  ) {
    return {
      acceptIncoming: incomingSeen > currentSeen,
      reason: 'lastSeen',
    };
  }
  return { acceptIncoming: false, reason: 'same-topology' };
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
/** Rate-limit GC_JOIN drop logs per (reason, fromAddress). */
const GC_JOIN_DROP_LOG_MIN_MS = 5_000;
/** Throttle broadcastTopology with no local room (ordering / race diagnostic). */
const BROADCAST_TOPOLOGY_NO_ROOM_LOG_MIN_MS = 10_000;

/** Buffer GC_KEY / GC_KEY_ROTATE until joinRoom creates GroupRoom (ordering fix). */
const PENDING_KEY_TTL_MS = 4_000;
/** Throttle "unknown room" logs when we cannot buffer (invalid / stale vs pending). */
const GC_UNKNOWN_ROOM_KEY_LOG_MIN_MS = 60_000;
/** Throttle diagnostic when pending key expires before join. */
const PENDING_KEY_EXPIRED_LOG_MIN_MS = 30_000;

type PendingKeyEntry =
  | {
      type: 'KEY';
      mediaSessionGeneration: number;
      timestamp: number;
      deadlineMs: number;
      env: GcKeyEnvelope;
    }
  | {
      type: 'ROTATE';
      mediaSessionGeneration: number;
      timestamp: number;
      deadlineMs: number;
      env: GcKeyRotateEnvelope;
    };

// ── GroupCallManager ────────────────────────────────────────────────────────── ──────────────────────────────────────────────────────────

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
  private recentRoomStateByRoomId = new Map<string, RecentRoomState>();

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
  private static readonly TRANSPORT_HEALTH_STALE_MS = 15_000;
  private transportHealthByRoom = new Map<
    string,
    { reportedAtMs: number; healthyPeerAddresses: Set<string> }
  >();

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
  /** Key `reason:fromAddress` → last log time for throttled GC_JOIN drop messages */
  private joinDropLogAt = new Map<string, number>();
  /** roomId → last warn time when broadcastTopology ran before joinRoom created the room */
  private broadcastTopologyNoRoomLogAt = new Map<string, number>();

  /** Per-room mesh audio relay budget (outbound + forwarded GC_AUDIO). */
  private relayByteBudgetByRoom = new Map<
    string,
    { tokens: number; lastMs: number }
  >();

  /** GC_KEY / GC_KEY_ROTATE before joinRoom — one slot per roomId (strict generation merge). */
  private pendingKeyByRoom = new Map<string, PendingKeyEntry>();
  private pendingKeyFlushSuccess = 0;
  private pendingKeyExpired = 0;
  private unknownRoomKeyLogAt = new Map<string, number>();
  private pendingKeyExpiredLogAt = new Map<string, number>();

  /** Numeric Qortal group ids (from renderer) to derive sidebar call indicators from relayed GC_* traffic. */
  private watchedQortalGroupNumericIds = new Set<number>();
  /**
   * For rooms we are not joined in: addresses seen on cheap-relay GC_JOIN (shape + TTL only).
   * Cleared when watch list changes or join timestamps go stale.
   */
  private spectatorRooms = new Map<string, Map<string, number>>();
  /** Watched rooms not locally joined: last wall time we relayed topology or cluster heartbeat (mesh liveness). */
  private spectatorMeshLivenessAt = new Map<string, number>();
  private qortalActivityEmitTimer: ReturnType<typeof setTimeout> | null = null;
  private qortalMeshExpiryTimer: ReturnType<typeof setTimeout> | null = null;
  private qortalSpectatorSweepTimer: ReturnType<typeof setInterval> | null = null;

  private buildRecentRoomState(room: GroupRoom, nowMs: number): RecentRoomState {
    return {
      ...buildGroupRoomBootstrapState(room, nowMs, true),
      cachedAtMs: nowMs,
    };
  }

  private getFreshRecentRoomState(roomId: string, nowMs = Date.now()): RecentRoomState | null {
    const cached = this.recentRoomStateByRoomId.get(roomId);
    if (!cached) return null;
    if (!isRecentRoomStateFresh(cached.cachedAtMs, nowMs)) {
      this.recentRoomStateByRoomId.delete(roomId);
      return null;
    }
    return cached;
  }

  private rememberRecentRoomState(room: GroupRoom, nowMs = Date.now()): void {
    this.recentRoomStateByRoomId.set(
      room.roomId,
      this.buildRecentRoomState(room, nowMs)
    );
  }

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
      this.schedulePresenceEviction(address);
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

    this.qortalSpectatorSweepTimer = setInterval(() => {
      if (this.spectatorRooms.size === 0 && this.watchedQortalGroupNumericIds.size === 0) {
        return;
      }
      this.scheduleQortalGroupCallActivityEmit(true);
    }, 45_000);
    this.qortalSpectatorSweepTimer.unref?.();

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
    this.joinDropLogAt.clear();
    this.broadcastTopologyNoRoomLogAt.clear();
    this.pendingKeyByRoom.clear();
    this.unknownRoomKeyLogAt.clear();
    this.pendingKeyExpiredLogAt.clear();
    this.transportHealthByRoom.clear();
    this.recentRoomStateByRoomId.clear();
    if (this.qortalActivityEmitTimer) {
      clearTimeout(this.qortalActivityEmitTimer);
      this.qortalActivityEmitTimer = null;
    }
    if (this.qortalMeshExpiryTimer) {
      clearTimeout(this.qortalMeshExpiryTimer);
      this.qortalMeshExpiryTimer = null;
    }
    if (this.qortalSpectatorSweepTimer) {
      clearInterval(this.qortalSpectatorSweepTimer);
      this.qortalSpectatorSweepTimer = null;
    }
    this.spectatorRooms.clear();
    this.spectatorMeshLivenessAt.clear();
    this.watchedQortalGroupNumericIds.clear();
    loggerLog('[GCall] GroupCallManager stopped.');
  }

  setLocalAddresses(addresses: string[]): void {
    this.localAddresses = new Set(addresses);
    loggerLog(`[GCall] Local addresses set: ${[...addresses].join(', ')}`);
  }

  reportTransportHealth(roomId: string, healthyPeerAddresses: string[]): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const healthyPeers = new Set<string>();
    for (const rawAddress of healthyPeerAddresses) {
      if (typeof rawAddress !== 'string') continue;
      const address = rawAddress.trim();
      if (!address) continue;
      if (this.localAddresses.has(address)) continue;
      if (!room.participants.has(address)) continue;
      healthyPeers.add(address);
    }
    this.transportHealthByRoom.set(roomId, {
      reportedAtMs: Date.now(),
      healthyPeerAddresses: healthyPeers,
    });
  }

  getPendingKeyMetrics(): {
    pending_key_flush_success: number;
    pending_key_expired: number;
    pendingRooms: number;
  } {
    return {
      pending_key_flush_success: this.pendingKeyFlushSuccess,
      pending_key_expired: this.pendingKeyExpired,
      pendingRooms: this.pendingKeyByRoom.size,
    };
  }

  private sweepExpiredPendingKeys(now: number = Date.now()): void {
    if (this.pendingKeyByRoom.size === 0) return;
    for (const [roomId, p] of [...this.pendingKeyByRoom]) {
      if (now > p.deadlineMs) {
        this.pendingKeyByRoom.delete(roomId);
        this.pendingKeyExpired++;
        this.logPendingKeyExpiredThrottled(roomId);
      }
    }
  }

  private logPendingKeyExpiredThrottled(roomId: string): void {
    const t = Date.now();
    const last = this.pendingKeyExpiredLogAt.get(roomId) ?? 0;
    if (t - last < PENDING_KEY_EXPIRED_LOG_MIN_MS) return;
    this.pendingKeyExpiredLogAt.set(roomId, t);
    loggerLog(`[GCall] Pending keying envelope dropped (TTL) for room ${roomId} before joinRoom`);
  }

  private logUnknownRoomKeyThrottled(roomId: string, kind: string): void {
    const t = Date.now();
    const last = this.unknownRoomKeyLogAt.get(roomId) ?? 0;
    if (t - last < GC_UNKNOWN_ROOM_KEY_LOG_MIN_MS) return;
    this.unknownRoomKeyLogAt.set(roomId, t);
    loggerLog(`[GCall] Dropped ${kind}: unknown room ${roomId} (not buffered)`);
  }

  private tryEnqueuePendingKeyFromKey(env: GcKeyEnvelope): boolean {
    const gen = env.mediaSessionGeneration;
    const ts = env.timestamp;
    if (
      typeof gen !== 'number' ||
      !Number.isFinite(gen) ||
      typeof ts !== 'number' ||
      !Number.isFinite(ts)
    ) {
      return false;
    }
    const roomId = env.roomId;
    const existing = this.pendingKeyByRoom.get(roomId);
    if (existing) {
      if (
        !pendingKeyEnvelopeWinsOver(
          { mediaSessionGeneration: gen, timestamp: ts },
          {
            mediaSessionGeneration: existing.mediaSessionGeneration,
            timestamp: existing.timestamp,
          }
        )
      ) {
        return false;
      }
    }
    this.pendingKeyByRoom.set(roomId, {
      type: 'KEY',
      mediaSessionGeneration: gen,
      timestamp: ts,
      deadlineMs: Date.now() + PENDING_KEY_TTL_MS,
      env: { ...env },
    });
    return true;
  }

  private tryEnqueuePendingKeyFromRotate(env: GcKeyRotateEnvelope): boolean {
    const gen = env.mediaSessionGeneration;
    const ts = env.timestamp;
    if (
      typeof gen !== 'number' ||
      !Number.isFinite(gen) ||
      typeof ts !== 'number' ||
      !Number.isFinite(ts)
    ) {
      return false;
    }
    const roomId = env.roomId;
    const existing = this.pendingKeyByRoom.get(roomId);
    if (existing) {
      if (
        !pendingKeyEnvelopeWinsOver(
          { mediaSessionGeneration: gen, timestamp: ts },
          {
            mediaSessionGeneration: existing.mediaSessionGeneration,
            timestamp: existing.timestamp,
          }
        )
      ) {
        return false;
      }
    }
    this.pendingKeyByRoom.set(roomId, {
      type: 'ROTATE',
      mediaSessionGeneration: gen,
      timestamp: ts,
      deadlineMs: Date.now() + PENDING_KEY_TTL_MS,
      env: { ...env, encryptedKeys: { ...env.encryptedKeys } },
    });
    return true;
  }

  private flushPendingKeyForRoom(roomId: string): void {
    const pending = this.pendingKeyByRoom.get(roomId);
    if (!pending) return;
    const now = Date.now();
    if (now > pending.deadlineMs) {
      this.pendingKeyByRoom.delete(roomId);
      this.pendingKeyExpired++;
      this.logPendingKeyExpiredThrottled(roomId);
      return;
    }
    this.pendingKeyByRoom.delete(roomId);
    if (pending.type === 'KEY') {
      this.handleKey(pending.env);
    } else {
      this.handleKeyRotate(pending.env);
    }
    this.pendingKeyFlushSuccess++;
  }

  private hasLocalRoomInterest(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  private logGcJoinDropThrottled(fromAddress: string, reasonBucket: string, message: string): void {
    const key = `${reasonBucket}:${fromAddress}`;
    const now = Date.now();
    const last = this.joinDropLogAt.get(key) ?? 0;
    if (now - last < GC_JOIN_DROP_LOG_MIN_MS) return;
    this.joinDropLogAt.set(key, now);
    loggerLog(message);
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

  private static parseQortalGroupNumericId(roomId: string): number | null {
    const m = /^gcall-qortal-(\d+)$/.exec(roomId);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  }

  private isWatchedQortalRoom(roomId: string): boolean {
    const n = GroupCallManager.parseQortalGroupNumericId(roomId);
    return n !== null && this.watchedQortalGroupNumericIds.has(n);
  }

  /**
   * Renderer passes member-group numeric ids; main tracks relayed joins/leaves only for those rooms.
   */
  setWatchedQortalGroupIds(ids: number[]): Record<string, boolean> {
    const next = new Set<number>();
    if (Array.isArray(ids)) {
      for (const raw of ids) {
        const n =
          typeof raw === 'number' && Number.isFinite(raw)
            ? Math.trunc(raw)
            : Number(raw);
        if (Number.isFinite(n) && n > 0) next.add(n);
      }
    }
    this.watchedQortalGroupNumericIds = next;
    for (const roomId of [...this.spectatorRooms.keys()]) {
      const num = GroupCallManager.parseQortalGroupNumericId(roomId);
      if (num === null || !next.has(num)) {
        this.spectatorRooms.delete(roomId);
      }
    }
    // Do not prune spectatorMeshLivenessAt by watch list: topology may arrive before groups load
    // or while watch is briefly []; TTL sweep in flush drops stale entries.
    this.scheduleQortalGroupCallActivityEmit(true);
    this.scheduleNextQortalMeshExpiry();
    return this.getQortalGroupCallActivitySnapshot();
  }

  private sweepSpectatorRooms(now: number): void {
    for (const [roomId, participants] of [...this.spectatorRooms.entries()]) {
      for (const [addr, joinedAt] of [...participants.entries()]) {
        if (gcJoinTimestampRejectReason(joinedAt, now) === 'expired') {
          participants.delete(addr);
        }
      }
      if (participants.size === 0) {
        this.spectatorRooms.delete(roomId);
      }
    }
  }

  private noteSpectatorJoinFromRelay(env: GcJoinEnvelope): void {
    if (GroupCallManager.parseQortalGroupNumericId(env.roomId) === null) return;
    let m = this.spectatorRooms.get(env.roomId);
    if (!m) {
      m = new Map();
      this.spectatorRooms.set(env.roomId, m);
    }
    const existing = m.get(env.fromAddress);
    if (
      existing !== undefined &&
      !shouldRefreshParticipantFromVerifiedJoin({
        currentJoinedAt: existing,
        incomingJoinTimestamp: env.timestamp,
      })
    ) {
      return;
    }
    m.set(env.fromAddress, env.timestamp);
    if (this.watchedQortalGroupNumericIds.size > 0) {
      this.scheduleQortalGroupCallActivityEmit(false);
    }
  }

  private noteSpectatorLeaveFromRelay(env: GcLeaveEnvelope): void {
    if (GroupCallManager.parseQortalGroupNumericId(env.roomId) === null) return;
    const m = this.spectatorRooms.get(env.roomId);
    if (!m) return;
    m.delete(env.fromAddress);
    if (m.size === 0) {
      this.spectatorRooms.delete(env.roomId);
    }
    if (this.watchedQortalGroupNumericIds.size > 0) {
      this.scheduleQortalGroupCallActivityEmit(false);
    }
  }

  private noteSpectatorMeshLivenessFromRelay(roomId: string): void {
    if (GroupCallManager.parseQortalGroupNumericId(roomId) === null) return;
    this.spectatorMeshLivenessAt.set(roomId, Date.now());
    this.scheduleNextQortalMeshExpiry();
    if (this.watchedQortalGroupNumericIds.size > 0) {
      this.scheduleQortalGroupCallActivityEmit(false);
    }
  }

  private sweepSpectatorMeshLiveness(now: number): void {
    for (const [roomId, at] of [...this.spectatorMeshLivenessAt.entries()]) {
      if (now - at > GC_SPECTATOR_MESH_LIVENESS_MAX_AGE_MS) {
        this.spectatorMeshLivenessAt.delete(roomId);
      }
    }
    this.scheduleNextQortalMeshExpiry();
  }

  private scheduleNextQortalMeshExpiry(): void {
    if (this.qortalMeshExpiryTimer) {
      clearTimeout(this.qortalMeshExpiryTimer);
      this.qortalMeshExpiryTimer = null;
    }
    if (
      this.watchedQortalGroupNumericIds.size === 0 ||
      this.spectatorMeshLivenessAt.size === 0
    ) {
      return;
    }
    const now = Date.now();
    let nextExpiryAt = Number.POSITIVE_INFINITY;
    for (const at of this.spectatorMeshLivenessAt.values()) {
      const expiryAt = at + GC_SPECTATOR_MESH_LIVENESS_MAX_AGE_MS;
      if (expiryAt < nextExpiryAt) nextExpiryAt = expiryAt;
    }
    if (!Number.isFinite(nextExpiryAt)) return;
    const delayMs = Math.max(0, nextExpiryAt - now);
    this.qortalMeshExpiryTimer = setTimeout(() => {
      this.qortalMeshExpiryTimer = null;
      this.scheduleQortalGroupCallActivityEmit(true);
    }, delayMs);
    this.qortalMeshExpiryTimer.unref?.();
  }

  private scheduleQortalGroupCallActivityEmit(immediate: boolean): void {
    if (immediate) {
      if (this.qortalActivityEmitTimer) {
        clearTimeout(this.qortalActivityEmitTimer);
        this.qortalActivityEmitTimer = null;
      }
      this.flushQortalGroupCallActivity();
      return;
    }
    if (this.qortalActivityEmitTimer) return;
    this.qortalActivityEmitTimer = setTimeout(() => {
      this.qortalActivityEmitTimer = null;
      this.flushQortalGroupCallActivity();
    }, 250);
    this.qortalActivityEmitTimer.unref?.();
  }

  private getQortalGroupCallActivitySnapshot(): Record<string, boolean> {
    const now = Date.now();
    this.sweepSpectatorRooms(now);
    this.sweepSpectatorMeshLiveness(now);
    const activeByGroupId: Record<string, boolean> = {};
    for (const id of this.watchedQortalGroupNumericIds) {
      const roomId = `gcall-qortal-${id}`;
      const gid = String(id);
      const local = this.rooms.get(roomId);
      if (local && local.participants.size > 0) {
        activeByGroupId[gid] = true;
        continue;
      }
      const spec = this.spectatorRooms.get(roomId);
      if (spec && spec.size > 0) {
        activeByGroupId[gid] = true;
        continue;
      }
      const meshAt = this.spectatorMeshLivenessAt.get(roomId);
      if (
        meshAt !== undefined &&
        now - meshAt <= GC_SPECTATOR_MESH_LIVENESS_MAX_AGE_MS
      ) {
        activeByGroupId[gid] = true;
      }
    }
    return activeByGroupId;
  }

  private flushQortalGroupCallActivity(): void {
    const activeByGroupId = this.getQortalGroupCallActivitySnapshot();
    this.emit('gcall:qortal-group-call-activity', { activeByGroupId });
  }

  // ── Outbound ──────────────────────────────────────────────────────────────

  joinRoom(
    roomId: string,
    chatId: string,
    localAddress: string,
    signature: string,
    publicKey: string,
    timestamp: number,
    joinGeneration?: number,
    /** Defensive lower bound after same-room rejoin — not canonical epoch (see mergeRoomTopologyEpochWithFloor). */
    topologyEpochFloor?: number
  ): { callSessionId: string; mediaSessionGeneration: number } {
    let room = this.rooms.get(roomId);
    if (!room) {
      const recent = this.getFreshRecentRoomState(roomId);
      room = {
        roomId,
        chatId,
        // Never revive cached participants into live room state on rejoin.
        // Recent topology/session is useful bootstrap authority; recent roster is not.
        participants: new Map(),
        topologyEpoch: mergeRoomTopologyEpochWithFloor(
          recent?.topologyEpoch ?? 0,
          topologyEpochFloor
        ),
        topologySignature: recent?.lastTopology
          ? buildTopologySignature(recent.lastTopology)
          : undefined,
        lastTopology: recent?.lastTopology
          ? {
              topologyEpoch: recent.lastTopology.topologyEpoch,
              rootForwarder: recent.lastTopology.rootForwarder,
              standbyForwarder: recent.lastTopology.standbyForwarder,
              clusters: recent.lastTopology.clusters.map((cluster) => ({
                members: [...cluster.members],
                forwarder: cluster.forwarder,
                standby: cluster.standby,
                standby2: cluster.standby2 ?? '',
              })),
              lastSeen: recent.lastTopology.lastSeen,
            }
          : undefined,
        joinTimestamp: timestamp,
        callSessionId: recent?.callSessionId || nodeCrypto.randomUUID(),
        mediaSessionGeneration: recent?.mediaSessionGeneration ?? 1,
      };
      this.rooms.set(roomId, room);
    } else {
      room.topologyEpoch = mergeRoomTopologyEpochWithFloor(room.topologyEpoch, topologyEpochFloor);
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
    this.flushPendingKeyForRoom(roomId);
    this.scheduleQortalGroupCallActivityEmit(true);
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
    const room = this.rooms.get(roomId);
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
    if (room) this.rememberRecentRoomState(room, timestamp);
    this.pendingKeyByRoom.delete(roomId);
    this.rooms.delete(roomId);
    this.relayByteBudgetByRoom.delete(roomId);
    this.transportHealthByRoom.delete(roomId);
    loggerLog(
      signature
        ? `[GCall] Sent GC_LEAVE for room ${roomId}`
        : `[GCall] Cleared local room state for ${roomId} without broadcasting GC_LEAVE`
    );
    this.scheduleQortalGroupCallActivityEmit(true);
  }

  broadcastTopology(
    roomId: string,
    topology: Omit<
      GcTopologyEnvelope,
      'type' | 'roomId' | 'hopsRemaining' | 'fromPublicKey' | 'signature' | 'timestamp'
    >,
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
    const room = this.rooms.get(roomId);
    if (room) {
      // Renderer is authoritative for outbound topology; direct assign (do not Math.max — regressions should surface).
      room.topologyEpoch = topology.topologyEpoch;
      room.topologySignature = buildTopologySignature(topology);
      room.lastTopology = {
        topologyEpoch: topology.topologyEpoch,
        rootForwarder: topology.rootForwarder,
        standbyForwarder: topology.standbyForwarder,
        clusters: topology.clusters,
        lastSeen: topology.lastSeen,
      };
    } else {
      const now = Date.now();
      const last = this.broadcastTopologyNoRoomLogAt.get(roomId) ?? 0;
      if (now - last >= BROADCAST_TOPOLOGY_NO_ROOM_LOG_MIN_MS) {
        this.broadcastTopologyNoRoomLogAt.set(roomId, now);
        loggerWarn(
          `[GCall] broadcastTopology for ${roomId}: no local room yet — cannot sync main topology epoch (join IPC should run before topology heartbeat)`
        );
      }
    }
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
    if (this.pendingKeyByRoom.size > 0) this.sweepExpiredPendingKeys();

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
    const nowJoin = Date.now();
    if (!this.hasLocalRoomInterest(env.roomId)) {
      if (
        isCheapRelayJoinShape(env) &&
        gcJoinTimestampRejectReason(env.timestamp, nowJoin) === null
      ) {
        this.noteSpectatorJoinFromRelay(env);
        this.relayDisinterestedSignedControl(env);
      }
      return;
    }

    const now = Date.now();
    const preRej = gcJoinTimestampRejectReason(env.timestamp, now);
    if (preRej === 'expired') {
      this.logGcJoinDropThrottled(
        env.fromAddress,
        'expired_pre_verify',
        `[GCall] Dropped GC_JOIN: expired from ${env.fromAddress} (pre-verify)`
      );
      return;
    }
    if (preRej === 'future') {
      this.logGcJoinDropThrottled(
        env.fromAddress,
        'future_timestamp',
        `[GCall] Dropped GC_JOIN: future timestamp from ${env.fromAddress} (pre-verify)`
      );
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
    const postRej = gcJoinTimestampRejectReason(env.timestamp, now);
    if (postRej === 'expired') {
      this.logGcJoinDropThrottled(
        env.fromAddress,
        'expired_post_verify',
        `[GCall] Dropped GC_JOIN: expired from ${env.fromAddress}`
      );
      return;
    }
    if (postRej === 'future') {
      this.logGcJoinDropThrottled(
        env.fromAddress,
        'future_timestamp_post',
        `[GCall] Dropped GC_JOIN: future timestamp from ${env.fromAddress}`
      );
      return;
    }

    // Cache the address → nodeId mapping for targeted audio delivery.
    if (fromNodeId) {
      this.participantNodeIds.set(env.fromAddress, fromNodeId);
    }

    // Update room state if we are in this room
    for (const [roomId, room] of this.rooms) {
      if (roomId === env.roomId) {
        const existing = room.participants.get(env.fromAddress);
        if (
          shouldRefreshParticipantFromVerifiedJoin({
            currentJoinedAt: existing?.joinedAt,
            incomingJoinTimestamp: env.timestamp,
          })
        ) {
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
        this.noteSpectatorLeaveFromRelay(env);
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
    const room = this.rooms.get(env.roomId);
    const participant = room?.participants.get(env.fromAddress);
    if (
      !shouldApplyVerifiedLeaveToParticipant({
        participantJoinedAt: participant?.joinedAt,
        leaveTimestamp: env.timestamp,
      })
    ) {
      loggerLog(
        `[GCall] Ignored stale GC_LEAVE for ${env.fromAddress} in ${env.roomId} (leaveTs=${env.timestamp}, joinedAt=${participant?.joinedAt ?? 'unknown'})`
      );
      return;
    }
    this.handleLeave(env.roomId, env.fromAddress, false);

    if ((env.hopsRemaining ?? 0) > 0) {
      this.p2p.send(null, { ...env, hopsRemaining: (env.hopsRemaining ?? 1) - 1 });
    }
  }

  private handleLeave(roomId: string, address: string, isAbrupt: boolean): void {
    if (shouldIgnoreLeaveForLocalAddress(this.localAddresses, address)) {
      loggerLog(
        `[GCall] Ignored ${isAbrupt ? 'abrupt ' : ''}GC_LEAVE for local address ${address} in ${roomId}`
      );
      return;
    }
    const room = this.rooms.get(roomId);
    const hadLocalInterest = Boolean(room);
    if (room) {
      room.participants.delete(address);
      if (room.participants.size === 0) {
        this.rooms.delete(roomId);
        this.relayByteBudgetByRoom.delete(roomId);
        this.transportHealthByRoom.delete(roomId);
      }
    }
    const health = this.transportHealthByRoom.get(roomId);
    if (health) {
      health.healthyPeerAddresses.delete(address);
      if (
        health.healthyPeerAddresses.size === 0 &&
        (!room || room.participants.size === 0)
      ) {
        this.transportHealthByRoom.delete(roomId);
      }
    }
    this.participantNodeIds.delete(address);
    if (hadLocalInterest) {
      this.emit('gcall:participant-left', { roomId, address, isAbrupt });
    }
    if (hadLocalInterest || this.isWatchedQortalRoom(roomId)) {
      this.scheduleQortalGroupCallActivityEmit(false);
    }
  }

  private handleTopology(env: GcTopologyEnvelope): void {
    if (!this.hasLocalRoomInterest(env.roomId)) {
      if (isCheapRelayTopologyShape(env)) {
        this.noteSpectatorMeshLivenessFromRelay(env.roomId);
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
      const incomingTopology = {
        topologyEpoch: env.topologyEpoch,
        rootForwarder: env.rootForwarder,
        standbyForwarder: env.standbyForwarder,
        clusters: env.clusters,
        lastSeen: env.lastSeen,
      };
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
      if (
        room.lastTopology &&
        incomingTopology.topologyEpoch === room.lastTopology.topologyEpoch &&
        incomingTopology.rootForwarder !== room.lastTopology.rootForwarder
      ) {
        const decision = chooseMainTopologyAuthority(room.lastTopology, incomingTopology);
        loggerLog(
          `[GCall] Same-epoch GC_TOPOLOGY disagreement room=${env.roomId} epoch=${incomingTopology.topologyEpoch} currentRoot=${room.lastTopology.rootForwarder} incomingRoot=${incomingTopology.rootForwarder} acceptIncoming=${decision.acceptIncoming} reason=${decision.reason}`
        );
        if (!decision.acceptIncoming) {
          if ((env.hopsRemaining ?? 0) > 0) {
            this.p2p.send(null, {
              ...env,
              hopsRemaining: (env.hopsRemaining ?? 1) - 1,
            });
          }
          return;
        }
      }
      emitFullTopology =
        env.topologyEpoch !== room.topologyEpoch ||
        topologySignature !== room.topologySignature;
      room.topologyEpoch = env.topologyEpoch;
      room.topologySignature = topologySignature;
      room.lastTopology = incomingTopology;
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
        this.noteSpectatorMeshLivenessFromRelay(env.roomId);
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
      const accepted = this.tryEnqueuePendingKeyFromKey(env);
      if (!accepted && !this.pendingKeyByRoom.has(env.roomId)) {
        this.logUnknownRoomKeyThrottled(env.roomId, 'GC_KEY');
      }
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
      const accepted = this.tryEnqueuePendingKeyFromRotate(env);
      if (!accepted && !this.pendingKeyByRoom.has(env.roomId)) {
        this.logUnknownRoomKeyThrottled(env.roomId, 'GC_KEY_ROTATE');
      }
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
   * Last-resort local session resync: ask local subscribers to drop/reacquire K
   * without inventing a newer generation than the rest of the mesh.
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
    this.emit('gcall:session-updated', {
      roomId,
      callSessionId: room.callSessionId,
      mediaSessionGeneration: getLocalSessionBreakMediaSessionGeneration(
        room.mediaSessionGeneration
      ),
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

  getRoomBootstrapState(roomId: string): GroupRoomBootstrapState | null {
    const liveRoom = this.rooms.get(roomId);
    const recent = this.getFreshRecentRoomState(roomId);
    if (!liveRoom && !recent) return null;
    if (!liveRoom) {
      return {
        ...recent!,
        // Recent cached participants are not authoritative roster truth.
        participants: [],
        lastTopology: recent!.lastTopology
          ? {
              ...recent!.lastTopology,
              clusters: recent!.lastTopology.clusters.map((cluster) => ({
                members: [...cluster.members],
                forwarder: cluster.forwarder,
                standby: cluster.standby,
                standby2: cluster.standby2 ?? '',
              })),
            }
          : undefined,
      };
    }

    const live = buildGroupRoomBootstrapState(liveRoom, Date.now(), false);
    if (!recent) return live;

    return {
      ...live,
      topologyEpoch: Math.max(live.topologyEpoch, recent.topologyEpoch),
      lastTopology: live.lastTopology ?? recent.lastTopology,
      callSessionId: live.callSessionId || recent.callSessionId,
      mediaSessionGeneration: Math.max(
        live.mediaSessionGeneration,
        recent.mediaSessionGeneration
      ),
      updatedAtMs: Math.max(live.updatedAtMs, recent.updatedAtMs),
      fromRecentCache: recent.fromRecentCache,
    };
  }

  private schedulePresenceEviction(address: string): void {
    if (this.presenceEvictionTimers.has(address)) return;

    let inCall = false;
    for (const [, room] of this.rooms) {
      if (room.participants.has(address)) {
        inCall = true;
        break;
      }
    }
    if (!inCall) return;

    loggerLog(
      `[GCall] Presence offline for ${address} — starting ${GroupCallManager.PRESENCE_EVICTION_GRACE_MS}ms grace timer`
    );
    const timer = setTimeout(() => {
      this.presenceEvictionTimers.delete(address);
      if (this.presence.isAddressOnline(address)) {
        loggerLog(`[GCall] ${address} recovered — skipping eviction`);
        return;
      }

      const now = Date.now();
      let delayedByHealthyTransport = false;
      for (const [roomId, room] of this.rooms) {
        if (!room.participants.has(address)) continue;
        const transportHealth = this.transportHealthByRoom.get(roomId);
        if (
          shouldDelayPresenceEvictionForHealthyTransport({
            lastReportAtMs: transportHealth?.reportedAtMs,
            healthyPeerAddresses: transportHealth?.healthyPeerAddresses ?? new Set(),
            address,
            nowMs: now,
            staleAfterMs: GroupCallManager.TRANSPORT_HEALTH_STALE_MS,
          })
        ) {
          delayedByHealthyTransport = true;
          loggerLog(
            `[GCall] Grace period expired for ${address} in ${roomId} — delaying eviction because transport is still healthy`
          );
          continue;
        }
        loggerLog(
          `[GCall] Grace period expired for ${address} — evicting from ${roomId}`
        );
        this.handleLeave(roomId, address, true);
      }

      if (delayedByHealthyTransport && !this.presence.isAddressOnline(address)) {
        this.schedulePresenceEviction(address);
      }
    }, GroupCallManager.PRESENCE_EVICTION_GRACE_MS);
    this.presenceEvictionTimers.set(address, timer);
  }
}
