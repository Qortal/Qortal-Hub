/**
 * True when `url` points at this machine: `localhost`, `127.x.x.x` or `::1`.
 * Core's `localAuthBypassEnabled` lets requests from there skip the API key;
 * requests from any other address, a node elsewhere on the LAN included,
 * still need it.
 */
export const isLoopbackNodeUrl = (url: string | null | undefined): boolean => {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  host = host.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    host === 'localhost' || host === '::1' || /^127(\.\d{1,3}){3}$/.test(host)
  );
};
