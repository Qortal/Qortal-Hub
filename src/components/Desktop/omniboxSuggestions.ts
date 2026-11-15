import { QORTAL_PROTOCOL } from '../../constants/constants';
import {
  type PinnedApp,
  removeBrokenPinnedApps,
} from '../../utils/pinnedAppsSettings';
import { parseQortalUseGroupLink } from '../../utils/qortalGroupLinks';
import type { AppBookmark } from '../Apps/AppBookmarks/bookmarkTypes';
import { isAppStartBookmark } from '../Apps/AppsLauncher/launcherItems';
import { extractComponents } from '../Chat/MessageDisplay';
import { appOpenCountKey, type AppOpenCounts } from './appOpenCounts';
import {
  type AppSearchOption,
  appTitle,
  MAX_APP_SUGGESTIONS,
  rankAppSearchMatches,
  scoreAppSearchMatch,
  type SearchableApp,
} from './appSearchSuggestions';

/**
 * Everything the top bar suggests while the user types, in groups: the link
 * itself, open tabs, pinned apps and bookmarks, Q-Apps and websites, names,
 * then the row that searches the library. A Q-App or website shows once, in
 * the first group that has it.
 */

/** Open tab rows shown at most. */
export const MAX_TAB_SUGGESTIONS = 3;
/** Pinned app and bookmark rows shown at most, together. */
export const MAX_SAVED_SUGGESTIONS = 3;
/** Name rows shown at most. */
export const MAX_NAME_SUGGESTIONS = 3;
/** Names are looked up once typing stops for this long. */
export const NAME_SEARCH_DELAY_MS = 250;
/** Shorter text is not looked up as a name. */
export const NAME_SEARCH_MIN_LENGTH = 2;
/** Names asked of Core: more than are shown, as some are left out. */
export const NAME_SEARCH_LIMIT = 10;

/** A tab of the strip, as `setTabsToNav` tells the bar about it. */
export type OmniboxTab = {
  identifier?: string;
  internal?: string;
  isPrivate?: boolean;
  metadata?: { title?: unknown } | null;
  name?: string;
  privateAppProperties?: {
    appName?: string;
    identifier?: string;
    logo?: string | null;
    name?: string;
    service?: string;
  } | null;
  service?: string;
  tabId: string;
  [key: string]: unknown;
};

/** A qortal:// link typed in the bar. */
export type OmniboxLink =
  | { kind: 'group'; link: string }
  | {
      identifier?: string;
      kind: 'resource';
      link: string;
      name: string;
      path: string;
      service: string;
    };

export type OmniboxOption =
  | AppSearchOption
  | { bookmark: AppBookmark; kind: 'bookmark' }
  | { kind: 'link'; link: OmniboxLink }
  | {
      /** The name's Q-App, else its website: what the row opens. */
      app: SearchableApp | null;
      kind: 'name';
      name: string;
    }
  | { app: PinnedApp; kind: 'pinned'; title: string }
  | { kind: 'tab'; tab: OmniboxTab };

export type OmniboxGroup =
  | 'apps'
  | 'library'
  | 'link'
  | 'names'
  | 'saved'
  | 'tabs';

export type OmniboxSources = {
  /** The Q-Apps and websites the library has loaded. */
  apps: readonly SearchableApp[];
  bookmarks?: readonly AppBookmark[] | null;
  /** Names Core found for the text. */
  names?: readonly string[];
  /** The tab on screen: there is nothing to switch to. */
  onScreenTabId?: string | null;
  openCounts?: AppOpenCounts;
  pinnedApps?: readonly PinnedApp[] | null;
  tabs?: readonly OmniboxTab[] | null;
};

const PROTOCOL_PATTERN = /^qortal:\/\//i;

const asText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/**
 * The text as a qortal:// link, with the protocol in any case, or null. A
 * group link is kept whole, as Hub's group handlers read it.
 */
