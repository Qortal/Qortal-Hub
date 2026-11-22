/**
 * A made-up node for the Explorer's page tests: one list of transactions
 * that every read is answered from (an address's lists by kind, the
 * payments between two accounts, a transaction by its signature), so the
 * answers agree with each other, plus each account's own records. Tests
 * put routes of their own in front of it (a failure, an answer held back).
 * Neutral data only.
 */
import { vi } from 'vitest';
import Base58Module from '../../encryption/Base58';
import { NULL_ACCOUNT } from '../../lib/explorer/reads';

export type Row = Record<string, unknown>;
export type Answer = { status?: number; body: unknown; delay?: Promise<void> };
export type Route = (path: string) => Answer | undefined;

const Base58 = Base58Module as unknown as {
  decode(text: string): Uint8Array;
  encode(bytes: Uint8Array): string;
};

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const base58 = (n: number) => {
  let text = '';
  do {
    text = ALPHABET[n % 58] + text;
    n = Math.floor(n / 58);
  } while (n > 0);
  return text;
};
/** A signature of its own for each number (88 base58 characters). */
export const sig = (n: number) =>
  `C${base58(n).padStart(6, '1')}`.padEnd(88, 'x');
/** An address of its own for each letter: Q and 33 of it. */
export const addr = (letter: string) => `Q${letter.repeat(33)}`;

export const BLOCK_TIME = (height: number) =>
  Date.UTC(2025, 0, 1, 12) + (height - 1_000_000) * 60_000;

export const params = (path: string) =>
  new URLSearchParams(path.split('?')[1] ?? '');

export interface Account {
  address: string;
  name?: string | null;
  publicKey?: string | null;
  level?: number;
  penalty?: number;
  blocksMinted?: number;
  balance?: number;
  /** Its groups, as Core lists them. */
  groups?: Row[];
  /** When its primary name was registered. */
  registered?: number;
}

/** The whole made-up chain of one test. */
export class TestChain {
  rows: Row[] = [];
  accounts = new Map<string, Account>();
  /** Recipients of level moves (Core's JSON leaves them out). */
  privs = new Map<string, string>();
  /** Completed trade portal trades, as Core sums them up. */
  portal: Row[] = [];
  private count = 0;
  /** Every request, in order. */
  calls: Array<{ method: string; path: string }> = [];
  /** Routes asked before the chain's own answers. */
  routes: Route[] = [];

  account(account: Account): string {
    this.accounts.set(account.address, account);
    return account.address;
  }

  tx(type: string, height: number, extra: Row = {}): Row {
    this.count += 1;
    const row: Row = {
      type,
      timestamp: BLOCK_TIME(height),
      signature: sig(this.count),
      fee: '0.01000000',
      txGroupId: 0,
      blockHeight: height,
      approvalStatus: 'NOT_REQUIRED',
      ...extra,
    };
    this.rows.push(row);
    return row;
  }

  pay(from: string, to: string, height: number, amount: string): Row {
    return this.tx('PAYMENT', height, {
      creatorAddress: from,
      recipient: to,
      amount,
    });
  }

  share(from: string, to: string, height: number, percent = '0.00'): Row {
    return this.tx('REWARD_SHARE', height, {
      creatorAddress: from,
      recipient: to,
      sharePercent: percent,
    });
  }

  /** A trade portal sale: `seller` sold `qort` QORT, the buyer receiving at `buyer`. */
  portalSale(seller: string, buyer: string, timestamp: number, qort: string) {
    this.count += 1;
    const row: Row = {
      tradeTimestamp: timestamp,
      qortAmount: qort,
      btcAmount: '0.01000000',
      foreignAmount: '0.01000000',
      atAddress: `A${String(this.count).padStart(33, 'X')}`.replace(/0/g, 'Y'),
      sellerAddress: seller,
      buyerReceivingAddress: buyer,
    };
    this.portal.push(row);
    return row;
  }

  levelMove(from: string, to: string, height: number): Row {
    const row = this.tx('TRANSFER_PRIVS', height, { creatorAddress: from });
    this.privs.set(row.signature as string, to);
    return row;
  }

