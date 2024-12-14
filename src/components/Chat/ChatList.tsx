import React, {
  useCallback,
  useState,
  useEffect,
  useRef,
  useMemo,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MessageItem } from "./MessageItem";
import { subscribeToEvent, unsubscribeFromEvent } from "../../utils/events";
import { useInView } from "react-intersection-observer";
import { Box, Typography } from "@mui/material";
import { ChatOptions } from "./ChatOptions";
import ErrorBoundary from "../../common/ErrorBoundary";

export const ChatList = ({
  initialMessages,
  myAddress,
  tempMessages,
  chatId,
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
  hasSecretKey
}) => {
  const parentRef = useRef();
  const [messages, setMessages] = useState(initialMessages);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showScrollDownButton, setShowScrollDownButton] = useState(false);

  const hasLoadedInitialRef = useRef(false);
  const scrollingIntervalRef = useRef(null);
  const lastSeenUnreadMessageTimestamp = useRef(null);

  // Initialize the virtualizer
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getItemKey: (index) => messages[index]?.tempSignature || messages[index].signature,
    getScrollElement: () => parentRef?.current,
    estimateSize: useCallback(() => 80, []), // Provide an estimated height of items, adjust this as needed
    overscan: 10, // Number of items to render outside the visible area to improve smoothness
  });

  const isAtBottom = useMemo(()=> {
    if (parentRef.current && rowVirtualizer?.isScrolling !== undefined) {
      const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    const atBottom = scrollTop + clientHeight >= scrollHeight - 10; // Adjust threshold as needed
   return atBottom
  }

  return false

  }, [rowVirtualizer?.isScrolling])

  useEffect(() => {
    if (!parentRef.current || rowVirtualizer?.isScrolling === undefined) return;
    if(isAtBottom){
      if (scrollingIntervalRef.current) {
        clearTimeout(scrollingIntervalRef.current);
      }
      setShowScrollDownButton(false);
      return;
    } else
    if (rowVirtualizer?.isScrolling) {
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
        (msg) => msg.unread && !msg?.chatReference && !msg?.isTemp && (!msg?.chatReference && msg?.timestamp > lastSeenUnreadMessageTimestamp.current || 0)
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
        rowVirtualizer.scrollToIndex(divideIndex, { align: "start" });
      } else {
        rowVirtualizer.scrollToIndex(index, { align: "end" });
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
    lastSeenUnreadMessageTimestamp.current = Date.now()
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
    subscribeToEvent("sent-new-message-group", sentNewMessageGroupFunc);
    return () => {
      unsubscribeFromEvent("sent-new-message-group", sentNewMessageGroupFunc);
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
  return (
    <Box
      sx={{
        display: "flex",
        width: "100%",
        height: "100%",
      }}
    >
      <div
        style={{
          height: "100%",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          width: "100%",
        }}
      >
        <div
          ref={parentRef}
          className="List"
          style={{
            flexGrow: 1,
            overflow: "auto",
            position: "relative",
            display: "flex",
            height: "0px",
          }}
        >
          <div
            style={{
              height: rowVirtualizer.getTotalSize(),
              width: "100%",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
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
                        reply.decryptedData = chatReferences[reply?.signature]?.edit;
                        reply.text = chatReferences[reply?.signature]?.edit?.message;
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
                      reactions = chatReferences[message.signature]?.reactions || null;
              
                      if (chatReferences[message.signature]?.edit?.message && message?.text) {
                        message.text = chatReferences[message.signature]?.edit?.message;
                        message.isEdit = true
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
                  console.error("Error processing message:", error, { index, message });
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
                          position: "absolute",
                          top: 0,
                          left: "50%",
                          transform: `translateY(${virtualRow.start}px) translateX(-50%)`,
                          width: "100%",
                          padding: "10px 0",
                          display: "flex",
                          alignItems: "center",
                          flexDirection: "column",
                          gap: "5px",
                        }}
                      >
                        <Typography>Error loading message.</Typography>
                      </div>
                    );
                  }


                return (
                  <div
                    data-index={virtualRow.index} //needed for dynamic row height measurement
                    ref={rowVirtualizer.measureElement} //measure dynamic row height
                    key={message.signature}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: "50%", // Move to the center horizontally
                      transform: `translateY(${virtualRow.start}px) translateX(-50%)`, // Adjust for centering
                      width: "100%", // Control width (90% of the parent)
                      padding: "10px 0",
                      display: "flex",
                      alignItems: "center",
                      overscrollBehavior: "none",
                      flexDirection: "column",
                      gap: "5px",
                    }}
                  >
                      <ErrorBoundary
                      fallback={
                        <Typography>
                          Error loading content: Invalid Data
                        </Typography>
                      }
                    >
                    <MessageItem
                      isLast={index === messages.length - 1}
                      lastSignature={lastSignature}
                      message={message}
                      onSeen={handleMessageSeen}
                      isTemp={!!message?.isTemp}
                      myAddress={myAddress}
                      onReply={onReply}
                      onEdit={onEdit}
                      reply={reply}
                      replyIndex={replyIndex}
                      scrollToItem={goToMessage}
                      handleReaction={handleReaction}
                      reactions={reactions}
                      isUpdating={isUpdating}
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
              bottom: 20,
              position: "absolute",
              right: 20,
              backgroundColor: "var(--unread)",
              color: "white",
              padding: "10px 20px",
              borderRadius: "20px",
              cursor: "pointer",
              zIndex: 10,
              border: "none",
              outline: "none",
            }}
          >
            Scroll to Unread Messages
          </button>
        )}
        {showScrollDownButton && !showScrollButton && (
          <button
            onClick={() => scrollToBottom()}
            style={{
              bottom: 20,
              position: "absolute",
              right: 20,
              backgroundColor: "var(--Mail-Background)",
              color: "white",
              padding: "10px 20px",
              borderRadius: "20px",
              cursor: "pointer",
              zIndex: 10,
              border: "none",
              outline: "none",
              fontSize: "16px",
            }}
          >
            Scroll to bottom
          </button>
        )}
      </div>
      {enableMentions && hasSecretKey && (
        <ChatOptions
        openQManager={openQManager}
          messages={messages}
          goToMessage={goToMessage}
          members={members}
          myName={myName}
          selectedGroup={selectedGroup}
        />
      )}
    </Box>
  );
};
