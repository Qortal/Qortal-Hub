/**
 * Single-remote (N===1) recovery playout gating: preroll min-ms, buffer-vs-target tier,
 * and helpers shared with tests. See 2-way jitter playout plan.
 */

import { OPUS_FRAME_DURATION_MS } from './gcallVoiceAudioConstants';

/** Initial stall escape: no ingress this long → allow one minimal decode (ms). */
export const GCALL_N1_STALL_ESCAPE_MS = 300;

/**
 * If a live recovery source stays stuck below full preroll for this long, allow it to leave
 * preroll early rather than remaining silent indefinitely.
 */
export const GCALL_N1_PREROLL_DEADLOCK_ESCAPE_MS = 180;
/** If the source never reaches the normal early-release buffer, allow a second weaker escape later. */
export const GCALL_N1_PREROLL_SEVERE_DEADLOCK_ESCAPE_MS = 420;
/** Treat pushes newer than this as evidence that the source is still actively trickling in. */
export const GCALL_N1_PREROLL_RECENT_PUSH_MAX_MS = 120;
/** Minimum queued Opus needed before early preroll release is allowed. */
export const GCALL_N1_PREROLL_EARLY_RELEASE_MIN_BUFFER_MS = 40;
/** Severe deadlock fallback: one frame is better than remaining muted forever. */
export const GCALL_N1_PREROLL_SEVERE_RELEASE_MIN_BUFFER_MS = 20;
/** Scale early-release reserve with target, but keep it bounded for weak exact-1-remote paths. */
export const GCALL_N1_PREROLL_EARLY_RELEASE_TARGET_RATIO = 0.3;
export const GCALL_N1_PREROLL_EARLY_RELEASE_MIN_BUFFER_MS_CEIL = 60;

/** Min start buffer before "preroll satisfied" (ms), lower bound of clamp — below low-latency adaptive max (120). */
export const GCALL_N1_MIN_START_MS_FLOOR = 100;

/** Upper clamp for min-start ms (align with max severe across profiles). */
export const GCALL_N1_MIN_START_MS_CEIL = 185;

/** Micro-accumulation after refill when preroll already satisfied (ms). */
export const GCALL_N1_ACCUMULATION_MS = 75;
/** After forced early release, hold decode a bit longer so the source can rebuild usable reserve. */
export const GCALL_N1_EARLY_RELEASE_ACCUMULATION_MS = 140;
/** Severe 20ms deadlock escape needs a longer rebuild window so the source can climb out of 1 frame. */
export const GCALL_N1_SEVERE_EARLY_RELEASE_ACCUMULATION_MS = 420;
/** During severe PCM rebuild, convert queued Opus to PCM faster than realtime but keep N=1 bounded. */
export const GCALL_N1_SEVERE_RELEASE_REBUILD_MIN_DECODE_CAP = 5;
export const GCALL_N1_SEVERE_RELEASE_EXIT_PCM_MS = 80;
export const GCALL_N1_SEVERE_RELEASE_EXIT_UNDERTARGET_MAX = 0.45;
export const GCALL_N1_SEVERE_RELEASE_PCM_DOMINANT_EXIT_PCM_MS = 120;
export const GCALL_N1_SEVERE_RELEASE_PCM_DOMINANT_EXIT_UNDERTARGET_MAX = 0.3;
/**
 * Opus-dominant escape for the severe forced-release rebuild loop.
 *
 * The severe rebuild caps jitter → PCM decoding to
 * {@link GCALL_N1_SEVERE_RELEASE_REBUILD_MIN_DECODE_CAP} frames/tick so PCM can
 * rebuild without dumping a burst onto the worklet ring. The PCM-dominant and
 * standard exits both demand that {@link GCALL_N1_SEVERE_RELEASE_EXIT_PCM_MS} /
 * {@link GCALL_N1_SEVERE_RELEASE_PCM_DOMINANT_EXIT_PCM_MS} of PCM be present
 * before we let go of the clamp — fine when the source is cooperating, but a
 * one-way trap when the remote path is bursty.
 *
 * Observed in the Phil ↔ Kenny call 60 logs: Kenny's inbound path flapped
 * between Reticulum packet/link transports 4× in the first 75 s, packets
 * arrived in bursts, the jitter buffer peaked at 400 ms (≥ 24 frames — the
 * `singleRemoteDepthMs` trim ceiling) yet `avgPcmBufferedMs` never climbed out
 * of the 8–85 ms band because the 5-frames/tick clamp couldn't match the
 * worklet drain + 0.947× playout stretch. `n1SevereRebuildReadyEscape` fired
 * 19× and `n1SevereRebuildDeadzoneReset` 7× — all one-shot primes that did
 * nothing to release the clamp — while Kenny logged `strong` playout starvation
 * across the whole call.
 *
 * Escape threshold: Opus-buffered ≥ 1× the smoothed playout target. At that
 * depth we already hold a full playout-target reserve of audio waiting to be
 * decoded; the rebuild's "protect PCM" rationale is moot because staying in
 * rebuild is actively *causing* the PCM starvation. Exiting lets the normal
 * drain cap (3–7 frames/tick depending on tier) flush the backlog into PCM,
 * which in turn satisfies the PCM-dominant exit on subsequent ticks.
 *
 * The escape still respects `severeInstability` — if the recent-stability
 * window shows real chaos (not just under-target), rebuild stays on.
 */
