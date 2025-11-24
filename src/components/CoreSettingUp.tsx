import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { useAtom } from 'jotai';
import { isOpenSettingUpLocalCoreAtom } from '../atoms/global';

import { useTranslation } from 'react-i18next';
import { HTTP_LOCALHOST_12391 } from '../constants/constants';
import { useCallback, useEffect, useRef, useState } from 'react';

export function CoreSettingUp() {
  const { t } = useTranslation(['node', 'core']);
  const [canContinue, setCanContinue] = useState(false);
  const [open, setOpen] = useAtom(isOpenSettingUpLocalCoreAtom);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isCallingRef = useRef<boolean>(false);

  const cleanUp = useCallback(() => {
    setCanContinue(false);
    isCallingRef.current = false;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const getStatus = useCallback(async () => {
    try {
      if (isCallingRef.current) return;
      isCallingRef.current = true;
      const res = await fetch(HTTP_LOCALHOST_12391 + '/admin/status');
      if (!res?.ok) return false;

      cleanUp();
      setCanContinue(true);
      return false;
    } catch (error) {
      console.error(error);
    } finally {
      isCallingRef.current = false;
    }
  }, [cleanUp]);

  useEffect(() => {
    if (intervalRef.current) return;
    if (open?.isShow) {
      intervalRef.current = setInterval(() => getStatus(), 5000);
    }
  }, [getStatus, open?.isShow]);

  const handleContinue = async () => {
    try {
      await open?.onOk(true);

      setOpen(false);
      return;
    } catch (error) {
      console.error(error);
    } finally {
      cleanUp();
    }
  };
  return (
    <Dialog
      open={open?.isShow}
      fullWidth
      maxWidth="sm"
      aria-labelledby="core-setup-title"
    >
      {!canContinue && (
        <>
          <DialogTitle id="core-setup-title">
            {t('node:NotFullyStarted.titleNotReady', {
              postProcess: 'capitalizeEachFirstChar',
            })}
          </DialogTitle>
          <DialogContent dividers>
            <Typography variant="body1" gutterBottom>
              {t('node:NotFullyStarted.descNotReady', {
                postProcess: 'capitalizeEachFirstChar',
              })}
              <CircularProgress size="1.2rem" color="primary" />
            </Typography>
          </DialogContent>
        </>
      )}

      {canContinue && (
        <>
          <DialogTitle id="core-setup-title">
            {t('node:NotFullyStarted.titleReady', {
              postProcess: 'capitalizeEachFirstChar',
            })}
          </DialogTitle>
          <DialogContent dividers>
            <Typography variant="body1" gutterBottom>
              {t('node:NotFullyStarted.descReady', {
                postProcess: 'capitalizeEachFirstChar',
              })}
            </Typography>
          </DialogContent>
        </>
      )}

      <DialogActions sx={{ p: 2 }}>
        <Button
          onClick={() => {
            open?.onCancel(false);
            setOpen(false);
            cleanUp();
          }}
          variant="text"
        >
          {t('core:action.close', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>

        <Button
          onClick={() => {
            handleContinue();
          }}
          disabled={!canContinue}
          color="success"
          variant="contained"
        >
          {t('node:actions.continue', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
