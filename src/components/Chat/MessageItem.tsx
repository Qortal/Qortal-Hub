import {
  memo,
  useCallback,
  useContext,
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
import { formatTimestamp } from '../../utils/time';
import { QORTAL_APP_CONTEXT, getBaseApiReact } from '../../App';
import { generateHTML } from '@tiptap/react';
import Highlight from '@tiptap/extension-highlight';
import Mention from '@tiptap/extension-mention';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { WrapperUserAction } from '../WrapperUserAction';
import ReplyIcon from '@mui/icons-material/Reply';
import { Spacer } from '../../common/Spacer';
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

export const MessageItem = memo(
  ({
    message,
    onSeen,
    isLast,
    isTemp,
    myAddress,
    onReply,
    isShowingAsReply,
    reply,
    replyIndex,
    scrollToItem,
    handleReaction,
    reactions,
    isUpdating,
    lastSignature,
    onEdit,
    isPrivate,
  }) => {
    const { getIndividualUserInfo } = useContext(QORTAL_APP_CONTEXT);
    const [anchorEl, setAnchorEl] = useState(null);
    const [selectedReaction, setSelectedReaction] = useState(null);
    const [userInfo, setUserInfo] = useState(null);

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

    const htmlText = useMemo(() => {
      if (message?.messageText) {
        const isHtml = isHtmlString(message?.messageText);
        if (isHtml) return message?.messageText;
        return generateHTML(message?.messageText, [
          StarterKit,
          Underline,
          Highlight,
          Mention,
          TextStyle,
        ]);
      }
    }, [message?.editTimestamp]);

    const htmlReply = useMemo(() => {
      if (reply?.messageText) {
        const isHtml = isHtmlString(reply?.messageText);
        if (isHtml) return reply?.messageText;
        return generateHTML(reply?.messageText, [
          StarterKit,
          Underline,
          Highlight,
          Mention,
          TextStyle,
        ]);
      }
    }, [reply?.editTimestamp]);

    const userAvatarUrl = useMemo(() => {
      return message?.senderName
        ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${
            message?.senderName
          }/qortal_avatar?async=true`
        : '';
    }, []);

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
          <div
            style={{
              backgroundColor: theme.palette.background.paper,
              borderRadius: '7px',
              display: 'flex',
              gap: '7px',
              opacity: isTemp || isUpdating ? 0.5 : 1,
              padding: '10px',
              width: '95%',
            }}
            id={message?.signature}
          >
            {isShowingAsReply ? (
              <ReplyIcon
                sx={{
                  fontSize: '30px',
                }}
              />
            ) : (
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '20px',
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
                      color: theme.palette.text.primary,
                      height: '40px',
                      width: '40px',
                    }}
                    alt={message?.senderName}
                    src={userAvatarUrl}
                  >
                    {message?.senderName?.charAt(0)}
                  </Avatar>
                </WrapperUserAction>
                <UserBadge userInfo={userInfo} />
              </Box>
            )}

            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: '7px',
                height: isShowingAsReply && '40px',
                width: '100%',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  width: '100%',
                }}
              >
                <WrapperUserAction
                  disabled={myAddress === message?.sender}
                  address={message?.sender}
                  name={message?.senderName}
                >
                  <Typography
                    sx={{
                      fontWight: 600,
                      fontFamily: 'Inter',
                    }}
                  >
                    {message?.senderName || message?.sender}
                  </Typography>
                </WrapperUserAction>

                <Box
                  sx={{
                    display: 'flex',
                    gap: '10px',
                    alignItems: 'center',
                  }}
                >
                  {message?.sender === myAddress &&
                    (!message?.isNotEncrypted || isPrivate === false) && (
                      <ButtonBase
                        onClick={() => {
                          onEdit(message);
                        }}
                      >
                        <EditIcon />
                      </ButtonBase>
                    )}

                  {!isShowingAsReply && (
                    <ButtonBase
                      onClick={() => {
                        onReply(message);
                      }}
                    >
                      <ReplyIcon />
                    </ButtonBase>
                  )}

                  {!isShowingAsReply && handleReaction && (
                    <ReactionPicker
                      onReaction={(val) => {
                        if (
                          reactions &&
                          reactions[val] &&
                          reactions[val]?.find(
                            (item) => item?.sender === myAddress
                          )
                        ) {
                          handleReaction(val, message, false);
                        } else {
                          handleReaction(val, message, true);
                        }
                      }}
                    />
                  )}
                </Box>
              </Box>

              {reply && (
                <>
                  <Spacer height="20px" />

                  <Box
                    sx={{
                      backgroundColor: theme.palette.background.surface,
                      borderRadius: '8px',
                      cursor: 'pointer',
                      display: 'flex',
                      gap: '20px',
                      maxHeight: '90px',
                      overflow: 'hidden',
                      width: '100%',
                    }}
                    onClick={() => {
                      scrollToItem(replyIndex);
                    }}
                  >
                    <Box
                      sx={{
                        background: theme.palette.text.primary,
                        height: '100%',
                        width: '5px',
                        flexShrink: 0,
                      }} // This is the little bar at left of replied messages
                    />

                    <Box
                      sx={{
                        padding: '5px',
                      }}
                    >
                      <Typography
                        sx={{
                          fontSize: '12px',
                          fontWeight: 600,
                        }}
                      >
                        {t('core:message.generic.replied_to', {
                          person: reply?.senderName || reply?.senderAddress,
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>

                      {reply?.messageText && (
                        <MessageDisplay htmlContent={htmlReply} />
                      )}

                      {reply?.decryptedData?.type === 'notification' ? (
                        <MessageDisplay
                          htmlContent={reply.decryptedData?.data?.message}
                        />
                      ) : (
                        <MessageDisplay isReply htmlContent={reply.text} />
                      )}
                    </Box>
                  </Box>
                </>
              )}

              {htmlText && !hasNoMessage && (
                <MessageDisplay htmlContent={htmlText} />
              )}

              {message?.decryptedData?.type === 'notification' ? (
                <MessageDisplay
                  htmlContent={message.decryptedData?.data?.message}
                />
              ) : hasNoMessage ? null : (
                <MessageDisplay htmlContent={message.text} />
              )}
              {hasNoMessage && (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                  }}
                >
                  <CommentsDisabledIcon color="primary" />
                  <Typography color="primary">
                    {t('core:message.generic.no_message', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                </Box>
              )}
              {message?.images && messageHasImage(message) && (
                <Embed embedLink={buildImageEmbedLink(message.images[0])} />
              )}

              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  width: '100%',
                }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    gap: '5px',
                  }}
                >
                  {reactions &&
                    Object.keys(reactions).map((reaction) => {
                      const numberOfReactions = reactions[reaction]?.length;
                      if (numberOfReactions === 0) return null;
                      return (
                        <ButtonBase
                          key={reaction}
                          sx={{
                            background: theme.palette.background.surface,
                            borderRadius: '7px',
                            height: '30px',
                            minWidth: '45px',
                          }}
                          onClick={(event) => {
                            event.stopPropagation(); // Prevent event bubbling
                            setAnchorEl(event.currentTarget);
                            setSelectedReaction(reaction);
                          }}
                        >
                          <div
                            style={{
                              fontSize: '16px',
                            }}
                          >
                            {reaction}
                          </div>
                          {numberOfReactions > 1 && (
                            <Typography
                              sx={{
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
                        style: {
                          backgroundColor: theme.palette.background.default,
                          color: theme.palette.text.primary,
                        },
                      },
                    }}
                  >
                    <Box sx={{ p: 2 }}>
                      <Typography variant="subtitle1" sx={{ marginBottom: 1 }}>
                        {t('core:message.generic.people_reaction', {
                          reaction: selectedReaction,
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>

                      <List
                        sx={{
                          maxHeight: '300px',
                          maxWidth: '300px',
                          overflow: 'auto',
                        }}
                      >
                        {reactions[selectedReaction]?.map((reactionItem) => (
                          <ListItem key={reactionItem.sender}>
                            <ListItemText
                              primary={
                                reactionItem.senderName || reactionItem.sender
                              }
                            />
                          </ListItem>
                        ))}
                      </List>

                      <Button
                        variant="contained"
                        color="primary"
                        onClick={() => {
                          if (
                            reactions[selectedReaction]?.find(
                              (item) => item?.sender === myAddress
                            )
                          ) {
                            handleReaction(selectedReaction, message, false); // Remove reaction
                          } else {
                            handleReaction(selectedReaction, message, true); // Add reaction
                          }
                          setAnchorEl(null);
                          setSelectedReaction(null);
                        }}
                        sx={{ marginTop: 2 }}
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

                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    gap: '15px',
                  }}
                >
                  {message?.isNotEncrypted && isPrivate && (
                    <KeyOffIcon
                      sx={{
                        color: theme.palette.text.primary,
                        marginLeft: '10px',
                      }}
                    />
                  )}

                  {isUpdating ? (
                    <Typography
                      sx={{
                        fontSize: '14px',
                        color: theme.palette.text.secondary,
                        fontFamily: 'Inter',
                      }}
                    >
                      {message?.status === 'failed-permanent'
                        ? t('core:message.error.update_failed', {
                            postProcess: 'capitalizeFirstChar',
                          })
                        : t('core:message.generic.updating', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                    </Typography>
                  ) : isTemp ? (
                    <Typography
                      sx={{
                        fontSize: '14px',
                        color: theme.palette.text.secondary,
                        fontFamily: 'Inter',
                      }}
                    >
                      {message?.status === 'failed-permanent'
                        ? t('core:message.error.send_failed', {
                            postProcess: 'capitalizeFirstChar',
                          })
                        : t('core:message.generic.sending', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                    </Typography>
                  ) : (
                    <>
                      {message?.isEdit && (
                        <Typography
                          sx={{
                            fontSize: '14px',
                            color: theme.palette.text.secondary,
                            fontFamily: 'Inter',
                            fontStyle: 'italic',
                          }}
                        >
                          {t('core:message.generic.edited', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </Typography>
                      )}

                      <Typography
                        sx={{
                          fontSize: '14px',
                          color: theme.palette.text.secondary,
                          fontFamily: 'Inter',
                        }}
                      >
                        {formatTimestamp(message.timestamp)}
                      </Typography>
                    </>
                  )}
                </Box>
              </Box>
            </Box>
          </div>
        </MessageWragger>
      </>
    );
  }
);

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
        borderRadius: '8px',
        cursor: 'pointer',
        display: 'flex',
        gap: '20px',
        marginTop: '20px',
        maxHeight: '90px',
        overflow: 'hidden',
        width: '100%',
      }}
    >
      <Box
        sx={{
          padding: '5px',
        }}
      >
        {isEdit ? (
          <Typography
            sx={{
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            {t('core:message.generic.editing_message', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        ) : (
          <Typography
            sx={{
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            {t('core:message.generic.replied_to', {
              person: message?.senderName || message?.senderAddress,
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        )}

        {replyMessageText && <MessageDisplay htmlContent={replyMessageText} />}

        {message?.decryptedData?.type === 'notification' ? (
          <MessageDisplay htmlContent={message.decryptedData?.data?.message} />
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
