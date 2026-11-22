/**
 * One account's list of confirmed transactions for the types picked
 * (lib/explorer/accountTx.ts): the newest 100 first, then 100 more on each
 * "Show more", up to the list's most.
 *
 * - The list on screen is the one merge base: Refresh's newest page and
 *   Show more's older page are each merged onto the list as it is when
 *   their answer arrives, in whichever order they arrive, so neither undoes
 *   the other (a page that no longer follows on is left out).
 * - The list lives in the window's cache (`put`), so the Overview's Latest
 *   transactions and the Transactions tab share the All list, and its first
 *   read is shared with one already on its way.
 * - A failed Refresh keeps the rows read so far on screen, with the failure
 *   and Retry, which reads the newest page again onto them.
 * - Answers that come back after another list was picked, the window
 *   started again, or the part went away are dropped. Nothing polls.
 * - The Overview reads an account's whole history through it (its QORT
 *   figures and Activity): `raise` lets the list hold more than the tabs'
 *   ceiling, and `readOn` reads 100 older up to the list's own ceiling (at
 *   the Explorer's most, one row, to know whether there are more). One
 *   part holds a list at a time (the Overview, or a tab), so two never read
 *   the same page.
 * - Refresh also clears an older page that failed, so reading on (and Show
 *   more) can try it again.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ACCOUNT_TX_TTL_MS,
  accountTxKey,
  canReadMore,
  canReadOn,
  fromFirstPage,
  mergeChecked,
  mergeNewest,
  mergeOlderAt,
  needsCheck,
  readTxPage,
  withCeiling,
  type AccountTxList,
} from '../../../lib/explorer/accountTx';
import type { TxRow } from '../../../lib/explorer/reads';
import { useExplorer } from '../ExplorerContext';

export interface AccountTxListState {
  /** What is on screen: kept while a Refresh reads, and after it failed. */
  list: AccountTxList | undefined;
  /** The newest page couldn't be read (the first read, or a Refresh). */
  error: unknown;
  /** Read the newest page again (onto the rows read, when there are). */
  retry: () => void;
  /** The newest page is being read again onto the rows held (Refresh, Retry). */
  refreshing: boolean;
  /** Show more: reading, or failed (with what failed). */
  more: { loading: boolean; error: unknown };
  showMore: () => void;
  /** 100 older, up to the list's own ceiling (a whole history asked for). */
  readOn: () => void;
  /** Let the list hold up to `max` rows (lib/explorer/accountTx.ts withCeiling). */
  raise: (max: number) => void;
}

interface Shown {
  key: string | null;
  list: AccountTxList | undefined;
  newestError: unknown;
  refreshing: boolean;
  moreLoading: boolean;
  moreError: unknown;
}

const nothing = (key: string | null, list?: AccountTxList): Shown => ({
  key,
  list,
  newestError: null,
  refreshing: false,
  moreLoading: false,
  moreError: null,
});

