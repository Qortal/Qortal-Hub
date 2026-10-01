export const USER_DECLINED_REQUEST_CODE = 'USER_DECLINED';

type CodedError = Error & { code?: string };

export function codedQortalRequestError(
  code: string,
  message: string
): CodedError {
  const error = new Error(message) as CodedError;
  error.code = code;
  return error;
}

export function serializeQortalRequestError(error: unknown): {
  error: string;
  code?: string;
  message: string;
} {
  const candidate =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown; message?: unknown })
      : undefined;
  const code =
    typeof candidate?.code === 'string' && candidate.code
      ? candidate.code
      : undefined;
  const message =
    typeof candidate?.message === 'string' && candidate.message
      ? candidate.message
      : typeof error === 'string' && error
        ? error
        : 'Request failed';
  return { error: code ?? message, ...(code ? { code } : {}), message };
}
