/**
 * Every read the Explorer makes, each as a spec: the key it is kept under
 * in the window's cache (cache.ts), how long, and how it reads. All GET,
 * all public. A failed read throws; "Core has nothing" is an answer of its
 * own (null, an empty list, 'unused'), never a failure turned into one.
 */
import Base58Module from '../../encryption/Base58';
import {
  CoreHttpError,
  getJson,
  getText,
  isCoreError,
  queryString,
  seg,
} from './core';

export interface ReadSpec<T> {
  key: string;
  ttlMs: number;
  load: () => Promise<T>;
}

const MINUTE = 60_000;

/** MINTER, the group whose members mint. */
export const MINTER_GROUP_ID = 694;
/** The dev group, whose admins are the Dev Admins. */
export const DEV_GROUP_ID = 1;
/** Core's null account: the owner of MINTER and the dev group, no one's account. */
export const NULL_ACCOUNT = 'QdSnUy6sUiEnaN87dWmE92g1uQjrvPgrWG';

const num = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

// ---- One account ----------------------------------------------------------------

export interface AccountInfo {
  address: string;
  /** The transaction this account last referenced; for one that never sent anything, its first incoming one. */
  reference: string | null;
  /** Known once the account has sent a transaction. */
  publicKey: string | null;
  level: number;
  blocksMinted: number;
  blocksMintedAdjustment: number;
  blocksMintedPenalty: number;
}

export type ExploredAccount =
  | { kind: 'account'; account: AccountInfo }
  /** A valid address the node has never seen: no transaction ever involved it. */
  | { kind: 'unused'; address: string }
  /** Written like an address, but the node rejects it (its checksum). */
  | { kind: 'invalid'; address: string };

export const accountRead = (address: string): ReadSpec<ExploredAccount> => ({
  key: `account:${address}`,
  ttlMs: 2 * MINUTE,
  load: async () => {
    try {
      const body = await getJson<Record<string, unknown>>(
        `/addresses/${seg(address)}`
      );
      return {
        kind: 'account',
        account: {
          address: str(body?.address) ?? address,
          reference: str(body?.reference),
          publicKey: str(body?.publicKey),
          level: num(body?.level),
          blocksMinted: num(body?.blocksMinted),
          blocksMintedAdjustment: num(body?.blocksMintedAdjustment),
          blocksMintedPenalty: num(body?.blocksMintedPenalty),
        },
      };
    } catch (error) {
      if (isCoreError(error, 404, 124)) return { kind: 'unused', address };
      if (isCoreError(error, 400, 102)) return { kind: 'invalid', address };
      throw error;
    }
  },
});

export const balanceRead = (address: string): ReadSpec<number> => ({
  key: `balance:${address}`,
  ttlMs: MINUTE,
  load: async () => {
    const value = await getJson<unknown>(`/addresses/balance/${seg(address)}`);
    const balance = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(balance)) throw new CoreHttpError(200, String(value));
    return balance;
  },
});

// ---- Names --------------------------------------------------------------------------

/** Its primary name, or null when it has none. */
export const primaryNameRead = (address: string): ReadSpec<string | null> => ({
  key: `primary:${address}`,
  ttlMs: 10 * MINUTE,
  // Core answers `{ owner }` without a name when there is none.
  load: async () => {
    const body = await getJson<{ name?: unknown }>(
      `/names/primary/${seg(address)}`
    );
    return str(body?.name);
  },
});

export interface NamesOf {
  /** Every name it owns, in the node's order. */
  names: string[];
  /** True when the reading stopped at NAME_PAGES pages and the node had more. */
  truncated: boolean;
}

const NAME_PAGE = 100;
const NAME_PAGES = 5;

