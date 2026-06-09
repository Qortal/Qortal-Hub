import fs from 'fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) =>
      name === 'userData' ? '/tmp/qortal-userdata' : '/tmp/qortal-appdata',
  },
}));

import {
  getMeshNetworkIdentityPath,
  getMeshNetworkPassphrasePath,
  getReticulumMeshStatePath,
  isPlausibleReachableOnHost,
  meshConfigSliceFromState,
  resolveMeshReachableOnHost,
  sortMeshOutboundHostsForEmission,
  type ReticulumMeshState,
} from './reticulum-mesh-store';

function baseState(overrides: Partial<ReticulumMeshState> = {}): ReticulumMeshState {
  return {
    version: 2,
    listenPort: 4243,
    meshListenEnabled: true,
    meshUpnpEnabled: true,
    reachableSelf: false,
    inboundObservedOnMeshPort: false,
    externalProbeSucceeded: false,
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
  it('uses canonical qortal-hub storage paths shared by local app instances', () => {
    expect(getReticulumMeshStatePath()).toBe(
      '/tmp/qortal-appdata/qortal-hub/reticulum-mesh-state.json'
    );
    expect(getMeshNetworkIdentityPath()).toBe(
      '/tmp/qortal-appdata/qortal-hub/reticulum/mesh-network.identity'
    );
    expect(getMeshNetworkPassphrasePath()).toBe(
      '/tmp/qortal-appdata/qortal-hub/reticulum/mesh-network.passphrase'
    );
  });

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
    expect(sliceA.outbound).toEqual(sliceB.outbound);
    expect(sliceA.outbound.map((o) => `${o.host}:${o.port}`)).toEqual([
      'a.test:4242',
      'z.test:4243',
    ]);
  });

  it('empty selected hosts yields empty outbound', () => {
    const state = baseState();
    const s = meshConfigSliceFromState(state, []);
    expect(s.outbound).toEqual([]);
  });

  it('keeps remote discovery on when mesh listen is disabled', () => {
    const state = baseState({ meshListenEnabled: false });
    const s = meshConfigSliceFromState(state, []);
    expect(s.meshDiscoveryClient).toBe(true);
    expect(s.autoconnectDiscoveredMax).toBe(8);
  });

  it('enables transport when mesh listen on (private gateway, reachable unknown)', () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      return s.endsWith('mesh-network.identity') || s.endsWith('mesh-network.passphrase');
    });
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      if (s.endsWith('mesh-network.passphrase')) {
        return 'qortal-hub-community-mesh-v1\n' as unknown as ReturnType<typeof fs.readFileSync>;
      }
      throw new Error(`Unexpected readFileSync path: ${s}`);
    });
    try {
      const state = baseState({ meshListenEnabled: true });
      const s = meshConfigSliceFromState(state, []);
      expect(s.meshPrivateGateway).toBe(true);
      expect(s.networkPassphrase).toBe('qortal-hub-community-mesh-v1');
      expect(s.reachableOn).toBeNull();
      expect(s.enableTransport).toBe(true);
    } finally {
      readSpy.mockRestore();
      existsSpy.mockRestore();
    }
  });

  it('enables transport when mesh listen on without gateway identity (plain mesh listen)', () => {
    const spy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    try {
      const state = baseState({ meshListenEnabled: true });
      const s = meshConfigSliceFromState(state, []);
      expect(s.meshPrivateGateway).toBe(false);
      expect(s.enableTransport).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps plain mesh listen when passphrase is missing', () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      return s.endsWith('mesh-network.identity');
    });
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('mesh passphrase missing');
    });
    try {
      const state = baseState({ meshListenEnabled: true });
      const s = meshConfigSliceFromState(state, []);
      expect(s.meshPrivateGateway).toBe(false);
      expect(s.networkPassphrase).toBeNull();
      expect(s.enableTransport).toBe(true);
    } finally {
      readSpy.mockRestore();
      existsSpy.mockRestore();
    }
  });

  it('disables transport when mesh listen is off', () => {
    const state = baseState({ meshListenEnabled: false });
    const s = meshConfigSliceFromState(state, []);
    expect(s.enableTransport).toBe(false);
  });
});

describe('resolveMeshReachableOnHost', () => {
  it('prefers manual host over discovery', () => {
    const state = baseState({
      meshReachableOnHost: 'mesh.example.org',
      discoveryReachableHost: '203.0.113.1',
    });
    expect(resolveMeshReachableOnHost(state)).toBe('mesh.example.org');
  });

  it('falls back to discovery when manual unset', () => {
    const state = baseState({ discoveryReachableHost: '198.51.100.2' });
    expect(resolveMeshReachableOnHost(state)).toBe('198.51.100.2');
  });
});

describe('isPlausibleReachableOnHost', () => {
  it('accepts valid IPv4 and hostnames', () => {
    expect(isPlausibleReachableOnHost('203.0.113.1')).toBe(true);
    expect(isPlausibleReachableOnHost('mesh.example.net')).toBe(true);
  });

  it('rejects invalid values', () => {
    expect(isPlausibleReachableOnHost('999.1.1.1')).toBe(false);
    expect(isPlausibleReachableOnHost('no-dot')).toBe(false);
    expect(isPlausibleReachableOnHost('')).toBe(false);
  });
});
