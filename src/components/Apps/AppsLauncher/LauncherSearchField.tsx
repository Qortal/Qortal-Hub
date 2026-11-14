import { type KeyboardEvent, type Ref } from 'react';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SearchIcon from '@mui/icons-material/Search';
import { Box, IconButton, InputBase } from '@mui/material';
import { useTranslation } from 'react-i18next';

interface LauncherSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Enter: open the best match, or the address that was typed. */
  onSubmit: () => void;
  inputRef?: Ref<HTMLInputElement>;
}

/** The launcher's one search box: app names, websites and qortal:// links. */
export const LauncherSearchField = ({
  value,
  onChange,
  onSubmit,
  inputRef,
}: LauncherSearchFieldProps) => {
  const { t } = useTranslation(['core']);
  const label = t('core:action.search_apps_or_link', {
    postProcess: 'capitalizeFirstChar',
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onSubmit();
    } else if (event.key === 'Escape' && value) {
      event.preventDefault();
      onChange('');
    }
  };

  return (
    <Box
      sx={(theme) => ({
        alignItems: 'center',
        backgroundColor: theme.palette.background.paper,
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: '24px',
        display: 'flex',
        gap: '10px',
        height: 48,
        maxWidth: 680,
        padding: '0 8px 0 18px',
        transition: 'border-color 160ms ease, box-shadow 160ms ease',
        width: '100%',
        '&:hover': {
          borderColor: theme.palette.text.secondary,
        },
        '&:focus-within': {
          borderColor: theme.palette.primary.main,
          boxShadow: `0 0 0 1px ${theme.palette.primary.main}`,
        },
      })}
    >
      <SearchIcon
        sx={(theme) => ({ color: theme.palette.text.secondary, fontSize: 22 })}
      />
      <InputBase
        autoComplete="off"
        inputProps={{ 'aria-label': label, spellCheck: false }}
        inputRef={inputRef}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={label}
        sx={(theme) => ({
          color: theme.palette.text.primary,
          flex: 1,
          fontSize: '16px',
          '& .MuiInputBase-input::placeholder': {
            color: theme.palette.text.secondary,
            opacity: 1,
          },
        })}
        value={value}
      />
      {value ? (
        <IconButton
          aria-label={t('core:launcher.clear_search', {
            postProcess: 'capitalizeFirstChar',
          })}
          onClick={() => onChange('')}
          size="small"
          sx={(theme) => ({ color: theme.palette.text.secondary })}
        >
          <CloseRoundedIcon sx={{ fontSize: 20 }} />
        </IconButton>
      ) : null}
    </Box>
  );
};
