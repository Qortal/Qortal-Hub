/**
 * One held asset, as a card (the grid) or a row (the list), from
 * Q-Mintership+'s AssetItems: its avatar with its owner's on the edge, its
 * name and number and who owns it, how much the account holds and its
 * share of all there is (a bar in the asset's own colour), and two values
 * side by side: the holding at its last trade with QORT, and what buyers
 * would pay for it now. Its name is the button that opens its window; the
 * button stretches over the whole card or row, so anywhere on it opens it,
 * while the rest reads as text. Its marks (its own, indivisible, can't be
 * sent) sit above the button, each with what it means on hover and focus.
 */
import { type ReactNode } from 'react';
import { Box, ButtonBase, Skeleton, Tooltip, Typography } from '@mui/material';
import { alpha, useTheme, type Theme } from '@mui/material/styles';
import { visuallyHidden } from '@mui/utils';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useTranslation } from 'react-i18next';
import { shortAddress } from '../../../lib/explorer/addresses';
import {
  quantityShown,
  type AssetMeta,
  type AssetView,
} from '../../../lib/explorer/assets';
import { formatDay } from '../../../lib/explorer/format';
import { visibleName } from '../../../lib/explorer/rules';
import { cap, isolate, mutedText, panelSx, StatusChip } from '../parts';
import { useAccountName } from '../transactions/TxSentence';
import { AssetAvatar } from './AssetAvatar';
import { assetAccent } from './assetLook';
import {
  approxQort,
  assetLabel,
  detailsLabel,
  priceEach,
  saleDetail,
  saleValue,
  shareText,
  unitsText,
  type SaleState,
} from './assetWords';

/** "by Pia": the owner by its primary name, or its short address. */
export function ByOwner({ owner, near }: { owner: string; near: boolean }) {
  const { t } = useTranslation(['explorer']);
  const name = useAccountName(owner, near);
  return (
    <>
      {t('explorer:assets.by_owner', {
        owner: isolate(name ? visibleName(name) : shortAddress(owner)),
      })}
    </>
  );
}

/** A mark of the asset's own (indivisible, can't be sent): plain, with what it means on hover and focus. */
function PlainChip({
  label,
  explanation,
}: {
  label: string;
  explanation: string;
}) {
  return (
    <Tooltip title={explanation}>
      <Box
        component="span"
        tabIndex={0}
        sx={(theme) => ({
          alignItems: 'center',
          backgroundColor: alpha(theme.palette.text.primary, 0.06),
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: '999px',
          color: 'text.primary',
          display: 'inline-flex',
          fontSize: '0.75rem',
          fontWeight: 600,
          lineHeight: 1.6,
          px: 1,
          whiteSpace: 'nowrap',
          '&:focus-visible': {
            outline: `2px solid ${theme.palette.primary.main}`,
          },
        })}
      >
        {label}
      </Box>
    </Tooltip>
  );
}

/**
 * Its marks: the account's own asset; indivisible, when it can't be split
 * (said only then); can't be sent. Above the stretched button.
 */
export function AssetChips({
  meta,
  owned,
}: {
  meta?: AssetMeta;
  owned: boolean;
}) {
  const { t } = useTranslation(['explorer']);
  const chips: ReactNode[] = [];
  if (owned)
    chips.push(
      <StatusChip
        key="own"
        kind="owner"
        label={t('explorer:assets.chip.own', cap)}
        explanation={t('explorer:assets.chip.own_info', cap)}
      />
    );
  if (meta && !meta.isDivisible)
    chips.push(
      <PlainChip
        key="indivisible"
        label={t('explorer:assets.chip.indivisible', cap)}
        explanation={t('explorer:assets.chip.indivisible_info', cap)}
      />
    );
  if (meta?.isUnspendable)
    chips.push(
      <PlainChip
        key="unspendable"
        label={t('explorer:assets.chip.unspendable', cap)}
        explanation={t('explorer:assets.chip.unspendable_info', cap)}
      />
    );
  if (!chips.length) return null;
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 0.75,
        position: 'relative',
        zIndex: 1,
      }}
    >
      {chips}
    </Box>
  );
}

