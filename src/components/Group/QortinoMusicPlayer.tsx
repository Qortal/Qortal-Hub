import {
  Box,
  ButtonBase,
  CircularProgress,
  IconButton,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import RepeatOneRoundedIcon from '@mui/icons-material/RepeatOneRounded';
import RepeatRoundedIcon from '@mui/icons-material/RepeatRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SkipNextRoundedIcon from '@mui/icons-material/SkipNextRounded';
import SkipPreviousRoundedIcon from '@mui/icons-material/SkipPreviousRounded';
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import type { QortinoLayoutDebugSettings } from './qortinoLayoutDebug';
import { GROUP_ACTIVITY_BLUE } from './groupActivityColorSystem';

const MUSIC_STATUS_SLOT_HEIGHT_PX = 20;

export type QortinoMusicTrack = {
  artist: string;
  coverColors: [string, string, string];
  id: string;
  length: string;
  name: string;
  title: string;
};

export type RepeatMode = 'all' | 'one';

const formatPlaybackTime = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
};

const truncateTrackLabel = (value: string, maxLength = 30) => {
  const trimmedValue = value.trim();
  if (!trimmedValue) return value;
  if (trimmedValue.length <= maxLength) return trimmedValue;
  return `${trimmedValue.slice(0, maxLength).trimEnd()} (...)`;
};

const smallTransportButtonSx = (theme: Theme) => ({
  alignItems: 'center',
  background:
    theme.palette.mode === 'dark'
      ? 'rgba(255,255,255,0.04)'
      : 'rgba(20,24,32,0.045)',
  border: `1px solid ${alpha(
    theme.palette.common.white,
    theme.palette.mode === 'dark' ? 0.06 : 0.12
  )}`,
  borderRadius: '9px',
  color: alpha('#9BC2FF', 0.94),
  display: 'inline-flex',
  height: '24px',
  justifyContent: 'center',
  transition: 'transform 120ms ease, border-color 140ms ease',
  width: '24px',
  '&:hover': {
    borderColor: alpha('#8DB8FF', 0.2),
    transform: 'translateY(-1px)',
  },
});

export const MusicCoverArt = ({
  isSpinning = false,
  size,
  track,
}: {
  isSpinning?: boolean;
  size: number;
  track: QortinoMusicTrack;
}) => (
  <Box
    sx={{
      alignItems: 'center',
      background: `radial-gradient(circle at 30% 28%, ${alpha(
        track.coverColors[2],
        0.94
      )} 0%, ${alpha(track.coverColors[0], 0.88)} 34%, ${alpha(
        track.coverColors[1],
        0.94
      )} 100%)`,
      border: `1px solid ${alpha('#D7E7FF', 0.14)}`,
      borderRadius: '50%',
      boxShadow: `0 14px 26px ${alpha(track.coverColors[1], 0.28)}, inset 0 1px 0 ${alpha(
        '#fff',
        0.22
      )}`,
      display: 'flex',
      height: `${size}px`,
      justifyContent: 'center',
      overflow: 'hidden',
      position: 'relative',
      transformOrigin: '50% 50%',
      transform: isSpinning ? 'rotate(12deg)' : 'rotate(0deg)',
      transition: 'filter 180ms ease, transform 280ms ease',
      width: `${size}px`,
      '&::before': {
        background: `linear-gradient(135deg, ${alpha('#ffffff', 0.32)} 0%, ${alpha(
          '#ffffff',
          0
        )} 48%)`,
        content: '""',
        inset: '10%',
        position: 'absolute',
        transform: 'rotate(-18deg)',
      },
      '&::after': {
        background: alpha('#05070B', 0.22),
        borderRadius: '50%',
        content: '""',
        height: `${Math.round(size * 0.46)}px`,
        left: '50%',
        position: 'absolute',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        width: `${Math.round(size * 0.46)}px`,
      },
    }}
  >
    <Box
      sx={{
        background: alpha('#EAF2FF', 0.9),
        borderRadius: '50%',
        boxShadow: `0 0 0 2px ${alpha('#0B1119', 0.32)}`,
        height: `${Math.max(8, Math.round(size * 0.08))}px`,
        position: 'relative',
        width: `${Math.max(8, Math.round(size * 0.08))}px`,
        zIndex: 1,
      }}
    />
  </Box>
);

type EarbumpMusicProgressMeterProps = {
  audioRef: RefObject<HTMLAudioElement | null>;
  durationLabel: string;
  durationSeconds: number;
  isTrackPlayable: boolean;
  onSeekInteraction?: () => void;
  playbackUrl: string;
  theme: Theme;
  trackId: string;
};

