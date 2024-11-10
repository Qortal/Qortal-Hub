import React, { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageItem } from './MessageItem';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { useInView } from 'react-intersection-observer'

export const ChatList = ({ initialMessages, myAddress, tempMessages, chatId, onReply, handleReaction, chatReferences, tempChatReferences }) => {
  const parentRef = useRef();
  const [messages, setMessages] = useState(initialMessages);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const hasLoadedInitialRef = useRef(false);
  const isAtBottomRef = useRef(true);
  // const [ref, inView] = useInView({
  //   threshold: 0.7
  // })

  // useEffect(() => {
  //   if (inView) {
      
  //   }
  // }, [inView])
  // Update message list with unique signatures and tempMessages
  useEffect(() => {
    let uniqueInitialMessagesMap = new Map();

    // Only add a message if it doesn't already exist in the Map
    initialMessages.forEach((message) => {
      if (!uniqueInitialMessagesMap.has(message.signature)) {
        uniqueInitialMessagesMap.set(message.signature, message);
      }
    });

    const uniqueInitialMessages = Array.from(uniqueInitialMessagesMap.values()).sort(
      (a, b) => a.timestamp - b.timestamp
    );
    const totalMessages = [...uniqueInitialMessages, ...(tempMessages || [])]

    if (totalMessages.length === 0) return;

    setMessages(totalMessages);

    setTimeout(() => {
      const hasUnreadMessages = totalMessages.some((msg) => msg.unread && !msg?.chatReference);
      if (parentRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 10; // Adjust threshold as needed
        if (!atBottom && hasUnreadMessages) {
          setShowScrollButton(hasUnreadMessages);
        } else {
          handleMessageSeen();
        }
      }
      if (!hasLoadedInitialRef.current) {
        scrollToBottom(totalMessages);
        hasLoadedInitialRef.current = true;
      }
    }, 500);
  }, [initialMessages, tempMessages]);

  const scrollToBottom = (initialMsgs) => {
    const index = initialMsgs ? initialMsgs.length - 1 : messages.length - 1;
    if (rowVirtualizer) {
      rowVirtualizer.scrollToIndex(index, { align: 'end' });
    }
    handleMessageSeen()
  };


  const handleMessageSeen = useCallback(() => {
    setMessages((prevMessages) =>
      prevMessages.map((msg) => ({
        ...msg,
        unread: false,
      }))
    );
    setShowScrollButton(false)
  }, []);

  // const scrollToBottom = (initialMsgs) => {
  //   const index = initialMsgs ? initialMsgs.length - 1 : messages.length - 1;
  //   if (parentRef.current) {
  //     parentRef.current.scrollToIndex(index);
  //   }
  // };


  const sentNewMessageGroupFunc = useCallback(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    subscribeToEvent('sent-new-message-group', sentNewMessageGroupFunc);
    return () => {
      unsubscribeFromEvent('sent-new-message-group', sentNewMessageGroupFunc);
    };
  }, [sentNewMessageGroupFunc]);

  const lastSignature = useMemo(()=> {
    if(!messages || messages?.length === 0) return null
    const lastIndex = messages.length - 1
    return messages[lastIndex]?.signature
  }, [messages])


  // Initialize the virtualizer
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80, // Provide an estimated height of items, adjust this as needed
    overscan: 10, // Number of items to render outside the visible area to improve smoothness
    measureElement:
    typeof window !== 'undefined' &&
    navigator.userAgent.indexOf('Firefox') === -1
      ? element => {
        return element?.getBoundingClientRect().height
      }
      : undefined,
  });

  return (
<>
    <div ref={parentRef} style={{ height: '100%', overflow: 'auto', position: 'relative', display: 'flex' }}>
      <div
        style={{
          width: '100%',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center', // Center items horizontally
          gap: '10px', // Add gap between items
          flexGrow: 1
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const index = virtualRow.index;
          let message = messages[index];
          let replyIndex = messages.findIndex((msg) => msg?.signature === message?.repliedTo);
          let reply;
          let reactions = null;

          if (message?.repliedTo && replyIndex !== -1) {
            reply = messages[replyIndex];
          }

          if (message?.message && message?.groupDirectId) {
            replyIndex = messages.findIndex((msg) => msg?.signature === message?.message?.repliedTo);
            if (message?.message?.repliedTo && replyIndex !== -1) {
              reply = messages[replyIndex];
            }
            message = {
              ...(message?.message || {}),
              isTemp: true,
              unread: false,
              status: message?.status
            };
          }

          if (chatReferences && chatReferences[message?.signature]) {
            if (chatReferences[message.signature]?.reactions) {
              reactions = chatReferences[message.signature]?.reactions;
            }
          }

          let isUpdating = false;
          if (tempChatReferences && tempChatReferences?.find((item) => item?.chatReference === message?.signature)) {
            isUpdating = true;
          }

          return (
            <div
            data-index={virtualRow.index} //needed for dynamic row height measurement
            ref={node => rowVirtualizer.measureElement(node)} //measure dynamic row height
              key={message.signature}
              style={{
                position: 'absolute',
                top: 0,
                left: '50%', // Move to the center horizontally
                transform: `translateY(${virtualRow.start}px) translateX(-50%)`, // Adjust for centering
                width: '100%', // Control width (90% of the parent)
                padding: '10px 0',
                display: 'flex',
                justifyContent: 'center',
                overscrollBehavior: 'none',
              }}
            >
              <MessageItem
                isLast={index === messages.length - 1}
                lastSignature={lastSignature}
                message={message}
                onSeen={handleMessageSeen}
                isTemp={!!message?.isTemp}
                myAddress={myAddress}
                onReply={onReply}
                reply={reply}
                replyIndex={replyIndex}
                scrollToItem={(idx) => rowVirtualizer.scrollToIndex(idx)}
                handleReaction={handleReaction}
                reactions={reactions}
                isUpdating={isUpdating}
              />
            </div>
          );
        })}
      </div>

      
    </div>
    {showScrollButton && (
      <button
        onClick={() => scrollToBottom()}
        style={{
          position: 'absolute',
          bottom: 20,
          right: 20,
          backgroundColor: '#ff5a5f',
          color: 'white',
          padding: '10px 20px',
          borderRadius: '20px',
          cursor: 'pointer',
          zIndex: 10,
        }}
      >
        Scroll to Unread Messages
      </button>
    )}
   </>
 
  );
};
