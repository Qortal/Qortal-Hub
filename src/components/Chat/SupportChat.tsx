/**
 * SupportChat — a persistent test chat window rendered as a fixed bottom-right
 * panel.  Three participants: two fixed support agents and the authenticated
 * user.  Uses the Hub P2P chat protocol directly.
 *
 * Supports: send, edit, delete, reactions, replies.
 *
 * chatId: "group:9999"  (hard-coded for this test window)
 * Support agents: QP9Jj4S3jpCgvPnaABMx8VWzND3qpji6rP
 *                 QWxEcmZxnM8yb1p92C1YKKRsp8svSVbFEs
 */

import {
  useCallback,
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
  Popover,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded';
import EmojiEmotionsRoundedIcon from '@mui/icons-material/EmojiEmotionsRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { userInfoAtom } from '../../atoms/global';
import { useP2PChat } from '../../hooks/useP2PChat';
import { useIsOnline } from '../../hooks/usePresence';

// ── Constants ─────────────────────────────────────────────────────────────────

const SUPPORT_CHAT_ID = 'group:9999';

const SUPPORT_ADDRESSES = [
  'QP9Jj4S3jpCgvPnaABMx8VWzND3qpji6rP',
  'QWxEcmZxnM8yb1p92C1YKKRsp8svSVbFEs',
] as const;

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

// ── Small helpers ─────────────────────────────────────────────────────────────

function shortAddr(addr: string): string {
  if (!addr || addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function addrColor(addr: string): string {
  let h = 0;
  for (let i = 0; i < addr.length; i++) {
    h = (h * 31 + addr.charCodeAt(i)) & 0xffff;
  }
  return `hsl(${h % 360}, 55%, 45%)`;
}

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

// ── ReplyQuoteBar ─────────────────────────────────────────────────────────────

function ReplyQuoteBar({
  parentId,
  findMessage,
  isMine,
}: {
  parentId: string;
  findMessage: (id: string) => RenderedMessage | undefined;
  isMine: boolean;
}) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const parent = findMessage(parentId);
  const authorColor = parent ? addrColor(parent.authorAddress) : '#78909c';
  const preview = parent
    ? parent.isDeleted
      ? 'Message deleted'
      : parent.content.length > 80
      ? `${parent.content.slice(0, 80)}…`
      : parent.content
    : '(message not found)';

  return (
    <Box
      sx={{
        mb: 0.6,
        px: 1,
        py: 0.4,
        borderRadius: 1,
        borderLeft: `3px solid ${authorColor}`,
        backgroundColor: isMine
          ? 'rgba(0,0,0,0.18)'
          : isDark
          ? 'rgba(255,255,255,0.08)'
          : 'rgba(0,0,0,0.07)',
        maxWidth: '100%',
      }}
    >
      {parent && (
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            color: authorColor,
            fontWeight: 600,
            lineHeight: 1.3,
          }}
        >
          {shortAddr(parent.authorAddress)}
        </Typography>
      )}
      <Typography
        variant="caption"
        sx={{
          display: 'block',
          opacity: 0.75,
          lineHeight: 1.3,
          fontStyle: parent?.isDeleted ? 'italic' : 'normal',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {preview}
      </Typography>
    </Box>
  );
}

// ── ReactionChips ─────────────────────────────────────────────────────────────

function ReactionChips({
  reactions,
  targetId,
  myAddress,
  onReaction,
}: {
  reactions: Record<string, string[]>;
  targetId: string;
  myAddress: string;
  onReaction: (targetId: string, emoji: string) => void;
}) {
  const entries = Object.entries(reactions);
  if (entries.length === 0) return null;

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4, mt: 0.5 }}>
      {entries.map(([emoji, addresses]) => {
        const iReacted = addresses.includes(myAddress);
        return (
          <Tooltip
            key={emoji}
            title={
              addresses.length <= 3
                ? addresses.map(shortAddr).join(', ')
                : `${addresses.slice(0, 3).map(shortAddr).join(', ')} +${addresses.length - 3}`
            }
            placement="top"
          >
            <Box
              onClick={() => onReaction(targetId, emoji)}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.3,
                px: 0.7,
                py: 0.2,
                borderRadius: 3,
                cursor: 'pointer',
                userSelect: 'none',
                border: '1px solid',
                borderColor: iReacted ? 'primary.main' : 'rgba(128,128,128,0.35)',
                backgroundColor: iReacted
                  ? 'primary.main'
                  : 'transparent',
                color: iReacted ? 'primary.contrastText' : 'text.primary',
                transition: 'opacity 0.15s',
                '&:hover': { opacity: 0.8 },
              }}
            >
              <span style={{ fontSize: 13, lineHeight: 1 }}>{emoji}</span>
              <Typography component="span" sx={{ fontSize: 11, lineHeight: 1 }}>
                {addresses.length}
              </Typography>
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}

// ── EmojiPicker ───────────────────────────────────────────────────────────────

function EmojiPicker({
  anchor,
  onClose,
  onPick,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  onPick: (emoji: string) => void;
}) {
  return (
    <Popover
      open={Boolean(anchor)}
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      PaperProps={{ sx: { p: 0.5, borderRadius: 2 } }}
    >
      <Box sx={{ display: 'flex', gap: 0.25 }}>
        {QUICK_REACTIONS.map((emoji) => (
          <Box
            key={emoji}
            onClick={() => {
              onPick(emoji);
              onClose();
            }}
            sx={{
              cursor: 'pointer',
              fontSize: 20,
              p: 0.5,
              borderRadius: 1,
              lineHeight: 1,
              userSelect: 'none',
              '&:hover': { backgroundColor: 'action.hover' },
            }}
          >
            {emoji}
          </Box>
        ))}
      </Box>
    </Popover>
  );
}

// ── MessageBubble ─────────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  isMine,
  findMessage,
  myAddress,
  onReply,
  onEdit,
  onDelete,
  onReaction,
}: {
  msg: RenderedMessage;
  isMine: boolean;
  findMessage: (id: string) => RenderedMessage | undefined;
  myAddress: string;
  onReply: (msg: RenderedMessage) => void;
  onEdit: (msg: RenderedMessage) => void;
  onDelete: (id: string) => void;
  onReaction: (targetId: string, emoji: string) => void;
}) {
  const theme = useTheme();
  const color = addrColor(msg.authorAddress);
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);

  const actionBar = (
    <Box
      className="chat-actions"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.25,
        opacity: 0,
        transition: 'opacity 0.15s',
        mx: 0.25,
        flexShrink: 0,
      }}
    >
      <Tooltip title="Reply" placement={isMine ? 'left' : 'right'}>
        <IconButton size="small" sx={{ p: 0.35 }} onClick={() => onReply(msg)}>
          <ReplyRoundedIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="React" placement={isMine ? 'left' : 'right'}>
        <IconButton
          size="small"
          sx={{ p: 0.35 }}
          onClick={(e) => setEmojiAnchor(e.currentTarget)}
        >
          <EmojiEmotionsRoundedIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
      {isMine && !msg.isDeleted && (
        <>
          <Tooltip title="Edit" placement="left">
            <IconButton
              size="small"
              sx={{ p: 0.35 }}
              onClick={() => onEdit(msg)}
            >
              <EditRoundedIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete" placement="left">
            <IconButton
              size="small"
              sx={{ p: 0.35, color: 'error.main' }}
              onClick={() => onDelete(msg.id)}
            >
              <DeleteRoundedIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        </>
      )}
    </Box>
  );

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-end',
        flexDirection: isMine ? 'row-reverse' : 'row',
        mb: 0.75,
        px: 1,
        '&:hover .chat-actions': { opacity: 1 },
      }}
    >
      {/* Hover actions — left of bubble for own messages, right for others */}
      {actionBar}

      {/* Bubble column */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: isMine ? 'flex-end' : 'flex-start',
          maxWidth: '80%',
          minWidth: 0,
        }}
      >
        {/* Sender label for others */}
        {!isMine && (
          <Typography
            variant="caption"
            sx={{
              fontFamily: 'monospace',
              color,
              mb: 0.25,
              ml: 0.5,
              opacity: 0.9,
            }}
          >
            {shortAddr(msg.authorAddress)}
          </Typography>
        )}

        {/* Bubble */}
        <Box
          sx={{
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
            maxWidth: '100%',
          }}
        >
          {/* Reply quote */}
          {msg.replyTo && (
            <ReplyQuoteBar
              parentId={msg.replyTo}
              findMessage={findMessage}
              isMine={isMine}
            />
          )}

          {/* Content */}
          {msg.isDeleted ? (
            <Typography
              variant="body2"
              sx={{ lineHeight: 1.45, fontStyle: 'italic', opacity: 0.5 }}
            >
              Message deleted
            </Typography>
          ) : (
            <Typography variant="body2" sx={{ lineHeight: 1.45 }}>
              {msg.content}
            </Typography>
          )}
        </Box>

        {/* Reactions row */}
        <Box sx={{ px: 0.5 }}>
          <ReactionChips
            reactions={msg.reactions}
            targetId={msg.id}
            myAddress={myAddress}
            onReaction={onReaction}
          />
        </Box>

        {/* Timestamp + edited badge */}
        <Box
          sx={{
            display: 'flex',
            gap: 0.5,
            mt: 0.2,
            mx: 0.5,
            alignItems: 'center',
          }}
        >
          <Typography variant="caption" sx={{ opacity: 0.4, fontSize: 10 }}>
            {fmtTime(msg.timestamp)}
          </Typography>
          {msg.isEdited && (
            <Typography
              variant="caption"
              sx={{ opacity: 0.35, fontSize: 10, fontStyle: 'italic' }}
            >
              edited
            </Typography>
          )}
        </Box>
      </Box>

      {/* Emoji picker popover (per-bubble) */}
      <EmojiPicker
        anchor={emojiAnchor}
        onClose={() => setEmojiAnchor(null)}
        onPick={(emoji) => onReaction(msg.id, emoji)}
      />
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

  const {
    messages,
    isSending,
    typingUsers,
    isReady,
    sendMessage,
    sendEdit,
    sendDelete,
    sendReaction,
    sendReply,
    notifyTyping,
  } = useP2PChat(SUPPORT_CHAT_ID);

  const [inputText, setInputText] = useState('');
  const [replyTarget, setReplyTarget] = useState<RenderedMessage | null>(null);
  const [editTarget, setEditTarget] = useState<RenderedMessage | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const theme = useTheme();

  const participants = useMemo(() => {
    const all = new Set<string>([...SUPPORT_ADDRESSES]);
    if (myAddress) all.add(myAddress);
    return Array.from(all);
  }, [myAddress]);

  // O(1) lookup for reply quote rendering.
  const messageMap = useMemo(
    () => new Map(messages.map((m) => [m.id, m])),
    [messages]
  );
  const findMessage = useCallback(
    (id: string) => messageMap.get(id),
    [messageMap]
  );

  useLayoutEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingUsers]);

  // ── Compose mode helpers ────────────────────────────────────────────────────

  const handleStartReply = useCallback((msg: RenderedMessage) => {
    setReplyTarget(msg);
    setEditTarget(null);
    setInputText('');
    // Defer focus so the banner renders first.
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleStartEdit = useCallback((msg: RenderedMessage) => {
    setEditTarget(msg);
    setReplyTarget(null);
    setInputText(msg.content);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleCancelCompose = useCallback(() => {
    setReplyTarget(null);
    setEditTarget(null);
    setInputText('');
  }, []);

  // ── Send ────────────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isSending) return;

    // Capture and clear compose state before the async call so the UI resets immediately.
    const et = editTarget;
    const rt = replyTarget;
    setInputText('');
    setEditTarget(null);
    setReplyTarget(null);

    if (et) {
      await sendEdit(et.id, text);
    } else if (rt) {
      await sendReply(rt.id, text);
    } else {
      await sendMessage(text);
    }
  }, [
    inputText,
    isSending,
    editTarget,
    replyTarget,
    sendMessage,
    sendEdit,
    sendReply,
  ]);

  const handleDelete = useCallback(
    async (targetId: string) => {
      await sendDelete(targetId);
    },
    [sendDelete]
  );

  const handleReaction = useCallback(
    async (targetId: string, emoji: string) => {
      await sendReaction(targetId, emoji);
    },
    [sendReaction]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      } else if (e.key === 'Escape') {
        handleCancelCompose();
      }
    },
    [handleSend, handleCancelCompose]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputText(e.target.value);
      notifyTyping();
    },
    [notifyTyping]
  );

  if (!myAddress) return null;

  const isDark = theme.palette.mode === 'dark';
  const bgColor = isDark ? '#1a1d23' : '#ffffff';
  const borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)';

  const inComposeMode = Boolean(replyTarget || editTarget);

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
          '&::-webkit-scrollbar': { width: 4 },
          '&::-webkit-scrollbar-thumb': {
            borderRadius: 4,
            backgroundColor: isDark
              ? 'rgba(255,255,255,0.15)'
              : 'rgba(0,0,0,0.15)',
          },
        }}
      >
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
            <Typography variant="body2">No messages yet. Say hello!</Typography>
          </Box>
        )}

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

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            isMine={msg.authorAddress === myAddress}
            findMessage={findMessage}
            myAddress={myAddress}
            onReply={handleStartReply}
            onEdit={handleStartEdit}
            onDelete={handleDelete}
            onReaction={handleReaction}
          />
        ))}

        <TypingRow addresses={typingUsers} />

        <div ref={messagesEndRef} />
      </Box>

      {/* ── Compose banner (reply / edit mode) ──────────────────────────── */}
      {inComposeMode && (
        <Box
          sx={{
            px: 1.5,
            pt: 0.75,
            pb: 0.5,
            borderTop: `1px solid ${borderColor}`,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flexShrink: 0,
          }}
        >
          <Box
            sx={{
              flex: 1,
              borderLeft: '3px solid',
              borderColor: editTarget ? 'warning.main' : 'primary.main',
              pl: 1,
              minWidth: 0,
            }}
          >
            <Typography
              variant="caption"
              sx={{ fontWeight: 600, display: 'block', lineHeight: 1.4 }}
            >
              {editTarget
                ? 'Editing message'
                : `Replying to ${shortAddr(replyTarget!.authorAddress)}`}
            </Typography>
            {replyTarget && (
              <Typography
                variant="caption"
                sx={{
                  opacity: 0.65,
                  display: 'block',
                  lineHeight: 1.3,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {replyTarget.content.length > 60
                  ? `${replyTarget.content.slice(0, 60)}…`
                  : replyTarget.content}
              </Typography>
            )}
          </Box>
          <Tooltip title="Cancel (Esc)">
            <IconButton
              size="small"
              onClick={handleCancelCompose}
              sx={{ opacity: 0.6, flexShrink: 0 }}
            >
              <CloseRoundedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      {/* ── Input row ───────────────────────────────────────────────────── */}
      <Box
        sx={{
          px: 1.5,
          py: 1,
          borderTop: inComposeMode ? 'none' : `1px solid ${borderColor}`,
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
          placeholder={
            !isReady
              ? 'Connecting…'
              : editTarget
              ? 'Edit message…'
              : replyTarget
              ? `Reply to ${shortAddr(replyTarget.authorAddress)}…`
              : 'Type a message…'
          }
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
            border: `1px solid ${editTarget ? theme.palette.warning.main : borderColor}`,
            '& .MuiInputBase-input': { resize: 'none' },
          }}
        />

        <IconButton
          size="small"
          onClick={handleSend}
          disabled={!isReady || !inputText.trim() || isSending || !window.chat}
          color={editTarget ? 'warning' : 'primary'}
          sx={{ mb: 0.25, '&:disabled': { opacity: 0.35 } }}
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
