import { error as loggerError } from './logger';
import {
  getReticulumDaemonStatus,
  startBundledReticulumDaemon,
  waitForReticulumSharedInstanceReady,
} from './reticulum-daemon';
import { startReticulumBridge } from './reticulum-bridge';

async function waitForAnyReticulumReadiness(timeoutMs?: number): Promise<void> {
  try {
    await waitForReticulumSharedInstanceReady(timeoutMs);
    return;
  } catch (sharedError) {
    try {
      await startReticulumBridge();
      return;
    } catch {
      throw sharedError;
    }
  }
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
