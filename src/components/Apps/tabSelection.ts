type SelectableTab = { tabId: string; lock?: unknown };

/** The most recently visited of `remainingTabs`, by the MRU list of tab ids. */
export function pickNextTabFromMru<T extends { tabId: string }>(
  remainingTabs: T[],
  mruIds: string[]
): T | null {
  if (!remainingTabs.length) return null;
  const ids = new Set(remainingTabs.map((t) => t.tabId));
  for (let i = mruIds.length - 1; i >= 0; i--) {
    const id = mruIds[i];
    if (ids.has(id)) {
      return remainingTabs.find((t) => t.tabId === id) ?? null;
    }
  }
  return null;
}

/**
 * What Close All leaves open. A locked tab asks before it closes, so it stays;
 * the tab to show is the selected one if it stays, else the most recently
 * visited one that stays, else the first.
 */
export function tabsLeftByCloseAll<T extends SelectableTab>(
  tabs: T[],
  selectedTabId: string | null | undefined,
  mruIds: string[]
): { kept: T[]; nextTab: T | null } {
  const kept = tabs.filter((tab) => !!tab?.lock);
  if (!kept.length) return { kept, nextTab: null };
  const nextTab =
    kept.find((tab) => tab.tabId === selectedTabId) ??
    pickNextTabFromMru(kept, mruIds) ??
    kept[0];
  return { kept, nextTab };
}
