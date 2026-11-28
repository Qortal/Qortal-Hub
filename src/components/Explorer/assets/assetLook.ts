/**
 * An asset's own colour, as its coin has it: the theme's info blue turned
 * to the asset's hue (lib/explorer/assets.ts `assetHue`), so light and dark
 * both follow and neighbouring assets stay apart. Text never wears it: the
 * asset's name beside it says which it is.
 */
import type { Theme } from '@mui/material/styles';
import { assetHue } from '../../../lib/explorer/assets';
import { withHue } from '../parts';

export function assetAccent(theme: Theme, assetId: number): string {
  return withHue(theme.palette.info.main, assetHue(assetId));
}
