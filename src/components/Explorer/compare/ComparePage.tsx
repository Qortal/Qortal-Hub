/**
 * Compare: two to four accounts side by side, lettered A–D (from
 * Q-Mintership+'s ComparePage), for a viewer the level 5+ rule lets in
 * (SetStepView shows the account it was about to anyone else). Evidence
 * only, under the Explorer's line about what links mean:
 *
 * 1. the accounts (cards with Remove), and a field for one more;
 * 2. Recorded between them, pair by pair;
 * 3. Timeline together;
 * 4. In common;
 * 5. Side by side;
 * 6. what was read of each account, with Read older.
 *
 * The accounts are the comparison: Remove and Add open a new step (Back
 * returns to the one before), one already compared is said instead, and
 * the accounts picked to compare follow the step on screen. Reads are in
 * useCompareData.ts. Read-only: nothing here writes.
 */
import { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useExplorer, useNearScreen } from '../ExplorerContext';
import { cap, mutedText } from '../parts';
import { CompareCards } from './CompareCards';
import { useCompareSteps } from './compareSteps';
import { InCommonSection } from './InCommonSection';
import { useLetterAccents } from './letters';
import { CompareCoverage, PairsSection } from './PairsSection';
import { SideBySide } from './SideBySide';
import { TimelineSection } from './TimelineSection';
import { useAccountLookup } from './useAccountLookup';
import { useCompareData } from './useCompareData';

export function ComparePage({
  accounts,
  about,
}: {
  accounts: readonly string[];
  about: string;
}) {
  const { t } = useTranslation(['explorer']);
  const { openAccount } = useExplorer();
  const { openCompare, setPicks } = useCompareSteps();
  const accents = useLetterAccents();

  const [belowNode, setBelowNode] = useState<HTMLElement | null>(null);
  const below = useNearScreen(belowNode);
  const [sideNode, setSideNode] = useState<HTMLElement | null>(null);
  const side = useNearScreen(sideNode);
  const data = useCompareData(accounts, { below, side });

  // The accounts picked to compare follow the comparison on screen.
  const joined = accounts.join(' ');
  useEffect(() => {
    setPicks(joined.split(' '));
  }, [joined, setPicks]);

  const remove = (address: string) => {
    const left = accounts.filter((each) => each !== address);
    if (left.length >= 2)
      openCompare(left, left.includes(about) ? about : left[0]);
    else if (left.length === 1) openAccount(left[0], { fromExplorer: true });
  };
  // The accounts picked that can be compared: all but those the node says
  // aren't accounts (never used, not valid). One still being read, or whose
  // read failed (its card says so, with Retry), is still compared.
  const comparable = data.sides.filter((side) => {
    const kind = side.explored.data?.kind;
    return kind === undefined || kind === 'account';
  }).length;
  const { lookUp, note, say } = useAccountLookup((address) => {
    const at = accounts.indexOf(address);
    if (at >= 0)
      say({
        key: 'explorer:compare.add.already',
        options: { letter: data.sides[at]?.letter ?? '' },
      });
    // With four compared there is no field (CompareCards says why).
    else openCompare([...accounts, address], about);
  });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Typography
          component="h2"
          sx={{
            fontSize: { xs: '1.15rem', sm: '1.3rem' },
            fontWeight: 700,
            lineHeight: 1.25,
          }}
        >
          {t('explorer:compare.title', cap)}
        </Typography>
        <Typography
          role="note"
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {t('explorer:compare.neutral', cap)}
        </Typography>
      </Box>
      <CompareCards
        data={data}
        accents={accents}
        onRemove={remove}
        onAdd={lookUp}
        note={note}
      />
      {comparable < 2 ? (
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {t('explorer:compare.add.more', cap)}
        </Typography>
      ) : data.live.length < 2 ? null : (
        <>
          <PairsSection data={data} accents={accents} />
          <Box
            ref={setBelowNode}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              minWidth: 0,
            }}
          >
            <TimelineSection data={data} accents={accents} />
            <InCommonSection data={data} />
          </Box>
          <Box ref={setSideNode} sx={{ minWidth: 0 }}>
            <SideBySide data={data} accents={accents} />
          </Box>
          <CompareCoverage data={data} accents={accents} />
        </>
      )}
    </Box>
  );
}
