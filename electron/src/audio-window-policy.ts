export const MAIN_WINDOW_ROLE = 'main-shell';
export const AUDIO_SURFACE_WINDOW_ROLE = 'audio-surface';
export const AUDIO_SURFACE_ENTRY_PATH = '/audio-surface.html';

export function buildAudioSurfaceScheme(baseScheme: string): string {
  return `${baseScheme}-audio`;
}

type HeaderRequestDetails = {
  url?: string;
  resourceType?: string;
  origin?: string;
  referrer?: string;
};

export function buildAudioSurfaceUrl(
  mainWindowUrl: string | null | undefined,
  fallbackScheme: string,
  audioSurfaceScheme = buildAudioSurfaceScheme(fallbackScheme)
): string {
  if (typeof mainWindowUrl === 'string' && mainWindowUrl.trim()) {
    try {
      const url = new URL(mainWindowUrl);
      if (url.protocol === `${fallbackScheme}:`) {
        return `${audioSurfaceScheme}://-${AUDIO_SURFACE_ENTRY_PATH}`;
      }
      url.pathname = AUDIO_SURFACE_ENTRY_PATH;
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch {
      /* ignore and fall through */
    }
  }
  return `${audioSurfaceScheme}://-${AUDIO_SURFACE_ENTRY_PATH}`;
}

export function shouldApplyAudioSurfaceIsolationHeaders(
  webContentsId: number | undefined,
  isolatedIds: ReadonlySet<number>
): boolean {
  return typeof webContentsId === 'number' && isolatedIds.has(webContentsId);
}

export function withAudioSurfaceIsolationHeaders(
  responseHeaders: Record<string, string | string[]>,
  details?: HeaderRequestDetails
): Record<string, string | string[]> {
  const next = { ...responseHeaders };
  const url = typeof details?.url === 'string' ? safeUrl(details.url) : null;
  const requestOrigin =
    typeof details?.origin === 'string' && details.origin.trim()
      ? details.origin
      : typeof details?.referrer === 'string' && details.referrer.trim()
        ? safeUrl(details.referrer)?.origin ?? ''
        : '';
  const requestUrlOrigin = url?.origin ?? '';
  const isTopLevelAudioSurfaceDocument =
    url?.pathname === AUDIO_SURFACE_ENTRY_PATH &&
    (details?.resourceType === 'mainFrame' || details?.resourceType === 'subFrame');
  const isSameOriginSubresource =
    !isTopLevelAudioSurfaceDocument &&
    !!requestOrigin &&
    !!requestUrlOrigin &&
    requestOrigin === requestUrlOrigin;
  const isAudioSurfaceLocalAssetSubresource =
    !isTopLevelAudioSurfaceDocument && isLikelyAudioSurfaceLocalAsset(details, url);

  if (isTopLevelAudioSurfaceDocument) {
    next['Cross-Origin-Opener-Policy'] = ['same-origin'];
    next['Cross-Origin-Embedder-Policy'] = ['require-corp'];
    next['Cross-Origin-Resource-Policy'] = ['same-origin'];
    return next;
  }

  if (isSameOriginSubresource || isAudioSurfaceLocalAssetSubresource) {
    next['Cross-Origin-Embedder-Policy'] = ['require-corp'];
    next['Cross-Origin-Resource-Policy'] = ['same-origin'];
  }

  return next;
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLikelyAudioSurfaceLocalAsset(
  details: HeaderRequestDetails | undefined,
  url: URL | null
): boolean {
  if (!url) return false;
  const resourceType = typeof details?.resourceType === 'string'
    ? details.resourceType
    : '';
  if (
    resourceType === 'worker' ||
    resourceType === 'script'
  ) {
    return isLocalAssetUrl(url);
  }
  return isLocalAssetUrl(url) && /\.wasm$/i.test(url.pathname);
}

function isLocalAssetUrl(url: URL): boolean {
  const isAppScheme = url.protocol === 'capacitor-electron:';
  const isLoopbackDevServer =
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  const isAssetPath =
    url.pathname.startsWith('/assets/') ||
    /\.(?:js|mjs|cjs|wasm)$/i.test(url.pathname);
  return isAssetPath && (isAppScheme || isLoopbackDevServer);
}
