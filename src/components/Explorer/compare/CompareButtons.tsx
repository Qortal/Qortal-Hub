/**
 * The account header's Compare buttons, for a viewer the level 5+ rule
 * lets in (nothing for anyone else, and nothing says anything is left
 * out):
 *
 * - "Add to compare" picks the account (up to 4), or takes it out; a line
 *   under the buttons says what happened, with "Compare now" once two or
 *   more are picked, and a 5th is refused in words.
 * - "Compare with…" opens the Explorer's search in a dialog: the account
 *   found there opens side by side with this one; this same account is
 *   said instead.
 */
import { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CompareArrowsRoundedIcon from '@mui/icons-material/CompareArrowsRounded';
import PlaylistAddCheckRoundedIcon from '@mui/icons-material/PlaylistAddCheckRounded';
import PlaylistAddRoundedIcon from '@mui/icons-material/PlaylistAddRounded';
import { useTranslation } from 'react-i18next';
import { COMPARE_MAX } from '../../../lib/explorer/comparePicks';
import { ExplorerSearchField } from '../ExplorerSearchField';
import { cap, isolate, mutedText } from '../parts';
import { useExplorerAccess } from '../useExplorerAccess';
import { useCompareSteps } from './compareSteps';
import { useAccountLookup } from './useAccountLookup';

interface Said {
  key: string;
  options?: Record<string, unknown>;
  /** Offer "Compare now". */
  compare?: boolean;
}

function CompareWith({ address, label }: { address: string; label: string }) {
  const { t } = useTranslation(['core', 'explorer']);
  const { openCompare } = useCompareSteps();
  const [open, setOpen] = useState(false);
  const { lookUp, note, say } = useAccountLookup((picked) => {
    if (picked === address) {
      say({ key: 'explorer:compare.with.same' });
      return;
    }
    setOpen(false);
    openCompare([address, picked], address);
  });
  const close = () => {
    say(null);
    setOpen(false);
  };
  return (
    <>
      <Button
        variant="outlined"
        size="small"
        startIcon={<CompareArrowsRoundedIcon />}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {t('explorer:compare.with.button', cap)}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        fullWidth
        maxWidth="sm"
        aria-labelledby="explorer-compare-with-title"
      >
        <DialogTitle
          id="explorer-compare-with-title"
          sx={{ alignItems: 'center', display: 'flex', gap: 1, pr: 1 }}
        >
          <Box component="span" sx={{ flex: 1 }}>
            {t('explorer:compare.with.title', cap)}
          </Box>
          <IconButton
            size="small"
            aria-label={t('core:action.close', cap)}
            onClick={close}
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
        >
          <Typography sx={{ overflowWrap: 'anywhere' }}>
            {t('explorer:compare.with.lead', { name: isolate(label), ...cap })}
          </Typography>
          <ExplorerSearchField
            compact
            autoFocus
            placeholder={t('explorer:compare.with.field', cap)}
            onLookUp={lookUp}
          />
          <Typography
            role="status"
            variant="body2"
            sx={(theme) => ({ color: mutedText(theme), minHeight: 20 })}
          >
            {note ? t(note.key, { ...note.options, ...cap }) : ''}
          </Typography>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CompareToggle({ address, label }: { address: string; label: string }) {
  const { t } = useTranslation(['explorer']);
  const { picks, togglePick, openCompare } = useCompareSteps();
  const [said, setSaid] = useState<Said | null>(null);
  const picked = picks.includes(address);

  const toggle = () => {
    const result = togglePick(address);
    if (result === 'full') setSaid({ key: 'explorer:compare.add.full' });
    else if (result === 'removed')
      setSaid({ key: 'explorer:compare.toggle.removed' });
    else if (result === 'added') {
      const count = picks.length + 1;
      setSaid({
        key: 'explorer:compare.toggle.added',
        options: { picked: count, max: COMPARE_MAX },
        compare: count >= 2,
      });
    }
  };

  return (
    <>
      <Button
        variant={picked ? 'contained' : 'outlined'}
        size="small"
        startIcon={
          picked ? <PlaylistAddCheckRoundedIcon /> : <PlaylistAddRoundedIcon />
        }
        aria-pressed={picked}
        // Its words, then whose: the name a screen reader says starts with what shows.
        aria-label={
          picked
            ? t('explorer:compare.toggle.picked_label', {
                name: label,
                ...cap,
              })
            : t('explorer:compare.toggle.add_label', {
                name: label,
                ...cap,
              })
        }
        onClick={toggle}
      >
        {picked
          ? t('explorer:compare.toggle.picked', cap)
          : t('explorer:compare.toggle.add', cap)}
      </Button>
      {said ? (
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexBasis: '100%',
            flexWrap: 'wrap',
            gap: 1,
          }}
        >
          <Typography
            role="status"
            variant="body2"
            sx={(theme) => ({ color: mutedText(theme) })}
          >
            {t(said.key, { ...said.options, ...cap })}
          </Typography>
          {said.compare && picks.length >= 2 ? (
            <Button
              size="small"
              onClick={() => {
                setSaid(null);
                openCompare(picks, address);
              }}
            >
              {t('explorer:compare.toggle.compare_now', cap)}
            </Button>
          ) : null}
        </Box>
      ) : null}
    </>
  );
}

/** Both buttons, for a viewer who sees Compare; nothing for anyone else. */
export function CompareButtons({
  address,
  label,
}: {
  address: string;
  /** How the account shows (its name, an exchange's name, or its short address). */
  label: string;
}) {
  const full = useExplorerAccess();
  if (!full) return null;
  return (
    <>
      <CompareWith address={address} label={label} />
      <CompareToggle address={address} label={label} />
    </>
  );
}
