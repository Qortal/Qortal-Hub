import { alpha, darken, type Theme } from '@mui/material/styles';

/*
 * The minting window's look (`src/components/Minting/Minting.tsx`), so the
 * Node Manager reads as part of the same family: its frame, its uppercase
 * section labels, its card surfaces and metric rows, its status card and its
 * buttons. The values are the minting window's own.
 */

const isDark = (theme: Theme) => theme.palette.mode === 'dark';

/** The blurred backdrop behind the window and its dialogs. */
export const windowBackdropSx = {
  backdropFilter: 'blur(12px)',
  backgroundColor: alpha('#07090D', 0.66),
} as const;

/** The window's frame (its size is the caller's). */
export const windowPaperSx = (theme: Theme) =>
  ({
    background: isDark(theme)
      ? 'linear-gradient(180deg, rgba(20,23,30,0.985) 0%, rgba(15,17,23,0.99) 100%)'
      : 'linear-gradient(180deg, rgba(251,253,255,0.985) 0%, rgba(244,247,251,0.99) 100%)',
    border: `1px solid ${alpha(theme.palette.divider, 0.42)}`,
    borderRadius: '14px',
    boxShadow: isDark(theme)
      ? '0 34px 120px rgba(0,0,0,0.46)'
      : '0 28px 88px rgba(18,28,45,0.16)',
  }) as const;

/** What a sticky table header sits on: the frame's own colour, opaque. */
export const windowSurfaceColor = (theme: Theme) =>
  isDark(theme) ? 'rgb(20,23,30)' : 'rgb(251,253,255)';

/** A small uppercase label over a section, as "BLOCKCHAIN STATISTICS". */
export const sectionLabelSx = (theme: Theme) =>
  ({
    color: alpha(theme.palette.text.secondary, 0.64),
    display: 'block',
    fontSize: '0.68rem',
    fontWeight: 700,
    letterSpacing: '0.11em',
    textTransform: 'uppercase',
  }) as const;

/** A card's surface. */
export const surfaceCardSx = (theme: Theme) =>
  ({
    background: isDark(theme)
      ? 'linear-gradient(180deg, rgba(22,25,32,0.68) 0%, rgba(18,21,28,0.76) 100%)'
      : 'linear-gradient(180deg, rgba(249,251,254,0.84) 0%, rgba(243,247,251,0.92) 100%)',
    border: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
    borderRadius: '12px',
    boxShadow: 'none',
  }) as const;

/** The quieter surface of a side column. */
export const quietSurfaceSx = (theme: Theme) =>
  ({
    background: isDark(theme)
      ? 'linear-gradient(180deg, rgba(18,21,28,0.42) 0%, rgba(15,18,24,0.52) 100%)'
      : 'linear-gradient(180deg, rgba(249,251,254,0.72) 0%, rgba(243,247,251,0.82) 100%)',
  }) as const;

/** A label and value row, with a thin line under all but the last. */
export const metricRowSx = (theme: Theme) =>
  ({
    alignItems: 'center',
    display: 'grid',
    gap: 1.5,
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    py: 1.05,
    '&:not(:last-of-type)': {
      borderBottom: `1px solid ${alpha(theme.palette.divider, 0.14)}`,
    },
  }) as const;

export const metricLabelSx = (theme: Theme) =>
  ({
    color: alpha(theme.palette.text.secondary, 0.62),
    fontSize: '0.88rem',
  }) as const;

export const metricValueSx = (theme: Theme) =>
  ({
    color: theme.palette.text.primary,
    fontSize: '0.93rem',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 700,
    overflowWrap: 'anywhere',
    textAlign: 'right',
  }) as const;

/** The main action, as "Visit Q-Mintership". */
export const primaryButtonSx = (theme: Theme) =>
  ({
    background:
      'linear-gradient(180deg, rgba(151,189,246,0.98) 0%, rgba(120,163,228,0.98) 100%)',
    border: '1px solid rgba(201,223,255,0.42)',
    borderRadius: '10px',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.34), 0 10px 24px rgba(44,88,152,0.24)',
    color: '#0E1827',
    fontWeight: 800,
    letterSpacing: '0.01em',
    px: 2.1,
    py: 0.9,
    textTransform: 'none',
    '&:hover': {
      background:
        'linear-gradient(180deg, rgba(160,196,250,1) 0%, rgba(128,171,233,1) 100%)',
      boxShadow:
        'inset 0 1px 0 rgba(255,255,255,0.36), 0 12px 26px rgba(44,88,152,0.28)',
    },
    '&.Mui-disabled': {
      background: alpha(theme.palette.action.disabledBackground, 0.9),
      borderColor: alpha(theme.palette.divider, 0.36),
      boxShadow: 'none',
      color: theme.palette.text.disabled,
    },
  }) as const;

