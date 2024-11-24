import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import ShortUniqueId from "short-unique-id";

const MessageQueueContext = createContext(null);

export const useMessageQueue = () => useContext(MessageQueueContext);

const uid = new ShortUniqueId({ length: 8 });

export const MessageQueueProvider = ({ children }) => {
  const messageQueueRef = useRef([]);
  const [queueChats, setQueueChats] = useState({}); // Stores chats and status for display
  const maxRetries = 2;

  const clearStatesMessageQueueProvider = useCallback(() => {
    setQueueChats({});
    messageQueueRef.current = [];
  }, []);

  // Promise-based lock to prevent concurrent executions
  const processingPromiseRef = useRef(Promise.resolve());

  // Function to add a message to the queue
  const addToQueue = useCallback((sendMessageFunc, messageObj, type, groupDirectId) => {
    const tempId = uid.rnd();
    const chatData = {
      ...messageObj,
      type,
      groupDirectId,
      signature: uid.rnd(),
      identifier: tempId,
      retries: 0, // Retry count for display purposes
      status: 'pending' // Initial status is 'pending'
    };

    // Add chat data to queueChats for status tracking
    setQueueChats((prev) => ({
      ...prev,
      [groupDirectId]: [...(prev[groupDirectId] || []), chatData]
    }));

    // Add the message to the global messageQueueRef
    messageQueueRef.current.push({
      func: sendMessageFunc,
      identifier: tempId,
      groupDirectId,
      specialId: messageObj?.message?.specialId
    });

    // Start processing the queue
    processQueue([], groupDirectId);
  }, []);

  // Function to process the message queue
  const processQueue = useCallback((newMessages = [], groupDirectId) => {
    processingPromiseRef.current = processingPromiseRef.current
      .then(() => processQueueInternal(newMessages, groupDirectId))
      .catch((err) => console.error('Error in processQueue:', err));
  }, []);

  // Internal function to handle queue processing
  const processQueueInternal = async (newMessages, groupDirectId) => {
    // Remove any messages from the queue that match the specialId from newMessages
    if (newMessages.length > 0) {
      messageQueueRef.current = messageQueueRef.current.filter((msg) => {
        return !newMessages.some(newMsg => newMsg?.specialId === msg?.specialId);
      });

      // Remove corresponding entries in queueChats for the provided groupDirectId
      setQueueChats((prev) => {
        const updatedChats = { ...prev };
        if (updatedChats[groupDirectId]) {
          updatedChats[groupDirectId] = updatedChats[groupDirectId].filter((chat) => {
            return !newMessages.some(newMsg => newMsg?.specialId === chat?.message?.specialId);
          });

          // Remove messages with status 'failed-permanent'
          updatedChats[groupDirectId] = updatedChats[groupDirectId].filter((chat) => {
            return chat?.status !== 'failed-permanent';
          });

          // If no more chats for this group, delete the groupDirectId entry
          if (updatedChats[groupDirectId].length === 0) {
            delete updatedChats[groupDirectId];
          }
        }
        return updatedChats;
      });
    }

    // If the queue is empty, no need to process
    if (messageQueueRef.current.length === 0) return;

    // Process messages sequentially
    while (messageQueueRef.current.length > 0) {
      const currentMessage = messageQueueRef.current[0]; // Get the first message in the queue
      const { groupDirectId, identifier } = currentMessage;

      // Update the chat status to 'sending'
      setQueueChats((prev) => {
        const updatedChats = { ...prev };
        if (updatedChats[groupDirectId]) {
          const chatIndex = updatedChats[groupDirectId].findIndex(
            (item) => item.identifier === identifier
          );
          if (chatIndex !== -1) {
            updatedChats[groupDirectId][chatIndex].status = 'sending';
          }
        }
        return updatedChats;
      });

      try {
        // Execute the function stored in the messageQueueRef
        await currentMessage.func();

        // Remove the message from the queue after successful sending
        messageQueueRef.current.shift();

        // Remove the message from queueChats
        setQueueChats((prev) => {
          const updatedChats = { ...prev };
          if (updatedChats[groupDirectId]) {
            updatedChats[groupDirectId] = updatedChats[groupDirectId].filter(
              (item) => item.identifier !== identifier
            );

            // If no more chats for this group, delete the groupDirectId entry
            if (updatedChats[groupDirectId].length === 0) {
              delete updatedChats[groupDirectId];
            }
          }
          return updatedChats;
        });

      } catch (error) {
        console.error('Message sending failed', error);

        // Retry logic
        setQueueChats((prev) => {
          const updatedChats = { ...prev };
          const chatIndex = updatedChats[groupDirectId]?.findIndex(
            (item) => item.identifier === identifier
          );
          if (chatIndex !== -1) {
            const retries = updatedChats[groupDirectId][chatIndex].retries;
            if (retries < maxRetries) {
              // Increment retry count and set status to 'failed'
              updatedChats[groupDirectId][chatIndex].retries += 1;
              updatedChats[groupDirectId][chatIndex].status = 'failed';
            } else {
              // Max retries reached, set status to 'failed-permanent'
              updatedChats[groupDirectId][chatIndex].status = 'failed-permanent';

              // Remove the message from the queue after max retries
              messageQueueRef.current.shift();
            }
          }
          return updatedChats;
        });
      }

      // Optional delay between processing messages
      // await new Promise((res) => setTimeout(res, 5000));
    }
  };

  // Method to process with new messages and groupDirectId
  const processWithNewMessages = (newMessages, groupDirectId) => {
    processQueue(newMessages, groupDirectId);
  };

  return (
    <MessageQueueContext.Provider value={{ addToQueue, queueChats, clearStatesMessageQueueProvider, processWithNewMessages }}>
      {children}
    </MessageQueueContext.Provider>
  );
};
