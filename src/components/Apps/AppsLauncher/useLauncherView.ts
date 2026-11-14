import { useCallback, useMemo } from 'react';
import { atom, useAtom } from 'jotai';
import {
  EMPTY_LAUNCHER_VIEW,
  type LauncherView,
  loadLauncherView,
  saveLauncherView,
} from './launcherItems';

type ViewState = {
  /** The account the view belongs to; undefined until one is loaded. */
  address: string | null | undefined;
  view: LauncherView;
};

/** The view in use, with the account it belongs to. */
const viewStateAtom = atom<ViewState>({
  address: undefined,
  view: EMPTY_LAUNCHER_VIEW,
});

/**
 * How the signed-in account left the launcher's tiles: where the folders and
 * bookmarks stand among the pinned apps, and which folders are open. It is
 * read from this device when the account changes, and saved to it with every
 * change. What the tiles are comes from the pin list and the bookmarks.
 */
export const useLauncherView = (address: string | null | undefined) => {
  const account = address || null;
  const [state, setState] = useAtom(viewStateAtom);

  const view = useMemo(
    () => (state.address === account ? state.view : loadLauncherView(account)),
    [account, state]
  );

  const setView = useCallback(
    (next: LauncherView) => {
      setState({ address: account, view: next });
      saveLauncherView(account, next);
    },
    [account, setState]
  );

  return [view, setView] as const;
};
