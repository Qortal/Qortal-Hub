/**
 * The Trades tab's lists, newest first, 10 at a time ("Show more"), from
 * Q-Mintership+'s TradeLists:
 *
 * - The Trade Portal: each completed trade, sold or bought, how much QORT
 *   for how much of which coin, at what price, with whom, when, and its AT
 *   (opening it in the Explorer). All, Sold or Bought, and with more than
 *   one coin, which coin.
 * - Q-Asset trades: each trade of its filled orders in a sentence (as
 *   Connections says them), with when; under them how much of its orders
 *   was read.
 *
 * What is picked and how far it is shown belong to the history step, so
 * Back shows the lists as they were left.
 */
import { useEffect, useRef } from 'react';
import type { TFunction } from 'i18next';
import {
  Box,
  Button,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import CallMadeRoundedIcon from '@mui/icons-material/CallMadeRounded';
import CallReceivedRoundedIcon from '@mui/icons-material/CallReceivedRounded';
import SwapHorizRoundedIcon from '@mui/icons-material/SwapHorizRounded';
import { useTranslation } from 'react-i18next';
import {
  FILLED_MAX,
  FILLS_MAX,
  type AccountTrades,
  type AssetTrade,
} from '../../../lib/explorer/assetTrades';
import { tradeSentence } from '../../../lib/explorer/findings';
import {
  formatCount,
  formatDayTime,
  formatList,
} from '../../../lib/explorer/format';
import {
  COIN_KEYS,
  coinPerQort,
  type CoinKey,
  type PortalTrade,
} from '../../../lib/explorer/portalTrades';
import {
  fromAtomic,
  type TxSentenceSpec,
  type TxSlot,
} from '../../../lib/explorer/txWords';
import { useExplorer, useStepState } from '../ExplorerContext';
import { cap, InlineLink, mutedText, panelSx } from '../parts';
import { flowColor } from '../transactions/txLook';
import { TxSentence } from '../transactions/TxSentence';
import { CoinDot } from './Breakdown';
import {
  coinAmount,
  coinCode,
  coinName,
  perQortText,
  unitsText,
} from './tradeWords';

const PAGE_ROWS = 10;

type SideFilter = 'all' | 'sold' | 'bought';
const SIDES: readonly SideFilter[] = ['all', 'sold', 'bought'];

const LIST_SX = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0.75,
  listStyle: 'none',
  m: 0,
  minWidth: 0,
  p: 0,
} as const;

/** Rows shown, kept with the history step; "Show more" puts the keyboard on the first row it added. */
function usePaged(stepKey: string, dependsOn: string) {
  const [stored, setShown] = useStepState<number>(stepKey, PAGE_ROWS);
  const shown =
    typeof stored === 'number' && stored >= PAGE_ROWS ? stored : PAGE_ROWS;
  const listRef = useRef<HTMLUListElement>(null);
  const firstNew = useRef<number | null>(null);
  useEffect(() => {
    const index = firstNew.current;
    if (index === null) return;
    firstNew.current = null;
    const row = listRef.current?.children[index];
    if (row instanceof HTMLElement) row.focus();
  }, [shown, dependsOn]);
  const showMore = () => {
    firstNew.current = shown;
    setShown(shown + PAGE_ROWS);
  };
  return { shown, showMore, listRef };
}

const amountSlot = (
  atomic: bigint,
  id: number | null,
  name: string | null
): TxSlot => ({
  kind: 'amount',
  amounts: [{ amount: fromAtomic(atomic), asset: { id, name } }],
});

/**
 * "Sold 25 QORT for 0.08 LTC to Second", from the account's side; "… for
 * 0.08 of another coin …"; just "… for 0.08 …" while which coin isn't known.
 */
function portalSentence(
  trade: PortalTrade,
  t: TFunction,
  language: string
): TxSentenceSpec {
  const code = coinCode(trade.chain);
  return {
    base: 'explorer:trades.say',
    key: `${trade.side}${trade.other ? '' : '_unknown'}`,
    slots: {
      qort: amountSlot(trade.qort, 0, null),
      coin: code
        ? amountSlot(trade.coin, null, code)
        : {
            kind: 'text',
            text:
              trade.chain === 'OTHER'
                ? coinAmount(trade.coin, trade.chain, t, language)
                : unitsText(trade.coin, language),
          },
      other: { kind: 'account', address: trade.other || null },
    },
  };
}

/**
 * Which way the QORT went, an arrow in green (in) or red (out) with the
 * word for screen readers; a trade of one asset for another, with no
 * QORT, a neutral mark.
 */
