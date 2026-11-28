import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  LinearProgress,
  Paper,
  Portal,
  Stack,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import type { QAppSaveUpdate } from '../../../../electron/src/qapp-context-menu-types';

/** A finished save's card leaves after this long; a failed one stays. */
export const SAVED_CARD_MS = 10_000;
export const CANCELLED_CARD_MS = 4_000;
/** Cards shown at most: the newest. */
const MAX_CARDS = 4;

/**
 * Saves started from the right-click menu in a Q-App: progress, Cancel, and
 * Show in folder once saved. It stays on screen outside the apps view too, so
 * a save started there can be followed from Home.
 */
export function QAppSavesNotice() {
  const { t } = useTranslation(['core']);
  const theme = useTheme();
  const [saves, setSaves] = useState<QAppSaveUpdate[]>([]);
  // Saves this page saw start: a later page (another account) never takes
  // up one it didn't.
  const knownRef = useRef(new Set<string>());
  // Each finished card's own timer, started once.
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const remove = (saveId: string) => {
    clearTimeout(timersRef.current.get(saveId));
    timersRef.current.delete(saveId);
    setSaves((current) => current.filter((save) => save.saveId !== saveId));
  };
  const removeRef = useRef(remove);
  removeRef.current = remove;

  useEffect(() => {
    const timers = timersRef.current;
    const stop = window.electronAPI?.onQAppSaveUpdate?.((update) => {
      if (!update || typeof update.saveId !== 'string') return;
      if (update.first) knownRef.current.add(update.saveId);
      if (!knownRef.current.has(update.saveId)) return;
      if (
        (update.state === 'done' || update.state === 'cancelled') &&
        !timers.has(update.saveId)
      ) {
        timers.set(
          update.saveId,
          setTimeout(
            () => removeRef.current(update.saveId),
            update.state === 'done' ? SAVED_CARD_MS : CANCELLED_CARD_MS
          )
        );
      }
      // Every save is kept, in the order they started, and the newest few
      // are shown: an older save's progress never pushes a newer card out.
      setSaves((current) =>
        current.some((save) => save.saveId === update.saveId)
          ? current.map((save) =>
              save.saveId === update.saveId ? update : save
            )
          : [...current, update]
      );
    });
    return () => {
      stop?.();
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  if (!saves.length) return null;

  const status = (save: QAppSaveUpdate) => {
    switch (save.state) {
      case 'saving':
        return save.percent === undefined
          ? t('core:qapp_menu.saving', { postProcess: 'capitalizeFirstChar' })
          : t('core:qapp_menu.saving_percent', {
              percent: save.percent,
              postProcess: 'capitalizeFirstChar',
            });
      case 'done':
        return t('core:qapp_menu.saved', {
          postProcess: 'capitalizeFirstChar',
        });
      case 'cancelled':
        return t('core:qapp_menu.save_cancelled', {
          postProcess: 'capitalizeFirstChar',
        });
      default:
        return t('core:qapp_menu.save_failed', {
          postProcess: 'capitalizeFirstChar',
        });
    }
  };

  return (
    <Portal>
      <Stack
        aria-live="polite"
        role="status"
        spacing={1}
        sx={{
          bottom: 16,
          maxWidth: 'calc(100vw - 32px)',
          position: 'fixed',
          right: 16,
          width: 300,
          zIndex: theme.zIndex.snackbar,
        }}
      >
        {saves.slice(-MAX_CARDS).map((save) => (
          <Paper
            key={save.saveId}
            data-save-state={save.state}
            elevation={6}
            sx={{
              backgroundColor: theme.palette.background.default,
              border: `1px solid ${theme.palette.border.subtle}`,
              borderRadius: '8px',
              px: 1.5,
              py: 1,
            }}
          >
            <Box sx={{ alignItems: 'center', display: 'flex', gap: 1 }}>
              <Typography
                noWrap
                title={save.name}
                variant="body2"
                sx={{ flex: 1, fontWeight: 600, minWidth: 0 }}
              >
                {save.name}
              </Typography>
              {save.state === 'saving' ? (
                <Button
                  size="small"
                  onClick={() =>
                    void window.electronAPI?.qappSaveCancel?.(save.saveId)
                  }
                >
                  {t('core:action.cancel', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>
              ) : (
                <IconButton
                  aria-label={t('core:action.close', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                  size="small"
                  onClick={() => remove(save.saveId)}
                >
                  <CloseRoundedIcon sx={{ fontSize: 16 }} />
                </IconButton>
              )}
            </Box>
            <Typography
              variant="caption"
              sx={{
                color:
                  save.state === 'failed'
                    ? theme.palette.error.main
                    : theme.palette.text.secondary,
              }}
            >
              {status(save)}
            </Typography>
            {save.state === 'saving' && (
              <LinearProgress
                sx={{ borderRadius: 1, mt: 0.75 }}
                value={save.percent ?? 0}
                variant={
                  save.percent === undefined ? 'indeterminate' : 'determinate'
                }
              />
            )}
            {save.state === 'done' && (
              <Box sx={{ mt: 0.5 }}>
                <Button
                  size="small"
                  sx={{ px: 0 }}
                  onClick={() =>
                    void window.electronAPI?.qappSaveShow?.(save.saveId)
                  }
                >
                  {t('core:qapp_menu.show_in_folder', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>
              </Box>
            )}
          </Paper>
        ))}
      </Stack>
    </Portal>
  );
}
