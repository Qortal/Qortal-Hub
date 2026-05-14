/**
 * Dedicated worker for group-call sender Opus encoding.
 *
 * This worker owns the CPU-heavy sender steps once configured:
 * Float32 PCM -> Int16 PCM -> AudioData -> AudioEncoder.encode().
 * The capture worklet is still relayed through the audio-surface main thread in
 * this phase; direct worklet-to-worker delivery is the next step.
 */

const GCALL_SENDER_MAX_ENCODER_QUEUE_SIZE = 4;
const GCALL_SENDER_MAX_REALTIME_FRAME_AGE_MS = 180;
const GCALL_SENDER_ENCODER_RESET_QUEUE_PINNED_MS = 500;
const GCALL_SENDER_ENCODER_RESET_STALE_DROPS = 8;
const GCALL_SENDER_ENCODER_RESET_STALE_WINDOW_MS = 2_000;
const GCALL_SENDER_ENCODER_RESET_MAX_OUTPUT_AGE_MS = 400;
const GCALL_SENDER_ENCODER_RESET_COOLDOWN_MS = 7_500;
const GCALL_SENDER_WORKER_CONFIG_SUPPORT_TIMEOUT_MS = 1_500;

type ConfigureMessage = {
  type: 'configure';
  generation: number;
  encoderConfig: AudioEncoderConfig;
};

type EncodeFrameMessage = {
  type: 'encodeFrame';
  generation: number;
  frame?: ArrayBuffer;
  sharedSlot?: number;
  byteOffset?: number;
  byteLength?: number;
  vad: boolean;
  capturePerfMs?: number;
  inputSampleRate?: number;
  outputSampleRate?: number;
  inputFrameSamples?: number;
};

type ResetMessage = {
  type: 'reset';
  generation: number;
  reason: string;
};

type ProbeMessage = {
  type: 'probe';
  id: number;
  encoderConfig: AudioEncoderConfig;
};

type InboundMessage =
  | ProbeMessage
  | ConfigureMessage
  | EncodeFrameMessage
  | ResetMessage
  | { type: 'setInputPort'; generation: number; port: MessagePort }
  | { type: 'stop'; generation?: number };

type EncodeTiming = {
  timestampUs: number;
  capturePerfMs: number;
  encoderInputPerfMs: number;
  vad: boolean;
};

type WorkerStats = {
  encodedFrameCount: number;
  droppedEncoderBackpressureFrames: number;
  droppedStaleEncodedFrames: number;
  encoderResetCount: number;
  lastEncoderResetAtMs: number;
  lastEncoderResetReason: string | null;
  encoderPressureActiveMs: number;
  staleEncodedDropsInWindow: number;
  encoderQueueSize: number | null;
  lastEncoderInputPerfMs: number;
  capturedFrameCount: number;
  lastCapturePerfMs: number;
  captureInputSampleRate: number | null;
  captureOutputSampleRate: number | null;
  captureInputFrameSamples: number | null;
  sharedRingEnabled: boolean;
  sharedRingSlotCount: number;
  sharedRingFallbackTransfers: number;
  encoderErrorCount: number;
  lastEncoderError: string | null;
};

function postProbeStage(
  stage: string,
  generationValue = generation,
  detail?: Record<string, unknown>
): void {
  workerPost({
    type: 'probeStage',
    generation: generationValue,
    stage,
    atMs: Date.now(),
    ...(detail ? { detail } : {}),
  });
}

function workerPost(message: unknown, transfer?: Transferable[]): void {
  const s = self as unknown as {
    postMessage(message: unknown, transfer?: Transferable[]): void;
  };
  if (transfer && transfer.length > 0) s.postMessage(message, transfer);
  else s.postMessage(message);
}

function float32ToInt16(frame: Float32Array): Int16Array {
  const out = new Int16Array(frame.length);
  for (let i = 0; i < frame.length; i++) {
    out[i] = Math.max(-32768, Math.min(32767, Math.round(frame[i]! * 32767)));
  }
  return out;
}

const AudioEncoderCtor = (globalThis as unknown as {
  AudioEncoder?: typeof AudioEncoder & {
    isConfigSupported?: (
      config: AudioEncoderConfig
    ) => Promise<{ supported: boolean; config?: AudioEncoderConfig }>;
  };
}).AudioEncoder;
const AudioDataCtor = (globalThis as unknown as {
  AudioData?: typeof AudioData;
}).AudioData;

