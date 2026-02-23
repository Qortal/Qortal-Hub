import { useContext, useEffect, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  IconButton,
  Popover,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { LoadingButton } from '@mui/lab';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ErrorIcon from '@mui/icons-material/Error';
import PersonIcon from '@mui/icons-material/Person';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import SendIcon from '@mui/icons-material/Send';
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
import { QORTAL_APP_CONTEXT } from '../../App';
import { getFee } from '../../background/background.ts';
import ImageUploader from '../../common/ImageUploader';
import { MAX_SIZE_AVATAR } from '../../constants/constants.ts';
import { fileToBase64 } from '../../utils/fileReading';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { getBaseApiReactForAvatar } from '../../utils/globalApi';

export const HomeProfileCard = () => {
  const { t } = useTranslation(['tutorial', 'core', 'group']);
  const theme = useTheme();
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const userInfo = useAtomValue(userInfoAtom);
  const balance = useAtomValue(balanceAtom);
  const setOpenSnack = useSetAtom(openSnackGlobalAtom);
  const setInfoSnack = useSetAtom(infoSnackGlobalAtom);

  const avatarAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [avatarError, setAvatarError] = useState(false);
  const [tempAvatar, setTempAvatar] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [avatarAnchorEl, setAvatarAnchorEl] = useState<HTMLElement | null>(null);
  const [isAvatarLoading, setIsAvatarLoading] = useState(false);
  const [qrAnchorEl, setQrAnchorEl] = useState<HTMLElement | null>(null);

  // Object URL for selected file preview; revoke on change/cleanup
  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  // When "Load your avatar" step (or any openAvatarUpload event) fires, open the same popover as "Change avatar"
  useEffect(() => {
    const openFromEvent = () => {
      if (avatarAnchorRef.current) setAvatarAnchorEl(avatarAnchorRef.current);
    };
    subscribeToEvent('openAvatarUpload', openFromEvent);
    return () => unsubscribeFromEvent('openAvatarUpload', openFromEvent);
  }, []);

  const name = userInfo?.name;
  const address = userInfo?.address;
  const avatarUrl =
    tempAvatar ??
    (name && !avatarError
      ? `${getBaseApiReactForAvatar()}/arbitrary/THUMBNAIL/${name}/qortal_avatar?async=true`
      : null);

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

  const publishAvatar = async () => {
    try {
      const fee = await getFee('ARBITRARY');

      if (+balance < +fee.fee)
        throw new Error(
          t('core:message.generic.avatar_publish_fee', {
            fee: fee.fee,
            postProcess: 'capitalizeFirstChar',
          })
        );

      await show({
        message: t('core:message.question.publish_avatar', {
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });

      setIsAvatarLoading(true);
      const avatarBase64 = await fileToBase64(avatarFile);

      await new Promise((res, rej) => {
        window
          .sendMessage('publishOnQDN', {
            data: avatarBase64,
            identifier: 'qortal_avatar',
            service: 'THUMBNAIL',
            uploadType: 'base64',
          })
          .then((response) => {
            if (!response?.error) {
              res(response);
              return;
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(
              error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
            );
          });
      });

      setAvatarFile(null);
      setTempAvatar(`data:image/webp;base64,${avatarBase64}`);
      setAvatarAnchorEl(null);
      executeEvent('avatarUploaded', {});
    } catch (error) {
      if (error?.message) {
        setInfoSnack({ type: 'error', message: error.message });
        setOpenSnack(true);
      }
    } finally {
      setIsAvatarLoading(false);
    }
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
        <Box sx={{ alignItems: 'center', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <ButtonBase
            ref={avatarAnchorRef}
            onClick={(e) => setAvatarAnchorEl(e.currentTarget)}
            sx={{ borderRadius: '50%' }}
          >
            <Avatar
              src={avatarUrl ?? undefined}
              onError={() => setAvatarError(true)}
              sx={{ height: 56, width: 56 }}
            >
              <PersonIcon sx={{ fontSize: 32 }} />
            </Avatar>
          </ButtonBase>
          <ButtonBase onClick={(e) => setAvatarAnchorEl(e.currentTarget)}>
            <Typography
              sx={{ color: theme.palette.text.secondary, fontSize: '0.68rem', opacity: 0.7 }}
            >
              {t('core:action.change_avatar', { postProcess: 'capitalizeFirstChar' })}
            </Typography>
          </ButtonBase>
        </Box>

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

      {/* Right: Balance + actions (vertical) */}
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

        {/* Icons column */}
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {/* Transfer QORT */}
          <Tooltip
            title={t('core:action.transfer_qort', {
              postProcess: 'capitalizeFirstChar',
            })}
            placement="left"
            disableInteractive
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
            placement="left"
            disableInteractive
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
            placement="left"
            disableInteractive
          >
            <IconButton onClick={handleOpenQTrade} size="small">
              <ShoppingCartIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Avatar upload popover */}
      <Popover
        open={Boolean(avatarAnchorEl)}
        anchorEl={avatarAnchorEl}
        onClose={() => {
          setAvatarAnchorEl(null);
          setAvatarFile(null);
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        slotProps={{
          paper: {
            sx: {
              borderRadius: '16px',
              overflow: 'hidden',
              boxShadow: theme.shadows[8],
              border: `1px solid ${theme.palette.divider}`,
              minWidth: 280,
            },
          },
        }}
      >
        <Box
          sx={{
            p: 2.5,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            bgcolor: theme.palette.background.paper,
          }}
        >
          <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 600 }}>
            {t('core:message.generic.avatar_size', {
              size: MAX_SIZE_AVATAR,
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>

          {/* Preview area */}
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              alignSelf: 'center',
              width: 120,
              height: 120,
              borderRadius: '50%',
              overflow: 'hidden',
              bgcolor: theme.palette.action.hover,
              border: `2px solid ${theme.palette.divider}`,
            }}
          >
            {avatarPreviewUrl ? (
              <Box
                component="img"
                src={avatarPreviewUrl}
                alt=""
                sx={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
              />
            ) : (
              <PersonIcon sx={{ fontSize: 56, color: theme.palette.text.disabled }} />
            )}
          </Box>

          <ImageUploader onPick={(file) => setAvatarFile(file)}>
            <Button
              variant="outlined"
              fullWidth
              sx={{
                borderColor: theme.palette.other.positive,
                color: theme.palette.other.positive,
                fontWeight: 600,
                textTransform: 'none',
                '&:hover': {
                  borderColor: theme.palette.other.positive,
                  bgcolor: `${theme.palette.other.positive}14`,
                },
              }}
            >
              {t('core:action.choose_image', { postProcess: 'capitalizeFirstChar' })}
            </Button>
          </ImageUploader>

          {avatarFile?.name && (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ textAlign: 'center' }}>
              {avatarFile.name}
            </Typography>
          )}

          {!name && (
            <Box
              sx={{
                display: 'flex',
                gap: 1,
                alignItems: 'center',
                p: 1.25,
                borderRadius: 1,
                bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,152,0,0.12)' : 'rgba(255,152,0,0.08)',
                border: `1px solid ${theme.palette.warning.main}40`,
              }}
            >
              <ErrorIcon sx={{ color: theme.palette.warning.main, fontSize: 20, flexShrink: 0 }} />
              <Typography variant="body2" color="text.secondary">
                {t('group:message.generic.avatar_registered_name', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </Box>
          )}

          <LoadingButton
            loading={isAvatarLoading}
            disabled={!avatarFile || !name}
            onClick={publishAvatar}
            variant="contained"
            fullWidth
            sx={{
              bgcolor: theme.palette.other.positive,
              color: theme.palette.getContrastText(theme.palette.other.positive),
              fontWeight: 600,
              textTransform: 'none',
              py: 1.25,
              '&:hover': {
                bgcolor: theme.palette.other.positive,
                filter: 'brightness(1.08)',
              },
              '&.Mui-disabled': {
                bgcolor: theme.palette.action.disabledBackground,
                color: theme.palette.action.disabled,
              },
            }}
          >
            {t('group:action.publish_avatar', { postProcess: 'capitalizeFirstChar' })}
          </LoadingButton>
        </Box>
      </Popover>

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
