/**
 * An account's Names tab: every name it owns, 20 at a time, in the order
 * picked (its primary name first by default), as a grid of cards or a list
 * (kept on this device). Each name shows its picture, its record (when it
 * was registered and last updated, whether it is for sale and at what
 * price, read once the name nears the screen), notes on how it is written,
 * its own history beside it (what this account did with it), and "Its
 * whole history", which opens every change to the name by every account
 * that had it, as a step of its own. Below, the names it had: sold, or
 * renamed to something else, each with who has it now.
 *
 * Reads: its names and its primary name (shared with the header: up to
 * 500 names, 100 a page, and it says when it stopped there), and its name
 * transactions (the Transactions tab's Names kind, one list in the
 * window's cache: 100 at a time, up to 1,000), which every name's history
 * comes from. When those stop short, it says so once, over the names, with
 * how many show none for that reason, and reads older ones on request.
 * What is picked (the order, how many are shown, a history shown in full)
 * belongs to the history step, so Back shows the tab as it was left.
 * Read-only.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { Box, Button, MenuItem, TextField, Typography } from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { ACCOUNT_TX_MAX, atCeiling } from '../../../lib/explorer/accountTx';
import { formatCount } from '../../../lib/explorer/format';
import {
  historyByName,
  isNameSort,
  NAME_SORTS,
  NAME_TX_TYPES,
  pastNameNow,
  pastNames,
  sortNames,
  unchangedSince,
  type NameSort,
} from '../../../lib/explorer/names';
import {
  nameDataRead,
  type NamesOf,
  type TxRow,
} from '../../../lib/explorer/reads';
import {
  useExplorerRead,
  useNearScreen,
  useStepState,
  type ReadState,
} from '../ExplorerContext';
import {
  cap,
  LoadingLine,
  mutedText,
  panelSx,
  ReadError,
  Section,
} from '../parts';
import {
  useAccountTxList,
  type AccountTxListState,
} from '../transactions/useAccountTxList';
import { useListView, ViewToggle, type ListView } from '../ViewToggle';
import { NameHistoryList, type HistoryStatus } from './NameHistoryList';
import {
  NameHead,
  NameNotes,
  NameRecordLine,
  NowOwnedBy,
  WholeHistoryButton,
} from './nameParts';

/** Names shown at first, and added by each "Show more". */
export const NAMES_PAGE = 20;

/** The look of a name that can take the focus from "Show more". */
const focusableSx = (theme: Theme) => ({
  '&:focus-visible': {
    outline: `2px solid ${theme.palette.primary.main}`,
    outlineOffset: 2,
  },
});

/**
 * One name's box: what it is on one side, its history on the other. A card
 * in the grid (its history under it); a row in the list (its history to
 * the right when there is room, under it otherwise).
 */
function NameItem({
  view,
  setNode,
  about,
  history,
}: {
  view: ListView;
  setNode: (node: HTMLLIElement | null) => void;
  about: ReactNode;
  history: ReactNode;
}) {
  const grid = view === 'grid';
  return (
    <Box
      component="li"
      ref={setNode}
      tabIndex={-1}
      sx={(theme) => ({
        alignContent: 'start',
        display: 'grid',
        gap: grid ? 1.5 : 1,
        gridTemplateColumns: 'minmax(0, 1fr)',
        minWidth: 0,
        ...(grid
          ? {
              ...panelSx(theme),
            }
          : {
              borderTop: `1px solid ${theme.palette.divider}`,
              py: 1.5,
              '&:first-of-type': { borderTop: 0, pt: 0 },
              '@container (min-width: 600px)': {
                columnGap: 3,
                gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)',
              },
            }),
        ...focusableSx(theme),
      })}
    >
      <Box
        sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}
      >
        {about}
      </Box>
      <Box
        sx={(theme) => ({
          backgroundColor: theme.palette.background.elevated,
          borderRadius: '10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 0.75,
          minWidth: 0,
          p: 1.25,
        })}
      >
        {history}
      </Box>
    </Box>
  );
}

