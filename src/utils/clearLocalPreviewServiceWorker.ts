const LOCAL_SW_CLEAR_RELOAD_KEY = 'qortal_hub_local_sw_cache_cleared';

const isLocalPreviewHost = (hostname: string) =>
  hostname === 'localhost' ||
  hostname === '0.0.0.0' ||
  hostname.startsWith('127.');

export const clearLocalPreviewServiceWorker = () => {
  if (
    typeof window === 'undefined' ||
    typeof navigator === 'undefined' ||
    !isLocalPreviewHost(window.location.hostname) ||
    !('serviceWorker' in navigator)
  ) {
    return;
  }

  const clearLocalCaches = async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();

    await Promise.all(
      registrations.map((registration) => registration.unregister())
    );

    if ('caches' in window) {
      const cacheNames = await window.caches.keys();
      await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
    }

    if (
      navigator.serviceWorker.controller &&
      window.sessionStorage.getItem(LOCAL_SW_CLEAR_RELOAD_KEY) !== 'true'
    ) {
      window.sessionStorage.setItem(LOCAL_SW_CLEAR_RELOAD_KEY, 'true');
      window.location.reload();
    }
  };

  clearLocalCaches().catch((error) => {
    console.warn('Unable to clear local preview service worker cache.', error);
  });
};
