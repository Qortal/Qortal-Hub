import { useCallback, useEffect, useRef } from 'react';
import { unstable_batchedUpdates } from 'react-dom';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { extStateAtom, userInfoAtom } from '../atoms/global';
import {
  isIdleAtom,
  isOnlineAtomFamily,
  myStatusAtom,
  onlineAddressesAtom,
  SelectableStatus,
  statusAtomFamily,
  statusMapAtom,
  UserStatus,
} from '../atoms/presence';

// ── Constants ─────────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 25_000;
const IDLE_TIMEOUT_MS = 30 * 60 * 1_000; // 30 minutes
const IDLE_CHECK_INTERVAL_MS = 60_000;    // check once per minute
const CLIENT_VERSION = '1.0.0';
/** Wait for outbound Reticulum hubs (excludes local mesh listen) before first announce. */
const REMOTE_RETICULUM_HUB_MIN_ONLINE = 2;
const REMOTE_RETICULUM_HUB_POLL_MS = 500;
const REMOTE_RETICULUM_HUB_MAX_WAIT_MS = 90_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

type RemoteHubWaitResult = 'ready' | 'cancelled' | 'timeout';

/**
 * Blocks until `onlineRemoteHubInterfaces >= REMOTE_RETICULUM_HUB_MIN_ONLINE` or timeout.
 * Skipped when not in Electron.
 * @returns `cancelled` if `shouldCancel` is true before announcing; `timeout` if hubs never came up.
 */
async function waitForOnlineRemoteReticulumHub(
  shouldCancel: () => boolean
): Promise<RemoteHubWaitResult> {
  const getStatus = window.electronAPI?.reticulumGetStatus;
  if (typeof getStatus !== 'function') {
    return 'ready';
  }
  const deadline = Date.now() + REMOTE_RETICULUM_HUB_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (shouldCancel()) return 'cancelled';
    try {
      const status = await getStatus();
      const n = status.onlineRemoteHubInterfaces ?? 0;
      if (n >= REMOTE_RETICULUM_HUB_MIN_ONLINE) return 'ready';
    } catch {
      // Bridge may be warming up; retry.
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, REMOTE_RETICULUM_HUB_POLL_MS);
    });
  }
  console.warn(
    `[Presence] Timed out waiting for ${REMOTE_RETICULUM_HUB_MIN_ONLINE} remote Reticulum hubs; announcing presence anyway.`
  );
  return 'timeout';
}

async function signPresenceFields(
  fields: Record<string, unknown>
): Promise<string> {
  const result = await (window as any).sendMessage(
    'signPresenceMessage',
    fields,
    10_000
  );
  if (result?.error) throw new Error(result.error);
  return result.signature as string;
}

function buildEnvelope(
  type: PresenceEnvelope['type'],
  payload: PresenceEnvelope['payload'],
  timestamp: number,
  signature: string
): PresenceEnvelope {
  return {
    id: crypto.randomUUID(),
    type,
    senderAddress: payload.address,
    timestamp,
    payload,
    signature,
  };
}

/**
 * Maps a UserStatus (or null) to a presence-badge dot colour.
 * Exported so all components share the same colour scheme.
 * `null` (offline) is handled at the call site (dot hidden or grey).
 */
export function statusDotColor(status: string | null): string {
  if (status === 'away') return '#f59e0b';
  if (status === 'busy') return '#ef4444';
  if (status === 'idle') return '#78909c';
  return '#44b700'; // online or any non-null fallback
}

