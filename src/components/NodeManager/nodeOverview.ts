/**
 * What the node's answers mean, for the Node Manager's Overview. Pure
 * functions only: the window reads the node, these turn the answers into
 * the numbers and checks it shows.
 */
import Base58Untyped from '../../encryption/Base58';

// Base58.ts has no types of its own.
const Base58 = Base58Untyped as unknown as {
  decode: (text: string) => Uint8Array;
};

/** One peer from Core's `/peers` or `/peers/data`, as far as it's used here. */
export type ConnectedPeer = {
  direction?: string;
  handshakeStatus?: string;
  isTooDivergent?: boolean;
  lastBlockSignature?: string;
  lastHeight?: number;
  lastPing?: number;
  version?: string;
};

export type CoreVersion = [number, number, number];

/** `qortal-6.1.9-9d93738`, `v6.1.9` or `6.1.9` → [6, 1, 9]; else null. */
export const parseCoreVersion = (value: unknown): CoreVersion | null => {
  if (typeof value !== 'string') return null;
  const match =
    /^(?:qortal-)?v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?:[-+.].*)?$/.exec(
      value.trim()
    );
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

export const compareCoreVersions = (a: CoreVersion, b: CoreVersion) =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export const formatCoreVersion = (version: CoreVersion) => version.join('.');

const isCompleted = (peer: ConnectedPeer) =>
  peer?.handshakeStatus === 'COMPLETED';

/**
 * A block signature as `/blocks/*` gives it (base58), written the way
 * `/peers` gives its peers' last blocks (base64). Null when it can't be read.
 */
export const signatureAsBase64 = (base58: unknown): string | null => {
  if (typeof base58 !== 'string' || !base58) return null;
  try {
    const bytes: Uint8Array = Base58.decode(base58);
    if (!bytes?.length) return null;
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  } catch {
    return null;
  }
};

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

export type PeerSummary = {
  total: number;
  inbound: number;
  outbound: number;
  /** Connected, but not done shaking hands yet. */
  connecting: number;
  /** Core versions the peers run, most peers first, then the newest. */
  versions: { version: string; count: number }[];
  /** Peers on a newer Core than this node's, and the newest seen. */
  newer: { count: number; highest: string } | null;
  ahead: number;
  same: number;
  behind: number;
  highestHeight: number | null;
  medianPingMs: number | null;
  tooDivergent: number;
  /**
   * Of the peers at this node's height, how many have the same last block
   * (`lastBlockSignature` in `/peers`' base64). Peers at other heights can't
   * be compared from these answers.
   */
  sameHeight: { total: number; agreeing: number } | null;
};

export const summarizePeers = (
  peers: unknown,
  ours: {
    height?: number | null;
    lastBlockSignature?: string | null;
    version?: string | null;
  } = {}
): PeerSummary => {
  const list: ConnectedPeer[] = Array.isArray(peers)
    ? peers.filter((peer) => peer && typeof peer === 'object')
    : [];
  const completed = list.filter(isCompleted);
  const ourHeight = isNumber(ours.height) ? ours.height : null;
  const ourVersion = parseCoreVersion(ours.version);

  const versionCounts = new Map<
    string,
    { count: number; parsed: CoreVersion }
  >();
  let newerCount = 0;
  let highest: CoreVersion | null = null;
  for (const peer of completed) {
    const parsed = parseCoreVersion(peer.version);
    if (!parsed) continue;
    const key = formatCoreVersion(parsed);
    const entry = versionCounts.get(key) ?? { count: 0, parsed };
    entry.count += 1;
    versionCounts.set(key, entry);
    if (ourVersion && compareCoreVersions(parsed, ourVersion) > 0) {
      newerCount += 1;
      if (!highest || compareCoreVersions(parsed, highest) > 0) {
        highest = parsed;
      }
    }
  }
  const versions = [...versionCounts.entries()]
    .sort(
      ([, a], [, b]) =>
        b.count - a.count || compareCoreVersions(b.parsed, a.parsed)
    )
    .map(([version, { count }]) => ({ version, count }));

  let ahead = 0;
  let same = 0;
  let behind = 0;
  let highestHeight: number | null = null;
  let sameHeightTotal = 0;
  let sameHeightAgreeing = 0;
  for (const peer of completed) {
    if (!isNumber(peer.lastHeight)) continue;
    highestHeight =
      highestHeight === null
        ? peer.lastHeight
        : Math.max(highestHeight, peer.lastHeight);
    if (ourHeight === null) continue;
    if (peer.lastHeight > ourHeight) ahead += 1;
    else if (peer.lastHeight < ourHeight) behind += 1;
    else {
      same += 1;
      if (ours.lastBlockSignature && peer.lastBlockSignature) {
        sameHeightTotal += 1;
        if (peer.lastBlockSignature === ours.lastBlockSignature) {
          sameHeightAgreeing += 1;
        }
      }
    }
  }

  // Like Core's own count, a peer is connected once done shaking hands.
  return {
    total: list.length,
    inbound: completed.filter((peer) => peer.direction === 'INBOUND').length,
    outbound: completed.filter((peer) => peer.direction === 'OUTBOUND').length,
    connecting: list.length - completed.length,
    versions,
    newer:
      ourVersion && highest
        ? { count: newerCount, highest: formatCoreVersion(highest) }
        : ourVersion
          ? { count: 0, highest: formatCoreVersion(ourVersion) }
          : null,
    ahead,
    same,
    behind,
    highestHeight,
    medianPingMs: median(
      completed.map((peer) => peer.lastPing).filter(isNumber)
    ),
    tooDivergent: completed.filter((peer) => peer.isTooDivergent === true)
      .length,
    sameHeight:
      sameHeightTotal > 0
        ? { total: sameHeightTotal, agreeing: sameHeightAgreeing }
        : null,
  };
};

