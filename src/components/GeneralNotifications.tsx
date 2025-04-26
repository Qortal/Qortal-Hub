import { useState } from 'react';
import {
  Box,
  ButtonBase,
  Card,
  MenuItem,
  Popover,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import { formatDate } from '../utils/time';
import { useHandlePaymentNotification } from '../hooks/useHandlePaymentNotification';
import { executeEvent } from '../utils/events';
import { useTranslation } from 'react-i18next';

export const GeneralNotifications = ({ address }) => {
  const [anchorEl, setAnchorEl] = useState(null);

  const {
    latestTx,
    getNameOrAddressOfSenderMiddle,
    hasNewPayment,
    setLastEnteredTimestampPayment,
    nameAddressOfSender,
  } = useHandlePaymentNotification(address);

  const handlePopupClick = (event) => {
    event.stopPropagation(); // Prevent parent onClick from firing
    setAnchorEl(event.currentTarget);
  };

  const { t } = useTranslation(['core']);
  const theme = useTheme();

  return (
    <>
      <ButtonBase
        onClick={(e) => {
          handlePopupClick(e);
        }}
        style={{}}
      >
        <Tooltip
          title={
            <span
              style={{
                color: theme.palette.text.primary,
                fontSize: '14px',
                fontWeight: 700,
                textTransform: 'uppercase',
              }}
            >
              {t('core:payment_notification')}
            </span>
          }
          placement="left"
          arrow
          sx={{ fontSize: '24' }}
          slotProps={{
            tooltip: {
              sx: {
                color: theme.palette.text.primary,
                backgroundColor: theme.palette.background.paper,
              },
            },
            arrow: {
              sx: {
                color: theme.palette.text.primary,
              },
            },
          }}
        >
          <NotificationsIcon
            sx={{
              color: hasNewPayment
                ? 'var(--unread)'
                : theme.palette.text.primary,
            }}
          />
        </Tooltip>
      </ButtonBase>

      <Popover
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => {
          if (hasNewPayment) {
            setLastEnteredTimestampPayment(Date.now());
          }
          setAnchorEl(null);
        }} // Close popover on click outside
      >
        <Box
          sx={{
            alignItems: hasNewPayment ? 'flex-start' : 'center',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '60vh',
            maxWidth: '100%',
            overflow: 'auto',
            padding: '5px',
            width: '300px',
          }}
        >
          {!hasNewPayment && (
            <Typography
              sx={{
                userSelect: 'none',
              }}
            >
              No new notifications
            </Typography>
          )}
          {hasNewPayment && (
            <MenuItem
              sx={{
                alignItems: 'flex-start',
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
                textWrap: 'auto',
                width: '100%',
              }}
              onClick={() => {
                setAnchorEl(null);
                executeEvent('openWalletsApp', {});
              }}
            >
              <Card
                sx={{
                  backgroundColor: '#1F2023',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '5px',
                  padding: '10px',
                  width: '100%',
                }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    gap: '5px',
                    justifyContent: 'space-between',
                  }}
                >
                  <AccountBalanceWalletIcon
                    sx={{
                      color: 'white',
                    }}
                  />{' '}
                  {formatDate(latestTx?.timestamp)}
                </Box>

                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    justifyContent: 'space-between',
                  }}
                >
                  <Typography>{latestTx?.amount}</Typography>
                </Box>

                <Typography
                  sx={{
                    fontSize: '0.8rem',
                  }}
                >
                  {nameAddressOfSender.current[latestTx?.creatorAddress] ||
                    getNameOrAddressOfSenderMiddle(latestTx?.creatorAddress)}
                </Typography>
              </Card>
            </MenuItem>
          )}
        </Box>
      </Popover>
    </>
  );
};
