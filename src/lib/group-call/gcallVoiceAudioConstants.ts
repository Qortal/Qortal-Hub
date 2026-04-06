/**
 * Canonical Opus / PCM frame geometry for group and DM Reticulum voice (single source of truth).
 */

export const OPUS_SAMPLE_RATE = 48_000;
export const OPUS_CHANNELS = 1;
export const OPUS_FRAME_DURATION_MS = 20;
export const OPUS_FRAME_SAMPLES =
  (OPUS_SAMPLE_RATE * OPUS_FRAME_DURATION_MS) / 1000;
