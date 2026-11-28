/**
 * How an account is linked to other accounts, as evidence (from
 * Q-Mintership+'s ConnectionsTab): each link a sentence with numbers, a
 * date and a block, opening to the transactions behind it; never a
 * verdict. Shown only to a viewer who sees the detailed parts (the level
 * 5+ rule, lib/explorer/access.ts).
 *
 * - QORT sent to exchanges, or got from them (ExchangeNotice).
 * - Recorded between them: minting level moved, reward shares (its
 *   sponsor, minting with another account now, the accounts it
 *   sponsored), names bought or sold, and payments by the other account
 *   (PaymentsPanel: each way, sorted as picked).
 * - In common: where its first QORT came from, and the sponsor it shares.
 * - "Also checked, nothing found: …", and what was read, with Read older.
 * - What was recorded between them as a circle, the way it opens
 *   (ConnectionsCircle, "Connections circle"), or as a list ("Recorded
 *   between them", one click away: the view toggle, or "See the list"). The
 *   choice belongs to the history step. Typing a search shows the list, as
 *   in Q-Mintership+; clearing it brings the circle back. The circle pressed
 *   again while searching draws what the search found, and says so.
 * - At the bottom, the Account report (AccountReport): a Markdown file of
 *   what the Explorer read about it and its connections.
 *
 * A search over the tab narrows every list to the rows that show what was
 * typed: a name (read for the accounts in them while it is typed, up to
 * SEARCH_NAMES), an address, an amount, a tag, a date. What is typed,
 * picked and opened belongs to the history step.
 *
 * Reads (useConnections): its Payments, Minting and Names lists (the
 * Transactions tab's kinds), its level moves' recipients, the online
 * list, where its first QORT came from, its payments with exchanges, its
 * sponsor's minting list, and, when more than one account sponsored it,
 * which one Core counts. Nothing polls.
 */
