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
import { useTranslation } from 'react-i18next';

export type StepStatus = 'idle' | 'active' | 'done' | 'error';
const isElectron = !!window?.coreSetup;
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
  const { t } = useTranslation(['node']);

  const proceedWithPublic = async () => {
    try {
      await handleSaveNodeInfo(null);
      await authenticate();
    } catch (error) {
      console.error(error);
    } finally {
      onClose();
    }
  };
  return (
    <Dialog
      open={open}
      fullWidth
      maxWidth="sm"
      aria-labelledby="core-setup-title"
    >
      <DialogTitle id="core-setup-title">
        {t('node:recommendation.title', {
          postProcess: 'capitalizeFirstChar',
        })}
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body1" gutterBottom>
          {t('node:recommendation.description', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>

        <Typography variant="subtitle1" gutterBottom>
          {t('node:recommendation.subTitle', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
        <ul>
          <li>
            {' '}
            {t('node:recommendation.point1', {
              postProcess: 'capitalizeFirstChar',
            })}
          </li>
          <li>
            {' '}
            {t('node:recommendation.point2', {
              postProcess: 'capitalizeFirstChar',
            })}
          </li>
          <li>
            {t('node:recommendation.point3', {
              postProcess: 'capitalizeFirstChar',
            })}
          </li>
        </ul>

        <Typography variant="body2" color="text.secondary">
          {t('node:recommendation.publicExplanation', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button onClick={proceedWithPublic} variant="text">
          {t('node:actions.continuePublic', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>
        {isElectron ? (
          <Button
            onClick={() => {
              setOpenCoreHandler(true);
              onClose();
            }}
            color="success"
            variant="contained"
          >
            {t('node:actions.openSetup', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
        ) : (
          <Button
            onClick={() => {
              window.open('https://qortal.dev/downloads', '_system');
              onClose();
            }}
            color="success"
            variant="contained"
          >
            {t('node:actions.goToDownloads', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
