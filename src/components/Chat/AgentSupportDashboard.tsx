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

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { useMessageReadObserver } from '../../hooks/useMessageReadObserver';
import { supportChatOpenAtom, userInfoAtom } from '../../atoms/global';
import {
  Avatar,
  Box,
  CircularProgress,
  Dialog,
  IconButton,
  InputBase,
  Paper,
  Popover,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded';
import AddReactionRoundedIcon from '@mui/icons-material/AddReactionRounded';
import DriveFileRenameOutlineRoundedIcon from '@mui/icons-material/DriveFileRenameOutlineRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import RemoveCircleOutlineRoundedIcon from '@mui/icons-material/RemoveCircleOutlineRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import BlockRoundedIcon from '@mui/icons-material/BlockRounded';
import LockOpenRoundedIcon from '@mui/icons-material/LockOpenRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import HeadsetMicRoundedIcon from '@mui/icons-material/HeadsetMicRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import CallRoundedIcon from '@mui/icons-material/CallRounded';
import CallEndRoundedIcon from '@mui/icons-material/CallEndRounded';
import MicRoundedIcon from '@mui/icons-material/MicRounded';
import MicOffRoundedIcon from '@mui/icons-material/MicOffRounded';
import {
  useAgentSupportChat,
  SupportTicket,
} from '../../hooks/useAgentSupportChat';
import { useIsOnline } from '../../hooks/usePresence';
import { decryptAttachmentFromSupport } from '../../hooks/useSupportChat';
import { useVoiceCallContext } from '../../context/VoiceCallContext';
import { CallAudioSettingsButton } from './CallAudioDeviceSelectors';

// ── Constants ─────────────────────────────────────────────────────────────────

const QUICK_REACTIONS = ['👍', '✅', '❤️', '🙏', '🤔', '😮', '😅', '😂', '👀', '🔥'] as const;

// ── Small helpers ─────────────────────────────────────────────────────────────

function shortAddr(addr: string): string {
  if (!addr || addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function addrColor(addr: string, isDark = false): string {
  let h = 0;
  for (let i = 0; i < addr.length; i++) {
    h = (h * 31 + addr.charCodeAt(i)) & 0xffff;
  }
  return `hsl(${h % 360}, 60%, ${isDark ? 68 : 40}%)`;
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
  const color = addrColor(ticket.userAddress, isDark);

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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        {/* User avatar with online dot */}
        <Box sx={{ position: 'relative', flexShrink: 0 }}>
          <Avatar
            sx={{
              width: 28,
              height: 28,
              fontSize: 11,
              fontWeight: 700,
              backgroundColor: color,
            }}
          >
            {ticket.userAddress[0]}
          </Avatar>
          <Box
            sx={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: online ? '#44b700' : '#78909c',
              border: '1.5px solid',
              borderColor: 'background.paper',
            }}
          />
        </Box>

        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            variant="caption"
            sx={{
              fontFamily: 'monospace',
              color,
              fontWeight: 600,
              lineHeight: 1.2,
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {shortAddr(ticket.userAddress)}
          </Typography>
          {ticket.isResolved && (
            <Typography
              variant="caption"
              sx={{ fontSize: 9, opacity: 0.55, letterSpacing: 0.4 }}
            >
              RESOLVED
            </Typography>
          )}
        </Box>
      </Box>
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
  const parent = findMessage(parentId);
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const authorColor = parent ? addrColor(parent.authorAddress, isDark) : '#78909c';
  const preview = parent
    ? parent.isDeleted
      ? 'Message deleted'
      : parent.content.length > 120
        ? `${parent.content.slice(0, 120)}…`
        : parent.content
    : '(message not found)';

  return (
    <Box
      sx={{
        mb: 0.75,
        px: 1,
        py: 0.5,
        borderRadius: 1.5,
        borderLeft: `3px solid ${authorColor}`,
        backgroundColor: isMine
          ? 'rgba(0,0,0,0.2)'
          : `${authorColor}22`,
        maxWidth: '100%',
      }}
    >
      {parent && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
          <Box
            sx={{
              width: 14,
              height: 14,
              borderRadius: '50%',
              backgroundColor: authorColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 8,
              fontWeight: 700,
              color: '#fff',
              flexShrink: 0,
            }}
          >
            {parent.authorAddress[0]}
          </Box>
          <Typography
            variant="caption"
            sx={{ color: authorColor, fontWeight: 600, fontSize: 11, lineHeight: 1 }}
          >
            {shortAddr(parent.authorAddress)}
          </Typography>
        </Box>
      )}
      <Typography
        variant="caption"
        sx={{
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          opacity: 0.75,
          lineHeight: 1.4,
          fontStyle: parent?.isDeleted ? 'italic' : 'normal',
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
  isMine,
}: {
  reactions: Record<string, string[]>;
  targetId: string;
  myAddress: string;
  onReaction: (targetId: string, emoji: string) => void;
  isMine: boolean;
}) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const primaryColor = theme.palette.primary.main;
  const entries = Object.entries(reactions);
  if (entries.length === 0) return null;

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 0.4,
        mt: -0.75,
        px: 0.5,
        alignSelf: isMine ? 'flex-end' : 'flex-start',
      }}
    >
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
                gap: 0.35,
                px: 1,
                py: 0.4,
                borderRadius: '20px',
                cursor: 'pointer',
                userSelect: 'none',
                backdropFilter: 'blur(8px)',
                backgroundColor: iReacted
                  ? alpha(primaryColor, 0.85)
                  : isDark ? 'rgba(40,44,52,0.88)' : 'rgba(255,255,255,0.88)',
                border: `1px solid ${iReacted ? primaryColor : (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)')}`,
                color: iReacted ? theme.palette.primary.contrastText : theme.palette.text.primary,
                boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
                transition: 'transform 0.1s ease, box-shadow 0.1s ease',
                '&:hover': {
                  transform: 'scale(1.08)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                },
              }}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }}>{emoji}</span>
              <Typography component="span" sx={{ fontSize: 11, lineHeight: 1, fontWeight: 600 }}>
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

