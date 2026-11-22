import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  useTheme,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
  NodeAdminError,
  nodeAdminRequest,
  type NodeAdminFailure,
} from './nodeAdmin';
import {
  dangerButtonSx,
  primaryButtonSx,
  quietButtonSx,
  textButtonSx,
  windowBackdropSx,
  windowPaperSx,
} from './nodeManagerLook';

export type NodeActionState =
  | { status: 'running' }
  | { status: 'done'; answer: string }
  | { status: 'failed'; reason: NodeAdminFailure };

/**
 * Runs admin actions on the node, one at a time per action id. An answer
 * counts only for the window and node that asked: once unmounted (closed,
 * locked, another node chosen) its requests are called off, and any answer
 * still coming is dropped.
 */
export const useNodeActions = (nodeBase: string) => {
  const [states, setStates] = useState<Record<string, NodeActionState>>({});
  const running = useRef(new Set<string>());
  const alive = useRef(true);
  const controller = useRef(new AbortController());
  useEffect(() => {
    alive.current = true;
    if (controller.current.signal.aborted)
      controller.current = new AbortController();
    return () => {
      alive.current = false;
      controller.current.abort();
    };
  }, []);

  const run = useCallback(
    async (
      id: string,
      path: string,
      init: Omit<Parameters<typeof nodeAdminRequest>[2], 'signal'> = {}
    ): Promise<NodeActionState> => {
      if (running.current.has(id)) return { status: 'running' };
      running.current.add(id);
      setStates((previous) => ({ ...previous, [id]: { status: 'running' } }));
      let next: NodeActionState;
      try {
        next = {
          answer: await nodeAdminRequest(nodeBase, path, {
            ...init,
            signal: controller.current.signal,
          }),
          status: 'done',
        };
      } catch (error) {
        next = {
          reason: error instanceof NodeAdminError ? error.reason : 'failed',
          status: 'failed',
        };
      } finally {
        running.current.delete(id);
      }
      if (alive.current) setStates((previous) => ({ ...previous, [id]: next }));
      return next;
    },
    [nodeBase]
  );

  const clear = useCallback((id: string) => {
    setStates((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
  }, []);

  return { clear, run, states };
};

/**
 * The last value that wasn't null, so a dialog keeps its words while it
 * fades out after its value was cleared.
 */
export const useLastShown = <T,>(value: T | null): T | null => {
  const last = useRef<T | null>(value);
  if (value !== null) last.current = value;
  return value ?? last.current;
};

/** Why an action didn't happen, in words. */
export const useFailureText = () => {
  const { t } = useTranslation(['node']);
  return (reason: NodeAdminFailure) =>
    t(`node:manager.action.failed_${reason}`);
};

/** What an action did, or why not, under its button. */
export const ActionNote = ({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'error' | 'success';
}) => {
  const theme = useTheme();
  const color =
    tone === 'error'
      ? theme.palette.error.main
      : tone === 'success'
        ? theme.palette.success.main
        : theme.palette.text.secondary;
  return (
    <Typography
      role="status"
      sx={{ color, fontSize: '0.84rem', lineHeight: 1.45 }}
    >
      {children}
    </Typography>
  );
};

/**
 * A button that shows a spinner while its action runs, in the minting
 * window's styles: `contained` is its gradient button (blue, or rose for
 * `error`), `outlined` a quiet one, `text` a plain one.
 */
export const ActionButton = ({
  busy,
  children,
  color = 'primary',
  disabled = false,
  onClick,
  variant = 'outlined',
}: {
  busy?: boolean;
  children: ReactNode;
  color?: 'primary' | 'error';
  disabled?: boolean;
  onClick: () => void;
  variant?: 'outlined' | 'contained' | 'text';
}) => {
  const theme = useTheme();
  const sx =
    variant === 'contained'
      ? color === 'error'
        ? dangerButtonSx(theme)
        : primaryButtonSx(theme)
      : variant === 'outlined'
        ? quietButtonSx(theme)
        : textButtonSx;
  return (
    <Button
      color={color}
      disabled={disabled || busy}
      onClick={onClick}
      size="small"
      startIcon={busy ? <CircularProgress color="inherit" size={14} /> : null}
      sx={sx}
      variant={variant}
    >
      {children}
    </Button>
  );
};

/**
 * Asks before an action: what it does, in one or two sentences, with the
 * button in red when it takes the node down or changes its chain.
 */
export const ConfirmActionDialog = ({
  body,
  confirmLabel,
  danger = false,
  onCancel,
  onConfirm,
  open,
  title,
}: {
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  return (
    <Dialog
      aria-describedby="node-manager-confirm-body"
      aria-labelledby="node-manager-confirm-title"
      BackdropProps={{ sx: windowBackdropSx }}
      onClose={onCancel}
      open={open}
      PaperProps={{ sx: { ...windowPaperSx(theme), maxWidth: 480 } }}
    >
      <DialogTitle
        id="node-manager-confirm-title"
        sx={{ fontSize: '1.05rem', fontWeight: 800, letterSpacing: '-0.02em' }}
      >
        {title}
      </DialogTitle>
      <DialogContent>
        <Box
          id="node-manager-confirm-body"
          sx={{ color: theme.palette.text.secondary, fontSize: '0.9rem' }}
        >
          {body}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel} sx={textButtonSx} variant="text">
          {t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
        </Button>
        <Button
          color={danger ? 'error' : 'primary'}
          onClick={onConfirm}
          sx={danger ? dangerButtonSx(theme) : primaryButtonSx(theme)}
          variant="contained"
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
