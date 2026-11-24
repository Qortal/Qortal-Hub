import { useCallback, useEffect, useRef, useState } from 'react';
import { getBaseApiReact, getBaseApiReactSocket } from '../../App';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import i18n, { supportedLanguages } from '../../i18n/i18n';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  extStateAtom,
  paymentNotificationsAtom,
  customWebsocketSubscriptionsAtom,
  dmFriendsByAddressAtom,
  notificationSeenInAppKeysAtom,
  filterSeenInAppKeysByRules,
  reticulumChatEnabledAtom,
  unreadWelcomeEventIdsAtom,
  globalNotificationFormAtom,
} from '../../atoms/global';
import {
  cancelQueuedNotification,
  fireOsNotificationPayment,
  handleNotificationClick,
} from '../../background/background';
import { dmNotificationQueueKey } from '../../utils/notificationClickRoute';
import {
  captureNotificationSession,
  isNotificationSessionCurrent,
} from '../../utils/notificationSession';
import {
  getNotificationPermissionKey,
  getPermission,
} from '../../qortal/qortal-requests';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';
import {
  QCHAT_MENTION_NOTIFICATION_APP_NAME,
  QCHAT_MENTION_NOTIFICATION_EVENT,
} from '../../utils/qChatMentionNotifications';
import {
  getEffectiveNotificationSettings,
  getGroupNotificationStore,
  getNotificationDeliveryMethod,
  isScopeMuted,
  shouldSuppressForMutedChannel,
  getWelcomeUnreadCount,
  type EffectiveNotificationSettings,
} from '../../utils/qChatNotificationSettings';
import {
  OsNotificationClaims,
  type OsNotificationFacts,
  type OsNotificationKind,
} from './reticulumNotificationPrecedence';
import {
  mentionTitleKey,
  mentionTitleTarget,
  normalizeMentionBroadcastScope,
  type MentionBroadcastScope,
} from './reticulumMentionNotificationTitle';
import {
  isHubBeingViewed,
  shouldNotifyForReticulumDm,
} from '../../utils/reticulumDmNotifications';
import {
  getReticulumNotificationChannelLabel,
  getChannelVisibilitySymbol,
} from '../../utils/reticulumNotificationChannel';
import {
  computeQChatVisible,
  shouldSuppressForViewedChannel,
  type QChatViewContext,
  isViewingChannel,
  setPublishedViewChannel,
} from '../../utils/qChatViewContextSuppression';
import { MAX_NOTIFICATION_PREVIEW_CHARS } from '../../constants/notificationConstants';
import qortPng from '../../assets/qort.png';

/**
 * Ask the shared gate whether this handler may present this kind for this event.
 *
 * Every Q-Chat handler calls this instead of its own `Set`, so the answer cannot
 * differ between handlers. See `reticulumNotificationPrecedence.ts` for why the
 * decision lives there — it is imported by the scenario harness as source, so it
 * must stay free of imports.
 */
const mayPresentQChatOsNotification = (
  claims: OsNotificationClaims,
  eventId: string,
  settings: EffectiveNotificationSettings | null | undefined,
  facts: OsNotificationFacts,
  kind: OsNotificationKind
): boolean => {
  if (!settings) return false;
  return claims.claimIfPermitted(eventId, settings, facts, kind);
};

/**
 * Suppression decision for a notification about (groupId, channelId).
 *
 * Reads BOTH the component ref and the shared module store. The ref alone is
 * not reliable: `qchat-view-channel` is a synchronous DOM event, so a payload
 * published before this component subscribed is lost and the ref keeps its
 * initial not-viewing sentinel. The store is written at the source, so it
 * holds the channel even when the event was missed.
 */
const shouldSuppressForCurrentView = (
  viewRef: React.MutableRefObject<QChatViewContext>,
  groupId: number,
  channelId: string
): boolean =>
  shouldSuppressForViewedChannel(viewRef.current, groupId, channelId) ||
  isViewingChannel(groupId, channelId);

const isQChatMentionNotification = (notification: any) =>
  notification?.appName === QCHAT_MENTION_NOTIFICATION_APP_NAME &&
  notification?.data?.qChatMention === true;

const isReticulumCalendarNotification = (notification: any) =>
  notification?.data?.reticulumCalendarReminder === true;

const NOTIFICATION_AGE_MS = 3 * 24 * 60 * 60 * 1000;
// The per-handler `Set`s and their cap were replaced by
// `OsNotificationClaims`, which owns the cap for all four kinds at once.
const RETICULUM_DM_OS_NOTIFICATION_MAX_TRACKED = 500;

const getNotificationCreatorTimestamp = (notification: {
  data?: { created?: number; timestamp?: number };
  timestamp?: number;
}) =>
  notification?.data?.created ??
  notification?.data?.timestamp ??
  notification?.timestamp;

const trimNotificationsToLast3Days = <
  T extends {
    data?: { created?: number; timestamp?: number };
    timestamp?: number;
  },
>(
  notifications: T[]
): T[] => {
  const cutoff = Date.now() - NOTIFICATION_AGE_MS;
  return notifications.filter((notification) => {
    const timestamp = getNotificationCreatorTimestamp(notification);
    return timestamp == null || timestamp >= cutoff;
  });
};

/** Message object with "You got a new qmail" in all supported languages (for Q-Mail subscription). */
function getNewQmailMessage(): Record<string, string> {
  const message: Record<string, string> = {};
  for (const lng of Object.keys(supportedLanguages)) {
    message[lng] = i18n.t('core:message.generic.new_qmail', { lng });
  }
  return message;
}

function getCalendarReminderMessage(title: string): Record<string, string> {
  const message: Record<string, string> = {};
  for (const lng of Object.keys(supportedLanguages)) {
    message[lng] = `${i18n.t('core:calendar.reminder', { lng })}: ${title}`;
  }
  return message;
}

const formatChannelLine = (name: string): string => `${name}\n`;

