/**
 * Pending decrypt queue limits for the audio decrypt worker path.
 *
 * Burst limits apply after key sync, participant join, or topology transitions that extend
 * global recovery — see staged escalation in `gcallAudioEscalation.ts` / `useGroupVoiceCall`.
 *
 * **Field tuning:** Prefer signals from the **same export window** as jitter QA (`exportWindowMetrics`);
 * session-level drops/high-water can diverge (see `GCALL_PHASE2_PENDING_DECRYPT_WINDOW_HINT` in `gcall-diagnostics.ts`).
 */

export const PENDING_DECRYPT_MAX = 96;
export const PENDING_DECRYPT_TTL_MS = 500;

/**
 * Recovery-mode cap (outside burst window). Staged increase from 192 for 2-way pending-decrypt
 * saturation; judge by drop rate reduction, not high-water alone (see 2-way stability plan).
 */
export const PENDING_DECRYPT_RECOVERY_MAX = 224;
export const PENDING_DECRYPT_RECOVERY_TTL_MS = 1000;

/** Sustained depth at/above this arms `decryptBurstRecoveryWindow` (see useGroupVoiceCall). */
export const PENDING_DECRYPT_SUSTAINED_ARM_DEPTH = 160;
/** Wall time depth must stay at/above {@link PENDING_DECRYPT_SUSTAINED_ARM_DEPTH} before arming. */
export const PENDING_DECRYPT_SUSTAINED_ARM_MS = 250;
/** Min interval between `pending-decrypt-sustained` burst arms. */
export const PENDING_DECRYPT_SUSTAINED_ARM_COOLDOWN_MS = 30_000;

/** Extra headroom and TTL only while `decryptBurstUntilMs` is in the future. */
export const PENDING_DECRYPT_BURST_EXTEND_MS = 5000;
export const PENDING_DECRYPT_BURST_TTL_MS = 1800;

/** Legacy nominal burst tier (floor for dynamic burst sizing). */
export const PENDING_DECRYPT_BURST_NOMINAL_BASE = 320;
/** @deprecated Use {@link PENDING_DECRYPT_BURST_NOMINAL_BASE} — kept for tuning snapshots. */
export const PENDING_DECRYPT_BURST_MAX = PENDING_DECRYPT_BURST_NOMINAL_BASE;

/** Absolute ceiling for dynamic decrypt burst cap (pathological load). */
export const GLOBAL_MAX_BURST_MAX = 384;

/** Upward slew for effective burst max (queue slots per second). Downward: immediate to requested. */
export const BURST_MAX_SLEW_UP_PER_SEC = 48;

/** Overload (stage 4) — pending decrypt depth hysteresis (renderer). */
export const PENDING_DECRYPT_OVERLOAD_ENTER = 160;
export const PENDING_DECRYPT_OVERLOAD_EXIT = 100;
export const PENDING_DECRYPT_OVERLOAD_EXIT_HOLD_MS = 500;
/** Clamp pending decrypt more aggressively once overload is active to force shedding. */
export const PENDING_DECRYPT_OVERLOAD_MAX = 176;
/** Forwarders fan out every source; clamp even harder during overload. */
export const PENDING_DECRYPT_OVERLOAD_FORWARDER_MAX = 144;
/** Healthy non-forwarders can hold a bit more in flight before they need to shed. */
export const PENDING_DECRYPT_OVERLOAD_PARTICIPANT_MAX = 208;
/** Multi-source participants must shed earlier; fresh audio is better than a deep stale queue. */
export const PENDING_DECRYPT_OVERLOAD_PARTICIPANT_MULTI_MAX = 176;
/** During overload, pending decrypt older than this is no longer useful for real-time audio. */
export const PENDING_DECRYPT_OVERLOAD_TTL_MS = 500;
/** Pre-overload uses a short TTL even while a broader burst window is active. */
export const PENDING_DECRYPT_PRE_OVERLOAD_TTL_MS = 700;

/** Earlier overload entry when depth is rising (paired with {@link PENDING_DECRYPT_OVERLOAD_RISING_TREND_DELTA}). */
export const PENDING_DECRYPT_OVERLOAD_WARM_DEPTH = 96;
/** Depth must increase by at least this vs previous sample to count as “rising” for overload. */
export const PENDING_DECRYPT_OVERLOAD_RISING_TREND_DELTA = 8;
/** Minimum depth for long-task–driven overload entry (stall pressure path). */
export const PENDING_DECRYPT_OVERLOAD_LONG_TASK_MIN_DEPTH = 80;

/** Wall-time budget per macrotask for applying decrypt worker results on the main thread (ms). */
export const GCALL_DECRYPT_APPLY_BUDGET_MS = 7;
/** Safety cap on decrypt applies per macrotask (after time budget). */
export const GCALL_DECRYPT_APPLY_MAX_PER_TURN = 24;