/** The list of names, in the view picked: the list sits in one panel, the grid's cards stand on their own. */
const NameList = ({
  view,
  label,
  listRef,
  children,
}: {
  view: ListView;
  label: string;
  listRef?: Ref<HTMLUListElement>;
  children: ReactNode;
}) => {
  const list = (
    <Box
      component="ul"
      ref={listRef}
      aria-label={label}
      sx={{
        listStyle: 'none',
        m: 0,
        minWidth: 0,
        p: 0,
        ...(view === 'grid'
          ? {
              display: 'grid',
              gap: 1.5,
              gridTemplateColumns:
                'repeat(auto-fill, minmax(min(100%, 300px), 1fr))',
            }
          : {}),
      }}
    >
      {children}
    </Box>
  );
  return (
    <Box sx={{ containerType: 'inline-size', minWidth: 0 }}>
      {view === 'list' ? <Box sx={panelSx}>{list}</Box> : list}
    </Box>
  );
};

/** A list shown a page at a time; "Show more" puts the keyboard on the first name it added. */
function usePaged(stepKey: string) {
  const [stored, setShown] = useStepState<number>(stepKey, NAMES_PAGE);
  const shown =
    typeof stored === 'number' && stored >= NAMES_PAGE ? stored : NAMES_PAGE;
  const listRef = useRef<HTMLUListElement>(null);
  const firstNew = useRef<number | null>(null);
  useEffect(() => {
    const index = firstNew.current;
    if (index === null) return;
    firstNew.current = null;
    const row = listRef.current?.children[index];
    if (row instanceof HTMLElement) row.focus();
  }, [shown]);
  const showMore = () => {
    firstNew.current = shown;
    setShown(shown + NAMES_PAGE);
  };
  return { shown, showMore, listRef };
}

function ShowMoreNames({ left, onShow }: { left: number; onShow: () => void }) {
  const { t, i18n } = useTranslation(['explorer']);
  const count = Math.min(left, NAMES_PAGE);
  return (
    <Button
      size="small"
      variant="outlined"
      onClick={onShow}
      sx={{ alignSelf: 'flex-start' }}
    >
      {t('explorer:names.show_more', {
        count,
        shown: formatCount(count, i18n.language),
        ...cap,
      })}
    </Button>
  );
}

function OwnedName({
  name,
  address,
  primary,
  txs,
  status,
  capped,
  view,
}: {
  name: string;
  address: string;
  primary: boolean;
  txs: readonly TxRow[];
  status: HistoryStatus;
  capped: boolean;
  view: ListView;
}) {
  const [node, setNode] = useState<HTMLLIElement | null>(null);
  const near = useNearScreen(node);
  return (
    <NameItem
      view={view}
      setNode={setNode}
      about={
        <>
          <NameHead name={name} primary={primary} />
          <NameRecordLine name={name} owner={address} near={near} />
          <NameNotes name={name} owner={address} />
        </>
      }
      history={
        <>
          <NameHistoryList
            name={name}
            txs={txs}
            address={address}
            status={status}
            capped={capped}
          />
          {status === 'ready' && unchangedSince(txs, capped) ? null : (
            <WholeHistoryButton name={name} />
          )}
        </>
      }
    />
  );
}

/** A name it had: who has it now, and what it did with it. */
function PastName({
  name,
  address,
  txs,
  view,
}: {
  name: string;
  address: string;
  txs: readonly TxRow[];
  view: ListView;
}) {
  const [node, setNode] = useState<HTMLLIElement | null>(null);
  const near = useNearScreen(node);
  const record = useExplorerRead(near ? nameDataRead(name) : null);
  const now =
    record.data === undefined ? null : pastNameNow(name, record.data, txs);
  // Its whole history goes on from its record: not when no one has it now,
  // nor when the node matched a registration made since (whose history isn't this one's).
  const walkable = now?.kind === 'owned' || now?.kind === 'respelled';
  return (
    <NameItem
      view={view}
      setNode={setNode}
      about={
        <>
          <NameHead name={name} />
          <NowOwnedBy name={name} record={record} txs={txs} address={address} />
        </>
      }
      history={
        <>
          <NameHistoryList
            name={name}
            txs={txs}
            address={address}
            status="ready"
            capped={false}
          />
          {walkable ? <WholeHistoryButton name={name} /> : null}
        </>
      }
    />
  );
}

/**
 * Over the names, when its name transactions stop short: how many were
 * read, how many of the names show none for that reason, and the way to
 * read older ones (or that the Explorer stops there).
 */
