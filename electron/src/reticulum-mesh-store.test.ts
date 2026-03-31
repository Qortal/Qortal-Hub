import { describe, expect, it } from 'vitest';
import {
  meshConfigSliceFromState,
  sortMeshOutboundHostsForEmission,
  type ReticulumMeshState,
} from './reticulum-mesh-store';

function baseState(overrides: Partial<ReticulumMeshState> = {}): ReticulumMeshState {
  return {
    version: 1,
    listenPort: 4243,
    meshListenEnabled: true,
    meshUpnpEnabled: true,
    reachableSelf: false,
    inboundObservedOnMeshPort: false,
    externalProbeSucceeded: false,
    peers: [],
    ...overrides,
  };
}

describe('sortMeshOutboundHostsForEmission', () => {
  it('orders by host case-insensitive then port', () => {
    const out = sortMeshOutboundHostsForEmission([
      { host: 'b.example', port: 2 },
      { host: 'a.example', port: 2 },
      { host: 'a.example', port: 1 },
    ]);
    expect(out.map((p) => `${p.host}:${p.port}`)).toEqual([
      'a.example:1',
      'a.example:2',
      'b.example:2',
    ]);
  });
});

describe('meshConfigSliceFromState', () => {
  it('produces identical slice when selected hosts are in different order', () => {
    const state = baseState();
    const selectedA = [
      { host: 'z.test', port: 4243 },
      { host: 'a.test', port: 4242 },
    ];
    const selectedB = [
      { host: 'a.test', port: 4242 },
      { host: 'z.test', port: 4243 },
    ];
    const sliceA = meshConfigSliceFromState(state, selectedA);
    const sliceB = meshConfigSliceFromState(state, selectedB);
    expect(sliceA).toEqual(sliceB);
    expect(sliceA.outbound.map((o) => `${o.host}:${o.port}`)).toEqual([
      'a.test:4242',
      'z.test:4243',
    ]);
  });

  it('differs when peer set differs', () => {
    const state = baseState();
    const s1 = meshConfigSliceFromState(state, [{ host: 'a.test', port: 1 }]);
    const s2 = meshConfigSliceFromState(state, [{ host: 'b.test', port: 1 }]);
    expect(s1.outbound[0]?.host).toBe('a.test');
    expect(s2.outbound[0]?.host).toBe('b.test');
  });
});