export function useAccountTxList(
  address: string,
  types: readonly string[],
  { enabled = true }: { enabled?: boolean } = {}
): AccountTxListState {
  const { cache, version } = useExplorer();
  // The types arrive anew each render: kept per value.
  const typesWord = types.join(',');
  const typeList = useMemo(
    () => (typesWord ? typesWord.split(',') : []),
    [typesWord]
  );
  const key = enabled ? accountTxKey(address, typeList) : null;

  const [shown, setShown] = useState<Shown>(() => nothing(null));
  /** The list every read merges onto: the one on screen, for its key. */
  const base = useRef<{ key: string | null; list: AccountTxList | undefined }>({
    key: null,
    list: undefined,
  });
  /** Each read's turn: one that comes back after a newer one, or after the list changed, is dropped. */
  const turns = useRef({ newest: 0, more: 0 });

  /** Put a list on screen, as the merge base and in the window's cache. */
  const adopt = useCallback(
    (forKey: string, list: AccountTxList) => {
      base.current = { key: forKey, list };
      cache.put(forKey, list, { ttlMs: ACCOUNT_TX_TTL_MS });
      setShown((was) => ({
        ...(was.key === forKey ? was : nothing(forKey)),
        list,
      }));
    },
    [cache]
  );

  /** Read the newest page: the list's first read, or merged onto the rows held. */
  const readNewest = useCallback(
    (forKey: string) => {
      const turn = ++turns.current.newest;
      const held = () =>
        base.current.key === forKey ? base.current.list : undefined;
      setShown((was) => ({
        ...(was.key === forKey ? was : nothing(forKey)),
        newestError: null,
        refreshing: Boolean(held()),
      }));
      // With nothing held, a read of the same list on its way elsewhere is shared.
      const read: Promise<{ page?: TxRow[]; list?: AccountTxList }> = held()
        ? readTxPage(address, typeList, 0).then((page) => ({ page }))
        : cache
            .read(
              forKey,
              async () => fromFirstPage(await readTxPage(address, typeList, 0)),
              { ttlMs: ACCOUNT_TX_TTL_MS }
            )
            .then((list) => ({ list }));
      read.then(
        ({ page, list }) => {
          if (turns.current.newest !== turn) return;
          // Merged onto the list as it is now, whatever changed it meanwhile.
          const now = held();
          const rows = page ?? list?.rows ?? [];
          adopt(
            forKey,
            now ? mergeNewest(now, rows) : (list ?? fromFirstPage(rows))
          );
          setShown((was) =>
            was.key === forKey ? { ...was, refreshing: false } : was
          );
        },
        (error) => {
          if (turns.current.newest !== turn) return;
          setShown((was) =>
            was.key === forKey
              ? { ...was, newestError: error, refreshing: false }
              : was
          );
        }
      );
    },
    [address, typeList, cache, adopt]
  );

  // Each list (and each window's cache) starts from what the cache keeps, or reads it.
  useEffect(() => {
    turns.current.newest += 1;
    turns.current.more += 1;
    if (!key) {
      base.current = { key: null, list: undefined };
      setShown(nothing(null));
      return;
    }
    const kept = cache.peek<AccountTxList>(key);
    base.current = { key, list: kept };
    setShown(nothing(key, kept));
    if (!kept) readNewest(key);
    // Only for a new key or cache: readNewest follows them.
  }, [key, cache]);

  // Refresh: the newest page again, merged onto what is on screen; an older
  // page that failed is no longer said to (reading on tries it again).
  const seenVersion = useRef(version);
  useEffect(() => {
    if (seenVersion.current === version) return;
    seenVersion.current = version;
    if (!key) return;
    setShown((was) =>
      was.key === key && was.moreError ? { ...was, moreError: null } : was
    );
    readNewest(key);
  }, [version, key, readNewest]);

  // Anything still on its way when the part goes is dropped.
  useEffect(
    () => () => {
      turns.current.newest += 1;
      turns.current.more += 1;
    },
    []
  );

  const moreBusy = useRef(false);
  /** The next older page may go past the tabs' ceiling, up to the list's own (readOn). */
  const onward = useRef(false);
  const showMore = useCallback(() => {
    if (!key || moreBusy.current) return;
    const forKey = key;
    const from = base.current.key === forKey ? base.current.list : undefined;
    const past = onward.current;
    onward.current = false;
    if (!from || !(past ? canReadOn(from) : canReadMore(from))) return;
    const turn = ++turns.current.more;
    const offset = from.nextOffset;
    const epoch = from.epoch;
    // At the Explorer's most: one row says whether the account has more.
    const check = past && needsCheck(from);
    moreBusy.current = true;
    setShown((was) =>
      was.key === forKey ? { ...was, moreLoading: true, moreError: null } : was
    );
    const done = (patch: Partial<Shown>) => {
      if (turns.current.more !== turn) return;
      moreBusy.current = false;
      setShown((was) =>
        was.key === forKey ? { ...was, moreLoading: false, ...patch } : was
      );
    };
    readTxPage(address, typeList, offset, check ? 1 : undefined).then(
      (page) => {
        if (turns.current.more !== turn) return;
        // Added to the list as it is now, if the page still follows on from it.
        const now = base.current.key === forKey ? base.current.list : undefined;
        if (now) {
          const merged = check
            ? mergeChecked(now, page, offset, epoch)
            : mergeOlderAt(now, page, offset, epoch);
          if (merged !== now) adopt(forKey, merged);
        }
        done({});
      },
      (error) => done({ moreError: error })
    );
  }, [key, address, typeList, adopt]);
  const readOn = useCallback(() => {
    onward.current = true;
    showMore();
  }, [showMore]);

  const raise = useCallback(
    (max: number) => {
      if (!key) return;
      const now = base.current.key === key ? base.current.list : undefined;
      if (!now) return;
      const raised = withCeiling(now, max);
      if (raised !== now) adopt(key, raised);
    },
    [key, adopt]
  );

  // A list that changed went with its Show more.
  useEffect(() => {
    moreBusy.current = false;
  }, [key, cache]);

  const retry = useCallback(() => {
    if (key) readNewest(key);
  }, [key, readNewest]);

  const current =
    shown.key === key
      ? shown
      : nothing(key, key ? cache.peek<AccountTxList>(key) : undefined);
  return {
    list: current.list,
    error: current.newestError,
    retry,
    refreshing: current.refreshing,
    more: { loading: current.moreLoading, error: current.moreError },
    showMore,
    readOn,
    raise,
  };
}
