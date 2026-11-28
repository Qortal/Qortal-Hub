/**
 * The Overview's first line: the account in one line of facts, "Level 7 ·
 * Minter Admin, in MINTER · owns 3 names · first seen May 2025 · last sent
 * a transaction 3 days ago". "Owns 3 names" opens the Names tab. Facts
 * still loading show as a short skeleton at the end; a fact that failed is
 * left out here (its own section says so, with Retry). An account that
 * never sent anything has no "last sent".
 */
import { Fragment } from 'react';
import { Box, Skeleton, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { useTranslation } from 'react-i18next';
import {
  formatAgo,
  formatCount,
  formatMonthYear,
} from '../../../lib/explorer/format';
import type { BlockAt, LastSent, NamesOf } from '../../../lib/explorer/reads';
import type { MinterStanding } from '../../../lib/explorer/rules';
import { cap, InlineLink } from '../parts';

/** undefined while loading, null when it failed or doesn't apply. */
type Part<T> = T | null | undefined;

export function OverviewSummary({
  level,
  standing,
  names,
  firstSeen,
  lastSent,
  onShowNames,
}: {
  level: number;
  standing: Part<MinterStanding>;
  names: Part<NamesOf>;
  firstSeen: Part<BlockAt>;
  lastSent: Part<LastSent>;
  /** Open the Names tab: "owns 3 names" is its link. */
  onShowNames?: () => void;
}) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const language = i18n.language;
  const parts: Array<{ key: string; text: string; onClick?: () => void }> = [
    {
      key: 'level',
      text: t('core:account_lookup.chip_level', { level, ...cap }),
    },
  ];
  if (standing)
    parts.push({
      key: 'minter',
      text: t(`explorer:summary.minter_${standing}`),
    });
  if (names) {
    const count = names.names.length;
    parts.push({
      key: 'names',
      text:
        count === 0
          ? t('explorer:summary.no_names')
          : t(
              names.truncated
                ? 'explorer:summary.owns_names_more'
                : 'explorer:summary.owns_names',
              { count, shown: formatCount(count, language) }
            ),
      onClick: count > 0 ? onShowNames : undefined,
    });
  }
  if (firstSeen?.timestamp)
    parts.push({
      key: 'first',
      text: t('explorer:summary.first_seen', {
        date: formatMonthYear(firstSeen.timestamp, language),
      }),
    });
  if (lastSent)
    parts.push({
      key: 'last',
      text: t('explorer:summary.last_sent', {
        ago: formatAgo(lastSent.timestamp, language),
      }),
    });
  const loading = [standing, names, firstSeen, lastSent].some(
    (part) => part === undefined
  );
  return (
    <Typography
      component="p"
      sx={{ fontSize: '1.02rem', m: 0, overflowWrap: 'anywhere' }}
    >
      {parts.map((part, index) => (
        <Fragment key={part.key}>
          {index > 0 ? ' · ' : null}
          {part.onClick ? (
            <InlineLink type="button" onClick={part.onClick}>
              {part.text}
            </InlineLink>
          ) : (
            part.text
          )}
        </Fragment>
      ))}
      {loading ? (
        <>
          {' · '}
          <Skeleton
            variant="text"
            width={120}
            aria-hidden
            sx={{ display: 'inline-block', verticalAlign: 'middle' }}
          />
          <Box component="span" sx={visuallyHidden}>
            {t('core:loading.generic', cap)}
          </Box>
        </>
      ) : null}
    </Typography>
  );
}
