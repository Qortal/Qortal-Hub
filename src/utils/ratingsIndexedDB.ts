import type { AppRatingData } from '../types/ratings';
import { RATING_CACHE_TTL } from '../constants/constants';

const DB_NAME = 'qortalRatingsDB';
const DB_VERSION = 1;
const STORE_NAME = 'ratingsCache';

let dbInstance: IDBDatabase | null = null;

const openRatingsDB = (): Promise<IDBDatabase> => {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;
      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(new Error('Error opening ratings IndexedDB'));
    };
  });
};

export const loadRatingsCacheFromDB = async (): Promise<
  Map<string, AppRatingData>
> => {
  try {
    const db = await openRatingsDB();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    return new Promise((resolve) => {
      const request = store.getAll();

      request.onsuccess = () => {
        const now = Date.now();
        const map = new Map<string, AppRatingData>();

        (request.result || []).forEach(
          (item: { key: string; data: AppRatingData }) => {
            // Only load non-expired entries
            if (now - item.data.lastFetched < RATING_CACHE_TTL) {
              map.set(item.key, item.data);
            }
          }
        );

        resolve(map);
      };

      request.onerror = () => {
        console.error('Error loading ratings cache from IndexedDB');
        resolve(new Map());
      };
    });
  } catch (error) {
    console.error('Error loading ratings cache:', error);
    return new Map();
  }
};

// Debounced save to IndexedDB
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

export const saveRatingsCacheToDB = (
  ratings: Map<string, AppRatingData>
): void => {
  if (saveTimeout) clearTimeout(saveTimeout);

  saveTimeout = setTimeout(async () => {
    try {
      const db = await openRatingsDB();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      // Clear existing entries and add new ones
      const clearRequest = store.clear();

      clearRequest.onsuccess = () => {
        ratings.forEach((data, key) => {
          store.put({ key, data });
        });
      };

      clearRequest.onerror = () => {
        console.error('Error clearing ratings cache in IndexedDB');
      };
    } catch (error) {
      console.error('Error saving ratings cache to IndexedDB:', error);
    }
  }, 1000);
};
