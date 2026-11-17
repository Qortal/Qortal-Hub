import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Avatar,
  Box,
  ButtonBase,
  Chip,
  IconButton,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CallEndRoundedIcon from '@mui/icons-material/CallEndRounded';
import MicRoundedIcon from '@mui/icons-material/MicRounded';
import MicOffRoundedIcon from '@mui/icons-material/MicOffRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import VolumeOffRoundedIcon from '@mui/icons-material/VolumeOffRounded';
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded';
import ScreenShareRoundedIcon from '@mui/icons-material/ScreenShareRounded';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  dmFriendsByAddressAtom,
  infoSnackGlobalAtom,
  openSnackGlobalAtom,
  p2pHealthAtom,
  userInfoAtom,
} from '../../atoms/global';
import { onlineAddressesAtom } from '../../atoms/presence';
import { useVoiceCallContext } from '../../context/VoiceCallContext';
import {
  buildDirectVoiceCallChatId,
  isDirectVoiceCallChatId,
  peerAddressFromDirectVoiceChatId,
} from '../../lib/call/directVoiceCallChatId';
import { useCallSwitchGuard } from '../../contexts/CallSwitchGuardContext';
import {
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { DIRECT_VOICE_CALL_NAV_SLOT_ID } from '../Desktop/GlobalQortalNavBar';
import { useLivePortalTarget } from '../../hooks/useLivePortalTarget';
import { CallAudioSettingsButton } from '../Chat/CallAudioDeviceSelectors';
import { DirectVoiceDebugPanel } from './DirectVoiceDebugPanel';
import { getPrimaryNameForAvatar } from './groupApi';
import {
  addrHue,
  initialsFromDisplayLabel,
  qortalAvatarThumbnailSrc,
  shortAddr,
} from './qortalGroupCallParticipantUi';

const DANGER = '#f23f42';
const VOICE_CONNECTED = '#3d9142';

export function DirectVoiceCallNavWidget() {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const userInfo = useAtomValue(userInfoAtom);
  const myAddress = userInfo?.address ?? '';
  const dmFriendsByAddress = useAtomValue(dmFriendsByAddressAtom);
  const onlineAddresses = useAtomValue(onlineAddressesAtom);
  const p2pHealth = useAtomValue(p2pHealthAtom);
  const setInfoSnack = useSetAtom(infoSnackGlobalAtom);
  const setOpenSnack = useSetAtom(openSnackGlobalAtom);
  const { confirmCallSwitch } = useCallSwitchGuard();
  const {
    activeCallChatId,
    audioMode,
    startupStatus,
    callMediaReady,
    callDuration,
    callState,
    initiateCall,
    hangUp,
    hearCall,
    isMuted,
    toggleHearCall,
    toggleMute,
    screenShareState,
    screenShareSupported,
    openScreenSharePicker,
    setScreenShareViewerOpen,
  } = useVoiceCallContext();
  const portalTarget = useLivePortalTarget(DIRECT_VOICE_CALL_NAV_SLOT_ID);

  const showCallError = useCallback(
    (message: string) => {
      setInfoSnack({ message, type: 'error' });
      setOpenSnack(true);
    },
    [setInfoSnack, setOpenSnack]
  );

  useEffect(() => {
    const startDirectCall = async (event: Event) => {
      const detail = (event as CustomEvent<{ address?: string; name?: string }>)
        .detail;
      const targetAddress = detail?.address?.trim() ?? '';
      const targetDisplayName = detail?.name?.trim() || '';
      const targetLabel = targetDisplayName || 'This user';
      if (!targetAddress || !myAddress || targetAddress === myAddress) return;

      if (!dmFriendsByAddress[targetAddress]) {
        showCallError(`Add ${targetLabel} as a friend before calling.`);
        return;
      }
      if (!onlineAddresses.has(targetAddress)) {
        showCallError(`${targetLabel} is offline and cannot receive a call.`);
        return;
      }
      if (p2pHealth !== 'good') {
        showCallError('Voice calls are unavailable until P2P connectivity recovers.');
        return;
      }

      const chatId = buildDirectVoiceCallChatId(myAddress, targetAddress);
      if (
        activeCallChatId === chatId &&
        (callState === 'calling' || callState === 'connected')
      ) {
        return;
      }
      const confirmed = await confirmCallSwitch({ type: 'direct', chatId });
      if (!confirmed) return;

      await initiateCall(
        targetAddress,
        chatId,
        async (fields) => {
          const result = await (window as any).sendMessage(
            'signPresenceMessage',
            fields,
            10_000
          );
          return {
            signature: result?.signature ?? '',
            publicKey: userInfo?.publicKey ?? '',
          };
        },
        targetDisplayName || undefined
      );
    };

    subscribeToEvent('startReticulumDirectVoiceCall', startDirectCall);
    return () => {
      unsubscribeFromEvent('startReticulumDirectVoiceCall', startDirectCall);
    };
  }, [
    activeCallChatId,
    callState,
    confirmCallSwitch,
    dmFriendsByAddress,
    initiateCall,
    myAddress,
    onlineAddresses,
    p2pHealth,
    showCallError,
    userInfo?.publicKey,
  ]);

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

  const title = peerPrimaryName || (peerAddress ? shortAddr(peerAddress) : '');
  const avatarSrc = qortalAvatarThumbnailSrc(peerPrimaryName || undefined);
  const initials = initialsFromDisplayLabel(title, peerAddress || myAddress);

  const durationLabel = useMemo(() => {
    const minutes = Math.floor(callDuration / 60)
      .toString()
      .padStart(2, '0');
    const seconds = (callDuration % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }, [callDuration]);

  if (!portalTarget || !activeDirect) return null;

  return createPortal(
    <>
      <DirectVoiceDebugPanel />
      <Box
        sx={{
          alignItems: 'center',
          backgroundColor:
            theme.palette.mode === 'dark'
              ? 'rgba(23, 27, 34, 0.98)'
              : 'rgba(236, 240, 246, 0.98)',
          border: `1px solid ${theme.palette.border.subtle}`,
          borderRadius: '12px',
          boxShadow:
            theme.palette.mode === 'dark'
              ? '0 8px 18px rgba(0, 0, 0, 0.18)'
              : '0 6px 16px rgba(15, 23, 42, 0.1)',
          color: theme.palette.text.primary,
          display: 'flex',
          gap: 0.75,
          height: 36,
          maxWidth: { xs: 218, sm: 320, md: 452 },
          minWidth: 0,
          px: 0.75,
        }}
      >
        <ButtonBase
          disableRipple
          sx={{
            alignItems: 'center',
            borderRadius: '9px',
            display: 'flex',
            gap: 0.75,
            height: 28,
            minWidth: 0,
            px: 0.5,
            '&:hover': {
              backgroundColor: theme.palette.action.hover,
            },
            '&:focus-visible': {
              outline: `1px solid ${theme.palette.primary.main}`,
              outlineOffset: '2px',
            },
          }}
        >
          <Chip
            label="DM CALL"
            size="small"
            sx={{
              bgcolor: alpha(theme.palette.primary.main, 0.16),
              color: theme.palette.text.primary,
              flexShrink: 0,
              fontSize: 10,
              fontWeight: 800,
              height: 20,
              letterSpacing: 0,
              '& .MuiChip-label': { px: 0.75 },
            }}
          />
          <Avatar
            alt={title}
            src={avatarSrc || undefined}
            sx={{
              bgcolor: addrHue(peerAddress || myAddress),
              color: '#fff',
              display: { xs: 'none', md: 'flex' },
              flexShrink: 0,
              fontSize: 9,
              fontWeight: 800,
              height: 24,
              width: 24,
            }}
          >
            {!avatarSrc ? initials : null}
          </Avatar>
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              display: { xs: 'none', sm: 'block' },
              fontSize: 12,
              fontWeight: 700,
              lineHeight: '16px',
              maxWidth: { sm: 82, md: 128 },
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </Typography>
        </ButtonBase>

        {callState === 'connected' ? (
          <Typography
            sx={{
              color: callMediaReady
                ? theme.palette.text.secondary
                : theme.palette.primary.main,
              display: { xs: 'none', md: 'block' },
              flexShrink: 0,
              fontSize: 11,
              fontWeight: 800,
            }}
          >
            {callMediaReady
              ? durationLabel
              : startupStatus.headline || 'Connecting...'}
          </Typography>
        ) : null}

        <Box
          sx={{
            backgroundColor: theme.palette.border.subtle,
            flexShrink: 0,
            height: 18,
            width: '1px',
          }}
        />

        {callState === 'connected' && callMediaReady ? (
          <Box
            sx={{
              '& .MuiIconButton-root': {
                color: theme.palette.text.secondary,
                flexShrink: 0,
                height: 28,
                width: 28,
              },
            }}
          >
            <CallAudioSettingsButton
              IconComponent={SettingsRoundedIcon}
              tooltipPlacement="bottom"
            />
          </Box>
        ) : null}

        <Tooltip
          title={
            audioMode !== 'webrtc'
              ? 'Screen sharing requires a direct WebRTC call'
              : !screenShareSupported
                ? 'The other person does not support screen sharing'
                : screenShareState === 'viewing'
                  ? 'View shared screen'
                  : screenShareState === 'sharing'
                    ? 'View your screen share'
                    : 'Share your screen'
          }
          arrow
        >
          <span>
            <IconButton
              disabled={
                callState !== 'connected' ||
                !callMediaReady ||
                audioMode !== 'webrtc' ||
                !screenShareSupported
              }
              size="small"
              onClick={() => {
                if (
                  screenShareState === 'sharing' ||
                  screenShareState === 'viewing' ||
                  screenShareState === 'starting'
                ) {
                  setScreenShareViewerOpen(true);
                } else {
                  void openScreenSharePicker();
                }
              }}
              sx={{
                color:
                  screenShareState === 'sharing' ||
                  screenShareState === 'viewing'
                    ? theme.palette.primary.main
                    : theme.palette.text.secondary,
                flexShrink: 0,
                height: 28,
                width: 28,
              }}
            >
              <ScreenShareRoundedIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip
          title={
            isMuted
              ? t('core:group_call_unmute', {
                  postProcess: 'capitalizeFirstChar',
                })
              : t('core:group_call_mute', {
                  postProcess: 'capitalizeFirstChar',
                })
          }
          arrow
        >
          <span>
            <IconButton
              disabled={callState !== 'connected' || !callMediaReady}
              size="small"
              onClick={toggleMute}
              sx={{
                color: isMuted ? DANGER : VOICE_CONNECTED,
                flexShrink: 0,
                height: 28,
                width: 28,
              }}
            >
              {isMuted ? (
                <MicOffRoundedIcon sx={{ fontSize: 17 }} />
              ) : (
                <MicRoundedIcon sx={{ fontSize: 17 }} />
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
          arrow
        >
          <span>
            <IconButton
              disabled={callState !== 'connected' || !callMediaReady}
              size="small"
              onClick={toggleHearCall}
              sx={{
                color: hearCall ? theme.palette.text.secondary : DANGER,
                flexShrink: 0,
                height: 28,
                width: 28,
              }}
            >
              {hearCall ? (
                <VolumeUpRoundedIcon sx={{ fontSize: 17 }} />
              ) : (
                <VolumeOffRoundedIcon sx={{ fontSize: 17 }} />
              )}
            </IconButton>
          </span>
        </Tooltip>

        <Tooltip title="Hang up" arrow>
          <IconButton
            size="small"
            onClick={hangUp}
            sx={{
              color: DANGER,
              flexShrink: 0,
              height: 28,
              width: 28,
            }}
          >
            <CallEndRoundedIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </>,
    portalTarget
  );
}
