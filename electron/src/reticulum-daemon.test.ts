import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  getReticulumDaemonStatus,
  getReticulumBridgeIdentityPath,
  getReticulumConfigDir,
  getReticulumAppInstanceRegistryPath,
  getReticulumSharedDaemonStatePath,
  getReticulumSharedRpcKeyPath,
  isReticulumSharedDaemonOwnedByAnotherLiveInstance,
  planReticulumAppQuit,
  recoverReticulumStateForAppLaunch,
  registerReticulumAppInstance,
  resolveReticulumDaemonStartupAction,
  setReticulumInstanceIndex,
  stopSharedReticulumDaemon,
  writeManagedReticulumConfigIfManaged,
} from './reticulum-daemon';
import type { ReticulumMeshConfigSlice } from './reticulum-mesh-store';

function sectionBody(config: string, header: string): string {
  const start = config.indexOf(header);
  expect(start).toBeGreaterThanOrEqual(0);
  const nextBlock = config.indexOf('[[', start + header.length);
  return nextBlock === -1 ? config.slice(start) : config.slice(start, nextBlock);
}

function getTestAppSettingsPath(): string {
  return '/tmp/qortal-appdata/qortal-hub/app-settings.json';
}

function getTestReticulumConfigPath(): string {
  return path.join(getReticulumConfigDir(), 'config');
}

