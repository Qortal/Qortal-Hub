/**
 * Compare, Sponsees and Funded: the Explorer window's steps that only a
 * viewer the level 5+ rule lets in sees (lib/explorer/access.ts), and the
 * accounts picked to compare. The window provides them; a part used
 * outside the window throws instead of quietly doing nothing.
 *
 * The picks are kept for this Hub session for each Hub account apart
 * (lib/explorer/comparePicks.ts), and cleared when Hub switches accounts:
 * the account signed in before never finds them, and the next never
 * inherits them.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  cleanPicks,
  clearPicks,
  readPicks,
  togglePick,
  writePicks,
  type PickResult,
} from '../../../lib/explorer/comparePicks';

export interface CompareSteps {
  /** The accounts picked to compare, in the order picked. */
  picks: readonly string[];
  /** Pick an account, or take it out when it is picked. */
  togglePick: (address: string) => PickResult;
  /** Take an account out of the picks. */
  removePick: (address: string) => void;
  /** Make `accounts` the picks (Compare on screen: its accounts). */
  setPicks: (accounts: readonly string[]) => void;
  /** Take every account out of the picks. */
  clearPicks: () => void;
  /**
   * Open Compare with `accounts` (up to 4, each once), as a step from what
   * is on screen; `about` is the account it is about (else the first): a
   * viewer who may no longer see Compare sees that account instead.
   */
  openCompare: (accounts: readonly string[], about?: string) => void;
  /** Open the accounts `address` sponsored, as a step. */
  openSponsees: (address: string) => void;
  /** Open the accounts whose first QORT payment came from `address`, as a step. */
  openFunded: (address: string) => void;
}

export const CompareStepsContext = createContext<CompareSteps | null>(null);

export function useCompareSteps(): CompareSteps {
  const value = useContext(CompareStepsContext);
  if (!value) throw new Error('Explorer parts belong inside ExplorerWindow');
  return value;
}

interface Kept {
  viewer: string | null;
  picks: string[];
}

const NONE: string[] = [];

/**
 * The picks of the Hub account `viewer`. Another Hub account: what was
 * picked before is cleared (here and where it was kept), and nothing of it
 * is ever handed to the new one, not even for the render before the switch
 * is seen.
 */
export function useComparePicks(viewer: string | null) {
  const [kept, setKept] = useState<Kept>(() => ({
    viewer,
    picks: readPicks(viewer),
  }));
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;
  const previous = useRef(viewer);
  useEffect(() => {
    if (previous.current === viewer) return;
    if (previous.current) clearPicks(previous.current);
    previous.current = viewer;
    setKept({ viewer, picks: readPicks(viewer) });
  }, [viewer]);

  const update = useCallback(
    (change: (picks: string[]) => string[]) =>
      setKept((was) => {
        const who = viewerRef.current;
        // A change made for another Hub account than the one kept: dropped.
        if (was.viewer !== who) return was;
        const picks = cleanPicks(change(was.picks));
        if (who) writePicks(who, picks);
        return { viewer: who, picks };
      }),
    []
  );

  const picks = kept.viewer === viewer ? kept.picks : NONE;
  const picksRef = useRef(picks);
  picksRef.current = picks;

  const toggle = useCallback(
    (address: string): PickResult => {
      const { result } = togglePick(picksRef.current, address);
      if (result === 'added' || result === 'removed')
        update((list) => togglePick(list, address).picks);
      return result;
    },
    [update]
  );
  const remove = useCallback(
    (address: string) =>
      update((list) => list.filter((pick) => pick !== address)),
    [update]
  );
  const set = useCallback(
    (accounts: readonly string[]) => update(() => [...accounts]),
    [update]
  );
  const clear = useCallback(() => update(() => []), [update]);

  return useMemo(
    () => ({
      picks,
      togglePick: toggle,
      removePick: remove,
      setPicks: set,
      clearPicks: clear,
    }),
    [picks, toggle, remove, set, clear]
  );
}
