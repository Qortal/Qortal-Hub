/**
 * Reticulum mesh coordinator: UPnP for mesh listen; no hub-mesh wire.
 */
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

vi.mock('./logger', () => ({
  debug: vi.fn(),
  log: vi.fn(),
}));

vi.mock('./setup', () => ({
  readAppSettings: vi.fn(async () => ({ reticulumMeshUpnpEnabled: false })),
}));

vi.mock('./reticulum-daemon', () => ({
  getReticulumInstanceIndex: vi.fn(() => 0),
  buildCurrentManagedReticulumConfig: vi.fn(() => ''),
  ensureMeshNetworkIdentityIfNeeded: vi.fn(() => ({ ok: true, created: false })),
  ensureMeshNetworkPassphraseIfNeeded: vi.fn(() => ({ ok: true, created: false })),
  getReticulumDaemonStatus: vi.fn(() => ({ running: false })),
  restartBundledReticulumDaemonAndWaitReady: vi.fn(async () => {}),
  startBundledReticulumDaemon: vi.fn(),
  stopBundledReticulumDaemon: vi.fn(),
  writeManagedReticulumConfigIfManaged: vi.fn(() => false),
}));

vi.mock('./reticulum-bridge-rebind', () => ({
  rebindReticulumBridgeConsumers: vi.fn(),
}));

vi.mock('./reticulum-bridge', () => ({
  startReticulumBridge: vi.fn(async () => {}),
  stopReticulumBridge: vi.fn(),
}));

vi.mock('./upnp-nat', () => ({
  createNatApiClient: vi.fn(),
  destroyNatClient: vi.fn(),
  mapTcpPort: vi.fn(async () => false),
  unmapTcpPort: vi.fn(async () => {}),
}));

import {
  applyManagedMeshConfigAfterReachableUpdate,
  startReticulumMeshCoordinator,
  stopReticulumMeshCoordinator,
} from './reticulum-mesh';
import {
  buildCurrentManagedReticulumConfig,
  getReticulumDaemonStatus,
  restartBundledReticulumDaemonAndWaitReady,
  writeManagedReticulumConfigIfManaged,
} from './reticulum-daemon';
import { rebindReticulumBridgeConsumers } from './reticulum-bridge-rebind';
import { startReticulumBridge, stopReticulumBridge } from './reticulum-bridge';

describe('ReticulumMeshCoordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopReticulumMeshCoordinator();
  });

  it('start/stop without throwing', () => {
    const bridge = { getState: () => 'ready' as const };
    expect(() => startReticulumMeshCoordinator(bridge as never)).not.toThrow();
    expect(() => stopReticulumMeshCoordinator()).not.toThrow();
  });

  it('waits for daemon readiness before restarting the bridge after mesh config changes', async () => {
    vi.mocked(buildCurrentManagedReticulumConfig).mockReturnValue('next-config');
    vi.mocked(writeManagedReticulumConfigIfManaged).mockReturnValue(true);
    vi.mocked(getReticulumDaemonStatus).mockReturnValue({ running: true } as any);

    await applyManagedMeshConfigAfterReachableUpdate();

    expect(stopReticulumBridge).toHaveBeenCalledTimes(1);
    expect(restartBundledReticulumDaemonAndWaitReady).toHaveBeenCalledTimes(1);
    expect(startReticulumBridge).toHaveBeenCalledTimes(1);
    expect(rebindReticulumBridgeConsumers).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(restartBundledReticulumDaemonAndWaitReady).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(startReticulumBridge).mock.invocationCallOrder[0]!);
  });

  it('does not restart the bridge if the awaited daemon restart fails', async () => {
    vi.mocked(buildCurrentManagedReticulumConfig).mockReturnValue('next-config');
    vi.mocked(writeManagedReticulumConfigIfManaged).mockReturnValue(true);
    vi.mocked(getReticulumDaemonStatus).mockReturnValue({ running: true } as any);
    vi.mocked(restartBundledReticulumDaemonAndWaitReady).mockRejectedValueOnce(
      new Error('shared instance timeout')
    );

    await applyManagedMeshConfigAfterReachableUpdate();

    expect(stopReticulumBridge).toHaveBeenCalledTimes(1);
    expect(restartBundledReticulumDaemonAndWaitReady).toHaveBeenCalledTimes(1);
    expect(startReticulumBridge).not.toHaveBeenCalled();
    expect(rebindReticulumBridgeConsumers).not.toHaveBeenCalled();
  });
});
