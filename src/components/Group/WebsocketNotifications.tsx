import { useEffect, useRef, useState } from 'react';
import { getBaseApiReact, getBaseApiReactSocket } from '../../App';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import i18n, { supportedLanguages } from '../../i18n/i18n';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  extStateAtom,
  paymentNotificationsAtom,
  customWebsocketSubscriptionsAtom,
  notificationSeenInAppKeysAtom,
  filterSeenInAppKeysByRules,
} from '../../atoms/global';
import { fireOsNotificationPayment } from '../../background/background';
import {
  getNotificationPermissionKey,
  getPermission,
} from '../../qortal/qortal-requests';

/** Message object with "You got a new qmail" in all supported languages (for Q-Mail subscription). */
function getNewQmailMessage(): Record<string, string> {
  const message: Record<string, string> = {};
  for (const lng of Object.keys(supportedLanguages)) {
    message[lng] = i18n.t('core:message.generic.new_qmail', { lng });
  }
  return message;
}

/** Picks message in current language, else en, else first available; not reactive. */
function getNotificationMessage(
  messageObj: Record<string, string> | undefined
): string {
  const fallback = 'New notification';
  if (!messageObj || typeof messageObj !== 'object') return fallback;
  const lang = (i18n.language || 'en').split('-')[0];
  const current = messageObj[lang];
  if (typeof current === 'string' && current.trim()) return current.trim();
  const en = messageObj.en;
  if (typeof en === 'string' && en.trim()) return en.trim();
  const first = Object.values(messageObj).find(
    (v) => typeof v === 'string' && (v as string).trim()
  );
  return typeof first === 'string' ? (first as string).trim() : fallback;
}

