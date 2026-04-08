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

import { error as loggerError } from './logger';
import {
  getReticulumDaemonStatus,
  restartBundledReticulumDaemonAndWaitReady,
  startBundledReticulumDaemon,
  waitForReticulumSharedInstanceReady,
} from './reticulum-daemon';
import { startReticulumForAppLaunch } from './reticulum-launch';

describe('startReticulumForAppLaunch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('waits for the shared instance before the bridge starts', async () => {
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
    expect(restartBundledReticulumDaemonAndWaitReady).not.toHaveBeenCalled();
  });

  it('retries daemon startup once when the first readiness wait times out', async () => {
    const timeoutError = new Error('Timed out waiting for Reticulum shared instance');
    vi.mocked(getReticulumDaemonStatus).mockReturnValue({
      running: true,
      pid: 456,
      mode: 'system',
      configDir: '/tmp/qortal-userdata/reticulum',
      reachability: 'unknown',
    });
    vi.mocked(waitForReticulumSharedInstanceReady).mockRejectedValueOnce(timeoutError);

    await startReticulumForAppLaunch(2_345);

    expect(waitForReticulumSharedInstanceReady).toHaveBeenCalledWith(2_345);
    expect(loggerError).toHaveBeenCalledWith(
      '[Reticulum] Shared instance missed initial launch readiness window; retrying daemon startup:',
      timeoutError
    );
    expect(restartBundledReticulumDaemonAndWaitReady).toHaveBeenCalledWith(2_345);
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
    expect(restartBundledReticulumDaemonAndWaitReady).not.toHaveBeenCalled();
  });
});