function HistoryCoverage({
  history,
  without,
}: {
  history: AccountTxListState;
  without: number;
}) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const list = history.list;
  if (!list || list.done) return null;
  const language = i18n.language;
  const read = list.rows.length;
  const sentences = [
    t('explorer:names.coverage', {
      count: read,
      shown: formatCount(read, language),
      ...cap,
    }),
    without > 0
      ? t('explorer:names.coverage_without', {
          count: without,
          shown: formatCount(without, language),
          ...cap,
        })
      : null,
    atCeiling(list)
      ? t('explorer:names.coverage_ceiling', {
          max: formatCount(ACCOUNT_TX_MAX, language),
          ...cap,
        })
      : t('explorer:names.coverage_older', cap),
  ].filter(Boolean);
  return (
    <Box
      sx={(theme) => ({
        alignItems: 'center',
        backgroundColor: alpha(theme.palette.info.main, 0.08),
        borderRadius: '10px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        p: 1.25,
      })}
    >
      <Typography role="status" variant="body2" sx={{ flex: '1 1 260px' }}>
        {sentences.join(' ')}
      </Typography>
      {!atCeiling(list) && !history.more.error ? (
        <Button
          size="small"
          variant="outlined"
          disabled={history.more.loading}
          onClick={history.showMore}
        >
          {history.more.loading
            ? t('core:loading.generic', cap)
            : t('explorer:names.read_older', cap)}
        </Button>
      ) : null}
      {history.more.error ? (
        <Box sx={{ flexBasis: '100%' }}>
          <ReadError
            message={t('explorer:names.history_more_failed', cap)}
            onRetry={history.showMore}
          />
        </Box>
      ) : null}
    </Box>
  );
}

/** How the read of its name transactions stands, when it isn't simply in. */
function HistoryState({ history }: { history: AccountTxListState }) {
  const { t } = useTranslation(['explorer']);
  if (!history.list && history.error)
    return (
      <ReadError
        message={t('explorer:names.history_failed', cap)}
        onRetry={history.retry}
      />
    );
  if (!history.list)
    return (
      <Typography
        role="status"
        variant="body2"
        sx={(theme) => ({ color: mutedText(theme) })}
      >
        {t('explorer:names.history_loading', cap)}
      </Typography>
    );
  // A Refresh that failed: the histories read so far stay.
  if (history.error)
    return (
      <ReadError
        message={t('explorer:names.history_refresh_failed', cap)}
        onRetry={history.retry}
      />
    );
  return null;
}

function NamesControls({
  sort,
  onSort,
  view,
  onView,
}: {
  sort: NameSort;
  onSort: (sort: NameSort) => void;
  view: ListView;
  onView: (view: ListView) => void;
}) {
  const { t } = useTranslation(['explorer']);
  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1.5,
        justifyContent: 'space-between',
      }}
    >
      <TextField
        select
        size="small"
        label={t('explorer:names.sort', cap)}
        value={sort}
        onChange={(event) => {
          if (isNameSort(event.target.value)) onSort(event.target.value);
        }}
        sx={{ flex: '0 1 240px', minWidth: 180 }}
      >
        {NAME_SORTS.map((option) => (
          <MenuItem key={option} value={option}>
            {t(`explorer:names.sort_${option}`, cap)}
          </MenuItem>
        ))}
      </TextField>
      <ViewToggle
        view={view}
        onView={onView}
        label={t('explorer:names.view_label', cap)}
      />
    </Box>
  );
}