let generation = 0;
let encoder: AudioEncoder | null = null;
let encoderConfig: AudioEncoderConfig | null = null;
let encoderGeneration = 0;
let encoderQueuePressureStartedPerfMs: number | null = null;
let encoderPressureActiveMs = 0;
let lastEncoderResetPerfMs = -Infinity;
let encodedFrameCount = 0;
let droppedEncoderBackpressureFrames = 0;
let droppedStaleEncodedFrames = 0;
let encoderResetCount = 0;
let lastEncoderResetAtMs = 0;
let lastEncoderResetReason: string | null = null;
let encoderErrorCount = 0;
let lastEncoderError: string | null = null;
let lastEncoderInputPerfMs = 0;
let capturedFrameCount = 0;
let lastCapturePerfMs = 0;
let captureInputSampleRate: number | null = null;
let captureOutputSampleRate: number | null = null;
let captureInputFrameSamples: number | null = null;
let inputPort: MessagePort | null = null;
let sharedSamples: Float32Array | null = null;
let sharedState: Int32Array | null = null;
let sharedSlotCount = 0;
let sharedFrameSamples = 960;
let sharedRingFallbackTransfers = 0;
let latestVad = false;
const staleEncodedDropPerfMs: number[] = [];
const encodeTimingByTimestampUs = new Map<number, EncodeTiming>();
const encodeTimingQueue: EncodeTiming[] = [];

function getStats(): WorkerStats {
  return {
    encodedFrameCount,
    droppedEncoderBackpressureFrames,
    droppedStaleEncodedFrames,
    encoderResetCount,
    lastEncoderResetAtMs,
    lastEncoderResetReason,
    encoderPressureActiveMs,
    staleEncodedDropsInWindow: staleEncodedDropPerfMs.length,
    encoderQueueSize:
      typeof encoder?.encodeQueueSize === 'number'
        ? encoder.encodeQueueSize
        : null,
    lastEncoderInputPerfMs,
    capturedFrameCount,
    lastCapturePerfMs,
    captureInputSampleRate,
    captureOutputSampleRate,
    captureInputFrameSamples,
    sharedRingEnabled: sharedSamples !== null && sharedState !== null,
    sharedRingSlotCount: sharedSlotCount,
    sharedRingFallbackTransfers,
    encoderErrorCount,
    lastEncoderError,
  };
}

function releaseSharedSlot(message: EncodeFrameMessage): void {
  if (
    sharedState &&
    typeof message.sharedSlot === 'number' &&
    message.sharedSlot >= 0 &&
    message.sharedSlot < sharedSlotCount
  ) {
    Atomics.store(sharedState, message.sharedSlot, 0);
  }
}

function postStats(): void {
  workerPost({ type: 'stats', generation, stats: getStats() });
}

function closeEncoder(): void {
  const current = encoder;
  encoder = null;
  encoderGeneration++;
  encodeTimingByTimestampUs.clear();
  encodeTimingQueue.length = 0;
  if (!current) return;
  try {
    current.close();
  } catch {
    /* ignore */
  }
}

function noteStaleEncodedDrop(nowPerfMs: number): void {
  staleEncodedDropPerfMs.push(nowPerfMs);
  const oldestAllowed =
    nowPerfMs - GCALL_SENDER_ENCODER_RESET_STALE_WINDOW_MS;
  while (
    staleEncodedDropPerfMs.length > 0 &&
    staleEncodedDropPerfMs[0]! < oldestAllowed
  ) {
    staleEncodedDropPerfMs.shift();
  }
}

