import { useRef, useState } from 'react';
import {
  alpha,
  Box,
  Button,
  IconButton,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import AddPhotoAlternateRoundedIcon from '@mui/icons-material/AddPhotoAlternateRounded';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import PhotoCameraRoundedIcon from '@mui/icons-material/PhotoCameraRounded';
import { useTranslation } from 'react-i18next';
import { SHOT_LIMITS } from './appPageData';
import { encodeScreenshot, MAX_IMAGE_FILE_BYTES } from './screenshotImage';
import {
  CaptureSource,
  isCaptureAvailable,
  ScreenshotCaptureDialog,
} from './ScreenshotCaptureDialog';

/** A screenshot being edited: one already on QDN, or a new picture. */
export interface ShotDraft {
  id: string;
  /** Shown in the editor: the QDN image or an object URL. */
  url: string;
  caption: string;
  width?: number;
  height?: number;
  /**
   * The picture itself, encoded as WebP: a new one, or one this Hub just
   * published. Without it, the picture is read back from QDN.
   */
  blob?: Blob;
  /** Read back from QDN: the signature of the screenshots it comes from. */
  readFrom?: string;
}

export const ScreenshotsEditor = ({
  shots,
  onChange,
  captureSource,
  captureUnavailableReason,
  onError,
}: {
  shots: ShotDraft[];
  onChange: (shots: ShotDraft[]) => void;
  captureSource: CaptureSource | null;
  /** Why the app can't be shown for capturing yet (no zip chosen...). */
  captureUnavailableReason?: string;
  onError: (message: string) => void;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const inputRef = useRef<HTMLInputElement>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const slots = SHOT_LIMITS.count - shots.length;
  const captureAvailable = isCaptureAvailable();

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    // A new pick starts without the last pick's error.
    onError('');
    const added: ShotDraft[] = [];
    for (const file of Array.from(files).slice(0, slots)) {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
        onError(
          t('core:app_page.screenshots.not_an_image', {
            name: file.name,
            postProcess: 'capitalizeFirstChar',
          })
        );
        continue;
      }
      if (file.size > MAX_IMAGE_FILE_BYTES) {
        onError(
          t('core:app_page.screenshots.too_big', {
            name: file.name,
            postProcess: 'capitalizeFirstChar',
          })
        );
        continue;
      }
      try {
        const encoded = await encodeScreenshot(file);
        added.push({
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          url: URL.createObjectURL(encoded.blob),
          blob: encoded.blob,
          caption: '',
          width: encoded.width,
          height: encoded.height,
        });
      } catch {
        onError(
          t('core:app_page.screenshots.not_an_image', {
            name: file.name,
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
    }
    if (added.length)
      onChange([...shots, ...added].slice(0, SHOT_LIMITS.count));
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= shots.length) return;
    const next = [...shots];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <Box>
      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))',
        }}
      >
        {shots.map((shot, index) => (
          <Box
            key={shot.id}
            sx={{
              border: `1px solid ${alpha(theme.palette.text.primary, 0.12)}`,
              borderRadius: '12px',
              overflow: 'hidden',
            }}
          >
            <Box sx={{ aspectRatio: '16 / 10', position: 'relative' }}>
              <img
                alt={
                  shot.caption ||
                  t('core:app_page.screenshots.alt_editor', {
                    index: index + 1,
                    postProcess: 'capitalizeFirstChar',
                  })
                }
                src={shot.url}
                style={{ height: '100%', objectFit: 'cover', width: '100%' }}
              />
              <Box
                sx={{
                  display: 'flex',
                  gap: 0.5,
                  position: 'absolute',
                  right: 4,
                  top: 4,
                }}
              >
                {[
                  {
                    label: t('core:app_page.screenshots.move_earlier', {
                      postProcess: 'capitalizeFirstChar',
                    }),
                    icon: <ChevronLeftRoundedIcon sx={{ fontSize: 16 }} />,
                    onClick: () => move(index, -1),
                    disabled: index === 0,
                  },
                  {
                    label: t('core:app_page.screenshots.move_later', {
                      postProcess: 'capitalizeFirstChar',
                    }),
                    icon: <ChevronRightRoundedIcon sx={{ fontSize: 16 }} />,
                    onClick: () => move(index, 1),
                    disabled: index === shots.length - 1,
                  },
                  {
                    label: t('core:action.remove', {
                      postProcess: 'capitalizeFirstChar',
                    }),
                    icon: <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />,
                    onClick: () => {
                      onError('');
                      onChange(shots.filter((item) => item.id !== shot.id));
                    },
                    disabled: false,
                  },
                ].map((action) => (
                  <Tooltip key={action.label} title={action.label}>
                    <span>
                      <IconButton
                        aria-label={action.label}
                        disabled={action.disabled}
                        onClick={action.onClick}
                        size="small"
                        sx={{
                          backgroundColor: alpha(
                            theme.palette.background.default,
                            0.82
                          ),
                          '&:hover': {
                            backgroundColor: theme.palette.background.default,
                          },
                        }}
                      >
                        {action.icon}
                      </IconButton>
                    </span>
                  </Tooltip>
                ))}
              </Box>
              <Typography
                sx={{
                  backgroundColor: alpha(
                    theme.palette.background.default,
                    0.82
                  ),
                  borderRadius: '8px',
                  bottom: 6,
                  fontSize: '11px',
                  fontWeight: 700,
                  left: 6,
                  position: 'absolute',
                  px: 0.75,
                }}
              >
                {index + 1}
              </Typography>
            </Box>
            <TextField
              fullWidth
              inputProps={{
                'aria-label': t('core:app_page.screenshots.caption', {
                  postProcess: 'capitalizeFirstChar',
                }),
                maxLength: SHOT_LIMITS.caption,
              }}
              onChange={(event) =>
                onChange(
                  shots.map((item) =>
                    item.id === shot.id
                      ? {
                          ...item,
                          caption: event.target.value.slice(
                            0,
                            SHOT_LIMITS.caption
                          ),
                        }
                      : item
                  )
                )
              }
              placeholder={t('core:app_page.screenshots.caption_placeholder', {
                postProcess: 'capitalizeFirstChar',
              })}
              size="small"
              sx={{
                // No frame at rest, the usual focused outline when typing.
                '& .MuiOutlinedInput-root:not(.Mui-focused) .MuiOutlinedInput-notchedOutline':
                  { borderColor: 'transparent' },
                '& input': { fontSize: '12.5px' },
              }}
              value={shot.caption}
            />
          </Box>
        ))}
      </Box>

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1,
          mt: 1.5,
        }}
      >
        <Tooltip
          title={
            !captureAvailable
              ? t('core:app_page.capture.needs_desktop', {
                  postProcess: 'capitalizeFirstChar',
                })
              : !captureSource
                ? captureUnavailableReason || ''
                : ''
          }
        >
          <span>
            <Button
              disabled={!captureAvailable || !captureSource || slots <= 0}
              onClick={() => {
                onError('');
                setCaptureOpen(true);
              }}
              startIcon={<PhotoCameraRoundedIcon />}
              sx={{ borderRadius: '12px', textTransform: 'none' }}
              variant="outlined"
            >
              {t('core:app_page.screenshots.take', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
          </span>
        </Tooltip>
        <Button
          disabled={slots <= 0}
          onClick={() => inputRef.current?.click()}
          startIcon={<AddPhotoAlternateRoundedIcon />}
          sx={{ borderRadius: '12px', textTransform: 'none' }}
          variant="outlined"
        >
          {t('core:app_page.screenshots.choose', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>
        <input
          accept="image/png,image/jpeg,image/webp"
          hidden
          multiple
          onChange={(event) => {
            void addFiles(event.target.files);
            event.target.value = '';
          }}
          ref={inputRef}
          type="file"
        />
        <Typography sx={{ color: 'text.secondary', fontSize: '12.5px' }}>
          {t('core:app_page.screenshots.limit_hint', {
            done: shots.length,
            limit: SHOT_LIMITS.count,
          })}
        </Typography>
      </Box>

      <ScreenshotCaptureDialog
        onClose={() => setCaptureOpen(false)}
        onDone={(captured) => {
          setCaptureOpen(false);
          onChange([...shots, ...captured].slice(0, SHOT_LIMITS.count));
        }}
        open={captureOpen}
        slots={Math.max(0, slots)}
        source={captureSource}
      />
    </Box>
  );
};
