/**
 * The Explorer's start page: one field for any account, your own account,
 * the accounts explored on this device (when remembering is on), and the
 * whole chain's latest transactions (chain/ChainLatest.tsx).
 * Read-only: nothing here sends anything.
 */
import { Box, Button, ButtonBase, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { shortAddress } from '../../lib/explorer/addresses';
import { primaryNameRead } from '../../lib/explorer/reads';
import { visibleName } from '../../lib/explorer/rules';
import { ChainLatest } from './chain/ChainLatest';
import { useExplorer, useExplorerRead } from './ExplorerContext';
import { ExplorerAvatar, ExplorerSearchField } from './ExplorerSearchField';
import { cap, mutedText, panelSx, Section } from './parts';
import { useExchangeName } from './useExplorerAccess';

/** An account to open: its picture, name (or short address) and address. */
export function AccountRow({
  address,
  fromExplorer,
}: {
  address: string;
  fromExplorer: boolean;
}) {
  const { openAccount } = useExplorer();
  const primary = useExplorerRead(primaryNameRead(address));
  const name = primary.data ?? null;
  const exchange = useExchangeName(address);
  return (
    <ButtonBase
      onClick={() => openAccount(address, { fromExplorer })}
      sx={(theme) => ({
        alignItems: 'center',
        borderRadius: '10px',
        display: 'flex',
        gap: 1.25,
        justifyContent: 'flex-start',
        minHeight: 48,
        px: 1,
        textAlign: 'left',
        width: '100%',
        '&:hover': { backgroundColor: theme.palette.action.hover },
        '&.Mui-focusVisible': {
          outline: `2px solid ${theme.palette.primary.main}`,
        },
      })}
    >
      <ExplorerAvatar name={name} size={32} />
      <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Typography
          component="span"
          sx={{
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          <bdi dir="auto">
            {name ? visibleName(name) : (exchange ?? shortAddress(address))}
          </bdi>
        </Typography>
        <Typography
          component="span"
          variant="body2"
          sx={(theme) => ({
            color: mutedText(theme),
            fontFamily: 'monospace',
            fontSize: '0.78rem',
          })}
        >
          {name || exchange ? shortAddress(address) : address}
        </Typography>
      </Box>
    </ButtonBase>
  );
}

const LIST_SX = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0.25,
  listStyle: 'none',
  m: 0,
  p: 0,
} as const;

export function ExplorerStart({
  recent,
  onClearRecent,
}: {
  recent: string[];
  onClearRecent: () => void;
}) {
  const { t } = useTranslation(['explorer']);
  const { openAccount, viewer } = useExplorer();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <ExplorerSearchField autoFocus onLookUp={(who) => openAccount(who)} />
      {viewer ? (
        <Section
          id="explorer-you"
          title={t('explorer:start.your_account', cap)}
        >
          <Box sx={panelSx}>
            <AccountRow address={viewer} fromExplorer={false} />
          </Box>
        </Section>
      ) : null}
      {recent.length ? (
        <Section
          id="explorer-recent"
          title={t('explorer:start.recent', cap)}
          action={
            <Button
              size="small"
              onClick={onClearRecent}
              aria-label={t('explorer:start.clear_recent', cap)}
            >
              {t('explorer:start.clear', cap)}
            </Button>
          }
        >
          <Box sx={panelSx}>
            <Box component="ul" sx={LIST_SX}>
              {recent.map((address) => (
                <li key={address}>
                  <AccountRow address={address} fromExplorer={false} />
                </li>
              ))}
            </Box>
          </Box>
        </Section>
      ) : null}
      <ChainLatest />
    </Box>
  );
}
