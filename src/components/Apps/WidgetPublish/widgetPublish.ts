import {
  WIDGET_IDENTIFIER_PREFIX,
  WIDGET_TAG,
} from '../../HomeWidgets/homeWidgets';

/**
 * Publishing a Q-App as a widget from the publish form, the way Qortal Hub's
 * Home and Qortal GO's widgets screen find widgets (docs/home-widgets.md): an
 * APP resource under the identifier `go-widget-<slug>`, tagged `go-widget`.
 * The identifier lets a name publish widgets next to its own app, and lets
 * Core find them by prefix on the node; the tag is what lists them.
 */

/** What the form puts before the ID the user types. */
export const WIDGET_ID_PREFIX = `${WIDGET_IDENTIFIER_PREFIX}-`;

/** Core keeps identifiers up to 64 characters. */
const IDENTIFIER_MAX_LENGTH = 64;
export const WIDGET_SLUG_MAX_LENGTH =
  IDENTIFIER_MAX_LENGTH - WIDGET_ID_PREFIX.length;

/** The widget lists show about this many characters of a title. */
export const WIDGET_TITLE_SUGGESTED_MAX = 24;

/** The tags a widget can carry besides `go-widget` (Core keeps five). */
export const WIDGET_OWN_TAG_COUNT = 4;

const VALID_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * What the ID field keeps of what is typed or pasted: lowercase letters,
 * digits and single dashes, without accents. A pasted full identifier loses
 * its `go-widget-`. A dash at the end stays while typing ("my-" before
 * "my-clock"); `finalWidgetSlug` drops it.
 */
export const cleanWidgetSlug = (input: string): string =>
  String(input ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .replace(new RegExp(`^${WIDGET_ID_PREFIX}`), '')
    .slice(0, WIDGET_SLUG_MAX_LENGTH);

/** The slug as it is published: no dash at the end. */
export const finalWidgetSlug = (slug: string): string =>
  cleanWidgetSlug(slug).replace(/-+$/, '');

export const isValidWidgetSlug = (slug: string): boolean =>
  slug.length > 0 &&
  slug.length <= WIDGET_SLUG_MAX_LENGTH &&
  VALID_SLUG.test(slug);

/** The identifier for `slug`, or '' while the slug isn't valid. */
export const widgetIdentifier = (slug: string): string => {
  const final = finalWidgetSlug(slug);
  return isValidWidgetSlug(final) ? `${WIDGET_ID_PREFIX}${final}` : '';
};

const isWidgetTag = (tag: string) => tag.trim().toLowerCase() === WIDGET_TAG;

/** The tags without `go-widget`: what the form lets the user edit. */
export const withoutWidgetTag = (tags: readonly string[]): string[] =>
  tags.filter((tag) => !isWidgetTag(tag));

/**
 * The five tag slots of a widget publish: `go-widget` first, then the user's
 * own tags that are filled in, in order.
 */
export const widgetPublishTags = (ownTags: readonly string[]): string[] => {
  const tags = [
    WIDGET_TAG,
    ...ownTags
      .map((tag) => tag.trim())
      .filter((tag) => tag && !isWidgetTag(tag))
      .slice(0, WIDGET_OWN_TAG_COUNT),
  ];
  return [...tags, ...Array(5 - tags.length).fill('')];
};

/** A widget the name has published already. */
export interface NameWidget {
  identifier: string;
  title: string;
  updated: number;
  /** Tagged `go-widget`: in the lists. A retired widget isn't. */
  listed: boolean;
}

export const nameWidgetsUrl = (baseUrl: string, name: string): string => {
  const params = new URLSearchParams({
    service: 'APP',
    name,
    exactmatchnames: 'true',
    identifier: WIDGET_IDENTIFIER_PREFIX,
    prefix: 'true',
    includemetadata: 'true',
    mode: 'ALL',
    limit: '0',
  });
  return `${baseUrl}/arbitrary/resources/search?${params.toString()}`;
};

type SearchResult = {
  name?: unknown;
  service?: unknown;
  identifier?: unknown;
  metadata?: { title?: unknown; tags?: unknown } | null;
  created?: unknown;
  updated?: unknown;
};

/** The name's own widgets in a search answer, newest first, each once. */
export const nameWidgetsFrom = (
  results: unknown,
  name: string
): NameWidget[] => {
  if (!Array.isArray(results)) return [];
  const wanted = name.toLowerCase();
  const byIdentifier = new Map<string, NameWidget>();
  for (const result of results as SearchResult[]) {
    if (
      typeof result?.name !== 'string' ||
      result.name.toLowerCase() !== wanted ||
      (result.service != null && result.service !== 'APP') ||
      typeof result.identifier !== 'string' ||
      !result.identifier.startsWith(WIDGET_IDENTIFIER_PREFIX)
    ) {
      continue;
    }
    const title =
      typeof result.metadata?.title === 'string' && result.metadata.title.trim()
        ? result.metadata.title.trim()
        : result.identifier;
    const tags = result.metadata?.tags;
    const widget: NameWidget = {
      identifier: result.identifier,
      title,
      updated: Number(result.updated ?? result.created ?? 0) || 0,
      listed:
        Array.isArray(tags) &&
        tags.some((tag) => typeof tag === 'string' && isWidgetTag(tag)),
    };
    const known = byIdentifier.get(widget.identifier);
    if (!known || widget.updated > known.updated) {
      byIdentifier.set(widget.identifier, widget);
    }
  }
  return [...byIdentifier.values()].sort(
    (a, b) => b.updated - a.updated || a.identifier.localeCompare(b.identifier)
  );
};

type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal }
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/**
 * The widgets `name` has published, for the form's "Widget" choice. A failure
 * gives none (the form then offers a new widget only); an abort is passed on.
 */
export const loadNameWidgets = async (
  baseUrl: string,
  name: string,
  {
    fetchFn = fetch as unknown as FetchLike,
    signal,
  }: { fetchFn?: FetchLike; signal?: AbortSignal } = {}
): Promise<NameWidget[]> => {
  try {
    const response = await fetchFn(nameWidgetsUrl(baseUrl, name), { signal });
    if (!response.ok) return [];
    return nameWidgetsFrom(await response.json(), name);
  } catch (error) {
    if (signal?.aborted) throw error;
    return [];
  }
};
