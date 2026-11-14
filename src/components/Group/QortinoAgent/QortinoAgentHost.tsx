import { useAtomValue } from 'jotai';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { qortinoAgentOpenAtom } from '../../../atoms/global';
import ErrorBoundary from '../../../common/ErrorBoundary';
import { hasPendingQortinoInstall } from '../../../qortinoAgent/installPending';
import { clearPendingQortinoQuestion } from '../../../qortinoAgent/pendingQuestion';
import { isQortinoLlmNativeAvailable } from '../../../qortinoAgent/qortinoLlm';
import { closeQortinoAgentSheet } from '../../../qortinoAgent/qortinoSheetNav';

const QortinoAgentPanel = lazy(() => import('./QortinoAgentPanel'));

/**
 * The panel failed: close Qortino, so the next open request opens it again
 * (with a fresh boundary).
 */
function PanelFailed({ onClosed }: { onClosed: () => void }) {
  useEffect(() => {
    closeQortinoAgentSheet();
    clearPendingQortinoQuestion();
    onClosed();
  }, [onClosed]);
  return null;
}

/**
 * Where Qortino AI's panel lives in Hub (signed in, desktop app only). Its
 * code loads the first time it opens and then stays, so later opens are
 * instant. A model download Hub was closed during carries on after sign-in.
 * A fault in the panel stays in the panel: Qortino closes, Hub carries on.
 */
export function QortinoAgentHost() {
  const open = useAtomValue(qortinoAgentOpenAtom);
  const [wanted, setWanted] = useState(false);
  const [crashed, setCrashed] = useState(false);
  const [boundaryKey, setBoundaryKey] = useState(0);
  const available = isQortinoLlmNativeAvailable();
  const markCrashed = useCallback(() => setCrashed(true), []);

  useEffect(() => {
    if (open) setWanted(true);
    // Opened again after a fault: try once more, from scratch.
    if (open && crashed) {
      setCrashed(false);
      setBoundaryKey((key) => key + 1);
    }
  }, [crashed, open]);

  useEffect(() => {
    if (!available || !hasPendingQortinoInstall()) return;
    void import('../../../qortinoAgent/installJob')
      .then((m) => m.resumeQortinoInstallIfPending())
      .catch(() => undefined);
  }, [available]);

  // Signed out (the host goes with the session): the next account starts
  // with Qortino closed and no question waiting.
  useEffect(
    () => () => {
      closeQortinoAgentSheet();
      clearPendingQortinoQuestion();
    },
    []
  );

  if (!available || !wanted || crashed) return null;
  return (
    <ErrorBoundary
      key={boundaryKey}
      fallback={<PanelFailed onClosed={markCrashed} />}
    >
      <Suspense fallback={null}>
        <QortinoAgentPanel />
      </Suspense>
    </ErrorBoundary>
  );
}
