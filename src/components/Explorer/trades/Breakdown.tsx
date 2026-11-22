/**
 * The Trades tab's breakdown, under its summary (from Q-Mintership+'s
 * Breakdown), a card each:
 *
 * - By coin: where the QORT it sold went and where the QORT it bought came
 *   from, each one bar split by coin with a key (part, QORT, coin), then
 *   each coin's sales and purchases with the average price and when.
 * - Over time: VolumeChart.
 * - Trade offers: the offers it made (each an AT holding the QORT offered),
 *   by coin: completed, ended without a trade, open (and, past the payouts
 *   read, not known), a bar each with a key that names each state; how many
 *   of those no longer open sold; the QORT its open ones hold.
 * - By Q-Asset: each asset, units bought and sold, the QORT for them and
 *   the average price of those traded for QORT.
 * - Highlights: its biggest sale and purchase and the average of each, as
 *   tiles, and the accounts it traded with most, ranked with a bar each.
 *
 * Colour says which coin (coinLook.ts) or which state (the theme's), never
 * alone: every bar has its key in words.
 */
import { useId, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { Box, Typography } from '@mui/material';
import { alpha, useTheme, type Theme } from '@mui/material/styles';
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded';
import HighlightOffRoundedIcon from '@mui/icons-material/HighlightOffRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import { useTranslation } from 'react-i18next';
import {
  qortPerUnit,
  type AssetTradesSummary,
} from '../../../lib/explorer/assetTrades';
import {
  formatCount,
  formatDay,
  formatSpan,
} from '../../../lib/explorer/format';
import {
  averageOf,
  coinPerQort,
  OFFER_OUTCOMES,
  type CoinTotals,
  type OfferOutcome,
  type OfferTotals,
  type Partner,
  type PortalSummary,
  type PortalTrade,
  type SideTotals,
  type CoinKey,
  type TradeChain,
} from '../../../lib/explorer/portalTrades';
import { PAYOUTS_MAX } from '../../../lib/explorer/tradeReads';
import { PersonButton } from '../connections/ConnectionRow';
import { cap, mutedText, panelSx, tileSx } from '../parts';
import { TxSentence } from '../transactions/TxSentence';
import { assetAccent } from '../assets/assetLook';
import { assetLabel } from '../assets/assetWords';
import { coinAccent } from './coinLook';
import {
  coinAmount,
  coinCode,
  coinName,
  offersLine,
  partText,
  perQortText,
  qortAmount,
  significant,
  unitsText,
} from './tradeWords';

/** A card of the breakdown, titled. */
export function BreakdownCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Box
      component="section"
      aria-labelledby={id}
      sx={(theme) => ({
        ...panelSx(theme),
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
      })}
    >
      <Typography
        id={id}
        component="h4"
        sx={{ fontSize: '1rem', fontWeight: 700, m: 0 }}
      >
        {title}
      </Typography>
      {children}
    </Box>
  );
}

/** A coin's colour as a dot, beside its name or ticker. */
export function CoinDot({
  chain,
  size = 10,
}: {
  chain: CoinKey | null;
  size?: number;
}) {
  const theme = useTheme();
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        backgroundColor: coinAccent(theme, chain),
        borderRadius: '50%',
        display: 'inline-block',
        flexShrink: 0,
        height: size,
        width: size,
      }}
    />
  );
}

const KEY_SX = {
  columnGap: 2,
  display: 'flex',
  flexWrap: 'wrap',
  listStyle: 'none',
  m: 0,
  p: 0,
  rowGap: 0.5,
} as const;

