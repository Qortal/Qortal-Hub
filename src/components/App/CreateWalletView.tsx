import {
  Box,
  Checkbox,
  FormControlLabel,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { RefObject, useState } from 'react';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import { PasswordField, ErrorText } from '../index';
import {
  AuthButton,
  AuthScreen,
  AuthSectionLabel,
  AuthStepDots,
} from '../Auth/AuthShell';

type CreateWalletViewProps = {
  creationStep: number;
  walletToBeDownloaded: any;
  walletToBeDownloadedPassword: string;
  walletToBeDownloadedPasswordConfirm: string;
  walletToBeDownloadedError: string;
  showSeed: boolean;
  storeAccount: boolean;
  generatorRef: RefObject<any>;
  confirmRef: RefObject<HTMLInputElement | null>;
  onReturnBack: () => void;
  onShowSeed: () => void;
  onHideSeed: () => void;
  onCreationStepNext: () => void;
  setWalletToBeDownloadedPassword: (v: string) => void;
  setWalletToBeDownloadedPasswordConfirm: (v: string) => void;
  setStoredAccount: (v: boolean) => void;
  onCreateAccount: () => void;
  onBackupAccountConfirm: () => void;
  onEnterHub: () => void;
  exportSeedphrase: () => void;
};

export function CreateWalletView({
  creationStep,
  walletToBeDownloaded,
  walletToBeDownloadedPassword,
  walletToBeDownloadedPasswordConfirm,
  walletToBeDownloadedError,
  storeAccount,
  generatorRef,
  confirmRef,
  onReturnBack,
  onCreationStepNext,
  setWalletToBeDownloadedPassword,
  setWalletToBeDownloadedPasswordConfirm,
  setStoredAccount,
  onCreateAccount,
  onBackupAccountConfirm,
  onEnterHub,
  exportSeedphrase,
}: CreateWalletViewProps) {
  const theme = useTheme();
  const [seedphraseSaved, setSeedphraseSaved] = useState(false);
  const [seedphraseCopied, setSeedphraseCopied] = useState(false);
  const [passwordStepError, setPasswordStepError] = useState('');
  const generatedSeedphrase = generatorRef.current?.parsedString || '';

  const passwordsMatch =
    walletToBeDownloadedPassword &&
    walletToBeDownloadedPasswordConfirm &&
    walletToBeDownloadedPassword === walletToBeDownloadedPasswordConfirm;

  const handleNextFromPassword = () => {
    if (!walletToBeDownloadedPassword) {
      setPasswordStepError('Enter a wallet password.');
      return;
    }

    if (!walletToBeDownloadedPasswordConfirm) {
      setPasswordStepError('Confirm your wallet password.');
      return;
    }

    if (!passwordsMatch) {
      setPasswordStepError('Passwords do not match.');
      return;
    }

    setPasswordStepError('');
    onCreationStepNext();
  };

  const handleCopyPhrase = async () => {
    if (!generatedSeedphrase) return;
    try {
      await navigator.clipboard.writeText(generatedSeedphrase);
      setSeedphraseCopied(true);
      window.setTimeout(() => setSeedphraseCopied(false), 1600);
    } catch (error) {
      console.error(error);
    }
  };

  if (walletToBeDownloaded) {
    return (
      <AuthScreen maxWidth={400}>
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: 2.2,
            textAlign: 'center',
          }}
        >
          <AuthStepDots count={3} current={3} />
          <Box
            sx={{
              alignItems: 'center',
              border: '1px solid rgba(88,199,113,0.34)',
              borderRadius: '999px',
              display: 'inline-flex',
              height: 84,
              justifyContent: 'center',
              width: 84,
            }}
          >
            <CheckCircleRoundedIcon
              sx={{
                color: 'rgb(88,199,113)',
                fontSize: 54,
              }}
            />
          </Box>

          <Box>
            <Typography
              sx={{
                fontSize: '1.56rem',
                fontWeight: 700,
                letterSpacing: '-0.03em',
              }}
            >
              Account created
            </Typography>
            <Typography
              sx={{
                color: 'rgba(214,221,233,0.58)',
                fontSize: '0.92rem',
                lineHeight: 1.6,
                mt: 0.9,
              }}
            >
              Keep your seedphrase safe.
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.9, width: '100%' }}>
            <AuthButton onClick={onEnterHub}>Enter Hub</AuthButton>
            <AuthButton onClick={onBackupAccountConfirm} primary={false}>
              Backup again
            </AuthButton>
          </Box>
        </Box>
      </AuthScreen>
    );
  }

  if (creationStep === 2) {
    return (
      <AuthScreen
        maxWidth={460}
        title="Your Seedphrase"
        subtitle="Also known as your recovery phrase. It restores your account if you lose access."
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <ButtonBase
            onClick={onReturnBack}
            sx={{
              color: 'rgba(214,221,233,0.62)',
              minWidth: 0,
              p: 0,
              '&:hover': { color: theme.palette.text.primary },
            }}
          >
            <ArrowBackRoundedIcon sx={{ fontSize: 18 }} />
          </ButtonBase>
          <AuthStepDots count={3} current={2} />
          <Box sx={{ width: 18 }} />
        </Box>

        <Box
          sx={{
            backgroundColor: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '8px',
            px: 2,
            py: 1.8,
            textAlign: 'center',
          }}
        >
          <Typography
            sx={{
              fontSize: '0.98rem',
              fontWeight: 600,
              lineHeight: 1.85,
              wordBreak: 'break-word',
            }}
          >
            {generatedSeedphrase}
          </Typography>
        </Box>

        <Box sx={{ display: 'grid', gap: 0.9, gridTemplateColumns: '1fr 1fr' }}>
          <AuthButton onClick={handleCopyPhrase} primary={false}>
            {seedphraseCopied ? 'Copied' : 'Copy'}
          </AuthButton>
          <AuthButton onClick={exportSeedphrase} primary={false}>
            Export
          </AuthButton>
        </Box>

        <Box
          sx={{
            alignItems: 'flex-start',
            backgroundColor: 'rgba(217,165,58,0.08)',
            border: '1px solid rgba(217,165,58,0.16)',
            borderRadius: '8px',
            color: 'rgba(239,228,202,0.92)',
            display: 'flex',
            gap: 1,
            px: 1.2,
            py: 1,
          }}
        >
          <WarningAmberRoundedIcon sx={{ color: '#E2B454', fontSize: 20, mt: 0.15 }} />
          <Typography sx={{ fontSize: '0.86rem', lineHeight: 1.55 }}>
            Never share this. Anyone with it can access your account.
          </Typography>
        </Box>

        <FormControlLabel
          sx={{ alignItems: 'flex-start', m: 0 }}
          control={
            <Checkbox
              checked={seedphraseSaved}
              onChange={(event) => setSeedphraseSaved(event.target.checked)}
              sx={{ color: theme.palette.text.secondary }}
            />
          }
          label={
            <Typography sx={{ fontSize: '0.88rem', lineHeight: 1.55 }}>
              I saved my seedphrase securely.
            </Typography>
          }
        />

        <AuthButton disabled={!seedphraseSaved} onClick={onCreateAccount}>
          Create account
        </AuthButton>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      maxWidth={400}
      title="Create password"
      subtitle="This password protects your account on this device."
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <ButtonBase
          onClick={onReturnBack}
          sx={{
            color: 'rgba(214,221,233,0.62)',
            minWidth: 0,
            p: 0,
            '&:hover': { color: theme.palette.text.primary },
          }}
        >
          <ArrowBackRoundedIcon sx={{ fontSize: 18 }} />
        </ButtonBase>
        <AuthStepDots count={3} current={1} />
        <Box sx={{ width: 18 }} />
      </Box>

      <Box>
        <AuthSectionLabel>Wallet password</AuthSectionLabel>
        <PasswordField
          value={walletToBeDownloadedPassword}
          onChange={(e) => setWalletToBeDownloadedPassword(e.target.value)}
          name="create-wallet-password"
          suppressAutofill
          sx={{ width: '100%' }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') confirmRef.current?.focus();
          }}
        />
      </Box>

      <Box>
        <AuthSectionLabel>Confirm password</AuthSectionLabel>
        <PasswordField
          inputRef={confirmRef}
          value={walletToBeDownloadedPasswordConfirm}
          onChange={(e) => setWalletToBeDownloadedPasswordConfirm(e.target.value)}
          name="create-wallet-password-confirmation"
          suppressAutofill
          sx={{ width: '100%' }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleNextFromPassword();
          }}
        />
      </Box>

      <FormControlLabel
        sx={{ alignItems: 'flex-start', m: 0 }}
        control={
          <Checkbox
            checked={storeAccount}
            onChange={(event) => setStoredAccount(event.target.checked)}
            sx={{ color: theme.palette.text.secondary }}
          />
        }
        label={
          <Typography
            sx={{
              color: 'rgba(214,221,233,0.62)',
              fontSize: '0.86rem',
              lineHeight: 1.55,
            }}
          >
            Save this account on this device
          </Typography>
        }
      />

      <ErrorText>{passwordStepError || walletToBeDownloadedError}</ErrorText>

      <AuthButton onClick={handleNextFromPassword}>Continue</AuthButton>
    </AuthScreen>
  );
}
