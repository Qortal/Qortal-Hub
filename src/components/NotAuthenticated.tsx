import { Box, ButtonBase, Typography, useTheme } from '@mui/material';
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import AccountCircleRoundedIcon from '@mui/icons-material/AccountCircleRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import HubRoundedIcon from '@mui/icons-material/HubRounded';
import SecurityRoundedIcon from '@mui/icons-material/SecurityRounded';
import Logo1Dark from '../assets/svgs/Logo1Dark.svg';
import { useAtomValue } from 'jotai';
import { selectedNodeInfoAtom } from '../atoms/global';
import {
  HTTPS_EXT_NODE_QORTAL_LINK,
  isLocalNodeUrl,
} from '../constants/constants';
import { Wallets } from './Wallets';
import { AuthButton, AuthFrame } from './Auth/AuthShell';
import {
  AuthGlowDebugPanel,
  buildAuthCardGlowBackground,
  buildAuthEdgeGradient,
  loadAuthGlowSettings,
  rgbaFromHex,
  type AuthGlowSettings,
} from './Auth/AuthGlowDebugPanel';
import { ConnectionModeModal } from './Auth/ConnectionModeModal';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  const [authGlowSettings, setAuthGlowSettings] = useState<AuthGlowSettings>(
    () => loadAuthGlowSettings()
  );
  const usingLocalNode = isLocalNodeUrl(selectedNode?.url);
  const connectionLabel = usingLocalNode
    ? 'Using local node'
    : selectedNode?.url === HTTPS_EXT_NODE_QORTAL_LINK
      ? 'Using public node'
      : 'Using custom node';
  const featureItems = [
    {
      icon: <SecurityRoundedIcon sx={{ fontSize: 34 }} />,
      title: 'Secure & Private',
      text: 'Your keys, your data, always in your control.',
    },
    {
      icon: <BoltRoundedIcon sx={{ fontSize: 34 }} />,
      title: 'Fast Access',
      text: 'Unlock and get to your Qortal experience instantly.',
    },
    {
      icon: <HubRoundedIcon sx={{ fontSize: 34 }} />,
      title: 'Decentralized',
      text: 'Connect to the network on your terms.',
    },
    {
      icon: <AccountCircleRoundedIcon sx={{ fontSize: 34 }} />,
      title: 'Built for You',
      text: 'One account. Endless possibilities.',
    },
  ];
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
  const introCardGlowOpacity =
    introComplete ? 1 : introStage === 'settling' ? 0.76 : 0;
  const introLogoGlowOpacity =
    introComplete ? 1 : introStage === 'settling' ? 0.82 : 0;
  const introAmbientOpacity =
    introComplete ? 0.72 : introStage === 'settling' ? 0.52 : 0;
  const authCardGlowBackground = useMemo(
    () => buildAuthCardGlowBackground(authGlowSettings),
    [authGlowSettings]
  );
  const authCardEdgeGradient = useMemo(
    () => buildAuthEdgeGradient(authGlowSettings),
    [authGlowSettings]
  );
  const authCardEdgeGlow = useMemo(
    () =>
      `0 0 18px ${rgbaFromHex(
        authGlowSettings.edgeCenterColor,
        authGlowSettings.edgeGlowIntensity * 0.34
      )}`,
    [authGlowSettings.edgeCenterColor, authGlowSettings.edgeGlowIntensity]
  );
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
    }, 620);

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
          }}
        >
          <Box
            aria-hidden
            sx={{
              background:
                'radial-gradient(ellipse 700px 430px at 50% 27%, rgba(48,130,255,0.22), rgba(30,86,170,0.12) 32%, transparent 66%)',
              inset: 0,
              opacity: introAmbientOpacity,
              pointerEvents: 'none',
              position: 'fixed',
              transition: 'opacity 620ms cubic-bezier(0.4, 0, 0.2, 1)',
              zIndex: 0,
            }}
          />
          <Box
            sx={{
              ...cardRevealSx(820),
              alignItems: 'center',
              background:
                'linear-gradient(180deg, rgba(12,24,42,0.99) 0%, rgba(7,12,21,0.99) 48%, rgba(4,7,12,0.99) 100%)',
              border: '1px solid rgba(154,181,224,0.28)',
              borderRadius: '16px',
              boxShadow:
                '0 26px 62px rgba(0,0,0,0.46), 0 0 0 1px rgba(79,132,224,0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
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
                background: authCardGlowBackground,
                borderRadius: '16px',
                content: '""',
                inset: 0,
                opacity: introCardGlowOpacity,
                pointerEvents: 'none',
                position: 'absolute',
                transition: 'opacity 620ms cubic-bezier(0.4, 0, 0.2, 1)',
              },
              '&::after': {
                background: authCardEdgeGradient,
                borderRadius: '16px',
                boxShadow: authCardEdgeGlow,
                content: '""',
                inset: 0,
                maskComposite: 'exclude',
                opacity: authGlowSettings.edgeGlowIntensity,
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
                  background:
                    'radial-gradient(circle, rgba(41,137,255,0.58), rgba(41,137,255,0.24) 38%, transparent 70%)',
                  content: '""',
                  filter: 'blur(8px)',
                  inset: '-26px',
                  opacity: introLogoGlowOpacity,
                  pointerEvents: 'none',
                  position: 'absolute',
                  transition: 'opacity 620ms cubic-bezier(0.4, 0, 0.2, 1)',
                },
                '&::after': {
                  background:
                    'radial-gradient(ellipse at 50% 76%, rgba(55,135,255,0.2), rgba(55,135,255,0.08) 42%, transparent 70%)',
                  content: '""',
                  height: 72,
                  left: '50%',
                  opacity: introLogoGlowOpacity,
                  pointerEvents: 'none',
                  position: 'absolute',
                  top: 44,
                  transform: 'translateX(-50%)',
                  transition: 'opacity 620ms cubic-bezier(0.4, 0, 0.2, 1)',
                  width: 280,
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
                  display: 'block',
                  filter:
                    'brightness(1.2) contrast(1.05) saturate(1.08) drop-shadow(0 0 18px rgba(34,132,255,0.32))',
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
                  color: '#F8FBFF',
                  fontSize: { xs: '1.88rem', md: '2.2rem' },
                  fontWeight: 800,
                  letterSpacing: '-0.03em',
                  lineHeight: 1.05,
                  textShadow: '0 2px 18px rgba(0,0,0,0.28)',
                }}
              >
                Enter Qortal
              </Typography>

              <Typography
                sx={{
                  color: 'rgba(214,221,233,0.64)',
                  fontSize: '0.95rem',
                  lineHeight: 1.55,
                  mt: 0.8,
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
                mt: 2.9,
                position: 'relative',
                textAlign: 'left',
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
                  border: '1px solid rgba(255,255,255,0.1)',
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
                    backgroundColor: 'rgba(255,255,255,0.035)',
                    borderColor: 'rgba(255,255,255,0.15)',
                  },
                }}
              >
                <DownloadRoundedIcon sx={{ fontSize: 18 }} />
                <Typography sx={{ fontSize: '0.92rem', fontWeight: 600 }}>
                  Import account
                </Typography>
              </ButtonBase>
            </Box>

            <Box
              sx={{
                ...revealSx(1230),
                alignItems: 'center',
                color: 'rgba(214,221,233,0.68)',
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
                <Typography sx={{ fontSize: '0.8rem', fontWeight: 600 }}>
                  {connectionLabel}
                </Typography>
              </Box>
              <Box
                sx={{
                  backgroundColor: 'rgba(255,255,255,0.14)',
                  display: { xs: 'none', sm: 'block' },
                  height: 22,
                  width: '1px',
                }}
              />
              <ButtonBase
                onClick={() => setIsConnectionModeOpen(true)}
                sx={{
                  alignItems: 'center',
                  color: 'rgba(214,221,233,0.66)',
                  display: 'inline-flex',
                  gap: 0.8,
                  minWidth: 0,
                  p: 0,
                  '&:hover': {
                    color: 'rgba(214,221,233,0.78)',
                  },
                }}
              >
                <CodeRoundedIcon sx={{ fontSize: 13 }} />
                <Typography sx={{ fontSize: '0.74rem', fontWeight: 600 }}>
                  Connection Mode
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
                key={item.title}
                sx={{
                  alignItems: 'flex-start',
                  display: 'grid',
                  gap: 1.8,
                  gridTemplateColumns: '50px minmax(0,1fr)',
                  textAlign: 'left',
                }}
              >
                <Box sx={{ color: '#3E82FF', pt: 0.1 }}>
                  {item.icon}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{
                      color: 'rgba(198,219,255,0.84)',
                      fontSize: '1rem',
                      fontWeight: 800,
                      lineHeight: 1.25,
                    }}
                  >
                    {item.title}
                  </Typography>
                  <Typography
                    sx={{
                      color: 'rgba(214,221,233,0.56)',
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
              filter:
                introStage === 'settling'
                  ? 'brightness(1.2) contrast(1.05) saturate(1.08) drop-shadow(0 0 18px rgba(34,132,255,0.32))'
                  : introStage === 'running'
                    ? 'brightness(0.88) contrast(0.99) saturate(0.96) drop-shadow(0 0 4px rgba(34,132,255,0.08))'
                    : 'brightness(0.78) contrast(0.96) saturate(0.92)',
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
                  ? 'top 860ms cubic-bezier(0.4, 0, 0.2, 1), left 860ms cubic-bezier(0.4, 0, 0.2, 1), width 860ms cubic-bezier(0.4, 0, 0.2, 1), height 860ms cubic-bezier(0.4, 0, 0.2, 1), filter 260ms cubic-bezier(0.4, 0, 0.2, 1)'
                  : introStage === 'settling'
                    ? `top 300ms ${AUTH_INTRO_SETTLE_EASING}, filter 620ms cubic-bezier(0.4, 0, 0.2, 1)`
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
      <AuthGlowDebugPanel
        settings={authGlowSettings}
        onChange={setAuthGlowSettings}
      />
    </>
  );
};
