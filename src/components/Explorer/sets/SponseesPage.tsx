/**
 * The accounts a sponsor sponsored (from Q-Mintership+'s SponseesPage),
 * for a viewer the level 5+ rule lets in: the accounts it made reward
 * shares to, from its own Minting list (the Transactions tab's kind, the
 * same cache entry as its Connections tab's: 100 a read, Read older up to
 * 1,000), each with when and at what percent, whether the share was
 * removed, how many shares in all, and, once its row nears the screen,
 * its level, a minting penalty and where it stands in MINTER; who mints
 * now from the online list. A line says how far the list was read: "none"
 * only from a list read to its end. Sorted the first sponsored first, or
 * another way. Pick 2 to 4 to compare them; two checks across the set run
 * on request (SetChecks). Read-only; nothing polls.
 */
import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import CompareArrowsRoundedIcon from '@mui/icons-material/CompareArrowsRounded';
import { useTranslation } from 'react-i18next';
import {
  ACCOUNT_TX_MAX,
  atCeiling,
  canReadMore,
} from '../../../lib/explorer/accountTx';
import { COMPARE_MAX, cleanPicks } from '../../../lib/explorer/comparePicks';
import {
  formatCount,
  formatDay,
  formatPercent,
  formatSpan,
} from '../../../lib/explorer/format';
import {
  accountRead,
  groupsOfRead,
  onlineRead,
} from '../../../lib/explorer/reads';
import { minterStandingOf } from '../../../lib/explorer/rules';
import {
  isSponseeSort,
  SPONSEE_SORTS,
  sortSponsees,
  sponseeRows,
  type SponseeRow,
  type SponseeSort,
} from '../../../lib/explorer/sets';
import { useCompareSteps } from '../compare/compareSteps';
import { PersonButton, useAccountLabel } from '../connections/ConnectionRow';
import { MINTING_TYPES } from '../connections/useConnections';
import {
  useExplorerRead,
  useNearScreen,
  useStepState,
} from '../ExplorerContext';
import { ExplorerTrail } from '../ExplorerTrail';
import {
  cap,
  isolate,
  LoadingLine,
  mutedText,
  panelSx,
  ReadError,
  Section,
  StatusChip,
} from '../parts';
import { useAccountTxList } from '../transactions/useAccountTxList';
import { SetChecks } from './SetChecks';

/** Rows shown before "Show more" (each reads its account once it nears the screen). */
const ROWS = 20;

const SORT_KEYS: Readonly<Record<SponseeSort, string>> = {
  first: 'explorer:sponsees.sort.first',
  latest: 'explorer:sponsees.sort.latest',
  active: 'explorer:sponsees.sort.active',
  minting: 'explorer:sponsees.sort.minting',
  shares: 'explorer:sponsees.sort.shares',
};

