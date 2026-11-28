/**
 * "How it adds up": the summary's "Buyers would pay now", asset by asset
 * (from Q-Mintership+'s SaleDialog). Each holding sold into the open buy
 * orders on the chain, the best price first, until it or the buyers run
 * out, the account's own buy orders left out: what it would fetch, for how
 * much of the holding, and the best offer, beside its worth at its last
 * trade, the most first. Nothing is sold; only the orders are read (the
 * tab's reads). An asset opens its own window from here.
 */
import { useId } from 'react';
import {
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import {
  assetsTotals,
  sortAssets,
  type AssetView,
} from '../../../lib/explorer/assets';
import { BIDS_READ } from '../../../lib/explorer/assetReads';
import { formatCount } from '../../../lib/explorer/format';
import { cap, mutedText } from '../parts';
import { AssetAvatar } from './AssetAvatar';
import { assetAccent } from './assetLook';
import {
  approxQort,
  assetLabel,
  bestOfferText,
  saleDetail,
  saleTotalText,
  saleValue,
  unitsText,
  type SaleState,
} from './assetWords';

function Row({
  view,
  total,
  priceState,
  onOpen,
}: {
  view: AssetView;
  /** Everything buyers would pay together, for the bar. */
  total: bigint;
  /** Where its last trade stands: never "never traded" before it was read. */
  priceState: SaleState;
  onOpen: () => void;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const theme = useTheme();
  const accent = assetAccent(theme, view.assetId);
  const sale = view.sale;
  const fraction =
    sale && total > 0n ? Number((sale.qort * 10_000n) / total) / 10_000 : 0;
  const detail = sale
    ? [
        saleDetail(sale, view.balance, t, language),
        bestOfferText(sale, t, language),
      ].filter(Boolean)
    : [];
  return (
    <Box
      component="li"
      sx={(themed) => ({
        borderTop: `1px solid ${themed.palette.divider}`,
        '&:first-of-type': { borderTop: 0 },
      })}
    >
      <ButtonBase
        onClick={onOpen}
        aria-haspopup="dialog"
        sx={(themed) => ({
          alignItems: 'center',
          borderRadius: '10px',
          columnGap: 1.25,
          display: 'grid',
          gridTemplateColumns: 'auto minmax(0, 1fr) auto',
          px: 0.5,
          py: 1,
          rowGap: 0.25,
          textAlign: 'start',
          width: '100%',
          '&:hover': { backgroundColor: alpha(accent, 0.06) },
          '&.Mui-focusVisible': {
            outline: `2px solid ${themed.palette.primary.main}`,
          },
        })}
      >
        <AssetAvatar asset={{ ...view, owner: view.meta?.owner }} size={36} />
        <Box component="span" sx={{ display: 'block', minWidth: 0 }}>
          <Typography
            component="span"
            sx={{ display: 'block', fontWeight: 700, overflowWrap: 'anywhere' }}
          >
            <bdi dir="auto">{assetLabel(view, t)}</bdi>
          </Typography>
          <Typography
            component="span"
            variant="body2"
            sx={(themed) => ({ color: mutedText(themed), display: 'block' })}
          >
            {[
              t('explorer:assets.holds_amount', {
                amount: unitsText(view.balance, language),
                ...cap,
              }),
              ...detail,
            ].join(' · ')}
          </Typography>
          <Typography
            component="span"
            variant="body2"
            sx={(themed) => ({ color: mutedText(themed), display: 'block' })}
          >
            {view.worth !== undefined || priceState === 'read'
              ? t('explorer:assets.at_last_trade', {
                  value:
                    view.worth !== undefined
                      ? approxQort(view.worth, t, language)
                      : t('explorer:assets.never_traded'),
                  ...cap,
                })
              : priceState === 'failed'
                ? t('explorer:assets.at_last_trade_failed', cap)
                : t('explorer:assets.summary.prices_loading', cap)}
          </Typography>
        </Box>
        <Typography
          component="span"
          sx={(themed) => ({
            color: sale?.sold ? 'text.primary' : mutedText(themed),
            fontVariantNumeric: 'tabular-nums',
            fontWeight: sale?.sold ? 700 : 400,
            textAlign: 'end',
          })}
        >
          {sale ? saleValue(sale, t, language) : '–'}
        </Typography>
        <Box
          component="span"
          aria-hidden
          sx={{
            backgroundColor: alpha(accent, 0.15),
            borderRadius: 999,
            display: fraction > 0 ? 'block' : 'none',
            gridColumn: '2 / 4',
            height: 4,
            overflow: 'hidden',
          }}
        >
          <Box
            component="span"
            sx={{
              backgroundColor: accent,
              display: 'block',
              height: '100%',
              width: `${Math.max(fraction * 100, 1)}%`,
            }}
          />
        </Box>
      </ButtonBase>
    </Box>
  );
}

export function SaleDialog({
  views,
  priceState,
  onClose,
  onOpenAsset,
}: {
  views: readonly AssetView[];
  /** Where each one's last trade stands. */
  priceState: (assetId: number) => SaleState;
  onClose: () => void;
  /** Opens an asset's own window (this one closes). */
  onOpenAsset: (assetId: number) => void;
}) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const language = i18n.language;
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('sm'));
  const titleId = useId();
  const totals = assetsTotals(views);
  const sorted = sortAssets(views, 'sale', language);
  return (
    <Dialog
      open
      onClose={onClose}
      fullScreen={narrow}
      fullWidth
      maxWidth="sm"
      aria-labelledby={titleId}
      slotProps={{
        paper: {
          sx: (themed) => ({
            backgroundColor: themed.palette.background.surface,
            backgroundImage: 'none',
            borderRadius: narrow ? 0 : '16px',
          }),
        },
      }}
    >
      <DialogTitle id={titleId}>
        {t('explorer:assets.how.title', cap)}
      </DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
      >
        <Typography
          variant="body2"
          sx={(themed) => ({ color: mutedText(themed) })}
        >
          {t('explorer:assets.sale_info', {
            n: formatCount(BIDS_READ, language),
            ...cap,
          })}
        </Typography>
        <Box
          sx={(themed) => ({
            alignItems: 'baseline',
            backgroundColor: themed.palette.background.elevated,
            borderRadius: '10px',
            columnGap: 2,
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            p: 1.5,
            rowGap: 0.5,
          })}
        >
          <Typography
            sx={{
              fontSize: '1.3rem',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 800,
            }}
          >
            {saleTotalText(totals.sale, totals.saleAtLeast, t, language)}
          </Typography>
          {totals.priced ? (
            <Typography
              variant="body2"
              sx={(themed) => ({ color: mutedText(themed) })}
            >
              {t('explorer:assets.how.at_last_trades', {
                value: approxQort(totals.worth, t, language),
                ...cap,
              })}
            </Typography>
          ) : null}
        </Box>
        <Box
          component="ul"
          aria-label={t('explorer:assets.how.list_label', cap)}
          sx={{ listStyle: 'none', m: 0, p: 0 }}
        >
          {sorted.map((view) => (
            <Row
              key={view.assetId}
              view={view}
              total={totals.sale}
              priceState={priceState(view.assetId)}
              onOpen={() => onOpenAsset(view.assetId)}
            />
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          {t('core:action.close', cap)}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
