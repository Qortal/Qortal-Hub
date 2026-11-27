import { useEffect, MutableRefObject } from 'react';
import { isHubLocked } from '../atoms/presence';
import { executeEvent } from '../utils/events';
import { handleGetFileFromIndexedDB } from '../utils/indexedDB';
import { openQortalLink } from '../utils/qortalLink/openQortalLink';
import { openQWalletsTab } from '../utils/openQWalletsTab';
import { openQChatTab } from '../utils/openQChatTab';
import { setPendingNotificationNav } from '../utils/notificationClickBuffer';

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
        setPendingNotificationNav({ eventName: 'openDirectMessage', detail: { from: message.payload?.from } });
        openQChatTab();
        executeEvent('openDirectMessage', { from: message.payload?.from });
      } else if (message.action === 'NOTIFICATION_OPEN_GROUP') {
        setPendingNotificationNav({ eventName: 'openGroupMessage', detail: { from: message.payload?.from, channelId: message.payload?.channelId } });
        openQChatTab();
        executeEvent('openGroupMessage', { from: message.payload?.from, channelId: message.payload?.channelId });
      } else if (message.action === 'NOTIFICATION_OPEN_ANNOUNCEMENT_GROUP') {
        setPendingNotificationNav({ eventName: 'openGroupAnnouncement', detail: { from: message.payload?.from } });
        openQChatTab();
        executeEvent('openGroupAnnouncement', { from: message.payload?.from });
      } else if (message.action === 'NOTIFICATION_OPEN_THREAD_NEW_POST') {
        executeEvent('openThreadNewPost', { data: message.payload?.data });
      } else if (message.action === 'NOTIFICATION_OPEN_APP') {
        const payload = message.payload;
        if (payload?.reticulumDirectMessage) {
          setPendingNotificationNav({ eventName: 'openDirectMessageInternal', detail: { address: payload.from, name: payload.name } });
          openQChatTab();
          executeEvent('openDirectMessageInternal', { address: payload.from, name: payload.name });
        } else if (
          payload?.qChatMention ||
          payload?.qChatMessage ||
          payload?.qChatReply ||
          // A "joined the group" notification carries the same channelId,
          // eventId and group id as the rest, so it opens the same way. It was
          // left out of this list and the click did nothing but focus the
          // window.
          payload?.qChatWelcome ||
          payload?.qChatReaction
        ) {
          setPendingNotificationNav({ eventName: 'openGroupMessage', detail: { channelId: payload.channelId, eventId: payload.eventId, from: payload.from } });
          openQChatTab();
          executeEvent('openGroupMessage', { channelId: payload.channelId, eventId: payload.eventId, from: payload.from });
        } else if (payload?.openCalendar) {
          setPendingNotificationNav({ eventName: 'openGroupMessage', detail: { from: payload.from, eventId: payload.eventId, occurrenceStart: payload.occurrenceStart, timezone: payload.timezone, openCalendar: true } });
          openQChatTab();
          executeEvent('openGroupMessage', { from: payload.from, eventId: payload.eventId, occurrenceStart: payload.occurrenceStart, timezone: payload.timezone, openCalendar: true });
        } else if (payload?.openWallets) {
          openQWalletsTab();
        } else if (payload?.link) {
          // Any kind of qortal:// link: a Q-App or website, an app's page,
          // or a group's link.
          void openQortalLink(payload.link);
        }
      } else if (message.action === 'NOTIFICATION_PERMISSION_REQUEST') {
        // As for approvals: nothing waits behind the lock screen.
        if (isHubLocked()) {
          window.postMessage(
            {
              action: 'NOTIFICATION_PERMISSION_RESPONSE',
              requestId: message.requestId,
              result: { accepted: false },
            },
            window.location.origin
          );
          return;
        }
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
        // While Hub is locked nothing is shown over or behind the lock screen:
        // the request is answered as declined.
        if (isHubLocked()) {
          window.postMessage(
            {
              action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
              requestId: message?.requestId,
              result: { accepted: false },
            },
            window.location.origin
          );
          return;
        }
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
