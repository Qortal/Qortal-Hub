/**
 * GroupAgentDashboard — group voice call interface for support agents.
 *
 * Agents see a panel with all current group support conversations and
 * can join/leave the shared group call room.  Uses useGroupVoiceCall.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import {
  Avatar,
  Badge,
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
import HubRoundedIcon from '@mui/icons-material/HubRounded';
import { groupChatOpenAtom, userInfoAtom } from '../../atoms/global';
import { useSupportChat, GROUP_SUPPORT_ADDRESSES } from '../../hooks/useSupportChat';
import { useGroupVoiceCall } from '../../hooks/useGroupVoiceCall';
import type { MyRole } from '../../hooks/useGroupVoiceCall';

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

const ROLE_COLORS: Record<MyRole, string> = {
  'root-forwarder':    '#6366f1',
  'cluster-forwarder': '#8b5cf6',
  'standby-forwarder': '#f59e0b',
  'participant':       'transparent',
};

const ROLE_LABELS: Record<MyRole, string> = {
  'root-forwarder':    'Root Forwarder',
  'cluster-forwarder': 'Cluster Forwarder',
  'standby-forwarder': 'Standby',
  'participant':       'Participant',
};

// ── ParticipantRow ─────────────────────────────────────────────────────────────

function ParticipantRow({
  address, speaking, role,
}: {
  address: string;
  speaking: boolean;
  role: MyRole;
}) {
  return (
    <Box
      sx={{
        display: 'flex', alignItems: 'center', gap: 1,
        px: 1, py: 0.5, borderRadius: 1,
        bgcolor: alpha('#fff', 0.03),
      }}
    >
      <Box sx={{ position: 'relative' }}>
        <Avatar
          sx={{
            width: 30, height: 30,
            bgcolor: addrColor(address),
            fontSize: 11,
            outline: speaking ? '2px solid #22c55e' : '2px solid transparent',
            transition: 'outline-color 0.15s',
          }}
        >
          {address.slice(0, 2)}
        </Avatar>
        {speaking && (
          <Box sx={{
            position: 'absolute', bottom: -1, right: -1,
            width: 10, height: 10, borderRadius: '50%',
            bgcolor: '#22c55e', border: '2px solid #1a1b1e',
          }} />
        )}
      </Box>

      <Typography variant="caption" sx={{ flex: 1, fontSize: 11, color: alpha('#fff', 0.8) }}>
        {shortAddr(address)}
      </Typography>

      {role !== 'participant' && (
        <Chip
          label={ROLE_LABELS[role]}
          size="small"
          icon={<HubRoundedIcon />}
          sx={{
            height: 16, fontSize: 8, fontWeight: 700,
            bgcolor: alpha(ROLE_COLORS[role], 0.2),
            color: ROLE_COLORS[role],
            '& .MuiChip-icon': { fontSize: 10, color: ROLE_COLORS[role] },
          }}
        />
      )}

      {speaking && (
        <RecordVoiceOverRoundedIcon sx={{ fontSize: 12, color: '#22c55e' }} />
      )}
    </Box>
  );
}

// ── GroupAgentDashboard ────────────────────────────────────────────────────────

export function GroupAgentDashboard() {
  const [isOpen, setIsOpen] = useAtom(groupChatOpenAtom);
  const userInfo = useAtomValue(userInfoAtom);

  const { messages, sendMessage, isSending } = useSupportChat();

  const {
    roomState, participants, myRole, activeSpeakers, topologyLabel,
    joinGroupCall, leaveGroupCall, setMuted: setCallMuted,
  } = useGroupVoiceCall();

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

  const inCall = roomState === 'connected' || roomState === 'joining';
  const isForwarder = myRole !== 'participant';

  if (!isOpen) {
    return (
      <Tooltip title="Group Call Dashboard" placement="left">
        <Box
          onClick={() => setIsOpen(true)}
          sx={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 1400,
            width: 52, height: 52, borderRadius: '50%',
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: inCall ? '0 0 0 4px rgba(99,102,241,0.35), 0 4px 20px rgba(99,102,241,0.5)'
                               : '0 4px 20px rgba(99,102,241,0.5)',
            transition: 'box-shadow 0.3s',
          }}
        >
          <Badge
            badgeContent={inCall ? participants.length : 0}
            color="success"
            sx={{ '& .MuiBadge-badge': { fontSize: 9 } }}
          >
            <Groups2RoundedIcon fontSize="medium" />
          </Badge>
        </Box>
      </Tooltip>
    );
  }

  return (
    <Paper
      elevation={12}
      sx={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 1400,
        width: 400, height: inCall ? 620 : 500, borderRadius: 3,
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
          Group Call — Agent
        </Typography>

        {inCall && (
          <Chip
            label={topologyLabel}
            size="small"
            sx={{ height: 18, fontSize: 9, fontWeight: 700, bgcolor: alpha('#fff', 0.2), color: '#fff' }}
          />
        )}

        {isForwarder && (
          <Chip
            icon={<HubRoundedIcon />}
            label={ROLE_LABELS[myRole]}
            size="small"
            sx={{
              height: 18, fontSize: 9, fontWeight: 700,
              bgcolor: alpha(ROLE_COLORS[myRole], 0.25),
              color: ROLE_COLORS[myRole],
              '& .MuiChip-icon': { fontSize: 10, color: ROLE_COLORS[myRole] },
            }}
          />
        )}

        <IconButton size="small" sx={{ color: '#fff' }} onClick={() => setIsOpen(false)}>
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Call controls */}
      <Box
        sx={{
          px: 2, py: 1,
          bgcolor: alpha(inCall ? '#6366f1' : '#fff', 0.06),
          borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        {inCall ? (
          <>
            {/* Participant list */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1, maxHeight: 160, overflowY: 'auto' }}>
              {participants.map((p) => (
                <ParticipantRow
                  key={p.address}
                  address={p.address}
                  speaking={p.speaking}
                  role={p.role}
                />
              ))}
            </Box>

            {/* Active speakers */}
            {activeSpeakers.length > 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.75 }}>
                <RecordVoiceOverRoundedIcon sx={{ fontSize: 12, color: '#22c55e' }} />
                <Typography variant="caption" sx={{ fontSize: 10, color: '#22c55e' }}>
                  Speaking: {activeSpeakers.map((a) => shortAddr(a)).join(', ')}
                </Typography>
              </Box>
            )}

            {/* Controls */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
                  sx={{ color: '#ef4444', bgcolor: alpha('#ef4444', 0.12), width: 28, height: 28 }}
                >
                  <CallEndRoundedIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>

              <Typography variant="caption" sx={{ ml: 'auto', fontSize: 10, color: alpha('#fff', 0.5) }}>
                {participants.length} participant{participants.length !== 1 ? 's' : ''}
              </Typography>
            </Box>
          </>
        ) : (
          <Box
            onClick={handleJoinCall}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1.5,
              cursor: 'pointer', py: 1, px: 1.5, borderRadius: 1.5,
              bgcolor: alpha('#6366f1', 0.12),
              '&:hover': { bgcolor: alpha('#6366f1', 0.22) },
              transition: 'background 0.15s',
            }}
          >
            {roomState === 'joining'
              ? <CircularProgress size={16} sx={{ color: '#6366f1' }} />
              : <Groups2RoundedIcon sx={{ fontSize: 18, color: '#6366f1' }} />
            }
            <Box>
              <Typography variant="body2" fontWeight={600} sx={{ color: '#6366f1', fontSize: 13 }}>
                {roomState === 'joining' ? 'Joining group call…' : 'Join Group Call'}
              </Typography>
              <Typography variant="caption" sx={{ color: alpha('#fff', 0.4), fontSize: 10 }}>
                Tap to enter the support room
              </Typography>
            </Box>
          </Box>
        )}
      </Box>

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
                  <Typography variant="caption" sx={{ pl: 0.5, color: addrColor(msg.authorAddress), fontWeight: 600, fontSize: 10 }}>
                    {shortAddr(msg.authorAddress)}
                  </Typography>
                )}
                <Box
                  sx={{
                    px: 1.5, py: 0.75, borderRadius: 2,
                    bgcolor: isMe ? '#6366f1' : alpha('#fff', 0.06),
                    maxWidth: 260, wordBreak: 'break-word',
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
          placeholder="Reply to group…"
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
          sx={{ color: '#6366f1', '&:disabled': { color: alpha('#6366f1', 0.3) } }}
        >
          {isSending ? <CircularProgress size={16} /> : <SendRoundedIcon fontSize="small" />}
        </IconButton>
      </Box>
    </Paper>
  );
}
