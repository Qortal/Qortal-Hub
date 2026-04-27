import { useEffect, useMemo, useRef } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { getBaseApiReact } from '../App';
import {
  managedSubscriptionsAtom,
  managedSubscriptionsLoadingAtom,
  myMemberGroupsAtom,
  myMemberGroupsLastFetchedAtom,
  mySubscriptionsAtom,
  subscriptionsLoadingAtom,
  userInfoAtom,
} from '../atoms/global';
import { useManagedSubscriptionsFromGroups } from './useSubscriptionsFromManagedGroups';
import { useSubscriptionsFromGroups } from './useSubscriptionsFromGroups';

const MEMBER_GROUPS_INTERVAL_MS = 5 * 60 * 1000;

let doFetchMemberGroups: (() => void) | null = null;

export function triggerMemberGroupsFetch() {
  doFetchMemberGroups?.();
}

export function clearMemberGroupsPolling() {
  doFetchMemberGroups = null;
}

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

  const fetchRef = useRef({
    address: userInfo?.address as string | undefined,
    lastFetched,
    setGroups: setMyMemberGroups,
    setLastFetched,
  });

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
      const { address, setGroups, setLastFetched: setTimestamp } =
        fetchRef.current;
      if (!address) return;

      try {
        const response = await fetch(`${getBaseApiReact()}/groups/member/${address}`);
        if (!response.ok) return;
        setGroups(await response.json());
        setTimestamp(Date.now());
      } catch {
        // Keep the previous subscription snapshot when the node request fails.
      }
    }

    doFetchMemberGroups = fetchMemberGroups;
    const intervalId = window.setInterval(
      fetchMemberGroups,
      MEMBER_GROUPS_INTERVAL_MS
    );

    return () => {
      window.clearInterval(intervalId);
      clearMemberGroupsPolling();
    };
  }, []);

  const address = userInfo?.address;
  useEffect(() => {
    if (!address) return;
    if (Date.now() - fetchRef.current.lastFetched < MEMBER_GROUPS_INTERVAL_MS) {
      return;
    }
    doFetchMemberGroups?.();
  }, [address]);

  const myMemberGroupsWhereAdmin = useMemo(
    () => myMemberGroups.filter((group: any) => group?.isAdmin),
    [myMemberGroups]
  );

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
