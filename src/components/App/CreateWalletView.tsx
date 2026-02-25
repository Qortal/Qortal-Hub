import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Trans, useTranslation } from 'react-i18next';
import { RefObject } from 'react';
import { Return } from '../../assets/Icons/Return.tsx';
import Logo1Dark from '../../assets/svgs/Logo1Dark.svg';
import { Spacer } from '../../common/Spacer';
import { CustomButton, CustomLabel, TextP } from '../../styles/App-styles.ts';
import { ErrorText, PasswordField } from '../index';
import { SuccessIcon } from '../../assets/Icons/SuccessIcon.tsx';
import WarningIcon from '@mui/icons-material/Warning';

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
  exportSeedphrase: () => void;
};

export function CreateWalletView({
  creationStep,
  walletToBeDownloaded,
  walletToBeDownloadedPassword,
  walletToBeDownloadedPasswordConfirm,
  walletToBeDownloadedError,
  showSeed,
  storeAccount,
  generatorRef,
  confirmRef,
  onReturnBack,
  onShowSeed,
  onHideSeed,
  onCreationStepNext,
  setWalletToBeDownloadedPassword,
  setWalletToBeDownloadedPasswordConfirm,
  setStoredAccount,
  onCreateAccount,
  onBackupAccountConfirm,
  exportSeedphrase,
}: CreateWalletViewProps) {
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core']);

  return (
    <>
      {!walletToBeDownloaded && (
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
              style={{ cursor: 'pointer', height: '24px', width: 'auto' }}
              onClick={onReturnBack}
            />
          </Box>
          <Spacer height="15px" />
          <div
            className="image-container"
            style={{ width: '136px', height: '154px' }}
          >
            <img src={Logo1Dark} className="base-image" alt="Qortal" />
          </div>
          <Spacer height="38px" />
          <TextP
            sx={{
              textAlign: 'center',
              lineHeight: 1.2,
              fontSize: '18px',
            }}
          >
            {t('auth:action.setup_qortal_account', {
              postProcess: 'capitalizeFirstChar',
            })}
          </TextP>
          <Spacer height="14px" />
          <Box
            sx={{
              display: 'flex',
              maxWidth: '100%',
              justifyContent: 'center',
              padding: '10px',
            }}
          >
            <Box
              sx={{
                alignItems: 'center',
                display: creationStep === 1 ? 'flex' : 'none',
                flexDirection: 'column',
                maxWidth: '95%',
                width: '350px',
              }}
            >
              <Typography sx={{ fontSize: '14px' }}>
                <Trans
                  ns="auth"
                  i18nKey="message.generic.seedphrase_notice"
                  components={{
                    seed: (
                      <span
                        onClick={onShowSeed}
                        style={{
                          fontSize: '14px',
                          color: 'steelblue',
                          cursor: 'pointer',
                        }}
                      />
                    ),
                  }}
                  tOptions={{ postProcess: ['capitalizeFirstChar'] }}
                />
              </Typography>
              <Typography sx={{ fontSize: '14px', marginTop: '5px' }}>
                {t('auth:tips.view_seedphrase', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
              <Typography
                sx={{ fontSize: '18px', marginTop: '15px', textAlign: 'center' }}
              >
                <Trans
                  i18nKey="action.create_qortal_account"
                  ns="auth"
                  components={{
                    next: <span style={{ fontWeight: 'bold' }} />,
                  }}
                  tOptions={{ postProcess: ['capitalizeFirstChar'] }}
                />
              </Typography>
              <Spacer height="17px" />
              <CustomButton onClick={onCreationStepNext}>
                {t('core:pagination.next', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </CustomButton>
            </Box>
            <div style={{ display: 'none' }}>
              {/* @ts-expect-error custom element from randomSentenceGenerator */}
              <random-sentence-generator
                ref={generatorRef}
                template="adverb verb noun adjective noun adverb verb noun adjective noun adjective verbed adjective noun"
              />
            </div>
            <Dialog
              open={showSeed}
              aria-labelledby="alert-dialog-title"
              aria-describedby="alert-dialog-description"
            >
              <DialogContent>
                <Box
                  sx={{
                    alignItems: 'center',
                    display: showSeed ? 'flex' : 'none',
                    flexDirection: 'column',
                    gap: '10px',
                    maxWidth: '400px',
                  }}
                >
                  <Typography sx={{ fontSize: '14px' }}>
                    {t('auth:seed_your', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                  <Box
                    sx={{
                      background: theme.palette.background.paper,
                      borderRadius: '8px',
                      padding: '10px',
                      textAlign: 'center',
                      width: '100%',
                    }}
                  >
                    {generatorRef.current?.parsedString}
                  </Box>
                  <CustomButton
                    sx={{ padding: '7px', fontSize: '12px' }}
                    onClick={exportSeedphrase}
                  >
                    {t('auth:action.export_seedphrase', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </CustomButton>
                </Box>
              </DialogContent>
              <DialogActions>
                <Button variant="contained" onClick={onHideSeed}>
                  {t('core:action.close', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>
              </DialogActions>
            </Dialog>
          </Box>
          <Box
            sx={{
              display: creationStep === 2 ? 'flex' : 'none',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <Spacer height="14px" />
            <CustomLabel htmlFor="standard-adornment-password">
              {t('auth:wallet.password', {
                postProcess: 'capitalizeFirstChar',
              })}
            </CustomLabel>
            <Spacer height="5px" />
            <PasswordField
              id="standard-adornment-password"
              value={walletToBeDownloadedPassword}
              onChange={(e) => setWalletToBeDownloadedPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmRef.current?.focus();
              }}
            />
            <Spacer height="5px" />
            <CustomLabel htmlFor="standard-adornment-password-confirm">
              {t('auth:wallet.password_confirmation', {
                postProcess: 'capitalizeFirstChar',
              })}
            </CustomLabel>
            <Spacer height="5px" />
            <PasswordField
              inputRef={confirmRef}
              id="standard-adornment-password-confirm"
              value={walletToBeDownloadedPasswordConfirm}
              onChange={(e) =>
                setWalletToBeDownloadedPasswordConfirm(e.target.value)
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCreateAccount();
              }}
            />
            <Spacer height="5px" />
            <Typography variant="body2">
              {t('auth:message.generic.no_minimum_length', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
            <Spacer height="5px" />
            <FormControlLabel
              sx={{ margin: 0 }}
              control={
                <Checkbox
                  onChange={(e) => setStoredAccount(e.target.checked)}
                  checked={storeAccount}
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
                    {t('auth:store_account', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                </Box>
              }
            />
            <Spacer height="17px" />
            <CustomButton onClick={onCreateAccount}>
              {t('auth:action.create_account', {
                postProcess: 'capitalizeFirstChar',
              })}
            </CustomButton>
          </Box>
          <ErrorText>{walletToBeDownloadedError}</ErrorText>
        </>
      )}
      {walletToBeDownloaded && (
        <>
          <Spacer height="48px" />
          <SuccessIcon />
          <Spacer height="45px" />
          <TextP
            sx={{
              textAlign: 'center',
              lineHeight: '15px',
            }}
          >
            {t('auth:message.generic.congrats_setup', {
              postProcess: 'capitalizeFirstChar',
            })}
          </TextP>
          <Spacer height="50px" />
          <Box
            sx={{
              display: 'flex',
              gap: '15px',
              alignItems: 'center',
              padding: '10px',
            }}
          >
            <WarningIcon color="warning" />
            <Typography>
              {t('auth:tips.safe_place', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </Box>
          <Spacer height="50px" />
          <CustomButton onClick={onBackupAccountConfirm}>
            {t('core:action.backup_account', {
              postProcess: 'capitalizeFirstChar',
            })}
          </CustomButton>
        </>
      )}
    </>
  );
}
