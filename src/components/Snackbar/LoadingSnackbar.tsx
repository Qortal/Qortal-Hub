import { useEffect, useRef } from 'react';
import { executeEvent } from '../../utils/events';

export const LoadingSnackbar = ({ open, info }) => {
  const sourceIdRef = useRef(`loading-snackbar-${Math.random().toString(36).slice(2)}`);
  const lastMessageRef = useRef<string | null>(null);

  useEffect(() => {
    if (open && info?.message) {
      if (lastMessageRef.current !== info.message) {
        lastMessageRef.current = info.message;
        executeEvent('openGlobalSnackBar', {
          duration: null,
          message: info.message,
          sourceId: sourceIdRef.current,
          type: 'info',
        });
      }
      return;
    }

    if (lastMessageRef.current != null) {
      executeEvent('closeGlobalSnackBar', {
        sourceId: sourceIdRef.current,
      });
      lastMessageRef.current = null;
    }
  }, [info?.message, open]);

  useEffect(() => {
    return () => {
      if (lastMessageRef.current != null) {
        executeEvent('closeGlobalSnackBar', {
          sourceId: sourceIdRef.current,
        });
      }
    };
  }, []);

  return null;
};