/** Soft ceiling for one jitter drain tick (prefetch + decode + adaptive); FEC prefetch yields first (ms). */
export const GCALL_JITTER_DRAIN_TICK_BUDGET_MS = 14;

/** Newest-first / receive-path shedding policy engages at this depth (aligns with overload entry). */
export const PENDING_DECRYPT_NEWEST_FIRST_DEPTH = PENDING_DECRYPT_OVERLOAD_ENTER;
/** Near-cap margin where a healthy participant may decrypt inline to avoid dropping at the worker cap. */
export const PENDING_DECRYPT_SYNC_BYPASS_NEAR_CAP_MARGIN = 8;
/** Keep sync bypass off if main-thread apply is already backlogged. */
export const PENDING_DECRYPT_SYNC_BYPASS_APPLY_QUEUE_MAX = 6;
/** Pre-overload throttle: react before overload entry when multi-source depth is rising quickly. */
export const PENDING_DECRYPT_PRE_OVERLOAD_FORWARDER_DEPTH =
  PENDING_DECRYPT_OVERLOAD_WARM_DEPTH - 16;
/** Participant multi-source pre-overload entry stays a little later than forwarders. */
export const PENDING_DECRYPT_PRE_OVERLOAD_PARTICIPANT_DEPTH =
  PENDING_DECRYPT_OVERLOAD_WARM_DEPTH - 16;
/** Rising depth delta that counts as bursty queue growth for pre-overload throttling. */
export const PENDING_DECRYPT_PRE_OVERLOAD_RISE_DELTA = 12;
/** Participants in multi-source calls should react sooner than forwarders once depth is already high. */
export const PENDING_DECRYPT_PRE_OVERLOAD_PARTICIPANT_RISE_DELTA = 8;
/** Keep participant pre-overload active once multi-source depth is already well into the danger band. */
export const PENDING_DECRYPT_PRE_OVERLOAD_PARTICIPANT_SUSTAINED_DEPTH =
  PENDING_DECRYPT_OVERLOAD_WARM_DEPTH + 16;
/** Mild pre-overload clamp above the hard overload max for multi-source smoothing. */
export const PENDING_DECRYPT_PRE_OVERLOAD_FORWARDER_CLAMP_MAX =
  PENDING_DECRYPT_OVERLOAD_FORWARDER_MAX + 16;
/** Participant pre-overload clamp should bite before the multi-source hard cap starts dropping. */
export const PENDING_DECRYPT_PRE_OVERLOAD_PARTICIPANT_CLAMP_MAX =
  PENDING_DECRYPT_OVERLOAD_PARTICIPANT_MULTI_MAX - 8;

export interface PendingDecryptDropCandidate {
  id: number;
  startedAt: number;
  ingressPeerAddress: string;
}

/**
 * Select a pending decrypt job to shed at the queue cap.
 *
 * Policy: keep newest audio, and when several ingress peers are present, avoid letting one
 * overrepresented ingress consume the whole decrypt queue.
 */
export function choosePendingDecryptDropCandidate(
  candidates: readonly PendingDecryptDropCandidate[],
  incomingIngressPeerAddress: string,
  pendingMax: number
): number | null {
  if (candidates.length === 0) return null;
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    counts.set(
      candidate.ingressPeerAddress,
      (counts.get(candidate.ingressPeerAddress) ?? 0) + 1
    );
  }
  if (incomingIngressPeerAddress && !counts.has(incomingIngressPeerAddress)) {
    counts.set(incomingIngressPeerAddress, 0);
  }
  const distinctIngresses = Math.max(1, counts.size);
  const fairShare = Math.max(1, Math.ceil(Math.max(1, pendingMax) / distinctIngresses));
  let targetIngress: string | null = null;
  let targetCount = 0;
  for (const [ingress, count] of counts) {
    if (count > fairShare && count > targetCount) {
      targetIngress = ingress;
      targetCount = count;
    }
  }
  if (targetIngress === null && incomingIngressPeerAddress) {
    const incomingCount = counts.get(incomingIngressPeerAddress) ?? 0;
    if (incomingCount >= fairShare) {
      targetIngress = incomingIngressPeerAddress;
    }
  }

  let selectedId: number | null = null;
  let selectedStartedAt = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (targetIngress !== null && candidate.ingressPeerAddress !== targetIngress) {
      continue;
    }
    if (candidate.startedAt < selectedStartedAt) {
      selectedStartedAt = candidate.startedAt;
      selectedId = candidate.id;
    }
  }
  if (selectedId !== null) return selectedId;

  for (const candidate of candidates) {
    if (candidate.startedAt < selectedStartedAt) {
      selectedStartedAt = candidate.startedAt;
      selectedId = candidate.id;
    }
  }
  return selectedId;
}

