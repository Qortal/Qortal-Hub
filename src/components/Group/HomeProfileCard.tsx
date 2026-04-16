import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  Portal,
  Typography,
  useTheme,
} from '@mui/material';
import { LoadingButton } from '@mui/lab';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CloseIcon from '@mui/icons-material/Close';
import ErrorIcon from '@mui/icons-material/Error';
import PersonIcon from '@mui/icons-material/Person';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
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
import { DecryptedText } from '../common/DecryptedText';

export const HomeProfileCard = () => {
  const { t } = useTranslation(['tutorial', 'core', 'group']);
  const theme = useTheme();
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const userInfo = useAtomValue(userInfoAtom);
  const setOpenSnack = useSetAtom(openSnackGlobalAtom);
  const setInfoSnack = useSetAtom(infoSnackGlobalAtom);

  const avatarAnchorRef = useRef<HTMLButtonElement | null>(null);
  const editProfileButtonRef = useRef<HTMLButtonElement | null>(null);
  const avatarPanelRef = useRef<HTMLDivElement | null>(null);
  const [avatarError, setAvatarError] = useState(false);
  const [tempAvatar, setTempAvatar] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [avatarAnchorEl, setAvatarAnchorEl] = useState<HTMLElement | null>(
    null
  );
  const [avatarPanelOriginRect, setAvatarPanelOriginRect] = useState<DOMRect | null>(
    null
  );
  const [avatarPanelHeight, setAvatarPanelHeight] = useState(430);
  const [isAvatarLoading, setIsAvatarLoading] = useState(false);
  const [isAddressFieldHovered, setIsAddressFieldHovered] = useState(false);
  const panelRef = useDashboardPanelMouseLight<HTMLDivElement>();
  const prefersReducedMotion = useReducedMotion();
  const isDarkMode = theme.palette.mode === 'dark';

  const openAvatarPanel = useCallback((target: HTMLElement | null) => {
    if (!target) return;
    setAvatarPanelOriginRect(target.getBoundingClientRect());
    setAvatarAnchorEl(target);
  }, []);

  const closeAvatarPanel = useCallback(() => {
    setAvatarAnchorEl(null);
    setAvatarFile(null);
  }, []);

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
      if (editProfileButtonRef.current) {
        openAvatarPanel(editProfileButtonRef.current);
        return;
      }
      if (avatarAnchorRef.current) {
        openAvatarPanel(avatarAnchorRef.current);
      }
    };
    subscribeToEvent('openAvatarUpload', openFromEvent);
    return () => unsubscribeFromEvent('openAvatarUpload', openFromEvent);
  }, [openAvatarPanel]);

  useEffect(() => {
    if (!avatarAnchorEl) return;

    const updatePanelMetrics = () => {
      setAvatarPanelOriginRect(avatarAnchorEl.getBoundingClientRect());
      if (avatarPanelRef.current) {
        setAvatarPanelHeight(avatarPanelRef.current.getBoundingClientRect().height);
      }
    };

    updatePanelMetrics();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && avatarPanelRef.current
        ? new ResizeObserver(() => updatePanelMetrics())
        : null;

    if (resizeObserver && avatarPanelRef.current) {
      resizeObserver.observe(avatarPanelRef.current);
    }

    window.addEventListener('resize', updatePanelMetrics);
    window.addEventListener('scroll', updatePanelMetrics, true);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updatePanelMetrics);
      window.removeEventListener('scroll', updatePanelMetrics, true);
    };
  }, [avatarAnchorEl]);

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
      compact: true,
      duration: 3000,
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

  const isAvatarPanelOpen = Boolean(avatarAnchorEl);
  const avatarPanelOriginRadius = avatarAnchorEl === avatarAnchorRef.current ? 999 : 10;
  const avatarPanelTargetRadius =
    avatarAnchorEl === editProfileButtonRef.current ? 10 : 18;
  const avatarPanelWidth =
    typeof window === 'undefined'
      ? 332
      : Math.min(352, Math.max(304, window.innerWidth - 32));

  const avatarPanelLayout = useMemo(() => {
    const viewportWidth =
      typeof window !== 'undefined' ? window.innerWidth : avatarPanelWidth + 32;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
    const fallbackLeft = Math.max(16, (viewportWidth - avatarPanelWidth) / 2);
    const fallbackTop = 140;

    if (!avatarPanelOriginRect) {
      return {
        left: fallbackLeft,
        top: fallbackTop,
        width: avatarPanelWidth,
        height: avatarPanelHeight,
      };
    }

    const preferredLeft = avatarPanelOriginRect.left;
    const left = Math.min(
      Math.max(16, preferredLeft),
      Math.max(16, viewportWidth - avatarPanelWidth - 16)
    );

    const preferredTop = avatarPanelOriginRect.top;
    const top = Math.min(
      Math.max(16, preferredTop),
      Math.max(16, viewportHeight - avatarPanelHeight - 16)
    );

    return {
      left,
      top,
      width: avatarPanelWidth,
      height: avatarPanelHeight,
    };
  }, [avatarPanelHeight, avatarPanelOriginRect, avatarPanelWidth]);

  const avatarPanelAnimation = useMemo(() => {
    if (!avatarPanelOriginRect) {
      return {
        initial: { opacity: 0, scale: 0.96 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.96 },
      };
    }

    if (prefersReducedMotion) {
      return {
        initial: { opacity: 0, scale: 0.98 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.98 },
      };
    }

    return {
      initial: {
        opacity: 0.9,
        scaleX: Math.max(0.18, avatarPanelOriginRect.width / avatarPanelLayout.width),
        scaleY: Math.max(0.1, avatarPanelOriginRect.height / avatarPanelLayout.height),
        borderRadius: avatarPanelOriginRadius,
      },
        animate: {
          opacity: 1,
          scaleX: 1,
          scaleY: 1,
          borderRadius: avatarPanelTargetRadius,
        },
      exit: {
        opacity: 0.9,
        scaleX: Math.max(0.18, avatarPanelOriginRect.width / avatarPanelLayout.width),
        scaleY: Math.max(0.1, avatarPanelOriginRect.height / avatarPanelLayout.height),
        borderRadius: avatarPanelOriginRadius,
      },
    };
  }, [avatarPanelLayout.height, avatarPanelLayout.left, avatarPanelLayout.top, avatarPanelLayout.width, avatarPanelOriginRadius, avatarPanelOriginRect, avatarPanelTargetRadius, prefersReducedMotion]);

  return (
    <Box
      ref={panelRef}
      sx={{
        ...dashboardPanelSx(theme),
        backgroundColor: isDarkMode ? '#24272f' : theme.palette.background.paper,
        backgroundImage:
          isDarkMode
            ? 'linear-gradient(180deg, #24272f 0%, #24272f 50%, #1B1D24 100%)'
            : 'linear-gradient(180deg, rgba(248,244,237,0.98) 0%, rgba(244,239,231,1) 52%, rgba(230,222,210,1) 100%)',
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
        className="dashboard-panel-decoration"
        aria-hidden="true"
        sx={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          borderRadius: 'inherit',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            left: '8px',
            right: '8px',
            top: 0,
            height: '1px',
            background:
              isDarkMode
                ? 'linear-gradient(90deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.18) 10%, rgba(255,255,255,0.24) 22%, rgba(255,255,255,0.22) 30%, rgba(255,255,255,0) 39%, rgba(255,255,255,0) 61%, rgba(255,255,255,0.22) 70%, rgba(255,255,255,0.24) 78%, rgba(255,255,255,0.18) 90%, rgba(255,255,255,0.1) 100%)'
                : 'linear-gradient(90deg, rgba(255,255,255,0.32) 0%, rgba(255,255,255,0.46) 12%, rgba(255,255,255,0.58) 24%, rgba(255,255,255,0.5) 34%, rgba(255,255,255,0.16) 50%, rgba(255,255,255,0.5) 66%, rgba(255,255,255,0.58) 76%, rgba(255,255,255,0.46) 88%, rgba(255,255,255,0.32) 100%)',
            filter: 'blur(0.08px)',
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '7px',
            height: '7px',
            borderTopLeftRadius: '7px',
            borderLeft:
              isDarkMode
                ? '1px solid rgba(255,255,255,0.176)'
                : '1px solid rgba(255,255,255,0.72)',
            borderTop:
              isDarkMode
                ? '1px solid rgba(255,255,255,0.176)'
                : '1px solid rgba(255,255,255,0.72)',
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            right: 0,
            top: 0,
            width: '7px',
            height: '7px',
            borderTopRightRadius: '7px',
            borderRight:
              isDarkMode
                ? '1px solid rgba(255,255,255,0.176)'
                : '1px solid rgba(255,255,255,0.72)',
            borderTop:
              isDarkMode
                ? '1px solid rgba(255,255,255,0.176)'
                : '1px solid rgba(255,255,255,0.72)',
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            left: 0,
            top: '7px',
            width: '1px',
            height: 'calc(100% - 7px)',
            background:
              isDarkMode
                ? 'linear-gradient(180deg, rgba(255,255,255,0.192) 0%, rgba(255,255,255,0.096) 18%, rgba(255,255,255,0.04) 38%, rgba(255,255,255,0.0144) 56%, transparent 82%)'
                : 'linear-gradient(180deg, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.34) 22%, rgba(255,255,255,0.14) 40%, rgba(255,255,255,0.04) 58%, transparent 82%)',
            filter: 'blur(0.08px)',
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            right: 0,
            top: '7px',
            width: '1px',
            height: 'calc(100% - 7px)',
            background:
              isDarkMode
                ? 'linear-gradient(180deg, rgba(255,255,255,0.192) 0%, rgba(255,255,255,0.096) 18%, rgba(255,255,255,0.04) 38%, rgba(255,255,255,0.0144) 56%, transparent 82%)'
                : 'linear-gradient(180deg, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.34) 22%, rgba(255,255,255,0.14) 40%, rgba(255,255,255,0.04) 58%, transparent 82%)',
            filter: 'blur(0.08px)',
          }}
        />
      </Box>
      <Box
        className="dashboard-panel-decoration"
        aria-hidden="true"
        sx={{
          position: 'absolute',
          left: '0.875%',
          right: '0.875%',
          top: isDarkMode ? 0 : 0,
          transform: isDarkMode ? 'translateY(-50%)' : 'translateY(-32%)',
          height: isDarkMode ? '3.3px' : '2px',
          pointerEvents: 'none',
          zIndex: isDarkMode ? -1 : 0,
            background:
              isDarkMode
                ? `linear-gradient(90deg, transparent 0%, rgba(60, 76, 90, 0) 12%, rgba(60, 76, 90, 0.12) 26%, rgba(87, 170, 219, 0.252) 40%, rgba(87, 170, 219, 0.648) 46%, rgba(87, 170, 219, 0.774) 50%, rgba(87, 170, 219, 0.648) 54%, rgba(87, 170, 219, 0.252) 60%, rgba(60, 76, 90, 0.12) 74%, rgba(60, 76, 90, 0) 88%, transparent 100%),
                 radial-gradient(92% 92% at 50% 100%, rgba(87, 170, 219, 0.27) 0%, rgba(87, 170, 219, 0.144) 30%, rgba(14, 15, 20, 0.035) 52%, transparent 76%)`
                : 'linear-gradient(90deg, transparent 0%, rgba(60, 76, 90, 0) 16%, rgba(60, 76, 90, 0.02) 30%, rgba(109, 159, 238, 0.08) 44%, rgba(109, 159, 238, 0.12) 50%, rgba(109, 159, 238, 0.08) 56%, rgba(60, 76, 90, 0.02) 70%, rgba(60, 76, 90, 0) 84%, transparent 100%)',
          filter: isDarkMode ? 'blur(0.72px)' : 'blur(0.28px)',
          opacity: isDarkMode ? 1 : 0.92,
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
          onClick={(e) => openAvatarPanel(e.currentTarget)}
          sx={{ borderRadius: '50%' }}
        >
          <Avatar
            src={avatarUrl ?? undefined}
            onError={() => setAvatarError(true)}
            sx={{
              bgcolor: isDarkMode ? '#636772' : '#E7DED0',
              height: 60,
              width: 60,
            }}
          >
            <PersonIcon
              sx={{
                color: isDarkMode ? '#1D2126' : theme.palette.text.secondary,
                fontSize: 34,
              }}
            />
          </Avatar>
        </ButtonBase>
        <Button
          ref={editProfileButtonRef}
          variant="outlined"
          onClick={(e) => openAvatarPanel(e.currentTarget)}
          sx={{
            backgroundColor: isDarkMode ? '#1B1E25' : theme.palette.background.surface,
            borderColor: theme.palette.border.subtle,
            borderRadius: '10px',
            color: theme.palette.text.primary,
            fontSize: '0.68rem',
            fontWeight: 600,
            lineHeight: 1,
            minWidth: 'auto',
            px: 1.4,
            py: 0.72,
            transition: 'background-color 160ms ease, border-color 160ms ease, color 160ms ease',
            textTransform: 'uppercase',
            '&:hover': {
              backgroundColor: isDarkMode ? '#181a20' : '#E8DECF',
              borderColor: theme.palette.border.main,
              color: theme.palette.text.primary,
            },
          }}
        >
          <Box
            component={motion.span}
            animate={{
              opacity: isAvatarPanelOpen ? 0 : 1,
              y: isAvatarPanelOpen ? -2 : 0,
            }}
            transition={{ duration: 0.14, ease: [0.2, 0, 0, 1] }}
            sx={{ display: 'inline-flex' }}
          >
            Edit profile
          </Box>
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
            bgcolor: isDarkMode ? '#1B1E25' : '#E7DDCE',
            border: `1px solid ${theme.palette.border.subtle}`,
            borderRadius: '10px',
            cursor: address ? 'pointer' : 'default',
            display: 'flex',
            gap: '10px',
            maxWidth: '381px',
            minHeight: '44px',
            position: 'relative',
            px: 1.5,
            py: 1,
            transition: 'background-color 160ms ease, border-color 160ms ease',
            width: '100%',
            '&:hover': address
              ? {
                  backgroundColor: isDarkMode ? '#181a20' : '#DDD2C2',
                  borderColor: theme.palette.border.main,
                  '& .wallet-address-overlay': {
                    color: theme.palette.text.primary,
                  },
                }
              : undefined,
          }}
          onClick={address ? handleCopyAddress : undefined}
          onMouseEnter={address ? () => setIsAddressFieldHovered(true) : undefined}
          onMouseLeave={address ? () => setIsAddressFieldHovered(false) : undefined}
          onKeyDown={
            address
              ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleCopyAddress();
                  }
                }
              : undefined
          }
          role={address ? 'button' : undefined}
          tabIndex={address ? 0 : undefined}
        >
          <Typography
            sx={{
              color: 'transparent',
              flex: 1,
              fontFamily: 'monospace',
              fontSize: '0.76rem',
              overflow: 'hidden',
              position: 'relative',
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
          <Box
            className="wallet-address-overlay"
            sx={{
              color: theme.palette.text.secondary,
              fontFamily: 'monospace',
              fontSize: '0.76rem',
              left: '12px',
              overflow: 'hidden',
              pointerEvents: 'none',
              position: 'absolute',
              right: '44px',
              textAlign: {
                xs: 'left',
                md: 'center',
              },
              textOverflow: 'ellipsis',
              top: '50%',
              transform: 'translateY(-50%)',
              transition: 'color 160ms ease',
              whiteSpace: 'nowrap',
            }}
          >
            <Box sx={{ pointerEvents: 'auto' }}>
              <DecryptedText
                text={address ?? '-'}
                animateOn="hover"
                active={isAddressFieldHovered}
                speed={35}
                maxIterations={12}
                sequential={true}
                revealDirection="start"
                useOriginalCharsOnly={true}
              />
            </Box>
          </Box>
          <ButtonBase
            onClick={(event) => {
              event.stopPropagation();
              handleCopyAddress();
            }}
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

      <Portal>
        <AnimatePresence>
          {isAvatarPanelOpen && (
            <>
              <Box
                component={motion.button}
                type="button"
                aria-label="Close avatar panel"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.14, ease: [0.2, 0, 0, 1] }}
                onClick={closeAvatarPanel}
                sx={{
                  appearance: 'none',
                  background: 'rgba(8, 10, 16, 0.08)',
                  border: 0,
                  inset: 0,
                  padding: 0,
                  position: 'fixed',
                  zIndex: 1298,
                }}
              />

              <Box
                component={motion.div}
                initial={avatarPanelAnimation.initial}
                animate={avatarPanelAnimation.animate}
                exit={avatarPanelAnimation.exit}
                transition={{
                  duration: prefersReducedMotion ? 0.14 : 0.28,
                  ease: [0.16, 0.9, 0.2, 1],
                }}
                onClick={(event) => event.stopPropagation()}
                sx={{
                  left: `${avatarPanelLayout.left}px`,
                  overflow: 'hidden',
                  position: 'fixed',
                  top: `${avatarPanelLayout.top}px`,
                  transformOrigin: 'top left',
                  width: `${avatarPanelLayout.width}px`,
                  zIndex: 1299,
                }}
              >
                <Box
                  ref={avatarPanelRef}
                  sx={{
                    bgcolor: isDarkMode ? '#1D1F27' : theme.palette.background.paper,
                    border: `1px solid ${theme.palette.border.subtle}`,
                    borderRadius: `${avatarPanelTargetRadius}px`,
                    boxShadow:
                      isDarkMode
                        ? '0 20px 48px rgba(0,0,0,0.34)'
                        : '0 18px 38px rgba(28, 36, 52, 0.12)',
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    component={motion.div}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{
                      duration: prefersReducedMotion ? 0.08 : 0.14,
                      delay: prefersReducedMotion ? 0 : 0.1,
                    }}
                    sx={{
                      bgcolor: isDarkMode ? '#1D1F27' : theme.palette.background.paper,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 0,
                    }}
                  >
                    <Box
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        justifyContent: 'space-between',
                        px: 2.25,
                        py: 1.7,
                      }}
                    >
                      <Box
                        sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}
                      >
                        <Typography
                          sx={{
                            color: theme.palette.text.primary,
                            fontSize: '0.94rem',
                            fontWeight: 600,
                            letterSpacing: '0.01em',
                          }}
                        >
                          Update avatar
                        </Typography>
                        <Typography
                          sx={{
                            color: theme.palette.text.secondary,
                            fontSize: '0.72rem',
                            lineHeight: 1.35,
                          }}
                        >
                          {t('core:message.generic.avatar_size', {
                            size: MAX_SIZE_AVATAR,
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </Typography>
                      </Box>
                      <ButtonBase
                        onClick={closeAvatarPanel}
                        sx={{
                          borderRadius: '9px',
                          color: theme.palette.text.secondary,
                          height: 28,
                          width: 28,
                          '&:hover': {
                            backgroundColor: theme.palette.action.hover,
                            color: theme.palette.text.primary,
                          },
                        }}
                      >
                        <CloseIcon sx={{ fontSize: 17 }} />
                      </ButtonBase>
                    </Box>

                    <Box
                      sx={{
                        borderTop: `1px solid ${theme.palette.border.subtle}`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1.5,
                        px: 2.25,
                        pb: 2.25,
                        pt: 2,
                      }}
                    >
                      <Box
                        sx={{
                          alignItems: 'center',
                          background:
                            isDarkMode
                              ? 'linear-gradient(180deg, rgba(27,30,37,0.98) 0%, rgba(24,26,32,1) 100%)'
                              : 'linear-gradient(180deg, rgba(255,255,255,0.72) 0%, rgba(233,238,245,0.82) 100%)',
                          border: `1px solid ${theme.palette.border.subtle}`,
                          borderRadius: '16px',
                          display: 'flex',
                          justifyContent: 'center',
                          minHeight: 164,
                          overflow: 'hidden',
                          position: 'relative',
                        }}
                      >
                        <Box
                          sx={{
                            alignItems: 'center',
                            backgroundColor: isDarkMode ? '#23262F' : theme.palette.background.elevated,
                            border: `1px solid ${theme.palette.border.subtle}`,
                            borderRadius: '50%',
                            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)',
                            display: 'flex',
                            height: 108,
                            justifyContent: 'center',
                            overflow: 'hidden',
                            width: 108,
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
                              sx={{ fontSize: 52, color: theme.palette.text.disabled }}
                            />
                          )}
                        </Box>
                      </Box>

                      <ImageUploader onPick={(file) => setAvatarFile(file)}>
                        <ButtonBase
                          sx={{
                            alignItems: 'center',
                            backgroundColor: isDarkMode ? '#181a20' : '#EEE6DA',
                            border: `1px solid ${theme.palette.border.subtle}`,
                            borderRadius: '12px',
                            color: theme.palette.text.primary,
                            display: 'flex',
                            justifyContent: 'space-between',
                            px: 1.5,
                            py: 1.3,
                            textAlign: 'left',
                            transition:
                              'background-color 160ms ease, border-color 160ms ease, transform 120ms ease',
                            width: '100%',
                            '&:hover': {
                              backgroundColor: isDarkMode ? '#16181d' : theme.palette.background.elevated,
                              borderColor: theme.palette.border.main,
                              transform: 'translateY(-1px)',
                            },
                          }}
                        >
                          <Box
                            sx={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '3px',
                            }}
                          >
                            <Typography
                              sx={{
                                color: theme.palette.text.primary,
                                fontSize: '0.84rem',
                                fontWeight: 600,
                              }}
                            >
                              {avatarFile
                                ? 'Replace image'
                                : t('core:action.choose_image', {
                                    postProcess: 'capitalizeFirstChar',
                                  })}
                            </Typography>
                            <Typography
                              sx={{
                                color: theme.palette.text.secondary,
                                fontSize: '0.7rem',
                                lineHeight: 1.35,
                              }}
                            >
                              PNG, JPG, WEBP or GIF
                            </Typography>
                          </Box>
                          <Box
                            sx={{
                              alignItems: 'center',
                              backgroundColor: isDarkMode ? '#23262F' : theme.palette.background.elevated,
                              border: `1px solid ${theme.palette.border.subtle}`,
                              borderRadius: '999px',
                              color: theme.palette.text.primary,
                              display: 'inline-flex',
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              minHeight: 30,
                              px: 1.2,
                            }}
                          >
                            Browse
                          </Box>
                        </ButtonBase>
                      </ImageUploader>

                      {avatarFile?.name && (
                        <Box
                          sx={{
                            alignItems: 'center',
                            backgroundColor: isDarkMode ? '#181a20' : '#EEE6DA',
                            border: `1px solid ${theme.palette.border.subtle}`,
                            borderRadius: '10px',
                            color: theme.palette.text.secondary,
                            display: 'flex',
                            minHeight: 36,
                            px: 1.2,
                          }}
                        >
                          <Typography
                            noWrap
                            sx={{
                              color: theme.palette.text.secondary,
                              fontSize: '0.72rem',
                              width: '100%',
                            }}
                          >
                            {avatarFile.name}
                          </Typography>
                        </Box>
                      )}

                      {!name && (
                        <Box
                          sx={{
                            alignItems: 'flex-start',
                            backgroundColor:
                              isDarkMode
                                ? 'rgba(255,152,0,0.1)'
                                : 'rgba(255,152,0,0.08)',
                            border: `1px solid ${theme.palette.warning.main}35`,
                            borderRadius: '12px',
                            display: 'flex',
                            gap: 1,
                            px: 1.25,
                            py: 1.15,
                          }}
                        >
                          <ErrorIcon
                            sx={{
                              color: theme.palette.warning.main,
                              fontSize: 18,
                              flexShrink: 0,
                              mt: '1px',
                            }}
                          />
                          <Typography
                            sx={{
                              color: theme.palette.text.secondary,
                              fontSize: '0.78rem',
                              lineHeight: 1.45,
                            }}
                          >
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
                          backgroundColor: theme.palette.primary.main,
                          borderRadius: '12px',
                          color: '#fff',
                          fontSize: '0.82rem',
                          fontWeight: 600,
                          minHeight: 44,
                          textTransform: 'none',
                          '&:hover': {
                            backgroundColor: theme.palette.primary.main,
                            filter: 'brightness(1.06)',
                          },
                          '&.Mui-disabled': {
                            backgroundColor: isDarkMode ? '#2A2D36' : theme.palette.background.elevated,
                            color: theme.palette.action.disabled,
                          },
                        }}
                      >
                        {t('group:action.publish_avatar', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </LoadingButton>
                    </Box>
                  </Box>
                </Box>
              </Box>
            </>
          )}
        </AnimatePresence>
      </Portal>
    </Box>
  );
};