export const namesOfRead = (address: string): ReadSpec<NamesOf> => ({
  key: `names:${address}`,
  ttlMs: 10 * MINUTE,
  load: async () => {
    const names: string[] = [];
    for (let page = 0; page < NAME_PAGES; page++) {
      const rows = await getJson<Array<{ name?: unknown }>>(
        `/names/address/${seg(address)}?${queryString({
          limit: NAME_PAGE,
          offset: page * NAME_PAGE,
        })}`
      );
      const chunk = (Array.isArray(rows) ? rows : [])
        .map((row) => str(row?.name))
        .filter((name): name is string => name !== null);
      names.push(...chunk);
      if (chunk.length < NAME_PAGE) return { names, truncated: false };
    }
    // Every page was full: one more row says whether it owns more than these.
    const more = await getJson<unknown>(
      `/names/address/${seg(address)}?${queryString({
        limit: 1,
        offset: NAME_PAGES * NAME_PAGE,
      })}`
    );
    return { names, truncated: Array.isArray(more) && more.length > 0 };
  },
});

/** Core's "name unknown". */
const NAME_UNKNOWN = 401;
/** Names that are also routes of Core's `/names/…`, so `/names/<name>` doesn't reach them. */
const ROUTE_NAMES = new Set(['search', 'forsale']);

export interface NameData {
  /** The name as registered: the node matches names ignoring case and look-alike letters. */
  name: string;
  owner: string;
}

/** A name's owner, or null when no one has it. */
export const nameDataRead = (name: string): ReadSpec<NameData | null> => ({
  key: `name:${name}`,
  ttlMs: 10 * MINUTE,
  load: async () => {
    // Not a name anyone can have, and not a path to ask the node about.
    if (name === '.' || name === '..') return null;
    if (ROUTE_NAMES.has(name)) {
      // `/names/search` and `/names/forsale` are lists of their own: find it by searching.
      const rows = await getJson<unknown>(
        `/names/search?${queryString({ query: name, prefix: true, limit: 100 })}`
      );
      const found = (Array.isArray(rows) ? rows : []).find(
        (row) =>
          typeof row?.name === 'string' &&
          row.name.toLowerCase() === name.toLowerCase()
      );
      const owner = str(found?.owner);
      return found && owner ? { name: found.name, owner } : null;
    }
    try {
      const body = await getJson<{ name?: unknown; owner?: unknown }>(
        `/names/${seg(name)}`
      );
      const registered = str(body?.name);
      const owner = str(body?.owner);
      if (!registered || !owner)
        throw new CoreHttpError(200, JSON.stringify(body));
      return { name: registered, owner };
    } catch (error) {
      if (isCoreError(error, 404, NAME_UNKNOWN)) return null;
      throw error;
    }
  },
});

/** Names that start with `text` (the node's name search), for a name no one has. */
export const namesStartingRead = (text: string): ReadSpec<string[]> => ({
  key: `startingwith:${text}`,
  ttlMs: 10 * MINUTE,
  load: async () => {
    const rows = await getJson<unknown>(
      `/names/search?${queryString({ query: text, prefix: true, limit: 8 })}`
    );
    return (Array.isArray(rows) ? rows : [])
      .map((row) => str((row as { name?: unknown })?.name))
      .filter((found): found is string => found !== null);
  },
});

// ---- Groups -------------------------------------------------------------------------

export interface GroupOf {
  groupId: number;
  groupName: string;
  owner: string | null;
  isOpen: boolean | null;
  memberCount: number | null;
  isAdmin: boolean;
  created: number | null;
  description: string | null;
}

export const groupsOfRead = (address: string): ReadSpec<GroupOf[]> => ({
  key: `groups:${address}`,
  ttlMs: 5 * MINUTE,
  load: async () => {
    const rows = await getJson<unknown>(`/groups/member/${seg(address)}`);
    return (Array.isArray(rows) ? rows : [])
      .filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === 'object'
      )
      .map((row) => ({
        groupId: num(row.groupId, NaN),
        groupName: typeof row.groupName === 'string' ? row.groupName : '',
        owner: str(row.owner),
        isOpen: typeof row.isOpen === 'boolean' ? row.isOpen : null,
        memberCount:
          typeof row.memberCount === 'number' ? row.memberCount : null,
        isAdmin: row.isAdmin === true,
        created: typeof row.created === 'number' ? row.created : null,
        description:
          typeof row.description === 'string' && row.description.trim()
            ? row.description.trim()
            : null,
      }))
      .filter((group) => Number.isFinite(group.groupId));
  },
});

