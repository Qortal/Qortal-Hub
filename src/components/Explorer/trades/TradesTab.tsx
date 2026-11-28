/**
 * An account's Trades tab (from Q-Mintership+'s TradesTab), only for a
 * viewer the level 5+ rule lets see it (lib/explorer/access.ts): the tab
 * list leaves it out for everyone else, the account page checks it too,
 * and nothing of it is read for them (useTrades.ts).
 *
 * - Its summary (TradesSummary): QORT sold and bought on the Trade Portal,
 *   the trade offers it made, its Q-Asset trades.
 * - The breakdown (Breakdown, VolumeChart): by coin, over time, the trade
 *   offers, by Q-Asset, highlights.
 * - Under it, its Trade Portal trades and its Q-Asset trades, newest first
 *   (TradeLists).
 *
 * "No trades yet" only when every read reached its end and found none; an
 * account without a public key isn't taken for one that never traded (its
 * purchases are the contracts that paid it). Nothing polls; nothing
 * writes.
 */
import { useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { summariseAssetTrades } from '../../../lib/explorer/assetTrades';
import { formatCount } from '../../../lib/explorer/format';
import {
  summariseOffers,
  summarisePortal,
  volumeByPeriod,
} from '../../../lib/explorer/portalTrades';
import type { AccountInfo } from '../../../lib/explorer/reads';
import { CONTRACTS_MAX, PAYOUTS_MAX } from '../../../lib/explorer/tradeReads';
import { cap, LoadingLine, mutedText, panelSx, Section } from '../parts';
import {
  AssetBreakdown,
  BreakdownCard,
  CoinBreakdown,
  Highlights,
  OffersBreakdown,
} from './Breakdown';
import { AssetTradeList, PortalTradeList } from './TradeLists';
import { TradesSummary } from './TradesSummary';
import { useTrades } from './useTrades';
import { VolumeChart } from './VolumeChart';

export function TradesTab({ account }: { account: AccountInfo }) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const data = useTrades(account);
  const { portal, offers, assets } = data;
  const trades = portal.status === 'ready' ? portal.data.trades : null;

  const summary = useMemo(
    () => (trades ? summarisePortal(trades) : null),
    [trades]
  );
  const volume = useMemo(
    () => (trades ? volumeByPeriod(trades) : null),
    [trades]
  );
  const offerSummary = useMemo(
    () =>
      offers.status === 'ready' && offers.data.outcomes === 'known'
        ? summariseOffers(offers.data.offers)
        : null,
    [offers]
  );
  const assetSummary = useMemo(
    () => (assets.data ? summariseAssetTrades(assets.data.trades) : null),
    [assets.data]
  );

  // "No trades yet" only from reads that all reached their end: never from
  // what was read before, kept on screen while a read again failed.
  const none =
    portal.status === 'ready' &&
    !portal.failedAgain &&
    !portal.data.trades.length &&
    // Not from part of what paid it: one past those read may be a trade.
    !portal.data.payoutsCut &&
    !portal.data.contractsCut &&
    offers.status === 'ready' &&
    !offers.failedAgain &&
    !offers.data.offers.length &&
    !offers.data.more &&
    Boolean(assets.data) &&
    assets.status !== 'error' &&
    !assets.data?.trades.length &&
    !assets.data?.truncated;
  if (none)
    return (
      <Box sx={panelSx}>
        <Typography role="status" sx={{ fontWeight: 700 }}>
          {t('explorer:trades.none_title', cap)}
        </Typography>
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {data.keyed
            ? t('explorer:trades.none_about', cap)
            : t('explorer:trades.none_about_no_key', cap)}
        </Typography>
      </Box>
    );

  const cut = portal.status === 'ready' ? portal.data : null;
  const partial = Boolean(cut && (cut.payoutsCut || cut.contractsCut));
  return (
    <>
      {!data.keyed ? (
        <Typography
          role="note"
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {t('explorer:trades.no_key', cap)}
          {cut?.payoutsCut
            ? ` ${t('explorer:trades.payouts_cut', {
                max: formatCount(PAYOUTS_MAX, language),
                ...cap,
              })}`
            : null}
          {cut?.contractsCut
            ? ` ${t('explorer:trades.contracts_cut', {
                max: formatCount(CONTRACTS_MAX, language),
                ...cap,
              })}`
            : null}
        </Typography>
      ) : null}
      <TradesSummary
        data={data}
        summary={summary}
        offers={offerSummary?.total ?? null}
        assetSummary={assetSummary}
      />
      {summary?.coins.length ||
      offerSummary?.total.made ||
      assetSummary?.count ? (
        <Section
          id="explorer-trades-breakdown"
          title={t('explorer:trades.breakdown.title', cap)}
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1.5,
              minWidth: 0,
            }}
          >
            {summary?.coins.length ? (
              <BreakdownCard
                title={t('explorer:trades.breakdown.by_coin', cap)}
              >
                <CoinBreakdown summary={summary} />
              </BreakdownCard>
            ) : summary?.unlabeled && portal.status === 'ready' ? (
              <BreakdownCard
                title={t('explorer:trades.breakdown.by_coin', cap)}
              >
                {portal.data.coins === 'reading' ? (
                  <LoadingLine
                    label={t('explorer:trades.breakdown.coins_loading', cap)}
                  />
                ) : (
                  <Typography
                    variant="body2"
                    sx={(theme) => ({ color: mutedText(theme) })}
                  >
                    {t('explorer:trades.breakdown.coins_unknown', cap)}
                  </Typography>
                )}
              </BreakdownCard>
            ) : null}
            {volume?.periods.length ? (
              <BreakdownCard
                title={t('explorer:trades.breakdown.over_time', cap)}
              >
                <VolumeChart
                  periods={volume.periods}
                  unit={volume.unit}
                  untimed={volume.untimed}
                />
              </BreakdownCard>
            ) : null}
            {offerSummary?.total.made && offers.status === 'ready' ? (
              <BreakdownCard title={t('explorer:trades.breakdown.offers', cap)}>
                <OffersBreakdown
                  total={offerSummary.total}
                  byCoin={offerSummary.byCoin}
                  more={offers.data.more}
                  read={offers.data.read}
                />
              </BreakdownCard>
            ) : null}
            {assetSummary?.count ? (
              <BreakdownCard
                title={t('explorer:trades.breakdown.by_asset', cap)}
              >
                <AssetBreakdown summary={assetSummary} />
              </BreakdownCard>
            ) : null}
            {summary && (summary.sold.count || summary.bought.count) ? (
              <BreakdownCard
                title={t('explorer:trades.breakdown.highlights', cap)}
              >
                <Highlights summary={summary} />
              </BreakdownCard>
            ) : null}
          </Box>
        </Section>
      ) : null}
      <Section
        id="explorer-trades-portal"
        title={t('explorer:trades.lists.portal_title', cap)}
      >
        {trades ? (
          trades.length ? (
            <PortalTradeList trades={trades} />
          ) : (
            <Box sx={panelSx}>
              <Typography variant="body2">
                {partial
                  ? t('explorer:trades.lists.portal_none_partial', cap)
                  : t('explorer:trades.lists.portal_none', cap)}
              </Typography>
            </Box>
          )
        ) : portal.status === 'failed' ? null : (
          <Box sx={panelSx}>
            <LoadingLine
              label={t('explorer:trades.summary.portal_loading', cap)}
            />
          </Box>
        )}
      </Section>
      <Section
        id="explorer-trades-assets"
        title={t('explorer:trades.lists.asset_title', cap)}
      >
        {assets.data ? (
          <AssetTradeList data={assets.data} selfTrades={assets.selfTrades} />
        ) : assets.status === 'error' ? null : (
          <Box sx={panelSx}>
            <LoadingLine
              label={t('explorer:trades.summary.assets_loading', cap)}
            />
          </Box>
        )}
      </Section>
    </>
  );
}
