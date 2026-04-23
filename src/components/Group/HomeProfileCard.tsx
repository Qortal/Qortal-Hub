import {
  type MouseEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Avatar,
  Box,
  ButtonBase,
  Menu,
  MenuItem,
  Portal,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { LoadingButton } from '@mui/lab';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CloseIcon from '@mui/icons-material/Close';
import ErrorIcon from '@mui/icons-material/Error';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import PersonIcon from '@mui/icons-material/Person';
import QrCode2RoundedIcon from '@mui/icons-material/QrCode2Rounded';
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
  onOpenReceive?: (anchorEl: HTMLElement) => void;
};

type AccountStatus = 'busy' | 'invisible' | 'online';

const ACCOUNT_STATUS_STORAGE_KEY = 'home_profile_account_status';
const ACCOUNT_STATUS_OPTIONS: Array<{
  color: string;
  key: AccountStatus;
  label: string;
}> = [
  {
    color: 'var(--account-status-online)',
    key: 'online',
    label: 'Online',
  },
  {
    color: 'var(--account-status-busy)',
    key: 'busy',
    label: 'Busy',
  },
  {
    color: 'var(--account-status-invisible)',
    key: 'invisible',
    label: 'Invisible',
  },
];

export const HomeProfileCard = ({
  onOpenReceive,
}: HomeProfileCardProps) => {
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
  const [accountStatusAnchorEl, setAccountStatusAnchorEl] =
    useState<HTMLElement | null>(null);
  const [accountStatusOverride, setAccountStatusOverride] =
    useState<AccountStatus | null>(null);
  const panelRef = useDashboardPanelMouseLight<HTMLDivElement>();
  const prefersReducedMotion = useReducedMotion();
  const isDarkMode = theme.palette.mode === 'dark';
  const avatarModalSurface = isDarkMode
    ? 'linear-gradient(145deg, rgba(49,54,64,0.985) 0%, rgba(35,39,47,0.992) 48%, rgba(24,27,33,0.996) 100%)'
    : 'linear-gradient(180deg, rgba(251,253,255,0.985) 0%, rgba(244,247,251,0.99) 100%)';
  const avatarModalSurfaceSoft = isDarkMode
    ? 'linear-gradient(145deg, rgba(94,101,114,0.34) 0%, rgba(72,78,89,0.3) 100%)'
    : alpha(theme.palette.text.primary, 0.035);
  const avatarFieldSurface = isDarkMode
    ? 'linear-gradient(145deg, rgba(88,95,108,0.2) 0%, rgba(56,62,73,0.28) 44%, rgba(37,41,49,0.42) 100%)'
    : 'linear-gradient(180deg, rgba(17,23,34,0.042) 0%, rgba(17,23,34,0.024) 100%)';
  const avatarFieldSurfaceHover = isDarkMode
    ? 'linear-gradient(145deg, rgba(98,106,120,0.24) 0%, rgba(63,70,82,0.34) 46%, rgba(43,48,57,0.48) 100%)'
    : 'linear-gradient(180deg, rgba(17,23,34,0.06) 0%, rgba(17,23,34,0.034) 100%)';
  const avatarFieldBorder = isDarkMode
    ? 'rgba(255,255,255,0.085)'
    : 'rgba(24,29,36,0.12)';
  const avatarFieldHoverBorder = isDarkMode
    ? 'rgba(255,255,255,0.12)'
    : 'rgba(24,29,36,0.16)';
  const avatarSectionDivider = isDarkMode
    ? 'rgba(255,255,255,0.052)'
    : 'rgba(24,29,36,0.1)';
  const avatarFieldInsetShadow = isDarkMode
    ? '0 8px 20px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.035)'
    : '0 4px 10px rgba(24,32,44,0.06), inset 0 1px 0 rgba(255,255,255,0.5)';
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
  const accountStatusStorageKey = useMemo(() => {
    const identityKey = address?.trim() || name?.trim() || 'default';
    return `${ACCOUNT_STATUS_STORAGE_KEY}:${identityKey}`;
  }, [address, name]);
  const accountIdentityPrimaryText = hasRegisteredName
    ? name ?? '—'
    : address ?? '—';
  const accountIdentitySecondaryText = address ?? '—';
  const shouldRevealAddressOnHover = hasRegisteredName && Boolean(address);
  const showAnimatedAddress = shouldRevealAddressOnHover && isAddressFieldHovered;
  const addressFieldActionButtonSizePx = 26;
  const addressFieldActionGapPx = 1;
  const addressFieldActionBaseColor = isDarkMode
    ? alpha(theme.palette.common.white, 0.34)
    : alpha(theme.palette.text.primary, 0.4);
  const addressFieldActionHoverColor = isDarkMode
    ? alpha(theme.palette.common.white, 0.68)
    : alpha(theme.palette.text.primary, 0.7);
  const addressFieldActionHoverBackground = isDarkMode
    ? alpha(theme.palette.common.white, 0.055)
    : alpha(theme.palette.text.primary, 0.06);
  const fallbackAccountStatus = useMemo<AccountStatus>(() => {
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
  const accountStatus = accountStatusOverride ?? fallbackAccountStatus;
  const isAccountStatusMenuOpen = Boolean(accountStatusAnchorEl);
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

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const storedStatus = window.localStorage.getItem(accountStatusStorageKey);

      if (
        storedStatus === 'online' ||
        storedStatus === 'busy' ||
        storedStatus === 'invisible'
      ) {
        setAccountStatusOverride(storedStatus);
        return;
      }
    } catch (error) {
      console.warn('Unable to read local account status override.', error);
    }

    setAccountStatusOverride(null);
  }, [accountStatusStorageKey]);

  const handleOpenAccountStatusMenu = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      setAccountStatusAnchorEl(event.currentTarget);
    },
    []
  );

  const handleCloseAccountStatusMenu = useCallback(() => {
    setAccountStatusAnchorEl(null);
  }, []);

  const handleSelectAccountStatus = useCallback(
    (nextStatus: AccountStatus) => {
      setAccountStatusOverride(nextStatus);

      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(accountStatusStorageKey, nextStatus);
        } catch (error) {
          console.warn('Unable to persist local account status override.', error);
        }
      }

      setAccountStatusAnchorEl(null);
    },
    [accountStatusStorageKey]
  );

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
          md: '104px minmax(0, 1fr)',
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
          gap: '4px',
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

        <ButtonBase
          onClick={handleOpenAccountStatusMenu}
          aria-haspopup="menu"
          aria-expanded={isAccountStatusMenuOpen ? 'true' : undefined}
          aria-controls={isAccountStatusMenuOpen ? 'account-status-menu' : undefined}
          sx={{
            alignItems: 'center',
            backgroundColor: alpha(
              isDarkMode ? theme.palette.common.white : theme.palette.text.primary,
              isDarkMode ? 0.06 : 0.05
            ),
            borderRadius: '999px',
            display: 'inline-flex',
            gap: '6px',
            justifyContent: 'center',
            maxWidth: '100%',
            minHeight: '22px',
            mt: '2px',
            px: '8px',
            py: '3px',
            transition:
              'background-color 160ms ease, color 160ms ease, transform 120ms ease',
            '&:hover': {
              backgroundColor: alpha(
                isDarkMode ? theme.palette.common.white : theme.palette.text.primary,
                isDarkMode ? 0.1 : 0.08
              ),
            },
            '&:focus-visible': {
              backgroundColor: alpha(theme.palette.primary.main, isDarkMode ? 0.16 : 0.1),
            },
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
              color: alpha(theme.palette.text.secondary, 0.88),
              fontSize: '0.72rem',
              fontWeight: 600,
              letterSpacing: '0.01em',
              lineHeight: 1.1,
              textAlign: 'center',
            }}
          >
            {accountStatusMeta.label}
          </Typography>
          <KeyboardArrowDownRoundedIcon
            sx={{
              color: alpha(theme.palette.text.secondary, 0.66),
              fontSize: '0.9rem',
            }}
          />
        </ButtonBase>
      </Box>

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: '8px',
          minWidth: 0,
          pl: {
            xs: 0,
            md: '12px',
          },
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
              bgcolor: isDarkMode ? '#1A1D24' : '#E7DDD0',
              border: `1px solid ${
                isDarkMode
                  ? 'rgba(255,255,255,0.045)'
                  : alpha(theme.palette.text.primary, 0.065)
              }`,
              borderRadius: '11px',
              boxShadow: isDarkMode
                ? 'inset 0 1px 0 rgba(255,255,255,0.018)'
                : 'inset 0 1px 0 rgba(255,255,255,0.12)',
              cursor: address ? 'pointer' : 'default',
              display: 'flex',
              gap: '8px',
              minHeight: '38px',
              px: '11px',
              py: '5px',
              transition:
                'background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease',
              width: '100%',
              '&:hover': address
                ? {
                    backgroundColor: isDarkMode ? '#171A20' : '#E2D7C9',
                    borderColor: isDarkMode
                      ? 'rgba(255,255,255,0.06)'
                      : alpha(theme.palette.text.primary, 0.095),
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
              className="wallet-address-overlay"
              sx={{
                alignItems: 'center',
                color: theme.palette.mode === 'dark'
                  ? 'rgba(236, 241, 248, 0.86)'
                  : alpha(theme.palette.text.primary, 0.72),
                display: 'flex',
                flex: '1 1 auto',
                fontFamily: shouldRevealAddressOnHover
                  ? showAnimatedAddress
                    ? 'monospace'
                    : 'inherit'
                  : hasRegisteredName
                    ? 'inherit'
                    : 'monospace',
                fontSize: '0.84rem',
                justifyContent: 'flex-start',
                minWidth: 0,
                pr: '4px',
                textAlign: 'left',
                transition: 'color 160ms ease',
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
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexShrink: 0,
                justifyContent: 'flex-end',
                ml: 'auto',
              }}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: `${addressFieldActionGapPx}px`,
                  justifyContent: 'flex-end',
                }}
              >
                {onOpenReceive ? (
                  <Tooltip enterDelay={450} title="Show receive QR">
                    <Box component="span">
                      <ButtonBase
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenReceive(event.currentTarget);
                        }}
                        disabled={!address}
                        aria-label="Show receive QR"
                        sx={{
                          alignItems: 'center',
                          borderRadius: '8px',
                          color: addressFieldActionBaseColor,
                          display: 'inline-flex',
                          flexShrink: 0,
                          height: `${addressFieldActionButtonSizePx}px`,
                          justifyContent: 'center',
                          transition:
                            'background-color 160ms ease, color 160ms ease, opacity 160ms ease',
                          width: `${addressFieldActionButtonSizePx}px`,
                          '&:hover': {
                            backgroundColor: addressFieldActionHoverBackground,
                            color: addressFieldActionHoverColor,
                          },
                        }}
                      >
                        <QrCode2RoundedIcon sx={{ fontSize: '0.95rem' }} />
                      </ButtonBase>
                    </Box>
                  </Tooltip>
                ) : null}
                <ButtonBase
                  onClick={(event) => {
                    event.stopPropagation();
                    handleCopyAddress();
                  }}
                  disabled={!address}
                  aria-label="Copy address"
                  sx={{
                    alignItems: 'center',
                    borderRadius: '8px',
                    color: addressFieldActionBaseColor,
                    display: 'inline-flex',
                    flexShrink: 0,
                    height: `${addressFieldActionButtonSizePx}px`,
                    justifyContent: 'center',
                    width: `${addressFieldActionButtonSizePx}px`,
                    '&:hover': {
                      backgroundColor: addressFieldActionHoverBackground,
                      color: addressFieldActionHoverColor,
                    },
                  }}
                >
                  <ContentCopyIcon sx={{ fontSize: '0.92rem' }} />
                </ButtonBase>
              </Box>
            </Box>
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

      <Menu
        id="account-status-menu"
        anchorEl={accountStatusAnchorEl}
        open={isAccountStatusMenuOpen}
        onClose={handleCloseAccountStatusMenu}
        anchorOrigin={{
          horizontal: 'center',
          vertical: 'bottom',
        }}
        transformOrigin={{
          horizontal: 'center',
          vertical: 'top',
        }}
        slotProps={{
          list: {
            sx: {
              p: '6px',
            },
          },
          paper: {
            sx: {
              backdropFilter: 'blur(14px)',
              bgcolor: isDarkMode ? 'rgba(34, 37, 46, 0.94)' : 'rgba(251, 247, 240, 0.94)',
              border: `1px solid ${alpha(
                isDarkMode ? theme.palette.common.white : theme.palette.text.primary,
                0.07
              )}`,
              borderRadius: '16px',
              boxShadow: isDarkMode
                ? '0 18px 36px rgba(0, 0, 0, 0.32)'
                : '0 16px 28px rgba(24, 32, 44, 0.12)',
              minWidth: 168,
              mt: 0.5,
              overflow: 'hidden',
            },
          },
        }}
      >
        {ACCOUNT_STATUS_OPTIONS.map((option) => {
          const isSelected = option.key === accountStatus;

          return (
            <MenuItem
              key={option.key}
              selected={isSelected}
              onClick={() => handleSelectAccountStatus(option.key)}
              sx={{
                alignItems: 'center',
                columnGap: '10px',
                borderRadius: '12px',
                minHeight: '38px',
                px: '12px',
                py: '7px',
              }}
            >
              <Box
                aria-hidden="true"
                sx={{
                  bgcolor: option.color,
                  borderRadius: '50%',
                  flexShrink: 0,
                  height: 8,
                  width: 8,
                }}
              />
              <Typography
                sx={{
                  color: isSelected
                    ? theme.palette.text.primary
                    : alpha(theme.palette.text.secondary, 0.96),
                  fontSize: '0.82rem',
                  fontWeight: isSelected ? 700 : 600,
                  letterSpacing: '0.01em',
                }}
              >
                {option.label}
              </Typography>
            </MenuItem>
          );
        })}
      </Menu>

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
                  overflow: 'visible',
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
                    background: avatarModalSurface,
                    border: isDarkMode
                      ? '1px solid rgba(255,255,255,0.08)'
                      : '1px solid rgba(24,29,36,0.09)',
                    borderRadius: '14px',
                    boxShadow:
                      isDarkMode
                        ? '0 34px 120px rgba(0,0,0,0.46)'
                        : '0 28px 88px rgba(18,28,45,0.16)',
                    clipPath: 'inset(0 round 14px)',
                    isolation: 'isolate',
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
                      background: avatarModalSurface,
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
                            fontSize: '0.98rem',
                            fontWeight: 700,
                            letterSpacing: '-0.02em',
                          }}
                        >
                          Update avatar
                        </Typography>
                        <Typography
                          sx={{
                            color: theme.palette.text.secondary,
                            fontSize: '0.76rem',
                            lineHeight: 1.45,
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
                          borderRadius: '8px',
                          color: theme.palette.text.secondary,
                          height: 30,
                          width: 30,
                          '&:hover': {
                            backgroundColor: alpha(
                              theme.palette.common.white,
                              isDarkMode ? 0.05 : 0.55
                            ),
                            color: theme.palette.text.primary,
                          },
                        }}
                      >
                        <CloseIcon sx={{ fontSize: 17 }} />
                      </ButtonBase>
                    </Box>

                    <Box
                      sx={{
                        borderTop: `1px solid ${avatarSectionDivider}`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1.15,
                        px: 2.25,
                        pb: 2.25,
                        pt: 2,
                      }}
                    >
                      <Box
                        sx={{
                          alignItems: 'center',
                          display: 'flex',
                          borderBottom: `1px solid ${avatarSectionDivider}`,
                          justifyContent: 'center',
                          minHeight: 146,
                          pb: 1.35,
                        }}
                      >
                        <Box
                          sx={{
                            alignItems: 'center',
                            background: avatarFieldSurface,
                            border: `1px solid ${avatarFieldBorder}`,
                            borderRadius: '50%',
                            boxShadow: avatarFieldInsetShadow,
                            display: 'flex',
                            height: 112,
                            justifyContent: 'center',
                            overflow: 'hidden',
                            width: 112,
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
                            borderRadius: '10px',
                            boxShadow: avatarFieldInsetShadow,
                            color: theme.palette.text.primary,
                            display: 'flex',
                            justifyContent: 'space-between',
                            px: 1.35,
                            py: 1.1,
                            textAlign: 'left',
                            transition:
                              'background 160ms ease, border-color 160ms ease, transform 120ms ease, box-shadow 160ms ease',
                            width: '100%',
                            '&:hover': {
                              background: avatarFieldSurfaceHover,
                              borderColor: avatarFieldHoverBorder,
                              boxShadow: isDarkMode
                                ? '0 10px 24px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.042)'
                                : '0 6px 14px rgba(24,32,44,0.08), inset 0 1px 0 rgba(255,255,255,0.54)',
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
                              fontWeight: 700,
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
                              background: avatarModalSurfaceSoft,
                              border: `1px solid ${avatarFieldBorder}`,
                              borderRadius: '999px',
                              color: theme.palette.text.primary,
                              display: 'inline-flex',
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              letterSpacing: '0.01em',
                              minHeight: 30,
                              px: 1.2,
                            }}
                          >
                            Browse
                          </Box>
                        </ButtonBase>
                      </ImageUploader>

                      {avatarFile?.name && (
                        <Typography
                          noWrap
                          sx={{
                            color: theme.palette.text.secondary,
                            fontSize: '0.72rem',
                            lineHeight: 1.35,
                            px: 0.15,
                          }}
                        >
                          {avatarFile.name}
                        </Typography>
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
                          borderRadius: '10px',
                          ...getBlueTier1ButtonSx(),
                          fontSize: '0.82rem',
                          fontWeight: 600,
                          minHeight: 42,
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

