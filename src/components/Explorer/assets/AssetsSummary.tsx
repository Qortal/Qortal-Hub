/**
 * The Assets tab's top (from Q-Mintership+'s AssetsSummary): how many
 * Q-Assets the account holds, what the ones that traded for QORT are worth
 * together at their last trades, right next to it what buyers would pay
 * for them now (with "How it adds up", asset by asset), and how many
 * assets it owns. Then how the worth at last trades splits among them: a
 * bar in each asset's own colour (the biggest four and the rest together)
 * with a key. The prices and the buy orders fill in after the holdings,
 * and each can fail on its own, with Retry; a total is never shown while
 * some of what it adds up failed or is still read.
 */
import { type ReactNode } from 'react';
import { Box, Button, Skeleton, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { visuallyHidden } from '@mui/utils';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  allocation,
  assetsTotals,
  type AssetsTotals,
  type AssetView,
} from '../../../lib/explorer/assets';
import { formatCount, formatList } from '../../../lib/explorer/format';
import { cap, mutedText, panelSx, ReadError, tileSx } from '../parts';
import { assetAccent } from './assetLook';
import { approxQort, assetLabel, saleTotalText, shareText } from './assetWords';
import type { AccountAssets } from './useAssets';

const VALUE_SX = {
  fontSize: '1.25rem',
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 800,
  lineHeight: 1.25,
  m: 0,
  overflowWrap: 'anywhere',
} as const;

function Stat({
  label,
  value,
  detail,
  action,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  /** A button under it ("How it adds up"). */
  action?: ReactNode;
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
      <Typography component="dd" sx={VALUE_SX}>
        {value}
      </Typography>
      {detail ? (
        <Typography
          component="dd"
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme), m: 0 })}
        >
          {detail}
        </Typography>
      ) : null}
      {action ? (
        <Box component="dd" sx={{ m: 0, ml: -1, mt: 0.5 }}>
          {action}
        </Box>
      ) : null}
    </Box>
  );
}

function Reading({ words }: { words: string }) {
  return (
    <>
      <Skeleton variant="text" width="60%" aria-hidden />
      <Box component="span" sx={visuallyHidden}>
        {words}
      </Box>
    </>
  );
}

/** Under the worth: how many of them have a price. */
function pricedLine(
  totals: AssetsTotals,
  t: TFunction,
  language: string
): string {
  if (!totals.held) return '';
  if (!totals.priced)
    return String(
      totals.held === 1
        ? t('explorer:assets.summary.priced_none_single', cap)
        : t('explorer:assets.summary.priced_none', cap)
    );
  if (totals.priced === totals.held)
    return String(
      totals.held === 1
        ? t('explorer:assets.summary.priced_single', cap)
        : t('explorer:assets.summary.priced_each', cap)
    );
  return String(
    t('explorer:assets.summary.priced_some', {
      count: totals.priced,
      shown: formatCount(totals.priced, language),
      held: formatCount(totals.held, language),
      ...cap,
    })
  );
}

/** Under what buyers would pay: who would buy what. */
function salesLine(
  totals: AssetsTotals,
  t: TFunction,
  language: string
): string {
  if (!totals.saleRead) return '';
  if (totals.saleNone === totals.saleRead)
    return String(
      totals.saleRead === 1
        ? t('explorer:assets.summary.sales_none_single', cap)
        : t('explorer:assets.summary.sales_none_all', cap)
    );
  const part = (key: string, count: number) =>
    String(
      t(`explorer:assets.summary.${key}`, {
        count,
        shown: formatCount(count, language),
      })
    );
  const parts = [
    totals.saleAll ? part('sales_all', totals.saleAll) : null,
    totals.salePart ? part('sales_part', totals.salePart) : null,
    totals.saleNone ? part('sales_none', totals.saleNone) : null,
  ].filter((each): each is string => Boolean(each));
  return String(
    t('explorer:assets.summary.sales_line', {
      list: formatList(parts, language),
      ...cap,
    })
  );
}

