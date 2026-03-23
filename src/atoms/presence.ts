import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';

/**
 * User-selectable presence status.
 * All four values count as "online" (present in the network).
 * `'idle'` is set automatically — it is never user-selectable.
 */
export type UserStatus = 'online' | 'away' | 'busy' | 'idle';

/**
 * Full set of statuses the user can pick in the UI.
 * `'offline'` means "appear offline" — the user sends PRESENCE_OFFLINE
 * and stops heartbeating; their address is excluded from the online count.
 * `'idle'` is intentionally excluded here (it is automatic, not selectable).
 */
export type SelectableStatus = 'online' | 'away' | 'busy' | 'offline';

/**
 * Tracks whether the P2P network is currently enabled and running.
 * When false the status badge shows "Offline" and the status picker is disabled.
 * Initialised to `true` (optimistic); `usePresence` reads the real value from
 * `appSettings` on mount and keeps it in sync with the settings toggle.
 */
export const p2pEnabledAtom = atom<boolean>(true);

/**
 * Drives the "Idle" label on the profile card without affecting the
 * status the user has chosen in the picker (myStatusAtom).
 */
export const isIdleAtom = atom<boolean>(false);

/**
 * Set of Qortal addresses that are currently online according to the
 * presence network. Updated in real-time by the usePresence hook.
 */
export const onlineAddressesAtom = atom<Set<string>>(new Set<string>());

/**
 * The local user's chosen presence status.
 * `'offline'` triggers PRESENCE_OFFLINE and stops heartbeating.
 */
export const myStatusAtom = atom<SelectableStatus>('online');

/**
 * Map of address → UserStatus for every currently-online peer.
 * Values include 'online', 'away', 'busy', and 'idle'.
 * Entries are removed when a peer goes offline.
 */
export const statusMapAtom = atom<Map<string, UserStatus>>(new Map<string, UserStatus>());

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
 * const status = useAtomValue(statusAtomFamily(address)); // 'online'|'away'|'busy'|null
 */
export const statusAtomFamily = atomFamily((address: string) =>
  atom((get) => get(statusMapAtom).get(address) ?? null)
);
