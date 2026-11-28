/**
 * The colours of the Overview's Activity, from the theme, so light and
 * dark both follow: each family's as the transaction lists draw it
 * (txLook.tsx), and each kind of milestone's: MINTER's blue for joining,
 * the info blue for asking, amber for a declined request, red for a
 * removal or a ban, violet for a Minter Admin, teal for a ban lifted, the
 * names' pink, minting gold, and the quiet grey for leaving.
 */
import type { Theme } from '@mui/material/styles';
import type { MarkKind } from '../../../../lib/explorer/activity';
import { withHue } from '../../parts';
import { familyAccent } from '../../transactions/txLook';

export function markAccent(theme: Theme, kind: MarkKind): string {
  const p = theme.palette;
  switch (kind) {
    case 'joined':
      return p.primary.main;
    case 'asked':
      return p.info.main;
    case 'declined':
      return p.warning.main;
    case 'removed':
    case 'banned':
      return p.error.main;
    case 'admin':
      return withHue(p.info.main, 275);
    case 'unbanned':
      return withHue(p.info.main, 172);
    case 'name':
      return familyAccent(theme, 'names');
    case 'minting':
      return p.other.minting;
    default:
      return p.text.secondary;
  }
}
