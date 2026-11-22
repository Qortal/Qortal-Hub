/**
 * Compare's accounts: one card each, lettered A–D in its colour (the
 * letter and the name always show, so colour is never the only mark): its
 * picture and name (opening it in the Explorer, a step on the trail), its
 * address with Copy, its level, where it stands in MINTER, Dev Admin,
 * minting now, a minting penalty, and Remove. An address the node doesn't
 * know says so on its card, and so does a read that failed (with Retry):
 * a chip left out is never a silent "no". Under the cards, a field for one
 * more account, up to 4.
 */
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useTranslation } from 'react-i18next';
import { shortAddress } from '../../../lib/explorer/addresses';
import { COMPARE_MAX } from '../../../lib/explorer/comparePicks';
import { devAdminsRead } from '../../../lib/explorer/reads';
import { minterStandingOf, mintingNowOf } from '../../../lib/explorer/rules';
import { PersonButton, useAccountLabel } from '../connections/ConnectionRow';
import { useExplorerRead } from '../ExplorerContext';
import { ExplorerSearchField } from '../ExplorerSearchField';
import {
  cap,
  CopyButton,
  LoadingLine,
  mutedText,
  ReadError,
  StatusChip,
} from '../parts';
import { LetterBadge } from './letters';
import type { LookupNote } from './useAccountLookup';
import type { CompareData, CompareSideData } from './useCompareData';

const CHIPS_SX = {
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 0.75,
  listStyle: 'none',
  m: 0,
  p: 0,
} as const;

