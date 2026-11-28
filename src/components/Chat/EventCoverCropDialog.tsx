import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Slider,
  Typography,
  useTheme,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type EventCoverDraft = {
  base64: string;
  fileName: string;
  height: number;
  mimeType: 'image/webp';
  sizeBytes: number;
  width: number;
};

type Props = {
  file: File | null;
  open: boolean;
  onApply: (draft: EventCoverDraft) => void;
  onClose: () => void;
};

const OUTPUT_WIDTH = 1200;
const OUTPUT_HEIGHT = 675;
const TARGET_BYTES = 500 * 1024;
const ACTIVE_BLUE = '#2563eb';
const ACTIVE_BLUE_HOVER = '#1e40af';

const nextTask = () =>
  new Promise<void>((resolve) => window.setTimeout(resolve, 0));

const base64ByteLength = (base64: string) => {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
};

export function EventCoverCropDialog({ file, open, onApply, onClose }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const compressionOperationRef = useRef(0);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const objectUrl = useMemo(
    () => (file && open ? URL.createObjectURL(file) : ''),
    [file, open]
  );

  useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl]
  );

  useEffect(() => {
    compressionOperationRef.current += 1;
    setWorking(false);
    if (!open) return;
    setZoom(1);
    setPosition({ x: 0, y: 0 });
    setNaturalSize({ width: 0, height: 0 });
    setError('');
  }, [file, open]);

  const close = () => {
    compressionOperationRef.current += 1;
    setWorking(false);
    onClose();
  };

  const clampPosition = (next: { x: number; y: number }, nextZoom = zoom) => {
    const stage = stageRef.current;
    if (!stage || !naturalSize.width || !naturalSize.height) return next;
    const scale =
      Math.max(
        stage.clientWidth / naturalSize.width,
        stage.clientHeight / naturalSize.height
      ) * nextZoom;
    const maxX = Math.max(
      0,
      (naturalSize.width * scale - stage.clientWidth) / 2
    );
    const maxY = Math.max(
      0,
      (naturalSize.height * scale - stage.clientHeight) / 2
    );
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  };

  useEffect(() => {
    setPosition((current) => clampPosition(current));
    // Position is deliberately excluded: this effect only responds to scale.
  }, [naturalSize.height, naturalSize.width, zoom]);

  const apply = async () => {
    const image = imageRef.current;
    const stage = stageRef.current;
    if (!file || !image || !stage || !naturalSize.width || !naturalSize.height)
      return;
    const operationId = ++compressionOperationRef.current;
    setWorking(true);
    setError('');
    try {
      const scale =
        Math.max(
          stage.clientWidth / naturalSize.width,
          stage.clientHeight / naturalSize.height
        ) * zoom;
      const sourceWidth = stage.clientWidth / scale;
      const sourceHeight = stage.clientHeight / scale;
      const sourceX = Math.max(
        0,
        Math.min(
          naturalSize.width - sourceWidth,
          naturalSize.width / 2 - position.x / scale - sourceWidth / 2
        )
      );
      const sourceY = Math.max(
        0,
        Math.min(
          naturalSize.height - sourceHeight,
          naturalSize.height / 2 - position.y / scale - sourceHeight / 2
        )
      );
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_WIDTH;
      canvas.height = OUTPUT_HEIGHT;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context)
        throw new Error(t('core:calendar.imageProcessingUnavailable'));
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        OUTPUT_WIDTH,
        OUTPUT_HEIGHT
      );

      let compressedBase64 = '';
      let compressedSize = 0;
      for (const quality of [0.78, 0.68, 0.58, 0.5, 0.42, 0.34, 0.28]) {
        await nextTask();
        if (compressionOperationRef.current !== operationId) return;
        const dataUrl = canvas.toDataURL('image/webp', quality);
        const prefix = 'data:image/webp;base64,';
        if (!dataUrl.startsWith(prefix)) {
          throw new Error(t('core:calendar.coverCompressFailed'));
        }
        compressedBase64 = dataUrl.slice(prefix.length);
        compressedSize = base64ByteLength(compressedBase64);
        if (compressedSize <= TARGET_BYTES) break;
      }
      if (!compressedBase64) {
        throw new Error(t('core:calendar.coverCompressFailed'));
      }
      if (compressedSize > 600 * 1024) {
        throw new Error(t('core:calendar.coverCompressTooLarge'));
      }
      if (compressionOperationRef.current !== operationId) return;
      const baseName =
        file.name.replace(/\.[^.]+$/, '').trim() || 'event-cover';
      onApply({
        base64: compressedBase64,
        fileName: `${baseName}.webp`,
        height: OUTPUT_HEIGHT,
        mimeType: 'image/webp',
        sizeBytes: compressedSize,
        width: OUTPUT_WIDTH,
      });
    } catch (reason) {
      if (compressionOperationRef.current !== operationId) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      setWorking(false);
    }
  };

  const baseScale =
    naturalSize.width && naturalSize.height && stageRef.current
      ? Math.max(
          stageRef.current.clientWidth / naturalSize.width,
          stageRef.current.clientHeight / naturalSize.height
        )
      : 1;

  return (
    <Dialog
      fullWidth
      maxWidth="sm"
      open={open}
      onClose={(_event, reason) => {
        if (reason !== 'backdropClick') close();
      }}
      PaperProps={{
        sx: {
          bgcolor: 'background.paper',
          backgroundImage: 'none',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: '10px',
          overflow: 'hidden',
        },
      }}
    >
      <DialogTitle sx={{ alignItems: 'center', display: 'flex', px: 3, py: 2 }}>
        <Typography fontSize={20} fontWeight={700} sx={{ flex: 1 }}>
          {t('core:calendar.editCover')}
        </Typography>
        <IconButton onClick={close} size="small">
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ px: 3, py: 1 }}>
        <Box
          ref={stageRef}
          onPointerDown={(event) => {
            if (!naturalSize.width) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              originX: position.x,
              originY: position.y,
            };
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            setPosition(
              clampPosition({
                x: drag.originX + event.clientX - drag.startX,
                y: drag.originY + event.clientY - drag.startY,
              })
            );
          }}
          onPointerUp={(event) => {
            if (dragRef.current?.pointerId === event.pointerId) {
              dragRef.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          sx={{
            aspectRatio: '16 / 9',
            bgcolor: theme.palette.mode === 'dark' ? '#14161b' : '#dde1e7',
            borderRadius: '8px',
            cursor: naturalSize.width ? 'grab' : 'default',
            overflow: 'hidden',
            position: 'relative',
            touchAction: 'none',
            userSelect: 'none',
            width: '100%',
            '&:active': { cursor: naturalSize.width ? 'grabbing' : 'default' },
          }}
        >
          {objectUrl && (
            <Box
              alt={t('core:calendar.coverCropLabel')}
              component="img"
              draggable={false}
              onLoad={(event) => {
                const image = event.currentTarget;
                imageRef.current = image;
                setNaturalSize({
                  height: image.naturalHeight,
                  width: image.naturalWidth,
                });
              }}
              src={objectUrl}
              sx={{
                height: naturalSize.height || 'auto',
                left: '50%',
                maxWidth: 'none',
                pointerEvents: 'none',
                position: 'absolute',
                top: '50%',
                transform: `translate(-50%, -50%) translate(${position.x}px, ${position.y}px) scale(${baseScale * zoom})`,
                transformOrigin: 'center',
                width: naturalSize.width || 'auto',
              }}
            />
          )}
          <Box
            aria-hidden="true"
            sx={{
              border: '2px solid rgba(255,255,255,0.9)',
              borderRadius: '6px',
              inset: 0,
              pointerEvents: 'none',
              position: 'absolute',
            }}
          />
        </Box>
        <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.5, mt: 2.5 }}>
          <ImageOutlinedIcon color="disabled" fontSize="small" />
          <Slider
            aria-label={t('core:calendar.coverZoom')}
            disabled={!naturalSize.width || working}
            max={3}
            min={1}
            onChange={(_event, value) => setZoom(value as number)}
            step={0.01}
            value={zoom}
          />
          <ZoomInRoundedIcon color="action" />
        </Box>
        {error && (
          <Typography color="error" fontSize={13} sx={{ mt: 1 }}>
            {error}
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 3, py: 2.5 }}>
        <Button
          disabled={working}
          onClick={() => {
            setZoom(1);
            setPosition({ x: 0, y: 0 });
          }}
          sx={{
            color: theme.palette.common.white,
            fontWeight: 600,
            textTransform: 'none',
            '&:hover': {
              backgroundColor: 'transparent',
              color: theme.palette.common.white,
            },
          }}
        >
          {t('core:calendar.resetCover')}
        </Button>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            onClick={close}
            sx={{
              backgroundColor: '#292e37',
              border: '1px solid #3a414d',
              borderRadius: '8px',
              color: theme.palette.common.white,
              fontWeight: 600,
              minHeight: 38,
              minWidth: 88,
              textTransform: 'none',
              '&:hover': {
                backgroundColor: '#343a45',
                color: theme.palette.common.white,
              },
            }}
          >
            {t('core:action.cancel', 'Cancel')}
          </Button>
          <Button
            disabled={working || !naturalSize.width}
            onClick={() => void apply()}
            sx={{
              backgroundColor: ACTIVE_BLUE,
              border: 0,
              borderRadius: '8px',
              color: theme.palette.common.white,
              fontWeight: 600,
              minHeight: 38,
              minWidth: 88,
              textTransform: 'none',
              '&:hover': {
                backgroundColor: ACTIVE_BLUE_HOVER,
                color: theme.palette.common.white,
              },
              '&.Mui-disabled': {
                backgroundColor: 'rgba(37, 99, 235, 0.34)',
                color: 'rgba(255, 255, 255, 0.48)',
              },
            }}
          >
            {working
              ? t('core:calendar.compressingCover')
              : t('core:calendar.applyCover')}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
