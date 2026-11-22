import { useEffect, useState } from 'react';
import {
  accountChoices,
  getSessionPermissions,
  getTakenBackSessionPermissions,
  notificationsChoice,
  subscribeSessionPermissions,
} from '../../qortal/qortal-requests';
import {
  storedChoices,
  type StoredChoice,
} from '../../qortal/alwaysAllowChoices';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';

/**
 * The "always allow" boxes the account ticked or turned off, read again on
 * each change; null until the first read is done.
 */
export function useAlwaysAllowChoices(address: string | null | undefined) {
  const [choices, setChoices] = useState<StoredChoice[] | null>(null);
  useEffect(() => {
    setChoices(null);
    if (!address) return;
    let alive = true;
    let reads = 0;
    const load = async () => {
      // Only the latest read counts: an earlier one may finish after it.
      const read = ++reads;
      const entries = await accountChoices(address);
      if (alive && read === reads) setChoices(storedChoices(entries));
    };
    void load();
    // Every stored choice that changes says so on this event.
    subscribeToEvent('notification-permission-updated', load);
    return () => {
      alive = false;
      unsubscribeFromEvent('notification-permission-updated', load);
    };
  }, [address]);
  return choices;
}

/**
 * The account's answer about the app's notifications (on, off or none), read
 * again on each change; null until the first read is done.
 */
export function useNotificationsChoice(
  address: string | null | undefined,
  appName: string | null | undefined
) {
  const [choice, setChoice] = useState<'on' | 'off' | 'none' | null>(null);
  useEffect(() => {
    setChoice(null);
    if (!address || !appName) return;
    let alive = true;
    let reads = 0;
    const load = async () => {
      const read = ++reads;
      const value = await notificationsChoice(address, appName);
      if (alive && read === reads) setChoice(value);
    };
    void load();
    subscribeToEvent('notification-permission-updated', load);
    return () => {
      alive = false;
      unsubscribeFromEvent('notification-permission-updated', load);
    };
  }, [address, appName]);
  return choice;
}

/**
 * What the tab may do without asking until it closes (`allowed`), and what
 * the user took back from it (`takenBack`).
 */
export function useSessionPermissions(
  tabId: string | null | undefined,
  appName: string | null | undefined
) {
  const read = () =>
    tabId && appName
      ? {
          allowed: [...getSessionPermissions(tabId, appName)].sort(),
          takenBack: [...getTakenBackSessionPermissions(tabId, appName)].sort(),
        }
      : { allowed: [] as string[], takenBack: [] as string[] };
  const [permissions, setPermissions] = useState(read);
  useEffect(() => {
    setPermissions(read());
    return subscribeSessionPermissions(() => setPermissions(read()));
  }, [tabId, appName]);
  return permissions;
}
