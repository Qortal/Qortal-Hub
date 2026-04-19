import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  ButtonBase,
  Portal,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { LoadingButton } from '@mui/lab';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CloseIcon from '@mui/icons-material/Close';
import ErrorIcon from '@mui/icons-material/Error';
import PersonIcon from '@mui/icons-material/Person';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
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
import { getBlueTier1ButtonSx } from '../../styles/blueMaterial';
import BorderGlow from '../common/BorderGlow';
import TiltedCard from '../common/TiltedCard';
import { GROUP_ACTIVITY_BLUE } from './groupActivityColorSystem';

type HomeProfileCardProps = {
  onOpenSettings?: () => void;
};

type AccountStatus = 'busy' | 'invisible' | 'online';

export const HomeProfileCard = ({ onOpenSettings }: HomeProfileCardProps) => {
  const { t } = useTranslation(['tutorial', 'core', 'group']);
  const theme = useTheme();
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const userInfo = useAtomValue(userInfoAtom);
  const setOpenSnack = useSetAtom(openSnackGlobalAtom);
  const setInfoSnack = useSetAtom(infoSnackGlobalAtom);

  const avatarAnchorRef = useRef<HTMLButtonElement | null>(null);
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
  const [isAvatarGlowHovered, setIsAvatarGlowHovered] = useState(false);
  const panelRef = useDashboardPanelMouseLight<HTMLDivElement>();
  const prefersReducedMotion = useReducedMotion();
  const isDarkMode = theme.palette.mode === 'dark';
  const avatarModalSurface = isDarkMode ? '#2C303A' : '#FBF8F2';
  const avatarModalSurfaceSoft = isDarkMode ? '#272B34' : '#F6F0E6';
  const avatarFieldSurface = isDarkMode
    ? 'linear-gradient(180deg, rgba(40,44,54,0.98) 0%, rgba(34,37,45,1) 100%)'
    : 'linear-gradient(180deg, rgba(248,243,234,0.96) 0%, rgba(242,235,225,1) 100%)';
  const avatarFieldBorder = isDarkMode
    ? 'rgba(255,255,255,0.075)'
    : 'rgba(28,36,52,0.08)';
  const avatarWarningTone = isDarkMode
    ? {
        background: 'rgba(189, 143, 73, 0.1)',
        border: 'rgba(189, 143, 73, 0.24)',
        icon: '#C7A56C',
      }
    : {
        background: 'rgba(191, 144, 73, 0.08)',
        border: 'rgba(191, 144, 73, 0.2)',
        icon: '#A97E3F',
      };

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
  const hasRegisteredName = Boolean(name);
  const accountIdentityPrimaryText = hasRegisteredName
    ? name ?? '—'
    : address ?? '—';
  const accountIdentitySecondaryText = address ?? '—';
  const shouldRevealAddressOnHover = hasRegisteredName && Boolean(address);
  const showAnimatedAddress = shouldRevealAddressOnHover && isAddressFieldHovered;
  const addressFieldSideSlotPx = 26;
  const accountStatus = useMemo<AccountStatus>(() => {
    const candidateStatuses = [
      userInfo?.status,
      userInfo?.presence,
      userInfo?.userStatus,
      userInfo?.availability,
    ];
    const rawStatus = candidateStatuses.find(
      (value) => typeof value === 'string' && value.trim().length > 0
    );

    if (typeof rawStatus !== 'string') {
      return 'online';
    }

    const normalized = rawStatus.trim().toLowerCase();

    if (
      normalized === 'busy' ||
      normalized === 'dnd' ||
      normalized === 'do not disturb'
    ) {
      return 'busy';
    }

    if (
      normalized === 'invisible' ||
      normalized === 'hidden' ||
      normalized === 'offline'
    ) {
      return 'invisible';
    }

    return 'online';
  }, [userInfo]);
  const accountStatusMeta = useMemo(() => {
    if (accountStatus === 'busy') {
      return {
        color: isDarkMode ? '#D8A34D' : '#C48A26',
        label: 'Busy',
      };
    }

    if (accountStatus === 'invisible') {
      return {
        color: isDarkMode
          ? alpha(theme.palette.common.white, 0.36)
          : alpha(theme.palette.text.primary, 0.32),
        label: 'Invisible',
      };
    }

    return {
      color: isDarkMode ? '#56C47B' : '#2F9E5E',
      label: 'Online',
    };
  }, [
    accountStatus,
    isDarkMode,
    theme.palette.common.white,
    theme.palette.text.primary,
  ]);
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
  const avatarPanelOriginRadius = 22;
  const avatarPanelTargetRadius = 20;
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
        ...dashboardPanelSx(theme, 'accent'),
        alignItems: 'center',
        borderRadius: '14px',
        display: 'grid',
        gap: {
          xs: '18px',
          md: '16px',
        },
        gridTemplateColumns: {
          xs: '1fr',
          md: '104px minmax(0, 1fr) 104px',
        },
        minHeight: '164px',
        padding: '22px 24px',
        width: '100%',
      }}
      onMouseMove={handleDashboardPanelPointerMove}
      onMouseLeave={handleDashboardPanelPointerLeave}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          justifyContent: 'center',
          width: '104px',
        }}
      >
        <TiltedCard
          scaleOnHover={1.1}
          rotateAmplitude={18}
        >
          <BorderGlow
            animated={isAvatarGlowHovered}
            loopAnimated={true}
            interactive={false}
            edgeSensitivity={20}
            glowColor={isDarkMode ? '218 79 73' : '218 72 70'}
            backgroundColor="transparent"
            borderRadius={26}
            glowRadius={50}
            glowIntensity={isDarkMode ? 0.3 : 0.42}
            coneSpread={25}
            colors={[
              GROUP_ACTIVITY_BLUE.gradientTop,
              GROUP_ACTIVITY_BLUE.primary,
              GROUP_ACTIVITY_BLUE.hover,
            ]}
            fillOpacity={0.32}
            style={{
              '--card-border': 'transparent',
              '--card-shadow': 'none',
              width: 'fit-content',
            }}
          >
            <ButtonBase
              ref={avatarAnchorRef}
              onClick={(e) => openAvatarPanel(e.currentTarget)}
              onMouseEnter={() => setIsAvatarGlowHovered(true)}
              onMouseLeave={() => setIsAvatarGlowHovered(false)}
              sx={{
                background: isDarkMode
                  ? 'linear-gradient(180deg, rgba(255,255,255,0.062) 0%, rgba(255,255,255,0.02) 100%)'
                  : 'linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0.36) 100%)',
                border: `1px solid ${
                  isDarkMode
                    ? 'rgba(255,255,255,0.08)'
                    : alpha(theme.palette.common.white, 0.54)
                }`,
                borderRadius: '22px',
                boxShadow: isDarkMode
                  ? '0 1px 4px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(0,0,0,0.18)'
                  : '0 1px 3px rgba(28,36,52,0.08), inset 0 1px 0 rgba(255,255,255,0.42)',
                display: 'inline-flex',
                overflow: 'hidden',
                padding: '3px',
                transition: 'border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease',
                '&:hover': {
                  borderColor: isDarkMode
                    ? 'rgba(255,255,255,0.12)'
                    : alpha(theme.palette.common.white, 0.74),
                  boxShadow: isDarkMode
                    ? '0 0 0 3px rgba(132,175,240,0.08), inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.18)'
                    : '0 0 0 3px rgba(132,175,240,0.08), inset 0 1px 0 rgba(255,255,255,0.5)',
                },
              }}
            >
              <Avatar
                src={avatarUrl ?? undefined}
                onError={() => setAvatarError(true)}
                sx={{
                  bgcolor: isDarkMode ? '#636772' : '#E7DED0',
                  borderRadius: '22px',
                  height: 88,
                  width: 88,
                }}
              >
                <PersonIcon
                  sx={{
                    color: isDarkMode ? '#1D2126' : theme.palette.text.secondary,
                    fontSize: 44,
                  }}
                />
              </Avatar>
            </ButtonBase>
          </BorderGlow>
        </TiltedCard>
        <Typography
          sx={{
            color: theme.palette.mode === 'dark'
              ? alpha(theme.palette.common.white, 0.48)
              : alpha(theme.palette.text.primary, 0.5),
            fontSize: '0.6rem',
            letterSpacing: '0.01em',
            opacity: 1,
            lineHeight: 1.1,
            textAlign: 'center',
            userSelect: 'none',
            width: '100%',
          }}
        >
          Edit profile
        </Typography>
      </Box>

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: '8px',
          minWidth: 0,
          width: '100%',
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            maxWidth: '430px',
            minWidth: 0,
            width: '100%',
          }}
        >
          <Typography
            sx={{
              color: isDarkMode
                ? alpha(theme.palette.common.white, 0.9)
                : alpha(theme.palette.text.primary, 0.9),
              fontSize: '0.95rem',
              fontWeight: 560,
              letterSpacing: '-0.01em',
              textAlign: 'center',
              width: '100%',
            }}
          >
            Account Overview
          </Typography>

          <Box
            sx={{
              alignItems: 'center',
              bgcolor: isDarkMode ? '#1A1E26' : '#E7DDCE',
              border: `1px solid ${
                isDarkMode
                  ? 'rgba(255,255,255,0.09)'
                  : theme.palette.border.main
              }`,
              borderRadius: '10px',
              boxShadow: isDarkMode
                ? 'inset 0 1px 0 rgba(255,255,255,0.045)'
                : 'inset 0 1px 0 rgba(255,255,255,0.28)',
              cursor: address ? 'pointer' : 'default',
              columnGap: '10px',
              display: 'grid',
              gridTemplateColumns: `${addressFieldSideSlotPx}px minmax(0, 1fr) ${addressFieldSideSlotPx}px`,
              minHeight: '48px',
              position: 'relative',
              px: 1.5,
              py: 1,
              transition: 'background-color 160ms ease, border-color 160ms ease',
              width: '100%',
              '&:hover': address
                ? {
                    backgroundColor: isDarkMode ? '#181c23' : '#DDD2C2',
                    borderColor: theme.palette.border.main,
                    '& .wallet-address-overlay': {
                      color: theme.palette.text.primary,
                    },
                  }
                : undefined,
            }}
            onClick={address ? handleCopyAddress : undefined}
            onMouseEnter={
              shouldRevealAddressOnHover
                ? () => setIsAddressFieldHovered(true)
                : undefined
            }
            onMouseLeave={
              shouldRevealAddressOnHover
                ? () => setIsAddressFieldHovered(false)
                : undefined
            }
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
            <Box
              aria-hidden="true"
              sx={{
                height: `${addressFieldSideSlotPx}px`,
                width: `${addressFieldSideSlotPx}px`,
              }}
            />
            <Box
              className="wallet-address-overlay"
              sx={{
                alignItems: 'center',
                color: theme.palette.mode === 'dark'
                  ? 'rgba(236, 241, 248, 0.9)'
                  : theme.palette.text.secondary,
                display: 'flex',
                fontFamily: shouldRevealAddressOnHover
                  ? showAnimatedAddress
                    ? 'monospace'
                    : 'inherit'
                  : hasRegisteredName
                    ? 'inherit'
                    : 'monospace',
                fontSize: '0.88rem',
                justifyContent: 'center',
                minWidth: 0,
                textAlign: 'center',
                transition: 'color 160ms ease',
                width: '100%',
              }}
            >
              {shouldRevealAddressOnHover ? (
                showAnimatedAddress ? (
                  <Box
                    sx={{
                      maxWidth: '100%',
                      overflow: 'hidden',
                      pointerEvents: 'auto',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <DecryptedText
                      text={accountIdentitySecondaryText}
                      animateOn="hover"
                      active={showAnimatedAddress}
                      speed={35}
                      maxIterations={12}
                      sequential={true}
                      revealDirection="start"
                      useOriginalCharsOnly={true}
                    />
                  </Box>
                ) : (
                  <Box
                    sx={{
                      maxWidth: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {accountIdentityPrimaryText}
                  </Box>
                )
              ) : (
                <Box
                  sx={{
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {accountIdentityPrimaryText}
                </Box>
              )}
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

          <Box
            sx={{
              alignItems: 'center',
              display: 'inline-flex',
              gap: '7px',
              justifyContent: 'center',
              minHeight: '18px',
              mt: '2px',
              width: '100%',
            }}
          >
            <Box
              aria-hidden="true"
              sx={{
                animation:
                  accountStatus === 'online'
                    ? 'homeProfileStatusPulse 3.4s ease-in-out infinite'
                    : undefined,
                bgcolor: accountStatusMeta.color,
                borderRadius: '50%',
                flexShrink: 0,
                height: 7,
                width: 7,
                '@keyframes homeProfileStatusPulse': {
                  '0%, 100%': {
                    opacity: 0.9,
                    transform: 'scale(0.92)',
                  },
                  '50%': {
                    opacity: 1,
                    transform: 'scale(1.08)',
                  },
                },
              }}
            />
            <Typography
              sx={{
                color: alpha(theme.palette.text.secondary, 0.92),
                fontSize: '0.72rem',
                fontWeight: 600,
                letterSpacing: '0.01em',
                lineHeight: 1.1,
                textAlign: 'center',
              }}
            >
              {accountStatusMeta.label}
            </Typography>
          </Box>

          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '0.64rem',
              letterSpacing: '0.05em',
              opacity: 0.88,
              textAlign: 'center',
              textTransform: 'uppercase',
              width: '100%',
            }}
          >
            QORTAL NAME & ADDRESS
          </Typography>
        </Box>
      </Box>

      <Box
        sx={{
          alignItems: 'flex-start',
          display: 'flex',
          justifyContent: {
            xs: 'flex-end',
            md: 'flex-end',
          },
          justifySelf: 'stretch',
          minHeight: '100%',
          width: '104px',
        }}
      >
        {onOpenSettings && (
          <ButtonBase
            onClick={onOpenSettings}
            aria-label={t('core:settings')}
            sx={{
              alignItems: 'center',
              borderRadius: '10px',
              color: theme.palette.text.secondary,
              display: 'inline-flex',
              height: 32,
              justifyContent: 'center',
              opacity: 0.52,
              backgroundColor: 'transparent',
              transition:
                'background-color 160ms ease, color 160ms ease, opacity 160ms ease, transform 120ms ease',
              width: 32,
              '&:hover': {
                backgroundColor: alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.06 : 0.18),
                color: theme.palette.text.primary,
                opacity: 1,
              },
              '&:active': {
                transform: 'translateY(1px)',
              },
            }}
          >
            <SettingsRoundedIcon sx={{ fontSize: 19 }} />
          </ButtonBase>
        )}
      </Box>

      <Portal>
        <AnimatePresence>
          {isAvatarPanelOpen && (
            <>
              <Box
                component={motion.button}
                type="button"
                aria-label="Close avatar panel"
                initial={{
                  opacity: 0,
                  backdropFilter: 'blur(0px) brightness(1) saturate(1)',
                  WebkitBackdropFilter: 'blur(0px) brightness(1) saturate(1)',
                  backgroundColor: isDarkMode
                    ? 'rgba(6, 8, 12, 0)'
                    : 'rgba(22, 26, 34, 0)',
                }}
                animate={{
                  opacity: 1,
                  backdropFilter: isDarkMode
                    ? 'blur(12px) brightness(0.76) saturate(0.88)'
                    : 'blur(12px) brightness(0.9) saturate(0.94)',
                  WebkitBackdropFilter: isDarkMode
                    ? 'blur(12px) brightness(0.76) saturate(0.88)'
                    : 'blur(12px) brightness(0.9) saturate(0.94)',
                  backgroundColor: isDarkMode
                    ? 'rgba(6, 8, 12, 0.4)'
                    : 'rgba(22, 26, 34, 0.14)',
                }}
                exit={{
                  opacity: 0,
                  backdropFilter: 'blur(0px) brightness(1) saturate(1)',
                  WebkitBackdropFilter: 'blur(0px) brightness(1) saturate(1)',
                  backgroundColor: isDarkMode
                    ? 'rgba(6, 8, 12, 0)'
                    : 'rgba(22, 26, 34, 0)',
                }}
                transition={{
                  duration: prefersReducedMotion ? 0.08 : 0.14,
                  ease: [0.2, 0, 0, 1],
                  delay: prefersReducedMotion ? 0 : 0.08,
                }}
                onClick={closeAvatarPanel}
                sx={{
                  appearance: 'none',
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
                    bgcolor: avatarModalSurface,
                    border: isDarkMode
                      ? '1px solid rgba(255,255,255,0.075)'
                      : '1px solid rgba(28,36,52,0.08)',
                    borderRadius: `${avatarPanelTargetRadius}px`,
                    boxShadow:
                      isDarkMode
                        ? '0 38px 92px rgba(0,0,0,0.54), 0 14px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.035)'
                        : '0 32px 72px rgba(28, 36, 52, 0.2), 0 12px 26px rgba(28, 36, 52, 0.1), inset 0 1px 0 rgba(255,255,255,0.45)',
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
                      bgcolor: avatarModalSurface,
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
                              ? 'linear-gradient(180deg, rgba(38,42,51,0.98) 0%, rgba(34,37,45,1) 100%)'
                              : 'linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(241,236,227,0.92) 100%)',
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
                            backgroundColor: isDarkMode ? avatarModalSurfaceSoft : theme.palette.background.elevated,
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
                            background: avatarFieldSurface,
                            border: `1px solid ${avatarFieldBorder}`,
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
                              background: isDarkMode
                                ? 'linear-gradient(180deg, rgba(43,47,58,1) 0%, rgba(36,39,47,1) 100%)'
                                : 'linear-gradient(180deg, rgba(250,246,238,1) 0%, rgba(244,238,229,1) 100%)',
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
                            backgroundColor: isDarkMode ? avatarModalSurfaceSoft : theme.palette.background.elevated,
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
                            background: avatarFieldSurface,
                            border: `1px solid ${avatarFieldBorder}`,
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
                            backgroundColor: avatarWarningTone.background,
                            border: `1px solid ${avatarWarningTone.border}`,
                            borderRadius: '12px',
                            display: 'flex',
                            gap: 1,
                            px: 1.25,
                            py: 1.15,
                          }}
                        >
                          <ErrorIcon
                            sx={{
                              color: avatarWarningTone.icon,
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
                          borderRadius: '12px',
                          ...getBlueTier1ButtonSx(),
                          fontSize: '0.82rem',
                          fontWeight: 600,
                          minHeight: 44,
                          textTransform: 'none',
                          '&.Mui-disabled': {
                            background: isDarkMode
                              ? 'rgba(255,255,255,0.035)'
                              : 'rgba(24,29,36,0.04)',
                            border: isDarkMode
                              ? '1px solid rgba(255,255,255,0.055)'
                              : '1px solid rgba(24,29,36,0.06)',
                            boxShadow: 'none',
                            color: isDarkMode
                              ? 'rgba(255,255,255,0.34)'
                              : 'rgba(24,29,36,0.34)',
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

