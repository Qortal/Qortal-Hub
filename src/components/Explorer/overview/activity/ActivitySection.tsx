/**
 * The Overview's Activity (from Q-Mintership+'s ActivitySection), for a
 * viewer who sees the detailed parts: the account's transactions over time
 * as a chart (ActivityChart), from when it was first seen to now, with its
 * milestones marked: names registered, bought, sold or renamed, minting
 * levels moved, its first reward share, and its MINTER story, all from
 * Core's own facts.
 *
 * - What it reads: the Overview's All list (useAccountHistory), shared with
 *   QORT minted and received / sent and the Transactions tab; its newest
 *   1,000 by itself (the Activity settings say how many), then as many more
 *   at a time on request, or all of it. What isn't read yet is hatched and
 *   said. Once the section nears the screen, its first reward share (one
 *   row) and the blocks its approved MINTER changes took effect at.
 * - A family in the legend can be hidden; a period picked on the chart
 *   lists its transactions under it, each opening as in the Transactions
 *   tab (the period only partly read says so). Both are kept with the
 *   history step, so Back shows them as left; so is where the chart ends,
 *   so its periods stay as drawn and a period picked stays marked.
 * - Milestones before the stretch drawn (its first reward share, read on
 *   its own) are listed under the chart, not dropped.
 * - Full screen: the same, as tall as the window allows (it follows the
 *   window), in a dialog.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  ButtonBase,
  Dialog,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import OpenInFullRoundedIcon from '@mui/icons-material/OpenInFullRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import { useTranslation } from 'react-i18next';
import { ACCOUNT_HISTORY_MAX } from '../../../../lib/explorer/accountTx';
import {
  ACTIVITY_FAMILIES,
  activitySpan,
  approvalHeights,
  chainMarks,
  familyCounts,
  firstShareMark,
  isActivityFamily,
  minterEvents,
  minterMarks,
  rowsIn,
  type ActivityBucket,
  type ActivityFamily,
  type ActivityMark,
} from '../../../../lib/explorer/activity';
import { formatCount, formatDay } from '../../../../lib/explorer/format';
import {
  blockTimeRead,
  firstShareRead,
} from '../../../../lib/explorer/qortReads';
import type { AccountInfo, BlockAt } from '../../../../lib/explorer/reads';
import { familyOf } from '../../../../lib/explorer/txFamilies';
import {
  useExplorer,
  useExplorerRead,
  useExplorerReads,
  useStepState,
  type ReadState,
} from '../../ExplorerContext';
import {
  cap,
  LoadingLine,
  mutedText,
  panelSx,
  ReadError,
  Section,
} from '../../parts';
import { familyAccent } from '../../transactions/txLook';
import { TxList } from '../../transactions/TxListRow';
import type { AccountHistory } from '../useAccountHistory';
import { ActivityChart } from './ActivityChart';
import { markAccent } from './activityLook';
import { markText, periodText } from './activityWords';

/** A period's transactions listed before "Show all". */
const PERIOD_ROWS = 20;
/** Milestones listed before "Show all". */
const MARKS_SHOWN = 8;

interface Picked {
  start: number;
  end: number;
}

interface ActivityState {
  history: AccountHistory;
  address: string;
  label: string;
  from: number;
  to: number;
  readFrom: number | null;
  firstSeenAt: number | null;
  /** Every milestone shown, oldest first: those on the chart, and any before it. */
  marks: ActivityMark[];
  /** The milestones within the stretch drawn. */
  chartMarks: ActivityMark[];
  marksFailed: boolean;
  retryMarks: () => void;
  hidden: ReadonlySet<ActivityFamily>;
  toggle: (family: ActivityFamily) => void;
  picked: Picked | null;
  pick: (bucket: ActivityBucket | null) => void;
  openMark: (mark: ActivityMark) => void;
}

