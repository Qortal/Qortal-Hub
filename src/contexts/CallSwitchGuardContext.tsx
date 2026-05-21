import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
import CallEndRoundedIcon from '@mui/icons-material/CallEndRounded';
import CallRoundedIcon from '@mui/icons-material/CallRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import { useVoiceCallContext } from '../context/VoiceCallContext';
import { useGroupCallContext } from './GroupCallContext';

type CallSwitchTarget =
  | { type: 'direct'; chatId: string }
  | { type: 'group'; roomId: string };

interface CallSwitchGuardContextValue {
  confirmCallSwitch: (target: CallSwitchTarget) => Promise<boolean>;
}

const CallSwitchGuardContext =
  createContext<CallSwitchGuardContextValue | null>(null);

function isDirectActive(callState: string) {
  return callState === 'calling' || callState === 'connected';
}

function isGroupActive(roomState: string) {
  return roomState === 'joining' || roomState === 'connected';
}

function waitForCondition(
  condition: () => boolean,
  timeoutMs = 6000
): Promise<void> {
  if (condition()) return Promise.resolve();
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      if (condition() || Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(id);
        resolve();
      }
    }, 80);
  });
}

export function CallSwitchGuardProvider({
  children,
}: {
  children: ReactNode;
}) {
  const directCall = useVoiceCallContext();
  const groupCall = useGroupCallContext();
  const theme = useTheme();
  const [pendingTarget, setPendingTarget] = useState<CallSwitchTarget | null>(
    null
  );
  const [switching, setSwitching] = useState(false);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const directStateRef = useRef(directCall.callState);
  const directChatIdRef = useRef(directCall.activeCallChatId);
  const groupStateRef = useRef(groupCall.roomState);
  const groupRoomIdRef = useRef(groupCall.roomId);

  useEffect(() => {
    directStateRef.current = directCall.callState;
    directChatIdRef.current = directCall.activeCallChatId;
  }, [directCall.activeCallChatId, directCall.callState]);

  useEffect(() => {
    groupStateRef.current = groupCall.roomState;
    groupRoomIdRef.current = groupCall.roomId;
  }, [groupCall.roomId, groupCall.roomState]);

  const currentLabel = useMemo(() => {
    if (isDirectActive(directCall.callState)) return 'direct message call';
    if (isGroupActive(groupCall.roomState)) return 'group call';
    return 'call';
  }, [directCall.callState, groupCall.roomState]);

  const targetLabel =
    pendingTarget?.type === 'group' ? 'group call' : 'direct message call';

  const dropCurrentCalls = useCallback(async () => {
    const shouldDropDirect =
      isDirectActive(directStateRef.current) ||
      directStateRef.current === 'ringing';
    const shouldDropGroup = isGroupActive(groupStateRef.current);

    const drops: Promise<unknown>[] = [];
    if (shouldDropDirect) drops.push(directCall.hangUp());
    if (shouldDropGroup) drops.push(groupCall.leaveGroupCall());
    await Promise.allSettled(drops);

    await waitForCondition(
      () =>
        (!shouldDropDirect || directStateRef.current === 'idle') &&
        (!shouldDropGroup || groupStateRef.current === 'idle')
    );
  }, [directCall, groupCall]);

  const closePrompt = useCallback((confirmed: boolean) => {
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
    setPendingTarget(null);
    setSwitching(false);
  }, []);

  const confirmCallSwitch = useCallback(
    async (target: CallSwitchTarget) => {
      const directActive = isDirectActive(directStateRef.current);
      const groupActive = isGroupActive(groupStateRef.current);
      const sameDirect =
        target.type === 'direct' &&
        directActive &&
        directChatIdRef.current === target.chatId;
      const sameGroup =
        target.type === 'group' &&
        groupActive &&
        groupRoomIdRef.current === target.roomId;

      const needsPrompt =
        (directActive || groupActive) && !sameDirect && !sameGroup;
      if (!needsPrompt) return true;

      const confirmed = await new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setPendingTarget(target);
      });
      if (!confirmed) return false;

      setSwitching(true);
      await dropCurrentCalls();
      closePrompt(true);
      return true;
    },
    [closePrompt, dropCurrentCalls]
  );

  const value = useMemo(
    () => ({ confirmCallSwitch }),
    [confirmCallSwitch]
  );

  return (
    <CallSwitchGuardContext.Provider value={value}>
      {children}
      <Dialog
        open={Boolean(pendingTarget)}
        onClose={() => {
          if (!switching) closePrompt(false);
        }}
        maxWidth="xs"
        fullWidth
        slotProps={{
          root: { sx: { zIndex: 2200 } },
          backdrop: { sx: { backgroundColor: 'rgba(0,0,0,0.62)' } },
        }}
        PaperProps={{
          elevation: 24,
          sx: {
            borderRadius: 2,
            overflow: 'hidden',
            backgroundImage:
              theme.palette.mode === 'dark'
                ? 'linear-gradient(160deg, rgba(59,130,246,0.14), rgba(15,23,42,0.98) 46%)'
                : 'linear-gradient(160deg, rgba(59,130,246,0.08), #fff 48%)',
          },
        }}
      >
        <DialogTitle sx={{ pb: 1.25 }}>
          <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.25 }}>
            <Box
              sx={{
                alignItems: 'center',
                bgcolor:
                  theme.palette.mode === 'dark'
                    ? 'rgba(239,68,68,0.16)'
                    : 'rgba(239,68,68,0.1)',
                borderRadius: '50%',
                color: '#ef4444',
                display: 'flex',
                flexShrink: 0,
                height: 38,
                justifyContent: 'center',
                width: 38,
              }}
            >
              <CallEndRoundedIcon fontSize="small" />
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 750, lineHeight: 1.2 }}>
              Switch calls?
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.5 }}>
          <Typography sx={{ color: 'text.secondary', fontSize: 14 }}>
            You are already in a {currentLabel}. Continuing will fully drop it
            before connecting to the new {targetLabel}.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ gap: 1, px: 3, pb: 2.5, pt: 1 }}>
          <Button
            disabled={switching}
            onClick={() => closePrompt(false)}
            sx={{ borderRadius: 1.5, px: 2 }}
          >
            Stay
          </Button>
          <Button
            variant="contained"
            disabled={switching}
            onClick={() => {
              resolverRef.current?.(true);
            }}
            startIcon={
              switching ? (
                <CircularProgress color="inherit" size={16} />
              ) : pendingTarget?.type === 'group' ? (
                <GroupsRoundedIcon />
              ) : (
                <CallRoundedIcon />
              )
            }
            sx={{
              borderRadius: 1.5,
              bgcolor: '#ef4444',
              px: 2,
              '&:hover': { bgcolor: '#dc2626' },
            }}
          >
            {switching ? 'Dropping call...' : 'Drop and continue'}
          </Button>
        </DialogActions>
      </Dialog>
    </CallSwitchGuardContext.Provider>
  );
}

export function useCallSwitchGuard(): CallSwitchGuardContextValue {
  const ctx = useContext(CallSwitchGuardContext);
  if (!ctx) {
    throw new Error(
      'useCallSwitchGuard must be used within CallSwitchGuardProvider'
    );
  }
  return ctx;
}
