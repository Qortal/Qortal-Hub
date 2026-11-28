/**
 * The tip a list hangs off: read when the list first shows (or taken from
 * the preset it was opened with), then pinned, so its rows don't move while
 * it is paged.
 *
 * - A list (`stepKey`) keeps it with its history step, so Back shows the
 *   same blocks. The window's Refresh (which moves `version`) reads the
 *   chain's newest block again and pins it in the old one's place,
 *   deliberately; when that read fails, the old one stays and it says so,
 *   with Retry. A tip taken from a kept answer (the window's cache, a
 *   preset) may be minutes old: before a block past it is refused, the
 *   newest is read again (`renew`, or `readNewest` and `pinChecked`), and
 *   `checked` says the tip pinned was read from the node while the list shows.
 * - The start page (no `stepKey`) keeps it only while it shows, and only for
 *   the window's cache it was read with: each showing reads the newest
 *   (once), and nothing from before a close or an account switch lingers.
 *
 * An answer that comes back after the part went is dropped.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExplorerCache } from '../../../lib/explorer/cache';
import { chainTipRead, isBlockHeight } from '../../../lib/explorer/chainTx';
import { useExplorer, useExplorerRead, useStepState } from '../ExplorerContext';

export interface PinnedTip {
  /** The tip the list hangs off, once known. */
  pinned: number | null;
  /** The tip pinned was read from the node while the list shows (Refresh, a check), not taken from a kept answer. */
  checked: boolean;
  /** The first read failed, so nothing is pinned yet: read it again. */
  failed: (() => void) | null;
  /** A newer tip is being read. */
  renewing: boolean;
  /** Refresh (or a check) couldn't read a newer tip: the pinned one stays. Read it again. */
  renewFailed: (() => void) | null;
  /** Read the newest tip and pin it. */
  renew: () => void;
  /** The chain's newest block, read now, nothing pinned: null when the read failed, undefined when the part went. */
  readNewest: () => Promise<number | null | undefined>;
  /** Pin a tip `readNewest` just gave. */
  pinChecked: (tip: number) => void;
}

/** A step-state key no step writes: what useStepState reads when the tip isn't kept with the step. */
const NOT_KEPT = 'chainTipNotKept';

export function usePinnedTip(
  stepKey: string | null,
  { renew: onRefresh }: { renew: boolean }
): PinnedTip {
  const { cache, version } = useExplorer();
  const [stepTip, setStepTip] = useStepState<number | null>(
    stepKey ?? NOT_KEPT,
    null
  );
  const [shownTip, setShownTip] = useState<{
    cache: ExplorerCache;
    tip: number;
  } | null>(null);
  const stored = stepKey
    ? stepTip
    : shownTip?.cache === cache
      ? shownTip.tip
      : null;
  const pinned = isBlockHeight(stored) ? stored : null;
  const setPinned = useCallback(
    (tip: number) => (stepKey ? setStepTip(tip) : setShownTip({ cache, tip })),
    [stepKey, setStepTip, cache]
  );
  // The tip last read from the node while this part shows.
  const [checkedTip, setCheckedTip] = useState<number | null>(null);
  const pinChecked = useCallback(
    (tip: number) => {
      setCheckedTip(tip);
      setPinned(tip);
    },
    [setPinned]
  );

  // The first tip: read once (a kept answer when there is one), then pinned.
  const first = useExplorerRead(pinned === null ? chainTipRead() : null);
  useEffect(() => {
    if (pinned === null && isBlockHeight(first.data)) setPinned(first.data);
  }, [pinned, first.data, setPinned]);

  // A newer tip, read past what is kept and pinned when it comes.
  const [renewal, setRenewal] = useState<'idle' | 'reading' | 'failed'>('idle');
  const run = useRef(0);
  const renew = useCallback(() => {
    const id = ++run.current;
    setRenewal('reading');
    const spec = chainTipRead();
    cache.read(spec.key, spec.load, { ttlMs: spec.ttlMs, force: true }).then(
      (height) => {
        if (run.current !== id) return;
        setRenewal('idle');
        pinChecked(height);
      },
      () => {
        if (run.current === id) setRenewal('failed');
      }
    );
  }, [cache, pinChecked]);

  // How many times this part went: a plain read answered after it went is dropped.
  const gone = useRef(0);
  const readNewest = useCallback(async () => {
    const born = gone.current;
    const spec = chainTipRead();
    let height: number | null = null;
    try {
      height = await cache.read(spec.key, spec.load, {
        ttlMs: spec.ttlMs,
        force: true,
      });
    } catch {
      height = null;
    }
    return gone.current === born ? height : undefined;
  }, [cache]);

  // The window's Refresh, pressed while this list shows.
  const seen = useRef(version);
  const pinnedNow = useRef(pinned);
  pinnedNow.current = pinned;
  useEffect(() => {
    if (seen.current === version) return;
    seen.current = version;
    if (onRefresh && pinnedNow.current !== null) renew();
  }, [version, onRefresh, renew]);

  // Anything still on its way when the part goes is dropped.
  useEffect(
    () => () => {
      run.current += 1;
      gone.current += 1;
    },
    []
  );

  return {
    pinned,
    checked: pinned !== null && pinned === checkedTip,
    failed: pinned === null && first.status === 'error' ? first.retry : null,
    renewing: renewal === 'reading',
    renewFailed: renewal === 'failed' ? renew : null,
    renew,
    readNewest,
    pinChecked,
  };
}
