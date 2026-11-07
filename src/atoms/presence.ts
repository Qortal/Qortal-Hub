import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';

/**
 * Presence statuses that count as "online" in the network.
 * `'idle'` is set automatically — it is never user-selectable.
 */
export type UserStatus = 'online' | 'busy' | 'idle';

/**
 * Full set of statuses the user can pick in the UI.
 * `'offline'` means "appear offline" — the user sends PRESENCE_OFFLINE
 * and stops heartbeating; their address is excluded from the online count.
 * `'idle'` is intentionally excluded here (it is automatic, not selectable).
 */
export type SelectableStatus = 'online' | 'busy' | 'offline';

/**
 * Drives the "Idle" label on the profile card without affecting the
 * status the user has chosen in the picker (myStatusAtom).
 */
export const isIdleAtom = atom<boolean>(false);

/**
 * Keeps an authenticated idle session locked until the wallet password is
 * verified. This is deliberately separate from `isIdleAtom`: activity may
 * update the idle timer while locked, but it must never unlock the app.
 */
export const appLockedAtom = atom<boolean>(false);

/**
 * Set of Qortal addresses that are currently online according to the
 * presence network. Updated in real-time by the usePresence hook.
 */
export const onlineAddressesAtom = atom<Set<string>>(new Set<string>());

/**
 * Primitive online count for consumers that do not need address membership.
 * Jotai only notifies subscribers when this number changes.
 */
export const onlineUserCountAtom = atom((get) => get(onlineAddressesAtom).size);

/**
 * The local user's chosen presence status.
 * `'offline'` triggers PRESENCE_OFFLINE and stops heartbeating.
 */
export const myStatusAtom = atom<SelectableStatus>('online');

/**
 * Map of address → UserStatus for every currently-online peer.
 * Values include 'online', 'busy', and 'idle'.
 * Entries are removed when a peer goes offline.
 */
export const statusMapAtom = atom<Map<string, UserStatus>>(
  new Map<string, UserStatus>()
);

/**
 * Derived atom family that returns a stable boolean for a single address.
 * Jotai only notifies subscribers when the boolean actually changes, so
 * components using this re-render only when THEIR address goes online/offline —
 * not on every presence update in the network.
 *
 * @example
 * // In a component:
 * const isOnline = useAtomValue(isOnlineAtomFamily(address));
 */
export const isOnlineAtomFamily = atomFamily((address: string) =>
  atom((get) => get(onlineAddressesAtom).has(address))
);

/**
 * Derived atom family that returns the UserStatus for a single address, or
 * null if that address is not currently online. Only re-renders subscribers
 * when THEIR address's status actually changes.
 *
 * @example
 * const status = useAtomValue(statusAtomFamily(address)); // 'online'|'busy'|'idle'|null
 */
export const statusAtomFamily = atomFamily((address: string) =>
  atom((get) => get(statusMapAtom).get(address) ?? null)
);

/**
 * Canonical badge status for a single address. The online-address set is the
 * authoritative liveness source used by the homepage count; the status map
 * only refines a live peer to busy/idle. Returning one primitive value keeps
 * per-row consumers on one subscription and prevents split online/status
 * snapshots from rendering contradictory badges.
 */
export const effectivePresenceStatusAtomFamily = atomFamily((address: string) =>
  atom((get): UserStatus | null => {
    if (!get(onlineAddressesAtom).has(address)) return null;
    return get(statusMapAtom).get(address) ?? 'online';
  })
);
