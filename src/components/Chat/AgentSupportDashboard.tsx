/**
 * AgentSupportDashboard — two-column panel rendered for authenticated support agents.
 *
 * Left column  : list of open support tickets (one per user who knocked).
 * Right column : conversation for the selected ticket with full send / edit /
 *                delete / reaction / reply capability and a "Resolve" button.
 *
 * Replaces <SupportChat /> in App.tsx when the logged-in address is a member
 * of SUPPORT_ADDRESSES.  Regular users never see this component.
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
import { useMessageReadObserver } from '../../hooks/useMessageReadObserver';
import {
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
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import BlockRoundedIcon from '@mui/icons-material/BlockRounded';
import LockOpenRoundedIcon from '@mui/icons-material/LockOpenRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { userInfoAtom } from '../../atoms/global';
import {
  useAgentSupportChat,
  SupportTicket,
} from '../../hooks/useAgentSupportChat';
import { useIsOnline } from '../../hooks/usePresence';

// ── Constants ─────────────────────────────────────────────────────────────────

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

// ── TicketRow ─────────────────────────────────────────────────────────────────

function TicketRow({
  ticket,
  isActive,
  onClick,
}: {
  ticket: SupportTicket;
  isActive: boolean;
  onClick: () => void;
}) {
  const online = useIsOnline(ticket.userAddress);
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const color = addrColor(ticket.userAddress);

  return (
    <Box
      onClick={onClick}
      sx={{
        px: 1,
        py: 0.9,
        cursor: 'pointer',
        borderRadius: 1,
        mx: 0.5,
        mb: 0.25,
        backgroundColor: isActive
          ? isDark
            ? 'rgba(255,255,255,0.1)'
            : 'rgba(0,0,0,0.08)'
          : 'transparent',
        '&:hover': {
          backgroundColor: isDark
            ? 'rgba(255,255,255,0.07)'
            : 'rgba(0,0,0,0.05)',
        },
        transition: 'background-color 0.12s',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.2 }}>
        {/* Online dot */}
        <Box
          sx={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: online ? '#44b700' : '#78909c',
            flexShrink: 0,
          }}
        />
        <Typography
          variant="caption"
          sx={{
            fontFamily: 'monospace',
            color,
            fontWeight: 600,
            lineHeight: 1.2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {shortAddr(ticket.userAddress)}
        </Typography>
      </Box>
      {ticket.isResolved && (
        <Typography
          variant="caption"
          sx={{ fontSize: 9, opacity: 0.55, letterSpacing: 0.4 }}
        >
          RESOLVED
        </Typography>
      )}
    </Box>
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
          sx={{ display: 'block', color: authorColor, fontWeight: 600, lineHeight: 1.3 }}
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
                backgroundColor: iReacted ? 'primary.main' : 'transparent',
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
            onClick={() => { onPick(emoji); onClose(); }}
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
  readBy,
  ticketUserAddress,
  onReply,
  onEdit,
  onDelete,
  onReaction,
  register,
  unregister,
}: {
  msg: RenderedMessage;
  isMine: boolean;
  findMessage: (id: string) => RenderedMessage | undefined;
  myAddress: string;
  readBy: Set<string>;
  ticketUserAddress: string;
  onReply: (msg: RenderedMessage) => void;
  onEdit: (msg: RenderedMessage) => void;
  onDelete: (id: string) => void;
  onReaction: (targetId: string, emoji: string) => void;
  register: (msgId: string, el: HTMLElement) => void;
  unregister: (msgId: string, el: HTMLElement) => void;
}) {
  const theme = useTheme();
  const color = addrColor(msg.authorAddress);
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);

  // Intersection-based read: observe this element only for messages from others.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || isMine || msg.isDeleted) return;
    register(msg.id, el);
    return () => unregister(msg.id, el);
  }, [msg.id, isMine, msg.isDeleted, register, unregister]);

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
            <IconButton size="small" sx={{ p: 0.35 }} onClick={() => onEdit(msg)}>
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
      ref={rootRef}
      sx={{
      }}
    >
      {actionBar}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: isMine ? 'flex-end' : 'flex-start',
          maxWidth: '80%',
          minWidth: 0,
        }}
      >
        {!isMine && (
          <Typography
            variant="caption"
            sx={{ fontFamily: 'monospace', color, mb: 0.25, ml: 0.5, opacity: 0.9 }}
          >
            {shortAddr(msg.authorAddress)}
          </Typography>
        )}
        <Box
          sx={{
            px: 1.5,
            py: 0.75,
            borderRadius: isMine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
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
          {msg.replyTo && (
            <ReplyQuoteBar
              parentId={msg.replyTo}
              findMessage={findMessage}
              isMine={isMine}
            />
          )}
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
        <Box sx={{ px: 0.5 }}>
          <ReactionChips
            reactions={msg.reactions}
            targetId={msg.id}
            myAddress={myAddress}
            onReaction={onReaction}
          />
        </Box>
        <Box
          sx={{ display: 'flex', gap: 0.5, mt: 0.2, mx: 0.5, alignItems: 'center' }}
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
          {isMine && ticketUserAddress && readBy.has(ticketUserAddress) && (
            <Typography variant="caption" sx={{ opacity: 0.45, fontSize: 10 }}>
              Seen
            </Typography>
          )}
        </Box>
      </Box>
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

// ── AgentSupportDashboard ─────────────────────────────────────────────────────

export function AgentSupportDashboard() {
  const userInfo = useAtomValue(userInfoAtom);
  const myAddress: string = userInfo?.address ?? '';

  const {
    tickets,
    activeTicketChatId,
    setActiveTicket,
    messages,
    isReady,
    isSending,
    typingUsers,
    readReceipts,
    markMessagesRead,
    sendMessage,
    sendEdit,
    sendDelete,
    sendReaction,
    sendReply,
    notifyTyping,
    resolveTicket,
    blockedAddresses,
    blockUser,
    unblockUser,
  } = useAgentSupportChat();

  const activeTicket = tickets.find((t) => t.chatId === activeTicketChatId) ?? null;

  const [inputText, setInputText] = useState('');
  const [replyTarget, setReplyTarget] = useState<RenderedMessage | null>(null);
  const [editTarget, setEditTarget] = useState<RenderedMessage | null>(null);
  const [resolving, setResolving] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const theme = useTheme();

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

  // Intersection-based read receipts: mark messages as read only when they
  // actually enter the visible scroll area (true "eyes-on" confirmation).
  const { register: registerRead, unregister: unregisterRead } = useMessageReadObserver(
    myAddress,
    readReceipts,
    markMessagesRead,
    scrollContainerRef
  );

  // ── Compose helpers ───────────────────────────────────────────────────────

  const handleStartReply = useCallback((msg: RenderedMessage) => {
    setReplyTarget(msg);
    setEditTarget(null);
    setInputText('');
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

  // ── Send ──────────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isSending) return;

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
  }, [inputText, isSending, editTarget, replyTarget, sendMessage, sendEdit, sendReply]);

  const handleDelete = useCallback(
    async (targetId: string) => { await sendDelete(targetId); },
    [sendDelete]
  );

  const handleReaction = useCallback(
    async (targetId: string, emoji: string) => { await sendReaction(targetId, emoji); },
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

  const handleResolve = useCallback(async () => {
    if (!activeTicket || resolving) return;
    setResolving(true);
    try {
      await resolveTicket();
    } finally {
      setResolving(false);
    }
  }, [activeTicket, resolving, resolveTicket]);

  const handleBlock = useCallback(async () => {
    if (!activeTicket || blocking) return;
    setBlocking(true);
    try {
      await blockUser(activeTicket.userAddress);
    } finally {
      setBlocking(false);
    }
  }, [activeTicket, blocking, blockUser]);

  // Reset compose state when switching tickets.
  const handleSelectTicket = useCallback(
    (chatId: string) => {
      setActiveTicket(chatId);
      setInputText('');
      setReplyTarget(null);
      setEditTarget(null);
    },
    [setActiveTicket]
  );

  if (!myAddress) return null;

  const isDark = theme.palette.mode === 'dark';
  const bgColor = isDark ? '#1a1d23' : '#ffffff';
  const borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
  const inComposeMode = Boolean(replyTarget || editTarget);
  const hasActiveTicket = Boolean(activeTicket);

  return (
    <Paper
      elevation={8}
      sx={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 520,
        height: 520,
        display: 'flex',
        flexDirection: 'row',
        borderRadius: 2.5,
        overflow: 'hidden',
        border: `1px solid ${borderColor}`,
        backgroundColor: bgColor,
        zIndex: 1300,
      }}
    >
      {/* ── Left: ticket list ──────────────────────────────────────────────── */}
      <Box
        sx={{
          width: 140,
          flexShrink: 0,
          borderRight: `1px solid ${dividerColor}`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Ticket list header */}
        <Box
          sx={{
            px: 1.5,
            pt: 1.5,
            pb: 1,
            borderBottom: `1px solid ${dividerColor}`,
            flexShrink: 0,
          }}
        >
          <Typography variant="caption" sx={{ fontWeight: 700, opacity: 0.7, letterSpacing: 0.4 }}>
            QUEUE
          </Typography>
          {tickets.filter((t) => !t.isBlocked).length > 0 && (
            <Typography
              variant="caption"
              sx={{
                ml: 0.75,
                px: 0.6,
                py: 0.1,
                borderRadius: 1,
                backgroundColor: 'primary.main',
                color: 'primary.contrastText',
                fontSize: 10,
                fontWeight: 700,
                lineHeight: 1.6,
              }}
            >
              {tickets.filter((t) => !t.isBlocked && !t.isResolved).length}
            </Typography>
          )}
        </Box>

        {/* Ticket rows */}
        <Box sx={{ flex: 1, overflowY: 'auto', pt: 0.5 }}>
          {tickets.filter((t) => !t.isBlocked).length === 0 && (
            <Typography
              variant="caption"
              sx={{ display: 'block', px: 1.5, pt: 1.5, opacity: 0.35, textAlign: 'center' }}
            >
              No requests yet
            </Typography>
          )}
          {tickets.filter((t) => !t.isBlocked).map((ticket) => (
            <TicketRow
              key={ticket.chatId}
              ticket={ticket}
              isActive={ticket.chatId === activeTicketChatId}
              onClick={() => handleSelectTicket(ticket.chatId)}
            />
          ))}
        </Box>

        {/* Blocked users section */}
        {blockedAddresses.size > 0 && (
          <Box sx={{ flexShrink: 0, borderTop: `1px solid ${dividerColor}` }}>
            <Box
              onClick={() => setShowBlocked((v) => !v)}
              sx={{
                px: 1.5,
                py: 0.75,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                '&:hover': { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' },
              }}
            >
              <Typography
                variant="caption"
                sx={{ fontWeight: 700, opacity: 0.55, letterSpacing: 0.4, fontSize: 9, flex: 1 }}
              >
                BLOCKED ({blockedAddresses.size})
              </Typography>
              <ExpandMoreRoundedIcon
                sx={{
                  fontSize: 14,
                  opacity: 0.45,
                  transform: showBlocked ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.15s',
                }}
              />
            </Box>
            {showBlocked && (
              <Box sx={{ maxHeight: 120, overflowY: 'auto', pb: 0.5 }}>
                {[...blockedAddresses].map((addr) => (
                  <Box
                    key={addr}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      px: 1,
                      py: 0.4,
                      gap: 0.5,
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        fontFamily: 'monospace',
                        flex: 1,
                        opacity: 0.5,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 10,
                      }}
                    >
                      {shortAddr(addr)}
                    </Typography>
                    <Tooltip title="Unblock">
                      <IconButton
                        size="small"
                        onClick={() => unblockUser(addr)}
                        sx={{ p: 0.25, color: 'text.secondary', flexShrink: 0 }}
                      >
                        <LockOpenRoundedIcon sx={{ fontSize: 12 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        )}
      </Box>

      {/* ── Right: conversation ────────────────────────────────────────────── */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Conversation header */}
        <Box
          sx={{
            px: 1.5,
            pt: 1.5,
            pb: 1,
            borderBottom: `1px solid ${borderColor}`,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, letterSpacing: 0.3 }}>
              Support Agents
            </Typography>
            {activeTicket && (
              <Typography
                variant="caption"
                sx={{
                  fontFamily: 'monospace',
                  opacity: 0.6,
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {activeTicket.userAddress}
              </Typography>
            )}
          </Box>

          {/* Connection dot */}
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
                flexShrink: 0,
              }}
            />
          </Tooltip>

          {/* Resolve button */}
          {hasActiveTicket && !activeTicket?.isResolved && (
            <Tooltip title="Resolve this ticket">
              <IconButton
                size="small"
                onClick={handleResolve}
                disabled={resolving}
                sx={{ color: 'success.main', p: 0.5, flexShrink: 0 }}
              >
                {resolving ? (
                  <CircularProgress size={14} color="inherit" />
                ) : (
                  <CheckCircleOutlineRoundedIcon sx={{ fontSize: 18 }} />
                )}
              </IconButton>
            </Tooltip>
          )}

          {/* Block button */}
          {hasActiveTicket && (
            <Tooltip title="Block this user">
              <IconButton
                size="small"
                onClick={handleBlock}
                disabled={blocking}
                sx={{ color: 'error.main', p: 0.5, flexShrink: 0 }}
              >
                {blocking ? (
                  <CircularProgress size={14} color="inherit" />
                ) : (
                  <BlockRoundedIcon sx={{ fontSize: 18 }} />
                )}
              </IconButton>
            </Tooltip>
          )}

          {activeTicket?.isResolved && (
            <Typography
              variant="caption"
              sx={{
                px: 0.75,
                py: 0.2,
                borderRadius: 1,
                backgroundColor: 'success.main',
                color: 'success.contrastText',
                fontWeight: 600,
                fontSize: 10,
                letterSpacing: 0.5,
                flexShrink: 0,
              }}
            >
              RESOLVED
            </Typography>
          )}
        </Box>

        {/* Message list */}
        <Box
          ref={scrollContainerRef}
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
          {!hasActiveTicket && (
            <Box
              sx={{
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: 0.3,
                px: 2,
                textAlign: 'center',
              }}
            >
              <Typography variant="body2">Select a ticket from the queue</Typography>
            </Box>
          )}

          {hasActiveTicket && messages.length === 0 && isReady && (
            <Box
              sx={{
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: 0.3,
              }}
            >
              <Typography variant="body2">No messages yet</Typography>
            </Box>
          )}

          {hasActiveTicket && !isReady && window.chat && (
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

          {hasActiveTicket && !window.chat && (
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
              readBy={readReceipts.get(msg.id) ?? new Set<string>()}
              ticketUserAddress={activeTicket?.userAddress ?? ''}
              onReply={handleStartReply}
              onEdit={handleStartEdit}
              onDelete={handleDelete}
              onReaction={handleReaction}
              register={registerRead}
              unregister={unregisterRead}
            />
          ))}

          <TypingRow addresses={typingUsers} />
          <div ref={messagesEndRef} />
        </Box>

        {/* Compose banner (reply / edit mode) */}
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

        {/* Input row */}
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
              !hasActiveTicket
                ? 'Select a ticket…'
                : !isReady
                  ? 'Connecting…'
                  : editTarget
                    ? 'Edit message…'
                    : replyTarget
                      ? `Reply to ${shortAddr(replyTarget.authorAddress)}…`
                      : 'Type a reply…'
            }
            disabled={!hasActiveTicket || !isReady || !window.chat}
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
            disabled={!hasActiveTicket || !isReady || !inputText.trim() || isSending || !window.chat}
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
      </Box>
    </Paper>
  );
}
