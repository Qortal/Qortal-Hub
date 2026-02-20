import { useEffect, useRef, useState } from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import Avatar from '@mui/material/Avatar';
import PersonIcon from '@mui/icons-material/Person';
import { useTranslation } from 'react-i18next';
import { useAtom } from 'jotai';
import { authenticatePasswordAtom } from '../atoms/global';
import { Return } from '../assets/Icons/Return.tsx';
import Logo1Dark from '../assets/svgs/Logo1Dark.svg';
import { isLocalNodeUrl } from '../constants/constants';
import { nodeDisplay } from '../utils/helpers.ts';
import { CustomButton, CustomLabel, TextP } from '../styles/App-styles.ts';
import { Spacer } from '../common/Spacer';
import { PasswordField, ErrorText } from './index';
import type { ApiKey } from '../types/auth';
import { getBaseApiReactForAvatar } from '../App';
import { getNameInfo } from './Group/groupApi';

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

export const AuthenticationForm = ({
  rawWallet,
  selectedNode,
  walletToBeDecryptedError,
  onBack,
  onAuthenticate,
}: AuthenticationFormProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core']);
  const [authenticatePassword, setAuthenticatePassword] = useAtom(
    authenticatePasswordAtom
  );
  const passwordRef = useRef<HTMLInputElement>(null);
  const [primaryName, setPrimaryName] = useState<string | null>(null);

  // Fetch primary name for this address first; only then can we construct the avatar URL.
  useEffect(() => {
    if (!rawWallet?.address0) {
      setPrimaryName(null);
      return;
    }
    getNameInfo(rawWallet.address0)
      .then((name) => setPrimaryName(name || null))
      .catch(() => setPrimaryName(null));
  }, [rawWallet?.address0]);

  // Avatar URL is built only from the fetched primary name (each address has its own primary name).
  // Use getBaseApiReactForAvatar so local HTTPS uses HTTP for avatars (avoids cert issues).
  const avatarSrc = primaryName
    ? `${getBaseApiReactForAvatar()}/arbitrary/THUMBNAIL/${primaryName}/qortal_avatar?async=true`
    : undefined;
  const displayLabel =
    primaryName ||
    rawWallet?.name ||
    rawWallet?.filename ||
    rawWallet?.address0 ||
    '';

  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

  return (
    <>
      <Spacer height="22px" />
      <Box
        sx={{
          boxSizing: 'border-box',
          display: 'flex',
          justifyContent: 'flex-start',
          maxWidth: '700px',
          paddingLeft: '22px',
          width: '100%',
        }}
      >
        <Return
          style={{
            cursor: 'pointer',
            height: '24px',
            width: 'auto',
          }}
          onClick={onBack}
        />
      </Box>

      <Spacer height="10px" />

      <div
        className="image-container"
        style={{
          width: '136px',
          height: '154px',
        }}
      >
        <img src={Logo1Dark} className="base-image" alt="" />
      </div>

      <Spacer height="35px" />

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: '10px',
          }}
        >
          <Avatar
            alt={displayLabel}
            src={avatarSrc}
            sx={{ width: 40, height: 40 }}
          >
            <PersonIcon sx={{ fontSize: 24 }} />
          </Avatar>
          <Typography>{displayLabel}</Typography>
        </Box>

        <Spacer height="10px" />

        <TextP
          sx={{
            textAlign: 'start',
            lineHeight: '24px',
            fontSize: '20px',
            fontWeight: 600,
          }}
        >
          {t('auth:authentication', {
            postProcess: 'capitalizeFirstChar',
          })}
        </TextP>
      </Box>

      <Spacer height="35px" />

      <>
        <CustomLabel htmlFor="standard-adornment-password">
          {t('auth:wallet.password', {
            postProcess: 'capitalizeFirstChar',
          })}
        </CustomLabel>

        <Spacer height="10px" />

        <PasswordField
          id="standard-adornment-password"
          value={authenticatePassword}
          onChange={(e) => setAuthenticatePassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onAuthenticate();
            }
          }}
          ref={passwordRef}
        />

        <>
          <Spacer height="20px" />

          <Typography
            sx={{
              fontSize: '12px',
              ...(isLocalNodeUrl(selectedNode?.url) && {
                fontWeight: 'bold',
                color: theme.palette.other.positive,
              }),
            }}
          >
            {t('auth:node.using', {
              postProcess: 'capitalizeFirstChar',
            })}
            : {nodeDisplay(selectedNode?.url)}
          </Typography>
        </>

        <Spacer height="20px" />

        <CustomButton onClick={onAuthenticate}>
          {t('auth:action.authenticate', {
            postProcess: 'capitalizeFirstChar',
          })}
        </CustomButton>

        <ErrorText>{walletToBeDecryptedError}</ErrorText>
      </>
    </>
  );
};
