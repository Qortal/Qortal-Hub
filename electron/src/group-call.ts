/**
 * Group Call protocol for the Qortal Hub P2P network.
 *
 * Implements fully decentralized group voice call signaling on top of the
 * existing P2P mesh.  All GC_* messages are ephemeral (never stored to disk).
 *
 * Architecture (handled entirely in the renderer):
 *   - Adaptive topology: ≤10 members → single forwarder, 11-50 → hierarchical
 *   - Reticulum Links for audio transport (Opus ~24 kbps)
 *   - End-to-end encryption: v2/v3 wire nonce||secretbox(inner); v1 decode fallback in renderer
 *
 * This module handles only the signaling layer:
 *   GC_JOIN / GC_LEAVE       — room membership (Reticulum compact wire; see group-call-wire-reticulum.ts)
 *   GC_TOPOLOGY              — forwarder tree (Reticulum; fragmentation when large)
 *   GC_CLUSTER_HEARTBEAT     — per cluster-forwarder liveness (signed, Reticulum)
 *   GC_KEY / GC_KEY_ROTATE   — room media key distribution (Reticulum)
 *
 * Security: GC_JOIN, GC_LEAVE, GC_TOPOLOGY, GC_CLUSTER_HEARTBEAT, GC_KEY, GC_KEY_ROTATE, and
 * GC_KEY_REQUEST carry Ed25519 signatures. In-room peers verify before use.
 */

import * as nodeCrypto from 'crypto';
import { EventEmitter } from 'events';
import {
  log as loggerLog,
  error as loggerError,
  warn as loggerWarn,
} from './logger';
import type { P2PNetwork } from './p2p-network';
import type { PresenceManager } from './presence';
import type {
  ReticulumBridge,
  ReticulumAudioQueueSnapshot,
  ReticulumEnqueueGroupAudioResult,
  ReticulumOpenAudioLinkResult,
  ReticulumSendFailureReason,
  ReticulumSendResult,
} from './reticulum-bridge';
import { VerifyWorkerPool } from './verify-worker-pool';
import {
  decodeClusterHeartbeatWire,
  decodeJoinIdentityWire,
  decodeJoinIdentityWireFailureReason,
  decodeJoinWire,
  decodeJoinWireFailureReason,
  decodeKeyRequestFromGq1,
  decodeKeyRequestWireSingle,
  decodeKeyRotateFromGr1,
  decodeKeyRotateWireSingle,
  decodeKeyWireFromGk1,
  decodeKeyWireSingle,
  decodeLeaveWire,
  decodeTopologyFromGt1,
  decodeTopologyWireSingle,
  encodeClusterHeartbeatWire,
  encodeJoinIdentityWire,
  encodeJoinWire,
  encodeKeyRequestWire,
  encodeKeyRotateWire,
  encodeKeyWire,
  encodeLeaveWire,
  encodeTopologyWire,
  GC_RETICULUM_WIRE_BUILD_MARKER,
  isGroupCallReticulumWireType,
  isRnsDestinationHashHex,
  isRnsIdentityPublicKeyBase64,
  parseGk0,
  parseGk1,
  parseGq0,
  parseGq1,
  parseGr0,
  parseGr1,
  parseGt0,
  parseGt1,
} from './group-call-wire-reticulum';
import type { GrFragmentMeta, GkFragmentMeta, GtFragmentMeta } from './group-call-wire-reticulum';
import {
  byteLengthUtf8JsonWithBridgeSender,
  RT_RETICULUM_MAX_WIRE_JSON_BYTES,
  wireFitsReticulum,
} from './reticulum-wire-size';

// ── Constants ─────────────────────────────────────────────────────────────────

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

const GC_RETICULUM_ACTIVITY_HEARTBEAT_INTERVAL_MS = 60_000;
/** Must exceed heartbeat interval so peers do not drop `GA` as stale between beats. */
const GC_RETICULUM_ACTIVITY_MAX_AGE_MS = 120_000;
const GC_RETICULUM_ACTIVITY_MAX_FUTURE_SKEW_MS = 30_000;
/** Inbound fragment reassembly buffers for Reticulum group-call control. */
const GC_RETICULUM_REASM_TTL_MS = 45_000;
const GC_RETICULUM_FIRST_CONTACT_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000];
const GC_RETICULUM_FAILURE_LOG_MIN_MS = 5_000;
const GC_RETICULUM_AUDIO_PENDING_MAX_FRAMES = 24;
const GC_RETICULUM_AUDIO_PENDING_MAX_AGE_MS = 750;
const GC_RETICULUM_AUDIO_PENDING_MIN_TOTAL_FRAMES = 12;
const GC_RETICULUM_AUDIO_PENDING_FRAMES_PER_ACTIVE_PEER = 6;
const GC_RETICULUM_AUDIO_PENDING_FANOUT_SOFT_LIMIT = 3;
const GC_RETICULUM_AUDIO_PENDING_HIGH_FANOUT_LIMIT = 12;
const GC_RETICULUM_AUDIO_FLUSH_MAX_FRAMES_PER_PASS = 12;
const GC_RETICULUM_AUDIO_FLUSH_MAX_FRAMES_PER_PEER = 4;
const GC_RETICULUM_AUDIO_FLUSH_RETRY_DELAY_MS = 5;
const GC_RETICULUM_AUDIO_RECOVERY_HOLD_MS = 160;
const GC_RETICULUM_AUDIO_RECOVERY_BUFFER_MAX_AGE_MS = 200;
const GC_RETICULUM_AUDIO_RECOVERY_ACTION_COOLDOWN_MS = 1_000;
const GC_RETICULUM_AUDIO_PRESSURE_BRIDGE_QUEUE_FRAMES = 8;
const GC_RETICULUM_AUDIO_PRESSURE_DECODED_QUEUE_DEPTH = 12;
const GC_RETICULUM_AUDIO_PRESSURE_RECENT_DROPS = 6;
const GC_RETICULUM_PACKET_LINK_FALLBACK_TIMEOUTS = 4;

type ReticulumMediaTransportKind = 'link' | 'packet';

const GC_RETICULUM_PACKET_MEDIA_ENABLED = true;
const GC_RETICULUM_PACKET_MEDIA_KEEP_AUDIO_LINKS = true;
const GC_RETICULUM_OVERLAY_HOPS = 3;
const GC_RETICULUM_OVERLAY_SEEN_TTL_MS = 120_000;
/** Same TTL as overlay id: logical duplicate may reappear after cache expiry. */
const GC_RETICULUM_OVERLAY_CONTENT_DEDUP_TTL_MS = 120_000;
/** Cap RAM if many unique payloads arrive (sweeps expired first). */
const GC_RETICULUM_OVERLAY_CONTENT_DEDUP_MAX = 8192;
/** Full scan for expired content-hash entries at most this often (idle traffic still frees memory). */
const GC_RETICULUM_OVERLAY_CONTENT_DEDUP_SWEEP_MIN_MS = 60_000;

type GcReticulumRetryKind =
  | 'join'
  | 'topology'
  | 'key'
  | 'key_request';

type GcReticulumSendFailureReason =
  | ReticulumSendFailureReason
  | 'no-route'
  | 'no-targets';

type GcReticulumSendResult =
  | { ok: true }
  | { ok: false; reason: GcReticulumSendFailureReason; error?: string };

const GC_RETICULUM_RETRYABLE_FAILURES = new Set<GcReticulumSendFailureReason>([
  'bridge-unavailable',
  'bridge-not-ready',
  'bridge-timeout',
  'bridge-exception',
  'bridge-not-started',
  'unknown-peer-presence-hash',
  'packet-send-false',
  'no-route',
  'no-targets',
]);

export type GcJoinTimestampRejectReason = 'expired' | 'future';

/** Exported for unit tests. */
export function gcJoinTimestampRejectReason(
  timestamp: number,
  now: number
): GcJoinTimestampRejectReason | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp))
    return 'expired';
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
  if (
    floor === undefined ||
    typeof floor !== 'number' ||
    !Number.isFinite(floor)
  ) {
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
  if (incoming.mediaSessionGeneration > existing.mediaSessionGeneration)
    return true;
  if (incoming.mediaSessionGeneration < existing.mediaSessionGeneration)
    return false;
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
  if (!opts.address || !opts.healthyPeerAddresses.has(opts.address))
    return false;
  const lastReportAtMs = opts.lastReportAtMs ?? 0;
  if (lastReportAtMs <= 0) return false;
  return opts.nowMs - lastReportAtMs <= opts.staleAfterMs;
}

/** v3: callSessionId + mediaSessionGeneration + keyCommitment (no topology/key epoch on wire). */
const GC_KEY_MESSAGE_VERSION = 3;

/** After base64 decode; rejects absurd blobs before IPC to renderer. */
const GROUP_AUDIO_MAX_BINARY_WIRE_BYTES = 12_288;

function isValidGcAudioBuffer(data: Buffer): boolean {
  return data.length > 0 && data.length <= GROUP_AUDIO_MAX_BINARY_WIRE_BYTES;
}

// ── Wire types ────────────────────────────────────────────────────────────────

export type GroupCallMsgType =
  | 'GC_JOIN'
  | 'GC_LEAVE'
  | 'GC_TOPOLOGY'
  | 'GC_CLUSTER_HEARTBEAT'
  | 'GC_KEY'
  | 'GC_KEY_ROTATE'
  | 'GC_KEY_REQUEST';

export const GC_MESSAGE_TYPES = new Set<string>([
  'GC_JOIN',
  'GC_LEAVE',
  'GC_TOPOLOGY',
  'GC_CLUSTER_HEARTBEAT',
  'GC_KEY',
  'GC_KEY_ROTATE',
  'GC_KEY_REQUEST',
]);

export interface GcReticulumActivityWire {
  t: 'GA';
  g: number;
  m: number;
}

export function decodeGcReticulumActivityWire(
  wire: Record<string, unknown>,
  now: number = Date.now()
): { groupId: number; timestamp: number } | null {
  if (wire.t !== 'GA') return null;
  if (
    typeof wire.g !== 'number' ||
    !Number.isInteger(wire.g) ||
    wire.g <= 0 ||
    typeof wire.m !== 'number' ||
    !Number.isFinite(wire.m)
  ) {
    return null;
  }
  if (wire.m - now > GC_RETICULUM_ACTIVITY_MAX_FUTURE_SKEW_MS) return null;
  if (now - wire.m > GC_RETICULUM_ACTIVITY_MAX_AGE_MS) return null;
  return {
    groupId: wire.g,
    timestamp: wire.m,
  };
}

// ── Envelope shapes ───────────────────────────────────────────────────────────

export interface GcJoinEnvelope {
  type: 'GC_JOIN';
  roomId: string;
  chatId: string;
  fromAddress: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  /** Joiner's Reticulum destination hash (32 hex, RNS 16-byte address); signed and on wire as `d`. */
  reticulumDestinationHash: string;
  /** RNS.Identity public key (64 bytes, standard base64). Wire `rk`; registers peer in bridge when verified. */
  reticulumIdentityPublicKeyBase64?: string;
  /** Per logical join session; stable across mesh re-announces from the same client. */
  joinGeneration?: number;
  hopsRemaining?: number;
}

