import { useState } from 'react';
import { Avatar, Box, Tooltip, Typography, useTheme } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PersonIcon from '@mui/icons-material/Person';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { userInfoAtom, balanceAtom } from '../../atoms/global';
import { getBaseApiReactForAvatar } from '../../utils/globalApi';

export const HomeProfileCard = () => {
  const { t } = useTranslation(['tutorial']);
  const theme = useTheme();
  const userInfo = useAtomValue(userInfoAtom);
  const balance = useAtomValue(balanceAtom);
  const [avatarError, setAvatarError] = useState(false);
  const [copied, setCopied] = useState(false);

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
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
        title={
          copied
            ? '✓'
            : t('tutorial:home.copy_address', {
                postProcess: 'capitalizeFirstChar',
              })
        }
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

      {/* Right: Balance */}
      <Box
        sx={{
          alignItems: 'flex-end',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
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
    </Box>
  );
};
