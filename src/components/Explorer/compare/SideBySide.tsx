/**
 * Compare → Side by side: a table, the accounts as its columns (each
 * column's header its letter and name) and a row per fact (sideRows.ts).
 * In a narrow window the columns stack: each fact is a block, its label
 * then one line per account, with its letter (container queries, so it
 * follows the Explorer window's own width, not the screen's). A fact the
 * same for every account reads "Same for all" once. A read that failed
 * says "couldn't read" in its cell, and one line says so, with Retry.
 */
import { Box, Skeleton, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { useTranslation } from 'react-i18next';
import { useAccountLabel } from '../connections/ConnectionRow';
import { cap, mutedText, ReadError, Section } from '../parts';
import { TxSentence } from '../transactions/TxSentence';
import { LetterBadge } from './letters';
import { sameForAll, sideRows, type SideCell } from './sideRows';
import type { CompareData, CompareSideData } from './useCompareData';

/** Narrower than this, the columns stack. */
const STACK_BELOW = 640;

function Cell({ cell }: { cell: SideCell | undefined }) {
  const { t } = useTranslation(['core', 'explorer']);
  if (!cell)
    return (
      <>
        <Skeleton variant="text" width={80} aria-hidden />
        <Box component="span" sx={visuallyHidden}>
          {t('core:loading.generic', cap)}
        </Box>
      </>
    );
  if (cell.sentence)
    return (
      <Box component="span" sx={{ overflowWrap: 'anywhere' }}>
        <TxSentence sentence={cell.sentence} />
      </Box>
    );
  return (
    <Box
      component="span"
      sx={(theme) => ({
        overflowWrap: 'anywhere',
        ...(cell.failed
          ? { color: mutedText(theme), fontStyle: 'italic' }
          : {}),
      })}
    >
      {cell.words ? t(cell.words.key, { ...cell.words.options, ...cap }) : null}
    </Box>
  );
}

function ColumnName({
  side,
  accent,
}: {
  side: CompareSideData;
  accent: string;
}) {
  const { label } = useAccountLabel(side.address, true);
  return (
    <Box sx={{ alignItems: 'center', display: 'flex', gap: 1, minWidth: 0 }}>
      <LetterBadge letter={side.letter} accent={accent} size={22} />
      <Box
        component="bdi"
        dir="auto"
        sx={{ fontWeight: 700, minWidth: 0, overflowWrap: 'anywhere' }}
      >
        {label}
      </Box>
    </Box>
  );
}

const CELL_SX = (theme: Parameters<typeof mutedText>[0]) => ({
  borderBottom: `1px solid ${theme.palette.divider}`,
  fontSize: '0.875rem',
  minWidth: 0,
  px: 1,
  py: 0.75,
  textAlign: 'start' as const,
  verticalAlign: 'top',
});

export function SideBySide({
  data,
  accents,
}: {
  data: CompareData;
  accents: readonly string[];
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const columns = data.live;
  const rows = sideRows(columns, data.online, i18n.language);
  const failed = columns.filter((side) =>
    [
      side.names,
      side.primary,
      side.funding,
      side.firstSeen,
      side.balance,
      side.lastSent,
      side.groups,
    ].some((read) => read.status === 'error' && read.data === undefined)
  );
  const onlineFailed =
    data.online?.status === 'error' && data.online.data === undefined;
  const retry = () => {
    for (const side of failed)
      for (const read of [
        side.names,
        side.primary,
        side.funding,
        side.firstSeen,
        side.balance,
        side.lastSent,
        side.groups,
      ])
        if (read.status === 'error') read.retry();
    if (onlineFailed) data.online?.retry();
  };
  if (columns.length < 2) return null;
  return (
    <Section
      id="explorer-compare-side"
      title={t('explorer:compare.side.title', cap)}
    >
      <Box sx={{ containerType: 'inline-size', minWidth: 0 }}>
        <Box
          component="table"
          role="table"
          sx={(theme) => ({
            borderCollapse: 'collapse',
            tableLayout: 'fixed',
            width: '100%',
            '& [data-letter]': { display: 'none' },
            [`@container (max-width: ${STACK_BELOW}px)`]: {
              '&, & tbody, & tr, & th, & td': { display: 'block' },
              '& thead': visuallyHidden,
              '& tr': {
                borderBottom: `1px solid ${theme.palette.divider}`,
                py: 0.75,
              },
              '& th, & td': { border: 0, px: 0, py: 0.25 },
              '& [data-letter]': {
                alignItems: 'flex-start',
                display: 'inline-flex',
                mr: 0.75,
              },
              '& td': { alignItems: 'flex-start', display: 'flex' },
            },
          })}
        >
          <Box component="caption" sx={visuallyHidden}>
            {t('explorer:compare.side.caption', cap)}
          </Box>
          <thead>
            <tr role="row">
              <Box
                component="th"
                scope="col"
                role="columnheader"
                sx={(theme) => ({ ...CELL_SX(theme), width: '24%' })}
              >
                <Box component="span" sx={visuallyHidden}>
                  {t('explorer:compare.side.fact', cap)}
                </Box>
              </Box>
              {columns.map((side) => (
                <Box
                  component="th"
                  scope="col"
                  role="columnheader"
                  key={side.address}
                  sx={CELL_SX}
                >
                  <ColumnName side={side} accent={accents[side.index]} />
                </Box>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const same = sameForAll(row.cells);
              return (
                <tr key={row.key} role="row">
                  <Box
                    component="th"
                    scope="row"
                    role="rowheader"
                    sx={(theme) => ({
                      ...CELL_SX(theme),
                      color: mutedText(theme),
                      fontWeight: 600,
                    })}
                  >
                    {t(row.label, cap)}
                  </Box>
                  {same ? (
                    <Box
                      component="td"
                      role="cell"
                      colSpan={columns.length}
                      sx={CELL_SX}
                    >
                      <Box
                        component="span"
                        sx={(theme) => ({ color: mutedText(theme) })}
                      >
                        {t('explorer:compare.side.same', cap)}
                      </Box>{' '}
                      <Cell cell={same} />
                    </Box>
                  ) : (
                    row.cells.map((cell, index) => (
                      <Box
                        component="td"
                        role="cell"
                        key={columns[index].address}
                        sx={CELL_SX}
                      >
                        <Box component="span" data-letter="">
                          <LetterBadge
                            letter={columns[index].letter}
                            accent={accents[columns[index].index]}
                            size={20}
                          />
                        </Box>
                        <Box component="span" sx={visuallyHidden}>
                          {t('explorer:compare.side.of', {
                            letter: columns[index].letter,
                          })}{' '}
                        </Box>
                        <Cell cell={cell} />
                      </Box>
                    ))
                  )}
                </tr>
              );
            })}
          </tbody>
        </Box>
      </Box>
      {failed.length || onlineFailed ? (
        <ReadError
          message={t('explorer:compare.side.failed_line', cap)}
          onRetry={retry}
        />
      ) : null}
    </Section>
  );
}
