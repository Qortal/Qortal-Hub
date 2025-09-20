import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { useAuth } from '../hooks/useAuth';
import { useAtom } from 'jotai';
import { isOpenSyncingDialogAtom } from '../atoms/global';

import { useTranslation } from 'react-i18next';
import { HTTP_LOCALHOST_12391 } from '../constants/constants';
import { useCallback, useEffect, useRef, useState } from 'react';

export function CoreSyncing() {
  const { authenticate } = useAuth();
  const { t } = useTranslation(['node', 'core']);
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
      const endpointLastBlock = `${HTTP_LOCALHOST_12391}/blocks/last`;
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
      intervalRef.current = setInterval(() => getStatus(), 5000);
    }
  }, [getStatus, open]);

  const handleContinue = async () => {
    try {
      await authenticate();

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
    >
      {!canContinue && (
        <>
          <DialogTitle id="core-setup-title">
            {t('node:sync.not_syncronized', {
              postProcess: 'capitalizeEachFirstChar',
            })}
          </DialogTitle>
          <DialogContent dividers>
            <Typography variant="body1" gutterBottom>
              {blocksBehind > 0 &&
                t('node:sync.behind', {
                  count: Number(blocksBehind.toFixed(0)),
                })}{' '}
              {t('node:sync.waiting')}{' '}
              <CircularProgress size="1.2rem" color="primary" />
            </Typography>
          </DialogContent>
        </>
      )}

      {canContinue && (
        <>
          <DialogTitle id="core-setup-title">
            {t('node:sync.syncronized', {
              postProcess: 'capitalizeEachFirstChar',
            })}
          </DialogTitle>
          <DialogContent dividers>
            <Typography variant="body1" gutterBottom>
              {t('node:sync.syncronized_desc', {
                postProcess: 'capitalizeFirstWord',
              })}
            </Typography>
          </DialogContent>
        </>
      )}

      <DialogActions sx={{ p: 2 }}>
        <Button
          onClick={() => {
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
