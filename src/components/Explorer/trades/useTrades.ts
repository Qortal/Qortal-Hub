/**
 * What the Trades tab reads and works out (from Q-Mintership+'s
 * TradesTab): its completed trades on the Trade Portal, the trade offers
 * it made and how each ended, and its Q-Asset trades. Only for a viewer
 * the level 5+ rule lets in: for anyone else nothing is read (every spec
 * is null until it is known that the viewer sees the detailed parts).
 *
 * - With a public key: its trades by its key (qortReads.ts, shared with
 *   the Overview's QORT purchased / sold and Compare: two reads, every chain
 *   at once), which coin each was for (one more read per chain and side,
 *   only here; a trade none of them claims is another coin, and a failure
 *   there fails the coins only), its offers (its DEPLOY_AT transactions),
 *   and, only when it made one, the payouts contracts made to it, which
 *   tell an offer that ended from one still open.
 * - Without one it never made a transaction: it made no offers and sold
 *   nothing, and Core can't list its trades by a key it doesn't have. Its
 *   purchases are the contracts that paid it (its payouts), each by its
 *   own record, the newest CONTRACTS_MAX (useKeylessPurchases, as the
 *   Overview counts them).
 * - Its Q-Asset trades, as Connections reads them; a trade between two of
 *   its own orders is left out, as Connections leaves it out.
 *
 * Each read loads, fails (with Retry) and is kept on its own; what was read
 * stays while a Refresh reads again, and a read again that failed says so.
 */
import { useMemo } from 'react';
import { assetTradesRead } from '../../../lib/explorer/assetTrades';
import {
  offerOutcomes,
  soldAts,
  withCoins,
  type OfferMade,
  type PortalTrade,
} from '../../../lib/explorer/portalTrades';
import {
  portalChainsRead,
  portalTradesRead,
} from '../../../lib/explorer/qortReads';
import type { AccountInfo } from '../../../lib/explorer/reads';
import { offersRead, payoutsRead } from '../../../lib/explorer/tradeReads';
import { useExplorerAccess } from '../useExplorerAccess';
import { useKeptRead } from '../useKeptRead';
import { useKeylessPurchases } from './useKeylessPurchases';

/** Where a part of the tab stands. */
export type PartState<T> =
  | { status: 'loading' }
  | { status: 'failed'; retry: () => void }
  | {
      status: 'ready';
      data: T;
      /** A read again failed: what is shown is the last answer, with Retry. */
      failedAgain: (() => void) | null;
    };

export interface PortalPart {
  trades: PortalTrade[];
  /**
   * Which coin each trade was for: known (another coin for one no chain
   * claims), still being read, or that read failed (the trades show
   * without their coins).
   */
  coins: 'known' | 'reading' | 'failed';
  /** Read which coin each was for again (it failed, or failed again). */
  retryCoins: (() => void) | null;
  /** Without a public key: it had more payouts than are read (what it bought before them isn't here). */
  payoutsCut: boolean;
  /** Without a public key: more contracts paid it than are read (CONTRACTS_MAX). */
  contractsCut: boolean;
}

export interface OffersPart {
  offers: OfferMade[];
  /** It made more contracts than were read: these are among its newest. */
  more: boolean;
  /** Its contracts read (trade offers and others). */
  read: number;
  /**
   * How each ended: known, being read, or that read failed (also when a
   * read again failed: how they ended may have changed since).
   */
  outcomes: 'known' | 'reading' | 'failed';
  retryOutcomes: () => void;
}

