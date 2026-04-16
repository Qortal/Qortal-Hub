import { useContext, useEffect, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  Popover,
  Typography,
  useTheme,
} from '@mui/material';
import { LoadingButton } from '@mui/lab';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ErrorIcon from '@mui/icons-material/Error';
import PersonIcon from '@mui/icons-material/Person';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  userInfoAtom,
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
import {
  dashboardPanelSx,
  handleDashboardPanelPointerLeave,
  handleDashboardPanelPointerMove,
  useDashboardPanelMouseLight,
} from './dashboardPanelEffects';

export const HomeProfileCard = () => {
  const { t } = useTranslation(['tutorial', 'core', 'group']);
  const theme = useTheme();
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const userInfo = useAtomValue(userInfoAtom);
  const setOpenSnack = useSetAtom(openSnackGlobalAtom);
  const setInfoSnack = useSetAtom(infoSnackGlobalAtom);

  const avatarAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [avatarError, setAvatarError] = useState(false);
  const [tempAvatar, setTempAvatar] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [avatarAnchorEl, setAvatarAnchorEl] = useState<HTMLElement | null>(
    null
  );
  const [isAvatarLoading, setIsAvatarLoading] = useState(false);
  const panelRef = useDashboardPanelMouseLight<HTMLDivElement>();

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  useEffect(() => {
    const openFromEvent = () => {
      if (avatarAnchorRef.current) {
        setAvatarAnchorEl(avatarAnchorRef.current);
      }
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

  const publishAvatar = async () => {
    try {
      const fee = await getFee('ARBITRARY');

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
      ref={panelRef}
      sx={{
        ...dashboardPanelSx(theme),
        backgroundColor: '#24272f',
        backgroundImage:
          theme.palette.mode === 'dark'
            ? 'linear-gradient(180deg, #24272f 0%, #24272f 50%, #1B1D24 100%)'
            : undefined,
        alignItems: 'center',
        borderRadius: '14px',
        display: 'grid',
        gap: {
          xs: '18px',
          md: '20px',
        },
        gridTemplateColumns: {
          xs: '1fr',
          md: 'auto minmax(0, 1fr) 72px',
        },
        padding: '20px 22px',
        width: '100%',
      }}
      onMouseMove={handleDashboardPanelPointerMove}
      onMouseLeave={handleDashboardPanelPointerLeave}
    >
      <Box
        aria-hidden="true"
        sx={{
          position: 'absolute',
          left: '0.875%',
          right: '0.875%',
          top: 0,
          transform: 'translateY(-50%)',
          height: '3.3px',
          pointerEvents: 'none',
          zIndex: -1,
          background:
            theme.palette.mode === 'dark'
              ? `linear-gradient(90deg, transparent 0%, rgba(60, 76, 90, 0) 12%, rgba(60, 76, 90, 0.12) 26%, rgba(87, 170, 219, 0.252) 40%, rgba(87, 170, 219, 0.648) 46%, rgba(87, 170, 219, 0.774) 50%, rgba(87, 170, 219, 0.648) 54%, rgba(87, 170, 219, 0.252) 60%, rgba(60, 76, 90, 0.12) 74%, rgba(60, 76, 90, 0) 88%, transparent 100%),
                 radial-gradient(92% 92% at 50% 100%, rgba(87, 170, 219, 0.27) 0%, rgba(87, 170, 219, 0.144) 30%, rgba(14, 15, 20, 0.035) 52%, transparent 76%)`
              : `linear-gradient(90deg, transparent 0%, rgba(60, 76, 90, 0) 12%, rgba(60, 76, 90, 0.07) 26%, rgba(60, 76, 90, 0.22) 44%, rgba(60, 76, 90, 0.28) 50%, rgba(60, 76, 90, 0.22) 56%, rgba(60, 76, 90, 0.07) 74%, rgba(60, 76, 90, 0) 88%, transparent 100%),
                 radial-gradient(92% 92% at 50% 100%, rgba(60, 76, 90, 0.1) 0%, rgba(60, 76, 90, 0.055) 30%, rgba(14, 15, 20, 0.016) 52%, transparent 76%)`,
          filter: 'blur(0.72px)',
          opacity: 1,
        }}
      />
      <Box
        sx={{
          alignItems: {
            xs: 'flex-start',
            md: 'center',
          },
          display: 'flex',
          flexDirection: {
            xs: 'row',
            md: 'column',
          },
          gap: '10px',
          minWidth: {
            xs: 0,
            md: '108px',
          },
        }}
      >
        <ButtonBase
          ref={avatarAnchorRef}
          onClick={(e) => setAvatarAnchorEl(e.currentTarget)}
          sx={{ borderRadius: '50%' }}
        >
          <Avatar
            src={avatarUrl ?? undefined}
            onError={() => setAvatarError(true)}
            sx={{ bgcolor: '#636772', height: 60, width: 60 }}
          >
            <PersonIcon sx={{ color: '#1D2126', fontSize: 34 }} />
          </Avatar>
        </ButtonBase>
        <Button
          variant="outlined"
          onClick={(e) => setAvatarAnchorEl(e.currentTarget)}
          sx={{
            borderColor: theme.palette.border.main,
            borderRadius: '999px',
            color: theme.palette.text.secondary,
            fontSize: '0.68rem',
            fontWeight: 700,
            lineHeight: 1,
            minWidth: 'auto',
            px: 1.4,
            py: 0.72,
            textTransform: 'uppercase',
            '&:hover': {
              borderColor: theme.palette.border.main,
              backgroundColor: theme.palette.action.hover,
            },
          }}
        >
          Edit profile
        </Button>
      </Box>

      <Box
        sx={{
          alignItems: {
            xs: 'flex-start',
            md: 'center',
          },
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          minWidth: 0,
          width: '100%',
        }}
      >
        <Typography
          sx={{
            color: theme.palette.text.primary,
            fontSize: '1rem',
            fontWeight: 600,
            textAlign: {
              xs: 'left',
              md: 'center',
            },
            width: '100%',
          }}
        >
          Account Overview
        </Typography>

        <Box
          sx={{
            alignItems: 'center',
            bgcolor: '#1B1E25',
            border: `1px solid ${theme.palette.border.subtle}`,
            borderRadius: '10px',
            display: 'flex',
            gap: '10px',
            maxWidth: '560px',
            minHeight: '44px',
            px: 1.5,
            py: 1,
            width: '100%',
          }}
        >
          <Typography
            sx={{
              color: theme.palette.text.primary,
              flex: 1,
              fontFamily: 'monospace',
              fontSize: '0.76rem',
              overflow: 'hidden',
              textAlign: {
                xs: 'left',
                md: 'center',
              },
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {address ?? '—'}
          </Typography>
          <ButtonBase
            onClick={handleCopyAddress}
            disabled={!address}
            sx={{
              alignItems: 'center',
              borderRadius: '8px',
              color: theme.palette.text.secondary,
              display: 'inline-flex',
              flexShrink: 0,
              height: '26px',
              justifyContent: 'center',
              width: '26px',
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
                color: theme.palette.text.primary,
              },
            }}
          >
            <ContentCopyIcon sx={{ fontSize: '0.92rem' }} />
          </ButtonBase>
        </Box>

        <Typography
          sx={{
            color: theme.palette.text.secondary,
            fontSize: '0.64rem',
            letterSpacing: '0.05em',
            textAlign: {
              xs: 'left',
              md: 'center',
            },
            textTransform: 'uppercase',
            width: '100%',
          }}
        >
          QORT Wallet Address
        </Typography>
      </Box>

      <Box
        sx={{
          display: {
            xs: 'none',
            md: 'block',
          },
        }}
      />

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
          <Typography
            variant="subtitle2"
            color="text.secondary"
            sx={{ fontWeight: 600 }}
          >
            {t('core:message.generic.avatar_size', {
              size: MAX_SIZE_AVATAR,
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>

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
              <PersonIcon
                sx={{ fontSize: 56, color: theme.palette.text.disabled }}
              />
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
              {t('core:action.choose_image', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
          </ImageUploader>

          {avatarFile?.name && (
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              sx={{ textAlign: 'center' }}
            >
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
                bgcolor:
                  theme.palette.mode === 'dark'
                    ? 'rgba(255,152,0,0.12)'
                    : 'rgba(255,152,0,0.08)',
                border: `1px solid ${theme.palette.warning.main}40`,
              }}
            >
              <ErrorIcon
                sx={{
                  color: theme.palette.warning.main,
                  fontSize: 20,
                  flexShrink: 0,
                }}
              />
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
              color: theme.palette.getContrastText(
                theme.palette.other.positive
              ),
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
            {t('group:action.publish_avatar', {
              postProcess: 'capitalizeFirstChar',
            })}
          </LoadingButton>
        </Box>
      </Popover>
    </Box>
  );
};