export type HeightSample = { at: number; height: number };

/** The samples of the last `keepMs`, newest last, with one more added. */
export const addHeightSample = (
  samples: HeightSample[],
  sample: HeightSample,
  keepMs = 10 * 60 * 1000
): HeightSample[] => {
  if (!isNumber(sample.height) || !isNumber(sample.at)) return samples;
  const last = samples[samples.length - 1];
  // The same height again tells nothing new; a lower one means a re-sync.
  if (last && last.height === sample.height) return samples;
  const kept =
    last && sample.height < last.height
      ? []
      : samples.filter((older) => sample.at - older.at <= keepMs);
  return [...kept, sample];
};

/**
 * How fast the node is catching up, from its recent heights, and how long it
 * has left to reach `target`. Null until there's enough to tell.
 */
export const syncEstimate = (
  samples: HeightSample[],
  target: number | null
): { blocksPerMinute: number; minutesLeft: number | null } | null => {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const minutes = (last.at - first.at) / 60_000;
  const blocks = last.height - first.height;
  if (minutes < 1 / 3 || blocks <= 0) return null;
  const blocksPerMinute = blocks / minutes;
  const left = isNumber(target) ? target - last.height : null;
  return {
    blocksPerMinute,
    minutesLeft: left !== null && left > 0 ? left / blocksPerMinute : null,
  };
};

/** Seconds per block between two blocks; null when it can't be told. */
export const averageBlockSeconds = (
  newer: { height?: number; timestamp?: number } | null | undefined,
  older: { height?: number; timestamp?: number } | null | undefined
): number | null => {
  if (
    !newer ||
    !older ||
    !isNumber(newer.height) ||
    !isNumber(older.height) ||
    !isNumber(newer.timestamp) ||
    !isNumber(older.timestamp)
  )
    return null;
  const blocks = newer.height - older.height;
  const ms = newer.timestamp - older.timestamp;
  if (blocks <= 0 || ms <= 0) return null;
  return ms / blocks / 1000;
};

export type MintingSummary =
  | 'public'
  | 'minting'
  | 'syncing'
  | 'no_key'
  | 'key_not_minting'
  | 'unknown';

/** Whether this node mints, or the main reason it doesn't. */
export const mintingSummary = ({
  isPublic,
  isMintingPossible,
  isSynchronizing,
  syncPercent,
  keyCount,
}: {
  isPublic: boolean;
  isMintingPossible?: boolean;
  isSynchronizing?: boolean;
  syncPercent?: number;
  /** Null when the node's key list couldn't be read. */
  keyCount: number | null;
}): MintingSummary => {
  if (isPublic) return 'public';
  if (isMintingPossible) return 'minting';
  if (isSynchronizing && !(isNumber(syncPercent) && syncPercent >= 100))
    return 'syncing';
  if (keyCount === null) return 'unknown';
  return keyCount > 0 ? 'key_not_minting' : 'no_key';
};

export type HelpCheckId =
  | 'uptime'
  | 'reachable'
  | 'relay'
  | 'data_peers'
  | 'up_to_date'
  | 'minting';

export type HelpCheck = {
  id: HelpCheckId;
  state: 'ok' | 'todo' | 'unknown';
};

/** A node counts as running all day after a day of uptime. */
export const DAY_MS = 24 * 60 * 60 * 1000;
/** Before an hour of uptime, no inbound peer yet says little. */
export const REACHABLE_AFTER_MS = 60 * 60 * 1000;

