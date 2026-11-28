/**
 * The Overview's notes, only when there are any: a minting penalty the
 * node recorded, how its primary name is written (like an address,
 * starting or ending like its own address, holding characters a reader
 * can't see), and how many of its other names have such notes, as a link
 * to the Names tab, which shows them. Facts about the spelling, never a
 * judgement of the person.
 */
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { formatCount } from '../../../lib/explorer/format';
import {
  namesWithNotes,
  type NamesWithNotes,
} from '../../../lib/explorer/names';
import type { NamesOf } from '../../../lib/explorer/reads';
import {
  nameNotes,
  visibleName,
  type NameNote,
} from '../../../lib/explorer/rules';
import { cap, InlineLink, isolate, panelSx, Section } from '../parts';

function noteText(
  note: NameNote,
  name: string,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const shown = isolate(visibleName(name));
  switch (note.kind) {
    case 'addressLike':
      return t('explorer:notes.name_address_like', { name: shown, ...cap });
    case 'ownerPrefix':
      return t('explorer:notes.name_owner_start', {
        name: shown,
        start: note.start,
        ...cap,
      });
    case 'ownerSuffix':
      return t('explorer:notes.name_owner_end', {
        name: shown,
        end: note.end,
        ...cap,
      });
    case 'invisible':
      if (note.count === 1)
        return t('explorer:notes.name_invisible_single', {
          name: shown,
          ...cap,
        });
      return t('explorer:notes.name_invisible', {
        name: shown,
        count: note.count,
        ...cap,
      });
  }
}

/** "2 of its 29 other names have notes", "Its other name has notes", … */
function otherNamesText(
  found: NamesWithNotes,
  t: (key: string, options?: Record<string, unknown>) => string,
  language: string
): string {
  if (found.total === 1)
    return t(
      found.besidePrimary
        ? 'explorer:notes.other_name_only'
        : 'explorer:notes.only_name',
      cap
    );
  const key = found.besidePrimary
    ? found.listed
      ? 'explorer:notes.other_names_listed'
      : 'explorer:notes.other_names'
    : found.listed
      ? 'explorer:notes.names_listed'
      : 'explorer:notes.names';
  return t(key, {
    count: found.withNotes,
    shown: formatCount(found.withNotes, language),
    total: formatCount(found.total, language),
    ...cap,
  });
}

export function NotesSection({
  address,
  penalty,
  primary,
  names,
  onShowNames,
}: {
  address: string;
  penalty: number;
  /** Its primary name: undefined while it isn't known, null for none. */
  primary: string | null | undefined;
  /** Its names, once read. */
  names: NamesOf | undefined;
  /** Open the Names tab. */
  onShowNames: () => void;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const notes = primary ? nameNotes(primary, address) : [];
  const others = names ? namesWithNotes(names, primary, address) : null;
  if (!penalty && !notes.length && !others) return null;
  return (
    <Section id="explorer-notes" title={t('explorer:notes.title', cap)}>
      <Box sx={panelSx}>
        <Box
          component="ul"
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            m: 0,
            pl: 2.5,
          }}
        >
          {penalty ? (
            <li>
              <Typography>
                {t('explorer:notes.penalty', {
                  blocks: `${penalty > 0 ? '+' : '−'}${formatCount(Math.abs(penalty), i18n.language)}`,
                  ...cap,
                })}
              </Typography>
            </li>
          ) : null}
          {primary
            ? notes.map((note) => (
                <li key={note.kind}>
                  <Typography sx={{ overflowWrap: 'anywhere' }}>
                    {noteText(note, primary, t)}
                  </Typography>
                </li>
              ))
            : null}
          {others ? (
            <li>
              <Typography>
                <InlineLink type="button" onClick={onShowNames}>
                  {otherNamesText(others, t, i18n.language)}
                </InlineLink>
              </Typography>
            </li>
          ) : null}
        </Box>
      </Box>
    </Section>
  );
}
