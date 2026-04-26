import { OPUS_FRAME_DURATION_MS } from '../gcallVoiceAudioConstants';

const MIN_DRAIN_RATE = 0.9;
const MAX_DRAIN_RATE = 1.01;
const DEFAULT_RECOVERY_DRAIN_RATE = 0.97;
const DEFAULT_PANIC_ENTER_MS = 60;
const DEFAULT_PANIC_EXIT_MS = 78;
const DEFAULT_OVERSHOOT_MARGIN_MS = 30;
const DEFAULT_SOFT_LANDING_MARGIN_MS = 15;
const DEFAULT_STALE_REPORT_GRACE_MS = 170;
const DEFAULT_MAX_EMERGENCY_FRAMES = 6;
const DEFAULT_MAX_DEFICIT_FRAMES = 4;
const DEFAULT_RESERVE_FLOOR_RATIO = 0.5;
const DEFAULT_LATENCY_DRAIN_TRIGGER_MS = 220;
const DEFAULT_LATENCY_DRAIN_HEADROOM_MS = 70;
const DEFAULT_MAX_LATENCY_DRAIN_FRAMES = 2;

export interface WorkletBufferEstimateInput {
  readonly lastBufferedMs: number | null;
  readonly postedSinceReportMs: number;
  readonly reportAgeMs: number;
  readonly lastReportedRate?: number | null;
  readonly fallbackDrainRate?: number;
}

export function estimateWorkletBufferedMs(
  input: WorkletBufferEstimateInput
): number | null {
  const { lastBufferedMs, postedSinceReportMs, reportAgeMs, lastReportedRate } =
    input;
  if (lastBufferedMs === null) return null;
  if (!Number.isFinite(reportAgeMs)) return lastBufferedMs;
  const drainRate = clamp(
    lastReportedRate ?? input.fallbackDrainRate ?? DEFAULT_RECOVERY_DRAIN_RATE,
    MIN_DRAIN_RATE,
    MAX_DRAIN_RATE
  );
  return Math.max(
    0,
    lastBufferedMs + postedSinceReportMs - reportAgeMs * drainRate
  );
}

export interface FramesToPostInput {
  readonly estimatedBufferedMs: number | null;
  readonly lastReportedBufferedMs: number | null;
  readonly targetBufferMs: number;
  readonly upstreamBufferedMs: number;
  readonly ringJustRefilled: boolean;
  readonly reportAgeMs: number;
  readonly panicEnterMs?: number;
  readonly panicExitMs?: number;
  readonly overshootMarginMs?: number;
  readonly softLandingMarginMs?: number;
  readonly staleReportGraceMs?: number;
  readonly maxEmergencyFrames?: number;
  readonly maxDeficitFrames?: number;
  readonly reserveFloorRatio?: number;
  readonly latencyDrainTriggerMs?: number;
  readonly latencyDrainHeadroomMs?: number;
  readonly maxLatencyDrainFrames?: number;
}

