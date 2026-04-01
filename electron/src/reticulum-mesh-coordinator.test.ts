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
  getReticulumDaemonStatus: vi.fn(() => ({ running: false })),
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
  startReticulumMeshCoordinator,
  stopReticulumMeshCoordinator,
} from './reticulum-mesh';

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
});