function Direction({ way }: { way: 'in' | 'out' | 'swap' }) {
  const { t } = useTranslation(['explorer']);
  const Icon =
    way === 'in'
      ? CallReceivedRoundedIcon
      : way === 'out'
        ? CallMadeRoundedIcon
        : SwapHorizRoundedIcon;
  return (
    <Box
      component="span"
      sx={{ display: 'inline-flex', flexShrink: 0, pt: 0.25 }}
    >
      <Icon
        aria-hidden
        sx={(theme) => ({
          color: way === 'swap' ? mutedText(theme) : flowColor(theme, way),
          fontSize: 18,
        })}
      />
      <Box component="span" sx={visuallyHidden}>
        {t(
          way === 'in'
            ? 'explorer:tx.incoming'
            : way === 'out'
              ? 'explorer:tx.outgoing'
              : 'explorer:trades.lists.swapped',
          cap
        )}
      </Box>
    </Box>
  );
}

const rowSx = {
  alignItems: 'flex-start',
  borderRadius: '10px',
  display: 'flex',
  gap: 1.25,
  minWidth: 0,
  px: 1,
  py: 0.75,
} as const;

function PortalTradeRow({ trade }: { trade: PortalTrade }) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const { openAccount } = useExplorer();
  const price = coinPerQort(trade.coin, trade.qort);
  return (
    <Box
      component="li"
      tabIndex={-1}
      sx={(theme) => ({
        ...rowSx,
        backgroundColor: theme.palette.background.elevated,
        '&:focus-visible': {
          outline: `2px solid ${theme.palette.primary.main}`,
        },
      })}
    >
      <Direction way={trade.side === 'sold' ? 'out' : 'in'} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          component="div"
          variant="body2"
          sx={{ overflowWrap: 'anywhere' }}
        >
          <TxSentence sentence={portalSentence(trade, t, language)} />
        </Typography>
        <Typography
          component="div"
          variant="body2"
          sx={(theme) => ({
            alignItems: 'center',
            color: mutedText(theme),
            columnGap: 0.75,
            display: 'flex',
            flexWrap: 'wrap',
          })}
        >
          {trade.chain !== null ? (
            <Box
              component="span"
              sx={{ alignItems: 'center', display: 'inline-flex', gap: 0.5 }}
            >
              <CoinDot chain={trade.chain} />
              {coinName(trade.chain, t)}
            </Box>
          ) : null}
          {price !== null ? (
            <span>
              {trade.chain !== null ? '· ' : ''}
              {perQortText(price, trade.chain, t, language)}
            </span>
          ) : null}
          <span>
            ·{' '}
            {trade.timestamp !== null
              ? formatDayTime(trade.timestamp, language)
              : t('explorer:trades.lists.when_unknown')}
          </span>
          {trade.at ? (
            <span>
              ·{' '}
              <InlineLink
                type="button"
                onClick={() => openAccount(trade.at, { fromExplorer: true })}
              >
                {t('explorer:trades.lists.its_at', cap)}
              </InlineLink>
            </span>
          ) : null}
        </Typography>
      </Box>
    </Box>
  );
}

