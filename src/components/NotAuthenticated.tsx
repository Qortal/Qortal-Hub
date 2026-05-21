import { Box, ButtonBase, Typography, useTheme } from '@mui/material';
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import AccountCircleRoundedIcon from '@mui/icons-material/AccountCircleRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import HubRoundedIcon from '@mui/icons-material/HubRounded';
import SecurityRoundedIcon from '@mui/icons-material/SecurityRounded';
import authIntroAudioSrc from '../assets/audio/light-transition-351939.mp3';
import Logo1Dark from '../assets/svgs/Logo1Dark.svg';
import { useAtomValue } from 'jotai';
import { selectedNodeInfoAtom } from '../atoms/global';
import {
  HTTPS_EXT_NODE_QORTAL_LINK,
  isLocalNodeUrl,
} from '../constants/constants';
import { Wallets } from './Wallets';
import { AuthButton, AuthFrame } from './Auth/AuthShell';
import { ConnectionModeModal } from './Auth/ConnectionModeModal';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthUnlockTransitionSnapshot } from '../types/authTransition';

type IntroLogoMetrics = {
  finalHeight: number;
  finalLeft: number;
  finalTop: number;
  finalWidth: number;
  initialHeight: number;
  initialLeft: number;
  initialTop: number;
  initialWidth: number;
  overshootTop: number;
};

type IntroStage = 'pending' | 'ready' | 'running' | 'settling' | 'complete';

const AUTH_UI_ANIMATIONS_STORAGE_KEY = 'hub_ui_animations_enabled';
const AUTH_INTRO_OVERSHOOT_PX = 7;
const AUTH_INTRO_START_DELAY_MS = 560;
const AUTH_INTRO_FRAME_SETTLE_MS = 32;
const AUTH_INTRO_MOVE_MS = 860;
const AUTH_INTRO_SETTLE_MS = 300;
const AUTH_INTRO_COMPLETE_DELAY_MS = 620;
const AUTH_INTRO_SETTLE_EASING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const AUTH_INTRO_AUDIO_DURATION_SECONDS = 8.1;
const AUTH_INTRO_AUDIO_PEAK_SECONDS = 2.44;
const AUTH_INTRO_AUDIO_VOLUME = 0.42;
const AUTH_INTRO_AUDIO_START_OFFSET_SECONDS = Math.max(
  0,
  AUTH_INTRO_AUDIO_PEAK_SECONDS -
    (AUTH_INTRO_START_DELAY_MS +
      AUTH_INTRO_FRAME_SETTLE_MS +
      AUTH_INTRO_MOVE_MS +
      AUTH_INTRO_SETTLE_MS) /
      1000
);
const AUTH_INTRO_LOGO_RING_DOWN_MS = Math.round(
  (AUTH_INTRO_AUDIO_DURATION_SECONDS - AUTH_INTRO_AUDIO_PEAK_SECONDS) *
    1000
);
const AUTH_INTRO_LOGO_RING_MS =
  AUTH_INTRO_SETTLE_MS + AUTH_INTRO_LOGO_RING_DOWN_MS;
const AUTH_INTRO_LOGO_RING_PEAK_PERCENT = `${Math.round(
  (AUTH_INTRO_SETTLE_MS / AUTH_INTRO_LOGO_RING_MS) * 100
)}%`;
const AUTH_INTRO_LOGO_FINAL_FILTER =
  'brightness(1.23) contrast(1.06) saturate(1.1) drop-shadow(0 0 10px rgba(26,130,255,0.24))';
const AUTH_INTRO_LOGO_PEAK_FILTER =
  'brightness(1.32) contrast(1.08) saturate(1.14) drop-shadow(0 0 17px rgba(31,136,255,0.38))';
const AUTH_INTRO_LOGO_MID_RING_FILTER =
  'brightness(1.29) contrast(1.075) saturate(1.13) drop-shadow(0 0 15px rgba(31,136,255,0.32))';
const AUTH_INTRO_LOGO_LATE_RING_FILTER =
  'brightness(1.26) contrast(1.065) saturate(1.115) drop-shadow(0 0 12px rgba(29,132,255,0.27))';
const AUTH_INTRO_LOGO_SETTLING_FILTER =
  'brightness(1.2) contrast(1.05) saturate(1.08)';
const AUTH_INTRO_LOGO_SETTLING_PEAK_FILTER =
  'brightness(1.3) contrast(1.08) saturate(1.13) drop-shadow(0 0 14px rgba(31,136,255,0.32))';
const AUTH_INTRO_LOGO_SETTLING_MID_FILTER =
  'brightness(1.265) contrast(1.07) saturate(1.12) drop-shadow(0 0 12px rgba(31,136,255,0.27))';