import { useMemo, type ReactNode } from 'react';
import {
  Box,
  Button,
  IconButton,
  InputAdornment,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import BubbleChartRoundedIcon from '@mui/icons-material/BubbleChartRounded';
import ClearRoundedIcon from '@mui/icons-material/ClearRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import ViewListRoundedIcon from '@mui/icons-material/ViewListRounded';
import { useTranslation } from 'react-i18next';
import { isQortAddress } from '../../../lib/explorer/addresses';
import {
  coreSponsorRead,
  fundingRead,
} from '../../../lib/explorer/connectionReads';
import type { EmptyCheck } from '../../../lib/explorer/connections';
import { exchangeName } from '../../../lib/explorer/exchanges';
import {
  flowSentence,
  fundingTagKey,
  type Finding,
} from '../../../lib/explorer/findings';
import { formatCount, formatList } from '../../../lib/explorer/format';
import {
  isFlowSort,
  sortFlows,
  type Flow,
  type FlowSort,
} from '../../../lib/explorer/money';
import { primaryNameRead, type AccountInfo } from '../../../lib/explorer/reads';
import { queryWords, textMatches } from '../../../lib/explorer/rowSearch';
import {
  useExplorer,
  useExplorerRead,
  useExplorerReads,
  useStepState,
} from '../ExplorerContext';
import {
  cap,
  isolate,
  LoadingLine,
  mutedText,
  ReadError,
  Section,
} from '../parts';
import { sentenceText } from '../transactions/sentenceText';
import {
  ConnectionRow,
  ROW_LIST_SX,
  blocksText,
  whenText,
} from './ConnectionRow';
import { AccountReport } from './AccountReport';
import { coverageSentences, nothingFound } from './connectionsSummary';
import { ConnectionsCircle } from './ConnectionsCircle';
import { ExchangeNotice } from './ExchangeNotice';
import { InCommon, inCommonEntries, useInCommon } from './InCommon';
import { PaymentsPanel } from './PaymentsPanel';
import { SponseesLink } from '../sets/SetLinks';
import {
  isShort,
  useConnections,
  type ConnectionsData,
} from './useConnections';

/** Rows of one part shown before "Show all". */
const PART_ROWS = 20;
/** Primary names read for one search, at most (4 at a time). */
export const SEARCH_NAMES = 300;

const SUBHEAD_SX = {
  fontSize: '0.95rem',
  fontWeight: 700,
  lineHeight: 1.3,
  m: 0,
} as const;

/** A part of "Recorded between them" under its heading. */
function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <Typography component="h4" sx={SUBHEAD_SX}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

/** A list of rows: the first 20, then "Show all". */
function Rows({
  label,
  stepKey,
  rows,
}: {
  label: string;
  stepKey: string;
  rows: ReactNode[];
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const [all, setAll] = useStepState<boolean>(stepKey, false);
  return (
    <>
      <Box component="ul" aria-label={label} sx={ROW_LIST_SX}>
        {all ? rows : rows.slice(0, PART_ROWS)}
      </Box>
      {rows.length > PART_ROWS && !all ? (
        <Button
          size="small"
          onClick={() => setAll(true)}
          sx={{ alignSelf: 'flex-start' }}
        >
          {t('explorer:connections.show_all', {
            count: rows.length,
            shown: formatCount(rows.length, i18n.language),
            ...cap,
          })}
        </Button>
      ) : null}
    </>
  );
}

/** What was read of its lists, how far, and Read older; a list that couldn't be read is named as such. */
export function Coverage({ data }: { data: ConnectionsData }) {
  const { t, i18n } = useTranslation(['explorer']);
  const sentences = coverageSentences(data, t, i18n.language);
  if (!sentences) return null;
  return (
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
        {sentences.join(' ')}
      </Typography>
      {data.canReadOlder && !data.olderFailed ? (
        <Button
          size="small"
          variant="outlined"
          disabled={data.olderLoading}
          onClick={data.readOlder}
        >
          {data.olderLoading
            ? t('explorer:connections.coverage.reading_older', cap)
            : t('explorer:connections.coverage.read_older', cap)}
        </Button>
      ) : null}
      {data.olderFailed ? (
        <Box sx={{ flexBasis: '100%' }}>
          <ReadError
            message={t('explorer:connections.failed.older', cap)}
            onRetry={data.retryOlder}
          />
        </Box>
      ) : null}
    </Box>
  );
}

export function ConnectionsTab({ account }: { account: AccountInfo }) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const language = i18n.language;
  const { cache } = useExplorer();
  const { address } = account;
  const data = useConnections(address);
  const funding = useExplorerRead(fundingRead(account));
  const sponsors = data.links?.sponsors ?? [];
  const sponsor = sponsors[0]?.sponsor ?? null;
  // More than one account sponsored it: which one Core counts (about a second, read once).
  const coreSponsor = useExplorerRead(
    sponsors.length > 1 ? coreSponsorRead(address) : null
  );
  const common = useInCommon(address, sponsor);

  // ---- Circle or list ---------------------------------------------------------------------
  const [storedView, setView] = useStepState<ConnectionsView>(
    'connView',
    'circle'
  );
  const view: ConnectionsView = storedView === 'list' ? 'list' : 'circle';
  // A search typed over the circle shows the list; cleared, the circle again.
  const [circleForSearch, setCircleForSearch] = useStepState<boolean>(
    'connCircleForSearch',
    false
  );

  // ---- The search ----------------------------------------------------------------------
  const [storedTyped, setStoredTyped] = useStepState<string>('connSearch', '');
  const typed = typeof storedTyped === 'string' ? storedTyped : '';
  const words = useMemo(() => queryWords(typed), [typed]);
  const searching = words.length > 0;
  const setTyped = (next: string) => {
    if (queryWords(next).length && view === 'circle') {
      setView('list');
      setCircleForSearch(true);
    } else if (!queryWords(next).length && circleForSearch) {
      setView('circle');
      setCircleForSearch(false);
    }
    setStoredTyped(next);
  };
  const pickView = (next: ConnectionsView) => {
    setView(next);
    setCircleForSearch(false);
  };
  // The payments' order, as Payments lists them.
  const [storedSort, setPaySort] = useStepState<FlowSort>(
    'connPaySort',
    'count'
  );
  const paySort: FlowSort = isFlowSort(storedSort) ? storedSort : 'count';
  /** Every account in its rows, in the order the tab lists them. */
  const accounts = useMemo(() => {
    const found = new Set<string>();
    for (const finding of data.recorded)
      if (
        finding.other &&
        finding.kind !== 'paidTo' &&
        finding.kind !== 'paidBy'
      )
        found.add(finding.other);
    for (const flow of [
      ...sortFlows(data.flowsSent ?? [], paySort),
      ...sortFlows(data.flowsReceived ?? [], paySort),
    ])
      found.add(flow.address);
    if (funding.data?.from) found.add(funding.data.from);
    if (sponsor) found.add(sponsor);
    return [...found].filter((other) => isQortAddress(other));
  }, [
    data.recorded,
    data.flowsSent,
    data.flowsReceived,
    paySort,
    funding.data,
    sponsor,
  ]);
  /** The names read for the search stop here: the others are found by their address. */
  const namesCapped = accounts.length > SEARCH_NAMES;
  // While a search is typed, the names of the accounts in the rows, so a name finds its rows.
  const nameSpecs = useMemo(
    () =>
      searching
        ? accounts
            .slice(0, SEARCH_NAMES)
            .filter((other) => !exchangeName(other))
            .map(primaryNameRead)
        : null,
    [searching, accounts]
  );
  const names = useExplorerReads(nameSpecs, { concurrency: 4 });
  const nameOf = useMemo(
    () => (other: string) => {
      const key = primaryNameRead(other).key;
      return (
        names.data.get(key) ??
        cache.peek<string | null>(key) ??
        exchangeName(other)
      );
    },
    [cache, names.data]
  );

  // ---- Tags on the rows ----------------------------------------------------------------
  const fundingFound = funding.data ?? null;
  const fundingTag = fundingFound ? fundingTagKey(fundingFound) : null;
  const tagsOf = (other: string | null): Array<string | null> =>
    other
      ? [
          other === sponsor
            ? String(t('explorer:connections.tag.sponsor'))
            : null,
          fundingTag && fundingFound?.from === other
            ? String(t(fundingTag))
            : null,
          exchangeName(other)
            ? String(t('explorer:connections.tag.exchange_row'))
            : null,
        ]
      : [];
  const findingTags = (finding: Finding): Array<string | null> => [
    // Its sponsor's own row says so in its sentence.
    ...(finding.kind === 'sponsor' ? [] : tagsOf(finding.other)),
    finding.kind === 'sponsor' &&
    coreSponsor.data &&
    finding.other === coreSponsor.data
      ? String(t('explorer:connections.tag.core_sponsor'))
      : null,
    finding.otherLevel !== undefined
      ? String(
          t('explorer:connections.tag.level_now', { level: finding.otherLevel })
        )
      : null,
  ];

  /** What a row shows, as the search reads it. */
  const rowText = (
    sentence: Finding['sentence'],
    when: string,
    tags: Array<string | null>,
    others: Array<string | null>
  ) =>
    [sentenceText(sentence, t, language, { nameOf }), when, ...tags, ...others]
      .filter(Boolean)
      .join('\n');
  const findFinding = (finding: Finding) =>
    !searching ||
    textMatches(
      rowText(
        finding.sentence,
        whenText(finding, t, language),
        findingTags(finding),
        [finding.other]
      ),
      words
    );
  const findFlow = (flow: Flow, direction: 'sent' | 'received') =>
    textMatches(
      rowText(
        flowSentence(flow, direction),
        blocksText(flow.first.height, flow.last.height, t, language),
        [
          ...tagsOf(flow.address),
          String(
            t(
              direction === 'sent'
                ? 'explorer:connections.payments.sent_to'
                : 'explorer:connections.payments.received_from'
            )
          ),
        ],
        [flow.address]
      ),
      words
    );

  // ---- The parts -------------------------------------------------------------------------
  const { recorded } = data;
  const of = (kind: Finding['kind']) =>
    recorded.filter((finding) => finding.kind === kind);
  const levelMoves = of('levelMove');
  const shares = [...of('sponsor'), ...of('mintingWith')];
  const sponsees = of('sponsees')[0] ?? null;
  const nameDeals = of('nameDeal');
  const traded = of('traded');
  const levelFound = levelMoves.filter(findFinding);
  const sharesFound = shares.filter(findFinding);
  const sponseesFound = sponsees && findFinding(sponsees) ? sponsees : null;
  const namesFound = nameDeals.filter(findFinding);
  const tradesFound = traded.filter(findFinding);
  const sentFound =
    data.flowsSent?.filter((flow) => !searching || findFlow(flow, 'sent')) ??
    [];
  const receivedFound =
    data.flowsReceived?.filter(
      (flow) => !searching || findFlow(flow, 'received')
    ) ?? [];
  const commonAll = inCommonEntries(fundingFound, sponsor, common, t, language);
  const commonFound = commonAll.filter(
    (entry) =>
      !searching ||
      textMatches(
        rowText(entry.sentence, entry.when, entry.tags, [entry.other]),
        words
      )
  );

  const row = (finding: Finding, action?: ReactNode) => (
    <ConnectionRow
      key={finding.key}
      address={address}
      rowKey={finding.key}
      other={finding.other}
      sentence={finding.sentence}
      when={whenText(finding, t, language)}
      tags={findingTags(finding)}
      evidence={{
        kind: finding.evidenceKind,
        txs: finding.evidence,
        signatures: finding.evidenceSignatures,
      }}
      action={action}
    />
  );

  const matchCount =
    levelFound.length +
    sharesFound.length +
    (sponseesFound ? 1 : 0) +
    namesFound.length +
    tradesFound.length +
    sentFound.length +
    receivedFound.length +
    commonFound.length;

  // ---- What was checked and found nothing ---------------------------------------------
  const {
    empty,
    soFar: emptySoFar,
    tradesLeftOut,
  } = nothingFound(data, funding.data, address);
  const listOf = (checks: EmptyCheck[]) =>
    formatList(
      checks.map((check) => String(t(`explorer:connections.empty.${check}`))),
      language
    );

  // ---- On screen ---------------------------------------------------------------------------
  const linksLoading = !data.minting.list && !data.minting.error;
  const namesLoading = !data.names.list && !data.names.error;
  const mintingFailed = !data.minting.list && Boolean(data.minting.error);
  const namesFailed = !data.names.list && Boolean(data.names.error);
  const tradesFailed =
    data.trades.status === 'error' && data.trades.data === undefined;
  const levelMovesFailed =
    data.privs.failed.length > 0 ||
    (!data.levelMoveList.list && Boolean(data.levelMoveList.error));
  const onlineFailed =
    data.online.status === 'error' && data.online.data === undefined;
  const paymentsFailed = !data.payments.list && Boolean(data.payments.error);
  const fundingFailed =
    funding.status === 'error' && funding.data === undefined;
  const sponsorListFailed =
    Boolean(sponsor) &&
    !common.sponsorList.list &&
    Boolean(common.sponsorList.error);
  const sharesShown = sharesFound.length > 0 || sponseesFound !== null;
  // A failed list stays in sight while searching: a search can't look in it.
  const paymentsShown =
    !searching ||
    paymentsFailed ||
    sentFound.length > 0 ||
    receivedFound.length > 0;
  /** A part the search couldn't look in: it failed. */
  const searchMissed =
    data.failed.length > 0 ||
    paymentsFailed ||
    fundingFailed ||
    sponsorListFailed ||
    names.failed.length > 0;
  /** Parts still being read: what they hold isn't searched yet. */
  const stillReading =
    !data.settled ||
    funding.status === 'loading' ||
    (Boolean(sponsor) && !common.sponsorList.list && !common.sponsorList.error);
  const typedText = isolate(typed.trim());

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1.5,
          }}
        >
          <TextField
            size="small"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            label={t('explorer:connections.search.label', cap)}
            placeholder={t('explorer:connections.search.placeholder', cap)}
            sx={{ flex: '1 1 280px', maxWidth: 520 }}
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
                      aria-label={t('explorer:connections.search.clear', cap)}
                      onClick={() => setTyped('')}
                    >
                      <ClearRoundedIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              },
            }}
          />
          <ConnectionsViewToggle view={view} onView={pickView} />
        </Box>
        {searching ? (
          <Typography
            role="status"
            variant="body2"
            sx={(theme) => ({
              color: mutedText(theme),
              overflowWrap: 'anywhere',
            })}
          >
            {matchCount
              ? t('explorer:connections.search.found', {
                  count: matchCount,
                  shown: formatCount(matchCount, language),
                  typed: typedText,
                  ...cap,
                })
              : names.loading || stillReading
                ? t('explorer:connections.search.looking', {
                    typed: typedText,
                    ...cap,
                  })
                : searchMissed || namesCapped
                  ? t('explorer:connections.search.none_partial', {
                      typed: typedText,
                      ...cap,
                    })
                  : t('explorer:connections.search.none', {
                      typed: typedText,
                      ...cap,
                    })}
            {stillReading
              ? ` ${t('explorer:connections.search.reading_lists', cap)}`
              : names.loading
                ? ` ${t('explorer:connections.search.reading_names', cap)}`
                : null}
            {namesCapped
              ? ` ${t('explorer:connections.search.names_capped', {
                  count: SEARCH_NAMES,
                  shown: formatCount(SEARCH_NAMES, language),
                  total: formatCount(accounts.length, language),
                  ...cap,
                })}`
              : null}
          </Typography>
        ) : null}
        {searching && names.failed.length ? (
          <ReadError
            message={t('explorer:connections.failed.names_search', cap)}
            onRetry={names.retry}
          />
        ) : null}
      </Box>

      {!searching ? (
        <ExchangeNotice
          address={address}
          recorded={recorded}
          paymentsShort={isShort(data.payments)}
        />
      ) : null}

      <Section
        id={
          view === 'circle'
            ? 'explorer-connections-circle'
            : 'explorer-connections-recorded'
        }
        title={
          view === 'circle'
            ? t('explorer:circle.title', cap)
            : t('explorer:connections.recorded_title', cap)
        }
      >
        <Box
          sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}
        >
          {mintingFailed ? (
            <ReadError
              message={t('explorer:connections.failed.minting', cap)}
              onRetry={data.minting.retry}
            />
          ) : null}
          {namesFailed ? (
            <ReadError
              message={t('explorer:connections.failed.names', cap)}
              onRetry={data.names.retry}
            />
          ) : null}
          {levelMovesFailed ? (
            <ReadError
              message={t('explorer:connections.failed.level_moves', cap)}
              onRetry={data.retryFailed}
            />
          ) : null}
          {tradesFailed ? (
            <ReadError
              message={t('explorer:connections.failed.trades', cap)}
              onRetry={data.trades.retry}
            />
          ) : null}
          {onlineFailed ? (
            <ReadError
              message={t('explorer:connections.failed.online', cap)}
              onRetry={data.online.retry}
            />
          ) : null}
          {data.refreshFailed ? (
            <ReadError
              message={t('explorer:transactions.refresh_failed', cap)}
              onRetry={data.retryRefresh}
            />
          ) : null}
          {linksLoading || namesLoading ? (
            <LoadingLine label={t('explorer:connections.links_loading', cap)} />
          ) : null}
          {view === 'circle' && paymentsFailed ? (
            <ReadError
              message={t('explorer:connections.failed.payments', cap)}
              onRetry={data.payments.retry}
            />
          ) : null}
          {view === 'circle' && !data.settled ? (
            <LoadingLine label={t('explorer:circle.loading', cap)} />
          ) : null}
          {view === 'circle' && data.settled ? (
            <ConnectionsCircle
              address={address}
              recorded={searching ? recorded.filter(findFinding) : recorded}
              tagsOf={findingTags}
              actionOf={(finding) =>
                finding.kind === 'sponsees' ? (
                  <SponseesLink sponsor={address} own />
                ) : null
              }
              searched={searching ? typedText : null}
              gaps={{
                failed: data.failed.length > 0,
                refreshFailed: data.refreshFailed,
                short: !data.complete && !data.failed.length,
              }}
              onShowList={(order) => {
                // The list's payments in the circle's order.
                setPaySort(order === 'qort' ? 'total' : 'count');
                pickView('list');
              }}
            />
          ) : null}
          {view === 'list' && levelFound.length ? (
            <Part title={t('explorer:connections.part.level', cap)}>
              <Rows
                label={t('explorer:connections.part.level', cap)}
                stepKey="connRows:level"
                rows={levelFound.map(row)}
              />
            </Part>
          ) : null}
          {view === 'list' && sharesShown ? (
            <Part title={t('explorer:connections.part.shares', cap)}>
              {sharesFound.length ? (
                <Rows
                  label={t('explorer:connections.part.shares', cap)}
                  stepKey="connRows:shares"
                  rows={sharesFound.map(row)}
                />
              ) : null}
              {sponseesFound ? (
                <Box component="ul" sx={ROW_LIST_SX}>
                  {row(sponseesFound, <SponseesLink sponsor={address} own />)}
                </Box>
              ) : null}
              <Typography
                variant="body2"
                sx={(theme) => ({ color: mutedText(theme) })}
              >
                {t('explorer:connections.reward_share_note', cap)}
              </Typography>
            </Part>
          ) : null}
          {view === 'list' && namesFound.length ? (
            <Part title={t('explorer:connections.part.names', cap)}>
              <Rows
                label={t('explorer:connections.part.names', cap)}
                stepKey="connRows:names"
                rows={namesFound.map(row)}
              />
            </Part>
          ) : null}
          {view === 'list' &&
          (tradesFound.length || (tradesLeftOut && !searching)) ? (
            <Part title={t('explorer:connections.part.trades', cap)}>
              {tradesFound.length ? (
                <Rows
                  label={t('explorer:connections.part.trades', cap)}
                  stepKey="connRows:trades"
                  rows={tradesFound.map(row)}
                />
              ) : null}
              {tradesLeftOut && !searching ? (
                <Typography
                  variant="body2"
                  sx={(theme) => ({ color: mutedText(theme) })}
                >
                  {t('explorer:connections.trades_left_out', {
                    count: tradesLeftOut,
                    shown: formatCount(tradesLeftOut, language),
                    ...cap,
                  })}
                </Typography>
              ) : null}
            </Part>
          ) : null}
          {view === 'list' && paymentsShown ? (
            <Part title={t('explorer:connections.part.payments', cap)}>
              <PaymentsPanel
                address={address}
                data={data}
                tagsOf={tagsOf}
                find={searching ? findFlow : null}
                typed={typed.trim()}
              />
            </Part>
          ) : null}
        </Box>
      </Section>

      <InCommon
        address={address}
        funding={funding}
        sponsor={sponsor}
        common={common}
        entries={commonFound}
        searching={searching}
        sentPayments={Boolean(data.flowsSent?.length)}
      />

      {!searching && empty.length ? (
        <Typography
          variant="body2"
          sx={(theme) => ({
            color: mutedText(theme),
            overflowWrap: 'anywhere',
          })}
        >
          {t('explorer:connections.nothing_found', {
            list: listOf(empty),
            ...cap,
          })}
        </Typography>
      ) : null}
      {!searching && emptySoFar.length ? (
        <Typography
          variant="body2"
          sx={(theme) => ({
            color: mutedText(theme),
            overflowWrap: 'anywhere',
          })}
        >
          {t('explorer:connections.nothing_found_so_far', {
            list: listOf(emptySoFar),
            ...cap,
          })}
        </Typography>
      ) : null}
      {!searching ? <Coverage data={data} /> : null}

      <AccountReport
        account={account}
        sources={{ data, funding, sponsor, common, coreSponsor, findingTags }}
      />
    </>
  );
}

type ConnectionsView = 'list' | 'circle';

/** As tall as the search beside it. */
const VIEW_BUTTON = { gap: 0.75, minHeight: 40, px: 1.5 } as const;

/** Circle or list: what was recorded between them, drawn around the account or as text (Q-Mintership+'s toggle). */
function ConnectionsViewToggle({
  view,
  onView,
}: {
  view: ConnectionsView;
  onView: (view: ConnectionsView) => void;
}) {
  const { t } = useTranslation(['explorer']);
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={view}
      onChange={(_event, next: unknown) => {
        if (next === 'list' || next === 'circle') onView(next);
      }}
      aria-label={t('explorer:circle.view_label', cap)}
    >
      <ToggleButton value="list" sx={VIEW_BUTTON}>
        <ViewListRoundedIcon fontSize="small" aria-hidden />
        {t('explorer:circle.view_list', cap)}
      </ToggleButton>
      <ToggleButton value="circle" sx={VIEW_BUTTON}>
        <BubbleChartRoundedIcon fontSize="small" aria-hidden />
        {t('explorer:circle.view_circle', cap)}
      </ToggleButton>
    </ToggleButtonGroup>
  );
}
