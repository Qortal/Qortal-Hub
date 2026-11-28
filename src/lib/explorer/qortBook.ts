/**
 * An account's QORT, added up from its whole history (from Q-Mintership+'s
 * rules/explorer/qortBook.ts): what it received and sent, what contracts
 * paid it, what it put into its own, names, asset orders and fees, and so
 * what it minted. Pure: no reads, no text (the Overview's At a glance puts
 * them into words).
 *
 * Core keeps no record of what an account earned by minting, so it is
 * worked out by bookkeeping: its balance now, less everything its
 * transactions moved. What is left reached it without a transaction of its
 * own: block rewards, which carry the transaction fees paid to minters, the
 * extra share for online Minter Admins and Dev Admins, and the legacy QORA
 * holders' share (Core's Block.distributeBlockReward). Checked against a
 * node on 2026-11-21: 33 accounts that never minted, with payments, sales
 * and purchases through trade contracts, messages carrying QORT, name sales
 * and purchases, asset orders and fees, each came to exactly 0.
 *
 * What a transaction moves, in QORT (atomic units, 1 QORT = 100,000,000):
 * - its fee, when the account made it (a GENESIS has none);
 * - PAYMENT, TRANSFER_ASSET and MESSAGE of QORT, MULTI_PAYMENT and an
 *   ARBITRARY's payments: received or sent;
 * - AT: paid to it by a contract: by someone else's, QORT purchased (a
 *   trade on the Trade Portal); by its own, its QORT back;
 * - DEPLOY_AT: QORT put into its own contract (a sell offer);
 * - BUY_NAME: paid for a name, or got for one it sold;
 * - GENESIS: what it was given when the chain began;
 * - CREATE_ASSET_ORDER with QORT on one side: settled by the order's own
 *   state and trades (orderQort), as Core moves those without a
 *   transaction of the account's.
 */
import type { AccountInfo, TxRow } from './reads';
import { toAtomic } from './txWords';

const QORT = 0;
const UNIT = 100_000_000n;

export interface QortBook {
  received: bigint;
  sent: bigint;
  /** Paid to it by other accounts' contracts: QORT bought on the Trade Portal. */
  purchased: bigint;
  /** Paid back to it by its own contracts. */
  returned: bigint;
  /** Put into its own contracts. */
  deployed: bigint;
  /** Names: got for names sold, less paid for names bought (may be below 0). */
  names: bigint;
  genesis: bigint;
  /** Fees it paid. */
  fees: bigint;
  /** Its own contracts' addresses. */
  ownAts: string[];
  /** Its asset orders with QORT on one side (their ids: the transactions' signatures). */
  orders: string[];
}

const atomic = (value: unknown): bigint => toAtomic(value) ?? 0n;

/** No asset named is QORT (a PAYMENT names none). */
const isQort = (assetId: unknown): boolean =>
  assetId === undefined || assetId === null || Number(assetId) === QORT;

/** What `rows` (the account's whole history, each once) moved, by kind. */
export function qortBook(rows: readonly TxRow[], address: string): QortBook {
  const book: QortBook = {
    received: 0n,
    sent: 0n,
    purchased: 0n,
    returned: 0n,
    deployed: 0n,
    names: 0n,
    genesis: 0n,
    fees: 0n,
    ownAts: [],
    orders: [],
  };
  for (const tx of rows)
    if (
      tx.type === 'DEPLOY_AT' &&
      tx.creatorAddress === address &&
      typeof tx.aTAddress === 'string'
    )
      book.ownAts.push(tx.aTAddress);
  const own = new Set(book.ownAts);
  const seen = new Set<string>();
  for (const tx of rows) {
    if (seen.has(tx.signature)) continue;
    seen.add(tx.signature);
    const mine = tx.creatorAddress === address;
    if (mine && tx.type !== 'GENESIS') book.fees += atomic(tx.fee);
    const move = (recipient: unknown, amount: unknown, assetId: unknown) => {
      if (!isQort(assetId)) return;
      const value = atomic(amount);
      if (recipient === address) book.received += value;
      if (mine) book.sent += value;
    };
    switch (tx.type) {
      case 'PAYMENT':
        move(tx.recipient, tx.amount, QORT);
        break;
      case 'TRANSFER_ASSET':
      case 'MESSAGE':
        move(tx.recipient, tx.amount, tx.assetId);
        break;
      case 'MULTI_PAYMENT':
      case 'ARBITRARY':
        for (const payment of Array.isArray(tx.payments) ? tx.payments : [])
          if (payment) move(payment.recipient, payment.amount, payment.assetId);
        break;
      case 'GENESIS':
        if (tx.recipient === address && isQort(tx.assetId))
          book.genesis += atomic(tx.amount);
        break;
      case 'AT':
        if (tx.recipient === address && isQort(tx.assetId)) {
          if (own.has(tx.atAddress as string))
            book.returned += atomic(tx.amount);
          else book.purchased += atomic(tx.amount);
        }
        break;
      case 'DEPLOY_AT':
        if (mine && isQort(tx.assetId)) book.deployed += atomic(tx.amount);
        break;
      case 'BUY_NAME':
        if (mine) book.names -= atomic(tx.amount);
        if (tx.seller === address) book.names += atomic(tx.amount);
        break;
      case 'CREATE_ASSET_ORDER':
        if (
          mine &&
          (Number(tx.haveAssetId) === QORT || Number(tx.wantAssetId) === QORT)
        )
          book.orders.push(tx.signature);
        break;
    }
  }
  return book;
}

