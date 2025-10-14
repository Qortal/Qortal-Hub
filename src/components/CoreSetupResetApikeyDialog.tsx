import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { useAuth } from '../hooks/useAuth';
import { useAtom } from 'jotai';
import { isOpenDialogResetApikey } from '../atoms/global';
import { QORTAL_APP_CONTEXT } from '../App';
import { useTranslation } from 'react-i18next';
import { HTTP_LOCALHOST_12391 } from '../constants/constants';
import { useContext, useState } from 'react';

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
  const [newApiKey, setNewApiKey] = useState('');
  const { setOpenSnackGlobal, setInfoSnackCustom } =
    useContext(QORTAL_APP_CONTEXT);
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
        url: HTTP_LOCALHOST_12391,
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
      >
        <DialogTitle id="core-setup-title">
          {t('node:invalidKey.title', {
            postProcess: 'capitalizeFirstChar',
          })}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body1" gutterBottom>
            {t('node:invalidKey.description', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
          <TextField
            placeholder="Apikey"
            value={newApiKey}
            onChange={(e) => setNewApiKey(e.target.value)}
          />
        </DialogContent>

        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setOpen(false)} variant="text">
            {t('core:action.close', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>

          <Button
            disabled={!newApiKey?.trim()}
            onClick={() => {
              insertApikeyFunc();
            }}
            color="success"
            variant="contained"
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
    >
      <DialogTitle id="core-setup-title">
        {' '}
        {t('node:invalidKey.title', {
          postProcess: 'capitalizeFirstChar',
        })}
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body1" gutterBottom>
          {t('node:invalidKey.resetDescription', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button onClick={() => setOpen(false)} variant="text">
          {t('core:action.close', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>

        <Button
          onClick={() => {
            resetApikeyFunc();
          }}
          color="success"
          variant="contained"
        >
          {t('node:actions.resetKey', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
