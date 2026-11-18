import { useEffect, MutableRefObject } from 'react';
import { executeEvent } from '../utils/events';
import { handleGetFileFromIndexedDB } from '../utils/indexedDB';
import { openQortalLink } from '../utils/qortalLink/openQortalLink';
import { openQWalletsTab } from '../utils/openQWalletsTab';

type PermissionHandler = (
  message: any,
  event: MessageEvent
) => void | Promise<void>;

/**
 * Subscribes to window 'message' events for app/extension communication.
 * Uses refs so the effect runs once and always calls the latest handler,
 * avoiding unnecessary re-renders and listener churn.
 */
export function useAppMessageHandler(
  isFocusedRef: MutableRefObject<boolean>,
  permissionHandlerRef: MutableRefObject<PermissionHandler | null>
) {
  useEffect(() => {
    const messageHandler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      const message = event.data;

      if (message?.action === 'CHECK_FOCUS') {
        event.source?.postMessage?.(
          { action: 'CHECK_FOCUS_RESPONSE', isFocused: isFocusedRef.current },
          (event as any).origin
        );
      } else if (message.action === 'NOTIFICATION_OPEN_DIRECT') {
        executeEvent('openDirectMessage', {
          from: message.payload?.from,
        });
      } else if (message.action === 'NOTIFICATION_OPEN_GROUP') {
        executeEvent('openGroupMessage', {
          from: message.payload?.from,
          channelId: message.payload?.channelId,
        });
      } else if (message.action === 'NOTIFICATION_OPEN_ANNOUNCEMENT_GROUP') {
        executeEvent('openGroupAnnouncement', {
          from: message.payload?.from,
        });
      } else if (message.action === 'NOTIFICATION_OPEN_THREAD_NEW_POST') {
        executeEvent('openThreadNewPost', {
          data: message.payload?.data,
        });
      } else if (message.action === 'NOTIFICATION_OPEN_APP') {
        const payload = message.payload;
        if (payload?.reticulumDirectMessage) {
          executeEvent('openDirectMessageInternal', {
            address: payload.from,
            name: payload.name,
          });
        } else if (payload?.qChatMention) {
          executeEvent('openGroupMessage', {
            channelId: payload.channelId,
            eventId: payload.eventId,
            from: payload.from,
          });
        } else if (payload?.openCalendar) {
          executeEvent('openGroupMessage', {
            from: payload.from,
            eventId: payload.eventId,
            occurrenceStart: payload.occurrenceStart,
            timezone: payload.timezone,
            openCalendar: true,
          });
        } else if (payload?.openWallets) {
          openQWalletsTab();
        } else if (payload?.link) {
          // Any kind of qortal:// link: a Q-App or website, an app's page,
          // or a group's link.
          void openQortalLink(payload.link);
        }
      } else if (message.action === 'NOTIFICATION_PERMISSION_REQUEST') {
        executeEvent('show-notification-permission', {
          requestId: message.requestId,
          appInfo: message.appInfo,
          payload: message.payload,
        });
      } else if (
        message.action === 'QORTAL_REQUEST_PERMISSION' &&
        message?.isFromExtension &&
        event.source === window
      ) {
        const handler = permissionHandlerRef.current;
        handler?.(message, event);
      } else if (message?.action === 'getFileFromIndexedDB') {
        handleGetFileFromIndexedDB(event);
      }
    };

    window.addEventListener('message', messageHandler);
    return () => window.removeEventListener('message', messageHandler);
  }, [isFocusedRef, permissionHandlerRef]);
}
