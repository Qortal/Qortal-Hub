import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Avatar, Box, ButtonBase, Divider, Typography, useTheme } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import SettingsEthernetRoundedIcon from '@mui/icons-material/SettingsEthernetRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useAtom } from 'jotai';
import { authenticatePasswordAtom } from '../atoms/global';
import { PasswordField, ErrorText } from './index';
import type { ApiKey } from '../types/auth';
import { getBaseApiReactForAvatar } from '../App';
import { getPrimaryNameForAvatar } from './Group/groupApi';
import { AuthButton, AuthFrame } from './Auth/AuthShell';
import {
  HTTPS_EXT_NODE_QORTAL_LINK,
  isLocalNodeUrl,
} from '../constants/constants';
import { ConnectionModeModal } from './Auth/ConnectionModeModal';
import type {
  AuthUnlockTransitionSnapshot,
  SharedElementRect,
} from '../types/authTransition';

type RawWallet = {
  name?: string;
  filename?: string;
  address0?: string;
};

type AuthenticationFormProps = {
  rawWallet: RawWallet;
  selectedNode: ApiKey | null;
  walletToBeDecryptedError: string;
  unlockTransition?: AuthUnlockTransitionSnapshot | null;
  onBack: () => void;
  onAuthenticate: () => Promise<void>;
  onUnlockTransitionComplete?: () => void;
};

const shortenAddress = (address?: string) => {
  if (!address) return '';
  if (address.length <= 20) return address;
  return `${address.slice(0, 8)}...${address.slice(-8)}`;
};

const isAddressLikeLabel = (value?: string, walletAddress?: string) => {
  const trimmedValue = value?.trim();
  const trimmedWalletAddress = walletAddress?.trim();
  if (!trimmedValue) return false;
  if (trimmedWalletAddress && trimmedValue === trimmedWalletAddress) return true;
  return /^Q[a-zA-Z0-9]{24,}$/.test(trimmedValue) && !trimmedValue.includes(' ');
};

const parsefilenameQortal = (filename?: string) => {
  if (!filename) return '';
  return filename.startsWith('qortal_backup_') ? filename.slice(14) : filename;
};

