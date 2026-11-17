/**
 * Configure WebCodecs `AudioDecoder` for inbound Opus — mirrors encoder expectations from
 * {@link getGroupCallAudioTuning} (`packetlossperc`) so PLC matches uplink FEC hints.
 * Falls back to minimal config if `opus` extensions are unsupported.
 */

import type { GroupCallAudioTuning } from './groupCallAudioProfile';

export async function configureWebCodecsOpusDecoderForGcall(
  decoder: { configure: (config: AudioDecoderConfig) => void },
  tuning: GroupCallAudioTuning,
  opts: { sampleRate: number; numberOfChannels: number }
): Promise<void> {
  const baseConfig = {
    codec: 'opus',
    sampleRate: opts.sampleRate,
    numberOfChannels: opts.numberOfChannels,
  };
  const plcConfig = {
    ...baseConfig,
    opus: {
      packetlossperc: tuning.opusExpectedPacketLossPercent,
    },
  };

  try {
    const AudioDecoderCtor = (
      globalThis as unknown as {
        AudioDecoder?: {
          isConfigSupported?: (
            c: unknown
          ) => Promise<{ supported: boolean; config?: AudioDecoderConfig }>;
        };
      }
    ).AudioDecoder;
    const supportResult = await AudioDecoderCtor?.isConfigSupported?.(plcConfig);
    if (supportResult?.supported) {
      decoder.configure(
        (supportResult.config ?? plcConfig) as unknown as AudioDecoderConfig
      );
      return;
    }
  } catch {
    /* use base */
  }

  decoder.configure(baseConfig as unknown as AudioDecoderConfig);
}