/** What a node can do for the network, and whether this one does it. */
export const helpTheNetworkChecks = ({
  uptimeMs,
  inbound,
  relayMode,
  dataPeers,
  newerPeers,
  isMintingPossible,
}: {
  uptimeMs: number | null;
  inbound: number | null;
  relayMode: boolean | null;
  dataPeers: number | null;
  /** Peers on a newer Core; null when it couldn't be told. */
  newerPeers: number | null;
  isMintingPossible: boolean | null;
}): HelpCheck[] => {
  const known = <T>(value: T | null, ok: (value: T) => boolean) =>
    value === null ? 'unknown' : ok(value) ? 'ok' : 'todo';
  const reachable: HelpCheck['state'] =
    inbound === null
      ? 'unknown'
      : inbound > 0
        ? 'ok'
        : uptimeMs !== null && uptimeMs >= REACHABLE_AFTER_MS
          ? 'todo'
          : 'unknown';
  return [
    { id: 'uptime', state: known(uptimeMs, (ms) => ms >= DAY_MS) },
    { id: 'reachable', state: reachable },
    { id: 'relay', state: known(relayMode, (on) => on) },
    { id: 'data_peers', state: known(dataPeers, (count) => count > 0) },
    { id: 'up_to_date', state: known(newerPeers, (count) => count === 0) },
    { id: 'minting', state: known(isMintingPossible, (on) => on) },
  ];
};

/** Core's own P2P port when its settings don't name one. */
export const defaultListenPort = (isTestNet: boolean | undefined) =>
  isTestNet ? 62392 : 12392;

/** Reads `true`/`false` from a single-setting answer; else null. */
export const settingBoolean = (value: unknown): boolean | null => {
  const text = typeof value === 'string' ? value.trim() : value;
  if (text === true || text === 'true') return true;
  if (text === false || text === 'false') return false;
  return null;
};

/** Reads a whole number from a single-setting answer; else null. */
export const settingNumber = (value: unknown): number | null => {
  const text = typeof value === 'number' ? String(value) : value;
  // An empty answer isn't 0.
  if (typeof text !== 'string' || !/^\d+$/.test(text.trim())) return null;
  return Number(text.trim());
};

const safeLanguage = (language: string) => {
  try {
    Intl.getCanonicalLocales(language);
    return language;
  } catch {
    return 'en';
  }
};

const unitNumber = (value: number, unit: string, language: string) =>
  new Intl.NumberFormat(safeLanguage(language), {
    maximumFractionDigits: 0,
    style: 'unit',
    unit,
    unitDisplay: 'narrow',
  }).format(value);

/** "3d 4h", "12 min", "40s": the two largest units of a duration. */
export const formatDuration = (ms: number, language: string): string => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days) parts.push(unitNumber(days, 'day', language));
  if (hours && parts.length < 2)
    parts.push(unitNumber(hours, 'hour', language));
  if (!days && minutes && parts.length < 2)
    parts.push(unitNumber(minutes, 'minute', language));
  if (!parts.length) parts.push(unitNumber(seconds % 60, 'second', language));
  // Intl.ListFormat joins units the language's way; it isn't in every
  // runtime, nor in this project's TypeScript lib yet.
  const ListFormat = (
    Intl as unknown as {
      ListFormat?: new (
        language: string,
        options: { style: string; type: string }
      ) => { format: (parts: string[]) => string };
    }
  ).ListFormat;
  try {
    if (ListFormat) {
      return new ListFormat(safeLanguage(language), {
        style: 'narrow',
        type: 'unit',
      }).format(parts);
    }
  } catch {
    // Falls back to a plain join below.
  }
  return parts.join(' ');
};

/** "34 seconds ago", "5 minutes ago": how long ago `timestamp` was. */
export const formatAgo = (
  timestamp: number,
  language: string,
  now = Date.now()
): string => {
  // The node's clock and this PC's may differ a little.
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  const format = new Intl.RelativeTimeFormat(safeLanguage(language), {
    numeric: 'auto',
  });
  if (seconds < 60) return format.format(-seconds, 'second');
  if (seconds < 3600) return format.format(-Math.round(seconds / 60), 'minute');
  if (seconds < 86_400)
    return format.format(-Math.round(seconds / 3600), 'hour');
  return format.format(-Math.round(seconds / 86_400), 'day');
};

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'];

/** "3.5 GB": a size in the largest unit that keeps it at 1 or more. */
export const formatBytes = (bytes: number, language: string): string => {
  let value = Math.max(0, bytes);
  let unit = 0;
  // The units' own sizes: a kilobyte is 1,000 bytes.
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return new Intl.NumberFormat(safeLanguage(language), {
    maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0,
    style: 'unit',
    unit: BYTE_UNITS[unit],
    unitDisplay: 'short',
  }).format(value);
};

export const formatCount = (value: number, language: string) =>
  new Intl.NumberFormat(safeLanguage(language)).format(value);
