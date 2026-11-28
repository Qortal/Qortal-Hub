/**
 * The accounts opened one from another, as crumbs under the account's
 * header: each one opens that account again, and the trail goes back to it.
 */
import { Box, ButtonBase } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { shortAddress } from '../../lib/explorer/addresses';
import { primaryNameRead } from '../../lib/explorer/reads';
import { visibleName } from '../../lib/explorer/rules';
import { useExplorer, useExplorerRead } from './ExplorerContext';
import { ExplorerAvatar } from './ExplorerSearchField';
import { cap } from './parts';

const CRUMB_SX = {
  alignItems: 'center',
  borderRadius: '8px',
  display: 'inline-flex',
  fontSize: '0.85rem',
  gap: 0.75,
  maxWidth: { xs: 160, sm: 220 },
  minHeight: 32,
  px: 0.75,
} as const;

const LABEL_SX = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

function Crumb({ address, current }: { address: string; current: boolean }) {
  const { openAccount } = useExplorer();
  const name = useExplorerRead(primaryNameRead(address)).data ?? null;
  const content = (
    <>
      <ExplorerAvatar name={name} size={20} />
      <Box component="bdi" dir="auto" sx={LABEL_SX}>
        {name ? visibleName(name) : shortAddress(address)}
      </Box>
    </>
  );
  if (current)
    return (
      <Box
        component="span"
        aria-current="page"
        sx={{ ...CRUMB_SX, fontWeight: 700 }}
      >
        {content}
      </Box>
    );
  return (
    <ButtonBase
      onClick={() => openAccount(address, { fromExplorer: true })}
      sx={(theme) => ({
        ...CRUMB_SX,
        color: theme.palette.primary.main,
        '&:hover': { backgroundColor: theme.palette.action.hover },
        '&.Mui-focusVisible': {
          outline: `2px solid ${theme.palette.primary.main}`,
        },
      })}
    >
      {content}
    </ButtonBase>
  );
}

export function ExplorerTrail({ trail }: { trail: string[] }) {
  const { t } = useTranslation(['explorer']);
  if (trail.length < 2) return null;
  return (
    <Box component="nav" aria-label={t('explorer:trail.label', cap)}>
      <Box
        component="ol"
        sx={(theme) => ({
          alignItems: 'center',
          display: 'flex',
          flexWrap: 'wrap',
          listStyle: 'none',
          m: 0,
          p: 0,
          '& > li + li::before': {
            color: theme.palette.text.secondary,
            content: '"›" / ""',
            px: 0.25,
          },
        })}
      >
        {trail.map((address, index) => (
          <Box
            component="li"
            key={address}
            sx={{ alignItems: 'center', display: 'flex', minWidth: 0 }}
          >
            <Crumb address={address} current={index === trail.length - 1} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}
