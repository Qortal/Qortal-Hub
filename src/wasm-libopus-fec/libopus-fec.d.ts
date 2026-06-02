/** Minimal typings for Emscripten output of native/libopus-fec-wasm/build.sh */
export interface LibopusFecModule {
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPF32: Float32Array;
  HEAPU8: Uint8Array;
  _gcall_opus_decoder_create(sampleRate: number, channels: number): number;
  _gcall_opus_decode_float(
    dec: number,
    dataPtr: number,
    len: number,
    pcmPtr: number,
    frameSize: number,
    decodeFec: number
  ): number;
  _gcall_opus_decoder_destroy(dec: number): void;
}

declare function createLibopusFecModule(
  moduleOverrides?: Record<string, unknown>
): Promise<LibopusFecModule>;

export default createLibopusFecModule;
