/**
 * The Overview's notes, only when there are any: a minting penalty the
 * node recorded, and how its primary name is written (like an address,
 * starting or ending like its own address, holding characters a reader
 * can't see). Facts about the spelling, never a judgement of the person.
 */
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { formatCount } from '../../../lib/explorer/format';
import {
  nameNotes,
  visibleName,
  type NameNote,
} from '../../../lib/explorer/rules';
import { cap, isolate, panelSx, Section } from '../parts';

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

export function NotesSection({
  address,
  penalty,
  primary,
}: {
  address: string;
  penalty: number;
  primary: string | null;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const notes = primary ? nameNotes(primary, address) : [];
  if (!penalty && !notes.length) return null;
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
        </Box>
      </Box>
    </Section>
  );
}
