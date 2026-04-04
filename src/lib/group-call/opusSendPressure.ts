/**
 * Opus uplink bitrate ladder + send-pressure hysteresis for Reticulum group voice.
 *
 * **Bitrate ladder:** `nominal` (from {@link getGroupCallAudioTuning}) steps down by
 * fixed fractions of nominal; floor is {@link OPUS_SEND_PRESSURE_MIN_BITRATE}. Tiers are
 * absolute bps after `max(floor, round(nominal * ratio))` — see {@link buildOpusSendPressureTiers}.
 *
 * **Pressure signal:** Aligns with main-process `isReticulumAudioBridgePressured` in
 * `electron/src/group-call.ts` (same numeric thresholds) plus optional renderer pending
 * depth so send-side reacts when IPC/main queues grow before bridge snapshots move.
 *
 * **Hysteresis:** Fast enter (~1.5s sustained pressure) steps down one tier at a time;
 * slow exit (~7.5s clean) steps up one tier; {@link OPUS_SEND_PRESSURE_STEP_UP_COOLDOWN_MS}
 * limits oscillation between tier increases.
 */

/** Minimum Opus bitrate when stepped down under pressure (do not go below). */
export const OPUS_SEND_PRESSURE_MIN_BITRATE = 10_000;

/** Fractions of nominal bitrate for pressure tiers (nominal → pressure_1 → … → floor). */
export const OPUS_SEND_PRESSURE_TIER_RATIOS = [
  1,
  0.75,
  0.58,
  0.42,
] as const;

/** Must match `GC_RETICULUM_AUDIO_PRESSURE_BRIDGE_QUEUE_FRAMES` in group-call.ts */
export const RETICULUM_SEND_PRESSURE_BRIDGE_QUEUE_FRAMES = 8;

/** Must match `GC_RETICULUM_AUDIO_PRESSURE_DECODED_QUEUE_DEPTH` */
export const RETICULUM_SEND_PRESSURE_DECODED_QUEUE_DEPTH = 12;

/** Must match `GC_RETICULUM_AUDIO_PRESSURE_RECENT_DROPS` (rolling 5s count) */
export const RETICULUM_SEND_PRESSURE_QUEUE_DROPS_LAST5S = 6;

/** Renderer pending frames threshold (aligned with window pressure heuristics). */
export const RETICULUM_SEND_PRESSURE_PENDING_FRAMES = 12;

/** Fast enter: sustained pressure before first / next step-down (ms). */
export const OPUS_SEND_PRESSURE_ENTER_MS = 1_500;

/** Slow exit: clean period before one step-up (ms). */
export const OPUS_SEND_PRESSURE_EXIT_MS = 7_500;

/** Minimum time between tier increases after clean period (anti-oscillation). */
export const OPUS_SEND_PRESSURE_STEP_UP_COOLDOWN_MS = 3_000;

/** Max peers per `gcall:sendAudioBatch` IPC invoke (fanout chunking, not temporal batching). */
export const GCALL_SEND_AUDIO_IPC_BATCH_SIZE = 5;

/** Cadence for send-pressure sampling + encoder tier updates (ms). */
export const OPUS_SEND_PRESSURE_TICK_MS = 250;

export interface ReticulumSendPressureSnapshot {
  bridgeWaitingForDrain?: boolean;
  bridgeQueuedFrames: number;
  decodedQueueDepth: number;
  queuePressureDropsLast5s: number;
  pendingFrames?: number;
}

/**
 * True when send path should be treated as pressured (instant sample).
 * Mirrors bridge pressure in main + optional main pending depth from renderer metrics.
 */
export function isReticulumSendPressureSignal(
  s: ReticulumSendPressureSnapshot
): boolean {
  if (s.bridgeWaitingForDrain === true) return true;
  if (s.bridgeQueuedFrames >= RETICULUM_SEND_PRESSURE_BRIDGE_QUEUE_FRAMES)
    return true;
  if (s.decodedQueueDepth >= RETICULUM_SEND_PRESSURE_DECODED_QUEUE_DEPTH) return true;
  if (s.queuePressureDropsLast5s >= RETICULUM_SEND_PRESSURE_QUEUE_DROPS_LAST5S)
    return true;
  if ((s.pendingFrames ?? 0) >= RETICULUM_SEND_PRESSURE_PENDING_FRAMES) return true;
  return false;
}

