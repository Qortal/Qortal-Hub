/**
 * Settings → Remove Qortino from this computer. The model's files, its saved
 * warm-up state and the install record go; the chats stay (they have a
 * delete of their own). Downloading again starts from nothing.
 */
import QortinoLlm from './qortinoLlm';
import { cancelQortinoInstallJob } from './installJob';
import {
  getQortinoInstallJob,
  IDLE_QORTINO_INSTALL_JOB,
  updateQortinoInstallJob,
} from './installJobStore';
import { setPendingQortinoInstall } from './installPending';
import {
  forgetQortinoModel,
  isQortinoModelPathInUse,
  unloadQortinoModelNow,
} from './modelSession';
import { resolveActiveQortinoModel } from './models';
import { clearInstallState, clearLegacyInstall } from './store';

export async function removeQortinoFromComputer(
  llmPath?: string | null
): Promise<{
  freedBytes: number;
}> {
  cancelQortinoInstallJob();
  setPendingQortinoInstall(false);
  // The model process reads the weights straight from these files: let go
  // of Qortino's model if it is loaded, loading, or the one the chat loads.
  // Another model in use, and its answer, are left alone.
  if (
    (llmPath && isQortinoModelPathInUse(llmPath)) ||
    resolveActiveQortinoModel(llmPath).isQortino
  ) {
    // An answer being written would keep the unload waiting until it ends.
    await QortinoLlm.cancel().catch(() => undefined);
    await unloadQortinoModelNow();
    forgetQortinoModel();
  }
  // A failure leaves the install record: the next open checks which parts
  // are still there.
  const { freedBytes } = await QortinoLlm.cleanupStorage({ keep: [] });
  await clearInstallState();
  await clearLegacyInstall();
  updateQortinoInstallJob({
    ...IDLE_QORTINO_INSTALL_JOB,
    viewOpen: getQortinoInstallJob().viewOpen,
  });
  return { freedBytes };
}
