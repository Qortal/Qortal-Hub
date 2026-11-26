import type { DmFriendStored } from '../atoms/global';

export const RETICULUM_DM_NOTIFICATION_CLOCK_SKEW_MS = 60_000;

type ReticulumDmNotificationEvent = {
  eventId?: unknown;
  eventType?: unknown;
  senderAddress?: unknown;
  recipientAddress?: unknown;
  timestamp?: unknown;
  readByOwner?: unknown;
};

export function isHubBeingViewed(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
}

export function shouldNotifyForReticulumDm({
  event,
  friendsByAddress,
  listeningSince,
  myAddress,
  hubIsBeingViewed,
}: {
  event: ReticulumDmNotificationEvent;
  friendsByAddress: Record<string, DmFriendStored>;
  listeningSince: number;
  myAddress: string;
  hubIsBeingViewed: boolean;
}): boolean {
  const eventId = typeof event?.eventId === 'string' ? event.eventId : '';
  const senderAddress =
    typeof event?.senderAddress === 'string' ? event.senderAddress : '';
  const recipientAddress =
    typeof event?.recipientAddress === 'string' ? event.recipientAddress : '';
  const timestamp = Number(event?.timestamp);

  return Boolean(
    eventId &&
    event.eventType === 'message' &&
    senderAddress &&
    senderAddress !== myAddress &&
    recipientAddress === myAddress &&
    friendsByAddress?.[senderAddress] &&
    event.readByOwner !== true &&
    !hubIsBeingViewed &&
    Number.isFinite(timestamp) &&
    timestamp >= listeningSince - RETICULUM_DM_NOTIFICATION_CLOCK_SKEW_MS
  );
}
