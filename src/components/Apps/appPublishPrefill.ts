/**
 * What the publish form fills in when the user picks a name: the metadata of
 * that name's own default APP or WEBSITE. Core matches a search's `name` as
 * "contains" and returns every identifier unless told otherwise, so the search
 * asks for the exact name's default resource, and the answer is checked again
 * here before anything goes into the form.
 */

export type PublishPrefill = {
  title: string;
  description: string;
  category: string;
  tags: string[];
};

export type PublishPrefillResult =
  /** The name's resource and its metadata. */
  | { kind: 'found'; prefill: PublishPrefill }
  /** The name has no resource of this service yet: a first publish. */
  | { kind: 'none' }
  /** The resource may exist, but its metadata couldn't be loaded. */
  | { kind: 'unavailable' };

export const EMPTY_PREFILL: PublishPrefill = {
  title: '',
  description: '',
  category: '',
  tags: [],
};

type ResourceMetadata = {
  title?: unknown;
  description?: unknown;
  category?: unknown;
  tags?: unknown;
};

type SearchResult = {
  name?: unknown;
  service?: unknown;
  identifier?: unknown;
  metadata?: ResourceMetadata | null;
};

export const buildPrefillSearchUrl = (
  baseUrl: string,
  service: string,
  name: string
): string => {
  const params = new URLSearchParams({
    service,
    name,
    exactmatchnames: 'true',
    default: 'true',
    includemetadata: 'true',
    mode: 'ALL',
    limit: '1',
  });
  return `${baseUrl}/arbitrary/resources/search?${params.toString()}`;
};

export const buildPrefillMetadataUrl = (
  baseUrl: string,
  service: string,
  name: string
): string =>
  `${baseUrl}/arbitrary/metadata/${encodeURIComponent(
    service
  )}/${encodeURIComponent(name)}/default`;

const isDefaultIdentifier = (identifier: unknown) =>
  identifier == null || identifier === '' || identifier === 'default';

/**
 * The search result that is `name`'s own default resource of `service`, or
 * null. Names are unique regardless of case, so case is ignored.
 */
export const findOwnDefaultResource = (
  results: unknown,
  service: string,
  name: string
): SearchResult | null => {
  if (!Array.isArray(results)) return null;
  const wanted = name.toLowerCase();
  return (
    results.find(
      (result: SearchResult) =>
        typeof result?.name === 'string' &&
        result.name.toLowerCase() === wanted &&
        (result.service == null || result.service === service) &&
        isDefaultIdentifier(result.identifier)
    ) ?? null
  );
};

/** Tags as Core stores them (an array) or as older apps sent them (a string). */
export const tagsFromMetadata = (rawTags: unknown): string[] => {
  if (Array.isArray(rawTags)) {
    return rawTags.filter((tag): tag is string => typeof tag === 'string');
  }
  if (typeof rawTags === 'string') {
    return rawTags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
};

const text = (value: unknown) => (typeof value === 'string' ? value : '');

export const prefillFromMetadata = (
  metadata: ResourceMetadata | null | undefined
): PublishPrefill => ({
  title: text(metadata?.title),
  description: text(metadata?.description),
  category: text(metadata?.category),
  tags: tagsFromMetadata(metadata?.tags),
});

const hasMetadata = (metadata: unknown): metadata is ResourceMetadata =>
  !!metadata && typeof metadata === 'object' && !Array.isArray(metadata);

type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal }
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/**
 * Loads what to fill in for `name`'s default `service` resource. An abort is
 * passed on as a rejection; any other failure is reported as 'unavailable'.
 */
export const loadPublishPrefill = async (
  baseUrl: string,
  service: string,
  name: string,
  {
    fetchFn = fetch as unknown as FetchLike,
    signal,
  }: { fetchFn?: FetchLike; signal?: AbortSignal } = {}
): Promise<PublishPrefillResult> => {
  let resource: SearchResult | null;
  try {
    const response = await fetchFn(
      buildPrefillSearchUrl(baseUrl, service, name),
      { signal }
    );
    if (!response.ok) return { kind: 'unavailable' };
    resource = findOwnDefaultResource(await response.json(), service, name);
  } catch (error) {
    if (signal?.aborted) throw error;
    return { kind: 'unavailable' };
  }
  if (!resource) return { kind: 'none' };
  if (hasMetadata(resource.metadata)) {
    return { kind: 'found', prefill: prefillFromMetadata(resource.metadata) };
  }

  // The node knows the resource but hasn't got its metadata file yet.
  try {
    const response = await fetchFn(
      buildPrefillMetadataUrl(baseUrl, service, name),
      { signal }
    );
    if (response.ok) {
      const metadata = await response.json();
      if (hasMetadata(metadata)) {
        return { kind: 'found', prefill: prefillFromMetadata(metadata) };
      }
    }
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  return { kind: 'unavailable' };
};