function CompareCard({
  side,
  accent,
  data,
  onRemove,
}: {
  side: CompareSideData;
  accent: string;
  data: CompareData;
  onRemove: (address: string) => void;
}) {
  const { t } = useTranslation(['core', 'explorer', 'group']);
  const { address, letter, account, explored } = side;
  // Its name only once the node knows it: nothing more is read about an address it doesn't.
  const { label } = useAccountLabel(address, account !== null);
  const devAdmins = useExplorerRead(account ? devAdminsRead() : null);
  const online = data.online;
  // For its labels: a screen reader doesn't need the name isolated.
  const who = { name: label, letter };

  let body;
  if (account) {
    const standing = side.groups.data
      ? minterStandingOf(side.groups.data)
      : undefined;
    const minting = online?.data
      ? mintingNowOf(online.data, address)
      : undefined;
    const chips: Array<{
      kind: Parameters<typeof StatusChip>[0]['kind'];
      label: string;
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
      chips.push({ kind: 'admin', label: t('explorer:chip.minter_admin') });
    if (standing === 'member')
      chips.push({ kind: 'member', label: t('explorer:chip.minter_member') });
    if (devAdmins.data?.includes(address))
      chips.push({ kind: 'devAdmin', label: t('explorer:chip.dev_admin') });
    if (minting)
      chips.push({
        kind: 'minting',
        label: t('explorer:chip.minting_now', cap),
      });
    if (account.blocksMintedPenalty !== 0)
      chips.push({
        kind: 'penalty',
        label: t('explorer:chip.minting_penalty', cap),
      });
    body = (
      <>
        <Box
          component="ul"
          aria-label={t('explorer:compare.card.about', { ...who, ...cap })}
          sx={CHIPS_SX}
        >
          {chips.map((chip) => (
            <li key={chip.kind}>
              <StatusChip kind={chip.kind} label={chip.label} />
            </li>
          ))}
        </Box>
        {side.groups.status === 'error' && !side.groups.data ? (
          <ReadError
            message={t('explorer:groups.failed', cap)}
            onRetry={side.groups.retry}
          />
        ) : null}
      </>
    );
  } else if (explored.data?.kind === 'unused')
    body = (
      <Typography variant="body2" sx={(theme) => ({ color: mutedText(theme) })}>
        {t('explorer:account.unused', cap)}
      </Typography>
    );
  else if (explored.data?.kind === 'invalid')
    body = (
      <Typography variant="body2" sx={(theme) => ({ color: mutedText(theme) })}>
        {t('explorer:account.invalid', cap)}
      </Typography>
    );
  else if (explored.status === 'error')
    body = (
      <ReadError
        message={t('explorer:account.failed', cap)}
        onRetry={explored.retry}
      />
    );
  else
    body = (
      <LoadingLine
        label={t('explorer:compare.card.loading', { letter, ...cap })}
      />
    );

  return (
    <Box
      component="li"
      sx={(theme) => ({
        backgroundColor: theme.palette.background.surface,
        border: `1px solid ${theme.palette.divider}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
        minWidth: 0,
        p: { xs: 1.5, sm: 2 },
      })}
    >
      <Box sx={{ alignItems: 'center', display: 'flex', gap: 1, minWidth: 0 }}>
        <LetterBadge letter={letter} accent={accent} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {account ? (
            <PersonButton
              address={address}
              near
              secondary={t('explorer:compare.card.letter', { letter, ...cap })}
            />
          ) : (
            <Typography
              component="span"
              sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}
            >
              {t('explorer:compare.card.letter', { letter, ...cap })}
            </Typography>
          )}
        </Box>
        <Tooltip title={t('explorer:compare.card.remove_short', cap)}>
          <IconButton
            size="small"
            aria-label={t('explorer:compare.card.remove', { ...who, ...cap })}
            onClick={() => onRemove(address)}
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box
        sx={{ alignItems: 'center', display: 'flex', gap: 0.5, minWidth: 0 }}
      >
        <Typography
          component="span"
          variant="body2"
          sx={{
            fontFamily: 'monospace',
            fontSize: '0.8rem',
            minWidth: 0,
            overflowWrap: 'anywhere',
          }}
        >
          {account ? shortAddress(address) : address}
        </Typography>
        <CopyButton
          value={address}
          label={t('explorer:compare.card.copy_address', { ...who, ...cap })}
          copiedMessage={t('group:home.address_copied', cap)}
        />
      </Box>
      {body}
    </Box>
  );
}

export function CompareCards({
  data,
  accents,
  onRemove,
  onAdd,
  note,
}: {
  data: CompareData;
  accents: readonly string[];
  onRemove: (address: string) => void;
  /** What was typed or picked in the field for one more account. */
  onAdd: (typed: string) => void;
  /** What the field says (one already compared, a name no one has, …). */
  note: LookupNote | null;
}) {
  const { t } = useTranslation(['explorer']);
  const count = data.sides.length;
  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}
    >
      <Box sx={{ containerType: 'inline-size' }}>
        <Box
          component="ul"
          aria-label={t('explorer:compare.card.list', cap)}
          sx={{
            display: 'grid',
            gap: 1.5,
            gridTemplateColumns: 'minmax(0, 1fr)',
            listStyle: 'none',
            m: 0,
            p: 0,
            '@container (min-width: 560px)': {
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            },
            ...(count === 3
              ? {
                  '@container (min-width: 900px)': {
                    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  },
                }
              : {}),
          }}
        >
          {data.sides.map((side) => (
            <CompareCard
              key={side.address}
              side={side}
              accent={accents[side.index]}
              data={data}
              onRemove={onRemove}
            />
          ))}
        </Box>
      </Box>
      {count < COMPARE_MAX ? (
        <Box sx={{ maxWidth: 520 }}>
          <ExplorerSearchField
            compact
            placeholder={t('explorer:compare.add.label', cap)}
            onLookUp={onAdd}
          />
        </Box>
      ) : (
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {t('explorer:compare.add.full', cap)}
        </Typography>
      )}
      <Typography
        role="status"
        variant="body2"
        sx={(theme) => ({ color: mutedText(theme), overflowWrap: 'anywhere' })}
      >
        {note ? t(note.key, { ...note.options, ...cap }) : ''}
      </Typography>
    </Box>
  );
}
