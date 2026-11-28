/**
 * Which transactions the tab shows: a chip per kind (All, Payments, Names,
 * Minting, Groups, QDN data, Trading, Messages, Other), each a toggle
 * button, wrapping on a narrow window; and, for a kind of several types,
 * one exact type of it. Core filters by type, so each choice is a list of
 * its own, read from the newest.
 */
import { Box, Chip, MenuItem, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
  TX_FAMILIES,
  typesFor,
  type TxFilter,
  type TxType,
} from '../../../lib/explorer/txFamilies';
import { cap } from '../parts';
import { typeTitle } from './sentenceText';

export function TxFilterBar({
  filter,
  onChange,
}: {
  filter: TxFilter;
  onChange: (filter: TxFilter) => void;
}) {
  const { t } = useTranslation(['explorer']);
  const types = filter.kind === 'all' ? [] : typesFor(filter.kind);
  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}
    >
      <Box
        role="group"
        aria-label={t('explorer:transactions.kind_label', cap)}
        sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}
      >
        {TX_FAMILIES.map((family) => {
          const active = filter.kind === family.key;
          return (
            <Chip
              key={family.key}
              clickable
              aria-pressed={active}
              color={active ? 'primary' : 'default'}
              variant={active ? 'filled' : 'outlined'}
              label={t(`explorer:tx_family.${family.key}`, cap)}
              onClick={() => onChange({ kind: family.key, type: null })}
              sx={{ fontWeight: 600 }}
            />
          );
        })}
      </Box>
      {types.length > 1 ? (
        <TextField
          select
          size="small"
          label={t('explorer:transactions.type', cap)}
          value={filter.type ?? ''}
          onChange={(event) =>
            onChange({
              kind: filter.kind,
              type: (event.target.value || null) as TxType | null,
            })
          }
          slotProps={{
            inputLabel: { shrink: true },
            select: { displayEmpty: true },
          }}
          sx={{ alignSelf: 'flex-start', maxWidth: '100%', minWidth: 220 }}
        >
          <MenuItem value="">
            {t('explorer:transactions.every_type', cap)}
          </MenuItem>
          {types.map((type) => (
            <MenuItem key={type} value={type}>
              {typeTitle(type, t, true)}
            </MenuItem>
          ))}
        </TextField>
      ) : null}
    </Box>
  );
}
