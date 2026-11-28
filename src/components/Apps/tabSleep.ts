/**
 * Sleeping tabs. Up to MAX_OPEN_APP_TABS tabs can be open, but at most
 * MAX_AWAKE_APP_TABS of them hold a loaded Q-App or website. When one more has
 * to load, the tab viewed least recently goes to sleep: its app is unloaded
 * (its webview goes) and the tab stays in the strip, dimmed. Selecting it
 * loads the app again, at the page it was on.
 *
 * A tab never sleeps while it is on screen, while its app asked to confirm
 * closing it (`lock`), while its app waits for Hub or saves a file
 * (tabActivity.ts), while sound plays in it (its webview says so), and never
 * when loading it again would not bring back the same app: a private app, a
 * copy the node built for this run (a preview), a Dev Mode tab. Launcher tabs and
 * Q-Chat's tab are Hub's own pages: they don't count, and never sleep.
 */
import { relativeAppPath, reportedAppPath } from './tabSession';

/** Tabs open at once, of every kind. */
export const MAX_OPEN_APP_TABS = 50;

/** Q-Apps and websites loaded at once: the tab limit before tabs could sleep. */
export const MAX_AWAKE_APP_TABS = 10;

type TabLike = Record<string, any>;

/**
 * A Q-App's, website's or Dev Mode preview's tab: it holds a webview. Hub's
 * own pages (a launcher tab, Q-Chat's tab) are `internal` tabs.
 */
export const holdsAnApp = (tab: unknown): tab is TabLike & { tabId: string } =>
  !!tab &&
  typeof tab === 'object' &&
  typeof (tab as TabLike).tabId === 'string' &&
  !(tab as TabLike).internal;

/**
 * Loading these again would not bring back what they showed, or would cost
 * a new download and decryption: a Dev Mode tab (no service; its page is
 * not on QDN), a private app and any other copy the node built for this run.
 */
export const neverSleeps = (tab: TabLike): boolean =>
  !tab.service || tab.isPrivate === true || !!tab.isPreview;

/**
 * The tabs to put to sleep so that at most `maxAwake` apps stay loaded, the
 * ones viewed least recently first. `awakeTabIds` are the loaded tabs, the one
 * about to load included; `recentTabIds` lists tab ids in the order they were
 * viewed, the last one most recently. `isBusy` is asked only of tabs that
 * could otherwise sleep, in that order, until enough are found. Fewer come
 * back when too few can sleep.
 */
export function tabsToPutToSleep({
  awakeTabIds,
  isBusy,
  maxAwake = MAX_AWAKE_APP_TABS,
  recentTabIds,
  shownTabId,
  tabs,
}: {
  awakeTabIds: ReadonlySet<string>;
  isBusy: (tab: TabLike) => boolean;
  maxAwake?: number;
  recentTabIds: readonly string[];
  shownTabId: string | null | undefined;
  tabs: readonly unknown[];
}): string[] {
  const awake = tabs.filter(
    (tab): tab is TabLike & { tabId: string } =>
      holdsAnApp(tab) && awakeTabIds.has(tab.tabId)
  );
  let excess = awake.length - maxAwake;
  if (excess <= 0) return [];
  // Never viewed (-1) counts as viewed longest ago.
  const viewedAt = (tabId: string) => recentTabIds.lastIndexOf(tabId);
  const candidates = awake
    .filter((tab) => tab.tabId !== shownTabId && !neverSleeps(tab) && !tab.lock)
    .sort((a, b) => viewedAt(a.tabId) - viewedAt(b.tabId));
  const sleepers: string[] = [];
  for (const tab of candidates) {
    if (excess <= 0) break;
    if (isBusy(tab)) continue;
    sleepers.push(tab.tabId);
    excess -= 1;
  }
  return sleepers;
}

/**
 * The tab as it goes to sleep: it loads again at the page its app showed
 * last (`currentLink`, the link its address bar showed), or where it was
 * opened when its app never said.
 */
export function tabAtItsPage<T extends TabLike>(tab: T, currentLink: unknown) {
  const reported = reportedAppPath(tab, currentLink);
  if (reported === undefined) return tab;
  const path = relativeAppPath(reported);
  if ((tab.path ?? '') === path) return tab;
  const { path: _path, ...rest } = tab;
  return (path ? { ...rest, path } : rest) as T;
}
