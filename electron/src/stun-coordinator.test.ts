import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReticulumBridge } from './reticulum-bridge';
import { StunUdpServer } from './stun-udp-server';
import { isPublicCommunityStunHost, StunCoordinator } from './stun-coordinator';

const tempDirs: string[] = [];

class FakeBridge extends EventEmitter {
  readonly getCommunityStunEndpoints = vi.fn(async () => []);
  readonly configureCommunityStun = vi.fn(async () => true);
}

function makeCoordinator(): StunCoordinator {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'community-stun-test-'));
  tempDirs.push(dir);
  return new StunCoordinator(path.join(dir, 'stun-cache.db'));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('community STUN endpoint validation', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '100.64.0.1',
    '169.254.1.2',
    '172.16.0.1',
    '192.168.1.1',
    '192.0.2.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    'localhost',
    'example.com',
    '::1',
  ])('rejects non-public probe target %s', (host) => {
    expect(isPublicCommunityStunHost(host)).toBe(false);
  });

  it('accepts a globally routable IPv4 literal', () => {
    expect(isPublicCommunityStunHost('8.8.8.8')).toBe(true);
  });

  it('moves discovery listeners and refreshes endpoints when the bridge is replaced', async () => {
    const first = new FakeBridge();
    const second = new FakeBridge();
    const coordinator = makeCoordinator();
    await coordinator.start(first as unknown as ReticulumBridge, {
      stunCacheDbPath: '',
      contributionEnabled: false,
    });

    coordinator.setBridge(second as unknown as ReticulumBridge);
    await Promise.resolve();

    expect(first.listenerCount('community-stun-endpoint')).toBe(0);
    expect(first.listenerCount('ready')).toBe(0);
    expect(second.listenerCount('community-stun-endpoint')).toBe(1);
    expect(second.listenerCount('ready')).toBe(1);
    expect(second.getCommunityStunEndpoints).toHaveBeenCalledTimes(1);

    coordinator.stop();
    await coordinator.waitForStop();
  });

  it('re-queries discovery when a call asks for an empty verified pool', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const bridge = new FakeBridge();
    const coordinator = makeCoordinator();
    await coordinator.start(bridge as unknown as ReticulumBridge, {
      stunCacheDbPath: '',
      contributionEnabled: false,
    });
    await Promise.resolve();
    expect(bridge.getCommunityStunEndpoints).toHaveBeenCalledTimes(1);

    // The startup query is still within the dedupe window.
    expect(coordinator.getIceServersForRenderer()).toEqual([]);
    expect(bridge.getCommunityStunEndpoints).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(coordinator.getIceServersForRenderer()).toEqual([]);
    await Promise.resolve();
    expect(bridge.getCommunityStunEndpoints).toHaveBeenCalledTimes(2);

    coordinator.stop();
    await coordinator.waitForStop();
  });

  it('refreshes anonymous discovery before verified probes can expire', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const bridge = new FakeBridge();
    const coordinator = makeCoordinator();
    await coordinator.start(bridge as unknown as ReticulumBridge, {
      stunCacheDbPath: '',
      contributionEnabled: false,
    });
    await Promise.resolve();
    expect(bridge.getCommunityStunEndpoints).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(bridge.getCommunityStunEndpoints).toHaveBeenCalledTimes(2);

    coordinator.stop();
    await coordinator.waitForStop();
  });

  it('queues previously verified endpoints for immediate startup revalidation', async () => {
    const bridge = new FakeBridge();
    const coordinator = makeCoordinator();
    const internal = coordinator as unknown as {
      cache: {
        getReprobeCandidates: ReturnType<typeof vi.fn>;
      };
      drainProbeQueue: () => void;
      probeQueue: Array<{ host: string; stunPort: number }>;
    };
    internal.cache.getReprobeCandidates = vi.fn(() => [
      {
        host: '8.8.8.8',
        stunPort: 47321,
        lastProbeSuccessAt: Date.now() - 60_000,
        lastProbeAttemptAt: Date.now() - 60_000,
      },
    ]);
    const drain = vi
      .spyOn(internal, 'drainProbeQueue')
      .mockImplementation(() => {});

    await coordinator.start(bridge as unknown as ReticulumBridge, {
      stunCacheDbPath: '',
      contributionEnabled: false,
    });

    expect(internal.cache.getReprobeCandidates).toHaveBeenCalledTimes(1);
    expect(internal.probeQueue).toEqual([
      expect.objectContaining({ host: '8.8.8.8', stunPort: 47321 }),
    ]);
    expect(drain).toHaveBeenCalled();

    coordinator.stop();
    await coordinator.waitForStop();
  });

  it('retries contribution after another local instance owns the UDP port', async () => {
    vi.useFakeTimers();
    const tryBind = vi
      .spyOn(StunUdpServer.prototype, 'tryBind')
      .mockResolvedValue(false);
    const coordinator = makeCoordinator();
    await coordinator.start(new FakeBridge() as unknown as ReticulumBridge, {
      stunCacheDbPath: '',
      contributionEnabled: true,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(tryBind).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(35_000);
    expect(tryBind).toHaveBeenCalledTimes(2);

    coordinator.stop();
    await coordinator.waitForStop();
  });

  it('recreates the contribution with a fresh NAT client after repeated mapping failures', async () => {
    const bridge = new FakeBridge();
    const coordinator = makeCoordinator();
    const oldClient = {
      _map: vi.fn(async () => [false, new Error('stale gateway')]),
      unmap: vi.fn(async () => true),
      destroy: vi.fn(async () => {}),
    };
    const oldServer = { stop: vi.fn() };
    const internal = coordinator as unknown as {
      running: boolean;
      contributionEnabled: boolean;
      contributionGeneration: number;
      contributionTask: Promise<void>;
      contributionMappingHealthy: boolean;
      mappingRefreshFailures: number;
      bridge: ReticulumBridge | null;
      natClient: typeof oldClient | null;
      udpServer: typeof oldServer | null;
      maintainContributionMapping: () => Promise<void>;
      startContribution: (generation: number) => Promise<void>;
    };
    internal.running = true;
    internal.contributionEnabled = true;
    internal.contributionMappingHealthy = true;
    internal.bridge = bridge as unknown as ReticulumBridge;
    internal.natClient = oldClient;
    internal.udpServer = oldServer;
    const startContribution = vi
      .spyOn(internal, 'startContribution')
      .mockResolvedValue();

    await internal.maintainContributionMapping();
    expect(internal.mappingRefreshFailures).toBe(1);
    expect(bridge.configureCommunityStun).not.toHaveBeenCalled();

    await internal.maintainContributionMapping();
    await internal.contributionTask;

    expect(bridge.configureCommunityStun).toHaveBeenCalledTimes(1);
    expect(bridge.configureCommunityStun).toHaveBeenCalledWith(null);
    expect(oldServer.stop).toHaveBeenCalledTimes(1);
    expect(oldClient.unmap).toHaveBeenCalledTimes(1);
    expect(oldClient.destroy).toHaveBeenCalledTimes(1);
    expect(startContribution).toHaveBeenCalledTimes(1);
    expect(startContribution).toHaveBeenCalledWith(1);
  });

  it('does not restart contribution if it is stopped while withdrawing a failed mapping', async () => {
    let finishWithdrawal: (() => void) | null = null;
    const bridge = new FakeBridge();
    bridge.configureCommunityStun.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishWithdrawal = () => resolve(true);
        })
    );
    const coordinator = makeCoordinator();
    const oldClient = {
      _map: vi.fn(async () => [false, new Error('stale gateway')]),
      unmap: vi.fn(async () => true),
      destroy: vi.fn(async () => {}),
    };
    const oldServer = { stop: vi.fn() };
    const internal = coordinator as unknown as {
      running: boolean;
      contributionEnabled: boolean;
      contributionTask: Promise<void>;
      contributionMappingHealthy: boolean;
      mappingRefreshFailures: number;
      bridge: ReticulumBridge | null;
      natClient: typeof oldClient | null;
      udpServer: typeof oldServer | null;
      refreshContributionMapping: () => Promise<void>;
      startContribution: (generation: number) => Promise<void>;
    };
    internal.running = true;
    internal.contributionEnabled = true;
    internal.contributionMappingHealthy = true;
    internal.mappingRefreshFailures = 1;
    internal.bridge = bridge as unknown as ReticulumBridge;
    internal.natClient = oldClient;
    internal.udpServer = oldServer;
    const startContribution = vi
      .spyOn(internal, 'startContribution')
      .mockResolvedValue();

    const refresh = internal.refreshContributionMapping();
    await vi.waitFor(() => {
      expect(bridge.configureCommunityStun).toHaveBeenCalledWith(null);
    });
    coordinator.stop();
    finishWithdrawal?.();
    await refresh;
    await coordinator.waitForStop();

    expect(startContribution).not.toHaveBeenCalled();
  });
});
