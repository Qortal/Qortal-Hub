/**
 * The Trades tab's top (from Q-Mintership+'s TradesSummary): QORT it sold
 * and bought on the Trade Portal, the trade offers it made and how they
 * ended, and its Q-Asset trades with the QORT they moved; under them when
 * it first and last traded on the Trade Portal, and with how many
 * accounts. Each figure fills in when its read is in, and says so while it
 * waits; one that fails says "–", with what couldn't load and Retry under
 * them. A count that may go on past what was read says "at least".
 */
import { type ReactNode } from 'react';
import { Box, Skeleton, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { useTranslation } from 'react-i18next';
import type { AssetTradesSummary } from '../../../lib/explorer/assetTrades';
import { formatCount, formatDay } from '../../../lib/explorer/format';
import type {
  OfferTotals,
  PortalSummary,
} from '../../../lib/explorer/portalTrades';
import { cap, mutedText, panelSx, ReadError, tileSx } from '../parts';
import { offersLine, qortAmount } from './tradeWords';
import type { TradesData } from './useTrades';

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
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
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

export function TradesSummary({
  data,
  summary,
  offers,
  assetSummary,
}: {
  data: TradesData;
  summary: PortalSummary | null;
  /** Null until the offers and how they ended are known. */
  offers: OfferTotals | null;
  assetSummary: AssetTradesSummary | null;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const { portal, offers: offersPart, assets } = data;
  const count = (key: string, n: number) =>
    String(t(key, { count: n, shown: formatCount(n, language) }));
  const atLeast = (n: number) =>
    String(
      t('explorer:trades.summary.at_least', { shown: formatCount(n, language) })
    );

  // Without a public key, a figure from part of what paid it may go on.
  const partial =
    portal.status === 'ready' &&
    (portal.data.payoutsCut || portal.data.contractsCut);
  const side = (key: 'sold' | 'bought') => {
    if (summary) {
      const qort = qortAmount(summary[key].qort, t, language);
      return {
        value:
          partial && key === 'bought'
            ? String(t('explorer:trades.summary.at_least', { shown: qort }))
            : qort,
        detail: summary[key].count
          ? count('explorer:trades.summary.trades', summary[key].count)
          : String(t('explorer:trades.summary.no_trades')),
      };
    }
    return portal.status === 'failed'
      ? { value: '–' }
      : {
          value: (
            <Reading words={t('explorer:trades.summary.portal_loading', cap)} />
          ),
        };
  };
  const sold = side('sold');
  const bought = side('bought');

  let offersValue: ReactNode;
  let offersDetail: string | undefined;
  if (offersPart.status === 'ready') {
    const made = offersPart.data.offers.length;
    offersValue = offersPart.data.more
      ? atLeast(made)
      : formatCount(made, language);
    offersDetail =
      offersPart.data.outcomes === 'known' && offers
        ? offersLine(offers, t, language)
        : offersPart.data.outcomes === 'reading'
          ? String(t('explorer:trades.summary.outcomes_loading'))
          : undefined;
  } else if (offersPart.status === 'failed') offersValue = '–';
  else
    offersValue = (
      <Reading words={t('explorer:trades.summary.offers_loading', cap)} />
    );

  let assetValue: ReactNode;
  let assetDetail: string | undefined;
  if (assetSummary && assets.data) {
    const cut = assets.data.truncated || assets.data.fillsCut > 0;
    assetValue = cut
      ? atLeast(assetSummary.count)
      : formatCount(assetSummary.count, language);
    const parts = [
      assetSummary.qortPaid > 0n
        ? String(
            t('explorer:trades.summary.paid', {
              qort: qortAmount(assetSummary.qortPaid, t, language),
            })
          )
        : '',
      assetSummary.qortGot > 0n
        ? String(
            t('explorer:trades.summary.got', {
              qort: qortAmount(assetSummary.qortGot, t, language),
            })
          )
        : '',
    ].filter(Boolean);
    assetDetail = parts.length ? parts.join(' · ') : undefined;
  } else if (assets.status === 'error') assetValue = '–';
  else
    assetValue = (
      <Reading words={t('explorer:trades.summary.assets_loading', cap)} />
    );

  const errors: ReactNode[] = [];
  if (portal.status === 'failed')
    errors.push(
      <ReadError
        key="portal"
        message={t('explorer:trades.failed.portal', cap)}
        onRetry={portal.retry}
      />
    );
  else if (portal.status === 'ready' && portal.failedAgain)
    errors.push(
      <ReadError
        key="portal"
        message={t('explorer:trades.failed.portal_again', cap)}
        onRetry={portal.failedAgain}
      />
    );
  if (portal.status === 'ready' && portal.data.coins === 'failed')
    errors.push(
      <ReadError
        key="coins"
        message={t('explorer:trades.failed.coins', cap)}
        onRetry={portal.data.retryCoins ?? (() => undefined)}
      />
    );
  else if (portal.status === 'ready' && portal.data.retryCoins)
    errors.push(
      <ReadError
        key="coins"
        message={t('explorer:trades.failed.coins_again', cap)}
        onRetry={portal.data.retryCoins}
      />
    );
  if (offersPart.status === 'failed')
    errors.push(
      <ReadError
        key="offers"
        message={t('explorer:trades.failed.offers', cap)}
        onRetry={offersPart.retry}
      />
    );
  else if (offersPart.status === 'ready' && offersPart.failedAgain)
    errors.push(
      <ReadError
        key="offers"
        message={t('explorer:trades.failed.offers_again', cap)}
        onRetry={offersPart.failedAgain}
      />
    );
  if (offersPart.status === 'ready' && offersPart.data.outcomes === 'failed')
    errors.push(
      <ReadError
        key="outcomes"
        message={t('explorer:trades.failed.outcomes', cap)}
        onRetry={offersPart.data.retryOutcomes}
      />
    );
  if (assets.status === 'error')
    errors.push(
      <ReadError
        key="assets"
        message={
          assets.data
            ? t('explorer:trades.failed.assets_again', cap)
            : t('explorer:trades.failed.assets', cap)
        }
        onRetry={assets.retry}
      />
    );

  const partners = summary?.partners.length ?? 0;
  return (
    <Box sx={panelSx}>
      <Box
        component="dl"
        aria-label={t('explorer:trades.summary.label', cap)}
        sx={{
          display: 'grid',
          gap: 1,
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(100%, 170px), 1fr))',
          m: 0,
        }}
      >
        <Stat
          label={t('explorer:trades.summary.sold', cap)}
          value={sold.value}
          detail={sold.detail}
        />
        <Stat
          label={t('explorer:trades.summary.bought', cap)}
          value={bought.value}
          detail={bought.detail}
        />
        <Stat
          label={t('explorer:trades.summary.offers', cap)}
          value={offersValue}
          detail={offersDetail}
        />
        <Stat
          label={t('explorer:trades.summary.asset_trades', cap)}
          value={assetValue}
          detail={assetDetail}
        />
      </Box>
      {summary && summary.first !== null && summary.last !== null ? (
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme), mt: 1.5 })}
        >
          {summary.first === summary.last ||
          formatDay(summary.first, language) ===
            formatDay(summary.last, language)
            ? t('explorer:trades.summary.when_day', {
                day: formatDay(summary.first, language),
                ...cap,
              })
            : t('explorer:trades.summary.when_span', {
                first: formatDay(summary.first, language),
                last: formatDay(summary.last, language),
                ...cap,
              })}{' '}
          {partners
            ? t('explorer:trades.summary.partners', {
                count: partners,
                shown: formatCount(partners, language),
                ...cap,
              })
            : null}
        </Typography>
      ) : null}
      {errors.length ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1.5 }}>
          {errors}
        </Box>
      ) : null}
    </Box>
  );
}
