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

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMessageReadObserver } from '../../hooks/useMessageReadObserver';
import { useAtom, useAtomValue } from 'jotai';
import {
  Avatar,
  Box,
  Button,
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
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded';
import HeadsetMicRoundedIcon from '@mui/icons-material/HeadsetMicRounded';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import { supportChatOpenAtom, userInfoAtom } from '../../atoms/global';
import { useSupportChat, SUPPORT_ADDRESSES, decryptAttachmentFromSupport } from '../../hooks/useSupportChat';
import { useIsOnline } from '../../hooks/usePresence';
import ImageUploader from '../../common/ImageUploader';

// ── Constants ─────────────────────────────────────────────────────────────────

export { SUPPORT_ADDRESSES };

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

// ── AttachmentImage ───────────────────────────────────────────────────────────

/**
 * Renders an encrypted image attachment.
 *
 * Live messages: attachmentData is present on the event — decrypt immediately.
 * History messages: fetch via window.chat.getAttachment(), then decrypt.
 * Results are cached in a shared ref so re-renders never re-decrypt.
 */
function AttachmentImage({
  eventId,
  attachmentData,
  senderPublicKey,
  mimeType,
  width,
  height,
  isAgent,
  decryptCache,
}: {
  eventId: string;
  attachmentData?: string;
  senderPublicKey: string;
  mimeType: string;
  width?: number;
  height?: number;
  isAgent?: boolean;
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

        const decrypted = await decryptAttachmentFromSupport(raw, senderPublicKey, isAgent);
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
  onReply,
  onEdit,
  onDelete,
  onReaction,
  readBy,
  register,
  unregister,
  isAgent,
  decryptCache,
  isGrouped,
}: {
  msg: RenderedMessage;
  isMine: boolean;
  findMessage: (id: string) => RenderedMessage | undefined;
  myAddress: string;
  onReply: (msg: RenderedMessage) => void;
  onEdit: (msg: RenderedMessage) => void;
  onDelete: (id: string) => void;
  onReaction: (targetId: string, emoji: string) => void;
  /** Addresses that have read this message. */
  readBy: Set<string>;
  register: (msgId: string, el: HTMLElement) => void;
  unregister: (msgId: string, el: HTMLElement) => void;
  isAgent: boolean;
  decryptCache: React.MutableRefObject<Map<string, string>>;
  isGrouped?: boolean;
}) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const color = addrColor(msg.authorAddress, isDark);
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);

  const borderColor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)';
  const seenByAgent = SUPPORT_ADDRESSES.some((a) => readBy.has(a));

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
        px: 1,
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
                backgroundColor: addrColor(msg.authorAddress, isDark),
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
        {/* Sender label for others (hidden when grouped) */}
        {!isMine && !isGrouped && (
          <Typography
            variant="caption"
            sx={{
              fontFamily: 'monospace',
              color,
              mb: 0.3,
              ml: 0.5,
              fontSize: 11,
              fontWeight: 600,
            }}
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
              : isDark
                ? 'rgba(255,255,255,0.1)'
                : 'rgba(0,0,0,0.055)',
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

          {/* Attachment image */}
          {!msg.isDeleted && msg.attachmentMeta && (
            <AttachmentImage
              eventId={msg.id}
              attachmentData={msg.originalEvent.attachmentData}
              senderPublicKey={msg.authorPublicKey}
              mimeType={msg.attachmentMeta.mimeType}
              width={msg.attachmentMeta.width}
              height={msg.attachmentMeta.height}
              isAgent={isAgent}
              decryptCache={decryptCache}
            />
          )}

          {/* Timestamp + edited + seen tick (WhatsApp-style, inside bubble) */}
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
              <Tooltip title={seenByAgent ? 'Seen by agent' : 'Sent'}>
                <DoneAllRoundedIcon
                  sx={{
                    fontSize: 14,
                    color: seenByAgent
                      ? 'rgba(255,255,255,0.95)'
                      : 'rgba(255,255,255,0.45)',
                  }}
                />
              </Tooltip>
            )}
          </Box>
        </Box>

        {/* Reactions — hang off the bubble bottom with negative margin */}
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
            <Box
              sx={{
                width: '1px',
                height: 18,
                backgroundColor: borderColor,
                mx: 0.25,
              }}
            />
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

// ── WelcomeAgentAvatar ────────────────────────────────────────────────────────

