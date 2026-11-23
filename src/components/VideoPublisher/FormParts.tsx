import { Box, MenuItem, TextField, Typography, useTheme } from '@mui/material';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CategoryOption } from '../../lib/videoPublisher';

/**
 * The window's alerts at its own text size: MUI's Alert takes the theme's
 * body2, which is large in Hub's theme (18px), next to the window's 0.8rem.
 */
export const WINDOW_ALERT_SX = {
  alignItems: 'center',
  fontSize: '0.8rem',
  lineHeight: 1.45,
  py: 0.25,
  '& .MuiAlert-message': { fontSize: 'inherit', lineHeight: 'inherit' },
} as const;

/** A small uppercase heading over a part of the window. */
export const SectionHeading = ({
  children,
  end,
  id,
}: {
  children: ReactNode;
  end?: ReactNode;
  id?: string;
}) => {
  const theme = useTheme();
  return (
    <Box
      sx={{
        alignItems: 'center',
        columnGap: 1,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        minHeight: 24,
        rowGap: 0.25,
      }}
    >
      <Typography
        component="h3"
        id={id}
        sx={{
          color: theme.palette.text.secondary,
          fontSize: '0.7rem',
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        {children}
      </Typography>
      {end}
    </Box>
  );
};

/** A select of one of the apps' category lists. */
export const CategorySelect = ({
  allowNone = false,
  disabled = false,
  error = false,
  label,
  onChange,
  options,
  value,
}: {
  allowNone?: boolean;
  disabled?: boolean;
  error?: boolean;
  label: string;
  onChange: (value: number | null) => void;
  options: readonly CategoryOption[];
  value: number | null | undefined;
}) => {
  const { t } = useTranslation(['core']);
  const known = options.some((option) => option.id === value);
  return (
    <TextField
      disabled={disabled}
      error={error}
      fullWidth
      label={label}
      onChange={(event) =>
        onChange(event.target.value === '' ? null : Number(event.target.value))
      }
      select
      size="small"
      value={known ? String(value) : ''}
    >
      <MenuItem value="">
        <Box component="em" sx={{ opacity: 0.7 }}>
          {allowNone
            ? t('core:video_publisher.fields.no_subcategory')
            : t('core:video_publisher.fields.choose')}
        </Box>
      </MenuItem>
      {options.map((option) => (
        <MenuItem key={option.id} value={String(option.id)}>
          {t(option.i18nKey, { defaultValue: option.defaultLabel })}
        </MenuItem>
      ))}
    </TextField>
  );
};

/** A whole number field; empty is null. */
export const NumberField = ({
  disabled = false,
  label,
  max,
  min = 0,
  onChange,
  value,
  width = 96,
}: {
  disabled?: boolean;
  label: string;
  max?: number;
  min?: number;
  onChange: (value: number | null) => void;
  value: number | null | undefined;
  width?: number | string;
}) => (
  <TextField
    disabled={disabled}
    label={label}
    onChange={(event) => {
      const raw = event.target.value.trim();
      if (!raw) return onChange(null);
      const number = Math.round(Number(raw));
      if (Number.isFinite(number)) onChange(number);
    }}
    size="small"
    slotProps={{ htmlInput: { inputMode: 'numeric', max, min, step: 1 } }}
    sx={{ width }}
    type="number"
    value={value ?? ''}
  />
);

/** Text with a counter against the app's limit. */
export const LimitedTextField = ({
  disabled = false,
  error = false,
  helperText,
  label,
  max,
  multiline = false,
  onChange,
  placeholder,
  value,
}: {
  disabled?: boolean;
  error?: boolean;
  helperText?: ReactNode;
  label: string;
  max?: number;
  multiline?: boolean;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) => {
  const { t } = useTranslation(['core']);
  const counter =
    max != null
      ? t('core:video_publisher.fields.characters', {
          count: value.length,
          max,
        })
      : null;
  return (
    <TextField
      disabled={disabled}
      error={error || (max != null && value.length > max)}
      fullWidth
      helperText={
        helperText || counter ? (
          <Box
            component="span"
            sx={{ display: 'flex', gap: 1, justifyContent: 'space-between' }}
          >
            <span>{helperText}</span>
            {counter ? <span>{counter}</span> : null}
          </Box>
        ) : undefined
      }
      label={label}
      maxRows={multiline ? 8 : undefined}
      minRows={multiline ? 2 : undefined}
      multiline={multiline}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      size="small"
      value={value}
    />
  );
};
