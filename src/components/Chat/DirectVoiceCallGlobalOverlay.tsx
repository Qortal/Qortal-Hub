/**
 * Full-window incoming DM voice call UI (Telegram-style).
 * Shown for any authenticated main-window user when a direct (`direct:…`) call rings.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Dialog,
  Typography,
} from '@mui/material';
import CallEndRoundedIcon from '@mui/icons-material/CallEndRounded';
import CallRoundedIcon from '@mui/icons-material/CallRounded';
import { useVoiceCallContext } from '../../context/VoiceCallContext';
import { isDirectVoiceCallChatId } from '../../lib/call/directVoiceCallChatId';
import { startDirectIncomingRingtone } from '../../lib/call/directIncomingRingtone';
import {
  addrHue,
  initialsFromDisplayLabel,
  qortalAvatarThumbnailSrc,
  shortAddr,
} from '../Group/qortalGroupCallParticipantUi';
import { getPrimaryNameForAvatar } from '../Group/groupApi';

export function DirectVoiceCallGlobalOverlay() {
  const { callState, incomingCall, acceptCall, rejectCall } =
    useVoiceCallContext();

  const open =
    callState === 'ringing' &&
    Boolean(incomingCall) &&
    isDirectVoiceCallChatId(incomingCall?.chatId);

  const fromAddress = incomingCall?.fromAddress ?? '';
  const [callerPrimaryName, setCallerPrimaryName] = useState('');
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);

  useEffect(() => {
    if (!fromAddress) {
      setCallerPrimaryName('');
      return;
    }
    let cancelled = false;
    getPrimaryNameForAvatar(fromAddress)
      .then((name) => {
        if (!cancelled) setCallerPrimaryName(name?.trim() ?? '');
      })
      .catch(() => {
        if (!cancelled) setCallerPrimaryName('');
      });
    return () => {
      cancelled = true;
    };
  }, [fromAddress]);

  const displayLabel =
    callerPrimaryName || (fromAddress ? shortAddr(fromAddress) : '');
  const avatarSrc = qortalAvatarThumbnailSrc(
    callerPrimaryName || undefined
  );
  const initials = initialsFromDisplayLabel(displayLabel, fromAddress);

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [avatarSrc]);

  const stopRingRef = useRef<(() => void) | null>(null);
  const stopRing = useCallback(() => {
    stopRingRef.current?.();
    stopRingRef.current = null;
  }, []);

  const onDecline = useCallback(() => {
    stopRing();
    void rejectCall();
  }, [rejectCall, stopRing]);

  const onAccept = useCallback(() => {
    stopRing();
    void acceptCall();
  }, [acceptCall, stopRing]);

  useEffect(() => {
    if (!open) {
      stopRing();
      return;
    }
    stopRingRef.current = startDirectIncomingRingtone();
    return () => {
      stopRingRef.current?.();
      stopRingRef.current = null;
    };
  }, [open, stopRing]);

  return (
    <Dialog
      open={open}
      onClose={(_e, reason) => {
        if (reason === 'backdropClick' || reason === 'escapeKeyDown') {
          stopRing();
          void rejectCall();
        }
      }}
      slotProps={{
        root: { sx: { zIndex: 2000 } },
        backdrop: {
          sx: { backgroundColor: 'rgba(0,0,0,0.72)' },
        },
      }}
      PaperProps={{
        elevation: 24,
        sx: (theme) => ({
          borderRadius: 3,
          maxWidth: 380,
          width: '100%',
          mx: 2,
          p: 3,
          textAlign: 'center',
          backgroundImage:
            theme.palette.mode === 'dark'
              ? 'linear-gradient(165deg, rgba(59,130,246,0.12) 0%, rgba(15,23,42,0.98) 45%)'
              : 'linear-gradient(165deg, rgba(59,130,246,0.08) 0%, #fff 50%)',
        }),
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
        }}
      >
        <Typography variant="overline" sx={{ letterSpacing: 1.2, opacity: 0.75 }}>
          Incoming voice call
        </Typography>
        <Avatar
          alt={displayLabel}
          src={
            avatarSrc && !avatarLoadFailed ? avatarSrc : undefined
          }
          slotProps={{
            img: {
              onError: () => setAvatarLoadFailed(true),
            },
          }}
          sx={{
            width: 96,
            height: 96,
            fontSize: 36,
            fontWeight: 700,
            bgcolor: addrHue(fromAddress),
            color: '#fff',
          }}
        >
          {avatarSrc && !avatarLoadFailed ? null : initials}
        </Avatar>
        <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
          {displayLabel}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>
          Direct message
        </Typography>
        <Box
          sx={{
            display: 'flex',
            gap: 2,
            justifyContent: 'center',
            width: '100%',
            mt: 1,
          }}
        >
          <Button
            variant="contained"
            size="large"
            onClick={onDecline}
            sx={{
              flex: 1,
              py: 1.5,
              borderRadius: 2,
              bgcolor: '#f23f42',
              '&:hover': { bgcolor: '#d32f32' },
            }}
            startIcon={<CallEndRoundedIcon />}
          >
            Decline
          </Button>
          <Button
            variant="contained"
            size="large"
            onClick={onAccept}
            sx={{
              flex: 1,
              py: 1.5,
              borderRadius: 2,
              bgcolor: '#23a559',
              '&:hover': { bgcolor: '#1d8f4c' },
            }}
            startIcon={<CallRoundedIcon />}
          >
            Accept
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
}
