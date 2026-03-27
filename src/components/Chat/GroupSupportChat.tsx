/**
 * GroupSupportChat — group voice call test interface for regular users.
 *
 * Renders as a fixed bottom-right panel (same position as SupportChat).
 * Uses GROUP_SUPPORT_ADDRESSES as the list of agents, and useGroupVoiceCall
 * for the audio layer.  Text chat re-uses useSupportChat.
 */

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import {
  Avatar,
  Box,
  Chip,
  CircularProgress,
  IconButton,
  InputBase,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import Groups2RoundedIcon from '@mui/icons-material/Groups2Rounded';
import CallEndRoundedIcon from '@mui/icons-material/CallEndRounded';
import MicRoundedIcon from '@mui/icons-material/MicRounded';
import MicOffRoundedIcon from '@mui/icons-material/MicOffRounded';
import RecordVoiceOverRoundedIcon from '@mui/icons-material/RecordVoiceOverRounded';
import { groupChatOpenAtom, userInfoAtom } from '../../atoms/global';
import { useSupportChat, GROUP_SUPPORT_ADDRESSES } from '../../hooks/useSupportChat';
import { useGroupVoiceCall } from '../../hooks/useGroupVoiceCall';
import { getGroupCallTransportSummary } from '../../lib/group-call/router';
import { CallAudioSettingsButton } from './CallAudioDeviceSelectors';

export { GROUP_SUPPORT_ADDRESSES };

// ── Constants ──────────────────────────────────────────────────────────────────

const GROUP_CHAT_ID = 'group:gcall-test';
const GROUP_ROOM_ID = 'gcall-support-room';

// ── Helpers ────────────────────────────────────────────────────────────────────

function shortAddr(addr: string): string {
  if (!addr || addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function addrColor(addr: string): string {
  let h = 0;
  for (let i = 0; i < addr.length; i++) {
    h = (h * 31 + addr.charCodeAt(i)) & 0xffff;
  }
  return `hsl(${h % 360}, 60%, 68%)`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const roleLabel: Record<string, string> = {
  'root-forwarder': 'Root',
  'cluster-forwarder': 'Forwarder',
  'standby-forwarder': 'Standby',
  'participant': '',
};

// ── ParticipantAvatar ──────────────────────────────────────────────────────────

function ParticipantAvatar({ address, speaking }: { address: string; speaking: boolean }) {
  return (
    <Tooltip title={address} placement="top">
      <Box sx={{ position: 'relative', display: 'inline-block' }}>
        <Avatar
          sx={{
            width: 36, height: 36,
            bgcolor: addrColor(address),
            fontSize: 13, fontWeight: 600,
            outline: speaking ? `2.5px solid #22c55e` : '2.5px solid transparent',
            transition: 'outline-color 0.15s ease',
          }}
        >
          {address.slice(0, 2)}
        </Avatar>
        {speaking && (
          <Box
            sx={{
              position: 'absolute', bottom: -2, right: -2,
              width: 12, height: 12, borderRadius: '50%',
              bgcolor: '#22c55e',
              border: '2px solid #1a1b1e',
            }}
          />
        )}
      </Box>
    </Tooltip>
  );
}

// ── GroupSupportChat ───────────────────────────────────────────────────────────

export function GroupSupportChat() {
  const [isOpen, setIsOpen] = useAtom(groupChatOpenAtom);
  const [keepMounted, setKeepMounted] = useState(false);

  if (!isOpen && !keepMounted) {
    return (
      <Tooltip title="Group Support Call" placement="left">
        <Box
          onClick={() => setIsOpen(true)}
          sx={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 1400,
            width: 52, height: 52, borderRadius: '50%',
            bgcolor: '#6366f1', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', boxShadow: '0 4px 20px rgba(99,102,241,0.5)',
            transition: 'transform 0.2s', '&:hover': { transform: 'scale(1.1)' },
          }}
        >
          <Groups2RoundedIcon fontSize="medium" />
        </Box>
      </Tooltip>
    );
  }

  return (
    <GroupSupportChatPanel
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      setKeepMounted={setKeepMounted}
    />
  );
}

function GroupSupportChatPanel({
  isOpen,
  setIsOpen,
  setKeepMounted,
}: {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  setKeepMounted: (active: boolean) => void;
}) {
  const userInfo = useAtomValue(userInfoAtom);

  // Text chat
  const { messages, sendMessage, isSending } = useSupportChat();

  // Group voice call
  const {
    roomState, participants, myRole, activeSpeakers, topologyLabel, metrics,
    joinGroupCall, leaveGroupCall, setMuted: setCallMuted,
  } = useGroupVoiceCall(isOpen);

  const inCall = roomState === 'connected' || roomState === 'joining';

  const [transportTick, bumpTransport] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!inCall) return;
    const id = setInterval(bumpTransport, 700);
    return () => clearInterval(id);
  }, [inCall]);
  const transport = useMemo(
    () => getGroupCallTransportSummary(metrics, Date.now()),
    [metrics, transportTick]
  );

  const [inputValue, setInputValue] = useState('');
  const [muted, setMuted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text) return;
    sendMessage(text);
    setInputValue('');
  }, [inputValue, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const handleJoinCall = useCallback(async () => {
    await joinGroupCall(GROUP_ROOM_ID, GROUP_CHAT_ID);
  }, [joinGroupCall]);

  useEffect(() => {
    setKeepMounted(inCall);
  }, [inCall, setKeepMounted]);

  return (
    <Paper
      elevation={12}
      sx={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 1400,
        width: 360, height: inCall ? 540 : 460, borderRadius: 3,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        bgcolor: '#1a1b1e', color: '#fff',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 2, py: 1.5,
          background: 'linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%)',
          display: 'flex', alignItems: 'center', gap: 1,
        }}
      >
        <Groups2RoundedIcon fontSize="small" />
        <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1 }}>
          Group Support
        </Typography>

        {/* Topology badge */}
        {inCall && (
          <Chip
            label={topologyLabel}
            size="small"
            sx={{
              height: 18, fontSize: 9, fontWeight: 700,
              bgcolor: alpha('#fff', 0.2), color: '#fff',
            }}
          />
        )}

        {inCall && (
          <Tooltip title={transport.tooltip} placement="bottom">
            <Chip
              label={transport.label}
              size="small"
              sx={{
                height: 18, fontSize: 9, fontWeight: 700,
                maxWidth: 120,
                bgcolor:
                  transport.mode === 'relay'
                    ? alpha('#f59e0b', 0.35)
                    : transport.mode === 'connecting'
                      ? alpha('#94a3b8', 0.35)
                      : alpha('#22c55e', 0.35),
                color: '#fff',
              }}
            />
          </Tooltip>
        )}

        {/* My role badge */}
        {inCall && myRole !== 'participant' && (
          <Chip
            label={roleLabel[myRole]}
            size="small"
            sx={{
              height: 18, fontSize: 9, fontWeight: 700,
              bgcolor: '#22c55e', color: '#fff',
            }}
          />
        )}

        <IconButton size="small" sx={{ color: '#fff', ml: 'auto' }} onClick={() => setIsOpen(false)}>
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Group call bar — in call */}
      {inCall && (
        <Box
          sx={{
            px: 2, py: 1,
            bgcolor: alpha('#6366f1', 0.12),
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {/* Participant roster */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75, flexWrap: 'wrap' }}>
            {participants.map((p) => (
              <Box key={p.address} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
                <ParticipantAvatar address={p.address} speaking={p.speaking} />
                {p.role !== 'participant' && (
                  <Typography variant="caption" sx={{ fontSize: 8, color: '#22c55e', lineHeight: 1 }}>
                    {roleLabel[p.role]}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>

          {/* Active speakers */}
          {activeSpeakers.length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
              <RecordVoiceOverRoundedIcon sx={{ fontSize: 12, color: '#22c55e' }} />
              <Typography variant="caption" sx={{ fontSize: 10, color: '#22c55e' }}>
                {activeSpeakers.map((a) => shortAddr(a)).join(', ')}
              </Typography>
            </Box>
          )}

          {/* Call controls */}
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <CallAudioSettingsButton />
            <Tooltip title={muted ? 'Unmute' : 'Mute'}>
              <IconButton
                size="small"
                onClick={() => { setMuted((m) => { setCallMuted(!m); return !m; }); }}
                sx={{
                  color: muted ? '#ef4444' : '#22c55e',
                  bgcolor: alpha(muted ? '#ef4444' : '#22c55e', 0.12),
                  width: 28, height: 28,
                }}
              >
                {muted ? <MicOffRoundedIcon sx={{ fontSize: 14 }} /> : <MicRoundedIcon sx={{ fontSize: 14 }} />}
              </IconButton>
            </Tooltip>

            <Tooltip title="Leave call">
              <IconButton
                size="small"
                onClick={leaveGroupCall}
                sx={{
                  color: '#ef4444', bgcolor: alpha('#ef4444', 0.12),
                  width: 28, height: 28,
                }}
              >
                <CallEndRoundedIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>

            <Typography variant="caption" sx={{ fontSize: 10, color: alpha('#fff', 0.5), ml: 'auto' }}>
              {participants.length} in call
            </Typography>
          </Box>

          <Box
            sx={{
              mt: 0.75,
              px: 1,
              py: 0.75,
              borderRadius: 1,
              bgcolor: alpha('#000', 0.16),
              border: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            <Typography variant="caption" sx={{ display: 'block', fontSize: 10, color: alpha('#fff', 0.72) }}>
              Mix load {metrics.mixerActiveSpeakerEstimate} | master {metrics.mixerMasterGain.toFixed(2)} | reduction {metrics.mixerCurrentReductionDb.toFixed(2)} dB
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', fontSize: 10, color: alpha('#fff', 0.72) }}>
              Overloads {metrics.mixerOverloadEvents} | heavy frac {(metrics.mixerHeavyReductionFraction * 100).toFixed(1)}% | conceal {metrics.concealmentTicks}
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', fontSize: 10, color: alpha('#fff', 0.72) }}>
              Jitter underruns {metrics.jitterUnderruns} | missing {metrics.missingFrames} | transport {transport.label}
            </Typography>
          </Box>
        </Box>
      )}

      {/* Join call button — not in call */}
      {!inCall && (
        <Box
          sx={{
            px: 2, py: 1,
            bgcolor: alpha('#6366f1', 0.08),
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <Box
            onClick={handleJoinCall}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer',
              py: 0.75, px: 1.5, borderRadius: 1.5,
              bgcolor: alpha('#6366f1', 0.15),
              '&:hover': { bgcolor: alpha('#6366f1', 0.25) },
              transition: 'background 0.15s',
            }}
          >
            {roomState === 'joining' ? (
              <CircularProgress size={14} sx={{ color: '#6366f1' }} />
            ) : (
              <Groups2RoundedIcon sx={{ fontSize: 16, color: '#6366f1' }} />
            )}
            <Typography variant="caption" fontWeight={600} sx={{ color: '#6366f1', fontSize: 12 }}>
              {roomState === 'joining' ? 'Joining…' : 'Join Group Call'}
            </Typography>
          </Box>
        </Box>
      )}

      {/* Messages */}
      <Box sx={{ flex: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {messages.map((msg: any) => {
          const isMe = msg.authorAddress === userInfo?.address;
          return (
            <Box
              key={msg.id}
              sx={{
                display: 'flex', flexDirection: isMe ? 'row-reverse' : 'row',
                alignItems: 'flex-end', gap: 0.75,
              }}
            >
              {!isMe && (
                <Avatar sx={{ width: 26, height: 26, bgcolor: addrColor(msg.authorAddress), fontSize: 10 }}>
                  {msg.authorAddress.slice(0, 2)}
                </Avatar>
              )}
              <Box>
                {!isMe && (
                  <Typography variant="caption" sx={{ pl: 0.5, color: addrColor(msg.authorAddress), fontWeight: 600 }}>
                    {shortAddr(msg.authorAddress)}
                  </Typography>
                )}
                <Box
                  sx={{
                    px: 1.5, py: 0.75, borderRadius: 2,
                    bgcolor: isMe ? '#6366f1' : alpha('#fff', 0.06),
                    maxWidth: 240, wordBreak: 'break-word',
                  }}
                >
                  <Typography variant="body2" sx={{ fontSize: 13 }}>
                    {typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}
                  </Typography>
                  <Typography variant="caption" sx={{ fontSize: 9, opacity: 0.5, display: 'block', textAlign: 'right', mt: 0.25 }}>
                    {fmtTime(msg.timestamp)}
                  </Typography>
                </Box>
              </Box>
            </Box>
          );
        })}
        <div ref={messagesEndRef} />
      </Box>

      {/* Input */}
      <Box
        sx={{
          px: 1.5, py: 1,
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', gap: 1,
        }}
      >
        <InputBase
          fullWidth
          multiline
          maxRows={3}
          placeholder="Message…"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          sx={{
            fontSize: 13, color: '#fff',
            px: 1.5, py: 0.75,
            bgcolor: alpha('#fff', 0.06),
            borderRadius: 2,
            '& textarea': { color: '#fff' },
          }}
        />
        <IconButton
          size="small"
          onClick={handleSend}
          disabled={isSending || !inputValue.trim()}
          sx={{
            color: '#6366f1',
            '&:disabled': { color: alpha('#6366f1', 0.3) },
          }}
        >
          {isSending ? <CircularProgress size={16} /> : <SendRoundedIcon fontSize="small" />}
        </IconButton>
      </Box>
    </Paper>
  );
}
