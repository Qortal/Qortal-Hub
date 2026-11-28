/**
 * The account's All list as the Overview holds it (`txlist:all:<address>`,
 * lib/explorer/accountTx.ts): one list for its Latest transactions, its
 * QORT figures and its Activity, and the same entry of the window's cache
 * the Transactions tab's All list is, so nothing they show is read twice.
 * The Overview holds it while it is on screen; the tab takes it from the
 * cache, as left.
 *
 * - Read once one of them nears the screen (`enabled`): its newest 100.
 * - For a viewer who sees the detailed parts (`deep`), it reads on by
 *   itself, 100 at a time, up to the first read (`firstRead`: the Activity
 *   settings, 1,000 by default). Read older (as many more) and Read the
 *   rest (all of it) read on, up to ACCOUNT_HISTORY_MAX, raising the list's
 *   own ceiling; how far was asked for belongs to the history step, so
 *   switching tabs and Back keep it. A read that failed stops it, until
 *   Retry or Refresh. Nothing polls.
 * - It reads on until it holds what was asked for, the node has no more,
 *   or it is at ACCOUNT_HISTORY_MAX and a read showed there are more:
 *   `reading` is never true without a read on its way or about to start.
 * - Its whole history is held once the node has no older rows, or its
 *   oldest row held is the account's first transaction (`firstSignature`:
 *   when it was first seen), as with exactly 1,000 transactions.
 * - For anyone else it is the newest page only, as Latest transactions
 *   always read it.
 */
import { useCallback, useEffect } from 'react';
import {
  ACCOUNT_HISTORY_MAX,
  canReadOn,
  historyAtCeiling,
  maxOf,
  needsCheck,
} from '../../../lib/explorer/accountTx';
import { useStepState } from '../ExplorerContext';
import {
  useAccountTxList,
  type AccountTxListState,
} from '../transactions/useAccountTxList';

export interface AccountHistory extends AccountTxListState {
  /** How many rows it reads up to (by itself, or as asked). */
  target: number;
  /** It reads on now, or is about to (`deep` only). */
  reading: boolean;
  /** Read as many older as the first read again. */
  readMore: () => void;
  /** Read all of it (up to ACCOUNT_HISTORY_MAX). */
  readAll: () => void;
  /** Read the older page that failed again. */
  retryMore: () => void;
  /** Every row the account has is held: its whole history. */
  whole: boolean;
  /** It stopped at the Explorer's most, and the node has more. */
  atCeiling: boolean;
}

interface Goal {
  address: string;
  firstRead: number;
  target: number;
}

export function useAccountHistory(
  address: string,
  {
    enabled,
    deep,
    firstRead,
    firstSignature,
  }: {
    enabled: boolean;
    deep: boolean;
    firstRead: number;
    /** The account's first transaction, once known (null: it has none). */
    firstSignature?: string | null;
  }
): AccountHistory {
  const state = useAccountTxList(address, [], { enabled });
  const { list, more, readOn, raise } = state;
  const [goal, setGoal] = useStepState<Goal | null>('historyGoal', null);
  // Another account, or the setting changed: its own first read again.
  const target = Math.min(
    ACCOUNT_HISTORY_MAX,
    goal && goal.address === address && goal.firstRead === firstRead
      ? goal.target
      : firstRead
  );
  const rows = list?.rows;
  const held = rows?.length ?? 0;
  const whole =
    Boolean(list?.done) ||
    (Boolean(firstSignature) &&
      held > 0 &&
      rows?.[held - 1]?.signature === firstSignature);
  const wants =
    deep &&
    Boolean(list) &&
    !whole &&
    !more.error &&
    (held < target || needsCheck(list));

  // Runs again when a page lands and when its read ends, so the next one starts.
  useEffect(() => {
    if (!wants || !list || more.loading) return;
    // More than the list holds was asked for: its ceiling first (the list changes, and this runs again).
    if (maxOf(list) < target) {
      raise(target);
      return;
    }
    if (canReadOn(list)) readOn();
  }, [wants, list, more.loading, target, raise, readOn]);

  const readMore = useCallback(
    () =>
      setGoal({
        address,
        firstRead,
        target: Math.min(
          ACCOUNT_HISTORY_MAX,
          Math.max(target, held) + firstRead
        ),
      }),
    [setGoal, address, firstRead, target, held]
  );
  const readAll = useCallback(
    () => setGoal({ address, firstRead, target: ACCOUNT_HISTORY_MAX }),
    [setGoal, address, firstRead]
  );

  return {
    ...state,
    target,
    reading: wants || (deep && more.loading),
    readMore,
    readAll,
    retryMore: readOn,
    whole,
    atCeiling: Boolean(list && !whole && historyAtCeiling(list)),
  };
}