export const GCALL_N1_SEVERE_RELEASE_OPUS_OVERFLOW_EXIT_RATIO = 1.0;
export const GCALL_N1_LATE_COLLAPSE_REARM_MAX_OPUS_MS = 60;
export const GCALL_N1_LATE_COLLAPSE_REARM_MAX_PCM_MS = 30;
export const GCALL_N1_LATE_COLLAPSE_REARM_UNDERTARGET_MIN = 0.85;
/**
 * Debounce between severe forced-release rebuild exits and the next allowed
 * late-collapse rearm. Previously 450 ms, which let the rebuild clamp re-arm
 * almost immediately after the opus-dominant escape released it — trapping the
 * call in a clamp/escape/clamp oscillation while PCM stayed starved. Bumping
 * to 2000 ms gives the normal drain cap at least a couple of playout periods
 * to actually flush the Opus backlog into PCM before we're allowed to
 * reintroduce the 5-frame clamp. Rearm logic still requires PCM ≤ 30 ms and
 * strong starvation, so this only delays rearm in the pathological case we
 * observed in call 62.
 */
export const GCALL_N1_LATE_COLLAPSE_REARM_COOLDOWN_MS = 2000;

/** Short refill accumulation outside recovery so 2-way steady state does not collapse back to 1 frame. Keep it brief so refill does not push usable audio past playout deadlines. */
export const GCALL_N1_STEADY_ACCUMULATION_MS = 30;

/** Denominator floor for r = bufferMs / max(target, floor) — matches adaptive min order. */
export const GCALL_N1_MIN_TARGET_MS_FLOOR = 100;

/** Small steady-state reserve for exact-1-remote calls after recovery exits. */
export const GCALL_N1_STEADY_MIN_HOLD_MS_FLOOR = 20;
export const GCALL_N1_STEADY_MIN_HOLD_MS_CEIL = 40;
/** Minimum whole-frame reserve that can actually be ready with N=1 primed hold. */
export const GCALL_N1_STEADY_MIN_RESERVE_FRAMES = 2;
/** When PCM remains this low on a live N===1 path, prioritize rebuilding PCM over hoarding Opus. */
export const GCALL_N1_PCM_REBUILD_MAX_MS = 60;
export const GCALL_N1_PCM_REBUILD_UNDERTARGET_MIN = 0.75;

/** Tier A: deep deficit — very aggressive throttle (typically 1 decode/tick max). */
export const GCALL_N1_RATIO_DEEP = 0.3;
export const GCALL_N1_RATIO_DEEP_ENTER = 0.28;
export const GCALL_N1_RATIO_DEEP_EXIT = 0.34;
export const GCALL_N1_RATIO_DEEP_ENTER_STEADY = 0.22;
export const GCALL_N1_RATIO_DEEP_EXIT_STEADY = 0.28;

/** Tier B: moderate throttle upper edge (below this band = moderate; above = normal burst). */
export const GCALL_N1_RATIO_MODERATE = 0.48;
export const GCALL_N1_RATIO_MODERATE_ENTER = 0.46;
export const GCALL_N1_RATIO_MODERATE_EXIT = 0.52;
export const GCALL_N1_RATIO_MODERATE_ENTER_STEADY = 0.36;
export const GCALL_N1_RATIO_MODERATE_EXIT_STEADY = 0.42;

/** Throttle [GCall] bufferEnforceActive diagnostics (ms per source). */
export const GCALL_N1_BUFFER_ENFORCE_LOG_MIN_MS = 2000;

export type GcallN1BufferEnforceTier = 'deep' | 'moderate' | 'normal';

