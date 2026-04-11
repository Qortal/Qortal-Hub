import type { GroupCallSourceWindowMetrics } from './router';

/** Denominator floor so bufferAdequacy is stable when target is tiny. */
export const GCALL_STARVATION_SMALL_FLOOR_MS = 1;

export const GCALL_STARVATION_STRONG_ADEQUACY_ENTRY = 0.3;
export const GCALL_STARVATION_STRONG_ADEQUACY_EXIT = 0.4;
export const GCALL_STARVATION_MILD_ADEQUACY_ENTRY = 0.5;
export const GCALL_STARVATION_MILD_ADEQUACY_EXIT = 0.6;

export const GCALL_STARVATION_STRONG_B_ADEQUACY_MIN = 0.3;
export const GCALL_STARVATION_STRONG_B_ADEQUACY_MAX = 0.5;
export const GCALL_STARVATION_STRONG_B_MIN_UNDER_TARGET_FRAC = 0.85;
export const GCALL_STARVATION_STRONG_B_PLAYOUT_DELTA_MS_THRESHOLD = -60;

/** Middling buffer adequacy: bad under-target fraction + delta without adequacy in strong-B band. */
export const GCALL_STARVATION_STRONG_C_MIN_UNDER_TARGET_FRAC = 0.5;
export const GCALL_STARVATION_STRONG_C_MAX_PLAYOUT_DELTA_MS = -30;
export const GCALL_STARVATION_STRONG_C_SUSTAINED_WINDOWS = 2;
export const GCALL_STARVATION_STRONG_C_ADEQUACY_MAX = 0.7;

/** Min window duration (ms) before starvation is evaluated (OR min ticks below). */
export const GCALL_STARVATION_MIN_PLAYOUT_ACTIVE_MS = 500;
/**
 * Min playout metric ticks in the window (PCM/playout samples from worklets).
 * Named for parity with the plan; not Opus decode frames.
 */
export const GCALL_STARVATION_MIN_PLAYOUT_METRIC_TICKS = 25;

export const GCALL_STARVATION_MILD_LIFT_MS = 20;
export const GCALL_STARVATION_STRONG_LIFT_MS = 40;

export const GCALL_STARVATION_MILD_ALPHA_UP = 0.47;
export const GCALL_STARVATION_MILD_ALPHA_DOWN = 0.22;
export const GCALL_STARVATION_STRONG_ALPHA_UP = 0.55;
export const GCALL_STARVATION_STRONG_ALPHA_DOWN = 0.18;

/** After exiting starvation, keep gentler decay briefly (per-source). */
export const GCALL_STARVATION_EXIT_COOLDOWN_MS = 2000;

export type PlayoutStarvationSeverity = 'none' | 'mild' | 'strong';

export type PlayoutStarvationSeverityReason =
  | 'none'
  | 'strong-A'
  | 'strong-B'
  | 'strong-C'
  | 'mild-adequacy';

/** Consecutive windows with strong-C conditions; reset when conditions break. */
export function strongCStarvationStreakTick(
  prevStreak: number,
  source: Pick<
    GroupCallSourceWindowMetrics,
    'playoutUnderTargetFraction' | 'avgPlayoutDeltaMs'
  >
): number {
  const ut = source.playoutUnderTargetFraction ?? 0;
  const delta = source.avgPlayoutDeltaMs ?? 0;
  if (
    ut > GCALL_STARVATION_STRONG_C_MIN_UNDER_TARGET_FRAC &&
    delta < GCALL_STARVATION_STRONG_C_MAX_PLAYOUT_DELTA_MS
  ) {
    return prevStreak + 1;
  }
  return 0;
}

export function computeBufferAdequacy(input: {
  avgPcmBufferedMs: number;
  smoothedTargetMs: number;
  smallFloorMs?: number;
}): number {
  const floor = input.smallFloorMs ?? GCALL_STARVATION_SMALL_FLOOR_MS;
  const denom = Math.max(input.smoothedTargetMs, floor);
  if (!(denom > 0) || !Number.isFinite(denom)) return 1;
  if (!Number.isFinite(input.avgPcmBufferedMs)) return 1;
  return input.avgPcmBufferedMs / denom;
}

export function hasPlayoutStarvationMinSample(input: {
  windowDurationMs: number;
  playoutMetricTicks: number;
}): boolean {
  return (
    input.windowDurationMs >= GCALL_STARVATION_MIN_PLAYOUT_ACTIVE_MS ||
    input.playoutMetricTicks >= GCALL_STARVATION_MIN_PLAYOUT_METRIC_TICKS
  );
}

