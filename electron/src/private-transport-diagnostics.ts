import { warn } from './logger';

type SetupStage =
  | 'relay-selection'
  | 'bootstrap-rpc'
  | 'bootstrap-validation'
  | 'session-open';

/** Keep local diagnostics useful without recording endpoints, accounts, proofs,
 * tickets, attach tokens or arbitrary error messages from remote peers. */
export async function diagnosePrivateTransport<T>(
  stage: SetupStage,
  operation: () => Promise<T> | T
): Promise<T> {
  const started = Date.now();
  try {
    return await operation();
  } catch (error) {
    const candidate = error as { code?: unknown; message?: unknown } | null;
    const value = candidate?.code ?? candidate?.message;
    const code =
      typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(value)
        ? value
        : 'UNCLASSIFIED_ERROR';
    const kind = error instanceof TypeError ? 'TypeError' : 'Error';
    warn(
      `[PrivateTransport] setup failed stage=${stage} code=${code} kind=${kind} elapsed_ms=${Date.now() - started}`
    );
    throw error;
  }
}
