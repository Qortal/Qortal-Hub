import { useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';
import type { TabShortcutAction } from '../../../electron/src/tab-shortcuts';
import { navigationControllerAtom } from '../../atoms/global';
import { appLockedAtom } from '../../atoms/presence';
import { executeEvent } from '../../utils/events';
import { extractComponents } from '../Chat/MessageDisplay';

/** A tab of the strip, as AppsDesktop keeps it. */
type StripTab = { tabId: string; [key: string]: any };

type QortalLink = {
  identifier?: string;
  name?: string;
  path?: string;
  service?: string;
};

/** Ctrl+Shift+T brings back up to this many closed tabs. */
export const MAX_CLOSED_TABS = 10;

export type ClosedTab = {
  /** What addTab needs to open the tab again. */
  data: Record<string, any>;
  /** The tab that was on its left, to reopen it in the same place. */
  afterTabId?: string;
};

/** Local dev and preview tabs have no service; Q-Chat's is INTERNAL. */
const isLocalDevTab = (tab: Record<string, any>) => !tab.service;

const isInternalTab = (tab: StripTab) =>
  !!tab.internal || tab.service === 'INTERNAL';

/**
 * The tab a switching shortcut shows, or null. Tabs go in the strip's order
 * and switching wraps around. With no tab on screen (Home, the new tab page),
 * the next tab is the first one and the previous tab the last one.
 */
export function tabForShortcut<T extends { tabId: string }>(
  tabs: T[],
  showingTabId: string | null,
  action: TabShortcutAction
): T | null {
  if (!tabs.length) return null;
  const index = tabs.findIndex((tab) => tab.tabId === showingTabId);
  switch (action.type) {
    case 'nextTab':
      return tabs[(index + 1) % tabs.length];
    case 'previousTab':
      return tabs[index <= 0 ? tabs.length - 1 : index - 1];
    case 'selectTab':
      return tabs[action.index] ?? null;
    case 'selectLastTab':
      return tabs[tabs.length - 1];
    default:
      return null;
  }
}

// Like Duplicate Tab, a Q-App comes back at the page it was showing. A local
// dev tab's link names a stand-in app, so that tab keeps its own fields. The
// id, the place in the strip and the lock belonged to the closed tab.
function reopenData(tab: StripTab, link: QortalLink | null) {
  const { afterTabId, lock, lockMessage, tabId, ...data } = tab;
  if (!link || data.internal || isLocalDevTab(data)) return data;
  return {
    ...data,
    identifier: link.identifier ?? data.identifier,
    name: link.name ?? data.name,
    path: link.path ?? data.path,
    service: link.service ?? data.service,
  };
}

/**
 * The tabs that left the strip between two renders, in the order to stack
 * them: the last one comes back first, so tabs closed together come back in
 * the strip's order.
 */
export function closedTabsBetween(
  previous: StripTab[],
  next: StripTab[],
  linkOf: (tabId: string) => QortalLink | null
): ClosedTab[] {
  const open = new Set(next.map((tab) => tab?.tabId));
  const closed: ClosedTab[] = [];
  previous.forEach((tab, index) => {
    if (!tab?.tabId || open.has(tab.tabId)) return;
    const leftTabId = previous[index - 1]?.tabId;
    closed.push({
      data: reopenData(tab, linkOf(tab.tabId)),
      ...(leftTabId && open.has(leftTabId) ? { afterTabId: leftTabId } : {}),
    });
  });
  return closed.reverse();
}

export function pushClosedTabs(
  stack: ClosedTab[],
  closed: ClosedTab[]
): ClosedTab[] {
  return closed.length ? [...stack, ...closed].slice(-MAX_CLOSED_TABS) : stack;
}

// The strip's own way to show a tab.
function showTab(tab: StripTab) {
  if (isLocalDevTab(tab)) {
    executeEvent('open-dev-mode', {});
    executeEvent('setSelectedTab', { data: tab, isDevMode: true });
    return;
  }
  executeEvent('open-apps-mode', {});
  executeEvent('setSelectedTab', { data: tab });
}

// A Hub dialog, such as a Q-App's request, is about what's on screen: closing
// or switching the tab under it would leave the dialog naming an app that's
// gone. The tabs stay put until it's answered.
const isHubDialogOpen = () =>
  !!document.querySelector('.MuiDialog-root:not(.MuiModal-hidden)');

// Keyboard focus stays where the shortcut was typed, often in the page of a
// tab that is about to be hidden, where further typing would go unseen.
function releaseFocus() {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) {
    active.blur();
  }
}

