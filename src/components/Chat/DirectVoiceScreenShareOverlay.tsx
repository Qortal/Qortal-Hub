import { useCallback, useEffect, useRef } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ScreenShareRoundedIcon from '@mui/icons-material/ScreenShareRounded';
import StopScreenShareRoundedIcon from '@mui/icons-material/StopScreenShareRounded';
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded';

import { useVoiceCallContext } from '../../context/VoiceCallContext';

export function DirectVoiceScreenShareOverlay({
  isAppLocked = false,
}: {
  isAppLocked?: boolean;
}) {
  const {
    screenShareState,
    screenShareSources,
    screenShareStream,
    screenShareViewerOpen,
    screenShareIsLocal,
    cancelScreenSharePicker,
    startScreenShare,
    stopScreenShare,
    setScreenShareViewerOpen,
  } = useVoiceCallContext();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const ensureVideoPlayback = useCallback(
    (video: HTMLVideoElement | null = videoRef.current) => {
      if (!video || !video.srcObject) return;
      void video.play().catch(() => {
        // A subsequent loadedmetadata/canplay event retries playback. Screen
        // video is always muted, so this does not affect the call's audio.
      });
    },
    []
  );

  const attachVideo = useCallback(
    (video: HTMLVideoElement | null) => {
      const previousVideo = videoRef.current;
      if (
        previousVideo &&
        previousVideo !== video &&
        previousVideo.srcObject === screenShareStream
      ) {
        previousVideo.srcObject = null;
      }
      videoRef.current = video;
      if (!video) return;
      video.srcObject = screenShareStream;
      if (screenShareStream) ensureVideoPlayback(video);
    },
    [ensureVideoPlayback, screenShareStream]
  );

  useEffect(() => {
    if (!isAppLocked) return;
    if (screenShareState === 'choosing') {
      cancelScreenSharePicker();
    } else if (
      screenShareIsLocal &&
      (screenShareState === 'sharing' || screenShareState === 'starting')
    ) {
      void stopScreenShare();
    }
  }, [
    cancelScreenSharePicker,
    isAppLocked,
    screenShareIsLocal,
    screenShareState,
    stopScreenShare,
  ]);

  const choosing = screenShareState === 'choosing';
  const starting = screenShareState === 'starting';
  const sharing = screenShareState === 'sharing';
  const viewing = screenShareState === 'viewing';
  const open =
    !isAppLocked && screenShareViewerOpen && screenShareState !== 'idle';

  const closeViewer = () => {
    if (choosing) {
      cancelScreenSharePicker();
      return;
    }
    setScreenShareViewerOpen(false);
  };

  const openFullscreen = () => {
    const video = videoRef.current;
    if (!video?.requestFullscreen) return;
    void video.requestFullscreen().catch(() => {});
  };

  return (
    <Dialog
      open={open}
      onClose={closeViewer}
      fullWidth
      maxWidth="lg"
      slotProps={{
        root: { sx: { zIndex: 1900 } },
        backdrop: { sx: { backgroundColor: 'rgba(4, 8, 14, 0.78)' } },
      }}
      PaperProps={{
        sx: (theme) => ({
          backgroundImage: 'none',
          bgcolor:
            theme.palette.mode === 'dark'
              ? 'rgba(18, 22, 29, 0.99)'
              : theme.palette.background.paper,
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 3,
          boxShadow: '0 24px 70px rgba(0,0,0,0.42)',
          maxHeight: '88vh',
          overflow: 'hidden',
        }),
      }}
    >
      <DialogTitle
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: 1.25,
          minHeight: 64,
          pr: screenShareStream && !choosing ? 12 : 7,
        }}
      >
        <ScreenShareRoundedIcon color="primary" />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 17, fontWeight: 800 }}>
            {choosing
              ? 'Choose what to share'
              : sharing
                ? 'You are sharing your screen'
                : viewing
                  ? 'Screen share'
                  : 'Starting screen share…'}
          </Typography>
          <Typography color="text.secondary" sx={{ fontSize: 12.5 }}>
            {choosing
              ? 'Select a screen or application window.'
              : sharing
                ? 'Only the selected screen or window is visible to the other person.'
                : viewing
                  ? 'Shared directly through the encrypted WebRTC call.'
                  : 'Establishing the encrypted video connection.'}
          </Typography>
        </Box>
        <IconButton
          aria-label="Close screen share window"
          onClick={closeViewer}
          sx={{ position: 'absolute', right: 16, top: 14 }}
        >
          <CloseRoundedIcon />
        </IconButton>
        {screenShareStream && !choosing ? (
          <IconButton
            aria-label="View screen share fullscreen"
            onClick={openFullscreen}
            sx={{ position: 'absolute', right: 54, top: 14 }}
          >
            <FullscreenRoundedIcon />
          </IconButton>
        ) : null}
      </DialogTitle>

      <DialogContent dividers sx={{ p: choosing ? 2 : 1.5 }}>
        {choosing ? (
          <Box
            sx={{
              display: 'grid',
              gap: 1.5,
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, minmax(0, 1fr))',
                lg: 'repeat(3, minmax(0, 1fr))',
              },
              maxHeight: '65vh',
              overflowY: 'auto',
              p: 0.5,
            }}
          >
            {screenShareSources.map((source) => (
              <Box
                component="button"
                type="button"
                key={source.id}
                onClick={() => void startScreenShare(source.id)}
                sx={(theme) => ({
                  appearance: 'none',
                  bgcolor: theme.palette.action.hover,
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: 2,
                  color: 'inherit',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  minWidth: 0,
                  overflow: 'hidden',
                  p: 0,
                  textAlign: 'left',
                  transition: 'border-color 120ms ease, transform 120ms ease',
                  '&:hover': {
                    borderColor: theme.palette.primary.main,
                    transform: 'translateY(-1px)',
                  },
                  '&:focus-visible': {
                    outline: `2px solid ${theme.palette.primary.main}`,
                    outlineOffset: 2,
                  },
                })}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    bgcolor: '#090b0f',
                    display: 'flex',
                    justifyContent: 'center',
                    width: '100%',
                    aspectRatio: '16 / 9',
                  }}
                >
                  {source.thumbnail ? (
                    <Box
                      component="img"
                      alt=""
                      src={source.thumbnail}
                      sx={{
                        height: '100%',
                        objectFit: 'contain',
                        width: '100%',
                      }}
                    />
                  ) : (
                    <ScreenShareRoundedIcon
                      sx={{ color: 'grey.600', fontSize: 38 }}
                    />
                  )}
                </Box>
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    gap: 1,
                    minWidth: 0,
                    px: 1.25,
                    py: 1,
                    width: '100%',
                  }}
                >
                  {source.appIcon ? (
                    <Box
                      component="img"
                      alt=""
                      src={source.appIcon}
                      sx={{ height: 20, width: 20 }}
                    />
                  ) : (
                    <ScreenShareRoundedIcon sx={{ fontSize: 19 }} />
                  )}
                  <Typography
                    sx={{
                      fontSize: 13,
                      fontWeight: 700,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {source.name}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        ) : (
          <Box
            sx={{
              alignItems: 'center',
              bgcolor: '#07090d',
              borderRadius: 2,
              display: 'flex',
              justifyContent: 'center',
              minHeight: { xs: 260, md: 480 },
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {screenShareStream ? (
              <Box
                component="video"
                ref={attachVideo}
                autoPlay
                playsInline
                muted
                onLoadedMetadata={(event) =>
                  ensureVideoPlayback(event.currentTarget)
                }
                onCanPlay={(event) => ensureVideoPlayback(event.currentTarget)}
                sx={{
                  display: 'block',
                  maxHeight: '68vh',
                  objectFit: 'contain',
                  width: '100%',
                }}
              />
            ) : (
              <Typography color="text.secondary">
                Establishing screen share…
              </Typography>
            )}
          </Box>
        )}
      </DialogContent>

      {choosing || sharing || starting ? (
        <DialogActions sx={{ px: 2.5, py: 1.5 }}>
          {choosing ? (
            <Button onClick={cancelScreenSharePicker}>Cancel</Button>
          ) : (
            <Button
              color="error"
              variant="contained"
              startIcon={<StopScreenShareRoundedIcon />}
              onClick={() => void stopScreenShare()}
            >
              {starting ? 'Cancel screen share' : 'Stop sharing'}
            </Button>
          )}
        </DialogActions>
      ) : null}
    </Dialog>
  );
}
