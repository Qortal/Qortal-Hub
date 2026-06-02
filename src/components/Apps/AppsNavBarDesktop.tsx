export function saveToLocalStorage(key, subKey, newValue) {
  try {
    const existingData = localStorage.getItem(key);
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
    localStorage.setItem(key, serializedValue);
  } catch (error) {
    console.error('Error saving to localStorage:', error);
  }
}

export const AppsNavBarDesktop = () => null;
