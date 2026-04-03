export interface AdaptiveIdealTargetInput {
  baseTargetMs: number;
  minTargetMs: number;
  maxTargetMs: number;
  jitterMultiplier: number;
  jitterMs: number;
  lossPenaltyMs?: number;
  playoutBoostMs?: number;
}

export interface AdaptiveSmoothedTargetInput {
  idealTargetMs: number;
  previousTargetMs?: number;
  alphaUp: number;
  alphaDown: number;
}

export function clampAdaptiveTargetMs(
  valueMs: number,
  minTargetMs: number,
  maxTargetMs: number
): number {
  return Math.max(minTargetMs, Math.min(maxTargetMs, valueMs));
}

export function computeAdaptiveJitterMs(samples: readonly number[]): number {
  if (samples.length < 3) return 0;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  let varianceSum = 0;
  for (const sample of samples) {
    varianceSum += (sample - mean) * (sample - mean);
  }
  return Math.sqrt(Math.max(0, varianceSum / samples.length));
}

export function computeAdaptiveIdealTargetMs(
  input: AdaptiveIdealTargetInput
): number {
  const lossPenaltyMs = input.lossPenaltyMs ?? 0;
  const playoutBoostMs = input.playoutBoostMs ?? 0;
  const unclamped =
    input.baseTargetMs +
    playoutBoostMs +
    input.jitterMultiplier * input.jitterMs +
    lossPenaltyMs;
  return clampAdaptiveTargetMs(
    unclamped,
    input.minTargetMs,
    input.maxTargetMs
  );
}

export function stepSmoothedAdaptiveTargetMs(
  input: AdaptiveSmoothedTargetInput
): number {
  const previousTargetMs = input.previousTargetMs ?? input.idealTargetMs;
  if (input.idealTargetMs > previousTargetMs) {
    return previousTargetMs + input.alphaUp * (input.idealTargetMs - previousTargetMs);
  }
  const fallingDeltaMs = previousTargetMs - input.idealTargetMs;
  const alphaDown =
    fallingDeltaMs > 40 ? Math.min(0.5, input.alphaDown * 1.5) : input.alphaDown;
  return previousTargetMs + alphaDown * (input.idealTargetMs - previousTargetMs);
}
