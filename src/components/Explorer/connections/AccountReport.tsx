/**
 * Connections → Account report (from Q-Mintership+'s AccountReport): one
 * button that makes a plain Markdown file of what the Explorer has read on
 * chain about the account and its connections (accountReportText.ts),
 * shows it, and saves it (Hub's saveFileToDiskGeneric) or copies it.
 *
 * - What it says is what the page read: Connections' lists and reads (passed
 *   in, not read again), the account's header reads, and the Overview's All
 *   list with its QORT figures (useAccountHistory and useQortFigures, the
 *   same reads and cache entries the Overview uses). While the report's
 *   window is open, that list reads on by itself to the first read (the
 *   Activity settings), as the Overview does, and "Read the rest" reads all
 *   of it; nothing else is read, and nothing of it before the window opens.
 * - Its QORT totals and activity by type come only from its whole history;
 *   until then the report says how much was read instead, and why: read in
 *   part (with "Read the rest"), still being read, longer than the
 *   Explorer reads, or couldn't be read (with Retry). While its newest
 *   transactions are read again (a Refresh, or a newer one on the node),
 *   that page is still being read, and so are the newest pages of
 *   Connections' lists after a Refresh: the report names them, and never
 *   says "its whole history" over them. QORT minted is
 *   PR 5's figure: its balance read between two reads of its newest
 *   transaction, "never minted" only without a reward share ever, and an
 *   account without a public key bought what other accounts' trade
 *   contracts paid it.
 * - A report made while something is still being read says what was
 *   missing: the window lists it before the report is made, and the report
 *   names it ("Still being read when the report was made"). What couldn't
 *   be read is named too, never taken for "none".
 * - Only for a viewer who sees the detailed parts: it is part of the
 *   Connections tab, and its reads start only when its window opens.
 * - Answers that arrive after the window closed are dropped; nothing polls.
 */
