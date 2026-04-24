import { useEffect, useRef, useState } from 'react';
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

type RawWallet = {
  name?: string;
  filename?: string;
  address0?: string;
};

type AuthenticationFormProps = {
  rawWallet: RawWallet;
  selectedNode: ApiKey | null;
  walletToBeDecryptedError: string;
  onBack: () => void;
  onAuthenticate: () => Promise<void>;
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
  onBack,
  onAuthenticate,
}: AuthenticationFormProps) => {
  const theme = useTheme();
  const [authenticatePassword, setAuthenticatePassword] = useAtom(
    authenticatePasswordAtom
  );
  const passwordRef = useRef<HTMLInputElement>(null);
  const [primaryName, setPrimaryName] = useState<string | null>(null);
  const [isConnectionModeOpen, setIsConnectionModeOpen] = useState(false);

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

  return (
    <>
      <AuthFrame maxWidth={390}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.1 }}>
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
          <Avatar alt={displayLabel} src={avatarSrc} sx={{ height: 58, width: 58 }}>
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
            {displayLabel}
          </Typography>
          <Typography
            sx={{
              color: 'rgba(214,221,233,0.58)',
              fontSize: '0.88rem',
            }}
          >
            {shortenAddress(rawWallet?.address0)}
          </Typography>
        </Box>

        <Box>
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

        <ErrorText>{walletToBeDecryptedError}</ErrorText>

        <AuthButton
          onClick={onAuthenticate}
          disabled={!authenticatePassword}
        >
          Unlock
        </AuthButton>

        <ButtonBase
          onClick={onBack}
          sx={{
            color: theme.palette.primary.main,
            fontSize: '0.88rem',
            fontWeight: 700,
            justifyContent: 'center',
            minHeight: 26,
          }}
        >
          Choose another account
        </ButtonBase>

        <Box
          sx={{
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
    </>
  );
};
