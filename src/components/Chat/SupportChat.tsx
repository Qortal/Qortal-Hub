/**
 * SupportChat — a persistent test chat window rendered as a fixed bottom-right
 * panel.  Three participants: two fixed support agents and the authenticated
 * user.  Uses the Hub P2P chat protocol directly.
 *
 * chatId: "group:9999"  (hard-coded for this test window)
 * Support agents: QP9Jj4S3jpCgvPnaABMx8VWzND3qpji6rP
 *                 QWxEcmZxnM8yb1p92C1YKKRsp8svSVbFEs
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAtomValue } from 'jotai';
import {
  Avatar,
  Box,
  CircularProgress,
  IconButton,
  InputBase,
  Paper,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import { userInfoAtom } from '../../atoms/global';
import { useP2PChat } from '../../hooks/useP2PChat';
import { useIsOnline } from '../../hooks/usePresence';

// ── Constants ─────────────────────────────────────────────────────────────────

/** The stable chat channel for this support window. */
const SUPPORT_CHAT_ID = 'group:9999';

/** Fixed support-agent addresses. */
const SUPPORT_ADDRESSES = [
  'QP9Jj4S3jpCgvPnaABMx8VWzND3qpji6rP',
  'QWxEcmZxnM8yb1p92C1YKKRsp8svSVbFEs',
] as const;

// ── Small helpers ─────────────────────────────────────────────────────────────

/** Returns the first 6 and last 4 chars of an address, e.g. "QP9Jj4…6rP" */
function shortAddr(addr: string): string {
  if (!addr || addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Deterministic HSL colour from an address string (for avatars). */
function addrColor(addr: string): string {
  let h = 0;
  for (let i = 0; i < addr.length; i++) {
    h = (h * 31 + addr.charCodeAt(i)) & 0xffff;
  }
  return `hsl(${h % 360}, 55%, 45%)`;
}

/** Format a timestamp as HH:MM. */
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── ParticipantChip ───────────────────────────────────────────────────────────

function ParticipantChip({
  address,
  isSelf,
}: {
  address: string;
  isSelf: boolean;
}) {
  const online = useIsOnline(address);
  const theme = useTheme();
  const color = addrColor(address);

  return (
    <Tooltip title={address} placement="top" arrow>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1,
          py: 0.25,
          borderRadius: 3,
          backgroundColor:
            theme.palette.mode === 'dark'
              ? 'rgba(255,255,255,0.06)'
              : 'rgba(0,0,0,0.05)',
          cursor: 'default',
          userSelect: 'none',
        }}
      >
        {/* Online / offline dot */}
        <Box
          sx={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: online ? '#44b700' : '#78909c',
            flexShrink: 0,
          }}
        />
        <Avatar
          sx={{
            width: 16,
            height: 16,
            fontSize: 9,
            backgroundColor: color,
            flexShrink: 0,
          }}
        >
          {address[0]}
        </Avatar>
        <Typography
          variant="caption"
          sx={{ lineHeight: 1, opacity: 0.85, fontFamily: 'monospace' }}
        >
          {isSelf ? `${shortAddr(address)} (you)` : shortAddr(address)}
        </Typography>
      </Box>
    </Tooltip>
  );
}

// ── MessageBubble ─────────────────────────────────────────────────────────────

function MessageBubble({
  event,
  isMine,
}: {
  event: P2PChatEvent;
  isMine: boolean;
}) {
  const theme = useTheme();
  const color = addrColor(event.authorAddress);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isMine ? 'flex-end' : 'flex-start',
        mb: 0.75,
        px: 1.5,
      }}
    >
      {/* Sender label — only shown for others */}
      {!isMine && (
        <Typography
          variant="caption"
          sx={{
            fontFamily: 'monospace',
            color: color,
            mb: 0.25,
            ml: 0.5,
            opacity: 0.9,
          }}
        >
          {shortAddr(event.authorAddress)}
        </Typography>
      )}

      <Box
        sx={{
          maxWidth: '82%',
          px: 1.5,
          py: 0.75,
          borderRadius: isMine
            ? '14px 14px 4px 14px'
            : '14px 14px 14px 4px',
          backgroundColor: isMine
            ? theme.palette.primary.main
            : theme.palette.mode === 'dark'
            ? 'rgba(255,255,255,0.1)'
            : 'rgba(0,0,0,0.07)',
          color: isMine
            ? theme.palette.primary.contrastText
            : theme.palette.text.primary,
          wordBreak: 'break-word',
        }}
      >
        <Typography variant="body2" sx={{ lineHeight: 1.45 }}>
          {event.content}
        </Typography>
      </Box>

      <Typography
        variant="caption"
        sx={{ opacity: 0.4, mt: 0.25, mx: 0.5, fontSize: 10 }}
      >
        {fmtTime(event.timestamp)}
      </Typography>
    </Box>
  );
}

// ── TypingRow ─────────────────────────────────────────────────────────────────

function TypingRow({ addresses }: { addresses: Set<string> }) {
  if (addresses.size === 0) return null;
  const list = Array.from(addresses).map(shortAddr).join(', ');
  return (
    <Typography
      variant="caption"
      sx={{
        px: 2,
        pb: 0.5,
        opacity: 0.5,
        fontStyle: 'italic',
        display: 'block',
      }}
    >
      {list} {addresses.size === 1 ? 'is' : 'are'} typing…
    </Typography>
  );
}

