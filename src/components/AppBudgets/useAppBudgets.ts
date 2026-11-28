import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  appBudgetsOf,
  subscribeAppBudgets,
  type AppBudget,
} from '../../qortal/appBudgets';

/** The account's app budgets, kept up to date as requests use them. */
export function useAppBudgets(address: string | null | undefined): AppBudget[] {
  return useSyncExternalStore(
    subscribeAppBudgets,
    () => appBudgetsOf(address),
    () => appBudgetsOf(address)
  );
}

/**
 * The time now, taken again every `everyMs` while mounted, so a budget shown
 * as active turns to ended when its end date passes.
 */
export function useNow(everyMs = 30 * 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}
