import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeToEvent, unsubscribeFromEvent } from '../../../utils/events';
import {
  APP_BOOKMARKS_CHANGED_EVENT,
  loadBookmarksForAddress,
  saveBookmarksForAddress,
} from '../AppBookmarks/bookmarkStorage';
import type { AppBookmarksForAddress } from '../AppBookmarks/bookmarkTypes';

/**
 * The account's bookmarks and bookmark folders: the store the bookmarks menu
 * uses. It is read again whenever the launcher shows and whenever the store
 * is saved, so a change made in one place appears in the other.
 *
 * - `save` shows the new state at once and writes it behind. Writes go one
 *   after another, in the order they were asked for.
 * - `isReady` turns true once the store was read, or could not be read: then
 *   `data` stays null.
 */
export const useLauncherBookmarks = (
  address: string | null | undefined,
  isShown: boolean
) => {
  const [data, setData] = useState<AppBookmarksForAddress | null>(null);
  const [isReady, setIsReady] = useState(false);
  const latestLoadRef = useRef(0);
  /** The writes that are not finished yet, and the account they are for. */
  const pendingRef = useRef({ address: '', count: 0 });
  const writesRef = useRef<Promise<unknown>>(Promise.resolve());

  const load = useCallback(async () => {
    // What is being written is newer than what is stored.
    const pending = pendingRef.current;
    if (pending.count > 0 && pending.address === address) return;

    const loadId = ++latestLoadRef.current;
    if (!address) {
      setData(null);
      setIsReady(true);
      return;
    }
    let loaded: AppBookmarksForAddress | null = null;
    try {
      loaded = await loadBookmarksForAddress(address);
    } catch (error) {
      console.error(error);
    }
    // An answer that is out of date is dropped: another account was asked
    // for since, or a change was made here.
    if (loadId !== latestLoadRef.current) return;
    setData(loaded);
    setIsReady(true);
  }, [address]);

  // Another account: its bookmarks are not read yet.
  useEffect(() => {
    setData(null);
    setIsReady(false);
  }, [address]);

  useEffect(() => {
    if (isShown) void load();
  }, [isShown, load]);

  useEffect(() => {
    const onChanged = (event: CustomEvent<{ address?: string }>) => {
      if (event.detail?.address === address) void load();
    };
    subscribeToEvent(APP_BOOKMARKS_CHANGED_EVENT, onChanged);
    return () => unsubscribeFromEvent(APP_BOOKMARKS_CHANGED_EVENT, onChanged);
  }, [address, load]);

  const save = useCallback(
    (next: AppBookmarksForAddress) => {
      if (!address) return;
      setData(next);
      // An answer still on its way would bring the old state back.
      latestLoadRef.current += 1;
      if (pendingRef.current.address !== address) {
        pendingRef.current = { address, count: 0 };
      }
      const pending = pendingRef.current;
      pending.count += 1;
      writesRef.current = writesRef.current
        .then(() => saveBookmarksForAddress(address, next))
        .then(
          () => {
            pending.count -= 1;
          },
          (error) => {
            console.error(error);
            pending.count -= 1;
            // Show what is really stored.
            void load();
          }
        );
    },
    [address, load]
  );

  return { data, isReady, save };
};