const EarbumpMusicProgressMeter = memo(function EarbumpMusicProgressMeter({
  audioRef,
  durationLabel,
  durationSeconds,
  isTrackPlayable,
  onSeekInteraction,
  playbackUrl,
  theme,
  trackId,
}: EarbumpMusicProgressMeterProps) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const elapsedLabelRef = useRef<HTMLSpanElement | null>(null);
  const progressFillRef = useRef<HTMLDivElement | null>(null);
  const rafPendingRef = useRef(false);
  const rafIdRef = useRef(0);
  const lastElapsedSecondRef = useRef(-1);

  const syncProgressDom = useCallback(
    (currentTime: number, explicitProgress?: number) => {
      const safeTime = Number.isFinite(currentTime)
        ? Math.max(0, currentTime)
        : 0;
      const liveDur =
        audioRef.current && audioRef.current.duration > 0
          ? audioRef.current.duration
          : durationSeconds > 0
            ? durationSeconds
            : 0;
      const rawProgress =
        typeof explicitProgress === 'number'
          ? explicitProgress
          : liveDur > 0
            ? safeTime / liveDur
            : 0;
      const clampedProgress = Math.min(Math.max(rawProgress, 0), 1);
      const elapsedSecond = Math.floor(safeTime);

      if (elapsedLabelRef.current && lastElapsedSecondRef.current !== elapsedSecond) {
        elapsedLabelRef.current.textContent = formatPlaybackTime(safeTime);
        lastElapsedSecondRef.current = elapsedSecond;
      }

      if (progressFillRef.current) {
        progressFillRef.current.style.transform = `scaleX(${clampedProgress})`;
      }
    },
    [audioRef, durationSeconds]
  );

  useEffect(() => {
    lastElapsedSecondRef.current = -1;
    syncProgressDom(0, 0);
  }, [playbackUrl, syncProgressDom, trackId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return undefined;
    }

    const flush = () => {
      rafPendingRef.current = false;
      const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      syncProgressDom(t);
    };

    const onTimeUpdate = () => {
      if (rafPendingRef.current) {
        return;
      }
      rafPendingRef.current = true;
      rafIdRef.current = requestAnimationFrame(flush);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    flush();

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      cancelAnimationFrame(rafIdRef.current);
      rafPendingRef.current = false;
    };
  }, [audioRef, playbackUrl, syncProgressDom, trackId]);

  const seekAtClientX = useCallback(
    (clientX: number) => {
      const audio = audioRef.current;
      const progressBar = barRef.current;
      if (!audio || !progressBar || !isTrackPlayable || durationSeconds <= 0) {
        return;
      }

      const rect = progressBar.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }

      const ratio = Math.min(
        Math.max((clientX - rect.left) / rect.width, 0),
        1
      );
      const nextTime = ratio * durationSeconds;

      audio.currentTime = nextTime;
      syncProgressDom(nextTime, ratio);
      onSeekInteraction?.();
    },
    [
      audioRef,
      durationSeconds,
      isTrackPlayable,
      onSeekInteraction,
      syncProgressDom,
    ]
  );

  const handleProgressPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isTrackPlayable || durationSeconds <= 0) {
        return;
      }

      event.preventDefault();
      seekAtClientX(event.clientX);

      const handleWindowPointerMove = (moveEvent: PointerEvent) => {
        seekAtClientX(moveEvent.clientX);
      };

      const handleWindowPointerUp = () => {
        window.removeEventListener('pointermove', handleWindowPointerMove);
        window.removeEventListener('pointerup', handleWindowPointerUp);
      };

      window.addEventListener('pointermove', handleWindowPointerMove);
      window.addEventListener('pointerup', handleWindowPointerUp, {
        once: true,
      });
    },
    [durationSeconds, isTrackPlayable, seekAtClientX]
  );

  const isDarkMode = theme.palette.mode === 'dark';
  const progressTrackSx = useMemo(() => {
    const trackInset = alpha(
      isDarkMode ? theme.palette.common.white : theme.palette.common.black,
      isDarkMode ? 0.1 : 0.07
    );
    const trackMid = alpha(
      isDarkMode ? theme.palette.common.white : theme.palette.text.primary,
      isDarkMode ? 0.08 : 0.09
    );
    const trackOuter = alpha(theme.palette.divider, isDarkMode ? 0.35 : 0.65);
    return {
      background: `linear-gradient(180deg, ${trackMid} 0%, ${trackInset} 100%)`,
      border: `1px solid ${trackOuter}`,
      borderRadius: '999px',
      boxSizing: 'border-box',
      boxShadow:
        theme.palette.mode === 'dark'
          ? `inset 0 1px 0 ${alpha(theme.palette.common.white, 0.06)}`
          : `inset 0 1px 0 ${alpha(theme.palette.common.white, 0.72)}`,
      height: '5px',
      overflow: 'hidden',
      position: 'relative',
      width: '100%',
    } as const;
  }, [
    isDarkMode,
    theme.palette.common.black,
    theme.palette.common.white,
    theme.palette.divider,
    theme.palette.mode,
    theme.palette.text.primary,
  ]);

  const progressFillSx = useMemo(() => {
    const glowStrength = isDarkMode ? 0.26 : 0.18;
    return {
      background: `linear-gradient(90deg, ${GROUP_ACTIVITY_BLUE.gradientTop} 0%, ${GROUP_ACTIVITY_BLUE.primary} 54%, ${GROUP_ACTIVITY_BLUE.hover} 100%)`,
      borderRadius: 'inherit',
      boxShadow: `0 0 10px ${alpha(GROUP_ACTIVITY_BLUE.primary, glowStrength)}`,
      height: '100%',
      transform: 'scaleX(0)',
      transformOrigin: '0 50%',
      width: '100%',
      willChange: 'transform',
    } as const;
  }, [isDarkMode]);

  return (
    <>
      <Typography
        sx={{
          color: alpha(theme.palette.text.secondary, 0.68),
          fontSize: '0.55rem',
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        <span ref={elapsedLabelRef}>0:00</span>
      </Typography>
      <Box
        ref={barRef}
        onPointerDown={handleProgressPointerDown}
        sx={{
          alignItems: 'center',
          cursor:
            isTrackPlayable && durationSeconds > 0 ? 'pointer' : 'default',
          display: 'flex',
          height: '12px',
          position: 'relative',
          touchAction: 'none',
        }}
      >
        <Box sx={progressTrackSx}>
          <Box ref={progressFillRef} sx={progressFillSx} />
        </Box>
      </Box>
      <Typography
        sx={{
          color: alpha(theme.palette.text.secondary, 0.68),
          fontSize: '0.55rem',
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        {durationLabel}
      </Typography>
    </>
  );
});

type QortinoMusicPlayerProps = {
  activeTrack: QortinoMusicTrack;
  activeTrackDurationSeconds: number;
  activeTrackPlaybackUrl: string;
  activeTrackReadyPercent: number;
  audioRef: RefObject<HTMLAudioElement | null>;
  isTrackLoadError: boolean;
  isTrackPeerStarved: boolean;
  isTrackPlayable: boolean;
  isTrackPreparing: boolean;
  isTrackReady: boolean;
  musicPlaying: boolean;
  musicStatusSlotMessage: string | null;
  onClearStreamError: () => void;
  onClose: () => void;
  onCycleTrack: (direction: 'next' | 'previous') => void;
  onOpenSearch: () => void;
  onToggleRepeatMode: () => void;
  onToggleTrack: (trackId: string) => void;
  qortinoLayoutDebug: QortinoLayoutDebugSettings;
  repeatMode: RepeatMode;
  title: string;
};

export const QortinoMusicPlayer = memo(function QortinoMusicPlayer({
  activeTrack,
  activeTrackDurationSeconds,
  activeTrackPlaybackUrl,
  activeTrackReadyPercent,
  audioRef,
  isTrackLoadError,
  isTrackPeerStarved,
  isTrackPlayable,
  isTrackPreparing,
  isTrackReady,
  musicPlaying,
  musicStatusSlotMessage,
  onClearStreamError,
  onClose,
  onCycleTrack,
  onOpenSearch,
  onToggleRepeatMode,
  onToggleTrack,
  qortinoLayoutDebug,
  repeatMode,
  title,
}: QortinoMusicPlayerProps) {
  const theme = useTheme();
  const musicControlRingColor = isTrackLoadError
    ? alpha('#FF8F8F', 0.94)
    : isTrackPeerStarved
      ? alpha('#F6C76E', 0.96)
      : isTrackPlayable
        ? alpha('#A9CAFF', 0.92)
        : alpha('#84B2FF', 0.94);
  const musicControlRingTrackColor = isTrackLoadError
    ? alpha('#FF8F8F', 0.2)
    : isTrackPeerStarved
      ? alpha('#F6C76E', 0.2)
      : alpha('#DCE8FF', 0.14);
  const musicControlShowsPause =
    musicPlaying && isTrackPlayable && !isTrackLoadError;
  const musicControlShowsDownload =
    Boolean(activeTrack.id) && isTrackPreparing && !isTrackPlayable;
  const musicControlShowsReadyPulse =
    Boolean(activeTrack.id) &&
    !musicPlaying &&
    isTrackPlayable &&
    !isTrackLoadError;
  const progressRowOffsetY = qortinoLayoutDebug.progressOffsetY + 12;
  const progressRowReservedTop = Math.max(progressRowOffsetY, 0);
  const progressRowVisualOffsetY = Math.min(progressRowOffsetY, 0);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.02 }}>
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          transform: `translateY(${qortinoLayoutDebug.musicHeaderOffsetY - 1}px)`,
        }}
      >
        <IconButton
          onClick={onOpenSearch}
          size="small"
          sx={{
            color: alpha('#9FC4FF', 0.92),
            height: '30px',
            width: '30px',
          }}
        >
          <SearchRoundedIcon sx={{ fontSize: '18px' }} />
        </IconButton>
        <Typography
          sx={{
            color: alpha(theme.palette.text.secondary, 0.82),
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          {title}
        </Typography>
        <IconButton
          onClick={onClose}
          size="small"
          sx={{
            color: alpha(theme.palette.text.secondary, 0.82),
            height: '30px',
            width: '30px',
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: '18px' }} />
        </IconButton>
      </Box>

      <Box
        sx={{
          alignItems: 'center',
          display: 'grid',
          gap: '14px',
          gridTemplateColumns: '28px minmax(0, 1fr) 28px',
        }}
      >
        <ButtonBase
          onClick={() => onCycleTrack('previous')}
          sx={{
            ...smallTransportButtonSx(theme),
            transform: `translateY(${qortinoLayoutDebug.prevNextOffsetY - 8}px)`,
          }}
        >
          <SkipPreviousRoundedIcon sx={{ fontSize: '15px' }} />
        </ButtonBase>
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.08,
          }}
        >
          <ButtonBase
            onClick={() => onToggleTrack(activeTrack.id)}
            sx={{
              alignItems: 'center',
              borderRadius: '50%',
              display: 'flex',
              height: '110px',
              isolation: 'isolate',
              justifyContent: 'center',
              position: 'relative',
              transform: `translateY(${qortinoLayoutDebug.vinylOffsetY + 12}px)`,
              width: '110px',
            }}
          >
            <MusicCoverArt
              isSpinning={musicPlaying && isTrackReady && !isTrackLoadError}
              size={110}
              track={activeTrack}
            />
            {activeTrack.id && !isTrackReady ? (
              <Box
                sx={{
                  height: '50px',
                  left: '50%',
                  pointerEvents: 'none',
                  position: 'absolute',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '50px',
                  zIndex: 2,
                }}
              >
                <CircularProgress
                  size={50}
                  thickness={4.1}
                  value={100}
                  variant="determinate"
                  sx={{
                    color: musicControlRingTrackColor,
                    inset: 0,
                    position: 'absolute',
                  }}
                />
                {isTrackPreparing && activeTrackReadyPercent <= 0 ? (
                  <CircularProgress
                    size={50}
                    thickness={4.1}
                    variant="indeterminate"
                    sx={{
                      animationDuration: '1.8s',
                      color: musicControlRingColor,
                      inset: 0,
                      position: 'absolute',
                      '& .MuiCircularProgress-circle': {
                        strokeLinecap: 'round',
                      },
                    }}
                  />
                ) : (
                  <CircularProgress
                    size={50}
                    thickness={4.1}
                    value={Math.max(
                      musicControlShowsReadyPulse ? 100 : 8,
                      activeTrackReadyPercent
                    )}
                    variant="determinate"
                    sx={{
                      color: musicControlRingColor,
                      inset: 0,
                      position: 'absolute',
                      transition: 'color 180ms ease',
                      '& .MuiCircularProgress-circle': {
                        strokeLinecap: 'round',
                        transition: 'stroke-dashoffset 260ms ease',
                      },
                    }}
                  />
                )}
              </Box>
            ) : null}
            <Box
              sx={{
                alignItems: 'center',
                background: alpha('#FFFFFF', musicPlaying ? 0.78 : 0.68),
                borderRadius: '50%',
                boxShadow: `0 8px 18px ${alpha('#000', 0.2)}`,
                color: alpha('#243A67', 0.88),
                display: 'flex',
                height: '36px',
                justifyContent: 'center',
                left: '50%',
                position: 'absolute',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: '36px',
                zIndex: 3,
              }}
            >
              {musicControlShowsPause ? (
                <PauseRoundedIcon sx={{ fontSize: '22px' }} />
              ) : musicControlShowsDownload ? (
                <DownloadRoundedIcon sx={{ fontSize: '18px' }} />
              ) : (
                <PlayArrowRoundedIcon sx={{ fontSize: '22px' }} />
              )}
            </Box>
          </ButtonBase>
          <Box
            sx={{
              maxWidth: '100%',
              minWidth: 0,
              textAlign: 'center',
              transform: `translateY(${qortinoLayoutDebug.titleAuthorOffsetY + 21}px)`,
              width: '100%',
            }}
          >
            <Typography
              sx={{
                color: alpha(theme.palette.text.primary, 0.92),
                fontSize: '0.78rem',
                fontWeight: 700,
                lineHeight: 1.15,
                overflow: 'hidden',
                textOverflow: 'clip',
                whiteSpace: 'nowrap',
                width: '100%',
              }}
            >
              {truncateTrackLabel(activeTrack.title)}
            </Typography>
            <Typography
              sx={{
                color: alpha(theme.palette.text.secondary, 0.72),
                fontSize: '0.61rem',
                mt: 0.12,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {activeTrack.artist}
            </Typography>
          </Box>
        </Box>
        <ButtonBase
          onClick={() => onCycleTrack('next')}
          sx={{
            ...smallTransportButtonSx(theme),
            transform: `translateY(${qortinoLayoutDebug.prevNextOffsetY - 8}px)`,
          }}
        >
          <SkipNextRoundedIcon sx={{ fontSize: '15px' }} />
        </ButtonBase>
      </Box>

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 0.18,
          mt: 0.36,
          pt: `${progressRowReservedTop}px`,
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'grid',
            gap: '8px',
            gridTemplateColumns: 'auto minmax(0, 1fr) auto auto',
            position: 'relative',
            transform: `translateY(${progressRowVisualOffsetY}px)`,
            zIndex: 1,
          }}
        >
          <EarbumpMusicProgressMeter
            audioRef={audioRef}
            durationLabel={activeTrack.length}
            durationSeconds={activeTrackDurationSeconds}
            isTrackPlayable={isTrackPlayable}
            onSeekInteraction={onClearStreamError}
            playbackUrl={activeTrackPlaybackUrl}
            theme={theme}
            trackId={activeTrack.id}
          />
          <ButtonBase
            onClick={onToggleRepeatMode}
            sx={{
              alignItems: 'center',
              color: alpha(
                repeatMode === 'one'
                  ? '#9FC4FF'
                  : theme.palette.text.secondary,
                repeatMode === 'one' ? 0.96 : 0.8
              ),
              display: 'inline-flex',
              height: '18px',
              justifyContent: 'center',
              position: 'relative',
              width: '18px',
              zIndex: 1,
            }}
          >
            {repeatMode === 'one' ? (
              <RepeatOneRoundedIcon sx={{ fontSize: '15px' }} />
            ) : (
              <RepeatRoundedIcon sx={{ fontSize: '15px' }} />
            )}
          </ButtonBase>
        </Box>
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            height: `${MUSIC_STATUS_SLOT_HEIGHT_PX}px`,
            justifyContent: 'center',
            overflow: 'hidden',
            pointerEvents: 'none',
            position: 'relative',
          }}
        >
          <Typography
            sx={{
              color: alpha(
                isTrackLoadError
                  ? '#FFB4B4'
                  : isTrackPeerStarved
                    ? '#F6D089'
                    : theme.palette.text.secondary,
                isTrackLoadError || isTrackPeerStarved ? 0.9 : 0.7
              ),
              fontSize: '0.58rem',
              fontWeight: 600,
              lineHeight: 1.35,
              maxWidth: '100%',
              opacity: musicStatusSlotMessage ? 1 : 0,
              textAlign: 'center',
              transform: `translateY(${qortinoLayoutDebug.nodeStatusOffsetY}px)`,
              transition: 'opacity 140ms ease',
              visibility: musicStatusSlotMessage ? 'visible' : 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            {musicStatusSlotMessage ?? ' '}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
});
