/**
 * One asset's own window (from Q-Mintership+'s AssetDialog), from the
 * Assets tab, the Overview's Q-Assets or the breakdown of what buyers would
 * pay: its avatar, number, owner and marks; its description as its owner
 * wrote it; what this account holds of it and its share; how much there
 * is, and that it is indivisible when it is; its last trade with QORT (how
 * many for how much, so a thin one shows) and the holding at that price,
 * beside what buyers would pay for it now; the open orders, buyers' best
 * offers and sellers' cheapest asks; its biggest holders, this account
 * marked and where it stands; and its latest trades with QORT, who bought
 * from whom.
 *
 * The holders, the orders and the trades are read when it opens, under the
 * account's address (its Refresh reads them again; the buy orders are the
 * tab's when it has read them). An account in it opens in the Explorer as
 * a step of the trail, and the window goes with the step it belongs to.
 * Read-only.
 */
import { useId, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import {
  bidLevels,
  perUnitOf,
  quantityShown,
  saleNow,
  shareOf,
  type AssetDeal,
  type AssetView,
  type OrderLevel,
} from '../../../lib/explorer/assets';
import {
  ASKS_READ,
  assetAsksRead,
  assetBidsRead,
  assetDealsRead,
  assetHoldersRead,
} from '../../../lib/explorer/assetReads';
import { formatCount, formatDay } from '../../../lib/explorer/format';
import { fromAtomic, type TxSentenceSpec } from '../../../lib/explorer/txWords';
import { useExplorerRead, useStepState } from '../ExplorerContext';
import { PersonButton } from '../connections/ConnectionRow';
import {
  cap,
  isolate,
  LoadingLine,
  mutedText,
  ReadError,
  tileSx,
} from '../parts';
import { TxSentence } from '../transactions/TxSentence';
import { AssetAvatar } from './AssetAvatar';
import { AssetChips, ShareBar } from './AssetItems';
import { assetAccent } from './assetLook';
import {
  approxQort,
  assetLabel,
  priceEach,
  saleDetail,
  saleValue,
  shareText,
  unitsText,
} from './assetWords';

/** Holders shown at first; the rest of those read on request. */
export const HOLDERS_SHOWN = 10;

function Fact({ label, children }: { label: string; children: ReactNode }) {
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
      <Typography
        component="dd"
        sx={{
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 700,
          m: 0,
          overflowWrap: 'anywhere',
        }}
      >
        {children}
      </Typography>
    </Box>
  );
}

function Heading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Typography
      id={id}
      component="h3"
      sx={{ fontSize: '1rem', fontWeight: 700, mt: 1 }}
    >
      {children}
    </Typography>
  );
}

const Muted = ({ children }: { children: ReactNode }) => (
  <Box
    component="span"
    sx={(theme) => ({ color: mutedText(theme), fontWeight: 400 })}
  >
    {children}
  </Box>
);

/** Where the account stands among the holders read. */
function rankText(
  rank: number | null,
  read: number,
  more: boolean,
  t: TFunction,
  language: string
): string {
  const options = {
    count: read,
    shown: formatCount(read, language),
    rank: rank === null ? '' : formatCount(rank, language),
    ...cap,
  };
  if (rank === null)
    return String(
      more
        ? t('explorer:assets.window.rank_none_biggest', options)
        : t('explorer:assets.window.rank_none', options)
    );
  return String(
    more
      ? t('explorer:assets.window.rank_biggest', options)
      : read === 1
        ? t('explorer:assets.window.rank_only', options)
        : t('explorer:assets.window.rank', options)
  );
}

