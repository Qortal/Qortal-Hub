import { atom } from 'jotai';
import {
  WIDGET_IDENTIFIER_PREFIX,
  hasWidgetTag,
  homeWidgetKey,
  type HomeWidgetListing,
  type QdnAppResource,
  widgetListingOf,
} from '../../HomeWidgets/homeWidgets';
import { type LibraryWidget, toLibraryWidget } from './widgetLibrary';

/**
 * The widgets the account's names have published, for My apps
 * (docs/home-widgets.md). Every APP of each name is asked for, since a widget
 * may sit under any identifier and Core can't search by tag:
 *
 * - tagged `go-widget`, it is a widget, listed for everyone; the name's own
 *   app can be one too, and then also shows under the apps;
 * - under a `go-widget` identifier without the tag, its publisher retired it:
 *   only they see it, here, so they can update it or list it again.
 */
export interface OwnWidget extends LibraryWidget {
  /** Tagged go-widget: in the widget lists. A retired widget isn't. */
  listed: boolean;
}

export const ownWidgetsUrl = (baseUrl: string, name: string): string => {
  const params = new URLSearchParams({
    service: 'APP',
    name,
    exactmatchnames: 'true',
    includemetadata: 'true',
    mode: 'ALL',
    limit: '0',
  });
  return `${baseUrl}/arbitrary/resources/search?${params.toString()}`;
};

const lowerNames = (names: readonly string[]) =>
  new Set(names.map((name) => name.toLowerCase()));

/** Newest first; titles in order for the same time. */
const newestFirst = (a: OwnWidget, b: OwnWidget) =>
  b.updated - a.updated || a.title.localeCompare(b.title);

/** `resource` as a widget of one of `names` (lowercase), or null. */
const toOwnWidget = (
  resource: QdnAppResource,
  names: ReadonlySet<string>
): OwnWidget | null => {
  const listing = widgetListingOf(resource);
  if (!listing || !names.has(listing.name.toLowerCase())) return null;
  const listed = hasWidgetTag(resource.metadata?.tags);
  const retired =
    !listed &&
    !!listing.identifier &&
    listing.identifier.startsWith(WIDGET_IDENTIFIER_PREFIX);
  if (!listed && !retired) return null;
  return { ...toLibraryWidget(listing), listed };
};

/** The widgets of `names` in the node's answers, newest first, each once. */
export const ownWidgetsFrom = (
  results: readonly unknown[],
  names: readonly string[]
): OwnWidget[] => {
  const wanted = lowerNames(names);
  const byKey = new Map<string, OwnWidget>();
  for (const result of results) {
    if (!result || typeof result !== 'object') continue;
    const widget = toOwnWidget(result as QdnAppResource, wanted);
    if (!widget) continue;
    const key = homeWidgetKey(widget);
    const known = byKey.get(key);
    if (!known || widget.updated > known.updated) byKey.set(key, widget);
  }
  return [...byKey.values()].sort(newestFirst);
};

/** Never shown: My apps says the widgets couldn't be loaded, with Retry. */
const OWN_WIDGETS_UNAVAILABLE = 'OWN_WIDGETS_UNAVAILABLE';

type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal }
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/**
 * The widgets `names` have published. It throws when the node can't answer
 * for one of the names: an answer that isn't a list is no answer either, so a
 * failed search is never taken for "no widgets".
 */
export const loadOwnWidgets = async (
  baseUrl: string,
  names: readonly string[],
  {
    fetchFn = fetch as unknown as FetchLike,
    signal,
  }: { fetchFn?: FetchLike; signal?: AbortSignal } = {}
): Promise<OwnWidget[]> => {
  const answers = await Promise.all(
    names.map(async (name) => {
      const response = await fetchFn(ownWidgetsUrl(baseUrl, name), {
        signal,
      });
      if (!response.ok) throw new Error(OWN_WIDGETS_UNAVAILABLE);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error(OWN_WIDGETS_UNAVAILABLE);
      return data as unknown[];
    })
  );
  return ownWidgetsFrom(answers.flat(), names);
};

