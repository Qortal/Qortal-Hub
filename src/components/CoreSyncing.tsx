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
import { useAuth } from '../hooks/useAuth';
import { useAtom } from 'jotai';
import { isOpenSyncingDialogAtom } from '../atoms/global';

import { useTranslation } from 'react-i18next';
import { getDefaultLocalNodeUrl } from '../constants/constants';
import { useCallback, useEffect, useRef, useState } from 'react';
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

export function CoreSyncing() {
  const { authenticate, handleSaveNodeInfo } = useAuth();
  const { t } = useTranslation(['node', 'core']);
  const theme = useTheme();
  const [canContinue, setCanContinue] = useState(false);
  const [open, setOpen] = useAtom(isOpenSyncingDialogAtom);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isCallingRef = useRef<boolean>(false);
  const [blocksBehind, setBlocksBehind] = useState(0);
  const cleanUp = useCallback(() => {
    setBlocksBehind(0);
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
      const data = await res.json();
      if (data?.syncPercent === 100) {
        cleanUp();
        setCanContinue(true);
        return false;
      }
      const endpointLastBlock = `${getDefaultLocalNodeUrl()}/blocks/last`;
      const resLastBlock = await fetch(endpointLastBlock);
      const dataLastBlock = await resLastBlock.json();
      const timestampNow = Date.now();
      const currentBlockTimestamp = dataLastBlock.timestamp;

      if (currentBlockTimestamp < timestampNow) {
        const diff = timestampNow - currentBlockTimestamp;
        const inSeconds = diff / 1000;
        const inBlocks = inSeconds / 70;
        const blocksBehind = inBlocks;
        if (inBlocks >= 10) {
          setBlocksBehind(blocksBehind);
        } else {
          setCanContinue(true);
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      isCallingRef.current = false;
    }
  }, [cleanUp]);

  useEffect(() => {
    if (intervalRef.current) return;
    if (open) {
      getStatus();
      intervalRef.current = setInterval(() => getStatus(), 5000);
    }
  }, [getStatus, open]);

  const handleContinue = async (isPublic = false) => {
    try {
      if (isPublic) {
        await handleSaveNodeInfo(null);
        await authenticate(isPublic);
      } else {
        await authenticate(isPublic, true);
      }

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
      open={open}
      fullWidth
      maxWidth="sm"
      aria-labelledby="core-setup-title"
      PaperProps={{
        sx: getDialogPaperSx(theme, { maxWidth: 500 }),
      }}
    >
      {!canContinue && (
        <>
          <DialogTitle id="core-setup-title" sx={dialogTitleSx}>
            {t('node:sync.not_synchronized', {
              postProcess: 'capitalizeEachFirstChar',
            })}
          </DialogTitle>
          <DialogContent sx={dialogContentSx}>
            <Box sx={dialogInfoCardSx}>
              <Typography sx={dialogContentTextSx}>
                {blocksBehind > 0 &&
                  t('node:sync.behind', {
                    count: Number(blocksBehind.toFixed(0)),
                  })}{' '}
                {t('node:sync.waiting')}{' '}
                <CircularProgress
                  size="1.05rem"
                  color="primary"
                  sx={{ ml: 0.35, verticalAlign: 'middle' }}
                />
              </Typography>
            </Box>
            <Typography sx={{ ...dialogContentTextSx, mt: 1.45 }}>
              {t('node:sync.description')}
            </Typography>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'flex-start',
                mt: 1.75,
              }}
            >
              <Button
                onClick={() => {
                  handleContinue(true);
                }}
                variant="contained"
                sx={getDialogPrimaryButtonSx(theme)}
              >
                {t('node:actions.continuePublic', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Button>
            </Box>
          </DialogContent>
        </>
      )}

      {canContinue && (
        <>
          <DialogTitle id="core-setup-title" sx={dialogTitleSx}>
            {t('node:sync.synchronized', {
              postProcess: 'capitalizeEachFirstChar',
            })}
          </DialogTitle>
          <DialogContent sx={dialogContentSx}>
            <Box sx={dialogInfoCardSx}>
              <Typography sx={dialogContentTextSx}>
                {t('node:sync.synchronized_desc', {
                  postProcess: 'capitalizeFirstWord',
                })}
              </Typography>
            </Box>
          </DialogContent>
        </>
      )}

      <DialogActions sx={dialogActionsSx}>
        <Button
          onClick={() => {
            setOpen(false);
            cleanUp();
          }}
          variant="outlined"
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
          variant="contained"
          sx={getDialogPrimaryButtonSx(theme)}
        >
          {t('node:actions.continueLocal', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