export function decideFramesToPost(input: FramesToPostInput): number {
  const panicEnterMs = input.panicEnterMs ?? DEFAULT_PANIC_ENTER_MS;
  const panicExitMs = Math.max(
    panicEnterMs,
    input.panicExitMs ?? DEFAULT_PANIC_EXIT_MS
  );
  const overshootMarginMs =
    input.overshootMarginMs ?? DEFAULT_OVERSHOOT_MARGIN_MS;
  const softLandingMarginMs =
    input.softLandingMarginMs ?? DEFAULT_SOFT_LANDING_MARGIN_MS;
  const staleReportGraceMs =
    input.staleReportGraceMs ?? DEFAULT_STALE_REPORT_GRACE_MS;
  const maxEmergencyFrames =
    input.maxEmergencyFrames ?? DEFAULT_MAX_EMERGENCY_FRAMES;
  const maxDeficitFrames =
    input.maxDeficitFrames ?? DEFAULT_MAX_DEFICIT_FRAMES;
  const reserveFloorRatio =
    input.reserveFloorRatio ?? DEFAULT_RESERVE_FLOOR_RATIO;
  const latencyDrainTriggerMs =
    input.latencyDrainTriggerMs ?? DEFAULT_LATENCY_DRAIN_TRIGGER_MS;
  const latencyDrainHeadroomMs =
    input.latencyDrainHeadroomMs ?? DEFAULT_LATENCY_DRAIN_HEADROOM_MS;
  const maxLatencyDrainFrames =
    input.maxLatencyDrainFrames ?? DEFAULT_MAX_LATENCY_DRAIN_FRAMES;
  const targetMs = input.targetBufferMs;
  const estimatedMs = input.estimatedBufferedMs;

  if (
    input.ringJustRefilled ||
    estimatedMs === null ||
    estimatedMs < panicEnterMs
  ) {
    const staleOrMissingEstimate =
      estimatedMs === null || input.reportAgeMs > staleReportGraceMs;
    const upstreamBufferedMs = input.upstreamBufferedMs;
    const upstreamHealthy = upstreamBufferedMs >= targetMs;
    const upstreamAboveTarget =
      upstreamBufferedMs >= targetMs + overshootMarginMs;
    const lastReportedLow =
      input.lastReportedBufferedMs !== null &&
      input.lastReportedBufferedMs <
        Math.max(panicExitMs, targetMs - softLandingMarginMs);
    if (staleOrMissingEstimate && upstreamAboveTarget) {
      return lastReportedLow ? Math.min(2, maxDeficitFrames) : 1;
    }
    if ((staleOrMissingEstimate || input.ringJustRefilled) && upstreamHealthy) {
      return (input.ringJustRefilled && upstreamAboveTarget && lastReportedLow) ||
        (!input.ringJustRefilled && lastReportedLow)
        ? Math.min(2, maxDeficitFrames)
        : 1;
    }
    const deficitMs = Math.max(
      targetMs - (estimatedMs ?? 0),
      panicEnterMs - (estimatedMs ?? 0)
    );
    return clampFrames(
      Math.ceil(Math.max(OPUS_FRAME_DURATION_MS, deficitMs) / OPUS_FRAME_DURATION_MS),
      2,
      maxEmergencyFrames
    );
  }

  if (estimatedMs < panicExitMs) {
    const deficitMs = Math.max(targetMs - estimatedMs, panicExitMs - estimatedMs);
    return clampFrames(
      Math.ceil(Math.max(OPUS_FRAME_DURATION_MS, deficitMs) / OPUS_FRAME_DURATION_MS),
      1,
      Math.min(2, maxDeficitFrames)
    );
  }

  if (estimatedMs < targetMs) {
    const deficitMs = targetMs - estimatedMs;
    return clampFrames(
      Math.ceil(deficitMs / OPUS_FRAME_DURATION_MS),
      2,
      maxDeficitFrames
    );
  }

  let framesToPost = 0;
  if (estimatedMs <= targetMs + overshootMarginMs) {
    framesToPost = estimatedMs <= targetMs + softLandingMarginMs ? 2 : 1;
  }

  const recentLowReport =
    input.lastReportedBufferedMs !== null &&
    input.lastReportedBufferedMs < targetMs &&
    input.reportAgeMs <= staleReportGraceMs &&
    input.upstreamBufferedMs < latencyDrainTriggerMs;
  const reserveAvailable =
    input.upstreamBufferedMs >= targetMs * reserveFloorRatio;
  if (recentLowReport && reserveAvailable) {
    framesToPost = Math.max(framesToPost, 1);
  }

  const latencyExcessMs = input.upstreamBufferedMs - latencyDrainTriggerMs;
  if (
    latencyExcessMs > 0 &&
    input.reportAgeMs <= staleReportGraceMs &&
    estimatedMs <= targetMs + overshootMarginMs + latencyDrainHeadroomMs
  ) {
    const latencyDrainFrames = clampFrames(
      Math.floor(latencyExcessMs / latencyDrainTriggerMs) + 1,
      1,
      maxLatencyDrainFrames
    );
    framesToPost = Math.max(framesToPost, latencyDrainFrames);
  }

  const staleLowReportRecovering =
    input.reportAgeMs > staleReportGraceMs &&
    input.lastReportedBufferedMs !== null &&
    input.lastReportedBufferedMs <
      Math.max(panicExitMs, targetMs - softLandingMarginMs) &&
    input.upstreamBufferedMs >= targetMs + overshootMarginMs &&
    estimatedMs <= targetMs + overshootMarginMs + latencyDrainHeadroomMs;
  if (staleLowReportRecovering) {
    framesToPost = Math.max(framesToPost, Math.min(2, maxDeficitFrames));
  }

  return framesToPost;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampFrames(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
