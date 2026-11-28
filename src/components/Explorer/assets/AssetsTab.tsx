/**
 * An account's Assets tab (from Q-Mintership+'s AssetsTab), for everyone:
 * the Q-Assets it holds. On top a summary: how many it holds, what they are
 * worth at their last trades with QORT and what buyers would pay now, how
 * many assets it owns, and how the worth splits. Then each asset it holds
 * as a card or a row (kept on this device), searched by name or number and
 * sorted (worth most first), 24 at a time; then the assets it owns and
 * holds none of. Opening one shows its own window (AssetDialog); "How it
 * adds up" shows what buyers would pay, asset by asset (SaleDialog).
 *
 * Reads (lib/explorer/assetReads.ts): its holdings, Core's asset list,
 * their last trades with QORT, the asset avatars, and each held asset's
 * open buy orders, four at a time; an opened asset's holders, orders and
 * trades. QORT itself is its balance (the Overview), not a Q-Asset. What
 * is picked (the search, the order, how many are shown, the asset open)
 * belongs to the history step, so Back shows the tab as it was left.
 * Nothing polls; nothing writes.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Box,
  Button,
  IconButton,
  InputAdornment,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import ClearRoundedIcon from '@mui/icons-material/ClearRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { useTranslation } from 'react-i18next';
import {
  ASSET_SORTS,
  isAssetSort,
  matchesAsset,
  notHeldView,
  quantityShown,
  sortAssets,
  type AssetMeta,
  type AssetSort,
  type AssetView,
} from '../../../lib/explorer/assets';
import { formatCount } from '../../../lib/explorer/format';
import { useNearScreen, useStepState } from '../ExplorerContext';
import {
  cap,
  isolate,
  LoadingLine,
  mutedText,
  panelSx,
  ReadError,
  Section,
} from '../parts';
import { useListView, ViewToggle } from '../ViewToggle';
import { AssetAvatar } from './AssetAvatar';
import { AssetDialog } from './AssetDialog';
import { AssetCard, AssetChips, AssetRow } from './AssetItems';
import { AssetsSummary } from './AssetsSummary';
import { assetLabel, detailsLabel, unitsText } from './assetWords';
import { SaleDialog } from './SaleDialog';
import { useAssets, type AccountAssets } from './useAssets';

/** Assets shown at first, and added by each "Show the next". */
export const ASSETS_PAGE = 24;

/** The asset whose window is open, as a view: one it holds, else one from Core's list. */
export function openAssetView(
  openId: number | null,
  views: readonly AssetView[] | undefined,
  list: ReadonlyMap<number, AssetMeta> | undefined,
  address: string,
  /** Where its holdings stand while `views` isn't known: never "none" from that. */
  holdings: 'reading' | 'failed'
): AssetView | null {
  if (typeof openId !== 'number' || !Number.isInteger(openId) || openId <= 0)
    return null;
  const held = views?.find((view) => view.assetId === openId);
  if (held) return held;
  const meta = list?.get(openId);
  if (!meta) return null;
  return views
    ? notHeldView(meta, address)
    : notHeldView(meta, address, holdings);
}

/** An asset it owns and holds none of: avatar, name (opens it), all there is and its marks. */
function OwnedRow({ meta, onOpen }: { meta: AssetMeta; onOpen: () => void }) {
  const { t, i18n } = useTranslation(['explorer']);
  const view = notHeldView(meta, meta.owner ?? '');
  return (
    <Box
      component="li"
      sx={(theme) => ({
        alignItems: 'center',
        borderTop: `1px solid ${theme.palette.divider}`,
        columnGap: 1.25,
        display: 'flex',
        flexWrap: 'wrap',
        py: 1,
        rowGap: 0.5,
        '&:first-of-type': { borderTop: 0 },
      })}
    >
      <AssetAvatar asset={meta} size={36} />
      <Button
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-label={detailsLabel(view, t)}
        sx={{ fontWeight: 700, minWidth: 0, px: 1 }}
      >
        <bdi dir="auto">{assetLabel(meta, t)}</bdi>
      </Button>
      <Typography variant="body2" sx={(theme) => ({ color: mutedText(theme) })}>
        {meta.quantity > 0n
          ? t('explorer:assets.owned_line', {
              id: meta.assetId,
              quantity: unitsText(quantityShown(meta.quantity), i18n.language),
            })
          : // Core writes 0 for its genesis assets: how much there is isn't known.
            t('explorer:assets.number', { id: meta.assetId })}
      </Typography>
      <AssetChips meta={meta} owned={false} />
    </Box>
  );
}