export function NamesTab({
  address,
  names,
  primary,
}: {
  address: string;
  /** Its names: the header's read. */
  names: ReadState<NamesOf>;
  /** Its primary name: the header's read. */
  primary: ReadState<string | null>;
}) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const history = useAccountTxList(address, NAME_TX_TYPES);
  const byName = useMemo(
    () => (history.list ? historyByName(history.list.rows) : null),
    [history.list]
  );
  const status: HistoryStatus = history.list
    ? 'ready'
    : history.error
      ? 'failed'
      : 'loading';
  const capped = Boolean(history.list && !history.list.done);
  const [storedSort, setSort] = useStepState<NameSort>('namesSort', 'primary');
  const sort: NameSort = isNameSort(storedSort) ? storedSort : 'primary';
  const [view, setView] = useListView('names');
  const owned = usePaged('namesShown');
  const had = usePaged('namesHadShown');

  // A primary name that can't be read: the names still show (in Core's order) and it says so.
  const primaryFailed =
    primary.status === 'error' && primary.data === undefined;
  const primaryName = primaryFailed ? null : primary.data;

  const listed = names.data;
  // Every name it owns, its primary one too even when it isn't among the
  // names listed (past the first 500).
  const allNames = listed
    ? typeof primaryName === 'string' && !listed.names.includes(primaryName)
      ? [primaryName, ...listed.names]
      : listed.names
    : [];
  const title = listed
    ? listed.truncated
      ? t('explorer:names.title_more', {
          n: formatCount(listed.names.length, i18n.language),
          ...cap,
        })
      : t('explorer:names.title_count', {
          n: formatCount(allNames.length, i18n.language),
          ...cap,
        })
    : t('explorer:names.title', cap);

  let body: ReactNode;
  if (names.status === 'error' && !listed)
    body = (
      <Box sx={panelSx}>
        <ReadError
          message={t('explorer:names.failed', cap)}
          onRetry={names.retry}
        />
      </Box>
    );
  else if (!listed || primaryName === undefined)
    body = (
      <Box sx={panelSx}>
        <LoadingLine label={t('explorer:names.loading', cap)} />
      </Box>
    );
  else if (!listed.names.length)
    // None now: what its name transactions say still decides the names it had, below.
    body = (
      <Box
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}
      >
        <Box sx={panelSx}>
          <Typography variant="body2" role="status">
            {t('explorer:names.none', cap)}
          </Typography>
        </Box>
        <HistoryState history={history} />
        <HistoryCoverage history={history} without={0} />
      </Box>
    );
  else {
    const all = allNames;
    const hasPrimary = primaryName !== null;
    const ordered = sortNames(all, sort, primaryName, byName, i18n.language);
    const visible = ordered.slice(0, owned.shown);
    const left = ordered.length - visible.length;
    const without = byName
      ? all.filter((name) => !byName.get(name)?.length).length
      : 0;
    body = (
      <Box
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}
      >
        {all.length > 1 ? (
          <NamesControls
            sort={sort}
            onSort={setSort}
            view={view}
            onView={setView}
          />
        ) : null}
        <HistoryState history={history} />
        <HistoryCoverage history={history} without={without} />
        {primaryFailed ? (
          <ReadError
            message={t('explorer:names.primary_failed', cap)}
            onRetry={primary.retry}
          />
        ) : primaryName === null ? (
          <Typography
            variant="body2"
            sx={(theme) => ({ color: mutedText(theme) })}
          >
            {t('explorer:names.no_primary', cap)}
          </Typography>
        ) : null}
        <NameList
          view={view}
          label={t('explorer:names.list_label', cap)}
          listRef={owned.listRef}
        >
          {visible.map((name) => (
            <OwnedName
              key={name}
              name={name}
              address={address}
              primary={hasPrimary && name === primaryName}
              txs={byName?.get(name) ?? []}
              status={status}
              capped={capped}
              view={view}
            />
          ))}
        </NameList>
        {left > 0 ? (
          <ShowMoreNames left={left} onShow={owned.showMore} />
        ) : null}
        {listed.truncated ? (
          <Typography
            variant="body2"
            role="status"
            sx={(theme) => ({ color: mutedText(theme) })}
          >
            {t('explorer:names.truncated', {
              count: listed.names.length,
              shown: formatCount(listed.names.length, i18n.language),
              ...cap,
            })}
          </Typography>
        ) : null}
      </Box>
    );
  }

  // The names it had: only once its history is read, and only when every name it owns is listed.
  const pastList =
    byName && listed && !listed.truncated ? pastNames(byName, allNames) : [];
  const pastVisible = pastList.slice(0, had.shown);
  const rowsRead = history.list?.rows.length ?? 0;

  return (
    <>
      <Section id="explorer-names" title={title}>
        {body}
      </Section>
      {pastList.length && byName ? (
        <Section
          id="explorer-names-had"
          title={t('explorer:names.had_title', {
            n: formatCount(pastList.length, i18n.language),
            ...cap,
          })}
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1.5,
              minWidth: 0,
            }}
          >
            <Typography
              variant="body2"
              sx={(theme) => ({ color: mutedText(theme) })}
            >
              {capped
                ? t('explorer:names.had_note_partial', {
                    count: rowsRead,
                    shown: formatCount(rowsRead, i18n.language),
                    ...cap,
                  })
                : t('explorer:names.had_note', cap)}
            </Typography>
            <NameList
              view={view}
              label={t('explorer:names.had_label', cap)}
              listRef={had.listRef}
            >
              {pastVisible.map((name) => (
                <PastName
                  key={name}
                  name={name}
                  address={address}
                  txs={byName.get(name) ?? []}
                  view={view}
                />
              ))}
            </NameList>
            {pastList.length > pastVisible.length ? (
              <ShowMoreNames
                left={pastList.length - pastVisible.length}
                onShow={had.showMore}
              />
            ) : null}
          </Box>
        </Section>
      ) : null}
    </>
  );
}
