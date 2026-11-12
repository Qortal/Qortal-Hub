import {
  WIDGET_IDENTIFIER_PREFIX,
  homeWidgetKey,
  toWidgetListing,
  type HomeWidgetListing,
  type QdnAppResource,
} from './homeWidgets';

/**
 * The widgets published on QDN, for the picker: APP resources tagged
 * `go-widget`. Two searches, side by side:
 *
 * - by identifier prefix (`go-widget…`): Core filters it on the node, so the
 *   answer is small and quick (retired widgets in it, untagged, are left out);
 * - every APP resource with its metadata, for widgets under other
 *   identifiers (Core's search has no tag filter).
 *
 * Either one failing still shows what the other found. Blocked names are left
 * out by the node (excludeblocked). Kept for a few minutes per node, so the
 * picker opening again shows the list at once.
 */
const CACHE_MS = 10 * 60_000;

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const cache = new Map<string, { at: number; widgets: HomeWidgetListing[] }>();

export const widgetSearchUrls = (baseUrl: string) => {
  const common =
    'service=APP&mode=ALL&limit=0&includemetadata=true&excludeblocked=true';
  return {
    byIdentifier: `${baseUrl}/arbitrary/resources/search?${common}&identifier=${encodeURIComponent(
      WIDGET_IDENTIFIER_PREFIX
    )}&prefix=true`,
    byTag: `${baseUrl}/arbitrary/resources/search?${common}`,
  };
};

const fetchList = async (
  fetcher: Fetcher,
  url: string,
  signal?: AbortSignal
): Promise<QdnAppResource[]> => {
  const response = await fetcher(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
};

/** Newest first; one entry per widget (the newest version). */
export const mergeWidgetResults = (
  ...lists: Array<readonly QdnAppResource[]>
): HomeWidgetListing[] => {
  const byKey = new Map<string, HomeWidgetListing>();
  for (const list of lists) {
    for (const resource of list) {
      const listing = toWidgetListing(resource);
      if (!listing) continue;
      const key = homeWidgetKey(listing);
      const known = byKey.get(key);
      if (!known || listing.updated > known.updated) byKey.set(key, listing);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => b.updated - a.updated || a.title.localeCompare(b.title)
  );
};

export async function fetchHomeWidgets(
  baseUrl: string,
  {
    fetcher = (url, init) => fetch(url, init),
    signal,
    fresh = false,
    now = Date.now(),
  }: {
    fetcher?: Fetcher;
    signal?: AbortSignal;
    /** Ask the node again even if a recent answer is kept. */
    fresh?: boolean;
    now?: number;
  } = {}
): Promise<HomeWidgetListing[]> {
  const cached = cache.get(baseUrl);
  if (!fresh && cached && now - cached.at < CACHE_MS) return cached.widgets;

  const urls = widgetSearchUrls(baseUrl);
  const [byIdentifier, byTag] = await Promise.allSettled([
    fetchList(fetcher, urls.byIdentifier, signal),
    fetchList(fetcher, urls.byTag, signal),
  ]);
  if (byIdentifier.status === 'rejected' && byTag.status === 'rejected') {
    throw byTag.reason ?? byIdentifier.reason;
  }
  const widgets = mergeWidgetResults(
    byIdentifier.status === 'fulfilled' ? byIdentifier.value : [],
    byTag.status === 'fulfilled' ? byTag.value : []
  );
  // Only a full answer with widgets in it is kept: a half one, or none yet
  // (a widget published a minute ago), is asked again next time.
  if (
    byIdentifier.status === 'fulfilled' &&
    byTag.status === 'fulfilled' &&
    widgets.length > 0
  ) {
    cache.set(baseUrl, { at: now, widgets });
  }
  return widgets;
}

export const clearHomeWidgetCacheForTests = () => cache.clear();
