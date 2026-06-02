/**
 * Group-call audio staged escalation — ownership and transition discipline.
 *
 * Stages (ordered; higher stages apply only when lower tiers have not stabilized depth):
 *
 * | Stage | Writable state (this stage owns) | Read-only signals | Downgrade / clear |
 * |-------|-----------------------------------|-------------------|---------------------|
 * | 1 Burst window | `decryptBurstUntilMs`, burst reason logs | `globalRecoveryUntilMs`, topology diff, key events | Self: timer elapses — burst tier limits fall back. Does not force-clear overload or pacing. |
 * | 2 Ingress pacing | Opus encode tier, pacing duration | Participant count, topology settle, overlap with stage 1 | Self: max duration or release — restore nominal bitrate. Does not clear burstMax math except indirectly. |
 * | 3 Dynamic burstMax | Effective cap after upward slew + downward immediate rule | Peak depth, ingress estimate, peer count, GLOBAL_MAX_BURST_MAX | Self: relaxes when requested drops. |
 * | 4 Overload | overloaded flag, diagnostic throttle, per-tick budgets | pendingDecryptDepth, long-task rate, drop rate, entry vs exit thresholds | Self: exit clears overload. May throttle diagnostics first. |
 * | 5 Extra escalation | Extra flush boost (IPC), optional second pacing tier | Triad hot, bridge pressure, lastStage5At, cooldown | Only while inputs justify; triad calming downgrades boost. |
 * | 6 Fail-safe (opt) | fail-safe flag, ultra-low bitrate tier, tight playout/jitter | Sustained failure past thresholds | Self: exit + max stint; must not latch forever. |
 *
 * Rule: stages 1–2 are time/event-triggered; 4 is threshold + hysteresis; 5 is additive.
 * No stage mutates another stage's owned refs except through the single transition path in the hook
 * (`runGcallAudioEscalationTransition`).
 *
 * Precedence: when newest-first / receive-path shedding is active (stage 4 depth policy),
 * ingress pacing must not keep ratcheting bitrate down — cap Opus tier index (see `tickOpusSendPressureController`).
 */

import {
  FAIL_SAFE_MAX_STINT_MS,
  FAIL_SAFE_OVERLOAD_SUSTAINED_MS,
  PENDING_DECRYPT_OVERLOAD_ENTER,
  PENDING_DECRYPT_OVERLOAD_EXIT,
  PENDING_DECRYPT_OVERLOAD_EXIT_HOLD_MS,
  PENDING_DECRYPT_OVERLOAD_LONG_TASK_MIN_DEPTH,
  PENDING_DECRYPT_OVERLOAD_WARM_DEPTH,
} from './pendingDecryptLimits';

const GCALL_FAIL_SAFE_STORAGE_KEY = 'qortal:gcall-audio-failsafe';

export function readGcallAudioFailSafeEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    const v = localStorage.getItem(GCALL_FAIL_SAFE_STORAGE_KEY);
    return v === '1' || v === 'true';
  } catch {
    return false;
  }
}

export interface DecryptOverloadState {
  active: boolean;
  exitBelowSinceMs: number | null;
}

export interface DecryptOverloadSignals {
  /** True if pending depth is climbing vs the prior sample (trend, not a static threshold). */
  risingTrend?: boolean;
  /** True when recent main-thread long tasks / stall pressure warrants receive-path shedding. */
  longTaskPressure?: boolean;
}

/**
 * Hysteresis: enter when depth > enter (or warm-depth + rising trend, or long-task pressure above min depth);
 * exit only when depth < exit for holdMs continuously.
 */
export function stepDecryptOverloadState(
  prev: DecryptOverloadState,
  depth: number,
  nowMs: number,
  signals?: DecryptOverloadSignals
): DecryptOverloadState {
  const enterStandard = depth > PENDING_DECRYPT_OVERLOAD_ENTER;
  const enterWarmRising =
    depth > PENDING_DECRYPT_OVERLOAD_WARM_DEPTH &&
    Boolean(signals?.risingTrend);
  const enterLongTask =
    Boolean(signals?.longTaskPressure) &&
    depth > PENDING_DECRYPT_OVERLOAD_LONG_TASK_MIN_DEPTH;

  if (enterStandard || enterWarmRising || enterLongTask) {
    return { active: true, exitBelowSinceMs: null };
  }
  if (depth < PENDING_DECRYPT_OVERLOAD_EXIT) {
    const since = prev.exitBelowSinceMs;
    if (since === null) {
      return {
        active: prev.active,
        exitBelowSinceMs: nowMs,
      };
    }
    if (nowMs - since >= PENDING_DECRYPT_OVERLOAD_EXIT_HOLD_MS) {
      return { active: false, exitBelowSinceMs: null };
    }
    return prev;
  }
  return { active: prev.active, exitBelowSinceMs: null };
}

export interface FailSafeState {
  active: boolean;
  overloadSinceMs: number | null;
  enteredAtMs: number | null;
}

/**
 * Optional fail-safe: overload sustained + still-elevated depth (requires flag).
 */
export function stepFailSafeState(
  prev: FailSafeState,
  opts: {
    failSafeEnabled: boolean;
    overloadActive: boolean;
    depth: number;
    exitDepth: number;
    nowMs: number;
  }
): FailSafeState {
  if (!opts.failSafeEnabled) {
    return { active: false, overloadSinceMs: null, enteredAtMs: null };
  }
  let overloadSince = prev.overloadSinceMs;
  if (opts.overloadActive) {
    if (overloadSince === null) overloadSince = opts.nowMs;
  } else {
    overloadSince = null;
  }
  let active = prev.active;
  let enteredAt = prev.enteredAtMs;
  const sustainedOverload =
    overloadSince !== null &&
    opts.nowMs - overloadSince >= FAIL_SAFE_OVERLOAD_SUSTAINED_MS;
  const depthBad = opts.depth > opts.exitDepth;
  if (!active && sustainedOverload && depthBad) {
    active = true;
    enteredAt = opts.nowMs;
  }
  if (active && enteredAt !== null) {
    const stint = opts.nowMs - enteredAt;
    const depthOk = opts.depth <= opts.exitDepth && !opts.overloadActive;
    if (stint >= FAIL_SAFE_MAX_STINT_MS || depthOk) {
      active = false;
      enteredAt = null;
      overloadSince = null;
    }
  }
  return {
    active,
    overloadSinceMs: overloadSince,
    enteredAtMs: enteredAt,
  };
}