/** One held asset in the list, as a card or a row, read once it nears the screen. */
function AssetItem({
  view,
  grid,
  assets,
  onOpen,
}: {
  view: AssetView;
  grid: boolean;
  assets: AccountAssets;
  onOpen: () => void;
}) {
  const [node, setNode] = useState<HTMLLIElement | null>(null);
  const near = useNearScreen(node);
  const Item = grid ? AssetCard : AssetRow;
  return (
    <Box
      component="li"
      ref={setNode}
      tabIndex={-1}
      sx={(theme) => ({
        minWidth: 0,
        ...(grid
          ? {}
          : {
              borderTop: `1px solid ${theme.palette.divider}`,
              '&:first-of-type': { borderTop: 0 },
            }),
        '&:focus-visible': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
      })}
    >
      <Item
        view={view}
        onOpen={onOpen}
        saleState={assets.saleState(view.assetId)}
        priceState={assets.priceState(view.assetId)}
        near={near}
      />
    </Box>
  );
}

function Controls({
  typed,
  onType,
  sort,
  onSort,
  view,
  onView,
}: {
  typed: string;
  onType: (typed: string) => void;
  sort: AssetSort;
  onSort: (sort: AssetSort) => void;
  view: 'grid' | 'list';
  onView: (view: 'grid' | 'list') => void;
}) {
  const { t } = useTranslation(['explorer']);
  return (
    <Box
      sx={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 1.5 }}
    >
      <TextField
        size="small"
        type="search"
        value={typed}
        onChange={(event) => onType(event.target.value)}
        label={t('explorer:assets.search.label', cap)}
        placeholder={t('explorer:assets.search.placeholder', cap)}
        sx={{ flex: '1 1 240px', maxWidth: 420 }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon fontSize="small" aria-hidden />
              </InputAdornment>
            ),
            endAdornment: typed ? (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  edge="end"
                  aria-label={t('explorer:assets.search.clear', cap)}
                  onClick={() => onType('')}
                >
                  <ClearRoundedIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : null,
          },
        }}
      />
      <TextField
        select
        size="small"
        label={t('explorer:assets.sort', cap)}
        value={sort}
        onChange={(event) => {
          if (isAssetSort(event.target.value)) onSort(event.target.value);
        }}
        sx={{ flex: '0 1 240px', minWidth: 180 }}
      >
        {ASSET_SORTS.map((option) => (
          <MenuItem key={option} value={option}>
            {t(`explorer:assets.sort_${option}`, cap)}
          </MenuItem>
        ))}
      </TextField>
      <ViewToggle
        view={view}
        onView={onView}
        label={t('explorer:assets.view_label', cap)}
      />
    </Box>
  );
}

