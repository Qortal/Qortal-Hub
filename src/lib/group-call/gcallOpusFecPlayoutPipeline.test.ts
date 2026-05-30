import { describe, expect, it, vi } from 'vitest';
import {
  GcallOpusFecPlayoutPipeline,
  type WasmFecDecodeStats,
} from './gcallOpusFecPlayoutPipeline';

describe('GcallOpusFecPlayoutPipeline', () => {
  it('writes decoded PCM batches through the shared sink when provided', () => {
    const sink = vi.fn().mockReturnValue(true);
    const stats = vi.fn();
    const pipeline = new GcallOpusFecPlayoutPipeline(
      () => undefined,
      stats,
      sink
    );
    const pcm = new Float32Array(960 * 3);
    const decodeStats: WasmFecDecodeStats = {
      plcFrames: 0,
      fecAttempts: 1,
      fecSuccessCoarse: 1,
    };

    pipeline.postBatch('Qpeer', pcm, 3, decodeStats, true);

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith('Qpeer', pcm, 3, null);
    expect(stats).toHaveBeenCalledWith(
      'Qpeer',
      expect.objectContaining({
        plcFrames: 0,
        fecAttempts: 1,
        fecSuccessCoarse: 1,
        deferredPcmTick: false,
      })
    );
  });
});
