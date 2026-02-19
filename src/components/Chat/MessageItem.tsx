import {
  memo,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useInView } from 'react-intersection-observer';
import { MessageDisplay } from './MessageDisplay';
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  List,
  ListItem,
  ListItemText,
  Popover,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { formatTimestamp } from '../../utils/time';
import { QORTAL_APP_CONTEXT, getBaseApiReact } from '../../App';
import { generateHTML } from '@tiptap/react';
import Highlight from '@tiptap/extension-highlight';
import Mention from '@tiptap/extension-mention';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { WrapperUserAction } from '../WrapperUserAction';
import ReplyIcon from '@mui/icons-material/Reply';
import { ReactionPicker } from '../ReactionPicker';
import KeyOffIcon from '@mui/icons-material/KeyOff';
import EditIcon from '@mui/icons-material/Edit';
import TextStyle from '@tiptap/extension-text-style';
import level0Img from '../../assets/badges/level-0.png';
import level1Img from '../../assets/badges/level-1.png';
import level2Img from '../../assets/badges/level-2.png';
import level3Img from '../../assets/badges/level-3.png';
import level4Img from '../../assets/badges/level-4.png';
import level5Img from '../../assets/badges/level-5.png';
import level6Img from '../../assets/badges/level-6.png';
import level7Img from '../../assets/badges/level-7.png';
import level8Img from '../../assets/badges/level-8.png';
import level9Img from '../../assets/badges/level-9.png';
import level10Img from '../../assets/badges/level-10.png';
import { Embed } from '../Embeds/Embed';
import CommentsDisabledIcon from '@mui/icons-material/CommentsDisabled';
import {
  buildImageEmbedLink,
  isHtmlString,
  messageHasImage,
} from '../../utils/chat';
import { useTranslation } from 'react-i18next';
import { ReactionsMap } from './ChatList';
import { AvatarPreviewModal } from '../Chat/AvatarPreviewModal';
import { getClickableAvatarSx } from './clickableAvatarStyles';

const getBadgeImg = (level) => {
  switch (level?.toString()) {
    case '0':
      return level0Img;
    case '1':
      return level1Img;
    case '2':
      return level2Img;
    case '3':
      return level3Img;
    case '4':
      return level4Img;
    case '5':
      return level5Img;
    case '6':
      return level6Img;
    case '7':
      return level7Img;
    case '8':
      return level8Img;
    case '9':
      return level9Img;
    case '10':
      return level10Img;
    default:
      return level0Img;
  }
};

const UserBadge = memo(({ userInfo }) => {
  return (
    <Tooltip disableFocusListener title={`level ${userInfo ?? 0}`}>
      <img
        style={{
          visibility: userInfo !== undefined ? 'visible' : 'hidden',
          width: '30px',
          height: 'auto',
        }}
        src={getBadgeImg(userInfo)}
      />
    </Tooltip>
  );
});

type MessageItemProps = {
  handleReaction: (reaction: string, messageId: string) => void;
  isLast: boolean;
  isPrivate: boolean;
  isScrollTarget?: boolean;
  isShowingAsReply?: boolean;
  isTemp: boolean;
  isUpdating: boolean;
  lastSignature: string;
  message: string;
  myAddress: string;
  onEdit: (messageId: string) => void;
  onReply: (messageId: string) => void;
  onSeen: () => void;
  reactions: ReactionsMap | null;
  reply: string | null;
  replyIndex: number;
  replyExpiredMeta?: any;
  scrollToItem: (index: number) => void;
};