export function useTrades(account: AccountInfo) {
  const full = useExplorerAccess();
  const { address, publicKey } = account;
  const keyed = Boolean(publicKey);
  const portal = useKeptRead(
    full && publicKey ? portalTradesRead(address, publicKey) : null
  );
  const chains = useKeptRead(
    full && publicKey ? portalChainsRead(address, publicKey) : null
  );
  const offers = useKeptRead(full && publicKey ? offersRead(address) : null);
  const madeOffers = (offers.data?.offers.length ?? 0) > 0;
  const payouts = useKeptRead(
    full && (madeOffers || !keyed) ? payoutsRead(address) : null
  );
  const keyless = useKeylessPurchases(
    address,
    !keyed && payouts.data ? payouts.data.payouts : null
  );
  const assetRead = useKeptRead(full ? assetTradesRead(address) : null);

  const portalPart = useMemo((): PartState<PortalPart> => {
    if (keyed) {
      if (portal.data)
        return {
          status: 'ready',
          data: {
            trades: withCoins(portal.data.trades, chains.data ?? null),
            coins: chains.data
              ? 'known'
              : chains.status === 'error'
                ? 'failed'
                : 'reading',
            retryCoins: chains.status === 'error' ? chains.retry : null,
            payoutsCut: false,
            contractsCut: false,
          },
          failedAgain: portal.status === 'error' ? portal.retry : null,
        };
      return portal.status === 'error'
        ? { status: 'failed', retry: portal.retry }
        : { status: 'loading' };
    }
    if (!payouts.data)
      return payouts.status === 'error'
        ? { status: 'failed', retry: payouts.retry }
        : { status: 'loading' };
    if (keyless.status === 'failed')
      return { status: 'failed', retry: keyless.retry };
    if (keyless.status !== 'ready') return { status: 'loading' };
    return {
      status: 'ready',
      data: {
        trades: keyless.trades,
        coins: 'known',
        retryCoins: null,
        payoutsCut: payouts.data.more,
        contractsCut: keyless.contractsCut,
      },
      failedAgain:
        payouts.status === 'error' ? payouts.retry : keyless.failedAgain,
    };
  }, [keyed, portal, chains, payouts, keyless]);

  const offersPart = useMemo((): PartState<OffersPart> => {
    // Without a key it never made a transaction: no offers.
    if (!keyed)
      return {
        status: 'ready',
        data: {
          offers: [],
          more: false,
          read: 0,
          outcomes: 'known',
          retryOutcomes: () => undefined,
        },
        failedAgain: null,
      };
    if (!offers.data)
      return offers.status === 'error'
        ? { status: 'failed', retry: offers.retry }
        : { status: 'loading' };
    const deployed = offers.data.offers;
    const sold =
      portalPart.status === 'ready' ? soldAts(portalPart.data.trades) : null;
    let outcomes: OffersPart['outcomes'] = 'known';
    let made: OfferMade[] = deployed.map((offer) => ({
      ...offer,
      outcome: 'open',
    }));
    // Its trades or its payouts read again and failed: how its offers ended
    // may have changed since, so the answer from before isn't shown as known.
    const portalAgain =
      portalPart.status === 'ready' ? portalPart.failedAgain : null;
    if (deployed.length) {
      if (
        payouts.status === 'error' ||
        portalPart.status === 'failed' ||
        portalAgain
      )
        outcomes = 'failed';
      else if (!payouts.data || !sold) outcomes = 'reading';
      else
        made = offerOutcomes(
          deployed,
          sold,
          new Set(payouts.data.payouts.map((payout) => payout.at)),
          payouts.data.more ? payouts.data.oldest : null
        );
    }
    return {
      status: 'ready',
      data: {
        offers: made,
        more: offers.data.more,
        read: offers.data.read,
        outcomes,
        retryOutcomes: () => {
          if (payouts.status === 'error') payouts.retry();
          if (portalPart.status === 'failed') portalPart.retry();
          else portalAgain?.();
        },
      },
      failedAgain: offers.status === 'error' ? offers.retry : null,
    };
  }, [keyed, offers, payouts, portalPart]);

  // A trade between two of its own orders isn't a trade with anyone: left out.
  const assets = useMemo(() => {
    if (!assetRead.data) return { ...assetRead, selfTrades: 0 };
    const trades = assetRead.data.trades.filter(
      (trade) => trade.other !== address
    );
    return {
      ...assetRead,
      data: { ...assetRead.data, trades },
      selfTrades: assetRead.data.trades.length - trades.length,
    };
  }, [assetRead, address]);

  return { keyed, portal: portalPart, offers: offersPart, assets };
}

export type TradesData = ReturnType<typeof useTrades>;