function Holders({ address, asset }: { address: string; asset: AssetView }) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const holders = useExplorerRead(assetHoldersRead(asset.assetId, address));
  const [all, setAll] = useStepState<boolean>(
    `assetHolders:${asset.assetId}`,
    false
  );
  const headingId = useId();
  let body: ReactNode;
  if (holders.status === 'error' && !holders.data)
    body = (
      <ReadError
        message={t('explorer:assets.window.holders_failed', cap)}
        onRetry={holders.retry}
      />
    );
  else if (!holders.data)
    body = (
      <LoadingLine label={t('explorer:assets.window.holders_loading', cap)} />
    );
  else if (!holders.data.rows.length)
    body = (
      <Typography variant="body2" sx={(theme) => ({ color: mutedText(theme) })}>
        {t('explorer:assets.window.holders_none', cap)}
      </Typography>
    );
  else {
    const { rows, more } = holders.data;
    const index = rows.findIndex((row) => row.address === address);
    const shown = all ? rows : rows.slice(0, HOLDERS_SHOWN);
    const quantity = asset.meta?.quantity;
    body = (
      <>
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {rankText(
            index < 0 ? null : index + 1,
            rows.length,
            more,
            t,
            language
          )}
        </Typography>
        <Box
          component="ol"
          aria-labelledby={headingId}
          sx={{ listStyle: 'none', m: 0, p: 0 }}
        >
          {shown.map((row, i) => {
            const share = quantity ? shareOf(row.balance, quantity) : undefined;
            const self = row.address === address;
            return (
              <Box
                component="li"
                key={row.address}
                sx={(theme) => ({
                  alignItems: 'center',
                  borderTop: i ? `1px solid ${theme.palette.divider}` : 0,
                  columnGap: 1,
                  display: 'flex',
                  flexWrap: 'wrap',
                  py: 0.5,
                  rowGap: 0.25,
                })}
              >
                <Typography
                  component="span"
                  variant="body2"
                  sx={(theme) => ({
                    color: mutedText(theme),
                    fontVariantNumeric: 'tabular-nums',
                    minWidth: 32,
                  })}
                >
                  {t('explorer:assets.window.place', {
                    place: formatCount(i + 1, language),
                  })}
                </Typography>
                <Box sx={{ flex: '1 1 160px', minWidth: 0 }}>
                  <PersonButton address={row.address} near />
                </Box>
                {self ? (
                  <Typography
                    component="span"
                    variant="body2"
                    sx={{ fontWeight: 700 }}
                  >
                    {t('explorer:assets.window.this_account', cap)}
                  </Typography>
                ) : null}
                <Typography
                  component="span"
                  sx={{
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: self ? 700 : 400,
                    ml: 'auto',
                  }}
                >
                  {unitsText(row.balance, language)}
                  {share !== undefined ? (
                    <Muted>
                      {' · '}
                      {shareText(share, t, language)}
                    </Muted>
                  ) : null}
                </Typography>
              </Box>
            );
          })}
        </Box>
        {rows.length > HOLDERS_SHOWN ? (
          <Box>
            <Button size="small" onClick={() => setAll(!all)}>
              {all
                ? t('explorer:assets.window.holders_first', {
                    n: formatCount(HOLDERS_SHOWN, language),
                    ...cap,
                  })
                : // More than were read: only the biggest are, never "all".
                  more
                  ? t('explorer:assets.window.holders_biggest', {
                      n: formatCount(rows.length, language),
                      ...cap,
                    })
                  : t('explorer:assets.window.holders_all', {
                      n: formatCount(rows.length, language),
                      ...cap,
                    })}
            </Button>
          </Box>
        ) : null}
      </>
    );
  }
  return (
    <Box component="section" aria-labelledby={headingId}>
      <Heading id={headingId}>
        {t('explorer:assets.window.holders', cap)}
      </Heading>
      {body}
    </Box>
  );
}

/** One side of the book: "18 QORT each · 4", the best first; or a line when it is empty. */
function Side({
  title,
  levels,
  empty,
}: {
  title: string;
  levels: readonly OrderLevel[];
  empty: string;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const id = useId();
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        id={id}
        variant="body2"
        sx={(theme) => ({ color: mutedText(theme), fontWeight: 600 })}
      >
        {title}
      </Typography>
      {levels.length ? (
        <Box
          component="ul"
          aria-labelledby={id}
          sx={{ listStyle: 'none', m: 0, p: 0 }}
        >
          {levels.map((level) => (
            <Box
              component="li"
              key={String(level.price)}
              sx={{
                display: 'flex',
                fontVariantNumeric: 'tabular-nums',
                gap: 1,
                justifyContent: 'space-between',
                py: 0.25,
              }}
            >
              <Typography component="span" variant="body2">
                {priceEach(level.price, t, language)}
              </Typography>
              <Typography
                component="span"
                variant="body2"
                sx={(theme) => ({ color: mutedText(theme) })}
              >
                {level.atLeast
                  ? t('explorer:assets.window.at_least_units', {
                      units: unitsText(level.units, language),
                    })
                  : unitsText(level.units, language)}
              </Typography>
            </Box>
          ))}
        </Box>
      ) : (
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {empty}
        </Typography>
      )}
    </Box>
  );
}

