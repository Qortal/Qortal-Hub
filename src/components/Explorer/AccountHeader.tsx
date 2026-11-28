/**
 * The top of an account: its picture and name, chips for its level, where
 * it stands in MINTER, Dev Admin, minting now, a minting penalty and
 * whether you blocked it, then its address and public key with Copy, a
 * note when it was opened by a name, and what User search offered: Send
 * QORT and Block. The chips' colours say what kind of fact each is, never
 * good or bad.
 */
import { useState } from 'react';
import { Box, Button, Tooltip, Typography } from '@mui/material';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import BlockRoundedIcon from '@mui/icons-material/BlockRounded';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  infoSnackGlobalAtom,
  isRunningPublicNodeAtom,
  openSnackGlobalAtom,
} from '../../atoms/global';
import { useBlockedAddresses } from '../../hooks/useBlockUsers';
import { executeEvent } from '../../utils/events';
import { shortAddress } from '../../lib/explorer/addresses';
import type { AccountInfo, NamesOf } from '../../lib/explorer/reads';
import {
  visibleName,
  type MinterStanding,
  type MintingNow,
} from '../../lib/explorer/rules';
import { useExplorer } from './ExplorerContext';
import { ExplorerAvatar } from './ExplorerSearchField';
import {
  cap,
  CopyButton,
  isolate,
  mutedText,
  ReadError,
  StatusChip,
} from './parts';

/** An account opened by one of its names: what was asked, and the name the node matched. */
export interface NameMatch {
  typed: string;
  matched: string;
}

export interface AccountHeaderProps {
  account: AccountInfo;
  /** Its primary name: undefined while loading (or when the read failed), null for none. */
  primary: string | null | undefined;
  /** Set when reading its name failed: read it again. */
  onRetryPrimary: (() => void) | null;
  names: NamesOf | undefined;
  standing: MinterStanding | undefined;
  devAdmin: boolean;
  minting: MintingNow | null | undefined;
  openedBy: NameMatch | null;
}

