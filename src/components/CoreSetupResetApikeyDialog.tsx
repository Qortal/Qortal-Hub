import * as React from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { useAuth } from '../hooks/useAuth';
import { useAtom } from 'jotai';
import { isOpenDialogResetApikey } from '../atoms/global';

export function CoreSetupResetApikeyDialog() {
  const { authenticate, resetApikey, isNodeValid } = useAuth();
  const [open, setOpen] = useAtom(isOpenDialogResetApikey);
  const resetApikeyFunc = async () => {
    try {
      await resetApikey();
      await isNodeValid();

      await authenticate();
      setOpen(false);
    } catch (error) {}
  };
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
            resetApikey();
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