/** Signed companion to split-wire GC_JOIN: carries RNS `rk` when GJ alone would exceed ENCRYPTED_MDU. */
export interface GcJoinRkEnvelope {
  type: 'GC_JOIN_RK';
  roomId: string;
  chatId: string;
  fromAddress: string;
  fromPublicKey: string;
  signature: string;
  timestamp: number;
  reticulumDestinationHash: string;
  reticulumIdentityPublicKeyBase64: string;
  joinGeneration?: number;
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

export type GcEnvelope =
  | GcJoinEnvelope
  | GcLeaveEnvelope
  | GcTopologyEnvelope
  | GcClusterHeartbeatEnvelope
  | GcKeyEnvelope
  | GcKeyRotateEnvelope
  | GcKeyRequestEnvelope;

// ── Room state ────────────────────────────────────────────────────────────────

interface RoomParticipant {
  publicKey: string;
  joinedAt: number;
  /** From signed GC_JOIN (compact wire `d`). */
  reticulumDestinationHash: string;
  /** From signed GC_JOIN wire `rk` when present. */
  reticulumIdentityPublicKeyBase64?: string;
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

interface ReticulumAudioPendingFrame {
  roomId: string;
  data: Buffer;
  enqueuedAtMs: number;
}

interface ReticulumAudioPeerState {
  address: string;
  peerPresenceHash: string;
  peerDestinationHash: string;
  transport: ReticulumMediaTransportKind;
  packetTransportFallback: boolean;
  routeKey: string;
  linkId: string | null;
  established: boolean;
  opening: boolean;
  rooms: Set<string>;
  pending: ReticulumAudioPendingFrame[];
  lastInboundAtMs: number;
  lastPathWarmAtMs: number;
  lastRecoveryActionAtMs: number;
  recoveryHoldUntilMs: number;
  recoveryReason: string;
}

interface GcReticulumAudioSendDiagnostics {
  transport: ReticulumMediaTransportKind;
  pendingFrames: number;
  queuePressureDrops: number;
  staleDrops: number;
  linkUnreadyDrops: number;
  packetSendFailures: number;
  targetAddress?: string;
  peerPresenceHash?: string;
  routeKey?: string;
  lastInboundAtMs?: number;
  recoveryReason?: string;
  recoveryHoldUntilMs?: number;
  bridge?: ReticulumAudioQueueSnapshot;
}

interface GcReticulumAudioFlushResult {
  diagnostics: GcReticulumAudioSendDiagnostics;
  framesEnqueued: number;
  bridgePressured: boolean;
  nextDelayMs?: number;
}

type GcReticulumAudioSendResult =
  | { success: true; diagnostics: GcReticulumAudioSendDiagnostics }
  | {
      success: false;
      error: 'invalid-or-oversize-payload' | 'no-reticulum-route';
      diagnostics?: GcReticulumAudioSendDiagnostics;
    };

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
      reticulumDestinationHash: p.reticulumDestinationHash,
      ...(p.reticulumIdentityPublicKeyBase64
        ? { reticulumIdentityPublicKeyBase64: p.reticulumIdentityPublicKeyBase64 }
        : {}),
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

function buildTopologySignature(
  env: Pick<
    GcTopologyEnvelope,
    'topologyEpoch' | 'rootForwarder' | 'standbyForwarder' | 'clusters'
  >
): string {
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
  },
  roomId: string
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
        reason: 'lastSeen-root-conflict',
      };
    }
    const currentRank = sha256Hex(`${currentRoot}:${roomId}`);
    const incomingRank = sha256Hex(`${incomingRoot}:${roomId}`);
    return {
      acceptIncoming: incomingRank.localeCompare(currentRank) < 0,
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

function buildGcKeySignedFields(
  env: GcKeyEnvelope
): Record<string, unknown> | null {
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

function buildGcKeyRequestSignedFields(
  env: GcKeyRequestEnvelope
): Record<string, unknown> {
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

/** Buffer GI (join identity) until matching GJ is verified, or GJ context until GI arrives. */
const GC_JOIN_RK_PENDING_TTL_MS = 120_000;

/** Jobs waiting on off-thread Ed25519 verification */
type GcVerifyPending =
  | {
      kind: 'join';
      env: GcJoinEnvelope;
      fromNodeId?: string;
      peerPresenceHash?: string;
    }
  | {
      kind: 'join_rk';
      env: GcJoinRkEnvelope;
      fromNodeId?: string;
      peerPresenceHash?: string;
    }
  | { kind: 'leave'; env: GcLeaveEnvelope; peerPresenceHash?: string }
  | { kind: 'topology'; env: GcTopologyEnvelope; peerPresenceHash?: string }
  | {
      kind: 'cluster_heartbeat';
      env: GcClusterHeartbeatEnvelope;
      peerPresenceHash?: string;
    }
  | { kind: 'key'; env: GcKeyEnvelope; peerPresenceHash?: string }
  | { kind: 'key_rotate'; env: GcKeyRotateEnvelope; peerPresenceHash?: string }
  | { kind: 'key_request'; env: GcKeyRequestEnvelope; peerPresenceHash?: string };

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
const PENDING_KEY_TTL_MS = 10_000;
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

type RetainedVerifiedKeyState = {
  roomId: string;
  recipientAddress: string;
  fromAddress: string;
  fromPublicKey: string;
  encryptedKey: string;
  timestamp: number;
  keyMessageVersion: number;
  callSessionId: string;
  mediaSessionGeneration: number;
  keyCommitment: string;
  verified: true;
  deliveryKind: 'live' | 'retained-state';
  replayReason?: 'subscribe';
};

/**
 * Serialize for gossip dedup: same logical payload must hash equal even if `X`/`L`/`r` differ.
 * (`r` is sender hash injected by presence_bridge; `X`/`L` are overlay routing.)
 */
function stableJsonStringifyForDedup(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableJsonStringifyForDedup(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableJsonStringifyForDedup(obj[k])}`)
    .join(',')}}`;
}

function hashReticulumWireForContentDedup(wire: Record<string, unknown>): string {
  const copy = { ...wire };
  delete copy.X;
  delete copy.L;
  delete copy.r;
  const body = stableJsonStringifyForDedup(copy);
  return nodeCrypto.createHash('sha256').update(body, 'utf8').digest('hex');
}

// ── GroupCallManager ────────────────────────────────────────────────────────── ──────────────────────────────────────────────────────────

let _instance: GroupCallManager | null = null;

export function startGroupCallManager(
  p2p: P2PNetwork,
  presence: PresenceManager,
  reticulumBridge?: ReticulumBridge | null
): GroupCallManager {
  if (_instance) _instance.stop();
  _instance = new GroupCallManager(p2p, presence, reticulumBridge ?? null);
  _instance.start();
  return _instance;
}

export function stopGroupCallManager(): void {
  if (_instance) {
    _instance.stop();
    _instance = null;
  }
}

export function getGroupCallManager(): GroupCallManager | null {
  return _instance;
}

export class GroupCallManager extends EventEmitter {
  private p2p: P2PNetwork;
  private presence: PresenceManager;
  private reticulumBridge: ReticulumBridge | null;
  private started = false;
  private localAddresses = new Set<string>();
  private rooms = new Map<string, GroupRoom>();
  private recentRoomStateByRoomId = new Map<string, RecentRoomState>();

  /** Cache address → nodeId learned from GC_JOIN, retained for diagnostics / legacy compatibility. */
  private participantNodeIds = new Map<string, string>();
  /** Fallback address → peer presence hash learned from verified inbound Reticulum traffic. */
  private reticulumPeerPresenceHashByAddress = new Map<string, string>();
  private reticulumAudioPeersByAddress = new Map<string, ReticulumAudioPeerState>();
  private reticulumAudioAddressByLinkId = new Map<string, string>();
  private reticulumAudioFlushScheduled = false;
  private reticulumAudioFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private reticulumAudioFlushCursor = 0;

  private presenceExpiredHandler: (address: string) => void;
  private onReticulumGroupCallMessage:
    | ((
        wire: Record<string, unknown>,
        senderDestinationHash: string,
        peerPresenceHash: string
      ) => void)
    | null = null;
  private onReticulumGroupAudioPacket:
    | ((payload: {
        linkId: string;
        roomId: string;
        data: Buffer | string;
        peerPresenceHash: string;
        peerDestinationHash: string;
        incoming: boolean;
      }) => void)
    | null = null;
  private onReticulumGroupAudioSendFailed:
    | ((payload: {
        linkId: string;
        peerPresenceHash?: string;
        transport?: 'link' | 'packet';
        reason: string;
        code: string;
        error: string;
        pathState?: string;
      }) => void)
    | null = null;
  private onReticulumGroupAudioLinkEstablished:
    | ((payload: {
        linkId: string;
        peerPresenceHash: string;
        peerDestinationHash: string;
        incoming: boolean;
      }) => void)
    | null = null;
  private onReticulumGroupAudioLinkClosed:
    | ((payload: {
        linkId: string;
        peerPresenceHash: string;
        peerDestinationHash: string;
        incoming: boolean;
        reason: string;
      }) => void)
    | null = null;
  private onPresenceUpdated:
    | (({ address, online }: { address: string; online: boolean }) => void)
    | null = null;
  private presenceEvictionTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
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
  /** Throttle noisy GC_JOIN / GJ wire diagnostics (decode, overlay dedup). */
  private gcJoinWireDebugLogAt = new Map<string, number>();
  /**
   * After verified GJ without rk (split path): correlate GI by (a|m|d|j) for GC_JOIN_RK verify.
   */
  private pendingJoinRkContextByKey = new Map<
    string,
    {
      roomId: string;
      chatId: string;
      fromPublicKey: string;
      expiresAt: number;
    }
  >();
  /** GI arrived before matching GJ was verified. */
  private pendingJoinRkBeforeGjByKey = new Map<
    string,
    {
      decoded: {
        fromAddress: string;
        signature: string;
        timestamp: number;
        reticulumDestinationHash: string;
        reticulumIdentityPublicKeyBase64: string;
        joinGeneration?: number;
      };
      fromNodeId?: string;
      peerPresenceHash?: string;
      expiresAt: number;
    }
  >();
  /** roomId → last warn time when broadcastTopology ran before joinRoom created the room */
  private broadcastTopologyNoRoomLogAt = new Map<string, number>();

  /** GC_KEY / GC_KEY_ROTATE before joinRoom — one slot per roomId (strict generation merge). */
  private pendingKeyByRoom = new Map<string, PendingKeyEntry>();
  /** Latest verified authoritative key state retained per room+local recipient for subscribe-time replay. */
  private retainedVerifiedKeyStateByRoomAndRecipient = new Map<
    string,
    RetainedVerifiedKeyState
  >();
  private pendingKeyFlushSuccess = 0;
  private pendingKeyExpired = 0;
  private unknownRoomKeyLogAt = new Map<string, number>();
  private pendingKeyExpiredLogAt = new Map<string, number>();
  private reticulumFailureLogAt = new Map<string, number>();
  private seenReticulumOverlayIds = new Map<string, number>();
  /** SHA-256 hex → expiry (wall ms): drop relay + local handling if we already saw this payload. */
  private seenReticulumWireContentHashes = new Map<string, number>();
  private lastReticulumWireContentHashSweepAt = 0;

  /** Numeric Qortal group ids (from renderer) to derive sidebar call indicators. */
  private watchedQortalGroupNumericIds = new Set<number>();
  /** Watched rooms not locally joined: last wall time we received a Reticulum activity hint. */
  private spectatorReticulumLivenessAt = new Map<string, number>();
  /** Qortal roomId → authoritative group member addresses to target with Reticulum activity hints. */
  private qortalReticulumTargetsByRoomId = new Map<string, Set<string>>();
  private qortalActivityEmitTimer: ReturnType<typeof setTimeout> | null = null;
  private qortalReticulumExpiryTimer: ReturnType<typeof setTimeout> | null = null;
  private qortalSpectatorSweepTimer: ReturnType<typeof setInterval> | null =
    null;
  private qortalReticulumHeartbeatTimer: ReturnType<typeof setInterval> | null =
    null;

  private reticulumTopoReasm = new Map<
    string,
    { meta: GtFragmentMeta; parts: Map<number, string>; deadline: number }
  >();
  private reticulumGrReasm = new Map<
    string,
    { meta: GrFragmentMeta; parts: Map<number, string>; deadline: number }
  >();
  private reticulumGkReasm = new Map<
    string,
    { meta: GkFragmentMeta; parts: Map<number, string>; deadline: number }
  >();
  private reticulumGqReasm = new Map<
    string,
    { meta: GkFragmentMeta; parts: Map<number, string>; deadline: number }
  >();
  private reticulumRetryTimers = new Set<ReturnType<typeof setTimeout>>();

  private buildRecentRoomState(
    room: GroupRoom,
    nowMs: number
  ): RecentRoomState {
    return {
      ...buildGroupRoomBootstrapState(room, nowMs, true),
      cachedAtMs: nowMs,
    };
  }

  private getFreshRecentRoomState(
    roomId: string,
    nowMs = Date.now()
  ): RecentRoomState | null {
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

  constructor(
    p2p: P2PNetwork,
    presence: PresenceManager,
    reticulumBridge?: ReticulumBridge | null
  ) {
    super();
    this.p2p = p2p;
    this.presence = presence;
    this.reticulumBridge = reticulumBridge ?? null;

    this.presenceExpiredHandler = (address: string) => {
      this.schedulePresenceEviction(address);
    };
  }

  private rememberReticulumPeerPresenceHash(
    address: string,
    peerPresenceHash?: string
  ): void {
    if (!address || !peerPresenceHash) return;
    this.reticulumPeerPresenceHashByAddress.set(address, peerPresenceHash);
  }

  /**
   * Hash to pass to the Reticulum bridge (overlay send, group audio, etc.).
   * Prefer the verified GC_JOIN identity hash from room state: it matches
   * `register_peer_identity` / Python `_known_peers`. Presence route can
   * reflect the wire sender (transport) when those differ, which would cause
   * `unknown_peer_presence_hash` if resolved before participant state.
   */
  private resolveReticulumPeerPresenceHash(address: string): string | null {
    for (const room of this.rooms.values()) {
      const p = room.participants.get(address);
      if (p?.reticulumDestinationHash) {
        const h = p.reticulumDestinationHash.trim().toLowerCase();
        this.rememberReticulumPeerPresenceHash(address, h);
        return h;
      }
    }
    const route = this.presence.getRouteForAddress(address);
    if (route?.kind === 'reticulum') {
      this.rememberReticulumPeerPresenceHash(address, route.destinationHash);
      return route.destinationHash;
    }
    return this.reticulumPeerPresenceHashByAddress.get(address) ?? null;
  }

  private attachReticulumBridgeListeners(): void {
    const bridge = this.reticulumBridge;
    if (!bridge || this.onReticulumGroupCallMessage) {
      return;
    }

    this.onReticulumGroupCallMessage = (
      wire,
      senderDestinationHash,
      peerPresenceHash
    ) => {
      try {
        this.handleReticulumGroupCallWire(
          wire,
          senderDestinationHash,
          peerPresenceHash
        );
      } catch (err) {
        loggerError('[GCall] Error handling Reticulum group call wire:', err);
      }
    };
    this.onReticulumGroupAudioPacket = (payload) => {
      try {
        this.handleReticulumGroupAudioPacket(payload);
      } catch (err) {
        loggerError('[GCall] Error handling Reticulum group audio packet:', err);
      }
    };
    this.onReticulumGroupAudioLinkEstablished = (payload) => {
      try {
        this.handleReticulumGroupAudioLinkEstablished(payload);
      } catch (err) {
        loggerError('[GCall] Error handling Reticulum group audio link ready:', err);
      }
    };
    this.onReticulumGroupAudioLinkClosed = (payload) => {
      try {
        this.handleReticulumGroupAudioLinkClosed(payload);
      } catch (err) {
        loggerError('[GCall] Error handling Reticulum group audio link close:', err);
      }
    };
    this.onReticulumGroupAudioSendFailed = (payload) => {
      try {
        this.handleReticulumGroupAudioSendFailed(payload);
      } catch (err) {
        loggerError('[GCall] Error handling Reticulum audio send failure:', err);
      }
    };
    bridge.on('group-call-message', this.onReticulumGroupCallMessage);
    bridge.on('group-audio-packet', this.onReticulumGroupAudioPacket);
    bridge.on(
      'group-audio-link-established',
      this.onReticulumGroupAudioLinkEstablished
    );
    bridge.on('group-audio-link-closed', this.onReticulumGroupAudioLinkClosed);
    bridge.on('group-audio-send-failed', this.onReticulumGroupAudioSendFailed);
  }

  private detachReticulumBridgeListeners(): void {
    if (this.reticulumBridge && this.onReticulumGroupCallMessage) {
      this.reticulumBridge.off(
        'group-call-message',
        this.onReticulumGroupCallMessage
      );
      this.onReticulumGroupCallMessage = null;
    }
    if (this.reticulumBridge && this.onReticulumGroupAudioPacket) {
      this.reticulumBridge.off(
        'group-audio-packet',
        this.onReticulumGroupAudioPacket
      );
      this.onReticulumGroupAudioPacket = null;
    }
    if (this.reticulumBridge && this.onReticulumGroupAudioLinkEstablished) {
      this.reticulumBridge.off(
        'group-audio-link-established',
        this.onReticulumGroupAudioLinkEstablished
      );
      this.onReticulumGroupAudioLinkEstablished = null;
    }
    if (this.reticulumBridge && this.onReticulumGroupAudioLinkClosed) {
      this.reticulumBridge.off(
        'group-audio-link-closed',
        this.onReticulumGroupAudioLinkClosed
      );
      this.onReticulumGroupAudioLinkClosed = null;
    }
    if (this.reticulumBridge && this.onReticulumGroupAudioSendFailed) {
      this.reticulumBridge.off(
        'group-audio-send-failed',
        this.onReticulumGroupAudioSendFailed
      );
      this.onReticulumGroupAudioSendFailed = null;
    }
  }

  setReticulumBridge(reticulumBridge?: ReticulumBridge | null): void {
    const nextBridge = reticulumBridge ?? null;
    if (this.reticulumBridge === nextBridge) {
      if (this.started) this.attachReticulumBridgeListeners();
      return;
    }
    this.detachReticulumBridgeListeners();
    this.reticulumBridge = nextBridge;
    if (this.started) {
      this.attachReticulumBridgeListeners();
    }
  }

  private logVerifyFailure(job: GcVerifyPending): void {
    if (job.kind === 'join') {
      loggerLog(
        `[GCall] Dropped GC_JOIN: invalid signature from ${job.env.fromAddress}`
      );
    } else if (job.kind === 'join_rk') {
      loggerLog(
        `[GCall] Dropped GC_JOIN_RK: invalid signature from ${job.env.fromAddress}`
      );
    } else if (job.kind === 'leave') {
      loggerLog(
        `[GCall] Dropped GC_LEAVE: invalid signature from ${job.env.fromAddress}`
      );
    } else if (job.kind === 'topology') {
      loggerLog(
        `[GCall] Dropped GC_TOPOLOGY: invalid signature from ${job.env.fromAddress}`
      );
    } else if (job.kind === 'cluster_heartbeat') {
      loggerLog(
        `[GCall] Dropped GC_CLUSTER_HEARTBEAT: invalid signature from ${job.env.fromAddress}`
      );
    } else if (job.kind === 'key') {
      loggerLog(
        `[GCall] Dropped GC_KEY: invalid signature from ${job.env.fromAddress}`
      );
    } else if (job.kind === 'key_rotate') {
      loggerLog(
        `[GCall] Dropped GC_KEY_ROTATE: invalid signature from ${job.env.fromAddress}`
      );
    } else {
      loggerLog(
        `[GCall] Dropped GC_KEY_REQUEST: invalid signature from ${job.env.fromAddress}`
      );
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
      const first = this.verifiedGcSignatures.keys().next().value as
        | string
        | undefined;
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
    if (job.kind === 'join') {
      const env = job.env;
      const signed = env.reticulumDestinationHash.trim().toLowerCase();
      const transport = job.peerPresenceHash?.trim().toLowerCase();
      if (transport && signed && transport !== signed) {
        this.logGcJoinDropThrottled(
          env.fromAddress,
          'join_hash_mismatch_transport',
          `[GCall] GC_JOIN reticulumDestinationHash differs from transport sender for ${env.fromAddress} — identity hash kept for bridge cache (matches register_peer_identity)`
        );
      }
      this.rememberReticulumPeerPresenceHash(env.fromAddress, signed);
    } else if (job.kind === 'join_rk') {
      const env = job.env;
      const signed = env.reticulumDestinationHash.trim().toLowerCase();
      const transport = job.peerPresenceHash?.trim().toLowerCase();
      if (transport && signed && transport !== signed) {
        this.logGcJoinDropThrottled(
          env.fromAddress,
          'join_hash_mismatch_transport',
          `[GCall] GC_JOIN_RK reticulumDestinationHash differs from transport sender for ${env.fromAddress} — identity hash kept for bridge cache (matches register_peer_identity)`
        );
      }
      this.rememberReticulumPeerPresenceHash(env.fromAddress, signed);
    } else {
      this.rememberReticulumPeerPresenceHash(
        job.env.fromAddress,
        job.peerPresenceHash
      );
    }
    switch (job.kind) {
      case 'join':
        this.applyVerifiedJoin(job.env, job.fromNodeId);
        break;
      case 'join_rk':
        this.applyVerifiedJoinRk(job.env, job.fromNodeId);
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
    if (this.started) return;
    this.started = true;
    this.attachReticulumBridgeListeners();

    this.verifyPool.start();

    // Hook into presence-updated to detect abrupt disconnects (with grace period)
    // Store reference so stop() can properly remove it.
    this.onPresenceUpdated = ({
      address,
      online,
    }: {
      address: string;
      online: boolean;
    }) => {
      if (!online) {
        this.presenceExpiredHandler(address);
      } else {
        // Peer came back online — cancel any pending eviction timer
        const timer = this.presenceEvictionTimers.get(address);
        if (timer !== undefined) {
          loggerLog(
            `[GCall] ${address} back online — cancelling eviction timer`
          );
          clearTimeout(timer);
          this.presenceEvictionTimers.delete(address);
        }
      }
    };
    this.presence.on('presence-updated', this.onPresenceUpdated);

    this.qortalSpectatorSweepTimer = setInterval(() => {
      if (this.watchedQortalGroupNumericIds.size === 0) {
        return;
      }
      this.scheduleQortalGroupCallActivityEmit(true);
    }, 45_000);
    this.qortalSpectatorSweepTimer.unref?.();
    this.qortalReticulumHeartbeatTimer = setInterval(() => {
      this.flushReticulumGroupActivityHeartbeats();
    }, GC_RETICULUM_ACTIVITY_HEARTBEAT_INTERVAL_MS);
    this.qortalReticulumHeartbeatTimer.unref?.();

    loggerLog(
      `[GCall] GroupCallManager started. reticulumWire=${GC_RETICULUM_WIRE_BUILD_MARKER}`
    );
  }

  stop(): void {
    this.started = false;
    this.verifyPool.stop();
    this.detachReticulumBridgeListeners();
    if (this.onPresenceUpdated)
      this.presence.off('presence-updated', this.onPresenceUpdated);
    for (const timer of this.presenceEvictionTimers.values())
      clearTimeout(timer);
    this.presenceEvictionTimers.clear();
    this.participantNodeIds.clear();
    this.reticulumPeerPresenceHashByAddress.clear();
    this.reticulumAudioPeersByAddress.clear();
    this.reticulumAudioAddressByLinkId.clear();
    this.reticulumAudioFlushScheduled = false;
    if (this.reticulumAudioFlushTimer) {
      clearTimeout(this.reticulumAudioFlushTimer);
      this.reticulumAudioFlushTimer = null;
    }
    this.reticulumAudioFlushCursor = 0;
    this.rooms.clear();
    this.verifiedGcSignatures.clear();
    this.inFlightGcVerify.clear();
    this.lastStaleTopologyLogAt = 0;
    this.joinDropLogAt.clear();
    this.broadcastTopologyNoRoomLogAt.clear();
    this.pendingKeyByRoom.clear();
    this.retainedVerifiedKeyStateByRoomAndRecipient.clear();
    this.unknownRoomKeyLogAt.clear();
    this.pendingKeyExpiredLogAt.clear();
    this.transportHealthByRoom.clear();
    this.recentRoomStateByRoomId.clear();
    this.seenReticulumOverlayIds.clear();
    this.seenReticulumWireContentHashes.clear();
    this.lastReticulumWireContentHashSweepAt = 0;
    if (this.qortalActivityEmitTimer) {
      clearTimeout(this.qortalActivityEmitTimer);
      this.qortalActivityEmitTimer = null;
    }
    if (this.qortalReticulumExpiryTimer) {
      clearTimeout(this.qortalReticulumExpiryTimer);
      this.qortalReticulumExpiryTimer = null;
    }
    if (this.qortalSpectatorSweepTimer) {
      clearInterval(this.qortalSpectatorSweepTimer);
      this.qortalSpectatorSweepTimer = null;
    }
    if (this.qortalReticulumHeartbeatTimer) {
      clearInterval(this.qortalReticulumHeartbeatTimer);
      this.qortalReticulumHeartbeatTimer = null;
    }
    this.spectatorReticulumLivenessAt.clear();
    this.qortalReticulumTargetsByRoomId.clear();
    this.watchedQortalGroupNumericIds.clear();
    this.reticulumTopoReasm.clear();
    this.reticulumGrReasm.clear();
    this.reticulumGkReasm.clear();
    this.reticulumGqReasm.clear();
    for (const timer of this.reticulumRetryTimers) {
      clearTimeout(timer);
    }
    this.reticulumRetryTimers.clear();
    loggerLog('[GCall] GroupCallManager stopped.');
  }

  setLocalAddresses(addresses: string[]): void {
    this.localAddresses = new Set(addresses);
    loggerLog(`[GCall] Local addresses set: ${[...addresses].join(', ')}`);
    this.syncReticulumAudioLinks();
  }

  setQortalGroupReticulumTargets(roomId: string, addresses: string[]): void {
    if (GroupCallManager.parseQortalGroupNumericId(roomId) === null) {
      this.qortalReticulumTargetsByRoomId.delete(roomId);
      return;
    }
    const next = new Set<string>();
    if (Array.isArray(addresses)) {
      for (const raw of addresses) {
        if (typeof raw !== 'string') continue;
        const address = raw.trim();
        if (!address || this.localAddresses.has(address)) continue;
        next.add(address);
      }
    }
    if (next.size > 0) {
      this.qortalReticulumTargetsByRoomId.set(roomId, next);
    } else {
      this.qortalReticulumTargetsByRoomId.delete(roomId);
    }
    this.flushReticulumGroupActivityHeartbeats(roomId);
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

  requestPeerMediaRecovery(
    roomId: string,
    address: string,
    reason: string
  ): void {
    const normalizedRoomId = roomId.trim();
    const normalizedAddress = address.trim();
    const normalizedReason = reason.trim() || 'renderer-recovery';
    if (!normalizedRoomId || !normalizedAddress) return;
    this.requestReticulumAudioRecovery(
      normalizedRoomId,
      normalizedAddress,
      normalizedReason,
      {
        force: true,
        holdAudio: true,
      }
    );
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
    loggerLog(
      `[GCall] Pending keying envelope dropped (TTL) for room ${roomId} before joinRoom`
    );
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

  private retainedKeyStateKey(roomId: string, recipientAddress: string): string {
    return `${roomId}:${recipientAddress}`;
  }

  private clearRetainedVerifiedKeyStatesForRoom(roomId: string): void {
    for (const key of this.retainedVerifiedKeyStateByRoomAndRecipient.keys()) {
      if (key.startsWith(`${roomId}:`)) {
        this.retainedVerifiedKeyStateByRoomAndRecipient.delete(key);
      }
    }
  }

  private shouldRetainVerifiedKeyStateForReplay(
    roomId: string,
    fromAddress: string
  ): boolean {
    const room = this.rooms.get(roomId);
    const authoritativeRoot = room?.lastTopology?.rootForwarder?.trim() ?? '';
    if (!authoritativeRoot) return true;
    return authoritativeRoot === fromAddress.trim();
  }

  private rememberRetainedVerifiedKeyState(
    recipientAddress: string,
    payload: Omit<RetainedVerifiedKeyState, 'recipientAddress'>
  ): void {
    if (
      !this.shouldRetainVerifiedKeyStateForReplay(
        payload.roomId,
        payload.fromAddress
      )
    ) {
      return;
    }
    this.retainedVerifiedKeyStateByRoomAndRecipient.set(
      this.retainedKeyStateKey(payload.roomId, recipientAddress),
      {
        ...payload,
        recipientAddress,
      }
    );
  }

  replayRetainedVerifiedKeyStatesTo(target: {
    id?: number;
    send: (channel: string, payload: unknown) => void;
  }): void {
    let replayed = 0;
    for (const retained of this.retainedVerifiedKeyStateByRoomAndRecipient.values()) {
      if (
        !this.shouldRetainVerifiedKeyStateForReplay(
          retained.roomId,
          retained.fromAddress
        )
      ) {
        continue;
      }
      target.send('gcall:key', {
        roomId: retained.roomId,
        fromAddress: retained.fromAddress,
        fromPublicKey: retained.fromPublicKey,
        encryptedKey: retained.encryptedKey,
        timestamp: retained.timestamp,
        keyMessageVersion: retained.keyMessageVersion,
        callSessionId: retained.callSessionId,
        mediaSessionGeneration: retained.mediaSessionGeneration,
        keyCommitment: retained.keyCommitment,
        verified: true,
        deliveryKind: 'retained-state',
        replayReason: 'subscribe',
      });
      replayed += 1;
    }
    if (replayed > 0) {
      loggerLog(
        `[GCall] Replayed ${replayed} retained verified key state frame(s) to subscriber ${target.id ?? 'unknown'}`
      );
    }
  }

  private logGcJoinDropThrottled(
    fromAddress: string,
    reasonBucket: string,
    message: string
  ): void {
    const key = `${reasonBucket}:${fromAddress}`;
    const now = Date.now();
    const last = this.joinDropLogAt.get(key) ?? 0;
    if (now - last < GC_JOIN_DROP_LOG_MIN_MS) return;
    this.joinDropLogAt.set(key, now);
    loggerLog(message);
  }

  /** Rate-limited debug for GJ wire paths (not keyed by fromAddress). */
  private logGcJoinWireDebugThrottled(dedupeKey: string, message: string): void {
    const now = Date.now();
    const last = this.gcJoinWireDebugLogAt.get(dedupeKey) ?? 0;
    if (now - last < GC_JOIN_DROP_LOG_MIN_MS) return;
    this.gcJoinWireDebugLogAt.set(dedupeKey, now);
    loggerLog(message);
  }

  private sweepExpiredReticulumReassembly(now: number): void {
    for (const m of [
      this.reticulumTopoReasm,
      this.reticulumGrReasm,
      this.reticulumGkReasm,
      this.reticulumGqReasm,
    ]) {
      for (const [k, v] of m) {
        if (now > v.deadline) m.delete(k);
      }
    }
  }

  private collectReticulumTargetAddressesForRoom(
    roomId: string,
    excludeAddresses?: Set<string>
  ): string[] {
    const ex = excludeAddresses ?? new Set<string>();
    const out = new Set<string>();
    const room = this.rooms.get(roomId);
    if (room) {
      for (const addr of room.participants.keys()) {
        if (this.localAddresses.has(addr) || ex.has(addr)) continue;
        out.add(addr);
      }
    }
    const extra = this.qortalReticulumTargetsByRoomId.get(roomId);
    if (extra) {
      for (const addr of extra) {
        if (this.localAddresses.has(addr) || ex.has(addr)) continue;
        out.add(addr);
      }
    }
    return [...out];
  }

  private collectReticulumDestinationHashesForRoom(
    roomId: string,
    excludeAddresses?: Set<string>
  ): string[] {
    const out = new Set<string>();
    for (const addr of this.collectReticulumTargetAddressesForRoom(
      roomId,
      excludeAddresses
    )) {
      const peerPresenceHash = this.resolveReticulumPeerPresenceHash(addr);
      if (peerPresenceHash) out.add(peerPresenceHash);
    }
    return [...out];
  }

  private isRetryableReticulumFailure(
    result: GcReticulumSendResult
  ): result is { ok: false; reason: GcReticulumSendFailureReason; error?: string } {
    if (!('reason' in result)) return false;
    return GC_RETICULUM_RETRYABLE_FAILURES.has(result.reason);
  }

  private scheduleReticulumRetry(
    delayMs: number,
    job: () => void
  ): void {
    const timer = setTimeout(() => {
      this.reticulumRetryTimers.delete(timer);
      job();
    }, delayMs);
    timer.unref?.();
    this.reticulumRetryTimers.add(timer);
  }

  private logReticulumFailureThrottled(key: string, message: string): void {
    const now = Date.now();
    const last = this.reticulumFailureLogAt.get(key) ?? 0;
    if (now - last < GC_RETICULUM_FAILURE_LOG_MIN_MS) return;
    this.reticulumFailureLogAt.set(key, now);
    loggerWarn(message);
  }

  private nextReticulumOverlayId(): string {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }

  private attachReticulumOverlayMeta(
    frame: Record<string, unknown>,
    hopsRemaining: number = GC_RETICULUM_OVERLAY_HOPS
  ): Record<string, unknown> {
    return {
      ...frame,
      X: this.nextReticulumOverlayId(),
      L: Math.max(0, Math.trunc(hopsRemaining)),
    };
  }

  private parseReticulumOverlayMeta(
    wire: Record<string, unknown>
  ): { overlayId: string; hopsRemaining: number } | null {
    if (typeof wire.X !== 'string' || typeof wire.L !== 'number') {
      return null;
    }
    return {
      overlayId: wire.X,
      hopsRemaining: Math.max(0, Math.trunc(wire.L)),
    };
  }

  private rememberReticulumOverlayId(overlayId: string): void {
    const now = Date.now();
    this.seenReticulumOverlayIds.set(overlayId, now + GC_RETICULUM_OVERLAY_SEEN_TTL_MS);
    for (const [id, expiresAt] of this.seenReticulumOverlayIds) {
      if (expiresAt <= now) this.seenReticulumOverlayIds.delete(id);
    }
  }

  private hasSeenReticulumOverlayId(overlayId: string): boolean {
    const now = Date.now();
    const expiresAt = this.seenReticulumOverlayIds.get(overlayId);
    if (typeof expiresAt !== 'number') return false;
    if (expiresAt <= now) {
      this.seenReticulumOverlayIds.delete(overlayId);
      return false;
    }
    return true;
  }

  private sweepExpiredReticulumWireContentHashes(now: number): void {
    for (const [h, expiresAt] of this.seenReticulumWireContentHashes) {
      if (expiresAt <= now) this.seenReticulumWireContentHashes.delete(h);
    }
  }

  /** Drops expired entries periodically so the map does not sit full of dead TTLs during idle periods. */
  private maybeSweepReticulumWireContentHashes(now: number): void {
    if (
      now - this.lastReticulumWireContentHashSweepAt <
      GC_RETICULUM_OVERLAY_CONTENT_DEDUP_SWEEP_MIN_MS
    ) {
      return;
    }
    this.lastReticulumWireContentHashSweepAt = now;
    this.sweepExpiredReticulumWireContentHashes(now);
  }

  private rememberReticulumWireContentHash(hash: string): void {
    const now = Date.now();
    this.seenReticulumWireContentHashes.set(
      hash,
      now + GC_RETICULUM_OVERLAY_CONTENT_DEDUP_TTL_MS
    );
    this.sweepExpiredReticulumWireContentHashes(now);
    while (
      this.seenReticulumWireContentHashes.size >
      GC_RETICULUM_OVERLAY_CONTENT_DEDUP_MAX
    ) {
      const first = this.seenReticulumWireContentHashes.keys().next().value;
      if (first === undefined) break;
      this.seenReticulumWireContentHashes.delete(first);
    }
  }

  private hasSeenReticulumWireContentHash(hash: string): boolean {
    const now = Date.now();
    const expiresAt = this.seenReticulumWireContentHashes.get(hash);
    if (typeof expiresAt !== 'number') return false;
    if (expiresAt <= now) {
      this.seenReticulumWireContentHashes.delete(hash);
      return false;
    }
    return true;
  }

  private async broadcastReticulumFramesViaOverlay(
    frames: Record<string, unknown>[],
    excludePeerHashes: string[] = []
  ): Promise<GcReticulumSendResult> {
    if (frames.length === 0) {
      return {
        ok: false,
        reason: 'wire-too-large',
        error: 'No Reticulum frames fit encrypted wire limit',
      };
    }
    const bridge = this.reticulumBridge;
    if (!bridge) return { ok: false, reason: 'bridge-unavailable' };
    if (bridge.getState() !== 'ready') {
      return { ok: false, reason: 'bridge-not-ready' };
    }
    const neighbors =
      this.presence.getReticulumActiveNeighborHashes(excludePeerHashes);
    if (neighbors.length === 0) {
      return { ok: false, reason: 'no-route' };
    }
    /** True if at least one overlay neighbor received every frame (gossip delivered). */
    let anyPeerFullDelivery = false;
    let lastFailure: Extract<ReticulumSendResult, { ok: false }> | null = null;
    for (const peerHash of neighbors) {
      let peerDeliveredAllFrames = true;
      for (const frame of frames) {
        const result: ReticulumSendResult = await bridge.sendGroupCallDetailed(
          peerHash,
          frame
        );
        if (result.ok === false) {
          peerDeliveredAllFrames = false;
          lastFailure = result;
          const wireT = frame['t'];
          const wireHint =
            typeof wireT === 'string' ? ` wire=${wireT}` : '';
          loggerWarn(
            `[GCall] Reticulum overlay fanout send failed peer=${peerHash.slice(0, 16)}… reason=${result.reason}${result.error ? ` error=${result.error}` : ''}${wireHint}`
          );
        }
      }
      if (peerDeliveredAllFrames) {
        anyPeerFullDelivery = true;
      }
    }
    if (anyPeerFullDelivery) {
      return { ok: true };
    }
    if (lastFailure) {
      return lastFailure;
    }
    return {
      ok: false,
      reason: 'packet-send-false',
      error: 'Overlay fanout had no successful delivery',
    };
  }

  private async sendReticulumFramesToHash(
    destinationHash: string,
    frames: Record<string, unknown>[]
  ): Promise<GcReticulumSendResult> {
    if (frames.length === 0) {
      return {
        ok: false,
        reason: 'wire-too-large',
        error: 'No Reticulum frames fit encrypted wire limit',
      };
    }
    const bridge = this.reticulumBridge;
    if (!bridge) return { ok: false, reason: 'bridge-unavailable' };
    if (bridge.getState() !== 'ready') {
      return { ok: false, reason: 'bridge-not-ready' };
    }
    for (const w of frames) {
      const result: ReticulumSendResult = await bridge.sendGroupCallDetailed(
        destinationHash,
        w
      );
      if (!result.ok) {
        return result;
      }
    }
    return { ok: true };
  }

  private fanoutReticulumWire(
    roomId: string,
    frames: Record<string, unknown>[],
    excludeAddresses?: Set<string>,
    retryKind?: GcReticulumRetryKind,
    attempt = 0
  ): void {
    void roomId;
    void excludeAddresses;
    void this.fanoutReticulumWireAsync(
      roomId,
      [],
      frames,
      excludeAddresses,
      retryKind,
      attempt
    );
  }

  private async fanoutReticulumWireAsync(
    roomId: string,
    targetAddresses: string[],
    frames: Record<string, unknown>[],
    excludeAddresses: Set<string> | undefined,
    retryKind: GcReticulumRetryKind | undefined,
    attempt: number
  ): Promise<void> {
    void roomId;
    void targetAddresses;
    void excludeAddresses;
    const overlayFrames = frames.map((frame) =>
      this.attachReticulumOverlayMeta(frame)
    );
    const firstFailure = await this.broadcastReticulumFramesViaOverlay(
      overlayFrames
    );
    if (
      retryKind &&
      firstFailure &&
      this.isRetryableReticulumFailure(firstFailure) &&
      attempt < GC_RETICULUM_FIRST_CONTACT_RETRY_DELAYS_MS.length
    ) {
      this.scheduleReticulumRetry(
        GC_RETICULUM_FIRST_CONTACT_RETRY_DELAYS_MS[attempt]!,
        () =>
          this.fanoutReticulumWire(
            roomId,
            frames,
            excludeAddresses,
            retryKind,
            attempt + 1
          )
      );
      return;
    }
    if (firstFailure && 'reason' in firstFailure) {
      const failure = firstFailure;
      this.logReticulumFailureThrottled(
        `room:${roomId}:${retryKind ?? 'fanout'}:${failure.reason}:${failure.error ?? ''}`,
        `[GCall] Reticulum ${retryKind ?? 'fanout'} send failed room=${roomId} reason=${failure.reason}${failure.error ? ` error=${failure.error}` : ''}`
      );
    }
  }

  private sendReticulumToAddress(
    address: string,
    frames: Record<string, unknown>[],
    retryKind?: GcReticulumRetryKind,
    attempt = 0
  ): void {
    void this.sendReticulumToAddressAsync(address, frames, retryKind, attempt);
  }

  private async sendReticulumToAddressAsync(
    address: string,
    frames: Record<string, unknown>[],
    retryKind: GcReticulumRetryKind | undefined,
    attempt: number
  ): Promise<void> {
    void address;
    const overlayFrames = frames.map((frame) =>
      this.attachReticulumOverlayMeta(frame)
    );
    const result = await this.broadcastReticulumFramesViaOverlay(overlayFrames);
    if (
      retryKind &&
      this.isRetryableReticulumFailure(result) &&
      attempt < GC_RETICULUM_FIRST_CONTACT_RETRY_DELAYS_MS.length
    ) {
      this.scheduleReticulumRetry(
        GC_RETICULUM_FIRST_CONTACT_RETRY_DELAYS_MS[attempt]!,
        () =>
          this.sendReticulumToAddress(
            address,
            frames,
            retryKind,
            attempt + 1
          )
      );
      return;
    }
    if ('reason' in result) {
      const failure = result;
      const failureError =
        'error' in failure && typeof failure.error === 'string'
          ? failure.error
          : '';
      this.logReticulumFailureThrottled(
        `addr:${address}:${retryKind ?? 'direct'}:${failure.reason}:${failureError}`,
        `[GCall] Reticulum ${retryKind ?? 'direct'} send failed address=${address} reason=${failure.reason}${failureError ? ` error=${failureError}` : ''}`
      );
    }
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
    // Do not prune Reticulum liveness by watch list: hints may arrive before groups load
    // or while watch is briefly []; TTL sweep in flush drops stale entries.
    this.scheduleQortalGroupCallActivityEmit(true);
    this.scheduleNextQortalReticulumExpiry();
    return this.getQortalGroupCallActivitySnapshot();
  }

  private noteSpectatorReticulumLiveness(roomId: string): void {
    if (GroupCallManager.parseQortalGroupNumericId(roomId) === null) return;
    this.spectatorReticulumLivenessAt.set(roomId, Date.now());
    this.scheduleNextQortalReticulumExpiry();
    if (this.watchedQortalGroupNumericIds.size > 0) {
      this.scheduleQortalGroupCallActivityEmit(false);
    }
  }

  private sweepSpectatorReticulumLiveness(now: number): void {
    for (const [roomId, at] of [...this.spectatorReticulumLivenessAt.entries()]) {
      if (now - at > GC_RETICULUM_ACTIVITY_MAX_AGE_MS) {
        this.spectatorReticulumLivenessAt.delete(roomId);
      }
    }
    this.scheduleNextQortalReticulumExpiry();
  }

  private scheduleNextQortalReticulumExpiry(): void {
    if (this.qortalReticulumExpiryTimer) {
      clearTimeout(this.qortalReticulumExpiryTimer);
      this.qortalReticulumExpiryTimer = null;
    }
    if (
      this.watchedQortalGroupNumericIds.size === 0 ||
      this.spectatorReticulumLivenessAt.size === 0
    ) {
      return;
    }
    const now = Date.now();
    let nextExpiryAt = Number.POSITIVE_INFINITY;
    for (const at of this.spectatorReticulumLivenessAt.values()) {
      const expiryAt = at + GC_RETICULUM_ACTIVITY_MAX_AGE_MS;
      if (expiryAt < nextExpiryAt) nextExpiryAt = expiryAt;
    }
    if (!Number.isFinite(nextExpiryAt)) return;
    const delayMs = Math.max(0, nextExpiryAt - now);
    this.qortalReticulumExpiryTimer = setTimeout(() => {
      this.qortalReticulumExpiryTimer = null;
      this.scheduleQortalGroupCallActivityEmit(true);
    }, delayMs);
    this.qortalReticulumExpiryTimer.unref?.();
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
    this.sweepSpectatorReticulumLiveness(now);
    const activeByGroupId: Record<string, boolean> = {};
    for (const id of this.watchedQortalGroupNumericIds) {
      const roomId = `gcall-qortal-${id}`;
      const gid = String(id);
      const local = this.rooms.get(roomId);
      if (local && local.participants.size > 0) {
        activeByGroupId[gid] = true;
        continue;
      }
      const reticulumAt = this.spectatorReticulumLivenessAt.get(roomId);
      if (
        reticulumAt !== undefined &&
        now - reticulumAt <= GC_RETICULUM_ACTIVITY_MAX_AGE_MS
      ) {
        activeByGroupId[gid] = true;
      }
    }
    return activeByGroupId;
  }

  private flushReticulumGroupActivityHeartbeats(roomId?: string): void {
    const bridge = this.reticulumBridge;
    if (!bridge || bridge.getState() !== 'ready') return;
    const roomIds = roomId ? [roomId] : [...this.qortalReticulumTargetsByRoomId.keys()];
    for (const candidateRoomId of roomIds) {
      this.sendReticulumGroupActivityForRoom(candidateRoomId);
    }
  }

  private sendReticulumGroupActivityForRoom(roomId: string): void {
    const bridge = this.reticulumBridge;
    if (!bridge || bridge.getState() !== 'ready') return;
    const groupId = GroupCallManager.parseQortalGroupNumericId(roomId);
    if (groupId === null) return;
    const room = this.rooms.get(roomId);
    if (!room || room.participants.size === 0) return;
    const targets = this.qortalReticulumTargetsByRoomId.get(roomId);
    if (!targets || targets.size === 0) return;
    const wire: GcReticulumActivityWire = {
      t: 'GA',
      g: groupId,
      m: Date.now(),
    };
    const overlayWire = this.attachReticulumOverlayMeta(
      wire as unknown as Record<string, unknown>
    );
    if (!wireFitsReticulum(overlayWire)) {
      loggerWarn(
        `[GCall] Skipping GA activity for room ${roomId}: wire exceeds Reticulum limit`
      );
      return;
    }
    void this.broadcastReticulumFramesViaOverlay([overlayWire]).then(() => {});
  }

  private handleReticulumGroupCallWire(
    wire: Record<string, unknown>,
    senderDestinationHash: string,
    peerPresenceHash: string
  ): void {
    const now = Date.now();
    this.maybeSweepReticulumWireContentHashes(now);

    const overlayMeta = this.parseReticulumOverlayMeta(wire);
    if (overlayMeta) {
      if (this.hasSeenReticulumOverlayId(overlayMeta.overlayId)) {
        if (wire.t === 'GJ') {
          const room =
            typeof wire.R === 'string' ? wire.R : String(wire.R ?? '?');
          this.logGcJoinWireDebugThrottled(
            `gj_overlay_dup:${overlayMeta.overlayId}`,
            `[GCall] Dropped GJ (duplicate overlay X, replay): room=${room} X=${overlayMeta.overlayId.slice(0, 24)}…`
          );
        }
        return;
      }
      let contentHash: string;
      try {
        contentHash = hashReticulumWireForContentDedup(wire);
      } catch {
        contentHash = '';
      }
      if (contentHash !== '' && this.hasSeenReticulumWireContentHash(contentHash)) {
        const t =
          typeof wire.t === 'string' ? wire.t : String(wire.t ?? '?');
        this.logGcJoinWireDebugThrottled(
          `overlay_payload_dup:${contentHash.slice(0, 16)}:${t}`,
          `[GCall] Dropped Reticulum wire (duplicate overlay payload, same as prior X): t=${t} h=${contentHash.slice(0, 16)}…`
        );
        return;
      }
      this.rememberReticulumOverlayId(overlayMeta.overlayId);
      if (contentHash !== '') this.rememberReticulumWireContentHash(contentHash);
      if (overlayMeta.hopsRemaining > 0) {
        const forwarded = {
          ...wire,
          L: overlayMeta.hopsRemaining - 1,
        };
        void this.broadcastReticulumFramesViaOverlay(
          [forwarded],
          peerPresenceHash ? [peerPresenceHash] : []
        ).then(() => {});
      }
    }
    this.sweepExpiredReticulumReassembly(now);

    const t = wire.t;
    if (t === 'GA') {
      const decoded = decodeGcReticulumActivityWire(wire, now);
      if (!decoded) return;
      const roomId = `gcall-qortal-${decoded.groupId}`;
      this.noteSpectatorReticulumLiveness(roomId);
      return;
    }

    if (typeof t !== 'string' || !isGroupCallReticulumWireType(t)) {
      return;
    }

    const syntheticFrom =
      senderDestinationHash.length > 0
        ? `reticulum:${senderDestinationHash}`
        : undefined;

    if (t === 'GJ') {
      const env = decodeJoinWire(wire);
      if (!env) {
        const why = decodeJoinWireFailureReason(wire);
        const room =
          typeof wire.R === 'string' ? wire.R : String(wire.R ?? '?');
        const from =
          typeof wire.a === 'string' ? wire.a : String(wire.a ?? '?');
        this.logGcJoinWireDebugThrottled(
          `gj_decode:${why ?? 'unknown'}:${room}:${from}`,
          `[GCall] Dropped GJ (decodeJoinWire failed): reason=${why ?? 'unknown'} room=${room} from=${from} peerPresenceHash=${peerPresenceHash ? `${peerPresenceHash.slice(0, 16)}…` : 'none'}`
        );
        return;
      }
      this.handleJoin(env as GcJoinEnvelope, syntheticFrom, peerPresenceHash);
      return;
    }
    if (t === 'GI') {
      const decoded = decodeJoinIdentityWire(wire);
      if (!decoded) {
        const why = decodeJoinIdentityWireFailureReason(wire);
        const from =
          typeof wire.a === 'string' ? wire.a : String(wire.a ?? '?');
        this.logGcJoinWireDebugThrottled(
          `gi_decode:${why ?? 'unknown'}:${from}`,
          `[GCall] Dropped GI (decodeJoinIdentityWire failed): reason=${why ?? 'unknown'} from=${from} peerPresenceHash=${peerPresenceHash ? `${peerPresenceHash.slice(0, 16)}…` : 'none'}`
        );
        return;
      }
      const preRej = gcJoinTimestampRejectReason(decoded.timestamp, now);
      if (preRej === 'expired') {
        this.logGcJoinDropThrottled(
          decoded.fromAddress,
          'expired_pre_verify',
          `[GCall] Dropped GC_JOIN_RK: expired from ${decoded.fromAddress} (pre-verify)`
        );
        return;
      }
      if (preRej === 'future') {
        this.logGcJoinDropThrottled(
          decoded.fromAddress,
          'future_timestamp',
          `[GCall] Dropped GC_JOIN_RK: future timestamp from ${decoded.fromAddress} (pre-verify)`
        );
        return;
      }
      this.processJoinIdentityVerify(
        decoded,
        syntheticFrom,
        peerPresenceHash
      );
      return;
    }
    if (t === 'GL') {
      const env = decodeLeaveWire(wire);
      if (!env) return;
      this.handleLeaveEnvelope(env as GcLeaveEnvelope, peerPresenceHash);
      return;
    }
    if (t === 'GH') {
      const env = decodeClusterHeartbeatWire(wire);
      if (!env) return;
      this.handleClusterHeartbeat(
        env as GcClusterHeartbeatEnvelope,
        peerPresenceHash
      );
      return;
    }
    if (t === 'GT') {
      const env = decodeTopologyWireSingle(wire);
      if (!env) return;
      this.handleTopology(env as GcTopologyEnvelope, peerPresenceHash);
      return;
    }
    if (t === 'GT0') {
      const meta = parseGt0(wire);
      if (!meta) return;
      this.reticulumTopoReasm.set(`${meta.roomId}:${meta.z}`, {
        meta,
        parts: new Map(),
        deadline: now + GC_RETICULUM_REASM_TTL_MS,
      });
      return;
    }
    if (t === 'GT1') {
      const pr = parseGt1(wire);
      if (!pr) return;
      const key = `${pr.R}:${pr.z}`;
      const buf = this.reticulumTopoReasm.get(key);
      if (!buf || pr.n !== buf.meta.n) return;
      buf.parts.set(pr.x, pr.p);
      if (buf.parts.size < buf.meta.n) return;
      const env = decodeTopologyFromGt1(buf.meta, buf.parts);
      this.reticulumTopoReasm.delete(key);
      if (!env) return;
      this.handleTopology(env as GcTopologyEnvelope, peerPresenceHash);
      return;
    }

    if (t === 'GR') {
      const env = decodeKeyRotateWireSingle(wire);
      if (!env) return;
      this.handleKeyRotate(env as GcKeyRotateEnvelope, peerPresenceHash);
      return;
    }
    if (t === 'GR0') {
      const meta = parseGr0(wire);
      if (!meta) return;
      this.reticulumGrReasm.set(`${meta.roomId}:${meta.z}`, {
        meta,
        parts: new Map(),
        deadline: now + GC_RETICULUM_REASM_TTL_MS,
      });
      return;
    }
    if (t === 'GR1') {
      const pr = parseGr1(wire);
      if (!pr) return;
      const key = `${pr.R}:${pr.z}`;
      const buf = this.reticulumGrReasm.get(key);
      if (!buf || pr.n !== buf.meta.n) return;
      buf.parts.set(pr.x, pr.p);
      if (buf.parts.size < buf.meta.n) return;
      const env = decodeKeyRotateFromGr1(buf.meta, buf.parts);
      this.reticulumGrReasm.delete(key);
      if (!env) return;
      this.handleKeyRotate(env as GcKeyRotateEnvelope, peerPresenceHash);
      return;
    }

    if (t === 'GK') {
      const env = decodeKeyWireSingle(wire);
      if (!env) return;
      this.handleKey(env as GcKeyEnvelope, peerPresenceHash);
      return;
    }
    if (t === 'GK0') {
      const meta = parseGk0(wire);
      if (!meta) return;
      this.reticulumGkReasm.set(`${meta.roomId}:${meta.z}`, {
        meta,
        parts: new Map(),
        deadline: now + GC_RETICULUM_REASM_TTL_MS,
      });
      return;
    }
    if (t === 'GK1') {
      const pr = parseGk1(wire);
      if (!pr) return;
      const key = `${pr.R}:${pr.z}`;
      const buf = this.reticulumGkReasm.get(key);
      if (!buf || pr.n !== buf.meta.n) return;
      buf.parts.set(pr.x, pr.p);
      if (buf.parts.size < buf.meta.n) return;
      const env = decodeKeyWireFromGk1(buf.meta, buf.parts);
      this.reticulumGkReasm.delete(key);
      if (!env) return;
      this.handleKey(env as GcKeyEnvelope, peerPresenceHash);
      return;
    }

    if (t === 'GQ0') {
      const meta = parseGq0(wire);
      if (!meta) return;
      this.reticulumGqReasm.set(`${meta.roomId}:${meta.z}`, {
        meta,
        parts: new Map(),
        deadline: now + GC_RETICULUM_REASM_TTL_MS,
      });
      return;
    }
    if (t === 'GQ1') {
      const pr = parseGq1(wire);
      if (!pr) return;
      const key = `${pr.R}:${pr.z}`;
      const buf = this.reticulumGqReasm.get(key);
      if (!buf || pr.n !== buf.meta.n) return;
      buf.parts.set(pr.x, pr.p);
      if (buf.parts.size < buf.meta.n) return;
      const env = decodeKeyRequestFromGq1(buf.meta, buf.parts);
      this.reticulumGqReasm.delete(key);
      if (!env) return;
      this.handleKeyRequest(env as GcKeyRequestEnvelope, peerPresenceHash);
      return;
    }

    if (t === 'GQ') {
      const env = decodeKeyRequestWireSingle(wire);
      if (!env) return;
      this.handleKeyRequest(env as GcKeyRequestEnvelope, peerPresenceHash);
      return;
    }

    if (
      t === 'GX' ||
      t === 'GO' ||
      t === 'GE' ||
      t === 'GO0' ||
      t === 'GO1' ||
      t === 'GE0' ||
      t === 'GE1' ||
      t === 'GF'
    ) {
      return;
    }
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
    reticulumDestinationHash: string,
    joinGeneration?: number,
    /** Defensive lower bound after same-room rejoin — not canonical epoch (see mergeRoomTopologyEpochWithFloor). */
    topologyEpochFloor?: number,
    /** RNS.Identity public key (64 bytes standard base64); optional when wire budget tight. */
    reticulumIdentityPublicKeyBase64?: string,
    /** Signature for `GC_JOIN_RK` (second Reticulum frame) when `reticulumIdentityPublicKeyBase64` is set. */
    joinRkSignature?: string
  ): { callSessionId: string; mediaSessionGeneration: number } {
    if (!isRnsDestinationHashHex(reticulumDestinationHash)) {
      throw new Error('Invalid or missing reticulumDestinationHash for GC_JOIN');
    }
    if (
      reticulumIdentityPublicKeyBase64 !== undefined &&
      reticulumIdentityPublicKeyBase64 !== '' &&
      !isRnsIdentityPublicKeyBase64(reticulumIdentityPublicKeyBase64)
    ) {
      throw new Error('Invalid reticulumIdentityPublicKeyBase64 for GC_JOIN');
    }
    const rkPresent =
      Boolean(reticulumIdentityPublicKeyBase64) &&
      isRnsIdentityPublicKeyBase64(reticulumIdentityPublicKeyBase64!);
    if (rkPresent) {
      if (
        typeof joinRkSignature !== 'string' ||
        joinRkSignature.trim() === ''
      ) {
        throw new Error(
          'joinRkSignature required when reticulumIdentityPublicKeyBase64 is set'
        );
      }
    }
    const destNorm = reticulumDestinationHash.trim().toLowerCase();
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
      room.topologyEpoch = mergeRoomTopologyEpochWithFloor(
        room.topologyEpoch,
        topologyEpochFloor
      );
    }
    const rk =
      reticulumIdentityPublicKeyBase64 &&
      isRnsIdentityPublicKeyBase64(reticulumIdentityPublicKeyBase64)
        ? reticulumIdentityPublicKeyBase64
        : undefined;
    room.participants.set(localAddress, {
      publicKey,
      joinedAt: timestamp,
      reticulumDestinationHash: destNorm,
      ...(rk ? { reticulumIdentityPublicKeyBase64: rk } : {}),
    });

    const env: GcJoinEnvelope = {
      type: 'GC_JOIN',
      roomId,
      chatId,
      fromAddress: localAddress,
      fromPublicKey: publicKey,
      signature,
      timestamp,
      reticulumDestinationHash: destNorm,
      ...(rk ? { reticulumIdentityPublicKeyBase64: rk } : {}),
      ...(joinGeneration !== undefined ? { joinGeneration } : {}),
    };
    if (rk) {
      const joinOnly = encodeJoinWire({
        ...env,
        reticulumIdentityPublicKeyBase64: undefined,
      });
      const giWire = encodeJoinIdentityWire({
        fromAddress: localAddress,
        signature: joinRkSignature!,
        timestamp,
        reticulumDestinationHash: destNorm,
        ...(joinGeneration !== undefined ? { joinGeneration } : {}),
        reticulumIdentityPublicKeyBase64: rk,
      });
      const bGj = byteLengthUtf8JsonWithBridgeSender(joinOnly);
      const bGi = byteLengthUtf8JsonWithBridgeSender(giWire);
      if (!wireFitsReticulum(joinOnly) || !wireFitsReticulum(giWire)) {
        loggerWarn(
          `[GCall] Skipping GC_JOIN split (Reticulum) for room ${roomId}: wire exceeds limit (GJ=${bGj} GI=${bGi} bytes > ${RT_RETICULUM_MAX_WIRE_JSON_BYTES})`
        );
      } else {
        this.fanoutReticulumWire(
          roomId,
          [joinOnly, giWire],
          new Set([localAddress]),
          'join'
        );
        loggerLog(
          `[GCall] Sent GC_JOIN+GI (Reticulum) for room ${roomId}`
        );
      }
    } else {
      const joinWire = encodeJoinWire(env);
      if (!wireFitsReticulum(joinWire)) {
        const bytes = byteLengthUtf8JsonWithBridgeSender(joinWire);
        loggerWarn(
          `[GCall] Skipping GC_JOIN (Reticulum) for room ${roomId}: wire exceeds Reticulum limit (${bytes} bytes > ${RT_RETICULUM_MAX_WIRE_JSON_BYTES}; shorten chatId/publicKey/signature or reduce fields)`
        );
      } else {
        this.fanoutReticulumWire(
          roomId,
          [joinWire],
          new Set([localAddress]),
          'join'
        );
        loggerLog(`[GCall] Sent GC_JOIN (Reticulum) for room ${roomId}`);
      }
    }
    this.flushPendingKeyForRoom(roomId);
    this.scheduleQortalGroupCallActivityEmit(true);
    this.flushReticulumGroupActivityHeartbeats(roomId);
    this.syncReticulumAudioLinks();
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
      };
      if (room) {
        const leaveWire = encodeLeaveWire(env);
        if (!wireFitsReticulum(leaveWire)) {
          loggerWarn(
            `[GCall] Skipping GC_LEAVE (Reticulum) for room ${roomId}: wire exceeds Reticulum limit`
          );
        } else {
          this.fanoutReticulumWire(
            roomId,
            [leaveWire],
            new Set([localAddress])
          );
        }
      }
    } else {
      loggerWarn(
        `[GCall] Missing GC_LEAVE signature for ${localAddress} in ${roomId} — clearing local room only`
      );
      this.participantNodeIds.delete(localAddress);
      this.reticulumPeerPresenceHashByAddress.delete(localAddress);
    }
    if (room) this.rememberRecentRoomState(room, timestamp);
    this.pendingKeyByRoom.delete(roomId);
    this.clearRetainedVerifiedKeyStatesForRoom(roomId);
    this.rooms.delete(roomId);
    this.qortalReticulumTargetsByRoomId.delete(roomId);
    this.transportHealthByRoom.delete(roomId);
    this.syncReticulumAudioLinks();
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
      | 'type'
      | 'roomId'
      | 'hopsRemaining'
      | 'fromPublicKey'
      | 'signature'
      | 'timestamp'
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
    };
    const room = this.rooms.get(roomId);
    if (room) {
      const previousRoot = room.lastTopology?.rootForwarder ?? '';
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
      if (
        previousRoot &&
        topology.rootForwarder &&
        previousRoot !== topology.rootForwarder
      ) {
        this.clearRetainedVerifiedKeyStatesForRoom(roomId);
      }
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
    const frames = encodeTopologyWire(env);
    if (frames.length === 0) {
      loggerWarn(
        `[GCall] Skipping GC_TOPOLOGY (Reticulum) for room ${roomId} epoch ${topology.topologyEpoch}: unable to encode within Reticulum wire limit`
      );
      return;
    }
    this.fanoutReticulumWire(
      roomId,
      frames,
      new Set([topology.fromAddress]),
      'topology'
    );
    loggerLog(
      `[GCall] Queued GC_TOPOLOGY (Reticulum) for room ${roomId} epoch ${topology.topologyEpoch}`
    );
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
    };
    const ghWire = encodeClusterHeartbeatWire(env);
    if (!wireFitsReticulum(ghWire)) {
      loggerWarn(
        `[GCall] Skipping GC_CLUSTER_HEARTBEAT (Reticulum) for room ${roomId}: wire exceeds Reticulum limit`
      );
      return;
    }
    this.fanoutReticulumWire(
      roomId,
      [ghWire],
      new Set([payload.fromAddress])
    );
  }

  /**
   * Send encrypted group audio over a persistent Reticulum link.
   */
  private computeReticulumAudioTargetsForRoom(room: GroupRoom): Set<string> {
    const targets = new Set<string>();
    const topology = room.lastTopology;
    if (!topology) {
      for (const peer of room.participants.keys()) {
        if (!peer || this.localAddresses.has(peer)) continue;
        targets.add(peer);
      }
      for (const address of [...targets]) {
        if (!address || this.localAddresses.has(address)) {
          targets.delete(address);
        }
      }
      return targets;
    }

    for (const localAddress of this.localAddresses) {
      if (!room.participants.has(localAddress)) continue;

      if (localAddress === topology.rootForwarder) {
        for (const cluster of topology.clusters) {
          if (cluster.forwarder === localAddress) {
            for (const member of cluster.members) {
              if (member && member !== localAddress) targets.add(member);
            }
          } else if (cluster.forwarder) {
            targets.add(cluster.forwarder);
          }
        }
        continue;
      }

      let assignedForwarder = topology.rootForwarder;
      for (const cluster of topology.clusters) {
        if (cluster.forwarder === localAddress) {
          if (topology.rootForwarder && topology.rootForwarder !== localAddress) {
            targets.add(topology.rootForwarder);
          }
          for (const member of cluster.members) {
            if (member && member !== localAddress) targets.add(member);
          }
          assignedForwarder = '';
          break;
        }
        if (cluster.members.includes(localAddress)) {
          assignedForwarder = cluster.forwarder || topology.rootForwarder;
          break;
        }
      }
      if (assignedForwarder && assignedForwarder !== localAddress) {
        targets.add(assignedForwarder);
      }
    }

    for (const peer of room.participants.keys()) {
      if (!peer || this.localAddresses.has(peer)) continue;
      targets.add(peer);
    }

    for (const address of [...targets]) {
      if (!address || this.localAddresses.has(address)) {
        targets.delete(address);
      }
    }
    return targets;
  }

  private normalizePeerPresenceHashForAudio(ph: string): string {
    return ph.trim().toLowerCase();
  }

  /**
   * Inbound Reticulum payloads may carry the wire sender hash (transport) while
   * `resolveReticulumPeerPresenceHash` prefers the verified join identity hash.
   * Match either against participant, presence route, or the address cache.
   */
  private addressMatchesWirePeerPresenceHash(
    wantNormalized: string,
    address: string
  ): boolean {
    const w = wantNormalized.trim().toLowerCase();
    if (!w || !address) return false;
    for (const room of this.rooms.values()) {
      const p = room.participants.get(address);
      const d = p?.reticulumDestinationHash?.trim().toLowerCase();
      if (d && d === w) return true;
    }
    const route = this.presence.getRouteForAddress(address);
    if (route?.kind === 'reticulum') {
      const rh = route.destinationHash.trim().toLowerCase();
      if (rh === w) return true;
    }
    const cached = this.reticulumPeerPresenceHashByAddress
      .get(address)
      ?.trim()
      .toLowerCase();
    if (cached && cached === w) return true;
    return false;
  }

  /**
   * Map Reticulum route / presence hash to participant address.
   * Falls back to scanning `room.participants` when audio peer state was
   * evicted (e.g. sync before topology applied) so inbound packets still
   * resolve and `gcall:audio` carries `fromAddress` for decode.
   * When `roomId` is omitted, scans every joined room for a matching participant.
   */
  private resolveReticulumAudioAddress(
    routeKey: string,
    peerPresenceHash: string,
    roomId?: string
  ): string | null {
    const rk = routeKey?.trim();
    if (rk) {
      const byLinkId = this.reticulumAudioAddressByLinkId.get(rk);
      if (byLinkId) return byLinkId;
    }
    const want = this.normalizePeerPresenceHashForAudio(peerPresenceHash);
    if (!want) return null;
    for (const [address, state] of this.reticulumAudioPeersByAddress) {
      if (
        this.normalizePeerPresenceHashForAudio(state.peerPresenceHash) === want ||
        this.addressMatchesWirePeerPresenceHash(want, address)
      ) {
        return address;
      }
    }
    const matchParticipantsInRoom = (room: GroupRoom | undefined): string | null => {
      if (!room) return null;
      for (const addr of room.participants.keys()) {
        if (this.addressMatchesWirePeerPresenceHash(want, addr)) {
          return addr;
        }
      }
      return null;
    };
    if (roomId) {
      const hit = matchParticipantsInRoom(this.rooms.get(roomId));
      if (hit) return hit;
    } else {
      for (const r of this.rooms.values()) {
        const hit = matchParticipantsInRoom(r);
        if (hit) return hit;
      }
    }
    return null;
  }

  private findRoomIdContainingParticipant(address: string): string | null {
    for (const [rid, room] of this.rooms) {
      if (room.participants.has(address)) return rid;
    }
    return null;
  }

  private getReticulumAudioTransportKind(): ReticulumMediaTransportKind {
    return GC_RETICULUM_PACKET_MEDIA_ENABLED ? 'packet' : 'link';
  }

  private getEffectiveReticulumAudioTransport(
    state?: Pick<ReticulumAudioPeerState, 'packetTransportFallback'> | null
  ): ReticulumMediaTransportKind {
    const baseTransport = this.getReticulumAudioTransportKind();
    if (baseTransport !== 'packet') return baseTransport;
    return state?.packetTransportFallback ? 'link' : 'packet';
  }

  private setReticulumAudioTransport(
    address: string,
    state: ReticulumAudioPeerState,
    transport: ReticulumMediaTransportKind,
    reason?: string
  ): void {
    state.transport = transport;
    if (reason) state.recoveryReason = reason;
    this.setReticulumAudioRouteKey(
      address,
      state,
      this.computeReticulumAudioRouteKey(
        transport,
        state.peerPresenceHash,
        state.linkId
      )
    );
  }

  private activateReticulumAudioLinkFallback(
    address: string,
    state: ReticulumAudioPeerState,
    reason: string
  ): void {
    if (this.getReticulumAudioTransportKind() !== 'packet') return;
    if (state.packetTransportFallback && state.transport === 'link') return;
    state.packetTransportFallback = true;
    this.setReticulumAudioTransport(address, state, 'link', reason);
    if (this.shouldMaintainReticulumAudioLink(state)) {
      void this.openReticulumAudioLinkForAddress(address);
    }
    this.scheduleReticulumAudioFlush();
  }

  private shouldFallbackPacketTransport(
    snapshot: ReticulumAudioQueueSnapshot | null | undefined
  ): boolean {
    if (!snapshot) return false;
    return (
      snapshot.packetPathResolutions === 0 &&
      snapshot.packetPathTimeouts >= GC_RETICULUM_PACKET_LINK_FALLBACK_TIMEOUTS
    );
  }

  private shouldMaintainReticulumAudioLink(
    state: Pick<ReticulumAudioPeerState, 'transport'> | null | undefined
  ): boolean {
    return (
      (state?.transport ?? this.getReticulumAudioTransportKind()) === 'link' ||
      GC_RETICULUM_PACKET_MEDIA_KEEP_AUDIO_LINKS
    );
  }

  private computeReticulumAudioRouteKey(
    transport: ReticulumMediaTransportKind,
    peerPresenceHash: string,
    linkId?: string | null
  ): string {
    if (transport === 'packet') {
      return `packet:${peerPresenceHash}`;
    }
    return linkId ?? `link:${peerPresenceHash}`;
  }

  private setReticulumAudioRouteKey(
    address: string,
    state: ReticulumAudioPeerState,
    nextRouteKey: string
  ): void {
    if (state.routeKey) {
      const existing = this.reticulumAudioAddressByLinkId.get(state.routeKey);
      if (existing === address) {
        this.reticulumAudioAddressByLinkId.delete(state.routeKey);
      }
    }
    state.routeKey = nextRouteKey;
    this.reticulumAudioAddressByLinkId.set(nextRouteKey, address);
  }

  private getReticulumAudioPendingMaxAgeMs(state: ReticulumAudioPeerState): number {
    if (state.recoveryHoldUntilMs > Date.now()) {
      return Math.min(
        GC_RETICULUM_AUDIO_PENDING_MAX_AGE_MS,
        GC_RETICULUM_AUDIO_RECOVERY_BUFFER_MAX_AGE_MS
      );
    }
    return GC_RETICULUM_AUDIO_PENDING_MAX_AGE_MS;
  }

  private requestReticulumPacketPathWarmup(
    address: string,
    state: ReticulumAudioPeerState,
    reason: string,
    opts?: {
      force?: boolean;
      holdAudio?: boolean;
      cooldownMs?: number;
    }
  ): void {
    const bridge = this.reticulumBridge;
    if (!bridge || state.transport !== 'packet') return;
    const now = Date.now();
    const cooldownMs =
      opts?.cooldownMs ?? GC_RETICULUM_AUDIO_RECOVERY_ACTION_COOLDOWN_MS;
    if (opts?.holdAudio) {
      state.recoveryHoldUntilMs = Math.max(
        state.recoveryHoldUntilMs,
        now + GC_RETICULUM_AUDIO_RECOVERY_HOLD_MS
      );
    }
    state.recoveryReason = reason;
    if (!opts?.force && now - state.lastPathWarmAtMs < cooldownMs) {
      const holdDelayMs =
        state.recoveryHoldUntilMs > now ? state.recoveryHoldUntilMs - now : 0;
      if (holdDelayMs > 0) {
        this.scheduleReticulumAudioFlush(holdDelayMs);
      }
      return;
    }
    state.lastPathWarmAtMs = now;
    state.lastRecoveryActionAtMs = now;
    void bridge
      .warmGroupAudioPath(state.peerPresenceHash)
      .then((result) => {
        if (!('reason' in result)) return;
        const failureReason = result.reason;
        this.logReticulumFailureThrottled(
          `packet-path-warm:${address}:${reason}:${failureReason}`,
          `[GCall] Reticulum packet path warm failed address=${address} reason=${reason} error=${failureReason}${result.error ? ` detail=${result.error}` : ''}`
        );
      })
      .catch((error) => {
        this.logReticulumFailureThrottled(
          `packet-path-warm:${address}:${reason}:exception`,
          `[GCall] Reticulum packet path warm exception address=${address} reason=${reason} error=${error instanceof Error ? error.message : String(error)}`
        );
      })
      .finally(() => {
        const latest = this.reticulumAudioPeersByAddress.get(address);
        if (!latest) return;
        const delayMs =
          latest.recoveryHoldUntilMs > Date.now()
            ? latest.recoveryHoldUntilMs - Date.now()
            : 0;
        this.scheduleReticulumAudioFlush(delayMs);
      });
  }

  private requestReticulumAudioRecovery(
    roomId: string,
    address: string,
    reason: string,
    opts?: {
      force?: boolean;
      holdAudio?: boolean;
      cooldownMs?: number;
    }
  ): void {
    const room = this.rooms.get(roomId);
    if (!room || !room.participants.has(address)) return;
    const state = this.ensureReticulumAudioPeerState(roomId, address);
    if (!state) return;
    if (state.transport === 'packet') {
      this.requestReticulumPacketPathWarmup(address, state, reason, {
        force: opts?.force,
        holdAudio: opts?.holdAudio ?? true,
        cooldownMs: opts?.cooldownMs,
      });
      if (this.shouldMaintainReticulumAudioLink(state)) {
        void this.openReticulumAudioLinkForAddress(address);
      }
      return;
    }
    if (state.linkId) {
      this.markReticulumAudioLinkUnready(address, state.linkId);
    }
    void this.openReticulumAudioLinkForAddress(address);
  }

  private async openReticulumAudioLinkForAddress(address: string): Promise<void> {
    const bridge = this.reticulumBridge;
    const state = this.reticulumAudioPeersByAddress.get(address);
    if (
      !bridge ||
      !state ||
      state.opening ||
      state.established ||
      !this.shouldMaintainReticulumAudioLink(state)
    ) {
      return;
    }
    state.opening = true;
    const result: ReticulumOpenAudioLinkResult = await bridge.openGroupAudioLink(
      state.peerPresenceHash
    );
    const latest = this.reticulumAudioPeersByAddress.get(address);
    if (!latest) return;
    latest.opening = false;
    if (result.ok) {
      latest.linkId = result.linkId;
      this.reticulumAudioAddressByLinkId.set(result.linkId, address);
      if (latest.transport === 'link') {
        this.setReticulumAudioRouteKey(address, latest, result.linkId);
      }
      if (result.established) {
        latest.established = true;
        this.scheduleReticulumAudioFlush();
      }
      return;
    }
    const failure = result as {
      ok: false;
      reason: ReticulumSendFailureReason;
      error?: string;
    };
    this.logReticulumFailureThrottled(
      `audio-open:${address}:${failure.reason}:${failure.error ?? ''}`,
      `[GCall] Reticulum audio link open failed address=${address} reason=${failure.reason}${failure.error ? ` error=${failure.error}` : ''}`
    );
  }

  private markReticulumAudioLinkUnready(address: string, linkId?: string): void {
    const state = this.reticulumAudioPeersByAddress.get(address);
    if (!state) return;
    if (linkId) {
      this.reticulumAudioAddressByLinkId.delete(linkId);
      if (state.linkId === linkId) state.linkId = null;
    } else if (state.linkId) {
      this.reticulumAudioAddressByLinkId.delete(state.linkId);
      state.linkId = null;
    }
    state.established = false;
    state.opening = false;
    if (state.transport === 'link') {
      this.setReticulumAudioRouteKey(
        address,
        state,
        this.computeReticulumAudioRouteKey(state.transport, state.peerPresenceHash)
      );
    }
  }

  private ensureReticulumAudioPeerState(
    roomId: string,
    address: string
  ): ReticulumAudioPeerState | null {
    const peerPresenceHash = this.resolveReticulumPeerPresenceHash(address);
    if (!peerPresenceHash) {
      return null;
    }
    let state = this.reticulumAudioPeersByAddress.get(address);
    const transport = this.getEffectiveReticulumAudioTransport(state);
    if (state && state.peerPresenceHash !== peerPresenceHash) {
      this.markReticulumAudioLinkUnready(address, state.linkId ?? undefined);
      this.reticulumAudioAddressByLinkId.delete(state.routeKey);
      this.reticulumAudioPeersByAddress.delete(address);
      state = undefined;
    }
    if (!state) {
      state = {
        address,
        peerPresenceHash,
        peerDestinationHash: '',
        transport,
        packetTransportFallback: false,
        routeKey: this.computeReticulumAudioRouteKey(transport, peerPresenceHash),
        linkId: null,
        established: false,
        opening: false,
        rooms: new Set<string>(),
        pending: [],
        lastInboundAtMs: 0,
        lastPathWarmAtMs: 0,
        lastRecoveryActionAtMs: 0,
        recoveryHoldUntilMs: 0,
        recoveryReason: '',
      };
      this.reticulumAudioPeersByAddress.set(address, state);
      this.reticulumAudioAddressByLinkId.set(state.routeKey, address);
    } else {
      state.peerPresenceHash = peerPresenceHash;
      this.setReticulumAudioTransport(address, state, transport);
    }
    state.rooms.add(roomId);
    if (this.shouldMaintainReticulumAudioLink(state)) {
      void this.openReticulumAudioLinkForAddress(address);
    }
    if (state.transport === 'packet') {
      this.requestReticulumPacketPathWarmup(address, state, 'peer-active', {
        holdAudio: false,
        cooldownMs: GC_RETICULUM_AUDIO_RECOVERY_ACTION_COOLDOWN_MS,
      });
    }
    return state;
  }

  private getReticulumAudioPendingTotalFrames(): number {
    let total = 0;
    for (const state of this.reticulumAudioPeersByAddress.values()) {
      total += state.pending.length;
    }
    return total;
  }

  private computeReticulumAudioPendingLimit(state: ReticulumAudioPeerState): number {
    let maxTargetsForRooms = 1;
    for (const roomId of state.rooms) {
      const room = this.rooms.get(roomId);
      if (!room) continue;
      maxTargetsForRooms = Math.max(
        maxTargetsForRooms,
        this.computeReticulumAudioTargetsForRoom(room).size
      );
    }
    if (maxTargetsForRooms >= GC_RETICULUM_AUDIO_PENDING_FANOUT_SOFT_LIMIT) {
      return GC_RETICULUM_AUDIO_PENDING_HIGH_FANOUT_LIMIT;
    }
    return GC_RETICULUM_AUDIO_PENDING_MAX_FRAMES;
  }

  private computeReticulumAudioPendingTotalLimit(): number {
    return Math.min(
      GC_RETICULUM_AUDIO_PENDING_MAX_FRAMES,
      Math.max(
        GC_RETICULUM_AUDIO_PENDING_MIN_TOTAL_FRAMES,
        this.reticulumAudioPeersByAddress.size *
          GC_RETICULUM_AUDIO_PENDING_FRAMES_PER_ACTIVE_PEER
      )
    );
  }

  private dropOldestPendingReticulumAudioFromLargestQueue(
    excludeAddress?: string
  ): boolean {
    let chosenAddress = '';
    let largestDepth = 0;
    for (const [address, state] of this.reticulumAudioPeersByAddress) {
      if (address === excludeAddress) continue;
      if (state.pending.length > largestDepth) {
        largestDepth = state.pending.length;
        chosenAddress = address;
      }
    }
    if (!chosenAddress) return false;
    const queue = this.reticulumAudioPeersByAddress.get(chosenAddress)?.pending;
    if (!queue || queue.length === 0) return false;
    queue.shift();
    return true;
  }

  private hasPendingReticulumAudio(): boolean {
    for (const state of this.reticulumAudioPeersByAddress.values()) {
      if (state.pending.length > 0) return true;
    }
    return false;
  }

  private isReticulumAudioBridgePressured(
    snapshot: ReticulumAudioQueueSnapshot | null | undefined
  ): boolean {
    if (!snapshot) return false;
    return (
      snapshot.bridgeWaitingForDrain ||
      snapshot.bridgeQueuedFrames >= GC_RETICULUM_AUDIO_PRESSURE_BRIDGE_QUEUE_FRAMES ||
      snapshot.decodedQueueDepth >= GC_RETICULUM_AUDIO_PRESSURE_DECODED_QUEUE_DEPTH ||
      snapshot.queuePressureDropsLast5s >= GC_RETICULUM_AUDIO_PRESSURE_RECENT_DROPS
    );
  }

  private scheduleReticulumAudioFlush(delayMs = 0): void {
    const normalizedDelayMs = Math.max(0, Math.ceil(delayMs));
    if (this.reticulumAudioFlushScheduled) {
      if (
        normalizedDelayMs > 0 &&
        this.reticulumAudioFlushTimer &&
        this.reticulumAudioFlushTimer.refresh
      ) {
        return;
      }
      if (normalizedDelayMs === 0 && this.reticulumAudioFlushTimer) {
        clearTimeout(this.reticulumAudioFlushTimer);
        this.reticulumAudioFlushTimer = null;
      } else {
        return;
      }
    }
    this.reticulumAudioFlushScheduled = true;
    const run = () => {
      this.reticulumAudioFlushScheduled = false;
      this.reticulumAudioFlushTimer = null;
      const flushed = this.flushReticulumAudioQueuesFair();
      if (!this.hasPendingReticulumAudio()) return;
      this.scheduleReticulumAudioFlush(
        Math.max(
          flushed?.nextDelayMs ?? 0,
          flushed?.bridgePressured ? GC_RETICULUM_AUDIO_FLUSH_RETRY_DELAY_MS : 0
        )
      );
    };
    if (normalizedDelayMs > 0) {
      this.reticulumAudioFlushTimer = setTimeout(run, normalizedDelayMs);
      this.reticulumAudioFlushTimer.unref?.();
      return;
    }
    setImmediate(run);
  }

  private enqueuePendingReticulumAudio(
    state: ReticulumAudioPeerState,
    roomId: string,
    data: Buffer
  ): { queuePressureDrops: number; staleDrops: number } {
    const now = Date.now();
    let staleDrops = 0;
    const maxAgeMs = this.getReticulumAudioPendingMaxAgeMs(state);
    while (
      state.pending.length > 0 &&
      now - state.pending[0]!.enqueuedAtMs > maxAgeMs
    ) {
      state.pending.shift();
      staleDrops++;
    }
    state.pending.push({ roomId, data: Buffer.from(data), enqueuedAtMs: now });
    let queuePressureDrops = 0;
    const perPeerLimit = this.computeReticulumAudioPendingLimit(state);
    while (state.pending.length > perPeerLimit) {
      state.pending.shift();
      queuePressureDrops++;
    }
    const totalLimit = this.computeReticulumAudioPendingTotalLimit();
    while (this.getReticulumAudioPendingTotalFrames() > totalLimit) {
      if (!this.dropOldestPendingReticulumAudioFromLargestQueue(state.address)) {
        if (state.pending.length === 0) break;
        state.pending.shift();
      }
      queuePressureDrops++;
    }
    return { queuePressureDrops, staleDrops };
  }

  private buildReticulumAudioSendDiagnostics(
    state: ReticulumAudioPeerState | null | undefined,
    address?: string,
    deltas?: Partial<Omit<GcReticulumAudioSendDiagnostics, 'pendingFrames' | 'bridge'>>
  ): GcReticulumAudioSendDiagnostics {
    return {
      transport: state?.transport ?? this.getReticulumAudioTransportKind(),
      pendingFrames: state?.pending.length ?? 0,
      queuePressureDrops: deltas?.queuePressureDrops ?? 0,
      staleDrops: deltas?.staleDrops ?? 0,
      linkUnreadyDrops: deltas?.linkUnreadyDrops ?? 0,
      packetSendFailures: deltas?.packetSendFailures ?? 0,
      ...(address ? { targetAddress: address } : {}),
      ...(state?.peerPresenceHash ? { peerPresenceHash: state.peerPresenceHash } : {}),
      ...(state?.routeKey ? { routeKey: state.routeKey } : {}),
      ...(state?.lastInboundAtMs ? { lastInboundAtMs: state.lastInboundAtMs } : {}),
      ...(state?.recoveryReason ? { recoveryReason: state.recoveryReason } : {}),
      ...(state && state.recoveryHoldUntilMs > 0
        ? { recoveryHoldUntilMs: state.recoveryHoldUntilMs }
        : {}),
      bridge:
        state && this.reticulumBridge
          ? this.reticulumBridge.getAudioQueueSnapshot(state.routeKey)
          : undefined,
    };
  }

  private flushPendingReticulumAudioForAddress(
    address: string,
    opts?: { maxFrames?: number; stopOnPressure?: boolean }
  ): GcReticulumAudioFlushResult | null {
    const bridge = this.reticulumBridge;
    const state = this.reticulumAudioPeersByAddress.get(address);
    if (
      !bridge ||
      !state ||
      (state.transport === 'link' && (!state.established || !state.linkId))
    ) {
      return null;
    }
    let queuePressureDrops = 0;
    let staleDrops = 0;
    let linkUnreadyDrops = 0;
    let packetSendFailures = 0;
    let framesEnqueued = 0;
    let bridgePressured = false;
    let nextDelayMs = 0;
    const maxFrames = opts?.maxFrames ?? Number.POSITIVE_INFINITY;
    const now = Date.now();
    const maxAgeMs = this.getReticulumAudioPendingMaxAgeMs(state);
    while (
      state.pending.length > 0 &&
      now - state.pending[0]!.enqueuedAtMs > maxAgeMs
    ) {
      state.pending.shift();
      staleDrops++;
    }
    if (state.recoveryHoldUntilMs > now) {
      nextDelayMs = Math.max(1, state.recoveryHoldUntilMs - now);
      return {
        diagnostics: this.buildReticulumAudioSendDiagnostics(state, address, {
          queuePressureDrops,
          staleDrops,
          linkUnreadyDrops,
          packetSendFailures,
        }),
        framesEnqueued,
        bridgePressured,
        nextDelayMs,
      };
    }
    while (
      state.pending.length > 0 &&
      (state.transport === 'packet' || (state.established && state.linkId)) &&
      framesEnqueued < maxFrames
    ) {
      const head = state.pending[0];
      if (
        head &&
        Date.now() - head.enqueuedAtMs > maxAgeMs
      ) {
        state.pending.shift();
        staleDrops++;
        continue;
      }
      const next = state.pending.shift()!;
      const result: ReticulumEnqueueGroupAudioResult =
        state.transport === 'packet'
          ? bridge.enqueuePacketGroupAudio(
              state.peerPresenceHash,
              next.roomId,
              next.data,
              state.peerDestinationHash
            )
          : bridge.enqueueGroupAudio(state.linkId!, next.roomId, next.data);
      if (result.ok) {
        queuePressureDrops += result.queuePressureDrops;
        staleDrops += result.staleDrops;
        framesEnqueued++;
        packetSendFailures = Math.max(
          packetSendFailures,
          result.snapshot.packetSendFailures
        );
        if (
          state.transport === 'packet' &&
          this.shouldFallbackPacketTransport(result.snapshot)
        ) {
          this.activateReticulumAudioLinkFallback(
            address,
            state,
            'packet-fallback:path-unresolved'
          );
        }
        bridgePressured =
          bridgePressured ||
          (opts?.stopOnPressure === true &&
            this.isReticulumAudioBridgePressured(result.snapshot));
        if (bridgePressured) break;
        continue;
      }
      state.pending.unshift(next);
      if (result.ok === false) {
        this.logReticulumFailureThrottled(
          `target-reticulum-audio-ipc-enqueue:${address}:${result.reason}`,
          `[GCall] target=reticulum-audio-ipc enqueueGroupAudio failed address=${address} reason=${result.reason}`
        );
      }
      if (
        result.ok === false &&
        (result.reason === 'bridge-not-ready' ||
          result.reason === 'audio-link-not-ready')
      ) {
        linkUnreadyDrops++;
        if (state.transport === 'link') {
          this.markReticulumAudioLinkUnready(address, state.linkId ?? undefined);
          void this.openReticulumAudioLinkForAddress(address);
        }
      }
      return {
        diagnostics: this.buildReticulumAudioSendDiagnostics(state, address, {
          queuePressureDrops,
          staleDrops,
          linkUnreadyDrops,
          packetSendFailures,
        }),
        framesEnqueued,
        bridgePressured,
        nextDelayMs,
      };
    }
    return {
      diagnostics: this.buildReticulumAudioSendDiagnostics(state, address, {
        queuePressureDrops,
        staleDrops,
        linkUnreadyDrops,
        packetSendFailures,
      }),
      framesEnqueued,
      bridgePressured,
      nextDelayMs,
    };
  }

  private flushReticulumAudioQueuesFair(
    preferredAddress?: string
  ): GcReticulumAudioFlushResult | null {
    const bridge = this.reticulumBridge;
    if (!bridge) return null;
    const addresses = [...this.reticulumAudioPeersByAddress.entries()]
      .filter(
        ([, state]) =>
          state.pending.length > 0 &&
          (state.transport === 'packet' || (state.established && !!state.linkId))
      )
      .map(([address]) => address);
    if (addresses.length === 0) return null;
    if (preferredAddress) {
      const idx = addresses.indexOf(preferredAddress);
      if (idx > 0) {
        addresses.splice(idx, 1);
        addresses.unshift(preferredAddress);
      }
    }
    const startIndex = preferredAddress
      ? 0
      : this.reticulumAudioFlushCursor % Math.max(1, addresses.length);
    let totalFramesEnqueued = 0;
    let bridgePressured = false;
    let nextDelayMs = 0;
    let diagnostics = this.buildReticulumAudioSendDiagnostics(undefined);
    for (
      let offset = 0;
      offset < addresses.length &&
      totalFramesEnqueued < GC_RETICULUM_AUDIO_FLUSH_MAX_FRAMES_PER_PASS;
      offset++
    ) {
      const address = addresses[(startIndex + offset) % addresses.length]!;
      const flushed = this.flushPendingReticulumAudioForAddress(address, {
        maxFrames: GC_RETICULUM_AUDIO_FLUSH_MAX_FRAMES_PER_PEER,
        stopOnPressure: true,
      });
      if (!flushed) continue;
      totalFramesEnqueued += flushed.framesEnqueued;
      bridgePressured = bridgePressured || flushed.bridgePressured;
      nextDelayMs = Math.max(nextDelayMs, flushed.nextDelayMs ?? 0);
      diagnostics = {
        transport: flushed.diagnostics.transport ?? diagnostics.transport,
        pendingFrames: Math.max(
          diagnostics.pendingFrames,
          flushed.diagnostics.pendingFrames
        ),
        queuePressureDrops:
          diagnostics.queuePressureDrops + flushed.diagnostics.queuePressureDrops,
        staleDrops: diagnostics.staleDrops + flushed.diagnostics.staleDrops,
        linkUnreadyDrops:
          diagnostics.linkUnreadyDrops + flushed.diagnostics.linkUnreadyDrops,
        packetSendFailures:
          diagnostics.packetSendFailures + flushed.diagnostics.packetSendFailures,
        bridge: flushed.diagnostics.bridge ?? diagnostics.bridge,
      };
      if (bridgePressured) break;
    }
    this.reticulumAudioFlushCursor =
      (startIndex + 1) % Math.max(1, addresses.length);
    return {
      diagnostics,
      framesEnqueued: totalFramesEnqueued,
      bridgePressured,
      nextDelayMs,
    };
  }

  private handleReticulumGroupAudioSendFailed(payload: {
    linkId: string;
    peerPresenceHash?: string;
    transport?: 'link' | 'packet';
    reason: string;
    code: string;
    error: string;
    pathState?: string;
  }): void {
    const address = this.resolveReticulumAudioAddress(
      payload.linkId,
      payload.peerPresenceHash ?? ''
    );
    if (!address) return;
    const code = payload.code;
    if (
      (payload.transport ?? 'link') === 'link' &&
      (code === 'unknown_link_id' ||
        code === 'audio_link_not_ready' ||
        code === 'packet_send_false' ||
        code === 'audio_payload_too_large' ||
        code === 'exception')
    ) {
      const state = this.reticulumAudioPeersByAddress.get(address);
      if (state?.linkId === payload.linkId) {
        this.markReticulumAudioLinkUnready(address, payload.linkId);
        void this.openReticulumAudioLinkForAddress(address);
      }
    }
    if ((payload.transport ?? 'link') === 'packet') {
      const state = this.reticulumAudioPeersByAddress.get(address);
      if (state) {
        this.requestReticulumPacketPathWarmup(address, state, payload.code || payload.reason, {
          force:
            code === 'path_request_timeout' ||
            code === 'packet_send_false' ||
            code === 'exception',
          holdAudio: true,
        });
        if (
          code === 'path_request_timeout' ||
          code === 'packet_send_false' ||
          code === 'exception'
        ) {
          this.activateReticulumAudioLinkFallback(
            address,
            state,
            `packet-fallback:${code || payload.reason}`
          );
        }
      }
    }
    this.logReticulumFailureThrottled(
      `audio-send-failed:${address ?? payload.linkId}:${payload.code}:${payload.error}:${payload.pathState ?? ''}`,
      `[GCall] Reticulum audio send failed transport=${payload.transport ?? 'link'} target=${payload.linkId ? payload.linkId.slice(0, 8) : (payload.peerPresenceHash ?? '').slice(0, 16)} code=${payload.code} reason=${payload.reason}${payload.pathState ? ` pathState=${payload.pathState}` : ''}${payload.error ? ` error=${payload.error}` : ''}`
    );
  }

  private syncReticulumAudioLinks(): void {
    const desiredByAddress = new Map<
      string,
      { peerPresenceHash: string; rooms: Set<string> }
    >();
    for (const room of this.rooms.values()) {
      for (const address of this.computeReticulumAudioTargetsForRoom(room)) {
        const peerPresenceHash = this.resolveReticulumPeerPresenceHash(address);
        if (!peerPresenceHash) continue;
        const existing = desiredByAddress.get(address);
        if (existing) {
          existing.rooms.add(room.roomId);
          continue;
        }
        desiredByAddress.set(address, {
          peerPresenceHash,
          rooms: new Set([room.roomId]),
        });
      }
    }

    for (const [address, state] of [...this.reticulumAudioPeersByAddress]) {
      const desired = desiredByAddress.get(address);
      if (!desired) {
        const linkId = state.linkId;
        this.reticulumAudioAddressByLinkId.delete(state.routeKey);
        this.reticulumAudioPeersByAddress.delete(address);
        if (linkId) {
          this.reticulumAudioAddressByLinkId.delete(linkId);
          void this.reticulumBridge?.closeGroupAudioLink(linkId).catch(() => {});
        }
        continue;
      }
      state.peerPresenceHash = desired.peerPresenceHash;
      if (this.getReticulumAudioTransportKind() !== 'packet') {
        state.packetTransportFallback = false;
      }
      state.rooms = desired.rooms;
      this.setReticulumAudioTransport(
        address,
        state,
        this.getEffectiveReticulumAudioTransport(state)
      );
      if (this.shouldMaintainReticulumAudioLink(state)) {
        void this.openReticulumAudioLinkForAddress(address);
      } else if (state.linkId) {
        const linkId = state.linkId;
        this.markReticulumAudioLinkUnready(address, linkId);
        void this.reticulumBridge?.closeGroupAudioLink(linkId).catch(() => {});
      }
      if (state.transport === 'packet') {
        this.requestReticulumPacketPathWarmup(address, state, 'sync-active-peer', {
          holdAudio: false,
          cooldownMs: GC_RETICULUM_AUDIO_RECOVERY_ACTION_COOLDOWN_MS,
        });
      }
    }

    for (const [address, desired] of desiredByAddress) {
      let state = this.reticulumAudioPeersByAddress.get(address);
      if (!state) {
        state = {
          address,
          peerPresenceHash: desired.peerPresenceHash,
          peerDestinationHash: '',
          transport: this.getEffectiveReticulumAudioTransport(null),
          packetTransportFallback: false,
          routeKey: this.computeReticulumAudioRouteKey(
            this.getEffectiveReticulumAudioTransport(null),
            desired.peerPresenceHash
          ),
          linkId: null,
          established: false,
          opening: false,
          rooms: desired.rooms,
          pending: [],
          lastInboundAtMs: 0,
          lastPathWarmAtMs: 0,
          lastRecoveryActionAtMs: 0,
          recoveryHoldUntilMs: 0,
          recoveryReason: '',
        };
        this.reticulumAudioPeersByAddress.set(address, state);
        this.reticulumAudioAddressByLinkId.set(state.routeKey, address);
      } else {
        state.peerPresenceHash = desired.peerPresenceHash;
        if (this.getReticulumAudioTransportKind() !== 'packet') {
          state.packetTransportFallback = false;
        }
        state.rooms = desired.rooms;
        this.setReticulumAudioTransport(
          address,
          state,
          this.getEffectiveReticulumAudioTransport(state)
        );
      }
      if (this.shouldMaintainReticulumAudioLink(state)) {
        void this.openReticulumAudioLinkForAddress(address);
      }
      if (state.transport === 'packet') {
        this.requestReticulumPacketPathWarmup(address, state, 'sync-active-peer', {
          holdAudio: false,
          cooldownMs: GC_RETICULUM_AUDIO_RECOVERY_ACTION_COOLDOWN_MS,
        });
      }
    }
  }

  sendAudio(
    roomId: string,
    toAddress: string,
    data: Buffer
  ): GcReticulumAudioSendResult {
    if (!isValidGcAudioBuffer(data)) {
      loggerWarn('[GCall] sendAudio dropped: invalid or oversize payload');
      return { success: false, error: 'invalid-or-oversize-payload' };
    }
    if (this.localAddresses.has(toAddress)) {
      this.emit('gcall:audio', { roomId, data: Buffer.from(data), fromAddress: toAddress });
      return {
        success: true,
        diagnostics: {
          transport: this.getReticulumAudioTransportKind(),
          pendingFrames: 0,
          queuePressureDrops: 0,
          staleDrops: 0,
          linkUnreadyDrops: 0,
          packetSendFailures: 0,
          targetAddress: toAddress,
        },
      };
    }
    const state = this.ensureReticulumAudioPeerState(roomId, toAddress);
    if (!state) {
      loggerWarn(`[GCall] sendAudio dropped: no Reticulum route for ${toAddress}`);
      return {
        success: false,
        error: 'no-reticulum-route',
        diagnostics: {
          transport: this.getReticulumAudioTransportKind(),
          pendingFrames: 0,
          queuePressureDrops: 0,
          staleDrops: 0,
          linkUnreadyDrops: 0,
          packetSendFailures: 0,
          targetAddress: toAddress,
        },
      };
    }
    const enqueueStats = this.enqueuePendingReticulumAudio(state, roomId, data);
    this.scheduleReticulumAudioFlush();
    if (state.transport === 'packet' || state.established) {
      const flushed = this.flushReticulumAudioQueuesFair(toAddress);
      if (flushed) {
        return {
          success: true,
          diagnostics: {
            ...flushed.diagnostics,
            targetAddress: toAddress,
            queuePressureDrops:
              flushed.diagnostics.queuePressureDrops + enqueueStats.queuePressureDrops,
            staleDrops: flushed.diagnostics.staleDrops + enqueueStats.staleDrops,
          },
        };
      }
    }
    return {
      success: true,
      diagnostics: this.buildReticulumAudioSendDiagnostics(state, toAddress, enqueueStats),
    };
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
      ...meta,
    };
    const keyFrames = encodeKeyWire(env);
    if (keyFrames.length === 0) {
      loggerWarn(
        `[GCall] Skipping GC_KEY (Reticulum) for room ${roomId}: unable to encode within Reticulum wire limit`
      );
      return;
    }
    this.sendReticulumToAddress(toAddress, keyFrames, 'key');
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
      ...meta,
    };
    const keyRotateFrames = encodeKeyRotateWire(env);
    if (keyRotateFrames.length === 0) {
      loggerWarn(
        `[GCall] Skipping GC_KEY_ROTATE (Reticulum) for room ${roomId}: unable to encode within Reticulum wire limit`
      );
      return;
    }
    this.fanoutReticulumWire(
      roomId,
      keyRotateFrames,
      new Set([fromAddress])
    );
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
    };
    const gqFrames = encodeKeyRequestWire(env);
    if (gqFrames.length === 0) {
      loggerWarn(
        `[GCall] Skipping GC_KEY_REQUEST (Reticulum) for room ${roomId}: unable to encode within Reticulum wire limit`
      );
      return;
    }
    this.sendReticulumToAddress(toAddress, gqFrames, 'key_request');
  }

  // ── Inbound ───────────────────────────────────────────────────────────────

  handleIncoming(
    env: GcEnvelope,
    fromNodeId?: string,
    peerPresenceHash?: string
  ): void {
    if (!GC_MESSAGE_TYPES.has(env.type)) return;
    if (this.pendingKeyByRoom.size > 0) this.sweepExpiredPendingKeys();

    switch (env.type) {
      case 'GC_JOIN':
        return this.handleJoin(env, fromNodeId, peerPresenceHash);
      case 'GC_LEAVE':
        return this.handleLeaveEnvelope(env, peerPresenceHash);
      case 'GC_TOPOLOGY':
        return this.handleTopology(env, peerPresenceHash);
      case 'GC_CLUSTER_HEARTBEAT':
        return this.handleClusterHeartbeat(env, peerPresenceHash);
      case 'GC_KEY':
        return this.handleKey(env, peerPresenceHash);
      case 'GC_KEY_ROTATE':
        return this.handleKeyRotate(env, peerPresenceHash);
      case 'GC_KEY_REQUEST':
        return this.handleKeyRequest(env, peerPresenceHash);
    }
  }

  private handleJoin(
    env: GcJoinEnvelope,
    fromNodeId?: string,
    peerPresenceHash?: string
  ): void {
    if (!this.hasLocalRoomInterest(env.roomId)) {
      this.logGcJoinDropThrottled(
        env.fromAddress,
        'no_local_room_yet',
        `[GCall] Ignored GC_JOIN (no local room yet — joinRoom not completed or wrong roomId): room=${env.roomId} from=${env.fromAddress}`
      );
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
        reticulumDestinationHash: env.reticulumDestinationHash.trim().toLowerCase(),
        ...(env.reticulumIdentityPublicKeyBase64 &&
        isRnsIdentityPublicKeyBase64(env.reticulumIdentityPublicKeyBase64)
          ? {
              reticulumIdentityPublicKeyBase64:
                env.reticulumIdentityPublicKeyBase64,
            }
          : {}),
        ...(typeof env.joinGeneration === 'number' &&
        Number.isFinite(env.joinGeneration)
          ? { joinGeneration: env.joinGeneration }
          : {}),
      },
      env.signature,
      env.fromPublicKey,
      env.fromAddress,
      { kind: 'join', env, fromNodeId, peerPresenceHash }
    );
  }

  private registerPeerIdentityFromJoinWire(env: GcJoinEnvelope): void {
    if (!env.reticulumIdentityPublicKeyBase64) return;
    if (!isRnsIdentityPublicKeyBase64(env.reticulumIdentityPublicKeyBase64)) {
      return;
    }
    if (this.localAddresses.has(env.fromAddress)) {
      return;
    }
    const bridge = this.reticulumBridge;
    if (!bridge) return;
    void bridge
      .registerPeerIdentityFromGroupJoin(
        env.reticulumDestinationHash.trim().toLowerCase(),
        env.reticulumIdentityPublicKeyBase64
      )
      .catch((err) => {
        loggerWarn(
          `[GCall] registerPeerIdentityFromGroupJoin failed: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      });
  }

  private joinIdentityKey(
    fromAddress: string,
    timestamp: number,
    destHash: string,
    joinGeneration?: number
  ): string {
    const d = destHash.trim().toLowerCase();
    const j =
      typeof joinGeneration === 'number' && Number.isFinite(joinGeneration)
        ? String(joinGeneration >>> 0)
        : 'n';
    return `${fromAddress}|${timestamp}|${d}|${j}`;
  }

  private pruneJoinRkPendingMaps(): void {
    const now = Date.now();
    for (const [k, v] of this.pendingJoinRkContextByKey) {
      if (v.expiresAt < now) this.pendingJoinRkContextByKey.delete(k);
    }
    for (const [k, v] of this.pendingJoinRkBeforeGjByKey) {
      if (v.expiresAt < now) this.pendingJoinRkBeforeGjByKey.delete(k);
    }
  }

  private notePendingJoinRkAfterVerifiedGj(env: GcJoinEnvelope): void {
    if (env.reticulumIdentityPublicKeyBase64) return;
    this.pruneJoinRkPendingMaps();
    const key = this.joinIdentityKey(
      env.fromAddress,
      env.timestamp,
      env.reticulumDestinationHash,
      env.joinGeneration
    );
    this.pendingJoinRkContextByKey.set(key, {
      roomId: env.roomId,
      chatId: env.chatId,
      fromPublicKey: env.fromPublicKey,
      expiresAt: Date.now() + GC_JOIN_RK_PENDING_TTL_MS,
    });
    const buf = this.pendingJoinRkBeforeGjByKey.get(key);
    if (buf) {
      this.pendingJoinRkBeforeGjByKey.delete(key);
      this.processJoinIdentityVerify(
        buf.decoded,
        buf.fromNodeId,
        buf.peerPresenceHash
      );
    }
  }

  private processJoinIdentityVerify(
    decoded: {
      fromAddress: string;
      signature: string;
      timestamp: number;
      reticulumDestinationHash: string;
      reticulumIdentityPublicKeyBase64: string;
      joinGeneration?: number;
    },
    fromNodeId?: string,
    peerPresenceHash?: string
  ): void {
    this.pruneJoinRkPendingMaps();
    const key = this.joinIdentityKey(
      decoded.fromAddress,
      decoded.timestamp,
      decoded.reticulumDestinationHash,
      decoded.joinGeneration
    );
    const ctx = this.pendingJoinRkContextByKey.get(key);
    if (!ctx || ctx.expiresAt < Date.now()) {
      this.pendingJoinRkBeforeGjByKey.set(key, {
        decoded,
        fromNodeId,
        peerPresenceHash,
        expiresAt: Date.now() + GC_JOIN_RK_PENDING_TTL_MS,
      });
      return;
    }
    if (!this.hasLocalRoomInterest(ctx.roomId)) {
      return;
    }
    const env: GcJoinRkEnvelope = {
      type: 'GC_JOIN_RK',
      roomId: ctx.roomId,
      chatId: ctx.chatId,
      fromAddress: decoded.fromAddress,
      fromPublicKey: ctx.fromPublicKey,
      signature: decoded.signature,
      timestamp: decoded.timestamp,
      reticulumDestinationHash: decoded.reticulumDestinationHash.trim().toLowerCase(),
      reticulumIdentityPublicKeyBase64: decoded.reticulumIdentityPublicKeyBase64,
      joinGeneration: decoded.joinGeneration,
    };
    this.enqueueJoinRkVerify(env, fromNodeId, peerPresenceHash);
  }

  private enqueueJoinRkVerify(
    env: GcJoinRkEnvelope,
    fromNodeId?: string,
    peerPresenceHash?: string
  ): void {
    const fields: Record<string, unknown> = {
      type: env.type,
      roomId: env.roomId,
      chatId: env.chatId,
      fromAddress: env.fromAddress,
      fromPublicKey: env.fromPublicKey,
      timestamp: env.timestamp,
      reticulumDestinationHash: env.reticulumDestinationHash,
      reticulumIdentityPublicKeyBase64: env.reticulumIdentityPublicKeyBase64,
    };
    if (
      typeof env.joinGeneration === 'number' &&
      Number.isFinite(env.joinGeneration)
    ) {
      fields.joinGeneration = env.joinGeneration;
    }
    const job: GcVerifyPending = {
      kind: 'join_rk',
      env,
      fromNodeId,
      peerPresenceHash,
    };
    this.enqueueVerify(
      fields,
      env.signature,
      env.fromPublicKey,
      env.fromAddress,
      job
    );
  }

  private applyVerifiedJoinRk(
    env: GcJoinRkEnvelope,
    fromNodeId?: string
  ): void {
    const now = Date.now();
    const postRej = gcJoinTimestampRejectReason(env.timestamp, now);
    if (postRej === 'expired') {
      this.logGcJoinDropThrottled(
        env.fromAddress,
        'expired_post_verify',
        `[GCall] Dropped GC_JOIN_RK: expired from ${env.fromAddress}`
      );
      return;
    }
    if (postRej === 'future') {
      this.logGcJoinDropThrottled(
        env.fromAddress,
        'future_timestamp_post',
        `[GCall] Dropped GC_JOIN_RK: future timestamp from ${env.fromAddress}`
      );
      return;
    }
    if (!this.hasLocalRoomInterest(env.roomId)) {
      return;
    }
    if (fromNodeId) {
      this.participantNodeIds.set(env.fromAddress, fromNodeId);
    }
    if (!isRnsIdentityPublicKeyBase64(env.reticulumIdentityPublicKeyBase64)) {
      return;
    }
    for (const [roomId, room] of this.rooms) {
      if (roomId !== env.roomId) continue;
      const existing = room.participants.get(env.fromAddress);
      if (!existing) {
        return;
      }
      room.participants.set(env.fromAddress, {
        publicKey: existing.publicKey,
        joinedAt: existing.joinedAt,
        reticulumDestinationHash: env.reticulumDestinationHash.trim().toLowerCase(),
        reticulumIdentityPublicKeyBase64: env.reticulumIdentityPublicKeyBase64,
      });
      break;
    }
    const joinForRegister: GcJoinEnvelope = {
      type: 'GC_JOIN',
      roomId: env.roomId,
      chatId: env.chatId,
      fromAddress: env.fromAddress,
      fromPublicKey: env.fromPublicKey,
      signature: env.signature,
      timestamp: env.timestamp,
      reticulumDestinationHash: env.reticulumDestinationHash,
      reticulumIdentityPublicKeyBase64: env.reticulumIdentityPublicKeyBase64,
      joinGeneration: env.joinGeneration,
    };
    this.registerPeerIdentityFromJoinWire(joinForRegister);
    this.syncReticulumAudioLinks();
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
            reticulumDestinationHash: env.reticulumDestinationHash.trim().toLowerCase(),
            ...(env.reticulumIdentityPublicKeyBase64 &&
            isRnsIdentityPublicKeyBase64(env.reticulumIdentityPublicKeyBase64)
              ? {
                  reticulumIdentityPublicKeyBase64:
                    env.reticulumIdentityPublicKeyBase64,
                }
              : {}),
          });
          if (!env.reticulumIdentityPublicKeyBase64) {
            this.notePendingJoinRkAfterVerifiedGj(env);
          }
        } else {
          this.logGcJoinDropThrottled(
            env.fromAddress,
            'stale_join_ts',
            `[GCall] Skipped GC_JOIN participant update (stale joinTs vs existing): from=${env.fromAddress} room=${env.roomId} incomingTs=${env.timestamp} existingJoinedAt=${existing?.joinedAt ?? 'n/a'}`
          );
        }
        break;
      }
    }

    this.registerPeerIdentityFromJoinWire(env);

    // Only notify the renderer when the local client is actively in this room.
    if (this.hasLocalRoomInterest(env.roomId)) {
      this.emit('gcall:participant-joined', {
        roomId: env.roomId,
        chatId: env.chatId,
        address: env.fromAddress,
        publicKey: env.fromPublicKey,
        timestamp: env.timestamp,
        ...(typeof env.joinGeneration === 'number' &&
        Number.isFinite(env.joinGeneration)
          ? { joinGeneration: env.joinGeneration }
          : {}),
      });
    }
    this.syncReticulumAudioLinks();
  }

  private handleLeaveEnvelope(
    env: GcLeaveEnvelope,
    peerPresenceHash?: string
  ): void {
    if (!this.hasLocalRoomInterest(env.roomId)) {
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
      { kind: 'leave', env, peerPresenceHash }
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
  }

  private handleLeave(
    roomId: string,
    address: string,
    isAbrupt: boolean
  ): void {
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
    this.reticulumPeerPresenceHashByAddress.delete(address);
    if (hadLocalInterest) {
      this.emit('gcall:participant-left', { roomId, address, isAbrupt });
    }
    if (hadLocalInterest || this.isWatchedQortalRoom(roomId)) {
      this.scheduleQortalGroupCallActivityEmit(false);
    }
    this.syncReticulumAudioLinks();
  }

  private handleTopology(
    env: GcTopologyEnvelope,
    peerPresenceHash?: string
  ): void {
    if (!this.hasLocalRoomInterest(env.roomId)) {
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
      { kind: 'topology', env, peerPresenceHash }
    );
  }

  private applyVerifiedTopology(env: GcTopologyEnvelope): void {
    // Update local epoch tracking
    const room = this.rooms.get(env.roomId);
    const topologySignature = buildTopologySignature(env);
    let emitFullTopology = true;
    if (room) {
      const previousRoot = room.lastTopology?.rootForwarder ?? '';
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
          loggerLog(
            `[GCall] Dropped stale GC_TOPOLOGY epoch ${env.topologyEpoch} < ${room.topologyEpoch}`
          );
        }
        return;
      }
      if (
        room.lastTopology &&
        incomingTopology.topologyEpoch === room.lastTopology.topologyEpoch &&
        incomingTopology.rootForwarder !== room.lastTopology.rootForwarder
      ) {
        const decision = chooseMainTopologyAuthority(
          room.lastTopology,
          incomingTopology,
          env.roomId
        );
        loggerLog(
          `[GCall] Same-epoch GC_TOPOLOGY disagreement room=${env.roomId} epoch=${incomingTopology.topologyEpoch} currentRoot=${room.lastTopology.rootForwarder} incomingRoot=${incomingTopology.rootForwarder} acceptIncoming=${decision.acceptIncoming} reason=${decision.reason}`
        );
        if (!decision.acceptIncoming) {
          return;
        }
      }
      emitFullTopology =
        env.topologyEpoch !== room.topologyEpoch ||
        topologySignature !== room.topologySignature;
      room.topologyEpoch = env.topologyEpoch;
      room.topologySignature = topologySignature;
      room.lastTopology = incomingTopology;
      if (
        previousRoot &&
        incomingTopology.rootForwarder &&
        previousRoot !== incomingTopology.rootForwarder
      ) {
        this.clearRetainedVerifiedKeyStatesForRoom(env.roomId);
      }
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
    this.syncReticulumAudioLinks();
  }

  private handleClusterHeartbeat(
    env: GcClusterHeartbeatEnvelope,
    peerPresenceHash?: string
  ): void {
    if (!this.hasLocalRoomInterest(env.roomId)) {
      return;
    }

    let fromPublicKey = env.fromPublicKey;
    if (!fromPublicKey) {
      const room = this.rooms.get(env.roomId);
      fromPublicKey = room?.participants.get(env.fromAddress)?.publicKey ?? '';
    }
    if (!fromPublicKey) {
      return;
    }

    const envForVerify: GcClusterHeartbeatEnvelope = {
      ...env,
      fromPublicKey,
    };

    this.enqueueVerify(
      buildGcClusterHeartbeatSignedFields(envForVerify),
      env.signature,
      fromPublicKey,
      env.fromAddress,
      { kind: 'cluster_heartbeat', env: envForVerify, peerPresenceHash }
    );
  }

  private applyVerifiedClusterHeartbeat(env: GcClusterHeartbeatEnvelope): void {
    if (env.clusterForwarder !== env.fromAddress) return;

    const room = this.rooms.get(env.roomId);
    if (room) {
      if (env.topologyEpoch < room.topologyEpoch) {
        return;
      }
      if (env.topologyEpoch !== room.topologyEpoch) {
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
  }

  private handleReticulumGroupAudioPacket(payload: {
    linkId: string;
    routeKey?: string;
    transport?: 'link' | 'packet';
    roomId: string;
    data: Buffer | string;
    peerPresenceHash: string;
    peerDestinationHash: string;
    incoming: boolean;
  }): void {
    if (!this.hasLocalRoomInterest(payload.roomId)) {
      return;
    }
    let raw: Buffer;
    if (Buffer.isBuffer(payload.data)) {
      raw = payload.data;
    } else if (typeof payload.data === 'string') {
      try {
        raw = Buffer.from(payload.data, 'base64');
      } catch {
        return;
      }
    } else {
      return;
    }
    if (!isValidGcAudioBuffer(raw)) {
      loggerWarn('[GCall] Reticulum audio dropped: invalid or oversize payload');
      return;
    }
    const fromAddress = this.resolveReticulumAudioAddress(
      payload.routeKey ?? payload.linkId,
      payload.peerPresenceHash,
      payload.roomId
    );
    if (fromAddress && !this.reticulumAudioPeersByAddress.has(fromAddress)) {
      void this.ensureReticulumAudioPeerState(payload.roomId, fromAddress);
    }
    if (fromAddress) {
      const state = this.reticulumAudioPeersByAddress.get(fromAddress);
      if (state) {
        state.peerDestinationHash =
          payload.peerDestinationHash || state.peerDestinationHash;
        state.lastInboundAtMs = Date.now();
        state.recoveryHoldUntilMs = 0;
        state.recoveryReason = '';
        if ((payload.transport ?? 'link') === 'packet') {
          state.packetTransportFallback = false;
          this.setReticulumAudioTransport(fromAddress, state, 'packet');
        }
      }
    }
    this.emit('gcall:audio', {
      roomId: payload.roomId,
      data: raw,
      transport: payload.transport ?? 'link',
      routeKey: payload.routeKey ?? payload.linkId,
      peerPresenceHash: payload.peerPresenceHash,
      peerDestinationHash: payload.peerDestinationHash,
      resolvedFromAddress: fromAddress ?? null,
      ...(fromAddress ? { fromAddress } : {}),
    });
  }

  private handleReticulumGroupAudioLinkEstablished(payload: {
    linkId: string;
    peerPresenceHash: string;
    peerDestinationHash: string;
    incoming: boolean;
  }): void {
    const address = this.resolveReticulumAudioAddress(
      payload.linkId,
      payload.peerPresenceHash
    );
    if (!address) return;
    if (!this.reticulumAudioPeersByAddress.has(address)) {
      const rid = this.findRoomIdContainingParticipant(address);
      if (rid) {
        void this.ensureReticulumAudioPeerState(rid, address);
      }
    }
    const state = this.reticulumAudioPeersByAddress.get(address);
    if (!state) return;
    state.linkId = payload.linkId;
    state.peerDestinationHash =
      payload.peerDestinationHash || state.peerDestinationHash;
    state.established = true;
    state.opening = false;
    this.reticulumAudioAddressByLinkId.set(payload.linkId, address);
    if (state.transport === 'link') {
      this.setReticulumAudioRouteKey(address, state, payload.linkId);
    }
    this.scheduleReticulumAudioFlush();
  }

  private handleReticulumGroupAudioLinkClosed(payload: {
    linkId: string;
    peerPresenceHash: string;
    peerDestinationHash: string;
    incoming: boolean;
    reason: string;
  }): void {
    const address = this.resolveReticulumAudioAddress(
      payload.linkId,
      payload.peerPresenceHash
    );
    if (!address) return;
    this.markReticulumAudioLinkUnready(address, payload.linkId);
    const state = this.reticulumAudioPeersByAddress.get(address);
    if (state && state.rooms.size > 0 && this.shouldMaintainReticulumAudioLink(state)) {
      void this.openReticulumAudioLinkForAddress(address);
    }
  }

  private handleKey(env: GcKeyEnvelope, peerPresenceHash?: string): void {
    if (!this.localAddresses.has(env.toAddress)) {
      return;
    }
    if (env.keyMessageVersion !== GC_KEY_MESSAGE_VERSION) {
      loggerLog(
        `[GCall] Dropped GC_KEY: unsupported version ${env.keyMessageVersion}`
      );
      return;
    }
    if (
      env.encryptedKeyDigest !==
      buildGcKeyDigest(env.toAddress, env.encryptedKey)
    ) {
      loggerLog(
        `[GCall] Dropped GC_KEY: payload digest mismatch from ${env.fromAddress}`
      );
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
        loggerLog(
          `[GCall] GC_KEY: adopted session gen ${env.mediaSessionGeneration} from ${env.fromAddress}`
        );
      } else {
        loggerLog(
          `[GCall] Dropped GC_KEY: stale session generation from ${env.fromAddress}`
        );
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
      { kind: 'key', env, peerPresenceHash }
    );
  }

  private handleKeyRotate(
    env: GcKeyRotateEnvelope,
    peerPresenceHash?: string
  ): void {
    let hasLocalRecipient = false;
    for (const localAddr of this.localAddresses) {
      if (env.encryptedKeys[localAddr]) {
        hasLocalRecipient = true;
        break;
      }
    }
    if (!hasLocalRecipient) {
      return;
    }
    if (env.keyMessageVersion !== GC_KEY_MESSAGE_VERSION) {
      loggerLog(
        `[GCall] Dropped GC_KEY_ROTATE: unsupported version ${env.keyMessageVersion}`
      );
      return;
    }
    if (env.encryptedKeysDigest !== buildGcKeyRotateDigest(env.encryptedKeys)) {
      loggerLog(
        `[GCall] Dropped GC_KEY_ROTATE: payload digest mismatch from ${env.fromAddress}`
      );
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
        loggerLog(
          `[GCall] GC_KEY_ROTATE: adopted session gen ${env.mediaSessionGeneration} from ${env.fromAddress}`
        );
      } else {
        loggerLog(
          `[GCall] Dropped GC_KEY_ROTATE: stale session generation from ${env.fromAddress}`
        );
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
      { kind: 'key_rotate', env, peerPresenceHash }
    );
  }

  private handleKeyRequest(
    env: GcKeyRequestEnvelope,
    peerPresenceHash?: string
  ): void {
    if (!this.localAddresses.has(env.toAddress)) {
      return;
    }
    if (env.keyMessageVersion !== GC_KEY_MESSAGE_VERSION) {
      loggerLog(
        `[GCall] Dropped GC_KEY_REQUEST: unsupported version ${env.keyMessageVersion}`
      );
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
      { kind: 'key_request', env, peerPresenceHash }
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
    const payload: RetainedVerifiedKeyState = {
      roomId: env.roomId,
      recipientAddress: env.toAddress,
      fromAddress: env.fromAddress,
      fromPublicKey: env.fromPublicKey,
      encryptedKey: env.encryptedKey,
      timestamp: env.timestamp,
      keyMessageVersion: env.keyMessageVersion,
      callSessionId: env.callSessionId,
      mediaSessionGeneration: env.mediaSessionGeneration,
      keyCommitment: env.keyCommitment,
      verified: true,
      deliveryKind: 'live',
    };
    this.rememberRetainedVerifiedKeyState(env.toAddress, payload);
    this.emit('gcall:key', payload);
  }

  private applyVerifiedKeyRotate(env: GcKeyRotateEnvelope): void {
    for (const localAddr of this.localAddresses) {
      const encryptedKey = env.encryptedKeys[localAddr];
      if (!encryptedKey) continue;
      const payload: RetainedVerifiedKeyState = {
        roomId: env.roomId,
        recipientAddress: localAddr,
        fromAddress: env.fromAddress,
        fromPublicKey: env.fromPublicKey,
        encryptedKey,
        timestamp: env.timestamp,
        keyMessageVersion: env.keyMessageVersion,
        callSessionId: env.callSessionId,
        mediaSessionGeneration: env.mediaSessionGeneration,
        keyCommitment: env.keyCommitment,
        verified: true,
        deliveryKind: 'live',
      };
      this.rememberRetainedVerifiedKeyState(localAddr, payload);
      this.emit('gcall:key', payload);
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

  // ── Queries ───────────────────────────────────────────────────────────────

  getRoomParticipants(
    roomId: string
  ): Array<{
    address: string;
    publicKey: string;
    reticulumDestinationHash: string;
    reticulumIdentityPublicKeyBase64?: string;
  }> {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return [...room.participants.entries()].map(([address, p]) => ({
      address,
      publicKey: p.publicKey,
      reticulumDestinationHash: p.reticulumDestinationHash,
      ...(p.reticulumIdentityPublicKeyBase64
        ? { reticulumIdentityPublicKeyBase64: p.reticulumIdentityPublicKeyBase64 }
        : {}),
    }));
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
            healthyPeerAddresses:
              transportHealth?.healthyPeerAddresses ?? new Set(),
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

      if (
        delayedByHealthyTransport &&
        !this.presence.isAddressOnline(address)
      ) {
        this.schedulePresenceEviction(address);
      }
    }, GroupCallManager.PRESENCE_EVICTION_GRACE_MS);
    this.presenceEvictionTimers.set(address, timer);
  }
}