/** The open orders: what buyers offer (its own orders aside) and what sellers ask, the best five prices a side. */
function Orders({ address, asset }: { address: string; asset: AssetView }) {
  const { t } = useTranslation(['explorer']);
  const bids = useExplorerRead(assetBidsRead(asset.assetId, address));
  const asks = useExplorerRead(assetAsksRead(asset.assetId, address));
  const headingId = useId();
  let body: ReactNode;
  const failed =
    (bids.status === 'error' && !bids.data) ||
    (asks.status === 'error' && !asks.data);
  if (failed)
    body = (
      <ReadError
        message={t('explorer:assets.window.orders_failed', cap)}
        onRetry={() => {
          if (bids.status === 'error') bids.retry();
          if (asks.status === 'error') asks.retry();
        }}
      />
    );
  else if (!bids.data || !asks.data)
    body = (
      <LoadingLine label={t('explorer:assets.window.orders_loading', cap)} />
    );
  else
    body = (
      <>
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {t('explorer:assets.window.orders_note', {
            n: ASKS_READ,
            ...cap,
          })}
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gap: 1.5,
            gridTemplateColumns:
              'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
          }}
        >
          <Side
            title={t('explorer:assets.window.buyers', cap)}
            levels={bidLevels(
              bids.data.orders.filter((order) => order.creator !== address),
              ASKS_READ,
              bids.data.more
            )}
            empty={t('explorer:assets.window.no_buyers', cap)}
          />
          <Side
            title={t('explorer:assets.window.sellers', cap)}
            levels={asks.data}
            empty={t('explorer:assets.window.no_sellers', cap)}
          />
        </Box>
      </>
    );
  return (
    <Box component="section" aria-labelledby={headingId}>
      <Heading id={headingId}>
        {t('explorer:assets.window.orders', cap)}
      </Heading>
      {body}
    </Box>
  );
}

/** What buyers would pay for the holding now: the tab's, or worked out here from the book. */
function SaleFact({ address, asset }: { address: string; asset: AssetView }) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const bids = useExplorerRead(
    asset.sale || asset.balance <= 0n
      ? null
      : assetBidsRead(asset.assetId, address)
  );
  if (asset.balance <= 0n) return null;
  const sale =
    asset.sale ??
    (bids.data
      ? saleNow(asset.balance, bids.data.orders, address, bids.data.more)
      : null);
  return (
    <Fact label={t('explorer:assets.sale', cap)}>
      {sale ? (
        <>
          {saleValue(sale, t, language)}
          {saleDetail(sale, asset.balance, t, language) ? (
            <Muted> {saleDetail(sale, asset.balance, t, language)}</Muted>
          ) : null}
        </>
      ) : bids.status === 'error' ? (
        '–'
      ) : (
        <LoadingLine
          label={t('explorer:assets.sale_loading', cap)}
          width="50%"
        />
      )}
    </Fact>
  );
}

/**
 * Its last trade with QORT: the tab's (its holdings' last trades), else the
 * newest of this window's own read of its trades with QORT (an asset it
 * doesn't hold, or whose last trades the tab couldn't read). "Never traded"
 * only from a read that found none.
 */
function LastTradeFact({
  address,
  asset,
}: {
  address: string;
  asset: AssetView;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const deals = useExplorerRead(
    asset.price ? null : assetDealsRead(asset.assetId, address)
  );
  const newest = deals.data?.[0];
  const price =
    asset.price ??
    (newest
      ? {
          perUnit: perUnitOf(newest.qort, newest.units),
          units: newest.units,
          qort: newest.qort,
          at: newest.at,
        }
      : null);
  return (
    <Fact label={t('explorer:assets.window.last_trade', cap)}>
      {price ? (
        <>
          {priceEach(price.perUnit, t, language)}
          <Muted>
            {' '}
            {t('explorer:assets.window.last_trade_size', {
              units: unitsText(price.units, language),
              asset: isolate(assetLabel(asset, t)),
              qort: unitsText(price.qort, language),
              date: formatDay(price.at, language),
            })}
          </Muted>
        </>
      ) : deals.data ? (
        t('explorer:assets.never_traded', cap)
      ) : deals.status === 'error' ? (
        '–'
      ) : (
        <LoadingLine
          label={t('explorer:assets.window.deals_loading', cap)}
          width="50%"
        />
      )}
    </Fact>
  );
}

/** "Second bought 6 GEMCOIN from Publisher for 120 QORT". */
function dealSentence(deal: AssetDeal, asset: AssetView): TxSentenceSpec {
  return {
    base: 'explorer:assets.say',
    key: 'deal',
    slots: {
      buyer: { kind: 'account', address: deal.buyer },
      seller: { kind: 'account', address: deal.seller },
      units: {
        kind: 'amount',
        amounts: [
          {
            amount: fromAtomic(deal.units),
            asset: { id: asset.assetId, name: asset.name },
          },
        ],
      },
      qort: {
        kind: 'amount',
        amounts: [
          { amount: fromAtomic(deal.qort), asset: { id: 0, name: null } },
        ],
      },
    },
  };
}

function Deals({ address, asset }: { address: string; asset: AssetView }) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const deals = useExplorerRead(assetDealsRead(asset.assetId, address));
  const headingId = useId();
  let body: ReactNode;
  if (deals.status === 'error' && !deals.data)
    body = (
      <ReadError
        message={t('explorer:assets.window.deals_failed', cap)}
        onRetry={deals.retry}
      />
    );
  else if (!deals.data)
    body = (
      <LoadingLine label={t('explorer:assets.window.deals_loading', cap)} />
    );
  else if (!deals.data.length)
    body = (
      <Typography variant="body2" sx={(theme) => ({ color: mutedText(theme) })}>
        {t('explorer:assets.window.deals_none', cap)}
      </Typography>
    );
  else
    body = (
      <Box
        component="ul"
        aria-labelledby={headingId}
        sx={{ listStyle: 'none', m: 0, p: 0 }}
      >
        {deals.data.map((deal, i) => (
          <Box
            component="li"
            key={`${deal.orderId}:${deal.at}:${i}`}
            sx={(theme) => ({
              borderTop: i ? `1px solid ${theme.palette.divider}` : 0,
              py: 0.75,
            })}
          >
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
              <TxSentence sentence={dealSentence(deal, asset)} />
            </Typography>
            <Typography
              variant="body2"
              sx={(theme) => ({ color: mutedText(theme) })}
            >
              {priceEach(perUnitOf(deal.qort, deal.units), t, language)} ·{' '}
              {formatDay(deal.at, language)}
            </Typography>
          </Box>
        ))}
      </Box>
    );
  return (
    <Box component="section" aria-labelledby={headingId}>
      <Heading id={headingId}>{t('explorer:assets.window.deals', cap)}</Heading>
      {body}
    </Box>
  );
}

