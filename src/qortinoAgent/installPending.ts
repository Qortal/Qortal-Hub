/**
 * Whether a Qortino model download was started and has not ended yet. Kept
 * apart from installJob.ts so Hub can check it at sign-in without loading
 * any Qortino code.
 */
const PENDING_KEY = 'qortino:install-pending:v1';

export function hasPendingQortinoInstall(): boolean {
  try {
    return globalThis.localStorage?.getItem(PENDING_KEY) === '1';
  } catch {
    return false;
  }
}

export function setPendingQortinoInstall(pending: boolean): void {
  try {
    if (pending) globalThis.localStorage?.setItem(PENDING_KEY, '1');
    else globalThis.localStorage?.removeItem(PENDING_KEY);
  } catch {
    /* without storage the download only lasts while Hub runs */
  }
}