type TabShortcutsOptions = {
  /** The strip's tabs, in its order. */
  tabs: StripTab[];
  selectedTab: StripTab | null;
  /** Whether the Apps (or Dev) view is on screen. */
  show: boolean;
  /** Whether the new tab page is on screen instead of a tab. */
  isNewTabWindow: boolean;
  /** The most tabs the strip takes. */
  maxTabs: number;
  /** What the strip's + does. */
  openNewTab: () => void;
};

/**
 * Browser-style tab shortcuts: Ctrl+T, Ctrl+W, Ctrl+Shift+T, Ctrl+Tab,
 * Ctrl+1…9, Ctrl+L, Ctrl+R and F5 (Cmd on macOS). Electron main reads the
 * keys, inside Q-Apps too, and sends the action here
 * (electron/src/tab-shortcuts.ts). Each action goes the way of the strip's own
 * controls. Outside the desktop app (no window.electronAPI) nothing happens.
 */
export function useTabShortcuts({
  isNewTabWindow,
  maxTabs,
  openNewTab,
  selectedTab,
  show,
  tabs,
}: TabShortcutsOptions): void {
  const navigationController = useAtomValue(navigationControllerAtom);
  const isAppLocked = useAtomValue(appLockedAtom);
  const closedTabsRef = useRef<ClosedTab[]>([]);
  const previousTabsRef = useRef(tabs);

  // Tabs that leave the strip, however they were closed (×, Ctrl+W, Close
  // All), can come back with Ctrl+Shift+T.
  useEffect(() => {
    const closed = closedTabsBetween(previousTabsRef.current, tabs, (tabId) => {
      const link = navigationController?.[tabId]?.currentLink;
      return link ? extractComponents(link) : null;
    });
    previousTabsRef.current = tabs;
    closedTabsRef.current = pushClosedTabs(closedTabsRef.current, closed);
  }, [tabs]);

  useEffect(() => {
    const subscribe = window.electronAPI?.onTabShortcut;
    if (typeof subscribe !== 'function') return undefined;

    const stripTabs = tabs.filter((tab) => !!tab?.tabId);
    const showing =
      show && !isNewTabWindow && selectedTab?.tabId
        ? (stripTabs.find((tab) => tab.tabId === selectedTab.tabId) ?? null)
        : null;

    const reopenClosedTab = () => {
      const stack = closedTabsRef.current;
      const closed = stack[stack.length - 1];
      if (!closed) return;
      // At the limit, addTab only warns, so the tab stays in line for later.
      if (tabs.length < maxTabs) {
        closedTabsRef.current = stack.slice(0, -1);
        releaseFocus();
      }
      if (isLocalDevTab(closed.data)) {
        executeEvent('appsDevModeAddTab', { data: closed.data });
        return;
      }
      executeEvent('addTab', {
        data: closed.afterTabId
          ? { ...closed.data, afterTabId: closed.afterTabId }
          : closed.data,
      });
      executeEvent('open-apps-mode', {});
    };

    return subscribe((action) => {
      // Nothing changes behind the lock screen or under an open dialog.
      if (isAppLocked || isHubDialogOpen()) return;
      switch (action.type) {
        case 'newTab':
          releaseFocus();
          openNewTab();
          return;
        case 'closeTab':
          if (!showing) return;
          releaseFocus();
          // The ×'s way, so a locked tab asks before it closes.
          executeEvent('removeTab', { data: showing });
          return;
        case 'reopenClosedTab':
          reopenClosedTab();
          return;
        case 'focusSearch':
          executeEvent('focusNavInput', {});
          return;
        case 'reloadTab':
          if (!showing || isInternalTab(showing)) return;
          // What the top bar's reload button does.
          if (typeof showing.refreshFunc === 'function') {
            showing.refreshFunc(showing.tabId);
          } else {
            executeEvent('refreshApp', { tabId: showing.tabId });
          }
          return;
        default: {
          const tab = tabForShortcut(stripTabs, showing?.tabId ?? null, action);
          if (!tab || tab.tabId === showing?.tabId) return;
          releaseFocus();
          showTab(tab);
        }
      }
    });
  }, [
    isAppLocked,
    isNewTabWindow,
    maxTabs,
    openNewTab,
    selectedTab,
    show,
    tabs,
  ]);
}
