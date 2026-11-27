import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import GraphicEqRoundedIcon from '@mui/icons-material/GraphicEqRounded';
import MicNoneRoundedIcon from '@mui/icons-material/MicNoneRounded';
import MicOffRoundedIcon from '@mui/icons-material/MicOffRounded';
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded';
import VolumeOffRoundedIcon from '@mui/icons-material/VolumeOffRounded';
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded';
import {
  Avatar,
  Box,
  Button,
  IconButton,
  MenuItem,
  Popover,
  Select,
  Slider,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ProximityPeer,
  ProximityVoiceMode,
  ProximityVoiceState,
} from './useQortalLandProximityVoice';

type Props = {
  state: ProximityVoiceState;
  mode: ProximityVoiceMode;
  pttKey: string;
  transmitting: boolean;
  peers: ProximityPeer[];
  error: string;
  devices: MediaDeviceInfo[];
  inputDeviceId: string;
  outputDeviceId: string;
  masterVolume: number;
  resolveName: (address: string) => string;
  onEnable: () => Promise<void>;
  onDisable: () => Promise<void>;
  onMode: (mode: ProximityVoiceMode) => void;
  onPttKey: (key: string) => void;
  onInputDevice: (deviceId: string) => void;
  onOutputDevice: (deviceId: string) => void;
  onMasterVolume: (volume: number) => void;
  onPeerPolicy: (peerKey: string, muted: boolean, volume: number) => void;
  availableVoiceAddresses?: string[];
  openRequest?: number;
  focusAddress?: string;
  onPresenceChange?: (enabled: boolean, muted: boolean) => void;
};

type VoicePopoverPosition = {
  left: number;
  top: number;
};

const PROXIMITY_VOICE_PANEL_WIDTH = 680;
const inactiveStates = new Set<ProximityVoiceState>([
  'off',
  'unavailable',
  'permission-denied',
]);

const panelSx = {
  background:
    'linear-gradient(145deg, rgba(8, 18, 31, 0.99), rgba(4, 12, 23, 0.985))',
  border: '1px solid rgba(44, 248, 255, 0.48)',
  borderRadius: '14px',
  boxShadow:
    '0 22px 52px rgba(0, 0, 0, 0.58), inset 0 0 28px rgba(44, 248, 255, 0.025)',
  color: '#f8fbff',
};

const initialsForName = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
};

const distanceLabel = (peer: ProximityPeer) => {
  const distance = peer.distance;
  if (distance == null) return { label: 'Nearby', color: '#91a0b6' };
  if (distance <= 180) return { label: 'Near', color: '#32d99c' };
  if (distance <= 420) return { label: 'Medium', color: '#ffc857' };
  return { label: 'Far', color: '#7f8ca0' };
};