export function classifyStrongStarvationCandidate(
  source: Pick<
    GroupCallSourceWindowMetrics,
    'playoutUnderTargetFraction' | 'avgPlayoutDeltaMs'
  >,
  bufferAdequacy: number,
  strongCStreak: number
): { strong: boolean; reason: 'strong-A' | 'strong-B' | 'strong-C' | null } {
  const ut = source.playoutUnderTargetFraction ?? 0;
  const delta = source.avgPlayoutDeltaMs ?? 0;
  if (bufferAdequacy < GCALL_STARVATION_STRONG_ADEQUACY_ENTRY) {
    return { strong: true, reason: 'strong-A' };
  }
  if (
    bufferAdequacy >= GCALL_STARVATION_STRONG_B_ADEQUACY_MIN &&
    bufferAdequacy < GCALL_STARVATION_STRONG_B_ADEQUACY_MAX
  ) {
    if (
      ut >= GCALL_STARVATION_STRONG_B_MIN_UNDER_TARGET_FRAC ||
      delta <= GCALL_STARVATION_STRONG_B_PLAYOUT_DELTA_MS_THRESHOLD
    ) {
      return { strong: true, reason: 'strong-B' };
    }
  }
  if (
    bufferAdequacy <= GCALL_STARVATION_STRONG_C_ADEQUACY_MAX &&
    strongCStreak >= GCALL_STARVATION_STRONG_C_SUSTAINED_WINDOWS
  ) {
    return { strong: true, reason: 'strong-C' };
  }
  return { strong: false, reason: null };
}

export function computeMildEntryCandidate(
  bufferAdequacy: number,
  isStrong: boolean
): boolean {
  if (isStrong) return false;
  return bufferAdequacy < GCALL_STARVATION_MILD_ADEQUACY_ENTRY;
}

export function stepPlayoutStarvationSeverity(input: {
  held: PlayoutStarvationSeverity;
  bufferAdequacy: number;
  strongMeta: {
    strong: boolean;
    reason: 'strong-A' | 'strong-B' | 'strong-C' | null;
  };
  mildCandidate: boolean;
}): { next: PlayoutStarvationSeverity; severityReason: PlayoutStarvationSeverityReason } {
  const { held, bufferAdequacy, strongMeta, mildCandidate } = input;
  const STRONG_EXIT = GCALL_STARVATION_STRONG_ADEQUACY_EXIT;
  const MILD_EXIT = GCALL_STARVATION_MILD_ADEQUACY_EXIT;

  if (held === 'strong') {
    if (bufferAdequacy > MILD_EXIT) {
      return { next: 'none', severityReason: 'none' };
    }
    if (bufferAdequacy > STRONG_EXIT) {
      return { next: 'mild', severityReason: 'mild-adequacy' };
    }
    if (strongMeta.strong && strongMeta.reason) {
      return { next: 'strong', severityReason: strongMeta.reason };
    }
    return {
      next: 'strong',
      severityReason:
        bufferAdequacy < GCALL_STARVATION_STRONG_ADEQUACY_ENTRY
          ? 'strong-A'
          : bufferAdequacy < GCALL_STARVATION_MILD_ADEQUACY_ENTRY
            ? 'strong-B'
            : 'strong-C',
    };
  }

  if (held === 'mild') {
    if (bufferAdequacy > MILD_EXIT) {
      return { next: 'none', severityReason: 'none' };
    }
    if (strongMeta.strong && strongMeta.reason) {
      return { next: 'strong', severityReason: strongMeta.reason };
    }
    return { next: 'mild', severityReason: 'mild-adequacy' };
  }

  if (strongMeta.strong && strongMeta.reason) {
    return { next: 'strong', severityReason: strongMeta.reason };
  }
  if (mildCandidate) {
    return { next: 'mild', severityReason: 'mild-adequacy' };
  }
  return { next: 'none', severityReason: 'none' };
}

export function starvationCeilingLiftForSeverity(
  severity: PlayoutStarvationSeverity
): number {
  if (severity === 'strong') return GCALL_STARVATION_STRONG_LIFT_MS;
  if (severity === 'mild') return GCALL_STARVATION_MILD_LIFT_MS;
  return 0;
}

export function starvationAlphaForSeverity(
  severity: PlayoutStarvationSeverity,
  baseAlphaUp: number,
  baseAlphaDown: number
): { alphaUp: number; alphaDown: number } {
  if (severity === 'strong') {
    return {
      alphaUp: GCALL_STARVATION_STRONG_ALPHA_UP,
      alphaDown: GCALL_STARVATION_STRONG_ALPHA_DOWN,
    };
  }
  if (severity === 'mild') {
    return {
      alphaUp: GCALL_STARVATION_MILD_ALPHA_UP,
      alphaDown: GCALL_STARVATION_MILD_ALPHA_DOWN,
    };
  }
  return { alphaUp: baseAlphaUp, alphaDown: baseAlphaDown };
}

export function playoutStarvationSeverityRank(
  s: PlayoutStarvationSeverity
): number {
  return s === 'strong' ? 2 : s === 'mild' ? 1 : 0;
}

export function worstPlayoutStarvationSeverity(
  a: PlayoutStarvationSeverity,
  b: PlayoutStarvationSeverity
): PlayoutStarvationSeverity {
  return playoutStarvationSeverityRank(a) >= playoutStarvationSeverityRank(b)
    ? a
    : b;
}
