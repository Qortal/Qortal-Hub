/**
 * Opens http(s) URLs in the system browser. In Electron, uses openExternal
 * (must stay allowlisted — see electron preload). Else uses window.open.
 */
export function openHttpUrlExternally(url: string | null | undefined): boolean {
  if (url == null || typeof url !== 'string') {
    return false;
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  if (!parsed.hostname) {
    return false;
  }

  const href = parsed.toString();

  if (window?.electronAPI?.openExternal) {
    window.electronAPI.openExternal(href);
    return true;
  }

  window.open(href, '_blank', 'noopener,noreferrer');
  return true;
}
