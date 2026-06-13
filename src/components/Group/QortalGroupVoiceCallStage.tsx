/**
 * Full-screen voice stage for Qortal member-gated group calls (`gcall-qortal-*`).
 * Discord-inspired layout; wired to GroupCallContext (no video / screen share in v1).
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Avatar,
  Box,
  Button,
  Chip,
  IconButton,
  Typography,
  CircularProgress,
  Tooltip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import Groups2RoundedIcon from '@mui/icons-material/Groups2Rounded';
import MicRoundedIcon from '@mui/icons-material/MicRounded';
import MicOffRoundedIcon from '@mui/icons-material/MicOffRounded';
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded';
import VolumeOffRoundedIcon from '@mui/icons-material/VolumeOffRounded';
import CallEndRoundedIcon from '@mui/icons-material/CallEndRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SettingsIcon from '@mui/icons-material/Settings';
import { useTranslation } from 'react-i18next';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import PictureInPictureAltRoundedIcon from '@mui/icons-material/PictureInPictureAltRounded';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import {
  userInfoAtom,
  qortalGroupVoiceCallMinimizedAtom,
  qortalGroupCallPrimaryNamesAtom,
} from '../../atoms/global';
import { useGroupCallContext } from '../../contexts/GroupCallContext';
import {
  addrHue,
  initialsFromDisplayLabel,
  qortalAvatarThumbnailSrc,
  registeredNameForAvatar,
  shortAddr,
} from './qortalGroupCallParticipantUi';
import { CallAudioSettingsButton } from '../Chat/CallAudioDeviceSelectors';
import { GroupCallStartupBanner } from '../Chat/GroupCallStartupBanner';

const BG_MAIN = '#0d1016';
const BG_HEADER = '#1b2028';
const BG_TILE = '#151922';
const BORDER_SUB = '#2a313d';
const TEXT_MUTED = '#9aa4b2';
const TEXT_MAIN = '#e5e9f0';
const SURFACE_SOFT = '#202632';
/** In call, mic idle (not VAD-speaking). Distinct from TEXT_MUTED so dots don’t read as “offline”. */
const VOICE_CONNECTED = '#3d9142';
const SPEAKING = '#23a559';
const DANGER = '#f23f42';
const QCALL_STAGE_Z_INDEX = 1590;
const QCALL_TOOLTIP_Z_INDEX = QCALL_STAGE_Z_INDEX + 20;
const MAX_QORTAL_GROUP_CALL_PARTICIPANTS = 7;

type SidebarMode = 'none' | 'participants';

type GroupCallLinkStats = {
  establishedLinks: number;
  participants: number;
};

