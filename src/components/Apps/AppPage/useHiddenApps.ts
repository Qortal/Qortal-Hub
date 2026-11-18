import { useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { getBaseApiReact } from '../../../App';
import { hiddenAppsAtom } from '../../../atoms/appsAtoms';
import { fetchHiddenApps } from './appPageQdn';
import { useOwnedNames } from './useAppPage';

/** How often the library asks again which apps are hidden. */
export const HIDDEN_APPS_REFRESH_MS = 10 * 60_000;

/** How soon it asks again after the node couldn't say. */
export const HIDDEN_APPS_RETRY_MS = 30_000;

const sameSet = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((key) => b.has(key));

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Keeps the library's list of apps their publishers hid (hiddenAppsAtom)
 * current: when Hub starts, then every 10 minutes. If the node can't say,
 * the list stays as it was and is asked for again soon. The user's own names
 * come along, so their own hidden apps stay listed for them.
 */
export const useHiddenAppsLoader = (address?: string, myName?: string) => {
  const setHiddenApps = useSetAtom(hiddenAppsAtom);
  const ownNames = useOwnedNames(address);

  useEffect(() => {
    const names = [
      ...new Set(
        [myName, ...ownNames].filter((name): name is string => !!name)
      ),
    ];
    setHiddenApps((previous) =>
      sameList(previous.ownNames, names)
        ? previous
        : { ...previous, ownNames: names }
    );
  }, [myName, ownNames, setHiddenApps]);

  useEffect(() => {
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      clearTimeout(retry);
      fetchHiddenApps(getBaseApiReact(), controller.signal)
        .then((hidden) =>
          setHiddenApps((previous) =>
            sameSet(previous.hidden, hidden)
              ? previous
              : { ...previous, hidden }
          )
        )
        .catch(() => {
          // A node that is starting answers within minutes: waiting for the
          // next round would list hidden apps until then.
          if (controller.signal.aborted) return;
          clearTimeout(retry);
          retry = setTimeout(load, HIDDEN_APPS_RETRY_MS);
        });
    };
    load();
    const timer = setInterval(load, HIDDEN_APPS_REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
      clearTimeout(retry);
    };
  }, [setHiddenApps]);
};
