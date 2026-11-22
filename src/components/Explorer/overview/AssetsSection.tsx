/**
 * The Overview's Q-Assets, under At a glance (from Q-Mintership+'s
 * AssetsSection), for everyone: the ones it holds, worth most first, as
 * small tiles (avatar, name, how much, and what it is worth at its last
 * trade with QORT, said so: the Overview reads no order books, so what
 * buyers would pay now is in each asset's window and on the Assets tab),
 * the first QUICK_ASSETS. Each opens its window right here, and "All N in
 * Assets" opens the tab. The same reads as the tab (assets/useAssets.ts),
 * made once the section nears the screen; it loads, fails and retries on
 * its own. Worth most first only once their last trades are read (by name
 * until then, and the list says which); a failed read of those says so,
 * with Retry.
 */
import { useState, type ReactNode } from 'react';
import { Box, Button, ButtonBase, Skeleton, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { visuallyHidden } from '@mui/utils';
import { useTranslation } from 'react-i18next';
import { sortAssets, type AssetView } from '../../../lib/explorer/assets';
import { formatCount } from '../../../lib/explorer/format';
import { useNearScreen, useStepState } from '../ExplorerContext';
import { cap, mutedText, panelSx, ReadError, Section } from '../parts';
import { AssetAvatar } from '../assets/AssetAvatar';
import { AssetDialog } from '../assets/AssetDialog';
import { assetAccent } from '../assets/assetLook';
import { openAssetView } from '../assets/AssetsTab';
import { approxQort, assetLabel, unitsText } from '../assets/assetWords';
import { useAssets } from '../assets/useAssets';

/** Tiles shown on the Overview. */
export const QUICK_ASSETS = 6;

const GRID_SX = {
  display: 'grid',
  gap: 1,
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 210px), 1fr))',
  listStyle: 'none',
  m: 0,
  p: 0,
} as const;

function Tile({ view, onOpen }: { view: AssetView; onOpen: () => void }) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const theme = useTheme();
  const accent = assetAccent(theme, view.assetId);
  return (
    <Box component="li" sx={{ minWidth: 0 }}>
      <ButtonBase
        onClick={onOpen}
        aria-haspopup="dialog"
        sx={(themed) => ({
          alignItems: 'center',
          backgroundColor: themed.palette.background.elevated,
          backgroundImage: `linear-gradient(90deg, ${alpha(accent, 0.12)} 0, transparent 70%)`,
          border: `1px solid ${themed.palette.divider}`,
          borderRadius: '12px',
          boxSizing: 'border-box',
          color: 'text.primary',
          display: 'flex',
          gap: 1.25,
          height: '100%',
          justifyContent: 'flex-start',
          minHeight: 44,
          minWidth: 0,
          p: 1.25,
          textAlign: 'start',
          transition: 'border-color 160ms ease',
          width: '100%',
          '&:hover': { borderColor: alpha(accent, 0.6) },
          '&.Mui-focusVisible': {
            outline: `2px solid ${themed.palette.primary.main}`,
            outlineOffset: 2,
          },
        })}
      >
        <AssetAvatar asset={{ ...view, owner: view.meta?.owner }} size={40} />
        <Box component="span" sx={{ display: 'block', minWidth: 0 }}>
          <Typography
            component="span"
            sx={{
              display: 'block',
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <bdi dir="auto">{assetLabel(view, t)}</bdi>
          </Typography>
          <Typography
            component="span"
            variant="body2"
            sx={{
              display: 'block',
              fontVariantNumeric: 'tabular-nums',
              overflowWrap: 'anywhere',
            }}
          >
            {unitsText(view.balance, language)}
            {view.worth !== undefined ? (
              <Box
                component="span"
                sx={(themed) => ({ color: mutedText(themed) })}
              >
                {' · '}
                {t('explorer:assets.overview.at_last_trade', {
                  value: approxQort(view.worth, t, language),
                })}
              </Box>
            ) : null}
          </Typography>
        </Box>
      </ButtonBase>
    </Box>
  );
}

export function AssetsSection({
  address,
  onShowAssets,
}: {
  address: string;
  /** Open the Assets tab. */
  onShowAssets: () => void;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const [node, setNode] = useState<HTMLElement | null>(null);
  const near = useNearScreen(node);
  const { holdings, list, views, prices } = useAssets(address, {
    enabled: near,
    sales: false,
  });
  const [openId, setOpenId] = useStepState<number | null>('openAsset', null);
  const open = openAssetView(
    openId,
    views,
    list.data?.assets,
    address,
    holdings.status === 'error' ? 'failed' : 'reading'
  );

  let body: ReactNode;
  if (!views && holdings.status === 'error')
    body = (
      <ReadError
        message={t('explorer:assets.failed', cap)}
        onRetry={holdings.retry}
      />
    );
  else if (!views)
    body = (
      <Box sx={GRID_SX}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} variant="rounded" height={64} aria-hidden />
        ))}
        <Box component="span" sx={visuallyHidden}>
          {t('explorer:assets.loading', cap)}
        </Box>
      </Box>
    );
  else if (!views.length)
    body = (
      <>
        {/* None was the answer before: a read again that failed says so beside it. */}
        {holdings.stale && holdings.status === 'error' ? (
          <ReadError
            message={t('explorer:assets.failed_again', cap)}
            onRetry={holdings.retry}
          />
        ) : null}
        <Typography
          role="status"
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {t('explorer:assets.none', cap)}
        </Typography>
      </>
    );
  else
    body = (
      <>
        {holdings.stale && holdings.status === 'error' ? (
          <ReadError
            message={t('explorer:assets.failed_again', cap)}
            onRetry={holdings.retry}
          />
        ) : null}
        {prices.status === 'error' ? (
          <ReadError
            message={
              prices.data
                ? t('explorer:assets.summary.prices_failed_again', cap)
                : t('explorer:assets.summary.prices_failed', cap)
            }
            onRetry={prices.retry}
          />
        ) : null}
        <Box
          component="ul"
          // Worth most first only once their last trades are read; by name until then.
          aria-label={
            prices.data
              ? t('explorer:assets.overview.list_label', cap)
              : t('explorer:assets.overview.list_label_name', cap)
          }
          sx={GRID_SX}
        >
          {sortAssets(views, prices.data ? 'worth' : 'name', language)
            .slice(0, QUICK_ASSETS)
            .map((view) => (
              <Tile
                key={view.assetId}
                view={view}
                onOpen={() => setOpenId(view.assetId)}
              />
            ))}
        </Box>
        <Box sx={{ mt: 1 }}>
          <Button size="small" variant="outlined" onClick={onShowAssets}>
            {views.length > QUICK_ASSETS || holdings.data?.more
              ? t('explorer:assets.overview.all', {
                  count: views.length,
                  // Its holdings went on past those read: "1,000+".
                  shown: `${formatCount(views.length, language)}${holdings.data?.more ? '+' : ''}`,
                  ...cap,
                })
              : t('explorer:assets.overview.open', cap)}
          </Button>
        </Box>
      </>
    );

  return (
    <Box ref={setNode} sx={{ minWidth: 0 }}>
      <Section
        id="explorer-overview-assets"
        title={t('explorer:assets.title', cap)}
      >
        <Box sx={panelSx}>{body}</Box>
      </Section>
      {open ? (
        <AssetDialog
          address={address}
          asset={open}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </Box>
  );
}
