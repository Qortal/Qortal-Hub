import type { DmFriendStored } from '../../atoms/global';

export type DirectRow = {
  address?: string;
  name?: string;
  timestamp?: number;
  sender?: string;
  senderName?: string;
  [key: string]: unknown;
};

/**
 * Merges socket `directs` with friend-only addresses so the sidebar shows
 * friends even when there is no message history yet.
 */
export function mergeDirectsWithFriends(
  directs: DirectRow[],
  friendsByAddress: Record<string, DmFriendStored>,
  myAddress: string,
  myName: string | undefined
): DirectRow[] {
  const map = new Map<string, DirectRow>();
  for (const d of directs || []) {
    const addr = d?.address;
    if (typeof addr === 'string' && addr) {
      map.set(addr, d);
    }
  }
  for (const [addr, meta] of Object.entries(friendsByAddress || {})) {
    if (!addr || map.has(addr)) continue;
    map.set(addr, {
      address: addr,
      name: meta.name || addr,
      sender: myAddress,
      senderName: myName,
      timestamp: undefined,
    });
  }
  return Array.from(map.values()).sort(
    (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
  );
}