export const AuthenticationForm = ({
  rawWallet,
  selectedNode,
  walletToBeDecryptedError,
  unlockTransition,
  onBack,
  onAuthenticate,
  onUnlockTransitionComplete,
}: AuthenticationFormProps) => {
  const theme = useTheme();
  const [authenticatePassword, setAuthenticatePassword] = useAtom(
    authenticatePasswordAtom
  );
  const passwordRef = useRef<HTMLInputElement>(null);
  const avatarRef = useRef<HTMLDivElement | null>(null);
  const initialPrimaryNameRef = useRef({
    address: unlockTransition?.walletAddress,
    name: unlockTransition?.primaryName ?? null,
  });
  const [primaryName, setPrimaryName] = useState<string | null>(
    initialPrimaryNameRef.current.address === rawWallet?.address0
      ? initialPrimaryNameRef.current.name
      : null
  );
  const [isConnectionModeOpen, setIsConnectionModeOpen] = useState(false);
  const [sharedTransition, setSharedTransition] = useState<{
    isRunning: boolean;
    snapshot: AuthUnlockTransitionSnapshot;
    targetAvatarRect: SharedElementRect;
  } | null>(null);

  useEffect(() => {
    if (!rawWallet?.address0) {
      setPrimaryName(null);
      return;
    }

    const seededPrimaryName =
      initialPrimaryNameRef.current.address === rawWallet.address0
        ? initialPrimaryNameRef.current.name
        : null;

    if (seededPrimaryName) {
      setPrimaryName(seededPrimaryName);
      return;
    }

    setPrimaryName(null);
    let isMounted = true;
    getPrimaryNameForAvatar(rawWallet.address0)
      .then((name) => {
        if (isMounted) setPrimaryName(name || null);
      })
      .catch(() => {
        if (isMounted) setPrimaryName(null);
      });

    return () => {
      isMounted = false;
    };
  }, [rawWallet?.address0]);

  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

  const avatarSrc = primaryName
    ? `${getBaseApiReactForAvatar()}/arbitrary/THUMBNAIL/${primaryName}/qortal_avatar?async=true`
    : undefined;
  const walletAddress = rawWallet?.address0?.trim() || '';
  const addressLabel = shortenAddress(walletAddress);
  const parsedFilenameLabel = parsefilenameQortal(rawWallet?.filename).trim();
  const preferredIdentityLabel =
    primaryName?.trim() || rawWallet?.name?.trim() || parsedFilenameLabel || '';
  const displayLabel = preferredIdentityLabel || addressLabel || 'Unnamed account';
  const titleLabel = isAddressLikeLabel(displayLabel, walletAddress)
    ? addressLabel || 'Unnamed account'
    : displayLabel;
  const usingLocalNode = isLocalNodeUrl(selectedNode?.url);
  const connectionLabel = usingLocalNode
    ? 'Using local node'
    : selectedNode?.url === HTTPS_EXT_NODE_QORTAL_LINK
      ? 'Using public node'
      : 'Using custom node';
  const isSharedTransitionActive = Boolean(sharedTransition);
  const storedAnimationPreference =
    typeof window !== 'undefined'
      ? window.localStorage.getItem('hub_ui_animations_enabled')
      : null;
  const shouldReduceMotion =
    typeof window !== 'undefined' &&
    (storedAnimationPreference === 'false' ||
      (storedAnimationPreference === null &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches));

  useLayoutEffect(() => {
    if (
      !unlockTransition ||
      shouldReduceMotion ||
      !avatarRef.current
    ) {
      return;
    }

    const rectToObject = (rect: DOMRect) => ({
      height: rect.height,
      left: rect.left,
      top: rect.top,
      width: rect.width,
    });

    setSharedTransition({
      isRunning: false,
      snapshot: unlockTransition,
      targetAvatarRect: rectToObject(avatarRef.current.getBoundingClientRect()),
    });

    let firstFrame = 0;
    let secondFrame = 0;
    const finishTimer = window.setTimeout(() => {
      setSharedTransition(null);
      onUnlockTransitionComplete?.();
    }, 430);

    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setSharedTransition((current) =>
          current ? { ...current, isRunning: true } : current
        );
      });
    });

    return () => {
      window.clearTimeout(finishTimer);
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [onUnlockTransitionComplete, shouldReduceMotion, unlockTransition]);

  const avatarSharedOpacitySx = {
    opacity: isSharedTransitionActive ? 0 : 1,
    transition: 'none',
  };
  const revealFormSx = unlockTransition
    ? {
        animation:
          'authUnlockFormReveal 320ms cubic-bezier(0.4, 0, 0.2, 1) 110ms both',
      }
    : {};

  return (
    <>
      <AuthFrame maxWidth={402} disableInitialAnimation>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
            '@keyframes authUnlockFormReveal': {
              from: {
                opacity: 0,
                transform: 'translateY(5px)',
              },
              to: {
                opacity: 1,
                transform: 'translateY(0)',
              },
            },
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'flex-start', width: '100%' }}>
            <ButtonBase
              onClick={onBack}
              sx={{
                alignItems: 'center',
                color: 'rgba(214,221,233,0.7)',
                display: 'inline-flex',
                height: 32,
                justifyContent: 'center',
                minWidth: 0,
                width: 32,
                '&:hover': {
                  color: theme.palette.text.primary,
                },
              }}
            >
              <ArrowBackRoundedIcon sx={{ fontSize: 28 }} />
            </ButtonBase>
          </Box>

          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: 0.6,
              mt: 1.1,
              textAlign: 'center',
            }}
          >
            <Avatar
              ref={avatarRef}
              alt={displayLabel}
              src={avatarSrc}
              sx={{ height: 84, width: 84, ...avatarSharedOpacitySx }}
            >
              <PersonIcon sx={{ fontSize: 42 }} />
            </Avatar>
            <Typography
              sx={{
                fontSize: '1.95rem',
                fontWeight: 700,
                letterSpacing: '-0.04em',
                lineHeight: 1.04,
                maxWidth: '100%',
                mt: 1.25,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                textShadow: '0 1px 8px rgba(0,0,0,0.16)',
                whiteSpace: 'nowrap',
              }}
            >
              {titleLabel}
            </Typography>
            <Box
              sx={{
                alignItems: 'center',
                color: 'rgba(214,221,233,0.5)',
                display: 'inline-flex',
                gap: 0.58,
                mt: 0.05,
              }}
            >
              <Typography
                sx={{
                  color: 'rgba(214,221,233,0.42)',
                  fontSize: '0.72rem',
                  fontWeight: 500,
                  lineHeight: 1.2,
                }}
              >
                {addressLabel}
              </Typography>
              <ButtonBase
                onClick={() => {
                  if (rawWallet?.address0) {
                    void navigator.clipboard?.writeText(rawWallet.address0).catch(() => {});
                  }
                }}
                sx={{
                  color: 'rgba(214,221,233,0.34)',
                  minWidth: 0,
                  p: 0,
                  '&:hover': {
                    color: 'rgba(214,221,233,0.7)',
                  },
                }}
              >
                <ContentCopyRoundedIcon sx={{ fontSize: 18 }} />
              </ButtonBase>
            </Box>
          </Box>

          <Divider
            sx={{
              borderColor: 'rgba(128,143,173,0.14)',
              mt: 2.15,
            }}
          />

          <Box
            sx={{
              ...revealFormSx,
              display: 'flex',
              flexDirection: 'column',
              gap: 1.05,
              mt: 2.15,
            }}
          >
            <Box>
              <Typography
                sx={{
                  color: 'rgba(214,221,233,0.62)',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  mb: 0.9,
                  textTransform: 'uppercase',
                }}
              >
                Wallet password
              </Typography>
              <PasswordField
                id="wallet-unlock-password"
                value={authenticatePassword}
                onChange={(e) => setAuthenticatePassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onAuthenticate();
                  }
                }}
                ref={passwordRef}
                sx={{
                  width: '100%',
                  '& .MuiOutlinedInput-root': {
                    background:
                      'linear-gradient(180deg, rgba(18,24,35,0.96) 0%, rgba(15,21,31,0.98) 100%)',
                    borderRadius: '10px',
                    minHeight: 50,
                    transition:
                      'background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease',
                    '& fieldset': {
                      border: '1px solid rgba(118,132,163,0.18)',
                    },
                    '&:hover': {
                      backgroundColor: 'rgba(20,27,39,0.98)',
                    },
                    '&:hover fieldset': {
                      border: '1px solid rgba(126,143,177,0.24)',
                    },
                    '&.Mui-focused': {
                      backgroundColor: 'rgba(21,29,41,0.99)',
                      boxShadow: '0 0 0 2px rgba(63,103,191,0.1)',
                    },
                    '&.Mui-focused fieldset': {
                      border: '1px solid rgba(108,144,229,0.28)',
                    },
                  },
                  '& input': {
                    fontSize: '0.88rem',
                    fontWeight: 500,
                    padding: '12px 14px',
                  },
                  '& input::placeholder': {
                    color: 'rgba(214,221,233,0.36)',
                    fontSize: '0.84rem',
                    fontWeight: 400,
                  },
                  '& .MuiInputAdornment-root .MuiButtonBase-root': {
                    color: 'rgba(214,221,233,0.46)',
                  },
                  '& .MuiOutlinedInput-root:hover .MuiInputAdornment-root .MuiButtonBase-root, & .MuiOutlinedInput-root.Mui-focused .MuiInputAdornment-root .MuiButtonBase-root':
                    {
                      color: 'rgba(214,221,233,0.74)',
                    },
                }}
                placeholder="Enter your password"
              />
            </Box>

            <Box sx={{ minHeight: 16, mt: -0.1 }}>
              <ErrorText>{walletToBeDecryptedError}</ErrorText>
            </Box>

            <AuthButton
              onClick={onAuthenticate}
              disabled={!authenticatePassword}
              sx={{
                border: '1px solid rgba(105,139,225,0.34)',
                borderRadius: '10px',
                boxShadow: '0 12px 30px rgba(10,18,36,0.24)',
                fontSize: '0.92rem',
                fontWeight: 600,
                height: 52,
                '&:disabled': {
                  background:
                    'linear-gradient(180deg, rgba(51,83,151,0.84) 0%, rgba(35,62,120,0.84) 100%)',
                  borderColor: 'rgba(105,139,225,0.22)',
                  color: 'rgba(230,236,247,0.58)',
                  opacity: 1,
                },
              }}
            >
              Unlock
            </AuthButton>
          </Box>

          <Box
            sx={{
              ...revealFormSx,
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: 2.1,
              mt: 2.2,
            }}
          >
            <ButtonBase
              onClick={onBack}
              sx={{
                alignItems: 'center',
                color: 'rgba(126,170,248,0.88)',
                display: 'inline-flex',
                fontSize: '0.79rem',
                fontWeight: 500,
                gap: 0.28,
                justifyContent: 'center',
                lineHeight: 1,
                minHeight: 26,
                width: '100%',
                '&:hover': {
                  color: 'rgba(148,186,255,0.96)',
                },
              }}
              >
                Choose another account
                <ChevronRightRoundedIcon sx={{ fontSize: 15 }} />
              </ButtonBase>

            <Divider
              sx={{
                alignSelf: 'stretch',
                borderColor: 'rgba(128,143,173,0.14)',
              }}
            />

            <Box
              sx={{
                alignItems: 'center',
                color: 'rgba(214,221,233,0.42)',
                display: 'flex',
                flexDirection: 'column',
                gap: 0.52,
                mx: 'auto',
                minWidth: 0,
                textAlign: 'center',
                width: '100%',
              }}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'inline-flex',
                  gap: 0.38,
                  justifyContent: 'center',
                  width: '100%',
                }}
              >
                <CheckCircleRoundedIcon
                  sx={{
                    color: usingLocalNode
                      ? 'rgba(116,208,138,0.62)'
                      : 'rgba(118,164,255,0.66)',
                    fontSize: 11,
                  }}
                />
                <Typography
                  sx={{
                    color: usingLocalNode
                      ? 'rgba(214,221,233,0.5)'
                      : selectedNode?.url === HTTPS_EXT_NODE_QORTAL_LINK
                        ? 'rgba(214,221,233,0.5)'
                        : 'rgba(214,221,233,0.5)',
                    fontSize: '0.76rem',
                    fontWeight: 400,
                    lineHeight: 1,
                  }}
                >
                  {connectionLabel}
                </Typography>
              </Box>
              <ButtonBase
                onClick={() => setIsConnectionModeOpen(true)}
                sx={{
                  alignItems: 'center',
                  color: 'rgba(214,221,233,0.62)',
                  display: 'inline-flex',
                  fontSize: '0.76rem',
                  fontWeight: 500,
                  gap: 0.38,
                  justifyContent: 'center',
                  minWidth: 0,
                  p: 0,
                  width: '100%',
                  '&:hover': {
                    color: 'rgba(214,221,233,0.78)',
                  },
                }}
              >
                <SettingsEthernetRoundedIcon sx={{ fontSize: 11 }} />
                <Typography sx={{ fontSize: '0.76rem', fontWeight: 500 }}>
                  Connection Mode
                </Typography>
              </ButtonBase>
            </Box>
          </Box>
        </Box>
      </AuthFrame>

      <ConnectionModeModal
        open={isConnectionModeOpen}
        onClose={() => setIsConnectionModeOpen(false)}
      />
      {sharedTransition && (
        <SharedUnlockTransitionOverlay transition={sharedTransition} />
      )}
    </>
  );
};