export function AssetsTab({ address }: { address: string }) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const language = i18n.language;
  const assets = useAssets(address);
  const { holdings, list, views, owned } = assets;
  const [typed, setTyped] = useStepState<string>('assetsSearch', '');
  const [storedSort, setSort] = useStepState<AssetSort>('assetsSort', 'worth');
  const sort: AssetSort = isAssetSort(storedSort) ? storedSort : 'worth';
  const [view, setView] = useListView('assets');
  const [storedShown, setShown] = useStepState<number>(
    'assetsShown',
    ASSETS_PAGE
  );
  const shown =
    typeof storedShown === 'number' && storedShown >= ASSETS_PAGE
      ? storedShown
      : ASSETS_PAGE;
  const [openId, setOpenId] = useStepState<number | null>('openAsset', null);
  const [how, setHow] = useStepState<boolean>('assetsHow', false);
  const listRef = useRef<HTMLUListElement>(null);
  const firstNew = useRef<number | null>(null);
  useEffect(() => {
    const index = firstNew.current;
    if (index === null) return;
    firstNew.current = null;
    const row = listRef.current?.children[index];
    if (row instanceof HTMLElement) row.focus();
  }, [shown]);

  const searching = typed.trim() !== '';
  const sorted = useMemo(
    () =>
      views
        ? sortAssets(
            views.filter((each) => matchesAsset(each, typed)),
            sort,
            language
          )
        : [],
    [views, typed, sort, language]
  );
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
      <Box sx={panelSx}>
        <ReadError
          message={t('explorer:assets.failed', cap)}
          onRetry={holdings.retry}
        />
      </Box>
    );
  else if (!views || !holdings.data)
    body = (
      <Box sx={panelSx}>
        <LoadingLine label={t('explorer:assets.loading', cap)} />
      </Box>
    );
  else if (!views.length)
    body = (
      <Box sx={panelSx}>
        {/* None was the answer before: a read again that failed says so beside it. */}
        {holdings.stale && holdings.status === 'error' ? (
          <ReadError
            message={t('explorer:assets.failed_again', cap)}
            onRetry={holdings.retry}
          />
        ) : null}
        <Typography role="status" variant="body2">
          {t('explorer:assets.none', cap)}
        </Typography>
      </Box>
    );
  else {
    const page = sorted.slice(0, shown);
    const left = sorted.length - page.length;
    const ownedCount = owned
      ? owned.length + views.filter((each) => each.owned).length
      : undefined;
    const grid = view === 'grid';
    body = (
      <Box
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}
      >
        {holdings.stale && holdings.status === 'error' ? (
          <ReadError
            message={t('explorer:assets.failed_again', cap)}
            onRetry={holdings.retry}
          />
        ) : null}
        <AssetsSummary
          views={views}
          assets={assets}
          ownedCount={ownedCount}
          onHowItAddsUp={() => setHow(true)}
        />
        <Controls
          typed={typed}
          onType={setTyped}
          sort={sort}
          onSort={setSort}
          view={view}
          onView={setView}
        />
        {searching ? (
          <Typography
            role="status"
            variant="body2"
            sx={(theme) => ({
              color: mutedText(theme),
              overflowWrap: 'anywhere',
            })}
          >
            {sorted.length
              ? t('explorer:assets.search.found', {
                  count: sorted.length,
                  shown: formatCount(sorted.length, language),
                  all: formatCount(views.length, language),
                  typed: isolate(typed.trim()),
                  ...cap,
                })
              : t('explorer:assets.search.none', {
                  typed: isolate(typed.trim()),
                  ...cap,
                })}
          </Typography>
        ) : null}
        {page.length ? (
          <Box sx={{ containerType: 'inline-size', minWidth: 0 }}>
            <Box
              component="ul"
              ref={listRef}
              aria-label={t('explorer:assets.list_label', cap)}
              sx={(theme) => ({
                listStyle: 'none',
                m: 0,
                minWidth: 0,
                p: 0,
                ...(grid
                  ? {
                      display: 'grid',
                      gap: 1.5,
                      gridTemplateColumns:
                        'repeat(auto-fill, minmax(min(100%, 290px), 1fr))',
                    }
                  : panelSx(theme)),
              })}
            >
              {page.map((item) => (
                <AssetItem
                  key={item.assetId}
                  view={item}
                  grid={grid}
                  assets={assets}
                  onOpen={() => setOpenId(item.assetId)}
                />
              ))}
            </Box>
          </Box>
        ) : null}
        {left > 0 ? (
          <Button
            size="small"
            variant="outlined"
            sx={{ alignSelf: 'flex-start' }}
            onClick={() => {
              firstNew.current = shown;
              setShown(shown + ASSETS_PAGE);
            }}
          >
            {t('explorer:assets.show_more', {
              count: Math.min(left, ASSETS_PAGE),
              shown: formatCount(Math.min(left, ASSETS_PAGE), language),
              ...cap,
            })}
          </Button>
        ) : null}
        {holdings.data.more ? (
          <Typography
            role="status"
            variant="body2"
            sx={(theme) => ({ color: mutedText(theme) })}
          >
            {t('explorer:assets.truncated', {
              count: holdings.data.rows.length,
              shown: formatCount(holdings.data.rows.length, language),
              ...cap,
            })}
          </Typography>
        ) : null}
        {list.status === 'error' && !list.data ? (
          <ReadError
            message={t('explorer:assets.list_failed', cap)}
            onRetry={list.retry}
          />
        ) : null}
      </Box>
    );
  }

  const title = views
    ? holdings.data?.more
      ? t('explorer:assets.title_more', {
          n: formatCount(views.length, language),
          ...cap,
        })
      : t('explorer:assets.title_count', {
          n: formatCount(views.length, language),
          ...cap,
        })
    : t('explorer:assets.title', cap);

  return (
    <>
      <Section id="explorer-assets" title={title}>
        {body}
      </Section>
      {owned?.length ? (
        <Section
          id="explorer-assets-owned"
          title={t('explorer:assets.owned_title', {
            n: formatCount(owned.length, language),
            ...cap,
          })}
        >
          <Box
            component="ul"
            aria-label={t('explorer:assets.owned_label', cap)}
            sx={(theme) => ({ ...panelSx(theme), listStyle: 'none', m: 0 })}
          >
            {owned.map((meta) => (
              <OwnedRow
                key={meta.assetId}
                meta={meta}
                onOpen={() => setOpenId(meta.assetId)}
              />
            ))}
          </Box>
        </Section>
      ) : null}
      {how && views ? (
        <SaleDialog
          views={views}
          priceState={assets.priceState}
          onClose={() => setHow(false)}
          onOpenAsset={(assetId) => {
            setHow(false);
            setOpenId(assetId);
          }}
        />
      ) : null}
      {open ? (
        <AssetDialog
          address={address}
          asset={open}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </>
  );
}