/** The Dev Admins: the dev group's admins, without Core's null account. */
export const devAdminsRead = (): ReadSpec<string[]> => ({
  key: 'devadmins',
  ttlMs: 30 * MINUTE,
  load: async () => {
    const admins: string[] = [];
    for (let page = 0; page < 2; page++) {
      const body = await getJson<{ members?: unknown }>(
        `/groups/members/${DEV_GROUP_ID}?${queryString({
          onlyAdmins: true,
          limit: 100,
          offset: page * 100,
        })}`
      );
      const rows = Array.isArray(body?.members) ? body.members : [];
      for (const row of rows) {
        const member = str((row as { member?: unknown })?.member);
        if (member && member !== NULL_ACCOUNT) admins.push(member);
      }
      if (rows.length < 100) break;
    }
    return admins;
  },
});

// ---- Minting --------------------------------------------------------------------------

/** One reward share minting right now. */
export interface OnlineShare {
  minterAddress: string;
  recipientAddress: string;
}

/** Every reward share online now (one read, kept 5 minutes, never polled). */
export const onlineRead = (): ReadSpec<OnlineShare[]> => ({
  key: 'online',
  ttlMs: 5 * MINUTE,
  load: async () => {
    const rows = await getJson<unknown>('/addresses/online');
    return (Array.isArray(rows) ? rows : [])
      .map((row) => ({
        minterAddress: str((row as Record<string, unknown>)?.minterAddress),
        recipientAddress: str(
          (row as Record<string, unknown>)?.recipientAddress
        ),
      }))
      .filter(
        (share): share is OnlineShare =>
          share.minterAddress !== null && share.recipientAddress !== null
      );
  },
});

export interface BlockAt {
  height: number;
  timestamp: number | null;
}

/**
 * The newest block the account's keys signed, or null when there is none.
 * Asked only for an account with a public key: the node can't answer
 * without one. Core's rows carry no time, so the block itself is read too.
 */
export const lastSignedRead = (address: string): ReadSpec<BlockAt | null> => ({
  key: `signed:${address}`,
  ttlMs: 5 * MINUTE,
  load: async () => {
    let rows: unknown;
    try {
      rows = await getJson<unknown>(
        `/blocks/signer/${seg(address)}?${queryString({ limit: 1, reverse: true })}`
      );
    } catch (error) {
      // "public key not found": it never had a key to sign with.
      if (isCoreError(error, 404, 304)) return null;
      throw error;
    }
    // The node reads its live and archived blocks apart: up to two rows.
    const best = (Array.isArray(rows) ? rows : [])
      .map((row) => num((row as { height?: unknown })?.height, NaN))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    if (best === undefined) return null;
    const block = await getJson<{ timestamp?: unknown }>(
      `/blocks/byheight/${seg(best)}`
    );
    return {
      height: best,
      timestamp: typeof block?.timestamp === 'number' ? block.timestamp : null,
    };
  },
});

// ---- Transactions ----------------------------------------------------------------------

/** A transaction as Core sends it: the fields every one has, and its type's own. */
export interface TxRow {
  type: string;
  timestamp: number;
  signature: string;
  reference?: string;
  fee?: string;
  txGroupId?: number;
  /** Absent while it waits for a block. */
  blockHeight?: number;
  /** NOT_REQUIRED, PENDING, APPROVED, REJECTED, EXPIRED or INVALID. */
  approvalStatus?: string;
  creatorAddress?: string;
  recipient?: string;
  amount?: string;
  assetId?: number | string;
  atAddress?: string;
  payments?: Array<{ recipient?: string; amount?: string; assetId?: unknown }>;
  [field: string]: unknown;
}