/** What was read, and the ways to read more. */
function ReadLine({ state }: { state: ActivityState }) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const language = i18n.language;
  const { activity, openActivitySettings } = useExplorer();
  const { history, firstSeenAt } = state;
  const rows = history.list?.rows ?? [];
  const held = rows.length;
  const oldest = held ? rows[held - 1].timestamp : null;
  let words: string;
  if (!history.list) words = String(t('explorer:activity.reading_first', cap));
  else if (!held) words = String(t('explorer:activity.none', cap));
  else if (history.reading)
    words = String(
      t('explorer:activity.reading', {
        count: held,
        shown: formatCount(held, language),
        target: formatCount(history.target, language),
        ...cap,
      })
    );
  else if (history.whole)
    words = String(
      held === 1
        ? t('explorer:activity.only', {
            date: formatDay(oldest ?? 0, language),
            ...cap,
          })
        : t('explorer:activity.all', {
            count: held,
            shown: formatCount(held, language),
            date: formatDay(oldest ?? 0, language),
            ...cap,
          })
    );
  else
    words = String(
      t(
        firstSeenAt && oldest && firstSeenAt < oldest
          ? 'explorer:activity.newest_since'
          : 'explorer:activity.newest',
        {
          count: held,
          shown: formatCount(held, language),
          date: formatDay(oldest ?? 0, language),
          first: formatDay(firstSeenAt ?? 0, language),
          ...cap,
        }
      )
    );
  const canRead =
    Boolean(history.list) &&
    held > 0 &&
    !history.whole &&
    !history.atCeiling &&
    !history.more.error;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {!history.list && history.error ? (
        <ReadError
          message={t('explorer:activity.failed', cap)}
          onRetry={history.retry}
        />
      ) : (
        <Typography
          role="status"
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {words}
          {history.atCeiling
            ? ` ${t('explorer:activity.ceiling', {
                max: formatCount(ACCOUNT_HISTORY_MAX, language),
              })}`
            : null}
        </Typography>
      )}
      <Box
        sx={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 1 }}
      >
        <Tooltip title={t('explorer:activity.settings', cap)}>
          <IconButton
            size="small"
            aria-label={t('explorer:activity.settings', cap)}
            aria-haspopup="dialog"
            onClick={openActivitySettings}
          >
            <TuneRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {canRead ? (
          <>
            <Button
              size="small"
              variant="outlined"
              disabled={history.reading}
              onClick={history.readMore}
            >
              {t('explorer:activity.read_older', {
                count: activity.firstRead,
                shown: formatCount(activity.firstRead, language),
                ...cap,
              })}
            </Button>
            <Button
              size="small"
              disabled={history.reading}
              onClick={history.readAll}
            >
              {t('explorer:activity.read_all', cap)}
            </Button>
          </>
        ) : null}
      </Box>
      {history.more.error ? (
        <ReadError
          message={t('explorer:activity.more_failed', cap)}
          onRetry={history.retryMore}
        />
      ) : null}
    </Box>
  );
}

/** Each family with its count: press one to hide it from the chart (and again to show it). */
function Legend({ state }: { state: ActivityState }) {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['explorer']);
  const counts = familyCounts(state.history.list?.rows ?? []);
  const present = ACTIVITY_FAMILIES.filter((family) => counts[family] > 0);
  if (!present.length) return null;
  return (
    <Box
      component="ul"
      aria-label={t('explorer:activity.legend', cap)}
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 0.75,
        listStyle: 'none',
        m: 0,
        p: 0,
      }}
    >
      {present.map((family) => {
        const shown = !state.hidden.has(family);
        const colour = familyAccent(theme, family);
        return (
          <li key={family}>
            <ButtonBase
              onClick={() => state.toggle(family)}
              aria-pressed={shown}
              sx={{
                alignItems: 'center',
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: '999px',
                color: shown ? 'text.primary' : 'text.secondary',
                display: 'inline-flex',
                fontSize: '0.8rem',
                gap: 0.75,
                minHeight: 30,
                px: 1.25,
                textDecoration: shown ? 'none' : 'line-through',
                '&.Mui-focusVisible': {
                  outline: `2px solid ${theme.palette.primary.main}`,
                },
              }}
            >
              <Box
                component="span"
                aria-hidden
                sx={{
                  backgroundColor: shown ? colour : 'transparent',
                  border: `2px solid ${colour}`,
                  borderRadius: '3px',
                  height: 10,
                  width: 10,
                }}
              />
              {t(`explorer:tx_family.${family}`, cap)}
              <Box
                component="span"
                sx={{ fontVariantNumeric: 'tabular-nums', opacity: 0.8 }}
              >
                {formatCount(counts[family], i18n.language)}
              </Box>
            </ButtonBase>
          </li>
        );
      })}
    </Box>
  );
}

