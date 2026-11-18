import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { getBaseApiReact } from '../../../App';
import { getPrimaryNamesForAddresses } from '../../Group/groupApi';
import { normalizeAppService } from './appPageIds';
import {
  AppPageResources,
  fetchAppPage,
  fetchHiddenState,
  fetchShotsManifest,
  findAppPageResources,
} from './appPageQdn';
import type { AppPageData, ShotsManifest } from './appPageData';
import type { AppHiddenState } from './appHidden';

const enc = encodeURIComponent;

/**
 * Whether the app's own listing entry is known: 'found' also when the page
 * was opened with it (from a library card); 'missing' when the node answered
 * without it.
 */
export type ListingStatus = 'loading' | 'found' | 'missing' | 'failed';

/**
 * The app's listing as the node has it now: metadata, status, size and the
 * latest signature. A page opened from a link starts with only a name.
 */
export const useAppListing = (app: any) => {
  const [listing, setListing] = useState<any>(app);
  const [status, setStatus] = useState<ListingStatus>(
    app?.metadata ? 'found' : 'loading'
  );
  const [token, setToken] = useState(0);

  useEffect(() => {
    setListing(app);
    setStatus(app?.metadata ? 'found' : 'loading');
  }, [app]);

  // Asked for again when the app is given again (a link to the page on
  // screen), or its status would stay at loading.
  useEffect(() => {
    if (!app?.name) return;
    const controller = new AbortController();
    const service = normalizeAppService(app.service);
    const identifier = app.identifier || 'default';
    // A listing found once stays known while it is asked for again.
    const unlessFound = (next: ListingStatus) =>
      setStatus((previous) => (previous === 'found' ? previous : next));
    unlessFound('loading');
    // mode=ALL: by default Core keeps only one resource per name and service.
    fetch(
      `${getBaseApiReact()}/arbitrary/resources/search?service=${service}` +
        `&name=${enc(app.name)}&exactmatchnames=true&includemetadata=true` +
        `&includestatus=true&mode=ALL&limit=20`,
      { signal: controller.signal }
    )
      .then((response) => {
        if (!response.ok) throw new Error(`search ${response.status}`);
        return response.json();
      })
      .then((list) => {
        if (!Array.isArray(list)) {
          unlessFound('failed');
          return;
        }
        const entry =
          list.find(
            (item) =>
              item?.name?.toLowerCase() === app.name.toLowerCase() &&
              (item.identifier || 'default') === identifier
          ) || null;
        if (!entry) {
          unlessFound('missing');
          return;
        }
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
        setStatus('found');
      })
      .catch(() => {
        if (!controller.signal.aborted) unlessFound('failed');
      });
    return () => controller.abort();
  }, [app, token]);

  const reload = useCallback(() => setToken((value) => value + 1), []);
  return { listing, status, reload };
};

interface PageState {
  loading: boolean;
  shotsLoading: boolean;
  page: AppPageData | null;
  shots: ShotsManifest | null;
  resources: AppPageResources | null;
  /** Whether its publisher hid it from the library (appHidden.ts). */
  hidden: AppHiddenState | null;
}

const pageCache = new Map<string, { at: number; state: PageState }>();
const PAGE_CACHE_MS = 60_000;

/** What the publisher hid or showed from here, and when. */
export interface SavedHiddenState {
  hidden: boolean;
  replaced: boolean;
  at: number;
}

// By app, beyond the page that published it: a page opened again before the
// node lists the new record still shows it, and doesn't offer it again.
// After ten minutes the node has the record, and its answer is the one shown.
const savedHiddenStates = new Map<string, SavedHiddenState>();
const SAVED_HIDDEN_MS = 10 * 60_000;
// Every page showing the app follows it: one in another launcher tab, or one
// opened while the publish was still going.
const savedHiddenListeners = new Set<() => void>();

const savedHiddenKey = (app: { service?: string; name?: string }) =>
  `${normalizeAppService(app?.service)}:${String(app?.name || '').toLowerCase()}`;

const subscribeSavedHidden = (listener: () => void) => {
  savedHiddenListeners.add(listener);
  return () => {
    savedHiddenListeners.delete(listener);
  };
};

