import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Editor } from '@tiptap/core';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { alpha, useTheme } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import { MAX_SIZE_MESSAGE } from '../../constants/constants';
import Tiptap, { type MentionSuggestionItem } from './TipTap';
import { normalizeExactReticulumMentions } from './reticulumMentionNormalization';
import { MessageItem } from './MessageItem';
import type { ReticulumChannelLinkAccess } from './MessageDisplay';
import { ReticulumGifCompressionStatus } from './ReticulumGifCompressionStatus';
import { ReticulumMessageExpiryButton } from './ReticulumMessageExpiryButton';
import {
  loadReticulumMessageExpiryPreference,
  resolveReticulumPreferredMessageExpiryDurationMs,
  saveReticulumMessageExpiryPreference,
} from './reticulumMessageExpiry';
import { ReactionPicker } from '../ReactionPicker';
import { MessageSizeLimitLip } from './MessageSizeLimitLip';

const RETICULUM_BLUE = '#2563eb';

export type ReticulumDiscussionFile = {
  base64?: string;
  fileName: string;
  filePath?: string;
  height?: number;
  isImage: boolean;
  mimeType: string;
  previewUrl?: string;
  sizeBytes: number;
  temporaryFilePath?: string;
  width?: number;
};

export type ReticulumDiscussionDraft = {
  expiryDurationMs?: number | null;
  htmlContent: string;
  messageText: Record<string, unknown>;
};

type ReticulumDiscussionDialogProps = {
  canWrite: boolean;
  channelExpiryDurationMs?: number;
  channelId: string;
  compressingGif: boolean;
  files: ReticulumDiscussionFile[];
  loading: boolean;
  membersWithNames: unknown[];
  mentionSuggestions?: MentionSuggestionItem[];
  messages: any[];
  myAddress: string;
  onClose: () => void;
  onRemoveFile: (index: number) => void;
  onSelectFiles: (files: File[]) => void | Promise<void>;
  onSend: (draft: ReticulumDiscussionDraft) => Promise<boolean>;
  onTypingChange: (active: boolean) => void;
  open: boolean;
  replyCount: number;
  reticulumGroupAvatarOwnerName?: string;
  reticulumGroupDisplayName?: string;
  reticulumMemberJoinedByAddress?: Record<string, number>;
  reticulumMemberRolesByAddress?: Record<string, 'owner' | 'admin'>;
  reticulumMemberRolesReady?: boolean;
  reticulumMentionUsers?: Record<
    string,
    { address: string; joined?: number; name: string }
  >;
  reticulumChannelLinkAccess?: ReticulumChannelLinkAccess;
  preparingFile: boolean;
  selectedGroup: number | string;
};

