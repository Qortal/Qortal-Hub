import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger', () => ({
  error: vi.fn(),
}));

vi.mock('./reticulum-daemon', () => ({
  getReticulumDaemonStatus: vi.fn(),
  restartBundledReticulumDaemonAndWaitReady: vi.fn(),
  startBundledReticulumDaemon: vi.fn(),
  waitForReticulumSharedInstanceReady: vi.fn(),
}));

vi.mock('./reticulum-bridge', () => ({
  startReticulumBridge: vi.fn(),
}));

import { error as loggerError } from './logger';
import {
  getReticulumDaemonStatus,
  restartBundledReticulumDaemonAndWaitReady,
  startBundledReticulumDaemon,
  waitForReticulumSharedInstanceReady,
} from './reticulum-daemon';
import { startReticulumBridge } from './reticulum-bridge';
import { startReticulumForAppLaunch } from './reticulum-launch';

describe('startReticulumForAppLaunch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(waitForReticulumSharedInstanceReady).mockResolvedValue(undefined);
    vi.mocked(startReticulumBridge).mockResolvedValue({} as never);
  });

  it('starts the daemon and accepts either shared-port or bridge readiness', async () => {
    vi.mocked(getReticulumDaemonStatus).mockReturnValue({
      running: true,
      pid: 123,
      mode: 'system',
      configDir: '/tmp/qortal-userdata/reticulum',
      reachability: 'unknown',
    });

    await startReticulumForAppLaunch(1_234);

    expect(startBundledReticulumDaemon).toHaveBeenCalledTimes(1);
    expect(waitForReticulumSharedInstanceReady).toHaveBeenCalledWith(1_234);
    expect(startReticulumBridge).toHaveBeenCalledTimes(1);
    expect(restartBundledReticulumDaemonAndWaitReady).not.toHaveBeenCalled();
  });

  it('uses bridge readiness instead of restarting when the raw shared-port probe times out', async () => {
    const timeoutError = new Error('Timed out waiting for Reticulum shared instance');
    vi.mocked(getReticulumDaemonStatus).mockReturnValue({
      running: true,
      pid: 456,
      mode: 'system',
      configDir: '/tmp/qortal-userdata/reticulum',
      reachability: 'unknown',
    });
    vi.mocked(waitForReticulumSharedInstanceReady).mockRejectedValueOnce(timeoutError);
    vi.mocked(startReticulumBridge).mockResolvedValueOnce({} as never);

    await startReticulumForAppLaunch(2_345);

    expect(waitForReticulumSharedInstanceReady).toHaveBeenCalledWith(2_345);
    expect(startReticulumBridge).toHaveBeenCalledTimes(1);
    expect(loggerError).not.toHaveBeenCalled();
    expect(restartBundledReticulumDaemonAndWaitReady).not.toHaveBeenCalled();
  });

  it('does not restart the shared daemon when both readiness checks fail', async () => {
    const timeoutError = new Error('Timed out waiting for Reticulum shared instance');
    const bridgeError = new Error('Bridge failed');
    vi.mocked(getReticulumDaemonStatus).mockReturnValue({
      running: true,
      pid: 456,
      mode: 'system',
      configDir: '/tmp/qortal-userdata/reticulum',
      reachability: 'unknown',
    });
    vi.mocked(waitForReticulumSharedInstanceReady).mockRejectedValueOnce(timeoutError);
    vi.mocked(startReticulumBridge).mockRejectedValueOnce(bridgeError);

    await startReticulumForAppLaunch(2_345);

    expect(loggerError).toHaveBeenCalledWith(
      '[Reticulum] Launch readiness wait failed; continuing with bridge startup:',
      bridgeError
    );
    expect(restartBundledReticulumDaemonAndWaitReady).not.toHaveBeenCalled();
  });

  it('skips the wait when no shared daemon is running', async () => {
    vi.mocked(getReticulumDaemonStatus).mockReturnValue({
      running: false,
      pid: undefined,
      mode: null,
      configDir: '/tmp/qortal-userdata/reticulum',
      reachability: 'disconnected',
    });

    await startReticulumForAppLaunch(3_456);

    expect(startBundledReticulumDaemon).toHaveBeenCalledTimes(1);
    expect(waitForReticulumSharedInstanceReady).not.toHaveBeenCalled();
    expect(startReticulumBridge).not.toHaveBeenCalled();
    expect(restartBundledReticulumDaemonAndWaitReady).not.toHaveBeenCalled();
  });
});