export const WebSocketNotifications = ({ myAddress, userName }) => {
  const extState = useAtomValue(extStateAtom);
  const extStateRef = useRef(extState);
  extStateRef.current = extState;
  const myAddressRef = useRef(myAddress);
  myAddressRef.current = myAddress;
  const setPaymentNotifications = useSetAtom(paymentNotificationsAtom);
  const customSubscriptions = useAtomValue(customWebsocketSubscriptionsAtom);
  const setCustomSubscriptions = useSetAtom(customWebsocketSubscriptionsAtom);
  const seenInAppKeys = useAtomValue(notificationSeenInAppKeysAtom);
  const setSeenInAppKeys = useSetAtom(notificationSeenInAppKeysAtom);

  const [socketOpen, setSocketOpen] = useState(false);
  const socketRef = useRef(null);
  const timeoutIdRef = useRef(null);
  const pingTimeoutRef = useRef(null);
  const listOfMyNamesRef = useRef<string[]>([]);
  const initWebsocketRef = useRef<(() => Promise<void>) | null>(null);

  const forceCloseWebSocket = () => {
    if (socketRef.current) {
      clearTimeout(timeoutIdRef.current);
      clearTimeout(pingTimeoutRef.current);
      socketRef.current.close(1000, 'forced');
      socketRef.current = null;
    }
  };

  const logoutEventFunc = () => {
    forceCloseWebSocket();
  };

  useEffect(() => {
    subscribeToEvent('logout-event', logoutEventFunc);

    return () => {
      unsubscribeFromEvent('logout-event', logoutEventFunc);
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      forceCloseWebSocket();
      setSocketOpen(false);
      if (initWebsocketRef.current) {
        setTimeout(() => initWebsocketRef.current?.(), 0);
      }
    };
    subscribeToEvent('notifications-websocket-reconnect', handler);
    return () =>
      unsubscribeFromEvent('notifications-websocket-reconnect', handler);
  }, []);

  useEffect(() => {
    const handler = (e) => setCustomSubscriptions(e.detail ?? []);
    subscribeToEvent('custom-ws-subscriptions-updated', handler);
    return () =>
      unsubscribeFromEvent('custom-ws-subscriptions-updated', handler);
  }, [setCustomSubscriptions]);

  useEffect(() => {
    const current = Array.isArray(seenInAppKeys) ? seenInAppKeys : [];
    const filtered = filterSeenInAppKeysByRules(
      current,
      customSubscriptions ?? []
    );
    if (filtered.length !== current.length) {
      setSeenInAppKeys(filtered);
    }
  }, [customSubscriptions, seenInAppKeys, setSeenInAppKeys]);

  useEffect(() => {
    const handler = (e) => {
      const notificationIds = e.detail;
      if (
        !notificationIds?.length ||
        !socketRef.current ||
        socketRef.current.readyState !== WebSocket.OPEN
      )
        return;
      socketRef.current.send(
        JSON.stringify({ action: 'unsubscribe', notificationIds })
      );
    };
    subscribeToEvent('custom-ws-unsubscribe', handler);
    return () => unsubscribeFromEvent('custom-ws-unsubscribe', handler);
  }, []);

  useEffect(() => {
    if (
      !socketOpen ||
      !socketRef.current ||
      socketRef.current.readyState !== WebSocket.OPEN
    )
      return;
    if (!customSubscriptions?.length) return;
    socketRef.current.send(
      JSON.stringify({
        action: 'subscribe',
        subscriptions: customSubscriptions,
      })
    );
  }, [socketOpen, customSubscriptions]);

  useEffect(() => {
    if (!myAddress || extState === 'not-authenticated' || !userName) return;

    /** Remove RESOURCE_PUBLISHED rules whose appName does not have qAPPNotification permission. */
    const filterSubscriptionsByNotificationPermission = async (
      subscriptions
    ) => {
      if (!Array.isArray(subscriptions)) return [];
      const result = [];
      for (const sub of subscriptions) {
        if (sub?.event !== 'RESOURCE_PUBLISHED') {
          result.push(sub);
          continue;
        }
        const appName = sub?.appName;
        if (!appName) continue;
        const allowed = await getPermission(
          getNotificationPermissionKey(appName)
        );
        if (allowed === true) result.push(sub);
      }
      return result;
    };

    const pingHeads = () => {
      try {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send('ping');
          timeoutIdRef.current = setTimeout(() => {
            if (socketRef.current) {
              socketRef.current.close();
              clearTimeout(pingTimeoutRef.current);
            }
          }, 5000);
        }
      } catch (error) {
        console.error('Error during ping (notifications):', error);
      }
    };

    const initWebsocketNotifications = async () => {
      forceCloseWebSocket();
      const currentAddress = myAddress;
      if (extStateRef.current === 'not-authenticated') return;
      if (currentAddress !== myAddressRef.current) return;

      try {
        const getNamesUrl = `${getBaseApiReact()}/names/address/${currentAddress}?limit=0`;
        const namesResponse = await fetch(getNamesUrl);
        const namesData = await namesResponse.json();
        listOfMyNamesRef.current = namesData.map(
          (n: { name: string }) => n.name
        );
        const query = `qortal_qmail_${userName.slice(0, 20)}_${currentAddress.slice(-6)}_mail_`;
        const socketLink = `${getBaseApiReactSocket()}/websockets/notifications`;
        const NOTIFICATION_AGE_MS = 3 * 24 * 60 * 60 * 1000;
        const getNotificationCreatorTimestamp = (n: {
          data?: { created?: number; timestamp?: number };
          timestamp?: number;
        }) => n?.data?.created ?? n?.data?.timestamp ?? n?.timestamp;
        const trimNotificationsToLast3Days = <
          T extends {
            data?: { created?: number; timestamp?: number };
            timestamp?: number;
          },
        >(
          list: T[]
        ): T[] => {
          const cutoff = Date.now() - NOTIFICATION_AGE_MS;
          return list.filter((n) => {
            const ts = getNotificationCreatorTimestamp(n);
            return ts == null || ts >= cutoff;
          }) as T[];
        };
        socketRef.current = new WebSocket(socketLink);

        socketRef.current.onopen = () => {
          setSocketOpen(true);
          socketRef.current.send(
            JSON.stringify({
              action: 'subscribe',
              subscriptions: [
                {
                  event: 'PAYMENT_RECEIVED',
                  notificationId: 'payment-notification',

                  filters: {
                    recipient: currentAddress,
                  },
                },
                {
                  event: 'RESOURCE_PUBLISHED',
                  resourceFilter: {
                    service: 'MAIL_PRIVATE',
                    identifier: query, // same variable you're using in the fetch
                    excludeBlocked: true,
                    mode: 'ALL',
                  },
                  image: `/arbitrary/THUMBNAIL/Q-Mail/qortal_avatar?async=true`,
                  link: 'qortal://app/Q-Mail',
                  notificationId: 'q-mail-notification',
                  appName: 'Q-Mail',
                  appService: 'APP',
                  message: getNewQmailMessage(),
                },
              ],
            })
          );
          setTimeout(() => {
            const after = Date.now() - 3 * 24 * 60 * 60 * 1000; // 3 days ago (ms)
            socketRef.current.send(
              JSON.stringify({
                action: 'notification-history',
                paymentReceivedLimit: 5,
                after,
              })
            );
          }, 1000);
          setTimeout(pingHeads, 50);
        };

        socketRef.current.onmessage = (e) => {
          try {
            if (e.data === 'pong') {
              clearTimeout(timeoutIdRef.current);
              pingTimeoutRef.current = setTimeout(pingHeads, 20000);
            } else {
              const data = JSON.parse(e.data);

              if (data?.type === 'history' && data?.results) {
                const filtered = data.results.filter(
                  (n) =>
                    !(
                      n?.event === 'RESOURCE_PUBLISHED' &&
                      listOfMyNamesRef.current.includes(n?.data?.name)
                    )
                );
                setPaymentNotifications(trimNotificationsToLast3Days(filtered));
              }
              if (data?.event === 'PAYMENT_RECEIVED' && data?.data) {
                const tx = data;
                setPaymentNotifications((prev) => {
                  const trimmed = trimNotificationsToLast3Days(prev);
                  const alreadyExists = trimmed.some(
                    (n) => n.signature === tx.data?.signature
                  );
                  if (alreadyExists) return trimmed;
                  return [tx, ...trimmed];
                });
                fireOsNotificationPayment(
                  tx,
                  i18n.t('core:message.generic.new_payment_received'),
                  i18n.t('core:message.generic.new_payment_body', {
                    amount: tx?.data?.amount ?? 0,
                  }),
                  `${getBaseApiReact()}/arbitrary/THUMBNAIL/Q-Wallets/qortal_avatar?async=true`,
                  tx?.link
                );
              }
              if (data?.event === 'RESOURCE_PUBLISHED' && data?.data) {
                const tx = { ...data };
                if (listOfMyNamesRef.current.includes(tx?.data?.name)) return;
                if (tx.data && tx.data.created == null) {
                  tx.data = { ...tx.data, created: Date.now() };
                }
                setPaymentNotifications((prev) => {
                  const trimmed = trimNotificationsToLast3Days(prev);
                  const alreadyExists = trimmed.some(
                    (n) =>
                      n?.event === 'RESOURCE_PUBLISHED' &&
                      n?.data?.identifier === tx.data?.identifier
                  );
                  if (alreadyExists) return trimmed;
                  return [tx, ...trimmed];
                });
                fireOsNotificationPayment(
                  tx,
                  i18n.t('core:message.generic.new_notification_from', {
                    appName: tx.appName ?? 'App',
                  }),
                  getNotificationMessage(tx.message),
                  `${getBaseApiReact()}${tx.image}`,
                  tx?.link
                );
              }
            }
          } catch (error) {
            console.error('Error parsing notifications message:', error);
          }
        };

        socketRef.current.onclose = (event) => {
          setSocketOpen(false);
          clearTimeout(pingTimeoutRef.current);
          clearTimeout(timeoutIdRef.current);
          console.warn(
            `Notifications WebSocket closed: ${event.reason || 'unknown reason'}`
          );
          if (extStateRef.current === 'not-authenticated') return;
          if (event.reason !== 'forced' && event.code !== 1000) {
            setTimeout(() => initWebsocketNotifications(), 10000);
          }
        };

        socketRef.current.onerror = (error) => {
          console.error('Notifications WebSocket error:', error);
          clearTimeout(pingTimeoutRef.current);
          clearTimeout(timeoutIdRef.current);
          if (socketRef.current) {
            socketRef.current.close();
          }
        };
      } catch (error) {
        console.error('Error initializing notifications WebSocket:', error);
      }
    };

    initWebsocketRef.current = initWebsocketNotifications;

    (async () => {
      const filtered = await filterSubscriptionsByNotificationPermission(
        customSubscriptions ?? []
      );
      setCustomSubscriptions(filtered);
      initWebsocketNotifications();
    })();

    return () => {
      initWebsocketRef.current = null;
      forceCloseWebSocket();
    };
  }, [myAddress, extState, userName]);

  return null;
};
