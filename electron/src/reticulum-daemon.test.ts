import crypto from 'crypto';
import fs from 'fs';
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

function sectionBody(config: string, header: string): string {
  const start = config.indexOf(header);
  expect(start).toBeGreaterThanOrEqual(0);
  const nextBlock = config.indexOf('[[', start + header.length);
  return nextBlock === -1 ? config.slice(start) : config.slice(start, nextBlock);
}

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
      const wantHostKey =
        wantType === 'BackboneInterface' ? 'remote' : 'target_host';
      const start = config.indexOf(`[[${hub.name}]]`);
      expect(start).toBeGreaterThanOrEqual(0);
      const nextBlock = config.indexOf('[[', start + 3);
      const section =
        nextBlock === -1 ? config.slice(start) : config.slice(start, nextBlock);
      expect(section).toContain(`type = ${wantType}`);
      expect(section).toContain(`${wantHostKey} = ${hub.host}`);
      expect(config).toContain(`target_port = ${hub.port}`);
      if (hub.networkName) {
        expect(section).toContain(`network_name = ${hub.networkName}`);
      }
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

  it('uses remote for Backbone hubs on Linux', () => {
    const config = buildManagedReticulumConfig([
      {
        name: 'Backbone Hub',
        host: 'backbone.example',
        port: 4242,
        interfaceType: 'BackboneInterface',
      },
    ]);
    const section = sectionBody(config, '[[Backbone Hub]]');
    if (process.platform === 'linux') {
      expect(section).toContain('type = BackboneInterface');
      expect(section).toContain('remote = backbone.example');
      expect(section).not.toContain('target_host = backbone.example');
    } else {
      expect(section).toContain('type = TCPClientInterface');
      expect(section).toContain('target_host = backbone.example');
    }
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
    const reticulumBlock = config.slice(
      config.indexOf('[reticulum]'),
      config.indexOf('[logging]')
    );
    expect(reticulumBlock).toContain('discover_interfaces = yes');
    expect(reticulumBlock).toContain('autoconnect_discovered_interfaces = 8');
    expect(config).toContain('[[Qortal Hub Mesh Listen]]');
    const meshListenSection = sectionBody(config, '[[Qortal Hub Mesh Listen]]');
    expect(meshListenSection).toContain('type = TCPServerInterface');
    expect(meshListenSection).toContain('listen_ip = 0.0.0.0');
    expect(meshListenSection).toContain('listen_port = 4243');
    expect(meshListenSection).not.toContain('announce_interval =');
    if (process.platform === 'linux') {
      const backboneSection = sectionBody(config, '[[Qortal Hub Mesh Backbone Listen]]');
      expect(backboneSection).toContain('type = BackboneInterface');
      expect(backboneSection).toContain('listen_on = 0.0.0.0');
      expect(backboneSection).toContain('port = 4244');
    } else {
      expect(config).not.toContain('[[Qortal Hub Mesh Backbone Listen]]');
    }
    const autoInterfaceSection = sectionBody(config, '[[Default Interface]]');
    expect(autoInterfaceSection).not.toContain('discover_interfaces = yes');
    expect(config).toContain('[[Mesh_deadbeef01]]');
    expect(config).toContain('target_host = mesh.example');
    expect(config).toContain('target_port = 4243');
  });

  it('omits mesh listen when private gateway has no reachable_on', () => {
    const spy = vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('mesh-network.identity');
    });
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
    try {
      const config = buildManagedReticulumConfig(DEFAULT_RETICULUM_HUBS, meshSlice);
      expect(config).toContain('enable_transport = True');
      expect(config).toContain(
        'network_identity = /tmp/qortal-userdata/reticulum/mesh-network.identity'
      );
      expect(config).not.toContain('reachable_on =');
      expect(config).not.toContain('[[Qortal Hub Mesh Listen]]');
      if (process.platform === 'linux') {
        expect(config).toContain('[[Qortal Hub Mesh Backbone Listen]]');
      }
      expect(config).not.toContain('discoverable = yes');
      expect(config).not.toContain('discovery_name = Qortal Hub Mesh Listen');
      expect(config).not.toContain('announce_interval = 5');
    } finally {
      spy.mockRestore();
    }
  });

  it('emits reachable_on and enable_transport when private gateway slice includes reachableOn', () => {
    const spy = vi.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('mesh-network.identity');
    });
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
    try {
      const config = buildManagedReticulumConfig(DEFAULT_RETICULUM_HUBS, meshSlice);
      expect(config).toContain('enable_transport = True');
      expect(config).toContain(
        'network_identity = /tmp/qortal-userdata/reticulum/mesh-network.identity'
      );
      expect(config).toContain('type = TCPServerInterface');
      expect(config).toContain('discovery_name = Qortal Hub Mesh Listen');
      expect(config).toContain('reachable_on = 203.0.113.7');
      expect(config).toContain('announce_interval = 5');
      if (process.platform === 'linux') {
        expect(config).toContain('[[Qortal Hub Mesh Backbone Listen]]');
        expect(config).toContain('port = 4244');
      }
    } finally {
      spy.mockRestore();
    }
  });

  it('computeManagedReticulumConfigFingerprint matches sha256 of buildCurrentManagedReticulumConfig', () => {
    const body = buildCurrentManagedReticulumConfig();
    const fp = computeManagedReticulumConfigFingerprint();
    const expected = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
    expect(fp).toBe(expected);
  });
});