const truncatePreview = (text: string, maxLen: number): string => {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
};

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
  const dmFriendsByAddress = useAtomValue(dmFriendsByAddressAtom);
  const dmFriendsByAddressRef = useRef(dmFriendsByAddress);
  dmFriendsByAddressRef.current = dmFriendsByAddress;
  const reticulumChatEnabled = useAtomValue(reticulumChatEnabledAtom);
  const myAddressRef = useRef(myAddress);
  myAddressRef.current = myAddress;
  const setPaymentNotifications = useSetAtom(paymentNotificationsAtom);
  const customSubscriptions = useAtomValue(customWebsocketSubscriptionsAtom);
  const setCustomSubscriptions = useSetAtom(customWebsocketSubscriptionsAtom);
  const seenInAppKeys = useAtomValue(notificationSeenInAppKeysAtom);
  const setSeenInAppKeys = useSetAtom(notificationSeenInAppKeysAtom);
  const welcomeUnreadMap = useAtomValue(unreadWelcomeEventIdsAtom);
  const welcomeUnreadMapRef = useRef(welcomeUnreadMap);
  welcomeUnreadMapRef.current = welcomeUnreadMap;
  const globalNotifForm = useAtomValue(globalNotificationFormAtom);
  const globalNotifFormRef = useRef(globalNotifForm);
  globalNotifFormRef.current = globalNotifForm;

  const [socketOpen, setSocketOpen] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const connectionIdRef = useRef(0);
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const historyRequestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const namesAbortControllerRef = useRef<AbortController | null>(null);
  const listOfMyNamesRef = useRef<string[]>([]);
  const initWebsocketRef = useRef<(() => Promise<void>) | null>(null);
  /**
   * At most one OS notification per event, across all four handlers.
   *
   * Replaces four independent `Set`s. Ownership was the bug: each handler only
   * knew whether *it* had already notified an event, so a mention and a generic
   * message could both present for the same post, and reply/reaction never
   * consulted the push-level settings at all.
   */
  const qChatOsNotificationClaimsRef = useRef<OsNotificationClaims>(
    new OsNotificationClaims()
  );
  const reticulumDmOsNotifiedEventIdsRef = useRef<Set<string>>(new Set());
  const currentViewContextRef = useRef<QChatViewContext>({
    groupId: -1,
    channelId: '',
    visible: false,
  });

  // Publish the channel on screen to the main process. Notifications are shown
  // from a queue with a multi-second delay, so the submit-time check above can
  // be stale by the time a notification is actually presented. Main re-checks
  // this context at show time and drops notifications for the viewed channel.
  const publishViewContext = useCallback(() => {
    const context: QChatViewContext = {
      ...currentViewContextRef.current,
      visible: computeQChatVisible(),
    };
    currentViewContextRef.current = context;
    void window.reticulumChat
      ?.setViewContext?.(context)
      .catch?.(() => undefined);
  }, []);

  useEffect(() => {
    const onOpenGroup = (e: CustomEvent) => {
      const gid = Number(e.detail?.from);
      if (Number.isFinite(gid)) {
        currentViewContextRef.current = {
          groupId: gid,
          channelId: String(e.detail?.channelId || ''),
          visible: computeQChatVisible(),
        };
        publishViewContext();
      }
    };
    const onViewChannel = (e: CustomEvent) => {
      const gid = Number(e.detail?.groupId);
      const channelId = String(e.detail?.channelId || '');
      // Accept the not-viewing sentinel (negative group id, empty channel).
      // Rejecting it left the ref holding the previously viewed channel with
      // `visible: true`, so notifications for a channel the user had navigated
      // away from were suppressed indefinitely.
      if (!Number.isFinite(gid)) return;
      // Also record it in the shared store, so a payload published before this
      // subscriber attached is still honoured.
      setPublishedViewChannel({ groupId: gid, channelId });
      currentViewContextRef.current = {
        groupId: gid,
        channelId,
        visible: computeQChatVisible(),
      };
      publishViewContext();
    };
    const onDeleteNotification = (e: CustomEvent) => {
      const evId = e.detail?.eventId;
      if (evId) {
        window.reticulumChat?.dismissNotification?.(String(evId));
      }
    };
    const onVisibilityChange = () => publishViewContext();
    subscribeToEvent('openGroupMessage', onOpenGroup);
    subscribeToEvent('qchat-view-channel', onViewChannel);
    subscribeToEvent('q-chat-delete-notification', onDeleteNotification);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onVisibilityChange);
    window.addEventListener('blur', onVisibilityChange);
    publishViewContext();
    return () => {
      unsubscribeFromEvent('openGroupMessage', onOpenGroup);
      unsubscribeFromEvent('qchat-view-channel', onViewChannel);
      unsubscribeFromEvent('q-chat-delete-notification', onDeleteNotification);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onVisibilityChange);
      window.removeEventListener('blur', onVisibilityChange);
      // No view-context reset here: this component mounts once for the app's
      // lifetime and never unmounts, so a cleanup would never run. Stale
      // contexts are prevented at the source instead — ChatGroup publishes an
      // explicit not-viewing sentinel whenever it is inactive — and the main
      // process clears on window blur/hide/closed.
    };
  }, [publishViewContext]);

  useEffect(() => {
    if (!reticulumChatEnabled || !myAddress) return;
    const listeningSince = Date.now();
    reticulumDmOsNotifiedEventIdsRef.current.clear();
    const off = window.reticulumChat?.onDirectEvent?.(({ event }) => {
      if (!event || typeof event !== 'object') return;
      const directEvent = event as {
        eventId?: string;
        eventType?: string;
        senderAddress?: string;
        recipientAddress?: string;
        authorPrimaryName?: string;
        payload?: string;
        timestamp?: number;
        readByOwner?: boolean;
        targetEventId?: string;
      };
      const eventId = String(directEvent.eventId || '');
      if (!eventId) return;

      // Handle DM deletion — dismiss the OS notification and drop any queued one,
      // then skip notification processing. The queue presents items several
      // seconds apart, so a message deleted while its notification is still
      // waiting would otherwise pop up after the user had removed it.
      if (directEvent.eventType === 'delete') {
        if (directEvent.targetEventId) {
          cancelQueuedNotification(
            dmNotificationQueueKey(String(directEvent.targetEventId))
          );
        }
        if (directEvent.senderAddress) {
          window.reticulumChat?.dismissNotifications?.(
            NaN,
            directEvent.senderAddress
          );
        }
        return;
      }

      // The delivery-method lookup below is awaited, so the account can change
      // before the notification is queued. Capture the session now: the queue
      // drops the item if that session has ended, instead of presenting this
      // friend's name and this message preview under the next account.
      const session = captureNotificationSession();

      if (
        reticulumDmOsNotifiedEventIdsRef.current.has(eventId) ||
        !shouldNotifyForReticulumDm({
          event: directEvent,
          friendsByAddress: dmFriendsByAddressRef.current,
          listeningSince,
          myAddress,
          hubIsBeingViewed: isHubBeingViewed(),
        })
      ) {
        return;
      }

      reticulumDmOsNotifiedEventIdsRef.current.add(eventId);
      if (
        reticulumDmOsNotifiedEventIdsRef.current.size >
        RETICULUM_DM_OS_NOTIFICATION_MAX_TRACKED
      ) {
        const oldestEventId = reticulumDmOsNotifiedEventIdsRef.current
          .values()
          .next().value;
        if (oldestEventId) {
          reticulumDmOsNotifiedEventIdsRef.current.delete(oldestEventId);
        }
      }

      const friend = dmFriendsByAddressRef.current[directEvent.senderAddress!];
      const senderName = friend?.name?.trim() || 'a friend';
      let dmMessageText = '';
      try {
        const payloadObj = JSON.parse(String(directEvent.payload || '{}'));
        if (payloadObj && typeof payloadObj === 'object') {
          dmMessageText = String(payloadObj.messageText || '').trim();
        }
      } catch {
        dmMessageText = String(directEvent.payload || '').trim();
      }
      dmMessageText = dmMessageText
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const dmPreviewText = truncatePreview(
        dmMessageText,
        MAX_NOTIFICATION_PREVIEW_CHARS
      );
      getNotificationDeliveryMethod().then((dmDeliveryMethod) => {
        void fireOsNotificationPayment(
          {
            appName: 'Q-Chat',
            appService: 'INTERNAL',
            event: 'RETICULUM_DM_MESSAGE',
          },
          `${senderName} sent you a DM`,
          dmPreviewText,
          qortPng,
          undefined,
          {
            from: directEvent.senderAddress,
            name: friend?.name,
            messageText: dmMessageText,
            senderName,
            reticulumDirectMessage: true,
          },
          dmDeliveryMethod,
          directEvent.senderAddress
            ? { groupId: 0, channelId: directEvent.senderAddress }
            : undefined,
          // No `eventId`: that would change the notification id from the DM
          // routing form to `general`, and a click would stop opening the
          // conversation. The queue key is what deduplicates and cancels.
          undefined,
          dmNotificationQueueKey(eventId),
          session
        );
      });
    });

    const addMissedCallNotification = (record: any) => {
      if (
        record?.ownerAddress !== myAddress ||
        record?.direction !== 'incoming' ||
        record?.outcome !== 'missed' ||
        record?.readAt > 0
      )
        return;
      const callId = String(record.callId || '');
      const peerAddress = String(record.peerAddress || '');
      if (!callId || !peerAddress) return;
      const friend = dmFriendsByAddressRef.current[peerAddress];
      const senderName = friend?.name?.trim() || peerAddress;
      setPaymentNotifications((previous) => [
        ...previous.filter((item) => item?.data?.reticulumDmCallId !== callId),
        {
          appName: 'Q-Chat',
          appService: 'INTERNAL',
          event: 'RETICULUM_DM_MISSED_CALL',
          notificationId: `reticulum-dm-call-${callId}`,
          image: LogoSelected,
          message: { en: `Missed voice call from ${senderName}` },
          timestamp: Number(record.endedAt || Date.now()),
          data: {
            created: Number(record.endedAt || Date.now()),
            from: peerAddress,
            name: friend?.name,
            reticulumDmMissedCall: true,
            reticulumDmCallId: callId,
          },
        },
      ]);
    };
    void window.reticulumChat
      ?.getDirectCallHistory(myAddress, undefined, 50, true)
      .then((records) => records.forEach(addMissedCallNotification))
      .catch(() => undefined);
    const offCalls = window.reticulumChat?.onDirectCallHistory?.(
      ({ record }: any) => {
        if (record?.ownerAddress !== myAddress) return;
        if (record?.outcome === 'missed') {
          addMissedCallNotification(record);
          return;
        }
        const callId = String(record?.callId || '');
        if (!callId) return;
        setPaymentNotifications((previous) =>
          previous.filter((item) => item?.data?.reticulumDmCallId !== callId)
        );
      }
    );
    const offCallSummary = window.reticulumChat?.onDirectSummaryChanged?.(
      ({ peerAddress }: any) => {
        const peer = String(peerAddress || '');
        if (!peer) return;
        void window.reticulumChat
          ?.getDirectCallHistory(myAddress, peer, 1, true)
          .then((records) => {
            if (records.length > 0) return;
            setPaymentNotifications((previous) =>
              previous.filter(
                (item) =>
                  !(
                    item?.data?.reticulumDmMissedCall === true &&
                    item?.data?.from === peer
                  )
              )
            );
          })
          .catch(() => undefined);
      }
    );

    return () => {
      off?.();
      offCalls?.();
      offCallSummary?.();
    };
  }, [myAddress, reticulumChatEnabled, setPaymentNotifications]);

  useEffect(() => {
    if (!reticulumChatEnabled || !myAddress) return;
    const off = window.reticulumChat?.onCalendarReminderDue?.((payload) => {
      if (!payload || typeof payload !== 'object') return;
      const reminder = payload as {
        ownerAddress?: string;
        groupId?: number;
        eventId?: string;
        occurrence?: ReticulumCalendarOccurrence;
      };
      if (reminder.ownerAddress !== myAddress || !reminder.occurrence) return;
      // Same as the DM path: the delivery lookup is awaited, so bind the item to
      // the session that received the reminder before that await.
      const session = captureNotificationSession();
      const occurrence = reminder.occurrence;
      const notificationId = `reticulum-calendar-${occurrence.occurrenceId}`;
      setPaymentNotifications((previous) =>
        trimNotificationsToLast3Days([
          {
            appName: 'Q-Chat',
            appService: 'INTERNAL',
            event: 'RETICULUM_CALENDAR_REMINDER',
            notificationId,
            image: LogoSelected,
            message: getCalendarReminderMessage(occurrence.title),
            timestamp: Date.now(),
            data: {
              created: Date.now(),
              eventId: reminder.eventId,
              groupId: reminder.groupId,
              occurrenceStart: occurrence.occurrenceStart,
              timezone: occurrence.timezone,
              identifier: notificationId,
              reticulumCalendarReminder: true,
            },
          },
          ...previous.filter(
            (item) =>
              !(
                isReticulumCalendarNotification(item) &&
                item?.notificationId === notificationId
              )
          ),
        ])
      );
      if (!isHubBeingViewed()) {
        getNotificationDeliveryMethod().then((calDeliveryMethod) => {
          void fireOsNotificationPayment(
            {
              appName: 'Q-Chat',
              appService: 'INTERNAL',
              event: 'RETICULUM_CALENDAR_REMINDER',
            },
            occurrence.title,
            occurrence.allDay
              ? i18n.t('core:calendar.allDay')
              : `${i18n.t('core:calendar.starts')} ${new Date(
                  occurrence.occurrenceStart
                ).toLocaleString()}`,
            qortPng,
            undefined,
            {
              from: reminder.groupId,
              eventId: reminder.eventId,
              occurrenceStart: occurrence.occurrenceStart,
              timezone: occurrence.timezone,
              openCalendar: true,
            },
            calDeliveryMethod,
            undefined,
            undefined,
            session
          );
        });
      }
    });
    return () => off?.();
  }, [myAddress, reticulumChatEnabled, setPaymentNotifications]);

  const forceCloseWebSocket = () => {
    connectionIdRef.current += 1;
    setSocketOpen(false);
    namesAbortControllerRef.current?.abort();
    namesAbortControllerRef.current = null;
    clearTimeout(historyRequestTimeoutRef.current);
    clearTimeout(reconnectTimeoutRef.current);
    clearTimeout(timeoutIdRef.current);
    clearTimeout(pingTimeoutRef.current);
    historyRequestTimeoutRef.current = null;
    reconnectTimeoutRef.current = null;
    timeoutIdRef.current = null;
    pingTimeoutRef.current = null;
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      socket.close(1000, 'forced');
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
    const off = window.reticulumChat?.onNotificationClicked?.(
      (notificationId) => {
        handleNotificationClick(notificationId);
      }
    );
    return () => off?.();
  }, []);

  useEffect(() => {
    const handler = () => {
      forceCloseWebSocket();
      setSocketOpen(false);
      if (initWebsocketRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          void initWebsocketRef.current?.();
        }, 0);
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
    const handleQChatMention = async (
      event: CustomEvent<{
        broadcastScope?: 'here' | 'everyone' | null;
        channelId?: string;
        eventId?: string;
        groupName?: string;
        groupId?: number;
        isEveryoneOrHere?: boolean;
        mentionCount?: number;
        syncUnreadCount?: boolean;
        messageText?: string;
        senderName?: string;
        timestamp?: number;
      }>
    ) => {
      const detail = event.detail;
      const eventId = String(detail?.eventId || '');
      const groupId = Number(detail?.groupId);
      const isUnreadCountSync = detail?.syncUnreadCount === true;
      if ((!eventId && !isUnreadCountSync) || !Number.isFinite(groupId)) {
        return;
      }
      // Captured before the settings lookups below, which are awaited. Logging
      // out and back in inside that window used to leave this handler running
      // for the previous account: it would then write a bell entry and queue an
      // OS notification under the new one, with the old account's sender, group
      // name and message preview. The token is checked after each await.
      const session = captureNotificationSession();

      const channelId = String(detail?.channelId || 'general');
      const isEveryoneOrHere = detail?.isEveryoneOrHere === true;
      // Copy only: tells the title whether the reader was reached by @here,
      // @everyone, or by name (`null`). The gate above keeps reading the
      // boolean, which the producer derives from this same scope.
      //
      // Narrowed rather than defaulted: this bus is untyped, so a stray value
      // would otherwise fall through `mentionTitleKey`'s null check and render
      // "@everyone" on a direct-mention title.
      const broadcastScope: MentionBroadcastScope =
        normalizeMentionBroadcastScope(detail?.broadcastScope);
      const groupStore = await getGroupNotificationStore(groupId).catch(
        () => null
      );
      const channelMuted = groupStore
        ? isScopeMuted(groupStore, undefined, channelId)
        : false;
      const effectiveSettings = await getEffectiveNotificationSettings(
        groupId,
        undefined,
        channelId,
        globalNotifFormRef.current
      ).catch(() => null);

      // The pair of conditions that used to be inline here — push level plus
      // muted-channel — are now the shared gate's job, so this handler and the
      // generic one cannot disagree about whether a mention also deserves a
      // "posted in channel" notification.
      const shouldPush =
        effectiveSettings != null &&
        !shouldSuppressForMutedChannel(
          channelMuted,
          effectiveSettings.pushLevel,
          true
        );

      const timestamp = Number(detail?.timestamp || Date.now());
      const groupName =
        String(detail?.groupName || '').trim() ||
        i18n.t('group:activity_dashboard.group_fallback_name', { groupId });
      let channelName = getReticulumNotificationChannelLabel(channelId, null);
      let channelVisibilitySymbol = '';
      if (!isUnreadCountSync || Number(detail?.mentionCount || 0) > 0) {
        try {
          const channels = await window.reticulumChat?.getChannels?.(
            groupId,
            true
          );
          channelName = getReticulumNotificationChannelLabel(
            channelId,
            channels
          );
          channelVisibilitySymbol = getChannelVisibilitySymbol(
            channelId,
            channels
          );
        } catch {
          // The stable ID remains a useful fallback while metadata is syncing.
        }
      }
      // Every await above is a chance for the account to change. Abandon the
      // work rather than attributing this mention to whoever is signed in now.
      if (!isNotificationSessionCurrent(session)) return;

      // A summaries refresh must not resurrect the bell entry for the channel
      // the user is looking at. The sync guard used to sit only on the OS-emit
      // block below, so the entry was rebuilt first and the suppression check
      // never ran for this path.
      if (
        isUnreadCountSync &&
        shouldSuppressForCurrentView(currentViewContextRef, groupId, channelId)
      ) {
        return;
      }

      setPaymentNotifications((previous) => {
        const trimmed = trimNotificationsToLast3Days(previous);
        const existing = trimmed.find(
          (notification) =>
            isQChatMentionNotification(notification) &&
            Number(notification?.data?.groupId) === groupId
        );
        if (isUnreadCountSync) {
          let mentionCount = Math.max(0, Number(detail?.mentionCount) || 0);
          if (
            mentionCount > 0 &&
            (groupStore?.notifyOnWelcomePosts ??
              globalNotifFormRef.current.notifyOnWelcomePosts) === false
          ) {
            const welcomeCount = getWelcomeUnreadCount(
              welcomeUnreadMapRef.current,
              groupId
            );
            mentionCount = Math.max(0, mentionCount - welcomeCount);
          }
          if (mentionCount === 0) {
            return trimmed.filter(
              (notification) =>
                !(
                  isQChatMentionNotification(notification) &&
                  Number(notification?.data?.groupId) === groupId
                )
            );
          }
          const syncedNotification = {
            appName: QCHAT_MENTION_NOTIFICATION_APP_NAME,
            appService: 'INTERNAL',
            data: {
              channelId,
              channelName,
              created: timestamp,
              eventId: existing?.data?.eventId || '',
              eventIds: existing?.data?.eventIds || [],
              groupId,
              groupName,
              identifier: `q-chat-mention-${groupId}`,
              mentionCount,
              qChatMention: true,
            },
            event: QCHAT_MENTION_NOTIFICATION_EVENT,
            image: '',
            message: {
              en: mentionCount === 1 ? '1 mention' : `${mentionCount} mentions`,
            },
            notificationId: `q-chat-mention-${groupId}`,
          };
          return [
            syncedNotification,
            ...trimmed.filter(
              (notification) =>
                !(
                  isQChatMentionNotification(notification) &&
                  Number(notification?.data?.groupId) === groupId
                )
            ),
          ];
        }
        const eventIds = Array.isArray(existing?.data?.eventIds)
          ? existing.data.eventIds
          : existing?.data?.eventId
            ? [existing.data.eventId]
            : [];
        if (eventIds.includes(eventId)) return trimmed;

        const nextEventIds = [...eventIds, eventId].slice(-100);
        const mentionCount = Math.max(
          nextEventIds.length,
          Number(existing?.data?.mentionCount) || 0
        );
        const nextNotification = {
          appName: QCHAT_MENTION_NOTIFICATION_APP_NAME,
          appService: 'INTERNAL',
          data: {
            channelId,
            channelName,
            created: timestamp,
            eventId,
            eventIds: nextEventIds,
            groupId,
            groupName,
            identifier: `q-chat-mention-${groupId}`,
            mentionCount,
            qChatMention: true,
          },
          event: QCHAT_MENTION_NOTIFICATION_EVENT,
          image: '',
          message: {
            en: mentionCount === 1 ? '1 mention' : `${mentionCount} mentions`,
          },
          notificationId: `q-chat-mention-${groupId}`,
        };
        return [
          nextNotification,
          ...trimmed.filter(
            (notification) =>
              !(
                isQChatMentionNotification(notification) &&
                Number(notification?.data?.groupId) === groupId
              )
          ),
        ];
      });
      // Unread-count synchronization rebuilds the Hub notification state and
      // must not replay old mentions as OS notifications.
      if (
        shouldPush &&
        !isUnreadCountSync &&
        mayPresentQChatOsNotification(
          qChatOsNotificationClaimsRef.current,
          eventId,
          effectiveSettings,
          { isMentionOfMe: true, isEveryoneOrHere },
          'mention'
        )
      ) {
        const mentionSender =
          detail.senderName ||
          i18n.t('reticulum:notification.someone', {
            postProcess: 'capitalizeFirstChar',
          });
        const mentionText = detail.messageText || '';
        if (
          shouldSuppressForCurrentView(
            currentViewContextRef,
            groupId,
            channelId
          )
        )
          return;
        const previewText = truncatePreview(
          `${channelVisibilitySymbol ? channelVisibilitySymbol + '  ' : ''}${channelName}\n${mentionText}`,
          MAX_NOTIFICATION_PREVIEW_CHARS
        );
        const mentionDeliveryMethod = await getNotificationDeliveryMethod();
        void fireOsNotificationPayment(
          {
            appName: QCHAT_MENTION_NOTIFICATION_APP_NAME,
            appService: 'INTERNAL',
            event: QCHAT_MENTION_NOTIFICATION_EVENT,
          },
          i18n.t(mentionTitleKey(broadcastScope), {
            groupName,
            sender: mentionSender,
            target: mentionTitleTarget(broadcastScope),
          }),
          previewText,
          qortPng,
          undefined,
          {
            channelId,
            eventId,
            from: groupId,
            messageText: mentionText,
            senderName: mentionSender,
            qChatMention: true,
          },
          mentionDeliveryMethod,
          { groupId, channelId },
          eventId,
          undefined,
          session
        );
      }
    };

    const handleQChatReplyNotification = async (
      event: CustomEvent<{
        channelId?: string;
        eventId?: string;
        groupId?: number;
        groupName?: string;
        messageText?: string;
        senderName?: string;
        timestamp?: number;
      }>
    ) => {
      const detail = event.detail;
      const eventId = String(detail?.eventId || '');
      const groupId = Number(detail?.groupId);
      if (!eventId || !Number.isFinite(groupId)) return;
      // Captured before the settings and channel-name lookups below, which are
      // awaited. See the mention handler for why this matters.
      const session = captureNotificationSession();

      const groupName =
        String(detail?.groupName || '').trim() ||
        i18n.t('group:activity_dashboard.group_fallback_name', { groupId });
      const channelId = String(detail?.channelId || 'general');

      const replyGroupStore = await getGroupNotificationStore(groupId).catch(
        () => null
      );
      const replyMuted = replyGroupStore
        ? isScopeMuted(replyGroupStore, undefined, channelId)
        : false;
      if (replyMuted) return;

      let channelName = getReticulumNotificationChannelLabel(channelId, null);
      let channelVisibilitySymbol = '';
      try {
        const channels = await window.reticulumChat?.getChannels?.(
          groupId,
          true
        );
        channelName = getReticulumNotificationChannelLabel(channelId, channels);
        channelVisibilitySymbol = getChannelVisibilitySymbol(
          channelId,
          channels
        );
      } catch {
        // The stable ID remains a useful fallback while metadata is syncing.
      }

      // Reply used to skip the push gate entirely, so `pushLevel: 'none'` with
      // `notifyOnReplies: false` still produced a notification. It now asks the
      // same question as every other handler.
      const replySettings = await getEffectiveNotificationSettings(
        groupId,
        undefined,
        channelId,
        globalNotifFormRef.current
      ).catch(() => null);
      if (!isNotificationSessionCurrent(session)) return;
      if (
        !mayPresentQChatOsNotification(
          qChatOsNotificationClaimsRef.current,
          eventId,
          replySettings,
          { isReplyToMe: true },
          'reply'
        )
      ) {
        return;
      }

      if (
        shouldSuppressForCurrentView(currentViewContextRef, groupId, channelId)
      )
        return;
      const replySender =
        detail.senderName ||
        i18n.t('reticulum:notification.someone', {
          postProcess: 'capitalizeFirstChar',
        });
      const replyText = detail.messageText || '';
      const previewText = truncatePreview(
        `${channelVisibilitySymbol ? channelVisibilitySymbol + '  ' : ''}${channelName}\n${replyText}`,
        MAX_NOTIFICATION_PREVIEW_CHARS
      );
      const replyDeliveryMethod = await getNotificationDeliveryMethod();
      void fireOsNotificationPayment(
        {
          appName: QCHAT_MENTION_NOTIFICATION_APP_NAME,
          appService: 'INTERNAL',
          event: 'Q_CHAT_REPLY',
        },
        i18n.t('reticulum:notification.reply_you_in_group', {
          groupName,
          sender: replySender,
        }),
        previewText,
        qortPng,
        undefined,
        {
          channelId,
          eventId,
          from: groupId,
          messageText: replyText,
          senderName: replySender,
          qChatReply: true,
        },
        replyDeliveryMethod,
        { groupId, channelId },
        eventId,
        undefined,
        session
      );
    };

    /**
     * "Someone joined the group", its own kind rather than a generic post.
     *
     * Title only. The channel name would be noise — a welcome always lands in
     * `general` — so the notice is one interpolated sentence in the title and
     * the body is left empty rather than repeating it. Kept as a single key,
     * never concatenated fragments, because word order differs across the
     * twelve locales.
     */
    const handleQChatWelcomeNotification = async (
      event: CustomEvent<{
        channelId?: string;
        eventId?: string;
        groupId?: number;
        groupName?: string;
        joinedName?: string;
        senderName?: string;
        timestamp?: number;
      }>
    ) => {
      const detail = event.detail;
      const eventId = String(detail?.eventId || '');
      const groupId = Number(detail?.groupId);
      if (!eventId || !Number.isFinite(groupId)) return;
      // Captured before the settings lookups below, which are awaited.
      const session = captureNotificationSession();

      const channelId = String(detail?.channelId || 'general');
      const groupName =
        String(detail?.groupName || '').trim() || `Group ${groupId}`;
      const joinedName =
        String(detail?.joinedName || detail?.senderName || '').trim() ||
        i18n.t('reticulum:notification.someone');

      const welcomeGroupStore = await getGroupNotificationStore(groupId).catch(
        () => null
      );
      const welcomeMuted = welcomeGroupStore
        ? isScopeMuted(welcomeGroupStore, undefined, channelId)
        : false;
      if (welcomeMuted) return;

      const welcomeSettings = await getEffectiveNotificationSettings(
        groupId,
        undefined,
        channelId,
        globalNotifFormRef.current
      ).catch(() => null);
      if (!isNotificationSessionCurrent(session)) return;
      if (
        !mayPresentQChatOsNotification(
          qChatOsNotificationClaimsRef.current,
          eventId,
          welcomeSettings,
          { isWelcomePost: true },
          'welcome'
        )
      ) {
        return;
      }

      if (
        shouldSuppressForCurrentView(currentViewContextRef, groupId, channelId)
      )
        return;

      const welcomeText = i18n.t('reticulum:notification.welcome_joined', {
        name: joinedName,
        groupName,
      });
      const welcomeDeliveryMethod = await getNotificationDeliveryMethod();
      void fireOsNotificationPayment(
        {
          appName: QCHAT_MENTION_NOTIFICATION_APP_NAME,
          appService: 'INTERNAL',
          event: 'Q_CHAT_WELCOME',
        },
        welcomeText,
        // No body: the title already says who joined which group, and a
        // duplicate line under it reads as a rendering bug. An empty body is
        // safe end to end — the Linux helper does `body or ''` and Electron's
        // Notification simply renders without one.
        '',
        qortPng,
        undefined,
        {
          channelId,
          eventId,
          from: groupId,
          senderName: joinedName,
          qChatWelcome: true,
        },
        welcomeDeliveryMethod,
        { groupId, channelId },
        eventId,
        undefined,
        session
      );
    };

    const handleQChatReactionNotification = async (
      event: CustomEvent<{
        channelId?: string;
        eventId?: string;
        groupId?: number;
        groupName?: string;
        senderName?: string;
        reactionEmoji?: string;
        messageText?: string;
        timestamp?: number;
      }>
    ) => {
      const detail = event.detail;
      const eventId = String(detail?.eventId || '');
      const groupId = Number(detail?.groupId);
      if (!eventId || !Number.isFinite(groupId)) return;
      // Captured before the settings lookup below, which is awaited.
      const session = captureNotificationSession();

      const reactionChannelId = String(detail?.channelId || 'general');
      // Reaction also skipped the gate. It now honours `notifyOnReactions`.
      const reactionSettings = await getEffectiveNotificationSettings(
        groupId,
        undefined,
        reactionChannelId,
        globalNotifFormRef.current
      ).catch(() => null);
      // Before the claim, not after: a stale run that claimed the event would
      // suppress the new account's genuine notification for the same event id.
      if (!isNotificationSessionCurrent(session)) return;
      if (
        !mayPresentQChatOsNotification(
          qChatOsNotificationClaimsRef.current,
          eventId,
          reactionSettings,
          { isReactionToMe: true },
          'reaction'
        )
      ) {
        return;
      }

      const reactionSender = detail.senderName || 'Someone';
      const reactionEmoji = detail.reactionEmoji || '';
      const groupName =
        String(detail?.groupName || '').trim() || `Group ${groupId}`;
      const channelId = String(detail?.channelId || 'general');

      const rxnGroupStore = await getGroupNotificationStore(groupId).catch(
        () => null
      );
      const rxnMuted = rxnGroupStore
        ? isScopeMuted(rxnGroupStore, undefined, channelId)
        : false;
      if (rxnMuted) return;

      let channelName = getReticulumNotificationChannelLabel(channelId, null);
      let channelVisibilitySymbol = '';
      try {
        const channels = await window.reticulumChat?.getChannels?.(
          groupId,
          true
        );
        channelName = getReticulumNotificationChannelLabel(channelId, channels);
        channelVisibilitySymbol = getChannelVisibilitySymbol(
          channelId,
          channels
        );
      } catch {
        // The stable ID remains a useful fallback while metadata is syncing.
      }
      const parentMessageText = detail.messageText || '';
      const previewText = parentMessageText
        ? truncatePreview(
            `${channelVisibilitySymbol ? channelVisibilitySymbol + '  ' : ''}${channelName}\n${parentMessageText}`,
            MAX_NOTIFICATION_PREVIEW_CHARS
          )
        : '';
      if (
        shouldSuppressForCurrentView(currentViewContextRef, groupId, channelId)
      )
        return;
      const reactionDeliveryMethod = await getNotificationDeliveryMethod();
      void fireOsNotificationPayment(
        {
          appName: QCHAT_MENTION_NOTIFICATION_APP_NAME,
          appService: 'INTERNAL',
          event: 'Q_CHAT_REACTION',
        },
        `${reactionSender} reacted to your post with ${reactionEmoji} in ${groupName}`,
        previewText,
        qortPng,
        undefined,
        {
          channelId,
          eventId,
          from: groupId,
          senderName: reactionSender,
          messageText: parentMessageText,
          qChatReaction: true,
        },
        reactionDeliveryMethod,
        { groupId, channelId },
        eventId,
        undefined,
        session
      );
    };

    const handleQChatMessageNotification = async (
      event: CustomEvent<{
        channelId?: string;
        eventId?: string;
        groupId?: number;
        groupName?: string;
        messageText?: string;
        senderName?: string;
        timestamp?: number;
      }>
    ) => {
      const detail = event.detail;
      const eventId = String(detail?.eventId || '');
      const groupId = Number(detail?.groupId);
      if (!eventId || !Number.isFinite(groupId)) return;
      // Captured before the settings and channel-name lookups below, which are
      // awaited. See the mention handler for why this matters.
      const session = captureNotificationSession();

      const channelId = String(detail?.channelId || 'general');
      const groupStore = await getGroupNotificationStore(groupId).catch(
        () => null
      );
      const channelMuted = groupStore
        ? isScopeMuted(groupStore, undefined, channelId)
        : false;
      const effectiveSettings = await getEffectiveNotificationSettings(
        groupId,
        undefined,
        channelId,
        globalNotifFormRef.current
      ).catch(() => null);

      const channelAllowed =
        effectiveSettings != null &&
        !shouldSuppressForMutedChannel(
          channelMuted,
          effectiveSettings.pushLevel,
          false
        );

      if (!channelAllowed) return;

      // Before the claim: a stale run that claimed the event would suppress the
      // new account's genuine notification for the same event id.
      if (!isNotificationSessionCurrent(session)) return;

      // The generic notification is the fallback kind: the shared gate refuses
      // it whenever the same post also merits a reply or mention, which is what
      // produced two notifications per post under `pushLevel: 'all'`.
      if (
        !mayPresentQChatOsNotification(
          qChatOsNotificationClaimsRef.current,
          eventId,
          effectiveSettings,
          {},
          'message'
        )
      ) {
        return;
      }

      const groupName =
        String(detail?.groupName || '').trim() || `Group ${groupId}`;
      let channelName = getReticulumNotificationChannelLabel(channelId, null);
      let channelVisibilitySymbol = '';
      try {
        const channels = await window.reticulumChat?.getChannels?.(
          groupId,
          true
        );
        channelName = getReticulumNotificationChannelLabel(channelId, channels);
        channelVisibilitySymbol = getChannelVisibilitySymbol(
          channelId,
          channels
        );
      } catch {
        // The stable ID remains a useful fallback while metadata is syncing.
      }

      const msgSender = detail.senderName || 'Someone';
      const msgText = detail.messageText || '';
      const previewText = truncatePreview(
        `${channelVisibilitySymbol ? channelVisibilitySymbol + '  ' : ''}${channelName}\n${msgText}`,
        MAX_NOTIFICATION_PREVIEW_CHARS
      );
      const messageDeliveryMethod = await getNotificationDeliveryMethod();
      void fireOsNotificationPayment(
        {
          appName: QCHAT_MENTION_NOTIFICATION_APP_NAME,
          appService: 'INTERNAL',
          event: 'Q_CHAT_MESSAGE',
        },
        `${msgSender} posted in ${groupName}`,
        previewText,
        qortPng,
        undefined,
        {
          channelId,
          eventId,
          from: groupId,
          messageText: msgText,
          senderName: msgSender,
          qChatMessage: true,
        },
        messageDeliveryMethod,
        { groupId, channelId },
        eventId,
        undefined,
        session
      );
    };

    subscribeToEvent(
      'q-chat-mention-notification',
      handleQChatMention as EventListener
    );
    subscribeToEvent(
      'q-chat-reply-notification',
      handleQChatReplyNotification as EventListener
    );
    subscribeToEvent(
      'q-chat-welcome-notification',
      handleQChatWelcomeNotification as EventListener
    );
    subscribeToEvent(
      'q-chat-reaction-notification',
      handleQChatReactionNotification as EventListener
    );
    subscribeToEvent(
      'q-chat-message-notification',
      handleQChatMessageNotification as EventListener
    );
    return () => {
      unsubscribeFromEvent(
        'q-chat-mention-notification',
        handleQChatMention as EventListener
      );
      unsubscribeFromEvent(
        'q-chat-reply-notification',
        handleQChatReplyNotification as EventListener
      );
      unsubscribeFromEvent(
        'q-chat-welcome-notification',
        handleQChatWelcomeNotification as EventListener
      );
      unsubscribeFromEvent(
        'q-chat-reaction-notification',
        handleQChatReactionNotification as EventListener
      );
      unsubscribeFromEvent(
        'q-chat-message-notification',
        handleQChatMessageNotification as EventListener
      );
    };
  }, [setPaymentNotifications]);

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

    let effectActive = true;

    const pingHeads = (
      socket: WebSocket,
      isCurrentConnection: (socket?: WebSocket | null) => boolean
    ) => {
      try {
        if (
          isCurrentConnection(socket) &&
          socket.readyState === WebSocket.OPEN
        ) {
          socket.send('ping');
          timeoutIdRef.current = setTimeout(() => {
            timeoutIdRef.current = null;
            if (isCurrentConnection(socket)) {
              socket.close();
              clearTimeout(pingTimeoutRef.current);
              pingTimeoutRef.current = null;
            }
          }, 5000);
        }
      } catch (error) {
        console.error('Error during ping (notifications):', error);
      }
    };

    const initWebsocketNotifications = async () => {
      forceCloseWebSocket();
      const connectionId = connectionIdRef.current;
      const isCurrentConnection = (socket?: WebSocket | null) => {
        if (!effectActive || connectionIdRef.current !== connectionId) {
          return false;
        }
        if (socket && socketRef.current !== socket) return false;
        return true;
      };
      const currentAddress = myAddress;
      if (extStateRef.current === 'not-authenticated') return;
      if (currentAddress !== myAddressRef.current) return;

      const namesAbortController = new AbortController();
      namesAbortControllerRef.current = namesAbortController;
      try {
        const getNamesUrl = `${getBaseApiReact()}/names/address/${currentAddress}?limit=0`;
        const namesResponse = await fetch(getNamesUrl, {
          signal: namesAbortController.signal,
        });
        const namesData = await namesResponse.json();
        if (!isCurrentConnection()) return;
        listOfMyNamesRef.current = namesData.map(
          (n: { name: string }) => n.name
        );
        const query = `qortal_qmail_${userName.slice(0, 20)}_${currentAddress.slice(-6)}_mail_`;
        const socketLink = `${getBaseApiReactSocket()}/websockets/notifications`;
        const socket = new WebSocket(socketLink);
        socketRef.current = socket;

        socket.onopen = () => {
          if (!isCurrentConnection(socket)) {
            socket.close(1000, 'superseded');
            return;
          }
          setSocketOpen(true);
          socket.send(
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
          historyRequestTimeoutRef.current = setTimeout(() => {
            historyRequestTimeoutRef.current = null;
            if (
              !isCurrentConnection(socket) ||
              socket.readyState !== WebSocket.OPEN
            )
              return;
            const after = Date.now() - 3 * 24 * 60 * 60 * 1000; // 3 days ago (ms)
            socket.send(
              JSON.stringify({
                action: 'notification-history',
                paymentReceivedLimit: 5,
                after,
              })
            );
          }, 1000);
          pingTimeoutRef.current = setTimeout(
            () => pingHeads(socket, isCurrentConnection),
            50
          );
        };

        socket.onmessage = (e) => {
          if (!isCurrentConnection(socket)) return;
          try {
            if (e.data === 'pong') {
              clearTimeout(timeoutIdRef.current);
              timeoutIdRef.current = null;
              pingTimeoutRef.current = setTimeout(
                () => pingHeads(socket, isCurrentConnection),
                20000
              );
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
                setPaymentNotifications((previous) => [
                  ...previous.filter(isQChatMentionNotification),
                  ...trimNotificationsToLast3Days(filtered),
                ]);
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

        socket.onclose = (event) => {
          if (!isCurrentConnection(socket)) return;
          socketRef.current = null;
          setSocketOpen(false);
          clearTimeout(historyRequestTimeoutRef.current);
          historyRequestTimeoutRef.current = null;
          clearTimeout(pingTimeoutRef.current);
          clearTimeout(timeoutIdRef.current);
          console.warn(
            `Notifications WebSocket closed: ${event.reason || 'unknown reason'}`
          );
          if (extStateRef.current === 'not-authenticated') return;
          if (event.reason !== 'forced' && event.code !== 1000) {
            reconnectTimeoutRef.current = setTimeout(() => {
              reconnectTimeoutRef.current = null;
              if (isCurrentConnection()) {
                void initWebsocketNotifications();
              }
            }, 10000);
          }
        };

        socket.onerror = (error) => {
          if (!isCurrentConnection(socket)) return;
          console.error('Notifications WebSocket error:', error);
          clearTimeout(pingTimeoutRef.current);
          clearTimeout(timeoutIdRef.current);
          socket.close();
        };
      } catch (error) {
        if (namesAbortController.signal.aborted) return;
        console.error('Error initializing notifications WebSocket:', error);
      } finally {
        if (namesAbortControllerRef.current === namesAbortController) {
          namesAbortControllerRef.current = null;
        }
      }
    };

    initWebsocketRef.current = initWebsocketNotifications;

    (async () => {
      const filtered = await filterSubscriptionsByNotificationPermission(
        customSubscriptions ?? []
      );
      if (!effectActive) return;
      setCustomSubscriptions(filtered);
      void initWebsocketNotifications();
    })();

    return () => {
      effectActive = false;
      initWebsocketRef.current = null;
      forceCloseWebSocket();
    };
  }, [myAddress, extState, userName]);

  return null;
};
