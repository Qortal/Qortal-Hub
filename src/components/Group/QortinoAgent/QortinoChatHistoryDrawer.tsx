import {
  Box,
  ClickAwayListener,
  IconButton,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  UNTITLED_CHAT_TITLE,
  type QortinoChatSession,
} from '../../../qortinoAgent/chatHistoryStore';

type Props = {
  open: boolean;
  onClose: () => void;
  sessions: QortinoChatSession[];
  activeId: string | null;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
};

/**
 * Qortino's chats, in a list that slides over the left of its panel. A click
 * outside it or Escape closes it.
 */
export function QortinoChatHistoryDrawer({
  open,
  onClose,
  sessions,
  activeId,
  onNewChat,
  onSelect,
  onRename,
  onTogglePin,
  onDelete,
}: Props) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const isDark = theme.palette.mode === 'dark';
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !editingId) {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editingId, onClose, open]);

  const titleOf = (session: QortinoChatSession) =>
    !session.titleCustom && session.title === UNTITLED_CHAT_TITLE
      ? t('core:qortino_agent.aria.new_chat')
      : session.title;

  /** An empty or unchanged name keeps the chat titled from its question. */
  const finishRename = (session: QortinoChatSession) => {
    const next = draft.trim();
    if (next && next !== titleOf(session)) onRename(session.id, next);
    setEditingId(null);
  };

  if (!open) return null;

  return (
    <Box
      sx={{
        background: alpha('#000', isDark ? 0.35 : 0.16),
        inset: 0,
        position: 'absolute',
        zIndex: 20,
        '@keyframes qortinoHistoryIn': {
          from: { opacity: 0, transform: 'translateX(-24px)' },
          to: { opacity: 1, transform: 'translateX(0)' },
        },
      }}
    >
      <ClickAwayListener onClickAway={onClose}>
        <Box
          role="dialog"
          aria-label={t('core:qortino_agent.aria.history')}
          sx={{
            animation: 'qortinoHistoryIn 160ms ease-out',
            background: isDark ? '#10131a' : '#f7f9fc',
            borderRight: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
            bottom: 0,
            boxShadow: `12px 0 32px ${alpha('#000', isDark ? 0.4 : 0.14)}`,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            left: 0,
            maxWidth: '86%',
            position: 'absolute',
            top: 0,
            width: 320,
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              borderBottom: `1px solid ${alpha(theme.palette.divider, 0.55)}`,
              display: 'flex',
              gap: 0.5,
              px: 1.25,
              py: 1,
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: '1rem', fontWeight: 800 }}>
                {t('core:qortino_agent.aria.history')}
              </Typography>
            </Box>
            <IconButton
              aria-label={t('core:qortino_agent.aria.new_chat')}
              size="small"
              onClick={() => {
                onNewChat();
                onClose();
              }}
              sx={{
                background: alpha('#7EB6FF', isDark ? 0.22 : 0.16),
                borderRadius: '10px',
              }}
            >
              <AddRoundedIcon fontSize="small" />
            </IconButton>
            <IconButton
              aria-label={t('core:qortino_agent.history.close')}
              size="small"
              onClick={onClose}
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Box>

          <Box
            sx={{
              display: 'flex',
              flex: 1,
              flexDirection: 'column',
              gap: 0.5,
              minHeight: 0,
              overflowY: 'auto',
              p: 1,
            }}
          >
            {!sessions.length ? (
              <Typography
                sx={{
                  color: alpha(theme.palette.text.primary, 0.55),
                  fontSize: '0.85rem',
                  px: 0.5,
                  py: 1.5,
                }}
              >
                {t('core:qortino_agent.history.empty')}
              </Typography>
            ) : null}
            {sessions.map((s) => {
              const active = s.id === activeId;
              const editing = editingId === s.id;
              return (
                <Box
                  key={s.id}
                  sx={{
                    background: active
                      ? alpha('#7EB6FF', isDark ? 0.22 : 0.14)
                      : alpha(
                          theme.palette.background.paper,
                          isDark ? 0.35 : 0.7
                        ),
                    border: `1px solid ${
                      active
                        ? alpha('#7EB6FF', 0.55)
                        : alpha(theme.palette.divider, 0.45)
                    }`,
                    borderRadius: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.45,
                    p: 0.75,
                  }}
                >
                  {editing ? (
                    <TextField
                      autoFocus
                      fullWidth
                      size="small"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing) return;
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          finishRename(s);
                        } else if (e.key === 'Escape') {
                          // Only the rename: the panel must not close too.
                          e.preventDefault();
                          e.stopPropagation();
                          setEditingId(null);
                        }
                      }}
                      onBlur={() => finishRename(s)}
                      inputProps={{ maxLength: 80 }}
                    />
                  ) : (
                    <Box
                      component="button"
                      type="button"
                      onClick={() => {
                        onSelect(s.id);
                        onClose();
                      }}
                      onDoubleClick={() => {
                        setEditingId(s.id);
                        setDraft(titleOf(s));
                      }}
                      sx={{
                        appearance: 'none',
                        background: 'transparent',
                        border: 'none',
                        color: 'inherit',
                        cursor: 'pointer',
                        fontSize: '0.86rem',
                        fontWeight: active ? 800 : 600,
                        p: 0,
                        textAlign: 'left',
                        width: '100%',
                        wordBreak: 'break-word',
                      }}
                    >
                      {s.pinned ? '📌 ' : ''}
                      {titleOf(s)}
                    </Box>
                  )}
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: 0.15,
                      justifyContent: 'flex-end',
                    }}
                  >
                    <IconButton
                      aria-label={t(
                        s.pinned
                          ? 'core:qortino_agent.history.unpin'
                          : 'core:qortino_agent.history.pin'
                      )}
                      size="small"
                      onClick={() => onTogglePin(s.id)}
                    >
                      {s.pinned ? (
                        <PushPinRoundedIcon sx={{ fontSize: 18 }} />
                      ) : (
                        <PushPinOutlinedIcon sx={{ fontSize: 18 }} />
                      )}
                    </IconButton>
                    <IconButton
                      aria-label={t('core:qortino_agent.history.rename_chat')}
                      size="small"
                      onClick={() => {
                        setEditingId(s.id);
                        setDraft(titleOf(s));
                      }}
                      sx={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        borderRadius: 0,
                      }}
                    >
                      <Typography sx={{ fontSize: '0.68rem', fontWeight: 800 }}>
                        {t('core:qortino_agent.history.rename')}
                      </Typography>
                    </IconButton>
                    <IconButton
                      aria-label={t('core:qortino_agent.history.delete_chat')}
                      size="small"
                      onClick={() => onDelete(s.id)}
                    >
                      <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      </ClickAwayListener>
    </Box>
  );
}
