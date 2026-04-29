import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  useTheme,
} from '@mui/material';
import { useAuth } from '../hooks/useAuth';
import { useAtom, useSetAtom } from 'jotai';
import {
  infoSnackGlobalAtom,
  isOpenDialogResetApikey,
  openSnackGlobalAtom,
} from '../atoms/global';
import { useTranslation } from 'react-i18next';
import { getDefaultLocalNodeUrl } from '../constants/constants';
import { useState } from 'react';
import { AuthInput, AuthSectionLabel } from './Auth/AuthShell';
import {
  dialogActionsSx,
  dialogContentSx,
  dialogContentTextSx,
  dialogInfoCardSx,
  dialogTitleSx,
  getDialogPaperSx,
  getDialogPrimaryButtonSx,
  getDialogSecondaryButtonSx,
} from './App/dialogSurface';

const isElectron = !!window?.coreSetup;

export function CoreSetupResetApikeyDialog() {
  const {
    authenticate,
    resetApikey,
    isNodeValid,
    validateLocalApiKey,
    handleSaveNodeInfo,
  } = useAuth();
  const { t } = useTranslation(['node', 'core']);
  const theme = useTheme();
  const [newApiKey, setNewApiKey] = useState('');
  const setOpenSnackGlobal = useSetAtom(openSnackGlobalAtom);
  const setInfoSnackCustom = useSetAtom(infoSnackGlobalAtom);
  const [open, setOpen] = useAtom(isOpenDialogResetApikey);
  const resetApikeyFunc = async () => {
    try {
      await resetApikey();
      await isNodeValid();

      await authenticate();
      setOpen(false);
    } catch (error) {}
  };

  const insertApikeyFunc = async () => {
    try {
      const res = await validateLocalApiKey(newApiKey);
      if (!res) {
        setOpenSnackGlobal(true);
        setInfoSnackCustom({
          type: 'error',
          message: t('node:error.invalidKey', {
            postProcess: 'capitalizeFirstChar',
          }),
        });
        return;
      }
      await handleSaveNodeInfo({
        url: getDefaultLocalNodeUrl(),
        apikey: newApiKey,
      });

      await authenticate();
      setOpen(false);
    } catch (error) {
      console.log('error', error);
    }
  };

  if (!isElectron) {
    return (
      <Dialog
        open={open}
        fullWidth
        maxWidth="sm"
        aria-labelledby="core-setup-title"
        slotProps={{
          paper: {
            sx: getDialogPaperSx(theme, { maxWidth: 460 }),
          },
        }}
      >
        <DialogTitle id="core-setup-title" sx={dialogTitleSx}>
          {t('node:invalidKey.title', {
            postProcess: 'capitalizeFirstChar',
          })}
        </DialogTitle>
        <DialogContent sx={dialogContentSx}>
          <Box sx={dialogInfoCardSx}>
            <Typography sx={dialogContentTextSx}>
              {t('node:invalidKey.description', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </Box>
          <Box sx={{ mt: 1.75 }}>
            <AuthSectionLabel>API key</AuthSectionLabel>
            <AuthInput
              autoFocus
              placeholder="Apikey"
              value={newApiKey}
              onChange={(e) => setNewApiKey(e.target.value)}
            />
          </Box>
        </DialogContent>

        <DialogActions sx={dialogActionsSx}>
          <Button
            onClick={() => setOpen(false)}
            variant="outlined"
            sx={getDialogSecondaryButtonSx(theme)}
          >
            {t('core:action.close', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>

          <Button
            disabled={!newApiKey?.trim()}
            onClick={() => {
              insertApikeyFunc();
            }}
            variant="contained"
            sx={getDialogPrimaryButtonSx(theme)}
          >
            {t('node:actions.resetKey', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
        </DialogActions>
      </Dialog>
    );
  }
  return (
    <Dialog
      open={open}
      fullWidth
      maxWidth="sm"
      aria-labelledby="core-setup-title"
      slotProps={{
        paper: {
          sx: getDialogPaperSx(theme, { maxWidth: 460 }),
        },
      }}
    >
      <DialogTitle id="core-setup-title" sx={dialogTitleSx}>
        {t('node:invalidKey.title', {
          postProcess: 'capitalizeFirstChar',
        })}
      </DialogTitle>
      <DialogContent sx={dialogContentSx}>
        <Box sx={dialogInfoCardSx}>
          <Typography sx={dialogContentTextSx}>
            {t('node:invalidKey.resetDescription', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </Box>
      </DialogContent>

      <DialogActions sx={dialogActionsSx}>
        <Button
          onClick={() => setOpen(false)}
          variant="outlined"
          sx={getDialogSecondaryButtonSx(theme)}
        >
          {t('core:action.close', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>

        <Button
          onClick={() => {
            resetApikeyFunc();
          }}
          variant="contained"
          sx={getDialogPrimaryButtonSx(theme)}
        >
          {t('node:actions.resetKey', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
