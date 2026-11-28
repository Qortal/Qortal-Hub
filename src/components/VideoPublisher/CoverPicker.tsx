import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import {
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VideoFrame } from '../../../electron/src/video-tool-types';
import { blobToDataUrl } from '../../lib/videoPublisher';
import { SectionHeading } from './FormParts';
import { formatDuration } from './format';
import type { CoverChoice } from './videoPublisherTypes';

const sameChoice = (a: CoverChoice | null, b: CoverChoice | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.kind === b.kind &&
    (a.kind === 'image'
      ? a.dataUrl === (b as typeof a).dataUrl
      : a.timeSec === (b as typeof a).timeSec &&
        a.sourceId === (b as typeof a).sourceId));

/**
 * A cover from the video's frames, or an image. "Automatic" lets Hub take a
 * frame from the converted video. Posters (Subscreen) show 2:3, as cropped.
 * Where the real poster belongs (a film, a series), `askPoster` says why and
 * offers to choose it, until an image is chosen.
 */
export const CoverPicker = ({
  askPoster,
  automaticLabel,
  disabled = false,
  frames,
  framesState,
  heading,
  onChange,
  onLoadFrames,
  poster = false,
  sourceId,
  value,
}: {
  /** Why this one wants its real poster (shown until an image is chosen). */
  askPoster?: string;
  /** What "Automatic" means here (a frame, the series' poster). */
  automaticLabel?: string;
  disabled?: boolean;
  frames?: VideoFrame[];
  framesState?: 'loading' | 'ready' | 'failed';
  heading: string;
  onChange: (choice: CoverChoice | null) => void;
  onLoadFrames: () => void;
  poster?: boolean;
  sourceId: string;
  value: CoverChoice | null;
}) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { t } = useTranslation(['core']);
  const inputRef = useRef<HTMLInputElement>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    if (!framesState) onLoadFrames();
  }, [framesState, onLoadFrames]);

  const tile = (selected: boolean) => ({
    aspectRatio: poster ? '2 / 3' : '16 / 9',
    border: `2px solid ${
      selected ? theme.palette.primary.main : 'transparent'
    }`,
    borderRadius: '10px',
    boxShadow: selected
      ? `0 0 0 3px ${alpha(theme.palette.primary.main, 0.2)}`
      : 'none',
    overflow: 'hidden',
    position: 'relative' as const,
    width: '100%',
    bgcolor: alpha(theme.palette.text.primary, 0.06),
    '&.Mui-focusVisible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: 2,
    },
  });
  const imageSx = {
    display: 'block',
    height: '100%',
    objectFit: 'cover' as const,
    width: '100%',
  };

  const chooseImage = async (file: File | undefined) => {
    if (!file) return;
    setImageFailed(false);
    if (!file.type.startsWith('image/')) {
      setImageFailed(true);
      return;
    }
    try {
      onChange({ kind: 'image', dataUrl: await blobToDataUrl(file) });
    } catch {
      setImageFailed(true);
    }
  };

  // A frame chosen from another video (taken off the list since, or picked
  // for an earlier series) is still what goes up: it's shown, as picked.
  const chosenFrame = value?.kind === 'frame' ? value : null;
  const otherFrame =
    chosenFrame &&
    (chosenFrame.sourceId !== sourceId ||
      (frames !== undefined &&
        !frames.some((frame) => frame.timeSec === chosenFrame.timeSec)))
      ? chosenFrame
      : null;

  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <SectionHeading
        end={
          <Button
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            size="small"
            startIcon={<ImageRoundedIcon />}
            sx={{ textTransform: 'none' }}
          >
            {t('core:video_publisher.cover.upload')}
          </Button>
        }
      >
        {heading}
      </SectionHeading>
      <input
        accept="image/*"
        hidden
        onChange={(event) => {
          void chooseImage(event.target.files?.[0]);
          event.target.value = '';
        }}
        ref={inputRef}
        type="file"
      />
      {askPoster && value?.kind !== 'image' ? (
        <Box
          data-testid="video-publisher-poster-prompt"
          sx={{
            alignItems: 'center',
            bgcolor: alpha(theme.palette.primary.main, isDark ? 0.1 : 0.08),
            border: `1px solid ${alpha(
              theme.palette.primary.main,
              isDark ? 0.42 : 0.45
            )}`,
            borderRadius: '12px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1.25,
            p: 1.25,
          }}
        >
          <Box
            aria-hidden
            sx={{
              alignItems: 'center',
              aspectRatio: '2 / 3',
              border: `1.5px dashed ${alpha(theme.palette.primary.main, 0.6)}`,
              borderRadius: '6px',
              color: theme.palette.primary.main,
              display: 'flex',
              flexShrink: 0,
              justifyContent: 'center',
              width: 34,
            }}
          >
            <ImageRoundedIcon sx={{ fontSize: '1.05rem' }} />
          </Box>
          <Box
            sx={{ display: 'grid', flex: '1 1 200px', gap: 0.25, minWidth: 0 }}
          >
            <Typography sx={{ fontSize: '0.84rem', fontWeight: 700 }}>
              {t('core:video_publisher.cover.poster_prompt_title')}
            </Typography>
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.76rem',
                lineHeight: 1.45,
              }}
            >
              {askPoster}
            </Typography>
          </Box>
          <Button
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            size="small"
            startIcon={<ImageRoundedIcon />}
            variant="contained"
          >
            {t('core:video_publisher.cover.choose_poster')}
          </Button>
        </Box>
      ) : null}
      <Box
        aria-label={heading}
        role="radiogroup"
        sx={{
          display: 'grid',
          gap: 0.75,
          gridTemplateColumns: `repeat(auto-fill, minmax(${
            poster ? 64 : 104
          }px, 1fr))`,
        }}
      >
        <ButtonBase
          aria-checked={value === null}
          aria-label={t('core:video_publisher.cover.automatic')}
          disabled={disabled}
          onClick={() => onChange(null)}
          role="radio"
          sx={{
            ...tile(value === null),
            alignContent: 'center',
            display: 'grid',
            gap: 0.25,
            justifyItems: 'center',
            px: 0.75,
            py: 0.5,
          }}
        >
          {/* Its icon beside its name, so a small 16:9 tile fits it all. */}
          <Box sx={{ alignItems: 'center', display: 'flex', gap: 0.375 }}>
            <AutoAwesomeRoundedIcon
              sx={{ color: theme.palette.primary.main, fontSize: '0.95rem' }}
            />
            <Typography sx={{ fontSize: '0.7rem', fontWeight: 650 }}>
              {t('core:video_publisher.cover.automatic')}
            </Typography>
          </Box>
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              display: '-webkit-box',
              fontSize: '0.62rem',
              lineHeight: 1.2,
              overflow: 'hidden',
              textAlign: 'center',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: poster ? 3 : 2,
            }}
          >
            {automaticLabel ?? t('core:video_publisher.cover.automatic_desc')}
          </Typography>
        </ButtonBase>
        {value?.kind === 'image' ? (
          <ButtonBase
            aria-checked
            disabled={disabled}
            role="radio"
            sx={tile(true)}
          >
            {/* Whole, as chosen: a poster in a 16:9 tile isn't cut. */}
            <Box
              alt={t('core:video_publisher.cover.your_image')}
              component="img"
              src={value.dataUrl}
              sx={{ ...imageSx, objectFit: 'contain' }}
            />
          </ButtonBase>
        ) : null}
        {otherFrame ? (
          <ButtonBase
            aria-checked
            aria-label={t('core:video_publisher.cover.frame', {
              time: formatDuration(otherFrame.timeSec),
            })}
            disabled={disabled}
            role="radio"
            sx={tile(true)}
          >
            <Box alt="" component="img" src={otherFrame.preview} sx={imageSx} />
          </ButtonBase>
        ) : null}
        {(frames ?? []).map((frame) => {
          const choice: CoverChoice = {
            kind: 'frame',
            sourceId,
            timeSec: frame.timeSec,
            preview: frame.dataUrl,
          };
          const selected = sameChoice(value, choice);
          const label = t('core:video_publisher.cover.frame', {
            time: formatDuration(frame.timeSec),
          });
          return (
            <ButtonBase
              aria-checked={selected}
              aria-label={label}
              disabled={disabled}
              key={frame.timeSec}
              onClick={() => onChange(choice)}
              role="radio"
              sx={tile(selected)}
            >
              <Box alt="" component="img" src={frame.dataUrl} sx={imageSx} />
            </ButtonBase>
          );
        })}
        {framesState === 'loading' ? (
          <Box
            aria-label={t('core:video_publisher.cover.loading')}
            role="status"
            sx={{ ...tile(false), display: 'grid', placeItems: 'center' }}
          >
            <CircularProgress size={18} />
          </Box>
        ) : null}
      </Box>
      {framesState === 'failed' || imageFailed ? (
        <Typography
          sx={{ color: theme.palette.error.main, fontSize: '0.74rem' }}
        >
          {imageFailed
            ? t('core:video_publisher.cover.image_failed')
            : t('core:video_publisher.cover.failed')}
        </Typography>
      ) : null}
    </Box>
  );
};
