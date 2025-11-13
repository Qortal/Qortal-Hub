import { Box, Modal, useTheme } from '@mui/material';
import type { MouseEvent, SyntheticEvent } from 'react';
type AvatarPreviewModalProps = {
  alt?: string;
  onClose: () => void;
  open: boolean;
  src?: string | null;
};
export const AvatarPreviewModal = ({
  alt,
  onClose,
  open,
  src,
}: AvatarPreviewModalProps) => {
  const theme = useTheme();
  if (!src) {
    return null;
  }
  const stopEvent = (event?: Event | SyntheticEvent | null) => {
    if (!event) return;
    if ('preventDefault' in event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    if ('stopPropagation' in event && typeof event.stopPropagation === 'function') {
      event.stopPropagation();
    }
    const nativeEvent =
      'nativeEvent' in event ? (event as SyntheticEvent).nativeEvent : null;
    if (
      nativeEvent &&
      'stopImmediatePropagation' in nativeEvent &&
      typeof nativeEvent.stopImmediatePropagation === 'function'
    ) {
      nativeEvent.stopImmediatePropagation();
    }
  };
  const handleClose = (
    event?: Event | SyntheticEvent | null,
    _reason?: 'backdropClick' | 'escapeKeyDown'
  ) => {
    stopEvent(event);
    onClose();
  };
  return (
    <Modal open={open} onClose={handleClose}>
      <Box
        onClick={(event: MouseEvent<HTMLDivElement>) => {
          handleClose(event, 'backdropClick');
        }}
        sx={{
          alignItems: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          cursor: 'zoom-out',
          display: 'flex',
          height: '100vh',
          justifyContent: 'center',
          left: 0,
          padding: theme.spacing(4),
          position: 'fixed',
          top: 0,
          width: '100vw',
          zIndex: theme.zIndex.modal,
        }}
      >
        <img
          src={src}
          alt={alt || ''}
          style={{
            maxHeight: '90vh',
            maxWidth: '90vw',
            objectFit: 'contain',
          }}
        />
      </Box>
    </Modal>
  );
};