import { useId, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { visuallyHidden } from '@mui/utils';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import { useTranslation } from 'react-i18next';
import { saveFileToDiskGeneric } from '../../../utils/generateWallet/generateWallet';
import { reportFileName } from '../../../lib/explorer/accountReport';
import { ACCOUNT_HISTORY_MAX } from '../../../lib/explorer/accountTx';
import { shortAddress } from '../../../lib/explorer/addresses';
import type { Funding } from '../../../lib/explorer/connections';
import { exchangePaymentsRead } from '../../../lib/explorer/connectionReads';
import {
  exchangeFlowsFrom,
  exchangeName,
} from '../../../lib/explorer/exchanges';
import { siblingsSentence, type Finding } from '../../../lib/explorer/findings';
import { formatCount, formatList } from '../../../lib/explorer/format';
import { balanceRead } from '../../../lib/explorer/qortReads';
import {
  firstSeenRead,
  groupsOfRead,
  namesOfRead,
  primaryNameRead,
  type AccountInfo,
} from '../../../lib/explorer/reads';
import { visibleName } from '../../../lib/explorer/rules';
import {
  useExplorer,
  useExplorerRead,
  type ReadState,
} from '../ExplorerContext';
import { useQortFigures, type QortFigures } from '../overview/QortFacts';
import { useAccountHistory } from '../overview/useAccountHistory';
import { cap, mutedText, panelSx, ReadError, Section } from '../parts';
import {
  accountReportMarkdown,
  partText,
  type Known,
  type ReportData,
  type ReportPart,
} from './accountReportText';
import { coverageSentences, nothingFound } from './connectionsSummary';
import type { InCommonData } from './InCommon';
import { isShort, type ConnectionsData } from './useConnections';

/** What the Connections tab already holds, for the report. */
export interface ReportSources {
  data: ConnectionsData;
  funding: ReadState<Funding | null>;
  sponsor: string | null;
  common: InCommonData;
  coreSponsor: ReadState<string | null>;
  findingTags: (finding: Finding) => Array<string | null>;
}

/** A read as the report holds it: its answer, failed, or still being read. */
export function known<T>(read: ReadState<T>): Known<T> {
  if (read.data !== undefined) return { state: 'ready', value: read.data };
  return read.status === 'error' ? { state: 'failed' } : { state: 'reading' };
}

export function AccountReport({
  account,
  sources,
}: {
  account: AccountInfo;
  sources: ReportSources;
}) {
  const { t } = useTranslation(['explorer']);
  const [open, setOpen] = useState(false);
  return (
    <Section
      id="explorer-connections-report"
      title={t('explorer:report.title', cap)}
    >
      <Box
        sx={(theme) => ({
          ...panelSx(theme),
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
        })}
      >
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {t('explorer:report.about', cap)}
        </Typography>
        <Box>
          <Button
            variant="outlined"
            startIcon={<DescriptionOutlinedIcon />}
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
          >
            {t('explorer:report.button', cap)}
          </Button>
        </Box>
      </Box>
      {open ? (
        <ReportDialog
          account={account}
          sources={sources}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </Section>
  );
}

interface Made {
  text: string;
  fileName: string;
}

/** What the report's QORT totals say, from PR 5's figures (the report says them only with its whole history). */
function qortOf(figures: QortFigures): ReportData['qort'] {
  if (!figures.book) return null;
  return {
    minted: figures.minted,
    book: figures.book,
    trades: figures.noKey ? null : known(figures.trades),
  };
}

function ReportDialog({
  account,
  sources,
  onClose,
}: {
  account: AccountInfo;
  sources: ReportSources;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const language = i18n.language;
  const { activity, cache } = useExplorer();
  const { address } = account;
  const { data, funding, sponsor, common, coreSponsor, findingTags } = sources;

  // The account's own reads: the header's and the Overview's, from the cache when they are in.
  const primary = useExplorerRead(primaryNameRead(address));
  const names = useExplorerRead(namesOfRead(address));
  const groups = useExplorerRead(groupsOfRead(address));
  const balance = useExplorerRead(balanceRead(address));
  const firstSeen = useExplorerRead(firstSeenRead(address));
  const own = exchangeName(address);
  const exchanges = useExplorerRead(own ? null : exchangePaymentsRead(address));
  // Its All list, read on as the Overview reads it, and PR 5's figures from it.
  const history = useAccountHistory(address, {
    enabled: true,
    deep: true,
    firstRead: activity.firstRead,
    firstSignature:
      firstSeen.status === 'ready'
        ? (firstSeen.data?.signature ?? null)
        : undefined,
  });
  const figures = useQortFigures(account, history, true);

  const [made, setMade] = useState<Made | null>(null);
  const [said, setSaid] = useState('');
  const previewId = useId();
  const label = primary.data
    ? visibleName(primary.data)
    : shortAddress(address);

  // ---- What couldn't be read, and what is still being read ---------------------------
  const failed: ReportPart[] = [];
  const pending: ReportPart[] = [];
  const add = (read: Known<unknown>, part: ReportPart) => {
    if (read.state === 'failed') failed.push(part);
    else if (read.state === 'reading') pending.push(part);
  };
  if (figures.historyState === 'failed') failed.push('history');
  else if (figures.historyState === 'reading') pending.push('history');
  // Its newest transactions read again (a Refresh, or a newer one on the node): what was read before waits for them.
  if (history.refreshing) pending.push('newest');
  // A Refresh reads the newest page of Connections' lists again: newer transactions may be on their way.
  if (
    [data.payments, data.minting, data.names, data.levelMoveList].some(
      (list) => list.refreshing
    )
  )
    pending.push('refresh');
  failed.push(...data.failed);
  if (!data.settled) {
    if (!data.payments.list && !data.payments.error) pending.push('payments');
    if (!data.minting.list && !data.minting.error) pending.push('minting');
    if (!data.names.list && !data.names.error) pending.push('names');
    if (
      data.privs.loading ||
      (isShort(data.minting) &&
        !data.levelMoveList.list &&
        !data.levelMoveList.error)
    )
      pending.push('level_moves');
    if (data.online.data === undefined && data.online.status !== 'error')
      pending.push('online');
    if (data.trades.data === undefined && data.trades.status !== 'error')
      pending.push('trades');
  }
  if (data.refreshFailed) failed.push('refresh');
  add(known(funding), 'funding');
  if (sponsor)
    add(
      common.sponsorList.list
        ? { state: 'ready', value: null }
        : common.sponsorList.error
          ? { state: 'failed' }
          : { state: 'reading' },
      'sponsor_list'
    );
  if (coreSponsor.status !== 'idle') add(known(coreSponsor), 'core_sponsor');
  if (!own) add(known(exchanges), 'exchanges');
  add(known(primary), 'primary');
  add(known(names), 'owned_names');
  add(known(groups), 'groups');
  add(known(firstSeen), 'first_seen');
  // The Balance fact's: once QORT minted is worked out, the balance it was worked out with (QortFacts).
  const balanceKnown: Known<bigint> =
    balance.data !== undefined
      ? { state: 'ready', value: balance.data.atomic }
      : balance.status === 'error'
        ? { state: 'failed' }
        : { state: 'reading' };
  add(balanceKnown, 'balance');
  if (figures.historyState === 'whole') {
    const { minted } = figures;
    if (minted.kind === 'failed')
      failed.push(
        minted.what === 'share'
          ? 'first_share'
          : minted.what === 'balance'
            ? 'balance'
            : minted.what === 'orders'
              ? 'orders'
              : 'newest'
      );
    else if (minted.kind === 'loading') pending.push('minted');
    if (!figures.noKey) add(known(figures.trades), 'portal');
  }
  const failedOnce = [...new Set(failed)];
  const pendingOnce = [...new Set(pending)].filter(
    (part) => !failedOnce.includes(part)
  );
  // Its history has a line of its own in the window.
  const pendingShown = pendingOnce.filter(
    (part) => part !== 'history' && part !== 'newest'
  );

  // ---- The report ------------------------------------------------------------------------
  const flows = (
    list: typeof data.flowsSent
  ): Known<NonNullable<typeof list>> =>
    list
      ? { state: 'ready', value: list }
      : !data.payments.list && data.payments.error
        ? { state: 'failed' }
        : { state: 'reading' };
  const siblings: ReportData['siblings'] = !sponsor
    ? { state: 'ready', value: null }
    : common.siblings
      ? {
          state: 'ready',
          value: common.siblings.length
            ? {
                sentence: siblingsSentence(
                  sponsor,
                  common.siblings.length,
                  isShort(common.sponsorList)
                ),
                first: Math.min(
                  ...common.siblings.map((sibling) => sibling.start.timestamp)
                ),
                last: Math.max(
                  ...common.siblings.map((sibling) => sibling.start.timestamp)
                ),
              }
            : null,
        }
      : common.sponsorList.error
        ? { state: 'failed' }
        : { state: 'reading' };
  const exchangesKnown: ReportData['exchanges'] = own
    ? { state: 'own', exchange: own }
    : exchanges.data !== undefined
      ? {
          state: 'ready',
          value:
            exchanges.data === null
              ? {
                  flows: exchangeFlowsFrom(
                    data.recorded,
                    isShort(data.payments)
                  ),
                  exact: false,
                }
              : { flows: exchanges.data, exact: true },
        }
      : exchanges.status === 'error'
        ? { state: 'failed' }
        : { state: 'reading' };
  const nameOf = useMemo(
    () => (other: string) =>
      other === address
        ? (primary.data ?? null)
        : cache.peek<string | null>(primaryNameRead(other).key),
    [cache, address, primary.data]
  );

  const make = () => {
    const madeAt = Date.now();
    const { empty, soFar, tradesLeftOut } = nothingFound(
      data,
      funding.data,
      address
    );
    const report: ReportData = {
      address,
      madeAt,
      account,
      primary: known(primary),
      names: known(names),
      groups: known(groups),
      online: known(data.online),
      firstSeen: known(firstSeen),
      balance: balanceKnown,
      history: {
        state: history.refreshing ? 'refreshing' : figures.historyState,
        held: history.list?.rows.length ?? 0,
      },
      qort: qortOf(figures),
      rows: history.list?.rows ?? null,
      findings: data.recorded,
      flowsSent: flows(data.flowsSent),
      flowsReceived: flows(data.flowsReceived),
      funding: known(funding),
      siblings,
      exchanges: exchangesKnown,
      tradesLeftOut,
      empty,
      soFar,
      coverage: coverageSentences(data, t, language) ?? [],
      failed: failedOnce,
      pending: pendingOnce,
      tagsOf: findingTags,
      nameOf,
    };
    setSaid('');
    setMade({
      text: accountReportMarkdown(report, t, language),
      fileName: reportFileName(
        String(t('explorer:report.file_prefix')),
        primary.data ?? address,
        madeAt
      ),
    });
  };

  const save = async () => {
    if (!made) return;
    try {
      await saveFileToDiskGeneric(
        new Blob([made.text], { type: 'text/markdown;charset=utf-8' }),
        made.fileName
      );
      setSaid(String(t('explorer:report.save_asked', { file: made.fileName })));
    } catch {
      setSaid(String(t('explorer:report.save_failed', cap)));
    }
  };
  const copy = async () => {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made.text);
      setSaid(String(t('explorer:report.copied', cap)));
    } catch {
      setSaid(String(t('explorer:report.copy_failed', cap)));
    }
  };

  const held = history.list?.rows.length ?? 0;
  const shown = formatCount(held, language);
  const historyLine = (() => {
    // Never its whole history while its newest transactions are read again.
    if (history.refreshing) return t('explorer:report.history_refreshing', cap);
    switch (figures.historyState) {
      case 'whole':
        return held === 1
          ? t('explorer:report.whole_read_single', cap)
          : t('explorer:report.whole_read', { count: held, shown, ...cap });
      case 'reading':
        return t('explorer:report.history_reading', {
          count: held,
          shown,
          ...cap,
        });
      case 'waiting':
        return t('explorer:report.history_waiting', {
          count: held,
          shown,
          ...cap,
        });
      case 'ceiling':
        return t('explorer:report.history_ceiling', {
          max: formatCount(ACCOUNT_HISTORY_MAX, language),
          ...cap,
        });
      default:
        return null;
    }
  })();

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="explorer-report-title"
      slotProps={{
        paper: {
          sx: (theme) => ({
            backgroundColor: theme.palette.background.default,
            backgroundImage: 'none',
            '& .MuiTypography-body2': {
              fontSize: '0.875rem',
              lineHeight: 1.45,
            },
            '& .MuiButton-root': { textTransform: 'none' },
          }),
        },
      }}
    >
      <DialogTitle
        id="explorer-report-title"
        sx={{ fontSize: '1.05rem', fontWeight: 700, overflowWrap: 'anywhere' }}
      >
        {t('explorer:report.dialog_title', { name: label, ...cap })}
      </DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}
      >
        <Typography>{t('explorer:report.dialog_about', cap)}</Typography>
        {historyLine ? (
          <Box
            role="status"
            sx={(theme) => ({
              alignItems: 'center',
              backgroundColor: alpha(theme.palette.info.main, 0.08),
              borderLeft: `3px solid ${theme.palette.info.main}`,
              borderRadius: '6px',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1,
              px: 1.25,
              py: 0.75,
            })}
          >
            <Typography variant="body2" sx={{ flex: '1 1 260px', minWidth: 0 }}>
              {historyLine}
            </Typography>
            {figures.historyState === 'waiting' && !history.refreshing ? (
              <Button size="small" variant="outlined" onClick={history.readAll}>
                {t('explorer:facts.read_rest', cap)}
              </Button>
            ) : null}
          </Box>
        ) : null}
        {figures.historyState === 'failed' ? (
          <ReadError
            message={t('explorer:facts.history_failed', cap)}
            onRetry={figures.retryHistory}
          />
        ) : null}
        {pendingShown.length ? (
          <Typography role="status" variant="body2">
            {t('explorer:report.pending', {
              list: formatList(
                pendingShown.map((part) => partText(part, t)),
                language
              ),
              ...cap,
            })}
          </Typography>
        ) : null}
        <Typography
          role="note"
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {t('explorer:report.neutral')}
        </Typography>
        {made ? (
          <>
            <Typography
              id={previewId}
              variant="body2"
              sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}
            >
              {made.fileName}
            </Typography>
            <Box
              component="pre"
              tabIndex={0}
              aria-labelledby={previewId}
              sx={(theme) => ({
                backgroundColor: theme.palette.background.surface,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: '8px',
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                m: 0,
                maxHeight: 360,
                overflow: 'auto',
                overflowWrap: 'anywhere',
                p: 1.5,
                whiteSpace: 'pre-wrap',
              })}
            >
              {made.text}
            </Box>
          </>
        ) : null}
        <Box component="span" role="status" sx={visuallyHidden}>
          {said}
        </Box>
        {said ? (
          <Typography
            variant="body2"
            aria-hidden
            sx={(theme) => ({ color: mutedText(theme) })}
          >
            {said}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1, px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t('core:action.close', cap)}</Button>
        {made ? (
          <>
            <Button variant="outlined" onClick={() => void copy()}>
              {t('explorer:report.copy', cap)}
            </Button>
            <Button variant="outlined" onClick={make}>
              {t('explorer:report.make_again', cap)}
            </Button>
            <Button variant="contained" onClick={() => void save()}>
              {t('explorer:report.save', cap)}
            </Button>
          </>
        ) : (
          <Button
            variant="contained"
            startIcon={<DescriptionOutlinedIcon />}
            onClick={make}
          >
            {pendingOnce.length
              ? t('explorer:report.make_now', cap)
              : t('explorer:report.make', cap)}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
