/**
 * Group-call Opus decode in a Worker with libopus PLC + in-band FEC (decode_fec).
 *
 * Main → worker:
 *   { type: 'decode', requestId, sourceAddr, packet: ArrayBuffer, gap: number }
 *   { type: 'reset', sourceAddr }
 *   { type: 'dispose', sourceAddr }
 *
 * Worker → main:
 *   { type: 'decoded', requestId, sourceAddr, pcm, frameCount, stats }
 *   pcm: contiguous Float32Array (frameCount * 960 samples, PLC → FEC → normal order)
 *   { type: 'error', requestId?, sourceAddr?, message: string }
 */

import createLibopusFecModule, { type LibopusFecModule } from '../wasm-libopus-fec/libopus-fec.js';

import { GCALL_AUDIO_MAX_OPUS_LEN } from '../lib/group-call/audioPacketCodec';

const SAMPLE_RATE = 48000;
const CHANNELS = 1;
const FRAME_SAMPLES = 960;
/** Align with main-thread `gapForWorker` cap (JitterBuffer / WASM drain). */
const MAX_WORKER_GAP = 48;
/** Defense-in-depth: insane gap → fresh decoder; then clamp to MAX_WORKER_GAP. */
const GAP_SANITY_THRESHOLD = 50;
/** After this many consecutive failed *normal* decodes, recreate the Opus decoder. */
const CONSECUTIVE_NORMAL_FAILS_BEFORE_RESET = 3;

type EmscriptenModule = LibopusFecModule;

let wasmInit: Promise<EmscriptenModule> | null = null;

function loadWasm(): Promise<EmscriptenModule> {
  if (!wasmInit) wasmInit = createLibopusFecModule();
  return wasmInit;
}

interface SourceState {
  dec: number;
  /** After reset: skip FEC until one in-order (gap===0) frame is decoded. */
  fecAllowed: boolean;
  /** Reused for every PLC/FEC/normal decode into WASM heap (serial use only). */
  pcmScratchPtr: number;
  /** Compressed packet copy; grown when packet larger than dataCap. */
  dataPtr: number;
  dataCap: number;
  consecutiveNormalFailures: number;
}

const sources = new Map<string, SourceState>();

function freeSourceBuffers(M: EmscriptenModule, s: SourceState) {
  if (s.pcmScratchPtr) {
    M._free(s.pcmScratchPtr);
    s.pcmScratchPtr = 0;
  }
  if (s.dataPtr) {
    M._free(s.dataPtr);
    s.dataPtr = 0;
    s.dataCap = 0;
  }
}

function destroyDecoder(M: EmscriptenModule, addr: string) {
  const s = sources.get(addr);
  if (s) {
    M._gcall_opus_decoder_destroy(s.dec);
    freeSourceBuffers(M, s);
    sources.delete(addr);
  }
}

/** New libopus handle; same pooled packet/PCM WASM buffers. */
function recreateOpusDecoder(M: EmscriptenModule, st: SourceState): boolean {
  M._gcall_opus_decoder_destroy(st.dec);
  const dec = M._gcall_opus_decoder_create(SAMPLE_RATE, CHANNELS);
  if (!dec) return false;
  st.dec = dec;
  st.fecAllowed = false;
  st.consecutiveNormalFailures = 0;
  return true;
}

function getOrCreateDecoder(M: EmscriptenModule, addr: string): SourceState | null {
  let s = sources.get(addr);
  if (s) return s;
  const dec = M._gcall_opus_decoder_create(SAMPLE_RATE, CHANNELS);
  if (!dec) return null;
  const pcmScratchPtr = M._malloc(FRAME_SAMPLES * 4);
  if (!pcmScratchPtr) {
    M._gcall_opus_decoder_destroy(dec);
    return null;
  }
  s = {
    dec,
    fecAllowed: false,
    pcmScratchPtr,
    dataPtr: 0,
    dataCap: 0,
    consecutiveNormalFailures: 0,
  };
  sources.set(addr, s);
  return s;
}