export function QortalGroupVoiceCallStage() {
  const { t } = useTranslation(['core']);
  const userInfo = useAtomValue(userInfoAtom);
  const qcallPrimaryNames = useAtomValue(qortalGroupCallPrimaryNamesAtom);
  const setQcallPrimaryNames = useSetAtom(qortalGroupCallPrimaryNamesAtom);
  const {
    roomState,
    mediaViable,
    roomId,
    participants,
    activeSpeakers,
    metrics,
    localConnectionHint,
    startupStatus,
    leaveGroupCall,
    setMuted,
    muted,
    hearCall,
    toggleHearCall,
    memberPrimaryNames,
    memberGateGroupName,
    exportGroupCallDiagnostics,
  } = useGroupCallContext();

  const [diagExporting, setDiagExporting] = useState(false);
  const [linkStats, setLinkStats] = useState<GroupCallLinkStats | null>(null);

  const handleDiagDownload = useCallback(async () => {
    setDiagExporting(true);
    try {
      await exportGroupCallDiagnostics?.({ download: true, clipboard: false });
    } catch (e) {
      console.error('[GCall] diagnostics export failed', e);
    } finally {
      setDiagExporting(false);
    }
  }, [exportGroupCallDiagnostics]);

  const [qcallMinimized, setQcallMinimized] = useAtom(
    qortalGroupVoiceCallMinimizedAtom
  );

  const [sidebar, setSidebar] = useState<SidebarMode>('none');

  const isQortalGroupRoom =
    typeof roomId === 'string' && roomId.startsWith('gcall-qortal-');
  const visible =
    isQortalGroupRoom && (roomState === 'connected' || roomState === 'joining');

  useEffect(() => {
    if (!visible) {
      setQcallMinimized(false);
      setQcallPrimaryNames({});
    }
  }, [visible, setQcallMinimized, setQcallPrimaryNames]);

  const [transportTick, bumpTransport] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(bumpTransport, 700);
    return () => window.clearInterval(id);
  }, [visible]);
  const transport = useMemo(() => {
    if (roomState === 'connected' && !mediaViable) {
      return {
        mode: 'connecting' as const,
        label: 'Reticulum',
        tooltip:
          'Reticulum audio is still establishing; you may not hear others yet.',
      };
    }
    void metrics;
    void transportTick;
    return {
      mode: 'reticulum' as const,
      label: 'Reticulum',
      tooltip: 'Encrypted voice over Reticulum',
    };
  }, [roomState, mediaViable, metrics, transportTick, t]);

  useEffect(() => {
    if (
      !visible ||
      !roomId ||
      typeof window.groupCall?.getLinkStats !== 'function'
    ) {
      setLinkStats(null);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await window.groupCall?.getLinkStats?.(roomId);
        if (cancelled) return;
        if (response?.success && response.stats) {
          const localAddress = userInfo?.address ?? '';
          const remoteParticipantCount = participants.filter(
            (participant) => participant.address !== localAddress
          ).length;
          setLinkStats({
            establishedLinks: Math.max(0, response.stats.establishedLinks),
            participants: Math.max(
              0,
              remoteParticipantCount ||
                Math.max(0, response.stats.participants - 1)
            ),
          });
        }
      } catch {
        if (!cancelled) setLinkStats(null);
      }
    };
    void refresh();
    const id = window.setInterval(refresh, 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [visible, roomId, participants, userInfo?.address]);

  useEffect(() => {
    if (!visible) setSidebar('none');
  }, [visible]);

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
  const displayPrimaryNames = useMemo(
    () => ({
      ...memberPrimaryNames,
      ...qcallPrimaryNames,
    }),
    [memberPrimaryNames, qcallPrimaryNames]
  );

  const toggleParticipantsSidebar = useCallback(() => {
    setSidebar((prev) => (prev === 'participants' ? 'none' : 'participants'));
  }, []);

  const callOccupancy = Math.min(
    sortedTiles.length,
    MAX_QORTAL_GROUP_CALL_PARTICIPANTS
  );

  const handleLeave = useCallback(() => {
    void leaveGroupCall();
  }, [leaveGroupCall]);

  const toggleMute = useCallback(() => {
    setMuted(!muted);
  }, [muted, setMuted]);

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

  if (!visible) return null;

  if (qcallMinimized) return null;

  const stageTitle =
    memberGateGroupName?.trim() ||
    t('core:group_call_stage_title', {
      postProcess: 'capitalizeFirstChar',
    });

  const gridCols =
    sortedTiles.length <= 1
      ? '1fr'
      : sortedTiles.length <= 4
        ? 'repeat(2, 1fr)'
        : 'repeat(2, 1fr)';

  const hintText =
    startupStatus.headline && startupStatus.stage !== 'connected'
      ? startupStatus.headline
      : (localConnectionHint?.message?.trim?.() ?? '');
  const topBarTooltipSlotProps = {
    popper: {
      sx: {
        zIndex: QCALL_TOOLTIP_Z_INDEX,
      },
    },
    tooltip: {
      sx: {
        bgcolor: '#f8fafc',
        border: `1px solid ${alpha('#0f172a', 0.12)}`,
        boxShadow: '0 10px 30px rgba(0,0,0,0.32)',
        color: '#111827',
        fontSize: 12,
        fontWeight: 700,
      },
    },
    arrow: {
      sx: {
        color: '#f8fafc',
      },
    },
  } as const;

  const node = (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: QCALL_STAGE_Z_INDEX,
        display: 'flex',
        flexDirection: 'column',
        background:
          'radial-gradient(circle at 50% 18%, rgba(43, 54, 70, 0.62) 0%, rgba(19, 23, 31, 0.95) 42%, #0b0d12 100%)',
        color: TEXT_MAIN,
        fontFamily: 'Inter, system-ui, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* Top bar */}
      <Box
        sx={{
          height: 52,
          flexShrink: 0,
          display: 'flex',
          flexWrap: 'nowrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          px: 2.5,
          bgcolor: alpha(BG_HEADER, 0.96),
          borderBottom: `1px solid ${BORDER_SUB}`,
          boxShadow: '0 1px 0 rgba(255,255,255,0.025)',
          minWidth: 0,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'nowrap',
            alignItems: 'center',
            gap: 1.5,
            minWidth: 0,
            flex: '1 1 auto',
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'row',
              flexWrap: 'nowrap',
              alignItems: 'center',
              gap: 1,
              flexShrink: 0,
              color: TEXT_MUTED,
              fontWeight: 600,
              fontSize: 14,
              whiteSpace: 'nowrap',
            }}
          >
            <Box
              sx={{
                bgcolor: alpha('#6aa8ff', 0.13),
                border: `1px solid ${alpha('#6aa8ff', 0.18)}`,
                borderRadius: '8px',
                height: 30,
                width: 30,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Groups2RoundedIcon sx={{ color: '#9cc7ff', fontSize: 18 }} />
            </Box>
            <Typography
              component="span"
              variant="body2"
              sx={{
                fontWeight: 600,
                fontSize: 14,
                color: TEXT_MAIN,
                whiteSpace: 'nowrap',
                lineHeight: 1.2,
              }}
            >
              {stageTitle}
            </Typography>
          </Box>
          <Box
            sx={{
              width: '1px',
              height: 20,
              bgcolor: alpha('#ffffff', 0.08),
              flexShrink: 0,
            }}
          />
          <Tooltip title={transport.tooltip} placement="bottom">
            <Chip
              label={transport.label}
              size="small"
              sx={{
                height: 20,
                fontSize: 10,
                fontWeight: 600,
                flexShrink: 0,
                maxWidth: 128,
                ml: 0.5,
                bgcolor:
                  transport.mode === 'connecting'
                    ? alpha('#94a3b8', 0.16)
                    : alpha('#22c55e', 0.18),
                color:
                  transport.mode === 'connecting' ? '#cbd5e1' : '#9ee6b4',
                border: `1px solid ${
                  transport.mode === 'connecting'
                    ? alpha('#94a3b8', 0.2)
                    : alpha('#22c55e', 0.28)
                }`,
                '& .MuiChip-label': { px: 0.75 },
              }}
            />
          </Tooltip>
          <Tooltip
            title={t('core:group_call_participants', {
              postProcess: 'capitalizeFirstChar',
            })}
            placement="bottom"
          >
            <Chip
              icon={
                <Groups2RoundedIcon sx={{ fontSize: '14px !important' }} />
              }
              label={`${callOccupancy}/${MAX_QORTAL_GROUP_CALL_PARTICIPANTS}`}
              size="small"
              sx={{
                height: 20,
                fontSize: 10,
                fontWeight: 700,
                flexShrink: 0,
                bgcolor: alpha('#60a5fa', 0.22),
                color: '#dbeafe',
                border: `1px solid ${alpha('#60a5fa', 0.35)}`,
                '& .MuiChip-icon': {
                  color: '#93c5fd',
                  ml: 0.6,
                  mr: -0.25,
                },
                '& .MuiChip-label': { px: 0.75 },
              }}
            />
          </Tooltip>
          {hintText ? (
            <Typography
              variant="caption"
              sx={{
                color: TEXT_MUTED,
                ml: 0.5,
                flex: '1 1 auto',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {hintText}
            </Typography>
          ) : null}
        </Box>

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            flexShrink: 0,
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              display: { xs: 'none', sm: 'inline-flex' },
              gap: 0.75,
              mr: 1.25,
            }}
          >
            <Typography
              component="span"
              sx={{
                color: TEXT_MAIN,
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: '0.08em',
                lineHeight: 1,
              }}
            >
              Q-CALL
            </Typography>
            <Box
              component="span"
              sx={{
                bgcolor: alpha('#60a5fa', 0.16),
                border: `1px solid ${alpha('#60a5fa', 0.28)}`,
                borderRadius: '999px',
                color: '#b8d8ff',
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.055em',
                lineHeight: 1,
                px: 0.75,
                py: 0.35,
                textTransform: 'uppercase',
              }}
            >
              Beta
            </Box>
          </Box>
          <Tooltip
            title={t('core:group_call_minimize', {
              postProcess: 'capitalizeFirstChar',
            })}
            placement="bottom"
            arrow
            slotProps={topBarTooltipSlotProps}
          >
            <IconButton
              size="small"
              onClick={() => setQcallMinimized(true)}
              sx={{
                color: '#c7ced8',
                '&:hover': { bgcolor: alpha('#ffffff', 0.07) },
              }}
            >
              <PictureInPictureAltRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip
            title={t('core:group_call_participants', {
              postProcess: 'capitalizeFirstChar',
            })}
            placement="bottom"
            arrow
            slotProps={topBarTooltipSlotProps}
          >
            <IconButton
              size="small"
              onClick={toggleParticipantsSidebar}
              sx={{
                color: '#c7ced8',
                '&:hover': { bgcolor: alpha('#ffffff', 0.07) },
              }}
            >
              <Groups2RoundedIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Main grid */}
        <Box
          sx={{
            flex: 1,
            p: { xs: 2, md: 4 },
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            minWidth: 0,
          }}
        >
          {roomState === 'joining' && sortedTiles.length <= 1 ? (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                color: TEXT_MUTED,
              }}
            >
              <CircularProgress size={40} sx={{ color: SPEAKING }} />
              <Typography>
                {t('core:group_call_connecting', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </Box>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: gridCols,
                gap: { xs: 1.5, md: 2.5 },
                width: sortedTiles.length <= 1 ? 'min(760px, 100%)' : '100%',
                height: sortedTiles.length <= 1 ? 'auto' : '100%',
                maxWidth: sortedTiles.length <= 1 ? 760 : 1240,
                maxHeight: '100%',
                alignContent: 'center',
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
                  displayPrimaryNames,
                  userInfo?.name
                );
                const avatarSrc = qortalAvatarThumbnailSrc(regName);
                const hasFriendlyDisplayName =
                  Boolean(displayPrimaryNames[p.address]?.trim()) ||
                  (self && Boolean(userInfo?.name?.trim()));
                const avatarInitials = hasFriendlyDisplayName
                  ? initialsFromDisplayLabel(displayName, p.address)
                  : p.address.slice(0, 2).toUpperCase();
                return (
                  <Box
                    key={p.address}
                    sx={{
                      position: 'relative',
                      borderRadius: '8px',
                      background: `linear-gradient(145deg, ${alpha(
                        '#2a3342',
                        0.72
                      )} 0%, ${BG_TILE} 54%, ${alpha('#0d1016', 0.96)} 100%)`,
                      minHeight: sortedTiles.length <= 1 ? 360 : 220,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: `1px solid ${
                        speaking ? alpha(SPEAKING, 0.75) : BORDER_SUB
                      }`,
                      boxShadow: speaking
                        ? `0 0 0 1px ${alpha(SPEAKING, 0.22)}, 0 22px 60px ${alpha(
                            SPEAKING,
                            0.12
                          )}`
                        : `0 18px 44px ${alpha('#000', 0.24)}`,
                      overflow: 'hidden',
                      transition:
                        'border-color 0.25s ease, box-shadow 0.25s ease, transform 0.2s ease',
                    }}
                  >
                    <Avatar
                      alt={displayName}
                      src={avatarSrc}
                      sx={{
                        width:
                          sortedTiles.length <= 1
                            ? { xs: 112, sm: 140 }
                            : { xs: 96, sm: 124 },
                        height:
                          sortedTiles.length <= 1
                            ? { xs: 112, sm: 140 }
                            : { xs: 96, sm: 124 },
                        bgcolor: addrHue(p.address),
                        color: '#fff',
                        fontSize: { xs: 28, sm: 36 },
                        fontWeight: 700,
                        userSelect: 'none',
                        border: `4px solid ${alpha('#ffffff', 0.08)}`,
                        boxShadow: `0 16px 36px ${alpha('#000', 0.28)}`,
                      }}
                    >
                      {avatarInitials}
                    </Avatar>
                    <Box
                      sx={{
                        position: 'absolute',
                        bottom: 12,
                        left: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.75,
                        bgcolor: alpha('#090b10', 0.72),
                        border: `1px solid ${alpha('#ffffff', 0.07)}`,
                        px: 1,
                        py: 0.5,
                        borderRadius: '8px',
                        fontSize: 12,
                        fontWeight: 600,
                        backdropFilter: 'blur(10px)',
                        maxWidth: 'calc(100% - 24px)',
                        overflow: 'hidden',
                      }}
                    >
                      {self && muted && (
                        <MicOffRoundedIcon
                          sx={{ fontSize: 14, color: DANGER, flexShrink: 0 }}
                        />
                      )}
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{
                          fontWeight: 600,
                          fontSize: 12,
                          color: 'inherit',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {displayName}
                      </Typography>
                      {p.role !== 'participant' && (
                        <Typography
                          component="span"
                          variant="caption"
                          sx={{
                            color: TEXT_MUTED,
                            ml: 0.5,
                            flexShrink: 0,
                          }}
                        >
                          ({p.role.replace(/-/g, ' ')})
                        </Typography>
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>

        {/* Sidebar */}
        {sidebar !== 'none' && (
          <Box
            sx={{
              width: 320,
              flexShrink: 0,
              bgcolor: alpha(BG_HEADER, 0.98),
              borderLeft: `1px solid ${BORDER_SUB}`,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            <Box
              sx={{
                height: 48,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: 2,
                borderBottom: `1px solid ${BORDER_SUB}`,
                color: TEXT_MAIN,
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                }}
              >
                <Groups2RoundedIcon sx={{ fontSize: 16 }} />
                {t('core:group_call_participants', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
              <IconButton size="small" onClick={() => setSidebar('none')}>
                <CloseRoundedIcon />
              </IconButton>
            </Box>

            <Box sx={{ flex: 1, overflowY: 'auto', py: 1, px: 0.5 }}>
              {sortedTiles.map((p) => {
                const self = p.address === userInfo?.address;
                const speaking =
                  activeSpeakers.includes(p.address) || p.speaking;
                const displayName = participantDisplayLabel(p.address, self);
                const regName = registeredNameForAvatar(
                  p.address,
                  self,
                  displayPrimaryNames,
                  userInfo?.name
                );
                const rowAvatarSrc = qortalAvatarThumbnailSrc(regName);
                const hasFriendlyDisplayName =
                  Boolean(displayPrimaryNames[p.address]?.trim()) ||
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
                      gap: 1.5,
                      py: 1,
                      px: 1,
                      borderRadius: '8px',
                      '&:hover': { bgcolor: alpha('#fff', 0.045) },
                    }}
                  >
                    <Box sx={{ position: 'relative' }}>
                      <Avatar
                        alt={displayName}
                        src={rowAvatarSrc}
                        sx={{
                          width: 32,
                          height: 32,
                          bgcolor: addrHue(p.address),
                          fontSize: 11,
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
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          border: `2px solid ${BG_HEADER}`,
                          bgcolor: voiceDotColor,
                        }}
                      />
                    </Box>
                    <Typography
                      variant="body2"
                      sx={{
                        flex: 1,
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                      }}
                    >
                      {displayName}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}
      </Box>

      {/* Control bar */}
      <Box
        sx={{
          minHeight: 108,
          flexShrink: 0,
          background: `linear-gradient(180deg, ${alpha(
            BG_MAIN,
            0.42
          )} 0%, ${alpha('#07090d', 0.92)} 100%)`,
          borderTop: `1px solid ${alpha('#ffffff', 0.055)}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: 3,
          position: 'relative',
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            bgcolor: alpha('#171c24', 0.94),
            border: `1px solid ${alpha('#ffffff', 0.08)}`,
            borderRadius: '999px',
            boxShadow: `0 18px 48px ${alpha('#000', 0.36)}`,
            display: 'flex',
            gap: 1,
            px: 1.25,
            py: 1,
          }}
        >
          <IconButton
            onClick={toggleMute}
            sx={{
              width: 52,
              height: 52,
              bgcolor: muted ? DANGER : SURFACE_SOFT,
              color: '#fff',
              '&:hover': {
                bgcolor: muted ? alpha(DANGER, 0.85) : alpha('#ffffff', 0.12),
              },
            }}
          >
            {muted ? (
              <MicOffRoundedIcon sx={{ fontSize: 28 }} />
            ) : (
              <MicRoundedIcon sx={{ fontSize: 28 }} />
            )}
          </IconButton>

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
            slotProps={topBarTooltipSlotProps}
          >
            <IconButton
              onClick={toggleHearCall}
              sx={{
                width: 52,
                height: 52,
                bgcolor: hearCall ? SURFACE_SOFT : DANGER,
                color: '#fff',
                '&:hover': {
                  bgcolor: hearCall ? alpha('#ffffff', 0.12) : alpha(DANGER, 0.85),
                },
              }}
            >
              {hearCall ? (
                <VolumeUpRoundedIcon sx={{ fontSize: 28 }} />
              ) : (
                <VolumeOffRoundedIcon sx={{ fontSize: 28 }} />
              )}
            </IconButton>
          </Tooltip>

          <Box
            sx={{
              width: '1px',
              height: 32,
              bgcolor: alpha('#ffffff', 0.11),
              flexShrink: 0,
              mx: 1,
            }}
          />

          <IconButton
            onClick={handleLeave}
            sx={{
              width: 52,
              height: 52,
              bgcolor: DANGER,
              color: '#fff',
              '&:hover': { bgcolor: alpha(DANGER, 0.85) },
            }}
          >
            <CallEndRoundedIcon sx={{ fontSize: 28 }} />
          </IconButton>
        </Box>

        <Box
          sx={{
            position: 'absolute',
            right: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            bgcolor: alpha('#171c24', 0.88),
            border: `1px solid ${alpha('#ffffff', 0.07)}`,
            borderRadius: '999px',
            p: 0.75,
          }}
        >
          <CallAudioSettingsButton
            iconButtonSize="medium"
            IconComponent={SettingsIcon}
            advancedContent={
              linkStats ? (
                <Box
                  sx={{
                    alignItems: 'center',
                    bgcolor: alpha('#60a5fa', 0.08),
                    border: `1px solid ${alpha('#60a5fa', 0.18)}`,
                    borderRadius: 1.5,
                    display: 'flex',
                    justifyContent: 'space-between',
                    px: 1.5,
                    py: 1,
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="caption"
                      sx={{
                        color: 'text.secondary',
                        display: 'block',
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                      }}
                    >
                      Reticulum links
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Established encrypted audio routes
                    </Typography>
                  </Box>
                  <Chip
                    icon={
                      <LinkRoundedIcon sx={{ fontSize: '14px !important' }} />
                    }
                    label={`${linkStats.establishedLinks}/${linkStats.participants}`}
                    size="small"
                    sx={{
                      bgcolor: alpha('#60a5fa', 0.16),
                      border: `1px solid ${alpha('#60a5fa', 0.28)}`,
                      color: 'primary.light',
                      flexShrink: 0,
                      fontWeight: 700,
                      '& .MuiChip-icon': {
                        color: 'primary.light',
                      },
                    }}
                  />
                </Box>
              ) : null
            }
            advancedActions={
              <Button
                size="small"
                startIcon={<FileDownloadRoundedIcon fontSize="small" />}
                disabled={diagExporting}
                onClick={() => void handleDiagDownload()}
              >
                {t('core:group_call_export_diagnostics', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Button>
            }
          />
        </Box>
      </Box>
    </Box>
  );

  return typeof document !== 'undefined'
    ? createPortal(node, document.body)
    : null;
}
