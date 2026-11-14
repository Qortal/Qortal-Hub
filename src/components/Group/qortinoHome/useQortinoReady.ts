/**
 * Whether Qortino AI has a model on this computer and is ready to answer:
 * his own, or another the user chose. Checked again whenever Qortino's panel
 * closes (a model may have been downloaded or removed there), when a
 * download finishes in the background, and when the chosen model changes.
 */
import { useAtomValue } from 'jotai';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { qortinoAgentOpenAtom } from '../../../atoms/global';
import { isQortinoLlmInferenceAvailable } from '../../../qortinoAgent/qortinoLlm';
import {
  getQortinoInstallJob,
  subscribeQortinoInstallJob,
} from '../../../qortinoAgent/installJobStore';
import {
  resolveActiveQortinoModel,
  useQortinoModels,
} from '../../../qortinoAgent/models';
import { loadInstallState } from '../../../qortinoAgent/store';

export function useQortinoReady(): boolean {
  const [ready, setReady] = useState(false);
  const sheetOpen = useAtomValue(qortinoAgentOpenAtom);
  const models = useQortinoModels();
  const jobStatus = useSyncExternalStore(
    subscribeQortinoInstallJob,
    () => getQortinoInstallJob().status,
    () => getQortinoInstallJob().status
  );

  useEffect(() => {
    if (sheetOpen || !isQortinoLlmInferenceAvailable()) return;
    let cancelled = false;
    void loadInstallState()
      .then((state) => {
        if (cancelled) return;
        const model = resolveActiveQortinoModel(
          state.installed ? state.llmPath : null,
          models
        );
        setReady(Boolean(model.path));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [jobStatus, models, sheetOpen]);

  return ready;
}
