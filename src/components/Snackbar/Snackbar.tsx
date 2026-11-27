import { useEffect, useRef } from 'react';
import { executeEvent } from '../../utils/events';

const getSnackbarDisplayMessage = (message: unknown) => {
  if (typeof message !== 'string') return message;

  if (
    /transaction\s+invalid/i.test(message) &&
    /account\s+is\s+not\s+a\s+group\s+member/i.test(message)
  ) {
    return 'Invalid transaction. Account is not a group member.';
  }

  return message;
};

export const CustomizedSnackbars = ({ open, setOpen, info, setInfo }) => {
  const lastSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !info?.message) {
      lastSignatureRef.current = null;
      return;
    }

    const displayMessage = getSnackbarDisplayMessage(info.message);
    const signature = JSON.stringify({
      compact: info?.compact ?? false,
      duration: info?.duration ?? undefined,
      message: displayMessage,
      type: info?.type ?? 'info',
    });

    if (lastSignatureRef.current === signature) return;
    lastSignatureRef.current = signature;

    executeEvent('openGlobalSnackBar', {
      compact: info?.compact,
      duration: info?.duration,
      message: displayMessage,
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