/** Fail-safe playout / jitter clamps (optional stage 6). */
export const FAIL_SAFE_PLAYOUT_TARGET_MAX_MS = 120;
export const FAIL_SAFE_JITTER_FLOOR_FRAMES = 2;
export const FAIL_SAFE_MAX_STINT_MS = 30_000;
export const FAIL_SAFE_OVERLOAD_SUSTAINED_MS = 4000;

/** Stage 5 re-escalation cooldown (main-process flush boost) — see `requestPeerMediaRecovery`. */
export const STAGE5_REESCALATION_COOLDOWN_MS = 2000;
export const STAGE5_BYPASS_BRIDGE_WAITING_MS = 500;
export const STAGE5_BYPASS_BINARY_OUT_HW = 8;
export const STAGE5_BYPASS_BINARY_OUT_DWELL_MS = 1000;
export const STAGE5_BYPASS_QUEUE_PRESSURE_LAST5S = 6;

/** Max ingress pacing duration (Opus send-pressure ladder); auto-release afterward. */
export const GCALL_INGRESS_PACING_MAX_MS = 10_000;
/** Minimum Opus bitrate during group-call send-pressure steps (field-tuned). */
export const GCALL_OPUS_SEND_PRESSURE_MIN_BITRATE = 24_000;

export interface PendingDecryptBurstSignals {
  peerCount: number;
  /** Recent inbound audio packets/sec (renderer estimate). */
  ingressPacketsPerSec: number;
  /** Rolling peak depth over a short window (e.g. 2s). */
  peakDepthRecent: number;
  /** Root/cluster forwarder aggregates more ingress; modest boost to requested burst cap. */
  isForwarder?: boolean;
}

export function shouldTreatPendingDecryptAsForwarder(input: {
  isForwarderRole: boolean;
  participantCount: number;
  activeSourceCount: number;
}): boolean {
  if (!input.isForwarderRole) return false;
  return (
    Math.max(0, Math.floor(input.participantCount)) > 2 ||
    Math.max(0, Math.floor(input.activeSourceCount)) > 1
  );
}

export function computePendingDecryptOverloadMax(input: {
  isForwarder: boolean;
  longTaskPressure: boolean;
  activeSourceCount: number;
}): number {
  if (input.isForwarder) {
    return PENDING_DECRYPT_OVERLOAD_FORWARDER_MAX;
  }
  if (input.longTaskPressure) {
    return PENDING_DECRYPT_OVERLOAD_MAX;
  }
  const n = Math.max(0, Math.floor(input.activeSourceCount));
  return n <= 1
    ? PENDING_DECRYPT_OVERLOAD_PARTICIPANT_MAX
    : PENDING_DECRYPT_OVERLOAD_PARTICIPANT_MULTI_MAX;
}

/**
 * If the worker queue is about to hit the overload cap but the main thread is otherwise healthy,
 * let a participant decode inline instead of dropping at the queue boundary.
 */
export function shouldBypassDecryptWorkerOnHotQueue(input: {
  pendingDepth: number;
  pendingMax: number;
  overloadActive: boolean;
  longTaskPressure: boolean;
  isForwarder: boolean;
  activeSourceCount: number;
  applyQueueDepth: number;
}): boolean {
  if (input.isForwarder || input.longTaskPressure) return false;
  if (
    !input.overloadActive &&
    input.pendingDepth < PENDING_DECRYPT_NEWEST_FIRST_DEPTH
  ) {
    return false;
  }
  if (Math.max(0, Math.floor(input.activeSourceCount)) > 1) return false;
  if (
    Math.max(0, Math.floor(input.applyQueueDepth)) >
    PENDING_DECRYPT_SYNC_BYPASS_APPLY_QUEUE_MAX
  ) {
    return false;
  }
  const pendingMax = Math.max(PENDING_DECRYPT_MAX, Math.floor(input.pendingMax));
  return (
    Math.max(0, Math.floor(input.pendingDepth)) >=
    pendingMax - PENDING_DECRYPT_SYNC_BYPASS_NEAR_CAP_MARGIN
  );
}

