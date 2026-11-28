/**
 * The Explorer's reads from the node Hub uses. Public GETs only: none of
 * these endpoints needs the API key, and the Explorer never writes. Every
 * part of a path is encoded (`seg`), so a name holding `/`, `?` or `#`
 * stays one path segment.
 */
import { getBaseApiReact } from '../../App';

/** A node answer that wasn't a success: its HTTP status and body. */
export class CoreHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`The node answered ${status}`);
    this.name = 'CoreHttpError';
    this.status = status;
    this.body = body;
  }

  /** Core's own error number (`{"error":124,…}`), or null when the body has none. */
  get code(): number | null {
    try {
      const parsed = JSON.parse(this.body);
      return typeof parsed?.error === 'number' ? parsed.error : null;
    } catch {
      return null;
    }
  }
}

/**
 * One path segment, encoded. "." and ".." would still move the path once
 * encoded (a URL reads "%2e" as a dot), so they are refused.
 */
export const seg = (value: string | number): string => {
  const text = String(value);
  if (text === '.' || text === '..')
    throw new RangeError('A path segment may not be "." or ".."');
  return encodeURIComponent(text);
};

type QueryValue = string | number | boolean;

/** `a=1&b=x`, leaving out undefined values; a list repeats its key (`txType=A&txType=B`). */
export function queryString(
  params: Record<string, QueryValue | readonly QueryValue[] | undefined>
): string {
  return Object.entries(params)
    .flatMap(([key, value]) =>
      value === undefined
        ? []
        : (Array.isArray(value) ? value : [value]).map(
            (item) =>
              `${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`
          )
    )
    .join('&');
}

/**
 * GET `path` from the node and parse its JSON. A non-2xx answer, a body
 * that isn't JSON, and a 2xx body that is one of Core's error objects all
 * throw a CoreHttpError, so a failure is never taken for an answer.
 */
export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${getBaseApiReact()}${path}`);
  const text = await response.text();
  if (!response.ok) throw new CoreHttpError(response.status, text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CoreHttpError(response.status, text);
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    typeof (parsed as { error?: unknown }).error === 'number'
  ) {
    throw new CoreHttpError(response.status, text);
  }
  return parsed as T;
}

/**
 * GET `path` from the node as text (a transaction's raw bytes in base58).
 * A non-2xx answer throws a CoreHttpError, as `getJson` does.
 */
export async function getText(path: string): Promise<string> {
  const response = await fetch(`${getBaseApiReact()}${path}`);
  const text = await response.text();
  if (!response.ok) throw new CoreHttpError(response.status, text);
  return text;
}

/** True when `error` is the node saying `status` with Core error `code`. */
export function isCoreError(
  error: unknown,
  status: number,
  code?: number
): boolean {
  return (
    error instanceof CoreHttpError &&
    error.status === status &&
    (code === undefined || error.code === code)
  );
}
