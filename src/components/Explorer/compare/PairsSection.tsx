/**
 * Compare → Recorded between them, pair by pair: each finding the
 * Connections tab's own sentence, told by the account that did it (its
 * picture and name first, opening it), when, and what stands behind it
 * (the transactions, or a trade's two orders), opening as the
 * Transactions tab's rows. Under each pair, what was checked and found
 * nothing (only from reads that reached their end), what was read only in
 * part, and what is still being read. The reads that failed are one line
 * with one Retry, never "nothing found"; below, how far each account's
 * lists were read, with Read older.
 */
import { useId, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { useTranslation } from 'react-i18next';
import {
  PAIR_CHECKS,
  saleTimeKnown,
  type CheckState,
  type PairCheck,
  type PairFinding,
  type PortalFinding,
} from '../../../lib/explorer/compare';
import {
  formatAmountExact,
  formatCount,
  formatDay,
  formatList,
} from '../../../lib/explorer/format';
import type { ConnectionsPart } from '../connections/useConnections';
import {
  EvidenceBySignatures,
  EvidenceList,
  evidenceWords,
  PersonButton,
  ROW_LIST_SX,
  useAccountLabel,
  whenText,
} from '../connections/ConnectionRow';
import { Coverage } from '../connections/ConnectionsTab';
import { useExplorer, useNearScreen, useStepState } from '../ExplorerContext';
import {
  cap,
  InlineLink,
  isolate,
  mutedText,
  ReadError,
  Section,
} from '../parts';
import { TxSentence } from '../transactions/TxSentence';
import { LetterBadge } from './letters';
import type { CompareData, CompareSideData, PairData } from './useCompareData';

/** A check in words. */
const CHECK_KEYS: Readonly<Record<PairCheck, string>> = {
  payments: 'explorer:compare.check.payments',
  reward_shares: 'explorer:compare.check.reward_shares',
  level_moves: 'explorer:connections.empty.level_moves',
  name_sales: 'explorer:connections.empty.name_sales',
  asset_trades: 'explorer:connections.empty.asset_trades',
  portal_trades: 'explorer:compare.check.portal_trades',
};

const SUBHEAD_SX = {
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  fontSize: '0.95rem',
  fontWeight: 700,
  gap: 0.75,
  lineHeight: 1.3,
  m: 0,
} as const;

function PairRow({
  item,
  side,
  other,
  accent,
  pairId,
}: {
  item: PairFinding;
  /** The account that did it. */
  side: CompareSideData;
  other: CompareSideData;
  accent: string;
  pairId: string;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const [node, setNode] = useState<HTMLElement | null>(null);
  const near = useNearScreen(node);
  const { finding } = item;
  const rowKey = `cmp:${pairId}:${item.actor}:${finding.key}`;
  const [open, setOpen] = useStepState<boolean>(rowKey, false);
  const id = useId();
  const actor = useAccountLabel(side.address, near).label;
  const otherLabel = useAccountLabel(other.address, near).label;
  const count = finding.evidenceSignatures?.length ?? finding.evidence.length;
  const words = evidenceWords(finding.evidenceKind, count, t, language);
  // Names in a label as they are: a screen reader doesn't need them isolated.
  const names = { words, actor, other: otherLabel };
  return (
    <Box
      component="li"
      ref={setNode}
      sx={(theme) => ({
        backgroundColor: theme.palette.background.elevated,
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        minWidth: 0,
        px: 1.5,
        py: 1.25,
      })}
    >
      <Box
        sx={{ alignItems: 'center', display: 'flex', gap: 0.75, minWidth: 0 }}
      >
        <LetterBadge letter={side.letter} accent={accent} size={22} />
        <PersonButton address={side.address} near={near} />
      </Box>
      <Box
        sx={{
          alignItems: 'flex-end',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1,
          justifyContent: 'space-between',
          minWidth: 0,
        }}
      >
        <Typography
          component="div"
          sx={{
            flex: '1 1 260px',
            fontSize: '0.95rem',
            lineHeight: 1.45,
            minWidth: 0,
            overflowWrap: 'anywhere',
          }}
        >
          <TxSentence sentence={finding.sentence} near={near} />
          <Box
            component="span"
            sx={(theme) => ({
              color: mutedText(theme),
              display: 'inline-block',
              fontSize: '0.8rem',
              ml: 0.75,
            })}
          >
            <span aria-hidden>· </span>
            {whenText(finding, t, language)}
          </Box>
        </Typography>
        {count ? (
          <Button
            size="small"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls={open ? id : undefined}
            aria-label={t('explorer:compare.recorded.show', {
              ...names,
              ...cap,
            })}
            endIcon={
              <ExpandMoreRoundedIcon
                sx={{
                  transform: open ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.15s',
                }}
              />
            }
            sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
          >
            {words}
          </Button>
        ) : null}
      </Box>
      {count && open ? (
        <Box id={id} sx={{ minWidth: 0 }}>
          {finding.evidenceSignatures ? (
            <EvidenceBySignatures
              signatures={finding.evidenceSignatures}
              viewpoint={side.address}
              stepKey={rowKey}
              label={t('explorer:compare.recorded.list', { ...names, ...cap })}
            />
          ) : (
            <EvidenceList
              txs={finding.evidence}
              viewpoint={side.address}
              stepKey={rowKey}
              label={t('explorer:compare.recorded.list', { ...names, ...cap })}
            />
          )}
        </Box>
      ) : null}
    </Box>
  );
}

/**
 * What one sold the other on the trade portal: opening to each sale, with
 * its AT. A sale Core gave no time says so, and is never given a date.
 */
function PortalRow({
  item,
  side,
  other,
  accent,
  pairId,
}: {
  item: PortalFinding;
  side: CompareSideData;
  other: CompareSideData;
  accent: string;
  pairId: string;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const { openAccount } = useExplorer();
  const [node, setNode] = useState<HTMLElement | null>(null);
  const near = useNearScreen(node);
  const rowKey = `cmp:${pairId}:${item.key}`;
  const [open, setOpen] = useStepState<boolean>(rowKey, false);
  const id = useId();
  const actor = useAccountLabel(side.address, near).label;
  const otherLabel = useAccountLabel(other.address, near).label;
  const count = item.trades.length;
  const words = String(
    t('explorer:compare.portal.trades', {
      count,
      shown: formatCount(count, language),
    })
  );
  const names = { words, actor, other: otherLabel };
  // When: from the sales with a time, and how many have none.
  const untimed = item.trades.filter(
    (trade) => !saleTimeKnown(trade.timestamp)
  ).length;
  const timed = saleTimeKnown(item.timestamp)
    ? whenText(
        {
          height: 0,
          timestamp: item.timestamp,
          firstTimestamp: item.firstTimestamp,
        },
        t,
        language
      )
    : null;
  const when =
    timed === null
      ? String(t('explorer:compare.portal.when_unknown'))
      : untimed
        ? String(
            t('explorer:compare.portal.when_some_unknown', {
              when: timed,
              count: untimed,
              shown: formatCount(untimed, language),
            })
          )
        : timed;
  return (
    <Box
      component="li"
      ref={setNode}
      sx={(theme) => ({
        backgroundColor: theme.palette.background.elevated,
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        minWidth: 0,
        px: 1.5,
        py: 1.25,
      })}
    >
      <Box
        sx={{ alignItems: 'center', display: 'flex', gap: 0.75, minWidth: 0 }}
      >
        <LetterBadge letter={side.letter} accent={accent} size={22} />
        <PersonButton address={side.address} near={near} />
      </Box>
      <Box
        sx={{
          alignItems: 'flex-end',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1,
          justifyContent: 'space-between',
          minWidth: 0,
        }}
      >
        <Typography
          component="div"
          sx={{
            flex: '1 1 260px',
            fontSize: '0.95rem',
            lineHeight: 1.45,
            minWidth: 0,
            overflowWrap: 'anywhere',
          }}
        >
          <TxSentence sentence={item.sentence} near={near} />
          <Box
            component="span"
            sx={(theme) => ({
              color: mutedText(theme),
              display: 'inline-block',
              fontSize: '0.8rem',
              ml: 0.75,
            })}
          >
            <span aria-hidden>· </span>
            {when}
          </Box>
        </Typography>
        <Button
          size="small"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          aria-label={t('explorer:compare.recorded.show', { ...names, ...cap })}
          endIcon={
            <ExpandMoreRoundedIcon
              sx={{
                transform: open ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.15s',
              }}
            />
          }
          sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          {words}
        </Button>
      </Box>
      {open ? (
        <Box
          id={id}
          component="ul"
          aria-label={t('explorer:compare.recorded.list', { ...names, ...cap })}
          sx={(theme) => ({
            borderLeft: `2px solid ${theme.palette.divider}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.5,
            listStyle: 'none',
            m: 0,
            mt: 0.5,
            minWidth: 0,
            pl: 1,
          })}
        >
          {item.trades.map((trade, index) => (
            <Typography
              component="li"
              variant="body2"
              key={`${trade.atAddress ?? index}:${trade.timestamp}`}
              sx={{ overflowWrap: 'anywhere' }}
            >
              {saleTimeKnown(trade.timestamp)
                ? t('explorer:compare.portal.row', {
                    amount: formatAmountExact(trade.qortAmount, language),
                    date: formatDay(trade.timestamp, language),
                  })
                : t('explorer:compare.portal.row_no_time', {
                    amount: formatAmountExact(trade.qortAmount, language),
                  })}
              {trade.atAddress ? (
                <>
                  {' · '}
                  <InlineLink
                    type="button"
                    onClick={() =>
                      openAccount(trade.atAddress as string, {
                        fromExplorer: true,
                      })
                    }
                  >
                    {t('explorer:connections.at_label', {
                      address: `${trade.atAddress.slice(0, 6)}…`,
                    })}
                  </InlineLink>
                </>
              ) : null}
            </Typography>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

/** One pair: its findings, then what it checked. */
function PairBlock({
  pair,
  accents,
}: {
  pair: PairData;
  accents: readonly string[];
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const headingId = useId();
  const { x, y } = pair;
  const xLabel = useAccountLabel(x.address, true).label;
  const yLabel = useAccountLabel(y.address, true).label;
  const heading = t('explorer:compare.recorded.pair', {
    a: isolate(xLabel),
    b: isolate(yLabel),
    ...cap,
  });
  const listLabel = t('explorer:compare.recorded.pair', {
    a: xLabel,
    b: yLabel,
    ...cap,
  });
  const by = (state: CheckState) =>
    PAIR_CHECKS.filter((check) => pair.checks[check] === state);
  const words = (checks: readonly PairCheck[]) =>
    formatList(
      checks.map((check) => String(t(CHECK_KEYS[check]))),
      language
    );
  const none = by('none');
  const soFar = by('none_so_far');
  const reading = by('reading');
  const sideOf = (address: string) => (address === x.address ? x : y);
  return (
    <Box
      component="section"
      aria-labelledby={headingId}
      sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}
    >
      <Typography id={headingId} component="h4" sx={SUBHEAD_SX}>
        <Box component="span" sx={{ display: 'inline-flex', gap: 0.25 }}>
          <LetterBadge letter={x.letter} accent={accents[x.index]} size={22} />
          <LetterBadge letter={y.letter} accent={accents[y.index]} size={22} />
        </Box>
        <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          {heading}
        </Box>
      </Typography>
      {pair.findings.length || pair.portal.length ? (
        <Box component="ul" aria-label={listLabel} sx={ROW_LIST_SX}>
          {pair.findings.map((item) => {
            const side = sideOf(item.actor);
            return (
              <PairRow
                key={`${item.actor}:${item.finding.key}`}
                item={item}
                side={side}
                other={sideOf(item.other)}
                accent={accents[side.index]}
                pairId={pair.pair.id}
              />
            );
          })}
          {pair.portal.map((item) => {
            const side = sideOf(item.actor);
            return (
              <PortalRow
                key={item.key}
                item={item}
                side={side}
                other={sideOf(item.other)}
                accent={accents[side.index]}
                pairId={pair.pair.id}
              />
            );
          })}
        </Box>
      ) : null}
      {[
        none.length
          ? t('explorer:compare.none', { list: words(none), ...cap })
          : null,
        soFar.length
          ? t('explorer:compare.none_so_far', {
              list: words(soFar),
              ...cap,
            })
          : null,
        reading.length
          ? t('explorer:compare.reading', {
              list: words(reading),
              ...cap,
            })
          : null,
      ]
        .filter(Boolean)
        .map((line) => (
          <Typography
            key={line as string}
            variant="body2"
            sx={(theme) => ({
              color: mutedText(theme),
              overflowWrap: 'anywhere',
            })}
          >
            {line}
          </Typography>
        ))}
    </Box>
  );
}

/** What failed for each account and pair, named, and the way to read it all again. */
function useFailures(data: CompareData) {
  const { t, i18n } = useTranslation(['explorer']);
  const parts: string[] = [];
  let online = false;
  for (const side of data.live)
    for (const part of side.conn.failed as ConnectionsPart[]) {
      if (part === 'online') {
        online = true;
        continue;
      }
      parts.push(
        String(
          t('explorer:compare.failed.of', {
            part: t(`explorer:connections.unread.${part}`),
            letter: side.letter,
          })
        )
      );
    }
  for (const side of data.live)
    if (side.coverage.portal === 'failed')
      parts.push(
        String(
          t('explorer:compare.failed.of', {
            part: t('explorer:compare.failed.portal'),
            letter: side.letter,
          })
        )
      );
  if (online) parts.push(String(t('explorer:connections.unread.online')));
  for (const pair of data.pairs)
    if (pair.pairFailed)
      parts.push(
        String(
          t('explorer:compare.failed.pair_payments', {
            a: pair.x.letter,
            b: pair.y.letter,
          })
        )
      );
  const retry = () => {
    for (const side of data.live) {
      if (side.conn.failed.length) side.conn.retryFailed();
      if (side.coverage.portal === 'failed') side.portal.retry();
    }
    if (data.pairReads.failed.length) data.pairReads.retry();
  };
  return {
    message: parts.length
      ? String(
          t('explorer:compare.failed.list', {
            list: formatList(parts, i18n.language),
            ...cap,
          })
        )
      : null,
    retry,
  };
}

export function PairsSection({
  data,
  accents,
}: {
  data: CompareData;
  accents: readonly string[];
}) {
  const { t } = useTranslation(['explorer']);
  const failures = useFailures(data);
  const refreshFailed = data.live.filter((side) => side.conn.refreshFailed);
  const exact = data.pairs.every(
    (pair) => pair.xy !== null && pair.yx !== null
  );
  return (
    <Section
      id="explorer-compare-recorded"
      title={t('explorer:compare.recorded.title', cap)}
    >
      <Typography variant="body2" sx={(theme) => ({ color: mutedText(theme) })}>
        {exact
          ? t('explorer:compare.recorded.note', cap)
          : t('explorer:compare.recorded.note_lists', cap)}
      </Typography>
      {failures.message ? (
        <ReadError message={failures.message} onRetry={failures.retry} />
      ) : null}
      {refreshFailed.length ? (
        <ReadError
          message={t('explorer:transactions.refresh_failed', cap)}
          onRetry={() =>
            refreshFailed.forEach((side) => side.conn.retryRefresh())
          }
        />
      ) : null}
      <Box
        sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, minWidth: 0 }}
      >
        {data.pairs.map((pair) => (
          <PairBlock key={pair.pair.id} pair={pair} accents={accents} />
        ))}
      </Box>
    </Section>
  );
}

/** How far each account's lists were read, with Read older (the Connections tab's own lines). */
export function CompareCoverage({
  data,
  accents,
}: {
  data: CompareData;
  accents: readonly string[];
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const more = data.pairs.filter((pair) => pair.xy?.more || pair.yx?.more);
  if (!data.live.length) return null;
  return (
    <Section
      id="explorer-compare-read"
      title={t('explorer:compare.coverage.title', cap)}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
          minWidth: 0,
        }}
      >
        {data.live.map((side) => (
          <Box
            key={side.address}
            sx={{
              alignItems: 'flex-start',
              display: 'flex',
              gap: 1,
              minWidth: 0,
            }}
          >
            <LetterBadge
              letter={side.letter}
              accent={accents[side.index]}
              size={22}
            />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                component="span"
                sx={(theme) => ({
                  color: mutedText(theme),
                  fontSize: '0.8rem',
                  fontWeight: 600,
                })}
              >
                {t('explorer:compare.card.letter', {
                  letter: side.letter,
                  ...cap,
                })}
              </Typography>
              <Coverage data={side.conn} />
            </Box>
          </Box>
        ))}
        {more.length ? (
          <Typography
            variant="body2"
            sx={(theme) => ({ color: mutedText(theme) })}
          >
            {t('explorer:compare.coverage.pairs_more', {
              pairs: formatList(
                more.map((pair) =>
                  String(
                    t('explorer:compare.coverage.pair', {
                      a: pair.x.letter,
                      b: pair.y.letter,
                    })
                  )
                ),
                i18n.language
              ),
              ...cap,
            })}
          </Typography>
        ) : null}
      </Box>
    </Section>
  );
}