// ── AttachmentImage ───────────────────────────────────────────────────────────

function AttachmentImage({
  eventId,
  attachmentData,
  senderPublicKey,
  mimeType,
  width,
  height,
  decryptCache,
}: {
  eventId: string;
  attachmentData?: string;
  senderPublicKey: string;
  mimeType: string;
  width?: number;
  height?: number;
  decryptCache: React.MutableRefObject<Map<string, string>>;
}) {
  const [dataUri, setDataUri] = useState<string | null>(
    decryptCache.current.get(eventId) ?? null
  );
  const [loading, setLoading] = useState(!decryptCache.current.has(eventId));
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    if (decryptCache.current.has(eventId)) {
      setDataUri(decryptCache.current.get(eventId)!);
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const raw = attachmentData ?? (await window.chat?.getAttachment(eventId)) ?? null;
        if (!raw || cancelled) { setLoading(false); return; }

        // isAgent=true: agent decrypts messages sent by users
        const decrypted = await decryptAttachmentFromSupport(raw, senderPublicKey, true);
        if (!decrypted || cancelled) { setLoading(false); return; }

        const uri = `data:${mimeType};base64,${decrypted}`;
        decryptCache.current.set(eventId, uri);
        if (!cancelled) setDataUri(uri);
      } catch (err) {
        console.error('[AttachmentImage] decrypt error', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const aspectRatio = width && height ? `${width} / ${height}` : undefined;

  if (loading) {
    return (
      <Box
        sx={{
          width: '100%',
          maxWidth: 240,
          aspectRatio: aspectRatio ?? '4 / 3',
          borderRadius: 1.5,
          backgroundColor: 'rgba(128,128,128,0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          mt: 0.5,
        }}
      >
        <CircularProgress size={20} />
      </Box>
    );
  }

  if (!dataUri) return null;

  return (
    <>
      <Box
        component="img"
        src={dataUri}
        alt="attachment"
        sx={{
          display: 'block',
          maxWidth: 240,
          maxHeight: 320,
          width: '100%',
          borderRadius: 1.5,
          mt: 0.5,
          cursor: 'zoom-in',
          objectFit: 'contain',
        }}
        onClick={() => setLightboxOpen(true)}
      />
      <Dialog
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        maxWidth={false}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(0,0,0,0.92)',
            boxShadow: 'none',
            m: 1,
            borderRadius: 2,
            overflow: 'hidden',
          },
        }}
      >
        <Box sx={{ position: 'relative' }}>
          <IconButton
            onClick={() => setLightboxOpen(false)}
            size="small"
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              zIndex: 1,
              backgroundColor: 'rgba(0,0,0,0.55)',
              color: '#fff',
              '&:hover': { backgroundColor: 'rgba(0,0,0,0.8)' },
            }}
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
          <Box
            component="img"
            src={dataUri}
            alt="attachment"
            sx={{ display: 'block', maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain' }}
          />
        </Box>
      </Dialog>
    </>
  );
}

