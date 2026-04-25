import { Box, ButtonBase, Typography, useTheme } from '@mui/material';
import SettingsEthernetRoundedIcon from '@mui/icons-material/SettingsEthernetRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import Logo1Dark from '../assets/svgs/Logo1Dark.svg';
import { useAtomValue } from 'jotai';
import { selectedNodeInfoAtom } from '../atoms/global';
import { isLocalNodeUrl } from '../constants/constants';
import { Wallets } from './Wallets';
import { AuthButton, AuthFrame } from './Auth/AuthShell';
import { ConnectionModeModal } from './Auth/ConnectionModeModal';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
const AUTH_INTRO_SETTLE_EASING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
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
  const selectedNode = useAtomValue(selectedNodeInfoAtom);
  const [isConnectionModeOpen, setIsConnectionModeOpen] = useState(false);
  const [isEntryAccountsReady, setIsEntryAccountsReady] = useState(false);
  const [isUnlockLeaving, setIsUnlockLeaving] = useState(false);
  const logoRef = useRef<HTMLImageElement | null>(null);
  const globalMotionOverrideRef = useRef<{
    element: HTMLStyleElement;
    wasDisabled?: boolean;
  } | null>(null);
  const [isIntroLogoReady, setIsIntroLogoReady] = useState(false);
  const [introMetrics, setIntroMetrics] = useState<IntroLogoMetrics | null>(null);
  const [introStage, setIntroStage] = useState<IntroStage>('pending');
  const usingLocalNode = isLocalNodeUrl(selectedNode?.url);
  const handleEntryAccountsReady = useCallback(() => {
    setIsEntryAccountsReady(true);
  }, []);
  const handleWalletUnlockStart = useCallback(
    (snapshot: AuthUnlockTransitionSnapshot) => {
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
  const shouldAnimateIntro = !introComplete;
  const isLogoAnimating =
    introStage === 'running' || introStage === 'settling';
  const isMainAuthContentVisible = introComplete || isLogoAnimating;
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
    const initialWidth = rect.width * 1.2;
    const initialHeight = rect.height * 1.2;
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
      loadTimer = window.setTimeout(() => {
        firstFrame = window.requestAnimationFrame(() => {
          secondFrame = window.requestAnimationFrame(() => {
            setIntroStage('running');
          });
        });
      }, 560);
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
  }, [introStage, isIntroLogoReady]);

  useEffect(() => {
    if (introStage !== 'running') return;

    const settleTimer = window.setTimeout(() => {
      setIntroStage('settling');
    }, 860);

    return () => {
      window.clearTimeout(settleTimer);
    };
  }, [introStage]);

  useEffect(() => {
    if (introStage !== 'settling') return;

    const completeTimer = window.setTimeout(() => {
      setIntroStage('complete');
      restoreGlobalMotionOverride();
    }, 280);

    return () => {
      window.clearTimeout(completeTimer);
    };
  }, [introStage]);

  useEffect(() => {
    if (introStage !== 'running' && introStage !== 'settling') return;

    const completeIntroOnResize = () => {
      setIntroStage('complete');
      restoreGlobalMotionOverride();
    };

    window.addEventListener('resize', completeIntroOnResize);

    return () => {
      window.removeEventListener('resize', completeIntroOnResize);
    };
  }, [introStage]);

  return (
    <>
      <AuthFrame
        maxWidth={560}
        disableInitialAnimation
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            opacity: isMainAuthContentVisible ? 1 : 0,
            textAlign: 'center',
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
          }}
        >
          <Box
            component="img"
            ref={logoRef}
            alt="Qortal"
            data-auth-logo-target="entry-logo"
            src={Logo1Dark}
            sx={{
              display: 'block',
              filter: 'brightness(1.08) contrast(1.02)',
              height: { xs: 98, md: 110 },
              mb: 2.7,
              mt: { xs: -2, md: -4 },
              opacity: introComplete ? 1 : 0,
              width: { xs: 98, md: 110 },
            }}
          />

          <Box sx={revealSx(930)}>
            <Typography
              sx={{
                fontSize: { xs: '2rem', md: '2.3rem' },
                fontWeight: 700,
                letterSpacing: '-0.04em',
                lineHeight: 1.02,
              }}
            >
              Enter Qortal
            </Typography>

            <Typography
              sx={{
                color: 'rgba(214,221,233,0.58)',
                fontSize: '0.96rem',
                lineHeight: 1.65,
                mt: 1,
              }}
            >
              Access or create your account.
            </Typography>
          </Box>

          <Box
            sx={{
              ...revealSx(1030),
              display: 'flex',
              flexDirection: 'column',
              gap: 1.2,
              mt: 5.4,
              textAlign: 'left',
              width: '100%',
            }}
          >
            {hasAccountsText}
          </Box>

          <Box
            sx={{
              ...revealSx(1130),
              display: 'flex',
              flexDirection: 'column',
              gap: 0.8,
              mt: 3.7,
              opacity: isUnlockLeaving ? 0 : 1,
              pt: 1.1,
              transition: 'opacity 180ms cubic-bezier(0.4, 0, 0.2, 1)',
              width: '100%',
            }}
          >
            <AuthButton onClick={() => setExtstate('create-wallet')}>
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'inline-flex',
                  gap: 0.8,
                }}
              >
                <AddRoundedIcon sx={{ fontSize: 18 }} />
                <span>Create account</span>
              </Box>
            </AuthButton>

            <ButtonBase
              onClick={() => setExtstate('wallets')}
              sx={{
                alignItems: 'center',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '8px',
                color: theme.palette.text.primary,
                display: 'inline-flex',
                gap: 0.8,
                height: 42,
                justifyContent: 'center',
                transition: 'background-color 160ms ease, border-color 160ms ease',
                width: '100%',
                '&:hover': {
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  borderColor: 'rgba(255,255,255,0.12)',
                },
              }}
            >
              <DownloadRoundedIcon sx={{ fontSize: 18 }} />
              <Typography sx={{ fontSize: '0.92rem', fontWeight: 700 }}>
                Import account
              </Typography>
            </ButtonBase>
          </Box>

          <Box
            sx={{
              ...revealSx(1230),
              alignItems: 'center',
              color: 'rgba(214,221,233,0.5)',
              display: 'flex',
              flexDirection: 'column',
              gap: 0.45,
              justifyContent: 'center',
              mt: 1.6,
              opacity: isUnlockLeaving ? 0 : 1,
              transition: 'opacity 180ms cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            <Box sx={{ alignItems: 'center', display: 'inline-flex', gap: 0.7 }}>
              <Box
                sx={{
                  backgroundColor: usingLocalNode
                    ? theme.palette.other.positive
                    : theme.palette.primary.main,
                  borderRadius: '999px',
                  height: 7,
                  width: 7,
                }}
              />
              <Typography sx={{ fontSize: '0.78rem', fontWeight: 600 }}>
                {usingLocalNode ? 'Using local node' : 'Using public node'}
              </Typography>
            </Box>
            <ButtonBase
              onClick={() => setIsConnectionModeOpen(true)}
              sx={{
                alignItems: 'center',
                color: 'rgba(214,221,233,0.42)',
                display: 'inline-flex',
                gap: 0.4,
                minWidth: 0,
                p: 0,
                '&:hover': {
                  color: 'rgba(214,221,233,0.66)',
                },
              }}
            >
              <SettingsEthernetRoundedIcon sx={{ fontSize: 14 }} />
              <Typography sx={{ fontSize: '0.74rem', fontWeight: 600 }}>
                Connection Mode
              </Typography>
            </ButtonBase>
          </Box>
        </Box>
      </AuthFrame>

      {shouldAnimateIntro && introMetrics && (
        <Box
          aria-hidden
          sx={{
            backgroundColor: isLogoAnimating
              ? 'rgba(6,8,13,0)'
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
              display: 'block',
              filter: 'brightness(1.08) contrast(1.02)',
              height: isLogoAnimating
                ? introMetrics.finalHeight
                : introMetrics.initialHeight,
              left: isLogoAnimating
                ? introMetrics.finalLeft
                : introMetrics.initialLeft,
              position: 'fixed',
              top:
                introStage === 'running'
                  ? introMetrics.overshootTop
                  : isLogoAnimating
                    ? introMetrics.finalTop
                    : introMetrics.initialTop,
              transition:
                introStage === 'running'
                  ? 'top 860ms cubic-bezier(0.4, 0, 0.2, 1), left 860ms cubic-bezier(0.4, 0, 0.2, 1), width 860ms cubic-bezier(0.4, 0, 0.2, 1), height 860ms cubic-bezier(0.4, 0, 0.2, 1)'
                  : introStage === 'settling'
                    ? `top 260ms ${AUTH_INTRO_SETTLE_EASING}`
                    : 'none',
              width: isLogoAnimating
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
