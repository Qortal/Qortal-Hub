import { useCallback, useEffect, useRef } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { getBaseApiReact } from '../App';
import { RATING_CACHE_TTL } from '../constants/constants';
import type { AppRatingData, VoteCount } from '../types/ratings';
import {
  loadRatingsCacheFromDB,
  saveRatingsCacheToDB,
} from '../utils/ratingsIndexedDB';

// Jotai atom for centralized ratings store (export for consumers that need full store, e.g. OfficialAppsTab)
export const ratingsStoreAtom = atom<Map<string, AppRatingData>>(new Map());

/** Derived atom family: each card subscribes only to its own rating. Key: getCacheKey(name, service). */
export const ratingForAppAtomFamily = atomFamily((key: string) =>
  atom((get) => get(ratingsStoreAtom).get(key) || null)
);

/**
 * Derived atom family: subscribes only to ratings for the given cache keys (e.g. featured app keys).
 * Key: comma-separated sorted cache keys. Use so only those apps' rating updates trigger re-renders.
 */
export const featuredRatingsMapAtomFamily = atomFamily((keysJson: string) =>
  atom((get) => {
    const keys = keysJson ? keysJson.split(',').filter(Boolean) : [];
    const entries = keys.map((k) => [
      k,
      get(ratingForAppAtomFamily(k)) as AppRatingData | null,
    ] as const);
    return Object.fromEntries(entries) as Record<string, AppRatingData | null>;
  })
);

// Set to track in-flight requests (prevents duplicate fetches)
const pendingRequests = new Set<string>();

// Shared IntersectionObserver instance
let sharedObserver: IntersectionObserver | null = null;
const observedElements = new Map<Element, string>();
const pendingFetches = new Set<string>();
let batchTimeout: ReturnType<typeof setTimeout> | null = null;
let batchFetchCallback: ((keys: string[]) => void) | null = null;

// Map from lowercased cache key to original name/service (preserves casing for API calls)
const keyToOriginalCase = new Map<string, { name: string; service: string }>();

// Generate cache key for an app (exported for consumers that need to subscribe to specific app ratings)
export const getCacheKey = (name: string, service: string): string => {
  return `${service.toLowerCase()}-${name.toLowerCase()}`;
};

// Calculate average rating from vote counts
const calculateRating = (
  voteCounts: VoteCount[]
): { averageRating: number; totalVotes: number } => {
  // Separate regular votes from initial value
  const ratingVotes = voteCounts.filter(
    (vote) => !vote.optionName.startsWith('initialValue-')
  );
  const initialValueVote = voteCounts.find((vote) =>
    vote.optionName.startsWith('initialValue-')
  );

  // Add initial value as a vote
  if (initialValueVote) {
    const initialRating = parseInt(
      initialValueVote.optionName.split('-')[1],
      10
    );
    ratingVotes.push({
      optionName: initialRating.toString(),
      voteCount: 1,
    });
  }

  let totalScore = 0;
  let totalVotes = 0;

  ratingVotes.forEach((vote) => {
    const rating = parseInt(vote.optionName, 10);
    if (!isNaN(rating)) {
      totalScore += rating * vote.voteCount;
      totalVotes += vote.voteCount;
    }
  });

  const averageRating = totalVotes > 0 ? totalScore / totalVotes : 0;
  return { averageRating, totalVotes };
};