export const parseOmniboxLink = (input: string): OmniboxLink | null => {
  const text = (input ?? '').trim();
  if (!PROTOCOL_PATTERN.test(text)) return null;
  const link = QORTAL_PROTOCOL + text.replace(PROTOCOL_PATTERN, '');
  if (parseQortalUseGroupLink(link)) return { kind: 'group', link };
  const parts = extractComponents(link);
  if (!parts?.service || !parts?.name) return null;
  return {
    identifier: parts.identifier,
    kind: 'resource',
    link,
    name: parts.name,
    path: parts.path,
    service: parts.service,
  };
};

/** What a tab is called in the strip. */
export const omniboxTabTitle = (tab: OmniboxTab): string =>
  asText(tab?.privateAppProperties?.name) ||
  asText(tab?.metadata?.title) ||
  asText(tab?.name);

/** A tab that is no Q-App: Q-Chat. */
export const isInternalTab = (tab: OmniboxTab) =>
  !!tab?.internal || asText(tab?.service).toUpperCase() === 'INTERNAL';

/** A tab of a private app, which only its own copy can open again. */
export const isPrivateAppTab = (tab: OmniboxTab) =>
  !!tab?.isPrivate || !!tab?.privateAppProperties;

const privateAppKey = (
  properties:
    | { identifier?: unknown; name?: unknown; service?: unknown }
    | null
    | undefined
): string | null => {
  const service = asText(properties?.service).toUpperCase();
  const name = asText(properties?.name).toLowerCase();
  const identifier = asText(properties?.identifier);
  return service && name && identifier
    ? `PRIVATE:${service}:${name}:${identifier}`
    : null;
};

/** What a tab shows: the same key for the same app, whatever its page. */
const tabTargetKey = (tab: OmniboxTab): string | null => {
  if (isInternalTab(tab)) return `INTERNAL:${asText(tab.internal)}`;
  if (isPrivateAppTab(tab)) {
    return privateAppKey(tab.privateAppProperties ?? tab);
  }
  return appOpenCountKey(tab.service, tab.name);
};

const pinTargetKey = (app: PinnedApp): string | null =>
  app.isPrivate
    ? privateAppKey(app.privateAppProperties)
    : appOpenCountKey(app.service, app.name);

/** The open tab showing this private app, if one does. */
export const findPrivateAppTab = (
  tabs: readonly OmniboxTab[] | null | undefined,
  app: PinnedApp
): OmniboxTab | null => {
  const key = privateAppKey(app?.privateAppProperties);
  if (!key) return null;
  return (
    (tabs ?? []).find(
      (tab) => isPrivateAppTab(tab) && tabTargetKey(tab) === key
    ) ?? null
  );
};

/**
 * How well one of `texts` matches `query`, with the top bar's scoring for a
 * name or title: higher is better, 0 is no match.
 */
const scoreTexts = (texts: readonly unknown[], query: string): number => {
  let best = 0;
  for (const text of texts) {
    const value = asText(text);
    if (!value) continue;
    best = Math.max(
      best,
      scoreAppSearchMatch(
        { metadata: { title: value }, name: value, service: '' },
        query
      )
    );
  }
  return best;
};

/** Best match first; equal matches keep the order they came in. */
const byScore = <T extends { order: number; score: number }>(
  left: T,
  right: T
) => right.score - left.score || left.order - right.order;

/**
 * The rows for what the user typed, in their groups' order. None for an
 * empty input. A qortal:// link gives only its own row, or none when it
 * cannot be opened.
 */