// ── DateSeparator ─────────────────────────────────────────────────────────────

function DateSeparator({ timestamp }: { timestamp: number }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const borderColor = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
  const label = new Date(timestamp).toLocaleDateString([], {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5 }}>
      <Box sx={{ flex: 1, height: '1px', backgroundColor: borderColor }} />
      <Typography
        variant="caption"
        sx={{
          opacity: 0.4,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 0.5,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </Typography>
      <Box sx={{ flex: 1, height: '1px', backgroundColor: borderColor }} />
    </Box>
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
  decryptCache,
  isGrouped,
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
  decryptCache: React.MutableRefObject<Map<string, string>>;
  isGrouped?: boolean;
}) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const color = addrColor(msg.authorAddress, isDark);
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);

  const borderColor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)';
  const seenByUser = ticketUserAddress && readBy.has(ticketUserAddress);

  // Intersection-based read: observe this element only for messages from others.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || isMine || msg.isDeleted) return;
    register(msg.id, el);
    return () => unregister(msg.id, el);
  }, [msg.id, isMine, msg.isDeleted, register, unregister]);

  return (
    <Box
      ref={rootRef}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        flexDirection: isMine ? 'row-reverse' : 'row',
        mb: isGrouped ? 0.35 : 1.25,
        px: 1.5,
        gap: 0.5,
        '&:hover .chat-actions': { opacity: 1 },
      }}
    >
      {/* Avatar or spacer */}
      {!isMine ? (
        isGrouped ? (
          <Box sx={{ width: 32, flexShrink: 0 }} />
        ) : (
          <Tooltip title={msg.authorAddress} placement="left">
            <Avatar
              sx={{
                width: 32,
                height: 32,
                fontSize: 12,
                fontWeight: 700,
                backgroundColor: color,
                flexShrink: 0,
                mt: 0.5,
              }}
            >
              {msg.authorAddress[0]}
            </Avatar>
          </Tooltip>
        )
      ) : null}

      {/* Bubble column */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: isMine ? 'flex-end' : 'flex-start',
          maxWidth: '72%',
          minWidth: 0,
        }}
      >
        {/* Sender label (hidden when grouped) */}
        {!isMine && !isGrouped && (
          <Typography
            variant="caption"
            sx={{ fontFamily: 'monospace', color, mb: 0.3, ml: 0.5, fontSize: 11, fontWeight: 600 }}
          >
            {shortAddr(msg.authorAddress)}
          </Typography>
        )}

        {/* Bubble */}
        <Box
          sx={{
            px: 1.75,
            py: 1,
            borderRadius: isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
            background: isMine
              ? `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark ?? theme.palette.primary.main})`
              : undefined,
            backgroundColor: isMine
              ? undefined
              : isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.055)',
            border: isMine
              ? undefined
              : `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'}`,
            boxShadow: isMine
              ? '0 2px 8px rgba(0,0,0,0.22)'
              : '0 1px 3px rgba(0,0,0,0.08)',
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
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, opacity: isMine ? 0.55 : 0.45 }}>
              <RemoveCircleOutlineRoundedIcon sx={{ fontSize: 15 }} />
              <Typography variant="body2" sx={{ fontStyle: 'italic', fontSize: 13 }}>
                This message was deleted
              </Typography>
            </Box>
          ) : (
            <Typography variant="body2" sx={{ lineHeight: 1.5, fontSize: 14 }}>
              {msg.content}
            </Typography>
          )}

          {!msg.isDeleted && msg.attachmentMeta && (
            <AttachmentImage
              eventId={msg.id}
              attachmentData={msg.originalEvent?.attachmentData}
              senderPublicKey={msg.authorPublicKey}
              mimeType={msg.attachmentMeta.mimeType}
              width={msg.attachmentMeta.width}
              height={msg.attachmentMeta.height}
              decryptCache={decryptCache}
            />
          )}

          {/* Timestamp + seen tick inside bubble */}
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 0.4,
              mt: 0.75,
              mx: -0.25,
            }}
          >
            {msg.isEdited && (
              <Typography
                sx={{
                  fontSize: 10,
                  fontStyle: 'italic',
                  color: isMine ? 'rgba(255,255,255,0.55)' : 'text.disabled',
                }}
              >
                edited
              </Typography>
            )}
            <Typography
              sx={{
                fontSize: 10,
                color: isMine ? 'rgba(255,255,255,0.6)' : 'text.disabled',
              }}
            >
              {fmtTime(msg.timestamp)}
            </Typography>
            {isMine && (
              <Tooltip title={seenByUser ? 'Seen by user' : 'Sent'}>
                <DoneAllRoundedIcon
                  sx={{
                    fontSize: 14,
                    color: seenByUser
                      ? 'rgba(255,255,255,0.95)'
                      : 'rgba(255,255,255,0.45)',
                  }}
                />
              </Tooltip>
            )}
          </Box>
        </Box>

        {/* Reactions */}
        <ReactionChips
          reactions={msg.reactions}
          targetId={msg.id}
          myAddress={myAddress}
          onReaction={onReaction}
          isMine={isMine}
        />
      </Box>

      {/* ── Action pill — sibling to bubble column so it never overlaps text ── */}
      <Box
        className="chat-actions"
        sx={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 0.25,
          opacity: 0,
          transition: 'opacity 0.18s ease',
          alignSelf: 'center',
          flexShrink: 0,
          backgroundColor: isDark ? '#23272e' : '#ffffff',
          borderRadius: '24px',
          boxShadow: isDark
            ? '0 4px 16px rgba(0,0,0,0.45)'
            : '0 4px 16px rgba(0,0,0,0.15)',
          border: `1px solid ${borderColor}`,
          px: 0.75,
          py: 0.5,
        }}
      >
        <Tooltip title="Reply">
          <IconButton
            size="small"
            sx={{
              borderRadius: '50%',
              p: 0.6,
              '&:hover': {
                color: 'primary.main',
                backgroundColor: alpha(theme.palette.primary.main, 0.12),
              },
            }}
            onClick={() => onReply(msg)}
          >
            <ReplyRoundedIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>

        <Tooltip title="React">
          <IconButton
            size="small"
            sx={{
              borderRadius: '50%',
              p: 0.6,
              '&:hover': {
                color: '#f59e0b',
                backgroundColor: 'rgba(245,158,11,0.12)',
              },
            }}
            onClick={(e) => setEmojiAnchor(e.currentTarget)}
          >
            <AddReactionRoundedIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>

        {isMine && !msg.isDeleted && (
          <>
            <Box sx={{ width: '1px', height: 18, backgroundColor: borderColor, mx: 0.25 }} />
            <Tooltip title="Edit">
              <IconButton
                size="small"
                sx={{
                  borderRadius: '50%',
                  p: 0.6,
                  '&:hover': {
                    color: 'warning.main',
                    backgroundColor: alpha(theme.palette.warning.main, 0.12),
                  },
                }}
                onClick={() => onEdit(msg)}
              >
                <DriveFileRenameOutlineRoundedIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton
                size="small"
                sx={{
                  borderRadius: '50%',
                  p: 0.6,
                  color: 'error.main',
                  '&:hover': { backgroundColor: alpha(theme.palette.error.main, 0.12) },
                }}
                onClick={() => onDelete(msg.id)}
              >
                <DeleteOutlineRoundedIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </Tooltip>
          </>
        )}
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
  const [isOpen, setIsOpen] = useAtom(supportChatOpenAtom);

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

  // ── Voice call ─────────────────────────────────────────────────────────────

  const {
    callState,
    audioMode,
    isMuted,
    callDuration,
    incomingCall,
    activeCallChatId,
    acceptCall,
    rejectCall,
    hangUp,
    toggleMute,
  } = useVoiceCallContext();

  const showSupportVoiceUI = useMemo(() => {
    if (callState === 'ringing' && incomingCall) {
      return incomingCall.chatId.startsWith('support:');
    }
    if (callState === 'calling' || callState === 'connected' || callState === 'ended') {
      return activeCallChatId?.startsWith('support:') ?? false;
    }
    return true;
  }, [callState, incomingCall, activeCallChatId]);

  const fmtDuration = (secs: number): string => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const [inputText, setInputText] = useState('');
  const [replyTarget, setReplyTarget] = useState<RenderedMessage | null>(null);
  const [editTarget, setEditTarget] = useState<RenderedMessage | null>(null);
  const [resolving, setResolving] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  const [addrCopied, setAddrCopied] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const decryptCache = useRef<Map<string, string>>(new Map());
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

  if (!isOpen) return null;

  const isDark = theme.palette.mode === 'dark';
  const bgColor = isDark ? '#1a1d23' : '#ffffff';
  const borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
  const inComposeMode = Boolean(replyTarget || editTarget);
  const hasActiveTicket = Boolean(activeTicket);

  return (
    <Paper
      elevation={12}
      sx={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 640,
        height: 600,
        display: 'flex',
        flexDirection: 'row',
        borderRadius: 3,
        overflow: 'hidden',
        border: `1px solid ${borderColor}`,
        backgroundColor: bgColor,
        zIndex: 1300,
      }}
    >
      {/* ── Left: ticket list ──────────────────────────────────────────────── */}
      <Box
        sx={{
          width: 180,
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
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
            <HeadsetMicRoundedIcon sx={{ fontSize: 16, color: 'text.secondary', mr: 0.5 }} />
            <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 0.2, flex: 1, fontSize: 12 }}>
              Support
            </Typography>
            <IconButton
              size="small"
              sx={{ p: 0.25 }}
              onClick={() => setIsOpen(false)}
            >
              <CloseRoundedIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="caption" sx={{ fontWeight: 700, opacity: 0.55, letterSpacing: 0.4, fontSize: 10 }}>
              QUEUE
            </Typography>
            {tickets.filter((t) => !t.isBlocked).length > 0 && (
              <Typography
                variant="caption"
                sx={{
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
            px: 2,
            py: 1.25,
            borderBottom: `1px solid ${borderColor}`,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          {/* User avatar + info */}
          {activeTicket ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0 }}>
              <Box sx={{ position: 'relative', flexShrink: 0 }}>
                <Avatar
                  sx={{
                    width: 32,
                    height: 32,
                    fontSize: 13,
                    fontWeight: 700,
                    backgroundColor: addrColor(activeTicket.userAddress, isDark),
                  }}
                >
                  {activeTicket.userAddress[0]}
                </Avatar>
                <Box
                  sx={{
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    backgroundColor: '#44b700',
                    border: '1.5px solid',
                    borderColor: 'background.paper',
                  }}
                />
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography
                    variant="subtitle2"
                    sx={{
                      fontFamily: 'monospace',
                      fontWeight: 600,
                      letterSpacing: 0.2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {shortAddr(activeTicket.userAddress)}
                  </Typography>
                  <Tooltip
                    title={addrCopied ? 'Copied!' : 'Copy full address'}
                    placement="top"
                    arrow
                  >
                    <IconButton
                      size="small"
                      onClick={() => {
                        navigator.clipboard.writeText(activeTicket.userAddress);
                        setAddrCopied(true);
                        setTimeout(() => setAddrCopied(false), 2000);
                      }}
                      sx={{
                        flexShrink: 0,
                        color: addrCopied ? 'success.main' : 'action.active',
                        transition: 'color 0.2s',
                        p: 0.4,
                      }}
                    >
                      {addrCopied
                        ? <CheckCircleOutlineRoundedIcon sx={{ fontSize: 15 }} />
                        : <ContentCopyRoundedIcon sx={{ fontSize: 15 }} />}
                    </IconButton>
                  </Tooltip>
                </Box>
                <Typography variant="caption" sx={{ opacity: 0.5, display: 'block', fontSize: 10 }}>
                  {activeTicket.isResolved ? 'Resolved' : 'Active session'}
                </Typography>
              </Box>
            </Box>
          ) : (
            <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1 }}>
              Support Agents
            </Typography>
          )}

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

        {/* Incoming call banner */}
        {showSupportVoiceUI && callState === 'ringing' && incomingCall && (
          <Box
            sx={{
              px: 2,
              py: 1,
              borderBottom: `1px solid ${borderColor}`,
              backgroundColor: isDark ? 'rgba(34,197,94,0.12)' : 'rgba(34,197,94,0.10)',
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              flexShrink: 0,
            }}
          >
            <CallRoundedIcon sx={{ fontSize: 18, color: 'success.main', flexShrink: 0 }} />
            <Typography variant="body2" sx={{ flex: 1, fontWeight: 600, color: 'success.main' }}>
              Incoming call from {incomingCall.fromAddress.slice(0, 6)}…{incomingCall.fromAddress.slice(-4)}
            </Typography>
            <Tooltip title="Accept">
              <IconButton
                size="small"
                onClick={acceptCall}
                sx={{ color: '#fff', backgroundColor: 'success.main', '&:hover': { backgroundColor: 'success.dark' }, p: 0.75 }}
              >
                <CallRoundedIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Reject">
              <IconButton
                size="small"
                onClick={rejectCall}
                sx={{ color: '#fff', backgroundColor: 'error.main', '&:hover': { backgroundColor: 'error.dark' }, p: 0.75 }}
              >
                <CallEndRoundedIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        )}

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

          {messages.map((msg, idx) => {
            const prev = idx > 0 ? messages[idx - 1] : null;
            const isGrouped = prev !== null && prev.authorAddress === msg.authorAddress;
            const showDateSep = prev !== null &&
              new Date(msg.timestamp).toDateString() !== new Date(prev.timestamp).toDateString();
            return (
              <React.Fragment key={msg.id}>
                {showDateSep && <DateSeparator timestamp={msg.timestamp} />}
                <MessageBubble
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
                  decryptCache={decryptCache}
                  isGrouped={isGrouped}
                />
              </React.Fragment>
            );
          })}

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

        {/* In-call status bar */}
        {showSupportVoiceUI && callState === 'connected' && (
          <Box
            sx={{
              px: 1.5,
              py: 0.75,
              borderTop: `1px solid ${borderColor}`,
              backgroundColor: isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)',
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 1,
              flexShrink: 0,
            }}
          >
            <CallRoundedIcon sx={{ fontSize: 15, color: 'primary.main', flexShrink: 0 }} />
            <Typography variant="caption" sx={{ flex: 1, fontWeight: 600, color: 'primary.main' }}>
              {fmtDuration(callDuration)}
            </Typography>
            <Typography
              variant="caption"
              sx={{
                px: 0.75,
                py: 0.15,
                borderRadius: 1,
                backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                fontWeight: 600,
                fontSize: 10,
                letterSpacing: 0.4,
                color: 'text.secondary',
              }}
            >
              {audioMode === 'reticulum' ? 'Reticulum' : '…'}
            </Typography>
            <CallAudioSettingsButton />
            <Tooltip title={isMuted ? 'Unmute' : 'Mute'}>
              <IconButton size="small" onClick={toggleMute} sx={{ p: 0.5 }}>
                {isMuted
                  ? <MicOffRoundedIcon sx={{ fontSize: 16, color: 'error.main' }} />
                  : <MicRoundedIcon sx={{ fontSize: 16 }} />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Hang up">
              <IconButton
                size="small"
                onClick={hangUp}
                sx={{ color: '#fff', backgroundColor: 'error.main', '&:hover': { backgroundColor: 'error.dark' }, p: 0.5 }}
              >
                <CallEndRoundedIcon sx={{ fontSize: 16 }} />
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
            maxRows={5}
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
              py: 1,
              borderRadius: 2.5,
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.06)'
                : 'rgba(0,0,0,0.04)',
              border: `1px solid ${editTarget ? theme.palette.warning.main : borderColor}`,
              '& .MuiInputBase-input': { resize: 'none' },
            }}
          />
          <IconButton
            size="medium"
            onClick={handleSend}
            disabled={!hasActiveTicket || !isReady || !inputText.trim() || isSending || !window.chat}
            color={editTarget ? 'warning' : 'primary'}
            sx={{ mb: 0.25, '&:disabled': { opacity: 0.35 } }}
          >
            {isSending ? (
              <CircularProgress size={20} />
            ) : (
              <SendRoundedIcon />
            )}
          </IconButton>
        </Box>
      </Box>
    </Paper>
  );
}
