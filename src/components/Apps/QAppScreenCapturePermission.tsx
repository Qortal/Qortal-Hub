import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

type Request = { requestId: string; origin: string };

export function QAppScreenCapturePermission({ active }: { active: boolean }) {
  const { t } = useTranslation(['question', 'core']);
  const [request, setRequest] = useState<Request | null>(null);
  const pending = useRef<Request | null>(null);
  useEffect(() => {
    const api = window.electronAPI;
    const stop = api?.onDisplayMediaRequest?.((value) => {
      if (!active) {
        api.authorizeDisplayMedia?.(value.requestId, false);
        return;
      }
      pending.current = value;
      setRequest(value);
    });
    const stopCancel = api?.onDisplayMediaCancel?.((id) => {
      if (pending.current?.requestId === id) {
        pending.current = null;
        setRequest(null);
      }
    });
    return () => {
      stop?.();
      stopCancel?.();
      if (pending.current)
        api?.authorizeDisplayMedia?.(pending.current.requestId, false);
      pending.current = null;
      setRequest(null);
    };
  }, [active]);
  const answer = (accepted: boolean) => {
    if (request)
      window.electronAPI?.authorizeDisplayMedia?.(request.requestId, accepted);
    pending.current = null;
    setRequest(null);
  };
  return (
    <Dialog
      open={!!request && active}
      onClose={() => answer(false)}
      maxWidth="sm"
      fullWidth
      aria-labelledby="display-capture-title"
    >
      <DialogTitle id="display-capture-title">
        {t('question:permission.screen_capture_title')}
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ overflowWrap: 'anywhere' }}>
          {t('question:permission.screen_capture_description', {
            origin: request?.origin,
          })}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button autoFocus onClick={() => answer(false)}>
          {t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
        </Button>
        <Button onClick={() => answer(true)}>
          {t('question:permission.notification_allow', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
