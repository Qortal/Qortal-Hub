import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { reticulumEnabledAtom } from '../../atoms/global';
import { joinNodeEndpoint } from '../../utils/nodeEndpointPath';
import type { ConnectedPeer } from './nodeOverview';
import { settingBoolean, settingNumber } from './nodeOverview';

/** How long one read may take before it counts as failed. */
export const READ_TIMEOUT_MS = 15_000;

/**
 * One answer from the node, kept apart from "no answer yet" and "the read
 * failed": a failed read never turns into an empty answer. After a failure
 * the last good answer stays, marked by `status: 'error'`.
 */
export type NodeRead<T> = {
  status: 'loading' | 'ok' | 'error';
  value: T | null;
  /** When the value was read, this PC's clock. */
  at: number | null;
  retry: () => void;
};

const LOADING = { at: null, status: 'loading', value: null } as const;

/**
 * Reads `path` from the node now and every `intervalMs` (once when 0), while
 * the component is mounted. A new `nodeBase` starts over, and answers from
 * the node before it are dropped.
 */
export const useNodeRead = <T>(
  nodeBase: string,
  load: ((base: string, signal: AbortSignal) => Promise<T>) | null,
  intervalMs: number,
  /** Read again when this changes, keeping the last answer meanwhile. */
  again?: unknown
): NodeRead<T> => {
  const [state, setState] = useState<Omit<NodeRead<T>, 'retry'>>(LOADING);
  const loadRef = useRef(load);
  loadRef.current = load;
  const [attempt, setAttempt] = useState(0);
  const baseRef = useRef(nodeBase);
  const enabled = load !== null;

  useEffect(() => {
    if (baseRef.current !== nodeBase) {
      baseRef.current = nodeBase;
      setState(LOADING);
    }
    if (!enabled) return;
    let alive = true;
    let inFlight = false;
    let controller: AbortController | null = null;

    const run = async () => {
      const read = loadRef.current;
      if (inFlight || !read) return;
      inFlight = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), READ_TIMEOUT_MS);
      try {
        const value = await read(nodeBase, controller.signal);
        if (alive) setState({ at: Date.now(), status: 'ok', value });
      } catch {
        if (alive)
          setState((previous) => ({
            at: previous.at,
            status: 'error',
            value: previous.value,
          }));
      } finally {
        clearTimeout(timeout);
        inFlight = false;
      }
    };

    void run();
    const timer = intervalMs > 0 ? setInterval(run, intervalMs) : null;
    return () => {
      alive = false;
      controller?.abort();
      if (timer) clearInterval(timer);
    };
  }, [attempt, again, enabled, intervalMs, nodeBase]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { ...state, retry };
};

const isCoreError = (data: unknown) =>
  !!data &&
  typeof data === 'object' &&
  !Array.isArray(data) &&
  typeof (data as { error?: unknown }).error === 'number';

