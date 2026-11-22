/**
 * Over time (from Q-Mintership+'s VolumeChart): the QORT it sold (above
 * the line) and bought (below it) on the Trade Portal, one bar per month,
 * quarter or year (lib/explorer/portalTrades.ts `volumeByPeriod`), each
 * stacked by coin in the coin's colour (coinLook.ts), sold and bought on
 * one scale. Plain SVG, stretched to the width, in the theme's colours.
 *
 * - Pointing at a bar, or moving to it with ← → once the chart has the
 *   focus (Home and End go to the ends), shows that period's figures under
 *   the chart, read out as they change; the latest period's show first.
 * - A key names the coins, and "Show as a table" lists every period that
 *   had a trade, with each side's coins: the chart in words. The period
 *   picked and the table belong to the history step.
 * - Another coin (one no chain the Explorer knows claims) is grey; while
 *   which coin each trade was for isn't known, a bar is one grey part. A
 *   trade Core gave no time is in no bar, and a line says how many.
 */
import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  Box,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import BarChartRoundedIcon from '@mui/icons-material/BarChartRounded';
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { formatCount, formatList } from '../../../lib/explorer/format';
import {
  COIN_KEYS,
  type CoinKey,
  type PeriodUnit,
  type VolumePeriod,
} from '../../../lib/explorer/portalTrades';
import { useStepState } from '../ExplorerContext';
import { cap, mutedText } from '../parts';
import { CoinDot } from './Breakdown';
import { coinAccent } from './coinLook';
import { coinCode, coinName, periodLabel, qortAmount } from './tradeWords';

/** A coin as the chart's words name it, inside a sentence: its ticker, or "another coin". */
const coinShort = (chain: CoinKey, t: TFunction) =>
  coinCode(chain) ?? String(t(`explorer:trades.coin.${chain}`));

/** One side's coins, in COIN_KEYS order, with the QORT of each. */
function sideCoins(byCoin: VolumePeriod['sold']): CoinKey[] {
  return COIN_KEYS.filter((chain) => byCoin[chain]);
}

/** "LTC 400.00 QORT, DOGE 40.00 QORT": one side's coins in words. */
function coinParts(
  byCoin: VolumePeriod['sold'],
  t: TFunction,
  language: string
): string {
  return formatList(
    sideCoins(byCoin).map((chain) =>
      String(
        t('explorer:trades.chart.coin_part', {
          code: coinShort(chain, t),
          qort: qortAmount(byCoin[chain] ?? 0n, t, language),
        })
      )
    ),
    language
  );
}

/** The bars' height, sold and bought together (px). */
const PLOT = 168;
/** One period's width, in the drawing's own units. */
const BAR = 10;
/** A bar part never thinner than this, so a small trade still shows (in the drawing's units). */
const MIN_PART = 2;

/** One side of a period, by coin, in words. */
function sideWords(
  byCoin: VolumePeriod['sold'],
  qort: bigint,
  count: number,
  t: TFunction,
  language: string
): string {
  if (!count) return String(t('explorer:trades.chart.side_none'));
  const coins = sideCoins(byCoin);
  const options = {
    count,
    shown: formatCount(count, language),
    qort: qortAmount(qort, t, language),
  };
  if (coins.length === 1)
    return String(
      t('explorer:trades.chart.side_coin', {
        ...options,
        code: coinShort(coins[0], t),
      })
    );
  if (coins.length > 1)
    return String(
      t('explorer:trades.chart.side_coins', {
        ...options,
        coins: coinParts(byCoin, t, language),
      })
    );
  return String(t('explorer:trades.chart.side', options));
}

export function periodWords(
  period: VolumePeriod,
  unit: PeriodUnit,
  t: TFunction,
  language: string
): string {
  return String(
    t('explorer:trades.chart.period_line', {
      period: periodLabel(period.start, unit, t, language),
      sold: sideWords(
        period.sold,
        period.soldQort,
        period.soldCount,
        t,
        language
      ),
      bought: sideWords(
        period.bought,
        period.boughtQort,
        period.boughtCount,
        t,
        language
      ),
      ...cap,
    })
  );
}

