import * as React from 'react';
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

const isElectron = !!window?.coreSetup;

export function CoreSetupResetApikeyDialog() {
  const {
    authenticate,
    resetApikey,
    isNodeValid,
    validateLocalApiKey,
    handleSaveNodeInfo,
  } = useAuth();
  const [newApiKey, setNewApiKey] = React.useState('');
  const { setOpenSnackGlobal, setInfoSnackCustom } =
    React.useContext(QORTAL_APP_CONTEXT);
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
          message: 'Invalid apikey',
        });
        return;
      }
      await handleSaveNodeInfo({
        url: 'http://127.0.0.1:12391',
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
        <DialogTitle id="core-setup-title">Invalid apikey</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body1" gutterBottom>
            Your apikey is invalid. Please insert a valid apikey.
          </Typography>
          <TextField
            placeholder="Apikey"
            value={newApiKey}
            onChange={(e) => setNewApiKey(e.target.value)}
          />
        </DialogContent>

        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setOpen(false)} variant="text">
            close
          </Button>

          <Button
            disabled={!newApiKey?.trim()}
            onClick={() => {
              insertApikeyFunc();
            }}
            color="success"
            variant="contained"
          >
            Reset apikey
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
      <DialogTitle id="core-setup-title">Invalid apikey</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body1" gutterBottom>
          Your apikey is invalid. Click reset to proceed.
        </Typography>
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button onClick={() => setOpen(false)} variant="text">
          close
        </Button>

        <Button
          onClick={() => {
            resetApikeyFunc();
          }}
          color="success"
          variant="contained"
        >
          Reset apikey
        </Button>
      </DialogActions>
    </Dialog>
  );
}