export const MessageItemComponent = ({
  handleReaction,
  isLast,
  isPrivate,
  isScrollTarget,
  isShowingAsReply,
  isTemp,
  isUpdating,
  lastSignature,
  message,
  myAddress,
  onEdit,
  onReply,
  onSeen,
  reactions,
  reply,
  replyIndex,
  replyExpiredMeta,
  scrollToItem,
}: MessageItemProps) => {
  const { getIndividualUserInfo } = useContext(QORTAL_APP_CONTEXT);
  const [anchorEl, setAnchorEl] = useState(null);
  const [selectedReaction, setSelectedReaction] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [isAvatarPreviewOpen, setIsAvatarPreviewOpen] = useState(false);
  const [avatarPreviewSrc, setAvatarPreviewSrc] = useState(null);
  const [isAvatarLoaded, setIsAvatarLoaded] = useState(false);

  useEffect(() => {
    const getInfo = async () => {
      if (!message?.sender) return;
      try {
        const res = await getIndividualUserInfo(message?.sender);
        if (!res) return null;
        setUserInfo(res);
      } catch (error) {
        //
      }
    };

    getInfo();
  }, [message?.sender, getIndividualUserInfo]);

  // Defer only main message body so generateHTML runs when React has time (reduces scroll-time CPU spikes).
  // Reply block uses reply/replyExpiredMeta directly so the reply preview always shows.
  const deferredMessage = useDeferredValue(message);

  const htmlText = useMemo(() => {
    const source = deferredMessage?.messageText;
    if (source) {
      const isHtml = isHtmlString(source);
      if (isHtml) return source;
      return generateHTML(source, [
        StarterKit,
        Underline,
        Highlight,
        Mention,
        TextStyle,
      ]);
    }
  }, [deferredMessage?.messageText, deferredMessage?.editTimestamp]);

  const htmlReply = useMemo(() => {
    const source = reply?.messageText;
    if (source) {
      const isHtml = isHtmlString(source);
      if (isHtml) return source;
      return generateHTML(source, [
        StarterKit,
        Underline,
        Highlight,
        Mention,
        TextStyle,
      ]);
    }
  }, [reply?.messageText, reply?.editTimestamp]);

  const htmlReplyExpired = useMemo(() => {
    if (!replyExpiredMeta) return null;
    const source = replyExpiredMeta?.messageText;
    if (source) {
      const isHtml = isHtmlString(source);
      if (isHtml) return source;
      return generateHTML(source, [
        StarterKit,
        Underline,
        Highlight,
        Mention,
        TextStyle,
      ]);
    }
    return null;
  }, [replyExpiredMeta?.messageText, replyExpiredMeta?.editTimestamp]);

  const userAvatarUrl = useMemo(() => {
    return message?.senderName
      ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${
          message?.senderName
        }/qortal_avatar?async=true`
      : '';
  }, [message?.senderName]);

  useEffect(() => {
    setIsAvatarLoaded(false);
  }, [userAvatarUrl]);

  const handleAvatarPreview = useCallback(
    (event) => {
      if (!userAvatarUrl || !isAvatarLoaded) return;
      event.preventDefault();
      event.stopPropagation();
      setAvatarPreviewSrc(userAvatarUrl);
      setIsAvatarPreviewOpen(true);
    },
    [isAvatarLoaded, setAvatarPreviewSrc, setIsAvatarPreviewOpen, userAvatarUrl]
  );

  const closeAvatarPreview = useCallback(() => {
    setIsAvatarPreviewOpen(false);
    setAvatarPreviewSrc(null);
  }, [setIsAvatarPreviewOpen, setAvatarPreviewSrc]);

  const onSeenFunc = useCallback(() => {
    onSeen(message.id);
  }, [message?.id]);

  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const hasNoMessage =
    (!message.decryptedData?.data?.message ||
      message.decryptedData?.data?.message === '<p></p>') &&
    (message?.images || [])?.length === 0 &&
    (!message?.messageText || message?.messageText === '<p></p>') &&
    (!message?.text || message?.text === '<p></p>');

  return (
    <>
      {message?.divide && (
        <div className="unread-divider" id="unread-divider-id">
          {t('core:message.generic.unread_messages', {
            postProcess: 'capitalizeFirstChar',
          })}
        </div>
      )}

      <MessageWragger
        lastMessage={lastSignature === message?.signature}
        isLast={isLast}
        onSeen={onSeenFunc}
      >
        <Box
          className="message-item-row"
          sx={{
            display: 'flex',
            gap: '12px',
            opacity: isTemp || isUpdating ? 0.5 : 1,
            padding: isShowingAsReply ? '4px 8px' : '4px 16px',
            position: 'relative',
            transition: 'background-color 0.1s ease, box-shadow 0.25s ease',
            width: '100%',
            ...(isScrollTarget && {
              backgroundColor: alpha(theme.palette.primary.main, 0.08),
              boxShadow: `inset 3px 0 0 0 ${theme.palette.primary.main}, inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.2)}`,
            }),
            ...(!isShowingAsReply && {
              '&:hover': {
                backgroundColor: alpha(theme.palette.text.primary, 0.04),
              },
              '& .message-item-toolbar': {
                opacity: 0,
                pointerEvents: 'none',
              },
              '&:hover .message-item-toolbar': {
                opacity: 1,
                pointerEvents: 'auto',
              },
            }),
          }}
          id={message?.signature}
        >
          {/* Left column: avatar + badge */}
          {isShowingAsReply ? (
            <ReplyIcon
              sx={{
                color: theme.palette.text.secondary,
                flexShrink: 0,
                fontSize: '18px',
                mt: '2px',
              }}
            />
          ) : (
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexDirection: 'column',
                flexShrink: 0,
                gap: '4px',
                paddingTop: '2px',
              }}
            >
              <WrapperUserAction
                disabled={myAddress === message?.sender}
                address={message?.sender}
                name={message?.senderName}
              >
                <Avatar
                  sx={{
                    backgroundColor: theme.palette.background.default,
                    border: '2px solid',
                    borderColor: 'divider',
                    color: theme.palette.text.primary,
                    height: '40px',
                    width: '40px',
                    ...getClickableAvatarSx(theme, isAvatarLoaded),
                  }}
                  alt={message?.senderName}
                  src={userAvatarUrl}
                  onClick={handleAvatarPreview}
                  imgProps={{
                    onLoad: () => {
                      setIsAvatarLoaded(true);
                    },
                    onError: () => {
                      setIsAvatarLoaded(false);
                    },
                  }}
                >
                  {message?.senderName?.charAt(0)}
                </Avatar>
              </WrapperUserAction>
              <UserBadge userInfo={userInfo} />
            </Box>
          )}

          {/* Right column: header + body + reactions */}
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              height: isShowingAsReply ? '40px' : undefined,
              minWidth: 0,
              width: '100%',
            }}
          >
            {/* Header: sender name + timestamp + edited label inline */}
            <Box
              sx={{
                alignItems: 'baseline',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <WrapperUserAction
                disabled={myAddress === message?.sender}
                address={message?.sender}
                name={message?.senderName}
              >
                <Typography
                  sx={{
                    fontFamily: 'Inter',
                    fontSize: '15px',
                    fontWeight: 700,
                    lineHeight: 1.3,
                  }}
                >
                  {message?.senderName || message?.sender}
                </Typography>
              </WrapperUserAction>

              {!isUpdating && !isTemp && (
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    flexShrink: 0,
                    fontFamily: 'Inter',
                    fontSize: '11px',
                    lineHeight: 1,
                  }}
                >
                  {formatTimestamp(message.timestamp)}
                </Typography>
              )}

              {message?.isEdit && !isUpdating && !isTemp && (
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    fontFamily: 'Inter',
                    fontSize: '11px',
                    fontStyle: 'italic',
                    lineHeight: 1,
                  }}
                >
                  {t('core:message.generic.edited', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
              )}
            </Box>

            {/* Reply preview - active reply */}
            {reply && (
              <Box
                sx={{
                  backgroundColor: theme.palette.background.surface,
                  border: '1px solid',
                  borderColor: theme.palette.divider,
                  borderRadius: '0 8px 8px 0',
                  cursor: 'pointer',
                  display: 'flex',
                  marginTop: '6px',
                  marginBottom: '8px',
                  marginLeft: '12px',
                  maxHeight: '72px',
                  overflow: 'hidden',
                  transition:
                    'background-color 0.15s ease, border-color 0.15s ease',
                  width: '100%',
                  '&:hover': {
                    backgroundColor: theme.palette.action.hover,
                    borderColor: theme.palette.text.secondary,
                  },
                }}
                onClick={() => {
                  scrollToItem(replyIndex);
                }}
              >
                <Box
                  sx={{
                    background: theme.palette.primary.main,
                    borderRadius: '4px 0 0 4px',
                    flexShrink: 0,
                    opacity: 0.7,
                    width: '3px',
                  }}
                />
                <Box sx={{ padding: '8px 12px', minWidth: 0 }}>
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: '6px',
                      marginBottom: '4px',
                    }}
                  >
                    <ReplyIcon
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: '14px',
                        flexShrink: 0,
                      }}
                    />
                    <Typography
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: '11px',
                        fontWeight: 600,
                        letterSpacing: '0.02em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {t('core:message.generic.replied_to', {
                        person: reply?.senderName || reply?.senderAddress,
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Typography>
                  </Box>

                  {reply?.messageText && (
                    <MessageDisplay isReply htmlContent={htmlReply} />
                  )}

                  {reply?.decryptedData?.type === 'notification' ? (
                    <MessageDisplay
                      isReply
                      htmlContent={reply.decryptedData?.data?.message}
                    />
                  ) : (
                    <MessageDisplay isReply htmlContent={reply.text} />
                  )}
                </Box>
              </Box>
            )}

            {/* Reply preview - expired/missing reply */}
            {!reply && (replyExpiredMeta || message?.repliedTo) && (
              <Box
                sx={{
                  backgroundColor: theme.palette.background.surface,
                  border: '1px solid',
                  borderColor: theme.palette.divider,
                  borderRadius: '0 8px 8px 0',
                  display: 'flex',
                  marginTop: '6px',
                  marginBottom: '8px',
                  marginLeft: '12px',
                  maxHeight: '72px',
                  overflow: 'hidden',
                  width: '100%',
                }}
              >
                <Box
                  sx={{
                    background: theme.palette.text.secondary,
                    borderRadius: '4px 0 0 4px',
                    flexShrink: 0,
                    opacity: 0.5,
                    width: '3px',
                  }}
                />
                <Box sx={{ padding: '8px 12px', minWidth: 0 }}>
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: '6px',
                      marginBottom: '4px',
                    }}
                  >
                    <ReplyIcon
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: '14px',
                        flexShrink: 0,
                      }}
                    />
                    <Typography
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: '11px',
                        fontWeight: 600,
                        letterSpacing: '0.02em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {replyExpiredMeta?.senderName || replyExpiredMeta?.sender
                        ? t('core:message.generic.replied_to', {
                            person:
                              replyExpiredMeta?.senderName ||
                              replyExpiredMeta?.sender,
                            postProcess: 'capitalizeFirstChar',
                          })
                        : t('core:message.generic.replied_to', {
                            person: t('core:message.error.missing_fields', {
                              fields: t('core:message.message'),
                            }),
                            postProcess: 'capitalizeFirstChar',
                          })}
                    </Typography>
                  </Box>

                  {replyExpiredMeta?.messageText && (
                    <MessageDisplay isReply htmlContent={htmlReplyExpired} />
                  )}

                  {replyExpiredMeta?.text && (
                    <MessageDisplay
                      isReply
                      htmlContent={replyExpiredMeta.text}
                    />
                  )}
                </Box>
              </Box>
            )}

            {/* Message body - show only one of htmlText or message.text to avoid duplicate for open groups */}
            {message?.decryptedData?.type === 'notification' ? (
              <MessageDisplay
                htmlContent={message.decryptedData?.data?.message}
              />
            ) : hasNoMessage ? null : htmlText ? (
              <MessageDisplay htmlContent={htmlText} />
            ) : (
              <MessageDisplay htmlContent={message.text} />
            )}

            {hasNoMessage && (
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: '8px',
                }}
              >
                <CommentsDisabledIcon
                  color="primary"
                  sx={{ fontSize: '18px' }}
                />
                <Typography color="primary" sx={{ fontSize: '14px' }}>
                  {t('core:message.generic.no_message', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
              </Box>
            )}

            {message?.images && messageHasImage(message) && (
              <Embed embedLink={buildImageEmbedLink(message.images[0])} />
            )}

            {/* Sending / updating status */}
            {(isUpdating || isTemp) && (
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  fontFamily: 'Inter',
                  fontSize: '12px',
                  fontStyle: 'italic',
                  marginTop: '2px',
                }}
              >
                {isUpdating
                  ? message?.status === 'failed-permanent'
                    ? t('core:message.error.update_failed', {
                        postProcess: 'capitalizeFirstChar',
                      })
                    : t('core:message.generic.updating', {
                        postProcess: 'capitalizeFirstChar',
                      })
                  : message?.status === 'failed-permanent'
                    ? t('core:message.error.send_failed', {
                        postProcess: 'capitalizeFirstChar',
                      })
                    : t('core:message.generic.sending', {
                        postProcess: 'capitalizeFirstChar',
                      })}
              </Typography>
            )}

            {/* Reactions row */}
            {reactions &&
              Object.keys(reactions).some(
                (r) => (reactions[r]?.length ?? 0) > 0
              ) && (
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '4px',
                    marginTop: '4px',
                  }}
                >
                  {message?.isNotEncrypted && isPrivate && (
                    <Tooltip title="Unencrypted" disableFocusListener>
                      <KeyOffIcon
                        sx={{
                          color: theme.palette.text.secondary,
                          fontSize: '16px',
                          mr: '4px',
                        }}
                      />
                    </Tooltip>
                  )}

                  {Object.keys(reactions).map((reaction) => {
                    const numberOfReactions = reactions[reaction]?.length;
                    if (numberOfReactions === 0) return null;
                    const isMine = !!reactions[reaction]?.find(
                      (item) => item?.sender === myAddress
                    );
                    return (
                      <ButtonBase
                        key={reaction}
                        sx={{
                          background: isMine
                            ? `${theme.palette.primary.main}22`
                            : theme.palette.background.surface,
                          border: '1px solid',
                          borderColor: isMine
                            ? theme.palette.primary.main
                            : theme.palette.divider,
                          borderRadius: '14px',
                          height: '28px',
                          minWidth: '44px',
                          padding: '0 10px',
                          transition:
                            'background-color 0.1s ease, border-color 0.1s ease',
                          '&:hover': {
                            backgroundColor: theme.palette.action.hover,
                          },
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          setAnchorEl(event.currentTarget);
                          setSelectedReaction(reaction);
                        }}
                      >
                        <span style={{ fontSize: '14px', lineHeight: 1 }}>
                          {reaction}
                        </span>
                        {numberOfReactions > 1 && (
                          <Typography
                            sx={{
                              color: isMine
                                ? theme.palette.primary.main
                                : theme.palette.text.secondary,
                              fontFamily: 'Inter',
                              fontSize: '12px',
                              fontWeight: 600,
                              marginLeft: '4px',
                            }}
                          >
                            {numberOfReactions}
                          </Typography>
                        )}
                      </ButtonBase>
                    );
                  })}
                </Box>
              )}

            {/* KeyOff when no reactions to show it beside */}
            {message?.isNotEncrypted &&
              isPrivate &&
              !(
                reactions &&
                Object.keys(reactions).some(
                  (r) => (reactions[r]?.length ?? 0) > 0
                )
              ) && (
                <Tooltip title="Unencrypted" disableFocusListener>
                  <KeyOffIcon
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '16px',
                      marginTop: '2px',
                    }}
                  />
                </Tooltip>
              )}

            {/* Reaction popover */}
            {selectedReaction && (
              <Popover
                open={Boolean(anchorEl)}
                anchorEl={anchorEl}
                onClose={() => {
                  setAnchorEl(null);
                  setSelectedReaction(null);
                }}
                anchorOrigin={{
                  vertical: 'top',
                  horizontal: 'center',
                }}
                transformOrigin={{
                  vertical: 'bottom',
                  horizontal: 'center',
                }}
                slotProps={{
                  paper: {
                    sx: {
                      backgroundColor: theme.palette.background.paper,
                      border: '1px solid',
                      borderColor: theme.palette.divider,
                      borderRadius: '12px',
                      boxShadow: theme.shadows[8],
                      minWidth: '260px',
                      maxWidth: '320px',
                    },
                  },
                }}
              >
                <Box sx={{ padding: '16px 16px 12px' }}>
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: '8px',
                      marginBottom: '12px',
                    }}
                  >
                    <Box
                      sx={{
                        alignItems: 'center',
                        backgroundColor: theme.palette.action.hover,
                        borderRadius: '8px',
                        display: 'flex',
                        fontSize: '18px',
                        height: '36px',
                        justifyContent: 'center',
                        width: '36px',
                      }}
                    >
                      {selectedReaction}
                    </Box>
                    <Typography
                      sx={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: theme.palette.text.primary,
                      }}
                    >
                      {t('core:message.generic.people_reaction', {
                        reaction: selectedReaction,
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Typography>
                  </Box>

                  <List
                    disablePadding
                    sx={{
                      maxHeight: '240px',
                      overflow: 'auto',
                      marginBottom: '12px',
                    }}
                  >
                    {reactions[selectedReaction]?.map((reactionItem) => (
                      <ListItem
                        key={reactionItem.sender}
                        disablePadding
                        sx={{
                          borderRadius: '8px',
                          marginBottom: '2px',
                          '&:last-of-type': { marginBottom: 0 },
                          '&:hover': {
                            backgroundColor: theme.palette.action.hover,
                          },
                        }}
                      >
                        <ListItemText
                          primary={
                            reactionItem.senderName || reactionItem.sender
                          }
                          primaryTypographyProps={{
                            fontSize: '14px',
                            fontWeight: 500,
                          }}
                          sx={{ py: '8px', px: '12px' }}
                        />
                      </ListItem>
                    ))}
                  </List>

                  <Button
                    variant="contained"
                    color="primary"
                    fullWidth
                    onClick={() => {
                      if (
                        reactions[selectedReaction]?.find(
                          (item) => item?.sender === myAddress
                        )
                      ) {
                        handleReaction(selectedReaction, message, false);
                      } else {
                        handleReaction(selectedReaction, message, true);
                      }
                      setAnchorEl(null);
                      setSelectedReaction(null);
                    }}
                    sx={{
                      borderRadius: '8px',
                      fontWeight: 600,
                      padding: '8px 16px',
                      textTransform: 'none',
                    }}
                  >
                    {reactions[selectedReaction]?.find(
                      (item) => item?.sender === myAddress
                    )
                      ? t('core:action.remove_reaction', {
                          postProcess: 'capitalizeFirstChar',
                        })
                      : t('core:action.add_reaction', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                  </Button>
                </Box>
              </Popover>
            )}
          </Box>

          {/* Floating action toolbar — visible on hover (via CSS so only one row is hovered) */}
          {!isShowingAsReply && (
            <Box
              className="message-item-toolbar"
              sx={{
                alignItems: 'center',
                backgroundColor: theme.palette.background.paper,
                border: '1px solid',
                borderColor: theme.palette.divider,
                borderRadius: '8px',
                boxShadow: theme.shadows[2],
                display: 'flex',
                gap: '2px',
                padding: '3px 6px',
                position: 'absolute',
                right: '16px',
                top: '4px',
                transition: 'opacity 0.15s ease',
                zIndex: 2,
              }}
            >
              {message?.sender === myAddress &&
                (!message?.isNotEncrypted || isPrivate === false) && (
                  <Tooltip title="Edit" disableFocusListener>
                    <ButtonBase
                      sx={{
                        borderRadius: '6px',
                        color: theme.palette.text.secondary,
                        padding: '4px',
                        '&:hover': {
                          backgroundColor: theme.palette.action.hover,
                          color: theme.palette.text.primary,
                        },
                      }}
                      onClick={() => {
                        onEdit(message);
                      }}
                    >
                      <EditIcon sx={{ fontSize: '18px' }} />
                    </ButtonBase>
                  </Tooltip>
                )}

              <Tooltip title="Reply" disableFocusListener>
                <ButtonBase
                  sx={{
                    borderRadius: '6px',
                    color: theme.palette.text.secondary,
                    padding: '4px',
                    '&:hover': {
                      backgroundColor: theme.palette.action.hover,
                      color: theme.palette.text.primary,
                    },
                  }}
                  onClick={() => {
                    onReply(message);
                  }}
                >
                  <ReplyIcon sx={{ fontSize: '18px' }} />
                </ButtonBase>
              </Tooltip>

              {handleReaction && (
                <ReactionPicker
                  onReaction={(val) => {
                    if (
                      reactions &&
                      reactions[val] &&
                      reactions[val]?.find((item) => item?.sender === myAddress)
                    ) {
                      handleReaction(val, message, false);
                    } else {
                      handleReaction(val, message, true);
                    }
                  }}
                />
              )}
            </Box>
          )}
        </Box>
        <AvatarPreviewModal
          open={isAvatarPreviewOpen}
          src={avatarPreviewSrc}
          alt={message?.senderName}
          onClose={closeAvatarPreview}
        />
      </MessageWragger>
    </>
  );
};

const MemoizedMessageItem = memo(MessageItemComponent);
MemoizedMessageItem.displayName = 'MessageItem'; // It ensures React DevTools shows MessageItem as the name (instead of "Anonymous" or "Memo")

export const MessageItem = MemoizedMessageItem;

export const ReplyPreview = ({ message, isEdit = false }) => {
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const replyMessageText = useMemo(() => {
    if (!message?.messageText) return null;
    const isHtml = isHtmlString(message?.messageText);
    if (isHtml) return message?.messageText;
    return generateHTML(message?.messageText, [
      StarterKit,
      Underline,
      Highlight,
      Mention,
      TextStyle,
    ]);
  }, [message?.messageText]);

  return (
    <Box
      sx={{
        backgroundColor: theme.palette.background.surface,
        border: '1px solid',
        borderColor: theme.palette.divider,
        borderRadius: '0 8px 8px 0',
        cursor: 'pointer',
        display: 'flex',
        marginTop: '8px',
        maxHeight: '72px',
        overflow: 'hidden',
        width: '100%',
      }}
    >
      <Box
        sx={{
          background: theme.palette.primary.main,
          borderRadius: '4px 0 0 4px',
          flexShrink: 0,
          width: '4px',
        }}
      />
      <Box sx={{ padding: '8px 12px', minWidth: 0 }}>
        {isEdit ? (
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: '6px',
              marginBottom: '4px',
            }}
          >
            <EditIcon
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '14px',
                flexShrink: 0,
              }}
            />
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.02em',
                textTransform: 'uppercase',
              }}
            >
              {t('core:message.generic.editing_message', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </Box>
        ) : (
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: '6px',
              marginBottom: '4px',
            }}
          >
            <ReplyIcon
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '14px',
                flexShrink: 0,
              }}
            />
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.02em',
                textTransform: 'uppercase',
              }}
            >
              {t('core:message.generic.replied_to', {
                person: message?.senderName || message?.senderAddress,
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </Box>
        )}

        {replyMessageText && (
          <MessageDisplay isReply htmlContent={replyMessageText} />
        )}

        {message?.decryptedData?.type === 'notification' ? (
          <MessageDisplay
            isReply
            htmlContent={message.decryptedData?.data?.message}
          />
        ) : (
          <MessageDisplay isReply htmlContent={message.text} />
        )}
      </Box>
    </Box>
  );
};

const MessageWragger = ({ lastMessage, onSeen, isLast, children }) => {
  if (lastMessage) {
    return (
      <WatchComponent onSeen={onSeen} isLast={isLast}>
        {children}
      </WatchComponent>
    );
  }
  return children;
};

const WatchComponent = ({ onSeen, isLast, children }) => {
  const { ref, inView } = useInView({
    threshold: 0.7, // Fully visible
    triggerOnce: true, // Only trigger once when it becomes visible
    delay: 100,
    trackVisibility: false,
  });

  useEffect(() => {
    if (inView && isLast && onSeen) {
      setTimeout(() => {
        onSeen();
      }, 100);
    }
  }, [inView, isLast, onSeen]);

  return (
    <div
      ref={ref}
      style={{
        display: 'flex',
        justifyContent: 'center',
        width: '100%',
      }}
    >
      {children}
    </div>
  );
};
