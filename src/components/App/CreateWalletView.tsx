import {
  Box,
  ButtonBase,
  Checkbox,
  FormControlLabel,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { RefObject, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import { PasswordField, ErrorText } from '../index';
import { AuthButton, AuthScreen, AuthSectionLabel, authPasswordFieldSx } from '../Auth/AuthShell';

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
  onBackupAccountConfirm: () => Promise<boolean>;
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
  const { t } = useTranslation(['auth']);
  const theme = useTheme();
  const isLight = theme.palette.mode === 'light';
  const [backupDownloaded, setBackupDownloaded] = useState(false);
  const [seedphraseCopied, setSeedphraseCopied] = useState(false);
  const [seedphraseRevealed, setSeedphraseRevealed] = useState(false);
  const [passwordStepError, setPasswordStepError] = useState('');
  const generatedSeedphrase = generatorRef.current?.parsedString || '';
  const successAccent = backupDownloaded
    ? {
        border: 'rgba(126,171,255,0.36)',
        icon: 'rgb(126,171,255)',
        surface: 'rgba(64,111,213,0.1)',
      }
    : {
        border: 'rgba(88,199,113,0.34)',
        icon: 'rgb(88,199,113)',
        surface: 'rgba(88,199,113,0)',
      };

  const passwordsMatch =
    walletToBeDownloadedPassword &&
    walletToBeDownloadedPasswordConfirm &&
    walletToBeDownloadedPassword === walletToBeDownloadedPasswordConfirm;

  const handleNextFromPassword = () => {
    if (!walletToBeDownloadedPassword) {
      setPasswordStepError(t('auth:create_wallet.error_enter_password'));
      return;
    }

    if (!walletToBeDownloadedPasswordConfirm) {
      setPasswordStepError(t('auth:create_wallet.error_confirm_password'));
      return;
    }

    if (!passwordsMatch) {
      setPasswordStepError(t('auth:create_wallet.error_passwords_mismatch'));
      return;
    }

    setPasswordStepError('');
    onCreationStepNext();
  };

  const handleCopyPhrase = async () => {
    if (!seedphraseRevealed) {
      setSeedphraseRevealed(true);
      return;
    }

    if (!generatedSeedphrase) return;
    try {
      await navigator.clipboard.writeText(generatedSeedphrase);
      setSeedphraseCopied(true);
      window.setTimeout(() => setSeedphraseCopied(false), 1600);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    setBackupDownloaded(false);
  }, [walletToBeDownloaded?.qortAddress]);

  const handleDownloadBackup = async () => {
    const saved = await onBackupAccountConfirm();
    if (saved) {
      setBackupDownloaded(true);
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
          <Box
            sx={{
              alignItems: 'center',
              backgroundColor: successAccent.surface,
              border: `1px solid ${successAccent.border}`,
              borderRadius: '999px',
              display: 'inline-flex',
              height: 84,
              justifyContent: 'center',
              transition:
                'background-color 360ms ease, border-color 360ms ease, box-shadow 360ms ease',
              width: 84,
            }}
          >
            <CheckCircleRoundedIcon
              sx={{
                color: successAccent.icon,
                fontSize: 54,
                transition: 'color 360ms ease',
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
              {backupDownloaded
                ? t('auth:create_wallet.success_wallet_saved', {
                    postProcess: 'capitalizeFirstChar',
                  })
                : t('auth:create_wallet.success_account_created', {
                    postProcess: 'capitalizeFirstChar',
                  })}
            </Typography>
            <Typography
              sx={{
                color: isLight
                  ? theme.palette.text.secondary
                  : 'rgba(214,221,233,0.58)',
                fontSize: '0.92rem',
                lineHeight: 1.6,
                mt: 0.9,
              }}
            >
              {backupDownloaded
                ? t('auth:create_wallet.success_ready_hub', {
                    postProcess: 'capitalizeFirstChar',
                  })
                : t('auth:create_wallet.success_backup_before_hub', {
                    postProcess: 'capitalizeFirstChar',
                  })}
            </Typography>
          </Box>

          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0.9,
              width: '100%',
            }}
          >
            {backupDownloaded ? (
              <>
                <AuthButton onClick={onEnterHub}>
                  {t('auth:create_wallet.enter_hub', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </AuthButton>
                <AuthButton onClick={handleDownloadBackup} primary={false}>
                  {t('auth:create_wallet.download_another_copy', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </AuthButton>
              </>
            ) : (
              <>
                <AuthButton onClick={handleDownloadBackup}>
                  {t('auth:create_wallet.backup_wallet', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </AuthButton>
                <AuthButton disabled primary={false}>
                  {t('auth:create_wallet.enter_hub', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </AuthButton>
              </>
            )}
          </Box>

          <Typography
            sx={{
              color: isLight
                ? theme.palette.text.secondary
                : 'rgba(214,221,233,0.5)',
              fontSize: '0.78rem',
              lineHeight: 1.5,
            }}
          >
            {t('auth:create_wallet.backup_encrypted_notice', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </Box>
      </AuthScreen>
    );
  }

  if (creationStep === 2) {
    return (
      <AuthScreen
        maxWidth={460}
        title={t('auth:create_wallet.seed_title', {
          postProcess: 'capitalizeFirstChar',
        })}
        subtitle={t('auth:create_wallet.seed_subtitle', {
          postProcess: 'capitalizeSentenceStarts',
        })}
      >
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-start',
            alignItems: 'center',
          }}
        >
          <ButtonBase
            onClick={onReturnBack}
            sx={{
              color: isLight
                ? alpha(theme.palette.text.primary, 0.55)
                : 'rgba(214,221,233,0.62)',
              minWidth: 0,
              p: 0,
              '&:hover': { color: theme.palette.text.primary },
            }}
          >
            <ArrowBackRoundedIcon sx={{ fontSize: 18 }} />
          </ButtonBase>
        </Box>

        <Box
          sx={{
            backgroundColor: isLight
              ? theme.palette.background.surface
              : 'rgba(255,255,255,0.03)',
            border: isLight
              ? `1px solid ${theme.palette.border.main}`
              : '1px solid rgba(255,255,255,0.08)',
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
              minHeight: '3.7em',
              lineHeight: 1.85,
              wordBreak: 'break-word',
            }}
          >
            {seedphraseRevealed ? generatedSeedphrase : ''}
          </Typography>
        </Box>

        <Box sx={{ display: 'grid', gap: 0.9, gridTemplateColumns: '1fr 1fr' }}>
          <AuthButton onClick={handleCopyPhrase} primary={false}>
            {!seedphraseRevealed
              ? t('auth:create_wallet.reveal')
              : seedphraseCopied
                ? t('auth:create_wallet.copied')
                : t('auth:create_wallet.copy')}
          </AuthButton>
          <AuthButton onClick={exportSeedphrase} primary={false}>
            {t('auth:create_wallet.export')}
          </AuthButton>
        </Box>

        <Box
          sx={{
            alignItems: 'flex-start',
            backgroundColor: isLight
              ? alpha('#d97706', 0.1)
              : 'rgba(217,165,58,0.08)',
            border: isLight
              ? `1px solid ${alpha('#d97706', 0.35)}`
              : '1px solid rgba(217,165,58,0.16)',
            borderRadius: '8px',
            color: isLight
              ? theme.palette.text.primary
              : 'rgba(239,228,202,0.92)',
            display: 'flex',
            gap: 1,
            px: 1.2,
            py: 1,
          }}
        >
          <WarningAmberRoundedIcon
            sx={{ color: '#E2B454', fontSize: 20, mt: 0.15 }}
          />
          <Typography sx={{ fontSize: '0.86rem', lineHeight: 1.55 }}>
            {t('auth:create_wallet.seed_warning')}
          </Typography>
        </Box>

        <AuthButton onClick={onCreateAccount}>
          {t('auth:create_wallet.create_account')}
        </AuthButton>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      maxWidth={400}
      title={t('auth:create_wallet.password_title', {
        postProcess: 'capitalizeFirstChar',
      })}
      subtitle={t('auth:create_wallet.password_subtitle', {
        postProcess: 'capitalizeFirstChar',
      })}
    >
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'flex-start',
          alignItems: 'center',
        }}
      >
        <ButtonBase
          onClick={onReturnBack}
          sx={{
            color: isLight
              ? alpha(theme.palette.text.primary, 0.55)
              : 'rgba(214,221,233,0.62)',
            minWidth: 0,
            p: 0,
            '&:hover': { color: theme.palette.text.primary },
          }}
        >
          <ArrowBackRoundedIcon sx={{ fontSize: 18 }} />
        </ButtonBase>
      </Box>

      <Box>
        <AuthSectionLabel>
          {t('auth:create_wallet.wallet_password')}
        </AuthSectionLabel>
        <PasswordField
          value={walletToBeDownloadedPassword}
          onChange={(e) => setWalletToBeDownloadedPassword(e.target.value)}
          name="create-wallet-password"
          suppressAutofill
          sx={authPasswordFieldSx(theme)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') confirmRef.current?.focus();
          }}
        />
      </Box>

      <Box>
        <AuthSectionLabel>
          {t('auth:create_wallet.confirm_password')}
        </AuthSectionLabel>
        <PasswordField
          inputRef={confirmRef}
          value={walletToBeDownloadedPasswordConfirm}
          onChange={(e) =>
            setWalletToBeDownloadedPasswordConfirm(e.target.value)
          }
          name="create-wallet-password-confirmation"
          suppressAutofill
          sx={authPasswordFieldSx(theme)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleNextFromPassword();
          }}
        />
      </Box>

      <FormControlLabel
        sx={{ alignItems: 'center', m: 0 }}
        control={
          <Checkbox
            checked={storeAccount}
            onChange={(event) => setStoredAccount(event.target.checked)}
            sx={{
              color: theme.palette.text.secondary,
              '&.Mui-checked': {
                color: theme.palette.primary.main,
              },
            }}
          />
        }
        label={
          <Typography
            sx={{
              color: isLight
                ? theme.palette.text.primary
                : 'rgba(214,221,233,0.62)',
              fontSize: '0.86rem',
              lineHeight: 1.55,
            }}
          >
            {t('auth:create_wallet.save_account_in_hub')}
          </Typography>
        }
      />

      <ErrorText>{passwordStepError || walletToBeDownloadedError}</ErrorText>

      <AuthButton onClick={handleNextFromPassword}>
        {t('auth:create_wallet.continue')}
      </AuthButton>
    </AuthScreen>
  );
}
