/** Reject promptly on lifecycle cancellation and always remove the listener.
 * The underlying operation still needs to release any resources it returns late.
 */
export function waitForRelayOperation<T>(
  operation: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!signal) return operation;
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener('abort', aborted);
      reject(signal.reason);
    };
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    operation.then(
      (value) => {
        signal.removeEventListener('abort', aborted);
        if (signal.aborted) reject(signal.reason);
        else resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', aborted);
        reject(error);
      }
    );
  });
}
