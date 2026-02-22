import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import AppsIcon from '@mui/icons-material/Apps';
import { Box, ButtonBase, Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import qTradeLogo from '../../assets/Icons/q-trade-logo.webp';
import { executeEvent } from '../../utils/events';

export const Explore = ({ setDesktopViewMode }) => {
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core', 'group', 'tutorial']);

  return (
    <Box
      sx={{
        display: 'flex',
        gap: '20px',
        flexWrap: 'wrap',
      }}
    >
      <ButtonBase
        sx={{
          '&:hover': { backgroundColor: theme.palette.background.paper },
          borderRadius: '8px',
          gap: '5px',
          padding: '5px',
          transition: 'all 0.1s ease-in-out',
        }}
        onClick={async () => {
          executeEvent('addTab', {
            data: { service: 'APP', name: 'q-trade' },
          });
          executeEvent('open-apps-mode', {});
        }}
      >
        <img
          style={{
            borderRadius: '50%',
            height: '30px',
          }}
          src={qTradeLogo}
        />

        <Typography
          sx={{
            fontSize: '1rem',
          }}
        >
          {t('tutorial:initial.trade_qort', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
      </ButtonBase>

      <ButtonBase
        sx={{
          '&:hover': { backgroundColor: theme.palette.background.paper },
          borderRadius: '8px',
          gap: '5px',
          padding: '5px',
          transition: 'all 0.1s ease-in-out',
        }}
        onClick={() => {
          executeEvent('newTabWindow', {});
          setDesktopViewMode('apps');
        }}
      >
        <AppsIcon
          sx={{
            color: theme.palette.text.primary,
          }}
        />

        <Typography
          sx={{
            fontSize: '1rem',
          }}
        >
          {t('tutorial:initial.see_apps', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
      </ButtonBase>

      <ButtonBase
        sx={{
          '&:hover': { backgroundColor: theme.palette.background.paper },
          transition: 'all 0.1s ease-in-out',
          padding: '5px',
          borderRadius: '8px',
          gap: '5px',
        }}
        onClick={async () => {
          executeEvent('openWalletsApp', {});
        }}
      >
        <AccountBalanceWalletIcon
          sx={{
            color: theme.palette.text.primary,
          }}
        />

        <Typography
          sx={{
            fontSize: '1rem',
          }}
        >
          {t('core:wallet.wallet_other', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
      </ButtonBase>
    </Box>
  );
};
