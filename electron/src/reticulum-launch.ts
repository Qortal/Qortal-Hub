import { error as loggerError, log as loggerLog } from './logger';
import {
  getReticulumDaemonStatus,
  isReticulumSharedDaemonOwnedByAnotherLiveInstance,
  restartBundledReticulumDaemonAndWaitReady,
  startBundledReticulumDaemon,
  waitForReticulumSharedInstanceReady,
} from './reticulum-daemon';
import { startReticulumBridge, stopReticulumBridge } from './reticulum-bridge';

async function waitForAnyReticulumReadiness(timeoutMs?: number): Promise<void> {
  try {
    await waitForReticulumSharedInstanceReady(timeoutMs);
  } catch (sharedError) {
    if (isReticulumSharedDaemonOwnedByAnotherLiveInstance()) {
      loggerLog(
        '[Reticulum] Shared instance readiness failed during launch, but another live app instance owns rnsd; starting bridge without restarting daemon:',
        sharedError
      );
      await startReticulumBridge();
      return;
    }
    try {
      loggerLog(
        '[Reticulum] Shared instance readiness failed during launch; trying bridge before restarting rnsd:',
        sharedError
      );
      await startReticulumBridge();
      return;
    } catch (bridgeError) {
      loggerError(
        '[Reticulum] Bridge startup failed after shared readiness timeout; restarting rnsd:',
        bridgeError
      );
      stopReticulumBridge();
    }
    await restartBundledReticulumDaemonAndWaitReady(timeoutMs, {
      forceKillOnStopTimeout: true,
    });
    try {
      await waitForReticulumSharedInstanceReady(timeoutMs);
    } catch (restartError) {
      loggerError(
        '[Reticulum] Shared instance readiness failed after launch restart:',
        restartError
      );
      throw restartError;
    }
  }
  await startReticulumBridge();
}

export async function startReticulumForAppLaunch(
  timeoutMs?: number
): Promise<void> {
  startBundledReticulumDaemon();

  const status = getReticulumDaemonStatus();
  if (!status.running) {
    return;
  }

  try {
    await waitForAnyReticulumReadiness(timeoutMs);
  } catch (error) {
    loggerError(
      '[Reticulum] Launch readiness wait failed; continuing with bridge startup:',
      error
    );
  }
}
