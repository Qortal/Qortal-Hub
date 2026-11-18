/**
 * The launcher as a tab of its own. The strip's +, Ctrl+T and the Apps
 * buttons open it in the tab strip, as many times as wanted, and each launcher
 * tab keeps its own page (the launcher, an app's details, a category, the
 * publish form) while other tabs show. A Q-App or website opened from inside
 * a launcher tab opens in its place, as a page opened from a browser's new
 * tab does.
 *
 * In AppsDesktop's tab list a launcher tab is `{ tabId, internal: 'launcher',
 * service: 'INTERNAL' }`; its title is translated where it shows. Its page is
 * kept beside the list, by tab id (LauncherTabState). It can't be pinned, and
 * it isn't kept for a restart (tabSession.ts).
 */
import { createContext, useContext } from 'react';
import type { AppsLauncherRequest } from './AppsLauncher';
import { isLauncherSubPage } from './AppsLauncher/launcherRouting';
import { pickNextTabFromMru } from './tabSelection';

/** The `internal` mark of a launcher tab. */
export const LAUNCHER_INTERNAL_TAB_ID = 'launcher';

export type LauncherTab = {
  tabId: string;
  internal: typeof LAUNCHER_INTERNAL_TAB_ID;
  service: 'INTERNAL';
};

export const isLauncherTab = (tab: unknown): boolean =>
  !!tab &&
  typeof tab === 'object' &&
  (tab as { internal?: unknown }).internal === LAUNCHER_INTERNAL_TAB_ID;

export const newLauncherTab = (tabId: string): LauncherTab => ({
  tabId,
  internal: LAUNCHER_INTERNAL_TAB_ID,
  service: 'INTERNAL',
});

/** The published app, website or widget a publish page updates. */
export type PublishEditTarget = {
  name: string;
  service: 'APP' | 'WEBSITE';
  /**
   * One of the name's widgets: the APP under this identifier. Without it,
   * the name's own app or website.
   */
  identifier?: string;
};

/** A launcher tab's page: the launcher itself, or a page opened from it. */
export type LauncherPage =
  | 'launcher'
  | 'appInfo'
  | 'appInfo-from-category'
  | 'category'
  | 'publish'
  | 'publish-app'
  | 'publish-website'
  | 'publish-widget';

/** Which page a launcher tab is on, and what that page shows. */
export type LauncherTabState = {
  page: LauncherPage;
  /** The app or website the details page is about. */
  appInfo: any;
  /** The category the category page lists. */
  category: any;
  /** What the publish page updates; null for a new app or website. */
  publishEditTarget: PublishEditTarget | null;
  /** Starts the launcher over: at the top, with this search. */
  request: AppsLauncherRequest;
};

/** A new launcher tab: the launcher, with `query` in its search box. */
export const newLauncherTabState = (query = ''): LauncherTabState => ({
  page: 'launcher',
  appInfo: null,
  category: null,
  publishEditTarget: null,
  request: { nonce: 0, query },
});

export const isPublishPage = (page: string): boolean =>
  page === 'publish' ||
  page === 'publish-app' ||
  page === 'publish-website' ||
  page === 'publish-widget';

export const isAppInfoPage = (page: string): boolean =>
  page === 'appInfo' || page === 'appInfo-from-category';

/** An app's details, opened from the launcher or from a category page. */
export const showAppInfo = (
  state: LauncherTabState,
  app: any,
  fromCategory = false
): LauncherTabState => ({
  ...state,
  page: fromCategory ? 'appInfo-from-category' : 'appInfo',
  appInfo: app,
});

export const showCategory = (
  state: LauncherTabState,
  category: any
): LauncherTabState => ({ ...state, page: 'category', category });

/**
 * A publish page, as My apps opens it: to update a published app, website or
 * widget, or for a new one. Any other page is left alone.
 */