const notifySavedHidden = () =>
  savedHiddenListeners.forEach((listener) => listener());

// How many times the app was hidden or shown from here: a hide window opened
// before the last change was opened for a state that is gone.
const hiddenStateChanges = new Map<string, number>();

/** Hiding or showing that is being published now, from any page or tab. */
export type HiddenStateRun = 'hide' | 'show';

// One at a time for each app, whichever page or launcher tab started it: the
// others wait, so nothing is published twice, for a second fee.
const hiddenStateRuns = new Map<string, { kind: HiddenStateRun }>();

/** How many times the app was hidden or shown from here so far. */
export const hiddenStateChangeCount = (app: {
  service?: string;
  name?: string;
}): number => hiddenStateChanges.get(savedHiddenKey(app)) ?? 0;

export const useHiddenStateChanges = (app: {
  service?: string;
  name?: string;
}): number => {
  const key = savedHiddenKey(app);
  return useSyncExternalStore(
    subscribeSavedHidden,
    () => hiddenStateChanges.get(key) ?? 0
  );
};

/**
 * Starts hiding or showing the app, unless that is being published already.
 * Gives what ends it, or null while another one goes on.
 */
export const claimHiddenStateRun = (
  app: { service?: string; name?: string },
  kind: HiddenStateRun
): (() => void) | null => {
  const key = savedHiddenKey(app);
  if (hiddenStateRuns.has(key)) return null;
  const run = { kind };
  hiddenStateRuns.set(key, run);
  notifySavedHidden();
  return () => {
    if (hiddenStateRuns.get(key) !== run) return;
    hiddenStateRuns.delete(key);
    notifySavedHidden();
  };
};

/** What is being published for the app now, from here or elsewhere. */
export const useHiddenStateRun = (app: {
  service?: string;
  name?: string;
}): HiddenStateRun | null => {
  const key = savedHiddenKey(app);
  return useSyncExternalStore(
    subscribeSavedHidden,
    () => hiddenStateRuns.get(key)?.kind ?? null
  );
};

/** What was hidden or shown from here for the app, in the last ten minutes. */
export const useSavedHiddenState = (app: {
  service?: string;
  name?: string;
}): SavedHiddenState | null => {
  const key = savedHiddenKey(app);
  const saved = useSyncExternalStore(
    subscribeSavedHidden,
    () => savedHiddenStates.get(key) ?? null
  );
  return saved && Date.now() - saved.at < SAVED_HIDDEN_MS ? saved : null;
};

export const rememberHiddenState = (
  app: { service?: string; name?: string },
  state: SavedHiddenState
) => {
  const key = savedHiddenKey(app);
  savedHiddenStates.set(key, state);
  hiddenStateChanges.set(key, (hiddenStateChanges.get(key) ?? 0) + 1);
  notifySavedHidden();
};

/** A hide and replace that stopped after publishing part of it. */
export interface UnfinishedHide {
  replace: boolean;
  /** The parts it published. */
  done: string[];
  /** The app's latest signature before it and its replacement's, if known. */
  versions?: { before: string; replacement: string };
}

// By app too: what it published can't be taken back, so the hide window goes
// on from there when it is opened again, also on a page opened again.
const unfinishedHides = new Map<string, UnfinishedHide>();

/**
 * Given the app's latest signature as the page lists it, a version that is
 * neither the one before the run nor its replacement means the app was
 * published again since: the run is over for that page. It stays remembered,
 * as another page of the app may list an older version than the run's.
 */
export const unfinishedHideOf = (
  app: { service?: string; name?: string },
  latestSignature?: string
): UnfinishedHide | null => {
  const run = unfinishedHides.get(savedHiddenKey(app));
  if (!run) return null;
  if (
    latestSignature &&
    run.versions &&
    latestSignature !== run.versions.before &&
    latestSignature !== run.versions.replacement
  ) {
    return null;
  }
  return run;
};

/** Null once the hide went through. */
export const rememberUnfinishedHide = (
  app: { service?: string; name?: string },
  run: UnfinishedHide | null
) => {
  if (run) unfinishedHides.set(savedHiddenKey(app), run);
  else unfinishedHides.delete(savedHiddenKey(app));
  notifySavedHidden();
};