/**
 * How long a widget published from this Hub is shown from what was published:
 * the node lists it once its transaction is confirmed, usually within a minute
 * or two. A publish that never makes it is no longer shown after this.
 */
export const PUBLISHED_OWN_WIDGET_WAIT_MS = 15 * 60_000;

/** A widget just published from this Hub, as the form published it. */
export interface PublishedOwnWidget extends HomeWidgetListing {
  publishedAt: number;
  /**
   * When the version it replaced was published, as the node had it (0 for a
   * new widget): the node's answer stands once it has a newer one.
   */
  replaces: number;
}

/**
 * The widgets published from this Hub lately. My apps shows each one at once,
 * from what the form published, until the node lists that version.
 */
export const publishedOwnWidgetsAtom = atom<PublishedOwnWidget[]>([]);

const waiting = (widget: PublishedOwnWidget, now: number) =>
  now - widget.publishedAt <= PUBLISHED_OWN_WIDGET_WAIT_MS;

/** `list` with `widget` just published, in place of an earlier entry for it. */
export const withPublishedOwnWidget = (
  list: readonly PublishedOwnWidget[],
  widget: HomeWidgetListing,
  { replaces = 0, now = Date.now() }: { replaces?: number; now?: number } = {}
): PublishedOwnWidget[] => {
  const key = homeWidgetKey(widget);
  // It replaces an earlier publish of it from here too, whatever version the
  // form was filled in from: the node listing that one doesn't overtake it.
  const earlier = list.find(
    (item) => homeWidgetKey(item) === key && waiting(item, now)
  );
  return [
    {
      ...widget,
      publishedAt: now,
      replaces: Math.max(replaces, earlier?.publishedAt ?? 0),
    },
    ...list.filter((item) => homeWidgetKey(item) !== key && waiting(item, now)),
  ];
};

/**
 * The widget published from here that stands in place of the node's version
 * of it, or null. `nodeUpdated`: when the node's version was published, 0
 * when it has none. The publish form fills in from it, so Update shows what
 * My apps shows.
 */
export const publishedOwnWidgetInPlace = (
  published: readonly PublishedOwnWidget[],
  widget: { name: string; identifier: string | null },
  nodeUpdated: number,
  now = Date.now()
): PublishedOwnWidget | null => {
  const name = widget.name.toLowerCase();
  return (
    published.find(
      (item) =>
        item.name.toLowerCase() === name &&
        item.identifier === widget.identifier &&
        waiting(item, now) &&
        !(nodeUpdated > item.replaces)
    ) ?? null
  );
};

/**
 * What My apps shows: the node's answer, and in place of it the widgets
 * published from here that it doesn't list in that version yet. Only `names`'
 * widgets: one published under another account never shows.
 */
export const withPublishedOwnWidgets = (
  fromNode: readonly OwnWidget[],
  published: readonly PublishedOwnWidget[],
  names: readonly string[],
  now = Date.now()
): OwnWidget[] => {
  const wanted = lowerNames(names);
  const byKey = new Map(
    fromNode.map((widget) => [homeWidgetKey(widget), widget] as const)
  );
  let changed = false;
  for (const item of published) {
    if (!waiting(item, now) || !wanted.has(item.name.toLowerCase())) continue;
    const key = homeWidgetKey(item);
    const known = byKey.get(key);
    if (known && known.updated > item.replaces) continue;
    const { publishedAt, replaces: _replaces, ...listing } = item;
    byKey.set(key, {
      ...toLibraryWidget({ ...listing, updated: publishedAt }),
      // Publishing adds the tag: it is listed again.
      listed: true,
    });
    changed = true;
  }
  return changed ? [...byKey.values()].sort(newestFirst) : [...fromNode];
};
