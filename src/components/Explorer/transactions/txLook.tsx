/**
 * How a transaction looks in a list: its family's icon in a soft circle of
 * the family's colour (payments green, names pink, minting gold, groups
 * the theme's blue, QDN cyan, trading orange, messages the info blue, the
 * rest grey), and which way it went from the account's side, an arrow in
 * green (in) or red (out) with the word for screen readers, so colour is
 * never the only sign. All from the theme. Decorative: the sentence beside
 * it says what happened.
 */
import { useMemo } from 'react';
import { Box } from '@mui/material';
import type { SvgIconComponent } from '@mui/icons-material';
import { alpha, styled, type Theme } from '@mui/material/styles';
import { visuallyHidden } from '@mui/utils';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined';
import CallMadeRoundedIcon from '@mui/icons-material/CallMadeRounded';
import CallReceivedRoundedIcon from '@mui/icons-material/CallReceivedRounded';
import ChatBubbleOutlineOutlinedIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import SwapHorizOutlinedIcon from '@mui/icons-material/SwapHorizOutlined';
import { useTranslation } from 'react-i18next';
import { privsRecipientRead, type TxRow } from '../../../lib/explorer/reads';
import { familyOf, type TxTypeFamily } from '../../../lib/explorer/txFamilies';
import { describeTx, type TxWords } from '../../../lib/explorer/txWords';
import { useExplorerRead } from '../ExplorerContext';
import { cap, withHue } from '../parts';

const FAMILY_ICON: Record<TxTypeFamily, SvgIconComponent> = {
  payments: PaymentsOutlinedIcon,
  names: BadgeOutlinedIcon,
  minting: BoltOutlinedIcon,
  groups: GroupsOutlinedIcon,
  qdn: CloudUploadOutlinedIcon,
  trading: SwapHorizOutlinedIcon,
  messages: ChatBubbleOutlineOutlinedIcon,
  other: ReceiptLongOutlinedIcon,
};

/** Each family's colour, from the theme. */
export function familyAccent(theme: Theme, family: TxTypeFamily): string {
  const p = theme.palette;
  switch (family) {
    case 'payments':
      return p.other.positive;
    case 'names':
      return withHue(p.info.main, 320);
    case 'minting':
      return p.other.minting;
    case 'groups':
      return p.primary.main;
    case 'qdn':
      return withHue(p.info.main, 188);
    case 'trading':
      return withHue(p.info.main, 22);
    case 'messages':
      return p.info.main;
    default:
      return p.text.secondary;
  }
}

export type Flow = 'in' | 'out';

/** The colour of each way: in green, out red. */
export const flowColor = (theme: Theme, flow: Flow): string =>
  flow === 'in' ? theme.palette.other.positive : theme.palette.other.danger;

const FAMILIES = Object.keys(FAMILY_ICON) as TxTypeFamily[];

/** The icon's soft circle: one rule per family, styled once for every row. */
const Circle = styled('span')(({ theme }) => ({
  alignItems: 'center',
  borderRadius: '50%',
  color: theme.palette.text.secondary,
  display: 'flex',
  flexShrink: 0,
  height: 34,
  justifyContent: 'center',
  position: 'relative',
  width: 34,
  '& > svg': { fontSize: 20 },
  ...Object.fromEntries(
    FAMILIES.map((family) => {
      const accent = familyAccent(theme, family);
      return [
        `&[data-family="${family}"]`,
        {
          backgroundColor: alpha(
            accent,
            theme.palette.mode === 'dark' ? 0.16 : 0.12
          ),
          color: accent,
        },
      ];
    })
  ),
}));

/** The way it went, on the circle's corner: in green, out red. */
const Corner = styled('span')(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.surface,
  borderRadius: '50%',
  bottom: -3,
  boxShadow: `0 0 0 1px ${theme.palette.divider}`,
  display: 'flex',
  height: 16,
  justifyContent: 'center',
  position: 'absolute',
  right: -3,
  width: 16,
  '& > svg': { fontSize: 12 },
  '&[data-flow="in"]': { color: flowColor(theme, 'in') },
  '&[data-flow="out"]': { color: flowColor(theme, 'out') },
}));

/** The family's icon in its soft circle, with the way it went on its corner. */
export function TxIcon({ type, flow }: { type: string; flow: Flow | null }) {
  const { t } = useTranslation(['explorer']);
  const family = familyOf(type);
  const Icon = FAMILY_ICON[family];
  const Arrow = flow === 'in' ? CallReceivedRoundedIcon : CallMadeRoundedIcon;
  return (
    <Circle data-family={family}>
      <Icon aria-hidden />
      {flow ? (
        <>
          <Corner aria-hidden data-flow={flow}>
            <Arrow />
          </Corner>
          <Box component="span" sx={visuallyHidden}>
            {flow === 'in'
              ? t('explorer:tx.incoming', cap)
              : t('explorer:tx.outgoing', cap)}
          </Box>
        </>
      ) : null}
    </Circle>
  );
}

/**
 * A transaction in words (lib/explorer/txWords.ts), with the one thing
 * Core's JSON leaves out: who received a minting level (TRANSFER_PRIVS).
 * In an account's own list the account either made the move or received
 * it (an address search finds no one else), so a move it didn't make was
 * to it and nothing needs reading; otherwise the recipient is read from
 * the raw bytes once `near`.
 */
export function useTxWords(
  tx: TxRow,
  viewpoint: string | null,
  near = true
): TxWords & { privsFailed: (() => void) | null } {
  const privs = tx.type === 'TRANSFER_PRIVS';
  const toViewpoint =
    privs && viewpoint && tx.creatorAddress !== viewpoint ? viewpoint : null;
  const recipient = useExplorerRead(
    privs && !toViewpoint && near ? privsRecipientRead(tx.signature) : null
  );
  const privsRecipient = toViewpoint ?? recipient.data ?? null;
  const words = useMemo(
    () => describeTx(tx, { viewpoint, privsRecipient }),
    [tx, viewpoint, privsRecipient]
  );
  return {
    ...words,
    privsFailed: recipient.status === 'error' ? recipient.retry : null,
  };
}
