import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useRef, useState } from 'react';
import { getBaseApiReact, getBaseApiReactSocket } from '../../App';
import {
  customWebsocketSubscriptionsAtom,
  extStateAtom,
  filterSeenInAppKeysByRules,
  notificationSeenInAppKeysAtom,
  paymentNotificationsAtom,
} from '../../atoms/global';
import { fireOsNotificationPayment } from '../../background/background';
import i18n, { supportedLanguages } from '../../i18n/i18n';
import {
  getNotificationPermissionKey,
  getPermission,
} from '../../qortal/qortal-requests';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';

function getNewQmailMessage(): Record<string, string> {
  return Object.keys(supportedLanguages).reduce<Record<string, string>>(
    (acc, lng) => {
      acc[lng] = i18n.t('core:message.generic.new_qmail', {
        defaultValue: 'You have new Q-Mail',
        lng,
      });
      return acc;
    },
    {}
  );
}

function getNotificationMessage(messageObj?: Record<string, string>) {
  if (!messageObj || typeof messageObj !== 'object') return 'New notification';
  const lang = (i18n.language || 'en').split('-')[0];
  return (
    messageObj[lang]?.trim() ||
    messageObj.en?.trim() ||
    Object.values(messageObj).find((value) => value?.trim()) ||
    'New notification'
  );
}

function trimNotificationsToLast3Days<T extends { data?: any; timestamp?: number }>(
  list: T[]
) {
  const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
  return list.filter((item) => {
    const ts = item?.data?.created ?? item?.data?.timestamp ?? item?.timestamp;
    return ts == null || ts >= cutoff;
  });
}

