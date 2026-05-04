import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  useTheme,
} from '@mui/material';
import { useAtom } from 'jotai';
import { isOpenSettingUpLocalCoreAtom } from '../atoms/global';

import { useTranslation } from 'react-i18next';
import { HTTP_LOCALHOST_12391 } from '../constants/constants';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  dialogActionsSx,
  dialogContentSx,
  dialogContentTextSx,
  dialogModalBackdropSx,
  dialogTitleSx,
  getDialogPaperSx,
  getDialogSecondaryButtonSx,
} from './App/dialogSurface';

export function CoreSettingUp() {
  const theme = useTheme();
  const { t } = useTranslation(['node', 'core']);
  const [canContinue, setCanContinue] = useState(false);
  const [open, setOpen] = useAtom(isOpenSettingUpLocalCoreAtom);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isCallingRef = useRef<boolean>(false);

  const continueButtonSx = {
    borderRadius: '11px',
    fontSize: '0.9rem',
    fontWeight: 600,
    minHeight: 42,
    minWidth: 112,
    px: 2.2,
    textTransform: 'none' as const,
    '&.Mui-disabled': {
      backgroundColor: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(169,188,216,0.12)',
      color: 'rgba(214,221,233,0.38)',
    },
  };

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
      // HTTP only: Core exposes /admin/status over HTTP; HTTPS can fail before TLS cert is ready.
      const res = await fetch(`${HTTP_LOCALHOST_12391}/admin/status`);
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
    if (!open?.isShow) return;
    void getStatus();
  }, [open?.isShow, getStatus]);

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

  const titleKey = !canContinue
    ? 'node:NotFullyStarted.titleNotReady'
    : 'node:NotFullyStarted.titleReady';
  const descKey = !canContinue
    ? 'node:NotFullyStarted.descNotReady'
    : 'node:NotFullyStarted.descReady';

  return (
    <Dialog
      open={open?.isShow}
      fullWidth
      maxWidth="sm"
      aria-labelledby="core-setting-up-title"
      slotProps={{
        backdrop: { sx: dialogModalBackdropSx },
        paper: {
          sx: getDialogPaperSx(theme, { maxWidth: 460 }),
        },
      }}
    >
      <DialogTitle id="core-setting-up-title" sx={dialogTitleSx}>
        {t(titleKey, {
          postProcess: 'capitalizeEachFirstChar',
        })}
      </DialogTitle>

      <DialogContent sx={dialogContentSx}>
        {!canContinue ? (
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 2,
              justifyContent: 'flex-start',
            }}
          >
            <Typography sx={dialogContentTextSx}>
              {t(descKey, {
                postProcess: 'capitalizeEachFirstChar',
              })}
            </Typography>
            <CircularProgress
              size={24}
              thickness={5}
              sx={{ color: 'rgba(143,179,246,0.95)', flexShrink: 0 }}
            />
          </Box>
        ) : (
          <Typography sx={dialogContentTextSx}>
            {t(descKey, {
              postProcess: 'capitalizeEachFirstChar',
            })}
          </Typography>
        )}
      </DialogContent>

      <DialogActions sx={dialogActionsSx}>
        <Button
          onClick={() => {
            open?.onCancel(false);
            setOpen(false);
            cleanUp();
          }}
          variant="contained"
          sx={getDialogSecondaryButtonSx(theme)}
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
          sx={continueButtonSx}
        >
          {t('node:actions.continue', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
