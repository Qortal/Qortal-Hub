import { getBaseApiReact } from '../../App';
import { executeEvent } from '../../utils/events';

export const RETICULUM_JOIN_UNREAD_BASELINE_PREFIX =
  'qchat-reticulum-join-unread-baseline-v1';
export const MAX_RETICULUM_JOIN_UNREAD_BASELINES = 256;
const DEFAULT_RETICULUM_CHANNEL_ID = 'general';
const cleanedBaselineKeys = new Set<string>();

const baselineStorageKey = (
  groupId: number,
  address: string,
  joinedAt: number
) =>
  `${RETICULUM_JOIN_UNREAD_BASELINE_PREFIX}:${groupId}:${address}:${joinedAt}`;

const readStoredChannels = (key: string): Set<string> => {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || '[]');
    return new Set(
      Array.isArray(value)
        ? value
            .map((channelId) => String(channelId || '').trim())
            .filter(Boolean)
        : []
    );
  } catch {
    return new Set();
  }
};

const writeStoredChannels = (key: string, channelIds: Set<string>) => {
  try {
    window.localStorage.setItem(key, JSON.stringify([...channelIds]));
  } catch {
    // A storage failure must not prevent the read watermark from being applied.
  }
};

type ReticulumJoinUnreadBaselineIdentity = {
  address: string;
  groupId: number;
  joinedAt: number;
};

const parseBaselineStorageKey = (key: string) => {
  const prefix = `${RETICULUM_JOIN_UNREAD_BASELINE_PREFIX}:`;
  if (!key.startsWith(prefix)) return null;

  const parts = key.slice(prefix.length).split(':');
  if (parts.length !== 3) return null;
  const groupId = Number(parts[0]);
  const address = String(parts[1] || '').trim();
  const joinedAt = Number(parts[2]);
  if (
    !Number.isInteger(groupId) ||
    groupId <= 0 ||
    !address ||
    !Number.isFinite(joinedAt) ||
    joinedAt <= 0
  ) {
    return null;
  }

  return { address, groupId, joinedAt };
};

export const cleanupReticulumJoinUnreadBaselines = ({
  address,
  groupId,
  joinedAt,
}: ReticulumJoinUnreadBaselineIdentity) => {
  if (typeof window === 'undefined') return false;

  const currentKey = baselineStorageKey(groupId, address, joinedAt);
  try {
    const validOtherRecords: Array<{ joinedAt: number; key: string }> = [];
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(`${RETICULUM_JOIN_UNREAD_BASELINE_PREFIX}:`)) {
        continue;
      }

      const parsed = parseBaselineStorageKey(key);
      if (!parsed) {
        window.localStorage.removeItem(key);
        continue;
      }

      const obsoleteMembership =
        parsed.groupId === groupId &&
        parsed.address === address &&
        key !== currentKey;
      if (obsoleteMembership) {
        window.localStorage.removeItem(key);
        continue;
      }

      if (key !== currentKey) {
        validOtherRecords.push({ joinedAt: parsed.joinedAt, key });
      }
    }

    validOtherRecords.sort(
      (left, right) =>
        right.joinedAt - left.joinedAt || right.key.localeCompare(left.key)
    );
    for (
      let index = MAX_RETICULUM_JOIN_UNREAD_BASELINES - 1;
      index < validOtherRecords.length;
      index += 1
    ) {
      window.localStorage.removeItem(validOtherRecords[index].key);
    }
    return true;
  } catch {
    // Cleanup is best-effort and must not prevent applying the read baseline.
    return false;
  }
};

const cleanupReticulumJoinUnreadBaselinesOnce = (
  identity: ReticulumJoinUnreadBaselineIdentity
) => {
  const key = baselineStorageKey(
    identity.groupId,
    identity.address,
    identity.joinedAt
  );
  if (cleanedBaselineKeys.has(key)) return;
  if (cleanedBaselineKeys.size >= MAX_RETICULUM_JOIN_UNREAD_BASELINES) {
    cleanedBaselineKeys.clear();
  }
  if (cleanupReticulumJoinUnreadBaselines(identity)) {
    cleanedBaselineKeys.add(key);
  }
};