const buildSharedTransform = (
  originRect: SharedElementRect,
  targetRect: SharedElementRect,
  isRunning: boolean,
  shouldScale = false
) => {
  const translateX = targetRect.left - originRect.left;
  const translateY = targetRect.top - originRect.top;
  const scaleX = shouldScale ? targetRect.width / originRect.width : 1;
  const scaleY = shouldScale ? targetRect.height / originRect.height : 1;

  return isRunning
    ? `translate3d(${translateX}px, ${translateY}px, 0) scale(${scaleX}, ${scaleY})`
    : 'translate3d(0, 0, 0) scale(1, 1)';
};

const sharedOverlayBaseSx = {
  opacity: 1,
  pointerEvents: 'none',
  position: 'fixed',
  transformOrigin: 'top left',
  transition:
    'transform 400ms cubic-bezier(0.4, 0, 0.2, 1), opacity 140ms cubic-bezier(0.4, 0, 0.2, 1)',
  zIndex: 5200,
};

const SharedUnlockTransitionOverlay = ({
  transition,
}: {
  transition: {
    isRunning: boolean;
    snapshot: AuthUnlockTransitionSnapshot;
    targetAvatarRect: SharedElementRect;
  };
}) => {
  const { isRunning, snapshot, targetAvatarRect } = transition;

  return (
    <>
      <Avatar
        alt={snapshot.displayName}
        src={snapshot.avatarSrc}
        sx={{
          ...sharedOverlayBaseSx,
          height: snapshot.avatarRect.height,
          left: snapshot.avatarRect.left,
          top: snapshot.avatarRect.top,
          transform: buildSharedTransform(
            snapshot.avatarRect,
            targetAvatarRect,
            isRunning,
            true
          ),
          width: snapshot.avatarRect.width,
        }}
      >
        <PersonIcon sx={{ fontSize: 22 }} />
      </Avatar>
    </>
  );
};