export function ProximityVoiceControl(props: Props) {
  const {
    state,
    mode,
    transmitting,
    peers,
    error,
    devices,
    inputDeviceId,
    outputDeviceId,
    masterVolume,
    resolveName,
    onEnable,
    onDisable,
    onMode,
    onInputDevice,
    onOutputDevice,
    onMasterVolume,
    onPeerPolicy,
    availableVoiceAddresses = [],
    openRequest = 0,
    focusAddress = '',
    onPresenceChange,
  } = props;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const handledOpenRequestRef = useRef(openRequest);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerRowRefs = useRef(new Map<string, HTMLDivElement>());
  const [popoverPosition, setPopoverPosition] =
    useState<VoicePopoverPosition | null>(null);
  const [pausedByUser, setPausedByUser] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [focusedAddress, setFocusedAddress] = useState('');
  const active = !inactiveStates.has(state);
  const busy = state === 'authorizing' || state === 'reconnecting';
  const hasVoiceSession = sessionStarted || active || pausedByUser;
  const voiceConnected = active && !pausedByUser;
  const nearbyPeers = peers.filter((peer) => peer.state !== 'left');
  const nearbyVoiceCount = new Set([
    ...availableVoiceAddresses,
    ...nearbyPeers.map((peer) => peer.address),
  ]).size;

  const deviceSelectSx = {
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
    color: '#edf4ff',
    height: 38,
    width: '100%',
    '& .MuiSelect-icon': { color: 'rgba(226, 235, 248, 0.78)' },
    '& .MuiSelect-select': {
      alignItems: 'center',
      color: '#edf4ff',
      display: 'flex',
      fontSize: 11.5,
      paddingY: 0.8,
    },
    '& .MuiOutlinedInput-notchedOutline': {
      borderColor: 'rgba(184, 201, 224, 0.23)',
    },
    '&:hover .MuiOutlinedInput-notchedOutline': {
      borderColor: 'rgba(44, 248, 255, 0.48)',
    },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
      borderColor: '#2cf8ff',
    },
  } as const;

  const openPanel = useCallback(() => {
    const trigger = buttonRef.current;
    const chatPanel = trigger?.closest<HTMLElement>(
      '[data-qortalland-chat-panel="true"]'
    );
    const bounds = (chatPanel ?? trigger)?.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const desiredWidth = Math.min(
      PROXIMITY_VOICE_PANEL_WIDTH,
      viewportWidth - 24
    );
    const left = bounds
      ? Math.max(12, Math.min(bounds.left, viewportWidth - desiredWidth - 12))
      : 12;
    const top = bounds ? Math.max(12, bounds.top - 10) : 12;
    setPopoverPosition({ left, top });
  }, []);

  useEffect(() => {
    if (openRequest === handledOpenRequestRef.current) return;
    handledOpenRequestRef.current = openRequest;
    openPanel();
    setFocusedAddress(focusAddress);
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    if (focusAddress) {
      window.setTimeout(() => {
        const focusKey =
          peers.find((peer) => peer.address === focusAddress)?.key ||
          focusAddress;
        peerRowRefs.current
          .get(focusKey)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }, 60);
      focusTimerRef.current = setTimeout(() => {
        setFocusedAddress((current) =>
          current === focusAddress ? '' : current
        );
      }, 1800);
    }
  }, [focusAddress, openPanel, openRequest, peers]);

  useEffect(
    () => () => {
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    },
    []
  );

  useEffect(() => {
    if (active) setSessionStarted(true);
  }, [active]);

  useEffect(() => {
    if (
      !pausedByUser &&
      (state === 'permission-denied' || state === 'unavailable')
    ) {
      setSessionStarted(false);
    }
  }, [pausedByUser, state]);

  useEffect(() => {
    onPresenceChange?.(hasVoiceSession, hasVoiceSession && pausedByUser);
  }, [hasVoiceSession, onPresenceChange, pausedByUser]);

  useEffect(() => {
    if (!popoverPosition) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPopoverPosition(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [popoverPosition]);

  const enableVoice = async () => {
    setSessionStarted(true);
    onMode('open-mic');
    try {
      await onEnable();
      setPausedByUser(false);
    } catch (cause) {
      setSessionStarted(false);
      throw cause;
    }
  };

  const toggleMute = async () => {
    if (pausedByUser) {
      onMode('open-mic');
      await onEnable();
      setPausedByUser(false);
      return;
    }
    setPausedByUser(true);
    try {
      await onDisable();
    } catch (cause) {
      setPausedByUser(false);
      throw cause;
    }
  };

  const voiceTooltip =
    hasVoiceSession || nearbyVoiceCount > 0
      ? `Proximity Voice\n${nearbyVoiceCount} player${
          nearbyVoiceCount === 1 ? '' : 's'
        } nearby`
      : 'Proximity Voice\nVoice is off';

  return (
    <>
      <Tooltip
        arrow
        placement="top"
        title={
          <Box>
            {voiceTooltip.split('\n').map((line) => (
              <Typography key={line} sx={{ fontSize: 11.5, lineHeight: 1.45 }}>
                {line}
              </Typography>
            ))}
          </Box>
        }
      >
        <Box sx={{ display: 'inline-flex', position: 'relative' }}>
          <IconButton
            ref={buttonRef}
            aria-label={`Proximity Voice, ${nearbyVoiceCount} nearby`}
            aria-haspopup="dialog"
            aria-expanded={Boolean(popoverPosition)}
            onClick={openPanel}
            size="small"
            sx={{
              backgroundColor: voiceConnected
                ? 'rgba(44, 248, 255, 0.1)'
                : 'transparent',
              border: `1px solid ${alpha(
                '#2cf8ff',
                popoverPosition || voiceConnected ? 0.48 : 0.18
              )}`,
              borderRadius: '50%',
              boxShadow: voiceConnected
                ? '0 0 11px rgba(44, 248, 255, 0.22)'
                : 'none',
              color: transmitting
                ? '#4dffb8'
                : pausedByUser
                  ? '#8d98aa'
                  : voiceConnected
                    ? '#2cf8ff'
                    : 'rgba(220, 232, 242, 0.58)',
              height: 31,
              padding: 0,
              width: 31,
              '&:hover': {
                backgroundColor: 'rgba(44, 248, 255, 0.1)',
                borderColor: 'rgba(44, 248, 255, 0.58)',
                color: '#72fbff',
              },
            }}
          >
            {pausedByUser ? (
              <MicOffRoundedIcon sx={{ fontSize: 18 }} />
            ) : transmitting ? (
              <GraphicEqRoundedIcon sx={{ fontSize: 19 }} />
            ) : (
              <MicNoneRoundedIcon sx={{ fontSize: 19 }} />
            )}
          </IconButton>
          {nearbyVoiceCount > 0 && (
            <Box
              aria-hidden="true"
              sx={{
                alignItems: 'center',
                backgroundColor: '#16d7df',
                border: '2px solid rgba(5, 12, 22, 0.96)',
                borderRadius: 999,
                color: '#031118',
                display: 'flex',
                fontSize: 9,
                fontWeight: 900,
                height: 15,
                justifyContent: 'center',
                minWidth: 15,
                padding: '0 3px',
                pointerEvents: 'none',
                position: 'absolute',
                right: -6,
                top: -6,
                zIndex: 2,
              }}
            >
              {nearbyVoiceCount > 9 ? '9+' : nearbyVoiceCount}
            </Box>
          )}
        </Box>
      </Tooltip>

      <Popover
        anchorPosition={popoverPosition ?? { left: 12, top: 12 }}
        anchorReference="anchorPosition"
        open={Boolean(popoverPosition)}
        onClose={() => setPopoverPosition(null)}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              background: 'transparent',
              boxShadow: 'none',
              maxWidth: 'calc(100vw - 24px)',
              overflow: 'visible',
              padding: 0,
            },
          },
        }}
      >
        <Box
          role="dialog"
          aria-label="Proximity voice"
          sx={{
            ...panelSx,
            display: 'grid',
            gridTemplateColumns: {
              xs: 'minmax(0, 1fr)',
              sm: '270px minmax(320px, 1fr)',
            },
            maxWidth: 'calc(100vw - 24px)',
            overflow: 'hidden',
            width: {
              xs: 'min(430px, calc(100vw - 24px))',
              sm: PROXIMITY_VOICE_PANEL_WIDTH,
            },
          }}
        >
          <Box
            sx={{
              borderRight: {
                xs: 'none',
                sm: '1px solid rgba(255, 255, 255, 0.09)',
              },
              padding: '16px',
            }}
          >
            <Box
              sx={{
                alignItems: 'center',
                display: 'grid',
                gap: 1.1,
                gridTemplateColumns: '40px minmax(0, 1fr)',
                marginBottom: 1.5,
              }}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  backgroundColor: 'rgba(44, 248, 255, 0.08)',
                  borderRadius: '50%',
                  color: transmitting ? '#4dffb8' : '#2cf8ff',
                  display: 'flex',
                  height: 38,
                  justifyContent: 'center',
                  width: 38,
                }}
              >
                {pausedByUser ? (
                  <MicOffRoundedIcon sx={{ fontSize: 22 }} />
                ) : transmitting ? (
                  <GraphicEqRoundedIcon sx={{ fontSize: 23 }} />
                ) : (
                  <MicNoneRoundedIcon sx={{ fontSize: 23 }} />
                )}
              </Box>
              <Box>
                <Typography sx={{ fontSize: 15, fontWeight: 800 }}>
                  Proximity voice
                </Typography>
                <Typography
                  sx={{
                    color: voiceConnected
                      ? '#2cf8ff'
                      : 'rgba(205, 214, 229, 0.64)',
                    fontSize: 11,
                    marginTop: 0.2,
                  }}
                >
                  {busy
                    ? 'Connecting voice'
                    : pausedByUser
                      ? 'Voice muted'
                      : voiceConnected
                        ? 'Talk with players near you.'
                        : 'Voice is off'}
                </Typography>
              </Box>
            </Box>

            {!hasVoiceSession ? (
              <Button
                disabled={busy}
                fullWidth
                onClick={() => void enableVoice().catch(() => {})}
                startIcon={<MicNoneRoundedIcon />}
                sx={{
                  background: 'linear-gradient(100deg, #13cde1, #25eef0)',
                  borderRadius: '8px',
                  color: '#041019',
                  fontSize: 12.5,
                  fontWeight: 800,
                  height: 40,
                  textTransform: 'none',
                  '&:hover': {
                    background: 'linear-gradient(100deg, #20d9e9, #48f7f5)',
                  },
                }}
              >
                Enable voice
              </Button>
            ) : (
              <Button
                disabled={busy}
                fullWidth
                onClick={() => void toggleMute().catch(() => {})}
                startIcon={
                  pausedByUser ? <MicNoneRoundedIcon /> : <MicOffRoundedIcon />
                }
                sx={{
                  border: '1px solid rgba(188, 204, 226, 0.26)',
                  borderRadius: '8px',
                  color: '#2cf8ff',
                  fontSize: 12.5,
                  fontWeight: 800,
                  height: 40,
                  textTransform: 'none',
                  '&:hover': {
                    backgroundColor: 'rgba(44, 248, 255, 0.07)',
                    borderColor: 'rgba(44, 248, 255, 0.46)',
                  },
                }}
              >
                {pausedByUser ? 'Unmute microphone' : 'Mute microphone'}
              </Button>
            )}

            <Typography
              sx={{
                color: 'rgba(174, 189, 211, 0.64)',
                fontSize: 9.5,
                fontWeight: 800,
                letterSpacing: '0.08em',
                marginTop: 1.45,
                textTransform: 'uppercase',
              }}
            >
              Output
            </Typography>
            <Select
              displayEmpty
              onChange={(event) => onOutputDevice(String(event.target.value))}
              size="small"
              sx={deviceSelectSx}
              value={outputDeviceId}
            >
              <MenuItem value="">System default</MenuItem>
              {devices
                .filter((device) => device.kind === 'audiooutput')
                .map((device) => (
                  <MenuItem key={device.deviceId} value={device.deviceId}>
                    {device.label || 'Speaker'}
                  </MenuItem>
                ))}
            </Select>

            <Typography
              sx={{
                color: 'rgba(174, 189, 211, 0.64)',
                fontSize: 9.5,
                fontWeight: 800,
                letterSpacing: '0.08em',
                marginTop: 1.15,
                textTransform: 'uppercase',
              }}
            >
              Microphone
            </Typography>
            <Select
              displayEmpty
              onChange={(event) => onInputDevice(String(event.target.value))}
              size="small"
              sx={deviceSelectSx}
              value={inputDeviceId}
            >
              <MenuItem value="">System default</MenuItem>
              {devices
                .filter((device) => device.kind === 'audioinput')
                .map((device) => (
                  <MenuItem key={device.deviceId} value={device.deviceId}>
                    {device.label || 'Microphone'}
                  </MenuItem>
                ))}
            </Select>

            <Box
              sx={{
                alignItems: 'center',
                display: 'grid',
                gap: 1,
                gridTemplateColumns: '20px 1fr 34px',
                marginTop: 1.35,
              }}
            >
              <VolumeUpRoundedIcon
                sx={{ color: 'rgba(224, 233, 245, 0.72)', fontSize: 18 }}
              />
              <Slider
                aria-label="Proximity voice volume"
                max={1}
                min={0}
                onChange={(_event, value) =>
                  onMasterVolume(Array.isArray(value) ? value[0] : value)
                }
                size="small"
                step={0.01}
                value={masterVolume}
              />
              <Typography
                sx={{
                  color: 'rgba(208, 219, 235, 0.72)',
                  fontSize: 10.5,
                  textAlign: 'right',
                }}
              >
                {Math.round(masterVolume * 100)}%
              </Typography>
            </Box>
            {error && (
              <Typography sx={{ color: '#ff7a8d', fontSize: 10.5, mt: 0.7 }}>
                {error}
              </Typography>
            )}
          </Box>

          <Box sx={{ minWidth: 0, padding: '15px 14px 14px' }}>
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 1,
              }}
            >
              <Box sx={{ alignItems: 'center', display: 'flex', gap: 0.75 }}>
                <PeopleAltRoundedIcon
                  sx={{ color: 'rgba(190, 204, 225, 0.62)', fontSize: 17 }}
                />
                <Typography
                  sx={{
                    color: 'rgba(190, 204, 225, 0.7)',
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: '0.07em',
                    textTransform: 'uppercase',
                  }}
                >
                  Nearby on voice · {nearbyVoiceCount}
                </Typography>
              </Box>
              <IconButton
                aria-label="Close proximity voice"
                onClick={() => setPopoverPosition(null)}
                size="small"
                sx={{
                  color: 'rgba(210, 221, 238, 0.62)',
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.06)',
                    color: '#fff',
                  },
                }}
              >
                <CloseRoundedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>

            {nearbyPeers.length === 0 ? (
              <Box
                sx={{
                  alignItems: 'center',
                  color: 'rgba(180, 194, 215, 0.56)',
                  display: 'flex',
                  gap: 1,
                  justifyContent: 'center',
                  minHeight: 150,
                }}
              >
                <PeopleAltRoundedIcon sx={{ fontSize: 18 }} />
                <Typography sx={{ fontSize: 11.5 }}>
                  {nearbyVoiceCount > 0
                    ? `${nearbyVoiceCount} player${
                        nearbyVoiceCount === 1 ? '' : 's'
                      } available`
                    : 'Nobody nearby'}
                </Typography>
              </Box>
            ) : (
              <Box
                sx={{
                  maxHeight: 198,
                  overflowY: nearbyPeers.length > 3 ? 'auto' : 'hidden',
                  paddingRight: nearbyPeers.length > 3 ? 0.5 : 0,
                  scrollbarColor: 'rgba(44, 248, 255, 0.35) transparent',
                  scrollbarWidth: 'thin',
                }}
              >
                {nearbyPeers.map((peer) => {
                  const name = resolveName(peer.address);
                  const range = distanceLabel(peer);
                  return (
                    <Box
                      key={peer.key}
                      ref={(node: HTMLDivElement | null) => {
                        if (node) peerRowRefs.current.set(peer.key, node);
                        else peerRowRefs.current.delete(peer.key);
                      }}
                      sx={{
                        alignItems: 'center',
                        backgroundColor:
                          focusedAddress === peer.address
                            ? 'rgba(44, 248, 255, 0.09)'
                            : 'transparent',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.065)',
                        borderRadius: '8px',
                        display: 'grid',
                        gap: 1,
                        gridTemplateColumns:
                          '38px minmax(80px, 1fr) 58px 20px 92px 30px',
                        minHeight: 64,
                        padding: '7px 4px',
                        transition: 'background-color 160ms ease',
                      }}
                    >
                      <Avatar
                        sx={{
                          bgcolor: 'rgba(44, 248, 255, 0.1)',
                          border: `1px solid ${
                            peer.speaking
                              ? '#32d99c'
                              : 'rgba(44, 248, 255, 0.28)'
                          }`,
                          fontSize: 12,
                          height: 34,
                          width: 34,
                        }}
                      >
                        {initialsForName(name)}
                      </Avatar>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography
                          noWrap
                          sx={{ fontSize: 12, fontWeight: 750 }}
                        >
                          {name}
                        </Typography>
                        <Box
                          sx={{
                            alignItems: 'center',
                            display: 'flex',
                            gap: 0.55,
                            marginTop: 0.2,
                          }}
                        >
                          <Box
                            sx={{
                              backgroundColor: peer.speaking
                                ? '#32d99c'
                                : '#2cf8ff',
                              borderRadius: '50%',
                              height: 6,
                              width: 6,
                            }}
                          />
                          <Typography
                            sx={{
                              color: peer.speaking
                                ? '#32d99c'
                                : 'rgba(192, 205, 224, 0.66)',
                              fontSize: 9.5,
                            }}
                          >
                            {peer.speaking ? 'Speaking' : 'On voice'}
                          </Typography>
                        </Box>
                      </Box>
                      <Typography
                        sx={{
                          color: range.color,
                          fontSize: 10,
                          textAlign: 'right',
                        }}
                      >
                        {range.label}
                      </Typography>
                      <VolumeUpRoundedIcon
                        sx={{
                          color: 'rgba(214, 224, 239, 0.64)',
                          fontSize: 17,
                        }}
                      />
                      <Slider
                        aria-label={`${name} volume`}
                        max={1}
                        min={0}
                        onChange={(_event, value) =>
                          onPeerPolicy(
                            peer.key,
                            peer.muted,
                            Array.isArray(value) ? value[0] : value
                          )
                        }
                        size="small"
                        step={0.01}
                        value={peer.volume}
                      />
                      <Tooltip
                        title={peer.muted ? 'Unmute player' : 'Mute player'}
                      >
                        <IconButton
                          aria-label={
                            peer.muted ? `Unmute ${name}` : `Mute ${name}`
                          }
                          onClick={() =>
                            onPeerPolicy(peer.key, !peer.muted, peer.volume)
                          }
                          size="small"
                          sx={{
                            color: peer.muted
                              ? '#ff8092'
                              : 'rgba(205, 216, 232, 0.62)',
                          }}
                        >
                          {peer.muted ? (
                            <VolumeOffRoundedIcon sx={{ fontSize: 17 }} />
                          ) : (
                            <MicOffRoundedIcon sx={{ fontSize: 17 }} />
                          )}
                        </IconButton>
                      </Tooltip>
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>
        </Box>
      </Popover>
    </>
  );
}