function SponseeItem({
  row,
  picked,
  full,
  short,
  onPick,
}: {
  row: SponseeRow;
  picked: boolean;
  /** Four are picked, and this one isn't. */
  full: boolean;
  /** The sponsor's list stopped short: older shares to it may not be read. */
  short: boolean;
  onPick: (address: string, on: boolean) => void;
}) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const language = i18n.language;
  const [node, setNode] = useState<HTMLElement | null>(null);
  const near = useNearScreen(node);
  const { label } = useAccountLabel(row.address, near);
  const account = useExplorerRead(near ? accountRead(row.address) : null);
  const groups = useExplorerRead(near ? groupsOfRead(row.address) : null);
  const info = account.data?.kind === 'account' ? account.data.account : null;
  const standing = groups.data ? minterStandingOf(groups.data) : undefined;
  const details = [
    row.removal
      ? String(
          t('explorer:sponsees.row.removed', {
            count: row.blocks ?? 0,
            blocks: formatCount(row.blocks ?? 0, language),
            block: formatCount(row.removal.height, language),
          })
        )
      : String(t('explorer:sponsees.row.not_removed')),
    // "In all" only from a list read to its end: else, in what was read.
    row.shares > 1
      ? String(
          t(
            short
              ? 'explorer:sponsees.row.shares_read'
              : 'explorer:sponsees.row.shares',
            {
              count: row.shares,
              shown: formatCount(row.shares, language),
            }
          )
        )
      : null,
    row.removal && row.active ? String(t('explorer:sponsees.row.again')) : null,
  ].filter((part): part is string => part !== null);
  return (
    <Box
      component="li"
      ref={setNode}
      sx={(theme) => ({
        alignItems: 'flex-start',
        backgroundColor: theme.palette.background.elevated,
        borderRadius: '12px',
        display: 'flex',
        gap: 0.5,
        minWidth: 0,
        px: 1,
        py: 1,
      })}
    >
      <Checkbox
        size="small"
        checked={picked}
        disabled={full && !picked}
        onChange={(event) => onPick(row.address, event.target.checked)}
        slotProps={{
          input: {
            'aria-label': t('explorer:sponsees.pick', {
              name: label,
              ...cap,
            }),
          },
        }}
      />
      <Box
        sx={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          gap: 0.5,
          minWidth: 0,
        }}
      >
        <PersonButton address={row.address} near={near} />
        <Typography sx={{ fontSize: '0.95rem', overflowWrap: 'anywhere' }}>
          {t('explorer:sponsees.row.sponsored', {
            date: formatDay(row.start.timestamp, language),
            percent: formatPercent(row.percent, language),
            block: formatCount(row.start.height, language),
            ...cap,
          })}
        </Typography>
        <Typography
          variant="body2"
          sx={(theme) => ({
            color: mutedText(theme),
            overflowWrap: 'anywhere',
          })}
        >
          {details.join(' · ')}
        </Typography>
        <Box
          component="ul"
          aria-label={t('explorer:sponsees.row.about', {
            name: label,
            ...cap,
          })}
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0.75,
            listStyle: 'none',
            m: 0,
            p: 0,
          }}
        >
          {info ? (
            <li>
              <StatusChip
                kind="level"
                label={t('core:account_lookup.chip_level', {
                  level: info.level,
                  ...cap,
                })}
              />
            </li>
          ) : null}
          {standing === 'admin' ? (
            <li>
              <StatusChip
                kind="admin"
                label={t('explorer:chip.minter_admin')}
              />
            </li>
          ) : null}
          {standing === 'member' ? (
            <li>
              <StatusChip
                kind="member"
                label={t('explorer:chip.minter_member')}
              />
            </li>
          ) : null}
          {row.mintingNow ? (
            <li>
              <StatusChip
                kind="minting"
                label={t('explorer:chip.minting_now', cap)}
              />
            </li>
          ) : null}
          {info && info.blocksMintedPenalty !== 0 ? (
            <li>
              <StatusChip
                kind="penalty"
                label={t('explorer:chip.minting_penalty', cap)}
              />
            </li>
          ) : null}
        </Box>
        {account.status === 'error' || groups.status === 'error' ? (
          <ReadError
            message={t('explorer:sponsees.row.failed', cap)}
            onRetry={() => {
              if (account.status === 'error') account.retry();
              if (groups.status === 'error') groups.retry();
            }}
          />
        ) : null}
      </Box>
    </Box>
  );
}

