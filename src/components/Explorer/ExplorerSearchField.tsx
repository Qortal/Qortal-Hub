/**
 * One field for any account or transaction: a name, an address (Q… or an
 * AT's A…) or a transaction signature. Names are suggested from 2 letters
 * (the node's name search; not for an address or a signature); Enter looks
 * up exactly what was typed, and a suggestion opens that name.
 */
import { useState } from 'react';
import {
  Autocomplete,
  Avatar,
  Box,
  CircularProgress,
  InputAdornment,
  TextField,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../../App';
import { useNameSearch } from '../../hooks/useNameSearch';
import {
  isAtAddress,
  isQortAddress,
  isSignature,
} from '../../lib/explorer/addresses';
import { seg } from '../../lib/explorer/core';
import { visibleName } from '../../lib/explorer/rules';
import { cap } from './parts';

const SUGGESTIONS = 8;

/** Where a name's picture is, or undefined when there is no name. */
function avatarUrl(name: string | null): string | undefined {
  if (!name) return undefined;
  try {
    return `${getBaseApiReact()}/arbitrary/THUMBNAIL/${seg(name)}/qortal_avatar?async=true`;
  } catch {
    return undefined;
  }
}

/** A name's picture, or its first letter. */
export function ExplorerAvatar({
  name,
  size = 32,
  decorative = true,
}: {
  name: string | null;
  size?: number;
  /** Beside the name in text: hidden from screen readers. */
  decorative?: boolean;
}) {
  const letter = (name ?? '').trim().charAt(0).toUpperCase() || '?';
  return (
    <Avatar
      alt={decorative ? '' : (name ?? '')}
      aria-hidden={decorative || undefined}
      src={avatarUrl(name)}
      sx={(theme) => ({
        bgcolor: alpha(theme.palette.primary.main, 0.22),
        color: 'text.primary',
        flexShrink: 0,
        fontSize: size * 0.42,
        fontWeight: 600,
        height: size,
        width: size,
      })}
    >
      {letter}
    </Avatar>
  );
}

export function ExplorerSearchField({
  onLookUp,
  compact = false,
  autoFocus = false,
}: {
  /** Look up what was typed or picked (trimmed, never empty). */
  onLookUp: (who: string) => void;
  /** The small field in the window's bar. */
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation(['core', 'explorer']);
  const [input, setInput] = useState('');
  const typed = input.trim();
  // An address or a signature is looked up as it is: no names to suggest.
  const nameLike =
    typed.length >= 2 &&
    !isQortAddress(typed) &&
    !isAtAddress(typed) &&
    !isSignature(typed);
  const { results, isLoading } = useNameSearch(
    nameLike ? typed : '',
    SUGGESTIONS,
    { minLength: 2 }
  );
  const options = nameLike
    ? results.map((row) => row.name).filter(Boolean)
    : [];

  const lookUp = (value: string) => {
    const who = value.trim();
    if (!who) return;
    setInput('');
    onLookUp(who);
  };

  return (
    <Autocomplete
      freeSolo
      fullWidth
      value={null}
      options={options}
      // The node already filtered them.
      filterOptions={(list) => list}
      inputValue={input}
      onInputChange={(_event, value, reason) => {
        if (reason !== 'reset') setInput(value);
      }}
      onChange={(_event, value) => {
        if (typeof value === 'string') lookUp(value);
      }}
      loading={isLoading && options.length === 0 && nameLike}
      loadingText={t('core:loading.generic', cap)}
      clearText={t('explorer:search.clear', cap)}
      size={compact ? 'small' : 'medium'}
      sx={{ minWidth: 0 }}
      renderOption={(props, option) => {
        const { key, ...rest } = props as typeof props & { key: string };
        return (
          <Box
            component="li"
            key={key}
            {...rest}
            sx={{ alignItems: 'center', display: 'flex', gap: 1.25 }}
          >
            <ExplorerAvatar name={option} size={26} />
            <Box component="bdi" dir="auto" sx={{ overflowWrap: 'anywhere' }}>
              {visibleName(option)}
            </Box>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          autoFocus={autoFocus}
          label={compact ? undefined : t('explorer:search.label', cap)}
          placeholder={
            compact
              ? t('explorer:search.compact_placeholder', cap)
              : t('explorer:search.placeholder', cap)
          }
          helperText={compact ? undefined : t('explorer:search.helper', cap)}
          inputProps={{
            ...params.inputProps,
            'aria-label': compact
              ? t('explorer:search.compact_placeholder', cap)
              : undefined,
            autoCapitalize: 'off',
            spellCheck: false,
          }}
          InputProps={{
            ...params.InputProps,
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: (
              <>
                {isLoading && nameLike ? (
                  <CircularProgress size={16} sx={{ mr: 1 }} />
                ) : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
}