export function AssetDialog({
  address,
  asset,
  onClose,
}: {
  address: string;
  asset: AssetView;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const language = i18n.language;
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('sm'));
  const titleId = useId();
  const accent = assetAccent(theme, asset.assetId);
  const meta = asset.meta;
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
      <DialogTitle id={titleId} sx={{ overflowWrap: 'anywhere', pb: 1 }}>
        <bdi dir="auto">{assetLabel(asset, t)}</bdi>
      </DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
      >
        <Box
          sx={{ alignItems: 'center', display: 'flex', gap: 2, minWidth: 0 }}
        >
          <AssetAvatar
            asset={{ ...asset, owner: meta?.owner }}
            size={64}
            badge
          />
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0.75,
              minWidth: 0,
            }}
          >
            <Typography sx={(themed) => ({ color: mutedText(themed) })}>
              {t('explorer:assets.window.asset_number', {
                id: asset.assetId,
                ...cap,
              })}
            </Typography>
            <AssetChips meta={meta} owned={asset.owned} />
          </Box>
        </Box>
        {meta?.owner ? (
          <Box>
            <Typography
              variant="body2"
              sx={(themed) => ({ color: mutedText(themed) })}
            >
              {t('explorer:assets.window.owner', cap)}
            </Typography>
            <PersonButton address={meta.owner} near />
          </Box>
        ) : null}
        {meta?.description ? (
          <Typography sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
            <bdi dir="auto">{meta.description}</bdi>
          </Typography>
        ) : null}
        <Box
          component="dl"
          sx={{
            display: 'grid',
            gap: 1,
            gridTemplateColumns:
              'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
            m: 0,
          }}
        >
          <Fact label={t('explorer:assets.window.holds', cap)}>
            {asset.holding === 'reading' ? (
              <LoadingLine label={t('explorer:assets.loading', cap)} />
            ) : asset.holding === 'failed' ? (
              // Its holdings couldn't be read: never "none" from that.
              '–'
            ) : asset.balance > 0n ? (
              unitsText(asset.balance, language)
            ) : (
              t('explorer:assets.window.holds_none', cap)
            )}
          </Fact>
          <Fact label={t('explorer:assets.window.share', cap)}>
            {asset.share !== undefined ? (
              <Box
                component="span"
                sx={{ alignItems: 'center', display: 'flex', gap: 1 }}
              >
                <ShareBar share={asset.share} accent={accent} />
                {shareText(asset.share, t, language)}
              </Box>
            ) : (
              '–'
            )}
          </Fact>
          <Fact label={t('explorer:assets.window.quantity', cap)}>
            {meta && meta.quantity > 0n
              ? unitsText(quantityShown(meta.quantity), language)
              : meta
                ? // Core writes 0 for its genesis assets: not known, never "0".
                  t('explorer:assets.window.quantity_unknown', cap)
                : '–'}
          </Fact>
          {meta && !meta.isDivisible ? (
            <Fact label={t('explorer:assets.chip.indivisible', cap)}>
              {t('explorer:assets.chip.indivisible_info', cap)}
            </Fact>
          ) : null}
          <LastTradeFact address={address} asset={asset} />
          {asset.worth !== undefined ? (
            <Fact label={t('explorer:assets.window.worth_at', cap)}>
              {approxQort(asset.worth, t, language)}
            </Fact>
          ) : null}
          <SaleFact address={address} asset={asset} />
        </Box>
        <Orders address={address} asset={asset} />
        <Holders address={address} asset={asset} />
        <Deals address={address} asset={asset} />
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          {t('core:action.close', cap)}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