export function VolumeChart({
  periods,
  unit,
  untimed = 0,
}: {
  periods: VolumePeriod[];
  unit: PeriodUnit;
  /** Trades Core gave no time: in no bar. */
  untimed?: number;
}) {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const id = useId();
  const [table, setTable] = useStepState<boolean>('tradesChartTable', false);
  const [picked, setPicked] = useStepState<number | null>(
    'tradesChartPick',
    null
  );
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  if (!periods.length) return null;
  const last = periods.length - 1;
  const at = picked === null ? last : Math.min(Math.max(picked, 0), last);
  const coins = COIN_KEYS.filter((chain) =>
    periods.some((period) => period.sold[chain] || period.bought[chain])
  );
  const maxSold = periods.reduce(
    (max, p) => (p.soldQort > max ? p.soldQort : max),
    0n
  );
  const maxBought = periods.reduce(
    (max, p) => (p.boughtQort > max ? p.boughtQort : max),
    0n
  );
  // One scale for both sides: the tallest sale and the tallest purchase share the plot.
  const total = Number(maxSold) + Number(maxBought);
  const scale = total ? PLOT / total : 0;
  const top = Math.round(Number(maxSold) * scale);
  const current = periods[at];
  const gap = periods.length > 60 ? 1 : 2;

  const indexAt = (clientX: number): number | null => {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    if (!rect.width) return null;
    const i = Math.floor(((clientX - rect.left) / rect.width) * periods.length);
    return Math.max(0, Math.min(last, i));
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === 'ArrowRight'
        ? at + 1
        : event.key === 'ArrowLeft'
          ? at - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setPicked(Math.min(Math.max(next, 0), last));
  };

  /**
   * One side's stack: its coins in COIN_KEYS order from the line outward,
   * then what of it isn't known by coin yet, grey.
   */
  const stack = (period: VolumePeriod, i: number, up: boolean) => {
    const byCoin = up ? period.sold : period.bought;
    const whole = up ? period.soldQort : period.boughtQort;
    const known = COIN_KEYS.reduce(
      (sum, chain) => sum + (byCoin[chain] ?? 0n),
      0n
    );
    const parts: Array<[CoinKey | null, bigint]> = [
      ...COIN_KEYS.flatMap(
        (chain): Array<[CoinKey, bigint]> =>
          byCoin[chain] ? [[chain, byCoin[chain] as bigint]] : []
      ),
      ...(whole > known ? [[null, whole - known] as [null, bigint]] : []),
    ];
    let offset = 0;
    return parts.map(([chain, value]) => {
      const h = Math.max(MIN_PART, Number(value) * scale);
      const y = up ? top - offset - h : top + 1 + offset;
      offset += h;
      return (
        <rect
          key={`${up ? 's' : 'b'}${chain ?? 'unknown'}`}
          data-coin={chain ?? 'unknown'}
          x={i * BAR + gap / 2}
          y={y}
          width={BAR - gap}
          height={h}
          fill={coinAccent(theme, chain)}
        />
      );
    });
  };

  const traded = periods.filter(
    (period) => period.soldCount || period.boughtCount
  );
  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, minWidth: 0 }}
    >
      <Box
        sx={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 1 }}
      >
        <Box
          component="ul"
          aria-label={t('explorer:trades.chart.coins', cap)}
          sx={{
            display: 'flex',
            flex: 1,
            flexWrap: 'wrap',
            gap: 1.5,
            listStyle: 'none',
            m: 0,
            p: 0,
          }}
        >
          {coins.map((chain) => (
            <Box
              component="li"
              key={chain}
              sx={{ alignItems: 'center', display: 'inline-flex', gap: 0.75 }}
            >
              <CoinDot chain={chain} />
              <Typography variant="body2">{coinName(chain, t)}</Typography>
            </Box>
          ))}
        </Box>
        <Button
          size="small"
          startIcon={
            table ? <BarChartRoundedIcon /> : <TableChartRoundedIcon />
          }
          onClick={() => setTable(!table)}
        >
          {table
            ? t('explorer:trades.chart.as_chart', cap)
            : t('explorer:trades.chart.as_table', cap)}
        </Button>
      </Box>
      {table ? (
        // Focusable, so a keyboard can scroll it sideways in a narrow window.
        <TableContainer
          tabIndex={0}
          role="region"
          aria-label={t(`explorer:trades.chart.table_label_${unit}`, cap)}
          sx={(themed) => ({
            borderRadius: '10px',
            overflowX: 'auto',
            '&:focus-visible': {
              outline: `2px solid ${themed.palette.primary.main}`,
              outlineOffset: 2,
            },
          })}
        >
          <Table
            size="small"
            aria-label={t(`explorer:trades.chart.table_label_${unit}`, cap)}
          >
            <TableHead>
              <TableRow>
                <TableCell>
                  {t(`explorer:trades.chart.table_period_${unit}`, cap)}
                </TableCell>
                <TableCell align="right">
                  {t('explorer:trades.chart.table_sold', cap)}
                </TableCell>
                <TableCell align="right">
                  {t('explorer:trades.chart.table_sales', cap)}
                </TableCell>
                <TableCell align="right">
                  {t('explorer:trades.chart.table_bought', cap)}
                </TableCell>
                <TableCell align="right">
                  {t('explorer:trades.chart.table_purchases', cap)}
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {[...traded].reverse().map((period) => (
                <TableRow key={period.start}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {periodLabel(period.start, unit, t, language)}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {period.soldCount
                      ? qortAmount(period.soldQort, t, language)
                      : '–'}
                    {sideCoins(period.sold).length ? (
                      <Box
                        component="span"
                        sx={(themed) => ({
                          color: mutedText(themed),
                          display: 'block',
                          fontSize: '0.78rem',
                        })}
                      >
                        {coinParts(period.sold, t, language)}
                      </Box>
                    ) : null}
                  </TableCell>
                  <TableCell align="right">
                    {formatCount(period.soldCount, language)}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {period.boughtCount
                      ? qortAmount(period.boughtQort, t, language)
                      : '–'}
                    {sideCoins(period.bought).length ? (
                      <Box
                        component="span"
                        sx={(themed) => ({
                          color: mutedText(themed),
                          display: 'block',
                          fontSize: '0.78rem',
                        })}
                      >
                        {coinParts(period.bought, t, language)}
                      </Box>
                    ) : null}
                  </TableCell>
                  <TableCell align="right">
                    {formatCount(period.boughtCount, language)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <>
          {maxSold > 0n ? (
            <Typography
              variant="body2"
              sx={(themed) => ({
                color: mutedText(themed),
                fontSize: '0.78rem',
              })}
            >
              {t(`explorer:trades.chart.max_sold_${unit}`, {
                qort: qortAmount(maxSold, t, language),
                ...cap,
              })}
            </Typography>
          ) : null}
          <Box
            ref={setNode}
            role="group"
            tabIndex={0}
            aria-label={t(`explorer:trades.chart.label_${unit}`, cap)}
            aria-describedby={`${id}-now`}
            data-volume-chart=""
            onKeyDown={onKey}
            onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
              const i = indexAt(event.clientX);
              if (i !== null) setPicked(i);
            }}
            onClick={(event) => {
              const i = indexAt(event.clientX);
              if (i !== null) setPicked(i);
            }}
            sx={(themed) => ({
              borderRadius: '8px',
              cursor: 'default',
              height: PLOT + 1,
              outline: 'none',
              '&:focus-visible': {
                outline: `2px solid ${themed.palette.primary.main}`,
                outlineOffset: 2,
              },
            })}
          >
            <svg
              aria-hidden
              focusable="false"
              width="100%"
              height="100%"
              viewBox={`0 0 ${periods.length * BAR} ${PLOT + 1}`}
              preserveAspectRatio="none"
              style={{ display: 'block' }}
            >
              <rect
                x={at * BAR}
                y={0}
                width={BAR}
                height={PLOT + 1}
                fill={alpha(theme.palette.primary.main, 0.14)}
                data-picked=""
              />
              {periods.map((period, i) => (
                <g key={period.start} data-period={i}>
                  {stack(period, i, true)}
                  {stack(period, i, false)}
                </g>
              ))}
              <line
                x1={0}
                x2={periods.length * BAR}
                y1={top + 0.5}
                y2={top + 0.5}
                stroke={theme.palette.divider}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </Box>
          {maxBought > 0n ? (
            <Typography
              variant="body2"
              sx={(themed) => ({
                color: mutedText(themed),
                fontSize: '0.78rem',
              })}
            >
              {t(`explorer:trades.chart.max_bought_${unit}`, {
                qort: qortAmount(maxBought, t, language),
                ...cap,
              })}
            </Typography>
          ) : null}
          <Box
            aria-hidden
            sx={(themed) => ({
              color: mutedText(themed),
              display: 'flex',
              fontSize: '0.75rem',
              gap: 1,
              justifyContent: 'space-between',
            })}
          >
            <span>{periodLabel(periods[0].start, unit, t, language)}</span>
            {periods.length > 1 ? (
              <span>{periodLabel(periods[last].start, unit, t, language)}</span>
            ) : null}
          </Box>
          <Typography
            id={`${id}-now`}
            variant="body2"
            aria-live="polite"
            sx={{ minHeight: '3em', overflowWrap: 'anywhere' }}
          >
            {periodWords(current, unit, t, language)}
          </Typography>
        </>
      )}
      {untimed ? (
        <Typography
          role="note"
          variant="body2"
          sx={(themed) => ({ color: mutedText(themed) })}
        >
          {t('explorer:trades.chart.untimed', {
            count: untimed,
            shown: formatCount(untimed, language),
            ...cap,
          })}
        </Typography>
      ) : null}
    </Box>
  );
}
