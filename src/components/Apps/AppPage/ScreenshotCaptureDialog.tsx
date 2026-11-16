import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  alpha,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import PhotoCameraRoundedIcon from '@mui/icons-material/PhotoCameraRounded';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../../../App';
import { createEndpoint } from '../../../background/background';
import AppViewerContainer from '../AppViewerContainer';
import { SHOT_LIMITS } from './appPageData';
import { encodeScreenshot } from './screenshotImage';
import { blobBytes, bytesToBase64 } from './blobBytes';
import type { ShotDraft } from './ScreenshotsEditor';
import { useLauncherTabDialog } from '../launcherTabs';

export type CaptureSource =
  | { kind: 'published'; service: string; name: string }
  | { kind: 'zip'; service: string; name: string; file: Blob };

interface Captured {
  png: Uint8Array;
  width: number;
  height: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How often, and how many times, to look whether the app is showing yet. */
export const READY_POLL_MS = 500;
export const READY_POLL_TRIES = 60;

const CAPTURE = { action: 'capture' } as const;

const blobToBase64 = async (blob: Blob) => bytesToBase64(await blobBytes(blob));

let captureCounter = 0;

export const isCaptureAvailable = () =>
  typeof window !== 'undefined' &&
  typeof window.electronAPI?.qappGuestShot === 'function' &&
  typeof window.electronAPI?.qappGuestPrepare === 'function';

/**
 * Shows the app as a tab would, for the publisher to move around in and
 * capture the screens they want, one press each. Nothing is taken by itself.
 */
export const ScreenshotCaptureDialog = ({
  open,
  source,
  slots,
  onClose,
  onDone,
}: {
  open: boolean;
  source: CaptureSource | null;
  /** How many screenshots may still be added. */
  slots: number;
  onClose: () => void;
  onDone: (shots: ShotDraft[]) => void;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const viewRef = useRef<any>(null);
  const [app, setApp] = useState<any>(null);
  const [failed, setFailed] = useState('');
  const [ready, setReady] = useState(false);
  const [shots, setShots] = useState<ShotDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const shotsRef = useRef<ShotDraft[]>([]);
  shotsRef.current = shots;
  const owner = useMemo(
    () =>
      app
        ? { tabId: String(app.tabId), name: app.name, service: app.service }
        : null,
    [app]
  );

  // Show the app: as published, or as a preview of the chosen zip.
  useEffect(() => {
    if (!open || !source) return;
    let alive = true;
    setFailed('');
    setReady(false);
    setShots([]);
    setError('');
    const tabId = `qhub-shots-${Date.now()}-${++captureCounter}`;
    if (source.kind === 'published') {
      setApp({ tabId, name: source.name, service: source.service });
      return;
    }
    (async () => {
      try {
        const endpoint = await createEndpoint(
          `/arbitrary/${source.service}/${encodeURIComponent(source.name)}/zip?preview=true`
        );
        const response = await fetch(endpoint, {
          body: await blobToBase64(source.file),
          headers: { 'Content-Type': 'text/plain' },
          method: 'POST',
        });
        if (!response.ok) throw new Error('PREVIEW_FAILED');
        const path = await response.text();
        if (!alive) return;
        setApp({
          isPreview: true,
          name: source.name,
          service: source.service,
          tabId,
          url: getBaseApiReact() + path,
        });
      } catch {
        if (alive)
          setFailed(
            t('core:app_page.capture.preview_failed', {
              postProcess: 'capitalizeFirstChar',
            })
          );
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, source, t]);

  useEffect(() => {
    if (!open) setApp(null);
  }, [open]);

  const capture = useCallback(
    (): Promise<Captured> =>
      window.electronAPI!.qappGuestShot!(owner!, CAPTURE),
    [owner]
  );

  // A capture works once the guest is attached and has drawn a page; until
  // then, the app's own loading shows under a note.
  useEffect(() => {
    if (!owner || !open) return;
    let alive = true;
    (async () => {
      for (let attempt = 0; attempt < READY_POLL_TRIES && alive; attempt++) {
        try {
          await capture();
          if (alive) setReady(true);
          return;
        } catch {
          // Not attached, or nothing drawn yet.
        }
        await sleep(READY_POLL_MS);
      }
      if (alive)
        setFailed(
          t('core:app_page.capture.not_ready', {
            postProcess: 'capitalizeFirstChar',
          })
        );
    })();
    return () => {
      alive = false;
    };
  }, [capture, open, owner, t]);

  const full = shots.length >= slots;

  const captureNow = async () => {
    if (!ready || busy || shotsRef.current.length >= slots) return;
    setBusy(true);
    setError('');
    try {
      const captured = await capture();
      const encoded = await encodeScreenshot(
        new Blob([captured.png as BlobPart], { type: 'image/png' }),
        SHOT_LIMITS.maxSide
      );
      const draft: ShotDraft = {
        id: `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        url: URL.createObjectURL(encoded.blob),
        blob: encoded.blob,
        caption: '',
        width: encoded.width,
        height: encoded.height,
      };
      setShots((list) => [...list, draft].slice(0, slots));
    } catch {
      setError(
        t('core:app_page.capture.capture_failed', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    } finally {
      setBusy(false);
    }
  };

  const move = (index: number, delta: number) =>
    setShots((list) => {
      const target = index + delta;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const remove = (item: ShotDraft) => {
    URL.revokeObjectURL(item.url);
    setShots((list) => list.filter((entry) => entry.id !== item.id));
  };

  const close = () => {
    shots.forEach((item) => URL.revokeObjectURL(item.url));
    onClose();
  };

  const chipSx = {
    backgroundColor: alpha(theme.palette.background.default, 0.82),
    '&:hover': { backgroundColor: theme.palette.background.default },
  };

  // Put away, the app kept running in it, while its launcher tab is hidden.
  const dialogShown = useLauncherTabDialog(open);

  return (
    <Dialog
      PaperProps={{ sx: { borderRadius: '18px' } }}
      aria-describedby="app-page-capture-instructions"
      fullWidth
      maxWidth="lg"
      onClose={close}
      {...dialogShown}
    >
      {/* The title names the dialog: the instructions and Close stay out. */}
      <DialogTitle sx={{ pb: 0.5, pr: 6 }}>
        {t('core:app_page.capture.title', {
          postProcess: 'capitalizeFirstChar',
        })}
      </DialogTitle>
      <IconButton
        aria-label={t('core:action.close', {
          postProcess: 'capitalizeFirstChar',
        })}
        onClick={close}
        sx={{ position: 'absolute', right: 12, top: 12 }}
      >
        <CloseRoundedIcon />
      </IconButton>
      <Typography
        id="app-page-capture-instructions"
        sx={{ color: 'text.secondary', fontSize: '13px', pb: 1.5, px: 3 }}
      >
        {t('core:app_page.capture.instructions', {
          postProcess: 'capitalizeFirstChar',
        })}
      </Typography>
      <DialogContent>
        <Box
          sx={{
            aspectRatio: '16 / 10',
            backgroundColor: theme.palette.background.default,
            border: `1px solid ${alpha(theme.palette.text.primary, 0.12)}`,
            borderRadius: '14px',
            maxHeight: '62vh',
            mx: 'auto',
            overflow: 'hidden',
            position: 'relative',
            width: '100%',
          }}
        >
          {app && !failed && (
            <AppViewerContainer
              app={app}
              customHeight="100%"
              hide={false}
              isDevMode={false}
              isSelected
              ref={viewRef}
            />
          )}
          {(!ready || failed) && (
            <Box
              sx={{
                alignItems: 'center',
                backgroundColor: alpha(theme.palette.background.default, 0.85),
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
                inset: 0,
                justifyContent: 'center',
                p: 3,
                position: 'absolute',
                textAlign: 'center',
              }}
            >
              {failed ? (
                <Typography sx={{ color: 'text.secondary' }}>
                  {failed}
                </Typography>
              ) : (
                <>
                  <CircularProgress size={28} />
                  <Typography
                    sx={{ color: 'text.secondary', fontSize: '14px' }}
                  >
                    {t('core:app_page.capture.loading', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                </>
              )}
            </Box>
          )}
        </Box>

        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1,
            justifyContent: 'space-between',
            mt: 1.5,
          }}
        >
          <Button
            disableElevation
            disabled={!ready || !!failed || busy || full}
            onClick={captureNow}
            startIcon={
              busy ? (
                <CircularProgress color="inherit" size={14} />
              ) : (
                <PhotoCameraRoundedIcon />
              )
            }
            sx={{ borderRadius: '12px', textTransform: 'none' }}
            variant="contained"
          >
            {t('core:app_page.capture.capture_this', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
          <Typography
            aria-live="polite"
            sx={{
              color: error ? theme.palette.error.main : 'text.secondary',
              fontSize: '13px',
            }}
          >
            {error ||
              (full && slots > 0
                ? t('core:app_page.capture.full', {
                    postProcess: 'capitalizeFirstChar',
                  })
                : t('core:app_page.capture.count', {
                    done: shots.length,
                    slots,
                  }))}
          </Typography>
        </Box>

        {shots.length > 0 && (
          <Box
            sx={{
              display: 'flex',
              gap: 1,
              mt: 1.5,
              overflowX: 'auto',
              pb: 0.5,
            }}
          >
            {shots.map((item, index) => (
              <Box
                key={item.id}
                sx={{
                  border: `1px solid ${alpha(theme.palette.text.primary, 0.14)}`,
                  borderRadius: '10px',
                  flexShrink: 0,
                  height: 90,
                  overflow: 'hidden',
                  position: 'relative',
                  width: 144,
                }}
              >
                <img
                  alt={t('core:app_page.screenshots.alt', {
                    index: index + 1,
                    name: source?.name || '',
                    postProcess: 'capitalizeFirstChar',
                  })}
                  src={item.url}
                  style={{ height: '100%', objectFit: 'cover', width: '100%' }}
                />
                <Box
                  sx={{
                    display: 'flex',
                    gap: 0.25,
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
                      icon: <CloseRoundedIcon sx={{ fontSize: 16 }} />,
                      onClick: () => remove(item),
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
                          sx={chipSx}
                        >
                          {action.icon}
                        </IconButton>
                      </span>
                    </Tooltip>
                  ))}
                </Box>
                <Typography
                  sx={{
                    backgroundColor: chipSx.backgroundColor,
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
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={close} sx={{ textTransform: 'none' }}>
          {t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
        </Button>
        <Button
          disableElevation
          disabled={shots.length === 0 || busy}
          onClick={() => onDone(shots)}
          sx={{ borderRadius: '12px', textTransform: 'none' }}
          variant="contained"
        >
          {t('core:app_page.capture.use', {
            count: shots.length,
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
