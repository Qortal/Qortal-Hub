import { useCallback, useMemo, useState } from 'react';
import {
  Box,
  ButtonBase,
  Checkbox,
  Dialog,
  FormControlLabel,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { LoadingButton } from '@mui/lab';
import CloseIcon from '@mui/icons-material/Close';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useTranslation } from 'react-i18next';
import { crypto, walletVersion } from '../../constants/decryptWallet';
import { decryptStoredWallet } from '../../utils/decryptWallet';
import PhraseWallet from '../../utils/generateWallet/phrase-wallet';
import { saveFileToDisk } from '../../utils/generateWallet/generateWallet';
import { executeEvent } from '../../utils/events';
import { PasswordField } from '../index';
import { getBlueTier1ButtonSx } from '../../styles/blueMaterial';

type BackupWalletModalProps = {
  onClose: () => void;
  open: boolean;
  rawWallet: any;
};

export const BackupWalletModal = ({
  onClose,
  open,
  rawWallet,
}: BackupWalletModalProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core']);
  const isDarkMode = theme.palette.mode === 'dark';
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isCurrentPasswordEditable, setIsCurrentPasswordEditable] =
    useState(false);
  const [isNewPasswordEditable, setIsNewPasswordEditable] = useState(false);
  const [keepCurrentPassword, setKeepCurrentPassword] = useState(true);
  const [error, setError] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);

  const modalSurface = isDarkMode
    ? 'linear-gradient(145deg, rgba(49,54,64,0.985) 0%, rgba(35,39,47,0.992) 48%, rgba(24,27,33,0.996) 100%)'
    : 'linear-gradient(180deg, rgba(251,253,255,0.985) 0%, rgba(244,247,251,0.99) 100%)';
  const sectionDivider = isDarkMode
    ? 'rgba(255,255,255,0.052)'
    : alpha(theme.palette.divider, 0.2);
  const fieldBorder = isDarkMode
    ? 'rgba(255,255,255,0.085)'
    : 'rgba(24,29,36,0.12)';
  const fieldHoverBorder = isDarkMode
    ? 'rgba(255,255,255,0.12)'
    : 'rgba(24,29,36,0.16)';
  const fieldSurface = isDarkMode
    ? 'linear-gradient(145deg, rgba(88,95,108,0.2) 0%, rgba(56,62,73,0.28) 44%, rgba(37,41,49,0.42) 100%)'
    : 'linear-gradient(180deg, rgba(17,23,34,0.042) 0%, rgba(17,23,34,0.024) 100%)';
  const fieldSurfaceHover = isDarkMode
    ? 'linear-gradient(145deg, rgba(98,106,120,0.24) 0%, rgba(63,70,82,0.34) 46%, rgba(43,48,57,0.48) 100%)'
    : 'linear-gradient(180deg, rgba(17,23,34,0.06) 0%, rgba(17,23,34,0.034) 100%)';
  const fieldInsetShadow = isDarkMode
    ? '0 8px 20px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.035)'
    : '0 4px 10px rgba(24,32,44,0.06), inset 0 1px 0 rgba(255,255,255,0.5)';

  const walletAddress = rawWallet?.address0 ?? '';

  const resetState = useCallback(() => {
    setCurrentPassword('');
    setNewPassword('');
    setIsCurrentPasswordEditable(false);
    setIsNewPasswordEditable(false);
    setKeepCurrentPassword(true);
    setError('');
    setIsDownloading(false);
  }, []);

  const handleClose = useCallback(() => {
    if (isDownloading) return;
    resetState();
    onClose();
  }, [isDownloading, onClose, resetState]);

  const handleDownload = useCallback(async () => {
    try {
      setError('');

      if (!rawWallet) {
        throw new Error('No active wallet was found for backup.');
      }

      if (!currentPassword) {
        throw new Error(
          t('auth:wallet.error.missing_password', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }

      if (!keepCurrentPassword && !newPassword) {
        throw new Error(
          t('auth:wallet.error.missing_new_password', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }

      setIsDownloading(true);

      let wallet = structuredClone(rawWallet);
      const decryptedWallet = await decryptStoredWallet(currentPassword, wallet);
      const phraseWallet = new PhraseWallet(
        decryptedWallet,
        wallet?.version || walletVersion
      );
      const passwordToUse = keepCurrentPassword ? currentPassword : newPassword;

      wallet = await phraseWallet.generateSaveWalletData(
        passwordToUse,
        crypto.kdfThreads,
        () => {}
      );

      await saveFileToDisk(wallet, rawWallet.address0);
      handleClose();
      executeEvent('openGlobalSnackBar', {
        message: t('auth:message.generic.keep_secure', {
          postProcess: 'capitalizeFirstChar',
        }),
        type: 'info',
        duration: 5600,
      });
    } catch (downloadError: any) {
      setError(downloadError?.message || 'Unable to create the wallet backup.');
      setIsDownloading(false);
    }
  }, [
    currentPassword,
    handleClose,
    keepCurrentPassword,
    newPassword,
    rawWallet,
    t,
  ]);

  const noteTone = useMemo(
    () =>
      isDarkMode
        ? {
            background: 'rgba(132, 176, 240, 0.09)',
            border: 'rgba(132, 176, 240, 0.2)',
            icon: '#8EB8F5',
          }
        : {
            background: 'rgba(90, 126, 196, 0.08)',
            border: 'rgba(90, 126, 196, 0.18)',
            icon: '#5C7EC6',
          },
    [isDarkMode]
  );

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      aria-labelledby="backup-wallet-dialog-title"
      aria-describedby="backup-wallet-dialog-description"
      maxWidth="sm"
      fullWidth
      slotProps={{
        backdrop: {
          sx: {
            backdropFilter: isDarkMode
              ? 'blur(12px) brightness(0.76) saturate(0.88)'
              : 'blur(12px) brightness(0.9) saturate(0.94)',
            WebkitBackdropFilter: isDarkMode
              ? 'blur(12px) brightness(0.76) saturate(0.88)'
              : 'blur(12px) brightness(0.9) saturate(0.94)',
            backgroundColor: isDarkMode
              ? 'rgba(6, 8, 12, 0.4)'
              : 'rgba(22, 26, 34, 0.14)',
          },
        },
        paper: {
          sx: {
            background: modalSurface,
            border: isDarkMode
              ? '1px solid rgba(255,255,255,0.08)'
              : '1px solid rgba(24,29,36,0.09)',
            borderRadius: '14px',
            boxShadow: isDarkMode
              ? '0 34px 120px rgba(0,0,0,0.46)'
              : '0 28px 88px rgba(18,28,45,0.16)',
            clipPath: 'inset(0 round 14px)',
            isolation: 'isolate',
            overflow: 'hidden',
            width: 'min(460px, calc(100vw - 32px))',
          },
        },
      }}
    >
      <Box sx={{ background: modalSurface, display: 'flex', flexDirection: 'column' }}>
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
            px: 2.25,
            py: 1.7,
          }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <Typography
              id="backup-wallet-dialog-title"
              sx={{
                color: theme.palette.text.primary,
                fontSize: '0.98rem',
                fontWeight: 700,
                letterSpacing: '-0.02em',
              }}
            >
              Backup wallet
            </Typography>
            <Typography
              id="backup-wallet-dialog-description"
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.76rem',
                lineHeight: 1.45,
              }}
            >
              Download a local wallet file so you can restore this account later.
            </Typography>
          </Box>
          <ButtonBase
            onClick={handleClose}
            disabled={isDownloading}
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
            borderTop: `1px solid ${sectionDivider}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 1.2,
            px: 2.25,
            pb: 2.15,
            pt: 1.85,
          }}
        >
          <Box
            sx={{
              alignItems: 'flex-start',
              backgroundColor: noteTone.background,
              border: `1px solid ${noteTone.border}`,
              borderRadius: '12px',
              display: 'flex',
              gap: 1,
              px: 1.25,
              py: 1.05,
            }}
          >
            <InfoOutlinedIcon
              sx={{
                color: noteTone.icon,
                flexShrink: 0,
                fontSize: 18,
                mt: '1px',
              }}
            />
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.76rem',
                lineHeight: 1.48,
              }}
            >
              This exports a wallet file locally on your device. Keep it stored
              somewhere safe.
            </Typography>
          </Box>

          <Box
            sx={{
              alignItems: 'flex-start',
              background: fieldSurface,
              border: `1px solid ${fieldBorder}`,
              borderRadius: '12px',
              boxShadow: fieldInsetShadow,
              display: 'flex',
              flexDirection: 'column',
              gap: '3px',
              px: 1.35,
              py: 1.15,
            }}
          >
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.7rem',
                fontWeight: 600,
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
              }}
            >
              Wallet address
            </Typography>
            <Typography
              sx={{
                color: theme.palette.text.primary,
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                fontWeight: 600,
                lineHeight: 1.45,
                wordBreak: 'break-all',
              }}
            >
              {walletAddress || 'No active wallet'}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.72 }}>
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                display: 'block',
                fontSize: '0.74rem',
                fontWeight: 600,
                letterSpacing: '0.01em',
              }}
            >
              Current password
            </Typography>
            <PasswordField
              id="backup-wallet-current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="new-password"
              name="backup-wallet-current-confirmation"
              onFocus={() => setIsCurrentPasswordEditable(true)}
              onMouseDown={() => setIsCurrentPasswordEditable(true)}
              onBlur={() => {
                if (!currentPassword) {
                  setIsCurrentPasswordEditable(false);
                }
              }}
              InputProps={{
                readOnly: !isCurrentPasswordEditable,
              }}
              inputProps={{
                autoComplete: 'new-password',
                'data-1p-ignore': 'true',
                'data-lpignore': 'true',
                spellCheck: 'false',
              }}
              sx={{
                width: '100%',
                '& .MuiOutlinedInput-root, & .MuiInputBase-root': {
                  background: fieldSurface,
                  borderRadius: '10px',
                  boxShadow: fieldInsetShadow,
                  '& fieldset': {
                    borderColor: fieldBorder,
                  },
                  '&:hover fieldset': {
                    borderColor: fieldHoverBorder,
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: fieldHoverBorder,
                    borderWidth: 1,
                  },
                  '&:hover': {
                    background: fieldSurfaceHover,
                  },
                },
                '& input:-webkit-autofill, & input:-webkit-autofill:hover, & input:-webkit-autofill:focus':
                  {
                    WebkitBoxShadow: isDarkMode
                      ? '0 0 0 100px rgb(47, 52, 62) inset'
                      : '0 0 0 100px rgb(248, 250, 253) inset',
                    WebkitTextFillColor: theme.palette.text.primary,
                    caretColor: theme.palette.text.primary,
                    transition: 'background-color 9999s ease-out 0s',
                  },
              }}
            />
          </Box>

          <FormControlLabel
            sx={{ m: 0 }}
            control={
              <Checkbox
                onChange={(event) => setKeepCurrentPassword(event.target.checked)}
                checked={keepCurrentPassword}
                disableRipple
                sx={{
                  '&.Mui-checked': {
                    color: theme.palette.text.secondary,
                  },
                  '& .MuiSvgIcon-root': {
                    color: theme.palette.text.secondary,
                  },
                }}
              />
            }
            label={
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: '0.76rem',
                  lineHeight: 1.45,
                }}
              >
                Keep the current password in the exported wallet file
              </Typography>
            }
          />

          {!keepCurrentPassword && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.72 }}>
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  display: 'block',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  letterSpacing: '0.01em',
                }}
              >
                New password for this backup
              </Typography>
              <PasswordField
                id="backup-wallet-new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                name="backup-wallet-new-passphrase"
                onFocus={() => setIsNewPasswordEditable(true)}
                onMouseDown={() => setIsNewPasswordEditable(true)}
                onBlur={() => {
                  if (!newPassword) {
                    setIsNewPasswordEditable(false);
                  }
                }}
                InputProps={{
                  readOnly: !isNewPasswordEditable,
                }}
                inputProps={{
                  autoComplete: 'new-password',
                  'data-1p-ignore': 'true',
                  'data-lpignore': 'true',
                  spellCheck: 'false',
                }}
                sx={{
                  width: '100%',
                  '& .MuiOutlinedInput-root, & .MuiInputBase-root': {
                    background: fieldSurface,
                    borderRadius: '10px',
                    boxShadow: fieldInsetShadow,
                    '& fieldset': {
                      borderColor: fieldBorder,
                    },
                    '&:hover fieldset': {
                      borderColor: fieldHoverBorder,
                    },
                    '&.Mui-focused fieldset': {
                      borderColor: fieldHoverBorder,
                      borderWidth: 1,
                    },
                    '&:hover': {
                      background: fieldSurfaceHover,
                    },
                  },
                  '& input:-webkit-autofill, & input:-webkit-autofill:hover, & input:-webkit-autofill:focus':
                    {
                      WebkitBoxShadow: isDarkMode
                        ? '0 0 0 100px rgb(47, 52, 62) inset'
                        : '0 0 0 100px rgb(248, 250, 253) inset',
                      WebkitTextFillColor: theme.palette.text.primary,
                      caretColor: theme.palette.text.primary,
                      transition: 'background-color 9999s ease-out 0s',
                    },
                }}
              />
            </Box>
          )}

          {error ? (
            <Typography
              sx={{
                color: theme.palette.error.light,
                fontSize: '0.74rem',
                lineHeight: 1.45,
              }}
            >
              {error}
            </Typography>
          ) : null}

          <LoadingButton
            loading={isDownloading}
            disabled={!rawWallet || !currentPassword || (!keepCurrentPassword && !newPassword)}
            onClick={handleDownload}
            startIcon={!isDownloading ? <FileDownloadRoundedIcon /> : null}
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
            Download wallet file
          </LoadingButton>
        </Box>
      </Box>
    </Dialog>
  );
};