/** Sorted descending unique bitrates for nominal profile bitrate. */
export function buildOpusSendPressureTiers(nominalBitrate: number): number[] {
  const n = Math.max(1, Math.round(nominalBitrate));
  const set = new Set<number>();
  for (const r of OPUS_SEND_PRESSURE_TIER_RATIOS) {
    const bps = Math.max(
      OPUS_SEND_PRESSURE_MIN_BITRATE,
      Math.round(n * r)
    );
    set.add(bps);
  }
  return [...set].sort((a, b) => b - a);
}

export interface OpusSendPressureControllerState {
  /** Index in `tiers` array (0 = highest bitrate). */
  tierIndex: number;
  pressureAccumMs: number;
  cleanAccumMs: number;
  lastStepUpAtMs: number;
  /** At lowest tier while pressure still active (controlled drops elsewhere). */
  maxPain: boolean;
  lastMaxPainLogAtMs: number;
}

export function createOpusSendPressureControllerState(): OpusSendPressureControllerState {
  return {
    tierIndex: 0,
    pressureAccumMs: 0,
    cleanAccumMs: 0,
    lastStepUpAtMs: 0,
    maxPain: false,
    lastMaxPainLogAtMs: 0,
  };
}

export interface OpusSendPressureTickResult {
  state: OpusSendPressureControllerState;
  /** Current encoder bitrate (bps). */
  targetBitrate: number;
  /** Tier changed this tick (for throttled logging). */
  tierChanged: boolean;
  /** Stepped to floor while pressure persists. */
  maxPainEntered: boolean;
}

/**
 * Advance pressure controller. Call on a fixed cadence (e.g. 250ms) with live snapshot + nominal tiers.
 */
export function tickOpusSendPressureController(
  state: OpusSendPressureControllerState,
  tiers: readonly number[],
  deltaMs: number,
  nowMs: number,
  pressured: boolean
): OpusSendPressureTickResult {
  if (tiers.length === 0) {
    return {
      state,
      targetBitrate: OPUS_SEND_PRESSURE_MIN_BITRATE,
      tierChanged: false,
      maxPainEntered: false,
    };
  }

  let tierChanged = false;
  let maxPainEntered = false;
  const maxIx = tiers.length - 1;
  state.tierIndex = Math.min(Math.max(0, state.tierIndex), maxIx);

  if (pressured) {
    state.cleanAccumMs = 0;
    state.pressureAccumMs += deltaMs;
    if (state.pressureAccumMs >= OPUS_SEND_PRESSURE_ENTER_MS) {
      state.pressureAccumMs = 0;
      if (state.tierIndex < maxIx) {
        state.tierIndex++;
        tierChanged = true;
      }
      if (state.tierIndex >= maxIx) {
        if (!state.maxPain) {
          state.maxPain = true;
          maxPainEntered = true;
        }
      }
    }
  } else {
    state.pressureAccumMs = 0;
    state.cleanAccumMs += deltaMs;
    state.maxPain = false;
    if (
      state.cleanAccumMs >= OPUS_SEND_PRESSURE_EXIT_MS &&
      state.tierIndex > 0 &&
      nowMs - state.lastStepUpAtMs >= OPUS_SEND_PRESSURE_STEP_UP_COOLDOWN_MS
    ) {
      state.tierIndex--;
      state.lastStepUpAtMs = nowMs;
      state.cleanAccumMs = 0;
      tierChanged = true;
    }
  }

  state.tierIndex = Math.min(Math.max(0, state.tierIndex), maxIx);
  const targetBitrate = tiers[state.tierIndex]!;

  return {
    state,
    targetBitrate,
    tierChanged,
    maxPainEntered,
  };
}
