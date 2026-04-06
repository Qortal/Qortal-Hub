/**
 * Slim right rail for 1:1 P2P voice calls (direct `direct:…` chatId), alongside
 * {@link QortalGroupVoiceCallDock}.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import {
  Avatar,
  Box,
  Chip,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import CallEndRoundedIcon from '@mui/icons-material/CallEndRounded';
import MicRoundedIcon from '@mui/icons-material/MicRounded';
import MicOffRoundedIcon from '@mui/icons-material/MicOffRounded';
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded';
import VolumeOffRoundedIcon from '@mui/icons-material/VolumeOffRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import { userInfoAtom } from '../../atoms/global';
import { useVoiceCallContext } from '../../context/VoiceCallContext';
import {
  isDirectVoiceCallChatId,
  peerAddressFromDirectVoiceChatId,
} from '../../lib/call/directVoiceCallChatId';
import {
  addrHue,
  initialsFromDisplayLabel,
  qortalAvatarThumbnailSrc,
  shortAddr,
} from './qortalGroupCallParticipantUi';
import { CallAudioSettingsButton } from '../Chat/CallAudioDeviceSelectors';
import { getPrimaryNameForAvatar } from './groupApi';
import { useTranslation } from 'react-i18next';
import { DirectVoiceDebugPanel } from './DirectVoiceDebugPanel';

const BG_RAIL = '#2b2d31';
const TEXT_MUTED = '#949ba4';
const DANGER = '#f23f42';

export function DirectVoiceCallDock() {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const userInfo = useAtomValue(userInfoAtom);
  const myAddress = userInfo?.address ?? '';
  const {
    callState,
    audioMode,
    isMuted,
    hearCall,
    callDuration,
    activeCallChatId,
    hangUp,
    toggleMute,
    toggleHearCall,
  } = useVoiceCallContext();

  const activeDirect =
    isDirectVoiceCallChatId(activeCallChatId) &&
    (callState === 'connected' || callState === 'calling');

  const peerAddress = useMemo(() => {
    if (!activeCallChatId || !myAddress) return '';
    return peerAddressFromDirectVoiceChatId(activeCallChatId, myAddress) ?? '';
  }, [activeCallChatId, myAddress]);

  const [peerPrimaryName, setPeerPrimaryName] = useState('');
  useEffect(() => {
    if (!peerAddress) {
      setPeerPrimaryName('');
      return;
    }
    let cancelled = false;
    getPrimaryNameForAvatar(peerAddress)
      .then((name) => {
        if (!cancelled) setPeerPrimaryName(name?.trim() ?? '');
      })
      .catch(() => {
        if (!cancelled) setPeerPrimaryName('');
      });
    return () => {
      cancelled = true;
    };
  }, [peerAddress]);

  const title = peerPrimaryName || (peerAddress ? shortAddr(peerAddress) : 'Voice call');
  const avatarRegName = peerPrimaryName || undefined;
  const avatarSrc = qortalAvatarThumbnailSrc(avatarRegName);
  const initials = initialsFromDisplayLabel(title, peerAddress || myAddress);

  const transport = useMemo(() => {
    if (callState === 'calling') {
      return {
        label: 'Calling…',
        tooltip: 'Waiting for peer to answer',
        mode: 'connecting' as const,
      };
    }
    if (audioMode === 'reticulum') {
      return {
        label: 'Reticulum',
        tooltip: 'Encrypted voice over Reticulum',
        mode: 'reticulum' as const,
      };
    }
    return {
      label: '…',
      tooltip: 'Connecting',
      mode: 'connecting' as const,
    };
  }, [audioMode, callState]);

  const durationLabel = useMemo(() => {
    const s = callDuration;
    const m = Math.floor(s / 60)
      .toString()
      .padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  }, [callDuration]);

  if (!activeDirect) return null;

  return (
    <>
    <DirectVoiceDebugPanel />
    <Box
      sx={{
        alignSelf: 'stretch',
        width: 112,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.75,
        py: 1.25,
        px: 0.5,
        bgcolor: BG_RAIL,
        borderLeft: `1px solid ${theme.palette.divider}`,
        color: '#dbdee1',
        minHeight: 0,
        zIndex: 2,
      }}
    >
      <Typography
        variant="caption"
        component="div"
        sx={{
          fontWeight: 700,
          fontSize: 10,
          lineHeight: 1.2,
          textAlign: 'center',
          px: 0.25,
          width: '100%',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          wordBreak: 'break-word',
          hyphens: 'auto',
          color: TEXT_MUTED,
        }}
      >
        DM · {title}
      </Typography>

      {callState === 'connected' && (
        <Typography
          variant="caption"
          sx={{ fontSize: 11, fontWeight: 600, color: '#dbdee1' }}
        >
          {durationLabel}
        </Typography>
      )}

      <Tooltip title={transport.tooltip} placement="left">
        <Chip
          label={transport.label}
          size="small"
          sx={{
            height: 18,
            maxWidth: '100%',
            fontSize: 9,
            fontWeight: 600,
            bgcolor:
              transport.mode === 'connecting'
                ? alpha('#94a3b8', 0.35)
                : transport.mode === 'reticulum'
                  ? alpha(theme.palette.primary.main, 0.4)
                  : alpha('#94a3b8', 0.35),
            color: '#dbdee1',
            '& .MuiChip-label': { px: 0.5, overflow: 'hidden' },
          }}
        />
      </Tooltip>

      <Box
        sx={{
          flex: 1,
          minHeight: 32,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          py: 0.5,
        }}
      >
        <Box sx={{ position: 'relative', flexShrink: 0 }}>
          <Avatar
            alt={title}
            src={avatarSrc}
            sx={{
              width: 36,
              height: 36,
              bgcolor: addrHue(peerAddress || myAddress),
              fontSize: 12,
              fontWeight: 700,
              color: '#fff',
            }}
          >
            {!avatarSrc ? initials : null}
          </Avatar>
        </Box>
      </Box>

      {callState === 'connected' && (
        <Box
          sx={{
            '& .MuiIconButton-root': { color: '#b5bac1' },
          }}
        >
          <CallAudioSettingsButton
            IconComponent={SettingsRoundedIcon}
            tooltipPlacement="left"
          />
        </Box>
      )}

      <Tooltip
        title={
          isMuted
            ? t('core:group_call_unmute', {
                postProcess: 'capitalizeFirstChar',
              })
            : t('core:group_call_mute', { postProcess: 'capitalizeFirstChar' })
        }
      >
        <span>
          <IconButton
            disabled={callState !== 'connected'}
            onClick={toggleMute}
            sx={{
              width: 44,
              height: 44,
              bgcolor: isMuted ? DANGER : '#313338',
              color: '#fff',
              '&:hover': {
                bgcolor: isMuted ? alpha(DANGER, 0.85) : '#4e5058',
              },
            }}
          >
            {isMuted ? (
              <MicOffRoundedIcon sx={{ fontSize: 22 }} />
            ) : (
              <MicRoundedIcon sx={{ fontSize: 22 }} />
            )}
          </IconButton>
        </span>
      </Tooltip>

      <Tooltip
        title={
          hearCall
            ? t('core:call_audio_mute', {
                postProcess: 'capitalizeFirstChar',
              })
            : t('core:call_audio_hear', {
                postProcess: 'capitalizeFirstChar',
              })
        }
        placement="left"
      >
        <span>
          <IconButton
            disabled={callState !== 'connected'}
            onClick={toggleHearCall}
            sx={{
              width: 44,
              height: 44,
              bgcolor: hearCall ? '#313338' : DANGER,
              color: '#fff',
              '&:hover': {
                bgcolor: hearCall ? '#4e5058' : alpha(DANGER, 0.85),
              },
            }}
          >
            {hearCall ? (
              <VolumeUpRoundedIcon sx={{ fontSize: 22 }} />
            ) : (
              <VolumeOffRoundedIcon sx={{ fontSize: 22 }} />
            )}
          </IconButton>
        </span>
      </Tooltip>

      <Tooltip title="Hang up" placement="left">
        <IconButton
          onClick={hangUp}
          sx={{
            width: 44,
            height: 44,
            bgcolor: DANGER,
            color: '#fff',
            '&:hover': { bgcolor: alpha(DANGER, 0.85) },
          }}
        >
          <CallEndRoundedIcon sx={{ fontSize: 22 }} />
      </IconButton>
    </Tooltip>
    </Box>
    </>
  );
}
