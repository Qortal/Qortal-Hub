/**
 * Minimal libopus decoder bindings for group-call FEC/PLC (mono, WebCodecs-compatible rates).
 * Built with Emscripten; see build.sh.
 */
#include <opus.h>
#include <emscripten/emscripten.h>

EMSCRIPTEN_KEEPALIVE
void *gcall_opus_decoder_create(int sample_rate, int channels) {
  int err = OPUS_OK;
  OpusDecoder *dec = opus_decoder_create(sample_rate, channels, &err);
  if (err != OPUS_OK || !dec) {
    return NULL;
  }
  return (void *)dec;
}

EMSCRIPTEN_KEEPALIVE
void gcall_opus_decoder_destroy(void *st) {
  if (st) {
    opus_decoder_destroy((OpusDecoder *)st);
  }
}

/** Max samples per channel for one Opus packet at 48 kHz (120 ms). */
#define GCALL_OPUS_MAX_FRAME_SAMPLES 5760

/**
 * Wraps opus_decode_float. Pass len==0 and data ignored for PLC (NULL packet).
 * decode_fec: 0 = normal, 1 = extract FEC for previous frame from this packet.
 */
EMSCRIPTEN_KEEPALIVE
int gcall_opus_decode_float(void *st, const unsigned char *data, int len,
                            float *pcm, int frame_size, int decode_fec) {
  if (!st || !pcm) {
    return OPUS_BAD_ARG;
  }
  if (frame_size <= 0 || frame_size > GCALL_OPUS_MAX_FRAME_SAMPLES) {
    return OPUS_BAD_ARG;
  }
  const unsigned char *payload = (len > 0) ? data : NULL;
  return opus_decode_float((OpusDecoder *)st, payload, len, pcm, frame_size,
                           decode_fec);
}
