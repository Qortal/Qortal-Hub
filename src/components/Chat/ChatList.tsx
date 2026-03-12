import { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageItem } from './MessageItem';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { Box, Button, Typography, useTheme } from '@mui/material';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import { ChatOptions } from './ChatOptions';
import ErrorBoundary from '../../common/ErrorBoundary';
import { useTranslation } from 'react-i18next';

type ReactionItem = {
  sender: string;
  senderName?: string;
};

export type ReactionsMap = {
  [reactionType: string]: ReactionItem[];
};

export const ChatList = ({
  initialMessages,
  myAddress,
  tempMessages,
  onReply,
  onEdit,
  handleReaction,
  chatReferences,
  tempChatReferences,
  members,
  myName,
  selectedGroup,
  enableMentions,
  openQManager,
  hasSecretKey,
  isPrivate,
  compactScrollButton = false,
}) => {
  const theme = useTheme();
  const parentRef = useRef(null);
  const [messages, setMessages] = useState(initialMessages);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showScrollDownButton, setShowScrollDownButton] = useState(false);
  const [highlightedMessageIndex, setHighlightedMessageIndex] = useState<
    number | null
  >(null);
  const hasLoadedInitialRef = useRef(false);
  const scrollingIntervalRef = useRef(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const lastSeenUnreadMessageTimestamp = useRef(null);

  // Shared scroll button styling (memoized so Button sx refs stay stable)
  const scrollButtonSx = useMemo(
    () => ({
      position: 'absolute' as const,
      right: 20,
      bottom: 20,
      zIndex: 10,
      borderRadius: '24px',
      textTransform: 'none' as const,
      fontWeight: 600,
      fontSize: '0.875rem',
      px: 2,
      py: 1.25,
      boxShadow:
        theme.palette.mode === 'dark'
          ? '0 4px 20px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.08)'
          : '0 4px 14px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)',
      backgroundColor: theme.palette.background.paper,
      color: theme.palette.text.primary,
      border: `1px solid ${theme.palette.divider}`,
      transition:
        'box-shadow 0.2s ease, transform 0.15s ease, background-color 0.2s ease',
      '&:hover': {
        backgroundColor: theme.palette.action.hover,
        boxShadow:
          theme.palette.mode === 'dark'
            ? `0 6px 24px rgba(0,0,0,0.5), 0 0 0 1px ${theme.palette.primary.main}40`
            : `0 6px 20px rgba(0,0,0,0.15), 0 0 0 1px ${theme.palette.primary.light}60`,
      },
      '&:active': {
        transform: 'scale(0.98)',
      },
    }),
    [theme]
  );
  const scrollButtonCompactSx = useMemo(
    () => ({
      ...scrollButtonSx,
      right: 16,
      bottom: 16,
      borderRadius: '50%',
      px: 0,
      py: 0,
      minWidth: 40,
      width: 40,
      height: 40,
      '& .MuiButton-startIcon': { margin: 0 },
    }),
    [scrollButtonSx]
  );

  // Initialize the virtualizer
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getItemKey: (index) =>
      messages[index]?.tempSignature || messages[index].signature,
    getScrollElement: () => parentRef?.current,
    estimateSize: useCallback(() => 80, []), // Provide an estimated height of items, adjust this as needed
    overscan: 10, // Number of items to render outside the visible area to improve smoothness
  });

  const isAtBottom = useMemo(() => {
    if (parentRef.current && rowVirtualizer?.isScrolling !== undefined) {
      const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 10; // Adjust threshold as needed
      return atBottom;
    }

    return false;
  }, [rowVirtualizer?.isScrolling]);

  useEffect(() => {
    if (!parentRef.current || rowVirtualizer?.isScrolling === undefined) return;
    if (isAtBottom) {
      if (scrollingIntervalRef.current) {
        clearTimeout(scrollingIntervalRef.current);
      }
      setShowScrollDownButton(false);
      return;
    } else if (rowVirtualizer?.isScrolling) {
      if (scrollingIntervalRef.current) {
        clearTimeout(scrollingIntervalRef.current);
      }
      setShowScrollDownButton(false);
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight <= 300;
    if (!atBottom) {
      scrollingIntervalRef.current = setTimeout(() => {
        setShowScrollDownButton(true);
      }, 250);
    } else {
      setShowScrollDownButton(false);
    }
  }, [rowVirtualizer?.isScrolling, isAtBottom]);

  // Update message list with unique signatures and tempMessages
  useEffect(() => {
    const uniqueInitialMessagesMap = new Map();

    // Only add a message if it doesn't already exist in the Map
    initialMessages.forEach((message) => {
      if (!uniqueInitialMessagesMap.has(message.signature)) {
        uniqueInitialMessagesMap.set(message.signature, message);
      }
    });

    const uniqueInitialMessages = Array.from(
      uniqueInitialMessagesMap.values()
    ).sort((a, b) => a.timestamp - b.timestamp);
    const totalMessages = [...uniqueInitialMessages, ...(tempMessages || [])];

    if (totalMessages.length === 0) return;

    setMessages(totalMessages);

    setTimeout(() => {
      const hasUnreadMessages = totalMessages.some(
        (msg) =>
          msg.unread &&
          !msg?.chatReference &&
          !msg?.isTemp &&
          ((!msg?.chatReference &&
            msg?.timestamp > lastSeenUnreadMessageTimestamp.current) ||
            0)
      );

      if (parentRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
        const atBottom = scrollTop + clientHeight >= scrollHeight - 10; // Adjust threshold as needed
        if (!atBottom && hasUnreadMessages) {
          setShowScrollButton(hasUnreadMessages);
          setShowScrollDownButton(false);
        } else {
          handleMessageSeen();
        }
      }
      if (!hasLoadedInitialRef.current) {
        const findDivideIndex = totalMessages.findIndex(
          (item) => !!item?.divide
        );
        const divideIndex =
          findDivideIndex !== -1 ? findDivideIndex : undefined;
        scrollToBottom(totalMessages, divideIndex);
        hasLoadedInitialRef.current = true;
      }
    }, 500);
  }, [initialMessages, tempMessages]);

  const scrollToBottom = (initialMsgs?: unknown[], divideIndex?: number) => {
    const index = initialMsgs ? initialMsgs.length - 1 : messages.length - 1;
    if (rowVirtualizer) {
      if (divideIndex) {
        rowVirtualizer.scrollToIndex(divideIndex, { align: 'start' });
      } else {
        rowVirtualizer.scrollToIndex(index, { align: 'end' });
      }
    }
    handleMessageSeen();
  };

  const handleMessageSeen = useCallback(() => {
    setMessages((prevMessages) =>
      prevMessages.map((msg) => ({
        ...msg,
        unread: false,
      }))
    );
    setShowScrollButton(false);
    lastSeenUnreadMessageTimestamp.current = Date.now();
  }, []);

  const sentNewMessageGroupFunc = useCallback(() => {
    const { scrollHeight, scrollTop, clientHeight } = parentRef.current;

    // Check if the user is within 200px from the bottom
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    if (distanceFromBottom <= 700) {
      scrollToBottom();
    }
  }, [messages]);

  useEffect(() => {
    subscribeToEvent('sent-new-message-group', sentNewMessageGroupFunc);
    return () => {
      unsubscribeFromEvent('sent-new-message-group', sentNewMessageGroupFunc);
    };
  }, [sentNewMessageGroupFunc]);

  const lastSignature = useMemo(() => {
    if (!messages || messages?.length === 0) return null;
    const lastIndex = messages.length - 1;
    return messages[lastIndex]?.signature;
  }, [messages]);

  const goToMessage = useCallback((idx: number) => {
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = null;
    }
    rowVirtualizer.scrollToIndex(idx);
    setHighlightedMessageIndex(idx);
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedMessageIndex(null);
      highlightTimeoutRef.current = null;
    }, 1200);
  }, []);

  // Memoize per-row payload so MessageItem receives stable references and memo can skip re-renders
  const processedRows = useMemo(() => {
    return messages.map((msg, index) => {
      let message = msg || null;
      let replyIndex = -1;
      let reply = null;
      let replyExpiredMeta = null;
      let reactions = null;
      let isUpdating = false;
      try {
        if (message) {
          replyIndex = messages.findIndex(
            (m) => m?.signature === message?.repliedTo
          );
          if (message?.repliedTo && replyIndex !== -1) {
            reply = { ...(messages[replyIndex] || {}) };
            if (chatReferences?.[reply?.signature]?.edit) {
              const edit = chatReferences[reply?.signature]?.edit;
              reply.decryptedData = edit;
              reply.text = edit?.message;
              reply.messageText = edit?.messageText;
              reply.editTimestamp = edit?.timestamp;
            }
          } else if (message?.repliedTo && replyIndex === -1) {
            const editMeta = chatReferences?.[message?.repliedTo]?.edit;
            if (editMeta) {
              replyExpiredMeta = {
                senderName: editMeta?.senderName,
                sender: editMeta?.sender,
                messageText:
                  editMeta?.messageText !== undefined
                    ? editMeta?.messageText
                    : undefined,
                text:
                  editMeta?.message !== undefined
                    ? editMeta?.message
                    : undefined,
                decryptedData: editMeta,
                editTimestamp: editMeta?.timestamp,
              };
            } else {
              replyExpiredMeta = { missing: true };
            }
          }
          if (message?.message && message?.groupDirectId) {
            replyIndex = messages.findIndex(
              (m) => m?.signature === message?.message?.repliedTo
            );
            if (message?.message?.repliedTo && replyIndex !== -1) {
              reply = messages[replyIndex] || null;
            }
            message = {
              ...(message?.message || {}),
              isTemp: true,
              unread: false,
              status: message?.status,
            };
          }
          if (chatReferences?.[message.signature]) {
            reactions = chatReferences[message.signature]?.reactions || null;
            if (chatReferences[message.signature]?.edit) {
              message = {
                ...message,
                text: chatReferences[message.signature]?.edit?.message,
                messageText:
                  chatReferences[message.signature]?.edit?.messageText,
                images: chatReferences[message.signature]?.edit?.images,
                isEdit: true,
                editTimestamp:
                  chatReferences[message.signature]?.edit?.timestamp,
              };
            }
          }
          if (
            tempChatReferences?.some(
              (item) => item?.chatReference === message?.signature
            )
          ) {
            isUpdating = true;
          }
        }
      } catch (err) {
        message = null;
        reply = null;
        reactions = null;
      }
      return {
        message,
        reply,
        replyIndex,
        replyExpiredMeta,
        reactions,
        isUpdating,
      };
    });
  }, [messages, chatReferences, tempChatReferences]);

  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  return (
    <Box
      sx={{
        display: 'flex',
        height: '100%',
        width: '100%',
      }}
    >
      <Box
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          position: 'relative',
          width: '100%',
        }}
      >
        <Box
          ref={parentRef}
          style={{
            display: 'flex',
            flexGrow: 1,
            height: '0px',
            overflow: 'auto',
            position: 'relative',
          }}
        >
          <Box
            sx={{
              height: rowVirtualizer.getTotalSize(),
              width: '100%',
            }}
          >
            <Box
              sx={{
                left: 0,
                position: 'absolute',
                top: 0,
                width: '100%',
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const index = virtualRow.index;
                const rowPayload = processedRows[index];
                if (!rowPayload) {
                  return (
                    <Box
                      key={virtualRow.index}
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '5px',
                        left: '50%',
                        padding: '10px 0',
                        position: 'absolute',
                        top: 0,
                        transform: `translateY(${virtualRow.start}px) translateX(-50%)`,
                        width: '100%',
                      }}
                    >
                      <Typography>
                        {t('core:message.error.message_loading', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>
                    </Box>
                  );
                }
                const {
                  message,
                  reply,
                  replyIndex,
                  replyExpiredMeta,
                  reactions,
                  isUpdating,
                } = rowPayload;
                if (!message) {
                  return (
                    <Box
                      key={virtualRow.index}
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '5px',
                        left: '50%',
                        padding: '10px 0',
                        position: 'absolute',
                        top: 0,
                        transform: `translateY(${virtualRow.start}px) translateX(-50%)`,
                        width: '100%',
                      }}
                    >
                      <Typography>
                        {t('core:message.error.message_loading', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>
                    </Box>
                  );
                }

                return (
                  <Box
                    data-index={virtualRow.index} //needed for dynamic row height measurement
                    ref={rowVirtualizer.measureElement} //measure dynamic row height
                    key={message.signature}
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '5px',
                      left: '50%', // Move to the center horizontally
                      overscrollBehavior: 'none',
                      padding: '10px 0',
                      position: 'absolute',
                      top: 0,
                      transform: `translateY(${virtualRow.start}px) translateX(-50%)`, // Adjust for centering
                      width: '100%', // Control width (90% of the parent)
                    }}
                  >
                    <ErrorBoundary
                      fallback={
                        <Typography>
                          {t('group:message.generic.invalid_data', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </Typography>
                      }
                    >
                      <MessageItem
                        key={message.signature}
                        handleReaction={handleReaction}
                        isLast={index === messages.length - 1}
                        isPrivate={isPrivate}
                        isScrollTarget={
                          highlightedMessageIndex === virtualRow.index
                        }
                        isTemp={!!message?.isTemp}
                        isUpdating={isUpdating}
                        lastSignature={lastSignature}
                        message={message}
                        myAddress={myAddress}
                        onEdit={onEdit}
                        onReply={onReply}
                        onSeen={handleMessageSeen}
                        reactions={reactions}
                        reply={reply}
                        replyIndex={replyIndex}
                        replyExpiredMeta={replyExpiredMeta}
                        scrollToItem={goToMessage}
                      />
                    </ErrorBoundary>
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Box>

        {showScrollButton && (
          <Button
            onClick={() => scrollToBottom()}
            startIcon={<KeyboardArrowDownRoundedIcon sx={{ fontSize: 20 }} />}
            sx={{
              ...scrollButtonSx,
              backgroundColor: theme.palette.primary.dark,
              color: theme.palette.primary.contrastText,
              border: `1px solid ${theme.palette.primary.main}`,
              '&:hover': {
                ...scrollButtonSx['&:hover'],
                backgroundColor: theme.palette.primary.main,
                color: theme.palette.primary.contrastText,
              },
            }}
          >
            {t('group:action.scroll_unread_messages', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
        )}

        {showScrollDownButton &&
          !showScrollButton &&
          (compactScrollButton ? (
            <Button
              onClick={() => scrollToBottom()}
              aria-label={t('group:action.scroll_bottom', {
                postProcess: 'capitalizeFirstChar',
              })}
              sx={scrollButtonCompactSx}
            >
              <KeyboardArrowDownRoundedIcon sx={{ fontSize: 22 }} />
            </Button>
          ) : (
            <Button
              onClick={() => scrollToBottom()}
              startIcon={<KeyboardArrowDownRoundedIcon sx={{ fontSize: 20 }} />}
              sx={scrollButtonSx}
            >
              {t('group:action.scroll_bottom', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
          ))}
      </Box>

      {enableMentions && (hasSecretKey || isPrivate === false) && (
        <ChatOptions
          goToMessage={goToMessage}
          isPrivate={isPrivate}
          members={members}
          messages={messages}
          myName={myName}
          openQManager={openQManager}
          selectedGroup={selectedGroup}
        />
      )}
    </Box>
  );
};
