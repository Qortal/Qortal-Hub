import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Avatar, Box, ButtonBase, Typography, useTheme } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import SettingsEthernetRoundedIcon from '@mui/icons-material/SettingsEthernetRounded';
import { useAtom } from 'jotai';
import { authenticatePasswordAtom } from '../atoms/global';
import { PasswordField, ErrorText } from './index';
import type { ApiKey } from '../types/auth';
import { getBaseApiReactForAvatar } from '../App';
import { getPrimaryNameForAvatar } from './Group/groupApi';
import { AuthButton, AuthFrame, AuthSectionLabel } from './Auth/AuthShell';
import { isLocalNodeUrl } from '../constants/constants';
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
  const addressRef = useRef<HTMLParagraphElement | null>(null);
  const avatarRef = useRef<HTMLDivElement | null>(null);
  const nameRef = useRef<HTMLParagraphElement | null>(null);
  const [primaryName, setPrimaryName] = useState<string | null>(null);
  const [isConnectionModeOpen, setIsConnectionModeOpen] = useState(false);
  const [sharedTransition, setSharedTransition] = useState<{
    isRunning: boolean;
    snapshot: AuthUnlockTransitionSnapshot;
    targetAddressRect: SharedElementRect;
    targetAvatarRect: SharedElementRect;
    targetNameRect: SharedElementRect;
  } | null>(null);

  useEffect(() => {
    if (!rawWallet?.address0) {
      setPrimaryName(null);
      return;
    }
    getPrimaryNameForAvatar(rawWallet.address0)
      .then((name) => setPrimaryName(name || null))
      .catch(() => setPrimaryName(null));
  }, [rawWallet?.address0]);

  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

  const avatarSrc = primaryName
    ? `${getBaseApiReactForAvatar()}/arbitrary/THUMBNAIL/${primaryName}/qortal_avatar?async=true`
    : undefined;
  const displayLabel =
    primaryName ||
    rawWallet?.name ||
    rawWallet?.filename ||
    rawWallet?.address0 ||
    'Unnamed account';
  const usingLocalNode = isLocalNodeUrl(selectedNode?.url);
  const isSharedTransitionActive = Boolean(sharedTransition);
  const shouldReduceMotion =
    typeof window !== 'undefined' &&
    (window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      window.localStorage.getItem('hub_ui_animations_enabled') === 'false');

  useLayoutEffect(() => {
    if (
      !unlockTransition ||
      shouldReduceMotion ||
      !avatarRef.current ||
      !nameRef.current ||
      !addressRef.current
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
      targetAddressRect: rectToObject(addressRef.current.getBoundingClientRect()),
      targetAvatarRect: rectToObject(avatarRef.current.getBoundingClientRect()),
      targetNameRect: rectToObject(nameRef.current.getBoundingClientRect()),
    });

    let firstFrame = 0;
    let secondFrame = 0;
    const finishTimer = window.setTimeout(() => {
      setSharedTransition(null);
      onUnlockTransitionComplete?.();
    }, 460);

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

  const sharedOpacitySx = {
    opacity: isSharedTransitionActive ? 0 : 1,
    transition: 'opacity 120ms cubic-bezier(0.4, 0, 0.2, 1)',
  };
  const revealFormSx = unlockTransition
    ? {
        animation:
          'authUnlockFormReveal 320ms cubic-bezier(0.4, 0, 0.2, 1) 110ms both',
      }
    : {};

  return (
    <>
      <AuthFrame maxWidth={390}>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2.1,
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
        <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
          <ButtonBase
            onClick={onBack}
            sx={{
              alignItems: 'center',
              color: 'rgba(214,221,233,0.62)',
              display: 'inline-flex',
              gap: 0.4,
              minWidth: 0,
              p: 0,
              '&:hover': {
                color: theme.palette.text.primary,
              },
            }}
          >
            <ArrowBackRoundedIcon sx={{ fontSize: 18 }} />
          </ButtonBase>
        </Box>

        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.05,
            textAlign: 'center',
          }}
        >
          <Avatar
            ref={avatarRef}
            alt={displayLabel}
            src={avatarSrc}
            sx={{ height: 58, width: 58, ...sharedOpacitySx }}
          >
            <PersonIcon sx={{ fontSize: 32 }} />
          </Avatar>
          <Typography
            sx={{
              fontSize: '1.44rem',
              fontWeight: 700,
              letterSpacing: '-0.03em',
            }}
          >
            Unlock account
          </Typography>
          <Typography sx={{ fontSize: '0.98rem', fontWeight: 700 }}>
            <Box
              ref={nameRef}
              component="span"
              sx={{ display: 'inline-block', ...sharedOpacitySx }}
            >
              {displayLabel}
            </Box>
          </Typography>
          <Typography
            ref={addressRef}
            sx={{
              color: 'rgba(214,221,233,0.58)',
              fontSize: '0.88rem',
              ...sharedOpacitySx,
            }}
          >
            {shortenAddress(rawWallet?.address0)}
          </Typography>
        </Box>

        <Box sx={revealFormSx}>
          <AuthSectionLabel>Wallet password</AuthSectionLabel>
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
            sx={{ width: '100%' }}
          />
        </Box>

        <Box sx={revealFormSx}>
          <ErrorText>{walletToBeDecryptedError}</ErrorText>
        </Box>

        <Box sx={revealFormSx}>
          <AuthButton
            onClick={onAuthenticate}
            disabled={!authenticatePassword}
          >
            Unlock
          </AuthButton>
        </Box>

        <Box sx={revealFormSx}>
          <ButtonBase
            onClick={onBack}
            sx={{
              color: theme.palette.primary.main,
              fontSize: '0.88rem',
              fontWeight: 700,
              justifyContent: 'center',
              minHeight: 26,
              width: '100%',
            }}
          >
            Choose another account
          </ButtonBase>
        </Box>

        <Box
          sx={{
            ...revealFormSx,
            alignItems: 'center',
            color: 'rgba(214,221,233,0.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: 0.4,
            justifyContent: 'center',
            mt: 0.3,
          }}
        >
          <Box sx={{ alignItems: 'center', display: 'inline-flex', gap: 0.65 }}>
            <CheckCircleRoundedIcon
              sx={{
                color: usingLocalNode
                  ? theme.palette.other.positive
                  : theme.palette.primary.main,
                fontSize: 15,
              }}
            />
            <Typography
              sx={{
                color: usingLocalNode
                  ? theme.palette.other.positive
                  : 'rgba(214,221,233,0.56)',
                fontSize: '0.78rem',
                fontWeight: 600,
              }}
            >
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
              <SettingsEthernetRoundedIcon sx={{ fontSize: 15 }} />
              <Typography sx={{ fontSize: '0.74rem', fontWeight: 600 }}>
                Connection Mode
              </Typography>
            </ButtonBase>
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
  pointerEvents: 'none',
  position: 'fixed',
  transformOrigin: 'top left',
  transition: 'transform 400ms cubic-bezier(0.4, 0, 0.2, 1)',
  zIndex: 5200,
};

