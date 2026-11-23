import { alpha, createTheme, type Theme } from '@mui/material/styles';
import {
  APP_BLUE_SURFACE_TEXT,
  getBlueTier1Gradient,
  getBlueTier1PillSurface,
} from '../../styles/blueMaterial';

/**
 * The window's parts in Hub's own look, as its Home windows have them:
 * round pills, segmented choices whose pick is Hub's blue pill, soft rounded
 * fields and blue progress bars. Applied to everything inside the window
 * (VideoPublisher wraps itself in it), on top of Hub's light or dark theme.
 */
export function publisherTheme(outer: Theme): Theme {
  const dark = outer.palette.mode === 'dark';
  const text = outer.palette.text.primary;
  const blue = outer.palette.primary.main;
  const selected = {
    ...getBlueTier1PillSurface(outer),
    color: APP_BLUE_SURFACE_TEXT,
  };
  return createTheme(outer, {
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 999,
            fontWeight: 600,
            letterSpacing: 0,
            textTransform: 'none',
          },
          sizeLarge: {
            borderRadius: 12,
            fontSize: '0.95rem',
            fontWeight: 700,
            minHeight: 46,
          },
          text: {
            paddingInline: 12,
            '&:hover': { backgroundColor: alpha(blue, dark ? 0.1 : 0.08) },
          },
          outlined: {
            borderColor: alpha(text, dark ? 0.16 : 0.2),
            '&:hover': {
              backgroundColor: alpha(blue, dark ? 0.08 : 0.06),
              borderColor: alpha(blue, 0.55),
            },
          },
        },
      },
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: {
            backgroundColor: alpha(text, dark ? 0.045 : 0.05),
            border: `1px solid ${alpha(text, dark ? 0.06 : 0.08)}`,
            borderRadius: 12,
            gap: 3,
            padding: 3,
          },
          grouped: {
            border: '0 !important',
            borderRadius: '9px !important',
            margin: '0 !important',
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            border: 0,
            borderRadius: 9,
            color: outer.palette.text.secondary,
            fontWeight: 600,
            lineHeight: 1.3,
            textTransform: 'none',
            transition:
              'background 160ms ease, color 160ms ease, box-shadow 160ms ease',
            '&:hover': {
              backgroundColor: alpha(text, dark ? 0.06 : 0.05),
              color: text,
            },
            '&.Mui-selected, &.Mui-selected:hover': selected,
            '&.Mui-disabled': { border: 0 },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: alpha(text, dark ? 0.025 : 0.02),
            borderRadius: 10,
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: alpha(text, dark ? 0.12 : 0.16),
            },
            '&:hover:not(.Mui-disabled):not(.Mui-error):not(.Mui-focused) .MuiOutlinedInput-notchedOutline':
              { borderColor: alpha(blue, 0.5) },
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { borderRadius: 999 },
          colorPrimary: { backgroundColor: alpha(blue, dark ? 0.16 : 0.2) },
          bar: { borderRadius: 999 },
          barColorPrimary: { background: getBlueTier1Gradient() },
        },
      },
      MuiAlert: {
        styleOverrides: { root: { borderRadius: 10 } },
      },
    },
  });
}

/** The panes' soft tint over the window's own surface. */
export const paneTint = (theme: Theme) =>
  alpha(
    theme.palette.text.primary,
    theme.palette.mode === 'dark' ? 0.03 : 0.028
  );

/**
 * One of the window's panes: a soft surface, framed lightly. Flat, so a
 * pane in two parts (the settings and their bar) joins without a seam.
 */
export const paneSx = (theme: Theme) => {
  const dark = theme.palette.mode === 'dark';
  const text = theme.palette.text.primary;
  return {
    backgroundColor: paneTint(theme),
    border: `1px solid ${alpha(text, dark ? 0.07 : 0.09)}`,
    borderRadius: '16px',
    boxShadow: `inset 0 1px 0 ${alpha(theme.palette.common.white, dark ? 0.035 : 0.5)}`,
  };
};

/**
 * One of the "Where to" choices: a small tile, the app's picture over its
 * name, five of them in one row; the picked one is Hub's blue pill surface.
 */
export const destinationTileSx = (theme: Theme, active: boolean) => {
  const dark = theme.palette.mode === 'dark';
  const text = theme.palette.text.primary;
  return {
    alignContent: 'center',
    border: `1px solid ${active ? 'transparent' : alpha(text, dark ? 0.1 : 0.12)}`,
    borderRadius: '12px',
    color: active ? APP_BLUE_SURFACE_TEXT : theme.palette.text.secondary,
    display: 'grid',
    fontSize: '0.76rem',
    fontWeight: active ? 700 : 600,
    gap: 0.625,
    justifyItems: 'center',
    lineHeight: 1.2,
    minHeight: 72,
    minWidth: 0,
    px: 0.5,
    py: 1,
    textAlign: 'center',
    transition:
      'background 160ms ease, color 160ms ease, border-color 160ms ease, box-shadow 160ms ease',
    ...(active
      ? getBlueTier1PillSurface(theme)
      : { backgroundColor: alpha(text, dark ? 0.038 : 0.03) }),
    '&:hover': active
      ? getBlueTier1PillSurface(theme)
      : {
          backgroundColor: alpha(text, dark ? 0.06 : 0.05),
          borderColor: alpha(text, dark ? 0.18 : 0.2),
          color: text,
        },
    '&.Mui-focusVisible': {
      outline: `2px solid ${alpha(theme.palette.primary.main, 0.6)}`,
      outlineOffset: 2,
    },
    '&.Mui-disabled': { opacity: 0.5 },
    // A narrow column (the window's side column at its smallest): smaller
    // names, so all five still fit.
    '@container (max-width: 440px)': { fontSize: '0.68rem', px: 0.25 },
  };
};

/**
 * A round backdrop for an app's picture, so it shows on any pill: a light
 * blue picture (Q-Share's) would vanish on the blue picked pill.
 */
export const avatarSocketSx = (theme: Theme) => ({
  alignItems: 'center',
  bgcolor:
    theme.palette.mode === 'dark'
      ? theme.palette.background.default
      : theme.palette.common.white,
  borderRadius: '50%',
  boxShadow: `0 0 0 1px ${alpha(theme.palette.text.primary, 0.12)}`,
  display: 'flex',
  flexShrink: 0,
  height: 28,
  justifyContent: 'center',
  overflow: 'hidden',
  width: 28,
});

/** A soft tinted note: a tone's colour on a faint wash of it. */
export const calloutSx = (theme: Theme, color: string) => ({
  alignItems: 'flex-start',
  bgcolor: alpha(color, theme.palette.mode === 'dark' ? 0.1 : 0.08),
  border: `1px solid ${alpha(color, theme.palette.mode === 'dark' ? 0.22 : 0.26)}`,
  borderRadius: '10px',
  display: 'flex',
  gap: 0.75,
  px: 1,
  py: 0.625,
});