function ensurePacketBuffer(M: EmscriptenModule, st: SourceState, byteLen: number): boolean {
  if (byteLen <= st.dataCap && st.dataPtr !== 0) return true;
  if (st.dataPtr) M._free(st.dataPtr);
  const p = M._malloc(byteLen);
  if (!p) {
    st.dataPtr = 0;
    st.dataCap = 0;
    return false;
  }
  st.dataPtr = p;
  st.dataCap = byteLen;
  return true;
}

function copyHeapPcmInto(
  M: EmscriptenModule,
  pcmPtr: number,
  out: Float32Array,
  outFrameIndex: number
): void {
  const base = pcmPtr >> 2;
  out.set(M.HEAPF32.subarray(base, base + FRAME_SAMPLES), outFrameIndex * FRAME_SAMPLES);
}

/** Log negative libopus return codes (see opus_defines.h). */
function logOpusDecodeFailure(
  ret: number,
  ctx: { phase: 'plc' | 'fec' | 'normal'; decodeFec: 0 | 1; gap: number; sourceAddr: string }
): void {
  if (ret >= 0) return;
  console.error('[GCall] opus-fec wasm gcall_opus_decode_float failed', {
    opusError: ret,
    ...ctx,
  });
}

/** Coarse FEC success: positive sample count and non-trivial energy (refinement D). */
function fecOutputLooksValid(samplesDecoded: number, pcm: Float32Array): boolean {
  if (samplesDecoded <= 0) return false;
  let e = 0;
  for (let i = 0; i < pcm.length; i++) e += pcm[i] * pcm[i];
  return e > 1e-10;
}

function decodePacket(
  M: EmscriptenModule,
  st: SourceState,
  packet: Uint8Array,
  gap: number,
  sourceAddr: string
): {
  pcm: Float32Array;
  frameCount: number;
  plcFrames: number;
  fecAttempts: number;
  fecSuccessCoarse: number;
} {
  let plcFrames = 0;
  let fecAttempts = 0;
  let fecSuccessCoarse = 0;

  if (gap > GAP_SANITY_THRESHOLD) {
    console.warn('[GCall] opus-fec wasm: gap > 50, resetting Opus decoder', {
      gap,
      sourceAddr: sourceAddr.slice(0, 12),
    });
    if (!recreateOpusDecoder(M, st)) {
      throw new Error('opus decoder recreate after absurd gap failed');
    }
  }

  const effectiveGap = Math.min(Math.max(0, gap), MAX_WORKER_GAP);
  const plcCount = Math.max(0, effectiveGap - 1);
  const pcmPtr = st.pcmScratchPtr;

  if (!ensurePacketBuffer(M, st, packet.length)) {
    throw new Error('opus packet buffer alloc failed');
  }
  M.HEAPU8.set(packet, st.dataPtr);
  const dataPtr = st.dataPtr;
  const dec = st.dec;

  const maxFrames =
    plcCount + (effectiveGap >= 1 && st.fecAllowed ? 1 : 0) + 1;
  const scratch = new Float32Array(maxFrames * FRAME_SAMPLES);
  let frameIdx = 0;

  for (let i = 0; i < plcCount; i++) {
    const n = M._gcall_opus_decode_float(dec, 0, 0, pcmPtr, FRAME_SAMPLES, 0);
    logOpusDecodeFailure(n, { phase: 'plc', decodeFec: 0, gap: effectiveGap, sourceAddr });
    if (n > 0) {
      copyHeapPcmInto(M, pcmPtr, scratch, frameIdx);
      frameIdx++;
      plcFrames++;
    }
  }

  if (effectiveGap >= 1 && st.fecAllowed) {
    const nFec = M._gcall_opus_decode_float(
      dec,
      dataPtr,
      packet.length,
      pcmPtr,
      FRAME_SAMPLES,
      1
    );
    logOpusDecodeFailure(nFec, { phase: 'fec', decodeFec: 1, gap: effectiveGap, sourceAddr });
    fecAttempts++;
    if (nFec > 0) {
      copyHeapPcmInto(M, pcmPtr, scratch, frameIdx);
      const frameView = scratch.subarray(
        frameIdx * FRAME_SAMPLES,
        (frameIdx + 1) * FRAME_SAMPLES
      );
      if (fecOutputLooksValid(nFec, frameView)) fecSuccessCoarse++;
      frameIdx++;
    }
  }

  const nCur = M._gcall_opus_decode_float(
    dec,
    dataPtr,
    packet.length,
    pcmPtr,
    FRAME_SAMPLES,
    0
  );
  logOpusDecodeFailure(nCur, { phase: 'normal', decodeFec: 0, gap: effectiveGap, sourceAddr });

  if (nCur > 0) {
    st.consecutiveNormalFailures = 0;
    copyHeapPcmInto(M, pcmPtr, scratch, frameIdx);
    frameIdx++;
    st.fecAllowed = true;
  } else {
    st.consecutiveNormalFailures++;
    if (st.consecutiveNormalFailures >= CONSECUTIVE_NORMAL_FAILS_BEFORE_RESET) {
      console.warn('[GCall] opus-fec wasm: repeated normal decode failures, resetting decoder', {
        sourceAddr: sourceAddr.slice(0, 12),
        consecutiveNormalFailures: st.consecutiveNormalFailures,
      });
      if (!recreateOpusDecoder(M, st)) {
        throw new Error('opus decoder recreate after decode failures failed');
      }
    }
  }

  const totalSamples = frameIdx * FRAME_SAMPLES;
  let pcm: Float32Array;
  if (frameIdx === 0) {
    pcm = new Float32Array(0);
  } else {
    pcm = new Float32Array(totalSamples);
    pcm.set(scratch.subarray(0, totalSamples));
  }

  return { pcm, frameCount: frameIdx, plcFrames, fecAttempts, fecSuccessCoarse };
}

