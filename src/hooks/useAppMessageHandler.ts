import { useEffect, MutableRefObject } from 'react';
import { executeEvent } from '../utils/events';
import { handleGetFileFromIndexedDB } from '../utils/indexedDB';

type PermissionHandler = (message: any, event: MessageEvent) => void | Promise<void>;

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
        });
      } else if (message.action === 'NOTIFICATION_OPEN_ANNOUNCEMENT_GROUP') {
        executeEvent('openGroupAnnouncement', {
          from: message.payload?.from,
        });
      } else if (message.action === 'NOTIFICATION_OPEN_THREAD_NEW_POST') {
        executeEvent('openThreadNewPost', {
          data: message.payload?.data,
        });
      } else if (message.action === 'NOTIFICATION_PERMISSION_REQUEST') {
        executeEvent('show-notification-permission', {
          requestId: message.requestId,
          appInfo: message.appInfo,
          payload: message.payload,
        });
      } else if (
        message.action === 'QORTAL_REQUEST_PERMISSION' &&
        message?.isFromExtension
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
