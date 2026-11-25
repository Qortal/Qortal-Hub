import EmojiEmotionsRoundedIcon from '@mui/icons-material/EmojiEmotionsRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import {
  Box,
  Button,
  IconButton,
  Popover,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import Picker, {
  EmojiStyle,
  Theme,
  type EmojiClickData,
} from 'emoji-picker-react';
import { useEffect, useRef, useState } from 'react';

export type GameChatMessage = {
  messageId: string;
  authorAddress: string;
  text: string;
  createdAt: number;
  delivered: boolean;
  failed?: boolean;
};

type Props = {
  address: string;
  disabled: boolean;
  messages: GameChatMessage[];
  opponentName: string;
  remoteTyping: boolean;
  onSend: (text: string) => boolean;
  onTyping: (active: boolean) => void;
  variant?: 'default' | 'chess';
};

const CHAT_LIMIT = 500;

export function GameSessionChat({
  address,
  disabled,
  messages,
  opponentName,
  remoteTyping,
  onSend,
  onTyping,
  variant = 'default',
}: Props) {
  const chessLayout = variant === 'chess';
  const [draft, setDraft] = useState('');
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);
  const [unread, setUnread] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  const previousCountRef = useRef(0);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (nearBottomRef.current) {
      element.scrollTop = element.scrollHeight;
      setUnread(0);
    } else if (messages.length > previousCountRef.current) {
      setUnread((value) => value + messages.length - previousCountRef.current);
    }
    previousCountRef.current = messages.length;
  }, [messages.length, remoteTyping]);

  useEffect(() => () => onTyping(false), [onTyping]);

  const submit = () => {
    const text = draft.trim();
    if (!text || disabled || !onSend(text)) return;
    setDraft('');
    onTyping(false);
  };

  const insertEmoji = (emoji: EmojiClickData) => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? draft.length;
    const end = input?.selectionEnd ?? start;
    const next =
      `${draft.slice(0, start)}${emoji.emoji}${draft.slice(end)}`.slice(
        0,
        CHAT_LIMIT
      );
    setDraft(next);
    onTyping(Boolean(next));
    setEmojiAnchor(null);
    window.setTimeout(() => {
      input?.focus();
      const cursor = Math.min(start + emoji.emoji.length, next.length);
      input?.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <Box
      aria-label="Private game chat"
      sx={{
        backgroundColor: chessLayout ? 'rgba(5, 18, 31, 0.32)' : 'transparent',
        border: chessLayout ? `1px solid ${alpha('#63869d', 0.28)}` : 0,
        borderLeft: chessLayout
          ? undefined
          : { md: `1px solid ${alpha('#fff', 0.1)}` },
        borderRadius: chessLayout ? '8px' : 0,
        borderTop: chessLayout
          ? undefined
          : { xs: `1px solid ${alpha('#fff', 0.1)}`, md: 0 },
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: chessLayout ? { xs: 280, lg: 0 } : { xs: 230, md: 0 },
        minWidth: 0,
        p: chessLayout ? '26px 14px 14px' : 0,
        pl: chessLayout ? undefined : { md: 2 },
        pt: chessLayout ? undefined : { xs: 2, md: 0 },
      }}
    >
      <Box sx={{ mb: chessLayout ? 0 : 1 }}>
        <Typography
          sx={{
            fontSize: chessLayout ? 17 : 14,
            fontWeight: chessLayout ? 700 : 850,
            lineHeight: chessLayout ? '21px' : undefined,
          }}
        >
          Private chat
        </Typography>
        <Typography
          sx={{
            color: alpha('#fff', chessLayout ? 0.54 : 0.46),
            fontSize: chessLayout ? 12 : 10,
            fontWeight: chessLayout ? 500 : undefined,
            lineHeight: chessLayout ? '16px' : undefined,
            mt: chessLayout ? '3px' : 0,
          }}
        >
          {chessLayout
            ? 'Temporary'
            : 'Temporary · cleared when this private session ends'}
        </Typography>
      </Box>

      <Stack
        aria-live="polite"
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          nearBottomRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            36;
          if (nearBottomRef.current) setUnread(0);
        }}
        spacing={chessLayout ? 1 : 0.8}
        sx={{
          flex: 1,
          maxHeight: chessLayout ? 'none' : { xs: 210, md: 'none' },
          minHeight: chessLayout ? 0 : { xs: 150, md: 0 },
          overflowY: 'auto',
          pr: chessLayout ? '10px' : 0.5,
          pt: chessLayout ? '18px' : 0,
          pb: chessLayout ? '14px' : 0,
          scrollbarColor: chessLayout
            ? `${alpha('#8d99a8', 0.3)} transparent`
            : undefined,
          scrollbarWidth: chessLayout ? 'thin' : undefined,
          '&::-webkit-scrollbar': chessLayout ? { width: 4 } : undefined,
          '&::-webkit-scrollbar-thumb': chessLayout
            ? { backgroundColor: alpha('#8d99a8', 0.3), borderRadius: 4 }
            : undefined,
        }}
      >
        {!chessLayout && messages.length === 0 && (
          <Typography
            sx={{
              color: alpha('#fff', 0.38),
              fontSize: 12,
              mt: 2,
              textAlign: 'center',
            }}
          >
            Messages stay between you and {opponentName}.
          </Typography>
        )}
        {messages.map((message) => {
          const local = message.authorAddress === address;
          return (
            <Box
              key={message.messageId}
              sx={{
                alignSelf: local ? 'flex-end' : 'flex-start',
                maxWidth: '88%',
              }}
            >
              <Box
                sx={{
                  backgroundColor: local
                    ? chessLayout
                      ? '#123b62'
                      : alpha('#248cf0', 0.34)
                    : alpha('#fff', chessLayout ? 0.065 : 0.08),
                  border: `1px solid ${local ? (chessLayout ? alpha('#59aefc', 0.5) : alpha('#59aefc', 0.46)) : alpha('#fff', chessLayout ? 0.08 : 0.1)}`,
                  borderRadius: chessLayout
                    ? '8px'
                    : local
                      ? '12px 12px 3px 12px'
                      : '12px 12px 12px 3px',
                  px: chessLayout ? 1.35 : 1.2,
                  py: chessLayout ? 0.9 : 0.8,
                }}
              >
                <Typography
                  sx={{
                    fontSize: chessLayout ? 13 : 12,
                    lineHeight: chessLayout ? 1.4 : undefined,
                    overflowWrap: 'anywhere',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {message.text}
                </Typography>
              </Box>
              <Typography
                sx={{
                  color: alpha('#fff', 0.36),
                  fontSize: 9,
                  mt: 0.25,
                  textAlign: local ? 'right' : 'left',
                }}
              >
                {new Date(message.createdAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {local
                  ? ` · ${message.failed ? 'Failed' : message.delivered ? 'Delivered' : 'Sending…'}`
                  : ''}
              </Typography>
            </Box>
          );
        })}
        {remoteTyping && (
          <Typography
            aria-live="polite"
            sx={{
              color: alpha('#9ffcff', 0.72),
              fontSize: 11,
              fontStyle: 'italic',
            }}
          >
            {opponentName} is typing…
          </Typography>
        )}
      </Stack>

      {unread > 0 && (
        <Button
          onClick={() => {
            const element = scrollRef.current;
            if (element) element.scrollTop = element.scrollHeight;
            nearBottomRef.current = true;
            setUnread(0);
          }}
          size="small"
          sx={{ alignSelf: 'center', fontSize: 10, my: 0.4 }}
        >
          {unread} new {unread === 1 ? 'message' : 'messages'}
        </Button>
      )}

      <Box sx={{ mt: chessLayout ? 0 : 1 }}>
        <Box
          sx={
            chessLayout
              ? {
                  alignItems: 'center',
                  backgroundColor: 'rgba(5, 16, 28, 0.75)',
                  border: `1px solid ${alpha('#63869d', 0.28)}`,
                  borderRadius: '7px',
                  display: 'grid',
                  gridTemplateColumns: '42px 1px minmax(0, 1fr) 42px',
                  height: 52,
                  overflow: 'hidden',
                }
              : { alignItems: 'flex-end', display: 'flex', gap: 0.5 }
          }
        >
          <Tooltip title="Add emoji">
            <span>
              <IconButton
                disabled={disabled}
                aria-label="Add emoji"
                onClick={(event) => setEmojiAnchor(event.currentTarget)}
                size="small"
                sx={{
                  color: chessLayout ? '#22d8e4' : '#9ffcff',
                  height: chessLayout ? 42 : undefined,
                  width: chessLayout ? 42 : undefined,
                }}
              >
                <EmojiEmotionsRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          {chessLayout && (
            <Box
              aria-hidden="true"
              sx={{
                backgroundColor: alpha('#63869d', 0.28),
                height: 26,
                width: 1,
              }}
            />
          )}
          <TextField
            fullWidth
            inputRef={inputRef}
            disabled={disabled}
            multiline={!chessLayout}
            maxRows={chessLayout ? undefined : 3}
            placeholder={disabled ? 'Chat unavailable' : 'Message...'}
            value={draft}
            inputProps={{
              maxLength: CHAT_LIMIT,
              'aria-label': 'Game chat message',
            }}
            onChange={(event) => {
              setDraft(event.target.value);
              onTyping(Boolean(event.target.value));
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            size="small"
            sx={
              chessLayout
                ? {
                    '& .MuiInputBase-root': {
                      background: 'transparent',
                      fontSize: 15,
                      height: 50,
                      p: 0,
                    },
                    '& .MuiInputBase-input': { px: 1.5, py: 0 },
                    '& fieldset': { border: '0 !important' },
                  }
                : undefined
            }
          />
          <Tooltip title="Send">
            <span>
              <IconButton
                disabled={disabled || !draft.trim()}
                aria-label="Send game chat message"
                onClick={submit}
                size="small"
                sx={{
                  color: chessLayout ? '#22d8e4' : '#2cf8ff',
                  height: chessLayout ? 42 : undefined,
                  width: chessLayout ? 42 : undefined,
                }}
              >
                <SendRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
        {(!chessLayout || draft.length >= 450) && (
          <Typography
            sx={{
              color: alpha('#fff', 0.34),
              fontSize: 9,
              mt: 0.3,
              textAlign: 'right',
            }}
          >
            {draft.length}/{CHAT_LIMIT}
          </Typography>
        )}
      </Box>

      <Popover
        anchorEl={emojiAnchor}
        open={Boolean(emojiAnchor)}
        onClose={() => setEmojiAnchor(null)}
        anchorOrigin={{ horizontal: 'left', vertical: 'top' }}
        transformOrigin={{ horizontal: 'left', vertical: 'bottom' }}
      >
        <Picker
          emojiStyle={EmojiStyle.NATIVE}
          height={360}
          lazyLoadEmojis
          onEmojiClick={insertEmoji}
          previewConfig={{ showPreview: false }}
          searchPlaceHolder="Search emojis"
          theme={Theme.DARK}
          width={320}
        />
      </Popover>
    </Box>
  );
}
