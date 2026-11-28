/**
 * Each compared account's letter (A–D) and colour. The colours are the
 * theme's info blue turned to four hues (keeping its saturation and
 * lightness, as the chips do), so they sit in the light and the dark
 * theme. Colour is never the only mark: the letter always shows, and the
 * name beside it. The letter is in the theme's text colour on a light
 * tint of its colour, so it reads on every surface.
 */
import { Box } from '@mui/material';
import { alpha, useTheme, type Theme } from '@mui/material/styles';
import type { Letter } from '../../../lib/explorer/compare';
import { withHue } from '../parts';

/** A blue, a violet, a teal and an amber. */
const HUES = [215, 285, 170, 35] as const;

export function letterAccents(theme: Theme): string[] {
  return HUES.map((hue) => withHue(theme.palette.info.main, hue));
}

export function useLetterAccents(): string[] {
  return letterAccents(useTheme());
}

export function LetterBadge({
  letter,
  accent,
  size = 26,
}: {
  letter: Letter;
  accent: string;
  size?: number;
}) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={(theme) => ({
        alignItems: 'center',
        backgroundColor: alpha(
          accent,
          theme.palette.mode === 'dark' ? 0.24 : 0.16
        ),
        border: `2px solid ${accent}`,
        borderRadius: '50%',
        color: theme.palette.text.primary,
        display: 'inline-flex',
        flexShrink: 0,
        fontSize: size >= 26 ? '0.85rem' : '0.75rem',
        fontWeight: 800,
        height: size,
        justifyContent: 'center',
        lineHeight: 1,
        verticalAlign: 'middle',
        width: size,
      })}
    >
      {letter}
    </Box>
  );
}