  /** Whether `row` involves `address`, as Core's address search counts it. */
  involves(row: Row, address: string): boolean {
    if (row.creatorAddress === address || row.recipient === address)
      return true;
    if (row.seller === address) return true;
    if (row.type === 'TRANSFER_PRIVS')
      return this.privs.get(row.signature as string) === address;
    if (Array.isArray(row.payments))
      return (row.payments as Row[]).some((p) => p.recipient === address);
    return false;
  }

  private sorted(rows: Row[], reverse: boolean): Row[] {
    const order = [...rows].sort(
      (a, b) =>
        (a.blockHeight as number) - (b.blockHeight as number) ||
        (a.timestamp as number) - (b.timestamp as number)
    );
    return reverse ? order.reverse() : order;
  }

  private page(rows: Row[], path: string): Row[] {
    const query = params(path);
    const offset = Number(query.get('offset') ?? 0);
    const limit = Number(query.get('limit') ?? 20);
    return rows.slice(offset, offset + limit);
  }

  /** The chain's own answer for `path`, or undefined. */
  answer(path: string): Answer | undefined {
    const query = params(path);
    const reverse = query.get('reverse') === 'true';
    if (path.startsWith('/transactions/search?')) {
      const address = query.get('address');
      if (!address) return undefined;
      const types = query.getAll('txType');
      const rows = this.rows.filter(
        (row) =>
          this.involves(row, address) &&
          (!types.length || types.includes(row.type as string))
      );
      return { body: this.page(this.sorted(rows, reverse), path) };
    }
    if (path.startsWith('/transactions/payments/between?')) {
      const sender = query.get('senderAddress');
      const recipient = query.get('recipientAddress');
      const rows = this.rows.filter(
        (row) =>
          row.type === 'PAYMENT' &&
          (!sender || row.creatorAddress === sender) &&
          (!recipient || row.recipient === recipient)
      );
      return { body: this.page(this.sorted(rows, reverse), path) };
    }
    if (path.startsWith('/crosschain/trades?')) {
      const key = query.get('sellerPublicKey');
      const seller = [...this.accounts.values()].find(
        (account) => key && account.publicKey === key
      );
      const rows = this.portal
        .filter((row) => seller && row.sellerAddress === seller.address)
        .sort(
          (a, b) => (b.tradeTimestamp as number) - (a.tradeTimestamp as number)
        );
      // Without a limit, Core answers every one.
      return {
        body: query.get('limit') === null ? rows : this.page(rows, path),
      };
    }
    const raw = /^\/transactions\/signature\/([^/?]+)\/raw$/.exec(path);
    if (raw) {
      const to = this.privs.get(decodeURIComponent(raw[1]));
      return to ? { body: privsBytes(to) } : undefined;
    }
    const one = /^\/transactions\/signature\/([^/?]+)$/.exec(path);
    if (one) {
      const row = this.rows.find(
        (r) => r.signature === decodeURIComponent(one[1])
      );
      return row
        ? { body: row }
        : {
            status: 404,
            body: { error: 311, message: 'transaction unknown' },
          };
    }
    const creator = /^\/transactions\/creator\/([^/?]+)\?/.exec(path);
    if (creator) {
      const owner = [...this.accounts.values()].find(
        (account) => account.publicKey === decodeURIComponent(creator[1])
      );
      const rows = owner
        ? this.rows.filter((row) => row.creatorAddress === owner.address)
        : [];
      return { body: this.page(this.sorted(rows, reverse), path) };
    }
    for (const account of this.accounts.values()) {
      const { address } = account;
      if (path === `/addresses/${address}`) {
        const received = this.sorted(
          this.rows.filter((row) => this.involves(row, address)),
          false
        )[0];
        return {
          body: {
            address,
            reference: (received?.signature as string) ?? null,
            publicKey: account.publicKey ?? null,
            level: account.level ?? 3,
            blocksMinted: account.blocksMinted ?? 250_000,
            blocksMintedAdjustment: 0,
            blocksMintedPenalty: account.penalty ?? 0,
          },
        };
      }
      if (path === `/names/primary/${address}`)
        return {
          body: account.name
            ? { name: account.name, owner: address }
            : { owner: address },
        };
      if (path.startsWith(`/names/address/${address}`))
        return {
          body:
            account.name && params(path).get('offset') !== '100'
              ? [{ name: account.name, owner: address }]
              : [],
        };
      if (path === `/groups/member/${address}`)
        return { body: account.groups ?? [] };
      if (path === `/addresses/balance/${address}`)
        return { body: account.balance ?? 12.5 };
      if (path.startsWith(`/blocks/signer/${address}`)) return { body: [] };
      if (account.name && path === `/names/${encodeURIComponent(account.name)}`)
        return {
          body: {
            name: account.name,
            owner: address,
            ...(account.registered ? { registered: account.registered } : {}),
          },
        };
    }
    return undefined;
  }

