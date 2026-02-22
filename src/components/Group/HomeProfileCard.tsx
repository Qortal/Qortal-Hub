import { useState } from 'react';
import {
  Avatar,
  Box,
  IconButton,
  Popover,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PersonIcon from '@mui/icons-material/Person';
import SendIcon from '@mui/icons-material/Send';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import QRCode from 'react-qr-code';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  userInfoAtom,
  balanceAtom,
  openSnackGlobalAtom,
  infoSnackGlobalAtom,
} from '../../atoms/global';
import { getBaseApiReactForAvatar } from '../../utils/globalApi';
import { executeEvent } from '../../utils/events';

export const HomeProfileCard = () => {
  const { t } = useTranslation(['tutorial', 'core']);
  const theme = useTheme();
  const userInfo = useAtomValue(userInfoAtom);
  const balance = useAtomValue(balanceAtom);
  const setOpenSnack = useSetAtom(openSnackGlobalAtom);
  const setInfoSnack = useSetAtom(infoSnackGlobalAtom);

  const [avatarError, setAvatarError] = useState(false);
  const [qrAnchorEl, setQrAnchorEl] = useState<HTMLElement | null>(null);

  const name = userInfo?.name;
  const address = userInfo?.address;
  const avatarUrl =
    name && !avatarError
      ? `${getBaseApiReactForAvatar()}/arbitrary/THUMBNAIL/${name}/qortal_avatar?async=true`
      : null;

  const formattedBalance = balance != null ? Number(balance).toFixed(2) : '—';

  const handleCopyAddress = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setInfoSnack({
      type: 'info',
      message: t('tutorial:home.address_copied', {
        postProcess: 'capitalizeFirstChar',
      }),
    });
    setOpenSnack(true);
  };

  const handleTransferQort = () => {
    executeEvent('openPaymentInternal', {});
  };

  const handleOpenQTrade = () => {
    executeEvent('addTab', { data: { service: 'APP', name: 'q-trade' } });
    executeEvent('open-apps-mode', {});
  };

  return (
    <Box
      sx={{
        alignItems: 'center',
        bgcolor: theme.palette.background.paper,
        borderRadius: '12px',
        display: 'flex',
        gap: '16px',
        justifyContent: 'space-between',
        padding: '16px 20px',
        width: '100%',
      }}
    >
      {/* Left: Avatar + Name */}
      <Box
        sx={{ alignItems: 'center', display: 'flex', flexShrink: 0, gap: '12px' }}
      >
        <Avatar
          src={avatarUrl ?? undefined}
          onError={() => setAvatarError(true)}
          sx={{ height: 56, width: 56 }}
        >
          <PersonIcon sx={{ fontSize: 32 }} />
        </Avatar>

        <Typography
          sx={{
            color: theme.palette.text.primary,
            fontSize: '1rem',
            fontWeight: 600,
            maxWidth: '140px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name ?? `${address?.slice(0, 8) ?? ''}…`}
        </Typography>
      </Box>

      {/* Center: Address (copy on click) */}
      <Tooltip
        title={t('tutorial:home.copy_address', {
          postProcess: 'capitalizeFirstChar',
        })}
      >
        <Box
          onClick={handleCopyAddress}
          sx={{
            alignItems: 'center',
            bgcolor: theme.palette.background.default,
            borderRadius: '8px',
            cursor: 'pointer',
            display: 'flex',
            flex: 1,
            gap: '6px',
            justifyContent: 'center',
            maxWidth: '360px',
            padding: '8px 12px',
            '&:hover': { bgcolor: theme.palette.action.hover },
          }}
        >
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontFamily: 'monospace',
              fontSize: '0.78rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {address ?? '—'}
          </Typography>
          <ContentCopyIcon
            sx={{
              color: theme.palette.text.secondary,
              flexShrink: 0,
              fontSize: '0.9rem',
            }}
          />
        </Box>
      </Tooltip>

      {/* Right: Balance + actions */}
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexShrink: 0,
          gap: '4px',
        }}
      >
        {/* Balance */}
        <Box
          sx={{
            alignItems: 'flex-end',
            display: 'flex',
            flexDirection: 'column',
            mr: '8px',
          }}
        >
          <Typography
            sx={{ color: theme.palette.text.secondary, fontSize: '0.72rem' }}
          >
            {t('tutorial:home.balance', { postProcess: 'capitalizeFirstChar' })}
          </Typography>
          <Typography
            sx={{
              color: theme.palette.text.primary,
              fontSize: '1rem',
              fontWeight: 700,
            }}
          >
            {formattedBalance} QORT
          </Typography>
        </Box>

        {/* Transfer QORT */}
        <Tooltip
          title={t('core:action.transfer_qort', {
            postProcess: 'capitalizeFirstChar',
          })}
        >
          <IconButton onClick={handleTransferQort} size="small">
            <SendIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        {/* QR Code */}
        <Tooltip
          title={t('core:action.see_qr_code', {
            postProcess: 'capitalizeFirstChar',
          })}
        >
          <IconButton
            onClick={(e) => setQrAnchorEl(e.currentTarget)}
            size="small"
          >
            <QrCode2Icon fontSize="small" />
          </IconButton>
        </Tooltip>

        {/* Get QORT in Q-Trade */}
        <Tooltip
          title={t('core:action.get_qort_trade', {
            postProcess: 'capitalizeFirstChar',
          })}
        >
          <IconButton onClick={handleOpenQTrade} size="small">
            <ShoppingCartIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* QR Code popover */}
      <Popover
        open={Boolean(qrAnchorEl)}
        anchorEl={qrAnchorEl}
        onClose={() => setQrAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Box sx={{ p: 2 }}>
          <QRCode
            value={address ?? ''}
            size={160}
            level="M"
            bgColor="#FFFFFF"
            fgColor="#000000"
          />
        </Box>
      </Popover>
    </Box>
  );
};