function WelcomeAgentAvatar({ address }: { address: string }) {
  const online = useIsOnline(address);
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const color = addrColor(address, isDark);
  return (
    <Tooltip title={address} placement="top">
      <Box sx={{ position: 'relative', flexShrink: 0 }}>
        <Avatar
          sx={{
            width: 36,
            height: 36,
            fontSize: 14,
            fontWeight: 700,
            backgroundColor: color,
          }}
        >
          {address[0]}
        </Avatar>
        <Box
          sx={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: 10,
            height: 10,
            borderRadius: '50%',
            backgroundColor: online ? '#44b700' : '#78909c',
            border: '2px solid',
            borderColor: 'background.paper',
          }}
        />
      </Box>
    </Tooltip>
  );
}

// ── SupportChat ───────────────────────────────────────────────────────────────

export function SupportChat() {
  const userInfo = useAtomValue(userInfoAtom);
  const myAddress: string = userInfo?.address ?? '';

  const [isOpen, setIsOpen] = useAtom(supportChatOpenAtom);
  const [hasStarted, setHasStarted] = useState(false);

  const {
    messages,
    isSending,
    typingUsers,
    isReady,
    isClosed,
    isAgentOnline,
    readReceipts,
    markMessagesRead,
    sendMessage,
    sendEdit,
    sendDelete,
    sendReaction,
    sendReply,
    notifyTyping,
    sendImage,
  } = useSupportChat(hasStarted);

  const isAgent = SUPPORT_ADDRESSES.includes(myAddress as typeof SUPPORT_ADDRESSES[number]);

  /** Decrypted data URI cache: eventId → data URI. Prevents re-decryption on re-renders. */
  const decryptCache = useRef<Map<string, string>>(new Map());

  const [inputText, setInputText] = useState('');
  const [replyTarget, setReplyTarget] = useState<RenderedMessage | null>(null);
  const [editTarget, setEditTarget] = useState<RenderedMessage | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<{
    file: File;
    previewUrl: string;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const theme = useTheme();

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

  // Intersection-based read receipts: mark messages as read only when they
  // actually enter the visible scroll area (true "eyes-on" confirmation).
  const { register: registerRead, unregister: unregisterRead } = useMessageReadObserver(
    myAddress,
    readReceipts,
    markMessagesRead,
    scrollContainerRef
  );

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

  const clearPendingAttachment = useCallback(() => {
    setPendingAttachment((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }, []);

  const handleCancelCompose = useCallback(() => {
    setReplyTarget(null);
    setEditTarget(null);
    setInputText('');
    clearPendingAttachment();
  }, [clearPendingAttachment]);

  // ── Send ────────────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const text = inputText.trim();

    // If there's a pending attachment, send it (with optional caption text) first.
    if (pendingAttachment && !editTarget) {
      if (isSending || !isAgentOnline) return;
      const { file } = pendingAttachment;
      clearPendingAttachment();
      const rt = replyTarget;
      setInputText('');
      setReplyTarget(null);
      // Caption is the typed text (may be empty).
      await sendImage(file, text || undefined).catch((err) =>
        console.error('[SupportChat] sendImage error', err)
      );
      // TODO: reply-with-attachment is not yet supported by the hook; for now
      // the reply context is discarded when sending an image.
      void rt;
      return;
    }

    if (!text || isSending || !isAgentOnline) return;

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
    isAgentOnline,
    editTarget,
    replyTarget,
    pendingAttachment,
    clearPendingAttachment,
    sendMessage,
    sendEdit,
    sendReply,
    sendImage,
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

  if (!myAddress || !isOpen) return null;

  const isDark = theme.palette.mode === 'dark';
  const bgColor = isDark ? '#1a1d23' : '#ffffff';
  const borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)';

  const inComposeMode = Boolean(replyTarget || editTarget);

  // ── Welcome / pre-start screen ───────────────────────────────────────────────
  if (!hasStarted) {
    return (
      <Paper
        elevation={12}
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 440,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 3,
          overflow: 'hidden',
          border: `1px solid ${borderColor}`,
          backgroundColor: bgColor,
          zIndex: 1300,
        }}
      >
        {/* Gradient hero header */}
        <Box
          sx={{
            background: `linear-gradient(135deg, ${theme.palette.primary.dark ?? theme.palette.primary.main}, ${theme.palette.primary.main})`,
            px: 2.5,
            pt: 2.5,
            pb: 3,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1,
            position: 'relative',
          }}
        >
          <IconButton
            size="small"
            onClick={() => setIsOpen(false)}
            sx={{
              position: 'absolute',
              top: 10,
              right: 10,
              color: 'rgba(255,255,255,0.7)',
              '&:hover': { color: '#fff', backgroundColor: 'rgba(255,255,255,0.12)' },
            }}
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>

          <Box
            sx={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              backgroundColor: 'rgba(255,255,255,0.18)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <HeadsetMicRoundedIcon sx={{ fontSize: 34, color: '#fff' }} />
          </Box>

          <Typography variant="h6" sx={{ color: '#fff', fontWeight: 700, mt: 0.5 }}>
            Qortal Support
          </Typography>
          <Typography variant="body2" align="center" sx={{ color: 'rgba(255,255,255,0.8)', maxWidth: 280, lineHeight: 1.5 }}>
            Our team is here to help you. Start a session to connect with an available agent.
          </Typography>
        </Box>

        {/* Agent status row */}
        <Box
          sx={{
            px: 2.5,
            py: 1.75,
            borderBottom: `1px solid ${borderColor}`,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
          }}
        >
          {SUPPORT_ADDRESSES.map((addr) => (
            <WelcomeAgentAvatar key={addr} address={addr} />
          ))}
          <Typography variant="body2" sx={{ color: isAgentOnline ? 'success.main' : 'text.disabled', fontWeight: 500 }}>
            {isAgentOnline ? 'Agents online' : 'No agents online'}
          </Typography>
        </Box>

        {/* CTA area */}
        <Box sx={{ px: 2.5, py: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Tooltip
            title={!isAgentOnline ? 'No agents are currently online. Please try again later.' : ''}
            placement="top"
          >
            <span style={{ width: '100%' }}>
              <Button
                variant="contained"
                size="large"
                fullWidth
                disabled={!isAgentOnline}
                onClick={() => setHasStarted(true)}
                sx={{ borderRadius: 2.5, py: 1.25, fontWeight: 700, fontSize: 15 }}
                startIcon={<HeadsetMicRoundedIcon />}
              >
                Start Support Chat
              </Button>
            </span>
          </Tooltip>

          {!isAgentOnline && (
            <Typography variant="caption" align="center" sx={{ color: 'text.disabled', display: 'block' }}>
              No agents are currently online. Please try again later.
            </Typography>
          )}
        </Box>
      </Paper>
    );
  }

  return (
    <Paper
      elevation={12}
      sx={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 440,
        height: 620,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 3,
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
          py: 1.25,
          borderBottom: `1px solid ${borderColor}`,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <HeadsetMicRoundedIcon sx={{ fontSize: 20, color: 'text.secondary', flexShrink: 0 }} />
        <Typography
          variant="subtitle2"
          sx={{ fontWeight: 700, flex: 1, letterSpacing: 0.3 }}
        >
          Support Team
        </Typography>

        {isClosed && (
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

        <Tooltip
          title={
            !window.chat
              ? 'P2P not available'
              : isReady
                ? 'Connected'
                : 'Connecting…'
          }
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
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
              }}
            />
            <Typography
              variant="caption"
              sx={{
                color: !window.chat ? 'error.main' : isReady ? 'success.main' : 'warning.main',
                fontWeight: 500,
                fontSize: 11,
              }}
            >
              {!window.chat ? 'Offline' : isReady ? 'Online' : 'Connecting…'}
            </Typography>
          </Box>
        </Tooltip>

        <IconButton size="small" onClick={() => setIsOpen(false)} sx={{ ml: 0.25 }}>
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* ── Message list ────────────────────────────────────────────────── */}
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
        {messages.length === 0 && isReady && (
          <Box
            sx={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1.5,
              px: 3,
              textAlign: 'center',
            }}
          >
            <ForumRoundedIcon sx={{ fontSize: 44, opacity: 0.2 }} />
            <Typography variant="body2" sx={{ opacity: 0.45, fontWeight: 500 }}>
              {isClosed
                ? 'This chat was resolved.'
                : 'No messages yet'}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.3, display: 'block' }}>
              {isClosed
                ? 'Send a message to re-open.'
                : 'Say hello to start the conversation.'}
            </Typography>
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
                onReply={handleStartReply}
                onEdit={handleStartEdit}
                onDelete={handleDelete}
                onReaction={handleReaction}
                readBy={readReceipts.get(msg.id) ?? new Set<string>()}
                register={registerRead}
                unregister={unregisterRead}
                isAgent={isAgent}
                decryptCache={decryptCache}
                isGrouped={isGrouped}
              />
            </React.Fragment>
          );
        })}

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
      {isReady && !isAgentOnline && (
        <Box
          sx={{
            px: 2,
            py: 0.75,
            mx: 1.5,
            mb: 0.5,
            borderRadius: 1.5,
            backgroundColor: isDark
              ? 'rgba(239,68,68,0.12)'
              : 'rgba(239,68,68,0.08)',
            flexShrink: 0,
          }}
        >
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              textAlign: 'center',
              color: 'error.main',
              fontWeight: 500,
              lineHeight: 1.4,
            }}
          >
            No support agents are online. Messaging is unavailable.
          </Typography>
        </Box>
      )}

      {/* Pending attachment preview strip */}
      {pendingAttachment && (
        <Box
          sx={{
            px: 2,
            pt: 1,
            pb: 0.5,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            borderTop: `1px solid ${borderColor}`,
            backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
            flexShrink: 0,
          }}
        >
          <Box sx={{ position: 'relative', flexShrink: 0 }}>
            <Box
              component="img"
              src={pendingAttachment.previewUrl}
              alt="preview"
              sx={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 1.5, display: 'block' }}
            />
            <IconButton
              size="small"
              onClick={clearPendingAttachment}
              sx={{
                position: 'absolute',
                top: -7,
                right: -7,
                width: 20,
                height: 20,
                backgroundColor: 'error.main',
                color: '#fff',
                '&:hover': { backgroundColor: 'error.dark' },
                p: 0,
              }}
            >
              <CloseRoundedIcon sx={{ fontSize: 13 }} />
            </IconButton>
          </Box>
          <Typography variant="caption" sx={{ opacity: 0.55 }}>
            {pendingAttachment.file.name} — add a caption or press send
          </Typography>
        </Box>
      )}

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
            !isReady
              ? 'Connecting…'
              : !isAgentOnline
                ? 'No agents online…'
                : editTarget
                  ? 'Edit message…'
                  : replyTarget
                    ? `Reply to ${shortAddr(replyTarget.authorAddress)}…`
                    : isClosed
                      ? 'Send a message to re-open…'
                      : 'Type a message…'
          }
          disabled={!isReady || !window.chat || !isAgentOnline}
          value={inputText}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={(e: React.ClipboardEvent) => {
            const items = Array.from(e.clipboardData.items);
            const imageItem = items.find((item) => item.type.startsWith('image/'));
            if (!imageItem) return;
            e.preventDefault();
            const file = imageItem.getAsFile();
            if (!file || !isReady || !isAgentOnline || isSending) return;
            clearPendingAttachment();
            const previewUrl = URL.createObjectURL(file);
            setPendingAttachment({ file, previewUrl });
          }}
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
          disabled={!isReady || (!inputText.trim() && !pendingAttachment) || isSending || !window.chat || !isAgentOnline}
          color={editTarget ? 'warning' : 'primary'}
          sx={{ mb: 0.25, '&:disabled': { opacity: 0.35 } }}
        >
          {isSending ? (
            <CircularProgress size={20} />
          ) : (
            <SendRoundedIcon />
          )}
        </IconButton>

        {/* Image attachment button — hidden in edit mode since edits are text-only */}
        {!editTarget && (
          <Tooltip title="Send image">
            <span>
              <ImageUploader
                onPick={(file) => {
                  if (!isReady || !isAgentOnline || isSending) return;
                  clearPendingAttachment();
                  const previewUrl = URL.createObjectURL(file);
                  setPendingAttachment({ file, previewUrl });
                  setTimeout(() => inputRef.current?.focus(), 0);
                }}
              >
                <IconButton
                  size="medium"
                  disabled={!isReady || isSending || !window.chat || !isAgentOnline}
                  sx={{ mb: 0.25, '&:disabled': { opacity: 0.35 } }}
                >
                  <AttachFileRoundedIcon />
                </IconButton>
              </ImageUploader>
            </span>
          </Tooltip>
        )}
      </Box>
    </Paper>
  );
}