/** The milestones, oldest first, each opening what it marks. */
function Milestones({ state }: { state: ActivityState }) {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const language = i18n.language;
  const [all, setAll] = useState(false);
  const { marks } = state;
  if (!marks.length && !state.marksFailed) return null;
  const shown = all ? marks : marks.slice(0, MARKS_SHOWN);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Typography component="h4" sx={{ fontSize: '0.95rem', fontWeight: 700 }}>
        {t('explorer:activity.milestones', cap)}
      </Typography>
      {marks.length ? (
        <Box
          component="ul"
          aria-label={t('explorer:activity.milestones', cap)}
          sx={{
            columnGap: 2,
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fill, minmax(min(100%, 260px), 1fr))',
            listStyle: 'none',
            m: 0,
            p: 0,
          }}
        >
          {shown.map((mark) => (
            <li key={mark.key}>
              <ButtonBase
                onClick={() => state.openMark(mark)}
                sx={{
                  alignItems: 'center',
                  borderRadius: '8px',
                  display: 'flex',
                  gap: 1,
                  justifyContent: 'flex-start',
                  minHeight: 40,
                  px: 0.5,
                  textAlign: 'start',
                  width: '100%',
                  '&:hover': { backgroundColor: theme.palette.action.hover },
                  '&.Mui-focusVisible': {
                    outline: `2px solid ${theme.palette.primary.main}`,
                  },
                }}
              >
                <Box
                  aria-hidden
                  sx={{
                    backgroundColor: markAccent(theme, mark.kind),
                    borderRadius: '50%',
                    flexShrink: 0,
                    height: 10,
                    width: 10,
                  }}
                />
                <Box component="span" sx={{ minWidth: 0 }}>
                  <Box
                    component="span"
                    sx={{ display: 'block', overflowWrap: 'anywhere' }}
                  >
                    {markText(mark, t, language)}
                  </Box>
                  <Typography
                    component="span"
                    variant="body2"
                    sx={{ color: mutedText(theme) }}
                  >
                    {formatDay(mark.at, language)}
                  </Typography>
                </Box>
              </ButtonBase>
            </li>
          ))}
        </Box>
      ) : null}
      {marks.length > MARKS_SHOWN ? (
        <Button
          size="small"
          onClick={() => setAll((open) => !open)}
          aria-expanded={all}
          sx={{ alignSelf: 'flex-start' }}
        >
          {all
            ? t('explorer:activity.show_fewer', cap)
            : t('explorer:activity.show_all_marks', {
                count: marks.length,
                shown: formatCount(marks.length, language),
                ...cap,
              })}
        </Button>
      ) : null}
      {state.marksFailed ? (
        <ReadError
          message={t('explorer:activity.marks_failed', cap)}
          onRetry={state.retryMarks}
        />
      ) : null}
    </Box>
  );
}

/** The picked period's transactions, newest first. */
function PeriodList({ state }: { state: ActivityState }) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const language = i18n.language;
  const [all, setAll] = useState<number | null>(null);
  const { picked, hidden } = state;
  const list = state.history.list?.rows;
  const rows = useMemo(
    () =>
      picked && list
        ? rowsIn(list, picked.start, picked.end, picked.end >= state.to).filter(
            (tx) => !hidden.has(familyOf(tx.type))
          )
        : [],
    [picked, list, hidden, state.to]
  );
  if (!picked) return null;
  const period = periodText(picked, language);
  const everything = all === picked.start;
  const shown = everything ? rows : rows.slice(0, PERIOD_ROWS);
  // The period holding the oldest transaction read: its older part isn't read yet.
  const partial =
    state.readFrom !== null &&
    picked.start <= state.readFrom &&
    state.readFrom < picked.end;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box
        sx={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 1 }}
      >
        <Box role="status" sx={{ mr: 'auto' }}>
          <Typography
            component="h4"
            sx={{ fontSize: '0.95rem', fontWeight: 700 }}
          >
            {t('explorer:activity.period_title', {
              count: rows.length,
              shown: formatCount(rows.length, language),
              period,
              ...cap,
            })}
          </Typography>
          {partial ? (
            <Typography
              variant="body2"
              sx={(theme) => ({ color: mutedText(theme) })}
            >
              {t('explorer:activity.partly_read', cap)}
            </Typography>
          ) : null}
        </Box>
        <Button size="small" onClick={() => state.pick(null)}>
          {t('explorer:activity.close_list', cap)}
        </Button>
      </Box>
      {rows.length ? (
        <TxList
          rows={shown}
          viewpoint={state.address}
          label={t('explorer:activity.period_label', { period, ...cap })}
        />
      ) : null}
      {rows.length > shown.length ? (
        <Button
          size="small"
          onClick={() => setAll(picked.start)}
          sx={{ alignSelf: 'flex-start' }}
        >
          {t('explorer:activity.show_all', {
            count: rows.length,
            shown: formatCount(rows.length, language),
            ...cap,
          })}
        </Button>
      ) : null}
    </Box>
  );
}