/**
 * The stopped hide as remembered, without unfinishedHideOf's check against
 * the app's version: a hide window open in another tab follows it.
 */
export const useUnfinishedHide = (app: {
  service?: string;
  name?: string;
}): UnfinishedHide | null => {
  const key = savedHiddenKey(app);
  return useSyncExternalStore(
    subscribeSavedHidden,
    () => unfinishedHides.get(key) ?? null
  );
};

/** Forgets loaded pages (tests start each case clean). */
export const clearAppPageCache = () => {
  pageCache.clear();
  savedHiddenStates.clear();
  unfinishedHides.clear();
  hiddenStateChanges.clear();
  hiddenStateRuns.clear();
};

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
      hidden: null,
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
      hidden: hit?.state.hidden ?? null,
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
        // The record says whether the app was replaced too; until it is read
        // (or if it can't be), its QDN title says whether it is hidden.
        if (resources.hidden) {
          const listed = resources.hidden;
          update({
            hidden: {
              hidden: listed.isHidden,
              replaced: false,
              updated: listed.updated,
            },
          });
          void fetchHiddenState(base, ref, signal)
            .then((hidden) => {
              if (!hidden) return;
              update({ hidden });
              // Read after the rest: the page kept for reopening gets it too.
              const kept = pageCache.get(key);
              if (kept) pageCache.set(key, { at: kept.at, state: current });
            })
            .catch(() => undefined);
        } else {
          update({ hidden: null });
        }
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

const namesCache = new Map<string, string>();
const namesInFlight = new Map<string, Promise<void>>();

const loadNames = async (addresses: string[]) => {
  const missing = addresses.filter(
    (address) => !namesCache.has(address) && !namesInFlight.has(address)
  );
  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50);
    const promise = getPrimaryNamesForAddresses(batch)
      .then((names) => {
        batch.forEach((address) =>
          namesCache.set(address, names[address] || '')
        );
      })
      .catch(() => {
        batch.forEach((address) => namesCache.set(address, ''));
      })
      .finally(() => batch.forEach((address) => namesInFlight.delete(address)));
    batch.forEach((address) => namesInFlight.set(address, promise));
  }
  await Promise.all(
    addresses
      .map((address) => namesInFlight.get(address))
      .filter(Boolean) as Promise<void>[]
  );
};

/** Primary names of addresses ('' for none), filled in as they arrive. */
export const usePrimaryNames = (addresses: string[]) => {
  const joined = useMemo(
    () =>
      Array.from(new Set(addresses.filter(Boolean)))
        .sort()
        .join(','),
    [addresses]
  );
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    const list = joined ? joined.split(',') : [];
    if (list.length === 0) return;
    let alive = true;
    const fromCache = () => {
      const next: Record<string, string> = {};
      list.forEach((address) => {
        if (namesCache.has(address)) next[address] = namesCache.get(address)!;
      });
      return next;
    };
    setNames(fromCache());
    loadNames(list).then(() => {
      if (alive) setNames(fromCache());
    });
    return () => {
      alive = false;
    };
  }, [joined]);

  return names;
};

const ownedNamesCache = new Map<string, string[]>();
/** How soon the names are asked for again after the node couldn't say. */
const OWNED_NAMES_RETRY_MS = 30_000;

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
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      fetch(`${getBaseApiReact()}/names/address/${enc(address)}?limit=0`, {
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) throw new Error(`names ${response.status}`);
          return response.json();
        })
        .then((list) => {
          const owned = Array.isArray(list)
            ? list
                .map((item) => item?.name)
                .filter((name): name is string => typeof name === 'string')
            : [];
          ownedNamesCache.set(address, owned);
          setNames(owned);
        })
        .catch(() => {
          // A failed answer isn't "no names": the library's loader stays
          // mounted, so ask again rather than keep none for the session.
          if (controller.signal.aborted) return;
          retry = setTimeout(load, OWNED_NAMES_RETRY_MS);
        });
    };
    load();
    return () => {
      controller.abort();
      clearTimeout(retry);
    };
  }, [address]);
  return names;
};
