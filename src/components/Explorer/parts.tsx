/**
 * The Explorer's building blocks, in Hub's own look (theme palette only,
 * light and dark): a section with its small-capitals title, a panel, a
 * fact tile, a status chip, a copy button, and the loading and failed
 * states every read shows on its own.
 */
import { type ReactNode } from 'react';
import {
  Box,
  Button,
  IconButton,
  Skeleton,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  alpha,
  decomposeColor,
  hslToRgb,
  recomposeColor,
  type Theme,
} from '@mui/material/styles';
import { visuallyHidden } from '@mui/utils';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { infoSnackGlobalAtom, openSnackGlobalAtom } from '../../atoms/global';

export const cap = { postProcess: 'capitalizeFirstChar' } as const;

/**
 * Text set into a sentence (a name), isolated from it, so a name written
 * right to left can't reorder the words around it.
 */
export const isolate = (text: string): string => `\u2068${text}\u2069`;

/** Small secondary text, readable on every surface. */
export const mutedText = (theme: Theme) =>
  theme.palette.mode === 'dark'
    ? theme.palette.text.secondary
    : alpha(theme.palette.text.primary, 0.72);

const sectionTitleSx = (theme: Theme) => ({
  color: mutedText(theme),
  fontSize: '0.7rem',
  fontWeight: 700,
  letterSpacing: '0.1em',
  lineHeight: 1.2,
  m: 0,
  textTransform: 'uppercase' as const,
});

/** A titled part of a page. */
export function Section({
  id,
  title,
  action,
  children,
}: {
  id: string;
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Box
      component="section"
      aria-labelledby={`${id}-title`}
      sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: 1,
          justifyContent: 'space-between',
          minHeight: 28,
        }}
      >
        <Typography id={`${id}-title`} component="h3" sx={sectionTitleSx}>
          {title}
        </Typography>
        {action}
      </Box>
      {children}
    </Box>
  );
}

export const panelSx = (theme: Theme) => ({
  backgroundColor: theme.palette.background.surface,
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: '14px',
  minWidth: 0,
  p: { xs: 1.5, sm: 2 },
});

export const tileSx = (theme: Theme) => ({
  backgroundColor: theme.palette.background.elevated,
  borderRadius: '12px',
  minWidth: 0,
  p: 1.5,
});

export function Panel({ children }: { children: ReactNode }) {
  return <Box sx={panelSx}>{children}</Box>;
}

/** A value still loading: a line of skeleton, read out as `label`. */
export function LoadingLine({
  label,
  width = '60%',
}: {
  label: string;
  width?: number | string;
}) {
  return (
    <Box component="span" sx={{ display: 'block' }}>
      <Skeleton variant="text" width={width} aria-hidden />
      <Box component="span" sx={visuallyHidden}>
        {label}
      </Box>
    </Box>
  );
}

/** A read that failed: what couldn't load, and Retry. Never an empty answer. */
export function ReadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation(['core']);
  return (
    <Box
      role="alert"
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        justifyContent: 'space-between',
      }}
    >
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {message}
      </Typography>
      <Button size="small" variant="outlined" onClick={onRetry}>
        {t('core:retry', cap)}
      </Button>
    </Box>
  );
}

/** Copy `value`, then say so in Hub's snackbar. */
export function CopyButton({
  value,
  label,
  copiedMessage,
}: {
  value: string;
  label: string;
  copiedMessage: string;
}) {
  const setInfoSnack = useSetAtom(infoSnackGlobalAtom);
  const setOpenSnack = useSetAtom(openSnackGlobalAtom);
  return (
    <Tooltip title={label}>
      <IconButton
        size="small"
        aria-label={label}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(
            () => {
              setInfoSnack({
                compact: true,
                duration: 3200,
                message: copiedMessage,
                type: 'success',
              });
              setOpenSnack(true);
            },
            () => undefined
          );
        }}
      >
        <ContentCopyRoundedIcon fontSize="inherit" />
      </IconButton>
    </Tooltip>
  );
}

// ---- Status chips -------------------------------------------------------------------------

export type ChipKind =
  | 'level'
  | 'member'
  | 'admin'
  | 'devAdmin'
  | 'minting'
  | 'penalty'
  | 'blocked'
  | 'owner';

/** `color` with its hue set to `hue` (degrees), keeping its saturation and lightness. */
export function withHue(color: string, hue: number): string {
  const { values } = decomposeColor(color);
  const [r, g, b] = values.slice(0, 3).map((v) => Number(v) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return hslToRgb(
    recomposeColor({
      type: 'hsl',
      values: [hue, Math.round(s * 100), Math.round(l * 100)],
    })
  );
}

/** The accent of a chip, from the theme: it says what kind of fact it is, never good or bad. */
export function chipAccent(theme: Theme, kind: ChipKind): string {
  const p = theme.palette;
  switch (kind) {
    case 'level':
      return p.primary.main;
    case 'member':
      return p.info.main;
    case 'admin':
      return withHue(p.info.main, 275);
    case 'devAdmin':
      return withHue(p.info.main, 172);
    case 'minting':
      return p.other.minting;
    case 'penalty':
      return p.warning.main;
    case 'blocked':
      return p.error.main;
    case 'owner':
      return withHue(p.info.main, 45);
  }
}

export function StatusChip({
  kind,
  label,
  explanation,
}: {
  kind: ChipKind;
  label: string;
  /** Said on hover and focus. */
  explanation?: string;
}) {
  const chip = (
    <Box
      component="span"
      tabIndex={explanation ? 0 : undefined}
      sx={(theme) => {
        const accent = chipAccent(theme, kind);
        return {
          alignItems: 'center',
          backgroundColor: alpha(accent, 0.14),
          border: `1px solid ${alpha(accent, 0.5)}`,
          borderRadius: '999px',
          color: 'text.primary',
          display: 'inline-flex',
          fontSize: '0.75rem',
          fontWeight: 600,
          gap: 0.6,
          lineHeight: 1.6,
          px: 1,
          whiteSpace: 'nowrap',
          '&:focus-visible': { outline: `2px solid ${accent}` },
          '&::before':
            kind === 'minting'
              ? {
                  backgroundColor: accent,
                  borderRadius: '50%',
                  content: '""',
                  height: 6,
                  width: 6,
                }
              : undefined,
        };
      }}
    >
      {label}
    </Box>
  );
  return explanation ? <Tooltip title={explanation}>{chip}</Tooltip> : chip;
}