self.onmessage = async (
  e: MessageEvent<
    | { type: 'decode'; requestId: number; sourceAddr: string; packet: ArrayBuffer; gap: number }
    | { type: 'reset'; sourceAddr: string }
    | { type: 'dispose'; sourceAddr: string }
  >
) => {
  const msg = e.data;
  try {
    const M = await loadWasm();

    if (msg.type === 'reset' || msg.type === 'dispose') {
      destroyDecoder(M, msg.sourceAddr);
      return;
    }

    if (msg.type !== 'decode') return;

    const { requestId, sourceAddr, gap } = msg;
    const packet = new Uint8Array(msg.packet);

    if (packet.length === 0 || packet.length > GCALL_AUDIO_MAX_OPUS_LEN) {
      self.postMessage({
        type: 'error',
        requestId,
        sourceAddr,
        message: 'invalid packet size',
      });
      return;
    }

    const st = getOrCreateDecoder(M, sourceAddr);
    if (!st) {
      self.postMessage({
        type: 'error',
        requestId,
        sourceAddr,
        message: 'decoder create failed',
      });
      return;
    }

    const { pcm, frameCount, plcFrames, fecAttempts, fecSuccessCoarse } = decodePacket(
      M,
      st,
      packet,
      gap,
      sourceAddr
    );

    const payload = {
      type: 'decoded' as const,
      requestId,
      sourceAddr,
      pcm,
      frameCount,
      stats: { plcFrames, fecAttempts, fecSuccessCoarse },
    };
    if (frameCount > 0) {
      self.postMessage(payload, { transfer: [pcm.buffer] });
    } else {
      self.postMessage(payload);
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      requestId: (e.data as { requestId?: number }).requestId,
      sourceAddr: (e.data as { sourceAddr?: string }).sourceAddr,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
