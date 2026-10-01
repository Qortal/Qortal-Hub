import { createHash } from 'crypto';

export type QAppGuestOwner = {
  tabId: string;
  name: string;
  service: string;
};

export function qappGuestPartition(
  origin: string,
  owner: QAppGuestOwner
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([origin, owner.service, owner.name]))
    .digest('hex');
  return `persist:qapp-${digest}`;
}

export function qappGuestUrlAllowed(
  initialUrl: string,
  nextUrl: string,
  owner: QAppGuestOwner,
  isDevMode: boolean
): boolean {
  try {
    const initial = new URL(initialUrl);
    const next = new URL(nextUrl);
    if (initial.origin !== next.origin) return false;
    if (!['http:', 'https:'].includes(next.protocol)) return false;
    if (isDevMode) return true;
    if (initial.pathname.startsWith('/render/hash/')) {
      const root = initial.pathname.split('/').slice(0, 4).join('/');
      return next.pathname === root || next.pathname.startsWith(`${root}/`);
    }
    const root = `/render/${encodeURIComponent(owner.service)}/${encodeURIComponent(owner.name)}`;
    return next.pathname === root || next.pathname.startsWith(`${root}/`);
  } catch {
    return false;
  }
}
