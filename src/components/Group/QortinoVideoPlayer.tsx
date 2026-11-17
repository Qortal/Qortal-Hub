import Forward10RoundedIcon from '@mui/icons-material/Forward10Rounded';
import FullscreenExitRoundedIcon from '@mui/icons-material/FullscreenExitRounded';
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import Replay10RoundedIcon from '@mui/icons-material/Replay10Rounded';
import VolumeOffRoundedIcon from '@mui/icons-material/VolumeOffRounded';
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded';
import {
  Box,
  ButtonBase,
  CircularProgress,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import { useEffect, useRef, useState } from 'react';
import {
  EarbumpMusicProgressMeter,
  smallTransportButtonSx,
} from './QortinoMusicPlayer';

export type QortinoVideoLabels = {
  back: string;
  exitFullScreen: string;
  forward: string;
  fullScreen: string;
  mute: string;
  pause: string;
  play: string;
  unmute: string;
  /** Why it doesn't play, when the browser can't play what the node has. */
  failed?: string;
};

type Props = {
  /** Where the node serves it, once it has it; null until then. */
  src: string | null;
  poster?: string;
  /** Starts by itself once it's there (right after its link was played). */
  autoPlay: boolean;
  /** Until it's there: how far the node has got, or why it can't. */
  status?: { error: boolean; message: string } | null;
  labels: QortinoVideoLabels;
  /** It started playing. */
  onPlay?: () => void;
};

const SKIP_SECONDS = 10;

const formatTime = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = String(safe % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${minutes}:${rest}`;
};

/** In a narrow window the skip buttons make way for the progress bar… */
const NARROW_WINDOW = '@container home-window (width < 320px)';
/** …unless it's tall too: then the progress gets a row of its own. */
const NARROW_TALL_WINDOW =
  '@container home-window (width < 320px) and (height >= 300px)';
/** In a short window the controls float over the picture. */
const SHORT_WINDOW = '@container home-window (height < 190px)';
/** Over the picture, they fade once the pointer has rested this long. */
const CONTROLS_REST_MS = 2500;

/** The controls over the picture: on a dark fade, in light colours. */
const floatingControlsSx = (theme: Theme) =>
  ({
    background: `linear-gradient(180deg, ${alpha(theme.palette.common.black, 0)} 0%, ${alpha(theme.palette.common.black, 0.78)} 100%)`,
    borderRadius: '0 0 12px 12px',
    bottom: 0,
    left: 0,
    padding: '18px 8px 7px',
    position: 'absolute',
    right: 0,
    transition: 'opacity 180ms ease',
    zIndex: 1,
    '& .qortino-video-progress .MuiTypography-root': {
      color: alpha(theme.palette.common.white, 0.88),
    },
    '& .earbump-progress-track': {
      background: alpha(theme.palette.common.white, 0.26),
      borderColor: alpha(theme.palette.common.white, 0.16),
      boxShadow: 'none',
    },
  }) as const;

const restingControlsSx = { opacity: 0, pointerEvents: 'none' } as const;

/**
 * A video in the Workspace's player, with controls in the player's own
 * look: play and pause as on the vinyl, back and forward 10 seconds, the
 * music player's progress bar, mute and full screen. A click on the
 * picture plays or pauses it, a double click goes full screen.
 *
 * It fits its window: in a short one (and in full screen) the controls
 * float over the picture and fade while it plays and the pointer rests;
 * in a narrow one the skip buttons make way, or, when it's tall too, the
 * progress gets a row of its own.
 */
export const QortinoVideoPlayer = ({
  autoPlay,
  labels,
  onPlay,
  poster,
  src,
  status,
}: Props) => {
  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';
  const frameRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const restTimerRef = useRef<number | undefined>(undefined);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isPointerResting, setIsPointerResting] = useState(true);
  const [hasKeyboardFocus, setHasKeyboardFocus] = useState(false);
  // The address the browser couldn't play; another one is tried afresh.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  useEffect(() => {
    const onChange = () =>
      setIsFullScreen(
        !!frameRef.current && document.fullscreenElement === frameRef.current
      );
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => () => window.clearTimeout(restTimerRef.current), []);

  const wakeControls = () => {
    setIsPointerResting(false);
    window.clearTimeout(restTimerRef.current);
    restTimerRef.current = window.setTimeout(
      () => setIsPointerResting(true),
      CONTROLS_REST_MS
    );
  };
  const restControls = () => {
    window.clearTimeout(restTimerRef.current);
    setIsPointerResting(true);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  };
  const skip = (seconds: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.min(
      Math.max(video.currentTime + seconds, 0),
      video.duration
    );
  };
  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };
  const toggleFullScreen = () => {
    const frame = frameRef.current;
    if (!frame) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frame.requestFullscreen?.().catch(() => undefined);
  };

  const failed = !!src && failedSrc === src;
  const ready = !!src && !failed;
  const shownStatus = failed
    ? labels.failed
      ? { error: true, message: labels.failed }
      : null
    : status;
  const floatingSx = floatingControlsSx(theme);
  const smallButton = smallTransportButtonSx(theme);
  const keyboardFocusProps = {
    onBlur: () => setHasKeyboardFocus(false),
    onFocusVisible: () => setHasKeyboardFocus(true),
  };
  const button = (
    className: string,
    label: string,
    onClick: () => void,
    icon: React.ReactNode
  ) => (
    <Tooltip title={label}>
      <span className={className}>
        <ButtonBase
          {...keyboardFocusProps}
          aria-label={label}
          disabled={!ready}
          onClick={onClick}
          sx={{
            ...smallButton,
            height: '26px',
            width: '26px',
            '&.Mui-disabled': { opacity: 0.45 },
          }}
        >
          {icon}
        </ButtonBase>
      </span>
    </Tooltip>
  );

  return (
    <Box
      data-resting={
        isPlaying && isPointerResting && !hasKeyboardFocus ? 'true' : undefined
      }
      onKeyDown={wakeControls}
      onPointerDown={wakeControls}
      onPointerLeave={restControls}
      onPointerMove={wakeControls}
      ref={frameRef}
      sx={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        gap: '8px',
        minHeight: 0,
        position: 'relative',
        [SHORT_WINDOW]: {
          '& .qortino-video-controls': floatingSx,
          '&[data-resting="true"] .qortino-video-controls': restingControlsSx,
        },
        '&:fullscreen': { background: theme.palette.common.black },
        '&:fullscreen .qortino-video-controls': {
          ...floatingSx,
          borderRadius: 0,
          flexWrap: 'nowrap',
          padding: '36px 20px 16px',
        },
        '&:fullscreen .qortino-video-controls > *': {
          marginLeft: 0,
          marginRight: 0,
          order: 0,
        },
        '&:fullscreen .qortino-video-progress': { flexBasis: 0 },
        '&:fullscreen .qortino-video-skip': { display: 'inline-flex' },
        '&:fullscreen[data-resting="true"] .qortino-video-controls':
          restingControlsSx,
      }}
    >
      <Box
        sx={{
          background: theme.palette.common.black,
          borderRadius: isFullScreen ? 0 : '12px',
          flex: 1,
          minHeight: '48px',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {ready ? (
          <video
            autoPlay={autoPlay}
            onClick={togglePlay}
            onDoubleClick={toggleFullScreen}
            onDurationChange={(event) =>
              setDuration(
                Number.isFinite(event.currentTarget.duration)
                  ? event.currentTarget.duration
                  : 0
              )
            }
            onError={() => {
              setFailedSrc(src);
              setIsPlaying(false);
            }}
            onPause={() => setIsPlaying(false)}
            onPlay={() => {
              setIsPlaying(true);
              onPlay?.();
            }}
            onVolumeChange={(event) => setIsMuted(event.currentTarget.muted)}
            playsInline
            poster={poster}
            ref={videoRef}
            src={src}
            style={{
              cursor: 'pointer',
              display: 'block',
              height: '100%',
              objectFit: 'contain',
              width: '100%',
            }}
          />
        ) : (
          <Box
            // The picture's address comes from QDN: quoted, so that it
            // stays one address, and set on the element itself, so that
            // it never becomes text of the page's style sheet.
            style={
              poster
                ? { backgroundImage: `url(${JSON.stringify(poster)})` }
                : undefined
            }
            sx={{
              alignItems: 'center',
              backgroundPosition: 'center',
              backgroundSize: 'cover',
              display: 'flex',
              height: '100%',
              justifyContent: 'center',
              p: 1,
            }}
          >
            {shownStatus ? (
              <Box
                sx={{
                  alignItems: 'center',
                  background: alpha(theme.palette.common.black, 0.62),
                  borderRadius: '999px',
                  color: theme.palette.common.white,
                  display: 'flex',
                  gap: 1,
                  maxWidth: '100%',
                  px: 1.5,
                  py: 0.75,
                }}
              >
                {shownStatus.error ? null : (
                  <CircularProgress color="inherit" size={14} thickness={5} />
                )}
                <Typography sx={{ fontSize: '0.7rem', fontWeight: 600 }}>
                  {shownStatus.message}
                </Typography>
              </Box>
            ) : null}
          </Box>
        )}
      </Box>

      <Box
        className="qortino-video-controls"
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexWrap: 'nowrap',
          gap: '8px',
          minWidth: 0,
          '& > span': { display: 'inline-flex', flexShrink: 0 },
          '& .qortino-video-progress': {
            alignItems: 'center',
            display: 'grid',
            flex: '1 1 0',
            gap: '8px',
            gridTemplateColumns: 'auto minmax(0, 1fr) auto',
            minWidth: 0,
          },
          [NARROW_WINDOW]: {
            gap: '6px',
            '& .qortino-video-skip': { display: 'none' },
          },
          [NARROW_TALL_WINDOW]: {
            flexWrap: 'wrap',
            rowGap: '6px',
            '& .qortino-video-progress': { flexBasis: '100%', order: -1 },
            '& .qortino-video-skip': { display: 'inline-flex' },
            '& .qortino-video-mute': { marginRight: 'auto', order: 1 },
            '& .qortino-video-back': { order: 2 },
            '& .qortino-video-play': { order: 3 },
            '& .qortino-video-forward': { order: 4 },
            '& .qortino-video-full': { marginLeft: 'auto', order: 5 },
          },
        }}
      >
        <Tooltip title={isPlaying ? labels.pause : labels.play}>
          <span className="qortino-video-play">
            <ButtonBase
              {...keyboardFocusProps}
              aria-label={isPlaying ? labels.pause : labels.play}
              disabled={!ready}
              onClick={togglePlay}
              sx={{
                alignItems: 'center',
                background: alpha('#FFFFFF', isPlaying ? 0.78 : 0.7),
                borderRadius: '50%',
                boxShadow: `0 6px 14px ${alpha('#000', isDarkMode ? 0.3 : 0.16)}`,
                color: alpha('#243A67', 0.9),
                display: 'flex',
                flexShrink: 0,
                height: '30px',
                justifyContent: 'center',
                transition: 'transform 120ms ease, box-shadow 140ms ease',
                width: '30px',
                '&:hover': { transform: 'translateY(-1px)' },
                '&.Mui-disabled': { opacity: 0.45 },
              }}
            >
              {isPlaying ? (
                <PauseRoundedIcon sx={{ fontSize: '19px' }} />
              ) : (
                <PlayArrowRoundedIcon sx={{ fontSize: '19px' }} />
              )}
            </ButtonBase>
          </span>
        </Tooltip>
        {button(
          'qortino-video-skip qortino-video-back',
          labels.back,
          () => skip(-SKIP_SECONDS),
          <Replay10RoundedIcon sx={{ fontSize: '16px' }} />
        )}
        {button(
          'qortino-video-skip qortino-video-forward',
          labels.forward,
          () => skip(SKIP_SECONDS),
          <Forward10RoundedIcon sx={{ fontSize: '16px' }} />
        )}
        <Box className="qortino-video-progress">
          <EarbumpMusicProgressMeter
            audioRef={videoRef}
            durationLabel={duration > 0 ? formatTime(duration) : '--:--'}
            durationSeconds={duration}
            isTrackPlayable={ready}
            playbackUrl={src ?? ''}
            theme={theme}
            trackId={src ?? ''}
          />
        </Box>
        {button(
          'qortino-video-mute',
          isMuted ? labels.unmute : labels.mute,
          toggleMute,
          isMuted ? (
            <VolumeOffRoundedIcon sx={{ fontSize: '16px' }} />
          ) : (
            <VolumeUpRoundedIcon sx={{ fontSize: '16px' }} />
          )
        )}
        {button(
          'qortino-video-full',
          isFullScreen ? labels.exitFullScreen : labels.fullScreen,
          toggleFullScreen,
          isFullScreen ? (
            <FullscreenExitRoundedIcon sx={{ fontSize: '17px' }} />
          ) : (
            <FullscreenRoundedIcon sx={{ fontSize: '17px' }} />
          )
        )}
      </Box>
    </Box>
  );
};
