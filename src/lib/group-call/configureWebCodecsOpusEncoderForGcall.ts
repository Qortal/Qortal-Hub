/**
 * Configure WebCodecs `AudioEncoder` for Opus the same way as group voice (`useGroupVoiceCall`).
 * Caps bitrate and sets voip-style Opus options so encrypted+JSON wire fits Reticulum MDU
 * (avoids `audio_payload_too_large` from `presence_bridge.make_group_audio_wire`).
 */

import type { GroupCallAudioTuning } from './groupCallAudioProfile';

export async function configureWebCodecsOpusEncoderForGcall(
  encoder: { configure: (config: AudioEncoderConfig) => void },
  tuning: GroupCallAudioTuning,
  opts: {
    sampleRate: number;
    numberOfChannels: number;
    frameDurationMs: number;
  }
): Promise<void> {
  const baseEncoderConfig = {
    codec: 'opus',
    sampleRate: opts.sampleRate,
    numberOfChannels: opts.numberOfChannels,
    bitrate: tuning.opusBitrate,
  };
  const fecEncoderConfig = {
    ...baseEncoderConfig,
    opus: {
      application: 'voip',
      signal: 'voice',
      frameDuration: opts.frameDurationMs * 1000,
      packetlossperc: tuning.opusExpectedPacketLossPercent,
      useinbandfec: true,
      usedtx: false,
    },
  };

  let encoderConfig: Record<string, unknown> = baseEncoderConfig;
  try {
    const AudioEncoderCtor = (globalThis as unknown as { AudioEncoder?: { isConfigSupported?: (c: unknown) => Promise<{ supported: boolean; config?: AudioEncoderConfig }> } }).AudioEncoder;
    const supportResult = await AudioEncoderCtor?.isConfigSupported?.(fecEncoderConfig);
    if (supportResult?.supported) {
      encoderConfig =
        (supportResult.config as Record<string, unknown> | undefined) ??
        (fecEncoderConfig as Record<string, unknown>);
    } else {
      encoderConfig = baseEncoderConfig;
    }
  } catch {
    encoderConfig = baseEncoderConfig;
  }

  encoder.configure(encoderConfig as unknown as AudioEncoderConfig);
}