export function buildPresenceSnapshot(
  sessions: PresenceSession[]
): {
  onlineAddresses: Set<string>;
  statusMap: Map<string, UserStatus>;
} {
  const onlineAddresses = new Set<string>();
  const latestStatusByAddress = new Map<
    string,
    { status: UserStatus; lastSeen: number }
  >();

  for (const session of sessions) {
    onlineAddresses.add(session.address);
    const nextStatus = session.status as UserStatus;
    const previous = latestStatusByAddress.get(session.address);
    if (!previous || session.lastSeen > previous.lastSeen) {
      latestStatusByAddress.set(session.address, {
        status: nextStatus,
        lastSeen: session.lastSeen,
      });
    }
  }

  const statusMap = new Map<string, UserStatus>();
  for (const [address, value] of latestStatusByAddress.entries()) {
    statusMap.set(address, value.status);
  }

  return { onlineAddresses, statusMap };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Manages the full presence lifecycle for the authenticated local user:
 *   • Announces presence after login once at least two remote Reticulum hubs are up
 *     (waits up to 90s, then announces anyway).
 *   • Sends a heartbeat every 25 s to keep the session alive.
 *   • Sends an offline notice when the user logs out, the component unmounts,
 *     or the user explicitly picks "Offline" in the status picker.
 *   • Re-announces when the user switches back from "Offline".
 *   • Automatically switches to `'idle'` status after 30 minutes of no input,
 *     and reverts the moment any input event is detected.
 *   • Subscribes to presence updates from the network and keeps
 *     `onlineAddressesAtom` and `statusMapAtom` in sync.
 *
 * Call this once at the App level.
 */
export function usePresence(): { sendOfflineBeforeLogout: () => Promise<void> } {
  const extState = useAtomValue(extStateAtom);
  const userInfo = useAtomValue(userInfoAtom);
  const setOnlineAddresses = useSetAtom(onlineAddressesAtom);
  const setStatusMap = useSetAtom(statusMapAtom);
  const [myStatus, setMyStatus] = useAtom(myStatusAtom);
  const setIsIdle = useSetAtom(isIdleAtom);

  const sessionIdRef = useRef<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ref-only idle tracking — no state, no re-renders for the timer itself.
  const lastActivityRef = useRef<number>(Date.now());
  const isIdleRef = useRef<boolean>(false);
  // Stable refs so all callbacks always read current values.
  const userInfoRef = useRef(userInfo);
  const myStatusRef = useRef<SelectableStatus>(myStatus);
  const isAuthenticatedRef = useRef(false);
  const isAppearedOfflineRef = useRef(false);

  const isAuthenticated = extState === 'authenticated';

  useEffect(() => { userInfoRef.current = userInfo; }, [userInfo]);
  useEffect(() => { myStatusRef.current = myStatus; }, [myStatus]);
  useEffect(() => { isAuthenticatedRef.current = isAuthenticated; }, [isAuthenticated]);

  // ── Effective status ──────────────────────────────────────────────────────
  //
  // Returns the status that should be put on the wire right now.
  // Priority: offline > idle (automatic) > user's chosen status.

  const getEffectiveStatus = useCallback((): UserStatus | 'offline' => {
    const chosen = myStatusRef.current;
    if (chosen === 'offline') return 'offline';
    if (isIdleRef.current) return 'idle';
    return chosen as UserStatus;
  }, []);

  // ── Stable helpers ────────────────────────────────────────────────────────

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current !== null) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const sendOfflineCallback = useCallback(async () => {
    const ui = userInfoRef.current;
    const sessionId = sessionIdRef.current;
    if (!ui?.address || !ui?.publicKey || !sessionId || !window.presence) return;
    try {
      const timestamp = Date.now();
      const signedFields = {
        address: ui.address,
        publicKey: ui.publicKey,
        sessionId,
        timestamp,
        type: 'PRESENCE_OFFLINE',
      };
      const signature = await signPresenceFields(signedFields);
      const payload: PresenceOfflinePayload = {
        address: ui.address,
        publicKey: ui.publicKey,
        sessionId,
        status: 'offline',
      };
      await window.presence.offline(
        buildEnvelope('PRESENCE_OFFLINE', payload, timestamp, signature)
      );
    } catch {
      // best-effort
    }
  }, []);

  const sendAnnounce = useCallback(async () => {
    const ui = userInfoRef.current;
    const sessionId = sessionIdRef.current;
    const statusVal = getEffectiveStatus();
    if (statusVal === 'offline') return;
    if (!ui?.address || !ui?.publicKey || !sessionId || !window.presence) return;
    const status = statusVal;
    try {
      const timestamp = Date.now();
      const signedFields = {
        address: ui.address,
        clientVersion: CLIENT_VERSION,
        publicKey: ui.publicKey,
        sessionId,
        status,
        timestamp,
        type: 'PRESENCE_ANNOUNCE',
      };
      const signature = await signPresenceFields(signedFields);
      const payload: PresenceAnnouncePayload = {
        address: ui.address,
        clientVersion: CLIENT_VERSION,
        publicKey: ui.publicKey,
        sessionId,
        status,
      };
      await window.presence?.announce(
        buildEnvelope('PRESENCE_ANNOUNCE', payload, timestamp, signature)
      );
    } catch (err) {
      console.error('[Presence] Announce failed:', err);
    }
  }, [getEffectiveStatus]);

  const sendHeartbeat = useCallback(async () => {
    const ui = userInfoRef.current;
    const sessionId = sessionIdRef.current;
    const statusVal = getEffectiveStatus();
    if (statusVal === 'offline') return;
    if (!ui?.address || !ui?.publicKey || !sessionId || !window.presence) return;
    const status = statusVal;
    try {
      const timestamp = Date.now();
      const signedFields = {
        address: ui.address,
        publicKey: ui.publicKey,
        sessionId,
        status,
        timestamp,
        type: 'PRESENCE_HEARTBEAT',
      };
      const signature = await signPresenceFields(signedFields);
      const payload: PresenceHeartbeatPayload = {
        address: ui.address,
        publicKey: ui.publicKey,
        sessionId,
        status,
      };
      await window.presence.heartbeat(
        buildEnvelope('PRESENCE_HEARTBEAT', payload, timestamp, signature)
      );
    } catch (err) {
      console.error('[Presence] Heartbeat failed:', err);
    }
  }, [getEffectiveStatus]);

  // ── Idle detection ────────────────────────────────────────────────────────
  //
  // All work happens in refs — only the atom write (on idle transition) causes
  // a React re-render, keeping this completely free of spurious updates.

  const onActivity = useCallback(() => {
    if (isIdleRef.current) {
      // Returning from idle: update timestamp and wake up.
      lastActivityRef.current = Date.now();
      isIdleRef.current = false;
      setIsIdle(false);
      if (isAuthenticatedRef.current) sendHeartbeat();
    } else {
      // Hot path (fires hundreds of times/s from mousemove): only write the
      // ref every 5 s. Precision needed is ~30 min, so 5 s is more than enough.
      const now = Date.now();
      if (now - lastActivityRef.current > 5_000) {
        lastActivityRef.current = now;
      }
    }
  }, [sendHeartbeat, setIsIdle]);

  // DOM activity listeners — always active so we catch pre-auth activity too.
  useEffect(() => {
    const EVENTS = ['mousemove', 'keydown', 'click', 'touchstart', 'wheel'] as const;
    EVENTS.forEach((e) => document.addEventListener(e, onActivity, { passive: true }));
    return () => {
      EVENTS.forEach((e) => document.removeEventListener(e, onActivity));
    };
  }, [onActivity]);

  // Idle check interval — only runs while authenticated, stops otherwise.
  useEffect(() => {
    if (!isAuthenticated) {
      if (idleCheckRef.current) {
        clearInterval(idleCheckRef.current);
        idleCheckRef.current = null;
      }
      if (isIdleRef.current) {
        isIdleRef.current = false;
        setIsIdle(false);
      }
      return;
    }

    idleCheckRef.current = setInterval(() => {
      if (isIdleRef.current) return;                          // already idle
      if (myStatusRef.current === 'offline') return;          // appearing offline
      if (Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS) {
        isIdleRef.current = true;
        setIsIdle(true);
        sendHeartbeat(); // broadcasts 'idle' to the network
      }
    }, IDLE_CHECK_INTERVAL_MS);

    return () => {
      if (idleCheckRef.current) {
        clearInterval(idleCheckRef.current);
        idleCheckRef.current = null;
      }
    };
  }, [isAuthenticated, sendHeartbeat, setIsIdle]);

  // ── Announce / offline lifecycle ──────────────────────────────────────────

  useEffect(() => {
    if (!isAuthenticated || !userInfo?.address || !userInfo?.publicKey || !window.presence) {
      // On logout, reset the atom to 'online' so the next login starts clean.
      // The status-change effect guards against sending an announce because
      // isAuthenticatedRef.current is already false by the time that effect runs.
      if (!isAuthenticated) {
        setMyStatus('online');
        myStatusRef.current = 'online';
        isAppearedOfflineRef.current = false;
      }
      return;
    }

    sessionIdRef.current = crypto.randomUUID();
    let cancelled = false;

    // Read any persisted 'offline' preference for this address before deciding
    // whether to announce.  All other statuses are ephemeral and default back
    // to 'online' on next login.
    (async () => {
      const stored = window.appStorage
        ? await window.appStorage.get(`presence-status:${userInfo.address}`)
        : null;
      if (cancelled) return;

      if (stored === 'offline') {
        // Set the flag BEFORE updating the atom so the status-change effect
        // (which watches `myStatus`) sees isAppearedOfflineRef=true and skips
        // sending an unnecessary OFFLINE message.
        isAppearedOfflineRef.current = true;
        setMyStatus('offline');
        myStatusRef.current = 'offline';
        return;
      }

      // Non-offline path — proceed with announce + heartbeat.
      if (myStatusRef.current === 'offline') {
        isAppearedOfflineRef.current = true;
        return;
      }

      isAppearedOfflineRef.current = false;
      const hubWait = await waitForOnlineRemoteReticulumHub(() => cancelled);
      if (hubWait === 'cancelled') return;
      if (cancelled) return;
      if (myStatusRef.current === 'offline') return;

      sendAnnounce();
      stopHeartbeat();
      heartbeatRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      stopHeartbeat();
      sendOfflineCallback();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, userInfo?.address, userInfo?.publicKey]);

  // ── React to explicit status changes from the picker ─────────────────────

  useEffect(() => {
    if (!isAuthenticatedRef.current) return;

    if (myStatus === 'offline') {
      if (!isAppearedOfflineRef.current) {
        isAppearedOfflineRef.current = true;
        stopHeartbeat();
        sendOfflineCallback();
      }
    } else if (isAppearedOfflineRef.current) {
      void (async () => {
        const hubWait = await waitForOnlineRemoteReticulumHub(
          () =>
            !isAuthenticatedRef.current || myStatusRef.current === 'offline'
        );
        if (hubWait === 'cancelled') return;
        if (!isAuthenticatedRef.current || myStatusRef.current === 'offline') return;
        isAppearedOfflineRef.current = false;
        sendAnnounce();
        stopHeartbeat();
        heartbeatRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
      })();
    } else {
      const timer = setTimeout(sendHeartbeat, 300);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myStatus]);

  // ── Persist / clear 'offline' status keyed by address ────────────────────
  //
  // Only 'offline' is persisted — all other statuses are ephemeral and restore
  // to 'online' on next login.  Written/deleted whenever the authenticated
  // user changes their status.

  useEffect(() => {
    if (!isAuthenticated || !userInfo?.address) return;
    const key = `presence-status:${userInfo.address}`;
    if (myStatus === 'offline') {
      window.appStorage?.set(key, 'offline');
    } else {
      window.appStorage?.delete(key);
    }
  }, [myStatus, isAuthenticated, userInfo?.address]);

  // ── Subscribe to network presence updates ────────────────────────────────

  useEffect(() => {
    if (!window.presence) return;

    window.presence.getAllOnline().then((sessions) => {
      const snapshot = buildPresenceSnapshot(sessions);
      setOnlineAddresses(snapshot.onlineAddresses);
      setStatusMap(snapshot.statusMap);
    });

    const applyPresenceUpdates = (
      updates: Array<{ address: string; online: boolean; status: UserStatus | null }>
    ) => {
      if (updates.length === 0) return;
      unstable_batchedUpdates(() => {
        setOnlineAddresses((prev) => {
          const next = new Set(prev);
          for (const { address, online } of updates) {
            if (online) next.add(address);
            else next.delete(address);
          }
          return next;
        });
        setStatusMap((prev) => {
          const next = new Map(prev);
          for (const { address, online, status } of updates) {
            if (online && status) next.set(address, status);
            else next.delete(address);
          }
          return next;
        });
      });
    };

    const unsubscribe = window.presence.onUpdateBatch
      ? window.presence.onUpdateBatch(applyPresenceUpdates)
      : window.presence.onUpdate((payload) => {
          applyPresenceUpdates([payload]);
        });

    const unsubscribeCleared = window.presence.onCleared?.(() => {
      unstable_batchedUpdates(() => {
        setOnlineAddresses(new Set());
        setStatusMap(new Map());
      });
    });

    return () => {
      unsubscribe();
      unsubscribeCleared?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { sendOfflineBeforeLogout: sendOfflineCallback };
}

// ── Component-level helpers ───────────────────────────────────────────────────

export function useIsOnline(address: string | null | undefined): boolean {
  const atom = isOnlineAtomFamily(address ?? '');
  const isOnline = useAtomValue(atom);
  if (!address) return false;
  return isOnline;
}

export function useStatus(address: string | null | undefined): UserStatus | null {
  const atom = statusAtomFamily(address ?? '');
  const status = useAtomValue(atom);
  if (!address) return null;
  return status;
}

export function useOnlineAddresses(): Set<string> {
  return useAtomValue(onlineAddressesAtom);
}

export function useMyStatus(): [SelectableStatus, (s: SelectableStatus) => void] {
  return useAtom(myStatusAtom);
}
