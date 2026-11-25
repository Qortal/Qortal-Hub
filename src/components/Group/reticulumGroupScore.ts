import { useEffect, useSyncExternalStore } from 'react';
import { getBaseApiReact } from '../../App';

// Scoring contract and rationale: docs/reticulum-group-score.md

const GROUP_SCORE_CACHE_KEY = 'qortal-reticulum-group-score-snapshot-v1';
const GROUP_SCORE_VERSION = 4;
const GROUP_SCORE_SLOT_MS = 6 * 60 * 60_000;
const GROUP_SCORE_MAX_STALE_MS = 24 * 60 * 60_000;
const UNKNOWN_GROUP_REFRESH_COOLDOWN_MS = 5 * 60_000;
const QORT_HOLDING_TARGET = 1_000_000;
const ACTIVITY_AUTHORS_TARGET = 50;
const ACTIVITY_MESSAGES_7D_TARGET = 500;
const ACTIVITY_MESSAGES_24H_TARGET = 100;

export type ReticulumGroupActivityMetrics = {
  activeAuthors7d: number;
  confidence: number;
  messages24h: number;
  messages7d: number;
  observedAt: number;
};

export type ReticulumGroupScoreBreakdown = {
  activity: ReticulumGroupActivityMetrics;
  activityObserved?: boolean;
  activityScore: number;
  balance: number;
  capturedAt: number;
  communityScore: number;
  created: number;
  groupId: number;
  holdingScore: number;
  legacyScore: number;
  memberCount: number;
  score: number;
};

export type ReticulumGroupScoreSnapshot = {
  capturedAt: number;
  evaluatedGroupIds: string[];
  groups: Record<string, ReticulumGroupScoreBreakdown>;
  holdings: Record<string, number>;
  networkOffsetMs: number;
  slot: number;
  version: 4;
};

const EMPTY_SNAPSHOT: ReticulumGroupScoreSnapshot = {
  capturedAt: 0,
  evaluatedGroupIds: [],
  groups: {},
  holdings: {},
  networkOffsetMs: 0,
  slot: -1,
  version: GROUP_SCORE_VERSION,
};

const clampScore = (value: number) =>
  Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

const logarithmicScore = (value: number, target: number) => {
  const normalizedValue = Math.max(0, Number(value) || 0);
  if (normalizedValue <= 0) return 0;
  return clampScore((Math.log1p(normalizedValue) / Math.log1p(target)) * 100);
};

const proportionalScore = (value: number, target: number) =>
  clampScore((Math.max(0, Number(value) || 0) / target) * 100);

export const getLegacyLevel = (timestamp?: number | string) => {
  const created = Number(timestamp);
  if (!Number.isFinite(created) || created <= 0) return null;
  const start = new Date(created);
  const now = new Date();
  let years = now.getFullYear() - start.getFullYear();
  if (
    now.getMonth() < start.getMonth() ||
    (now.getMonth() === start.getMonth() && now.getDate() < start.getDate())
  ) {
    years -= 1;
  }
  return Math.max(0, Math.min(10, years));
};

export const getCommunityLevel = (count?: number) => {
  const members = Math.max(0, Number(count) || 0);
  if (members <= 10) return 1;
  if (members <= 25) return 2;
  if (members <= 50) return 3;
  if (members <= 99) return 4;
  if (members <= 249) return 5;
  if (members <= 499) return 6;
  if (members <= 999) return 7;
  if (members <= 2499) return 8;
  if (members <= 4999) return 9;
  return 10;
};

export const getReticulumGroupScoreColor = (score?: number | null) => {
  if (!Number.isFinite(score)) return '#8F96A5';
  if (Number(score) <= 24) return '#EF4444';
  if (Number(score) <= 44) return '#F97316';
  if (Number(score) <= 64) return '#FACC15';
  if (Number(score) <= 94) return '#22C55E';
  return '#00A8FF';
};

export const calculateReticulumGroupScore = (input: {
  activity: ReticulumGroupActivityMetrics;
  activityObserved: boolean;
  balance: number;
  capturedAt: number;
  created: number;
  groupId: number;
  memberCount: number;
}): ReticulumGroupScoreBreakdown | null => {
  const legacyLevel = getLegacyLevel(input.created);
  if (legacyLevel == null) return null;
  const holdingScore = logarithmicScore(input.balance, QORT_HOLDING_TARGET);
  const activeAuthorsScore = proportionalScore(
    input.activity.activeAuthors7d,
    ACTIVITY_AUTHORS_TARGET
  );
  const messages7dScore = proportionalScore(
    input.activity.messages7d,
    ACTIVITY_MESSAGES_7D_TARGET
  );
  const messages24hScore = proportionalScore(
    input.activity.messages24h,
    ACTIVITY_MESSAGES_24H_TARGET
  );
  const activityScore =
    activeAuthorsScore * 0.5 + messages7dScore * 0.3 + messages24hScore * 0.2;
  const legacyScore = Math.min(100, legacyLevel * 10);
  const communityScore = getCommunityLevel(input.memberCount) * 10;
  const score = Math.round(
    holdingScore * 0.5 +
      activityScore * 0.3 +
      legacyScore * 0.1 +
      communityScore * 0.1
  );
  return {
    ...input,
    activityScore,
    communityScore,
    holdingScore,
    legacyScore,
    score: Math.max(0, Math.min(100, score)),
  };
};

