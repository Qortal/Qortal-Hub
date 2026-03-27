export const RECENT_SPEAKER_WINDOW_MS = 1_500;
export const SPEAKER_HANGOVER_MS = 250;
export const ACTIVE_SPEAKER_GAIN = 0.78;
export const INACTIVE_SPEAKER_GAIN = 0.12;
export const MASTER_GAIN_FLOOR = 0.55;
export const MASTER_GAIN_NUMERATOR = 0.95;
export const GAIN_SMOOTHING_TIME_CONSTANT_S = 0.05;
export const GAIN_UPDATE_CADENCE_MS = 120;
export const OVERLOAD_REDUCTION_THRESHOLD_DB = -1.5;
export const HEAVY_REDUCTION_THRESHOLD_DB = -3;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function computeRecentSpeakerEstimate(
  speakers: ReadonlyMap<string, number>,
  nowMs: number,
  recentSpeakerWindowMs: number = RECENT_SPEAKER_WINDOW_MS
): number {
  let count = 0;
  for (const [, lastVadAt] of speakers) {
    if (nowMs - lastVadAt <= recentSpeakerWindowMs) count++;
  }
  return count;
}

export function computePerSpeakerGainTarget(opts: {
  recentSpeakerEstimate: number;
  lastVadAtMs?: number;
  nowMs: number;
  speakerHangoverMs?: number;
  activeSpeakerGain?: number;
  inactiveSpeakerGain?: number;
}): number {
  const {
    recentSpeakerEstimate,
    lastVadAtMs,
    nowMs,
    speakerHangoverMs = SPEAKER_HANGOVER_MS,
    activeSpeakerGain = ACTIVE_SPEAKER_GAIN,
    inactiveSpeakerGain = INACTIVE_SPEAKER_GAIN,
  } = opts;

  const isActive =
    typeof lastVadAtMs === 'number' &&
    Number.isFinite(lastVadAtMs) &&
    nowMs - lastVadAtMs <= speakerHangoverMs;
  if (!isActive) return inactiveSpeakerGain;
  return recentSpeakerEstimate <= 1 ? 1 : activeSpeakerGain;
}

export function computeMasterGainTarget(
  recentSpeakerEstimate: number,
  numerator: number = MASTER_GAIN_NUMERATOR,
  floor: number = MASTER_GAIN_FLOOR
): number {
  if (recentSpeakerEstimate <= 1) return 1;
  return clamp(numerator / Math.sqrt(recentSpeakerEstimate), floor, 1);
}

export function shouldUpdateAudioMix(
  lastUpdateAtMs: number,
  nowMs: number,
  cadenceMs: number = GAIN_UPDATE_CADENCE_MS
): boolean {
  return nowMs - lastUpdateAtMs >= cadenceMs;
}