/** Its share of all there is, as a bar in its colour; the words beside it say it. */
export function ShareBar({ share, accent }: { share: number; accent: string }) {
  const width = share > 0 ? Math.max(share * 100, 2) : 0;
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        backgroundColor: alpha(
          accent,
          theme.palette.mode === 'dark' ? 0.2 : 0.16
        ),
        borderRadius: 999,
        flex: '1 1 auto',
        height: 6,
        minWidth: 40,
        overflow: 'hidden',
      })}
    >
      <Box
        sx={{
          backgroundColor: accent,
          borderRadius: 999,
          height: '100%',
          width: `${Math.min(width, 100)}%`,
        }}
      />
    </Box>
  );
}

/** The name, as the button that opens the asset, stretched over its card or row. */
function OpenButton({
  label,
  onOpen,
  radius,
  children,
}: {
  label: string;
  onOpen: () => void;
  /** The corners of the card or row it covers (px). */
  radius: number;
  children: ReactNode;
}) {
  return (
    <ButtonBase
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={label}
      sx={(theme) => ({
        color: 'inherit',
        font: 'inherit',
        justifyContent: 'flex-start',
        maxWidth: '100%',
        minHeight: 32,
        minWidth: 0,
        position: 'static',
        textAlign: 'start',
        '&::after': {
          borderRadius: `${radius}px`,
          content: '""',
          inset: 0,
          position: 'absolute',
        },
        '&.Mui-focusVisible::after': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
      })}
    >
      {children}
    </ButtonBase>
  );
}

function NameText({ name, lines = 2 }: { name: string; lines?: number }) {
  return (
    <Typography
      component="span"
      sx={{
        display: '-webkit-box',
        fontSize: '1.02rem',
        fontWeight: 700,
        lineHeight: 1.3,
        overflow: 'hidden',
        overflowWrap: 'anywhere',
        WebkitBoxOrient: 'vertical',
        WebkitLineClamp: lines,
      }}
    >
      <bdi dir="auto">{name}</bdi>
    </Typography>
  );
}

/** "#77 · by Pia"; in a row, which shows no marks, "#79 · indivisible · by Sid". */
function IdLine({
  view,
  near,
  indivisible = false,
}: {
  view: AssetView;
  near: boolean;
  indivisible?: boolean;
}) {
  const { t } = useTranslation(['explorer']);
  const owner = view.meta?.owner ?? null;
  return (
    <Typography
      variant="body2"
      sx={(theme) => ({ color: mutedText(theme), overflowWrap: 'anywhere' })}
    >
      {t('explorer:assets.number', { id: view.assetId })}
      {indivisible && view.meta && !view.meta.isDivisible
        ? ` · ${t('explorer:assets.chip.indivisible')}`
        : null}
      {owner ? (
        <>
          {' · '}
          <ByOwner owner={owner} near={near} />
        </>
      ) : null}
    </Typography>
  );
}

function ShareLine({ view, accent }: { view: AssetView; accent: string }) {
  const { t, i18n } = useTranslation(['explorer']);
  if (view.share === undefined || !view.meta) return null;
  return (
    <Box sx={{ alignItems: 'center', display: 'flex', gap: 1, minWidth: 0 }}>
      <ShareBar share={view.share} accent={accent} />
      <Typography
        variant="body2"
        sx={(theme) => ({
          color: mutedText(theme),
          flexShrink: 0,
          fontVariantNumeric: 'tabular-nums',
        })}
      >
        {t('explorer:assets.share_of', {
          share: shareText(view.share, t, i18n.language),
          quantity: unitsText(quantityShown(view.meta.quantity), i18n.language),
        })}
      </Typography>
    </Box>
  );
}

const miniSx = (theme: Theme) => ({
  backgroundColor: theme.palette.background.elevated,
  borderRadius: '10px',
  minWidth: 0,
  px: 1,
  py: 0.75,
});

