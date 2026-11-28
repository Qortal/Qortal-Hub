/**
 * useExplorerRead (ExplorerContext.tsx), keeping what was last read for the
 * same key while it is read again and when that read fails (a Refresh, or
 * Retry after it): the part goes on showing what it had, with the failure
 * and Retry beside it, never nothing. `stale` says what is shown is the
 * last answer, not a new one. Another key (another account) starts empty.
 */
import { useRef } from 'react';
import type { ReadSpec } from '../../lib/explorer/reads';
import { useExplorerRead, type ReadState } from './ExplorerContext';

export interface KeptRead<T> extends ReadState<T> {
  /** The data shown is the last answer for this key, kept through a read again that failed or is still on its way. */
  stale: boolean;
}

export function useKeptRead<T>(spec: ReadSpec<T> | null): KeptRead<T> {
  const read = useExplorerRead(spec);
  const key = spec?.key ?? null;
  const last = useRef<{ key: string; data: T } | null>(null);
  if (key !== null && read.data !== undefined)
    last.current = { key, data: read.data };
  const kept =
    read.data === undefined &&
    read.status !== 'idle' &&
    key !== null &&
    last.current?.key === key
      ? last.current.data
      : undefined;
  return { ...read, data: read.data ?? kept, stale: kept !== undefined };
}
