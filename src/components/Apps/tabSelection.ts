type SelectableTab = { tabId: string; lock?: unknown; pinned?: unknown };

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
 * What Close All leaves open. A locked tab asks before it closes, and a pinned
 * tab closes only once it is unpinned, so both stay; the tab to show is the
 * selected one if it stays, else the most recently visited one that stays,
 * else the first.
 */
export function tabsLeftByCloseAll<T extends SelectableTab>(
  tabs: T[],
  selectedTabId: string | null | undefined,
  mruIds: string[]
): { kept: T[]; nextTab: T | null } {
  const kept = tabs.filter((tab) => !!tab?.lock || !!tab?.pinned);
  if (!kept.length) return { kept, nextTab: null };
  const nextTab =
    kept.find((tab) => tab.tabId === selectedTabId) ??
    pickNextTabFromMru(kept, mruIds) ??
    kept[0];
  return { kept, nextTab };
}

/**
 * The note Close All shows about the tabs it left open, as an i18n key, or
 * null when it closed them all.
 */
export function closeAllKeptNoteKey(kept: SelectableTab[]): string | null {
  const hasPinned = kept.some((tab) => !!tab?.pinned);
  const hasLocked = kept.some((tab) => !!tab?.lock);
  if (hasPinned && hasLocked) return 'core:app_tab.pinned_and_locked_kept_open';
  if (hasPinned) return 'core:app_tab.pinned_kept_open';
  if (hasLocked) return 'core:app_tab.locked_kept_open';
  return null;
}