/** One small value panel: a label, the value, and a line under it. */
function MiniPanel({
  label,
  value,
  detail,
  quiet = false,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  /** The value is words, not an amount (no trade, no buyers). */
  quiet?: boolean;
}) {
  return (
    <Box sx={miniSx}>
      <Typography
        variant="body2"
        component="p"
        sx={(theme) => ({
          color: mutedText(theme),
          fontSize: '0.78rem',
          lineHeight: 1.3,
          m: 0,
        })}
      >
        {label}
      </Typography>
      <Typography
        component="p"
        sx={(theme) => ({
          color: quiet ? mutedText(theme) : 'text.primary',
          fontSize: quiet ? '0.9rem' : '1rem',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: quiet ? 500 : 700,
          m: 0,
          overflowWrap: 'anywhere',
        })}
      >
        {value}
      </Typography>
      {detail ? (
        <Typography
          variant="body2"
          component="p"
          sx={(theme) => ({
            color: mutedText(theme),
            fontSize: '0.78rem',
            lineHeight: 1.3,
            m: 0,
            overflowWrap: 'anywhere',
          })}
        >
          {detail}
        </Typography>
      ) : null}
    </Box>
  );
}

/** What buyers would pay now, as words, or a placeholder while its buy orders are read. */
export function SaleValue({
  view,
  state,
}: {
  view: AssetView;
  state: SaleState;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  if (view.sale) return <>{saleValue(view.sale, t, i18n.language)}</>;
  if (state === 'failed') return <>–</>;
  return (
    <>
      <Skeleton variant="text" width="70%" aria-hidden />
      <Box component="span" sx={visuallyHidden}>
        {t('explorer:assets.sale_loading', cap)}
      </Box>
    </>
  );
}

/**
 * The holding at its last trade with QORT, in words: "never traded for
 * QORT" only once its last trades were read; while they are, a
 * placeholder, and "–" when that read failed.
 */
export function LastTradeValue({
  view,
  state,
}: {
  view: AssetView;
  state: SaleState;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  if (view.worth !== undefined)
    return <>{approxQort(view.worth, t, i18n.language)}</>;
  if (state === 'read') return <>{t('explorer:assets.never_traded', cap)}</>;
  if (state === 'failed') return <>–</>;
  return (
    <>
      <Skeleton variant="text" width="70%" aria-hidden />
      <Box component="span" sx={visuallyHidden}>
        {t('explorer:assets.summary.prices_loading', cap)}
      </Box>
    </>
  );
}

/** The holding at its last trade, and what buyers would pay now: side by side. */
function Values({
  view,
  saleState,
  priceState,
}: {
  view: AssetView;
  saleState: SaleState;
  priceState: SaleState;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 0.75,
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        position: 'relative',
      }}
    >
      <MiniPanel
        label={t('explorer:assets.last_trade', cap)}
        value={<LastTradeValue view={view} state={priceState} />}
        detail={
          view.price
            ? `${priceEach(view.price.perUnit, t, language)} · ${formatDay(view.price.at, language)}`
            : undefined
        }
        quiet={view.worth === undefined}
      />
      <MiniPanel
        label={t('explorer:assets.sale', cap)}
        value={<SaleValue view={view} state={saleState} />}
        detail={
          view.sale
            ? saleDetail(view.sale, view.balance, t, language)
            : undefined
        }
        quiet={
          view.sale?.sold === 0n ||
          (view.sale === undefined && saleState === 'failed')
        }
      />
    </Box>
  );
}

