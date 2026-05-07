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
import { useAtom, useAtomValue } from 'jotai';
import PictureInPictureAltRoundedIcon from '@mui/icons-material/PictureInPictureAltRounded';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import {
  userInfoAtom,
  qortalGroupVoiceCallMinimizedAtom,
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

const BG_MAIN = '#313338';
const BG_HEADER = '#2b2d31';
const BG_TILE = '#111214';
const BORDER_SUB = '#1e1f22';
const TEXT_MUTED = '#949ba4';
/** In call, mic idle (not VAD-speaking). Distinct from TEXT_MUTED so dots don’t read as “offline”. */
const VOICE_CONNECTED = '#3d9142';
const SPEAKING = '#23a559';
const DANGER = '#f23f42';

type SidebarMode = 'none' | 'participants';

type GroupCallLinkStats = {
  establishedLinks: number;
  participants: number;
};

export function QortalGroupVoiceCallStage() {
  const { t } = useTranslation(['core']);
  const userInfo = useAtomValue(userInfoAtom);
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

  const handleDiagClipboard = useCallback(async () => {
    setDiagExporting(true);
    try {
      await exportGroupCallDiagnostics?.({ download: false, clipboard: true });
    } catch (e) {
      console.error('[GCall] diagnostics clipboard failed', e);
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
    if (!visible) setQcallMinimized(false);
  }, [visible, setQcallMinimized]);

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

  const toggleParticipantsSidebar = useCallback(() => {
    setSidebar((prev) => (prev === 'participants' ? 'none' : 'participants'));
  }, []);

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

  const node = (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 1590,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: BG_MAIN,
        color: '#dbdee1',
        fontFamily: 'Inter, system-ui, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* Top bar */}
      <Box
        sx={{
          height: 48,
          flexShrink: 0,
          display: 'flex',
          flexWrap: 'nowrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          px: 2,
          bgcolor: BG_HEADER,
          borderBottom: `1px solid ${BORDER_SUB}`,
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
                bgcolor: '#4e5058',
                borderRadius: 1,
                p: 0.5,
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
              }}
            >
              <Groups2RoundedIcon sx={{ fontSize: 18 }} />
            </Box>
            <Typography
              component="span"
              variant="body2"
              sx={{
                fontWeight: 600,
                fontSize: 14,
                color: TEXT_MUTED,
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
              height: 16,
              bgcolor: '#4e5058',
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
                    ? alpha('#94a3b8', 0.35)
                    : alpha('#22c55e', 0.35),
                color: '#dbdee1',
                '& .MuiChip-label': { px: 0.75 },
              }}
            />
          </Tooltip>
          {linkStats ? (
            <Tooltip title="Reticulum links / participants" placement="bottom">
              <Chip
                icon={<LinkRoundedIcon sx={{ fontSize: '14px !important' }} />}
                label={`${linkStats.establishedLinks}/${linkStats.participants}`}
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
          ) : null}
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
          <Tooltip
            title={t('core:group_call_export_diagnostics', {
              postProcess: 'capitalizeFirstChar',
            })}
            placement="bottom"
          >
            <span>
              <IconButton
                size="small"
                disabled={diagExporting}
                onClick={() => void handleDiagDownload()}
                sx={{ color: '#93c5fd' }}
              >
                <FileDownloadRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip
            title={t('core:group_call_copy_diagnostics', {
              postProcess: 'capitalizeFirstChar',
            })}
            placement="bottom"
          >
            <span>
              <IconButton
                size="small"
                disabled={diagExporting}
                onClick={() => void handleDiagClipboard()}
                sx={{ color: '#c4b5fd' }}
              >
                <ContentCopyRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip
            title={t('core:group_call_minimize', {
              postProcess: 'capitalizeFirstChar',
            })}
            placement="bottom"
          >
            <IconButton
              size="small"
              onClick={() => setQcallMinimized(true)}
              sx={{ color: '#b5bac1' }}
            >
              <PictureInPictureAltRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip
            title={t('core:group_call_participants', {
              postProcess: 'capitalizeFirstChar',
            })}
          >
            <IconButton
              size="small"
              onClick={toggleParticipantsSidebar}
              sx={{ color: '#b5bac1' }}
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
            p: 2,
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
                gap: 2,
                width: '100%',
                height: '100%',
                maxWidth: 1200,
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
                  memberPrimaryNames,
                  userInfo?.name
                );
                const avatarSrc = qortalAvatarThumbnailSrc(regName);
                const hasFriendlyDisplayName =
                  Boolean(memberPrimaryNames[p.address]?.trim()) ||
                  (self && Boolean(userInfo?.name?.trim()));
                const avatarInitials = hasFriendlyDisplayName
                  ? initialsFromDisplayLabel(displayName, p.address)
                  : p.address.slice(0, 2).toUpperCase();
                return (
                  <Box
                    key={p.address}
                    sx={{
                      position: 'relative',
                      borderRadius: 2,
                      bgcolor: BG_TILE,
                      minHeight: 160,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '2px solid',
                      borderColor: speaking ? SPEAKING : 'transparent',
                      boxShadow: speaking
                        ? `0 0 16px ${alpha(SPEAKING, 0.35)}`
                        : 'none',
                      transition:
                        'border-color 0.25s ease, box-shadow 0.25s ease',
                    }}
                  >
                    <Avatar
                      alt={displayName}
                      src={avatarSrc}
                      sx={{
                        width: { xs: 96, sm: 128 },
                        height: { xs: 96, sm: 128 },
                        bgcolor: addrHue(p.address),
                        color: '#fff',
                        fontSize: { xs: 28, sm: 36 },
                        fontWeight: 700,
                        userSelect: 'none',
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
                        bgcolor: alpha('#000', 0.55),
                        px: 1,
                        py: 0.5,
                        borderRadius: 1,
                        fontSize: 12,
                        fontWeight: 600,
                        backdropFilter: 'blur(6px)',
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
              bgcolor: BG_HEADER,
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
                      gap: 1.5,
                      py: 1,
                      px: 1,
                      borderRadius: 1,
                      '&:hover': { bgcolor: alpha('#fff', 0.04) },
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
          height: 96,
          flexShrink: 0,
          bgcolor: BORDER_SUB,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: 3,
          position: 'relative',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <IconButton
            onClick={toggleMute}
            sx={{
              width: 56,
              height: 56,
              bgcolor: muted ? DANGER : '#313338',
              color: '#fff',
              '&:hover': {
                bgcolor: muted ? alpha(DANGER, 0.85) : '#4e5058',
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
          >
            <IconButton
              onClick={toggleHearCall}
              sx={{
                width: 56,
                height: 56,
                bgcolor: hearCall ? '#313338' : DANGER,
                color: '#fff',
                '&:hover': {
                  bgcolor: hearCall ? '#4e5058' : alpha(DANGER, 0.85),
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
              bgcolor: '#4e5058',
              flexShrink: 0,
              mx: 1,
            }}
          />

          <IconButton
            onClick={handleLeave}
            sx={{
              width: 56,
              height: 56,
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
          }}
        >
          <CallAudioSettingsButton
            iconButtonSize="medium"
            IconComponent={SettingsIcon}
          />
        </Box>
      </Box>
    </Box>
  );

  return typeof document !== 'undefined'
    ? createPortal(node, document.body)
    : null;
}
