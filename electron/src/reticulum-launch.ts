import { error as loggerError } from './logger';
import {
  getReticulumDaemonStatus,
  startBundledReticulumDaemon,
  waitForReticulumSharedInstanceReady,
} from './reticulum-daemon';
import { startReticulumBridge } from './reticulum-bridge';

async function waitForAnyReticulumReadiness(timeoutMs?: number): Promise<void> {
  const errors: unknown[] = [];
  let pending = 2;

  return new Promise<void>((resolve, reject) => {
    const failOne = (error: unknown) => {
      errors.push(error);
      pending -= 1;
      if (pending === 0) {
        reject(errors[errors.length - 1] ?? new Error('Reticulum readiness failed'));
      }
    };

    waitForReticulumSharedInstanceReady(timeoutMs).then(resolve).catch(failOne);
    startReticulumBridge().then(() => resolve()).catch(failOne);
  });
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