export function computeN1RecoveryEarlyReleaseMinBufferMs(
  smoothedTargetMs: number
): number {
  const targetMs = Math.max(
    GCALL_N1_MIN_TARGET_MS_FLOOR,
    Number.isFinite(smoothedTargetMs)
      ? smoothedTargetMs
      : GCALL_N1_MIN_TARGET_MS_FLOOR
  );
  return Math.max(
    GCALL_N1_PREROLL_EARLY_RELEASE_MIN_BUFFER_MS,
    Math.min(
      GCALL_N1_PREROLL_EARLY_RELEASE_MIN_BUFFER_MS_CEIL,
      Math.round(targetMs * GCALL_N1_PREROLL_EARLY_RELEASE_TARGET_RATIO)
    )
  );
}

export function computeN1MinStartMs(smoothedTargetMs: number): number {
  const t = Number.isFinite(smoothedTargetMs) ? smoothedTargetMs : GCALL_N1_MIN_TARGET_MS_FLOOR;
  return Math.max(
    GCALL_N1_MIN_START_MS_FLOOR,
    Math.min(t, GCALL_N1_MIN_START_MS_CEIL)
  );
}

export function computeN1SteadyMinHoldMs(smoothedTargetMs: number): number {
  const t = Math.max(
    Number.isFinite(smoothedTargetMs)
      ? smoothedTargetMs
      : GCALL_N1_MIN_TARGET_MS_FLOOR,
    GCALL_N1_MIN_TARGET_MS_FLOOR
  );
  return Math.max(
    GCALL_N1_STEADY_MIN_HOLD_MS_FLOOR,
    Math.min(GCALL_N1_STEADY_MIN_HOLD_MS_CEIL, Math.round(t * 0.3))
  );
}

export function computeN1SteadyReserveMs(smoothedTargetMs: number): number {
  const minHoldMs = computeN1SteadyMinHoldMs(smoothedTargetMs);
  const frameFloorMs =
    GCALL_N1_STEADY_MIN_RESERVE_FRAMES * OPUS_FRAME_DURATION_MS;
  return Math.max(
    frameFloorMs,
    Math.ceil(minHoldMs / OPUS_FRAME_DURATION_MS) * OPUS_FRAME_DURATION_MS
  );
}

export function shouldHoldN1SteadyReserve(input: {
  steadySingleRemote: boolean;
  sourceRecentlyPushed: boolean;
  hasReadyFrame: boolean;
  opusBufferedMs: number;
  reserveMs: number;
}): boolean {
  return (
    input.steadySingleRemote &&
    input.sourceRecentlyPushed &&
    input.hasReadyFrame &&
    input.opusBufferedMs <= input.reserveMs
  );
}

export function shouldForceN1RecoveryPrerollSatisfied(input: {
  blockedForMs: number;
  lastPushAgeMs: number;
  opusBufferedMs: number;
  sourceActive: boolean;
  targetMs?: number;
}): boolean {
  const minBufferMs = computeN1RecoveryEarlyReleaseMinBufferMs(
    input.targetMs ?? GCALL_N1_MIN_TARGET_MS_FLOOR
  );
  return (
    isSevereN1RecoveryPrerollRelease(input) ||
    (input.sourceActive &&
      input.blockedForMs >= GCALL_N1_PREROLL_DEADLOCK_ESCAPE_MS &&
      input.lastPushAgeMs <= GCALL_N1_PREROLL_RECENT_PUSH_MAX_MS &&
      input.opusBufferedMs >= minBufferMs)
  );
}

export function isSevereN1RecoveryPrerollRelease(input: {
  blockedForMs: number;
  lastPushAgeMs: number;
  opusBufferedMs: number;
  sourceActive: boolean;
  targetMs?: number;
}): boolean {
  const minBufferMs = computeN1RecoveryEarlyReleaseMinBufferMs(
    input.targetMs ?? GCALL_N1_MIN_TARGET_MS_FLOOR
  );
  return (
    input.sourceActive &&
    input.blockedForMs >= GCALL_N1_PREROLL_SEVERE_DEADLOCK_ESCAPE_MS &&
    input.lastPushAgeMs <= GCALL_N1_PREROLL_RECENT_PUSH_MAX_MS &&
    input.opusBufferedMs >= GCALL_N1_PREROLL_SEVERE_RELEASE_MIN_BUFFER_MS &&
    input.opusBufferedMs < minBufferMs
  );
}

export function computeN1BufferRatio(
  opusBufferedMs: number,
  smoothedTargetMs: number
): { ratio: number; denomMs: number } {
  const denomMs = Math.max(
    Number.isFinite(smoothedTargetMs) ? smoothedTargetMs : GCALL_N1_MIN_TARGET_MS_FLOOR,
    GCALL_N1_MIN_TARGET_MS_FLOOR
  );
  const ratio =
    denomMs > 0 ? opusBufferedMs / denomMs : opusBufferedMs > 0 ? 1 : 0;
  return { ratio, denomMs };
}

