import { localStorageKeyFor } from '../../utils/pinnedAppsStorage';

export function saveToLocalStorage(key, subKey, newValue) {
  try {
    // Pinned apps go to the signed-in account's own key.
    const storageKey = localStorageKeyFor(key);
    const existingData = localStorage.getItem(storageKey);
    let combinedData = {};

    if (existingData) {
      const parsedData = JSON.parse(existingData);
      combinedData = {
        ...parsedData,
        timestamp: Date.now(),
        [subKey]: newValue,
      };
    } else {
      combinedData = {
        timestamp: Date.now(),
        [subKey]: newValue,
      };
    }

    const serializedValue = JSON.stringify(combinedData);
    localStorage.setItem(storageKey, serializedValue);
  } catch (error) {
    console.error('Error saving to localStorage:', error);
  }
}

export const AppsNavBarDesktop = () => null;