/** An asset order, as `/assets/order/{id}` answers. */
export interface OrderState {
  haveAssetId: number;
  wantAssetId: number;
  amount: string;
  price: string;
  fulfilled: string;
  isClosed: boolean;
  isFulfilled: boolean;
  /** The asset `amount` is in (the asset wanted, for newer orders). */
  amountAssetId?: number;
}

/** A trade of an order, as `/assets/order/{id}/trades` answers. */
export interface OrderTrade {
  initiatingOrderId: string;
  targetOrderId: string;
  targetAmount: string;
  initiatorAmount: string;
  initiatorSaving?: string;
}

/** `a × b`, rounded up (Core's roundUpScaledMultiply). */
const timesUp = (a: bigint, b: bigint) => (a * b + UNIT - 1n) / UNIT;

/**
 * What an asset order moved in QORT, for the account that placed it (Core:
 * Order.process, cancel, Trade.process): selling QORT, it was taken when
 * placed (the amount, or amount × price when the amount is in the asset
 * wanted), then savings and, if cancelled, what was left came back; buying
 * QORT, each trade paid it.
 */
export function orderQort(
  id: string,
  order: OrderState,
  trades: readonly OrderTrade[]
): bigint {
  let net = 0n;
  if (Number(order.wantAssetId) === QORT)
    for (const trade of trades)
      net += atomic(
        trade.initiatingOrderId === id
          ? trade.targetAmount
          : trade.initiatorAmount
      );
  if (Number(order.haveAssetId) === QORT) {
    const amount = atomic(order.amount);
    const price = atomic(order.price);
    const inWant =
      order.amountAssetId !== undefined &&
      order.amountAssetId !== null &&
      Number(order.amountAssetId) === Number(order.wantAssetId);
    net -= inWant ? timesUp(amount, price) : amount;
    for (const trade of trades)
      if (trade.initiatingOrderId === id) net += atomic(trade.initiatorSaving);
    if (order.isClosed && !order.isFulfilled) {
      const left = amount - atomic(order.fulfilled);
      net += inWant ? timesUp(left, price) : left;
    }
  }
  return net;
}

/**
 * QORT minted: its balance, less what its transactions moved (`book`) and
 * its asset orders (`orders`, net). Below 0, its transactions don't add up
 * to its balance, and it can't be worked out.
 */
export function qortMinted(
  balance: bigint,
  book: QortBook,
  orders: bigint
): bigint {
  const moved =
    book.received -
    book.sent +
    book.purchased +
    book.returned -
    book.deployed +
    book.names +
    book.genesis +
    orders -
    book.fees;
  return balance - moved;
}

export type MovedPart =
  | 'received'
  | 'sent'
  | 'purchased'
  | 'returned'
  | 'deployed'
  | 'names'
  | 'orders'
  | 'genesis'
  | 'fees';

/** What moved, part by part, for QORT minted's (i): the parts that aren't 0, in this order. */
export function movedParts(
  book: QortBook,
  orders: bigint
): Array<{ part: MovedPart; atomic: bigint }> {
  const parts: Array<{ part: MovedPart; atomic: bigint }> = [
    { part: 'received', atomic: book.received },
    { part: 'sent', atomic: book.sent },
    { part: 'purchased', atomic: book.purchased },
    { part: 'returned', atomic: book.returned },
    { part: 'deployed', atomic: book.deployed },
    { part: 'names', atomic: book.names },
    { part: 'orders', atomic: orders },
    { part: 'genesis', atomic: book.genesis },
    { part: 'fees', atomic: book.fees },
  ];
  return parts.filter((each) => each.atomic !== 0n);
}

/**
 * Whether the account never minted, with nothing to work out: Qortal counts
 * no blocks minted for it, and no reward share ever involved it (its oldest
 * one, `firstShare`, is none). An account that moved its minting level
 * away (TRANSFER_PRIVS) has its blocks minted set back to 0, but minted
 * before, under a reward share; the bookkeeping works that out.
 */
export function neverMinted(
  account: Pick<AccountInfo, 'blocksMinted' | 'blocksMintedAdjustment'>,
  firstShare: unknown
): boolean {
  return (
    account.blocksMinted === 0 &&
    !account.blocksMintedAdjustment &&
    firstShare === null
  );
}