// Fetch rating data from API
const fetchRatingFromAPI = async (
  name: string,
  service: string
): Promise<AppRatingData | null> => {
  const pollName = `app-library-${service}-rating-${name}`;
  const url = `${getBaseApiReact()}/polls/${pollName}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const responseData = await response.json();

    if (responseData?.message?.includes('POLL_NO_EXISTS')) {
      return {
        averageRating: 0,
        totalVotes: 0,
        voteCounts: [],
        hasPublishedRating: false,
        pollInfo: null,
        lastFetched: Date.now(),
      };
    }

    if (responseData?.pollName) {
      const urlVotes = `${getBaseApiReact()}/polls/votes/${pollName}`;
      const responseVotes = await fetch(urlVotes, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      const votesData = await responseVotes.json();
      const voteCounts: VoteCount[] = votesData.voteCounts || [];
      const { averageRating, totalVotes } = calculateRating(voteCounts);

      return {
        averageRating,
        totalVotes,
        voteCounts,
        hasPublishedRating: true,
        pollInfo: responseData,
        lastFetched: Date.now(),
      };
    }

    return null;
  } catch {
    // Network errors and POLL_NO_EXISTS are expected - return default state
    return {
      averageRating: 0,
      totalVotes: 0,
      voteCounts: [],
      hasPublishedRating: false,
      pollInfo: null,
      lastFetched: Date.now(),
    };
  }
};

// Initialize shared observer
const initializeObserver = (onBatchFetch: (keys: string[]) => void) => {
  if (sharedObserver) return;

  // Guard for environments without IntersectionObserver (SSR, tests)
  if (typeof IntersectionObserver === 'undefined') return;

  batchFetchCallback = onBatchFetch;

  sharedObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const key = observedElements.get(entry.target);
          if (key) {
            pendingFetches.add(key);
          }
        }
      });

      // Debounce batch fetch
      if (batchTimeout) clearTimeout(batchTimeout);
      if (pendingFetches.size > 0) {
        batchTimeout = setTimeout(() => {
          const keys = Array.from(pendingFetches);
          pendingFetches.clear();
          batchFetchCallback?.(keys);
        }, 100);
      }
    },
    { rootMargin: '200px', threshold: 0.1 }
  );
};

export const useAppRatings = () => {
  const setRatingsStore = useSetAtom(ratingsStoreAtom);
  const initializedRef = useRef(false);
  const ratingsStoreRef = useRef<Map<string, AppRatingData>>(new Map());

  // Initialize: load cache from IndexedDB
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    loadRatingsCacheFromDB().then((cached) => {
      if (cached.size > 0) {
        ratingsStoreRef.current = cached;
        setRatingsStore(cached);
      }
    });
  }, [setRatingsStore]);

  // Fetch a single rating - stable callback that doesn't change on store updates
  const fetchRating = useCallback(
    async (name: string, service: string, forceRefresh = false) => {
      const key = getCacheKey(name, service);
      keyToOriginalCase.set(key, { name, service });

      // Check if already in store and not expired (use ref to avoid dependency)
      const existing = ratingsStoreRef.current.get(key);
      if (
        existing &&
        !forceRefresh &&
        Date.now() - existing.lastFetched < RATING_CACHE_TTL
      ) {
        return existing;
      }

      // Prevent duplicate in-flight requests
      if (pendingRequests.has(key)) return null;
      pendingRequests.add(key);

      try {
        const data = await fetchRatingFromAPI(name, service);
        if (data) {
          setRatingsStore((prev) => {
            const next = new Map(prev);
            next.set(key, data);
            saveRatingsCacheToDB(next);
            ratingsStoreRef.current = next;
            return next;
          });
          return data;
        }
      } finally {
        pendingRequests.delete(key);
      }

      return null;
    },
    [setRatingsStore]
  );

  // Batch fetch multiple ratings - stable callback
  const batchFetchRatings = useCallback(
    async (keys: string[]) => {
      const keysToFetch = keys.filter((key) => {
        const existing = ratingsStoreRef.current.get(key);
        // Fetch if not in store, expired, or not currently fetching
        return (
          !pendingRequests.has(key) &&
          (!existing || Date.now() - existing.lastFetched >= RATING_CACHE_TTL)
        );
      });

      if (keysToFetch.length === 0) return;

      // Fetch all in parallel
      const results = await Promise.all(
        keysToFetch.map(async (key) => {
          const original = keyToOriginalCase.get(key);
          if (!original) return { key, data: null };
          const { name, service } = original;
          pendingRequests.add(key);
          try {
            const data = await fetchRatingFromAPI(name, service);
            return { key, data };
          } finally {
            pendingRequests.delete(key);
          }
        })
      );

      // Update store with all results
      setRatingsStore((prev) => {
        const next = new Map(prev);
        results.forEach(({ key, data }) => {
          if (data) {
            next.set(key, data);
          }
        });
        saveRatingsCacheToDB(next);
        ratingsStoreRef.current = next;
        return next;
      });
    },
    [setRatingsStore]
  );

  // Initialize observer with batch fetch callback
  useEffect(() => {
    initializeObserver(batchFetchRatings);
  }, [batchFetchRatings]);

  // Register an element for visibility-based fetching
  const registerVisibility = useCallback(
    (
      element: HTMLElement | null,
      name: string,
      service: string
    ): (() => void) | undefined => {
      if (!element || !sharedObserver) return undefined;

      const key = getCacheKey(name, service);
      keyToOriginalCase.set(key, { name, service });
      observedElements.set(element, key);
      sharedObserver.observe(element);

      return () => {
        observedElements.delete(element);
        sharedObserver?.unobserve(element);
      };
    },
    []
  );

  // Invalidate a rating (force refresh on next access)
  const invalidateRating = useCallback(
    (name: string, service: string) => {
      const key = getCacheKey(name, service);
      setRatingsStore((prev) => {
        const next = new Map(prev);
        next.delete(key);
        saveRatingsCacheToDB(next);
        ratingsStoreRef.current = next;
        return next;
      });
    },
    [setRatingsStore]
  );

  const getRating = useCallback(
    (name: string, service: string): AppRatingData | null => {
      const key = getCacheKey(name, service);
      return ratingsStoreRef.current.get(key) || null;
    },
    []
  );

  return {
    getRating,
    fetchRating,
    registerVisibility,
    invalidateRating,
  };
};

// Hook for a single app rating (convenience wrapper) - narrow subscription so only this app's rating triggers re-render
export const useAppRating = (name?: string, service?: string) => {
  const { fetchRating, registerVisibility, invalidateRating } = useAppRatings();
  const containerRef = useRef<HTMLDivElement>(null);
  const registeredRef = useRef(false);

  const key =
    name && service ? getCacheKey(name, service) : '';
  const rating = useAtomValue(ratingForAppAtomFamily(key));

  // Register for visibility-based fetching once when mounted (no rating in deps to avoid effect churn)
  useEffect(() => {
    if (!name || !service || registeredRef.current) return;
    registeredRef.current = true;

    const cleanup = registerVisibility(containerRef.current, name, service);

    if (!cleanup && typeof IntersectionObserver === 'undefined') {
      fetchRating(name, service);
    }

    return () => {
      cleanup?.();
      registeredRef.current = false;
    };
  }, [name, service, registerVisibility, fetchRating]);

  const refresh = useCallback(() => {
    if (name && service) {
      return fetchRating(name, service, true);
    }
    return Promise.resolve(null);
  }, [name, service, fetchRating]);

  const invalidate = useCallback(() => {
    if (name && service) {
      invalidateRating(name, service);
    }
  }, [name, service, invalidateRating]);

  return {
    rating,
    containerRef,
    refresh,
    invalidate,
    isLoading: !rating && !!name && !!service,
  };
};