function createEncoder(): AudioEncoder {
  postProbeStage('encoder-create-start');
  if (!encoderConfig || !AudioEncoderCtor) {
    throw new Error('missing-encoder-config-or-api');
  }
  const localEncoderGeneration = ++encoderGeneration;
  const next = new AudioEncoderCtor({
    output: (chunk) => {
      if (localEncoderGeneration !== encoderGeneration || encoder !== next) {
        return;
      }
      const encodeOutPerfMs = performance.now();
      const chunkTimestampUs =
        typeof chunk.timestamp === 'number' ? chunk.timestamp : null;
      let timing =
        chunkTimestampUs !== null
          ? encodeTimingByTimestampUs.get(chunkTimestampUs)
          : undefined;
      if (timing && chunkTimestampUs !== null) {
        encodeTimingByTimestampUs.delete(chunkTimestampUs);
        const queuedIndex = encodeTimingQueue.findIndex(
          (entry) => entry.timestampUs === chunkTimestampUs
        );
        if (queuedIndex >= 0) {
          encodeTimingQueue.splice(queuedIndex, 1);
        }
      } else {
        timing = encodeTimingQueue.shift();
        if (timing) {
          encodeTimingByTimestampUs.delete(timing.timestampUs);
        }
      }
      const capturePerfMs = timing?.capturePerfMs ?? encodeOutPerfMs;
      const encoderInputPerfMs =
        timing?.encoderInputPerfMs ?? lastEncoderInputPerfMs;
      const outputAgeMs = encodeOutPerfMs - capturePerfMs;
      if (outputAgeMs > GCALL_SENDER_MAX_REALTIME_FRAME_AGE_MS) {
        droppedStaleEncodedFrames++;
        noteStaleEncodedDrop(encodeOutPerfMs);
        if (outputAgeMs > GCALL_SENDER_ENCODER_RESET_MAX_OUTPUT_AGE_MS) {
          resetEncoderIfAllowed('encoded-output-age', encodeOutPerfMs);
        } else if (
          staleEncodedDropPerfMs.length >=
          GCALL_SENDER_ENCODER_RESET_STALE_DROPS
        ) {
          resetEncoderIfAllowed('stale-output-drops', encodeOutPerfMs);
        }
        postStats();
        return;
      }
      const frame = new Uint8Array(chunk.byteLength);
      chunk.copyTo(frame);
      encodedFrameCount++;
      workerPost(
        {
          type: 'encoded',
          generation,
          opusFrame: frame.buffer,
          vad: timing?.vad ?? latestVad,
          capturePerfMs,
          encoderInputPerfMs,
          encodeOutPerfMs,
          stats: getStats(),
        },
        [frame.buffer]
      );
    },
    error: (error) => {
      if (localEncoderGeneration !== encoderGeneration) return;
      encoderErrorCount++;
      lastEncoderError = error instanceof Error ? error.message : String(error);
      workerPost({
        type: 'error',
        generation,
        message: lastEncoderError,
        stats: getStats(),
      });
      },
    });
  postProbeStage('encoder-configure-start');
  next.configure(encoderConfig);
  postProbeStage('encoder-configure-done');
  return next;
}

function resetEncoderIfAllowed(reason: string, nowPerfMs: number): boolean {
  if (
    nowPerfMs - lastEncoderResetPerfMs <
    GCALL_SENDER_ENCODER_RESET_COOLDOWN_MS
  ) {
    return false;
  }
  return replaceEncoder(reason, nowPerfMs);
}

function replaceEncoder(reason: string, nowPerfMs = performance.now()): boolean {
  if (!encoderConfig || !AudioEncoderCtor) return false;
  lastEncoderResetPerfMs = nowPerfMs;
  encoderResetCount++;
  lastEncoderResetAtMs = Date.now();
  lastEncoderResetReason = reason;
  encoderQueuePressureStartedPerfMs = null;
  encoderPressureActiveMs = 0;
  staleEncodedDropPerfMs.length = 0;
  closeEncoder();
  try {
    encoder = createEncoder();
    postStats();
    return true;
  } catch (error) {
    encoderErrorCount++;
    lastEncoderError = error instanceof Error ? error.message : String(error);
    workerPost({
      type: 'error',
      generation,
      message: lastEncoderError,
      stats: getStats(),
    });
    return false;
  }
}

async function checkConfigSupport(
  config: AudioEncoderConfig
): Promise<{
  audioEncoderDefined: boolean;
  audioDataDefined: boolean;
  configSupported: boolean | null;
  supportError: string | null;
}> {
  const audioEncoderDefined = typeof AudioEncoderCtor !== 'undefined';
  const audioDataDefined = typeof AudioDataCtor !== 'undefined';
  let configSupported: boolean | null = null;
  let supportError: string | null = null;
  if (audioEncoderDefined && audioDataDefined) {
    try {
      postProbeStage('support-check-start', generation, {
        audioEncoderDefined,
        audioDataDefined,
      });
      const supportPromise = AudioEncoderCtor?.isConfigSupported?.(config);
      const supportResult = supportPromise
        ? await Promise.race([
            supportPromise,
            new Promise<{ supported: false; timedOut: true }>((resolve) => {
              setTimeout(
                () => resolve({ supported: false, timedOut: true }),
                GCALL_SENDER_WORKER_CONFIG_SUPPORT_TIMEOUT_MS
              );
            }),
          ])
        : null;
      configSupported =
        typeof supportResult?.supported === 'boolean'
          ? supportResult.supported
          : null;
      if ('timedOut' in (supportResult ?? {})) {
        supportError = `config-support-timeout-${GCALL_SENDER_WORKER_CONFIG_SUPPORT_TIMEOUT_MS}ms`;
      }
      postProbeStage('support-check-done', generation, {
        configSupported,
        supportError,
      });
    } catch (error) {
      supportError = error instanceof Error ? error.message : String(error);
      configSupported = false;
      postProbeStage('support-check-error', generation, { supportError });
    }
  }
  return {
    audioEncoderDefined,
    audioDataDefined,
    configSupported,
    supportError,
  };
}

