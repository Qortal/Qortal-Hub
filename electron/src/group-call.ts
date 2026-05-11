/**
 * Group Call protocol for the Qortal Hub Reticulum transport.
 *
 * Implements fully decentralized group voice call signaling over Reticulum.
 * All GC_* messages are ephemeral (never stored to disk).
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
import type { PresenceManager } from './presence';
import type {
  ReticulumBridge,
  ReticulumAudioLinkHeartbeatCommand,
  ReticulumAudioQueueSnapshot,
  ReticulumEnqueueGroupAudioResult,
  ReticulumOpenAudioLinkResult,
  ReticulumSendFailureReason,
  ReticulumSendResult,
} from './reticulum-bridge';
import { VerifyWorkerPool } from './verify-worker-pool';
import {
  isInReticulumFallbackReactivationCooldown,
  shouldActivateReticulumPeerRxFallback,
} from './reticulum-audio-link-fallback-policy';
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
import type {
  GrFragmentMeta,
  GkFragmentMeta,
  GtFragmentMeta,
} from './group-call-wire-reticulum';
import { compactDmVoiceJoinWireChatId } from './dm-voice-wire';
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

/**
 * Experimental diagnostic switch.
 *
 * Set to true to run group calls without main-process room bootstrap/cache:
 * - no recent room state is retained after leave/rejoin
 * - joinRoom does not reuse recent topology/session identity
 * - getRoomBootstrapState returns null, so renderers rely only on live GC_* traffic
 *   plus the separate live getRoomParticipants() roster path.
 *
 * Keep false for normal builds.
 */
export const GCALL_DISABLE_ROOM_BOOTSTRAP_CACHE = true;

const GC_RETICULUM_ACTIVITY_HEARTBEAT_INTERVAL_MS = 5_000;
/** Must exceed heartbeat interval so peers do not drop `GA` as stale between beats. */
const GC_RETICULUM_ACTIVITY_MAX_AGE_MS = 7_000;
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
const GC_RETICULUM_LINK_CONTROL_PENDING_MAX_FRAMES = 32;
const GC_RETICULUM_LINK_CONTROL_PENDING_MAX_AGE_MS = 20_000;
const GC_RETICULUM_AUDIO_PREROUTE_PENDING_MAX_FRAMES = 6;
const GC_RETICULUM_AUDIO_PREROUTE_PENDING_MAX_AGE_MS = 300;
const GC_RETICULUM_AUDIO_PREROUTE_RETRY_DELAY_MS = 30;
const GC_RETICULUM_AUDIO_FLUSH_MAX_FRAMES_PER_PASS = 12;
const GC_RETICULUM_AUDIO_FLUSH_MAX_FRAMES_PER_PEER = 4;
/** When local node is any forwarder or within post-recovery boost, scale flush caps (see getReticulumAudioFlushLimits). */
const GC_RETICULUM_AUDIO_FLUSH_SCALE_FACTOR = 3;
const GC_RETICULUM_AUDIO_FLUSH_MAX_FRAMES_PER_PASS_CAP = 48;
const GC_RETICULUM_AUDIO_FLUSH_MAX_FRAMES_PER_PEER_CAP = 12;
/** After renderer-requested media recovery, temporarily allow deeper flush (matches ADAPTIVE_RECOVERY_COOLDOWN_MS in renderer). */
const GC_RETICULUM_MEDIA_RECOVERY_FLUSH_BOOST_MS = 8_000;
/** Stage-5 flush boost re-escalation cooldown (renderer-aligned). */
const STAGE5_REESCALATION_COOLDOWN_MS = 2_000;
const STAGE5_BYPASS_BRIDGE_WAITING_MS = 500;
const STAGE5_BYPASS_BINARY_OUT_HW = 8;
const STAGE5_BYPASS_BINARY_OUT_DWELL_MS = 1_000;
const STAGE5_BYPASS_QUEUE_PRESSURE_LAST5S = 6;
/**
 * Path warm / topology recovery reasons: do not set recovery hold (avoids 200ms pending max-age
 * during route churn). See getReticulumAudioPendingMaxAgeMs when recoveryHoldUntilMs is active.
 */
const GC_RETICULUM_RECOVERY_HOLD_AUDIO_FALSE_REASONS = new Set<string>([
  'topology-startup-warm',
  'topology-root-inbound-warm',
  'topology-root-inbound-stress-warm',
  'topology-predictive-warm',
  'peer-joined-inbound-warm',
  'peer-joined-startup-warm',
  'path-degraded-warm',
]);
const GC_RETICULUM_RECOVERY_PACKET_PROTECTION_REASONS = new Set<string>([
  'path-degraded-warm',
]);
/**
 * Renderer media-quality warmups are soft evidence. They may happen during
 * join/key/topology settle, so they must not tear down an already-open link.
 */
const GC_RETICULUM_RECOVERY_PRESERVE_LINK_REASONS = new Set<string>([
  'path-degraded-warm',
]);
/** Matches send-side pressure backoff: fair flush reschedules with this delay when bridge is pressured. */
const GC_RETICULUM_AUDIO_FLUSH_RETRY_DELAY_MS = 5;
const GC_RETICULUM_AUDIO_RECOVERY_HOLD_MS = 160;
const GC_RETICULUM_AUDIO_RECOVERY_BUFFER_MAX_AGE_MS = 200;
const GC_RETICULUM_AUDIO_RECOVERY_ACTION_COOLDOWN_MS = 1_000;
/** Give GC_LEAVE link-control frames one short flush window before link teardown. */
const GC_RETICULUM_LEAVE_LINK_DRAIN_MS = 350;
/** Kept in sync with `RETICULUM_SEND_PRESSURE_*` in `src/lib/group-call/opusSendPressure.ts` (renderer ladder). */
const GC_RETICULUM_AUDIO_PRESSURE_BRIDGE_QUEUE_FRAMES = 8;
const GC_RETICULUM_AUDIO_PRESSURE_DECODED_QUEUE_DEPTH = 12;
const GC_RETICULUM_AUDIO_PRESSURE_RECENT_DROPS = 6;
/**
 * Mirror of `RETICULUM_SEND_PRESSURE_*_FORWARDER` in opusSendPressure.ts — optional stricter
 * thresholds when the sender is a forwarder (fan-out uplink).
 */
const GC_RETICULUM_AUDIO_PRESSURE_BRIDGE_QUEUE_FRAMES_FORWARDER = 6;
const GC_RETICULUM_AUDIO_PRESSURE_DECODED_QUEUE_DEPTH_FORWARDER = 10;
const GC_RETICULUM_AUDIO_PRESSURE_RECENT_DROPS_FORWARDER = 5;
const GC_RETICULUM_PACKET_LINK_FALLBACK_EVIDENCE_COUNT = 4;
const GC_RETICULUM_PACKET_LINK_FALLBACK_MIN_DEGRADED_MS = 6_000;
const GC_RETICULUM_PACKET_LINK_FALLBACK_REQUEST_WINDOW_MS = 15_000;
const GC_RETICULUM_PACKET_LINK_FALLBACK_MIN_DWELL_MS = 3_000;
const GC_RETICULUM_PACKET_LINK_FALLBACK_REMOTE_RX_MISSING_MS = 6_000;
const GC_RETICULUM_PACKET_LINK_FALLBACK_LOCAL_SEND_RECENT_MS = 12_000;
const GC_RETICULUM_PACKET_LINK_FALLBACK_PACKET_RX_AGE_CAP_MS = 60_000;
/**
 * When a just-joined client learns an older peer from retained/bootstrap GC_JOIN,
 * let the peer that received the fresh GC_JOIN own the first audio-link open.
 * This avoids both sides racing duplicate Reticulum links during first contact.
 */
const GC_RETICULUM_JOINER_AUDIO_OPEN_DEFER_MS = 3_000;
/**
 * Hysteresis between consecutive fallback activations. After leaving link-fallback, we refuse
 * to re-enter for this window so a quiet listener (natural speech silences) does not
 * ping-pong between packet↔link every 5 s heartbeat. Set from field evidence: Kenny (root,
 * mostly listening) flipped 8 times in 41 s in phil-kenny-one-on-one-61 because every
 * conversational silence >4 s left Phil's heartbeat reporting packetRxRecent=false —
 * each flip churned the bridge routeKey and dropped in-flight frames.
 */
const GC_RETICULUM_PACKET_LINK_FALLBACK_REACTIVATION_COOLDOWN_MS = 15_000;
/**
 * When interpreting a peer's `packetRxAgeMs` heartbeat, how much older than our own last
 * outbound packet the peer's last-received age must be before we consider "our recent
 * send failed to arrive" (i.e. genuine packet-path loss). Guards against the silence
 * false-positive: if we simply weren't sending, peer's old rx age is expected. Generous
 * enough to absorb one-way path latency and heartbeat sampling jitter.
 */
const GC_RETICULUM_PACKET_LINK_FALLBACK_PEER_RX_LOSS_TOLERANCE_MS = 2_000;
const GC_RETICULUM_AUDIO_LINK_HEARTBEAT_WIRE_TYPE = 'GAC';
const GC_RETICULUM_AUDIO_LINK_HEARTBEAT_INTERVAL_MS = 5_000;
const GC_RETICULUM_AUDIO_LINK_HEARTBEAT_TICK_MS = 1_000;
const GC_RETICULUM_AUDIO_LINK_HEARTBEAT_MISSED_MAX = 2;
const GC_RETICULUM_AUDIO_LINK_HEARTBEAT_ACTIVITY_GRACE_MS =
  GC_RETICULUM_AUDIO_LINK_HEARTBEAT_INTERVAL_MS *
    GC_RETICULUM_AUDIO_LINK_HEARTBEAT_MISSED_MAX +
  1_000;
const GC_RETICULUM_AUDIO_LINK_HEARTBEAT_RECOVERY_COOLDOWN_MS = 5_000;
const GC_RETICULUM_AUDIO_LINK_ESTABLISH_RETRY_MIN_MS = 5_000;
const GC_RETICULUM_AUDIO_LINK_ESTABLISH_RETRY_MAX_MS = 30_000;
const GC_RETICULUM_AUDIO_LINK_ESTABLISH_INITIAL_STALE_MS = 8_000;
const GC_RETICULUM_AUDIO_LINK_ESTABLISH_STALE_MS = 45_000;
const GC_RETICULUM_AUDIO_LINK_STICKY_MS = 15_000;

type ReticulumMediaTransportKind = 'link' | 'packet';

const GC_RETICULUM_PACKET_MEDIA_ENABLED = false;
const GC_RETICULUM_PACKET_MEDIA_KEEP_AUDIO_LINKS = true;
const GC_RETICULUM_OVERLAY_HOPS = 4;
const GC_RETICULUM_OVERLAY_SEEN_TTL_MS = 120_000;
/** Short-lived logical-message dedupe: suppress same authored message while allowing retries to recover soon. */
const GC_RETICULUM_OVERLAY_LOGICAL_DEDUP_TTL_MS = 30_000;
/** Cap RAM if many unique logical keys arrive (sweeps expired first). */
const GC_RETICULUM_OVERLAY_LOGICAL_DEDUP_MAX = 8192;
/** Full scan for expired logical-key entries at most this often (idle traffic still frees memory). */
const GC_RETICULUM_OVERLAY_LOGICAL_DEDUP_SWEEP_MIN_MS = 30_000;
/** Retry retained GC_JOIN identity replay across topology heartbeats; first direct send can be lost. */
const GC_RETAINED_JOIN_IDENTITY_REPLAY_MAX_ATTEMPTS = 6;

type GcReticulumRetryKind =
  | 'join'
  | 'join_replay'
  | 'leave'
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
  'bridge-overloaded',
  'bridge-not-started',
  'unknown-peer-presence-hash',
  'packet-send-false',
  'no-route',
  'no-targets',
]);

/** Exported for unit tests — whether recovery should apply short pending max-age hold. */
export function shouldHoldAudioForReticulumRecoveryReason(
  reason: string
): boolean {
  const r = reason.trim().toLowerCase();
  return !GC_RETICULUM_RECOVERY_HOLD_AUDIO_FALSE_REASONS.has(r);
}

