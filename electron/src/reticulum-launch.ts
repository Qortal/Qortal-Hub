import { error as loggerError } from './logger';
import {
  getReticulumDaemonStatus,
  restartBundledReticulumDaemonAndWaitReady,
  startBundledReticulumDaemon,
  waitForReticulumSharedInstanceReady,
} from './reticulum-daemon';

export async function startReticulumForAppLaunch(
  timeoutMs?: number
): Promise<void> {
  startBundledReticulumDaemon();

  const status = getReticulumDaemonStatus();
  if (!status.running) {
    return;
  }

  try {
    await waitForReticulumSharedInstanceReady(timeoutMs);
  } catch (error) {
    loggerError(
      '[Reticulum] Shared instance missed initial launch readiness window; retrying daemon startup:',
      error
    );
    await restartBundledReticulumDaemonAndWaitReady(timeoutMs);
  }
}