export function shouldPreemptivelyThrottlePendingDecrypt(input: {
  pendingDepth: number;
  previousDepth: number;
  isForwarder: boolean;
  participantCount: number;
  activeSourceCount: number;
  longTaskPressure: boolean;
}): boolean {
  const participantCount = Math.max(0, Math.floor(input.participantCount));
  const activeSourceCount = Math.max(0, Math.floor(input.activeSourceCount));
  const multiSourceSession = participantCount > 2 || activeSourceCount > 1;
  if (!multiSourceSession) return false;
  if (input.longTaskPressure) return true;

  const pendingDepth = Math.max(0, Math.floor(input.pendingDepth));
  const previousDepth = Math.max(0, Math.floor(input.previousDepth));
  const risingDelta = pendingDepth - previousDepth;
  const depthFloor = input.isForwarder
    ? PENDING_DECRYPT_PRE_OVERLOAD_FORWARDER_DEPTH
    : PENDING_DECRYPT_PRE_OVERLOAD_PARTICIPANT_DEPTH;
  const riseDeltaMin = input.isForwarder
    ? PENDING_DECRYPT_PRE_OVERLOAD_RISE_DELTA
    : PENDING_DECRYPT_PRE_OVERLOAD_PARTICIPANT_RISE_DELTA;
  if (
    !input.isForwarder &&
    pendingDepth >= PENDING_DECRYPT_PRE_OVERLOAD_PARTICIPANT_SUSTAINED_DEPTH
  ) {
    return true;
  }
  return (
    pendingDepth >= depthFloor &&
    risingDelta >= riseDeltaMin
  );
}

export function computePendingDecryptPreOverloadClampMax(input: {
  isForwarder: boolean;
  activeSourceCount: number;
}): number {
  const activeSourceCount = Math.max(0, Math.floor(input.activeSourceCount));
  if (input.isForwarder) {
    return PENDING_DECRYPT_PRE_OVERLOAD_FORWARDER_CLAMP_MAX;
  }
  return activeSourceCount <= 1
    ? PENDING_DECRYPT_OVERLOAD_PARTICIPANT_MAX
    : PENDING_DECRYPT_PRE_OVERLOAD_PARTICIPANT_CLAMP_MAX;
}

/**
 * Requested burst cap from peers + ingress + peak depth, before upward slew and global ceiling.
 */
export function computeRequestedBurstMaxFromSignals(
  s: PendingDecryptBurstSignals
): number {
  const peers = Math.max(0, Math.floor(s.peerCount));
  const pps = Math.min(120, Math.max(0, s.ingressPacketsPerSec));
  const depth = Math.max(0, s.peakDepthRecent);
  const forwarderBoost = s.isForwarder ? 24 : 0;
  const raw =
    PENDING_DECRYPT_BURST_NOMINAL_BASE * 0.55 +
    peers * 6 +
    pps * 0.85 +
    depth * 0.9 +
    forwarderBoost;
  const rounded = Math.round(raw);
  return Math.min(
    GLOBAL_MAX_BURST_MAX,
    Math.max(PENDING_DECRYPT_BURST_NOMINAL_BASE, rounded)
  );
}

/**
 * Stage 3 policy: upward slew-limited; downward immediate to the requested cap.
 */
export function slewBurstMaxTowardRequested(
  currentEffective: number,
  requested: number,
  deltaMs: number
): number {
  const cap = Math.min(requested, GLOBAL_MAX_BURST_MAX);
  if (cap <= currentEffective) return cap;
  const maxUp = (BURST_MAX_SLEW_UP_PER_SEC * deltaMs) / 1000;
  return Math.min(cap, currentEffective + maxUp);
}

export function computePendingDecryptLimits(
  nowMs: number,
  globalRecoveryUntilMs: number,
  decryptBurstUntilMs: number,
  effectiveBurstMax: number,
  overloadActive = false,
  overloadMax = PENDING_DECRYPT_OVERLOAD_MAX,
  preOverloadActive = false
): { max: number; ttlMs: number } {
  if (overloadActive) {
    return {
      max: Math.min(
        overloadMax,
        Math.max(PENDING_DECRYPT_MAX, Math.floor(effectiveBurstMax))
      ),
      ttlMs: PENDING_DECRYPT_OVERLOAD_TTL_MS,
    };
  }
  if (preOverloadActive) {
    return {
      max: Math.min(
        GLOBAL_MAX_BURST_MAX,
        Math.max(PENDING_DECRYPT_MAX, Math.floor(effectiveBurstMax))
      ),
      ttlMs: PENDING_DECRYPT_PRE_OVERLOAD_TTL_MS,
    };
  }
  if (nowMs < decryptBurstUntilMs) {
    const max = Math.min(
      GLOBAL_MAX_BURST_MAX,
      Math.max(PENDING_DECRYPT_RECOVERY_MAX + 1, Math.floor(effectiveBurstMax))
    );
    return {
      max,
      ttlMs: PENDING_DECRYPT_BURST_TTL_MS,
    };
  }
  if (nowMs < globalRecoveryUntilMs) {
    return {
      max: PENDING_DECRYPT_RECOVERY_MAX,
      ttlMs: PENDING_DECRYPT_RECOVERY_TTL_MS,
    };
  }
  return { max: PENDING_DECRYPT_MAX, ttlMs: PENDING_DECRYPT_TTL_MS };
}
