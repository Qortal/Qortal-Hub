/**
 * Compare → Timeline together: the firsts of every compared account in one
 * list, oldest first: where its first QORT came from, its primary name
 * (bought, or registered), its first self-share and its level moves. Each
 * line has its letter, what happened (told from that account's side), its
 * block (a link to the transaction) or its date; between lines, how far
 * apart they are. A list, not a chart: it reads the same in a narrow
 * window. What is still being read, what was read only in part, and a
 * read that failed are said, never left out as if nothing were there.
 */
import { Box, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { useTranslation } from 'react-i18next';
import { timelineGap, type TimelineEvent } from '../../../lib/explorer/compare';
import { formatCount, formatDay } from '../../../lib/explorer/format';
import { useExplorer } from '../ExplorerContext';
import {
  cap,
  InlineLink,
  LoadingLine,
  mutedText,
  ReadError,
  Section,
} from '../parts';
import { TxSentence } from '../transactions/TxSentence';
import { durationText, lettersText } from './compareWords';
import { LetterBadge } from './letters';
import type { CompareData } from './useCompareData';

function GapLine({
  previous,
  event,
}: {
  previous: TimelineEvent;
  event: TimelineEvent;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const gap = timelineGap(previous, event);
  const words =
    gap.kind === 'same_block'
      ? t('explorer:compare.timeline.same_block', cap)
      : gap.kind === 'blocks'
        ? t('explorer:compare.timeline.blocks_later', {
            count: gap.blocks,
            blocks: formatCount(gap.blocks, i18n.language),
            ...cap,
          })
        : gap.kind === 'moments'
          ? t('explorer:compare.timeline.moments_later', cap)
          : t('explorer:compare.timeline.time_later', {
              time: durationText(gap.ms, i18n.language),
              ...cap,
            });
  return (
    <Typography
      variant="body2"
      sx={(theme) => ({ color: mutedText(theme), fontStyle: 'italic', pl: 4 })}
    >
      {words}
    </Typography>
  );
}

function EventLine({
  event,
  accent,
}: {
  event: TimelineEvent;
  accent: string;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const { openTransaction } = useExplorer();
  const language = i18n.language;
  const when =
    event.height !== null
      ? t('explorer:compare.timeline.block', {
          block: formatCount(event.height, language),
        })
      : formatDay(event.timestamp, language);
  return (
    <Box
      sx={{ alignItems: 'flex-start', display: 'flex', gap: 1, minWidth: 0 }}
    >
      <LetterBadge letter={event.letter} accent={accent} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography component="div" sx={{ overflowWrap: 'anywhere' }}>
          {/* The badge is a picture: its letter, said. */}
          <Box component="span" sx={visuallyHidden}>
            {t('explorer:compare.timeline.who', { letter: event.letter })}{' '}
          </Box>
          <TxSentence sentence={event.sentence} />
        </Typography>
        <Typography
          variant="body2"
          sx={(theme) => ({
            alignItems: 'center',
            color: mutedText(theme),
            columnGap: 0.75,
            display: 'flex',
            flexWrap: 'wrap',
          })}
        >
          {event.signature ? (
            <InlineLink
              type="button"
              aria-label={t('explorer:compare.timeline.open', { when, ...cap })}
              onClick={() => openTransaction(event.signature as string)}
            >
              {when}
            </InlineLink>
          ) : (
            <span>{when}</span>
          )}
          {event.height !== null ? (
            <>
              <span aria-hidden>·</span>
              <span>{formatDay(event.timestamp, language)}</span>
            </>
          ) : null}
        </Typography>
      </Box>
    </Box>
  );
}

export function TimelineSection({
  data,
  accents,
}: {
  data: CompareData;
  accents: readonly string[];
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const events = data.timeline;
  const partial = data.live
    .filter(
      (side) =>
        side.coverage.minting === 'partial' || side.coverage.names === 'partial'
    )
    .map((side) => side.letter);
  const failedSides = data.live.filter(
    (side) =>
      (side.funding.status === 'error' && side.funding.data === undefined) ||
      (side.primary.status === 'error' && side.primary.data === undefined) ||
      // Its name is placed only after when it was first seen: never left out silently.
      (Boolean(side.primary.data) &&
        side.firstSeen.status === 'error' &&
        side.firstSeen.data === undefined) ||
      side.coverage.minting === 'failed' ||
      side.coverage.names === 'failed'
  );
  const failed = failedSides.length > 0 || data.records.failed.length > 0;
  const retry = () => {
    for (const side of failedSides) {
      if (side.funding.status === 'error') side.funding.retry();
      if (side.primary.status === 'error') side.primary.retry();
      if (side.firstSeen.status === 'error') side.firstSeen.retry();
      if (side.conn.failed.length) side.conn.retryFailed();
    }
    if (data.records.failed.length) data.records.retry();
  };
  if (!events.length && !data.timelineReading && !failed) return null;
  return (
    <Section
      id="explorer-compare-timeline"
      title={t('explorer:compare.timeline.title', cap)}
    >
      {events.length ? (
        <Box
          component="ol"
          aria-label={t('explorer:compare.timeline.label', cap)}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            listStyle: 'none',
            m: 0,
            minWidth: 0,
            p: 0,
          }}
        >
          {events.map((event, index) => (
            <Box component="li" key={event.key} sx={{ minWidth: 0 }}>
              {index > 0 ? (
                <GapLine previous={events[index - 1]} event={event} />
              ) : null}
              <EventLine
                event={event}
                accent={
                  accents[data.accounts.indexOf(event.address)] ?? accents[0]
                }
              />
            </Box>
          ))}
        </Box>
      ) : null}
      {data.timelineReading ? (
        <LoadingLine label={t('explorer:compare.timeline.reading', cap)} />
      ) : null}
      {partial.length ? (
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {t('explorer:compare.timeline.partial', {
            letters: lettersText(partial, i18n.language),
            ...cap,
          })}
        </Typography>
      ) : null}
      {failed ? (
        <ReadError
          message={t('explorer:compare.timeline.failed', cap)}
          onRetry={retry}
        />
      ) : null}
    </Section>
  );
}