/** One side's QORT as a bar split by coin, with its key. */
function SideBar({
  label,
  coins,
  side,
}: {
  label: string;
  coins: readonly CoinTotals[];
  side: 'sold' | 'bought';
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const theme = useTheme();
  const parts = coins.filter((coin) => coin[side].count > 0);
  const whole = parts.reduce((sum, coin) => sum + coin[side].qort, 0n);
  if (!parts.length) return null;
  return (
    <Box>
      <Typography
        variant="body2"
        sx={(themed) => ({ color: mutedText(themed), mb: 0.75 })}
      >
        {label}
      </Typography>
      <Box
        aria-hidden
        sx={{
          borderRadius: 999,
          display: 'flex',
          gap: '2px',
          height: 12,
          overflow: 'hidden',
        }}
      >
        {parts.map((coin) => (
          <Box
            key={coin.chain}
            sx={{
              backgroundColor: coinAccent(theme, coin.chain),
              flex: `${Math.max(whole ? Number(coin[side].qort) / Number(whole) : 1, 0.01)} 1 0`,
            }}
          />
        ))}
      </Box>
      <Box component="ul" aria-label={label} sx={{ ...KEY_SX, mt: 1 }}>
        {parts.map((coin) => (
          <Box
            component="li"
            key={coin.chain}
            sx={{
              alignItems: 'baseline',
              display: 'flex',
              gap: 0.75,
              minWidth: 0,
            }}
          >
            <CoinDot chain={coin.chain} />
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
              {t('explorer:trades.breakdown.coin_part', {
                coin: coinName(coin.chain, t),
                part: partText(coin[side].qort, whole, t, language),
              })}
              <Box
                component="span"
                sx={(themed) => ({ color: mutedText(themed) })}
              >
                {' · '}
                {t('explorer:trades.breakdown.qort_for', {
                  qort: qortAmount(coin[side].qort, t, language),
                  coin: coinAmount(coin[side].coin, coin.chain, t, language),
                })}
              </Box>
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function SideLine({ totals, chain }: { totals: SideTotals; chain: CoinKey }) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  if (!totals.count) return <>{t('explorer:trades.breakdown.none')}</>;
  const price = coinPerQort(totals.coin, totals.qort);
  return (
    <>
      {t('explorer:trades.breakdown.qort_for', {
        qort: qortAmount(totals.qort, t, language),
        coin: coinAmount(totals.coin, chain, t, language),
      })}
      <Box
        component="span"
        sx={(theme) => ({ color: mutedText(theme), display: 'block' })}
      >
        {t('explorer:trades.summary.trades', {
          count: totals.count,
          shown: formatCount(totals.count, language),
        })}
        {price !== null
          ? ` · ${t('explorer:trades.breakdown.average', {
              price: perQortText(price, chain, t, language),
            })}`
          : ''}
      </Box>
    </>
  );
}

const PAIRS_SX = {
  columnGap: 1.5,
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr)',
  m: 0,
  rowGap: 0.75,
  '& dd': {
    fontVariantNumeric: 'tabular-nums',
    m: 0,
    overflowWrap: 'anywhere',
  },
} as const;

export function CoinBreakdown({ summary }: { summary: PortalSummary }) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  return (
    <>
      <SideBar
        label={t('explorer:trades.breakdown.sold_by_coin', cap)}
        coins={summary.coins}
        side="sold"
      />
      <SideBar
        label={t('explorer:trades.breakdown.bought_by_coin', cap)}
        coins={summary.coins}
        side="bought"
      />
      <Box
        sx={{
          display: 'grid',
          gap: 1,
          gridTemplateColumns:
            'repeat(auto-fill, minmax(min(100%, 260px), 1fr))',
        }}
      >
        {summary.coins.map((coin) => (
          <Box key={coin.chain} sx={tileSx}>
            <Typography
              component="h5"
              sx={{
                alignItems: 'center',
                display: 'flex',
                fontSize: '0.95rem',
                fontWeight: 700,
                gap: 0.75,
                m: 0,
              }}
            >
              <CoinDot chain={coin.chain} />
              {coinCode(coin.chain)
                ? t('explorer:trades.breakdown.coin_title', {
                    coin: coinName(coin.chain, t),
                    code: coinCode(coin.chain),
                  })
                : coinName(coin.chain, t)}
            </Typography>
            <Typography
              component="dl"
              variant="body2"
              sx={{ ...PAIRS_SX, mt: 0.75 }}
            >
              <Box component="dt" sx={(theme) => ({ color: mutedText(theme) })}>
                {t('explorer:trades.breakdown.sold', cap)}
              </Box>
              <dd>
                <SideLine totals={coin.sold} chain={coin.chain} />
              </dd>
              <Box component="dt" sx={(theme) => ({ color: mutedText(theme) })}>
                {t('explorer:trades.breakdown.bought', cap)}
              </Box>
              <dd>
                <SideLine totals={coin.bought} chain={coin.chain} />
              </dd>
              <Box component="dt" sx={(theme) => ({ color: mutedText(theme) })}>
                {t('explorer:trades.breakdown.when', cap)}
              </Box>
              <dd>
                {coin.first !== null && coin.last !== null
                  ? formatSpan(coin.first, coin.last, language)
                  : t('explorer:trades.breakdown.when_unknown')}
              </dd>
            </Typography>
          </Box>
        ))}
      </Box>
      {summary.coins.some((coin) => coin.chain === 'OTHER') ? (
        <Typography
          role="note"
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {t('explorer:trades.breakdown.other_coin_note', cap)}
        </Typography>
      ) : null}
    </>
  );
}

const OUTCOME_ICON: Record<OfferOutcome, typeof CheckCircleOutlineRoundedIcon> =
  {
    completed: CheckCircleOutlineRoundedIcon,
    ended: HighlightOffRoundedIcon,
    open: ScheduleRoundedIcon,
    unknown: HelpOutlineRoundedIcon,
  };

function outcomeColour(theme: Theme, outcome: OfferOutcome): string {
  if (outcome === 'completed') return theme.palette.other.positive;
  if (outcome === 'open') return theme.palette.info.main;
  if (outcome === 'unknown') return alpha(theme.palette.text.primary, 0.14);
  return alpha(theme.palette.text.primary, 0.32);
}

function OutcomeBar({ totals }: { totals: OfferTotals }) {
  const theme = useTheme();
  return (
    <Box
      aria-hidden
      sx={{
        borderRadius: 999,
        display: 'flex',
        gap: '2px',
        height: 10,
        overflow: 'hidden',
      }}
    >
      {OFFER_OUTCOMES.filter((outcome) => totals[outcome] > 0).map(
        (outcome) => (
          <Box
            key={outcome}
            sx={{
              backgroundColor: outcomeColour(theme, outcome),
              flex: `${totals[outcome]} 1 0`,
            }}
          />
        )
      )}
    </Box>
  );
}

export function OffersBreakdown({
  total,
  byCoin,
  more,
  read,
}: {
  total: OfferTotals;
  byCoin: Array<OfferTotals & { chain: TradeChain | null }>;
  /** It made more contracts than were read: these are among its newest. */
  more: boolean;
  /** Its contracts read (trade offers and others). */
  read: number;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const theme = useTheme();
  const finished = total.completed + total.ended;
  const shown = OFFER_OUTCOMES.filter(
    (outcome) => outcome !== 'unknown' || total.unknown > 0
  );
  const sentences = [
    more
      ? t('explorer:trades.offers.total_newest', {
          count: total.made,
          shown: formatCount(total.made, language),
          read: formatCount(read, language),
          ...cap,
        })
      : total.made === 1
        ? t('explorer:trades.offers.total_single', cap)
        : t('explorer:trades.offers.total', {
            count: total.made,
            shown: formatCount(total.made, language),
            ...cap,
          }),
    finished
      ? t('explorer:trades.offers.sold_part', {
          part: partText(
            BigInt(total.completed),
            BigInt(finished),
            t,
            language
          ),
          ...cap,
        })
      : null,
    total.open
      ? total.open === 1
        ? t('explorer:trades.offers.open_holds_single', {
            qort: qortAmount(total.openQort, t, language),
            ...cap,
          })
        : t('explorer:trades.offers.open_holds', {
            qort: qortAmount(total.openQort, t, language),
            ...cap,
          })
      : null,
    total.unknown
      ? t('explorer:trades.offers.unknown_note', {
          count: total.unknown,
          shown: formatCount(total.unknown, language),
          max: formatCount(PAYOUTS_MAX, language),
          ...cap,
        })
      : null,
  ].filter(Boolean);
  return (
    <>
      <Typography
        variant="body2"
        sx={(themed) => ({ color: mutedText(themed) })}
      >
        {t('explorer:trades.offers.about', cap)}
      </Typography>
      <Box
        component="ul"
        aria-label={t('explorer:trades.offers.states_label', cap)}
        sx={KEY_SX}
      >
        {shown.map((outcome) => {
          const Icon = OUTCOME_ICON[outcome];
          return (
            <Box
              component="li"
              key={outcome}
              sx={{ alignItems: 'center', display: 'inline-flex', gap: 0.5 }}
            >
              <Icon
                aria-hidden
                sx={{
                  color:
                    outcome === 'unknown'
                      ? mutedText(theme)
                      : outcomeColour(theme, outcome),
                  fontSize: 18,
                }}
              />
              <Typography variant="body2">
                {t(`explorer:trades.offers.state_${outcome}`, cap)}
              </Typography>
            </Box>
          );
        })}
      </Box>
      <Box
        component="ul"
        aria-label={t('explorer:trades.offers.by_coin_label', cap)}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
          listStyle: 'none',
          m: 0,
          p: 0,
        }}
      >
        {byCoin.map((coin) => (
          <Box component="li" key={coin.chain ?? 'other'} sx={{ minWidth: 0 }}>
            <Typography
              variant="body2"
              sx={{
                alignItems: 'baseline',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 0.75,
                mb: 0.5,
              }}
            >
              {coin.chain ? <CoinDot chain={coin.chain} /> : null}
              <strong>
                {coin.chain
                  ? coinName(coin.chain, t)
                  : t('explorer:trades.offers.other_contracts', cap)}
              </strong>
              <Box
                component="span"
                sx={(themed) => ({ color: mutedText(themed) })}
              >
                {t('explorer:trades.offers.coin_line', {
                  count: coin.made,
                  shown: formatCount(coin.made, language),
                  line: offersLine(coin, t, language),
                })}
              </Box>
            </Typography>
            <OutcomeBar totals={coin} />
          </Box>
        ))}
      </Box>
      <Typography variant="body2">{sentences.join(' ')}</Typography>
    </>
  );
}

export function AssetBreakdown({ summary }: { summary: AssetTradesSummary }) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const theme = useTheme();
  /**
   * "8 for 200.00 QORT · 25 QORT each · 2 for other Q-Assets": the units
   * traded for QORT with their QORT and price, and those traded for other
   * Q-Assets apart (they have no price in QORT).
   */
  const side = (units: bigint, qort: bigint, forQort: bigint) => {
    if (units <= 0n) return t('explorer:trades.breakdown.none');
    const price = qortPerUnit(qort, forQort);
    const forAssets = units - forQort;
    return [
      forQort > 0n
        ? t('explorer:trades.breakdown.units_for', {
            units: unitsText(forQort, language),
            qort: qortAmount(qort, t, language),
          })
        : null,
      price !== null
        ? t('explorer:trades.breakdown.each', {
            price: significant(price, language),
          })
        : null,
      forAssets > 0n
        ? t('explorer:trades.breakdown.units_for_assets', {
            units: unitsText(forAssets, language),
          })
        : null,
    ]
      .filter(Boolean)
      .join(' · ');
  };
  return (
    <Box
      component="ul"
      aria-label={t('explorer:trades.breakdown.by_asset', cap)}
      sx={{
        display: 'grid',
        gap: 1,
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))',
        listStyle: 'none',
        m: 0,
        p: 0,
      }}
    >
      {summary.assets.map((asset) => (
        <Box
          component="li"
          key={`${asset.asset.id}:${asset.asset.name}`}
          sx={tileSx}
        >
          <Typography
            component="h5"
            sx={{
              alignItems: 'center',
              display: 'flex',
              fontSize: '0.95rem',
              fontWeight: 700,
              gap: 0.75,
              m: 0,
            }}
          >
            <Box
              component="span"
              aria-hidden
              sx={{
                backgroundColor:
                  asset.asset.id !== null && asset.asset.id > 0
                    ? assetAccent(theme, asset.asset.id)
                    : mutedText(theme),
                borderRadius: '50%',
                flexShrink: 0,
                height: 10,
                width: 10,
              }}
            />
            <bdi dir="auto" style={{ overflowWrap: 'anywhere' }}>
              {assetLabel(
                { assetId: asset.asset.id ?? 0, name: asset.asset.name },
                t
              )}
            </bdi>
          </Typography>
          <Typography
            component="dl"
            variant="body2"
            sx={{ ...PAIRS_SX, mt: 0.75 }}
          >
            <Box component="dt" sx={(themed) => ({ color: mutedText(themed) })}>
              {t('explorer:trades.breakdown.bought', cap)}
            </Box>
            <dd>{side(asset.bought, asset.qortPaid, asset.boughtForQort)}</dd>
            <Box component="dt" sx={(themed) => ({ color: mutedText(themed) })}>
              {t('explorer:trades.breakdown.sold', cap)}
            </Box>
            <dd>{side(asset.sold, asset.qortGot, asset.soldForQort)}</dd>
            <Box component="dt" sx={(themed) => ({ color: mutedText(themed) })}>
              {t('explorer:trades.breakdown.trades', cap)}
            </Box>
            <dd>
              {t('explorer:trades.breakdown.trades_latest', {
                shown: formatCount(asset.count, language),
                date: formatDay(asset.last, language),
              })}
            </dd>
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

const TILE_VALUE_SX = {
  fontSize: '1.15rem',
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 800,
  lineHeight: 1.3,
  m: 0,
  overflowWrap: 'anywhere',
} as const;

function Tile({
  label,
  value,
  lines,
}: {
  label: string;
  value: string;
  lines: ReactNode[];
}) {
  return (
    <Box
      sx={(theme) => ({
        ...tileSx(theme),
        display: 'flex',
        flexDirection: 'column',
        gap: 0.25,
      })}
    >
      <Typography
        component="dt"
        variant="body2"
        sx={(theme) => ({ color: mutedText(theme) })}
      >
        {label}
      </Typography>
      <Typography component="dd" sx={TILE_VALUE_SX}>
        {value}
      </Typography>
      {lines.map((line, i) => (
        <Typography
          key={i}
          component="dd"
          variant="body2"
          sx={(theme) => ({
            color: mutedText(theme),
            m: 0,
            overflowWrap: 'anywhere',
          })}
        >
          {line}
        </Typography>
      ))}
    </Box>
  );
}

/** A trade under its figure: the coin, the other account, the day. */
function tradeLines(
  trade: PortalTrade,
  t: TFunction,
  language: string
): ReactNode[] {
  return [
    String(
      t('explorer:trades.highlights.for_coin', {
        coin: coinAmount(trade.coin, trade.chain, t, language),
      })
    ),
    ...(trade.other
      ? [
          <TxSentence
            key="other"
            sentence={{
              base: 'explorer:trades.say',
              key: trade.side === 'sold' ? 'to' : 'from',
              slots: { other: { kind: 'account', address: trade.other } },
            }}
          />,
        ]
      : []),
    trade.timestamp !== null
      ? formatDay(trade.timestamp, language)
      : String(t('explorer:trades.lists.when_unknown')),
  ];
}

/** How many partners Highlights ranks. */
const TOP_PARTNERS = 5;

/** The accounts it traded with most, ranked: each with its trades and the QORT in them, a bar against the first's trades, and which way they went. */
function PartnerBoard({
  partners,
  total,
}: {
  partners: readonly Partner[];
  total: number;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const theme = useTheme();
  const most = Math.max(
    1,
    ...partners.map((partner) => partner.sold + partner.bought)
  );
  return (
    <Box sx={{ maxWidth: 720 }}>
      <Typography
        component="h5"
        sx={{ fontSize: '0.95rem', fontWeight: 700, m: 0 }}
      >
        {t('explorer:trades.highlights.partners_title', cap)}
      </Typography>
      <Typography
        variant="body2"
        sx={(themed) => ({ color: mutedText(themed) })}
      >
        {total > partners.length
          ? t('explorer:trades.highlights.partners_top', {
              n: formatCount(partners.length, language),
              count: total,
              shown: formatCount(total, language),
              ...cap,
            })
          : total === 1
            ? t('explorer:trades.highlights.partners_single', cap)
            : t('explorer:trades.highlights.partners_all', {
                shown: formatCount(total, language),
                ...cap,
              })}
      </Typography>
      <Box
        component="ol"
        aria-label={t('explorer:trades.highlights.partners_label', cap)}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          listStyle: 'none',
          m: 0,
          mt: 1.25,
          p: 0,
        }}
      >
        {partners.map((partner, i) => {
          const trades = partner.sold + partner.bought;
          return (
            <Box
              component="li"
              key={partner.address}
              sx={{ display: 'flex', gap: 1 }}
            >
              <Typography
                variant="body2"
                sx={(themed) => ({
                  color: mutedText(themed),
                  flexShrink: 0,
                  fontVariantNumeric: 'tabular-nums',
                  pt: 1,
                  textAlign: 'end',
                  width: '1.75em',
                })}
              >
                {t('explorer:trades.highlights.rank', {
                  n: formatCount(i + 1, language),
                })}
              </Typography>
              <Box
                sx={{
                  display: 'flex',
                  flex: 1,
                  flexDirection: 'column',
                  gap: 0.5,
                  minWidth: 0,
                }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    columnGap: 1.5,
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    rowGap: 0.25,
                  }}
                >
                  <PersonButton address={partner.address} near />
                  <Typography
                    variant="body2"
                    sx={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    <strong>
                      {t('explorer:trades.summary.trades', {
                        count: trades,
                        shown: formatCount(trades, language),
                      })}
                    </strong>
                    <Box
                      component="span"
                      sx={(themed) => ({ color: mutedText(themed) })}
                    >
                      {' · '}
                      {qortAmount(partner.qort, t, language)}
                    </Box>
                  </Typography>
                </Box>
                <Box
                  aria-hidden
                  sx={{
                    backgroundColor: alpha(theme.palette.text.primary, 0.08),
                    borderRadius: 999,
                    height: 6,
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    sx={{
                      backgroundColor: 'primary.main',
                      borderRadius: 999,
                      height: '100%',
                      width: `${Math.max((trades / most) * 100, 2)}%`,
                    }}
                  />
                </Box>
                <Typography
                  variant="body2"
                  sx={(themed) => ({
                    color: mutedText(themed),
                    fontSize: '0.78rem',
                  })}
                >
                  {partner.sold && partner.bought
                    ? t('explorer:trades.highlights.both_ways', {
                        sold: formatCount(partner.sold, language),
                        bought: formatCount(partner.bought, language),
                        ...cap,
                      })
                    : partner.sold
                      ? t('explorer:trades.highlights.all_sold', cap)
                      : t('explorer:trades.highlights.all_bought', cap)}
                </Typography>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/** Its biggest sale and purchase and the average of each, as tiles; then the accounts it traded with most. */
export function Highlights({ summary }: { summary: PortalSummary }) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const tiles: Array<{
    key: string;
    label: string;
    value: string;
    lines: ReactNode[];
  }> = [];
  const side = (
    biggest: PortalTrade | null,
    totals: SideTotals,
    kind: 'sale' | 'purchase'
  ) => {
    if (biggest)
      tiles.push({
        key: `biggest_${kind}`,
        label: t(`explorer:trades.highlights.biggest_${kind}`, cap),
        value: qortAmount(biggest.qort, t, language),
        lines: tradeLines(biggest, t, language),
      });
    if (totals.count)
      tiles.push({
        key: `average_${kind}`,
        label: t(`explorer:trades.highlights.average_${kind}`, cap),
        value: qortAmount(averageOf(totals), t, language),
        lines: [
          totals.count === 1
            ? t(`explorer:trades.highlights.over_${kind}_single`)
            : t(`explorer:trades.highlights.over_${kind}s`, {
                count: totals.count,
                shown: formatCount(totals.count, language),
              }),
        ],
      });
  };
  side(summary.biggestSale, summary.sold, 'sale');
  side(summary.biggestBuy, summary.bought, 'purchase');
  const partners = summary.partners.slice(0, TOP_PARTNERS);
  return (
    <>
      <Box
        component="dl"
        sx={{
          display: 'grid',
          gap: 1,
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(100%, 160px), 1fr))',
          m: 0,
        }}
      >
        {tiles.map((tile) => (
          <Tile
            key={tile.key}
            label={tile.label}
            value={tile.value}
            lines={tile.lines}
          />
        ))}
      </Box>
      {partners.length ? (
        <PartnerBoard partners={partners} total={summary.partners.length} />
      ) : null}
    </>
  );
}
