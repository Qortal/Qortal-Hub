import { useCallback, useEffect, useRef, useState } from 'react';
import { getBaseApiReact } from '../../../App';
import { normalizeAppService } from './appPageIds';
import {
  AppPageResources,
  fetchAppPage,
  fetchShotsManifest,
  findAppPageResources,
} from './appPageQdn';
import type { AppPageData, ShotsManifest } from './appPageData';

const enc = encodeURIComponent;

/**
 * The app's listing as the node has it now: metadata, status, size and the
 * latest signature. A page opened from a link starts with only a name.
 */
export const useAppListing = (app: any) => {
  const [listing, setListing] = useState<any>(app);
  const [token, setToken] = useState(0);

  useEffect(() => {
    setListing(app);
  }, [app]);

  useEffect(() => {
    if (!app?.name) return;
    const controller = new AbortController();
    const service = normalizeAppService(app.service);
    const identifier = app.identifier || 'default';
    // mode=ALL: by default Core keeps only one resource per name and service.
    fetch(
      `${getBaseApiReact()}/arbitrary/resources/search?service=${service}` +
        `&name=${enc(app.name)}&exactmatchnames=true&includemetadata=true` +
        `&includestatus=true&mode=ALL&limit=20`,
      { signal: controller.signal }
    )
      .then((response) => (response.ok ? response.json() : []))
      .then((list) => {
        if (!Array.isArray(list)) return;
        const entry =
          list.find(
            (item) =>
              item?.name?.toLowerCase() === app.name.toLowerCase() &&
              (item.identifier || 'default') === identifier
          ) || null;
        if (!entry) return;
        // Core's search cache writes 'default' for the app's own resource;
        // the library opens it without an identifier, and so does the page.
        const { identifier: found, ...rest } = entry;
        setListing((previous: any) => ({
          ...previous,
          ...rest,
          identifier: found && found !== 'default' ? found : undefined,
          service,
          metadata: entry.metadata || previous?.metadata,
          status: entry.status || previous?.status,
        }));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [app?.name, app?.service, app?.identifier, token]);

  const reload = useCallback(() => setToken((value) => value + 1), []);
  return { listing, reload };
};

interface PageState {
  loading: boolean;
  shotsLoading: boolean;
  page: AppPageData | null;
  shots: ShotsManifest | null;
  resources: AppPageResources | null;
}

const pageCache = new Map<string, { at: number; state: PageState }>();
const PAGE_CACHE_MS = 60_000;

/** Forgets loaded pages (tests start each case clean). */
export const clearAppPageCache = () => pageCache.clear();

/** The publisher's page (About, What's new, links) and screenshots. */
export const useAppPageData = (app: { service?: string; name?: string }) => {
  const service = normalizeAppService(app?.service);
  const name = app?.name || '';
  const key = `${service}:${name.toLowerCase()}`;
  const cached = pageCache.get(key);
  const [state, setState] = useState<PageState>(
    cached?.state || {
      loading: !!name,
      shotsLoading: false,
      page: null,
      shots: null,
      resources: null,
    }
  );
  const [token, setToken] = useState(0);
  const forceRef = useRef(false);

  useEffect(() => {
    if (!name) return;
    const hit = pageCache.get(key);
    if (hit && !forceRef.current && Date.now() - hit.at < PAGE_CACHE_MS) {
      setState(hit.state);
      return;
    }
    forceRef.current = false;
    const controller = new AbortController();
    const { signal } = controller;
    const base = getBaseApiReact();
    const ref = { service, name };
    let current: PageState = {
      loading: true,
      shotsLoading: false,
      page: hit?.state.page ?? null,
      shots: hit?.state.shots ?? null,
      resources: hit?.state.resources ?? null,
    };
    const update = (patch: Partial<PageState>) => {
      current = { ...current, ...patch };
      setState(current);
    };
    update({});

    (async () => {
      try {
        const resources = await findAppPageResources(base, ref, signal);
        update({ resources, shotsLoading: !!resources.shots });
        const [page] = await Promise.all([
          resources.page
            ? fetchAppPage(base, ref, signal).catch(() => null)
            : Promise.resolve(null),
          (async () => {
            const shots = resources.shots
              ? await fetchShotsManifest(base, ref, signal).catch(() => null)
              : null;
            update({ shots, shotsLoading: false });
          })(),
        ]);
        update({ page, loading: false });
        pageCache.set(key, { at: Date.now(), state: current });
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return;
        update({ loading: false, shotsLoading: false });
      }
    })();
    return () => controller.abort();
  }, [key, name, service, token]);

  const reload = useCallback(() => {
    forceRef.current = true;
    pageCache.delete(key);
    setToken((value) => value + 1);
  }, [key]);

  return { ...state, reload };
};

const ownedNamesCache = new Map<string, string[]>();

/** Every name the address owns, so a publisher with several names is found. */
export const useOwnedNames = (address: string | undefined) => {
  const [names, setNames] = useState<string[]>(
    (address && ownedNamesCache.get(address)) || []
  );
  useEffect(() => {
    if (!address) {
      setNames([]);
      return;
    }
    const controller = new AbortController();
    fetch(`${getBaseApiReact()}/names/address/${enc(address)}?limit=0`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : []))
      .then((list) => {
        const owned = Array.isArray(list)
          ? list
              .map((item) => item?.name)
              .filter((name): name is string => typeof name === 'string')
          : [];
        ownedNamesCache.set(address, owned);
        setNames(owned);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [address]);
  return names;
};
