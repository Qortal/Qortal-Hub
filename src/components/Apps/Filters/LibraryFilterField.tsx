import { useRef } from 'react';
import { IconButton, InputBase } from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { useTranslation } from 'react-i18next';
import {
  cap,
  libraryAccent,
  libraryFocusRing,
  libraryHairline,
  libraryMuted,
} from '../AppsLibrary/libraryStyles';

/** The look of the library's small search fields. */
export const filterFieldSx = (theme: Theme): Record<string, any> => ({
  backgroundColor: alpha(theme.palette.background.paper, 0.72),
  border: `1px solid ${libraryHairline(theme, 0.14)}`,
  borderRadius: '12px',
  boxSizing: 'border-box',
  color: theme.palette.text.primary,
  fontSize: '14px',
  gap: 0.75,
  height: 36,
  minWidth: 0,
  px: 1.25,
  transition: 'border-color 160ms, box-shadow 160ms',
  '&:hover': { borderColor: libraryHairline(theme, 0.28) },
  '&:focus-within, &.Mui-focused': {
    borderColor: libraryAccent(theme),
    boxShadow: `0 0 0 3px ${alpha(libraryAccent(theme), 0.25)}`,
  },
  '& .MuiInputBase-input': { p: 0 },
  '& .MuiInputBase-input::placeholder': {
    color: libraryMuted(theme),
    opacity: 1,
  },
  '& > .MuiSvgIcon-root': { color: libraryMuted(theme), fontSize: 18 },
});

interface LibraryFilterFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Its name and placeholder. */
  label: string;
  sx?: Record<string, any>;
}

/** A small search field that narrows one part of the library. */
export const LibraryFilterField = ({
  value,
  onChange,
  label,
  sx,
}: LibraryFilterFieldProps) => {
  const { t } = useTranslation(['core']);
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <InputBase
      endAdornment={
        value ? (
          <IconButton
            aria-label={t('core:launcher.clear_search', cap)}
            disableRipple
            onClick={() => {
              onChange('');
              // The button goes once the field is empty: focus stays in the
              // field instead of falling back to the top of the page.
              inputRef.current?.focus();
            }}
            sx={(theme) => ({
              borderRadius: '8px',
              color: libraryMuted(theme),
              height: 24,
              mr: -0.5,
              width: 24,
              '&:hover': {
                backgroundColor: alpha(theme.palette.text.primary, 0.06),
                color: theme.palette.text.primary,
              },
              '&.Mui-focusVisible': libraryFocusRing(theme, 0),
            })}
          >
            <CloseRoundedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        ) : null
      }
      inputProps={{ 'aria-label': label }}
      inputRef={inputRef}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && value) {
          event.stopPropagation();
          onChange('');
        }
      }}
      placeholder={label}
      startAdornment={<SearchRoundedIcon aria-hidden />}
      sx={(theme) => ({ ...filterFieldSx(theme), ...sx })}
      value={value}
    />
  );
};
