import { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageItem } from './MessageItem';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { Box, Button, Typography, useTheme } from '@mui/material';
import { ChatOptions } from './ChatOptions';
import ErrorBoundary from '../../common/ErrorBoundary';
import { useTranslation } from 'react-i18next';

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
}) => {
  const parentRef = useRef(null);
  const [messages, setMessages] = useState(initialMessages);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showScrollDownButton, setShowScrollDownButton] = useState(false);
  const hasLoadedInitialRef = useRef(false);
  const scrollingIntervalRef = useRef(null);
  const lastSeenUnreadMessageTimestamp = useRef(null);

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
    let uniqueInitialMessagesMap = new Map();

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

  const scrollToBottom = (initialMsgs, divideIndex) => {
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

  const goToMessage = useCallback((idx) => {
    rowVirtualizer.scrollToIndex(idx);
  }, []);

  const theme = useTheme();
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
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          position: 'relative',
          width: '100%',
        }}
      >
        <div
          ref={parentRef}
          className="List"
          style={{
            display: 'flex',
            flexGrow: 1,
            height: '0px',
            overflow: 'auto',
            position: 'relative',
          }}
        >
          <div
            style={{
              height: rowVirtualizer.getTotalSize(),
              width: '100%',
            }}
          >
            <div
              style={{
                left: 0,
                position: 'absolute',
                top: 0,
                width: '100%',
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const index = virtualRow.index;
                let message = messages[index] || null; // Safeguard against undefined
                let replyIndex = -1;
                let reply = null;
                let reactions = null;
                let isUpdating = false;

                try {
                  // Safeguard for message existence
                  if (message) {
                    // Check for repliedTo logic
                    replyIndex = messages.findIndex(
                      (msg) => msg?.signature === message?.repliedTo
                    );

                    if (message?.repliedTo && replyIndex !== -1) {
                      reply = { ...(messages[replyIndex] || {}) };
                      if (chatReferences?.[reply?.signature]?.edit) {
                        reply.decryptedData =
                          chatReferences[reply?.signature]?.edit;
                        reply.text =
                          chatReferences[reply?.signature]?.edit?.message;
                        reply.editTimestamp =
                          chatReferences[reply?.signature]?.edit?.timestamp;
                      }
                    }

                    // GroupDirectId logic
                    if (message?.message && message?.groupDirectId) {
                      replyIndex = messages.findIndex(
                        (msg) => msg?.signature === message?.message?.repliedTo
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

                    // Check for reactions and edits
                    if (chatReferences?.[message.signature]) {
                      reactions =
                        chatReferences[message.signature]?.reactions || null;

                      if (
                        chatReferences[message.signature]?.edit?.message &&
                        message?.text
                      ) {
                        message.text =
                          chatReferences[message.signature]?.edit?.message;
                        message.isEdit = true;
                        message.editTimestamp =
                          chatReferences[message.signature]?.edit?.timestamp;
                      }
                      if (
                        chatReferences[message.signature]?.edit?.messageText &&
                        message?.messageText
                      ) {
                        message.messageText =
                          chatReferences[message.signature]?.edit?.messageText;
                        message.isEdit = true;
                        message.editTimestamp =
                          chatReferences[message.signature]?.edit?.timestamp;
                      }
                      if (chatReferences[message.signature]?.edit?.images) {
                        message.images =
                          chatReferences[message.signature]?.edit?.images;
                        message.isEdit = true;
                      }
                    }

                    // Check if message is updating
                    if (
                      tempChatReferences?.some(
                        (item) => item?.chatReference === message?.signature
                      )
                    ) {
                      isUpdating = true;
                    }
                  }
                } catch (error) {
                  console.error('Error processing message:', error, {
                    index,
                    message,
                  });
                  // Gracefully handle the error by providing fallback data
                  message = null;
                  reply = null;
                  reactions = null;
                }
                // Render fallback if message is null
                if (!message) {
                  return (
                    <div
                      key={virtualRow.index}
                      style={{
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
                    </div>
                  );
                }

                return (
                  <div
                    data-index={virtualRow.index} //needed for dynamic row height measurement
                    ref={rowVirtualizer.measureElement} //measure dynamic row height
                    key={message.signature}
                    style={{
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
                        handleReaction={handleReaction}
                        isLast={index === messages.length - 1}
                        isPrivate={isPrivate}
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
                        scrollToItem={goToMessage}
                      />
                    </ErrorBoundary>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {showScrollButton && (
          <button
            onClick={() => scrollToBottom()}
            style={{
              backgroundColor: theme.palette.other.unread,
              border: 'none',
              borderRadius: '20px',
              bottom: 20,
              color: theme.palette.text.primary,
              cursor: 'pointer',
              outline: 'none',
              padding: '10px 20px',
              position: 'absolute',
              right: 20,
              zIndex: 10,
            }}
          >
            {t('group:action.scroll_unread_messages', {
              postProcess: 'capitalizeFirstChar',
            })}
          </button>
        )}

        {showScrollDownButton && !showScrollButton && (
          <Button
            onClick={() => scrollToBottom()}
            variant="contained"
            style={{
              backgroundColor: theme.palette.background.paper,
              border: 'none',
              borderRadius: '20px',
              bottom: 20,
              color: theme.palette.text.primary,
              cursor: 'pointer',
              fontSize: '16px',
              outline: 'none',
              padding: '10px 20px',
              position: 'absolute',
              right: 20,
              zIndex: 10,
              textTransform: 'none',
            }}
          >
            {t('group:action.scroll_unread_messages', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
        )}
      </div>

      {enableMentions && (hasSecretKey || isPrivate === false) && (
        <ChatOptions
          openQManager={openQManager}
          messages={messages}
          goToMessage={goToMessage}
          members={members}
          myName={myName}
          selectedGroup={selectedGroup}
          isPrivate={isPrivate}
        />
      )}
    </Box>
  );
};