const SharedUnlockTransitionOverlay = ({
  transition,
}: {
  transition: {
    isRunning: boolean;
    snapshot: AuthUnlockTransitionSnapshot;
    targetAddressRect: SharedElementRect;
    targetAvatarRect: SharedElementRect;
    targetNameRect: SharedElementRect;
  };
}) => {
  const {
    isRunning,
    snapshot,
    targetAddressRect,
    targetAvatarRect,
    targetNameRect,
  } = transition;

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
      <Typography
        sx={{
          ...sharedOverlayBaseSx,
          color: '#f6f8fc',
          fontSize: '0.95rem',
          fontWeight: 700,
          left: snapshot.nameRect.left,
          lineHeight: 1.25,
          top: snapshot.nameRect.top,
          transform: buildSharedTransform(
            snapshot.nameRect,
            targetNameRect,
            isRunning
          ),
          whiteSpace: 'nowrap',
        }}
      >
        {snapshot.displayName}
      </Typography>
      <Typography
        sx={{
          ...sharedOverlayBaseSx,
          color: 'rgba(214,221,233,0.58)',
          fontSize: '0.79rem',
          fontWeight: 400,
          left: snapshot.addressRect.left,
          lineHeight: 1.35,
          top: snapshot.addressRect.top,
          transform: buildSharedTransform(
            snapshot.addressRect,
            targetAddressRect,
            isRunning
          ),
          whiteSpace: 'nowrap',
        }}
      >
        {snapshot.addressLabel}
      </Typography>
    </>
  );
};