export const buildOmniboxOptions = (
  input: string,
  {
    apps,
    bookmarks,
    names,
    onScreenTabId,
    openCounts = {},
    pinnedApps,
    tabs,
  }: OmniboxSources
): OmniboxOption[] => {
  const query = (input ?? '').trim();
  if (!query) return [];
  if (PROTOCOL_PATTERN.test(query)) {
    const link = parseOmniboxLink(query);
    return link ? [{ kind: 'link', link }] : [];
  }

  // What the rows already open: an app shows once, in its first group.
  const shown = new Set<string>();
  const options: OmniboxOption[] = [];

  const tabRows = (tabs ?? [])
    .map((tab, order) => ({
      order,
      score:
        tab?.tabId && tab.tabId !== onScreenTabId
          ? scoreTexts(
              [
                omniboxTabTitle(tab),
                tab.name,
                tab.privateAppProperties?.appName,
              ],
              query
            )
          : 0,
      tab,
    }))
    .filter(({ score }) => score > 0)
    .sort(byScore)
    .slice(0, MAX_TAB_SUGGESTIONS);
  for (const { tab } of tabRows) {
    const key = tabTargetKey(tab);
    if (key) shown.add(key);
    options.push({ kind: 'tab', tab });
  }

  const catalog = new Map<string, SearchableApp>();
  for (const app of apps ?? []) {
    const key = appOpenCountKey(app?.service, app?.name);
    if (key && !catalog.has(key)) catalog.set(key, app);
  }

  // Pins first among equal matches, then the bookmarks.
  const pins = removeBrokenPinnedApps(pinnedApps as PinnedApp[]);
  const savedRows = [
    ...pins.map((app, order) => {
      const catalogApp = app.isPrivate
        ? null
        : catalog.get(appOpenCountKey(app.service, app.name) ?? '');
      const title = app.isPrivate
        ? asText(app.privateAppProperties?.appName)
        : catalogApp
          ? appTitle(catalogApp)
          : asText(app.name);
      return {
        appKey: pinTargetKey(app),
        option: { app, kind: 'pinned', title } as OmniboxOption,
        order,
        score: app.isPrivate
          ? scoreTexts([title, app.privateAppProperties?.name], query)
          : scoreTexts([title, app.name], query),
        startsApp: true,
      };
    }),
    ...(bookmarks ?? [])
      .filter((bookmark) => bookmark?.service && bookmark?.appName)
      .map((bookmark, index) => ({
        appKey: appOpenCountKey(bookmark.service, bookmark.appName),
        option: { bookmark, kind: 'bookmark' } as OmniboxOption,
        order: pins.length + index,
        score: scoreTexts([bookmark.name, bookmark.appName], query),
        startsApp: isAppStartBookmark(bookmark),
      })),
  ]
    .filter(({ score }) => score > 0)
    .sort(byScore);
  let savedCount = 0;
  for (const row of savedRows) {
    if (savedCount >= MAX_SAVED_SUGGESTIONS) break;
    // A pin, or a bookmark of an app's start page, stands for the app and is
    // left out when the app is listed already. A bookmark of another page
    // is not the app itself.
    if (row.startsApp && row.appKey && shown.has(row.appKey)) continue;
    if (row.startsApp && row.appKey) shown.add(row.appKey);
    options.push(row.option);
    savedCount += 1;
  }

  const appRows = rankAppSearchMatches(query, apps ?? [], openCounts)
    .filter((app) => !shown.has(appOpenCountKey(app.service, app.name) ?? ''))
    .slice(0, MAX_APP_SUGGESTIONS);
  for (const app of appRows) {
    shown.add(appOpenCountKey(app.service, app.name) ?? '');
    options.push({ app, kind: 'app' });
  }

  // Names already listed as a Q-App or website are left out. Names found for
  // an older text are kept only while they still match.
  const seenNames = new Set<string>();
  const nameRows: { name: string; order: number; score: number }[] = [];
  (names ?? []).forEach((value, order) => {
    const name = asText(value);
    const lower = name.toLowerCase();
    if (!lower || seenNames.has(lower)) return;
    seenNames.add(lower);
    if (
      shown.has(appOpenCountKey('APP', name) ?? '') ||
      shown.has(appOpenCountKey('WEBSITE', name) ?? '')
    ) {
      return;
    }
    const score = scoreTexts([name], query);
    if (score > 0) nameRows.push({ name, order, score });
  });
  for (const { name } of nameRows
    .sort(byScore)
    .slice(0, MAX_NAME_SUGGESTIONS)) {
    const app =
      catalog.get(appOpenCountKey('APP', name) ?? '') ??
      catalog.get(appOpenCountKey('WEBSITE', name) ?? '') ??
      null;
    options.push({ app, kind: 'name', name });
  }

  options.push({ kind: 'library', query });
  return options;
};