  /** Answers what nothing else did: the quiet parts of every page. */
  rest(path: string): Answer | undefined {
    if (path === '/addresses/online') return { body: [] };
    if (path.startsWith('/groups/members/1?')) return { body: { members: [] } };
    if (path.startsWith('/names/search?')) return { body: [] };
    if (path.startsWith('/names/'))
      return {
        status: 404,
        body: { error: 401, message: 'name unknown' },
      };
    if (path.startsWith('/transactions/unconfirmed?')) return { body: [] };
    if (path.startsWith('/assets/orders/')) return { body: [] };
    if (path === '/admin/status') return { body: { height: 2_000_500 } };
    if (path === '/admin/info')
      return { body: { currentTimestamp: 2_000_000_000_000 } };
    if (path.startsWith('/blocks/byheight/'))
      return {
        body: { height: 1_999_060, timestamp: 2_000_000_000_000 - 86_400_000 },
      };
    if (path.startsWith('/addresses/'))
      return {
        status: 404,
        body: { error: 124, message: 'account address unknown' },
      };
    return undefined;
  }

  /** Replaces `fetch` with this node. */
  install() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).slice('http://node.test'.length);
        this.calls.push({ method: init?.method ?? 'GET', path });
        for (const route of [
          ...this.routes,
          (p: string) => this.answer(p),
          (p: string) => this.rest(p),
        ]) {
          const answer = route(path);
          if (!answer) continue;
          if (answer.delay) await answer.delay;
          const status = answer.status ?? 200;
          return {
            ok: status >= 200 && status < 300,
            status,
            text: async () =>
              typeof answer.body === 'string'
                ? answer.body
                : JSON.stringify(answer.body),
            json: async () => answer.body,
          } as Response;
        }
        return {
          ok: false,
          status: 404,
          text: async () => JSON.stringify({ error: 999, message: 'no route' }),
          json: async () => ({}),
        } as Response;
      })
    );
  }
}

/** A TRANSFER_PRIVS's raw bytes, in base58, moving the level to `recipient`. */
export function privsBytes(recipient: string): string {
  const bytes = new Uint8Array(137 + 64);
  new DataView(bytes.buffer).setInt32(0, 40);
  bytes.set(Base58.decode(recipient), 112);
  return Base58.encode(bytes);
}

export const minterGroup = (isAdmin: boolean): Row => ({
  groupId: 694,
  groupName: 'MINTER',
  owner: NULL_ACCOUNT,
  isOpen: false,
  memberCount: 600,
  isAdmin,
});

export interface Persona {
  level: number;
  minter: 'admin' | 'member' | null;
}

export const LEVEL_FIVE: Persona = { level: 5, minter: 'member' };
export const LEVEL_FOUR: Persona = { level: 4, minter: 'member' };

/** The Hub account looking: its level and its groups. */
export function viewerRoute(persona: Persona, address: string): Route {
  return (path) => {
    if (path === `/addresses/${address}`)
      return {
        body: {
          address,
          reference: null,
          publicKey: null,
          level: persona.level,
          blocksMinted: 0,
          blocksMintedAdjustment: 0,
          blocksMintedPenalty: 0,
        },
      };
    if (path === `/groups/member/${address}`)
      return {
        body: persona.minter ? [minterGroup(persona.minter === 'admin')] : [],
      };
    return undefined;
  };
}

/** An answer held back until it is let go. */
export function hold() {
  let release: () => void = () => undefined;
  const until = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { until, release };
}