describe('reticulum-daemon managed config', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setReticulumInstanceIndex(0);
    delete process.env.QORTAL_RETICULUM_SYSTEM;
    for (const filePath of [
      getReticulumAppInstanceRegistryPath(),
      getReticulumSharedDaemonStatePath(),
      getReticulumSharedRpcKeyPath(),
      getTestAppSettingsPath(),
      getTestReticulumConfigPath(),
    ]) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        /* ignore */
      }
    }
    try {
      fs.rmdirSync(path.dirname(getReticulumAppInstanceRegistryPath()));
    } catch {
      /* ignore */
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setReticulumInstanceIndex(0);
    delete process.env.QORTAL_RETICULUM_SYSTEM;
    for (const filePath of [
      getReticulumAppInstanceRegistryPath(),
      getReticulumSharedDaemonStatePath(),
      getReticulumSharedRpcKeyPath(),
      getTestAppSettingsPath(),
      getTestReticulumConfigPath(),
    ]) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        /* ignore */
      }
    }
    try {
      fs.rmdirSync(path.dirname(getReticulumAppInstanceRegistryPath()));
    } catch {
      /* ignore */
    }
  });

  it('uses the canonical qortal-hub Reticulum config directory', () => {
    expect(getReticulumConfigDir()).toBe(
      '/tmp/qortal-appdata/qortal-hub/reticulum'
    );
  });

  it('keeps the presence bridge identity under per-instance userData', () => {
    expect(getReticulumBridgeIdentityPath()).toBe(
      '/tmp/qortal-userdata/reticulum/presence-bridge.identity'
    );
  });

  it('enables remote interface discovery without AutoInterface LAN discovery and includes the default public hubs', () => {
    const config = buildManagedReticulumConfig();

    expect(config).not.toContain('[[Default Interface]]');
    expect(config).not.toContain('type = AutoInterface');
    expect(config).toContain('discover_interfaces = Yes');
    expect(config).toContain('autoconnect_discovered_interfaces = 8');
    expect(config).toMatch(/\nrpc_key = [0-9a-f]{64}\n/);

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

  it('uses one persisted RPC key for every managed config render', () => {
    const first = buildManagedReticulumConfig();
    const second = buildManagedReticulumConfig();
    const keyPath = getReticulumSharedRpcKeyPath();
    const keyOnDisk = fs.readFileSync(keyPath, 'utf8').trim();

    expect(keyOnDisk).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toContain(`rpc_key = ${keyOnDisk}`);
    expect(second).toContain(`rpc_key = ${keyOnDisk}`);
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
      meshDiscoveryClient: false,
      autoconnectDiscoveredMax: 0,
      meshPrivateGateway: false,
      networkIdentityPath:
        '/tmp/qortal-appdata/qortal-hub/reticulum/mesh-network.identity',
      networkPassphrase: null,
      enableTransport: true,
      reachableOn: null,
    };
    const config = buildManagedReticulumConfig(DEFAULT_RETICULUM_HUBS, meshSlice);
    expect(config).toContain('enable_transport = True');
    const reticulumBlock = config.slice(
      config.indexOf('[reticulum]'),
      config.indexOf('[logging]')
    );
    expect(reticulumBlock).toContain('discover_interfaces = Yes');
    expect(reticulumBlock).toContain('autoconnect_discovered_interfaces = 8');
    expect(config).toContain('[[Qortal Hub Mesh Listen]]');
    const meshListenType =
      process.platform === 'linux' ? 'BackboneInterface' : 'TCPServerInterface';
    const meshListenSection = sectionBody(config, '[[Qortal Hub Mesh Listen]]');
    expect(meshListenSection).toContain(`type = ${meshListenType}`);
    if (process.platform === 'linux') {
      expect(meshListenSection).toContain('listen_on = 0.0.0.0');
      expect(meshListenSection).toContain('port = 4243');
      expect(meshListenSection).not.toContain('listen_port =');
    } else {
      expect(meshListenSection).toContain('listen_ip = 0.0.0.0');
      expect(meshListenSection).toContain('listen_port = 4243');
    }
    expect(meshListenSection).not.toContain('announce_interval =');
    expect(meshListenSection).not.toContain('network_name =');
    expect(config).not.toContain('[[Default Interface]]');
    expect(config).not.toContain('type = AutoInterface');
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
      meshDiscoveryClient: false,
      autoconnectDiscoveredMax: 0,
      meshPrivateGateway: true,
      networkIdentityPath:
        '/tmp/qortal-appdata/qortal-hub/reticulum/mesh-network.identity',
      networkPassphrase: 'qortal-hub-community-mesh-v1',
      enableTransport: true,
      reachableOn: null,
    };
    try {
      const config = buildManagedReticulumConfig(DEFAULT_RETICULUM_HUBS, meshSlice);
      expect(config).toContain('enable_transport = True');
      expect(config).toContain(
        'network_identity = /tmp/qortal-appdata/qortal-hub/reticulum/mesh-network.identity'
      );
      expect(config).not.toContain('reachable_on =');
      expect(config).not.toContain('[[Qortal Hub Mesh Listen]]');
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
      meshDiscoveryClient: false,
      autoconnectDiscoveredMax: 0,
      meshPrivateGateway: true,
      networkIdentityPath:
        '/tmp/qortal-appdata/qortal-hub/reticulum/mesh-network.identity',
      networkPassphrase: 'qortal-hub-community-mesh-v1',
      enableTransport: true,
      reachableOn: '203.0.113.7',
    };
    try {
      const config = buildManagedReticulumConfig(DEFAULT_RETICULUM_HUBS, meshSlice);
      expect(config).toContain('enable_transport = True');
      expect(config).toContain(
        'network_identity = /tmp/qortal-appdata/qortal-hub/reticulum/mesh-network.identity'
      );
      expect(config).toContain('discovery_name = Qortal Hub Mesh Listen');
      expect(config).toContain('network_name = qortal-hub');
      expect(config).toContain('passphrase = qortal-hub-community-mesh-v1');
      expect(config).toContain('reachable_on = 203.0.113.7');
      expect(config).toContain('announce_interval = 5');
      expect(config).toContain('publish_ifac = yes');
      const privateGatewayListenType =
        process.platform === 'linux' ? 'BackboneInterface' : 'TCPServerInterface';
      expect(config).toContain(`type = ${privateGatewayListenType}`);
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

  it('does not write managed config when disabled in app settings', () => {
    const settingsPath = getTestAppSettingsPath();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ reticulumManagedConfigEnabled: false }),
      'utf8'
    );

    const wrote = writeManagedReticulumConfigIfManaged(
      `${buildManagedReticulumConfig()}\n`
    );

    expect(wrote).toBe(false);
    expect(fs.existsSync(getTestReticulumConfigPath())).toBe(false);
  });

  it('keeps the shared daemon running while other app instances remain active', () => {
    const alivePids = new Set([101, 202]);
    const killSpy = vi
      .spyOn(process, 'kill')
      .mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
        if (signal === 0 || typeof signal === 'undefined') {
          if (alivePids.has(pid)) {
            return true;
          }
          const err = new Error('ESRCH') as Error & { code?: string };
          err.code = 'ESRCH';
          throw err;
        }
        return true;
      }) as typeof process.kill);

    registerReticulumAppInstance(0, 101);
    registerReticulumAppInstance(1, 202);

    const firstQuit = planReticulumAppQuit(101);

    expect(firstQuit).toEqual({
      otherActiveInstances: 1,
      remainingActiveInstances: 1,
      shouldStopSharedDaemon: false,
    });

    const secondQuit = planReticulumAppQuit(202);

    expect(secondQuit).toEqual({
      otherActiveInstances: 0,
      remainingActiveInstances: 0,
      shouldStopSharedDaemon: true,
    });
    expect(killSpy).toHaveBeenCalledWith(101, 0);
    expect(killSpy).toHaveBeenCalledWith(202, 0);
  });

  it('lets the last surviving secondary instance stop the shared daemon from pid metadata', () => {
    const killSpy = vi
      .spyOn(process, 'kill')
      .mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
        if (pid !== 999) {
          const err = new Error('ESRCH') as Error & { code?: string };
          err.code = 'ESRCH';
          throw err;
        }
        if (signal === 0 || signal === 'SIGTERM') {
          return true;
        }
        return true;
      }) as typeof process.kill);

    fs.mkdirSync(path.dirname(getReticulumSharedDaemonStatePath()), {
      recursive: true,
    });
    fs.writeFileSync(
      getReticulumSharedDaemonStatePath(),
      JSON.stringify({
        pid: 999,
        ownerAppPid: 101,
        ownerInstanceIndex: 0,
        startedAt: Date.now(),
        configDir: '/tmp/qortal-appdata/qortal-hub/reticulum',
        mode: 'system',
      }),
      'utf8'
    );

    stopSharedReticulumDaemon();

    expect(killSpy).toHaveBeenNthCalledWith(1, 999, 0);
    expect(killSpy).toHaveBeenNthCalledWith(2, 999, 'SIGTERM');
    expect(fs.existsSync(getReticulumSharedDaemonStatePath())).toBe(false);
  });

  it('recovers an orphaned shared daemon on a fresh primary-instance launch', () => {
    const killSpy = vi
      .spyOn(process, 'kill')
      .mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
        if (pid !== 999) {
          const err = new Error('ESRCH') as Error & { code?: string };
          err.code = 'ESRCH';
          throw err;
        }
        if (signal === 0 || signal === 'SIGTERM') {
          return true;
        }
        return true;
      }) as typeof process.kill);

    fs.mkdirSync(path.dirname(getReticulumSharedDaemonStatePath()), {
      recursive: true,
    });
    fs.writeFileSync(
      getReticulumSharedDaemonStatePath(),
      JSON.stringify({
        pid: 999,
        ownerAppPid: 101,
        ownerInstanceIndex: 0,
        startedAt: Date.now(),
        configDir: '/tmp/qortal-appdata/qortal-hub/reticulum',
        mode: 'system',
      }),
      'utf8'
    );

    const recovery = recoverReticulumStateForAppLaunch(0);

    expect(recovery).toEqual({
      activeInstances: 0,
      orphanedDaemonFound: true,
      orphanedDaemonStopped: true,
      daemonStateCleared: true,
    });
    expect(killSpy).toHaveBeenNthCalledWith(1, 999, 0);
    expect(killSpy).toHaveBeenNthCalledWith(2, 999, 'SIGTERM');
    expect(fs.existsSync(getReticulumSharedDaemonStatePath())).toBe(false);
  });

  it('clears stale daemon metadata without signaling when the saved pid is already dead', () => {
    const killSpy = vi
      .spyOn(process, 'kill')
      .mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
        const err = new Error('ESRCH') as Error & { code?: string };
        err.code = 'ESRCH';
        throw err;
      }) as typeof process.kill);

    fs.mkdirSync(path.dirname(getReticulumSharedDaemonStatePath()), {
      recursive: true,
    });
    fs.writeFileSync(
      getReticulumSharedDaemonStatePath(),
      JSON.stringify({
        pid: 999,
        ownerAppPid: 101,
        ownerInstanceIndex: 0,
        startedAt: Date.now(),
        configDir: '/tmp/qortal-appdata/qortal-hub/reticulum',
        mode: 'system',
      }),
      'utf8'
    );

    const recovery = recoverReticulumStateForAppLaunch(0);

    expect(recovery).toEqual({
      activeInstances: 0,
      orphanedDaemonFound: false,
      orphanedDaemonStopped: false,
      daemonStateCleared: true,
    });
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(999, 0);
    expect(fs.existsSync(getReticulumSharedDaemonStatePath())).toBe(false);
  });

  it('reports the shared daemon as running for secondary instances without a local child', () => {
    const killSpy = vi
      .spyOn(process, 'kill')
      .mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
        if (pid === 999 && signal === 0) {
          return true;
        }
        const err = new Error('ESRCH') as Error & { code?: string };
        err.code = 'ESRCH';
        throw err;
      }) as typeof process.kill);

    fs.mkdirSync(path.dirname(getReticulumSharedDaemonStatePath()), {
      recursive: true,
    });
    fs.writeFileSync(
      getReticulumSharedDaemonStatePath(),
      JSON.stringify({
        pid: 999,
        ownerAppPid: 101,
        ownerInstanceIndex: 0,
        startedAt: Date.now(),
        configDir: '/tmp/qortal-appdata/qortal-hub/reticulum',
        mode: 'system',
      }),
      'utf8'
    );

    expect(getReticulumDaemonStatus()).toEqual({
      running: true,
      pid: 999,
      mode: 'system',
      configDir: '/tmp/qortal-appdata/qortal-hub/reticulum',
      reachability: 'unknown',
    });
    expect(killSpy).toHaveBeenCalledWith(999, 0);
  });

  it('detects a shared daemon owned by another live app instance', () => {
    const alivePids = new Set([101, 999]);
    vi.spyOn(process, 'kill').mockImplementation(
      ((pid: number, signal?: number | NodeJS.Signals) => {
        if (signal === 0 || typeof signal === 'undefined') {
          if (alivePids.has(pid)) return true;
          const err = new Error('ESRCH') as Error & { code?: string };
          err.code = 'ESRCH';
          throw err;
        }
        return true;
      }) as typeof process.kill
    );

    registerReticulumAppInstance(0, 101);
    fs.mkdirSync(path.dirname(getReticulumSharedDaemonStatePath()), {
      recursive: true,
    });
    fs.writeFileSync(
      getReticulumSharedDaemonStatePath(),
      JSON.stringify({
        pid: 999,
        ownerAppPid: 101,
        ownerInstanceIndex: 0,
        startedAt: Date.now(),
        configDir: '/tmp/qortal-appdata/qortal-hub/reticulum',
        mode: 'system',
      }),
      'utf8'
    );

    expect(isReticulumSharedDaemonOwnedByAnotherLiveInstance()).toBe(true);
  });

  it('does not treat dead owner metadata as another live daemon owner', () => {
    const alivePids = new Set([202, 999]);
    vi.spyOn(process, 'kill').mockImplementation(
      ((pid: number, signal?: number | NodeJS.Signals) => {
        if (signal === 0 || typeof signal === 'undefined') {
          if (alivePids.has(pid)) return true;
          const err = new Error('ESRCH') as Error & { code?: string };
          err.code = 'ESRCH';
          throw err;
        }
        return true;
      }) as typeof process.kill
    );

    registerReticulumAppInstance(1, 202);
    fs.mkdirSync(path.dirname(getReticulumSharedDaemonStatePath()), {
      recursive: true,
    });
    fs.writeFileSync(
      getReticulumSharedDaemonStatePath(),
      JSON.stringify({
        pid: 999,
        ownerAppPid: 101,
        ownerInstanceIndex: 0,
        startedAt: Date.now(),
        configDir: '/tmp/qortal-appdata/qortal-hub/reticulum',
        mode: 'system',
      }),
      'utf8'
    );

    expect(isReticulumSharedDaemonOwnedByAnotherLiveInstance()).toBe(false);
  });

  it('lets a secondary instance take daemon ownership when no shared daemon is alive', () => {
    setReticulumInstanceIndex(1);

    expect(resolveReticulumDaemonStartupAction()).toBe('spawn');
  });
});