export const showPublishPage = (
  state: LauncherTabState,
  page: string,
  publishEditTarget: PublishEditTarget | null = null
): LauncherTabState =>
  isPublishPage(page)
    ? { ...state, page: page as LauncherPage, publishEditTarget }
    : state;

/** Whether the top bar's Back has a page to return to in this tab. */
export const canGoBackInLauncher = (
  state: LauncherTabState | null | undefined
): boolean => !!state && isLauncherSubPage(state.page);

/**
 * The top bar's Back: an app's details opened from a category return to it;
 * every other page returns to the launcher, as it was left.
 */
export const launcherPageBack = (state: LauncherTabState): LauncherTabState => {
  switch (state.page) {
    case 'appInfo-from-category':
      return { ...state, page: 'category' };
    case 'category':
      return { ...state, page: 'launcher', category: null };
    case 'appInfo':
      return { ...state, page: 'launcher' };
    case 'publish':
    case 'publish-app':
    case 'publish-website':
    case 'publish-widget':
      return { ...state, page: 'launcher', publishEditTarget: null };
    default:
      return state;
  }
};

/** The launcher again, started over with `query`, as a library search asks. */
export const restartLauncher = (
  state: LauncherTabState,
  query: string
): LauncherTabState => ({
  ...newLauncherTabState(query),
  request: { nonce: state.request.nonce + 1, query },
});

/**
 * The launcher tab the Apps buttons and a library search go to: the one on
 * screen, else the one viewed last, else the last in the strip; null when no
 * launcher tab is open.
 */
export function launcherTabToShow<T extends { tabId: string }>(
  tabs: T[],
  selectedTabId: string | null | undefined,
  mruIds: string[]
): T | null {
  const launcherTabs = tabs.filter(isLauncherTab);
  return (
    launcherTabs.find((tab) => tab.tabId === selectedTabId) ??
    pickNextTabFromMru(launcherTabs, mruIds) ??
    launcherTabs[launcherTabs.length - 1] ??
    null
  );
}

/** The states of the launcher tabs still open, the same object if all are. */
export function keepOpenLauncherStates(
  states: Record<string, LauncherTabState>,
  tabs: { tabId: string }[]
): Record<string, LauncherTabState> {
  const open = new Set(tabs.filter(isLauncherTab).map((tab) => tab.tabId));
  const ids = Object.keys(states);
  if (ids.every((tabId) => open.has(tabId))) return states;
  return Object.fromEntries(
    ids
      .filter((tabId) => open.has(tabId))
      .map((tabId) => [tabId, states[tabId]])
  );
}

/**
 * The launcher tab a part of the launcher is shown in, or null outside one.
 * What opens from inside a launcher tab opens in its place (AppsDesktop).
 */
export const LauncherTabContext = createContext<string | null>(null);

export const useLauncherTabId = () => useContext(LauncherTabContext);

/**
 * False inside a launcher tab while it is hidden. The tab stays mounted, so a
 * dialog opened in it would still show over the other tabs: it steps aside
 * (useLauncherTabDialog) and comes back as it was.
 */
export const LauncherTabShownContext = createContext(true);

/**
 * A dialog's `open` and `keepMounted` inside a launcher tab: while the tab is
 * hidden it is put away, with what it holds kept mounted, and it shows again
 * with the tab. Outside a launcher tab it is just `open`.
 */
export const useLauncherTabDialog = (open: boolean) => {
  const isTabShown = useContext(LauncherTabShownContext);
  return { open: open && isTabShown, keepMounted: open && !isTabShown };
};

/**
 * `addTab`'s data for a Q-App or website opened from inside a launcher tab:
 * it opens in that tab. Outside one the data is left as it is.
 */
export const inLauncherTab = <T extends object>(
  data: T,
  launcherTabId: string | null | undefined
): T | (T & { fromLauncherTabId: string }) =>
  launcherTabId ? { ...data, fromLauncherTabId: launcherTabId } : data;
