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

export type StepStatus = 'idle' | 'active' | 'done' | 'error';

export interface StepState {
  status: StepStatus;
  /** 0..100; if omitted, inferred from status (done=>100, idle=>0) */
  progress?: number;
  /** Optional small helper text under the progress bar */
  message?: string;
}

interface CoreSetupRecommendationDialogProps {
  open: boolean;
  onClose: () => void;
  openLocalSetup: () => void;
  setOpenCoreHandler: (val: boolean) => void;
}

export function CoreSetupRecommendationDialog(
  props: CoreSetupRecommendationDialogProps
) {
  const { open, onClose, setOpenCoreHandler } = props;
  const { handleSaveNodeInfo, authenticate } = useAuth();

  const proceedWithPublic = async () => {
    try {
      await handleSaveNodeInfo(null);
      await authenticate();
    } catch (error) {}
  };
  return (
    <Dialog
      open={open}
      fullWidth
      maxWidth="sm"
      aria-labelledby="core-setup-title"
    >
      <DialogTitle id="core-setup-title">Using your local Node</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body1" gutterBottom>
          You may proceed with the public node if you wish, but we strongly
          recommend using your local node for the best experience.
        </Typography>

        <Typography variant="subtitle1" gutterBottom>
          Advantages of using your local node:
        </Typography>
        <ul>
          <li>Full decentralized access</li>
          <li>Faster downloads</li>
          <li>User-controlled data</li>
        </ul>

        <Typography variant="body2" color="text.secondary">
          The public node you connect to is actually a privately operated node
          that has been made publicly accessible. While convenient, it comes
          with certain limitations compared to running your own.
        </Typography>
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button onClick={proceedWithPublic} variant="text">
          Continue with public node
        </Button>

        <Button
          onClick={() => {
            setOpenCoreHandler(true);
            onClose();
          }}
          color="success"
          variant="contained"
        >
          Open local setup
        </Button>
      </DialogActions>
    </Dialog>
  );
}