export function PortalTradeList({
  trades,
}: {
  trades: readonly PortalTrade[];
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const coins = COIN_KEYS.filter((chain) =>
    trades.some((trade) => trade.chain === chain)
  );
  const [storedSide, setSide] = useStepState<SideFilter>('tradesSide', 'all');
  const side: SideFilter = SIDES.includes(storedSide) ? storedSide : 'all';
  const [storedCoin, setCoin] = useStepState<CoinKey | 'all'>(
    'tradesCoin',
    'all'
  );
  const coin =
    storedCoin !== 'all' && coins.includes(storedCoin) ? storedCoin : 'all';
  const { shown, showMore, listRef } = usePaged(
    'tradesShown',
    `${side}:${coin}`
  );
  const ofCoin = trades.filter(
    (trade) => coin === 'all' || trade.chain === coin
  );
  const count = (which: SideFilter) =>
    which === 'all'
      ? ofCoin.length
      : ofCoin.filter((trade) => trade.side === which).length;
  const matching = ofCoin.filter(
    (trade) => side === 'all' || trade.side === side
  );
  const visible = matching.slice(0, shown);
  const left = matching.length - visible.length;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <Box
        sx={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 1 }}
      >
        <ToggleButtonGroup
          exclusive
          size="small"
          value={side}
          onChange={(_event, value: SideFilter | null) => {
            if (value) setSide(value);
          }}
          aria-label={t('explorer:trades.lists.which', cap)}
        >
          {SIDES.map((which) => (
            <ToggleButton
              key={which}
              value={which}
              sx={{ px: 1.5, textTransform: 'none' }}
            >
              {t(`explorer:trades.lists.side_${which}`, {
                n: formatCount(count(which), language),
                ...cap,
              })}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        {coins.length > 1 ? (
          <TextField
            select
            size="small"
            label={t('explorer:trades.lists.coin', cap)}
            value={coin}
            onChange={(event) => setCoin(event.target.value as CoinKey | 'all')}
            sx={{ minWidth: 170 }}
          >
            <MenuItem value="all">
              {t('explorer:trades.lists.every_coin', cap)}
            </MenuItem>
            {coins.map((chain) => (
              <MenuItem key={chain} value={chain}>
                <Box
                  component="span"
                  sx={{ alignItems: 'center', display: 'inline-flex', gap: 1 }}
                >
                  <CoinDot chain={chain} />
                  {coinName(chain, t)}
                </Box>
              </MenuItem>
            ))}
          </TextField>
        ) : null}
      </Box>
      {visible.length ? (
        <Box
          component="ul"
          ref={listRef}
          aria-label={t('explorer:trades.lists.portal_label', cap)}
          sx={LIST_SX}
        >
          {visible.map((trade, i) => (
            <PortalTradeRow
              key={`${trade.side}:${trade.at || i}`}
              trade={trade}
            />
          ))}
        </Box>
      ) : (
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {t('explorer:trades.lists.none_of_these', cap)}
        </Typography>
      )}
      {left > 0 ? (
        <Button
          size="small"
          variant="outlined"
          onClick={showMore}
          sx={{ alignSelf: 'flex-start' }}
        >
          {t('explorer:trades.lists.show_more', {
            count: Math.min(left, PAGE_ROWS),
            shown: formatCount(Math.min(left, PAGE_ROWS), language),
            left: formatCount(left, language),
            ...cap,
          })}
        </Button>
      ) : null}
    </Box>
  );
}

/** How much of its orders was read: "Read: all 7 of its filled Q-Asset orders." and the Explorer's limits. */
function assetCoverage(
  data: AccountTrades,
  t: TFunction,
  language: string
): string {
  const orders = data.orders;
  const options = { count: orders, shown: formatCount(orders, language) };
  const read = data.truncated
    ? String(t('explorer:connections.coverage.trades_newest', options))
    : orders === 1
      ? String(t('explorer:connections.coverage.trades_single'))
      : orders
        ? String(t('explorer:connections.coverage.trades_all', options))
        : String(t('explorer:connections.coverage.trades_none'));
  return [
    t('explorer:connections.coverage.read', {
      list: formatList([read], language),
      ...cap,
    }),
    data.truncated
      ? t('explorer:connections.coverage.trades_ceiling', {
          max: formatCount(FILLED_MAX, language),
          ...cap,
        })
      : null,
    data.fillsCut
      ? t('explorer:connections.coverage.trades_fills_cut', {
          count: data.fillsCut,
          shown: formatCount(data.fillsCut, language),
          max: formatCount(FILLS_MAX, language),
          ...cap,
        })
      : null,
  ]
    .filter(Boolean)
    .join(' ');
}

export function AssetTradeList({
  data,
  selfTrades = 0,
}: {
  data: AccountTrades;
  /** Trades between two of its own orders, left out (as Connections leaves them out). */
  selfTrades?: number;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const { shown, showMore, listRef } = usePaged('tradesAssetsShown', '');
  const visible = data.trades.slice(0, shown);
  const left = data.trades.length - visible.length;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      {visible.length ? (
        <Box
          component="ul"
          ref={listRef}
          aria-label={t('explorer:trades.lists.asset_label', cap)}
          sx={LIST_SX}
        >
          {visible.map((trade) => (
            <Box
              component="li"
              key={`${trade.orderId}:${trade.otherOrderId}:${trade.timestamp}`}
              tabIndex={-1}
              sx={(theme) => ({
                ...rowSx,
                backgroundColor: theme.palette.background.elevated,
                '&:focus-visible': {
                  outline: `2px solid ${theme.palette.primary.main}`,
                },
              })}
            >
              <Direction
                way={
                  trade.got.asset.id === 0
                    ? 'in'
                    : trade.gave.asset.id === 0
                      ? 'out'
                      : 'swap'
                }
              />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  component="div"
                  variant="body2"
                  sx={{ overflowWrap: 'anywhere' }}
                >
                  <TxSentence sentence={tradeSentence(trade)} />
                </Typography>
                <Typography
                  variant="body2"
                  sx={(theme) => ({ color: mutedText(theme) })}
                >
                  {formatDayTime(trade.timestamp, language)}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      ) : (
        <Box sx={panelSx}>
          <Typography variant="body2">
            {t('explorer:trades.lists.asset_none', cap)}
          </Typography>
        </Box>
      )}
      {left > 0 ? (
        <Button
          size="small"
          variant="outlined"
          onClick={showMore}
          sx={{ alignSelf: 'flex-start' }}
        >
          {t('explorer:trades.lists.show_more', {
            count: Math.min(left, PAGE_ROWS),
            shown: formatCount(Math.min(left, PAGE_ROWS), language),
            left: formatCount(left, language),
            ...cap,
          })}
        </Button>
      ) : null}
      <Typography variant="body2" sx={(theme) => ({ color: mutedText(theme) })}>
        {assetCoverage(data, t, language)}
        {selfTrades
          ? ` ${t('explorer:trades.lists.self_left_out', {
              count: selfTrades,
              shown: formatCount(selfTrades, language),
              ...cap,
            })}`
          : ''}
      </Typography>
    </Box>
  );
}
