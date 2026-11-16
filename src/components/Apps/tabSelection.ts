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
 * Whether a tab stays open when it is closed along with others (Close all
 * tabs, Close other tabs, Close tabs to the right). A locked tab asks before
 * it closes, and a pinned tab closes only on its own, so both stay.
 */
export function staysOpenWithOthers(tab: SelectableTab): boolean {
  return !!tab?.lock || !!tab?.pinned;
}

/**
 * The tabs Close other tabs closes, from the menu of `tabId`: every other
 * tab but the pinned ones.
 */
export function otherTabIds<T extends SelectableTab>(
  tabs: T[],
  tabId: string
): string[] {
  return tabs
    .filter((tab) => tab?.tabId && tab.tabId !== tabId && !tab.pinned)
    .map((tab) => tab.tabId);
}

/**
 * The tabs Close tabs to the right closes, from the menu of `tabId`: the
 * tabs after it in the strip, but not the pinned ones.
 */
export function tabIdsToTheRight<T extends SelectableTab>(
  tabs: T[],
  tabId: string
): string[] {
  const index = tabs.findIndex((tab) => tab?.tabId === tabId);
  if (index === -1) return [];
  return tabs
    .slice(index + 1)
    .filter((tab) => tab?.tabId && !tab.pinned)
    .map((tab) => tab.tabId);
}

/**
 * The tab to show once some tabs have closed. The selected tab stays on
 * screen while it is open. If it closed, the most recently visited open tab
 * shows, else the open tab that was next to it on the right, else the one on
 * its left. Null when no tab was selected or none is left.
 */
export function tabToShowAfterClose<T extends { tabId: string }>(
  tabsBefore: T[],
  remainingTabs: T[],
  selectedTabId: string | null | undefined,
  mruIds: string[]
): T | null {
  if (!selectedTabId || !remainingTabs.length) return null;
  const stays = remainingTabs.find((tab) => tab.tabId === selectedTabId);
  if (stays) return stays;
  const recent = pickNextTabFromMru(remainingTabs, mruIds);
  if (recent) return recent;
  const open = new Set(remainingTabs.map((tab) => tab.tabId));
  const index = tabsBefore.findIndex((tab) => tab?.tabId === selectedTabId);
  if (index === -1) return remainingTabs[remainingTabs.length - 1];
  const onTheRight = tabsBefore
    .slice(index + 1)
    .find((tab) => open.has(tab?.tabId));
  if (onTheRight) return onTheRight;
  return (
    tabsBefore
      .slice(0, index)
      .reverse()
      .find((tab) => open.has(tab?.tabId)) ?? null
  );
}

/**
 * The note shown about the tabs a close of several left open, as an i18n
 * key, or null when it closed them all.
 */
export function keptOpenNoteKey(kept: SelectableTab[]): string | null {
  const hasPinned = kept.some((tab) => !!tab?.pinned);
  const hasLocked = kept.some((tab) => !!tab?.lock);
  if (hasPinned && hasLocked) return 'core:app_tab.pinned_and_locked_kept_open';
  if (hasPinned) return 'core:app_tab.pinned_kept_open';
  if (hasLocked) return 'core:app_tab.locked_kept_open';
  return null;
}