const readCachedSnapshot = (): ReticulumGroupScoreSnapshot => {
  if (typeof window === 'undefined') return EMPTY_SNAPSHOT;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(GROUP_SCORE_CACHE_KEY) || 'null'
    );
    if (
      !parsed ||
      parsed.version !== GROUP_SCORE_VERSION ||
      !Array.isArray(parsed.evaluatedGroupIds) ||
      !parsed.groups ||
      typeof parsed.groups !== 'object' ||
      !parsed.holdings ||
      typeof parsed.holdings !== 'object'
    ) {
      return EMPTY_SNAPSHOT;
    }
    const networkNow = Date.now() + (Number(parsed.networkOffsetMs) || 0);
    if (
      networkNow - Number(parsed.capturedAt || 0) >
      GROUP_SCORE_MAX_STALE_MS
    ) {
      return EMPTY_SNAPSHOT;
    }
    return parsed as ReticulumGroupScoreSnapshot;
  } catch {
    return EMPTY_SNAPSHOT;
  }
};

let currentSnapshot = readCachedSnapshot();
let refreshInFlight: Promise<ReticulumGroupScoreSnapshot> | null = null;
const listeners = new Set<() => void>();
const unknownGroupRefreshes = new Map<string, number>();

const emitSnapshot = (snapshot: ReticulumGroupScoreSnapshot) => {
  currentSnapshot = snapshot;
  try {
    window.localStorage.setItem(
      GROUP_SCORE_CACHE_KEY,
      JSON.stringify(snapshot)
    );
  } catch {
    // Scores remain available for the current session without persistent storage.
  }
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => currentSnapshot;

const currentNetworkTime = () =>
  Date.now() + (Number(currentSnapshot.networkOffsetMs) || 0);

const currentSlot = () =>
  Math.floor(currentNetworkTime() / GROUP_SCORE_SLOT_MS);

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

export const refreshReticulumGroupScores = async (
  force = false
): Promise<ReticulumGroupScoreSnapshot> => {
  if (!force && currentSnapshot.slot === currentSlot()) return currentSnapshot;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const baseApi = getBaseApiReact();
      const [balancesResponse, adminInfo] = await Promise.all([
        fetch(`${baseApi}/groups/balances?limit=0&reverse=true`),
        fetch(`${baseApi}/admin/info`)
          .then((response) => (response.ok ? response.json() : null))
          .catch(() => null),
      ]);
      if (!balancesResponse.ok) {
        throw new Error(
          `Group balances request failed (${balancesResponse.status})`
        );
      }
      const balances = await balancesResponse.json();
      if (!Array.isArray(balances)) {
        throw new Error('Group balances response is invalid');
      }
      const networkTimestamp = Number(adminInfo?.currentTimestamp);
      const networkOffsetMs = Number.isFinite(networkTimestamp)
        ? networkTimestamp - Date.now()
        : currentSnapshot.networkOffsetMs;
      const capturedAt = Date.now() + networkOffsetMs;
      const slot = Math.floor(capturedAt / GROUP_SCORE_SLOT_MS);
      const discoveryGroups = balances.filter((group: any) => {
        const groupId = Number(group?.groupId);
        return Number.isInteger(groupId) && groupId > 0;
      });
      const holdings = Object.fromEntries(
        discoveryGroups.map((group: any) => [
          String(group.groupId),
          Math.max(0, Number(group?.balance) || 0),
        ])
      );
      const discoveryGroupIds = discoveryGroups.map((group: any) =>
        Number(group.groupId)
      );

      await window.reticulumChat?.setPublicGroupDirectory?.(discoveryGroupIds);
      const readActivity = async () => {
        if (!window.reticulumChat?.getPublicGroupActivitySnapshot) {
          throw new Error('Public group Activity snapshot is unavailable');
        }
        return window.reticulumChat.getPublicGroupActivitySnapshot();
      };
      const firstActivity = await readActivity();
      await delay(3_000);
      const latestActivity = await readActivity();
      const activityByGroup = new Map<number, ReticulumGroupActivityMetrics>();
      for (const summary of [
        ...(firstActivity?.summaries || []),
        ...(latestActivity?.summaries || []),
      ]) {
        const groupId = Number(summary?.groupId);
        if (!Number.isInteger(groupId) || groupId <= 0) continue;
        const previous = activityByGroup.get(groupId);
        if (!previous || Number(summary.observedAt) >= previous.observedAt) {
          activityByGroup.set(groupId, {
            activeAuthors7d: Math.max(0, Number(summary.activeAuthors7d) || 0),
            confidence: Math.max(0, Number(summary.confidence) || 0),
            messages24h: Math.max(0, Number(summary.messages24h) || 0),
            messages7d: Math.max(0, Number(summary.messages7d) || 0),
            observedAt: Number(summary.observedAt) || capturedAt,
          });
        }
      }
      const availableGroupIds = new Set<number>(
        [
          ...(firstActivity?.availableGroupIds || []),
          ...(latestActivity?.availableGroupIds || []),
        ].map(Number)
      );

      const discoveryIds = new Set(discoveryGroupIds.map(String));
      const preservingCurrentSlot = currentSnapshot.slot === slot;
      const nextGroups: Record<string, ReticulumGroupScoreBreakdown> = {};
      for (const [groupId, previous] of Object.entries(
        currentSnapshot.groups
      )) {
        if (
          discoveryIds.has(groupId) &&
          capturedAt - Number(previous?.capturedAt || 0) <=
            GROUP_SCORE_MAX_STALE_MS
        ) {
          nextGroups[groupId] = previous;
        }
      }
      for (const group of discoveryGroups) {
        const groupId = Number(group?.groupId);
        if (!Number.isInteger(groupId) || groupId <= 0) continue;
        const groupKey = String(groupId);
        const previous = nextGroups[groupKey];
        const activityObserved = availableGroupIds.has(groupId);
        if (preservingCurrentSlot && previous) {
          const previousActivityWasObserved =
            previous.activityObserved !== false;
          if (previousActivityWasObserved || !activityObserved) continue;
        }
        if (!activityObserved && previous) continue;
        const activity = activityByGroup.get(groupId) || {
          activeAuthors7d: 0,
          confidence: activityObserved ? 1 : 0,
          messages24h: 0,
          messages7d: 0,
          observedAt: capturedAt,
        };
        const breakdown = calculateReticulumGroupScore({
          activity,
          activityObserved,
          balance: Math.max(0, Number(group?.balance) || 0),
          capturedAt,
          created: Number(
            group?.created ?? group?.creationTimestamp ?? group?.createdAt
          ),
          groupId,
          memberCount: Math.max(0, Number(group?.memberCount) || 0),
        });
        if (breakdown) nextGroups[groupKey] = breakdown;
      }
      const nextSnapshot: ReticulumGroupScoreSnapshot = {
        capturedAt,
        evaluatedGroupIds: [...discoveryIds],
        groups: nextGroups,
        holdings,
        networkOffsetMs,
        slot,
        version: GROUP_SCORE_VERSION,
      };
      emitSnapshot(nextSnapshot);
      return nextSnapshot;
    } catch (error) {
      console.warn('[ReticulumGroupScore] Refresh failed:', error);
      return currentSnapshot;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
};

export const ensureReticulumGroupScore = (groupId?: string | number) => {
  const normalizedGroupId = String(groupId ?? '').trim();
  if (!normalizedGroupId) return refreshReticulumGroupScores(false);
  const existing = currentSnapshot.groups[normalizedGroupId];
  if (
    existing &&
    currentNetworkTime() - existing.capturedAt <= GROUP_SCORE_MAX_STALE_MS
  ) {
    return Promise.resolve(currentSnapshot);
  }
  if (
    currentSnapshot.slot === currentSlot() &&
    currentSnapshot.evaluatedGroupIds.includes(normalizedGroupId)
  ) {
    return Promise.resolve(currentSnapshot);
  }
  const lastRequested = unknownGroupRefreshes.get(normalizedGroupId) || 0;
  if (Date.now() - lastRequested < UNKNOWN_GROUP_REFRESH_COOLDOWN_MS) {
    return Promise.resolve(currentSnapshot);
  }
  unknownGroupRefreshes.set(normalizedGroupId, Date.now());
  return refreshReticulumGroupScores(true);
};

export const startReticulumGroupScoreScheduler = () => {
  void refreshReticulumGroupScores(false);
  const interval = window.setInterval(() => {
    void refreshReticulumGroupScores(false);
  }, 60_000);
  return () => window.clearInterval(interval);
};

export const useReticulumGroupScoreSnapshot = () =>
  useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_SNAPSHOT);

export const useReticulumGroupScore = (groupId?: string | number) => {
  const snapshot = useReticulumGroupScoreSnapshot();
  const normalizedGroupId = String(groupId ?? '').trim();
  const score = normalizedGroupId
    ? snapshot.groups[normalizedGroupId]
    : undefined;
  useEffect(() => {
    if (!normalizedGroupId || score) return;
    void ensureReticulumGroupScore(normalizedGroupId);
  }, [normalizedGroupId, score]);
  if (
    !score ||
    currentNetworkTime() - score.capturedAt > GROUP_SCORE_MAX_STALE_MS
  ) {
    return undefined;
  }
  return score;
};
