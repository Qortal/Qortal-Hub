import { useEffect, useMemo, useRef } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  managedSubscriptionsAtom,
  managedSubscriptionsLoadingAtom,
  myMemberGroupsAtom,
  myMemberGroupsLastFetchedAtom,
  mySubscriptionsAtom,
  subscriptionsLoadingAtom,
  userInfoAtom,
} from '../atoms/global';
import { getBaseApiReact } from '../App';
import { useSubscriptionsFromGroups } from './useSubscriptionsFromGroups';
import { useManagedSubscriptionsFromGroups } from './useSubscriptionsFromManagedGroups';

const MEMBER_GROUPS_INTERVAL_MS = 5 * 60 * 1_000;

// Module-level callback so external callers (e.g. HomeDesktop refresh button)
// can trigger an immediate re-fetch without needing a prop/context.
let _doFetchMemberGroups: (() => void) | null = null;

/** Trigger an immediate re-fetch of member groups from anywhere. */
export function triggerMemberGroupsFetch() {
  _doFetchMemberGroups?.();
}

/** Called on logout to clear the fetch callback. */
export function clearMemberGroupsPolling() {
  _doFetchMemberGroups = null;
}

/**
 * Initializes subscription data globally.
 * Must be mounted inside an authenticated context (e.g. the title bar).
 * Fetches member groups on a 5-minute interval, then derives mySubscriptions
 * and managedSubscriptions, storing them in global atoms.
 */
export function useInitializeMySubscriptions() {
  const userInfo = useAtomValue(userInfoAtom);
  const [myMemberGroups, setMyMemberGroups] = useAtom(myMemberGroupsAtom);
  const [lastFetched, setLastFetched] = useAtom(myMemberGroupsLastFetchedAtom);
  const setMySubscriptions = useSetAtom(mySubscriptionsAtom);
  const setManagedSubscriptions = useSetAtom(managedSubscriptionsAtom);
  const setSubscriptionsLoading = useSetAtom(subscriptionsLoadingAtom);
  const setManagedSubscriptionsLoading = useSetAtom(
    managedSubscriptionsLoadingAtom
  );

  // Stable ref so interval/address-watch callbacks always see the latest values.
  const fetchRef = useRef<{
    address: string | undefined;
    lastFetched: number;
    setGroups: typeof setMyMemberGroups;
    setLastFetched: typeof setLastFetched;
  }>({ address: undefined, lastFetched: 0, setGroups: setMyMemberGroups, setLastFetched });

  useEffect(() => {
    fetchRef.current = {
      address: userInfo?.address,
      lastFetched,
      setGroups: setMyMemberGroups,
      setLastFetched,
    };
  });

  useEffect(() => {
    async function fetchMemberGroups() {
      const { address, setGroups, setLastFetched: setTs } = fetchRef.current;
      if (!address) return;
      try {
        const res = await fetch(
          `${getBaseApiReact()}/groups/member/${address}`
        );
        if (!res.ok) return;
        const data = await res.json();
        setGroups(data);
        setTs(Date.now());
      } catch {
        // silently ignore network errors
      }
    }

    // Expose for external callers (e.g. HomeDesktop refresh button).
    _doFetchMemberGroups = fetchMemberGroups;

    const intervalId = setInterval(fetchMemberGroups, MEMBER_GROUPS_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
      _doFetchMemberGroups = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trigger an immediate fetch whenever the address becomes available.
  // This covers the case where userInfo is not yet populated when the hook
  // first mounts (e.g. after a logout → re-login cycle).
  const address = userInfo?.address;
  useEffect(() => {
    if (!address) return;
    // Skip if data was fetched recently to avoid a redundant request on the
    // very first mount when the address and a fresh lastFetched arrive together.
    if (Date.now() - fetchRef.current.lastFetched < MEMBER_GROUPS_INTERVAL_MS) return;
    _doFetchMemberGroups?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const myMemberGroupsWhereAdmin = useMemo(() => {
    return myMemberGroups.filter((group) => group.isAdmin);
  }, [myMemberGroups]);

  const { mySubscriptions, loading } = useSubscriptionsFromGroups(
    userInfo?.address,
    userInfo?.name,
    myMemberGroups
  );

  const { managedSubscriptions, loading: managedLoading } =
    useManagedSubscriptionsFromGroups(
      userInfo?.address,
      userInfo?.name,
      myMemberGroupsWhereAdmin
    );

  // Sync local hook results into global atoms so any component can read them.
  useEffect(() => {
    setMySubscriptions(mySubscriptions);
  }, [mySubscriptions, setMySubscriptions]);

  useEffect(() => {
    setManagedSubscriptions(managedSubscriptions);
  }, [managedSubscriptions, setManagedSubscriptions]);

  useEffect(() => {
    setSubscriptionsLoading(loading);
  }, [loading, setSubscriptionsLoading]);

  useEffect(() => {
    setManagedSubscriptionsLoading(managedLoading);
  }, [managedLoading, setManagedSubscriptionsLoading]);
}
