import { useMediaQuery } from '@mui/material';
import { alpha, darken, keyframes, type Theme } from '@mui/material/styles';

/**
 * The launcher library's look, shared by its tabs, cards, filters and the
 * category page. Only the standard palette keys are used, so the parts also
 * render under a plain `createTheme()`.
 */

/** A plain style object for `sx`. */
type Sx = Record<string, any>;

export const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';
export const LIBRARY_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** True when the system asks for less motion. */
export const usePrefersReducedMotion = () =>
  useMediaQuery('(prefers-reduced-motion: reduce)', { noSsr: true });

export const isDark = (theme: Theme) => theme.palette.mode === 'dark';

export const cap = { postProcess: 'capitalizeFirstChar' } as const;

/** Accent text, icons and focus rings: at least 4.5:1 on every surface. */
export const libraryAccent = (theme: Theme) =>
  isDark(theme)
    ? theme.palette.primary.light
    : darken(theme.palette.primary.dark, 0.35);

/** Small secondary text: at least 4.5:1 on every surface. */
export const libraryMuted = (theme: Theme) =>
  isDark(theme)
    ? theme.palette.text.secondary
    : alpha(theme.palette.text.primary, 0.72);

/**
 * Inner edges (cards, pills, fields). Panels use `1px solid divider`; never
 * alpha(divider): the light theme's divider is rgba already.
 */
export const libraryHairline = (theme: Theme, opacity = 0.1) =>
  alpha(theme.palette.text.primary, opacity);

export const libraryHoverBorder = (theme: Theme) =>
  alpha(libraryAccent(theme), 0.6);

export const libraryFocusRing = (theme: Theme, offset = 2): Sx => ({
  outline: `2px solid ${libraryAccent(theme)}`,
  outlineOffset: `${offset}px`,
});

/** A section of the library: a rounded, slightly translucent panel. */
export const libraryPanelSx = (theme: Theme): Sx => ({
  backgroundColor: alpha(theme.palette.background.paper, 0.72),
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: '18px',
});

/**
 * A card, tile or row. It never clips (`overflow: hidden` would cut off the
 * focus ring drawn around it).
 */
export const cardSurfaceSx = (
  theme: Theme,
  {
    interactive = true,
    lift = 2,
    shadow = 'raised',
  }: {
    interactive?: boolean;
    lift?: number;
    /** `compact` stays close to the card, for a row that clips round it. */
    shadow?: 'raised' | 'compact';
  } = {}
): Sx => ({
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${libraryHairline(theme, 0.1)}`,
  borderRadius: '16px',
  boxSizing: 'border-box',
  position: 'relative',
  transition: `border-color 160ms, box-shadow 160ms, transform 160ms ${LIBRARY_EASE}`,
  ...(interactive && {
    '&:hover': {
      backgroundImage: `linear-gradient(${alpha(theme.palette.primary.main, 0.06)}, ${alpha(theme.palette.primary.main, 0.06)})`,
      borderColor: libraryHoverBorder(theme),
      boxShadow:
        shadow === 'compact'
          ? `0 4px 10px ${alpha(theme.palette.common.black, isDark(theme) ? 0.36 : 0.1)}`
          : `0 8px 22px ${alpha(theme.palette.common.black, isDark(theme) ? 0.4 : 0.1)}`,
      transform: `translateY(-${lift}px)`,
    },
    '&:active': { transform: 'none' },
  }),
  [REDUCED_MOTION]: {
    transition: 'border-color 160ms, box-shadow 160ms',
    '&:hover': { transform: 'none' },
  },
});

export const libraryMenuPaperSx = (theme: Theme): Sx => ({
  backgroundColor: theme.palette.background.paper,
  backgroundImage: 'none',
  border: `1px solid ${libraryHairline(theme, 0.1)}`,
  borderRadius: '14px',
  boxShadow: `0 16px 40px ${alpha(theme.palette.common.black, isDark(theme) ? 0.5 : 0.16)}`,
  mt: 0.75,
});

/**
 * A menu item. The selected and focused tints are set here: MUI's own come
 * from `action.selected` / `action.focus`, which are near-black in the dark
 * theme.
 */
export const libraryMenuItemSx = (theme: Theme): Sx => ({
  borderRadius: '10px',
  color: theme.palette.text.primary,
  fontSize: 14,
  gap: 1.25,
  minHeight: 36,
  mx: 0.75,
  px: 1.25,
  '&:hover': { backgroundColor: alpha(theme.palette.text.primary, 0.06) },
  '&.Mui-focusVisible, &.Mui-focused': {
    backgroundColor: alpha(theme.palette.text.primary, 0.1),
    ...libraryFocusRing(theme, -2),
  },
  '&.Mui-selected, &[aria-selected="true"], &[aria-checked="true"]': {
    backgroundColor: alpha(theme.palette.primary.main, 0.12),
    color: libraryAccent(theme),
    fontWeight: 600,
  },
  '&.Mui-selected:hover, &.Mui-selected.Mui-focusVisible, &[aria-selected="true"].Mui-focused':
    {
      backgroundColor: alpha(theme.palette.primary.main, 0.18),
    },
  '& .libraryCheck': {
    color: libraryAccent(theme),
    fontSize: 18,
    ml: 'auto',
    visibility: 'hidden',
  },
  '&.Mui-selected .libraryCheck, &[aria-selected="true"] .libraryCheck, &[aria-checked="true"] .libraryCheck':
    { visibility: 'visible' },
});

/** Tooltips in the library open at once. */
export const INSTANT_TOOLTIP = {
  disableInteractive: true,
  enterDelay: 0,
  enterNextDelay: 0,
} as const;

/**
 * Read by screen readers, not shown. The sizes are in px: in sx, 1 would be
 * 100 % of the parent and a margin of -1 would be -8 px.
 */
export const visuallyHiddenSx = {
  border: 0,
  clip: 'rect(0 0 0 0)',
  height: '1px',
  margin: '-1px',
  overflow: 'hidden',
  padding: 0,
  position: 'absolute',
  whiteSpace: 'nowrap',
  width: '1px',
} as const;

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

/** A short opacity fade, for a tab or a view coming in. */
export const libraryFadeInSx = (duration = 160): Sx => ({
  animation: `${fadeIn} ${duration}ms ease-out`,
  [REDUCED_MOTION]: { animation: 'none' },
});

/** An icon on a tinted square, as in section headers and category tiles. */
export const accentTileSx = (theme: Theme, size: number, radius = 12): Sx => ({
  alignItems: 'center',
  backgroundColor: alpha(
    theme.palette.primary.main,
    isDark(theme) ? 0.16 : 0.14
  ),
  borderRadius: `${radius}px`,
  color: libraryAccent(theme),
  display: 'flex',
  flexShrink: 0,
  height: size,
  justifyContent: 'center',
  width: size,
});

/** Formats a count in the reader's language. */
export const formatLibraryNumber = (
  value: number,
  locale?: string,
  options?: Intl.NumberFormatOptions
) => {
  try {
    return new Intl.NumberFormat(locale, options).format(value);
  } catch {
    return new Intl.NumberFormat(undefined, options).format(value);
  }
};
