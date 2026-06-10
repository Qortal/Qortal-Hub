import { error as loggerError } from './logger';
import {
  getReticulumDaemonStatus,
  restartBundledReticulumDaemonAndWaitReady,
  startBundledReticulumDaemon,
  waitForReticulumSharedInstanceReady,
} from './reticulum-daemon';
import { startReticulumBridge } from './reticulum-bridge';

async function waitForAnyReticulumReadiness(timeoutMs?: number): Promise<void> {
  try {
    await waitForReticulumSharedInstanceReady(timeoutMs);
  } catch (sharedError) {
    loggerError(
      '[Reticulum] Shared instance readiness failed during launch; restarting rnsd:',
      sharedError
    );
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
