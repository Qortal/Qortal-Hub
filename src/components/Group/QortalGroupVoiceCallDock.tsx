/**
 * Minimized Qortal group voice call: slim rail to the right of the groups / DMs sidebar.
 * Paired with `QortalGroupVoiceCallStage` and `qortalGroupVoiceCallMinimizedAtom`.
 */

import React, { useCallback, useEffect, useMemo, useReducer } from 'react';
import { useAtom, useAtomValue } from 'jotai';
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
import OpenInFullRoundedIcon from '@mui/icons-material/OpenInFullRounded';
import { useTranslation } from 'react-i18next';
import {
  qortalGroupVoiceCallMinimizedAtom,
  userInfoAtom,
} from '../../atoms/global';
import { useGroupCallContext } from '../../contexts/GroupCallContext';
import { getGroupCallTransportSummary } from '../../lib/group-call/router';
import {
  addrHue,
  initialsFromDisplayLabel,
  qortalAvatarThumbnailSrc,
  registeredNameForAvatar,
  shortAddr,
} from './qortalGroupCallParticipantUi';

const BG_RAIL = '#2b2d31';
const TEXT_MUTED = '#949ba4';
const DANGER = '#f23f42';
const VOICE_CONNECTED = '#3d9142';
const SPEAKING = '#23a559';

export function QortalGroupVoiceCallDock() {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const userInfo = useAtomValue(userInfoAtom);
  const [minimized, setMinimized] = useAtom(qortalGroupVoiceCallMinimizedAtom);
  const {
    roomState,
    roomId,
    participants,
    activeSpeakers,
    metrics,
    leaveGroupCall,
    setMuted,
    muted,
    memberGateGroupName,
    memberPrimaryNames,
  } = useGroupCallContext();

  const isQortal =
    typeof roomId === 'string' && roomId.startsWith('gcall-qortal-');
  const active =
    isQortal && (roomState === 'connected' || roomState === 'joining');

  const [transportTick, bumpTransport] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!active || !minimized) return;
    const id = window.setInterval(bumpTransport, 700);
    return () => window.clearInterval(id);
  }, [active, minimized]);
  const transport = useMemo(
    () => getGroupCallTransportSummary(metrics, Date.now()),
    [metrics, transportTick]
  );

  const title =
    memberGateGroupName?.trim() ||
    t('core:group_call_stage_title', {
      postProcess: 'capitalizeFirstChar',
    });

  const handleLeave = useCallback(() => {
    void leaveGroupCall();
  }, [leaveGroupCall]);

  const toggleMute = useCallback(() => {
    setMuted(!muted);
  }, [muted, setMuted]);

  const participantDisplayLabel = useCallback(
    (address: string, isSelf: boolean) => {
      const fromList = memberPrimaryNames[address]?.trim();
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
    [memberPrimaryNames, userInfo?.name, t]
  );

  const sortedTiles = useMemo(() => {
    const my = userInfo?.address ?? '';
    const list = [...participants];
    list.sort((a, b) => {
      if (a.address === my) return -1;
      if (b.address === my) return 1;
      return a.address.localeCompare(b.address);
    });
    return list;
  }, [participants, userInfo?.address]);

  if (!minimized || !active) return null;

  return (
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
      <Tooltip
        title={t('core:group_call_expand', {
          postProcess: 'capitalizeFirstChar',
        })}
        placement="left"
      >
        <IconButton
          size="small"
          onClick={() => setMinimized(false)}
          sx={{ color: '#b5bac1' }}
        >
          <OpenInFullRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>

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
        {title}
      </Typography>

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
              transport.mode === 'relay'
                ? alpha('#f59e0b', 0.35)
                : transport.mode === 'connecting'
                  ? alpha('#94a3b8', 0.35)
                  : alpha('#22c55e', 0.35),
            color: '#dbdee1',
            '& .MuiChip-label': { px: 0.5, overflow: 'hidden' },
          }}
        />
      </Tooltip>

      <Box
        sx={{
          flex: 1,
          minHeight: 48,
          width: '100%',
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
          py: 0.25,
        }}
      >
        {sortedTiles.map((p) => {
          const self = p.address === userInfo?.address;
          const speaking =
            activeSpeakers.includes(p.address) || p.speaking;
          const displayName = participantDisplayLabel(p.address, self);
          const regName = registeredNameForAvatar(
            p.address,
            self,
            memberPrimaryNames,
            userInfo?.name
          );
          const rowAvatarSrc = qortalAvatarThumbnailSrc(regName);
          const hasFriendlyDisplayName =
            Boolean(memberPrimaryNames[p.address]?.trim()) ||
            (self && Boolean(userInfo?.name?.trim()));
          const rowInitials = hasFriendlyDisplayName
            ? initialsFromDisplayLabel(displayName, p.address)
            : p.address.slice(0, 2).toUpperCase();
          const voiceDotColor =
            self && muted
              ? DANGER
              : speaking
                ? SPEAKING
                : VOICE_CONNECTED;
          return (
            <Box
              key={p.address}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                width: '100%',
                minWidth: 0,
              }}
            >
              <Box sx={{ position: 'relative', flexShrink: 0 }}>
                <Avatar
                  alt={displayName}
                  src={rowAvatarSrc}
                  sx={{
                    width: 28,
                    height: 28,
                    bgcolor: addrHue(p.address),
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#fff',
                  }}
                >
                  {rowInitials}
                </Avatar>
                <Box
                  sx={{
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    border: `2px solid ${BG_RAIL}`,
                    bgcolor: voiceDotColor,
                  }}
                />
              </Box>
              <Typography
                variant="caption"
                sx={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 10,
                  fontWeight: 500,
                  lineHeight: 1.2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: '#dbdee1',
                }}
              >
                {displayName}
              </Typography>
            </Box>
          );
        })}
      </Box>

      <Tooltip
        title={
          muted
            ? t('core:group_call_unmute', {
                postProcess: 'capitalizeFirstChar',
              })
            : t('core:group_call_mute', { postProcess: 'capitalizeFirstChar' })
        }
      >
        <span>
          <IconButton
            onClick={toggleMute}
            sx={{
              width: 44,
              height: 44,
              bgcolor: muted ? DANGER : '#313338',
              color: '#fff',
              '&:hover': {
                bgcolor: muted ? alpha(DANGER, 0.85) : '#4e5058',
              },
            }}
          >
            {muted ? (
              <MicOffRoundedIcon sx={{ fontSize: 22 }} />
            ) : (
              <MicRoundedIcon sx={{ fontSize: 22 }} />
            )}
          </IconButton>
        </span>
      </Tooltip>

      <Tooltip
        title={t('core:group_call_leave', {
          postProcess: 'capitalizeFirstChar',
        })}
      >
        <IconButton
          onClick={handleLeave}
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
  );
}