export const resolveReticulumMembershipJoinedAt = async (
  groupId: number,
  address: string
): Promise<number | null> => {
  const normalizedAddress = String(address || '').trim();
  if (!Number.isInteger(groupId) || groupId <= 0 || !normalizedAddress) {
    return null;
  }
  const response = await fetch(
    `${getBaseApiReact()}/groups/members/${groupId}?limit=0`
  );
  if (!response.ok) return null;
  const data = await response.json();
  const member = Array.isArray(data?.members)
    ? data.members.find(
        (candidate: any) =>
          String(candidate?.member || '').trim() === normalizedAddress
      )
    : null;
  const joinedAt = Number(member?.joined);
  return Number.isFinite(joinedAt) && joinedAt > 0 ? joinedAt : null;
};

export const applyReticulumJoinUnreadBaseline = async ({
  address,
  groupId,
  joinedAt,
  knownChannelIds = [],
}: {
  address: string;
  groupId: number;
  joinedAt: number;
  knownChannelIds?: string[];
}): Promise<boolean> => {
  const normalizedAddress = String(address || '').trim();
  if (
    !Number.isInteger(groupId) ||
    groupId <= 0 ||
    !normalizedAddress ||
    !Number.isFinite(joinedAt) ||
    joinedAt <= 0 ||
    typeof window.reticulumChat?.markRead !== 'function'
  ) {
    return false;
  }

  cleanupReticulumJoinUnreadBaselinesOnce({
    address: normalizedAddress,
    groupId,
    joinedAt,
  });

  const channelIds = new Set<string>([DEFAULT_RETICULUM_CHANNEL_ID]);
  for (const channelId of knownChannelIds) {
    const normalizedChannelId = String(channelId || '').trim();
    if (normalizedChannelId) channelIds.add(normalizedChannelId);
  }
  try {
    const channels = await window.reticulumChat.getChannels?.(groupId, true);
    if (Array.isArray(channels)) {
      for (const channel of channels as Array<{ channelId?: string }>) {
        const channelId = String(channel?.channelId || '').trim();
        if (channelId) channelIds.add(channelId);
      }
    }
  } catch {
    // The membership bridge may still be synchronizing. Callers retry.
  }

  const storageKey = baselineStorageKey(groupId, normalizedAddress, joinedAt);
  const completedChannels = readStoredChannels(storageKey);
  const newlyBaselinedChannelIds: string[] = [];
  for (const channelId of channelIds) {
    if (completedChannels.has(channelId)) continue;
    try {
      const result = await window.reticulumChat.markRead(
        groupId,
        channelId,
        joinedAt,
        normalizedAddress
      );
      if (result?.success !== true) continue;
      completedChannels.add(channelId);
      newlyBaselinedChannelIds.push(channelId);
    } catch {
      // A later membership/channel refresh will retry this channel.
    }
  }
  if (newlyBaselinedChannelIds.length > 0) {
    // Do NOT dismiss OS notifications here.
    //
    // Baselining is about the read watermark: messages that predate the join
    // must not count as unread. Dismissal is a different concern — it means
    // "the reader has seen this channel", and only entering or reading a
    // channel may cause it.
    //
    // Dismissing per channel was still wrong: this runs on the first load of
    // every group, and it dismissed every channel it could baseline, so a
    // notification in General was cleared while the reader was in another
    // channel. Because the persisted baseline makes this a one-shot per
    // membership period, the effect was invisible on later loads but reliable
    // on the first one — including the automated welcome message.
    //
    // Pre-join history cannot notify anyway: notifications are generated from
    // live events, not from backfilled messages.
    writeStoredChannels(storageKey, completedChannels);
    cleanupReticulumJoinUnreadBaselines({
      address: normalizedAddress,
      groupId,
      joinedAt,
    });
    executeEvent('reticulum-chat-summaries-refresh', {});
  }
  return completedChannels.size > 0;
};
