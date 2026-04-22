import { useEffect, useRef } from 'react';
import { executeEvent } from '../../utils/events';

export const CustomizedSnackbars = ({
  open,
  setOpen,
  info,
  setInfo,
}) => {
  const lastSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !info?.message) {
      lastSignatureRef.current = null;
      return;
    }

    const signature = JSON.stringify({
      compact: info?.compact ?? false,
      duration: info?.duration ?? undefined,
      message: info?.message,
      type: info?.type ?? 'info',
    });

    if (lastSignatureRef.current === signature) return;
    lastSignatureRef.current = signature;

    executeEvent('openGlobalSnackBar', {
      compact: info?.compact,
      duration: info?.duration,
      message: info?.message,
      type: info?.type,
    });

    setOpen(false);
    setInfo(null);
  }, [
    info?.compact,
    info?.duration,
    info?.message,
    info?.type,
    open,
    setInfo,
    setOpen,
  ]);

  return null;
};