/** How the worth splits: one bar, a part per asset in its colour, and a key under it. */
function Allocation({ views }: { views: readonly AssetView[] }) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const theme = useTheme();
  const parts = allocation(views, 5, language);
  if (parts.length < 2) return null;
  const colourOf = (assetId: number | null) =>
    assetId === null
      ? alpha(theme.palette.text.primary, 0.3)
      : assetAccent(theme, assetId);
  return (
    <Box sx={{ mt: 1.5 }}>
      <Typography
        variant="body2"
        sx={(themed) => ({ color: mutedText(themed), mb: 0.75 })}
      >
        {t('explorer:assets.summary.split_title', cap)}
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
        {parts.map((part) => (
          <Box
            key={part.assetId ?? 'others'}
            sx={{
              backgroundColor: colourOf(part.assetId),
              flex: `${Math.max(part.fraction, 0.01)} 1 0`,
            }}
          />
        ))}
      </Box>
      <Box
        component="ul"
        aria-label={t('explorer:assets.summary.split_title', cap)}
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1.5,
          listStyle: 'none',
          m: 0,
          mt: 1,
          p: 0,
        }}
      >
        {parts.map((part) => (
          <Box
            component="li"
            key={part.assetId ?? 'others'}
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: 0.75,
              minWidth: 0,
            }}
          >
            <Box
              aria-hidden
              sx={{
                backgroundColor: colourOf(part.assetId),
                borderRadius: '50%',
                flexShrink: 0,
                height: 10,
                width: 10,
              }}
            />
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
              <bdi dir="auto">
                {part.assetId === null
                  ? t('explorer:assets.summary.split_others', {
                      count: part.others ?? 0,
                      shown: formatCount(part.others ?? 0, language),
                    })
                  : assetLabel({ assetId: part.assetId, name: part.name }, t)}
              </bdi>{' '}
              <Box
                component="span"
                sx={(themed) => ({
                  color: mutedText(themed),
                  fontVariantNumeric: 'tabular-nums',
                })}
              >
                {shareText(part.fraction, t, language)}
              </Box>
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export function AssetsSummary({
  views,
  assets,
  ownedCount,
  onHowItAddsUp,
}: {
  views: readonly AssetView[];
  assets: AccountAssets;
  /** Assets it owns, held or not; undefined until Core's asset list is in. */
  ownedCount?: number;
  /** Opens "How it adds up". */
  onHowItAddsUp: () => void;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const totals = assetsTotals(views);
  const { prices, bids } = assets;
  const pricesFailed = prices.status === 'error';
  const pricesWaiting = !prices.data && !pricesFailed && views.length > 0;
  const booksFailed = bids.failed.length > 0;
  // Every holding's orders are read (or kept from before, beside a failure):
  // no total from some of them.
  const booksDone = !bids.loading && totals.saleRead === totals.held;

  let worth: ReactNode;
  let worthDetail: string | undefined;
  if (pricesWaiting)
    worth = (
      <Reading words={t('explorer:assets.summary.prices_loading', cap)} />
    );
  else if (pricesFailed && !prices.data) worth = '–';
  else if (totals.priced) {
    worth = approxQort(totals.worth, t, language);
    worthDetail = pricedLine(totals, t, language);
  } else {
    worth = '–';
    worthDetail = pricedLine(totals, t, language);
  }

  let sale: ReactNode;
  if (booksDone)
    sale =
      totals.saleNone === totals.saleRead
        ? t('explorer:assets.no_buyers', cap)
        : saleTotalText(totals.sale, totals.saleAtLeast, t, language);
  else if (booksFailed) sale = '–';
  else
    sale = <Reading words={t('explorer:assets.summary.sales_loading', cap)} />;

  return (
    <Box sx={panelSx}>
      <Box
        component="dl"
        aria-label={t('explorer:assets.summary.label', cap)}
        sx={{
          display: 'grid',
          gap: 1,
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(100%, 170px), 1fr))',
          m: 0,
        }}
      >
        <Stat
          label={t('explorer:assets.summary.holds', cap)}
          value={t('explorer:assets.summary.holds_count', {
            count: totals.held,
            shown: formatCount(totals.held, language),
          })}
        />
        <Stat
          label={
            totals.held === 1
              ? t('explorer:assets.summary.worth_single', cap)
              : t('explorer:assets.summary.worth', cap)
          }
          value={worth}
          detail={worthDetail}
        />
        <Stat
          label={t('explorer:assets.sale', cap)}
          value={sale}
          detail={booksDone ? salesLine(totals, t, language) : undefined}
          action={
            booksDone ? (
              <Button
                size="small"
                aria-haspopup="dialog"
                onClick={onHowItAddsUp}
              >
                {t('explorer:assets.how.open', cap)}
              </Button>
            ) : undefined
          }
        />
        <Stat
          label={t('explorer:assets.summary.owns', cap)}
          value={
            ownedCount !== undefined ? (
              t('explorer:assets.summary.owns_count', {
                count: ownedCount,
                shown: formatCount(ownedCount, language),
              })
            ) : assets.list.status === 'error' ? (
              // The node's list of assets couldn't be read (said under the list).
              '–'
            ) : (
              <Reading words={t('explorer:assets.summary.owns_loading', cap)} />
            )
          }
        />
      </Box>
      {pricesFailed ? (
        <Box sx={{ mt: 1 }}>
          <ReadError
            message={
              prices.data
                ? t('explorer:assets.summary.prices_failed_again', cap)
                : t('explorer:assets.summary.prices_failed', cap)
            }
            onRetry={prices.retry}
          />
        </Box>
      ) : null}
      {booksFailed ? (
        <Box sx={{ mt: 1 }}>
          <ReadError
            message={t('explorer:assets.summary.sales_failed', {
              count: bids.failed.length,
              shown: formatCount(bids.failed.length, language),
              ...cap,
            })}
            onRetry={bids.retry}
          />
        </Box>
      ) : null}
      <Allocation views={views} />
    </Box>
  );
}