export function computeN1BufferEnforceTier(
  ratio: number
): GcallN1BufferEnforceTier {
  if (ratio < GCALL_N1_RATIO_DEEP) return 'deep';
  if (ratio <= GCALL_N1_RATIO_MODERATE) return 'moderate';
  return 'normal';
}

export function stepN1BufferEnforceTier(
  previousTier: GcallN1BufferEnforceTier | null,
  ratio: number
): GcallN1BufferEnforceTier {
  if (previousTier === 'deep') {
    if (ratio <= GCALL_N1_RATIO_DEEP_EXIT) return 'deep';
    return ratio < GCALL_N1_RATIO_MODERATE_EXIT ? 'moderate' : 'normal';
  }
  if (previousTier === 'moderate') {
    if (ratio < GCALL_N1_RATIO_DEEP_ENTER) return 'deep';
    if (ratio <= GCALL_N1_RATIO_MODERATE_EXIT) return 'moderate';
    return 'normal';
  }
  if (previousTier === 'normal') {
    if (ratio < GCALL_N1_RATIO_DEEP_ENTER) return 'deep';
    if (ratio < GCALL_N1_RATIO_MODERATE_ENTER) return 'moderate';
    return 'normal';
  }
  return computeN1BufferEnforceTier(ratio);
}

export function stepN1SteadyBufferEnforceTier(
  previousTier: GcallN1BufferEnforceTier | null,
  ratio: number
): GcallN1BufferEnforceTier {
  if (previousTier === 'deep') {
    if (ratio <= GCALL_N1_RATIO_DEEP_EXIT_STEADY) return 'deep';
    return ratio < GCALL_N1_RATIO_MODERATE_EXIT_STEADY ? 'moderate' : 'normal';
  }
  if (previousTier === 'moderate') {
    if (ratio < GCALL_N1_RATIO_DEEP_ENTER_STEADY) return 'deep';
    if (ratio <= GCALL_N1_RATIO_MODERATE_EXIT_STEADY) return 'moderate';
    return 'normal';
  }
  if (previousTier === 'normal') {
    if (ratio < GCALL_N1_RATIO_DEEP_ENTER_STEADY) return 'deep';
    if (ratio < GCALL_N1_RATIO_MODERATE_ENTER_STEADY) return 'moderate';
    return 'normal';
  }
  return computeN1BufferEnforceTier(ratio);
}

export interface ComputeN1TierBurstCapOpts {
  /** When true, allow extra decodes/tick in deep tier under recovery (main-thread stalls starve buffer). */
  recoverySingleRemote?: boolean;
}

/**
 * Effective scaled burst cap for N===1 tier (upper bound; caller still clamps in loop).
 */
export function computeN1TierBurstCap(
  tier: GcallN1BufferEnforceTier,
  scaledBurstCap: number,
  opts?: ComputeN1TierBurstCapOpts
): number {
  if (tier === 'deep') {
    return opts?.recoverySingleRemote ? 4 : 1;
  }
  if (tier === 'moderate') return Math.min(6, scaledBurstCap);
  return scaledBurstCap;
}

export function computeN1LiveRecoveryBurstCap(input: {
  tier: GcallN1BufferEnforceTier;
  scaledBurstCap: number;
  opusBufferedMs: number;
  minStartMs: number;
  sourceRecentlyPushed: boolean;
}): number {
  const baseCap = computeN1TierBurstCap(input.tier, input.scaledBurstCap, {
    recoverySingleRemote: true,
  });
  if (
    !input.sourceRecentlyPushed ||
    input.opusBufferedMs >= input.minStartMs
  ) {
    return baseCap;
  }
  if (input.tier === 'deep') return Math.min(2, baseCap);
  if (input.tier === 'moderate') return Math.min(3, baseCap);
  return Math.min(5, baseCap);
}

export function shouldBoostN1PcmRebuild(input: {
  sourceRecentlyPushed: boolean;
  sampleCount: number;
  avgPcmBufferedMs: number;
  playoutUnderTargetFraction: number;
  playoutStarvationSeverity: 'none' | 'mild' | 'strong';
}): boolean {
  return (
    input.sourceRecentlyPushed &&
    input.sampleCount >= 2 &&
    input.avgPcmBufferedMs <= GCALL_N1_PCM_REBUILD_MAX_MS &&
    input.playoutUnderTargetFraction >= GCALL_N1_PCM_REBUILD_UNDERTARGET_MIN &&
    (input.playoutStarvationSeverity === 'strong' ||
      input.playoutUnderTargetFraction >= 0.9)
  );
}