export const ReticulumDiscussionDialog = ({
  canWrite,
  channelExpiryDurationMs,
  channelId,
  compressingGif,
  files,
  loading,
  membersWithNames,
  mentionSuggestions,
  messages,
  myAddress,
  onClose,
  onRemoveFile,
  onSelectFiles,
  onSend,
  onTypingChange,
  open,
  replyCount,
  reticulumGroupAvatarOwnerName,
  reticulumGroupDisplayName,
  reticulumMemberJoinedByAddress,
  reticulumMemberRolesByAddress,
  reticulumMemberRolesReady = true,
  reticulumMentionUsers,
  reticulumChannelLinkAccess,
  preparingFile,
  selectedGroup,
}: ReticulumDiscussionDialogProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core', 'reticulum']);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [expiryDurationMs, setExpiryDurationMs] = useState<
    number | null | undefined
  >();
  const [formattingResetKey, setFormattingResetKey] = useState(0);
  const [focused, setFocused] = useState(false);
  const [messageSize, setMessageSize] = useState(0);
  const [messageSizeLimitShakeKey, setMessageSizeLimitShakeKey] = useState(0);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rootMessage = messages[0] || null;
  const messageById = useMemo(
    () =>
      new Map(
        messages.map((message) => [String(message?.signature || ''), message])
      ),
    [messages]
  );
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    estimateSize: () => 92,
    getItemKey: (index) =>
      String(messages[index]?.signature || `discussion-message-${index}`),
    getScrollElement: () => scrollRef.current,
    overscan: 8,
  });

  useEffect(() => {
    if (!open) {
      editor?.commands.clearContent();
      setExpiryDurationMs(undefined);
      setMessageSize(0);
      setFormattingResetKey((key) => key + 1);
      return;
    }
    const preferred = loadReticulumMessageExpiryPreference(
      myAddress,
      selectedGroup,
      channelId
    );
    setExpiryDurationMs(
      resolveReticulumPreferredMessageExpiryDurationMs(
        preferred,
        channelExpiryDurationMs
      )
    );
  }, [
    channelExpiryDurationMs,
    channelId,
    editor,
    myAddress,
    open,
    selectedGroup,
  ]);

  const handleExpiryChange = useCallback(
    (durationMs: number | null | undefined) => {
      saveReticulumMessageExpiryPreference(
        myAddress,
        selectedGroup,
        durationMs,
        channelId
      );
      setExpiryDurationMs(durationMs);
    },
    [myAddress, selectedGroup, channelId]
  );

  useEffect(() => {
    if (!open || messages.length === 0) return;
    window.requestAnimationFrame(() => {
      rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
    });
  }, [messages.length, open, rowVirtualizer]);

  const send = async () => {
    if (!canWrite || !editor || sending || preparingFile || loading) return;
    const normalizedMentions = normalizeExactReticulumMentions(
      editor.getJSON() as Record<string, unknown>,
      mentionSuggestions
    );
    if (normalizedMentions.changed) {
      editor.commands.setContent(normalizedMentions.document, false);
    }
    const htmlContent = editor.getHTML();
    const hasText = Boolean(editor.getText().trim());
    if (!hasText && files.length === 0) return;
    const messageText = editor.getJSON() as Record<string, unknown>;
    const payloadSize = JSON.stringify(messageText).length + 300;
    if (payloadSize > MAX_SIZE_MESSAGE) {
      setMessageSizeLimitShakeKey((key) => key + 1);
      return;
    }
    setSending(true);
    try {
      if (
        await onSend({
          expiryDurationMs,
          htmlContent,
          messageText,
        })
      ) {
        editor.commands.clearContent();
        setExpiryDurationMs(
          resolveReticulumPreferredMessageExpiryDurationMs(
            loadReticulumMessageExpiryPreference(
              myAddress,
              selectedGroup,
              channelId
            ),
            channelExpiryDurationMs
          )
        );
        setMessageSize(0);
        setFormattingResetKey((key) => key + 1);
      }
    } finally {
      setSending(false);
    }
  };

  const closeDisabled = sending || preparingFile;
  const sendDisabled =
    loading ||
    !canWrite ||
    closeDisabled ||
    (!editor?.getText().trim() && files.length === 0);

  return (
    <Dialog
      BackdropProps={{
        sx: {
          backdropFilter: 'blur(3px)',
          backgroundColor: 'rgba(3, 6, 12, 0.76)',
        },
      }}
      fullWidth
      maxWidth={false}
      onClose={closeDisabled ? undefined : onClose}
      open={open}
      PaperProps={{
        sx: {
          background:
            theme.palette.mode === 'dark'
              ? 'linear-gradient(180deg, rgba(15, 19, 27, 0.98) 0%, rgba(9, 12, 18, 0.98) 100%)'
              : 'linear-gradient(180deg, rgba(250, 251, 253, 0.98) 0%, rgba(242, 245, 249, 0.98) 100%)',
          border: '1px solid',
          borderColor:
            theme.palette.mode === 'dark'
              ? 'rgba(126, 139, 166, 0.2)'
              : 'rgba(38, 52, 74, 0.16)',
          borderRadius: '14px',
          boxShadow:
            theme.palette.mode === 'dark'
              ? '0 22px 70px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.02)'
              : '0 22px 70px rgba(27, 39, 58, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.72)',
          height: 'min(782px, calc(100vh - 24px))',
          m: { xs: 1, sm: 1.5 },
          maxWidth: 935,
          overflow: 'hidden',
          width: 'min(935px, calc(100vw - 32px))',
        },
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          justifyContent: 'space-between',
          minHeight: 92,
          px: '22px',
          pb: '15px',
          pt: '18px',
        }}
      >
        <Box sx={{ alignItems: 'center', display: 'flex', gap: 2 }}>
          <Box
            sx={{
              alignItems: 'center',
              backgroundColor: alpha(theme.palette.text.primary, 0.06),
              border: `1px solid ${alpha(theme.palette.text.primary, 0.12)}`,
              borderRadius: '12px',
              color: alpha(theme.palette.text.primary, 0.58),
              display: 'flex',
              height: 42,
              justifyContent: 'center',
              width: 42,
            }}
          >
            <ForumRoundedIcon sx={{ fontSize: 22 }} />
          </Box>
          <Box>
            <Typography
              sx={{
                color: 'text.primary',
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: '-0.025em',
                lineHeight: '30px',
              }}
            >
              Discussion
            </Typography>
            <Typography
              sx={{
                color: 'text.secondary',
                fontSize: 14,
                fontWeight: 500,
                lineHeight: '18px',
                mt: '2px',
              }}
            >
              {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
            </Typography>
          </Box>
        </Box>
        <IconButton
          aria-label={t('reticulum:discussion.close', {
            postProcess: 'capitalizeFirstChar',
          })}
          disabled={closeDisabled}
          onClick={closeDisabled ? undefined : onClose}
          size="small"
          sx={{
            backgroundColor: alpha(theme.palette.text.primary, 0.025),
            border: `1px solid ${alpha(theme.palette.text.primary, 0.14)}`,
            color: 'text.primary',
            height: 40,
            width: 40,
            '&:hover': {
              backgroundColor: alpha(theme.palette.text.primary, 0.07),
            },
          }}
        >
          <CloseRoundedIcon />
        </IconButton>
      </Box>

      <Box
        data-reticulum-chat-root="true"
        ref={scrollRef}
        sx={{
          '--discussion-body-text-color': theme.palette.text.primary,
          flex: 1,
          minHeight: 0,
          overflowX: 'hidden',
          overflowY: 'auto',
          py: 0,
        }}
      >
        {loading ? (
          <Box sx={{ display: 'grid', height: '100%', placeItems: 'center' }}>
            <CircularProgress size={26} />
          </Box>
        ) : messages.length === 0 ? (
          <Box sx={{ display: 'grid', height: '100%', placeItems: 'center' }}>
            <Typography sx={{ color: 'text.secondary', fontSize: 14 }}>
              This discussion is no longer available.
            </Typography>
          </Box>
        ) : (
          <Box
            sx={{
              height: rowVirtualizer.getTotalSize(),
              position: 'relative',
              width: '100%',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const index = virtualRow.index;
              const message = messages[index];
              const reply = message?.repliedTo
                ? messageById.get(String(message.repliedTo)) || rootMessage
                : null;
              return (
                <Box
                  data-index={index}
                  key={virtualRow.key}
                  ref={rowVirtualizer.measureElement}
                  sx={{
                    boxSizing: 'border-box',
                    left: 0,
                    maxWidth: '100%',
                    overflow: 'hidden',
                    px: '22px',
                    pb: index === 0 ? '24px' : '10px',
                    pt: index === 0 ? '20px' : 0,
                    position: 'absolute',
                    top: 0,
                    transform: `translateY(${virtualRow.start}px)`,
                    width: '100%',
                  }}
                >
                  {(index === 0 || index === 1) && (
                    <Typography
                      sx={{
                        color: 'text.secondary',
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: '0.11em',
                        lineHeight: '16px',
                        mb: '14px',
                        textTransform: 'uppercase',
                      }}
                    >
                      {index === 0
                        ? t('reticulum:discussion.initial_post', {
                            postProcess: 'capitalizeEachFirstChar',
                          })
                        : t('reticulum:discussion.replies', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                    </Typography>
                  )}
                  <Box
                    className={`reticulum-discussion-message ${
                      index === 0
                        ? 'reticulum-discussion-message--initial'
                        : 'reticulum-discussion-message--reply'
                    }`}
                    sx={{
                      backgroundColor:
                        index === 0
                          ? theme.palette.mode === 'dark'
                            ? '#1b1f27'
                            : '#eef2f6'
                          : theme.palette.mode === 'dark'
                            ? '#171a21'
                            : '#f5f7fa',
                      border: '1px solid',
                      borderColor:
                        index === 0
                          ? alpha(theme.palette.primary.main, 0.22)
                          : alpha(theme.palette.text.primary, 0.08),
                      borderRadius: '14px',
                      boxShadow:
                        index === 0
                          ? 'inset 0 1px 0 rgba(255, 255, 255, 0.02)'
                          : 'none',
                      maxWidth: '100%',
                      minWidth: 0,
                      overflow: 'hidden',
                      p: index === 0 ? '18px' : '16px 18px',
                    }}
                  >
                    <MessageItem
                      handleReaction={() => undefined}
                      isLast={index === messages.length - 1}
                      isPrivate={false}
                      isTemp={false}
                      isUpdating={false}
                      lastSignature={String(messages.at(-1)?.signature || '')}
                      message={message}
                      myAddress={myAddress}
                      onDelete={() => undefined}
                      onEdit={() => undefined}
                      onReply={() => undefined}
                      onSeen={() => undefined}
                      reactions={null}
                      reply={reply}
                      replyIndex={0}
                      reticulumChatEnabled
                      reticulumDiscussionRootId={String(
                        rootMessage?.signature || ''
                      )}
                      reticulumDiscussionView
                      reticulumGroupAvatarOwnerName={
                        reticulumGroupAvatarOwnerName
                      }
                      reticulumGroupDisplayName={reticulumGroupDisplayName}
                      reticulumMemberJoinedByAddress={
                        reticulumMemberJoinedByAddress
                      }
                      reticulumMemberRolesByAddress={
                        reticulumMemberRolesByAddress
                      }
                      reticulumMemberRolesReady={reticulumMemberRolesReady}
                      reticulumMentionUsers={reticulumMentionUsers}
                      reticulumChannelLinkAccess={reticulumChannelLinkAccess}
                      scrollToItem={() => undefined}
                      selectedGroup={selectedGroup}
                    />
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      <Box
        className="reticulum-discussion-composer"
        sx={{
          '--discussion-composer-field-bg':
            theme.palette.mode === 'dark' ? '#131720' : '#ffffff',
          '--discussion-composer-field-border': alpha(
            theme.palette.text.primary,
            0.16
          ),
          backgroundColor:
            theme.palette.mode === 'dark'
              ? 'rgba(15, 18, 25, 0.82)'
              : 'rgba(247, 249, 252, 0.94)',
          borderTop: '1px solid',
          borderColor: 'divider',
          p: '16px 18px',
        }}
      >
        <Box sx={{ mb: messageSize > MAX_SIZE_MESSAGE ? 1.25 : 0 }}>
          <MessageSizeLimitLip
            maximum={MAX_SIZE_MESSAGE}
            shakeKey={messageSizeLimitShakeKey}
            size={messageSize}
          />
        </Box>
        {(files.length > 0 || preparingFile) && (
          <Box
            sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1, px: 0.25 }}
          >
            {compressingGif ? (
              <ReticulumGifCompressionStatus />
            ) : preparingFile ? (
              <Box
                sx={{ alignItems: 'center', display: 'flex', gap: 1, px: 0.5 }}
              >
                <CircularProgress size={16} />
                <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>
                  Preparing attachment…
                </Typography>
              </Box>
            ) : null}
            {files.map((file, index) => (
              <Box
                key={`${file.fileName}-${index}`}
                sx={{
                  alignItems: 'center',
                  backgroundColor: alpha(
                    theme.palette.background.default,
                    0.72
                  ),
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: '8px',
                  display: 'flex',
                  gap: 1,
                  maxWidth: 280,
                  minHeight: 48,
                  p: 0.75,
                }}
              >
                {file.previewUrl ? (
                  <Box
                    component="img"
                    src={file.previewUrl}
                    sx={{
                      borderRadius: '5px',
                      height: 36,
                      objectFit: 'cover',
                      width: 36,
                    }}
                  />
                ) : file.isImage ? (
                  <ImageRoundedIcon sx={{ color: 'text.secondary' }} />
                ) : (
                  <InsertDriveFileRoundedIcon
                    sx={{ color: 'text.secondary' }}
                  />
                )}
                <Typography
                  sx={{
                    flex: 1,
                    fontSize: 12,
                    fontWeight: 600,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {file.fileName}
                </Typography>
                <Tooltip
                  title={t('reticulum:discussion.remove_attachment', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                >
                  <IconButton
                    aria-label={t('reticulum:discussion.remove_file', {
                      fileName: file.fileName,
                      postProcess: 'capitalizeFirstChar',
                    })}
                    onClick={() => onRemoveFile(index)}
                    size="small"
                  >
                    <CloseRoundedIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            ))}
          </Box>
        )}

        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: 1,
            minHeight: 44,
          }}
        >
          <Tiptap
            collapseFormattingTraySignal={formattingResetKey}
            compactChat
            disableEnter={!canWrite || loading || closeDisabled}
            enableMentions
            insertFiles={onSelectFiles}
            isChat
            isFocusedParent={focused}
            membersWithNames={membersWithNames}
            mentionSuggestions={mentionSuggestions}
            onContentUpdate={(nextEditor) => {
              setMessageSize(JSON.stringify(nextEditor.getJSON()).length + 300);
              onTypingChange(Boolean(nextEditor.getText().trim()));
            }}
            onEnter={send}
            placeholder={t('reticulum:discussion.reply_placeholder', {
              postProcess: 'capitalizeFirstChar',
            })}
            setEditorRef={setEditor}
            setIsFocusedParent={setFocused}
          />
          <Tooltip
            title={t('reticulum:discussion.choose_emoji', {
              postProcess: 'capitalizeFirstChar',
            })}
          >
            <Box
              sx={{
                alignItems: 'center',
                display: 'inline-flex',
                flexShrink: 0,
                justifyContent: 'center',
              }}
            >
              <ReactionPicker
                compactComposer
                neutralIcon
                onReaction={(emoji: string) => {
                  editor?.chain().focus().insertContent(emoji).run();
                }}
              />
            </Box>
          </Tooltip>
          <Box
            sx={{
              alignItems: 'stretch',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: '10px',
              display: 'inline-flex',
              flexShrink: 0,
              height: 38,
              overflow: 'hidden',
            }}
          >
            <ReticulumMessageExpiryButton
              channelExpiryDurationMs={channelExpiryDurationMs}
              disabled={loading || closeDisabled}
              disabledReason={t('reticulum:discussion.wait_until_ready', {
                postProcess: 'capitalizeFirstChar',
              })}
              onChange={handleExpiryChange}
              segmented
              value={expiryDurationMs}
            />
            <Button
              disabled={sendDisabled}
              onClick={() => void send()}
              startIcon={
                sending ? (
                  <CircularProgress color="inherit" size={16} />
                ) : (
                  <SendRoundedIcon sx={{ fontSize: 18 }} />
                )
              }
              sx={{
                backgroundColor: RETICULUM_BLUE,
                borderRadius: 0,
                color: 'common.white',
                flexShrink: 0,
                fontWeight: 650,
                height: 38,
                minWidth: 82,
                px: '14px',
                textTransform: 'none',
                '&:hover': { backgroundColor: '#1e40af' },
                '&.Mui-focusVisible': {
                  boxShadow: (theme) =>
                    `inset 0 0 0 2px ${theme.palette.common.white}`,
                },
              }}
              variant="contained"
            >
              Send
            </Button>
          </Box>
        </Box>
        {!canWrite && (
          <Typography
            sx={{ color: 'text.secondary', fontSize: 11.5, mt: 0.5, pl: 0.5 }}
          >
            Only group admins can write in this channel.
          </Typography>
        )}
        {messageSize >= 3200 && (
          <Typography
            sx={{
              color:
                messageSize > MAX_SIZE_MESSAGE
                  ? 'error.main'
                  : 'text.secondary',
              fontSize: 11,
              mt: 0.5,
              pl: 0.5,
            }}
          >
            {messageSize} / {MAX_SIZE_MESSAGE} bytes
          </Typography>
        )}
      </Box>
    </Dialog>
  );
};