/** Everything but the section's frame: inline, or full screen. */
function ActivityPanel({
  state,
  height,
}: {
  state: ActivityState;
  height: number;
}) {
  const { t } = useTranslation(['explorer']);
  const rows = state.history.list?.rows;
  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}
    >
      <ReadLine state={state} />
      {rows === undefined ? (
        state.history.error ? null : (
          <LoadingLine label={t('explorer:activity.reading_first', cap)} />
        )
      ) : rows.length ? (
        <>
          <Legend state={state} />
          <ActivityChart
            rows={rows}
            from={state.from}
            to={state.to}
            readFrom={state.readFrom}
            hidden={state.hidden}
            marks={state.chartMarks}
            height={height}
            picked={state.picked?.start ?? null}
            onPick={state.pick}
            onOpenMark={state.openMark}
            label={t('explorer:activity.chart_label', {
              name: state.label,
              ...cap,
            })}
          />
          <PeriodList state={state} />
          <Milestones state={state} />
        </>
      ) : null}
    </Box>
  );
}

/** The window's height while `active`, following it as it is resized. */
function useWindowHeight(active: boolean): number {
  const [height, setHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    if (!active) return undefined;
    const update = () => setHeight(window.innerHeight);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [active]);
  return height;
}

export function ActivitySection({
  account,
  label,
  history,
  firstSeen,
  near,
  nodeRef,
  onShowNames,
}: {
  account: AccountInfo;
  /** Whose activity, in words: its primary name, or its address. */
  label: string;
  history: AccountHistory;
  firstSeen: ReadState<BlockAt | null>;
  /** The section is near the screen: its own reads may start. */
  near: boolean;
  nodeRef: (node: HTMLElement | null) => void;
  /** Open the Names tab (several names registered in one milestone). */
  onShowNames: () => void;
}) {
  const { t } = useTranslation(['core', 'explorer']);
  const { address } = account;
  const { activity, openTransaction } = useExplorer();
  const share = useExplorerRead(near ? firstShareRead(address) : null);
  const list = history.list?.rows;
  const rows = useMemo(() => list ?? [], [list]);
  const events = useMemo(
    () => minterEvents(rows, address, history.whole),
    [rows, address, history.whole]
  );
  const heights = useMemo(() => approvalHeights(events), [events]);
  const blocks = useExplorerReads(
    near && heights.length ? heights.map(blockTimeRead) : null,
    { concurrency: 2 }
  );
  const blockTimes = useMemo(() => {
    const times = new Map<number, number>();
    for (const height of heights) {
      const at = blocks.data.get(`blocktime:${height}`);
      if (at !== undefined) times.set(height, at);
    }
    return times;
  }, [heights, blocks.data]);

  // What is picked and hidden belongs to the history step (Back shows it as left).
  const [hiddenList, setHidden] = useStepState<string[]>('activityHidden', []);
  const hidden = useMemo(
    () => new Set(hiddenList.filter(isActivityFamily)),
    [hiddenList]
  );
  const [picked, setPicked] = useStepState<Picked | null>(
    'activityPicked',
    null
  );
  const [full, setFull] = useState(false);
  const windowHeight = useWindowHeight(full);

  const oldest = rows.length ? rows[rows.length - 1].timestamp : null;
  const newest = rows.length ? rows[0].timestamp : null;
  const firstSeenAt = firstSeen.data?.timestamp ?? null;
  // Where the chart ends is kept with the step: its periods stay as drawn
  // (a minute on, or Back later), so a period picked stays marked.
  const [keptEnd, setKeptEnd] = useStepState<number | null>(
    'activityEnd',
    null
  );
  const { from, to, readFrom } = activitySpan({
    oldest,
    newest,
    done: history.whole,
    firstSeenAt,
    now: Date.now(),
    end: keptEnd,
  });
  useEffect(() => {
    if (keptEnd === null || to > keptEnd) setKeptEnd(to);
  }, [keptEnd, to, setKeptEnd]);

  const hiddenMarks = activity.hiddenMarks;
  const shareData = share.data;
  const marks = useMemo(
    () =>
      [
        ...minterMarks(events, blockTimes),
        ...chainMarks(rows, address),
        ...firstShareMark(shareData),
      ]
        .filter((mark) => !hiddenMarks.includes(mark.kind))
        .sort((a, b) => a.at - b.at),
    [events, blockTimes, rows, address, shareData, hiddenMarks]
  );
  // On the chart only those within the stretch drawn; the list has them all.
  const chartMarks = useMemo(
    () => marks.filter((mark) => mark.at >= from && mark.at <= to),
    [marks, from, to]
  );

  const state: ActivityState = {
    history,
    address,
    label,
    from,
    to,
    readFrom,
    firstSeenAt,
    marks,
    chartMarks,
    marksFailed: share.status === 'error' || blocks.failed.length > 0,
    retryMarks: () => {
      if (share.status === 'error') share.retry();
      if (blocks.failed.length) blocks.retry();
    },
    hidden,
    toggle: (family) =>
      setHidden(
        hidden.has(family)
          ? hiddenList.filter((each) => each !== family)
          : [...hiddenList, family]
      ),
    picked,
    pick: (bucket) =>
      setPicked(bucket ? { start: bucket.start, end: bucket.end } : null),
    openMark: (mark) => {
      if (mark.say === 'registered_many') onShowNames();
      else if (mark.signature) openTransaction(mark.signature);
    },
  };

  return (
    <Box ref={nodeRef} sx={{ minWidth: 0 }}>
      <Section
        id="explorer-activity"
        title={t('explorer:activity.title', cap)}
        action={
          <Tooltip title={t('explorer:activity.full_screen', cap)}>
            <IconButton
              size="small"
              aria-label={t('explorer:activity.full_screen', cap)}
              aria-haspopup="dialog"
              onClick={() => setFull(true)}
            >
              <OpenInFullRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        }
      >
        <Box
          sx={(theme) => ({
            ...panelSx(theme),
            containerType: 'inline-size',
          })}
        >
          {full ? null : <ActivityPanel state={state} height={160} />}
        </Box>
      </Section>
      <Dialog
        open={full}
        onClose={() => setFull(false)}
        fullScreen
        aria-labelledby="explorer-activity-full-title"
        slotProps={{
          paper: {
            sx: (theme) => ({
              backgroundColor: theme.palette.background.default,
              backgroundImage: 'none',
            }),
          },
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            margin: '0 auto',
            maxWidth: 1600,
            p: { xs: 1.5, md: 3 },
            width: '100%',
            '& .MuiTypography-body2': { fontSize: '0.875rem' },
            '& .MuiButton-root': { textTransform: 'none' },
          }}
        >
          <Box sx={{ alignItems: 'center', display: 'flex', gap: 1 }}>
            <Typography
              id="explorer-activity-full-title"
              component="h2"
              sx={{ flex: 1, fontSize: '1.1rem', fontWeight: 700, minWidth: 0 }}
            >
              {t('explorer:activity.full_title', { name: label, ...cap })}
            </Typography>
            <Tooltip title={t('core:action.close', cap)}>
              <IconButton
                aria-label={t('core:action.close', cap)}
                onClick={() => setFull(false)}
              >
                <CloseRoundedIcon />
              </IconButton>
            </Tooltip>
          </Box>
          {full ? (
            <Box sx={{ containerType: 'inline-size', minWidth: 0 }}>
              <ActivityPanel
                state={state}
                height={Math.max(220, Math.min(720, windowHeight - 360))}
              />
            </Box>
          ) : null}
        </Box>
      </Dialog>
    </Box>
  );
}