export const WebSocketNotifications = ({
  myAddress,
  userName,
}: {
  myAddress?: string;
  userName?: string;
}) => {
  const extState = useAtomValue(extStateAtom);
  const extStateRef = useRef(extState);
  extStateRef.current = extState;
  const myAddressRef = useRef(myAddress);
  myAddressRef.current = myAddress;
  const customSubscriptions = useAtomValue(customWebsocketSubscriptionsAtom);
  const setCustomSubscriptions = useSetAtom(customWebsocketSubscriptionsAtom);
  const seenInAppKeys = useAtomValue(notificationSeenInAppKeysAtom);
  const setSeenInAppKeys = useSetAtom(notificationSeenInAppKeysAtom);
  const setNotifications = useSetAtom(paymentNotificationsAtom);
  const [socketOpen, setSocketOpen] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listOfMyNamesRef = useRef<string[]>([]);
  const initWebsocketRef = useRef<(() => Promise<void>) | null>(null);

  const forceCloseWebSocket = () => {
    if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
    if (pingTimeoutRef.current) clearTimeout(pingTimeoutRef.current);
    socketRef.current?.close(1000, 'forced');
    socketRef.current = null;
  };

  useEffect(() => {
    const logoutEventFunc = () => forceCloseWebSocket();
    subscribeToEvent('logout-event', logoutEventFunc);
    return () => unsubscribeFromEvent('logout-event', logoutEventFunc);
  }, []);

  useEffect(() => {
    const handler = () => {
      forceCloseWebSocket();
      setSocketOpen(false);
      setTimeout(() => initWebsocketRef.current?.(), 0);
    };
    subscribeToEvent('notifications-websocket-reconnect', handler);
    return () =>
      unsubscribeFromEvent('notifications-websocket-reconnect', handler);
  }, []);

  useEffect(() => {
    const handler = (event) => setCustomSubscriptions(event.detail ?? []);
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
    const handler = (event) => {
      const notificationIds = event.detail;
      if (
        !notificationIds?.length ||
        !socketRef.current ||
        socketRef.current.readyState !== WebSocket.OPEN
      ) {
        return;
      }
      socketRef.current.send(
        JSON.stringify({ action: 'unsubscribe', notificationIds })
      );
    };
    subscribeToEvent('custom-ws-unsubscribe', handler);
    return () => unsubscribeFromEvent('custom-ws-unsubscribe', handler);
  }, []);

  useEffect(() => {
    if (!socketOpen || socketRef.current?.readyState !== WebSocket.OPEN) return;
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

    const filterSubscriptionsByNotificationPermission = async (subscriptions) => {
      if (!Array.isArray(subscriptions)) return [];
      const result = [];
      for (const sub of subscriptions) {
        if (sub?.event !== 'RESOURCE_PUBLISHED') {
          result.push(sub);
          continue;
        }
        const allowed = await getPermission(
          getNotificationPermissionKey(sub?.appName)
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
            socketRef.current?.close();
            if (pingTimeoutRef.current) clearTimeout(pingTimeoutRef.current);
          }, 5000);
        }
      } catch (error) {
        console.error('Error during notifications ping:', error);
      }
    };

    const initWebsocketNotifications = async () => {
      forceCloseWebSocket();
      const currentAddress = myAddress;
      if (extStateRef.current === 'not-authenticated') return;
      if (currentAddress !== myAddressRef.current) return;

      try {
        const namesResponse = await fetch(
          `${getBaseApiReact()}/names/address/${currentAddress}?limit=0`
        );
        const namesData = await namesResponse.json();
        listOfMyNamesRef.current = Array.isArray(namesData)
          ? namesData.map((nameData) => nameData.name)
          : [];

        const query = `qortal_qmail_${userName.slice(0, 20)}_${currentAddress.slice(-6)}_mail_`;
        socketRef.current = new WebSocket(
          `${getBaseApiReactSocket()}/websockets/notifications`
        );

        socketRef.current.onopen = () => {
          setSocketOpen(true);
          socketRef.current?.send(
            JSON.stringify({
              action: 'subscribe',
              subscriptions: [
                {
                  event: 'PAYMENT_RECEIVED',
                  filters: { recipient: currentAddress },
                  notificationId: 'payment-notification',
                },
                {
                  appName: 'Q-Mail',
                  appService: 'APP',
                  event: 'RESOURCE_PUBLISHED',
                  image: '/arbitrary/THUMBNAIL/Q-Mail/qortal_avatar?async=true',
                  link: 'qortal://app/Q-Mail',
                  message: getNewQmailMessage(),
                  notificationId: 'q-mail-notification',
                  resourceFilter: {
                    excludeBlocked: true,
                    identifier: query,
                    mode: 'ALL',
                    service: 'MAIL_PRIVATE',
                  },
                },
              ],
            })
          );
          setTimeout(() => {
            socketRef.current?.send(
              JSON.stringify({
                action: 'notification-history',
                after: Date.now() - 3 * 24 * 60 * 60 * 1000,
                paymentReceivedLimit: 5,
              })
            );
          }, 1000);
          setTimeout(pingHeads, 50);
        };

        socketRef.current.onmessage = (event) => {
          try {
            if (event.data === 'pong') {
              if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
              pingTimeoutRef.current = setTimeout(pingHeads, 20000);
              return;
            }

            const data = JSON.parse(event.data);
            if (data?.type === 'history' && data?.results) {
              const filtered = data.results.filter(
                (item) =>
                  !(
                    item?.event === 'RESOURCE_PUBLISHED' &&
                    listOfMyNamesRef.current.includes(item?.data?.name)
                  )
              );
              setNotifications(trimNotificationsToLast3Days(filtered));
            }

            if (data?.event === 'PAYMENT_RECEIVED' && data?.data) {
              setNotifications((prev) => {
                const trimmed = trimNotificationsToLast3Days(prev);
                if (
                  trimmed.some(
                    (item) => item.signature === data.data?.signature
                  )
                ) {
                  return trimmed;
                }
                return [data, ...trimmed];
              });
              fireOsNotificationPayment(
                data,
                i18n.t('core:message.generic.new_payment_received', {
                  defaultValue: 'New payment received',
                }),
                i18n.t('core:message.generic.new_payment_body', {
                  amount: data?.data?.amount ?? 0,
                  defaultValue: `You received ${data?.data?.amount ?? 0} QORT`,
                }),
                `${getBaseApiReact()}/arbitrary/THUMBNAIL/Q-Wallets/qortal_avatar?async=true`,
                data?.link
              );
            }

            if (data?.event === 'RESOURCE_PUBLISHED' && data?.data) {
              const tx = { ...data };
              if (listOfMyNamesRef.current.includes(tx?.data?.name)) return;
              if (tx.data && tx.data.created == null) {
                tx.data = { ...tx.data, created: Date.now() };
              }
              setNotifications((prev) => {
                const trimmed = trimNotificationsToLast3Days(prev);
                if (
                  trimmed.some(
                    (item) =>
                      item?.event === 'RESOURCE_PUBLISHED' &&
                      item?.data?.identifier === tx.data?.identifier
                  )
                ) {
                  return trimmed;
                }
                return [tx, ...trimmed];
              });
              fireOsNotificationPayment(
                tx,
                i18n.t('core:message.generic.new_notification_from', {
                  appName: tx.appName ?? 'App',
                  defaultValue: `New notification from ${tx.appName ?? 'App'}`,
                }),
                getNotificationMessage(tx.message),
                `${getBaseApiReact()}${tx.image}`,
                tx?.link
              );
            }
          } catch (error) {
            console.error('Error parsing notifications message:', error);
          }
        };

        socketRef.current.onclose = (event) => {
          setSocketOpen(false);
          if (pingTimeoutRef.current) clearTimeout(pingTimeoutRef.current);
          if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
          if (
            extStateRef.current !== 'not-authenticated' &&
            event.reason !== 'forced' &&
            event.code !== 1000
          ) {
            setTimeout(() => initWebsocketNotifications(), 10000);
          }
        };

        socketRef.current.onerror = (error) => {
          console.error('Notifications WebSocket error:', error);
          if (pingTimeoutRef.current) clearTimeout(pingTimeoutRef.current);
          if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
          socketRef.current?.close();
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