export function SponseesPage({
  address,
  trail,
}: {
  address: string;
  trail: string[];
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const { openCompare } = useCompareSteps();
  const { label } = useAccountLabel(address, true);
  const list = useAccountTxList(address, MINTING_TYPES);
  const online = useExplorerRead(onlineRead());
  const rows = useMemo(
    () =>
      list.list ? sponseeRows(list.list.rows, address, online.data) : null,
    [list.list, address, online.data]
  );
  const [storedSort, setSort] = useStepState<SponseeSort>(
    'sponseeSort',
    'first'
  );
  const sort: SponseeSort = isSponseeSort(storedSort) ? storedSort : 'first';
  const sorted = useMemo(
    () => (rows ? sortSponsees(rows, sort) : []),
    [rows, sort]
  );
  const [shown, setShown] = useStepState<number>('sponseeShown', ROWS);
  const [storedPicks, setPicks] = useStepState<string[]>('sponseePicks', []);
  const picks = cleanPicks(storedPicks);
  // Four picked: the other rows' boxes are off (SponseeItem's `full`).
  const pick = (who: string, on: boolean) =>
    setPicks(
      on
        ? picks.includes(who)
          ? picks
          : [...picks, who]
        : picks.filter((each) => each !== who)
    );

  const short = Boolean(list.list && !list.list.done);
  const read = list.list?.rows.length ?? 0;
  const coverage = list.list
    ? t('explorer:connections.coverage.read', {
        list: short
          ? t('explorer:connections.coverage.minting_newest', {
              count: read,
              shown: formatCount(read, language),
            })
          : read === 1
            ? t('explorer:connections.coverage.minting_single')
            : read
              ? t('explorer:connections.coverage.minting_all', {
                  count: read,
                  shown: formatCount(read, language),
                })
              : t('explorer:connections.coverage.minting_none'),
        ...cap,
      })
    : null;

  let body;
  if (!list.list && list.error)
    body = (
      <ReadError
        message={t('explorer:connections.failed.minting', cap)}
        onRetry={list.retry}
      />
    );
  else if (!rows)
    body = <LoadingLine label={t('explorer:sponsees.loading', cap)} />;
  else if (!rows.length)
    body = (
      <Typography role="status">
        {short
          ? t('explorer:sponsees.none_so_far', cap)
          : t('explorer:sponsees.none', cap)}
      </Typography>
    );
  else {
    const starts = rows.map((row) => row.start.timestamp);
    const minting = rows.filter((row) => row.mintingNow).length;
    body = (
      <>
        <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
          {t(
            short
              ? 'explorer:sponsees.summary_more'
              : 'explorer:sponsees.summary',
            {
              count: rows.length,
              shown: formatCount(rows.length, language),
              span: formatSpan(
                Math.min(...starts),
                Math.max(...starts),
                language
              ),
              ...cap,
            }
          )}
          {online.data
            ? ` ${t('explorer:sponsees.minting_now', {
                count: minting,
                shown: formatCount(minting, language),
                ...cap,
              })}`
            : null}
        </Typography>
        {online.status === 'error' && !online.data ? (
          <ReadError
            message={t('explorer:connections.failed.online', cap)}
            onRetry={online.retry}
          />
        ) : null}
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {t('explorer:connections.reward_share_note', cap)}
        </Typography>
        <Section
          id="explorer-sponsees-list"
          title={t('explorer:sponsees.list_title', cap)}
          action={
            <Button
              variant="contained"
              size="small"
              startIcon={<CompareArrowsRoundedIcon />}
              disabled={picks.length < 2}
              onClick={() => openCompare(picks, address)}
            >
              {t('explorer:compare.picks.compare', {
                picked: picks.length,
                ...cap,
              })}
            </Button>
          }
        >
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1.5,
            }}
          >
            {rows.length > 1 ? (
              <TextField
                select
                size="small"
                label={t('explorer:connections.payments.sort', cap)}
                value={sort}
                onChange={(event) => {
                  if (isSponseeSort(event.target.value))
                    setSort(event.target.value);
                }}
                sx={{ flex: '0 1 260px', minWidth: 200 }}
              >
                {SPONSEE_SORTS.map((option) => (
                  <MenuItem key={option} value={option}>
                    {t(SORT_KEYS[option], cap)}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
            <Typography
              variant="body2"
              sx={(theme) => ({ color: mutedText(theme), flex: '1 1 220px' })}
            >
              {t('explorer:sponsees.pick_hint', { max: COMPARE_MAX, ...cap })}
            </Typography>
          </Box>
          <Box
            component="ul"
            aria-label={t('explorer:sponsees.title', {
              name: label,
              ...cap,
            })}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              listStyle: 'none',
              m: 0,
              p: 0,
            }}
          >
            {sorted.slice(0, shown).map((row) => (
              <SponseeItem
                key={row.address}
                row={row}
                picked={picks.includes(row.address)}
                full={picks.length >= COMPARE_MAX}
                short={short}
                onPick={pick}
              />
            ))}
          </Box>
          {sorted.length > shown ? (
            <Button
              size="small"
              onClick={() => setShown(shown + ROWS)}
              sx={{ alignSelf: 'flex-start' }}
            >
              {t('explorer:connections.payments.show_more', {
                count: Math.min(ROWS, sorted.length - shown),
                shown: formatCount(
                  Math.min(ROWS, sorted.length - shown),
                  language
                ),
                ...cap,
              })}
            </Button>
          ) : null}
        </Section>
        <SetChecks accounts={rows.map((row) => row.address)} />
      </>
    );
  }

  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, minWidth: 0 }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Typography
          component="h2"
          sx={{
            fontSize: { xs: '1.15rem', sm: '1.3rem' },
            fontWeight: 700,
            lineHeight: 1.25,
            overflowWrap: 'anywhere',
          }}
        >
          {t('explorer:sponsees.title', { name: isolate(label), ...cap })}
        </Typography>
        <ExplorerTrail trail={trail} />
      </Box>
      <Box
        sx={(theme) => ({
          ...panelSx(theme),
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
        })}
      >
        {body}
        {coverage ? (
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1,
            }}
          >
            <Typography
              role="status"
              variant="body2"
              sx={(theme) => ({ color: mutedText(theme), flex: '1 1 280px' })}
            >
              {coverage}
              {list.list && atCeiling(list.list)
                ? ` ${t('explorer:connections.coverage.ceiling', {
                    max: formatCount(ACCOUNT_TX_MAX, language),
                    ...cap,
                  })}`
                : null}
            </Typography>
            {list.list && canReadMore(list.list) && !list.more.error ? (
              <Button
                size="small"
                variant="outlined"
                disabled={list.more.loading}
                onClick={list.showMore}
              >
                {list.more.loading
                  ? t('explorer:connections.coverage.reading_older', cap)
                  : t('explorer:connections.coverage.read_older', cap)}
              </Button>
            ) : null}
          </Box>
        ) : null}
        {list.more.error ? (
          <ReadError
            message={t('explorer:connections.failed.older', cap)}
            onRetry={list.showMore}
          />
        ) : null}
        {list.list && list.error ? (
          <ReadError
            message={t('explorer:transactions.refresh_failed', cap)}
            onRetry={list.retry}
          />
        ) : null}
      </Box>
    </Box>
  );
}
