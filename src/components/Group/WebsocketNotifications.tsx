import { useEffect, useRef, useState } from 'react';
import { getBaseApiReact, getBaseApiReactSocket } from '../../App';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  extStateAtom,
  paymentNotificationsAtom,
  customWebsocketSubscriptionsAtom,
  notificationSeenInAppKeysAtom,
  filterSeenInAppKeysByRules,
} from '../../atoms/global';
import { fireOsNotificationPayment } from '../../background/background';

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
        const query = `qortal_qmail_${userName.slice(0, 20)}_${currentAddress.slice(-6)}_mail_`;
        const socketLink = `${getBaseApiReactSocket()}/websockets/notifications`;
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
                  link: 'qortal://app/q-mail',
                  notificationId: 'q-mail-notification',
                  appName: 'Q-Mail',
                  appService: 'APP',
                  message: {
                    en: 'You got a new qmail',
                  },
                },
              ],
            })
          );
          setTimeout(() => {
            socketRef.current.send(
              JSON.stringify({
                action: 'notification-history',
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
              console.log('Notification websocket message:', data);
              if (data?.type === 'history' && data?.results) {
                setPaymentNotifications(data.results);
              }
              if (data?.event === 'PAYMENT_RECEIVED' && data?.data) {
                const tx = data;
                setPaymentNotifications((prev) => {
                  const alreadyExists = prev.some(
                    (n) => n.signature === tx.data?.signature
                  );
                  if (alreadyExists) return prev;
                  return [tx, ...prev];
                });
                fireOsNotificationPayment(
                  tx,
                  'New Payment Received',
                  `You have received a new payment of ${tx?.data?.amount} QORT`,
                  `${getBaseApiReact()}/arbitrary/THUMBNAIL/Q-Wallets/qortal_avatar?async=true`
                );
              }
              if (data?.event === 'RESOURCE_PUBLISHED' && data?.data) {
                const tx = { ...data };
                if (tx.data && tx.data.created == null) {
                  tx.data = { ...tx.data, created: Date.now() };
                }
                setPaymentNotifications((prev) => {
                  const alreadyExists = prev.some(
                    (n) =>
                      n?.event === 'RESOURCE_PUBLISHED' &&
                      n?.data?.identifier === tx.data?.identifier
                  );
                  if (alreadyExists) return prev;
                  return [tx, ...prev];
                });
                fireOsNotificationPayment(
                  tx,
                  `New notification from ${tx.appName}`,
                  tx.message.en,
                  `${getBaseApiReact()}/${tx.image}`
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

    initWebsocketNotifications();

    return () => {
      forceCloseWebSocket();
    };
  }, [myAddress, extState, userName]);

  return null;
};
