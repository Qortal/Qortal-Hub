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
import OpenInFullRoundedIcon from '@mui/icons-material/OpenInFullRounded';
import VolumeOffRoundedIcon from '@mui/icons-material/VolumeOffRounded';
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  qortalGroupVoiceCallMinimizedAtom,
  qortalGroupCallPrimaryNamesAtom,
  userInfoAtom,
} from '../../atoms/global';
import { useGroupCallContext } from '../../contexts/GroupCallContext';
import { QORTAL_GROUP_CALL_NAV_SLOT_ID } from '../Desktop/GlobalQortalNavBar';
import {
  addrHue,
  initialsFromDisplayLabel,
  qortalAvatarThumbnailSrc,
  registeredNameForAvatar,
  shortAddr,
} from './qortalGroupCallParticipantUi';

const DANGER = '#f23f42';
const SPEAKING = '#23a559';
const VOICE_CONNECTED = '#3d9142';

export function QortalGroupVoiceCallNavWidget() {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const userInfo = useAtomValue(userInfoAtom);
  const qcallPrimaryNames = useAtomValue(qortalGroupCallPrimaryNamesAtom);
  const [minimized, setMinimized] = useAtom(qortalGroupVoiceCallMinimizedAtom);
  const {
    roomState,
    roomId,
    participants,
    activeSpeakers,
    leaveGroupCall,
    setMuted,
    muted,
    hearCall,
    toggleHearCall,
    memberGateGroupName,
    memberPrimaryNames,
  } = useGroupCallContext();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.getElementById(QORTAL_GROUP_CALL_NAV_SLOT_ID));
  }, []);

  const isQortal =
    typeof roomId === 'string' && roomId.startsWith('gcall-qortal-');
  const active =
    minimized &&
    isQortal &&
    (roomState === 'connected' || roomState === 'joining');

  const title =
    memberGateGroupName?.trim() ||
    t('core:group_call_stage_title', {
      postProcess: 'capitalizeFirstChar',
    });

  const sortedParticipants = useMemo(() => {
    const my = userInfo?.address ?? '';
    const list = [...participants];
    list.sort((a, b) => {
      if (a.address === my) return -1;
      if (b.address === my) return 1;
      return a.address.localeCompare(b.address);
    });
    return list;
  }, [participants, userInfo?.address]);
  const displayPrimaryNames = useMemo(
    () => ({
      ...memberPrimaryNames,
      ...qcallPrimaryNames,
    }),
    [memberPrimaryNames, qcallPrimaryNames]
  );

  const participantDisplayLabel = useCallback(
    (address: string, isSelf: boolean) => {
      const fromList = displayPrimaryNames[address]?.trim();
      if (fromList) return fromList;
      if (isSelf) {
        const un = userInfo?.name?.trim?.();
        if (un) return un;
        return t('core:group_call_you', {
          postProcess: 'capitalizeFirstChar',
        });
      }
      return shortAddr(address);
    },
    [displayPrimaryNames, userInfo?.name, t]
  );

  const avatarParticipants = sortedParticipants.slice(0, 3);
  const extraParticipantCount = Math.max(0, sortedParticipants.length - 3);

  const handleLeave = useCallback(() => {
    void leaveGroupCall();
  }, [leaveGroupCall]);

  const toggleMute = useCallback(() => {
    setMuted(!muted);
  }, [muted, setMuted]);

  if (!portalTarget || !active) return null;

  return createPortal(
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
        maxWidth: { xs: 208, sm: 300, md: 360 },
        minWidth: 0,
        px: 0.75,
      }}
    >
      <ButtonBase
        disableRipple
        onClick={() => setMinimized(false)}
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
          label="Q-CALL"
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
        <Typography
          sx={{
            color: theme.palette.text.secondary,
            display: { xs: 'none', sm: 'block' },
            fontSize: 12,
            fontWeight: 700,
            lineHeight: '16px',
            maxWidth: { sm: 86, md: 140 },
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </Typography>
      </ButtonBase>

      <Box
        sx={{
          alignItems: 'center',
          display: { xs: 'none', md: 'flex' },
          flexShrink: 0,
          ml: 0.25,
        }}
      >
        {avatarParticipants.map((participant, index) => {
          const self = participant.address === userInfo?.address;
          const displayName = participantDisplayLabel(
            participant.address,
            self
          );
          const regName = registeredNameForAvatar(
            participant.address,
            self,
            displayPrimaryNames,
            userInfo?.name
          );
          const hasFriendlyDisplayName =
            Boolean(displayPrimaryNames[participant.address]?.trim()) ||
            (self && Boolean(userInfo?.name?.trim()));
          const initials = hasFriendlyDisplayName
            ? initialsFromDisplayLabel(displayName, participant.address)
            : participant.address.slice(0, 2).toUpperCase();
          const speaking =
            activeSpeakers.includes(participant.address) ||
            participant.speaking;
          return (
            <Tooltip key={participant.address} title={displayName} arrow>
              <Avatar
                alt={displayName}
                src={qortalAvatarThumbnailSrc(regName)}
                sx={{
                  bgcolor: addrHue(participant.address),
                  border: `2px solid ${
                    speaking
                      ? SPEAKING
                      : theme.palette.mode === 'dark'
                        ? '#171b22'
                        : '#ecf0f6'
                  }`,
                  color: '#fff',
                  fontSize: 9,
                  fontWeight: 800,
                  height: 24,
                  ml: index === 0 ? 0 : -0.75,
                  width: 24,
                }}
              >
                {initials}
              </Avatar>
            </Tooltip>
          );
        })}
        {extraParticipantCount > 0 ? (
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: 11,
              fontWeight: 800,
              ml: 0.5,
            }}
          >
            +{extraParticipantCount}
          </Typography>
        ) : null}
      </Box>

      <Box
        sx={{
          backgroundColor: theme.palette.border.subtle,
          flexShrink: 0,
          height: 18,
          width: '1px',
        }}
      />

      <Tooltip
        title={
          muted
            ? t('core:group_call_unmute', {
                postProcess: 'capitalizeFirstChar',
              })
            : t('core:group_call_mute', { postProcess: 'capitalizeFirstChar' })
        }
        arrow
      >
        <IconButton
          size="small"
          onClick={toggleMute}
          sx={{
            color: muted ? DANGER : VOICE_CONNECTED,
            flexShrink: 0,
            height: 28,
            width: 28,
          }}
        >
          {muted ? (
            <MicOffRoundedIcon sx={{ fontSize: 17 }} />
          ) : (
            <MicRoundedIcon sx={{ fontSize: 17 }} />
          )}
        </IconButton>
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
        <IconButton
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
      </Tooltip>

      <Tooltip
        title={t('core:group_call_expand', {
          postProcess: 'capitalizeFirstChar',
        })}
        arrow
      >
        <IconButton
          size="small"
          onClick={() => setMinimized(false)}
          sx={{
            color: theme.palette.text.secondary,
            flexShrink: 0,
            height: 28,
            width: 28,
          }}
        >
          <OpenInFullRoundedIcon sx={{ fontSize: 17 }} />
        </IconButton>
      </Tooltip>

      <Tooltip
        title={t('core:group_call_leave', {
          postProcess: 'capitalizeFirstChar',
        })}
        arrow
      >
        <IconButton
          size="small"
          onClick={handleLeave}
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
    </Box>,
    portalTarget
  );
}
