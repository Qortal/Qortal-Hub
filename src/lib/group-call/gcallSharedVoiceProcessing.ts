/**
 * Barrel for shared group/DM voice processing (constants, WASM FEC env, jitter factory).
 * Prefer importing from here when a file needs several of these; otherwise import submodules.
 */

export {
  OPUS_CHANNELS,
  OPUS_FRAME_DURATION_MS,
  OPUS_FRAME_SAMPLES,
  OPUS_SAMPLE_RATE,
} from './gcallVoiceAudioConstants';
export {
  GCALL_WASM_FEC_ENV_OFF,
  GCALL_WASM_FEC_EXTRA_HOLD_FRAMES,
  GCALL_WASM_FEC_MAX_PCM_PER_TICK,
  readGcallWasmFecDesired,
} from './gcallWasmFecEnv';
export {
  createGcallJitterBufferForIngress,
  type GcallInboundAdaptiveNetworkMode,
} from './gcallInboundJitterSetup';
export {
  GcallOpusFecPlayoutPipeline,
  GCALL_EMPTY_PCM,
  GCALL_WASM_FEC_EMPTY_STATS,
  type WasmFecDecodeStats,
  type WasmFecPcmSlab,
} from './gcallOpusFecPlayoutPipeline';
export { postStaticPlayoutTargetForTuning } from './gcallInboundPlayoutTarget';
