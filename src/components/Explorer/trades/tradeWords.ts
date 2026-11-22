/**
 * How the Trades tab puts its figures into words, in the reader's
 * language: QORT as Hub shows it (two decimals), coins exactly with their
 * ticker, prices to four significant digits, periods of the chart, and how
 * the trade offers ended. Pure (it takes `t`).
 */
import type { TFunction } from 'i18next';
import { formatCount, formatMonthYear } from '../../../lib/explorer/format';
import {
  COIN_CODE,
  isTradeChain,
  quarterOf,
  type CoinKey,
  type OfferTotals,
  type PeriodUnit,
} from '../../../lib/explorer/portalTrades';
import { qortText, unitsText } from '../assets/assetWords';
import { cap } from '../parts';

export { qortText, unitsText };

/** "1,234.57 QORT". */
export const qortAmount = (atomic: bigint, t: TFunction, language: string) =>
  String(
    t('explorer:trades.qort_amount', { qort: qortText(atomic, language) })
  );

/** "Litecoin", or "Another coin": a coin's name as a label (a title, a key, a menu). */
export const coinName = (chain: CoinKey, t: TFunction) =>
  String(t(`explorer:trades.coin.${chain}`, cap));

/** A coin's ticker ("LTC"); null for another coin, and while which isn't known. */
export const coinCode = (chain: CoinKey | null): string | null =>
  isTradeChain(chain) ? COIN_CODE[chain] : null;

/**
 * A coin amount, exactly: "0.0812 LTC"; "0.0812 of another coin"; just
 * "0.0812" while which coin isn't known.
 */
export function coinAmount(
  atomic: bigint,
  chain: CoinKey | null,
  t: TFunction,
  language: string
): string {
  const amount = unitsText(atomic, language);
  const code = coinCode(chain);
  if (code) return `${amount} ${code}`;
  return chain === 'OTHER'
    ? String(t('explorer:trades.coin_other_amount', { amount }))
    : amount;
}

/** A ratio to four significant digits ("0.003512"). */
export function significant(value: number, language: string): string {
  const options = { maximumSignificantDigits: 4 };
  try {
    return new Intl.NumberFormat(language, options).format(value);
  } catch {
    return new Intl.NumberFormat('en', options).format(value);
  }
}

/** "0.0035 LTC per QORT"; "0.0035 per QORT" for another coin, or one not known yet. */
export function perQortText(
  ratio: number,
  chain: CoinKey | null,
  t: TFunction,
  language: string
): string {
  const price = significant(ratio, language);
  const code = coinCode(chain);
  return String(
    code
      ? t('explorer:trades.per_qort', { price, code })
      : t('explorer:trades.per_qort_plain', { price })
  );
}

/** "678 completed · 475 ended without a trade · 1 open", leaving out the ones at 0; "none yet" with none. */
export function offersLine(
  totals: OfferTotals,
  t: TFunction,
  language: string
): string {
  const parts = (['completed', 'ended', 'open', 'unknown'] as const)
    .filter((outcome) => totals[outcome] > 0)
    .map((outcome) =>
      String(
        t(`explorer:trades.offers.count_${outcome}`, {
          count: totals[outcome],
          shown: formatCount(totals[outcome], language),
        })
      )
    );
  return parts.join(' · ') || String(t('explorer:trades.offers.none'));
}

/** "Oct 2026", "Q4 2026", "2026": a period of the chart. */
export function periodLabel(
  start: number,
  unit: PeriodUnit,
  t: TFunction,
  language: string
): string {
  if (unit === 'year') return yearText(start, language);
  if (unit === 'quarter')
    // The year as plain digits: the sentence around it says it is a year ("2026年第1四半期").
    return String(
      t('explorer:trades.chart.quarter', {
        quarter: quarterOf(start),
        year: String(new Date(start).getFullYear()),
      })
    );
  return formatMonthYear(start, language);
}

function yearText(start: number, language: string): string {
  const options = { year: 'numeric' as const };
  try {
    return new Intl.DateTimeFormat(language, options).format(new Date(start));
  } catch {
    return new Intl.DateTimeFormat('en', options).format(new Date(start));
  }
}

/** "98 %", "1.8 %", "99.8 %" (never 100 % for less than all), "under 0.1 %": a coin's part of a side. */
export function partText(
  part: bigint,
  whole: bigint,
  t: TFunction,
  language: string
): string {
  const format = (value: number, digits: number) => {
    const options = {
      style: 'percent' as const,
      maximumFractionDigits: digits,
      minimumFractionDigits: 0,
    };
    try {
      return new Intl.NumberFormat(language, options).format(value);
    } catch {
      return new Intl.NumberFormat('en', options).format(value);
    }
  };
  if (whole <= 0n || part <= 0n) return format(0, 0);
  if (part >= whole) return format(1, 0);
  const share = Number((part * 10_000n) / whole) / 10_000;
  if (share >= 0.999)
    return String(t('explorer:trades.part_over', { share: format(0.999, 1) }));
  if (share >= 0.995) return format(share, 1);
  if (share >= 0.1) return format(share, 0);
  if (share >= 0.001) return format(share, 1);
  return String(t('explorer:trades.part_under', { share: format(0.001, 1) }));
}
