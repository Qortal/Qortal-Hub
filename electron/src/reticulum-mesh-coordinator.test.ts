/**
 * Integration-style tests for ReticulumMeshCoordinator fanout immediate probes.
 * Mocks heavy deps so the real coordinator module can run start/stop.
 */
import { EventEmitter } from 'events';
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
  buildCurrentManagedReticulumConfig: vi.fn(() => ''),
  computeManagedReticulumConfigFingerprint: vi.fn(() => 'a'.repeat(64)),
  getReticulumInstanceIndex: vi.fn(() => 0),
  startBundledReticulumDaemon: vi.fn(),
  stopBundledReticulumDaemon: vi.fn(),
  writeManagedReticulumConfigIfManaged: vi.fn(() => false),
}));

vi.mock('./reticulum-bridge', () => ({
  getReticulumBridge: vi.fn(() => null),
  startReticulumBridge: vi.fn(),
  stopReticulumBridge: vi.fn(),
}));

let mockPm!: EventEmitter & {
  getReticulumFanoutDestinationHashes: () => string[];
};

vi.mock('./presence', () => ({
  getPresenceManager: () => mockPm,
}));

import {
  startReticulumMeshCoordinator,
  stopReticulumMeshCoordinator,
} from './reticulum-mesh';
import { MESH_FANOUT_PRESENCE_DEBOUNCE_MS } from './reticulum-mesh-constants';

function createBridgeStub() {
  const meshSendPeerExchange = vi.fn(async () => ({ ok: true as const }));
  const bridge = {
    getState: vi.fn(() => 'ready' as const),
    on: vi.fn(),
    off: vi.fn(),
    meshSendPeerExchange,
  };
  return bridge;
}

describe('ReticulumMeshCoordinator fanout immediate probes', () => {
  let fanoutHashes: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    fanoutHashes = [];
    mockPm = new EventEmitter() as EventEmitter & {
      getReticulumFanoutDestinationHashes: () => string[];
    };
    mockPm.getReticulumFanoutDestinationHashes = () => fanoutHashes;
  });

  afterEach(() => {
    stopReticulumMeshCoordinator();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('fires one mesh request when a new fanout hash appears after startup', async () => {
    const bridge = createBridgeStub();
    startReticulumMeshCoordinator(bridge as never);

    expect(bridge.meshSendPeerExchange).not.toHaveBeenCalled();

    fanoutHashes = ['new-hash-a'];
    mockPm.emit('presence-updated');
    await vi.advanceTimersByTimeAsync(MESH_FANOUT_PRESENCE_DEBOUNCE_MS);

    expect(bridge.meshSendPeerExchange).toHaveBeenCalledTimes(1);
    expect(bridge.meshSendPeerExchange).toHaveBeenCalledWith({
      peerPresenceHash: 'new-hash-a',
      kind: 'request',
    });
  });

  it('does not re-probe the same hash on a later presence-updated', async () => {
    const bridge = createBridgeStub();
    fanoutHashes = [];
    startReticulumMeshCoordinator(bridge as never);

    fanoutHashes = ['stable'];
    mockPm.emit('presence-updated');
    await vi.advanceTimersByTimeAsync(MESH_FANOUT_PRESENCE_DEBOUNCE_MS);
    expect(bridge.meshSendPeerExchange).toHaveBeenCalledTimes(1);

    mockPm.emit('presence-updated');
    await vi.advanceTimersByTimeAsync(MESH_FANOUT_PRESENCE_DEBOUNCE_MS);
    expect(bridge.meshSendPeerExchange).toHaveBeenCalledTimes(1);
  });

  it('probes a second hash when it is added after the first was already probed', async () => {
    const bridge = createBridgeStub();
    startReticulumMeshCoordinator(bridge as never);

    fanoutHashes = ['first'];
    mockPm.emit('presence-updated');
    await vi.advanceTimersByTimeAsync(MESH_FANOUT_PRESENCE_DEBOUNCE_MS);
    expect(bridge.meshSendPeerExchange).toHaveBeenCalledTimes(1);

    fanoutHashes = ['first', 'second'];
    mockPm.emit('presence-updated');
    await vi.advanceTimersByTimeAsync(MESH_FANOUT_PRESENCE_DEBOUNCE_MS);

    expect(bridge.meshSendPeerExchange).toHaveBeenCalledTimes(2);
    expect(bridge.meshSendPeerExchange).toHaveBeenLastCalledWith({
      peerPresenceHash: 'second',
      kind: 'request',
    });
  });

  it('caps immediate probes per event and issues multiple calls in one debounced run', async () => {
    const bridge = createBridgeStub();
    startReticulumMeshCoordinator(bridge as never);

    fanoutHashes = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    mockPm.emit('presence-updated');
    await vi.advanceTimersByTimeAsync(MESH_FANOUT_PRESENCE_DEBOUNCE_MS);

    expect(bridge.meshSendPeerExchange).toHaveBeenCalledTimes(8);
    const calls = bridge.meshSendPeerExchange.mock.calls as unknown as Array<
      [{ peerPresenceHash: string; kind: string }]
    >;
    const hashes = calls.map((c) => c[0].peerPresenceHash);
    expect(hashes).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });

  it('stops listening after coordinator stop (no probes after emit)', async () => {
    const bridge = createBridgeStub();
    startReticulumMeshCoordinator(bridge as never);
    stopReticulumMeshCoordinator();

    fanoutHashes = ['late'];
    mockPm.emit('presence-updated');
    await vi.advanceTimersByTimeAsync(MESH_FANOUT_PRESENCE_DEBOUNCE_MS);

    expect(bridge.meshSendPeerExchange).not.toHaveBeenCalled();
  });
});
