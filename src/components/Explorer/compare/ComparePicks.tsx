/**
 * The start page's accounts picked to compare, for a viewer the level 5+
 * rule lets in (nothing for anyone else): each with its letter and Remove,
 * Clear, and Compare once two or more are picked.
 */
import { Box, Button, IconButton, Tooltip, Typography } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CompareArrowsRoundedIcon from '@mui/icons-material/CompareArrowsRounded';
import { useTranslation } from 'react-i18next';
import { letterOf } from '../../../lib/explorer/compare';
import { shortAddress } from '../../../lib/explorer/addresses';
import { PersonButton, useAccountLabel } from '../connections/ConnectionRow';
import { cap, mutedText, panelSx, Section } from '../parts';
import { useExplorerAccess } from '../useExplorerAccess';
import { useCompareSteps } from './compareSteps';
import { LetterBadge, useLetterAccents } from './letters';

function Pick({
  address,
  index,
  accent,
  onRemove,
}: {
  address: string;
  index: number;
  accent: string;
  onRemove: (address: string) => void;
}) {
  const { t } = useTranslation(['explorer']);
  const { label } = useAccountLabel(address, true);
  const letter = letterOf(index);
  return (
    <Box
      component="li"
      sx={{ alignItems: 'center', display: 'flex', gap: 1, minWidth: 0 }}
    >
      <LetterBadge letter={letter} accent={accent} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <PersonButton
          address={address}
          near
          secondary={shortAddress(address)}
        />
      </Box>
      <Tooltip title={t('explorer:compare.picks.remove_short', cap)}>
        <IconButton
          size="small"
          aria-label={t('explorer:compare.picks.remove', {
            name: label,
            ...cap,
          })}
          onClick={() => onRemove(address)}
        >
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

function PickList() {
  const { t } = useTranslation(['explorer']);
  const { picks, removePick, clearPicks, openCompare } = useCompareSteps();
  const accents = useLetterAccents();
  if (!picks.length) return null;
  return (
    <Section
      id="explorer-compare-picks"
      title={t('explorer:compare.picks.title', cap)}
      action={
        <Button
          size="small"
          onClick={clearPicks}
          aria-label={t('explorer:compare.picks.clear', cap)}
        >
          {t('explorer:start.clear', cap)}
        </Button>
      }
    >
      <Box
        sx={(theme) => ({
          ...panelSx(theme),
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        })}
      >
        <Box
          component="ul"
          aria-label={t('explorer:compare.picks.title', cap)}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 0.25,
            listStyle: 'none',
            m: 0,
            p: 0,
          }}
        >
          {picks.map((address, index) => (
            <Pick
              key={address}
              address={address}
              index={index}
              accent={accents[index]}
              onRemove={removePick}
            />
          ))}
        </Box>
        {picks.length >= 2 ? (
          <Button
            variant="contained"
            size="small"
            startIcon={<CompareArrowsRoundedIcon />}
            onClick={() => openCompare(picks)}
            sx={{ alignSelf: 'flex-start' }}
          >
            {t('explorer:compare.picks.compare', {
              picked: picks.length,
              ...cap,
            })}
          </Button>
        ) : (
          <Typography
            variant="body2"
            sx={(theme) => ({ color: mutedText(theme) })}
          >
            {t('explorer:compare.picks.one_more', cap)}
          </Typography>
        )}
      </Box>
    </Section>
  );
}

export function ComparePicks() {
  const full = useExplorerAccess();
  return full ? <PickList /> : null;
}
