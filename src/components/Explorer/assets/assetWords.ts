/**
 * How the Assets tab, the Overview's Q-Assets and an asset's window put
 * amounts into words, in the reader's language: units exactly (Core's
 * eight decimals, trailing zeros dropped), QORT as Hub shows it (two
 * decimals), prices exactly, shares of all there is as a percent that is
 * never 100 % for less than all nor 0 % for more than none.
 */
import type { TFunction } from 'i18next';
import type { AssetView, SaleNow } from '../../../lib/explorer/assets';
import { formatAmountExact, formatQort } from '../../../lib/explorer/format';
import { visibleName } from '../../../lib/explorer/rules';
import { fromAtomic } from '../../../lib/explorer/txWords';

/** An asset's name as shown (characters a reader can't see marked), or its number while it has none. */
export function assetLabel(
  asset: { assetId: number; name: string | null },
  t: TFunction
): string {
  return asset.name !== null
    ? visibleName(asset.name)
    : String(t('explorer:tx.asset_number', { id: asset.assetId }));
}

/** Units of an asset, exactly: "6", "25.5", "12,345.678". */
export const unitsText = (atomic: bigint, language: string): string =>
  formatAmountExact(fromAtomic(atomic), language);

/** QORT as Hub shows it: "120.00", "0.004" (a small amount keeps its digits). */
export const qortText = (atomic: bigint, language: string): string =>
  formatQort(Number(fromAtomic(atomic)), language);

/** "≈ 120.00 QORT": a worth or what buyers would pay. */
export const approxQort = (atomic: bigint, t: TFunction, language: string) =>
  String(
    t('explorer:assets.approx_qort', { qort: qortText(atomic, language) })
  );

/** "20 QORT each": a price, exactly. */
export const priceEach = (perUnit: bigint, t: TFunction, language: string) =>
  String(
    t('explorer:assets.price_each', { price: unitsText(perUnit, language) })
  );

function percent(language: string, digits: number) {
  const options = {
    style: 'percent' as const,
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  };
  try {
    return new Intl.NumberFormat(language, options);
  } catch {
    return new Intl.NumberFormat('en', options);
  }
}

/**
 * A share of all there is: "71 %", "2.1 %", "0.24 %", "under 0.01 %", "100 %"
 * only when it holds all of it, in the language's way of writing a percent.
 */
export function shareText(
  share: number,
  t: TFunction,
  language: string
): string {
  if (share >= 1) return percent(language, 0).format(1);
  if (share <= 0) return percent(language, 0).format(0);
  if (share < 0.0001)
    return String(
      t('explorer:assets.share_under', {
        share: percent(language, 2).format(0.0001),
      })
    );
  const digits = share >= 0.1 ? 0 : share >= 0.01 ? 1 : 2;
  const step = 10 ** (digits + 2);
  // Rounding up to 100 would say it holds all of it.
  const shown =
    Math.round(share * step) >= step ? Math.floor(share * 1e4) / 1e4 : share;
  return percent(language, shown === share ? digits : 2).format(shown);
}

/** What buyers would pay now: "≈ 102.00 QORT", "at least ≈ 0.50 QORT", or "no buyers now". */
export function saleValue(
  sale: SaleNow,
  t: TFunction,
  language: string
): string {
  if (!sale.sold)
    return String(
      t('explorer:assets.no_buyers', { postProcess: 'capitalizeFirstChar' })
    );
  return sale.atLeast
    ? String(
        t('explorer:assets.at_least_qort', {
          qort: qortText(sale.qort, language),
        })
      )
    : approxQort(sale.qort, t, language);
}

/** What buyers would pay for them together: "≈ 113.98 QORT", or "at least ≈ 113.98 QORT" when a book had more orders than were read. */
export const saleTotalText = (
  qort: bigint,
  atLeast: boolean,
  t: TFunction,
  language: string
) =>
  atLeast
    ? String(
        t('explorer:assets.at_least_qort', { qort: qortText(qort, language) })
      )
    : approxQort(qort, t, language);

/** Under it: "for all of it", "for 5,000 of 12,345.678"; '' when no buyer wants any. */
export function saleDetail(
  sale: SaleNow,
  balance: bigint,
  t: TFunction,
  language: string
): string {
  if (!sale.sold) return '';
  if (!sale.unsold) return String(t('explorer:assets.sale_all'));
  return String(
    t('explorer:assets.sale_part', {
      sold: unitsText(sale.sold, language),
      balance: unitsText(balance, language),
    })
  );
}

/** "Best offer 18 QORT each", or ''. */
export const bestOfferText = (sale: SaleNow, t: TFunction, language: string) =>
  sale.bestBid
    ? String(
        t('explorer:assets.best_offer', {
          price: unitsText(sale.bestBid, language),
        })
      )
    : '';

/** Whether a view's buy orders are read, being read, or failed. */
export type SaleState = 'read' | 'reading' | 'failed';

/** The view, as the name button of its card or row is called. */
export const detailsLabel = (view: AssetView, t: TFunction) =>
  String(t('explorer:assets.details', { name: assetLabel(view, t) }));