function KeyLine({
  label,
  value,
  copyLabel,
  copiedMessage,
}: {
  label: string;
  value: string;
  copyLabel: string;
  copiedMessage: string;
}) {
  return (
    <Box sx={{ alignItems: 'center', display: 'flex', gap: 0.5, minWidth: 0 }}>
      <Typography
        component="span"
        variant="body2"
        sx={(theme) => ({ color: mutedText(theme), flexShrink: 0 })}
      >
        {label}
      </Typography>
      <Typography
        component="span"
        variant="body2"
        sx={{
          fontFamily: 'monospace',
          fontSize: '0.82rem',
          minWidth: 0,
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </Typography>
      <CopyButton
        value={value}
        label={copyLabel}
        copiedMessage={copiedMessage}
      />
    </Box>
  );
}

export function AccountHeader({
  account,
  primary,
  onRetryPrimary,
  names,
  standing,
  devAdmin,
  minting,
  openedBy,
}: AccountHeaderProps) {
  const { t } = useTranslation(['auth', 'core', 'explorer', 'group']);
  const { viewer, close } = useExplorer();
  const isPublicNode = useAtomValue(isRunningPublicNodeAtom);
  const setInfoSnack = useSetAtom(infoSnackGlobalAtom);
  const setOpenSnack = useSetAtom(openSnackGlobalAtom);
  const { addToBlockList, isUserBlocked, removeBlockFromList } =
    useBlockedAddresses(true);
  const [blockPending, setBlockPending] = useState(false);

  const { address } = account;
  const own = viewer === address;
  const blocked = isUserBlocked(address);
  const name = primary ?? null;

  const say = (type: 'success' | 'error', message: string) => {
    setInfoSnack({ compact: true, duration: 3200, message, type });
    setOpenSnack(true);
  };

  // Block takes the address and its name together, as User search did: it waits for the name.
  const nameKnown = primary !== undefined;
  const toggleBlock = async () => {
    if (own || isPublicNode || blockPending || !nameKnown) return;
    setBlockPending(true);
    try {
      if (blocked) {
        await removeBlockFromList(address, name ?? undefined);
        say('success', t('explorer:header.unblocked', cap));
      } else {
        await addToBlockList(address, name ?? undefined);
        say('success', t('explorer:header.blocked', cap));
      }
    } catch {
      say('error', t('auth:message.error.block_user', cap));
    } finally {
      setBlockPending(false);
    }
  };

  // The address only: a name could change hands before the payment is sent.
  const sendQort = () => {
    executeEvent('openPaymentInternal', { address });
    close();
  };

  const chips: Array<{
    kind: Parameters<typeof StatusChip>[0]['kind'];
    label: string;
    explanation?: string;
  }> = [
    {
      kind: 'level',
      label: t('core:account_lookup.chip_level', {
        level: account.level,
        ...cap,
      }),
    },
  ];
  if (standing === 'admin')
    chips.push({
      kind: 'admin',
      label: t('explorer:chip.minter_admin'),
      explanation: t('explorer:chip.minter_admin_explained', cap),
    });
  if (standing === 'member')
    chips.push({
      kind: 'member',
      label: t('explorer:chip.minter_member'),
      explanation: t('explorer:chip.minter_member_explained', cap),
    });
  if (devAdmin)
    chips.push({
      kind: 'devAdmin',
      label: t('explorer:chip.dev_admin'),
      explanation: t('explorer:chip.dev_admin_explained', cap),
    });
  if (minting)
    chips.push({
      kind: 'minting',
      label: t('explorer:chip.minting_now', cap),
      explanation: t('explorer:chip.minting_now_explained', cap),
    });
  if (account.blocksMintedPenalty !== 0)
    chips.push({
      kind: 'penalty',
      label: t('explorer:chip.minting_penalty', cap),
      explanation: t('explorer:chip.minting_penalty_explained', cap),
    });
  if (blocked)
    chips.push({
      kind: 'blocked',
      label: t('core:account_lookup.chip_blocked', cap),
    });

  let subtitle: string | null = null;
  if (primary === null && names)
    subtitle = names.names.length
      ? t('explorer:header.no_primary_name', cap)
      : t('core:account_lookup.chip_no_registered_name', cap);

  const typedOtherName =
    openedBy && openedBy.typed !== openedBy.matched ? openedBy : null;
  const openedByOtherName =
    openedBy && !typedOtherName && primary && openedBy.matched !== primary
      ? openedBy
      : null;

  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}
    >
      <Box
        sx={{ alignItems: 'center', display: 'flex', gap: 1.5, minWidth: 0 }}
      >
        <ExplorerAvatar name={name} size={56} decorative={false} />
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 0.75,
            minWidth: 0,
          }}
        >
          <Typography
            component="h2"
            sx={{
              fontSize: { xs: '1.15rem', sm: '1.3rem' },
              fontWeight: 700,
              lineHeight: 1.25,
              overflowWrap: 'anywhere',
            }}
          >
            <bdi dir="auto">
              {name ? visibleName(name) : shortAddress(address)}
            </bdi>
          </Typography>
          {onRetryPrimary ? (
            <ReadError
              message={t('explorer:header.name_failed', cap)}
              onRetry={onRetryPrimary}
            />
          ) : null}
          {subtitle ? (
            <Typography
              variant="body2"
              sx={(theme) => ({ color: mutedText(theme) })}
            >
              {subtitle}
            </Typography>
          ) : null}
          <Box
            component="ul"
            aria-label={t('explorer:header.about', cap)}
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 0.75,
              listStyle: 'none',
              m: 0,
              p: 0,
            }}
          >
            {chips.map((chip) => (
              <li key={chip.kind}>
                <StatusChip
                  kind={chip.kind}
                  label={chip.label}
                  explanation={chip.explanation}
                />
              </li>
            ))}
          </Box>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        <KeyLine
          label={t('core:account_lookup.label_address', cap)}
          value={address}
          copyLabel={t('core:message.generic.copy_address', cap)}
          copiedMessage={t('group:home.address_copied', cap)}
        />
        {account.publicKey ? (
          <KeyLine
            label={t('core:account_lookup.label_public_key', cap)}
            value={account.publicKey}
            copyLabel={t('explorer:header.copy_public_key', cap)}
            copiedMessage={t('explorer:header.public_key_copied', cap)}
          />
        ) : null}
      </Box>

      {typedOtherName || openedByOtherName ? (
        <Typography
          role="note"
          variant="body2"
          sx={(theme) => ({
            color: mutedText(theme),
            overflowWrap: 'anywhere',
          })}
        >
          {typedOtherName
            ? t('explorer:header.name_matched', {
                typed: isolate(visibleName(typedOtherName.typed)),
                matched: isolate(visibleName(typedOtherName.matched)),
                ...cap,
              })
            : t('explorer:header.opened_from_name', {
                name: isolate(visibleName(openedByOtherName.matched)),
                ...cap,
              })}
        </Typography>
      ) : null}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <Tooltip
          title={own ? t('core:account_lookup.tooltip_send_disabled', cap) : ''}
        >
          <span>
            <Button
              variant="contained"
              size="small"
              startIcon={<SendRoundedIcon />}
              disabled={own}
              onClick={sendQort}
            >
              {t('core:action.send_qort', cap)}
            </Button>
          </span>
        </Tooltip>
        <Tooltip
          title={
            own
              ? t('core:account_lookup.tooltip_block_self', cap)
              : isPublicNode
                ? t('core:account_lookup.tooltip_block_public_node', cap)
                : ''
          }
        >
          <span>
            <Button
              variant="outlined"
              size="small"
              color={blocked ? 'inherit' : 'error'}
              startIcon={<BlockRoundedIcon />}
              disabled={own || isPublicNode || blockPending || !nameKnown}
              onClick={() => void toggleBlock()}
            >
              {blocked
                ? t('core:account_lookup.action_unblock', cap)
                : t('core:account_lookup.action_block', cap)}
            </Button>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}
