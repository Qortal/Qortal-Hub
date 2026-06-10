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
    vi.mocked(restartBundledReticulumDaemonAndWaitReady).mockResolvedValue(
      undefined
    );
    vi.mocked(waitForReticulumSharedInstanceReady).mockResolvedValue(undefined);
    vi.mocked(startReticulumBridge).mockResolvedValue({} as never);
  });

  it('starts the daemon and waits for shared-port readiness before starting the bridge', async () => {
    vi.mocked(getReticulumDaemonStatus).mockReturnValue({
      running: true,
      pid: 123,
      mode: 'system',
      configDir: '/tmp/qortal-appdata/qortal-hub/reticulum',
      reachability: 'unknown',
    });

    await startReticulumForAppLaunch(1_234);

    expect(startBundledReticulumDaemon).toHaveBeenCalledTimes(1);
    expect(waitForReticulumSharedInstanceReady).toHaveBeenCalledWith(1_234);
    expect(startReticulumBridge).toHaveBeenCalledTimes(1);
    expect(restartBundledReticulumDaemonAndWaitReady).not.toHaveBeenCalled();
  });

  it('restarts rnsd before bridge startup when the shared-port probe times out', async () => {
    const timeoutError = new Error(
      'Timed out waiting for Reticulum shared instance'
    );
    vi.mocked(getReticulumDaemonStatus).mockReturnValue({
      running: true,
      pid: 456,
      mode: 'system',
      configDir: '/tmp/qortal-appdata/qortal-hub/reticulum',
      reachability: 'unknown',
    });
    vi.mocked(waitForReticulumSharedInstanceReady)
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce(undefined);

    await startReticulumForAppLaunch(2_345);

    expect(waitForReticulumSharedInstanceReady).toHaveBeenCalledWith(2_345);
    expect(startReticulumBridge).toHaveBeenCalledTimes(1);
    expect(loggerError).toHaveBeenCalledWith(
      '[Reticulum] Shared instance readiness failed during launch; restarting rnsd:',
      timeoutError
    );
    expect(restartBundledReticulumDaemonAndWaitReady).toHaveBeenCalledWith(
      2_345,
      { forceKillOnStopTimeout: true }
    );
  });

  it('surfaces launch readiness failure when restart cannot restore the shared port', async () => {
    const timeoutError = new Error(
      'Timed out waiting for Reticulum shared instance'
    );
    const restartError = new Error('Still not ready');
    vi.mocked(getReticulumDaemonStatus).mockReturnValue({
      running: true,
      pid: 456,
      mode: 'system',
      configDir: '/tmp/qortal-appdata/qortal-hub/reticulum',
      reachability: 'unknown',
    });
    vi.mocked(waitForReticulumSharedInstanceReady)
      .mockRejectedValueOnce(timeoutError)
      .mockRejectedValueOnce(restartError);

    await startReticulumForAppLaunch(2_345);

    expect(loggerError).toHaveBeenCalledWith(
      '[Reticulum] Shared instance readiness failed during launch; restarting rnsd:',
      timeoutError
    );
    expect(loggerError).toHaveBeenCalledWith(
      '[Reticulum] Shared instance readiness failed after launch restart:',
      restartError
    );
    expect(loggerError).toHaveBeenCalledWith(
      '[Reticulum] Launch readiness wait failed; continuing with bridge startup:',
      restartError
    );
    expect(startReticulumBridge).not.toHaveBeenCalled();
    expect(restartBundledReticulumDaemonAndWaitReady).toHaveBeenCalledTimes(1);
  });

  it('skips the wait when no shared daemon is running', async () => {
    vi.mocked(getReticulumDaemonStatus).mockReturnValue({
      running: false,
      pid: undefined,
      mode: null,
      configDir: '/tmp/qortal-appdata/qortal-hub/reticulum',
      reachability: 'disconnected',
    });

    await startReticulumForAppLaunch(3_456);

    expect(startBundledReticulumDaemon).toHaveBeenCalledTimes(1);
    expect(waitForReticulumSharedInstanceReady).not.toHaveBeenCalled();
    expect(startReticulumBridge).not.toHaveBeenCalled();
    expect(restartBundledReticulumDaemonAndWaitReady).not.toHaveBeenCalled();
  });
});
