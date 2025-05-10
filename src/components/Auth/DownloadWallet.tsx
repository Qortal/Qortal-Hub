import {
  Box,
  Checkbox,
  FormControlLabel,
  Typography,
  useTheme,
} from '@mui/material';
import { Spacer } from '../../common/Spacer';
import { Return } from '../../assets/Icons/Return';
import { CustomButton, CustomLabel, TextP } from '../../styles/App-styles';
import { PasswordField } from '../PasswordField/PasswordField';
import { ErrorText } from '../ErrorText/ErrorText';
import Logo1Dark from '../../assets/svgs/Logo1Dark.svg';
import { useTranslation } from 'react-i18next';
import { saveFileToDisk } from '../../utils/generateWallet/generateWallet';
import { useState } from 'react';
import { decryptStoredWallet } from '../../utils/decryptWallet';
import PhraseWallet from '../../utils/generateWallet/phrase-wallet';
import { crypto, walletVersion } from '../../constants/decryptWallet';

export const DownloadWallet = ({
  returnToMain,
  setIsLoading,
  showInfo,
  rawWallet,
  setWalletToBeDownloaded,
  walletToBeDownloaded,
}) => {
  const [walletToBeDownloadedPassword, setWalletToBeDownloadedPassword] =
    useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [keepCurrentPassword, setKeepCurrentPassword] = useState<boolean>(true);
  const theme = useTheme();
  const [walletToBeDownloadedError, setWalletToBeDownloadedError] =
    useState<string>('');

  const { t } = useTranslation(['auth']);

  const saveFileToDiskFunc = async () => {
    try {
      await saveFileToDisk(
        walletToBeDownloaded.wallet,
        walletToBeDownloaded.qortAddress
      );
    } catch (error: any) {
      setWalletToBeDownloadedError(error?.message);
    }
  };

  const saveWalletFunc = async (password: string, newPassword) => {
    let wallet = structuredClone(rawWallet);

    const res = await decryptStoredWallet(password, wallet);
    const wallet2 = new PhraseWallet(res, wallet?.version || walletVersion);
    const passwordToUse = newPassword || password;
    wallet = await wallet2.generateSaveWalletData(
      passwordToUse,
      crypto.kdfThreads,
      () => {}
    );

    setWalletToBeDownloaded({
      wallet,
      qortAddress: rawWallet.address0,
    });

    return {
      wallet,
      qortAddress: rawWallet.address0,
    };
  };

  const confirmPasswordToDownload = async () => {
    try {
      setWalletToBeDownloadedError('');
      if (!keepCurrentPassword && !newPassword) {
        setWalletToBeDownloadedError(
          t('auth:wallet.error.missing_new_password', {
            postProcess: 'capitalize',
          })
        );
        return;
      }
      if (!walletToBeDownloadedPassword) {
        setWalletToBeDownloadedError(
          t('auth:wallet.error.missing_password', { postProcess: 'capitalize' })
        );
        return;
      }
      setIsLoading(true);
      await new Promise<void>((res) => {
        setTimeout(() => {
          res();
        }, 250);
      });
      const newPasswordForWallet = !keepCurrentPassword ? newPassword : null;
      const res = await saveWalletFunc(
        walletToBeDownloadedPassword,
        newPasswordForWallet
      );
    } catch (error: any) {
      setWalletToBeDownloadedError(error?.message);
    } finally {
      setIsLoading(false);
    }
  };

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
          onClick={returnToMain}
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
        <img src={Logo1Dark} className="base-image" />
      </div>

      <Spacer height="35px" />

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
        }}
      >
        <TextP
          sx={{
            textAlign: 'start',
            lineHeight: '24px',
            fontSize: '20px',
            fontWeight: 600,
          }}
        >
          {t('auth:download_account', { postProcess: 'capitalize' })}
        </TextP>
      </Box>

      <Spacer height="35px" />

      {!walletToBeDownloaded && (
        <>
          <CustomLabel htmlFor="standard-adornment-password">
            {t('auth:wallet.password_confirmation', {
              postProcess: 'capitalize',
            })}
          </CustomLabel>

          <Spacer height="5px" />

          <PasswordField
            id="standard-adornment-password"
            value={walletToBeDownloadedPassword}
            onChange={(e) => setWalletToBeDownloadedPassword(e.target.value)}
          />

          <Spacer height="20px" />

          <FormControlLabel
            sx={{
              margin: 0,
            }}
            control={
              <Checkbox
                onChange={(e) => setKeepCurrentPassword(e.target.checked)}
                checked={keepCurrentPassword}
                edge="start"
                tabIndex={-1}
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
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Typography sx={{ fontSize: '14px' }}>
                  {t('auth:wallet.keep_password', {
                    postProcess: 'capitalize',
                  })}
                </Typography>
              </Box>
            }
          />
          <Spacer height="20px" />
          {!keepCurrentPassword && (
            <>
              <CustomLabel htmlFor="standard-adornment-password">
                {t('auth:wallet.new_password', {
                  postProcess: 'capitalize',
                })}
              </CustomLabel>

              <Spacer height="5px" />
              <PasswordField
                id="standard-adornment-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <Spacer height="20px" />
            </>
          )}

          <CustomButton onClick={confirmPasswordToDownload}>
            {t('auth:password_confirmation', {
              postProcess: 'capitalize',
            })}
          </CustomButton>

          <ErrorText>{walletToBeDownloadedError}</ErrorText>
        </>
      )}

      {walletToBeDownloaded && (
        <>
          <CustomButton
            onClick={async () => {
              await saveFileToDiskFunc();
              await showInfo({
                message: t('auth:keep_secure', {
                  postProcess: 'capitalize',
                }),
              });
            }}
          >
            {t('auth:download_account', {
              postProcess: 'capitalize',
            })}
          </CustomButton>
        </>
      )}
    </>
  );
};