/** An action that takes the node down or changes its chain. */
export const dangerButtonSx = (theme: Theme) =>
  ({
    background:
      'linear-gradient(180deg, rgba(248,150,160,0.96) 0%, rgba(226,101,118,0.98) 100%)',
    border: '1px solid rgba(255,214,219,0.4)',
    borderRadius: '10px',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.3), 0 10px 24px rgba(126,29,44,0.22)',
    color: '#2A0C12',
    fontWeight: 800,
    letterSpacing: '0.01em',
    px: 1.8,
    py: 0.9,
    textTransform: 'none',
    '&:hover': {
      background:
        'linear-gradient(180deg, rgba(250,158,168,1) 0%, rgba(230,110,127,1) 100%)',
      boxShadow:
        'inset 0 1px 0 rgba(255,255,255,0.34), 0 12px 26px rgba(126,29,44,0.26)',
    },
    '&.Mui-disabled': {
      background: alpha(theme.palette.action.disabledBackground, 0.9),
      borderColor: alpha(theme.palette.divider, 0.36),
      boxShadow: 'none',
      color: theme.palette.text.disabled,
    },
  }) as const;

/**
 * A secondary action in a card's corner: outlined in the text colour (the
 * dark theme's divider is too dark to outline with).
 */
export const quietButtonSx = (theme: Theme) =>
  ({
    backgroundColor: alpha(
      theme.palette.text.primary,
      isDark(theme) ? 0.04 : 0.02
    ),
    border: `1px solid ${alpha(theme.palette.text.primary, isDark(theme) ? 0.16 : 0.2)}`,
    borderRadius: '10px',
    color: theme.palette.text.primary,
    fontWeight: 700,
    px: 1.4,
    textTransform: 'none',
    '&:hover': {
      backgroundColor: alpha(
        theme.palette.text.primary,
        isDark(theme) ? 0.08 : 0.05
      ),
      border: `1px solid ${alpha(theme.palette.text.primary, isDark(theme) ? 0.26 : 0.3)}`,
    },
  }) as const;

/** A text action in a table row or under a note. */
export const textButtonSx = {
  fontWeight: 700,
  minWidth: 0,
  textTransform: 'none',
} as const;

export type Tone = 'active' | 'syncing' | 'inactive';

/**
 * The minting window's status colours: green when it runs, blue while it
 * works, rose when it doesn't. On light backgrounds the accent is darkened
 * so the words stay readable.
 */
export const toneOf = (theme: Theme, tone: Tone) => {
  const base = { active: '#74d28f', inactive: '#e59aa7', syncing: '#9eb8df' }[
    tone
  ];
  const accent = { active: '#86d89d', inactive: '#f0a6b2', syncing: '#a8c2ea' }[
    tone
  ];
  return {
    accent: isDark(theme) ? accent : darken(accent, 0.45),
    background: alpha(
      base,
      isDark(theme)
        ? { active: 0.085, inactive: 0.07, syncing: 0.08 }[tone]
        : { active: 0.11, inactive: 0.095, syncing: 0.1 }[tone]
    ),
    borderColor: alpha(
      base,
      { active: 0.11, inactive: 0.09, syncing: 0.1 }[tone]
    ),
  };
};

/** A card tinted by its tone, with a thin accent line down its left edge. */
export const toneCardSx = (theme: Theme, tone: Tone) => {
  const colours = toneOf(theme, tone);
  return {
    background: colours.background,
    borderColor: colours.borderColor,
    position: 'relative',
    '&::before': {
      backgroundColor: alpha(colours.accent, 0.62),
      borderRadius: '999px',
      bottom: 16,
      content: '""',
      left: 0,
      position: 'absolute',
      top: 16,
      width: '1px',
    },
  } as const;
};
