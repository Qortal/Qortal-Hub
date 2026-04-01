import crypto from 'crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) =>
      name === 'userData' ? '/tmp/qortal-userdata' : '/tmp/qortal-appdata',
  },
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('electron-is-dev', () => ({
  default: false,
}));

import {
  DEFAULT_RETICULUM_HUBS,
  buildCurrentManagedReticulumConfig,
  buildManagedReticulumConfig,
  computeManagedReticulumConfigFingerprint,
} from './reticulum-daemon';
import type { ReticulumMeshConfigSlice } from './reticulum-mesh-store';

describe('reticulum-daemon managed config', () => {
  it('keeps LAN discovery and includes the default public hubs', () => {
    const config = buildManagedReticulumConfig();

    expect(config).toContain('[[Default Interface]]');
    expect(config).toContain('type = AutoInterface');
    expect(config).toContain('enabled = yes');

    for (const hub of DEFAULT_RETICULUM_HUBS) {
      expect(config).toContain(`[[${hub.name}]]`);
      const wantType =
        hub.interfaceType === 'BackboneInterface' && process.platform === 'linux'
          ? 'BackboneInterface'
          : 'TCPClientInterface';
      const start = config.indexOf(`[[${hub.name}]]`);
      expect(start).toBeGreaterThanOrEqual(0);
      const nextBlock = config.indexOf('[[', start + 3);
      const section =
        nextBlock === -1 ? config.slice(start) : config.slice(start, nextBlock);
      expect(section).toContain(`type = ${wantType}`);
      expect(config).toContain(`target_host = ${hub.host}`);
      expect(config).toContain(`target_port = ${hub.port}`);
    }
  });

  it('can render multiple hubs without changing the generator shape', () => {
    const config = buildManagedReticulumConfig([
      { name: 'Hub One', host: 'one.example', port: 1111 },
      { name: 'Hub Two', host: 'two.example', port: 2222 },
    ]);

    expect(config).toContain('[[Hub One]]');
    expect(config).toContain('target_host = one.example');
    expect(config).toContain('target_port = 1111');
    expect(config).toContain('[[Hub Two]]');
    expect(config).toContain('target_host = two.example');
    expect(config).toContain('target_port = 2222');
  });

  it('includes optional hub mesh listen and mesh TCP clients', () => {
    const meshSlice: ReticulumMeshConfigSlice = {
      listenEnabled: true,
      listenPort: 4243,
      outbound: [
        { sectionName: 'Mesh_deadbeef01', host: 'mesh.example', port: 4243 },
      ],
      meshDiscoveryClient: true,
      autoconnectDiscoveredMax: 8,
      meshPrivateGateway: false,
      networkIdentityPath: '/tmp/qortal-userdata/reticulum/mesh-network.identity',
      enableTransport: true,
      reachableOn: null,
    };
    const config = buildManagedReticulumConfig(DEFAULT_RETICULUM_HUBS, meshSlice);
    expect(config).toContain('enable_transport = True');
    expect(config).toContain('[[Qortal Hub Mesh Listen]]');
    const meshListenType =
      process.platform === 'linux' ? 'BackboneInterface' : 'TCPServerInterface';
    expect(config).toContain(`type = ${meshListenType}`);
    expect(config).toContain('listen_port = 4243');
    expect(config).toContain('discover_interfaces = yes');
    expect(config).toContain('[[Mesh_deadbeef01]]');
    expect(config).toContain('target_host = mesh.example');
    expect(config).toContain('target_port = 4243');
  });

  it('enables transport for private gateway without reachable_on in config', () => {
    const meshSlice: ReticulumMeshConfigSlice = {
      listenEnabled: true,
      listenPort: 4243,
      outbound: [],
      meshDiscoveryClient: true,
      autoconnectDiscoveredMax: 8,
      meshPrivateGateway: true,
      networkIdentityPath: '/tmp/qortal-userdata/reticulum/mesh-network.identity',
      enableTransport: true,
      reachableOn: null,
    };
    const config = buildManagedReticulumConfig(DEFAULT_RETICULUM_HUBS, meshSlice);
    expect(config).toContain('enable_transport = True');
    expect(config).not.toContain('reachable_on =');
    expect(config).toContain('discoverable = yes');
  });

  it('emits reachable_on and enable_transport when private gateway slice includes reachableOn', () => {
    const meshSlice: ReticulumMeshConfigSlice = {
      listenEnabled: true,
      listenPort: 4243,
      outbound: [],
      meshDiscoveryClient: true,
      autoconnectDiscoveredMax: 8,
      meshPrivateGateway: true,
      networkIdentityPath: '/tmp/qortal-userdata/reticulum/mesh-network.identity',
      enableTransport: true,
      reachableOn: '203.0.113.7',
    };
    const config = buildManagedReticulumConfig(DEFAULT_RETICULUM_HUBS, meshSlice);
    expect(config).toContain('enable_transport = True');
    expect(config).toContain('reachable_on = 203.0.113.7');
    const meshListenType =
      process.platform === 'linux' ? 'BackboneInterface' : 'TCPServerInterface';
    expect(config).toContain(`type = ${meshListenType}`);
  });

  it('computeManagedReticulumConfigFingerprint matches sha256 of buildCurrentManagedReticulumConfig', () => {
    const body = buildCurrentManagedReticulumConfig();
    const fp = computeManagedReticulumConfigFingerprint();
    const expected = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
    expect(fp).toBe(expected);
  });
});
