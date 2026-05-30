import { describe, expect, it } from 'vitest';
import {
  buildRootInboundWarmDedupeKeys,
  clearRootInboundWarmDedupeForPeer,
} from './rootInboundWarmDedupe';

describe('rootInboundWarmDedupe', () => {
  it('builds stable warm and stress keys for join generation + address', () => {
    const addr = 'QeJW96BDMFkm';
    expect(buildRootInboundWarmDedupeKeys(0, addr)).toEqual({
      warmKey: `0:${addr}`,
      stressKey: `0:stress:${addr}`,
    });
    expect(buildRootInboundWarmDedupeKeys(3, addr)).toEqual({
      warmKey: `3:${addr}`,
      stressKey: `3:stress:${addr}`,
    });
  });

  it('clearRootInboundWarmDedupeForPeer removes entries so rejoin can warm again', () => {
    const addr = 'QP9Jj4PeerAddr';
    const jg = 1;
    const warm = new Set<string>();
    const stress = new Set<string>();
    const { warmKey, stressKey } = buildRootInboundWarmDedupeKeys(jg, addr);
    warm.add(warmKey);
    stress.add(stressKey);
    expect(warm.has(warmKey)).toBe(true);
    expect(stress.has(stressKey)).toBe(true);

    clearRootInboundWarmDedupeForPeer(jg, addr, warm, stress);
    expect(warm.has(warmKey)).toBe(false);
    expect(stress.has(stressKey)).toBe(false);
  });
});
