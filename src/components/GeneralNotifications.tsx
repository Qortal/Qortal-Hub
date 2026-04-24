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
import NotificationsNoneRoundedIcon from '@mui/icons-material/NotificationsNoneRounded';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import { alpha } from '@mui/material/styles';
import { formatDate } from '../utils/time';
import { useHandlePaymentNotification } from '../hooks/useHandlePaymentNotification';
import { executeEvent } from '../utils/events';
import { useTranslation } from 'react-i18next';

export const GeneralNotifications = ({
  address,
  tooltipPlacement = 'left',
  compact = false,
  buttonSx = undefined,
  iconSx = undefined,
}) => {
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

  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const theme = useTheme();
  const isOpen = !!anchorEl;
  const NotificationIcon = hasNewPayment
    ? NotificationsActiveRoundedIcon
    : NotificationsNoneRoundedIcon;

  return (
    <>
      <ButtonBase
        onClick={(e) => {
          handlePopupClick(e);
        }}
        sx={buttonSx || undefined}
        aria-label="Payment notifications"
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
          placement={tooltipPlacement}
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
          <NotificationIcon
            sx={{
              color: hasNewPayment
                ? theme.palette.other.unread
                : theme.palette.text.secondary,
              fontSize: compact ? 20 : undefined,
              ...(iconSx || {}),
            }}
          />
        </Tooltip>
      </ButtonBase>

      <Popover
        open={isOpen}
        anchorEl={anchorEl}
        onClose={() => {
          if (hasNewPayment) {
            setLastEnteredTimestampPayment(Date.now());
          }
          setAnchorEl(null);
        }} // Close popover on click outside
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'center',
        }}
        slotProps={{
          paper: {
            sx: {
              background: `linear-gradient(180deg, ${alpha('#252A33', 0.98)} 0%, ${alpha(
                '#1C2129',
                0.98
              )} 100%)`,
              backgroundImage: 'none',
              border: `1px solid ${alpha('#FFFFFF', 0.06)}`,
              borderRadius: '16px',
              boxShadow: `0 18px 40px ${alpha('#000000', 0.34)}`,
              mt: 1,
              overflow: 'hidden',
            },
          },
        }}
      >
        <Box
          sx={{
            alignItems: hasNewPayment ? 'stretch' : 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: hasNewPayment ? 0 : 1.25,
            justifyContent: hasNewPayment ? 'flex-start' : 'center',
            minHeight: hasNewPayment ? 'unset' : 152,
            maxHeight: '60vh',
            maxWidth: '100%',
            overflow: 'auto',
            padding: hasNewPayment ? '8px' : '18px 20px',
            width: '320px',
          }}
        >
          {!hasNewPayment && (
            <>
              <NotificationIcon
                sx={{
                  color: alpha(theme.palette.text.secondary, 0.82),
                  fontSize: 22,
                }}
              />
              <Typography
                sx={{
                  color: theme.palette.text.primary,
                  fontSize: '0.96rem',
                  fontWeight: 600,
                  textAlign: 'center',
                  userSelect: 'none',
                }}
              >
                No new payment notifications
              </Typography>
              <Typography
                sx={{
                  color: alpha(theme.palette.text.secondary, 0.76),
                  fontSize: '0.78rem',
                  lineHeight: 1.5,
                  maxWidth: '240px',
                  textAlign: 'center',
                  userSelect: 'none',
                }}
              >
                Latest incoming payment notification from the past 24 hours will
                appear here.
              </Typography>
            </>
          )}
          {hasNewPayment && (
            <MenuItem
              sx={{
                alignItems: 'flex-start',
                borderRadius: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
                textWrap: 'auto',
                width: '100%',
                '&:hover': {
                  backgroundColor: alpha('#FFFFFF', 0.035),
                },
              }}
              onClick={() => {
                setAnchorEl(null);
                executeEvent('openWalletsApp', {});
              }}
            >
              <Card
                sx={{
                  background: `linear-gradient(180deg, ${alpha('#242A34', 0.98)} 0%, ${alpha(
                    '#1A1F27',
                    0.98
                  )} 100%)`,
                  border: `1px solid ${alpha('#FFFFFF', 0.055)}`,
                  borderRadius: '14px',
                  boxShadow: `0 10px 24px ${alpha('#000000', 0.22)}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '5px',
                  padding: '12px',
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
                      color: theme.palette.text.primary,
                      fontSize: 19,
                    }}
                  />
                  <Typography
                    sx={{
                      color: alpha(theme.palette.text.secondary, 0.82),
                      fontSize: '0.72rem',
                      fontWeight: 500,
                    }}
                  >
                    {formatDate(latestTx?.timestamp)}
                  </Typography>
                </Box>

                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    justifyContent: 'space-between',
                  }}
                >
                  <Typography
                    sx={{
                      color: theme.palette.text.primary,
                      fontSize: '1rem',
                      fontWeight: 700,
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {latestTx?.amount}
                  </Typography>
                </Box>

                <Typography
                  sx={{
                    color: alpha(theme.palette.text.secondary, 0.86),
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