async function handleProbe(message: ProbeMessage): Promise<void> {
  postProbeStage('probe-received', generation, { id: message.id });
  const detail = await checkConfigSupport(message.encoderConfig);
  postProbeStage('probe-result-send', generation, { id: message.id });
  workerPost({
    type: 'probeResult',
    id: message.id,
    ...detail,
    supported:
      detail.audioEncoderDefined &&
      detail.audioDataDefined &&
      detail.configSupported !== false,
  });
}

async function handleConfigure(message: ConfigureMessage): Promise<void> {
  generation = message.generation >>> 0;
  postProbeStage('configure-received', generation);
  const detail = await checkConfigSupport(message.encoderConfig);
  const supported =
    detail.audioEncoderDefined &&
    detail.audioDataDefined &&
    detail.configSupported !== false;
  if (!supported) {
    closeEncoder();
    workerPost({
      type: 'configured',
      generation,
      supported: false,
      ...detail,
      stats: getStats(),
    });
    return;
  }
  encoderConfig = message.encoderConfig;
  try {
    closeEncoder();
    encoder = createEncoder();
    postProbeStage('configured-response-send', generation, { supported: true });
    workerPost({
      type: 'configured',
      generation,
      supported: true,
      ...detail,
      stats: getStats(),
    });
  } catch (error) {
    encoderErrorCount++;
    lastEncoderError = error instanceof Error ? error.message : String(error);
    postProbeStage('configured-response-send', generation, {
      supported: false,
      supportError: lastEncoderError,
    });
    workerPost({
      type: 'configured',
      generation,
      supported: false,
      ...detail,
      supportError: lastEncoderError,
      stats: getStats(),
    });
  }
}