/** The group a row is listed under. */
export const omniboxGroupOf = (option: OmniboxOption): OmniboxGroup => {
  switch (option.kind) {
    case 'app':
      return 'apps';
    case 'bookmark':
    case 'pinned':
      return 'saved';
    case 'link':
      return 'link';
    case 'name':
      return 'names';
    case 'tab':
      return 'tabs';
    default:
      return 'library';
  }
};

/** A key for each row, unique among the rows. */
export const omniboxOptionKey = (option: OmniboxOption): string => {
  switch (option.kind) {
    case 'app':
      return `${option.app.service}:${option.app.name}`;
    case 'bookmark':
      return `bookmark:${option.bookmark.id}`;
    case 'link':
      return `link:${option.link.link}`;
    case 'name':
      return `name:${option.name}`;
    case 'pinned':
      return `pinned:${pinTargetKey(option.app)}`;
    case 'tab':
      return `tab:${option.tab.tabId}`;
    default:
      return 'library';
  }
};

/** The app a row opens, with the key its tab would have. */
const optionTargetKey = (option: OmniboxOption): string | null => {
  switch (option.kind) {
    case 'app':
      return appOpenCountKey(option.app.service, option.app.name);
    case 'bookmark':
      return appOpenCountKey(option.bookmark.service, option.bookmark.appName);
    case 'link':
      return option.link.kind === 'resource'
        ? appOpenCountKey(option.link.service, option.link.name)
        : null;
    case 'name':
      return option.app
        ? appOpenCountKey(option.app.service, option.app.name)
        : null;
    case 'pinned':
      return pinTargetKey(option.app);
    case 'tab':
      return tabTargetKey(option.tab);
    default:
      return null;
  }
};

/**
 * The open tab that a row's Q-App or website is in, if any: a tab row's own
 * tab, else the first tab showing the same app.
 */
export const omniboxOptionOpenTab = (
  option: OmniboxOption,
  tabs: readonly OmniboxTab[] | null | undefined
): OmniboxTab | null => {
  if (option.kind === 'tab') return option.tab;
  const key = optionTargetKey(option);
  if (!key) return null;
  return (tabs ?? []).find((tab) => tabTargetKey(tab) === key) ?? null;
};

/**
 * Whether a row whose app is open can also open it in a new tab. Q-Chat and
 * a private app have the one tab only.
 */
export const canOpenInNewTab = (openTab: OmniboxTab | null): boolean =>
  !!openTab &&
  !isInternalTab(openTab) &&
  !isPrivateAppTab(openTab) &&
  !!appOpenCountKey(openTab.service, openTab.name);

/**
 * The page a tab shows, from its address bar link: the part after the app
 * (`post/abc`), or '' at its start page or for another app's link.
 */
export const omniboxTabPage = (
  tab: OmniboxTab,
  currentLink: unknown
): string => {
  const link = asText(currentLink);
  const service = asText(tab?.service).toUpperCase();
  const name = asText(tab?.name);
  if (!link || !service || !name) return '';
  const lowerLink = link.toLowerCase();
  const prefixes = [name, encodeURIComponent(name)].map((part) =>
    `${QORTAL_PROTOCOL}${service}/${part}`.toLowerCase()
  );
  const prefix = prefixes.find(
    (start) =>
      lowerLink === start ||
      lowerLink.startsWith(`${start}/`) ||
      lowerLink.startsWith(`${start}?`)
  );
  if (!prefix) return '';
  const page = link
    .slice(prefix.length)
    .replace(/^[/?]+/, '')
    .replace(/\/+$/, '');
  try {
    return decodeURIComponent(page);
  } catch {
    return page;
  }
};
