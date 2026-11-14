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
import { forgetQortinoModel, unloadQortinoModelNow } from './modelSession';
import { clearInstallState, clearLegacyInstall } from './store';

export async function removeQortinoFromComputer(): Promise<{
  freedBytes: number;
}> {
  cancelQortinoInstallJob();
  setPendingQortinoInstall(false);
  // The model process reads the weights straight from these files.
  await unloadQortinoModelNow();
  forgetQortinoModel();
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
