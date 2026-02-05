import { useCallback, useEffect, useRef } from 'react';
import { atom, useAtom } from 'jotai';
import { getBaseApiReact } from '../App';
import {
  RATING_CACHE_TTL,
  RATING_CACHE_STORAGE_KEY,
} from '../constants/constants';
import type {
  AppRatingData,
  RatingsCacheStorage,
  VoteCount,
} from '../types/ratings';

// Jotai atom for centralized ratings store
const ratingsStoreAtom = atom<Map<string, AppRatingData>>(new Map());

// Set to track in-flight requests (prevents duplicate fetches)
const pendingRequests = new Set<string>();

// Shared IntersectionObserver instance
let sharedObserver: IntersectionObserver | null = null;
const observedElements = new Map<Element, string>();
const pendingFetches = new Set<string>();
let batchTimeout: ReturnType<typeof setTimeout> | null = null;
let batchFetchCallback: ((keys: string[]) => void) | null = null;

// Generate cache key for an app
const getCacheKey = (name: string, service: string): string => {
  return `${service.toLowerCase()}-${name.toLowerCase()}`;
};

// Load cache from localStorage
const loadCacheFromStorage = (): Map<string, AppRatingData> => {
  try {
    const stored = localStorage.getItem(RATING_CACHE_STORAGE_KEY);
    if (!stored) return new Map();

    const parsed: RatingsCacheStorage = JSON.parse(stored);
    const now = Date.now();
    const map = new Map<string, AppRatingData>();

    Object.entries(parsed.ratings).forEach(([key, data]) => {
      // Only load non-expired entries
      if (now - data.lastFetched < RATING_CACHE_TTL) {
        map.set(key, data);
      }
    });

    return map;
  } catch (error) {
    console.error('Error loading ratings cache:', error);
    return new Map();
  }
};

// Save cache to localStorage (debounced)
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
const saveCacheToStorage = (ratings: Map<string, AppRatingData>) => {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      const storage: RatingsCacheStorage = {
        version: 1,
        ratings: Object.fromEntries(ratings.entries()),
      };
      localStorage.setItem(RATING_CACHE_STORAGE_KEY, JSON.stringify(storage));
    } catch (error) {
      console.error('Error saving ratings cache:', error);
    }
  }, 1000);
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
  const [ratingsStore, setRatingsStore] = useAtom(ratingsStoreAtom);
  const initializedRef = useRef(false);

  // Initialize: load cache from localStorage
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const cached = loadCacheFromStorage();
    if (cached.size > 0) {
      setRatingsStore(cached);
    }
  }, [setRatingsStore]);

  // Fetch a single rating
  const fetchRating = useCallback(
    async (name: string, service: string, forceRefresh = false) => {
      const key = getCacheKey(name, service);

      // Check if already in store and not expired
      const existing = ratingsStore.get(key);
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
            saveCacheToStorage(next);
            return next;
          });
          return data;
        }
      } finally {
        pendingRequests.delete(key);
      }

      return null;
    },
    [ratingsStore, setRatingsStore]
  );

  // Batch fetch multiple ratings
  const batchFetchRatings = useCallback(
    async (keys: string[]) => {
      const keysToFetch = keys.filter((key) => {
        const existing = ratingsStore.get(key);
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
          const [service, ...nameParts] = key.split('-');
          const name = nameParts.join('-');
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
        saveCacheToStorage(next);
        return next;
      });
    },
    [ratingsStore, setRatingsStore]
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
      observedElements.set(element, key);
      sharedObserver.observe(element);

      return () => {
        observedElements.delete(element);
        sharedObserver?.unobserve(element);
      };
    },
    []
  );

  // Get rating data for an app
  const getRating = useCallback(
    (name: string, service: string): AppRatingData | null => {
      const key = getCacheKey(name, service);
      return ratingsStore.get(key) || null;
    },
    [ratingsStore]
  );

  // Invalidate a rating (force refresh on next access)
  const invalidateRating = useCallback(
    (name: string, service: string) => {
      const key = getCacheKey(name, service);
      setRatingsStore((prev) => {
        const next = new Map(prev);
        next.delete(key);
        saveCacheToStorage(next);
        return next;
      });
    },
    [setRatingsStore]
  );

  return {
    getRating,
    fetchRating,
    registerVisibility,
    invalidateRating,
    ratingsStore,
  };
};

// Hook for a single app rating (convenience wrapper)
export const useAppRating = (name?: string, service?: string) => {
  const { getRating, fetchRating, registerVisibility, invalidateRating } =
    useAppRatings();
  const containerRef = useRef<HTMLDivElement>(null);
  const registeredRef = useRef(false);

  // Register for visibility-based fetching (or fetch immediately if IO unavailable)
  useEffect(() => {
    if (!name || !service || registeredRef.current) return;
    registeredRef.current = true;

    const cleanup = registerVisibility(containerRef.current, name, service);

    // Fallback: fetch immediately if IntersectionObserver isn't available
    if (!cleanup && typeof IntersectionObserver === 'undefined') {
      fetchRating(name, service);
    }

    return () => {
      cleanup?.();
      registeredRef.current = false;
    };
  }, [name, service, registerVisibility, fetchRating]);

  const rating = name && service ? getRating(name, service) : null;

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
