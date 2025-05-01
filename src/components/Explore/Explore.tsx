import { Box, ButtonBase, Typography, useTheme } from '@mui/material';
import ChatIcon from '@mui/icons-material/Chat';
import qTradeLogo from '../../assets/Icons/q-trade-logo.webp';
import AppsIcon from '@mui/icons-material/Apps';
import { executeEvent } from '../../utils/events';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import { useTranslation } from 'react-i18next';

export const Explore = ({ setDesktopViewMode }) => {
  const theme = useTheme();
  const { t } = useTranslation(['core', 'tutorial']);

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
          borderRadius: '5px',
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
          {t('tutorial:initial.trade_qort', { postProcess: 'capitalize' })}
        </Typography>
      </ButtonBase>

      <ButtonBase
        sx={{
          '&:hover': { backgroundColor: theme.palette.background.paper },
          borderRadius: '5px',
          gap: '5px',
          padding: '5px',
          transition: 'all 0.1s ease-in-out',
        }}
        onClick={() => {
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
          {t('tutorial:initial.see_apps', { postProcess: 'capitalize' })}
        </Typography>
      </ButtonBase>

      <ButtonBase
        sx={{
          '&:hover': { backgroundColor: theme.palette.background.paper },
          borderRadius: '5px',
          gap: '5px',
          padding: '5px',
          transition: 'all 0.1s ease-in-out',
        }}
        onClick={async () => {
          executeEvent('openGroupMessage', {
            from: '0',
          });
        }}
      >
        <ChatIcon
          sx={{
            color: theme.palette.text.primary,
          }}
        />
        <Typography
          sx={{
            fontSize: '1rem',
          }}
        >
          {t('tutorial:initial.general_chat', { postProcess: 'capitalize' })}
        </Typography>
      </ButtonBase>
      <ButtonBase
        sx={{
          '&:hover': { backgroundColor: theme.palette.background.paper },
          transition: 'all 0.1s ease-in-out',
          padding: '5px',
          borderRadius: '5px',
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
          {t('core:wallet.wallet_other', { postProcess: 'capitalize' })}
        </Typography>
      </ButtonBase>
    </Box>
  );
};
