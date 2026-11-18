import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { getBaseApiReact } from '../../../App';
import {
  type OwnWidget,
  PUBLISHED_OWN_WIDGET_WAIT_MS,
  loadOwnWidgets,
  publishedOwnWidgetsAtom,
  withPublishedOwnWidgets,
} from './ownWidgets';

export type OwnWidgetsPhase = 'loading' | 'error' | 'ready';

type Loaded = { phase: 'error' } | { phase: 'ready'; widgets: OwnWidget[] };

const NAMES_SEPARATOR = '\u0000';

/** The node is asked again this long after a publish from here. */
const PUBLISHED_RECHECK_MS = 2 * 60_000;
/** A moment past a publish's wait, so it is over when the answer comes. */
const WAIT_OVER_MARGIN_MS = 1_000;

/**
 * The widgets the account's names have published, for My apps, with the ones
 * just published from this Hub that the node doesn't list yet.
 *
 * A failed load is an error to retry, never "no widgets". A failed refresh
 * keeps what is shown. Other names (another account) start over: nothing of
 * the previous names shows while theirs load, and a late answer for the
 * previous names is dropped.
 */
export const useOwnWidgets = (names: readonly string[], refreshKey = 0) => {
  const namesKey = [...names].sort().join(NAMES_SEPARATOR);
  const [attempt, setAttempt] = useState(0);
  // Asks the node again while widgets published from here wait for it.
  const [recheck, setRecheck] = useState(0);
  const [loaded, setLoaded] = useState<{
    namesKey: string;
    value: Loaded;
  } | null>(null);
  const published = useAtomValue(publishedOwnWidgetsAtom);

  useEffect(() => {
    const list = namesKey ? namesKey.split(NAMES_SEPARATOR) : [];
    if (list.length === 0) {
      setLoaded({ namesKey, value: { phase: 'ready', widgets: [] } });
      return;
    }
    const controller = new AbortController();
    loadOwnWidgets(getBaseApiReact(), list, { signal: controller.signal })
      .then((widgets) => {
        if (controller.signal.aborted) return;
        setLoaded({ namesKey, value: { phase: 'ready', widgets } });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setLoaded((previous) =>
          previous?.namesKey === namesKey && previous.value.phase === 'ready'
            ? previous
            : { namesKey, value: { phase: 'error' } }
        );
      });
    return () => controller.abort();
  }, [attempt, namesKey, refreshKey, recheck]);

  // A widget published from here shows from what was published only until
  // the node answers with that version, or its wait is over: the node is
  // asked again a little after the publish, and when the wait ends.
  useEffect(() => {
    const wanted = new Set(
      namesKey
        ? namesKey.split(NAMES_SEPARATOR).map((item) => item.toLowerCase())
        : []
    );
    const now = Date.now();
    const next = Math.min(
      ...published
        .filter((item) => wanted.has(item.name.toLowerCase()))
        .flatMap((item) => [
          item.publishedAt + PUBLISHED_RECHECK_MS,
          item.publishedAt + PUBLISHED_OWN_WIDGET_WAIT_MS + WAIT_OVER_MARGIN_MS,
        ])
        .filter((at) => at > now)
    );
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(
      () => setRecheck((value) => value + 1),
      next - now
    );
    return () => clearTimeout(timer);
  }, [published, namesKey, recheck]);

  const retry = useCallback(() => {
    setLoaded(null);
    setAttempt((value) => value + 1);
  }, []);

  const current = loaded?.namesKey === namesKey ? loaded.value : null;
  const widgets = useMemo(
    () =>
      current?.phase === 'ready'
        ? withPublishedOwnWidgets(
            current.widgets,
            published,
            namesKey ? namesKey.split(NAMES_SEPARATOR) : []
          )
        : [],
    // `recheck`: the clock is read again when a wait ends, also when the
    // node can't answer then.
    [current, namesKey, published, recheck]
  );
  const phase: OwnWidgetsPhase = current ? current.phase : 'loading';
  return { phase, widgets, retry };
};