// ── SupportChat ───────────────────────────────────────────────────────────────

export function SupportChat() {
  const userInfo = useAtomValue(userInfoAtom);
  const myAddress: string = userInfo?.address ?? '';

  const { messages, isSending, typingUsers, isReady, sendMessage, notifyTyping } =
    useP2PChat(SUPPORT_CHAT_ID);

  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const theme = useTheme();

  // Collect all participants.
  const participants = useMemo(() => {
    const all = new Set<string>([...SUPPORT_ADDRESSES]);
    if (myAddress) all.add(myAddress);
    return Array.from(all);
  }, [myAddress]);

  // Auto-scroll to the bottom when new messages arrive.
  useLayoutEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingUsers]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isSending) return;
    setInputText('');
    await sendMessage(text);
  }, [inputText, isSending, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputText(e.target.value);
      notifyTyping();
    },
    [notifyTyping]
  );

  // Don't render until the user is authenticated.
  if (!myAddress) return null;

  const isDark = theme.palette.mode === 'dark';
  const bgColor = isDark ? '#1a1d23' : '#ffffff';
  const borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)';

  return (
    <Paper
      elevation={8}
      sx={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 380,
        height: 520,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 2.5,
        overflow: 'hidden',
        border: `1px solid ${borderColor}`,
        backgroundColor: bgColor,
        zIndex: 1300,
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <Box
        sx={{
          px: 2,
          pt: 1.5,
          pb: 1,
          borderBottom: `1px solid ${borderColor}`,
          flexShrink: 0,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.75 }}>
          <Typography
            variant="subtitle2"
            sx={{ fontWeight: 700, flex: 1, letterSpacing: 0.3 }}
          >
            Support Chat
          </Typography>

          {/* Connection / ready indicator */}
          <Tooltip
            title={
              !window.chat
                ? 'P2P not available'
                : isReady
                ? 'Connected'
                : 'Connecting…'
            }
          >
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: !window.chat
                  ? '#ef4444'
                  : isReady
                  ? '#44b700'
                  : '#f59e0b',
                ml: 1,
              }}
            />
          </Tooltip>
        </Box>

        {/* Participant chips */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {participants.map((addr) => (
            <ParticipantChip
              key={addr}
              address={addr}
              isSelf={addr === myAddress}
            />
          ))}
        </Box>
      </Box>

      {/* ── Message list ────────────────────────────────────────────────── */}
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          pt: 1,
          pb: 0.5,
          // Subtle scrollbar
          '&::-webkit-scrollbar': { width: 4 },
          '&::-webkit-scrollbar-thumb': {
            borderRadius: 4,
            backgroundColor: isDark
              ? 'rgba(255,255,255,0.15)'
              : 'rgba(0,0,0,0.15)',
          },
        }}
      >
        {/* Empty state */}
        {messages.length === 0 && isReady && (
          <Box
            sx={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: 0.35,
              gap: 1,
              px: 3,
              textAlign: 'center',
            }}
          >
            <Typography variant="body2">
              No messages yet. Say hello!
            </Typography>
          </Box>
        )}

        {/* Loading state */}
        {!isReady && window.chat && (
          <Box
            sx={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: 0.4,
            }}
          >
            <CircularProgress size={20} />
          </Box>
        )}

        {/* P2P unavailable */}
        {!window.chat && (
          <Box
            sx={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              px: 3,
              textAlign: 'center',
              opacity: 0.45,
            }}
          >
            <Typography variant="caption">
              P2P network is not running. Enable it in Settings to use chat.
            </Typography>
          </Box>
        )}

        {/* Messages */}
        {messages.map((ev) => (
          <MessageBubble
            key={ev.id}
            event={ev}
            isMine={ev.authorAddress === myAddress}
          />
        ))}

        {/* Typing indicator */}
        <TypingRow addresses={typingUsers} />

        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </Box>

      {/* ── Input row ───────────────────────────────────────────────────── */}
      <Box
        sx={{
          px: 1.5,
          py: 1,
          borderTop: `1px solid ${borderColor}`,
          display: 'flex',
          alignItems: 'flex-end',
          gap: 0.5,
          flexShrink: 0,
        }}
      >
        <InputBase
          inputRef={inputRef}
          multiline
          maxRows={4}
          placeholder={isReady ? 'Type a message…' : 'Connecting…'}
          disabled={!isReady || !window.chat}
          value={inputText}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          sx={{
            flex: 1,
            fontSize: 14,
            px: 1.5,
            py: 0.75,
            borderRadius: 2,
            backgroundColor: isDark
              ? 'rgba(255,255,255,0.06)'
              : 'rgba(0,0,0,0.04)',
            border: `1px solid ${borderColor}`,
            '& .MuiInputBase-input': {
              resize: 'none',
            },
          }}
        />

        <IconButton
          size="small"
          onClick={handleSend}
          disabled={!isReady || !inputText.trim() || isSending || !window.chat}
          color="primary"
          sx={{
            mb: 0.25,
            '&:disabled': { opacity: 0.35 },
          }}
        >
          {isSending ? (
            <CircularProgress size={18} />
          ) : (
            <SendRoundedIcon fontSize="small" />
          )}
        </IconButton>
      </Box>
    </Paper>
  );
}