/** A JSON answer from the node; a failed request or Core error throws. */
export const getNodeJson = async <T>(
  base: string,
  path: string,
  signal: AbortSignal
): Promise<T> => {
  const response = await fetch(joinNodeEndpoint(base, path), { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (isCoreError(data)) throw new Error('Core error');
  return data as T;
};

/** A text answer from the node; a failed request throws. */
export const getNodeText = async (
  base: string,
  path: string,
  signal: AbortSignal
): Promise<string> => {
  const response = await fetch(joinNodeEndpoint(base, path), { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
};

export type AdminInfo = {
  buildTimestamp?: number;
  buildVersion?: string;
  currentTimestamp?: number;
  isTestNet?: boolean;
  nodeId?: string;
  type?: string;
  uptime?: number;
};

export type LastBlock = {
  height?: number;
  minterAddress?: string;
  minterLevel?: number;
  signature?: string;
  timestamp?: number;
  totalFees?: string;
  transactionCount?: number;
};

export type BlockSummary = {
  height?: number;
  signature?: string;
  timestamp?: number;
  transactionCount?: number;
};

export type SystemInfo = {
  availableProcessors?: number;
  maxMemory?: number;
  memoryInUse?: number;
};

export type ActivitySummary = {
  blockCount?: number;
  namesRegistered?: number;
  totalTransactionCount?: number;
  transactionCountByType?: Record<string, number>;
};

/** The few settings the Overview explains. Null: the node didn't say. */
export type NodeSettingsSubset = {
  apiWhitelistEnabled: boolean | null;
  autoUpdateEnabled: boolean | null;
  /** Null also when the node uses its default port. */
  listenPort: number | null;
  maxDataPeers: number | null;
  relayModeEnabled: boolean | null;
  uPnPEnabled: boolean | null;
};

const readSettings = async (
  base: string,
  signal: AbortSignal
): Promise<NodeSettingsSubset> => {
  const one = (name: string) =>
    getNodeText(base, `/admin/settings/${name}`, signal);
  const [whitelist, autoUpdate, listenPort, maxDataPeers, relay, uPnP] =
    await Promise.allSettled([
      one('apiWhitelistEnabled'),
      one('autoUpdateEnabled'),
      one('listenPort'),
      one('maxDataPeers'),
      one('relayModeEnabled'),
      one('uPnPEnabled'),
    ]);
  const text = (result: PromiseSettledResult<string>) =>
    result.status === 'fulfilled' ? result.value : null;
  const settings = {
    apiWhitelistEnabled: settingBoolean(text(whitelist)),
    autoUpdateEnabled: settingBoolean(text(autoUpdate)),
    listenPort: settingNumber(text(listenPort)),
    maxDataPeers: settingNumber(text(maxDataPeers)),
    relayModeEnabled: settingBoolean(text(relay)),
    uPnPEnabled: settingBoolean(text(uPnP)),
  };
  if (Object.values(settings).every((value) => value === null))
    throw new Error('No settings read');
  return settings;
};

export const OVERVIEW_INTERVALS = {
  activity: 5 * 60_000,
  onlineMinters: 60_000,
  dataPeers: 30_000,
  info: 30_000,
  lastBlock: 10_000,
  mintingKeys: 30_000,
  peers: 15_000,
  system: 30_000,
} as const;

/** Blocks in a day, at Qortal's one-minute target. */
export const BLOCKS_A_DAY = 1440;
/** How many of the newest blocks the Overview lists. */
export const RECENT_BLOCKS = 10;

/** Everything the Overview shows, read from the node in use. */
export const useNodeOverviewData = (nodeBase: string, isPublic: boolean) => {
  const info = useNodeRead<AdminInfo>(
    nodeBase,
    (base, signal) => getNodeJson(base, '/admin/info', signal),
    OVERVIEW_INTERVALS.info
  );
  const lastBlock = useNodeRead<LastBlock>(
    nodeBase,
    (base, signal) => getNodeJson(base, '/blocks/last', signal),
    OVERVIEW_INTERVALS.lastBlock
  );
  const peers = useNodeRead<ConnectedPeer[]>(
    nodeBase,
    async (base, signal) => {
      const list = await getNodeJson<unknown>(base, '/peers', signal);
      if (!Array.isArray(list)) throw new Error('Not a list');
      return list as ConnectedPeer[];
    },
    OVERVIEW_INTERVALS.peers
  );
  const dataPeers = useNodeRead<ConnectedPeer[]>(
    nodeBase,
    async (base, signal) => {
      const list = await getNodeJson<unknown>(base, '/peers/data', signal);
      if (!Array.isArray(list)) throw new Error('Not a list');
      return list as ConnectedPeer[];
    },
    OVERVIEW_INTERVALS.dataPeers
  );
  // Core 6.1.9 leaves the online accounts count in block answers at 0: the
  // minters online now come from their own list.
  const onlineMinters = useNodeRead<number>(
    nodeBase,
    async (base, signal) => {
      const levels = await getNodeJson<unknown>(
        base,
        '/addresses/online/levels',
        signal
      );
      if (!Array.isArray(levels)) throw new Error('Not a list');
      return levels.reduce(
        (sum, entry) =>
          sum +
          (typeof entry?.count === 'number' && entry.count > 0
            ? entry.count
            : 0),
        0
      );
    },
    OVERVIEW_INTERVALS.onlineMinters
  );
  const activity = useNodeRead<ActivitySummary>(
    nodeBase,
    (base, signal) => getNodeJson(base, '/admin/summary', signal),
    OVERVIEW_INTERVALS.activity
  );
  // The public node's memory, keys and settings aren't the user's.
  const system = useNodeRead<SystemInfo>(
    nodeBase,
    isPublic
      ? null
      : (base, signal) => getNodeJson(base, '/admin/systeminfo', signal),
    OVERVIEW_INTERVALS.system
  );
  const mintingKeys = useNodeRead<number>(
    nodeBase,
    isPublic
      ? null
      : async (base, signal) => {
          const list = await getNodeJson<unknown>(
            base,
            '/admin/mintingaccounts',
            signal
          );
          if (!Array.isArray(list)) throw new Error('Not a list');
          return list.length;
        },
    OVERVIEW_INTERVALS.mintingKeys
  );
  const settings = useNodeRead<NodeSettingsSubset>(
    nodeBase,
    isPublic ? null : readSettings,
    0
  );

  const height = lastBlock.value?.height;
  const hasHeight = typeof height === 'number' && height > 0;
  // The newest blocks and the one a day back, read again with each new block.
  const recentBlocks = useNodeRead<BlockSummary[]>(
    nodeBase,
    hasHeight
      ? async (base, signal) => {
          const start = Math.max(1, height - RECENT_BLOCKS + 1);
          const list = await getNodeJson<unknown>(
            base,
            `/blocks/summaries?start=${start}&end=${height + 1}`,
            signal
          );
          if (!Array.isArray(list)) throw new Error('Not a list');
          return [...(list as BlockSummary[])].sort(
            (a, b) => (b.height ?? 0) - (a.height ?? 0)
          );
        }
      : null,
    0,
    height
  );
  // The day-old block only moves the average a little: read it again every
  // 60 blocks, not with every block.
  const dayBack = hasHeight ? Math.max(1, height - BLOCKS_A_DAY) : null;
  const dayBackStep = dayBack === null ? null : Math.floor(dayBack / 60);
  const dayOldBlock = useNodeRead<BlockSummary>(
    nodeBase,
    dayBack !== null
      ? (base, signal) =>
          getNodeJson(base, `/blocks/byheight/${dayBack}`, signal)
      : null,
    0,
    dayBackStep
  );

  const minterAddress = lastBlock.value?.minterAddress;
  const minterName = usePrimaryName(nodeBase, minterAddress);

  return {
    activity,
    dataPeers,
    dayOldBlock,
    info,
    lastBlock,
    minterName,
    mintingKeys,
    onlineMinters,
    peers,
    recentBlocks,
    settings,
    system,
  };
};

const ADDRESS_PATTERN = /^Q[1-9A-HJ-NP-Za-km-z]{33}$/;

/** The primary name of `address`, remembered while the window is open. */
const usePrimaryName = (nodeBase: string, address: string | undefined) => {
  const names = useRef(new Map<string, string | null>());
  const [, setVersion] = useState(0);
  const valid = typeof address === 'string' && ADDRESS_PATTERN.test(address);
  const key = valid ? `${nodeBase} ${address}` : null;

  useEffect(() => {
    if (!key || names.current.has(key)) return;
    let alive = true;
    const controller = new AbortController();
    getNodeJson<{ name?: string }>(
      nodeBase,
      `/names/primary/${encodeURIComponent(address)}`,
      controller.signal
    )
      .then((answer) => {
        if (!alive) return;
        names.current.set(
          key,
          typeof answer?.name === 'string' && answer.name ? answer.name : null
        );
        setVersion((count) => count + 1);
      })
      // A failed look-up isn't remembered: the next block tries again.
      .catch(() => undefined);
    return () => {
      alive = false;
      controller.abort();
    };
  }, [address, key, nodeBase]);

  return key ? (names.current.get(key) ?? null) : null;
};

/** Reticulum's status, as main reports it; the fields the Overview shows. */
export type ReticulumOverview = {
  bridgeState?: 'stopped' | 'starting' | 'ready' | 'degraded';
  configuredHubInterfaces?: number;
  configuredRemoteHubInterfaces?: number;
  hubSummary?: string;
  mode?: 'frozen' | 'venv' | 'system' | null;
  onlineHubInterfaces?: number;
  onlineRemoteHubInterfaces?: number;
  overlayLinksConnected?: number;
  p2pActiveOverlayPeers?: number;
  p2pInboundOverlayPeers?: number;
  p2pOutboundOverlayPeers?: number;
  p2pReceivingOverlayPeers?: number;
  p2pReceivingOverlayPeersStableMs?: number;
  reachability?: 'unknown' | 'lan-only' | 'hub-connected' | 'disconnected';
  running?: boolean;
  transportEnabled?: boolean;
  verifiedOverlayPeerCount?: number;
};

/**
 * Reticulum's status while the window is open: `off` when it's turned off
 * in Hub, `unavailable` outside the desktop app.
 */
export const useReticulumOverview = (): {
  state: 'off' | 'unavailable' | 'loading' | 'ok';
  /** Set only while `state` is `ok`. */
  status: ReticulumOverview | null;
} => {
  const enabled = useAtomValue(reticulumEnabledAtom);
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  const available = typeof api?.reticulumGetStatus === 'function';
  const [status, setStatus] = useState<ReticulumOverview | null>(null);

  useEffect(() => {
    setStatus(null);
    if (!enabled || !available) return;
    let alive = true;
    void api
      .reticulumGetStatus()
      .then((next) => {
        if (alive && next) setStatus(next);
      })
      .catch(() => undefined);
    const unsubscribe =
      typeof api.onReticulumStatus === 'function'
        ? api.onReticulumStatus((next) => {
            if (alive && next) setStatus(next);
          })
        : undefined;
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [api, available, enabled]);

  if (!enabled) return { state: 'off', status: null };
  if (!available) return { state: 'unavailable', status: null };
  return status ? { state: 'ok', status } : { state: 'loading', status: null };
};