export function computeN1PcmRebuildBurstCap(
  tier: GcallN1BufferEnforceTier,
  scaledBurstCap: number
): number {
  if (tier === 'deep') return Math.min(5, scaledBurstCap);
  if (tier === 'moderate') return Math.min(6, scaledBurstCap);
  return Math.min(7, scaledBurstCap);
}

export function shouldKeepN1SevereForcedReleaseRebuild(input: {
  nowMs: number;
  rebuildUntilMs: number;
  opusBufferedMs: number;
  targetMs: number;
  sampleCount: number;
  avgPcmBufferedMs: number;
  playoutUnderTargetFraction: number;
  recentStable: boolean;
  severeInstability: boolean;
}): boolean {
  if (input.rebuildUntilMs > input.nowMs) return true;
  if (input.sampleCount < 2) return true;

  const targetMs = Math.max(
    GCALL_N1_MIN_TARGET_MS_FLOOR,
    Number.isFinite(input.targetMs)
      ? input.targetMs
      : GCALL_N1_MIN_TARGET_MS_FLOOR
  );
  const pcmDominantExitMs = Math.max(
    GCALL_N1_SEVERE_RELEASE_EXIT_PCM_MS,
    Math.min(targetMs, GCALL_N1_SEVERE_RELEASE_PCM_DOMINANT_EXIT_PCM_MS)
  );
  if (
    !input.severeInstability &&
    input.avgPcmBufferedMs >= pcmDominantExitMs &&
    input.playoutUnderTargetFraction <=
      GCALL_N1_SEVERE_RELEASE_PCM_DOMINANT_EXIT_UNDERTARGET_MAX
  ) {
    return false;
  }

  // Opus-dominant escape: a full target's worth of opus sitting in the jitter
  // buffer means the rebuild clamp is now the cause of PCM starvation, not the
  // cure for it. Break the feedback loop and let the normal drain flush the
  // backlog to PCM. See GCALL_N1_SEVERE_RELEASE_OPUS_OVERFLOW_EXIT_RATIO for
  // the full reasoning + the call-60 regression that motivated this branch.
  // `severeInstability` still keeps the clamp on when the recent-stability
  // window flags chaotic variance (not just steady under-target starvation).
  const opusOverflowExitMs =
    targetMs * GCALL_N1_SEVERE_RELEASE_OPUS_OVERFLOW_EXIT_RATIO;
  if (
    !input.severeInstability &&
    input.opusBufferedMs >= opusOverflowExitMs
  ) {
    return false;
  }

  if (!input.recentStable || input.severeInstability) return true;
  return !(
    input.opusBufferedMs >=
      computeN1RecoveryEarlyReleaseMinBufferMs(input.targetMs) &&
    input.avgPcmBufferedMs >= GCALL_N1_SEVERE_RELEASE_EXIT_PCM_MS &&
    input.playoutUnderTargetFraction <=
      GCALL_N1_SEVERE_RELEASE_EXIT_UNDERTARGET_MAX
  );
}

export function shouldRearmN1LateCollapseRecovery(input: {
  nowMs: number;
  cooldownUntilMs: number;
  sourceRecentlyPushed: boolean;
  opusBufferedMs: number;
  sampleCount: number;
  avgPcmBufferedMs: number;
  playoutUnderTargetFraction: number;
  playoutStarvationSeverity: 'none' | 'mild' | 'strong';
}): boolean {
  return (
    input.nowMs >= input.cooldownUntilMs &&
    input.sourceRecentlyPushed &&
    input.opusBufferedMs <= GCALL_N1_LATE_COLLAPSE_REARM_MAX_OPUS_MS &&
    input.sampleCount >= 2 &&
    input.avgPcmBufferedMs <= GCALL_N1_LATE_COLLAPSE_REARM_MAX_PCM_MS &&
    input.playoutUnderTargetFraction >=
      GCALL_N1_LATE_COLLAPSE_REARM_UNDERTARGET_MIN &&
    (input.playoutStarvationSeverity === 'strong' ||
      input.playoutUnderTargetFraction >= 0.95)
  );
}

export function computeN1SteadyTierBurstCap(
  tier: GcallN1BufferEnforceTier,
  scaledBurstCap: number
): number {
  if (tier === 'deep') return Math.min(2, scaledBurstCap);
  if (tier === 'moderate') return Math.min(5, scaledBurstCap);
  return Math.min(7, scaledBurstCap);
}