export const toTxRows = (rows: unknown): TxRow[] =>
  (Array.isArray(rows) ? rows : []).filter(
    (row): row is TxRow =>
      Boolean(row) &&
      typeof (row as TxRow).type === 'string' &&
      typeof (row as TxRow).signature === 'string'
  );

export interface LastSent {
  type: string;
  height: number;
  timestamp: number;
}

/** Its newest confirmed transaction of its own, or null when it has none. */
export const lastSentRead = (
  address: string,
  publicKey: string
): ReadSpec<LastSent | null> => ({
  key: `lastsent:${address}`,
  ttlMs: 2 * MINUTE,
  load: async () => {
    const rows = toTxRows(
      await getJson<unknown>(
        `/transactions/creator/${seg(publicKey)}?${queryString({
          confirmationStatus: 'CONFIRMED',
          limit: 1,
          reverse: true,
        })}`
      )
    );
    const row = rows[0];
    if (!row || typeof row.blockHeight !== 'number') return null;
    return {
      type: row.type,
      height: row.blockHeight,
      timestamp: row.timestamp,
    };
  },
});

/**
 * When the account was first seen: the oldest confirmed transaction
 * involving it (as sender, recipient or otherwise), or null when there is
 * none. One row, oldest first.
 */
export const firstSeenRead = (address: string): ReadSpec<BlockAt | null> => ({
  key: `firstseen:${address}`,
  ttlMs: 30 * MINUTE,
  load: async () => {
    const rows = toTxRows(
      await getJson<unknown>(
        `/transactions/search?${queryString({
          address,
          confirmationStatus: 'CONFIRMED',
          limit: 1,
          reverse: false,
        })}`
      )
    );
    const first = rows[0];
    return first && typeof first.blockHeight === 'number'
      ? { height: first.blockHeight, timestamp: first.timestamp }
      : null;
  },
});

/** How many payments User search read, and the Explorer still reads, for its first figures. */
export const RECENT_PAYMENTS_LIMIT = 500;

export interface RecentPayments {
  /** Its newest QORT payments, sent and received, newest first. */
  rows: TxRow[];
  /** The read came back full: the account may have older payments. */
  full: boolean;
}

export const recentPaymentsRead = (
  address: string
): ReadSpec<RecentPayments> => ({
  key: `payments:${address}`,
  ttlMs: 2 * MINUTE,
  load: async () => {
    const rows = toTxRows(
      await getJson<unknown>(
        `/transactions/search?${queryString({
          txType: 'PAYMENT',
          address,
          confirmationStatus: 'CONFIRMED',
          limit: RECENT_PAYMENTS_LIMIT,
          reverse: true,
        })}`
      )
    );
    return { rows, full: rows.length >= RECENT_PAYMENTS_LIMIT };
  },
});

// ---- The node's pace, for "about N days to the next level" ----------------------------

export interface NodeTiming {
  height: number;
  /** The node's clock now. */
  currentTimestamp: number;
  /** When the block 1,440 blocks back was made. */
  dayBackTimestamp: number;
}

/** What Hub's Minting window measures the pace of blocks with (MintingStats.tsx). */
export const nodeTimingRead = (): ReadSpec<NodeTiming> => ({
  key: 'nodetiming',
  ttlMs: 10 * MINUTE,
  load: async () => {
    const status = await getJson<{ height?: unknown }>('/admin/status');
    const height = num(status?.height, NaN);
    if (!Number.isFinite(height) || height <= 1440)
      throw new CoreHttpError(200, JSON.stringify(status));
    const [block, info] = await Promise.all([
      getJson<{ timestamp?: unknown }>(
        `/blocks/byheight/${seg(height - 1440)}`
      ),
      getJson<{ currentTimestamp?: unknown }>('/admin/info'),
    ]);
    const dayBackTimestamp = num(block?.timestamp, NaN);
    const currentTimestamp = num(info?.currentTimestamp, NaN);
    if (
      !Number.isFinite(dayBackTimestamp) ||
      !Number.isFinite(currentTimestamp)
    )
      throw new CoreHttpError(200, 'timing');
    return { height, currentTimestamp, dayBackTimestamp };
  },
});

