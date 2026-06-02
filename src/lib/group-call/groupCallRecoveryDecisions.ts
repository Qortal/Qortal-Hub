import type { PlayoutStarvationSeverity } from './gcallPlayoutStarvation';

export const GCALL_HEALTHY_SINGLE_REMOTE_MICRO_WIDEN_PCM_MIN_MS = 120;
export const GCALL_HEALTHY_SINGLE_REMOTE_MICRO_WIDEN_UNDERTARGET_MAX = 0.18;
export const GCALL_HEALTHY_SINGLE_REMOTE_MICRO_WIDEN_SAMPLE_COUNT_MIN = 3;
export const ADAPTIVE_RECOVERY_EXIT_PCM_BUFFERED_MIN_MS = 120;
export const ADAPTIVE_RECOVERY_EXIT_UNDERTARGET_MAX = 0.2;
export const ADAPTIVE_RECOVERY_EXIT_MAX_UNDERRUNS = 2;
export const ADAPTIVE_RECOVERY_EXIT_PCM_BUFFERED_MIN_MS_SINGLE_REMOTE = 105;
export const ADAPTIVE_RECOVERY_EXIT_UNDERTARGET_MAX_SINGLE_REMOTE = 0.35;
export const ADAPTIVE_RECOVERY_EXIT_MAX_UNDERRUNS_SINGLE_REMOTE = 4;
export const ADAPTIVE_RECOVERY_ACCEL_EXIT_PCM_BUFFERED_MIN_MS_SINGLE_REMOTE = 92;
export const ADAPTIVE_RECOVERY_ACCEL_EXIT_UNDERTARGET_MAX_SINGLE_REMOTE = 0.45;
export const ADAPTIVE_RECOVERY_SEVERE_UNDERTARGET_FRACTION = 0.45;
export const ADAPTIVE_RECOVERY_SEVERE_UNDERRUNS = 4;

export interface RecoveryPlayoutHealthSample {
  atMs: number;
  bufferedMs: number;
  underTarget: boolean;
}

export interface RecentRecoveryStabilitySummary {
  sampleCount: number;
  avgPcmBufferedMs: number;
  playoutUnderTargetFraction: number;
  underrunCount: number;
  stable: boolean;
  severeInstability: boolean;
}

export interface RecoveryStabilityThresholds {
  minBufferedMs: number;
  maxUnderTargetFraction: number;
  maxUnderruns: number;
}

export function getRecoveryStabilityThresholds(
  activeSourceCount: number
): RecoveryStabilityThresholds {
  if (activeSourceCount === 1) {
    return {
      minBufferedMs: ADAPTIVE_RECOVERY_EXIT_PCM_BUFFERED_MIN_MS_SINGLE_REMOTE,
      maxUnderTargetFraction:
        ADAPTIVE_RECOVERY_EXIT_UNDERTARGET_MAX_SINGLE_REMOTE,
      maxUnderruns: ADAPTIVE_RECOVERY_EXIT_MAX_UNDERRUNS_SINGLE_REMOTE,
    };
  }
  return {
    minBufferedMs: ADAPTIVE_RECOVERY_EXIT_PCM_BUFFERED_MIN_MS,
    maxUnderTargetFraction: ADAPTIVE_RECOVERY_EXIT_UNDERTARGET_MAX,
    maxUnderruns: ADAPTIVE_RECOVERY_EXIT_MAX_UNDERRUNS,
  };
}

export function summarizeRecentRecoveryStability(opts: {
  samples: readonly RecoveryPlayoutHealthSample[];
  underrunTimesMs: readonly number[];
  nowMs: number;
  windowMs: number;
  minBufferedMs?: number;
  maxUnderTargetFraction?: number;
  maxUnderruns?: number;
  severeUnderTargetFraction?: number;
  severeUnderruns?: number;
}): RecentRecoveryStabilitySummary {
  const minBufferedMs =
    opts.minBufferedMs ?? ADAPTIVE_RECOVERY_EXIT_PCM_BUFFERED_MIN_MS;
  const maxUnderTargetFraction =
    opts.maxUnderTargetFraction ?? ADAPTIVE_RECOVERY_EXIT_UNDERTARGET_MAX;
  const maxUnderruns =
    opts.maxUnderruns ?? ADAPTIVE_RECOVERY_EXIT_MAX_UNDERRUNS;
  const severeUnderTargetFraction =
    opts.severeUnderTargetFraction ??
    ADAPTIVE_RECOVERY_SEVERE_UNDERTARGET_FRACTION;
  const severeUnderruns =
    opts.severeUnderruns ?? ADAPTIVE_RECOVERY_SEVERE_UNDERRUNS;
  const windowStartMs = opts.nowMs - Math.max(1, opts.windowMs);
  const samples = opts.samples.filter((sample) => sample.atMs >= windowStartMs);
  const underrunCount = opts.underrunTimesMs.filter(
    (atMs) => atMs >= windowStartMs
  ).length;
  const sampleCount = samples.length;
  const avgPcmBufferedMs =
    sampleCount > 0
      ? samples.reduce((sum, sample) => sum + sample.bufferedMs, 0) /
        sampleCount
      : 0;
  const playoutUnderTargetFraction =
    sampleCount > 0
      ? samples.reduce((sum, sample) => sum + (sample.underTarget ? 1 : 0), 0) /
        sampleCount
      : 0;
  const stable =
    sampleCount >= 2 &&
    avgPcmBufferedMs > minBufferedMs &&
    playoutUnderTargetFraction < maxUnderTargetFraction &&
    underrunCount <= maxUnderruns;
  const severeInstability =
    underrunCount >= severeUnderruns ||
    (sampleCount >= 2 &&
      playoutUnderTargetFraction >= severeUnderTargetFraction);
  return {
    sampleCount,
    avgPcmBufferedMs,
    playoutUnderTargetFraction,
    underrunCount,
    stable,
    severeInstability,
  };
}