export function AssetCard({
  view,
  onOpen,
  saleState,
  priceState,
  near,
}: {
  view: AssetView;
  onOpen: () => void;
  saleState: SaleState;
  priceState: SaleState;
  near: boolean;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const theme = useTheme();
  const accent = assetAccent(theme, view.assetId);
  return (
    <Box
      sx={(themed) => ({
        ...panelSx(themed),
        backgroundImage: `linear-gradient(180deg, ${alpha(accent, 0.1)} 0, transparent 72px)`,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        height: '100%',
        position: 'relative',
        transition: 'border-color 160ms ease',
        '&:hover': { borderColor: alpha(accent, 0.6) },
      })}
    >
      <Box
        sx={{ alignItems: 'center', display: 'flex', gap: 1.5, minWidth: 0 }}
      >
        <AssetAvatar
          asset={{ ...view, owner: view.meta?.owner }}
          size={52}
          badge
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <OpenButton label={detailsLabel(view, t)} onOpen={onOpen} radius={14}>
            <NameText name={assetLabel(view, t)} />
          </OpenButton>
          <IdLine view={view} near={near} />
        </Box>
      </Box>
      <Box>
        <Typography
          variant="body2"
          sx={(themed) => ({ color: mutedText(themed) })}
        >
          {t('explorer:assets.holds', cap)}
        </Typography>
        <Typography
          sx={{
            fontSize: '1.5rem',
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 800,
            lineHeight: 1.2,
            overflowWrap: 'anywhere',
          }}
        >
          {unitsText(view.balance, i18n.language)}
        </Typography>
      </Box>
      <ShareLine view={view} accent={accent} />
      <Values view={view} saleState={saleState} priceState={priceState} />
      <AssetChips meta={view.meta} owned={view.owned} />
    </Box>
  );
}

export function AssetRow({
  view,
  onOpen,
  saleState,
  priceState,
  near,
}: {
  view: AssetView;
  onOpen: () => void;
  saleState: SaleState;
  priceState: SaleState;
  near: boolean;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const theme = useTheme();
  const accent = assetAccent(theme, view.assetId);
  const cell = { minWidth: 0 };
  return (
    <Box
      sx={(themed) => ({
        alignItems: 'center',
        borderRadius: '10px',
        columnGap: 1.5,
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        position: 'relative',
        px: 0.75,
        py: 1,
        rowGap: 0.5,
        '&:hover': { backgroundColor: alpha(accent, 0.06) },
        // Wide enough: its figures in columns of their own.
        '@container (min-width: 720px)': {
          gridTemplateColumns:
            'auto minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) auto',
        },
        '& [data-cell]': {
          gridColumn: '2 / 3',
          '@container (min-width: 720px)': {
            gridColumn: 'auto',
            gridRow: 'auto',
          },
        },
        color: themed.palette.text.primary,
      })}
    >
      <AssetAvatar asset={{ ...view, owner: view.meta?.owner }} size={40} />
      <Box sx={cell}>
        <OpenButton label={detailsLabel(view, t)} onOpen={onOpen} radius={10}>
          <NameText name={assetLabel(view, t)} lines={1} />
        </OpenButton>
        <IdLine view={view} near={near} indivisible />
      </Box>
      <ChevronRightRoundedIcon
        aria-hidden
        sx={(themed) => ({
          color: mutedText(themed),
          gridColumn: 3,
          gridRow: 1,
          '@container (min-width: 720px)': { gridColumn: 6 },
        })}
      />
      <Box data-cell="" sx={cell}>
        <Typography
          sx={{
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 700,
            overflowWrap: 'anywhere',
          }}
        >
          {unitsText(view.balance, language)}
        </Typography>
        {view.share !== undefined ? (
          <Typography
            variant="body2"
            sx={(themed) => ({ color: mutedText(themed) })}
          >
            {t('explorer:assets.share_of_all', {
              share: shareText(view.share, t, language),
            })}
          </Typography>
        ) : null}
      </Box>
      <Box data-cell="" sx={cell}>
        <Typography
          variant="body2"
          sx={(themed) => ({ color: mutedText(themed), fontSize: '0.78rem' })}
        >
          {t('explorer:assets.last_trade', cap)}
        </Typography>
        {view.worth !== undefined && view.price ? (
          <>
            <Typography
              sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
            >
              {approxQort(view.worth, t, language)}
            </Typography>
            <Typography
              variant="body2"
              sx={(themed) => ({ color: mutedText(themed) })}
            >
              {priceEach(view.price.perUnit, t, language)}
            </Typography>
          </>
        ) : (
          <Typography
            component="div"
            variant="body2"
            sx={(themed) => ({ color: mutedText(themed) })}
          >
            <LastTradeValue view={view} state={priceState} />
          </Typography>
        )}
      </Box>
      <Box data-cell="" sx={cell}>
        <Typography
          variant="body2"
          sx={(themed) => ({ color: mutedText(themed), fontSize: '0.78rem' })}
        >
          {t('explorer:assets.sale', cap)}
        </Typography>
        <Typography
          component="div"
          sx={(themed) => ({
            color: view.sale?.sold ? 'text.primary' : mutedText(themed),
            fontVariantNumeric: 'tabular-nums',
            fontWeight: view.sale?.sold ? 600 : 400,
          })}
        >
          <SaleValue view={view} state={saleState} />
        </Typography>
        {view.sale && view.sale.sold ? (
          <Typography
            variant="body2"
            sx={(themed) => ({ color: mutedText(themed) })}
          >
            {saleDetail(view.sale, view.balance, t, language)}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}