// ---- One transaction ----------------------------------------------------------------------

/** Core's "transaction unknown". */
const TRANSACTION_UNKNOWN = 311;

/**
 * A transaction by its signature, or null when the node doesn't know it
 * (it may not have reached the node yet). Kept a minute: one waiting for a
 * block is read again by Refresh, or by opening it again later.
 */
export const txRead = (signature: string): ReadSpec<TxRow | null> => ({
  key: `tx:${signature}`,
  ttlMs: MINUTE,
  load: async () => {
    try {
      const [row] = toTxRows([
        await getJson<unknown>(`/transactions/signature/${seg(signature)}`),
      ]);
      if (!row) throw new CoreHttpError(200, 'not a transaction');
      return row;
    } catch (error) {
      if (isCoreError(error, 404, TRANSACTION_UNKNOWN)) return null;
      throw error;
    }
  },
});

/** Hub's base58 (an untyped module), with the two calls used here typed. */
const Base58 = Base58Module as unknown as {
  decode(text: string): Uint8Array;
  encode(bytes: Uint8Array): string;
};

/** TRANSFER_PRIVS is type 40. */
const TRANSFER_PRIVS_TYPE = 40;

/**
 * The recipient of a TRANSFER_PRIVS (a minting level moved to a new key),
 * from the transaction's raw bytes, since Core's JSON leaves it out: type
 * (4 bytes), timestamp (8), txGroupId (4), reference (64), the sender's
 * public key (32), then the recipient's 25-byte address. Null when the
 * bytes aren't such a transaction.
 */
export function decodePrivsRecipient(raw: string): string | null {
  let bytes: Uint8Array;
  try {
    bytes = Base58.decode(raw.trim());
  } catch {
    return null;
  }
  if (!(bytes instanceof Uint8Array) || bytes.length < 137) return null;
  const type = new DataView(bytes.buffer, bytes.byteOffset, 4).getInt32(0);
  if (type !== TRANSFER_PRIVS_TYPE) return null;
  const address = Base58.encode(bytes.slice(112, 137));
  return /^Q[1-9A-HJ-NP-Za-km-z]{33}$/.test(address) ? address : null;
}

/** Who a minting level was moved to (a transaction never changes: kept 30 minutes). */
export const privsRecipientRead = (
  signature: string
): ReadSpec<string | null> => ({
  key: `privs:${signature}`,
  ttlMs: 30 * MINUTE,
  load: async () =>
    decodePrivsRecipient(
      await getText(`/transactions/signature/${seg(signature)}/raw`)
    ),
});

/** Core's "group unknown". */
const GROUP_UNKNOWN = 1101;

/** A group's name, for a sentence; null when the node has no such group. */
export const groupNameRead = (groupId: number): ReadSpec<string | null> => ({
  key: `group:${groupId}`,
  ttlMs: 30 * MINUTE,
  load: async () => {
    try {
      const body = await getJson<{ groupName?: unknown }>(
        `/groups/${seg(groupId)}`
      );
      return str(body?.groupName);
    } catch (error) {
      if (isCoreError(error, 404, GROUP_UNKNOWN)) return null;
      throw error;
    }
  },
});

/** How many of an account's own waiting transactions are read at most. */
export const WAITING_LIMIT = 100;

/**
 * What the account sent that isn't in a block yet (the node's own list of
 * waiting transactions, by its public key), newest first. Kept 20 seconds;
 * never polled. Waiting transactions sent to it can't be found: Core
 * records who a transaction involves only once it is in a block.
 */
export const waitingRead = (
  address: string,
  publicKey: string
): ReadSpec<TxRow[]> => ({
  key: `waiting:${address}`,
  ttlMs: 20_000,
  load: async () =>
    toTxRows(
      await getJson<unknown>(
        `/transactions/unconfirmed?${queryString({
          creator: publicKey,
          limit: WAITING_LIMIT,
          reverse: true,
        })}`
      )
    ).sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)),
});