function shouldRequestPacketProtectionForReticulumRecoveryReason(
  reason: string
): boolean {
  const r = reason.trim().toLowerCase();
  return GC_RETICULUM_RECOVERY_PACKET_PROTECTION_REASONS.has(r);
}

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
  lastLeaveTimestamp?: number | undefined;
}): boolean {
  if (
    typeof opts.lastLeaveTimestamp === 'number' &&
    Number.isFinite(opts.lastLeaveTimestamp) &&
    opts.incomingJoinTimestamp <= opts.lastLeaveTimestamp
  ) {
    return false;
  }
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

export function shouldDelayPresenceEvictionForRecentCallActivity(opts: {
  lastActivityAtMs: number | null | undefined;
  nowMs: number;
  staleAfterMs: number;
}): boolean {
  const lastActivityAtMs = opts.lastActivityAtMs ?? 0;
  if (lastActivityAtMs <= 0) return false;
  return opts.nowMs - lastActivityAtMs <= opts.staleAfterMs;
}

/** v3: callSessionId + mediaSessionGeneration + keyCommitment (no topology/key epoch on wire). */
const GC_KEY_MESSAGE_VERSION = 3;

/** After base64 decode; rejects absurd blobs before IPC to renderer. */
const GROUP_AUDIO_MAX_BINARY_WIRE_BYTES = 12_288;
const GC_LINK_CONTROL_MAGIC = Buffer.from('QGCCTL1\0', 'ascii');

function isValidGcAudioBuffer(data: Buffer): boolean {
  return data.length > 0 && data.length <= GROUP_AUDIO_MAX_BINARY_WIRE_BYTES;
}

function encodeGcLinkControlWire(wire: Record<string, unknown>): Buffer | null {
  try {
    const body = Buffer.from(JSON.stringify(wire), 'utf8');
    const out = Buffer.concat([GC_LINK_CONTROL_MAGIC, body]);
    return isValidGcAudioBuffer(out) ? out : null;
  } catch {
    return null;
  }
}

function decodeGcLinkControlWire(data: Buffer): Record<string, unknown> | null {
  if (
    data.length <= GC_LINK_CONTROL_MAGIC.length ||
    !data
      .subarray(0, GC_LINK_CONTROL_MAGIC.length)
      .equals(GC_LINK_CONTROL_MAGIC)
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      data.subarray(GC_LINK_CONTROL_MAGIC.length).toString('utf8')
    ) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
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

interface GcReticulumAudioLinkHeartbeatWire {
  t: typeof GC_RETICULUM_AUDIO_LINK_HEARTBEAT_WIRE_TYPE;
  R: string;
  c: ReticulumAudioLinkHeartbeatCommand;
  m: number;
  p?: number;
  packetRxAgeMs?: number;
  packetRxRecent?: boolean;
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

function decodeGcReticulumAudioLinkHeartbeatWire(
  wire: Record<string, unknown>
): GcReticulumAudioLinkHeartbeatWire | null {
  if (wire.t !== GC_RETICULUM_AUDIO_LINK_HEARTBEAT_WIRE_TYPE) return null;
  if (typeof wire.R !== 'string' || wire.R.length === 0) return null;
  if (wire.c !== 'PING' && wire.c !== 'PONG') return null;
  if (typeof wire.m !== 'number' || !Number.isFinite(wire.m)) return null;
  let seq: number | undefined;
  if (typeof wire.p === 'number' && Number.isFinite(wire.p)) {
    seq = Math.max(0, Math.trunc(wire.p));
  }
  let packetRxAgeMs: number | undefined;
  if (typeof wire.pa === 'number' && Number.isFinite(wire.pa)) {
    packetRxAgeMs = Math.max(
      -1,
      Math.min(
        GC_RETICULUM_PACKET_LINK_FALLBACK_PACKET_RX_AGE_CAP_MS,
        Math.trunc(wire.pa)
      )
    );
  }
  let packetRxRecent: boolean | undefined;
  if (wire.pr === 0 || wire.pr === 1) {
    packetRxRecent = wire.pr === 1;
  } else if (typeof wire.pr === 'boolean') {
    packetRxRecent = wire.pr;
  }
  return {
    t: GC_RETICULUM_AUDIO_LINK_HEARTBEAT_WIRE_TYPE,
    R: wire.R,
    c: wire.c,
    m: wire.m,
    ...(seq !== undefined ? { p: seq } : {}),
    ...(packetRxAgeMs !== undefined ? { packetRxAgeMs } : {}),
    ...(packetRxRecent !== undefined ? { packetRxRecent } : {}),
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

interface ReticulumLinkControlPendingFrame {
  roomId: string;
  data: Buffer;
  reason: string;
  enqueuedAtMs: number;
}

interface ReticulumAudioAwaitingRouteState {
  address: string;
  rooms: Set<string>;
  pending: ReticulumAudioPendingFrame[];
  recoveryReason: string;
  retryTimer: ReturnType<typeof setTimeout> | null;
}

interface ReticulumAudioPeerState {
  address: string;
  peerPresenceHash: string;
  peerDestinationHash: string;
  transport: ReticulumMediaTransportKind;
  packetTransportFallback: boolean;
  packetDegradedSinceMs: number;
  packetFallbackEvidenceCount: number;
  packetFallbackActivatedAtMs: number;
  packetFallbackLastProbeAtMs: number;
  packetFallbackProbeCount: number;
  packetFallbackExitCount: number;
  packetFallbackLastDwellMs: number;
  /** Wall time of last `deactivateReticulumAudioLinkFallback`; gates reactivation cooldown. */
  packetFallbackLastExitAtMs: number;
  packetLinkFallbackRequestedUntilMs: number;
  packetLinkFallbackReason: string;
  peerPacketRxMissingUntilMs: number;
  routeKey: string;
  linkId: string | null;
  linkOpenedByOwner: boolean | null;
  established: boolean;
  opening: boolean;
  linkAuthSentByRoom: Map<string, string>;
  linkAuthSentCount: number;
  linkAuthRxCount: number;
  linkAuthAppliedCount: number;
  lastLinkAuthAtMs: number;
  lastLinkAuthReason: string;
  rooms: Set<string>;
  pending: ReticulumAudioPendingFrame[];
  pendingControl: ReticulumLinkControlPendingFrame[];
  lastInboundAtMs: number;
  lastInboundPacketAtMs: number;
  lastOutboundPacketAtMs: number;
  lastPathWarmAtMs: number;
  lastRecoveryActionAtMs: number;
  recoveryHoldUntilMs: number;
  recoveryReason: string;
  linkHeartbeatSeq: number;
  linkHeartbeatAwaitingSeq: number;
  linkHeartbeatLastPingAtMs: number;
  linkHeartbeatLastPongAtMs: number;
  linkHeartbeatLastRxAtMs: number;
  linkHeartbeatMissedPongs: number;
  linkHeartbeatLastRecoveryAtMs: number;
  linkEstablishedAtMs: number;
  linkEstablishLastAttemptAtMs: number;
  linkEstablishRetryDelayMs: number;
  linkOpenAttempts: number;
  linkEstablishedCount: number;
  linkStaleCloseCount: number;
  lastLinkCloseReason: string;
  lastLinkCloseAtMs: number;
  lastLinkCloseLinkId: string;
  lastLinkUnreadyReason: string;
  lastLinkUnreadyAtMs: number;
  lastLinkUnreadyLinkId: string;
  pathDiversityUntilMs: number;
  pathDiversityReason: string;
}

interface GcReticulumAudioSendDiagnostics {
  transport: ReticulumMediaTransportKind;
  pendingFrames: number;
  pendingOldestAgeMs?: number;
  queuePressureDrops: number;
  staleDrops: number;
  linkUnreadyDrops: number;
  packetSendFailures: number;
  targetAddress?: string;
  peerPresenceHash?: string;
  routeKey?: string;
  linkId?: string;
  linkEstablished?: boolean;
  linkOpenedByOwner?: boolean | null;
  linkOpening?: boolean;
  linkEstablishPendingAgeMs?: number;
  linkEstablishLastAttemptAtMs?: number;
  linkEstablishRetryDelayMs?: number;
  linkOpenAttempts?: number;
  linkEstablishedCount?: number;
  linkEstablishedAtMs?: number;
  linkStaleCloseCount?: number;
  pendingControlFrames?: number;
  linkAuthSentCount?: number;
  linkAuthRxCount?: number;
  linkAuthAppliedCount?: number;
  lastLinkAuthAtMs?: number;
  lastLinkAuthReason?: string;
  lastLinkCloseReason?: string;
  lastLinkCloseAtMs?: number;
  lastLinkCloseLinkId?: string;
  lastLinkUnreadyReason?: string;
  lastLinkUnreadyAtMs?: number;
  lastLinkUnreadyLinkId?: string;
  lastInboundAtMs?: number;
  recoveryReason?: string;
  recoveryHoldUntilMs?: number;
  linkFallbackActive?: boolean;
  linkFallbackReason?: string;
  linkFallbackDwellMs?: number;
  linkFallbackProbeCount?: number;
  linkFallbackExitCount?: number;
  linkFallbackLastDwellMs?: number;
  pathDiversityActive?: boolean;
  pathDiversityReason?: string;
  pathDiversityMirrorAttempts?: number;
  pathDiversityMirrorSuccesses?: number;
  pathDiversityMirrorFailures?: number;
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

function mergeGcReticulumAudioSendDiagnostics(
  a: GcReticulumAudioSendDiagnostics,
  b: GcReticulumAudioSendDiagnostics
): GcReticulumAudioSendDiagnostics {
  const linkClose =
    (b.lastLinkCloseAtMs ?? 0) >= (a.lastLinkCloseAtMs ?? 0) ? b : a;
  const linkUnready =
    (b.lastLinkUnreadyAtMs ?? 0) >= (a.lastLinkUnreadyAtMs ?? 0) ? b : a;
  return {
    transport: b.transport ?? a.transport,
    pendingFrames: Math.max(a.pendingFrames, b.pendingFrames),
    pendingOldestAgeMs: Math.max(
      a.pendingOldestAgeMs ?? 0,
      b.pendingOldestAgeMs ?? 0
    ),
    queuePressureDrops: a.queuePressureDrops + b.queuePressureDrops,
    staleDrops: a.staleDrops + b.staleDrops,
    linkUnreadyDrops: a.linkUnreadyDrops + b.linkUnreadyDrops,
    packetSendFailures: a.packetSendFailures + b.packetSendFailures,
    linkEstablishPendingAgeMs: Math.max(
      a.linkEstablishPendingAgeMs ?? 0,
      b.linkEstablishPendingAgeMs ?? 0
    ),
    linkEstablishLastAttemptAtMs: Math.max(
      a.linkEstablishLastAttemptAtMs ?? 0,
      b.linkEstablishLastAttemptAtMs ?? 0
    ),
    linkEstablishRetryDelayMs: Math.max(
      a.linkEstablishRetryDelayMs ?? 0,
      b.linkEstablishRetryDelayMs ?? 0
    ),
    linkOpenAttempts: Math.max(
      a.linkOpenAttempts ?? 0,
      b.linkOpenAttempts ?? 0
    ),
    linkEstablishedCount: Math.max(
      a.linkEstablishedCount ?? 0,
      b.linkEstablishedCount ?? 0
    ),
    linkEstablishedAtMs: Math.max(
      a.linkEstablishedAtMs ?? 0,
      b.linkEstablishedAtMs ?? 0
    ),
    linkAuthSentCount: Math.max(
      a.linkAuthSentCount ?? 0,
      b.linkAuthSentCount ?? 0
    ),
    linkAuthRxCount: Math.max(a.linkAuthRxCount ?? 0, b.linkAuthRxCount ?? 0),
    linkAuthAppliedCount: Math.max(
      a.linkAuthAppliedCount ?? 0,
      b.linkAuthAppliedCount ?? 0
    ),
    lastLinkAuthAtMs: Math.max(a.lastLinkAuthAtMs ?? 0, b.lastLinkAuthAtMs ?? 0),
    lastLinkAuthReason: b.lastLinkAuthAtMs ?? 0 > (a.lastLinkAuthAtMs ?? 0)
      ? b.lastLinkAuthReason
      : a.lastLinkAuthReason,
    linkStaleCloseCount: Math.max(
      a.linkStaleCloseCount ?? 0,
      b.linkStaleCloseCount ?? 0
    ),
    linkFallbackActive:
      a.linkFallbackActive || b.linkFallbackActive || undefined,
    pathDiversityActive:
      a.pathDiversityActive || b.pathDiversityActive || undefined,
    pathDiversityMirrorAttempts:
      (a.pathDiversityMirrorAttempts ?? 0) +
      (b.pathDiversityMirrorAttempts ?? 0),
    pathDiversityMirrorSuccesses:
      (a.pathDiversityMirrorSuccesses ?? 0) +
      (b.pathDiversityMirrorSuccesses ?? 0),
    pathDiversityMirrorFailures:
      (a.pathDiversityMirrorFailures ?? 0) +
      (b.pathDiversityMirrorFailures ?? 0),
    ...(b.targetAddress
      ? { targetAddress: b.targetAddress }
      : a.targetAddress
        ? { targetAddress: a.targetAddress }
        : {}),
    ...(b.peerPresenceHash
      ? { peerPresenceHash: b.peerPresenceHash }
      : a.peerPresenceHash
        ? { peerPresenceHash: a.peerPresenceHash }
        : {}),
    ...(b.routeKey
      ? { routeKey: b.routeKey }
      : a.routeKey
        ? { routeKey: a.routeKey }
        : {}),
    ...(b.linkId ? { linkId: b.linkId } : a.linkId ? { linkId: a.linkId } : {}),
    ...(b.linkEstablished != null
      ? { linkEstablished: b.linkEstablished }
      : a.linkEstablished != null
        ? { linkEstablished: a.linkEstablished }
        : {}),
    ...(b.linkOpening != null
      ? { linkOpening: b.linkOpening }
      : a.linkOpening != null
        ? { linkOpening: a.linkOpening }
        : {}),
    ...(b.linkOpenedByOwner !== undefined
      ? { linkOpenedByOwner: b.linkOpenedByOwner }
      : a.linkOpenedByOwner !== undefined
        ? { linkOpenedByOwner: a.linkOpenedByOwner }
        : {}),
    ...(linkClose.lastLinkCloseReason
      ? {
          lastLinkCloseReason: linkClose.lastLinkCloseReason,
          lastLinkCloseAtMs: linkClose.lastLinkCloseAtMs,
          lastLinkCloseLinkId: linkClose.lastLinkCloseLinkId,
        }
      : {}),
    ...(linkUnready.lastLinkUnreadyReason
      ? {
          lastLinkUnreadyReason: linkUnready.lastLinkUnreadyReason,
          lastLinkUnreadyAtMs: linkUnready.lastLinkUnreadyAtMs,
          lastLinkUnreadyLinkId: linkUnready.lastLinkUnreadyLinkId,
        }
      : {}),
    linkFallbackProbeCount: Math.max(
      a.linkFallbackProbeCount ?? 0,
      b.linkFallbackProbeCount ?? 0
    ),
    linkFallbackExitCount: Math.max(
      a.linkFallbackExitCount ?? 0,
      b.linkFallbackExitCount ?? 0
    ),
    linkFallbackLastDwellMs: Math.max(
      a.linkFallbackLastDwellMs ?? 0,
      b.linkFallbackLastDwellMs ?? 0
    ),
    bridge: b.bridge ?? a.bridge ?? a.bridge,
  };
}

export interface GcReticulumAudioLinkStats {
  roomId: string;
  establishedLinks: number;
  participants: number;
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
const RECENT_BOOTSTRAP_PARTICIPANT_ACTIVITY_TTL_MS = 45_000;
const RECENT_ROOM_REMOTE_REJOIN_GRACE_MS = 3_500;

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
        ? {
            reticulumIdentityPublicKeyBase64:
              p.reticulumIdentityPublicKeyBase64,
          }
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

function buildGcJoinSignedFields(
  env: GcJoinEnvelope
): Record<string, unknown> {
  return {
    type: env.type,
    roomId: env.roomId,
    chatId: env.chatId,
    fromAddress: env.fromAddress,
    fromPublicKey: env.fromPublicKey,
    timestamp: env.timestamp,
    reticulumDestinationHash: env.reticulumDestinationHash
      .trim()
      .toLowerCase(),
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
  };
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
      kind: 'link_auth_join';
      env: GcJoinEnvelope;
      linkId: string;
      peerDestinationHash: string;
      peerPresenceHash?: string;
      incoming: boolean | null;
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
  | {
      kind: 'key_request';
      env: GcKeyRequestEnvelope;
      peerPresenceHash?: string;
    };

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
/** Buffer inbound GC_JOIN until joinRoom registers the room (align with GC_JOIN_RK pending TTL). */
const PENDING_GC_JOIN_BEFORE_JOIN_ROOM_MS = 120_000;
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

export function getReticulumOverlayLogicalDedupeKey(
  wire: Record<string, unknown>
): string | null {
  const t = typeof wire.t === 'string' ? wire.t : null;
  if (!t) return null;
  const z = typeof wire.z === 'string' ? wire.z : null;
  const x =
    typeof wire.x === 'number' && Number.isFinite(wire.x)
      ? Math.max(0, Math.trunc(wire.x))
      : null;
  const g = typeof wire.g === 'string' ? wire.g : null;

  if (z && x !== null) {
    return `${t}:z:${z}:x:${x}`;
  }
  if (z) {
    return `${t}:z:${z}`;
  }
  if (g) {
    return `${t}:g:${g}`;
  }
  return null;
}

// ── GroupCallManager ────────────────────────────────────────────────────────── ──────────────────────────────────────────────────────────

let _instance: GroupCallManager | null = null;

export function startGroupCallManager(
  presence: PresenceManager,
  reticulumBridge?: ReticulumBridge | null
): GroupCallManager {
  if (_instance) _instance.stop();
  _instance = new GroupCallManager(presence, reticulumBridge ?? null);
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
  private presence: PresenceManager;
  private reticulumBridge: ReticulumBridge | null;
  private started = false;
  private localAddresses = new Set<string>();
  private localAddressesBySource = new Map<string, Set<string>>();
  private rooms = new Map<string, GroupRoom>();
  private recentRoomStateByRoomId = new Map<string, RecentRoomState>();
  private recentBootstrapParticipantActivityByRoom = new Map<
    string,
    Map<string, number>
  >();

  /** Cache address → nodeId learned from GC_JOIN, retained for diagnostics / legacy compatibility. */
  private participantNodeIds = new Map<string, string>();
  /** Fallback address → peer presence hash learned from verified inbound Reticulum traffic. */
  private reticulumPeerPresenceHashByAddress = new Map<string, string>();
  /** Reverse Reticulum hash lookup for inbound audio/link events with no address context. */
  private reticulumAddressByPeerPresenceHash = new Map<string, string>();
  private reticulumAudioAwaitingRouteByAddress = new Map<
    string,
    ReticulumAudioAwaitingRouteState
  >();
  private reticulumAudioPeersByAddress = new Map<
    string,
    ReticulumAudioPeerState
  >();
  private reticulumAudioAddressByLinkId = new Map<string, string>();
  private reticulumAudioOpenDeferUntilByAddress = new Map<string, number>();
  private reticulumAudioOpenDeferTimersByAddress = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private reticulumAudioFlushScheduled = false;
  private reticulumAudioFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private reticulumLeaveLinkDrainTimers = new Set<
    ReturnType<typeof setTimeout>
  >();
  private reticulumAudioFlushCursor = 0;
  /** Wall clock ms until which flush caps are scaled after media recovery (see GC_RETICULUM_MEDIA_RECOVERY_FLUSH_BOOST_MS). */
  private reticulumAudioFlushBoostUntilMs = 0;
  /** Renderer-reported fail-safe clamps aggressive main-process flush (optional stage 6). */
  private gcallAudioFailSafeActive = false;
  private bridgeWaitingForDrainSinceMs: number | null = null;
  private binaryOutHighPressureSinceMs: number | null = null;
  private lastStage5FlushBoostAtMs = 0;
  private lastStage5FlushBoostPacketFailures = 0;

  private presenceExpiredHandler: (address: string) => void;
  private onReticulumGroupCallMessage:
    | ((
        wire: Record<string, unknown>,
        senderDestinationHash: string,
        peerPresenceHash: string,
        linkId?: string
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
  private static readonly CALL_ACTIVITY_EVICTION_STALE_MS = 45_000;
  private transportHealthByRoom = new Map<
    string,
    { reportedAtMs: number; healthyPeerAddresses: Set<string> }
  >();
  private recentCallActivityByRoom = new Map<string, Map<string, number>>();

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
  /** GC_JOIN / GJ before joinRoom registered `roomId` (race: peer sends join first). */
  private pendingGcJoinBeforeJoinRoom = new Map<
    string,
    Array<{
      env: GcJoinEnvelope;
      fromNodeId?: string;
      peerPresenceHash?: string;
      deadlineMs: number;
    }>
  >();
  /** Latest verified authoritative key state retained per room+local recipient for subscribe-time replay. */
  private retainedVerifiedKeyStateByRoomAndRecipient = new Map<
    string,
    RetainedVerifiedKeyState
  >();
  /** Verified/local GC_JOIN retained per room+address so late joiners can learn peer identity quickly. */
  private retainedVerifiedJoinByRoomAndAddress = new Map<
    string,
    GcJoinEnvelope
  >();
  /** Verified/local GC_JOIN_RK retained per room+address for late-join identity replay. */
  private retainedVerifiedJoinRkByRoomAndAddress = new Map<
    string,
    GcJoinRkEnvelope
  >();
  /** roomId:address -> last verified leave timestamp; blocks stale delayed joins from resurrecting peers. */
  private leftParticipantTimestampByRoomAndAddress = new Map<string, number>();
  /** roomId:epoch:target → retained GC_JOIN identity replay attempts after topology publish. */
  private retainedJoinIdentityReplayAttemptsByTopology = new Map<
    string,
    number
  >();
  /** roomId → verified key/rotate still needs renderer session reconciliation. */
  private pendingVerifiedSessionUpdateByRoom = new Map<
    string,
    { callSessionId: string; mediaSessionGeneration: number }
  >();
  private pendingKeyFlushSuccess = 0;
  private pendingKeyExpired = 0;
  private unknownRoomKeyLogAt = new Map<string, number>();
  private pendingKeyExpiredLogAt = new Map<string, number>();
  private reticulumFailureLogAt = new Map<string, number>();
  private seenReticulumOverlayIds = new Map<string, number>();
  /** Logical message key → expiry (wall ms): suppress short-lived duplicate relays of the same authored message. */
  private seenReticulumWireLogicalKeys = new Map<string, number>();
  private lastReticulumWireLogicalKeySweepAt = 0;

  /** Numeric Qortal group ids (from renderer) to derive sidebar call indicators. */
  private watchedQortalGroupNumericIds = new Set<number>();
  /** Watched rooms not locally joined: last wall time we received a Reticulum activity hint. */
  private spectatorReticulumLivenessAt = new Map<string, number>();
  /** Qortal roomId → authoritative group member addresses to target with Reticulum activity hints. */
  private qortalReticulumTargetsByRoomId = new Map<string, Set<string>>();
  private qortalActivityEmitTimer: ReturnType<typeof setTimeout> | null = null;
  private qortalReticulumExpiryTimer: ReturnType<typeof setTimeout> | null =
    null;
  private qortalSpectatorSweepTimer: ReturnType<typeof setInterval> | null =
    null;
  private qortalReticulumHeartbeatTimer: ReturnType<typeof setInterval> | null =
    null;
  private reticulumAudioLinkHeartbeatTimer: ReturnType<
    typeof setInterval
  > | null = null;

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
    const bootstrap = buildGroupRoomBootstrapState(room, nowMs, true);
    if (bootstrap.participants.length > 1) {
      const recentActivity = this.recentBootstrapParticipantActivityByRoom.get(
        room.roomId
      );
      bootstrap.participants = bootstrap.participants.filter((participant) => {
        if (this.localAddresses.has(participant.address)) return true;
        const lastActivityAtMs =
          recentActivity?.get(participant.address) ?? participant.joinedAt ?? 0;
        return (
          nowMs - lastActivityAtMs <=
          RECENT_BOOTSTRAP_PARTICIPANT_ACTIVITY_TTL_MS
        );
      });
    }
    return {
      ...bootstrap,
      cachedAtMs: nowMs,
    };
  }

  private getFreshRecentRoomState(
    roomId: string,
    nowMs = Date.now()
  ): RecentRoomState | null {
    if (GCALL_DISABLE_ROOM_BOOTSTRAP_CACHE) return null;
    const cached = this.recentRoomStateByRoomId.get(roomId);
    if (!cached) return null;
    if (!isRecentRoomStateFresh(cached.cachedAtMs, nowMs)) {
      this.recentRoomStateByRoomId.delete(roomId);
      return null;
    }
    return cached;
  }

  private hasFreshSpectatorReticulumLivenessSince(
    roomId: string,
    sinceMs: number,
    nowMs = Date.now()
  ): boolean {
    const at = this.spectatorReticulumLivenessAt.get(roomId);
    if (typeof at !== 'number') return false;
    return at > sinceMs && nowMs - at <= GC_RETICULUM_ACTIVITY_MAX_AGE_MS;
  }

  private shouldTrustRecentRemoteState(
    recent: RecentRoomState,
    nowMs = Date.now()
  ): boolean {
    if (recent.participants.length <= 1 && !recent.lastTopology) {
      return true;
    }
    if (nowMs - recent.cachedAtMs <= RECENT_ROOM_REMOTE_REJOIN_GRACE_MS) {
      return true;
    }
    return this.hasFreshSpectatorReticulumLivenessSince(
      recent.roomId,
      recent.cachedAtMs,
      nowMs
    );
  }

  private getUsableRecentRoomState(
    roomId: string,
    nowMs = Date.now()
  ): RecentRoomState | null {
    const recent = this.getFreshRecentRoomState(roomId, nowMs);
    if (!recent) return null;
    if (this.shouldTrustRecentRemoteState(recent, nowMs)) {
      return recent;
    }
    return {
      ...recent,
      participants: recent.participants.filter((participant) =>
        this.localAddresses.has(participant.address)
      ),
      topologyEpoch: 0,
      lastTopology: undefined,
      callSessionId: '',
      mediaSessionGeneration: 1,
      fromRecentCache: false,
    };
  }

  private rememberRecentRoomState(room: GroupRoom, nowMs = Date.now()): void {
    if (GCALL_DISABLE_ROOM_BOOTSTRAP_CACHE) return;
    this.recentRoomStateByRoomId.set(
      room.roomId,
      this.buildRecentRoomState(room, nowMs)
    );
  }

  private noteBootstrapParticipantActivity(
    roomId: string,
    address: string,
    atMs = Date.now()
  ): void {
    if (GCALL_DISABLE_ROOM_BOOTSTRAP_CACHE) return;
    const trimmed = address.trim();
    if (!trimmed) return;
    let byAddress = this.recentBootstrapParticipantActivityByRoom.get(roomId);
    if (!byAddress) {
      byAddress = new Map<string, number>();
      this.recentBootstrapParticipantActivityByRoom.set(roomId, byAddress);
    }
    byAddress.set(trimmed, atMs);
  }

  private clearBootstrapParticipantActivityForRoom(roomId: string): void {
    this.recentBootstrapParticipantActivityByRoom.delete(roomId);
  }

  private clearBootstrapParticipantActivityForAddress(
    roomId: string,
    address: string
  ): void {
    const byAddress = this.recentBootstrapParticipantActivityByRoom.get(roomId);
    if (!byAddress) return;
    byAddress.delete(address);
    if (byAddress.size === 0) {
      this.recentBootstrapParticipantActivityByRoom.delete(roomId);
    }
  }

  constructor(
    presence: PresenceManager,
    reticulumBridge?: ReticulumBridge | null
  ) {
    super();
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
    const normalized = this.normalizePeerPresenceHashForAudio(peerPresenceHash);
    if (!normalized) return;
    const previous = this.reticulumPeerPresenceHashByAddress.get(address);
    if (previous) {
      this.reticulumAddressByPeerPresenceHash.delete(
        this.normalizePeerPresenceHashForAudio(previous)
      );
    }
    this.reticulumPeerPresenceHashByAddress.set(address, normalized);
    this.reticulumAddressByPeerPresenceHash.set(normalized, address);
    this.promoteAwaitingRouteReticulumAudio(address);
  }

  private forgetReticulumPeerPresenceHash(address: string): void {
    const previous = this.reticulumPeerPresenceHashByAddress.get(address);
    if (previous) {
      this.reticulumAddressByPeerPresenceHash.delete(
        this.normalizePeerPresenceHashForAudio(previous)
      );
    }
    this.reticulumPeerPresenceHashByAddress.delete(address);
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
      peerPresenceHash,
      linkId
    ) => {
      try {
        this.handleReticulumGroupCallWire(
          wire,
          senderDestinationHash,
          peerPresenceHash,
          linkId
        );
      } catch (err) {
        loggerError('[GCall] Error handling Reticulum group call wire:', err);
      }
    };
    this.onReticulumGroupAudioPacket = (payload) => {
      try {
        this.handleReticulumGroupAudioPacket(payload);
      } catch (err) {
        loggerError(
          '[GCall] Error handling Reticulum group audio packet:',
          err
        );
      }
    };
    this.onReticulumGroupAudioLinkEstablished = (payload) => {
      try {
        this.handleReticulumGroupAudioLinkEstablished(payload);
      } catch (err) {
        loggerError(
          '[GCall] Error handling Reticulum group audio link ready:',
          err
        );
      }
    };
    this.onReticulumGroupAudioLinkClosed = (payload) => {
      try {
        this.handleReticulumGroupAudioLinkClosed(payload);
      } catch (err) {
        loggerError(
          '[GCall] Error handling Reticulum group audio link close:',
          err
        );
      }
    };
    this.onReticulumGroupAudioSendFailed = (payload) => {
      try {
        this.handleReticulumGroupAudioSendFailed(payload);
      } catch (err) {
        loggerError(
          '[GCall] Error handling Reticulum audio send failure:',
          err
        );
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
    } else if (job.kind === 'link_auth_join') {
      loggerLog(
        `[GCall] Dropped Reticulum link auth GC_JOIN: invalid signature from ${job.env.fromAddress}`
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
      if (job.kind === 'link_auth_join') {
        try {
          this.applyVerifiedJobSync(job);
        } catch (err) {
          loggerError('[GCall] Error applying cached verified message:', err);
        }
      }
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
    if (job.kind === 'join' || job.kind === 'link_auth_join') {
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
      case 'link_auth_join':
        this.applyVerifiedJoin(job.env);
        this.applyVerifiedReticulumLinkAuthJoin(job);
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
    this.reticulumAudioLinkHeartbeatTimer = setInterval(() => {
      this.tickReticulumAudioLinkHeartbeats();
    }, GC_RETICULUM_AUDIO_LINK_HEARTBEAT_TICK_MS);
    this.reticulumAudioLinkHeartbeatTimer.unref?.();

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
    this.localAddresses.clear();
    this.localAddressesBySource.clear();
    this.participantNodeIds.clear();
    this.reticulumPeerPresenceHashByAddress.clear();
    this.reticulumAddressByPeerPresenceHash.clear();
    for (const state of this.reticulumAudioAwaitingRouteByAddress.values()) {
      if (state.retryTimer) clearTimeout(state.retryTimer);
    }
    this.reticulumAudioAwaitingRouteByAddress.clear();
    this.reticulumAudioPeersByAddress.clear();
    this.reticulumAudioAddressByLinkId.clear();
    this.reticulumAudioFlushScheduled = false;
    if (this.reticulumAudioFlushTimer) {
      clearTimeout(this.reticulumAudioFlushTimer);
      this.reticulumAudioFlushTimer = null;
    }
    for (const timer of this.reticulumLeaveLinkDrainTimers) {
      clearTimeout(timer);
    }
    this.reticulumLeaveLinkDrainTimers.clear();
    this.reticulumAudioFlushCursor = 0;
    this.rooms.clear();
    this.verifiedGcSignatures.clear();
    this.inFlightGcVerify.clear();
    this.lastStaleTopologyLogAt = 0;
    this.joinDropLogAt.clear();
    this.broadcastTopologyNoRoomLogAt.clear();
    this.pendingKeyByRoom.clear();
    this.pendingGcJoinBeforeJoinRoom.clear();
    this.retainedVerifiedKeyStateByRoomAndRecipient.clear();
    this.retainedVerifiedJoinByRoomAndAddress.clear();
    this.retainedVerifiedJoinRkByRoomAndAddress.clear();
    this.leftParticipantTimestampByRoomAndAddress.clear();
    this.retainedJoinIdentityReplayAttemptsByTopology.clear();
    this.unknownRoomKeyLogAt.clear();
    this.pendingKeyExpiredLogAt.clear();
    this.transportHealthByRoom.clear();
    this.recentCallActivityByRoom.clear();
    this.recentRoomStateByRoomId.clear();
    this.seenReticulumOverlayIds.clear();
    this.seenReticulumWireLogicalKeys.clear();
    this.lastReticulumWireLogicalKeySweepAt = 0;
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
    if (this.reticulumAudioLinkHeartbeatTimer) {
      clearInterval(this.reticulumAudioLinkHeartbeatTimer);
      this.reticulumAudioLinkHeartbeatTimer = null;
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

  setLocalAddresses(addresses: string[], source = 'default'): void {
    const normalizedSource = source.trim() || 'default';
    const next = new Set<string>();
    for (const raw of addresses) {
      if (typeof raw !== 'string') continue;
      const address = raw.trim();
      if (!address) continue;
      next.add(address);
    }
    if (next.size > 0) {
      this.localAddressesBySource.set(normalizedSource, next);
    } else {
      this.localAddressesBySource.delete(normalizedSource);
    }
    const merged = new Set<string>();
    for (const registered of this.localAddressesBySource.values()) {
      for (const address of registered) merged.add(address);
    }
    this.localAddresses = merged;
    loggerLog(
      `[GCall] Local addresses set source=${normalizedSource}: ${[...this.localAddresses].join(', ')}`
    );
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

  /** Renderer-reported staged escalation (fail-safe clamps aggressive flush in `getReticulumAudioFlushLimits`). */
  reportGcallAudioEscalation(opts: { failSafeActive?: boolean }): void {
    this.gcallAudioFailSafeActive = opts.failSafeActive === true;
  }

  getReticulumAudioLinkStats(roomId: string): GcReticulumAudioLinkStats {
    const normalizedRoomId = roomId.trim();
    const room = this.rooms.get(normalizedRoomId);
    let establishedLinks = 0;
    for (const state of this.reticulumAudioPeersByAddress.values()) {
      if (
        state.rooms.has(normalizedRoomId) &&
        state.established &&
        Boolean(state.linkId)
      ) {
        establishedLinks += 1;
      }
    }
    return {
      roomId: normalizedRoomId,
      establishedLinks,
      participants: room?.participants.size ?? 0,
    };
  }

  private refreshReticulumAudioPressureDwell(): void {
    const snap = this.reticulumBridge?.getAudioQueueSnapshot();
    const now = Date.now();
    if (!snap) {
      this.bridgeWaitingForDrainSinceMs = null;
      this.binaryOutHighPressureSinceMs = null;
      return;
    }
    if (snap.bridgeWaitingForDrain) {
      if (this.bridgeWaitingForDrainSinceMs === null) {
        this.bridgeWaitingForDrainSinceMs = now;
      }
    } else {
      this.bridgeWaitingForDrainSinceMs = null;
    }
    if (snap.binaryOutQueueDepth >= STAGE5_BYPASS_BINARY_OUT_HW) {
      if (this.binaryOutHighPressureSinceMs === null) {
        this.binaryOutHighPressureSinceMs = now;
      }
    } else {
      this.binaryOutHighPressureSinceMs = null;
    }
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
    const holdAudio =
      shouldHoldAudioForReticulumRecoveryReason(normalizedReason);
    const now = Date.now();
    this.refreshReticulumAudioPressureDwell();
    const snap = this.reticulumBridge?.getAudioQueueSnapshot();
    const sinceLast = now - this.lastStage5FlushBoostAtMs;
    const bypassCooldown =
      (this.bridgeWaitingForDrainSinceMs !== null &&
        now - this.bridgeWaitingForDrainSinceMs >=
          STAGE5_BYPASS_BRIDGE_WAITING_MS) ||
      (this.binaryOutHighPressureSinceMs !== null &&
        now - this.binaryOutHighPressureSinceMs >=
          STAGE5_BYPASS_BINARY_OUT_DWELL_MS) ||
      (snap != null &&
        snap.queuePressureDropsLast5s >= STAGE5_BYPASS_QUEUE_PRESSURE_LAST5S &&
        snap.bridgeQueuedFrames >=
          GC_RETICULUM_AUDIO_PRESSURE_BRIDGE_QUEUE_FRAMES) ||
      (snap != null &&
        snap.packetSendFailures > this.lastStage5FlushBoostPacketFailures);
    const extendFlushBoost =
      sinceLast >= STAGE5_REESCALATION_COOLDOWN_MS || bypassCooldown;
    if (extendFlushBoost) {
      this.reticulumAudioFlushBoostUntilMs = Math.max(
        this.reticulumAudioFlushBoostUntilMs,
        now + GC_RETICULUM_MEDIA_RECOVERY_FLUSH_BOOST_MS
      );
      this.lastStage5FlushBoostAtMs = now;
      if (snap) {
        this.lastStage5FlushBoostPacketFailures = snap.packetSendFailures;
      }
    }
    this.requestReticulumAudioRecovery(
      normalizedRoomId,
      normalizedAddress,
      normalizedReason,
      {
        force: true,
        holdAudio,
        protectPacketPath:
          shouldRequestPacketProtectionForReticulumRecoveryReason(
            normalizedReason
          ),
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

  private sweepExpiredPendingGcJoin(now: number = Date.now()): void {
    if (this.pendingGcJoinBeforeJoinRoom.size === 0) return;
    for (const [roomId, list] of [...this.pendingGcJoinBeforeJoinRoom]) {
      const alive = list.filter((e) => e.deadlineMs > now);
      if (alive.length === 0) this.pendingGcJoinBeforeJoinRoom.delete(roomId);
      else if (alive.length !== list.length)
        this.pendingGcJoinBeforeJoinRoom.set(roomId, alive);
    }
  }

  private enqueuePendingGcJoinBeforeJoinRoom(
    env: GcJoinEnvelope,
    fromNodeId?: string,
    peerPresenceHash?: string
  ): void {
    const roomId = env.roomId;
    const now = Date.now();
    const deadlineMs = now + PENDING_GC_JOIN_BEFORE_JOIN_ROOM_MS;
    let list = this.pendingGcJoinBeforeJoinRoom.get(roomId) ?? [];
    list = list.filter((e) => e.deadlineMs > now);
    const filtered = list.filter((e) => e.env.fromAddress !== env.fromAddress);
    filtered.push({ env, fromNodeId, peerPresenceHash, deadlineMs });
    const MAX_PENDING_GC_JOIN_PER_ROOM = 16;
    if (filtered.length > MAX_PENDING_GC_JOIN_PER_ROOM) {
      filtered.splice(0, filtered.length - MAX_PENDING_GC_JOIN_PER_ROOM);
    }
    this.pendingGcJoinBeforeJoinRoom.set(roomId, filtered);
    this.logGcJoinDropThrottled(
      env.fromAddress,
      'queued_until_join',
      `[GCall] Queued GC_JOIN (await joinRoom) for room ${roomId} from ${env.fromAddress}`
    );
  }

  private flushPendingGcJoinForRoom(roomId: string): void {
    const pending = this.pendingGcJoinBeforeJoinRoom.get(roomId);
    if (!pending || pending.length === 0) return;
    this.pendingGcJoinBeforeJoinRoom.delete(roomId);
    const now = Date.now();
    for (const item of pending) {
      if (now > item.deadlineMs) continue;
      this.handleJoin(item.env, item.fromNodeId, item.peerPresenceHash);
    }
  }

  private hasLocalRoomInterest(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  private retainedKeyStateKey(
    roomId: string,
    recipientAddress: string
  ): string {
    return `${roomId}:${recipientAddress}`;
  }

  private retainedJoinStateKey(roomId: string, address: string): string {
    return `${roomId}:${address}`;
  }

  private noteParticipantLeft(
    roomId: string,
    address: string,
    timestamp: number
  ): void {
    if (!roomId || !address || !Number.isFinite(timestamp)) return;
    const key = this.retainedJoinStateKey(roomId, address);
    const previous =
      this.leftParticipantTimestampByRoomAndAddress.get(key) ?? 0;
    if (timestamp >= previous) {
      this.leftParticipantTimestampByRoomAndAddress.set(key, timestamp);
    }
  }

  private clearParticipantLeftTombstone(roomId: string, address: string): void {
    this.leftParticipantTimestampByRoomAndAddress.delete(
      this.retainedJoinStateKey(roomId, address)
    );
  }

  private getParticipantLeftTimestamp(
    roomId: string,
    address: string
  ): number | undefined {
    return this.leftParticipantTimestampByRoomAndAddress.get(
      this.retainedJoinStateKey(roomId, address)
    );
  }

  private clearRetainedVerifiedKeyStatesForRoom(roomId: string): void {
    for (const key of this.retainedVerifiedKeyStateByRoomAndRecipient.keys()) {
      if (key.startsWith(`${roomId}:`)) {
        this.retainedVerifiedKeyStateByRoomAndRecipient.delete(key);
      }
    }
  }

  private clearRetainedVerifiedJoinStatesForRoom(roomId: string): void {
    for (const key of this.retainedVerifiedJoinByRoomAndAddress.keys()) {
      if (key.startsWith(`${roomId}:`)) {
        this.retainedVerifiedJoinByRoomAndAddress.delete(key);
      }
    }
    for (const key of this.retainedVerifiedJoinRkByRoomAndAddress.keys()) {
      if (key.startsWith(`${roomId}:`)) {
        this.retainedVerifiedJoinRkByRoomAndAddress.delete(key);
      }
    }
    for (const key of this.retainedJoinIdentityReplayAttemptsByTopology.keys()) {
      if (key.startsWith(`${roomId}:`)) {
        this.retainedJoinIdentityReplayAttemptsByTopology.delete(key);
      }
    }
    for (const key of this.leftParticipantTimestampByRoomAndAddress.keys()) {
      if (key.startsWith(`${roomId}:`)) {
        this.leftParticipantTimestampByRoomAndAddress.delete(key);
      }
    }
  }

  private dropRetainedVerifiedJoinState(roomId: string, address: string): void {
    const key = this.retainedJoinStateKey(roomId, address);
    this.retainedVerifiedJoinByRoomAndAddress.delete(key);
    this.retainedVerifiedJoinRkByRoomAndAddress.delete(key);
  }

  private noteRecentCallActivity(
    roomId: string,
    address: string,
    atMs = Date.now()
  ): void {
    if (!roomId || !address) return;
    let byAddress = this.recentCallActivityByRoom.get(roomId);
    if (!byAddress) {
      byAddress = new Map<string, number>();
      this.recentCallActivityByRoom.set(roomId, byAddress);
    }
    byAddress.set(address, atMs);
  }

  private getRecentCallActivityAt(roomId: string, address: string): number {
    return this.recentCallActivityByRoom.get(roomId)?.get(address) ?? 0;
  }

  private clearRecentCallActivityForRoom(roomId: string): void {
    this.recentCallActivityByRoom.delete(roomId);
  }

  private clearRecentCallActivityForAddress(
    roomId: string,
    address: string
  ): void {
    const byAddress = this.recentCallActivityByRoom.get(roomId);
    if (!byAddress) return;
    byAddress.delete(address);
    if (byAddress.size === 0) {
      this.recentCallActivityByRoom.delete(roomId);
    }
  }

  private noteRecentCallActivityForTopology(
    roomId: string,
    topology: Pick<
      GcTopologyEnvelope,
      'rootForwarder' | 'standbyForwarder' | 'clusters'
    >,
    atMs = Date.now()
  ): void {
    const seen = new Set<string>();
    const note = (address?: string | null) => {
      const trimmed = (address ?? '').trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      this.noteRecentCallActivity(roomId, trimmed, atMs);
    };
    note(topology.rootForwarder);
    note(topology.standbyForwarder);
    for (const cluster of topology.clusters ?? []) {
      note(cluster.forwarder);
      note(cluster.standby);
      note(cluster.standby2);
      for (const member of cluster.members ?? []) {
        note(member);
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

  private rememberRetainedVerifiedJoin(env: GcJoinEnvelope): void {
    this.retainedVerifiedJoinByRoomAndAddress.set(
      this.retainedJoinStateKey(env.roomId, env.fromAddress),
      {
        ...env,
        reticulumDestinationHash: env.reticulumDestinationHash
          .trim()
          .toLowerCase(),
      }
    );
  }

  private rememberRetainedVerifiedJoinRk(env: GcJoinRkEnvelope): void {
    this.retainedVerifiedJoinRkByRoomAndAddress.set(
      this.retainedJoinStateKey(env.roomId, env.fromAddress),
      {
        ...env,
        reticulumDestinationHash: env.reticulumDestinationHash
          .trim()
          .toLowerCase(),
      }
    );
  }

  private shouldReplayRetainedJoinIdentityForLateJoin(
    roomId: string,
    newcomerAddress: string
  ): boolean {
    const room = this.rooms.get(roomId);
    if (!room || !newcomerAddress) return false;
    const rootForwarder = room.lastTopology?.rootForwarder?.trim() ?? '';
    if (!rootForwarder || !this.localAddresses.has(rootForwarder)) return false;
    return room.participants.size > 1;
  }

  private replayRetainedJoinIdentityToAddress(
    roomId: string,
    targetAddress: string,
    excludeAddress: string
  ): void {
    if (!targetAddress || this.localAddresses.has(targetAddress)) return;
    const frames: Record<string, unknown>[] = [];
    for (const [key, joinEnv] of this.retainedVerifiedJoinByRoomAndAddress) {
      if (!key.startsWith(`${roomId}:`)) continue;
      if (joinEnv.fromAddress === excludeAddress) continue;
      frames.push(
        encodeJoinWire({
          ...joinEnv,
          reticulumIdentityPublicKeyBase64: undefined,
        })
      );
      const joinRk = this.retainedVerifiedJoinRkByRoomAndAddress.get(key);
      if (
        joinRk?.reticulumIdentityPublicKeyBase64 &&
        isRnsIdentityPublicKeyBase64(joinRk.reticulumIdentityPublicKeyBase64)
      ) {
        frames.push(
          encodeJoinIdentityWire({
            fromAddress: joinRk.fromAddress,
            signature: joinRk.signature,
            timestamp: joinRk.timestamp,
            reticulumDestinationHash: joinRk.reticulumDestinationHash,
            ...(typeof joinRk.joinGeneration === 'number' &&
            Number.isFinite(joinRk.joinGeneration)
              ? { joinGeneration: joinRk.joinGeneration }
              : {}),
            reticulumIdentityPublicKeyBase64:
              joinRk.reticulumIdentityPublicKeyBase64,
          })
        );
      }
    }
    if (frames.length === 0) return;
    this.sendReticulumToAddress(targetAddress, frames, 'join_replay');
  }

  private replayRetainedJoinIdentitiesForPublishedTopology(
    roomId: string,
    topology: Pick<
      GcTopologyEnvelope,
      'topologyEpoch' | 'rootForwarder' | 'clusters'
    >
  ): void {
    const rootForwarder = topology.rootForwarder.trim();
    if (!rootForwarder || !this.localAddresses.has(rootForwarder)) return;
    const targets = new Set<string>();
    for (const cluster of topology.clusters) {
      for (const member of cluster.members ?? []) {
        const address = member.trim();
        if (address && !this.localAddresses.has(address)) {
          targets.add(address);
        }
      }
    }
    const room = this.rooms.get(roomId);
    for (const address of room?.participants.keys() ?? []) {
      if (address && !this.localAddresses.has(address)) {
        targets.add(address);
      }
    }
    for (const targetAddress of targets) {
      const replayKey = `${roomId}:${topology.topologyEpoch}:${targetAddress}`;
      const attempts =
        this.retainedJoinIdentityReplayAttemptsByTopology.get(replayKey) ?? 0;
      if (attempts >= GC_RETAINED_JOIN_IDENTITY_REPLAY_MAX_ATTEMPTS) continue;
      this.retainedJoinIdentityReplayAttemptsByTopology.set(
        replayKey,
        attempts + 1
      );
      this.replayRetainedJoinIdentityToAddress(
        roomId,
        targetAddress,
        targetAddress
      );
    }
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
  private logGcJoinWireDebugThrottled(
    dedupeKey: string,
    message: string
  ): void {
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
  ): result is {
    ok: false;
    reason: GcReticulumSendFailureReason;
    error?: string;
  } {
    if (!('reason' in result)) return false;
    return GC_RETICULUM_RETRYABLE_FAILURES.has(result.reason);
  }

  private scheduleReticulumRetry(delayMs: number, job: () => void): void {
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
    this.seenReticulumOverlayIds.set(
      overlayId,
      now + GC_RETICULUM_OVERLAY_SEEN_TTL_MS
    );
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

  private sweepExpiredReticulumWireLogicalKeys(now: number): void {
    for (const [key, expiresAt] of this.seenReticulumWireLogicalKeys) {
      if (expiresAt <= now) this.seenReticulumWireLogicalKeys.delete(key);
    }
  }

  /** Drops expired entries periodically so the map does not sit full of dead TTLs during idle periods. */
  private maybeSweepReticulumWireLogicalKeys(now: number): void {
    if (
      now - this.lastReticulumWireLogicalKeySweepAt <
      GC_RETICULUM_OVERLAY_LOGICAL_DEDUP_SWEEP_MIN_MS
    ) {
      return;
    }
    this.lastReticulumWireLogicalKeySweepAt = now;
    this.sweepExpiredReticulumWireLogicalKeys(now);
  }

  private rememberReticulumWireLogicalKey(key: string): void {
    const now = Date.now();
    this.seenReticulumWireLogicalKeys.set(
      key,
      now + GC_RETICULUM_OVERLAY_LOGICAL_DEDUP_TTL_MS
    );
    this.sweepExpiredReticulumWireLogicalKeys(now);
    while (
      this.seenReticulumWireLogicalKeys.size >
      GC_RETICULUM_OVERLAY_LOGICAL_DEDUP_MAX
    ) {
      const first = this.seenReticulumWireLogicalKeys.keys().next().value;
      if (first === undefined) break;
      this.seenReticulumWireLogicalKeys.delete(first);
    }
  }

  private hasSeenReticulumWireLogicalKey(key: string): boolean {
    const now = Date.now();
    const expiresAt = this.seenReticulumWireLogicalKeys.get(key);
    if (typeof expiresAt !== 'number') return false;
    if (expiresAt <= now) {
      this.seenReticulumWireLogicalKeys.delete(key);
      return false;
    }
    return true;
  }

  private releaseReticulumWireLogicalKey(key: string | null): void {
    if (!key) return;
    this.seenReticulumWireLogicalKeys.delete(key);
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
    return bridge.fanoutGroupCallDetailed(frames, excludePeerHashes);
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
    const firstFailure =
      await this.broadcastReticulumFramesViaOverlay(overlayFrames);
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
    const overlayFrames = frames.map((frame) =>
      this.attachReticulumOverlayMeta(frame)
    );
    const destinationHash = this.resolveReticulumPeerPresenceHash(address);
    const result = destinationHash
      ? await this.sendReticulumFramesToHash(destinationHash, overlayFrames)
      : await this.broadcastReticulumFramesViaOverlay(overlayFrames);
    if (
      retryKind &&
      this.isRetryableReticulumFailure(result) &&
      attempt < GC_RETICULUM_FIRST_CONTACT_RETRY_DELAYS_MS.length
    ) {
      this.scheduleReticulumRetry(
        GC_RETICULUM_FIRST_CONTACT_RETRY_DELAYS_MS[attempt]!,
        () =>
          this.sendReticulumToAddress(address, frames, retryKind, attempt + 1)
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

  /**
   * Full map for the groups list (watched ids only). Used when the renderer subscribes to
   * `gcall:qortal-group-call-activity` so it does not miss state emitted before subscribe.
   */
  getQortalGroupCallActivitySnapshotForSidebar(): Record<string, boolean> {
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
    for (const [roomId, at] of [
      ...this.spectatorReticulumLivenessAt.entries(),
    ]) {
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
    const roomIds = roomId
      ? [roomId]
      : [...this.qortalReticulumTargetsByRoomId.keys()];
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
    if (!this.shouldSendReticulumGroupActivity(room)) return;
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

  private shouldSendReticulumGroupActivity(room: GroupRoom): boolean {
    let localIsParticipant = false;
    for (const address of this.localAddresses) {
      if (room.participants.has(address)) {
        localIsParticipant = true;
        break;
      }
    }
    if (!localIsParticipant) return false;
    if (room.participants.size <= 1) return true;
    const rootForwarder = room.lastTopology?.rootForwarder?.trim();
    return Boolean(rootForwarder && this.localAddresses.has(rootForwarder));
  }

  private handleReticulumGroupCallWire(
    wire: Record<string, unknown>,
    senderDestinationHash: string,
    peerPresenceHash: string,
    linkId = ''
  ): void {
    const now = Date.now();
    this.maybeSweepReticulumWireLogicalKeys(now);

    let overlayLogicalKey: string | null = null;
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
      overlayLogicalKey = getReticulumOverlayLogicalDedupeKey(wire);
      if (
        overlayLogicalKey !== null &&
        this.hasSeenReticulumWireLogicalKey(overlayLogicalKey)
      ) {
        const t = typeof wire.t === 'string' ? wire.t : String(wire.t ?? '?');
        this.logGcJoinWireDebugThrottled(
          `overlay_logical_dup:${overlayLogicalKey}`,
          `[GCall] Dropped Reticulum wire (duplicate logical message across overlay replays): t=${t} key=${overlayLogicalKey.slice(0, 48)}…`
        );
        return;
      }
      this.rememberReticulumOverlayId(overlayMeta.overlayId);
      if (overlayLogicalKey !== null) {
        this.rememberReticulumWireLogicalKey(overlayLogicalKey);
      }
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

    if (t === GC_RETICULUM_AUDIO_LINK_HEARTBEAT_WIRE_TYPE) {
      const decoded = decodeGcReticulumAudioLinkHeartbeatWire(wire);
      if (!decoded) return;
      this.handleReticulumAudioLinkHeartbeatWire(
        decoded,
        senderDestinationHash,
        peerPresenceHash,
        linkId
      );
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
      this.processJoinIdentityVerify(decoded, syntheticFrom, peerPresenceHash);
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
      if (!buf || pr.n !== buf.meta.n) {
        this.releaseReticulumWireLogicalKey(overlayLogicalKey);
        return;
      }
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
      if (!buf || pr.n !== buf.meta.n) {
        this.releaseReticulumWireLogicalKey(overlayLogicalKey);
        return;
      }
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
      if (!buf || pr.n !== buf.meta.n) {
        this.releaseReticulumWireLogicalKey(overlayLogicalKey);
        return;
      }
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
      if (!buf || pr.n !== buf.meta.n) {
        this.releaseReticulumWireLogicalKey(overlayLogicalKey);
        return;
      }
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
      throw new Error(
        'Invalid or missing reticulumDestinationHash for GC_JOIN'
      );
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
      const recent = GCALL_DISABLE_ROOM_BOOTSTRAP_CACHE
        ? null
        : this.getFreshRecentRoomState(roomId);
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
    this.noteBootstrapParticipantActivity(roomId, localAddress, timestamp);

    const wireChatId = compactDmVoiceJoinWireChatId(roomId, chatId);
    const env: GcJoinEnvelope = {
      type: 'GC_JOIN',
      roomId,
      chatId: wireChatId,
      fromAddress: localAddress,
      fromPublicKey: publicKey,
      signature,
      timestamp,
      reticulumDestinationHash: destNorm,
      ...(rk ? { reticulumIdentityPublicKeyBase64: rk } : {}),
      ...(joinGeneration !== undefined ? { joinGeneration } : {}),
    };
    this.rememberRetainedVerifiedJoin(env);
    if (rk) {
      this.rememberRetainedVerifiedJoinRk({
        type: 'GC_JOIN_RK',
        roomId,
        chatId: wireChatId,
        fromAddress: localAddress,
        fromPublicKey: publicKey,
        signature: joinRkSignature!,
        timestamp,
        reticulumDestinationHash: destNorm,
        reticulumIdentityPublicKeyBase64: rk,
        ...(joinGeneration !== undefined ? { joinGeneration } : {}),
      });
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
        loggerLog(`[GCall] Sent GC_JOIN+GI (Reticulum) for room ${roomId}`);
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
    this.flushPendingGcJoinForRoom(roomId);
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
    let shouldDelayReticulumAudioTeardown = false;
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
          const { sentLinks, skippedLinks } =
            this.sendReticulumLinkControlToEstablishedRoomLinks(
              roomId,
              [leaveWire],
              new Set([localAddress]),
              'GC_LEAVE'
            );
          void skippedLinks;
          shouldDelayReticulumAudioTeardown = sentLinks > 0;
          this.fanoutReticulumWire(
            roomId,
            [leaveWire],
            new Set([localAddress]),
            'leave'
          );
        }
      }
    } else {
      loggerWarn(
        `[GCall] Missing GC_LEAVE signature for ${localAddress} in ${roomId} — clearing local room only`
      );
      this.participantNodeIds.delete(localAddress);
      this.forgetReticulumPeerPresenceHash(localAddress);
      this.clearAwaitingRouteReticulumAudio(localAddress);
    }
    if (room) this.rememberRecentRoomState(room, timestamp);
    this.pendingKeyByRoom.delete(roomId);
    this.pendingGcJoinBeforeJoinRoom.delete(roomId);
    this.pendingVerifiedSessionUpdateByRoom.delete(roomId);
    this.clearRetainedVerifiedKeyStatesForRoom(roomId);
    this.clearRetainedVerifiedJoinStatesForRoom(roomId);
    this.clearRecentCallActivityForRoom(roomId);
    this.clearBootstrapParticipantActivityForRoom(roomId);
    this.rooms.delete(roomId);
    this.qortalReticulumTargetsByRoomId.delete(roomId);
    this.transportHealthByRoom.delete(roomId);
    if (shouldDelayReticulumAudioTeardown) {
      this.scheduleReticulumAudioLinkTeardownAfterLeave(roomId);
    } else {
      this.syncReticulumAudioLinks();
    }
    loggerLog(
      signature
        ? `[GCall] Sent GC_LEAVE for room ${roomId}`
        : `[GCall] Cleared local room state for ${roomId} without broadcasting GC_LEAVE`
    );
    this.scheduleQortalGroupCallActivityEmit(true);
  }

  private scheduleReticulumAudioLinkTeardownAfterLeave(roomId: string): void {
    const timer = setTimeout(() => {
      this.reticulumLeaveLinkDrainTimers.delete(timer);
      if (this.rooms.has(roomId)) {
        loggerLog(
          `[GCall] GC_LEAVE link drain skipped for room ${roomId}; room was rejoined before teardown`
        );
        return;
      }
      loggerLog(
        `[GCall] GC_LEAVE link drain complete for room ${roomId}; syncing Reticulum audio links`
      );
      this.syncReticulumAudioLinks();
    }, GC_RETICULUM_LEAVE_LINK_DRAIN_MS);
    timer.unref?.();
    this.reticulumLeaveLinkDrainTimers.add(timer);
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
    this.replayRetainedJoinIdentitiesForPublishedTopology(roomId, topology);
    this.syncReticulumAudioLinks();
    const { sentLinks, skippedLinks } =
      this.sendReticulumLinkControlToEstablishedRoomLinks(
        roomId,
        frames,
        new Set([topology.fromAddress]),
        'GC_TOPOLOGY'
      );
    loggerLog(
      `[GCall] Queued GC_TOPOLOGY (Reticulum links) for room ${roomId} epoch ${topology.topologyEpoch} links=${sentLinks} skipped=${skippedLinks}`
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
    const room = this.rooms.get(roomId);
    const cluster = room?.lastTopology?.clusters[payload.clusterIndex];
    const targetAddresses =
      cluster && cluster.forwarder === payload.clusterForwarder
        ? cluster.members
        : [];
    const { sentLinks, skippedLinks } =
      this.sendReticulumLinkControlToAddresses(
        roomId,
        [ghWire],
        targetAddresses,
        new Set([payload.fromAddress]),
        'GC_CLUSTER_HEARTBEAT'
      );
    loggerLog(
      `[GCall] Queued GC_CLUSTER_HEARTBEAT (Reticulum links) for room ${roomId} cluster=${payload.clusterIndex} links=${sentLinks} skipped=${skippedLinks}`
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
          if (
            topology.rootForwarder &&
            topology.rootForwarder !== localAddress
          ) {
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
      if (
        !address ||
        this.localAddresses.has(address) ||
        !room.participants.has(address)
      ) {
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
   * 1:1 DM voice rooms use `dmv:` + 18 hex chars of sha256(directChatId). When inbound Reticulum
   * audio arrives with an empty or unmapped `peerPresenceHash`, infer the peer from `GroupRoom.chatId`.
   */
  private resolveDmVoicePeerFromRoomId(
    roomId: string | undefined | null
  ): string | null {
    if (!roomId) return null;
    if (!roomId.startsWith('dmv:')) return null;

    const room = this.rooms.get(roomId);
    const directChatId = room?.chatId;
    if (directChatId?.startsWith('direct:')) {
      const body = directChatId.slice('direct:'.length);
      const parts = body.split(':').filter(Boolean);
      if (parts.length === 2) {
        const [a, b] = parts;
        for (const local of this.localAddresses) {
          if (local === a) return b;
          if (local === b) return a;
        }
      }
    }
    return null;
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
    const want = this.normalizePeerPresenceHashForAudio(peerPresenceHash);
    if (rk) {
      const byLinkId = this.reticulumAudioAddressByLinkId.get(rk);
      if (
        byLinkId &&
        (!want ||
          this.addressMatchesWirePeerPresenceHash(want, byLinkId) ||
          this.normalizePeerPresenceHashForAudio(
            this.reticulumAudioPeersByAddress.get(byLinkId)?.peerPresenceHash ??
              ''
          ) === want)
      ) {
        return byLinkId;
      }
    }
    if (!want) {
      return this.resolveDmVoicePeerFromRoomId(roomId);
    }
    const cachedAddress = this.reticulumAddressByPeerPresenceHash.get(want);
    if (cachedAddress) return cachedAddress;
    for (const [address, state] of this.reticulumAudioPeersByAddress) {
      if (
        this.normalizePeerPresenceHashForAudio(state.peerPresenceHash) ===
          want ||
        this.addressMatchesWirePeerPresenceHash(want, address)
      ) {
        return address;
      }
    }
    const matchParticipantsInRoom = (
      room: GroupRoom | undefined
    ): string | null => {
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
      const room = this.rooms.get(roomId);
      if (room) {
        const remoteParticipants = [...room.participants.keys()].filter(
          (address) => address && !this.localAddresses.has(address)
        );
        if (remoteParticipants.length === 1) return remoteParticipants[0]!;
      }
    } else {
      for (const r of this.rooms.values()) {
        const hit = matchParticipantsInRoom(r);
        if (hit) return hit;
      }
    }
    return this.resolveDmVoicePeerFromRoomId(roomId);
  }

  private findRoomIdContainingParticipant(address: string): string | null {
    for (const [rid, room] of this.rooms) {
      if (room.participants.has(address)) return rid;
    }
    return null;
  }

  private isOnlyRemoteParticipantInRoom(
    roomId: string,
    address: string
  ): boolean {
    const room = this.rooms.get(roomId);
    if (!room || !address || this.localAddresses.has(address)) return false;
    const remoteParticipants = [...room.participants.keys()].filter(
      (participant) => participant && !this.localAddresses.has(participant)
    );
    return remoteParticipants.length === 1 && remoteParticipants[0] === address;
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
    reason: string,
    opts?: { bypassReactivationCooldown?: boolean }
  ): void {
    if (this.getReticulumAudioTransportKind() !== 'packet') return;
    if (state.packetTransportFallback && state.transport === 'link') return;
    // Hysteresis: once we exit fallback, refuse to re-enter for a short window so a quiet
    // listener (conversational silences) does not thrash transport on every heartbeat
    // report. Without this, `maybeActivateReticulumFallbackFromPeerRxReport` re-fires every
    // ~2–3 s because peer heartbeats still say packetRxRecent=false until our next send.
    if (
      !opts?.bypassReactivationCooldown &&
      isInReticulumFallbackReactivationCooldown({
        packetFallbackLastExitAtMs: state.packetFallbackLastExitAtMs,
        nowMs: Date.now(),
        cooldownMs: GC_RETICULUM_PACKET_LINK_FALLBACK_REACTIVATION_COOLDOWN_MS,
      })
    ) {
      return;
    }
    state.packetTransportFallback = true;
    state.packetFallbackActivatedAtMs = Date.now();
    state.packetFallbackLastProbeAtMs = 0;
    this.setReticulumAudioTransport(address, state, 'link', reason);
    loggerWarn(
      `[GCall] Reticulum audio switching to link fallback address=${address} reason=${reason}`
    );
    if (this.shouldMaintainReticulumAudioLink(state)) {
      void this.openReticulumAudioLinkForAddress(address);
    }
    this.scheduleReticulumAudioFlush();
  }

  private deactivateReticulumAudioLinkFallback(
    address: string,
    state: ReticulumAudioPeerState,
    reason: string
  ): void {
    const dwellMs =
      state.packetFallbackActivatedAtMs > 0
        ? Math.max(0, Date.now() - state.packetFallbackActivatedAtMs)
        : 0;
    state.packetTransportFallback = false;
    state.packetFallbackExitCount += 1;
    state.packetFallbackLastDwellMs = dwellMs;
    state.packetFallbackLastExitAtMs = Date.now();
    this.noteReticulumPacketTransportHealthy(state);
    this.setReticulumAudioTransport(address, state, 'packet', reason);
    loggerLog(
      `[GCall] Reticulum audio leaving link fallback address=${address} reason=${reason} dwellMs=${Math.round(dwellMs)} probes=${state.packetFallbackProbeCount}`
    );
    this.scheduleReticulumAudioFlush();
  }

  private requestReticulumPacketLinkFallback(
    address: string,
    state: ReticulumAudioPeerState,
    reason: string,
    opts?: { bypassReactivationCooldown?: boolean }
  ): void {
    if (this.getReticulumAudioTransportKind() !== 'packet') return;
    const now = Date.now();
    state.packetLinkFallbackRequestedUntilMs = Math.max(
      state.packetLinkFallbackRequestedUntilMs,
      now + GC_RETICULUM_PACKET_LINK_FALLBACK_REQUEST_WINDOW_MS
    );
    state.packetLinkFallbackReason = reason;
    this.noteReticulumPacketTransportDegraded(
      state,
      GC_RETICULUM_PACKET_LINK_FALLBACK_EVIDENCE_COUNT
    );
    if (state.established && state.linkId) {
      this.activateReticulumAudioLinkFallback(address, state, reason, opts);
      return;
    }
    if (this.shouldMaintainReticulumAudioLink(state)) {
      void this.openReticulumAudioLinkForAddress(address);
    }
  }

  private noteReticulumPacketTransportDegraded(
    state: ReticulumAudioPeerState,
    evidence = 1
  ): void {
    const now = Date.now();
    if (state.packetDegradedSinceMs <= 0) {
      state.packetDegradedSinceMs = now;
    }
    if (evidence > 0) {
      state.packetFallbackEvidenceCount += evidence;
    }
  }

  private noteReticulumPacketTransportHealthy(
    state: ReticulumAudioPeerState
  ): void {
    state.packetDegradedSinceMs = 0;
    state.packetFallbackEvidenceCount = 0;
    state.packetFallbackActivatedAtMs = 0;
    state.packetFallbackLastProbeAtMs = 0;
    state.packetLinkFallbackRequestedUntilMs = 0;
    state.packetLinkFallbackReason = '';
    state.peerPacketRxMissingUntilMs = 0;
  }

  private isHardReticulumPacketPathFailure(pathState?: string): boolean {
    const normalized = pathState?.trim().toLowerCase();
    return (
      normalized === 'failing' ||
      normalized === 'failed' ||
      normalized === 'unresolved'
    );
  }

  private canLeaveReticulumPacketFallback(
    state: ReticulumAudioPeerState
  ): boolean {
    const now = Date.now();
    return (
      !state.packetTransportFallback ||
      state.packetFallbackActivatedAtMs <= 0 ||
      (now - state.packetFallbackActivatedAtMs >=
        GC_RETICULUM_PACKET_LINK_FALLBACK_MIN_DWELL_MS &&
        state.packetLinkFallbackRequestedUntilMs <= now &&
        state.peerPacketRxMissingUntilMs <= now)
    );
  }

  private shouldFallbackPacketTransport(
    state: Pick<
      ReticulumAudioPeerState,
      | 'transport'
      | 'packetTransportFallback'
      | 'packetDegradedSinceMs'
      | 'packetFallbackEvidenceCount'
    >
  ): boolean {
    return (
      state.transport === 'packet' &&
      !state.packetTransportFallback &&
      state.packetDegradedSinceMs > 0 &&
      Date.now() - state.packetDegradedSinceMs >=
        GC_RETICULUM_PACKET_LINK_FALLBACK_MIN_DEGRADED_MS &&
      state.packetFallbackEvidenceCount >=
        GC_RETICULUM_PACKET_LINK_FALLBACK_EVIDENCE_COUNT
    );
  }

  private maybeActivateReticulumPacketFallback(
    address: string,
    state: ReticulumAudioPeerState,
    reason: string
  ): void {
    if (!this.shouldFallbackPacketTransport(state)) return;
    if (!state.established || !state.linkId) {
      if (this.shouldMaintainReticulumAudioLink(state)) {
        void this.openReticulumAudioLinkForAddress(address);
      }
      return;
    }
    this.activateReticulumAudioLinkFallback(address, state, reason);
  }

  private shouldMaintainReticulumAudioLink(
    state: Pick<ReticulumAudioPeerState, 'transport'> | null | undefined
  ): boolean {
    return (
      (state?.transport ?? this.getReticulumAudioTransportKind()) === 'link' ||
      GC_RETICULUM_PACKET_MEDIA_KEEP_AUDIO_LINKS
    );
  }

  private hasEstablishedReticulumAudioLink(
    state:
      | Pick<ReticulumAudioPeerState, 'established' | 'linkId'>
      | null
      | undefined
  ): boolean {
    return state?.established === true && Boolean(state.linkId);
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

  private getLocalJoinTimestampForRoom(room: GroupRoom): number {
    const timestamps: number[] = [];
    for (const address of this.localAddresses) {
      const joinedAt = room.participants.get(address)?.joinedAt;
      if (typeof joinedAt === 'number' && Number.isFinite(joinedAt)) {
        timestamps.push(joinedAt);
      }
    }
    if (
      typeof room.joinTimestamp === 'number' &&
      Number.isFinite(room.joinTimestamp)
    ) {
      timestamps.push(room.joinTimestamp);
    }
    return timestamps.length > 0 ? Math.min(...timestamps) : 0;
  }

  private shouldDeferInitialAudioOpenForVerifiedJoin(
    room: GroupRoom,
    env: GcJoinEnvelope
  ): boolean {
    if (!env.fromAddress || this.localAddresses.has(env.fromAddress))
      return false;
    const localJoinTimestamp = this.getLocalJoinTimestampForRoom(room);
    if (localJoinTimestamp <= 0) return false;
    // Older peer identity learned by the joiner: let that peer open first after
    // receiving our fresher GC_JOIN. Fresh/newer joins are opened immediately here.
    return env.timestamp < localJoinTimestamp;
  }

  private clearReticulumAudioOpenDefer(address: string): void {
    this.reticulumAudioOpenDeferUntilByAddress.delete(address);
    const timer = this.reticulumAudioOpenDeferTimersByAddress.get(address);
    if (timer) {
      clearTimeout(timer);
      this.reticulumAudioOpenDeferTimersByAddress.delete(address);
    }
  }

  private deferReticulumAudioOpenForAddress(
    address: string,
    delayMs: number
  ): void {
    if (!address || this.localAddresses.has(address)) return;
    const state = this.reticulumAudioPeersByAddress.get(address);
    if (state?.established || state?.linkId || state?.opening) return;
    const until = Date.now() + Math.max(0, delayMs);
    const existingUntil =
      this.reticulumAudioOpenDeferUntilByAddress.get(address) ?? 0;
    if (existingUntil >= until) return;
    this.reticulumAudioOpenDeferUntilByAddress.set(address, until);
    const existingTimer =
      this.reticulumAudioOpenDeferTimersByAddress.get(address);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(
      () => {
        this.reticulumAudioOpenDeferTimersByAddress.delete(address);
        const activeUntil =
          this.reticulumAudioOpenDeferUntilByAddress.get(address) ?? 0;
        if (activeUntil > Date.now()) return;
        this.reticulumAudioOpenDeferUntilByAddress.delete(address);
        this.syncReticulumAudioLinks();
      },
      Math.max(0, until - Date.now())
    );
    timer.unref?.();
    this.reticulumAudioOpenDeferTimersByAddress.set(address, timer);
  }

  private isReticulumAudioOpenDeferred(address: string): boolean {
    const until = this.reticulumAudioOpenDeferUntilByAddress.get(address) ?? 0;
    if (until <= 0) return false;
    if (until <= Date.now()) {
      this.clearReticulumAudioOpenDefer(address);
      return false;
    }
    return true;
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

  private getReticulumAudioPendingMaxAgeMs(
    state: ReticulumAudioPeerState
  ): number {
    if (state.recoveryHoldUntilMs > Date.now()) {
      return Math.min(
        GC_RETICULUM_AUDIO_PENDING_MAX_AGE_MS,
        GC_RETICULUM_AUDIO_RECOVERY_BUFFER_MAX_AGE_MS
      );
    }
    return GC_RETICULUM_AUDIO_PENDING_MAX_AGE_MS;
  }

  private getReticulumAudioPendingOldestAgeMs(
    pending: ReadonlyArray<{ enqueuedAtMs: number }>,
    now = Date.now()
  ): number {
    if (pending.length === 0) return 0;
    return Math.max(0, now - pending[0]!.enqueuedAtMs);
  }

  private getReticulumAudioHeartbeatRoomId(
    state: ReticulumAudioPeerState
  ): string | null {
    for (const roomId of state.rooms) {
      if (this.rooms.has(roomId)) return roomId;
    }
    return null;
  }

  private getReticulumAudioPacketRxAgeMs(
    state: ReticulumAudioPeerState,
    now: number = Date.now()
  ): number {
    if (state.lastInboundPacketAtMs <= 0) return -1;
    return Math.max(
      0,
      Math.min(
        GC_RETICULUM_PACKET_LINK_FALLBACK_PACKET_RX_AGE_CAP_MS,
        now - state.lastInboundPacketAtMs
      )
    );
  }

  private maybeActivateReticulumFallbackFromPeerRxReport(
    address: string,
    state: ReticulumAudioPeerState,
    wire: GcReticulumAudioLinkHeartbeatWire
  ): void {
    if (this.getReticulumAudioTransportKind() !== 'packet') return;
    if (!state.packetTransportFallback && state.transport !== 'packet') return;
    // Silence-aware decision: only flip to link-fallback when a recent outbound packet of
    // ours failed to arrive — not when we simply weren't sending. See pure helper for the
    // exact predicate + rationale (phil-kenny-one-on-one-61).
    const now = Date.now();
    const outboundAudioAgeMs =
      state.lastOutboundPacketAtMs > 0
        ? now - state.lastOutboundPacketAtMs
        : Number.POSITIVE_INFINITY;
    const outboundPacketAgeMs = outboundAudioAgeMs;
    const reason = `packet-fallback:peer-rx-missing:${wire.c.toLowerCase()}`;
    if (
      !shouldActivateReticulumPeerRxFallback({
        peerRxRecent: wire.packetRxRecent,
        peerRxAgeMs: wire.packetRxAgeMs,
        outboundPacketAgeMs,
        remoteRxMissingMs:
          GC_RETICULUM_PACKET_LINK_FALLBACK_REMOTE_RX_MISSING_MS,
        localSendRecentMs:
          GC_RETICULUM_PACKET_LINK_FALLBACK_LOCAL_SEND_RECENT_MS,
        peerRxLossToleranceMs:
          GC_RETICULUM_PACKET_LINK_FALLBACK_PEER_RX_LOSS_TOLERANCE_MS,
      })
    ) {
      return;
    }
    state.peerPacketRxMissingUntilMs = Math.max(
      state.peerPacketRxMissingUntilMs,
      now + GC_RETICULUM_PACKET_LINK_FALLBACK_REQUEST_WINDOW_MS
    );
    this.requestReticulumPacketLinkFallback(address, state, reason, {
      bypassReactivationCooldown: true,
    });
  }

  private resetReticulumAudioLinkHeartbeat(
    state: ReticulumAudioPeerState
  ): void {
    state.linkHeartbeatAwaitingSeq = 0;
    state.linkHeartbeatMissedPongs = 0;
    state.linkHeartbeatLastPingAtMs = 0;
    state.linkEstablishLastAttemptAtMs = -1;
    state.linkEstablishRetryDelayMs =
      GC_RETICULUM_AUDIO_LINK_ESTABLISH_RETRY_MIN_MS;
    const now = Date.now();
    state.linkHeartbeatLastPongAtMs = now;
    state.linkHeartbeatLastRxAtMs = now;
  }

  private noteReticulumAudioLinkActivity(
    state: ReticulumAudioPeerState,
    now = Date.now()
  ): void {
    state.linkHeartbeatLastRxAtMs = Math.max(
      state.linkHeartbeatLastRxAtMs,
      now
    );
    state.linkHeartbeatLastPongAtMs = Math.max(
      state.linkHeartbeatLastPongAtMs,
      now
    );
    state.linkHeartbeatAwaitingSeq = 0;
    state.linkHeartbeatMissedPongs = 0;
  }

  private hasRecentReticulumAudioLinkActivity(
    state: ReticulumAudioPeerState,
    now = Date.now()
  ): boolean {
    return (
      (state.linkHeartbeatLastRxAtMs > 0 &&
        now - state.linkHeartbeatLastRxAtMs <=
          GC_RETICULUM_AUDIO_LINK_HEARTBEAT_ACTIVITY_GRACE_MS) ||
      (state.lastInboundAtMs > 0 &&
        now - state.lastInboundAtMs <=
          GC_RETICULUM_AUDIO_LINK_HEARTBEAT_ACTIVITY_GRACE_MS)
    );
  }

  private isReticulumAudioEstablishedLinkSticky(
    state: ReticulumAudioPeerState,
    now = Date.now()
  ): boolean {
    if (!state.established || !state.linkId) return false;
    return (
      (state.linkEstablishedAtMs > 0 &&
        now - state.linkEstablishedAtMs <=
          GC_RETICULUM_AUDIO_LINK_STICKY_MS) ||
      this.hasRecentReticulumAudioLinkActivity(state, now)
    );
  }

  private closeReticulumAudioLinkQuietly(linkId: string, reason: string): void {
    if (!linkId) return;
    const address = this.reticulumAudioAddressByLinkId.get(linkId);
    const state =
      (address ? this.reticulumAudioPeersByAddress.get(address) : undefined) ??
      [...this.reticulumAudioPeersByAddress.values()].find(
        (candidate) =>
          candidate.linkId === linkId ||
          candidate.lastLinkUnreadyLinkId === linkId
      );
    if (state) {
      state.lastLinkCloseReason = reason;
      state.lastLinkCloseAtMs = Date.now();
      state.lastLinkCloseLinkId = linkId;
    }
    loggerLog(
      `[GCall] Closing Reticulum audio link linkId=${linkId} reason=${reason}`
    );
    void this.reticulumBridge?.closeGroupAudioLink(linkId).catch(() => {});
  }

  private sendReticulumLinkControlToEstablishedRoomLinks(
    roomId: string,
    frames: Record<string, unknown>[],
    excludeAddresses: Set<string>,
    reason: string,
    targetAddresses?: Set<string>
  ): { sentLinks: number; skippedLinks: number } {
    const bridge = this.reticulumBridge;
    if (!bridge || bridge.getState() !== 'ready' || frames.length === 0) {
      return { sentLinks: 0, skippedLinks: 0 };
    }
    let skippedLinks = 0;
    const encodedFrames: Buffer[] = [];
    for (const frame of frames) {
      const encoded = encodeGcLinkControlWire(frame);
      if (!encoded) {
        skippedLinks++;
        continue;
      }
      encodedFrames.push(encoded);
    }
    if (encodedFrames.length === 0) {
      return { sentLinks: 0, skippedLinks };
    }
    let sentLinks = 0;
    for (const [address, state] of this.reticulumAudioPeersByAddress) {
      if (targetAddresses && !targetAddresses.has(address)) continue;
      if (excludeAddresses.has(address)) continue;
      if (!state.rooms.has(roomId)) {
        skippedLinks++;
        continue;
      }
      if (!state.established || !state.linkId) {
        this.queuePendingReticulumLinkControl(
          address,
          state,
          roomId,
          encodedFrames,
          reason
        );
        skippedLinks++;
        continue;
      }
      if (
        !this.isReticulumAudioLinkVerifiedForAddress(
          address,
          state.peerPresenceHash,
          state.peerDestinationHash
        )
      ) {
        skippedLinks++;
        continue;
      }
      let enqueuedForLink = 0;
      for (const encoded of encodedFrames) {
        const result = bridge.enqueueGroupAudio(state.linkId, roomId, encoded);
        if (result.ok) {
          enqueuedForLink++;
        } else {
          skippedLinks++;
        }
      }
      if (enqueuedForLink > 0) sentLinks++;
    }
    if (sentLinks > 0) {
      this.scheduleReticulumAudioFlush();
    }
    loggerLog(
      `[GCall] Queued ${reason} over Reticulum group links room=${roomId} links=${sentLinks} skipped=${skippedLinks}`
    );
    return { sentLinks, skippedLinks };
  }

  private queuePendingReticulumLinkControl(
    address: string,
    state: ReticulumAudioPeerState,
    roomId: string,
    encodedFrames: Buffer[],
    reason: string
  ): void {
    if (encodedFrames.length === 0) return;
    const now = Date.now();
    while (
      state.pendingControl.length > 0 &&
      now - state.pendingControl[0]!.enqueuedAtMs >
        GC_RETICULUM_LINK_CONTROL_PENDING_MAX_AGE_MS
    ) {
      state.pendingControl.shift();
    }
    for (const encoded of encodedFrames) {
      state.pendingControl.push({
        roomId,
        data: Buffer.from(encoded),
        reason,
        enqueuedAtMs: now,
      });
    }
    while (
      state.pendingControl.length >
      GC_RETICULUM_LINK_CONTROL_PENDING_MAX_FRAMES
    ) {
      state.pendingControl.shift();
    }
    loggerLog(
      `[GCall] Queued ${reason} pending Reticulum group link room=${roomId} address=${address} pending=${state.pendingControl.length}`
    );
    this.retryReticulumAudioLinkAfterPendingControlIfStale(
      address,
      state,
      roomId,
      reason,
      now
    );
  }

  private retryReticulumAudioLinkAfterPendingControlIfStale(
    address: string,
    state: ReticulumAudioPeerState,
    roomId: string,
    reason: string,
    now: number
  ): void {
    if (state.established && state.linkId) return;
    if (state.opening) return;
    if (!this.shouldMaintainReticulumAudioLink(state)) return;
    const pendingLinkAgeMs =
      state.linkId && state.linkEstablishLastAttemptAtMs >= 0
        ? now - state.linkEstablishLastAttemptAtMs
        : 0;
    const establishStaleMs =
      state.linkEstablishedCount === 0
        ? GC_RETICULUM_AUDIO_LINK_ESTABLISH_INITIAL_STALE_MS
        : GC_RETICULUM_AUDIO_LINK_ESTABLISH_STALE_MS;
    if (state.linkId && pendingLinkAgeMs < establishStaleMs) return;
    loggerLog(
      `[GCall] Reticulum pending link control forcing establish retry room=${roomId} address=${address} reason=${reason} pendingAgeMs=${Math.max(0, pendingLinkAgeMs)} pendingControl=${state.pendingControl.length}`
    );
    this.retryReticulumAudioLinkEstablishIfNeeded(address, state, roomId, now);
  }

  private flushPendingReticulumLinkControl(
    address: string,
    state: ReticulumAudioPeerState
  ): void {
    const bridge = this.reticulumBridge;
    if (
      !bridge ||
      typeof bridge.enqueueGroupAudio !== 'function' ||
      bridge.getState() !== 'ready' ||
      !state.established ||
      !state.linkId ||
      state.pendingControl.length === 0
    ) {
      return;
    }
    const now = Date.now();
    let sent = 0;
    let dropped = 0;
    const kept: ReticulumLinkControlPendingFrame[] = [];
    for (const pending of state.pendingControl) {
      if (
        now - pending.enqueuedAtMs >
          GC_RETICULUM_LINK_CONTROL_PENDING_MAX_AGE_MS ||
        !state.rooms.has(pending.roomId)
      ) {
        dropped++;
        continue;
      }
      const result = bridge.enqueueGroupAudio(
        state.linkId,
        pending.roomId,
        pending.data
      );
      if (result.ok) {
        sent++;
      } else {
        kept.push(pending);
      }
    }
    state.pendingControl = kept.slice(
      -GC_RETICULUM_LINK_CONTROL_PENDING_MAX_FRAMES
    );
    if (sent > 0) {
      this.scheduleReticulumAudioFlush();
    }
    if (sent > 0 || dropped > 0) {
      loggerLog(
        `[GCall] Flushed pending Reticulum link control address=${address} link=${state.linkId} sent=${sent} kept=${state.pendingControl.length} dropped=${dropped}`
      );
    }
  }

  private getLocalReticulumLinkAuthJoinWire(
    roomId: string
  ): Record<string, unknown> | null {
    for (const localAddress of this.localAddresses) {
      const env = this.retainedVerifiedJoinByRoomAndAddress.get(
        this.retainedJoinStateKey(roomId, localAddress)
      );
      if (!env) continue;
      const wire = encodeJoinWire({
        ...env,
        reticulumIdentityPublicKeyBase64: undefined,
      });
      return wireFitsReticulum(wire) ? wire : null;
    }
    return null;
  }

  private sendReticulumAudioLinkAuth(
    address: string,
    state: ReticulumAudioPeerState,
    reason: string,
    linkIdOverride?: string,
    allowPending = false
  ): void {
    const bridge = this.reticulumBridge;
    const linkId = linkIdOverride || state.linkId;
    if (
      !bridge ||
      typeof bridge.enqueueGroupAudio !== 'function' ||
      !linkId ||
      (!state.established && !allowPending)
    ) {
      return;
    }
    let sent = 0;
    for (const roomId of state.rooms) {
      if (state.linkAuthSentByRoom.get(roomId) === linkId) continue;
      const frame = this.getLocalReticulumLinkAuthJoinWire(roomId);
      if (!frame) continue;
      const encoded = encodeGcLinkControlWire(frame);
      if (!encoded) continue;
      const result = bridge.enqueueGroupAudio(linkId, roomId, encoded);
      if (result.ok) {
        state.linkAuthSentByRoom.set(roomId, linkId);
        state.linkAuthSentCount++;
        state.lastLinkAuthAtMs = Date.now();
        state.lastLinkAuthReason = `sent:${reason}`;
        sent++;
      }
    }
    if (sent > 0) {
      loggerLog(
        `[GCall] Queued Reticulum audio link auth address=${address} link=${linkId} rooms=${sent} reason=${reason}`
      );
      this.scheduleReticulumAudioFlush();
    }
  }

  private sendReticulumLinkControlToAddresses(
    roomId: string,
    frames: Record<string, unknown>[],
    targetAddresses: Iterable<string>,
    excludeAddresses: Set<string>,
    reason: string
  ): { sentLinks: number; skippedLinks: number } {
    const targets = new Set<string>();
    for (const raw of targetAddresses) {
      const address = raw.trim();
      if (!address || this.localAddresses.has(address)) continue;
      targets.add(address);
    }
    if (targets.size === 0) return { sentLinks: 0, skippedLinks: 0 };
    this.syncReticulumAudioLinks();
    return this.sendReticulumLinkControlToEstablishedRoomLinks(
      roomId,
      frames,
      excludeAddresses,
      reason,
      targets
    );
  }

  private isReticulumAudioLinkVerifiedForAddress(
    address: string,
    peerPresenceHash: string,
    peerDestinationHash?: string
  ): boolean {
    const hashes = [peerPresenceHash, peerDestinationHash ?? '']
      .map((hash) => this.normalizePeerPresenceHashForAudio(hash))
      .filter(Boolean);
    if (hashes.length === 0) return false;
    const state = this.reticulumAudioPeersByAddress.get(address);
    const expected = this.normalizePeerPresenceHashForAudio(
      state?.peerPresenceHash ?? ''
    );
    return hashes.some(
      (hash) =>
        (expected && hash === expected) ||
        this.addressMatchesWirePeerPresenceHash(hash, address)
    );
  }

  private getReticulumAudioLocalAddressForState(
    state: ReticulumAudioPeerState
  ): string | null {
    for (const roomId of state.rooms) {
      const room = this.rooms.get(roomId);
      if (!room) continue;
      for (const localAddress of this.localAddresses) {
        if (room.participants.has(localAddress)) return localAddress;
      }
    }
    for (const localAddress of this.localAddresses) {
      if (localAddress) return localAddress;
    }
    return null;
  }

  private isLocalAddressReticulumAudioLinkOwner(
    localAddress: string,
    peerAddress: string
  ): boolean {
    const left = localAddress.trim();
    const right = peerAddress.trim();
    if (!left || !right) return false;
    return left.localeCompare(right) <= 0;
  }

  private isReticulumAudioLinkOpenedByOwner(
    address: string,
    state: ReticulumAudioPeerState,
    incoming: boolean | null
  ): boolean | null {
    if (incoming === null) return null;
    const localAddress = this.getReticulumAudioLocalAddressForState(state);
    if (!localAddress) return null;
    const localIsOwner = this.isLocalAddressReticulumAudioLinkOwner(
      localAddress,
      address
    );
    return incoming ? !localIsOwner : localIsOwner;
  }

  private adoptEstablishedReticulumAudioLink(
    address: string,
    state: ReticulumAudioPeerState,
    linkId: string,
    peerDestinationHash: string,
    incoming: boolean | null,
    reason: string
  ): boolean {
    if (!linkId) return false;
    if (state.established && state.linkId && state.linkId !== linkId) {
      const incomingOpenedByOwner = this.isReticulumAudioLinkOpenedByOwner(
        address,
        state,
        incoming
      );
      if (
        incomingOpenedByOwner === true &&
        state.linkOpenedByOwner !== true &&
        !this.isReticulumAudioEstablishedLinkSticky(state)
      ) {
        const previousLinkId = state.linkId;
        this.reticulumAudioAddressByLinkId.delete(previousLinkId);
        this.closeReticulumAudioLinkQuietly(
          previousLinkId,
          `superseded-by-owner:${reason}`
        );
        state.linkId = null;
        state.linkOpenedByOwner = null;
        state.established = false;
      } else {
        this.reticulumAudioAddressByLinkId.delete(linkId);
        this.closeReticulumAudioLinkQuietly(
          linkId,
          `duplicate-established:${reason}`
        );
        return false;
      }
    }

    if (state.established && state.linkId && state.linkId !== linkId) {
      this.reticulumAudioAddressByLinkId.delete(linkId);
      this.closeReticulumAudioLinkQuietly(
        linkId,
        `duplicate-established:${reason}`
      );
      return false;
    }

    const previousLinkId = state.linkId;
    if (previousLinkId && previousLinkId !== linkId) {
      this.reticulumAudioAddressByLinkId.delete(previousLinkId);
      this.closeReticulumAudioLinkQuietly(
        previousLinkId,
        `superseded-before-established:${reason}`
      );
    }

    state.linkId = linkId;
    state.linkOpenedByOwner = this.isReticulumAudioLinkOpenedByOwner(
      address,
      state,
      incoming
    );
    state.peerDestinationHash =
      peerDestinationHash || state.peerDestinationHash;
    state.established = true;
    state.linkEstablishedCount++;
    state.linkEstablishedAtMs = Date.now();
    state.opening = false;
    this.clearReticulumAudioOpenDefer(address);
    this.reticulumAudioAddressByLinkId.set(linkId, address);
    if (state.transport === 'link') {
      this.setReticulumAudioRouteKey(address, state, linkId);
    }
    this.resetReticulumAudioLinkHeartbeat(state);
    this.flushPendingReticulumLinkControl(address, state);
    this.sendReticulumAudioLinkAuth(address, state, reason);
    return true;
  }

  private retryReticulumAudioLinkEstablishIfNeeded(
    address: string,
    state: ReticulumAudioPeerState,
    roomId: string,
    now: number
  ): boolean {
    if (state.established && state.linkId) return false;
    if (state.opening) return true;
    const pendingLinkAgeMs =
      state.linkId && state.linkEstablishLastAttemptAtMs >= 0
        ? now - state.linkEstablishLastAttemptAtMs
        : 0;
    const establishStaleMs =
      state.linkEstablishedCount === 0
        ? GC_RETICULUM_AUDIO_LINK_ESTABLISH_INITIAL_STALE_MS
        : GC_RETICULUM_AUDIO_LINK_ESTABLISH_STALE_MS;
    if (
      state.linkId &&
      pendingLinkAgeMs < establishStaleMs
    ) {
      return true;
    }
    const retryDelayMs = Math.max(
      GC_RETICULUM_AUDIO_LINK_ESTABLISH_RETRY_MIN_MS,
      state.linkEstablishRetryDelayMs ||
        GC_RETICULUM_AUDIO_LINK_ESTABLISH_RETRY_MIN_MS
    );
    if (
      state.linkEstablishLastAttemptAtMs >= 0 &&
      now - state.linkEstablishLastAttemptAtMs < retryDelayMs
    ) {
      return true;
    }
    const staleLinkId = state.linkId;
    state.linkEstablishLastAttemptAtMs = now;
    state.linkEstablishRetryDelayMs = Math.min(
      GC_RETICULUM_AUDIO_LINK_ESTABLISH_RETRY_MAX_MS,
      retryDelayMs * 2
    );
    loggerLog(
      `[GCall] Reticulum audio link establish retry address=${address} room=${roomId} staleLinkId=${staleLinkId || 'n/a'} pendingAgeMs=${Math.max(0, pendingLinkAgeMs)} nextDelayMs=${state.linkEstablishRetryDelayMs}`
    );
    if (staleLinkId) {
      state.linkStaleCloseCount++;
      this.markReticulumAudioLinkUnready(
        address,
        staleLinkId,
        'link-establish-retry-stale'
      );
      this.closeReticulumAudioLinkQuietly(
        staleLinkId,
        'link-establish-retry-stale'
      );
    }
    void this.openReticulumAudioLinkForAddress(address);
    return true;
  }

  private sendReticulumAudioLinkHeartbeat(
    address: string,
    state: ReticulumAudioPeerState,
    roomId: string,
    command: ReticulumAudioLinkHeartbeatCommand,
    seq?: number
  ): void {
    const bridge = this.reticulumBridge;
    const linkId = state.linkId;
    if (!bridge || !linkId || !state.established) return;
    const sendHeartbeat = (
      bridge as ReticulumBridge & {
        sendGroupAudioLinkHeartbeatDetailed?: (opts: {
          roomId: string;
          command: ReticulumAudioLinkHeartbeatCommand;
          seq?: number;
          peerPresenceHash?: string;
          linkId?: string;
          packetRxAgeMs?: number;
          packetRxRecent?: boolean;
        }) => Promise<ReticulumSendResult>;
      }
    ).sendGroupAudioLinkHeartbeatDetailed;
    if (typeof sendHeartbeat !== 'function') return;
    const packetRxAgeMs = this.getReticulumAudioPacketRxAgeMs(state);
    void sendHeartbeat
      .call(bridge, {
        roomId,
        command,
        ...(typeof seq === 'number' ? { seq } : {}),
        linkId,
        peerPresenceHash: state.peerPresenceHash,
        packetRxAgeMs,
        packetRxRecent:
          packetRxAgeMs >= 0 &&
          packetRxAgeMs <=
            GC_RETICULUM_PACKET_LINK_FALLBACK_REMOTE_RX_MISSING_MS,
      })
      .then((result) => {
        if (result.ok) return;
        const latest = this.reticulumAudioPeersByAddress.get(address);
        if (!latest) return;
        this.logReticulumFailureThrottled(
          `audio-link-heartbeat:${address}:${command}:${result.reason}:${result.error ?? ''}`,
          `[GCall] Reticulum audio link heartbeat send failed address=${address} command=${command} reason=${result.reason}${result.error ? ` error=${result.error}` : ''}`
        );
        if (
          result.reason === 'unknown-link-id' ||
          result.reason === 'audio-link-not-ready' ||
          result.reason === 'packet-send-false'
        ) {
          this.markReticulumAudioLinkUnready(
            address,
            linkId,
            `link-heartbeat-send-failed:${result.reason}`
          );
          this.requestReticulumAudioRecovery(
            roomId,
            address,
            'link-heartbeat-send-failed',
            {
              force: true,
              holdAudio: false,
              cooldownMs:
                GC_RETICULUM_AUDIO_LINK_HEARTBEAT_RECOVERY_COOLDOWN_MS,
            }
          );
        }
      })
      .catch((error) => {
        this.logReticulumFailureThrottled(
          `audio-link-heartbeat:${address}:${command}:exception`,
          `[GCall] Reticulum audio link heartbeat exception address=${address} command=${command} error=${error instanceof Error ? error.message : String(error)}`
        );
      });
  }

  private tickReticulumAudioLinkHeartbeats(): void {
    const now = Date.now();
    for (const [address, state] of this.reticulumAudioPeersByAddress) {
      if (!this.shouldMaintainReticulumAudioLink(state)) continue;
      if (state.rooms.size === 0) continue;
      const roomId = this.getReticulumAudioHeartbeatRoomId(state);
      if (!roomId) continue;
      if (
        this.retryReticulumAudioLinkEstablishIfNeeded(
          address,
          state,
          roomId,
          now
        )
      ) {
        continue;
      }

      if (
        state.packetTransportFallback &&
        now - state.lastPathWarmAtMs >=
          GC_RETICULUM_AUDIO_RECOVERY_ACTION_COOLDOWN_MS
      ) {
        this.requestReticulumPacketPathWarmup(
          address,
          state,
          'packet-fallback-probe',
          {
            force: true,
            holdAudio: false,
          }
        );
      }

      if (
        now - state.linkHeartbeatLastPingAtMs <
        GC_RETICULUM_AUDIO_LINK_HEARTBEAT_INTERVAL_MS
      ) {
        continue;
      }

      if (state.linkHeartbeatAwaitingSeq > 0) {
        state.linkHeartbeatMissedPongs += 1;
        if (
          state.linkHeartbeatMissedPongs >=
          GC_RETICULUM_AUDIO_LINK_HEARTBEAT_MISSED_MAX
        ) {
          if (this.hasRecentReticulumAudioLinkActivity(state, now)) {
            state.linkHeartbeatAwaitingSeq = 0;
            state.linkHeartbeatMissedPongs = 0;
            continue;
          }
          if (
            now - state.linkHeartbeatLastRecoveryAtMs >=
            GC_RETICULUM_AUDIO_LINK_HEARTBEAT_RECOVERY_COOLDOWN_MS
          ) {
            state.linkHeartbeatLastRecoveryAtMs = now;
            this.markReticulumAudioLinkUnready(
              address,
              state.linkId,
              'link-heartbeat-timeout'
            );
            this.requestReticulumAudioRecovery(
              roomId,
              address,
              'link-heartbeat-timeout',
              {
                force: true,
                holdAudio: false,
                cooldownMs:
                  GC_RETICULUM_AUDIO_LINK_HEARTBEAT_RECOVERY_COOLDOWN_MS,
              }
            );
          }
          continue;
        }
      }

      state.linkHeartbeatSeq = (state.linkHeartbeatSeq + 1) >>> 0;
      state.linkHeartbeatAwaitingSeq = state.linkHeartbeatSeq;
      state.linkHeartbeatLastPingAtMs = now;
      this.sendReticulumAudioLinkHeartbeat(
        address,
        state,
        roomId,
        'PING',
        state.linkHeartbeatSeq
      );
    }
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
    if (!bridge || this.getReticulumAudioTransportKind() !== 'packet') return;
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
    const fallbackProbe =
      state.packetTransportFallback && reason === 'packet-fallback-probe';
    if (fallbackProbe) {
      state.packetFallbackLastProbeAtMs = now;
      state.packetFallbackProbeCount += 1;
      if (
        state.packetFallbackProbeCount <= 3 ||
        state.packetFallbackProbeCount % 5 === 0
      ) {
        loggerLog(
          `[GCall] Reticulum packet fallback probe address=${address} count=${state.packetFallbackProbeCount}`
        );
      }
    }
    void bridge
      .warmGroupAudioPath(state.peerPresenceHash)
      .then((result) => {
        const latest = this.reticulumAudioPeersByAddress.get(address);
        if (!latest) return;
        if ('reason' in result) {
          const failureReason = result.reason;
          this.logReticulumFailureThrottled(
            `packet-path-warm:${address}:${reason}:${failureReason}`,
            `[GCall] Reticulum packet path warm failed address=${address} reason=${reason} error=${failureReason}${result.error ? ` detail=${result.error}` : ''}`
          );
          return;
        }
        const pathReady = result.ready === true || result.pathState === 'fresh';
        const pathKnownUnready =
          result.ready === false ||
          (typeof result.pathState === 'string' &&
            result.pathState !== 'fresh');
        if (pathReady) {
          if (!this.canLeaveReticulumPacketFallback(latest)) {
            return;
          }
          if (latest.packetTransportFallback || latest.transport !== 'packet') {
            this.deactivateReticulumAudioLinkFallback(address, latest, reason);
            return;
          }
          this.noteReticulumPacketTransportHealthy(latest);
          return;
        }
        if (!pathKnownUnready) return;
        if (this.isHardReticulumPacketPathFailure(result.pathState)) {
          this.noteReticulumPacketTransportDegraded(latest);
          this.maybeActivateReticulumPacketFallback(
            address,
            latest,
            `packet-fallback:warm:${result.pathState ?? 'unready'}`
          );
          return;
        }
        this.noteReticulumPacketTransportDegraded(latest, 0);
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
      forceLinkFallback?: boolean;
      protectPacketPath?: boolean;
    }
  ): void {
    const room = this.rooms.get(roomId);
    const existingState = this.reticulumAudioPeersByAddress.get(address);
    if (
      !room ||
      (!room.participants.has(address) && !existingState?.rooms.has(roomId))
    ) {
      return;
    }
    const state = this.ensureReticulumAudioPeerState(roomId, address);
    if (!state) return;
    const forceLinkFallback =
      opts?.forceLinkFallback === true &&
      this.getReticulumAudioTransportKind() === 'packet';
    const protectPacketPath =
      (forceLinkFallback || opts?.protectPacketPath === true) &&
      this.getReticulumAudioTransportKind() === 'packet';
    if (protectPacketPath) {
      state.pathDiversityUntilMs = Math.max(
        state.pathDiversityUntilMs,
        Date.now() + GC_RETICULUM_MEDIA_RECOVERY_FLUSH_BOOST_MS
      );
      state.pathDiversityReason = reason;
      if (
        !forceLinkFallback &&
        state.transport === 'packet' &&
        !state.packetTransportFallback
      ) {
        this.noteReticulumPacketTransportDegraded(state, 2);
        this.maybeActivateReticulumPacketFallback(
          address,
          state,
          `packet-fallback:${reason}:media-quality`
        );
      }
    }
    if (state.transport === 'packet') {
      this.requestReticulumPacketPathWarmup(address, state, reason, {
        force: opts?.force,
        holdAudio: opts?.holdAudio ?? true,
        cooldownMs: opts?.cooldownMs,
      });
      if (this.shouldMaintainReticulumAudioLink(state)) {
        void this.openReticulumAudioLinkForAddress(address);
      }
      if (forceLinkFallback) {
        this.requestReticulumPacketLinkFallback(
          address,
          state,
          `packet-fallback:${reason}`,
          { bypassReactivationCooldown: true }
        );
      }
      return;
    }
    if (
      state.packetTransportFallback &&
      this.getReticulumAudioTransportKind() === 'packet'
    ) {
      this.requestReticulumPacketPathWarmup(address, state, reason, {
        force: opts?.force,
        holdAudio: opts?.holdAudio ?? false,
        cooldownMs: opts?.cooldownMs,
      });
      if (this.shouldMaintainReticulumAudioLink(state)) {
        void this.openReticulumAudioLinkForAddress(address);
      }
      if (forceLinkFallback) {
        this.requestReticulumPacketLinkFallback(
          address,
          state,
          `packet-fallback:${reason}`,
          { bypassReactivationCooldown: true }
        );
      }
      return;
    }
    if (
      state.linkId &&
      !GC_RETICULUM_RECOVERY_PRESERVE_LINK_REASONS.has(reason)
    ) {
      this.markReticulumAudioLinkUnready(
        address,
        state.linkId,
        `audio-recovery:${reason}`
      );
    }
    void this.openReticulumAudioLinkForAddress(address);
  }

  private async openReticulumAudioLinkForAddress(
    address: string
  ): Promise<void> {
    const bridge = this.reticulumBridge;
    const state = this.reticulumAudioPeersByAddress.get(address);
    if (this.isReticulumAudioOpenDeferred(address)) {
      return;
    }
    if (
      !bridge ||
      !state ||
      state.opening ||
      Boolean(state.linkId) ||
      state.established ||
      !this.shouldMaintainReticulumAudioLink(state)
    ) {
      return;
    }
    state.opening = true;
    state.linkEstablishLastAttemptAtMs = Date.now();
    state.linkOpenAttempts++;
    const result: ReticulumOpenAudioLinkResult =
      await bridge.openGroupAudioLink(state.peerPresenceHash);
    const latest = this.reticulumAudioPeersByAddress.get(address);
    if (!latest) return;
    latest.opening = false;
    if (result.ok) {
      if (result.established) {
        if (
          !this.isReticulumAudioLinkVerifiedForAddress(
            address,
            latest.peerPresenceHash,
            latest.peerDestinationHash
          )
        ) {
          latest.linkId = result.linkId;
          latest.linkOpenedByOwner = this.isReticulumAudioLinkOpenedByOwner(
            address,
            latest,
            false
          );
          this.reticulumAudioAddressByLinkId.set(result.linkId, address);
          this.sendReticulumAudioLinkAuth(
            address,
            latest,
            'open-result-awaiting-auth',
            result.linkId,
            true
          );
          return;
        }
        if (
          !this.adoptEstablishedReticulumAudioLink(
            address,
            latest,
            result.linkId,
            latest.peerDestinationHash,
            false,
            'open-result'
          )
        ) {
          return;
        }
        if (
          latest.packetLinkFallbackRequestedUntilMs > Date.now() &&
          latest.transport === 'packet' &&
          !latest.packetTransportFallback
        ) {
          this.activateReticulumAudioLinkFallback(
            address,
            latest,
            latest.packetLinkFallbackReason || 'packet-fallback:link-ready'
          );
        }
        this.flushReticulumAudioQueuesFair(address);
        if (this.hasPendingReticulumAudio()) {
          this.scheduleReticulumAudioFlush();
        }
      } else if (
        latest.established &&
        latest.linkId &&
        latest.linkId !== result.linkId
      ) {
        this.closeReticulumAudioLinkQuietly(
          result.linkId,
          'open-result-duplicate-pending'
        );
      } else if (latest.linkId && latest.linkId !== result.linkId) {
        const latestOpenedByOwner = latest.linkOpenedByOwner === true;
        const resultOpenedByOwner = this.isReticulumAudioLinkOpenedByOwner(
          address,
          latest,
          false
        );
        if (resultOpenedByOwner === true && !latestOpenedByOwner) {
          const previousLinkId = latest.linkId;
          this.reticulumAudioAddressByLinkId.delete(previousLinkId);
          this.closeReticulumAudioLinkQuietly(
            previousLinkId,
            'open-result-pending-superseded-by-owner'
          );
          latest.linkId = result.linkId;
          latest.linkOpenedByOwner = true;
          this.reticulumAudioAddressByLinkId.set(result.linkId, address);
        } else {
          this.closeReticulumAudioLinkQuietly(
            result.linkId,
            'open-result-extra-pending'
          );
        }
      } else if (!latest.established && !latest.linkId) {
        latest.linkId = result.linkId;
        latest.linkOpenedByOwner = this.isReticulumAudioLinkOpenedByOwner(
          address,
          latest,
          false
        );
        this.reticulumAudioAddressByLinkId.set(result.linkId, address);
      } else if (
        latest.linkEstablishRetryDelayMs <
        GC_RETICULUM_AUDIO_LINK_ESTABLISH_RETRY_MIN_MS
      ) {
        latest.linkEstablishRetryDelayMs =
          GC_RETICULUM_AUDIO_LINK_ESTABLISH_RETRY_MIN_MS;
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

  private markReticulumAudioLinkUnready(
    address: string,
    linkId?: string,
    reason = 'link-unready'
  ): void {
    const state = this.reticulumAudioPeersByAddress.get(address);
    if (!state) return;
    const closedLinkId = linkId || state.linkId || '';
    if (linkId) {
      this.reticulumAudioAddressByLinkId.delete(linkId);
      if (state.linkId !== linkId) return;
      state.linkId = null;
    } else if (state.linkId) {
      this.reticulumAudioAddressByLinkId.delete(state.linkId);
      state.linkId = null;
    }
    state.lastLinkUnreadyReason = reason;
    state.lastLinkUnreadyAtMs = Date.now();
    state.lastLinkUnreadyLinkId = closedLinkId;
    state.established = false;
    state.linkOpenedByOwner = null;
    state.opening = false;
    state.linkHeartbeatAwaitingSeq = 0;
    state.linkHeartbeatMissedPongs = 0;
    if (state.transport === 'link') {
      this.setReticulumAudioRouteKey(
        address,
        state,
        this.computeReticulumAudioRouteKey(
          state.transport,
          state.peerPresenceHash
        )
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
      this.markReticulumAudioLinkUnready(
        address,
        state.linkId ?? undefined,
        'peer-presence-hash-changed'
      );
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
        packetDegradedSinceMs: 0,
        packetFallbackEvidenceCount: 0,
        packetFallbackActivatedAtMs: 0,
        packetFallbackLastProbeAtMs: 0,
        packetFallbackProbeCount: 0,
        packetFallbackExitCount: 0,
        packetFallbackLastDwellMs: 0,
        packetFallbackLastExitAtMs: 0,
        packetLinkFallbackRequestedUntilMs: 0,
        packetLinkFallbackReason: '',
        peerPacketRxMissingUntilMs: 0,
        routeKey: this.computeReticulumAudioRouteKey(
          transport,
          peerPresenceHash
        ),
        linkId: null,
        linkOpenedByOwner: null,
        established: false,
        opening: false,
        linkAuthSentByRoom: new Map(),
        linkAuthSentCount: 0,
        linkAuthRxCount: 0,
        linkAuthAppliedCount: 0,
        lastLinkAuthAtMs: 0,
        lastLinkAuthReason: '',
        rooms: new Set<string>(),
        pending: [],
        pendingControl: [],
        lastInboundAtMs: 0,
        lastInboundPacketAtMs: 0,
        lastOutboundPacketAtMs: 0,
        lastPathWarmAtMs: 0,
        lastRecoveryActionAtMs: 0,
        recoveryHoldUntilMs: 0,
        recoveryReason: '',
        linkHeartbeatSeq: 0,
        linkHeartbeatAwaitingSeq: 0,
        linkHeartbeatLastPingAtMs: 0,
        linkHeartbeatLastPongAtMs: 0,
        linkHeartbeatLastRxAtMs: 0,
        linkHeartbeatMissedPongs: 0,
        linkHeartbeatLastRecoveryAtMs: 0,
        linkEstablishedAtMs: 0,
        linkEstablishLastAttemptAtMs: -1,
        linkEstablishRetryDelayMs:
          GC_RETICULUM_AUDIO_LINK_ESTABLISH_RETRY_MIN_MS,
        linkOpenAttempts: 0,
        linkEstablishedCount: 0,
        linkStaleCloseCount: 0,
        lastLinkCloseReason: '',
        lastLinkCloseAtMs: 0,
        lastLinkCloseLinkId: '',
        lastLinkUnreadyReason: '',
        lastLinkUnreadyAtMs: 0,
        lastLinkUnreadyLinkId: '',
        pathDiversityUntilMs: 0,
        pathDiversityReason: '',
      };
      this.reticulumAudioPeersByAddress.set(address, state);
      this.reticulumAudioAddressByLinkId.set(state.routeKey, address);
    } else {
      state.peerPresenceHash = peerPresenceHash;
      this.setReticulumAudioTransport(address, state, transport);
    }
    state.rooms.add(roomId);
    this.promoteAwaitingRouteReticulumAudio(address, state);
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

  private clearAwaitingRouteReticulumAudio(
    address: string,
    state?: ReticulumAudioAwaitingRouteState
  ): void {
    const current =
      state ?? this.reticulumAudioAwaitingRouteByAddress.get(address);
    if (!current) return;
    if (current.retryTimer) {
      clearTimeout(current.retryTimer);
      current.retryTimer = null;
    }
    this.reticulumAudioAwaitingRouteByAddress.delete(address);
  }

  private scheduleAwaitingRouteReticulumAudioRetry(
    address: string,
    delayMs = GC_RETICULUM_AUDIO_PREROUTE_RETRY_DELAY_MS
  ): void {
    const state = this.reticulumAudioAwaitingRouteByAddress.get(address);
    if (!state || state.retryTimer || state.pending.length === 0) return;
    const timer = setTimeout(
      () => {
        const latest = this.reticulumAudioAwaitingRouteByAddress.get(address);
        if (latest) latest.retryTimer = null;
        this.retryAwaitingRouteReticulumAudio(address);
      },
      Math.max(1, delayMs)
    );
    timer.unref?.();
    state.retryTimer = timer;
  }

  private bufferReticulumAudioAwaitingRoute(
    roomId: string,
    address: string,
    data: Buffer
  ): {
    queuePressureDrops: number;
    staleDrops: number;
    pendingFrames: number;
    pendingOldestAgeMs: number;
  } {
    const now = Date.now();
    let state = this.reticulumAudioAwaitingRouteByAddress.get(address);
    if (!state) {
      state = {
        address,
        rooms: new Set<string>(),
        pending: [],
        recoveryReason: 'awaiting-reticulum-identity',
        retryTimer: null,
      };
      this.reticulumAudioAwaitingRouteByAddress.set(address, state);
    }
    state.rooms.add(roomId);
    let staleDrops = 0;
    while (
      state.pending.length > 0 &&
      now - state.pending[0]!.enqueuedAtMs >
        GC_RETICULUM_AUDIO_PREROUTE_PENDING_MAX_AGE_MS
    ) {
      state.pending.shift();
      staleDrops++;
    }
    state.pending.push({ roomId, data: Buffer.from(data), enqueuedAtMs: now });
    let queuePressureDrops = 0;
    while (
      state.pending.length > GC_RETICULUM_AUDIO_PREROUTE_PENDING_MAX_FRAMES
    ) {
      state.pending.shift();
      queuePressureDrops++;
    }
    this.scheduleAwaitingRouteReticulumAudioRetry(address);
    return {
      queuePressureDrops,
      staleDrops,
      pendingFrames: state.pending.length,
      pendingOldestAgeMs: this.getReticulumAudioPendingOldestAgeMs(
        state.pending,
        now
      ),
    };
  }

  private promoteAwaitingRouteReticulumAudio(
    address: string,
    state?: ReticulumAudioPeerState
  ): void {
    const buffered = this.reticulumAudioAwaitingRouteByAddress.get(address);
    if (!buffered || buffered.pending.length === 0) {
      if (buffered) this.clearAwaitingRouteReticulumAudio(address, buffered);
      return;
    }
    const targetState =
      state ??
      (() => {
        for (const roomId of buffered.rooms) {
          if (!this.rooms.has(roomId)) continue;
          const ensured = this.ensureReticulumAudioPeerState(roomId, address);
          if (ensured) return ensured;
        }
        return null;
      })();
    if (this.reticulumAudioAwaitingRouteByAddress.get(address) !== buffered) {
      return;
    }
    if (!targetState) {
      this.scheduleAwaitingRouteReticulumAudioRetry(address);
      return;
    }
    const now = Date.now();
    for (const pending of buffered.pending) {
      if (
        now - pending.enqueuedAtMs >
        GC_RETICULUM_AUDIO_PREROUTE_PENDING_MAX_AGE_MS
      ) {
        continue;
      }
      this.enqueuePendingReticulumAudio(
        targetState,
        pending.roomId,
        pending.data
      );
    }
    this.clearAwaitingRouteReticulumAudio(address, buffered);
    this.scheduleReticulumAudioFlush();
  }

  private retryAwaitingRouteReticulumAudio(address: string): void {
    const state = this.reticulumAudioAwaitingRouteByAddress.get(address);
    if (!state) return;
    const now = Date.now();
    while (
      state.pending.length > 0 &&
      now - state.pending[0]!.enqueuedAtMs >
        GC_RETICULUM_AUDIO_PREROUTE_PENDING_MAX_AGE_MS
    ) {
      state.pending.shift();
    }
    if (state.pending.length === 0) {
      this.clearAwaitingRouteReticulumAudio(address, state);
      return;
    }
    for (const roomId of [...state.rooms]) {
      if (!this.rooms.has(roomId)) {
        state.rooms.delete(roomId);
        continue;
      }
      const ensured = this.ensureReticulumAudioPeerState(roomId, address);
      if (!ensured) continue;
      if (ensured.transport === 'packet' || ensured.established) {
        this.flushReticulumAudioQueuesFair(address);
      }
      return;
    }
    if (state.rooms.size === 0) {
      this.clearAwaitingRouteReticulumAudio(address, state);
      return;
    }
    this.scheduleAwaitingRouteReticulumAudioRetry(address);
  }

  private getReticulumAudioPendingTotalFrames(): number {
    let total = 0;
    for (const state of this.reticulumAudioPeersByAddress.values()) {
      total += state.pending.length;
    }
    return total;
  }

  private computeReticulumAudioPendingLimit(
    state: ReticulumAudioPeerState
  ): number {
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
    snapshot: ReticulumAudioQueueSnapshot | null | undefined,
    forwarder = false
  ): boolean {
    if (!snapshot) return false;
    const bq = forwarder
      ? GC_RETICULUM_AUDIO_PRESSURE_BRIDGE_QUEUE_FRAMES_FORWARDER
      : GC_RETICULUM_AUDIO_PRESSURE_BRIDGE_QUEUE_FRAMES;
    const dq = forwarder
      ? GC_RETICULUM_AUDIO_PRESSURE_DECODED_QUEUE_DEPTH_FORWARDER
      : GC_RETICULUM_AUDIO_PRESSURE_DECODED_QUEUE_DEPTH;
    const dr = forwarder
      ? GC_RETICULUM_AUDIO_PRESSURE_RECENT_DROPS_FORWARDER
      : GC_RETICULUM_AUDIO_PRESSURE_RECENT_DROPS;
    return (
      snapshot.bridgeWaitingForDrain ||
      snapshot.bridgeQueuedFrames >= bq ||
      snapshot.decodedQueueDepth >= dq ||
      snapshot.queuePressureDropsLast5s >= dr
    );
  }

  /** True if any local address is root-forwarder or cluster forwarder in an active room. */
  private isLocalAddressAnyForwarder(): boolean {
    for (const room of this.rooms.values()) {
      const topo = room.lastTopology;
      if (!topo) continue;
      const root = topo.rootForwarder?.trim();
      if (root) {
        for (const addr of this.localAddresses) {
          if (addr === root) return true;
        }
      }
      for (const cluster of topo.clusters ?? []) {
        const fw = cluster.forwarder?.trim();
        if (fw && this.localAddresses.has(fw)) return true;
      }
    }
    return false;
  }

  /**
   * Scale Reticulum audio flush caps when local node fans out (forwarder) or shortly after
   * renderer-requested media recovery, so pending queues drain faster toward the bridge.
   */
  private getReticulumAudioFlushLimits(): {
    maxPerPass: number;
    maxPerPeer: number;
  } {
    this.refreshReticulumAudioPressureDwell();
    const snap = this.reticulumBridge?.getAudioQueueSnapshot();
    let pass = GC_RETICULUM_AUDIO_FLUSH_MAX_FRAMES_PER_PASS;
    let peer = GC_RETICULUM_AUDIO_FLUSH_MAX_FRAMES_PER_PEER;
    if (snap) {
      const bq = snap.bridgeQueuedFrames;
      const bin = snap.binaryOutQueueDepth;
      const dec = snap.decodedQueueDepth;
      const pressure = Math.min(1, (bq + bin * 2 + dec) / 48);
      const passSpan =
        GC_RETICULUM_AUDIO_FLUSH_MAX_FRAMES_PER_PASS_CAP -
        GC_RETICULUM_AUDIO_FLUSH_MAX_FRAMES_PER_PASS;
      const peerSpan =
        GC_RETICULUM_AUDIO_FLUSH_MAX_FRAMES_PER_PEER_CAP -
        GC_RETICULUM_AUDIO_FLUSH_MAX_FRAMES_PER_PEER;
      pass = Math.round(
        Math.min(
          GC_RETICULUM_AUDIO_FLUSH_MAX_FRAMES_PER_PASS_CAP,
          pass + passSpan * pressure * 0.6
        )
      );
      peer = Math.round(
        Math.min(
          GC_RETICULUM_AUDIO_FLUSH_MAX_FRAMES_PER_PEER_CAP,
          peer + peerSpan * pressure * 0.6
        )
      );
    }
    const now = Date.now();
    const boost =
      now < this.reticulumAudioFlushBoostUntilMs ||
      this.isLocalAddressAnyForwarder();
    if (boost) {
      pass = Math.min(
        GC_RETICULUM_AUDIO_FLUSH_MAX_FRAMES_PER_PASS_CAP,
        pass * GC_RETICULUM_AUDIO_FLUSH_SCALE_FACTOR
      );
      peer = Math.min(
        GC_RETICULUM_AUDIO_FLUSH_MAX_FRAMES_PER_PEER_CAP,
        peer * GC_RETICULUM_AUDIO_FLUSH_SCALE_FACTOR
      );
    }
    if (this.gcallAudioFailSafeActive) {
      pass = Math.min(
        pass,
        Math.round(GC_RETICULUM_AUDIO_FLUSH_MAX_FRAMES_PER_PASS * 1.5)
      );
      peer = Math.min(
        peer,
        Math.round(GC_RETICULUM_AUDIO_FLUSH_MAX_FRAMES_PER_PEER * 1.5)
      );
    }
    return { maxPerPass: pass, maxPerPeer: peer };
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
      if (
        !this.dropOldestPendingReticulumAudioFromLargestQueue(state.address)
      ) {
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
    deltas?: Partial<
      Omit<
        GcReticulumAudioSendDiagnostics,
        'pendingFrames' | 'pendingOldestAgeMs' | 'bridge'
      >
    >
  ): GcReticulumAudioSendDiagnostics {
    const now = Date.now();
    const fallbackActive = state?.packetTransportFallback === true;
    const pathDiversityActive = !!state && state.pathDiversityUntilMs > now;
    const linkEstablishPendingAgeMs =
      state &&
      !state.established &&
      (state.linkId || state.opening) &&
      state.linkEstablishLastAttemptAtMs >= 0
        ? Math.max(0, now - state.linkEstablishLastAttemptAtMs)
        : undefined;
    return {
      transport: state?.transport ?? this.getReticulumAudioTransportKind(),
      pendingFrames: state?.pending.length ?? 0,
      pendingOldestAgeMs: state
        ? this.getReticulumAudioPendingOldestAgeMs(state.pending, now)
        : undefined,
      queuePressureDrops: deltas?.queuePressureDrops ?? 0,
      staleDrops: deltas?.staleDrops ?? 0,
      linkUnreadyDrops: deltas?.linkUnreadyDrops ?? 0,
      packetSendFailures: deltas?.packetSendFailures ?? 0,
      ...(address ? { targetAddress: address } : {}),
      ...(state?.peerPresenceHash
        ? { peerPresenceHash: state.peerPresenceHash }
        : {}),
      ...(state?.routeKey ? { routeKey: state.routeKey } : {}),
      ...(state
        ? {
            linkEstablished: state.established,
            linkOpenedByOwner: state.linkOpenedByOwner,
            linkOpening: state.opening,
            linkEstablishLastAttemptAtMs: state.linkEstablishLastAttemptAtMs,
            linkEstablishRetryDelayMs: state.linkEstablishRetryDelayMs,
            linkOpenAttempts: state.linkOpenAttempts,
            linkEstablishedCount: state.linkEstablishedCount,
            linkEstablishedAtMs: state.linkEstablishedAtMs,
            linkStaleCloseCount: state.linkStaleCloseCount,
            pendingControlFrames: state.pendingControl.length,
            linkAuthSentCount: state.linkAuthSentCount,
            linkAuthRxCount: state.linkAuthRxCount,
            linkAuthAppliedCount: state.linkAuthAppliedCount,
            lastLinkAuthAtMs: state.lastLinkAuthAtMs,
            lastLinkAuthReason: state.lastLinkAuthReason,
          }
        : {}),
      ...(linkEstablishPendingAgeMs !== undefined
        ? { linkEstablishPendingAgeMs }
        : {}),
      ...(state?.linkId ? { linkId: state.linkId } : {}),
      ...(state?.lastLinkCloseReason
        ? {
            lastLinkCloseReason: state.lastLinkCloseReason,
            lastLinkCloseAtMs: state.lastLinkCloseAtMs,
            lastLinkCloseLinkId: state.lastLinkCloseLinkId,
          }
        : {}),
      ...(state?.lastLinkUnreadyReason
        ? {
            lastLinkUnreadyReason: state.lastLinkUnreadyReason,
            lastLinkUnreadyAtMs: state.lastLinkUnreadyAtMs,
            lastLinkUnreadyLinkId: state.lastLinkUnreadyLinkId,
          }
        : {}),
      ...(state?.lastInboundAtMs
        ? { lastInboundAtMs: state.lastInboundAtMs }
        : {}),
      ...(state?.recoveryReason
        ? { recoveryReason: state.recoveryReason }
        : {}),
      ...(state && state.recoveryHoldUntilMs > 0
        ? { recoveryHoldUntilMs: state.recoveryHoldUntilMs }
        : {}),
      ...(fallbackActive
        ? {
            linkFallbackActive: true,
            linkFallbackReason:
              state?.recoveryReason || state?.packetLinkFallbackReason || '',
            linkFallbackDwellMs:
              state && state.packetFallbackActivatedAtMs > 0
                ? Math.max(0, now - state.packetFallbackActivatedAtMs)
                : 0,
          }
        : {}),
      ...(state && state.packetFallbackProbeCount > 0
        ? { linkFallbackProbeCount: state.packetFallbackProbeCount }
        : {}),
      ...(state && state.packetFallbackExitCount > 0
        ? { linkFallbackExitCount: state.packetFallbackExitCount }
        : {}),
      ...(state && state.packetFallbackLastDwellMs > 0
        ? { linkFallbackLastDwellMs: state.packetFallbackLastDwellMs }
        : {}),
      ...(pathDiversityActive
        ? {
            pathDiversityActive: true,
            pathDiversityReason: state.pathDiversityReason,
          }
        : {}),
      ...(deltas?.pathDiversityMirrorAttempts != null
        ? { pathDiversityMirrorAttempts: deltas.pathDiversityMirrorAttempts }
        : {}),
      ...(deltas?.pathDiversityMirrorSuccesses != null
        ? { pathDiversityMirrorSuccesses: deltas.pathDiversityMirrorSuccesses }
        : {}),
      ...(deltas?.pathDiversityMirrorFailures != null
        ? { pathDiversityMirrorFailures: deltas.pathDiversityMirrorFailures }
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
    if (!bridge || !state || !this.hasEstablishedReticulumAudioLink(state)) {
      return null;
    }
    let queuePressureDrops = 0;
    let staleDrops = 0;
    let linkUnreadyDrops = 0;
    let packetSendFailures = 0;
    let pathDiversityMirrorAttempts = 0;
    let pathDiversityMirrorSuccesses = 0;
    let pathDiversityMirrorFailures = 0;
    let framesEnqueued = 0;
    let bridgePressured = false;
    let nextDelayMs = 0;
    const maxFrames = opts?.maxFrames ?? Number.POSITIVE_INFINITY;
    const forwarderPressured = this.isLocalAddressAnyForwarder();
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
          pathDiversityMirrorAttempts,
          pathDiversityMirrorSuccesses,
          pathDiversityMirrorFailures,
        }),
        framesEnqueued,
        bridgePressured,
        nextDelayMs,
      };
    }
    if (
      state.transport === 'packet' &&
      state.pending.length > 0 &&
      state.packetDegradedSinceMs > 0
    ) {
      this.requestReticulumPacketPathWarmup(
        address,
        state,
        'packet-drain-recovery',
        {
          holdAudio: false,
        }
      );
    }
    while (
      state.pending.length > 0 &&
      this.hasEstablishedReticulumAudioLink(state) &&
      framesEnqueued < maxFrames
    ) {
      const head = state.pending[0];
      if (head && Date.now() - head.enqueuedAtMs > maxAgeMs) {
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
        if (state.transport === 'packet') {
          state.lastOutboundPacketAtMs = Date.now();
          this.maybeActivateReticulumPacketFallback(
            address,
            state,
            'packet-fallback:path-unresolved'
          );
        }
        if (state.pathDiversityUntilMs > Date.now()) {
          const mirrorResult =
            state.transport === 'packet'
              ? state.established && state.linkId
                ? bridge.enqueueGroupAudio(state.linkId, next.roomId, next.data)
                : null
              : bridge.enqueuePacketGroupAudio(
                  state.peerPresenceHash,
                  next.roomId,
                  next.data,
                  state.peerDestinationHash
                );
          if (mirrorResult) {
            pathDiversityMirrorAttempts++;
            if (mirrorResult.ok === true) {
              pathDiversityMirrorSuccesses++;
              queuePressureDrops += mirrorResult.queuePressureDrops;
              staleDrops += mirrorResult.staleDrops;
              packetSendFailures = Math.max(
                packetSendFailures,
                mirrorResult.snapshot.packetSendFailures
              );
              if (state.transport === 'link') {
                state.lastOutboundPacketAtMs = Date.now();
              }
            } else {
              const failure = mirrorResult as {
                ok: false;
                reason: ReticulumSendFailureReason;
              };
              pathDiversityMirrorFailures++;
              this.logReticulumFailureThrottled(
                `target-reticulum-audio-diversity-mirror:${address}:${failure.reason}`,
                `[GCall] target=reticulum-audio diversity mirror failed address=${address} primary=${state.transport} reason=${failure.reason}`
              );
            }
          }
        }
        bridgePressured =
          bridgePressured ||
          (opts?.stopOnPressure === true &&
            this.isReticulumAudioBridgePressured(
              result.snapshot,
              forwarderPressured
            ));
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
          this.markReticulumAudioLinkUnready(
            address,
            state.linkId ?? undefined,
            `enqueue-failed:${result.reason}`
          );
          void this.openReticulumAudioLinkForAddress(address);
        }
      }
      return {
        diagnostics: this.buildReticulumAudioSendDiagnostics(state, address, {
          queuePressureDrops,
          staleDrops,
          linkUnreadyDrops,
          packetSendFailures,
          pathDiversityMirrorAttempts,
          pathDiversityMirrorSuccesses,
          pathDiversityMirrorFailures,
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
        pathDiversityMirrorAttempts,
        pathDiversityMirrorSuccesses,
        pathDiversityMirrorFailures,
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
          this.hasEstablishedReticulumAudioLink(state)
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
    const { maxPerPass, maxPerPeer } = this.getReticulumAudioFlushLimits();
    let totalFramesEnqueued = 0;
    let bridgePressured = false;
    let nextDelayMs = 0;
    let diagnostics = this.buildReticulumAudioSendDiagnostics(undefined);
    for (
      let offset = 0;
      offset < addresses.length && totalFramesEnqueued < maxPerPass;
      offset++
    ) {
      const address = addresses[(startIndex + offset) % addresses.length]!;
      const flushed = this.flushPendingReticulumAudioForAddress(address, {
        maxFrames: maxPerPeer,
        stopOnPressure: true,
      });
      if (!flushed) continue;
      totalFramesEnqueued += flushed.framesEnqueued;
      bridgePressured = bridgePressured || flushed.bridgePressured;
      nextDelayMs = Math.max(nextDelayMs, flushed.nextDelayMs ?? 0);
      diagnostics = mergeGcReticulumAudioSendDiagnostics(
        diagnostics,
        flushed.diagnostics
      );
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
        this.markReticulumAudioLinkUnready(
          address,
          payload.linkId,
          `send-failed:${payload.code || payload.reason}`
        );
        void this.openReticulumAudioLinkForAddress(address);
      }
    }
    if ((payload.transport ?? 'link') === 'packet') {
      const state = this.reticulumAudioPeersByAddress.get(address);
      if (state) {
        if (
          code === 'path_request_timeout' ||
          code === 'packet_send_false' ||
          code === 'exception'
        ) {
          this.noteReticulumPacketTransportDegraded(state);
        }
        this.requestReticulumPacketPathWarmup(
          address,
          state,
          payload.code || payload.reason,
          {
            force:
              code === 'path_request_timeout' ||
              code === 'packet_send_false' ||
              code === 'exception',
            holdAudio: true,
          }
        );
        this.maybeActivateReticulumPacketFallback(
          address,
          state,
          `packet-fallback:${code || payload.reason}`
        );
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
        this.clearReticulumAudioOpenDefer(address);
        if (linkId) {
          this.reticulumAudioAddressByLinkId.delete(linkId);
          this.closeReticulumAudioLinkQuietly(linkId, 'sync-no-longer-desired');
        }
        continue;
      }
      state.peerPresenceHash = desired.peerPresenceHash;
      if (this.getReticulumAudioTransportKind() !== 'packet') {
        state.packetTransportFallback = false;
        this.noteReticulumPacketTransportHealthy(state);
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
        this.markReticulumAudioLinkUnready(
          address,
          linkId,
          'sync-link-no-longer-maintained'
        );
        this.closeReticulumAudioLinkQuietly(
          linkId,
          'sync-link-no-longer-maintained'
        );
      }
      if (state.transport === 'packet') {
        this.requestReticulumPacketPathWarmup(
          address,
          state,
          'sync-active-peer',
          {
            holdAudio: false,
            cooldownMs: GC_RETICULUM_AUDIO_RECOVERY_ACTION_COOLDOWN_MS,
          }
        );
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
          packetDegradedSinceMs: 0,
          packetFallbackEvidenceCount: 0,
          packetFallbackActivatedAtMs: 0,
          packetFallbackLastProbeAtMs: 0,
          packetFallbackProbeCount: 0,
          packetFallbackExitCount: 0,
          packetFallbackLastDwellMs: 0,
          packetFallbackLastExitAtMs: 0,
          packetLinkFallbackRequestedUntilMs: 0,
          packetLinkFallbackReason: '',
          peerPacketRxMissingUntilMs: 0,
          routeKey: this.computeReticulumAudioRouteKey(
            this.getEffectiveReticulumAudioTransport(null),
            desired.peerPresenceHash
          ),
          linkId: null,
          linkOpenedByOwner: null,
          established: false,
          opening: false,
          linkAuthSentByRoom: new Map(),
          linkAuthSentCount: 0,
          linkAuthRxCount: 0,
          linkAuthAppliedCount: 0,
          lastLinkAuthAtMs: 0,
          lastLinkAuthReason: '',
          rooms: desired.rooms,
          pending: [],
          pendingControl: [],
          lastInboundAtMs: 0,
          lastInboundPacketAtMs: 0,
          lastOutboundPacketAtMs: 0,
          lastPathWarmAtMs: 0,
          lastRecoveryActionAtMs: 0,
          recoveryHoldUntilMs: 0,
          recoveryReason: '',
          linkHeartbeatSeq: 0,
          linkHeartbeatAwaitingSeq: 0,
          linkHeartbeatLastPingAtMs: 0,
          linkHeartbeatLastPongAtMs: 0,
          linkHeartbeatLastRxAtMs: 0,
          linkHeartbeatMissedPongs: 0,
          linkHeartbeatLastRecoveryAtMs: 0,
          linkEstablishedAtMs: 0,
          linkEstablishLastAttemptAtMs: -1,
          linkEstablishRetryDelayMs:
            GC_RETICULUM_AUDIO_LINK_ESTABLISH_RETRY_MIN_MS,
          linkOpenAttempts: 0,
          linkEstablishedCount: 0,
          linkStaleCloseCount: 0,
          lastLinkCloseReason: '',
          lastLinkCloseAtMs: 0,
          lastLinkCloseLinkId: '',
          lastLinkUnreadyReason: '',
          lastLinkUnreadyAtMs: 0,
          lastLinkUnreadyLinkId: '',
          pathDiversityUntilMs: 0,
          pathDiversityReason: '',
        };
        this.reticulumAudioPeersByAddress.set(address, state);
        this.reticulumAudioAddressByLinkId.set(state.routeKey, address);
      } else {
        state.peerPresenceHash = desired.peerPresenceHash;
        if (this.getReticulumAudioTransportKind() !== 'packet') {
          state.packetTransportFallback = false;
          this.noteReticulumPacketTransportHealthy(state);
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
        this.requestReticulumPacketPathWarmup(
          address,
          state,
          'sync-active-peer',
          {
            holdAudio: false,
            cooldownMs: GC_RETICULUM_AUDIO_RECOVERY_ACTION_COOLDOWN_MS,
          }
        );
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
      this.emit('gcall:audio', {
        roomId,
        data: Buffer.from(data),
        fromAddress: toAddress,
      });
      return {
        success: true,
        diagnostics: {
          transport: this.getReticulumAudioTransportKind(),
          pendingFrames: 0,
          pendingOldestAgeMs: 0,
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
      const buffered = this.bufferReticulumAudioAwaitingRoute(
        roomId,
        toAddress,
        data
      );
      this.logReticulumFailureThrottled(
        `audio-awaiting-route:${roomId}:${toAddress}`,
        `[GCall] sendAudio buffered awaiting Reticulum identity for ${toAddress}`
      );
      return {
        success: true,
        diagnostics: {
          transport: this.getReticulumAudioTransportKind(),
          pendingFrames: buffered.pendingFrames,
          pendingOldestAgeMs: buffered.pendingOldestAgeMs,
          queuePressureDrops: buffered.queuePressureDrops,
          staleDrops: buffered.staleDrops,
          linkUnreadyDrops: 0,
          packetSendFailures: 0,
          targetAddress: toAddress,
          recoveryReason: 'awaiting-reticulum-identity',
        },
      };
    }
    const enqueueStats = this.enqueuePendingReticulumAudio(state, roomId, data);
    this.scheduleReticulumAudioFlush();
    if (this.hasEstablishedReticulumAudioLink(state)) {
      const flushed = this.flushReticulumAudioQueuesFair(toAddress);
      if (flushed) {
        return {
          success: true,
          diagnostics: {
            ...flushed.diagnostics,
            targetAddress: toAddress,
            queuePressureDrops:
              flushed.diagnostics.queuePressureDrops +
              enqueueStats.queuePressureDrops,
            staleDrops:
              flushed.diagnostics.staleDrops + enqueueStats.staleDrops,
          },
        };
      }
    }
    return {
      success: true,
      diagnostics: this.buildReticulumAudioSendDiagnostics(
        state,
        toAddress,
        enqueueStats
      ),
    };
  }

  /**
   * Same payload to multiple peers — one IPC invoke from renderer with shared enqueue/flush work.
   */
  sendAudioBatch(
    roomId: string,
    toAddresses: string[],
    data: Buffer
  ): GcReticulumAudioSendResult {
    if (!isValidGcAudioBuffer(data)) {
      loggerWarn('[GCall] sendAudioBatch dropped: invalid or oversize payload');
      return { success: false, error: 'invalid-or-oversize-payload' };
    }
    if (toAddresses.length === 0) {
      return {
        success: true,
        diagnostics: {
          transport: this.getReticulumAudioTransportKind(),
          pendingFrames: 0,
          queuePressureDrops: 0,
          staleDrops: 0,
          linkUnreadyDrops: 0,
          packetSendFailures: 0,
        },
      };
    }
    let shouldScheduleFlush = false;
    let flushablePreferredAddress: string | undefined;
    let flushableEnqueueQueuePressureDrops = 0;
    let flushableEnqueueStaleDrops = 0;
    const deferredFlushableDiagnostics: GcReticulumAudioSendDiagnostics[] = [];
    let merged: GcReticulumAudioSendDiagnostics | null = null;
    for (const toAddress of toAddresses) {
      if (this.localAddresses.has(toAddress)) {
        this.emit('gcall:audio', {
          roomId,
          data: Buffer.from(data),
          fromAddress: toAddress,
        });
        const diagnostics: GcReticulumAudioSendDiagnostics = {
          transport: this.getReticulumAudioTransportKind(),
          pendingFrames: 0,
          queuePressureDrops: 0,
          staleDrops: 0,
          linkUnreadyDrops: 0,
          packetSendFailures: 0,
          targetAddress: toAddress,
        };
        merged = merged
          ? mergeGcReticulumAudioSendDiagnostics(merged, diagnostics)
          : diagnostics;
        continue;
      }
      const state = this.ensureReticulumAudioPeerState(roomId, toAddress);
      if (!state) {
        const buffered = this.bufferReticulumAudioAwaitingRoute(
          roomId,
          toAddress,
          data
        );
        this.logReticulumFailureThrottled(
          `audio-awaiting-route:${roomId}:${toAddress}`,
          `[GCall] sendAudio buffered awaiting Reticulum identity for ${toAddress}`
        );
        const diagnostics: GcReticulumAudioSendDiagnostics = {
          transport: this.getReticulumAudioTransportKind(),
          pendingFrames: buffered.pendingFrames,
          queuePressureDrops: buffered.queuePressureDrops,
          staleDrops: buffered.staleDrops,
          linkUnreadyDrops: 0,
          packetSendFailures: 0,
          targetAddress: toAddress,
          recoveryReason: 'awaiting-reticulum-identity',
        };
        merged = merged
          ? mergeGcReticulumAudioSendDiagnostics(merged, diagnostics)
          : diagnostics;
        continue;
      }
      const enqueueStats = this.enqueuePendingReticulumAudio(
        state,
        roomId,
        data
      );
      shouldScheduleFlush = true;
      if (this.hasEstablishedReticulumAudioLink(state)) {
        flushablePreferredAddress ??= toAddress;
        flushableEnqueueQueuePressureDrops += enqueueStats.queuePressureDrops;
        flushableEnqueueStaleDrops += enqueueStats.staleDrops;
        deferredFlushableDiagnostics.push(
          this.buildReticulumAudioSendDiagnostics(state, toAddress)
        );
        continue;
      }
      const diagnostics = this.buildReticulumAudioSendDiagnostics(
        state,
        toAddress,
        enqueueStats
      );
      merged = merged
        ? mergeGcReticulumAudioSendDiagnostics(merged, diagnostics)
        : diagnostics;
    }
    if (shouldScheduleFlush) {
      this.scheduleReticulumAudioFlush();
    }
    for (const diagnostics of deferredFlushableDiagnostics) {
      merged = merged
        ? mergeGcReticulumAudioSendDiagnostics(merged, diagnostics)
        : diagnostics;
    }
    if (flushablePreferredAddress) {
      const flushed = this.flushReticulumAudioQueuesFair(
        flushablePreferredAddress
      );
      if (flushed) {
        const diagnostics = {
          ...flushed.diagnostics,
          queuePressureDrops:
            flushed.diagnostics.queuePressureDrops +
            flushableEnqueueQueuePressureDrops,
          staleDrops:
            flushed.diagnostics.staleDrops + flushableEnqueueStaleDrops,
        };
        merged = merged
          ? mergeGcReticulumAudioSendDiagnostics(merged, diagnostics)
          : diagnostics;
      } else if (
        flushableEnqueueQueuePressureDrops > 0 ||
        flushableEnqueueStaleDrops > 0
      ) {
        const fallback = {
          ...this.buildReticulumAudioSendDiagnostics(undefined),
          queuePressureDrops: flushableEnqueueQueuePressureDrops,
          staleDrops: flushableEnqueueStaleDrops,
        };
        merged = merged
          ? mergeGcReticulumAudioSendDiagnostics(merged, fallback)
          : fallback;
      }
    }
    return { success: true, diagnostics: merged! };
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
    const { sentLinks, skippedLinks } =
      this.sendReticulumLinkControlToAddresses(
        roomId,
        keyFrames,
        [toAddress],
        new Set([fromAddress]),
        'GC_KEY'
      );
    loggerLog(
      `[GCall] Queued GC_KEY (Reticulum links) for room ${roomId} to=${toAddress} links=${sentLinks} skipped=${skippedLinks}`
    );
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
    const { sentLinks, skippedLinks } =
      this.sendReticulumLinkControlToAddresses(
        roomId,
        keyRotateFrames,
        Object.keys(encryptedKeys),
        new Set([fromAddress]),
        'GC_KEY_ROTATE'
      );
    loggerLog(
      `[GCall] Queued GC_KEY_ROTATE (Reticulum links) for room ${roomId} recipients=${Object.keys(encryptedKeys).length} links=${sentLinks} skipped=${skippedLinks}`
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
    const { sentLinks, skippedLinks } =
      this.sendReticulumLinkControlToAddresses(
        roomId,
        gqFrames,
        [toAddress],
        new Set([fromAddress]),
        'GC_KEY_REQUEST'
      );
    loggerLog(
      `[GCall] Queued GC_KEY_REQUEST (Reticulum links) for room ${roomId} to=${toAddress} links=${sentLinks} skipped=${skippedLinks}`
    );
  }

  // ── Inbound ───────────────────────────────────────────────────────────────

  handleIncoming(
    env: GcEnvelope,
    fromNodeId?: string,
    peerPresenceHash?: string
  ): void {
    if (!GC_MESSAGE_TYPES.has(env.type)) return;
    if (this.pendingKeyByRoom.size > 0) this.sweepExpiredPendingKeys();
    if (this.pendingGcJoinBeforeJoinRoom.size > 0)
      this.sweepExpiredPendingGcJoin();

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
    if (this.pendingGcJoinBeforeJoinRoom.size > 0)
      this.sweepExpiredPendingGcJoin();
    const watchedSpectatorRoom = this.isWatchedQortalRoom(env.roomId);
    if (!this.hasLocalRoomInterest(env.roomId) && !watchedSpectatorRoom) {
      this.enqueuePendingGcJoinBeforeJoinRoom(
        env,
        fromNodeId,
        peerPresenceHash
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
      buildGcJoinSignedFields(env),
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
      reticulumDestinationHash: decoded.reticulumDestinationHash
        .trim()
        .toLowerCase(),
      reticulumIdentityPublicKeyBase64:
        decoded.reticulumIdentityPublicKeyBase64,
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
    this.noteRecentCallActivity(env.roomId, env.fromAddress, env.timestamp);
    const room = this.rooms.get(env.roomId);
    if (!room) {
      return;
    }
    if (fromNodeId) {
      this.participantNodeIds.set(env.fromAddress, fromNodeId);
    }
    if (!isRnsIdentityPublicKeyBase64(env.reticulumIdentityPublicKeyBase64)) {
      return;
    }
    const existing = room.participants.get(env.fromAddress);
    if (!existing) {
      return;
    }
    room.participants.set(env.fromAddress, {
      publicKey: existing.publicKey,
      joinedAt: existing.joinedAt,
      reticulumDestinationHash: env.reticulumDestinationHash
        .trim()
        .toLowerCase(),
      reticulumIdentityPublicKeyBase64: env.reticulumIdentityPublicKeyBase64,
    });
    this.noteBootstrapParticipantActivity(
      env.roomId,
      env.fromAddress,
      env.timestamp
    );
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
    this.rememberRetainedVerifiedJoinRk(env);
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
    this.noteRecentCallActivity(env.roomId, env.fromAddress, env.timestamp);
    const room = this.rooms.get(env.roomId);
    if (!room) {
      if (this.isWatchedQortalRoom(env.roomId)) {
        this.noteSpectatorReticulumLiveness(env.roomId);
      }
      return;
    }

    // Cache the address → nodeId mapping for targeted audio delivery.
    if (fromNodeId) {
      this.participantNodeIds.set(env.fromAddress, fromNodeId);
    }

    const existing = room.participants.get(env.fromAddress);
    if (
      shouldRefreshParticipantFromVerifiedJoin({
        currentJoinedAt: existing?.joinedAt,
        incomingJoinTimestamp: env.timestamp,
        lastLeaveTimestamp: this.getParticipantLeftTimestamp(
          env.roomId,
          env.fromAddress
        ),
      })
    ) {
      room.participants.set(env.fromAddress, {
        publicKey: env.fromPublicKey,
        joinedAt: env.timestamp,
        reticulumDestinationHash: env.reticulumDestinationHash
          .trim()
          .toLowerCase(),
        ...(env.reticulumIdentityPublicKeyBase64 &&
        isRnsIdentityPublicKeyBase64(env.reticulumIdentityPublicKeyBase64)
          ? {
              reticulumIdentityPublicKeyBase64:
                env.reticulumIdentityPublicKeyBase64,
            }
          : {}),
      });
      this.clearParticipantLeftTombstone(env.roomId, env.fromAddress);
      this.noteBootstrapParticipantActivity(
        env.roomId,
        env.fromAddress,
        env.timestamp
      );
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

    this.rememberRetainedVerifiedJoin(env);
    this.registerPeerIdentityFromJoinWire(env);
    if (this.shouldDeferInitialAudioOpenForVerifiedJoin(room, env)) {
      this.deferReticulumAudioOpenForAddress(
        env.fromAddress,
        GC_RETICULUM_JOINER_AUDIO_OPEN_DEFER_MS
      );
      loggerLog(
        `[GCall] Deferring outbound Reticulum audio link open for older peer ${env.fromAddress} in ${env.roomId} by ${GC_RETICULUM_JOINER_AUDIO_OPEN_DEFER_MS}ms`
      );
    } else {
      this.clearReticulumAudioOpenDefer(env.fromAddress);
    }
    if (
      this.shouldReplayRetainedJoinIdentityForLateJoin(
        env.roomId,
        env.fromAddress
      )
    ) {
      this.replayRetainedJoinIdentityToAddress(
        env.roomId,
        env.fromAddress,
        env.fromAddress
      );
    }

    // Only notify the renderer when the local client is actively in this room.
    if (this.hasLocalRoomInterest(env.roomId)) {
      const roomRow = this.rooms.get(env.roomId);
      const chatIdForEmit = roomRow?.chatId?.startsWith('direct:')
        ? roomRow.chatId
        : env.chatId;
      this.emit('gcall:participant-joined', {
        roomId: env.roomId,
        chatId: chatIdForEmit,
        address: env.fromAddress,
        publicKey: env.fromPublicKey,
        timestamp: env.timestamp,
        ...(typeof env.joinGeneration === 'number' &&
        Number.isFinite(env.joinGeneration)
          ? { joinGeneration: env.joinGeneration }
          : {}),
      });
    }
    if (this.isWatchedQortalRoom(env.roomId)) {
      this.noteSpectatorReticulumLiveness(env.roomId);
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
    this.handleLeave(env.roomId, env.fromAddress, false, env.timestamp);
  }

  private handleLeave(
    roomId: string,
    address: string,
    isAbrupt: boolean,
    leaveTimestamp = Date.now()
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
      if (!isAbrupt) {
        this.noteParticipantLeft(roomId, address, leaveTimestamp);
        this.dropRetainedVerifiedJoinState(roomId, address);
        this.clearRecentCallActivityForAddress(roomId, address);
        this.clearBootstrapParticipantActivityForAddress(roomId, address);
      }
      if (room.participants.size === 0) {
        if (!isAbrupt) {
          this.clearRetainedVerifiedJoinStatesForRoom(roomId);
          this.clearRecentCallActivityForRoom(roomId);
          this.clearBootstrapParticipantActivityForRoom(roomId);
        }
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
    if (!isAbrupt) {
      this.forgetReticulumPeerPresenceHash(address);
      this.clearAwaitingRouteReticulumAudio(address);
    }
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
    this.noteRecentCallActivity(env.roomId, env.fromAddress, env.timestamp);
    this.noteRecentCallActivityForTopology(env.roomId, env, env.timestamp);
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
    this.noteRecentCallActivity(env.roomId, env.fromAddress, env.timestamp);

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

  private handleReticulumAudioLinkHeartbeatWire(
    wire: GcReticulumAudioLinkHeartbeatWire,
    senderDestinationHash: string,
    peerPresenceHash: string,
    linkId: string
  ): void {
    const hasLocalInterest = this.hasLocalRoomInterest(wire.R);
    const address = hasLocalInterest
      ? this.resolveReticulumAudioAddress(
          linkId,
          peerPresenceHash || senderDestinationHash,
          wire.R
        )
      : null;
    loggerLog(
      `[GCall] Reticulum audio link heartbeat rx command=${wire.c} room=${wire.R} linkId=${linkId || 'n/a'} peerPresenceHash=${peerPresenceHash || 'n/a'} senderDestinationHash=${senderDestinationHash || 'n/a'} address=${address ?? 'unresolved'} seq=${wire.p ?? 'n/a'} packetRxRecent=${wire.packetRxRecent === undefined ? 'n/a' : wire.packetRxRecent ? 'yes' : 'no'} packetRxAgeMs=${wire.packetRxAgeMs ?? 'n/a'} localInterest=${hasLocalInterest ? 'yes' : 'no'}`
    );
    if (!hasLocalInterest) return;
    if (!address) {
      this.closeReticulumAudioLinkQuietly(
        linkId,
        'heartbeat-unresolved-address'
      );
      return;
    }
    if (
      !this.isReticulumAudioLinkVerifiedForAddress(
        address,
        peerPresenceHash || senderDestinationHash,
        senderDestinationHash
      ) &&
      !this.isOnlyRemoteParticipantInRoom(wire.R, address)
    ) {
      this.closeReticulumAudioLinkQuietly(
        linkId,
        'heartbeat-unverified-address'
      );
      return;
    }
    this.noteRecentCallActivity(wire.R, address);
    if (!this.reticulumAudioPeersByAddress.has(address)) {
      void this.ensureReticulumAudioPeerState(wire.R, address);
    }
    const state = this.reticulumAudioPeersByAddress.get(address);
    if (!state) return;
    const now = Date.now();
    this.noteReticulumAudioLinkActivity(state, now);
    if (linkId) {
      if (state.established && state.linkId && state.linkId !== linkId) {
        this.closeReticulumAudioLinkQuietly(linkId, 'duplicate-heartbeat');
        return;
      }
      if (!state.established) {
        this.adoptEstablishedReticulumAudioLink(
          address,
          state,
          linkId,
          senderDestinationHash,
          null,
          'heartbeat'
        );
      } else {
        this.reticulumAudioAddressByLinkId.set(linkId, address);
      }
    }
    if (senderDestinationHash) {
      state.peerDestinationHash = senderDestinationHash;
    }
    this.maybeActivateReticulumFallbackFromPeerRxReport(address, state, wire);
    if (wire.c === 'PONG') return;
    this.sendReticulumAudioLinkHeartbeat(
      address,
      state,
      wire.R,
      'PONG',
      wire.p
    );
  }

  private shouldAcceptStaleReticulumLinkAuthJoin(
    env: GcJoinEnvelope
  ): boolean {
    const room = this.rooms.get(env.roomId);
    const participant = room?.participants.get(env.fromAddress);
    if (!participant) return false;
    if (participant.publicKey !== env.fromPublicKey) return false;
    const incomingHash = env.reticulumDestinationHash.trim().toLowerCase();
    const knownHash = participant.reticulumDestinationHash.trim().toLowerCase();
    return Boolean(incomingHash && incomingHash === knownHash);
  }

  private handleReticulumLinkAuthJoinWire(
    wire: Record<string, unknown>,
    payload: {
      roomId: string;
      linkId: string;
      peerPresenceHash: string;
      peerDestinationHash: string;
      incoming: boolean;
    }
  ): boolean {
    if (wire.t !== 'GJ') return false;
    const env = decodeJoinWire(wire);
    if (!env) {
      this.closeReticulumAudioLinkQuietly(payload.linkId, 'link-auth-bad-join');
      return true;
    }
    if (env.roomId !== payload.roomId || !this.hasLocalRoomInterest(env.roomId)) {
      this.closeReticulumAudioLinkQuietly(payload.linkId, 'link-auth-wrong-room');
      return true;
    }
    if (this.localAddresses.has(env.fromAddress)) {
      this.closeReticulumAudioLinkQuietly(payload.linkId, 'link-auth-self');
      return true;
    }
    const preRej = gcJoinTimestampRejectReason(env.timestamp, Date.now());
    if (
      preRej === 'future' ||
      (preRej === 'expired' && !this.shouldAcceptStaleReticulumLinkAuthJoin(env))
    ) {
      this.closeReticulumAudioLinkQuietly(
        payload.linkId,
        `link-auth-${preRej}`
      );
      return true;
    }
    this.enqueueVerify(
      buildGcJoinSignedFields(env),
      env.signature,
      env.fromPublicKey,
      env.fromAddress,
      {
        kind: 'link_auth_join',
        env,
        linkId: payload.linkId,
        peerDestinationHash: payload.peerDestinationHash,
        peerPresenceHash: payload.peerPresenceHash,
        incoming: payload.incoming,
      }
    );
    const currentAddress = this.reticulumAudioAddressByLinkId.get(payload.linkId);
    const state = currentAddress
      ? this.reticulumAudioPeersByAddress.get(currentAddress)
      : undefined;
    if (state) {
      state.linkAuthRxCount++;
      state.lastLinkAuthAtMs = Date.now();
      state.lastLinkAuthReason = 'rx';
    }
    return true;
  }

  private applyVerifiedReticulumLinkAuthJoin(
    job: Extract<GcVerifyPending, { kind: 'link_auth_join' }>
  ): void {
    const env = job.env;
    const room = this.rooms.get(env.roomId);
    const participant = room?.participants.get(env.fromAddress);
    if (!room || !participant) {
      this.closeReticulumAudioLinkQuietly(job.linkId, 'link-auth-no-participant');
      return;
    }
    if (participant.publicKey !== env.fromPublicKey) {
      this.closeReticulumAudioLinkQuietly(
        job.linkId,
        'link-auth-public-key-mismatch'
      );
      return;
    }
    const signedHash = env.reticulumDestinationHash.trim().toLowerCase();
    if (signedHash) {
      this.rememberReticulumPeerPresenceHash(env.fromAddress, signedHash);
    }
    let state = this.reticulumAudioPeersByAddress.get(env.fromAddress);
    if (!state) {
      state = this.ensureReticulumAudioPeerState(env.roomId, env.fromAddress);
    } else {
      state.rooms.add(env.roomId);
    }
    if (!state) {
      this.closeReticulumAudioLinkQuietly(job.linkId, 'link-auth-no-peer-state');
      return;
    }
    state.peerDestinationHash =
      job.peerDestinationHash || state.peerDestinationHash;
    this.reticulumAudioAddressByLinkId.set(job.linkId, env.fromAddress);
    if (
      this.adoptEstablishedReticulumAudioLink(
        env.fromAddress,
        state,
        job.linkId,
        job.peerDestinationHash,
        job.incoming,
        'link-auth'
      )
    ) {
      state.linkAuthAppliedCount++;
      state.lastLinkAuthAtMs = Date.now();
      state.lastLinkAuthReason = 'applied';
      this.noteRecentCallActivity(env.roomId, env.fromAddress, env.timestamp);
      this.noteBootstrapParticipantActivity(
        env.roomId,
        env.fromAddress,
        env.timestamp
      );
      this.scheduleReticulumAudioFlush();
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
    receivedAtWallMs?: number;
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
      loggerWarn(
        '[GCall] Reticulum audio dropped: invalid or oversize payload'
      );
      return;
    }
    const audioPeerPresenceHash =
      payload.peerPresenceHash || payload.peerDestinationHash;
    const fromAddress = this.resolveReticulumAudioAddress(
      payload.routeKey ?? payload.linkId,
      audioPeerPresenceHash,
      payload.roomId
    );
    const inboundLinkControlWire =
      (payload.transport ?? 'link') === 'link' && payload.linkId
        ? decodeGcLinkControlWire(raw)
        : null;
    if (
      inboundLinkControlWire &&
      this.handleReticulumLinkAuthJoinWire(inboundLinkControlWire, {
        roomId: payload.roomId,
        linkId: payload.linkId,
        peerPresenceHash: audioPeerPresenceHash,
        peerDestinationHash: payload.peerDestinationHash,
        incoming: payload.incoming,
      })
    ) {
      return;
    }
    if (inboundLinkControlWire && !fromAddress) {
      this.closeReticulumAudioLinkQuietly(
        payload.linkId,
        'control-unresolved-address'
      );
      return;
    }
    if (fromAddress && !this.reticulumAudioPeersByAddress.has(fromAddress)) {
      void this.ensureReticulumAudioPeerState(payload.roomId, fromAddress);
    }
    if (fromAddress) {
      const isLinkPacket = (payload.transport ?? 'link') === 'link';
      if (
        isLinkPacket &&
        !this.isReticulumAudioLinkVerifiedForAddress(
          fromAddress,
          audioPeerPresenceHash,
          payload.peerDestinationHash
        ) &&
        !this.isOnlyRemoteParticipantInRoom(payload.roomId, fromAddress)
      ) {
        this.closeReticulumAudioLinkQuietly(
          payload.linkId,
          'audio-unverified-address'
        );
        return;
      }
      this.noteRecentCallActivity(payload.roomId, fromAddress);
      this.noteBootstrapParticipantActivity(payload.roomId, fromAddress);
      const state = this.reticulumAudioPeersByAddress.get(fromAddress);
      if (state) {
        if (isLinkPacket && payload.linkId) {
          if (
            state.established &&
            state.linkId &&
            state.linkId !== payload.linkId
          ) {
            this.closeReticulumAudioLinkQuietly(
              payload.linkId,
              'duplicate-audio'
            );
            return;
          }
          if (!state.established) {
            this.adoptEstablishedReticulumAudioLink(
              fromAddress,
              state,
              payload.linkId,
              payload.peerDestinationHash,
              payload.incoming,
              'audio'
            );
          }
        }
        state.peerDestinationHash =
          payload.peerDestinationHash || state.peerDestinationHash;
        const now = Date.now();
        state.lastInboundAtMs = now;
        if (
          (payload.transport ?? 'link') === 'link' &&
          payload.linkId === state.linkId
        ) {
          this.noteReticulumAudioLinkActivity(state, now);
        }
        state.recoveryHoldUntilMs = 0;
        state.recoveryReason = '';
        if ((payload.transport ?? 'link') === 'packet') {
          state.lastInboundPacketAtMs = now;
        }
      }
      if (inboundLinkControlWire) {
        this.handleReticulumGroupCallWire(
          inboundLinkControlWire,
          payload.peerDestinationHash,
          audioPeerPresenceHash,
          payload.linkId
        );
        return;
      }
      this.forwardInboundReticulumGroupAudio(payload.roomId, fromAddress, raw);
    }
    this.emit('gcall:audio', {
      roomId: payload.roomId,
      data: raw,
      transport: payload.transport ?? 'link',
      routeKey: payload.routeKey ?? payload.linkId,
      peerPresenceHash: payload.peerPresenceHash,
      peerDestinationHash: payload.peerDestinationHash,
      bridgeReceivedAtWallMs:
        typeof payload.receivedAtWallMs === 'number' &&
        payload.receivedAtWallMs > 0
          ? payload.receivedAtWallMs
          : null,
      resolvedFromAddress: fromAddress ?? null,
      ...(fromAddress ? { fromAddress } : {}),
    });
  }

  private forwardInboundReticulumGroupAudio(
    roomId: string,
    sourceAddr: string,
    data: Buffer
  ): void {
    if (!sourceAddr) return;
    const room = this.rooms.get(roomId);
    const topology = room?.lastTopology;
    if (!room || !topology) return;

    const recipients = new Set<string>();
    for (const localAddress of this.localAddresses) {
      if (!localAddress || !room.participants.has(localAddress)) continue;
      if (localAddress === topology.rootForwarder) {
        for (const cluster of topology.clusters) {
          if (cluster.forwarder === localAddress) {
            for (const member of cluster.members) {
              if (
                member &&
                member !== localAddress &&
                member !== sourceAddr &&
                !this.localAddresses.has(member)
              ) {
                recipients.add(member);
              }
            }
          } else if (
            cluster.forwarder &&
            cluster.forwarder !== sourceAddr &&
            !this.localAddresses.has(cluster.forwarder)
          ) {
            recipients.add(cluster.forwarder);
          }
        }
        continue;
      }

      const myCluster = topology.clusters.find(
        (cluster) => cluster.forwarder === localAddress
      );
      if (!myCluster) continue;
      if (
        topology.rootForwarder &&
        topology.rootForwarder !== localAddress &&
        topology.rootForwarder !== sourceAddr &&
        !this.localAddresses.has(topology.rootForwarder)
      ) {
        recipients.add(topology.rootForwarder);
      }
      for (const member of myCluster.members) {
        if (
          member &&
          member !== localAddress &&
          member !== sourceAddr &&
          !this.localAddresses.has(member)
        ) {
          recipients.add(member);
        }
      }
    }

    if (recipients.size === 0) return;
    this.sendAudioBatch(roomId, [...recipients], Buffer.from(data));
  }

  private handleReticulumGroupAudioLinkEstablished(payload: {
    linkId: string;
    peerPresenceHash: string;
    peerDestinationHash: string;
    incoming: boolean;
  }): void {
    const peerPresenceHash =
      payload.peerPresenceHash || payload.peerDestinationHash;
    const address =
      this.reticulumAudioAddressByLinkId.get(payload.linkId) ??
      this.resolveReticulumAudioAddress(payload.linkId, peerPresenceHash);
    if (!address) {
      loggerLog(
        `[GCall] Reticulum audio link established awaiting auth link=${payload.linkId} peerPresenceHash=${peerPresenceHash || 'n/a'}`
      );
      return;
    }
    const verifiedForAddress = this.isReticulumAudioLinkVerifiedForAddress(
      address,
      peerPresenceHash,
      payload.peerDestinationHash
    );
    if (!this.reticulumAudioPeersByAddress.has(address)) {
      const rid = this.findRoomIdContainingParticipant(address);
      if (rid) {
        void this.ensureReticulumAudioPeerState(rid, address);
      }
    }
    const state = this.reticulumAudioPeersByAddress.get(address);
    if (!state) return;
    if (!verifiedForAddress) {
      state.linkId = payload.linkId;
      state.linkOpenedByOwner = this.isReticulumAudioLinkOpenedByOwner(
        address,
        state,
        payload.incoming
      );
      state.peerDestinationHash =
        payload.peerDestinationHash || state.peerDestinationHash;
      this.reticulumAudioAddressByLinkId.set(payload.linkId, address);
      this.sendReticulumAudioLinkAuth(
        address,
        state,
        'established-awaiting-auth',
        payload.linkId,
        true
      );
      loggerLog(
        `[GCall] Reticulum audio link established awaiting verified auth address=${address} link=${payload.linkId}`
      );
      return;
    }
    if (
      !this.adoptEstablishedReticulumAudioLink(
        address,
        state,
        payload.linkId,
        payload.peerDestinationHash,
        payload.incoming,
        payload.incoming ? 'incoming-established' : 'outgoing-established'
      )
    ) {
      return;
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
    const peerPresenceHash =
      payload.peerPresenceHash || payload.peerDestinationHash;
    const address = this.resolveReticulumAudioAddress(
      payload.linkId,
      peerPresenceHash
    );
    if (!address) return;
    const state = this.reticulumAudioPeersByAddress.get(address);
    if (state?.linkId && state.linkId !== payload.linkId) {
      this.reticulumAudioAddressByLinkId.delete(payload.linkId);
      return;
    }
    this.markReticulumAudioLinkUnready(
      address,
      payload.linkId,
      `bridge-link-closed:${payload.reason || 'unknown'}`
    );
    if (
      state &&
      state.rooms.size > 0 &&
      this.shouldMaintainReticulumAudioLink(state)
    ) {
      const roomId = this.getReticulumAudioHeartbeatRoomId(state);
      if (roomId) {
        state.linkHeartbeatLastRecoveryAtMs = Date.now();
        this.requestReticulumAudioRecovery(roomId, address, 'link-closed', {
          force: true,
          holdAudio: false,
          cooldownMs: GC_RETICULUM_AUDIO_LINK_HEARTBEAT_RECOVERY_COOLDOWN_MS,
        });
      } else {
        void this.openReticulumAudioLinkForAddress(address);
      }
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
    let sessionAdopted = false;
    if (env.mediaSessionGeneration !== room.mediaSessionGeneration) {
      if (env.mediaSessionGeneration > room.mediaSessionGeneration) {
        // Root has advanced the generation (session-break). Adopt the new session.
        room.callSessionId = env.callSessionId;
        room.mediaSessionGeneration = env.mediaSessionGeneration;
        sessionAdopted = true;
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
      sessionAdopted = true;
    }
    if (sessionAdopted) {
      this.pendingVerifiedSessionUpdateByRoom.set(env.roomId, {
        callSessionId: env.callSessionId,
        mediaSessionGeneration: env.mediaSessionGeneration,
      });
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
    let sessionAdopted = false;
    if (env.mediaSessionGeneration !== room.mediaSessionGeneration) {
      if (env.mediaSessionGeneration > room.mediaSessionGeneration) {
        room.callSessionId = env.callSessionId;
        room.mediaSessionGeneration = env.mediaSessionGeneration;
        sessionAdopted = true;
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
      sessionAdopted = true;
    }
    if (sessionAdopted) {
      this.pendingVerifiedSessionUpdateByRoom.set(env.roomId, {
        callSessionId: env.callSessionId,
        mediaSessionGeneration: env.mediaSessionGeneration,
      });
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
    this.noteRecentCallActivity(env.roomId, env.fromAddress, env.timestamp);
    this.noteBootstrapParticipantActivity(
      env.roomId,
      env.fromAddress,
      env.timestamp
    );
    this.emitPendingVerifiedSessionUpdate(env.roomId, env);
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
    this.noteRecentCallActivity(env.roomId, env.fromAddress, env.timestamp);
    this.noteBootstrapParticipantActivity(
      env.roomId,
      env.fromAddress,
      env.timestamp
    );
    this.emitPendingVerifiedSessionUpdate(env.roomId, env);
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
    this.noteRecentCallActivity(env.roomId, env.fromAddress, env.timestamp);
    this.noteBootstrapParticipantActivity(
      env.roomId,
      env.fromAddress,
      env.timestamp
    );
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

  private emitPendingVerifiedSessionUpdate(
    roomId: string,
    env: { callSessionId: string; mediaSessionGeneration: number }
  ): void {
    const pending = this.pendingVerifiedSessionUpdateByRoom.get(roomId);
    if (
      !pending ||
      pending.callSessionId !== env.callSessionId ||
      pending.mediaSessionGeneration !== env.mediaSessionGeneration
    ) {
      return;
    }
    this.pendingVerifiedSessionUpdateByRoom.delete(roomId);
    this.emit('gcall:session-updated', {
      roomId,
      callSessionId: env.callSessionId,
      mediaSessionGeneration: env.mediaSessionGeneration,
    });
  }

  getKeyDigestForTarget(toAddress: string, encryptedKey: string): string {
    return buildGcKeyDigest(toAddress, encryptedKey);
  }

  getKeyRotateDigest(encryptedKeys: Record<string, string>): string {
    return buildGcKeyRotateDigest(encryptedKeys);
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  getRoomParticipants(roomId: string): Array<{
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
        ? {
            reticulumIdentityPublicKeyBase64:
              p.reticulumIdentityPublicKeyBase64,
          }
        : {}),
    }));
  }

  getRoomBootstrapState(roomId: string): GroupRoomBootstrapState | null {
    if (GCALL_DISABLE_ROOM_BOOTSTRAP_CACHE) return null;
    const liveRoom = this.rooms.get(roomId);
    const recent = this.getUsableRecentRoomState(roomId);
    if (!liveRoom && !recent) return null;
    if (!liveRoom) {
      return {
        ...recent!,
        // Fresh recent participants are a bootstrap roster only. They let a
        // fast leave/rejoin restore visible peers until live GC_JOIN traffic
        // or an updated room snapshot arrives again.
        participants: recent!.participants.map((participant) => ({
          ...participant,
          reticulumDestinationHash: participant.reticulumDestinationHash,
          ...(participant.reticulumIdentityPublicKeyBase64
            ? {
                reticulumIdentityPublicKeyBase64:
                  participant.reticulumIdentityPublicKeyBase64,
              }
            : {}),
        })),
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

    const participantsByAddress = new Map(
      live.participants.map((participant) => [participant.address, participant])
    );
    if (
      live.participants.length <= 1 &&
      recent.participants.length > live.participants.length
    ) {
      for (const participant of recent.participants) {
        if (this.getParticipantLeftTimestamp(roomId, participant.address)) {
          continue;
        }
        if (!participantsByAddress.has(participant.address)) {
          participantsByAddress.set(participant.address, participant);
        }
      }
    }

    return {
      ...live,
      participants: [...participantsByAddress.values()],
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
        const lastCallActivityAtMs = this.getRecentCallActivityAt(
          roomId,
          address
        );
        if (
          shouldDelayPresenceEvictionForHealthyTransport({
            lastReportAtMs: transportHealth?.reportedAtMs,
            healthyPeerAddresses:
              transportHealth?.healthyPeerAddresses ?? new Set(),
            address,
            nowMs: now,
            staleAfterMs: GroupCallManager.TRANSPORT_HEALTH_STALE_MS,
          }) ||
          shouldDelayPresenceEvictionForRecentCallActivity({
            lastActivityAtMs: lastCallActivityAtMs,
            nowMs: now,
            staleAfterMs: GroupCallManager.CALL_ACTIVITY_EVICTION_STALE_MS,
          })
        ) {
          delayedByHealthyTransport = true;
          loggerLog(
            `[GCall] Grace period expired for ${address} in ${roomId} — delaying eviction because call activity is still recent`
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
