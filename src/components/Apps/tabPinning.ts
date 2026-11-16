type PinnableTab = { tabId: string; pinned?: boolean };

export function isPinnedTab(tab: { pinned?: unknown } | null | undefined) {
  return !!tab?.pinned;
}

/** Pinned tabs first, each group keeping its own order. */
export function pinnedFirst<T extends PinnableTab>(tabs: T[]): T[] {
  const pinned = tabs.filter(isPinnedTab);
  if (!pinned.length) return tabs;
  const next = [...pinned, ...tabs.filter((tab) => !isPinnedTab(tab))];
  return next.every((tab, index) => tab === tabs[index]) ? tabs : next;
}

/**
 * Pins or unpins a tab. A tab being pinned goes to the end of the pinned
 * tabs, and a tab being unpinned to the start of the others, so it moves as
 * little as it can. An unpinned tab has no `pinned` key at all.
 */
export function setTabPinned<T extends PinnableTab>(
  tabs: T[],
  tabId: string,
  pinned: boolean
): T[] {
  const index = tabs.findIndex((tab) => tab?.tabId === tabId);
  if (index === -1 || isPinnedTab(tabs[index]) === pinned) return tabs;

  let changed: T;
  if (pinned) {
    changed = { ...tabs[index], pinned: true };
  } else {
    const { pinned: _wasPinned, ...rest } = tabs[index];
    changed = rest as T;
  }
  const others = pinnedFirst(tabs.filter((_, i) => i !== index));
  const pinnedCount = others.filter(isPinnedTab).length;
  return [
    ...others.slice(0, pinnedCount),
    changed,
    ...others.slice(pinnedCount),
  ];
}

/**
 * Moves a dragged tab to the place of the tab it was dropped on, but only
 * within its own group: a pinned tab can't go among the others, nor the
 * other way round.
 */
export function moveTabWithinGroup<T extends PinnableTab>(
  tabs: T[],
  activeId: string,
  overId: string
): T[] {
  const from = tabs.findIndex((tab) => tab?.tabId === activeId);
  const to = tabs.findIndex((tab) => tab?.tabId === overId);
  if (from === -1 || to === -1 || from === to) return tabs;
  if (isPinnedTab(tabs[from]) !== isPinnedTab(tabs[to])) return tabs;

  const next = [...tabs];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return pinnedFirst(next);
}