export function shouldBypassRecoveryReentryCooldown(opts: {
  severity: number;
  severeInstability: boolean;
}): boolean {
  return opts.severity >= 3 || opts.severeInstability;
}

export function shouldSuppressHealthySingleRemoteMicroWiden(opts: {
  activeSourceCount: number;
  adaptiveNetworkMode: 'low-latency' | 'recovery';
  shouldTightenRecovery: boolean;
  severeWindowSource: boolean;
  ingressPeerRecovery: boolean;
  recentStability: RecentRecoveryStabilitySummary;
}): boolean {
  return (
    opts.activeSourceCount === 1 &&
    opts.adaptiveNetworkMode !== 'recovery' &&
    !opts.shouldTightenRecovery &&
    !opts.severeWindowSource &&
    !opts.ingressPeerRecovery &&
    opts.recentStability.stable &&
    !opts.recentStability.severeInstability &&
    opts.recentStability.sampleCount >=
      GCALL_HEALTHY_SINGLE_REMOTE_MICRO_WIDEN_SAMPLE_COUNT_MIN &&
    opts.recentStability.avgPcmBufferedMs >=
      GCALL_HEALTHY_SINGLE_REMOTE_MICRO_WIDEN_PCM_MIN_MS &&
    opts.recentStability.playoutUnderTargetFraction <=
      GCALL_HEALTHY_SINGLE_REMOTE_MICRO_WIDEN_UNDERTARGET_MAX
  );
}

export function shouldAccelerateMultiSourceRecoveryDecay(opts: {
  activeSourceCount: number;
  adaptiveNetworkMode: 'low-latency' | 'recovery';
  starvationSeverity: PlayoutStarvationSeverity;
  bufferAdequacy: number;
  avgPlayoutDeltaMs: number;
  shouldTightenRecovery: boolean;
  severeWindowSource: boolean;
  ingressPeerRecovery: boolean;
}): boolean {
  return (
    opts.activeSourceCount >= 2 &&
    opts.adaptiveNetworkMode === 'recovery' &&
    opts.starvationSeverity !== 'none' &&
    opts.bufferAdequacy < 0.65 &&
    opts.avgPlayoutDeltaMs <= -40 &&
    !opts.shouldTightenRecovery &&
    !opts.severeWindowSource &&
    !opts.ingressPeerRecovery
  );
}

export function shouldAccelerateSingleRemoteRecoveryDecay(opts: {
  activeSourceCount: number;
  adaptiveNetworkMode: 'low-latency' | 'recovery';
  shouldTightenRecovery: boolean;
  severeWindowSource: boolean;
  ingressPeerRecovery: boolean;
  recentStability: RecentRecoveryStabilitySummary;
}): boolean {
  return (
    opts.activeSourceCount === 1 &&
    opts.adaptiveNetworkMode === 'recovery' &&
    !opts.shouldTightenRecovery &&
    !opts.severeWindowSource &&
    !opts.ingressPeerRecovery &&
    !opts.recentStability.severeInstability &&
    opts.recentStability.sampleCount >= 2 &&
    opts.recentStability.avgPcmBufferedMs >=
      ADAPTIVE_RECOVERY_ACCEL_EXIT_PCM_BUFFERED_MIN_MS_SINGLE_REMOTE &&
    opts.recentStability.playoutUnderTargetFraction <=
      ADAPTIVE_RECOVERY_ACCEL_EXIT_UNDERTARGET_MAX_SINGLE_REMOTE
  );
}
