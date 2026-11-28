/**
 * What the Connections tab says about what it read, in words the tab and
 * the Account report share: how far each list was read, and what was
 * checked and found nothing.
 */
import type { TFunction } from 'i18next';
import { ACCOUNT_TX_MAX } from '../../../lib/explorer/accountTx';
import {
  FILLED_MAX,
  FILLS_MAX,
  leftOutTrades,
} from '../../../lib/explorer/assetTrades';
import {
  pairedOnline,
  type EmptyCheck,
  type Funding,
} from '../../../lib/explorer/connections';
import type { Finding } from '../../../lib/explorer/findings';
import { formatCount, formatList } from '../../../lib/explorer/format';
import { cap } from '../parts';
import {
  isShort,
  stoppedAtCeiling,
  type ConnectionsData,
} from './useConnections';

/**
 * What was read of its lists and how far, as sentences (the line under
 * the tab, and the Account report's "What was read"): null until a list is
 * read; a list that couldn't be read is named as such.
 */
export function coverageSentences(
  data: ConnectionsData,
  t: TFunction,
  language: string
): string[] | null {
  const lists = [
    ['payments', data.payments],
    ['minting', data.minting],
    ['names', data.names],
  ] as const;
  // Once a list is read; one still being read joins it when it is in.
  if (!lists.some(([, state]) => state.list)) return null;
  const parts = lists.flatMap(([kind, state]) => {
    const list = state.list;
    if (!list)
      return state.error
        ? [String(t(`explorer:connections.coverage.${kind}_failed`))]
        : [];
    const rows = list.rows.length;
    const options = { count: rows, shown: formatCount(rows, language) };
    if (!list.done)
      return [
        String(t(`explorer:connections.coverage.${kind}_newest`, options)),
      ];
    if (rows === 1)
      return [String(t(`explorer:connections.coverage.${kind}_single`))];
    return [
      rows
        ? String(t(`explorer:connections.coverage.${kind}_all`, options))
        : String(t(`explorer:connections.coverage.${kind}_none`)),
    ];
  });
  const trades = data.trades.data;
  if (trades) {
    const orders = trades.orders;
    const options = { count: orders, shown: formatCount(orders, language) };
    parts.push(
      trades.truncated
        ? String(t('explorer:connections.coverage.trades_newest', options))
        : orders === 1
          ? String(t('explorer:connections.coverage.trades_single'))
          : orders
            ? String(t('explorer:connections.coverage.trades_all', options))
            : String(t('explorer:connections.coverage.trades_none'))
    );
  } else if (data.trades.status === 'error')
    parts.push(String(t('explorer:connections.coverage.trades_failed')));
  const sentences = [
    t('explorer:connections.coverage.read', {
      list: formatList(parts, language),
      ...cap,
    }),
    isShort(data.minting) && data.levelMovesComplete
      ? t('explorer:connections.coverage.level_moves_all', cap)
      : null,
    lists.some(([, state]) => stoppedAtCeiling(state))
      ? t('explorer:connections.coverage.ceiling', {
          max: formatCount(ACCOUNT_TX_MAX, language),
          ...cap,
        })
      : null,
    trades?.truncated
      ? t('explorer:connections.coverage.trades_ceiling', {
          max: formatCount(FILLED_MAX, language),
          ...cap,
        })
      : null,
    trades?.fillsCut
      ? t('explorer:connections.coverage.trades_fills_cut', {
          count: trades.fillsCut,
          shown: formatCount(trades.fillsCut, language),
          max: formatCount(FILLS_MAX, language),
          ...cap,
        })
      : null,
  ];
  return sentences.filter(Boolean).map(String);
}

/**
 * What was checked and found nothing: read in full (`empty`, "Also
 * checked, nothing found"), or only in part (`soFar`, "In what was read so
 * far"); a part still being read, or that couldn't be read, is in neither.
 * `tradesLeftOut`: its Q-Asset trades that aren't listed (with itself, or
 * an order the node doesn't know), so trades are never "none" then.
 */
export function nothingFound(
  data: ConnectionsData,
  funding: Funding | null | undefined,
  address: string
): { empty: EmptyCheck[]; soFar: EmptyCheck[]; tradesLeftOut: number } {
  const empty: EmptyCheck[] = [];
  const soFar: EmptyCheck[] = [];
  const of = (kind: Finding['kind']) =>
    data.recorded.filter((finding) => finding.kind === kind);
  const mintingShort = isShort(data.minting);
  if (data.minting.list && data.links) {
    // A move whose recipient is still being read isn't listed yet: not "none".
    if (!of('levelMove').length && !data.privs.loading)
      (data.levelMovesComplete ? empty : soFar).push('level_moves');
    if (!of('sponsor').length) (mintingShort ? soFar : empty).push('sponsor');
    if (!of('sponsees').length) (mintingShort ? soFar : empty).push('sponsees');
    if (data.mintingWith && !data.mintingWith.length && data.online.data) {
      // Who mints with it now is in the online list itself.
      if (!mintingShort || !pairedOnline(data.online.data, address))
        empty.push('minting_with');
    }
  }
  if (data.names.list && !of('nameDeal').length)
    (isShort(data.names) ? soFar : empty).push('name_sales');
  const tradesLeftOut = data.trades.data
    ? leftOutTrades(data.trades.data.trades, address)
    : 0;
  // Some it had are left out (with itself, or an order the node doesn't know): not "none".
  if (data.trades.data && !of('traded').length && !tradesLeftOut)
    (data.trades.data.truncated || data.trades.data.fillsCut
      ? soFar
      : empty
    ).push('asset_trades');
  if (
    data.flowsSent &&
    data.flowsReceived &&
    !data.flowsSent.length &&
    !data.flowsReceived.length
  )
    (isShort(data.payments) ? soFar : empty).push('payments');
  if (funding === null) empty.push('first_qort');
  return { empty, soFar, tradesLeftOut };
}