const AUTH_INTRO_LOGO_SETTLING_LATE_FILTER =
  'brightness(1.225) contrast(1.055) saturate(1.095) drop-shadow(0 0 8px rgba(29,132,255,0.18))';
let hasAuthIntroPlayedThisSession = false;

const areAuthAnimationsEnabled = () => {
  if (typeof window === 'undefined') return true;

  try {
    const storedValue = window.localStorage.getItem(
      AUTH_UI_ANIMATIONS_STORAGE_KEY
    );

    if (storedValue === null) return true;

    return JSON.parse(storedValue) !== false;
  } catch {
    return true;
  }
};

export const manifestData = {
  version: '1.0.0',
};

export const NotAuthenticated = ({
  setExtstate,
  setRawWallet,
  rawWallet,
  onWalletUnlockStart,
}) => {
  const theme = useTheme();
  const isLight = theme.palette.mode === 'light';
  const { t } = useTranslation(['auth']);
  const selectedNode = useAtomValue(selectedNodeInfoAtom);
  const [isConnectionModeOpen, setIsConnectionModeOpen] = useState(false);
  const [isEntryAccountsReady, setIsEntryAccountsReady] = useState(false);
  const [isUnlockLeaving, setIsUnlockLeaving] = useState(false);
  const [isLogoRingDownActive, setIsLogoRingDownActive] = useState(false);
  const logoRef = useRef<HTMLImageElement | null>(null);
  const introAudioRef = useRef<HTMLAudioElement | null>(null);
  const globalMotionOverrideRef = useRef<{
    element: HTMLStyleElement;
    wasDisabled?: boolean;
  } | null>(null);
  const [isIntroLogoReady, setIsIntroLogoReady] = useState(false);
  const [introMetrics, setIntroMetrics] = useState<IntroLogoMetrics | null>(null);
  const [introStage, setIntroStage] = useState<IntroStage>('pending');
  const usingLocalNode = isLocalNodeUrl(selectedNode?.url);
  const customNodeStatusLabel =
    selectedNode?.name?.trim() || selectedNode?.url?.trim() || '';
  const connectionLabel = usingLocalNode
    ? t('auth:authentication_form.using_local_node', {
        postProcess: 'capitalizeFirstChar',
      })
    : selectedNode?.url === HTTPS_EXT_NODE_QORTAL_LINK
      ? t('auth:authentication_form.using_public_node', {
          postProcess: 'capitalizeFirstChar',
        })
      : customNodeStatusLabel
        ? t('auth:authentication_form.using_custom_node_named', {
            label: customNodeStatusLabel,
            defaultValue: 'Using {{label}}',
            postProcess: 'capitalizeFirstChar',
          })
        : t('auth:authentication_form.using_custom_node', {
            postProcess: 'capitalizeFirstChar',
          });
  const featureItems = useMemo(
    () => [
      {
        id: 'secure',
        icon: <SecurityRoundedIcon sx={{ fontSize: 34 }} />,

        title: t('auth:intro_features.secure_title'),
        text: t('auth:intro_features.secure_text'),
      },
      {
        id: 'fast',
        icon: <BoltRoundedIcon sx={{ fontSize: 34 }} />,

        title: t('auth:intro_features.fast_title'),
        text: t('auth:intro_features.fast_text'),
      },
      {
        id: 'decentralized',
        icon: <HubRoundedIcon sx={{ fontSize: 34 }} />,

        title: t('auth:intro_features.decentralized_title'),
        text: t('auth:intro_features.decentralized_text'),
      },
      {
        id: 'built',
        icon: <AccountCircleRoundedIcon sx={{ fontSize: 34 }} />,

        title: t('auth:intro_features.built_title'),
        text: t('auth:intro_features.built_text'),
      },
    ],
    [t]
  );
  const handleEntryAccountsReady = useCallback(() => {
    setIsEntryAccountsReady(true);
  }, []);
  const handleWalletUnlockStart = useCallback(
    (snapshot: AuthUnlockTransitionSnapshot) => {
      const audio = introAudioRef.current;
      if (audio) {
        audio.pause();
        try {
          audio.currentTime = 0;
        } catch {
          // Some media backends reject seeking before metadata is ready.
        }
      }
      setIsLogoRingDownActive(false);
      setIsUnlockLeaving(true);
      onWalletUnlockStart?.(snapshot);
    },
    [onWalletUnlockStart]
  );
  const hasAccountsText = (
    <Wallets
      mode="entry"
      setExtState={setExtstate}
      setRawWallet={setRawWallet}
      rawWallet={rawWallet}
      onReady={handleEntryAccountsReady}
      onWalletUnlockStart={handleWalletUnlockStart}
    />
  );
  const introComplete = introStage === 'complete';
  const introCardGlowOpacity =
    introComplete ? 1 : introStage === 'settling' ? 0.76 : 0;
  const shouldAnimateIntro = !introComplete;
  const isLogoAnimating =
    introStage === 'running' || introStage === 'settling';
  const isMainAuthContentVisible = introComplete || isLogoAnimating;
  const shouldRenderIntroOverlay = shouldAnimateIntro || isLogoRingDownActive;
  const isIntroOverlayAtRest = isLogoAnimating || isLogoRingDownActive;
  const restoreGlobalMotionOverride = () => {
    const override = globalMotionOverrideRef.current;

    if (!override) return;

    override.element.disabled = override.wasDisabled ?? false;
    globalMotionOverrideRef.current = null;
  };
  const prepareIntroMetrics = () => {
    const logoElement =
      logoRef.current ||
      (typeof document !== 'undefined'
        ? (document.querySelector(
            '[data-auth-logo-target="entry-logo"]'
          ) as HTMLImageElement | null)
        : null);

    if (!logoElement) return false;

    const rect = logoElement.getBoundingClientRect();
    const initialWidth = rect.width * 1.45;
    const initialHeight = rect.height * 1.45;
    const initialTop = window.innerHeight / 2 - initialHeight / 2;
    const yDirection = rect.top >= initialTop ? 1 : -1;

    setIntroMetrics({
      finalHeight: rect.height,
      finalLeft: rect.left,
      finalTop: rect.top,
      finalWidth: rect.width,
      initialHeight,
      initialLeft: window.innerWidth / 2 - initialWidth / 2,
      initialTop,
      initialWidth,
      overshootTop: rect.top + yDirection * AUTH_INTRO_OVERSHOOT_PX,
    });

    return true;
  };
  const revealSx = (delayMs: number) =>
    introComplete
      ? {}
      : {
          animation: isLogoAnimating
            ? `authIntroReveal 400ms cubic-bezier(0.4, 0, 0.2, 1) ${delayMs}ms both`
            : 'none',
          opacity: 0,
          pointerEvents: 'none',
          transform: 'translateY(6px)',
    };
  const cardRevealSx = (delayMs: number) =>
    introComplete
      ? {}
      : {
          animation: isLogoAnimating
            ? `authIntroCardReveal 320ms cubic-bezier(0.4, 0, 0.2, 1) ${delayMs}ms both`
            : 'none',
          opacity: 0,
          pointerEvents: 'none',
    };
  const stopIntroAudio = useCallback(() => {
    const audio = introAudioRef.current;

    if (!audio) return;

    audio.pause();
    audio.volume = AUTH_INTRO_AUDIO_VOLUME;
    try {
      audio.currentTime = 0;
    } catch {
      // Some media backends reject seeking before metadata is ready.
    }
  }, []);
  const playIntroAudio = useCallback(() => {
    if (!areAuthAnimationsEnabled()) return;

    const audio = introAudioRef.current ?? new Audio(authIntroAudioSrc);
    introAudioRef.current = audio;

    audio.pause();
    audio.preload = 'auto';
    audio.volume = AUTH_INTRO_AUDIO_VOLUME;
    try {
      audio.currentTime = AUTH_INTRO_AUDIO_START_OFFSET_SECONDS;
    } catch {
      // If metadata is still loading, playback can start from the beginning.
    }

    void audio.play().catch(() => {
      // Autoplay can be blocked outside Electron before user interaction.
    });
  }, []);

  useEffect(() => {
    if (!areAuthAnimationsEnabled()) {
      setIsIntroLogoReady(true);
      return;
    }

    let isMounted = true;
    const logoImage = new Image();
    const markLogoReady = () => {
      if (isMounted) {
        setIsIntroLogoReady(true);
      }
    };
    const fallbackTimer = window.setTimeout(markLogoReady, 1200);

    logoImage.onload = () => {
      window.clearTimeout(fallbackTimer);
      markLogoReady();
    };
    logoImage.onerror = () => {
      window.clearTimeout(fallbackTimer);
      markLogoReady();
    };
    logoImage.src = Logo1Dark;

    if (typeof logoImage.decode === 'function') {
      logoImage
        .decode()
        .then(() => {
          window.clearTimeout(fallbackTimer);
          markLogoReady();
        })
        .catch(() => {
          window.clearTimeout(fallbackTimer);
          markLogoReady();
        });
    }

    return () => {
      isMounted = false;
      window.clearTimeout(fallbackTimer);
    };
  }, []);

  useEffect(() => {
    if (!areAuthAnimationsEnabled()) return undefined;

    const audio = new Audio(authIntroAudioSrc);
    audio.preload = 'auto';
    audio.volume = AUTH_INTRO_AUDIO_VOLUME;
    introAudioRef.current = audio;
    audio.load();

    return () => {
      stopIntroAudio();
      introAudioRef.current = null;
    };
  }, [stopIntroAudio]);

  useLayoutEffect(() => {
    if (!isEntryAccountsReady) return;

    const globalMotionOverride =
      typeof document !== 'undefined'
        ? (document.getElementById(
            'hub-ui-animations-style'
          ) as HTMLStyleElement | null)
        : null;
    const wasGlobalMotionOverrideDisabled = globalMotionOverride?.disabled;
    if (hasAuthIntroPlayedThisSession || !areAuthAnimationsEnabled()) {
      setIntroStage('complete');
      return;
    }

    hasAuthIntroPlayedThisSession = true;

    // The dashboard UI Animations toggle injects a global transition killer.
    // If the user logs out, that style can still be mounted during auth.
    if (globalMotionOverride) {
      globalMotionOverrideRef.current = {
        element: globalMotionOverride,
        wasDisabled: wasGlobalMotionOverrideDisabled,
      };
      globalMotionOverride.disabled = true;
    }

    if (!prepareIntroMetrics()) {
      setIntroStage('complete');
      return;
    }

    setIntroStage('ready');

    return () => {
      restoreGlobalMotionOverride();
    };
  }, [isEntryAccountsReady]);

  useEffect(() => {
    if (introStage !== 'ready' || !isIntroLogoReady) return;

    let loadTimer = 0;
    let secondFrame = 0;
    let firstFrame = 0;
    const startIntro = () => {
      playIntroAudio();
      loadTimer = window.setTimeout(() => {
        firstFrame = window.requestAnimationFrame(() => {
          secondFrame = window.requestAnimationFrame(() => {
            setIntroStage('running');
          });
        });
      }, AUTH_INTRO_START_DELAY_MS);
    };

    if (document.readyState === 'complete') {
      startIntro();
    } else {
      window.addEventListener('load', startIntro, { once: true });
    }

    return () => {
      window.removeEventListener('load', startIntro);
      window.clearTimeout(loadTimer);
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [introStage, isIntroLogoReady, playIntroAudio]);

  useEffect(() => {
    if (introStage !== 'running') return;

    const settleTimer = window.setTimeout(() => {
      setIsLogoRingDownActive(true);
      setIntroStage('settling');
    }, AUTH_INTRO_MOVE_MS);

    return () => {
      window.clearTimeout(settleTimer);
    };
  }, [introStage]);

  useEffect(() => {
    if (!isLogoRingDownActive) return;

    const ringTimer = window.setTimeout(() => {
      setIsLogoRingDownActive(false);
    }, AUTH_INTRO_LOGO_RING_MS);

    return () => {
      window.clearTimeout(ringTimer);
    };
  }, [isLogoRingDownActive]);

  useEffect(() => {
    if (introStage !== 'settling') return;

    const completeTimer = window.setTimeout(() => {
      setIntroStage('complete');
      restoreGlobalMotionOverride();
    }, AUTH_INTRO_COMPLETE_DELAY_MS);

    return () => {
      window.clearTimeout(completeTimer);
    };
  }, [introStage, stopIntroAudio]);

  useEffect(() => {
    if (introStage !== 'running' && introStage !== 'settling') return;

    const completeIntroOnResize = () => {
      setIntroStage('complete');
      setIsLogoRingDownActive(false);
      restoreGlobalMotionOverride();
    };

    window.addEventListener('resize', completeIntroOnResize);

    return () => {
      window.removeEventListener('resize', completeIntroOnResize);
    };
  }, [introStage, stopIntroAudio]);

  return (
    <>
      <AuthFrame
        maxWidth={1160}
        disableInitialAnimation
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            opacity: isMainAuthContentVisible ? 1 : 0,
            textAlign: 'center',
            width: '100%',
            '@keyframes authIntroReveal': {
              from: {
                opacity: 0,
                transform: 'translateY(6px)',
              },
              to: {
                opacity: 1,
                transform: 'translateY(0)',
              },
            },
            '@keyframes authIntroCardReveal': {
              from: {
                opacity: 0,
              },
              to: {
                opacity: 1,
              },
            },
            '@keyframes authIntroLogoRing': {
              '0%': {
                filter: AUTH_INTRO_LOGO_FINAL_FILTER,
              },
              [AUTH_INTRO_LOGO_RING_PEAK_PERCENT]: {
                filter: AUTH_INTRO_LOGO_PEAK_FILTER,
              },
              '42%': {
                filter: AUTH_INTRO_LOGO_MID_RING_FILTER,
              },
              '76%': {
                filter: AUTH_INTRO_LOGO_LATE_RING_FILTER,
              },
              '100%': {
                filter: AUTH_INTRO_LOGO_FINAL_FILTER,
              },
            },
            '@keyframes authIntroLogoHaloRing': {
              '0%': {
                filter: 'blur(15px) brightness(1)',
                opacity: 0.76,
                transform: 'scale(1)',
              },
              [AUTH_INTRO_LOGO_RING_PEAK_PERCENT]: {
                filter: 'blur(15px) brightness(1.22)',
                opacity: 1,
                transform: 'scale(1.07)',
              },
              '42%': {
                filter: 'blur(15px) brightness(1.16)',
                opacity: 0.98,
                transform: 'scale(1.045)',
              },
              '76%': {
                filter: 'blur(15px) brightness(1.07)',
                opacity: 0.96,
                transform: 'scale(1.018)',
              },
              '100%': {
                filter: 'blur(15px) brightness(1)',
                opacity: 1,
                transform: 'scale(1)',
              },
            },
            '@keyframes authIntroOverlayLogoRing': {
              '0%': {
                filter: AUTH_INTRO_LOGO_SETTLING_FILTER,
                opacity: 1,
              },
              [AUTH_INTRO_LOGO_RING_PEAK_PERCENT]: {
                filter: AUTH_INTRO_LOGO_SETTLING_PEAK_FILTER,
                opacity: 0.94,
              },
              '42%': {
                filter: AUTH_INTRO_LOGO_SETTLING_MID_FILTER,
                opacity: 0.8,
              },
              '76%': {
                filter: AUTH_INTRO_LOGO_SETTLING_LATE_FILTER,
                opacity: 0.45,
              },
              '100%': {
                filter: AUTH_INTRO_LOGO_SETTLING_FILTER,
                opacity: 0,
              },
            },
          }}
        >
          <Box
            aria-hidden
            sx={{
              background: isLight
                ? 'radial-gradient(ellipse 430px 280px at 50% 22%, rgba(62,130,255,0.2), rgba(120,165,235,0.11) 34%, rgba(195,212,245,0.07) 62%, transparent 86%), radial-gradient(ellipse 610px 820px at 27% 52%, rgba(90,140,225,0.12), rgba(170,195,235,0.07) 38%, rgba(225,232,248,0.05) 64%, transparent 91%), radial-gradient(ellipse 610px 820px at 73% 52%, rgba(90,140,225,0.12), rgba(170,195,235,0.07) 38%, rgba(225,232,248,0.05) 64%, transparent 91%)'
                : 'radial-gradient(ellipse 430px 280px at 50% 22%, rgba(39,125,255,0.24), rgba(22,78,170,0.13) 34%, rgba(8,34,88,0.045) 62%, transparent 86%), radial-gradient(ellipse 610px 820px at 27% 52%, rgba(25,82,175,0.16), rgba(12,42,96,0.085) 38%, rgba(5,20,52,0.035) 64%, transparent 91%), radial-gradient(ellipse 610px 820px at 73% 52%, rgba(25,82,175,0.16), rgba(12,42,96,0.085) 38%, rgba(5,20,52,0.035) 64%, transparent 91%)',
              filter: 'blur(24px)',
              height: { xs: 880, md: 980 },
              left: '50%',
              opacity: 0.96,
              pointerEvents: 'none',
              position: 'absolute',
              top: { xs: '47%', md: '48%' },
              transform: 'translate(-50%, -50%)',
              width: { xs: 1180, md: 1500 },
              zIndex: 0,
            }}
          />
          <Box
            sx={{
              ...cardRevealSx(820),
              alignItems: 'center',
              background: isLight
                ? 'linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(249,251,255,0.97) 48%, rgba(242,246,252,0.99) 100%)'
                : 'linear-gradient(180deg, rgba(8,15,27,0.985) 0%, rgba(5,8,14,0.992) 54%, rgba(3,5,9,0.995) 100%)',
              border: isLight
                ? `1px solid ${theme.palette.border.subtle}`
                : '1px solid rgba(142,164,196,0.2)',
              borderRadius: '16px',
              boxShadow: isLight
                ? '0 22px 56px rgba(45, 72, 112, 0.09), 0 0 0 1px rgba(62,130,255,0.05), inset 0 1px 0 rgba(255,255,255,0.9)'
                : '0 28px 70px rgba(0,0,0,0.5), 0 0 46px rgba(28,86,178,0.1), inset 0 1px 0 rgba(255,255,255,0.04)',
              display: 'flex',
              flexDirection: 'column',
              maxWidth: 640,
              minHeight: { xs: 'auto', md: 560 },
              overflow: 'visible',
              px: { xs: 2.25, sm: 3.4 },
              py: { xs: 3.2, sm: 4.1 },
              position: 'relative',
              width: '100%',
              zIndex: 1,
              '&::before': {
                background: isLight
                  ? 'radial-gradient(ellipse 560px 310px at 50% -9%, rgba(62,130,255,0.2), rgba(130,170,235,0.12) 35%, rgba(200,218,248,0.08) 62%, transparent 90%)'
                  : 'radial-gradient(ellipse 560px 310px at 50% -9%, rgba(37,126,255,0.32), rgba(27,82,170,0.16) 35%, rgba(12,35,84,0.055) 62%, transparent 90%)',
                borderRadius: '16px',
                content: '""',
                inset: 0,
                opacity: introCardGlowOpacity,
                pointerEvents: 'none',
                position: 'absolute',
                transition: 'opacity 620ms cubic-bezier(0.4, 0, 0.2, 1)',
              },
              '&::after': {
                background: isLight
                  ? 'linear-gradient(180deg, rgba(255,255,255,0.72) 0%, rgba(228,238,252,0.48) 38%, rgba(210,228,252,0.32) 100%)'
                  : 'linear-gradient(180deg, rgba(224,238,255,0.54) 0%, rgba(158,188,231,0.3) 38%, rgba(123,145,174,0.2) 100%)',
                borderRadius: '16px',
                boxShadow: isLight
                  ? '0 0 28px rgba(62,130,255,0.1)'
                  : '0 0 20px rgba(81,137,239,0.12)',
                content: '""',
                inset: 0,
                maskComposite: 'exclude',
                padding: '1px',
                pointerEvents: 'none',
                position: 'absolute',
                WebkitMask:
                  'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
                WebkitMaskComposite: 'xor',
              },
            }}
          >
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                height: { xs: 78, md: 88 },
                justifyContent: 'center',
                mb: { xs: 3.2, md: 3.6 },
                mt: { xs: -10.2, md: -11.9 },
                position: 'relative',
                width: { xs: 94, md: 108 },
                zIndex: 1,
                '&::before': {
                  background: isLight
                    ? 'radial-gradient(circle at 50% 40%, rgba(62,140,255,0.35), rgba(100,160,245,0.18) 34%, rgba(180,205,245,0.1) 62%, transparent 88%)'
                    : 'radial-gradient(circle at 50% 40%, rgba(42,142,255,0.5), rgba(42,142,255,0.2) 34%, rgba(19,82,184,0.075) 62%, transparent 88%)',
                  content: '""',
                  filter: 'blur(15px)',
                  inset: '-46px',
                  opacity: introCardGlowOpacity,
                  pointerEvents: 'none',
                  position: 'absolute',
                  transform: 'scale(1)',
                  transformOrigin: 'center',
                  transition: 'opacity 620ms cubic-bezier(0.4, 0, 0.2, 1)',
                  animation:
                    isLogoRingDownActive
                      ? `authIntroLogoHaloRing ${AUTH_INTRO_LOGO_RING_MS}ms linear both`
                      : 'none',
                },
                '&::after': {
                  background: isLight
                    ? 'radial-gradient(ellipse 430px 260px at 50% 30%, rgba(62,130,255,0.16), rgba(120,165,230,0.1) 38%, rgba(200,218,248,0.06) 66%, transparent 92%)'
                    : 'radial-gradient(ellipse 430px 260px at 50% 30%, rgba(39,124,255,0.22), rgba(28,88,190,0.12) 38%, rgba(10,40,105,0.045) 66%, transparent 92%)',
                  content: '""',
                  filter: 'blur(14px)',
                  height: 320,
                  left: '50%',
                  opacity: introCardGlowOpacity,
                  pointerEvents: 'none',
                  position: 'absolute',
                  top: -30,
                  transform: 'translateX(-50%)',
                  transition: 'opacity 620ms cubic-bezier(0.4, 0, 0.2, 1)',
                  width: 560,
                  zIndex: -1,
                },
              }}
            >
              <Box
                component="img"
                ref={logoRef}
                alt="Qortal"
                data-auth-logo-target="entry-logo"
                src={Logo1Dark}
                sx={{
                  animation:
                    isLogoRingDownActive
                      ? `authIntroLogoRing ${AUTH_INTRO_LOGO_RING_MS}ms linear both`
                      : 'none',
                  display: 'block',
                  filter: AUTH_INTRO_LOGO_FINAL_FILTER,
                  height: { xs: 94, md: 108 },
                  opacity:
                    introStage === 'settling' || introComplete ? 1 : 0,
                  position: 'relative',
                  transition:
                    'opacity 220ms cubic-bezier(0.4, 0, 0.2, 1), filter 620ms cubic-bezier(0.4, 0, 0.2, 1)',
                  width: { xs: 94, md: 108 },
                  zIndex: 1,
                }}
              />
            </Box>

            <Box
              sx={{
                ...revealSx(930),
                position: 'relative',
                zIndex: 1,
              }}
            >
              <Typography
                sx={{
                  color: theme.palette.text.primary,
                  fontSize: { xs: '1.88rem', md: '2.2rem' },
                  fontWeight: 800,
                  letterSpacing: '-0.03em',
                  lineHeight: 1.05,
                  textShadow: isLight
                    ? '0 1px 0 rgba(255,255,255,0.85)'
                    : '0 2px 18px rgba(0,0,0,0.28)',
                }}
              >
                {t('auth:entry.title')}
              </Typography>

              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: '0.95rem',
                  lineHeight: 1.55,
                  mt: 0.8,
                }}
              >
                {t('auth:entry.subtitle')}
              </Typography>
            </Box>

            <Box
              sx={{
                ...revealSx(1030),
                display: 'flex',
                flexDirection: 'column',
                gap: 1.2,
                mt: 2.9,
                opacity: isUnlockLeaving ? 0 : 1,
                pointerEvents: isUnlockLeaving ? 'none' : 'auto',
                position: 'relative',
                textAlign: 'left',
                transition: 'opacity 180ms cubic-bezier(0.4, 0, 0.2, 1)',
                width: '100%',
                zIndex: 1,
              }}
            >
              {hasAccountsText}
            </Box>

            <Box
              sx={{
                ...revealSx(1130),
                display: 'flex',
                flexDirection: 'column',
                gap: 1.25,
                mt: 2.3,
                opacity: isUnlockLeaving ? 0 : 1,
                position: 'relative',
                transition: 'opacity 180ms cubic-bezier(0.4, 0, 0.2, 1)',
                width: '100%',
                zIndex: 1,
              }}
            >
              <AuthButton
                onClick={() => {
                  setIsLogoRingDownActive(false);
                  stopIntroAudio();
                  setExtstate('create-wallet');
                }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'inline-flex',
                    gap: 0.8,
                  }}
                >
                  <AddRoundedIcon sx={{ fontSize: 18 }} />
                  <span>{t('auth:entry.create_account')}</span>
                </Box>
              </AuthButton>

              <ButtonBase
                onClick={() => {
                  setIsLogoRingDownActive(false);
                  stopIntroAudio();
                  setExtstate('wallets');
                }}
                sx={{
                  alignItems: 'center',
                  border: isLight
                    ? `1px solid ${theme.palette.border.main}`
                    : '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  color: theme.palette.text.primary,
                  display: 'inline-flex',
                  gap: 0.8,
                  height: 42,
                  justifyContent: 'center',
                  transition:
                    'background-color 160ms ease, border-color 160ms ease',
                  width: '100%',
                  '&:hover': {
                    backgroundColor: isLight
                      ? theme.palette.action.hover
                      : 'rgba(255,255,255,0.035)',
                    borderColor: isLight
                      ? theme.palette.border.main
                      : 'rgba(255,255,255,0.15)',
                  },
                }}
              >
                <DownloadRoundedIcon sx={{ fontSize: 18 }} />
                <Typography
                  sx={{
                    fontSize: '0.92rem',
                    fontSynthesis: 'none',
                    fontWeight: 500,
                    letterSpacing: 0,
                    lineHeight: 1,
                    textRendering: 'geometricPrecision',
                    WebkitFontSmoothing: 'antialiased',
                  }}
                >
                  {t('auth:entry.import_account')}
                </Typography>
              </ButtonBase>
            </Box>

            <Box
              sx={{
                ...revealSx(1230),
                alignItems: 'center',
                color: theme.palette.text.secondary,
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                gap: { xs: 0.7, sm: 3.1 },
                justifyContent: 'center',
                mt: 1.75,
                opacity: isUnlockLeaving ? 0 : 1,
                position: 'relative',
                transition: 'opacity 180ms cubic-bezier(0.4, 0, 0.2, 1)',
                zIndex: 1,
              }}
            >
              <Box
                sx={{ alignItems: 'center', display: 'inline-flex', gap: 0.9 }}
              >
                <Box
                  sx={{
                    backgroundColor: usingLocalNode
                      ? theme.palette.other.positive
                      : selectedNode?.url === HTTPS_EXT_NODE_QORTAL_LINK
                        ? theme.palette.primary.main
                        : '#D8BA8A',
                    borderRadius: '999px',
                    height: 7,
                    width: 7,
                  }}
                />
                <Typography
                  sx={{
                    fontSize: '0.8rem',
                    fontWeight: 500,
                    lineHeight: 1,
                  }}
                >
                  {connectionLabel}
                </Typography>
              </Box>
              <Box
                sx={{
                  backgroundColor: isLight
                    ? theme.palette.divider
                    : 'rgba(255,255,255,0.14)',
                  display: { xs: 'none', sm: 'block' },
                  height: 22,
                  width: '1px',
                }}
              />
              <ButtonBase
                onClick={() => setIsConnectionModeOpen(true)}
                sx={{
                  alignItems: 'center',
                  color: theme.palette.text.secondary,
                  display: 'inline-flex',
                  gap: 0.8,
                  minWidth: 0,
                  p: 0,
                  '&:hover': {
                    color: theme.palette.text.primary,
                  },
                }}
              >
                <CodeRoundedIcon sx={{ fontSize: 14 }} />
                <Typography
                  sx={{
                    fontSize: '0.8rem',
                    fontWeight: 500,
                    lineHeight: 1,
                  }}
                >
                  {t('auth:connection_mode.title')}
                </Typography>
              </ButtonBase>
            </Box>
          </Box>

          <Box
            sx={{
              ...revealSx(1330),
              display: { xs: 'none', md: 'grid' },
              gap: 6.5,
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              maxWidth: 1120,
              mt: 5.8,
              width: '100%',
            }}
          >
            {featureItems.map((item) => (
              <Box
                key={item.id}
                sx={{
                  alignItems: 'flex-start',
                  display: 'grid',
                  gap: 1.8,
                  gridTemplateColumns: '50px minmax(0,1fr)',
                  textAlign: 'left',
                }}
              >
                <Box sx={{ color: theme.palette.primary.main, pt: 0.1 }}>
                  {item.icon}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{
                      color: theme.palette.text.primary,
                      fontSize: '1rem',
                      fontWeight: 800,
                      lineHeight: 1.25,
                    }}
                  >
                    {item.title}
                  </Typography>
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '0.9rem',
                      lineHeight: 1.45,
                      mt: 0.45,
                    }}
                  >
                    {item.text}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      </AuthFrame>

      {shouldRenderIntroOverlay && introMetrics && (
        <Box
          aria-hidden
          sx={{
            backgroundColor: isIntroOverlayAtRest
              ? 'transparent'
              : isLight
                ? 'rgba(247,249,252,1)'
                : 'rgba(6,8,13,1)',
            inset: 0,
            pointerEvents: 'none',
            position: 'fixed',
            transition: isLogoAnimating
              ? 'background-color 420ms cubic-bezier(0.4, 0, 0.2, 1) 840ms'
              : 'none',
            zIndex: 5000,
          }}
        >
          <Box
            component="img"
            alt=""
            src={Logo1Dark}
            sx={{
              animation:
                isLogoRingDownActive
                  ? `authIntroOverlayLogoRing ${AUTH_INTRO_LOGO_RING_MS}ms linear both`
                  : 'none',
              display: 'block',
              filter:
                introStage === 'settling'
                  ? AUTH_INTRO_LOGO_SETTLING_FILTER
                  : introStage === 'running'
                    ? 'brightness(0.88) contrast(0.99) saturate(0.96)'
                    : 'brightness(0.78) contrast(0.96) saturate(0.92)',
              height: isIntroOverlayAtRest
                ? introMetrics.finalHeight
                : introMetrics.initialHeight,
              left: isIntroOverlayAtRest
                ? introMetrics.finalLeft
                : introMetrics.initialLeft,
              position: 'fixed',
              top:
                introStage === 'running'
                  ? introMetrics.overshootTop
                  : isIntroOverlayAtRest
                    ? introMetrics.finalTop
                    : introMetrics.initialTop,
              transition:
                introStage === 'running'
                  ? `top ${AUTH_INTRO_MOVE_MS}ms cubic-bezier(0.4, 0, 0.2, 1), left ${AUTH_INTRO_MOVE_MS}ms cubic-bezier(0.4, 0, 0.2, 1), width ${AUTH_INTRO_MOVE_MS}ms cubic-bezier(0.4, 0, 0.2, 1), height ${AUTH_INTRO_MOVE_MS}ms cubic-bezier(0.4, 0, 0.2, 1), filter 260ms cubic-bezier(0.4, 0, 0.2, 1)`
                  : introStage === 'settling'
                    ? `top ${AUTH_INTRO_SETTLE_MS}ms ${AUTH_INTRO_SETTLE_EASING}, filter ${AUTH_INTRO_COMPLETE_DELAY_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`
                    : 'none',
              width: isIntroOverlayAtRest
                ? introMetrics.finalWidth
                : introMetrics.initialWidth,
            }}
          />
        </Box>
      )}

      <ConnectionModeModal
        open={isConnectionModeOpen}
        onClose={() => setIsConnectionModeOpen(false)}
      />
    </>
  );
};