function handleEncodeFrame(message: EncodeFrameMessage): void {
  if (message.generation !== generation || !encoder || !AudioDataCtor) {
    releaseSharedSlot(message);
    return;
  }
  const activeEncoder = encoder;
  const capturedAtPerfMs =
    typeof message.capturePerfMs === 'number' &&
    Number.isFinite(message.capturePerfMs) &&
    message.capturePerfMs > 0
      ? message.capturePerfMs
      : performance.now();
  latestVad = message.vad === true;
  capturedFrameCount++;
  lastCapturePerfMs = capturedAtPerfMs;
  if (
    typeof message.inputSampleRate === 'number' &&
    Number.isFinite(message.inputSampleRate)
  ) {
    captureInputSampleRate = message.inputSampleRate;
  }
  if (
    typeof message.outputSampleRate === 'number' &&
    Number.isFinite(message.outputSampleRate)
  ) {
    captureOutputSampleRate = message.outputSampleRate;
  }
  if (
    typeof message.inputFrameSamples === 'number' &&
    Number.isFinite(message.inputFrameSamples)
  ) {
    captureInputFrameSamples = message.inputFrameSamples;
  }
  workerPost({
    type: 'vad',
    generation,
    vad: latestVad,
    stats: getStats(),
  });
  const queueSize =
    typeof activeEncoder.encodeQueueSize === 'number'
      ? activeEncoder.encodeQueueSize
      : 0;
  if (queueSize >= GCALL_SENDER_MAX_ENCODER_QUEUE_SIZE) {
    releaseSharedSlot(message);
    droppedEncoderBackpressureFrames++;
    if (encoderQueuePressureStartedPerfMs === null) {
      encoderQueuePressureStartedPerfMs = capturedAtPerfMs;
    }
    encoderPressureActiveMs =
      capturedAtPerfMs - encoderQueuePressureStartedPerfMs;
    if (
      encoderPressureActiveMs >= GCALL_SENDER_ENCODER_RESET_QUEUE_PINNED_MS
    ) {
      resetEncoderIfAllowed('queue-pinned', capturedAtPerfMs);
    } else {
      postStats();
    }
    return;
  }
  encoderQueuePressureStartedPerfMs = null;
  encoderPressureActiveMs = 0;
  let floatFrame: Float32Array | null = null;
  if (
    sharedSamples &&
    typeof message.sharedSlot === 'number' &&
    message.sharedSlot >= 0 &&
    message.sharedSlot < sharedSlotCount
  ) {
    const offset = message.sharedSlot * sharedFrameSamples;
    floatFrame = sharedSamples.subarray(offset, offset + sharedFrameSamples);
  } else if (message.frame instanceof ArrayBuffer) {
    if (sharedSamples) sharedRingFallbackTransfers++;
    const byteOffset = Math.max(0, message.byteOffset ?? 0);
    const byteLength = Math.max(
      0,
      message.byteLength ?? message.frame.byteLength - byteOffset
    );
    floatFrame = new Float32Array(
      message.frame,
      byteOffset,
      Math.floor(byteLength / Float32Array.BYTES_PER_ELEMENT)
    );
  }
  if (!floatFrame) {
    releaseSharedSlot(message);
    return;
  }
  const pcm16 = float32ToInt16(floatFrame);
  releaseSharedSlot(message);
  const encoderInputPerfMs = performance.now();
  lastEncoderInputPerfMs = encoderInputPerfMs;
  const timestampUs = Math.trunc(encoderInputPerfMs * 1000);
  const timing: EncodeTiming = {
    timestampUs,
    capturePerfMs: capturedAtPerfMs,
    encoderInputPerfMs,
    vad: latestVad,
  };
  encodeTimingByTimestampUs.set(timestampUs, timing);
  encodeTimingQueue.push(timing);
  while (encodeTimingQueue.length > 32) {
    const dropped = encodeTimingQueue.shift();
    if (dropped) encodeTimingByTimestampUs.delete(dropped.timestampUs);
  }
  const audioData = new AudioDataCtor({
    format: 's16',
    sampleRate: 48_000,
    numberOfFrames: 960,
    numberOfChannels: 1,
    timestamp: timestampUs,
    data: pcm16 as unknown as BufferSource,
  });
  activeEncoder.encode(audioData);
  audioData.close();
}

function handleSetInputPort(message: {
  generation: number;
  port: MessagePort;
  sharedSamples?: SharedArrayBuffer;
  sharedState?: SharedArrayBuffer;
  sharedSlotCount?: number;
  sharedFrameSamples?: number;
}): void {
  inputPort = message.port;
  sharedSamples =
    message.sharedSamples instanceof SharedArrayBuffer
      ? new Float32Array(message.sharedSamples)
      : null;
  sharedState =
    message.sharedState instanceof SharedArrayBuffer
      ? new Int32Array(message.sharedState)
      : null;
  sharedSlotCount = Math.max(0, message.sharedSlotCount ?? 0);
  sharedFrameSamples = Math.max(1, message.sharedFrameSamples ?? 960);
  inputPort.onmessage = (event: MessageEvent) => {
    const data = event.data as EncodeFrameMessage;
    if (data?.type === 'encodeFrame') {
      handleEncodeFrame(data);
    }
  };
  inputPort.start?.();
  workerPost({
    type: 'inputPortReady',
    generation: message.generation,
    stats: getStats(),
  });
}

(self as unknown as { onmessage: ((event: MessageEvent) => void) | null })
  .onmessage = (event: MessageEvent) => {
  const message = event.data as InboundMessage;
  if (message?.type) {
    postProbeStage(`message-received:${message.type}`);
  }
  if (message?.type === 'probe') {
    void handleProbe(message);
  } else if (message?.type === 'configure') {
    void handleConfigure(message);
  } else if (message?.type === 'encodeFrame') {
    handleEncodeFrame(message);
  } else if (message?.type === 'setInputPort') {
    handleSetInputPort(message);
  } else if (message?.type === 'reset') {
    if (message.generation === generation) {
      replaceEncoder(message.reason || 'reset');
    }
  } else if (message?.type === 'stop') {
    inputPort?.close?.();
    inputPort = null;
    sharedSamples = null;
    sharedState = null;
    sharedSlotCount = 0;
    closeEncoder();
  }
};
