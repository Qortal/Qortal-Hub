import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  decodeBase64ForUIChatMessages,
  objectToBase64,
} from '../../qdn/encryption/group-encryption';
import { ChatList } from './ChatList';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import Tiptap from './TipTap';
import { CustomButton } from '../../styles/App-styles';
import CircularProgress from '@mui/material/CircularProgress';
import { LoadingSnackbar } from '../Snackbar/LoadingSnackbar';
import {
  getBaseApiReact,
  getBaseApiReactSocket,
  MyContext,
  pauseAllQueues,
  resumeAllQueues,
} from '../../App';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { PUBLIC_NOTIFICATION_CODE_FIRST_SECRET_KEY } from '../../constants/codes';
import { useMessageQueue } from '../../MessageQueueContext';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { Box, ButtonBase, Divider, Typography, useTheme } from '@mui/material';
import ShortUniqueId from 'short-unique-id';
import { ReplyPreview } from './MessageItem';
import { ExitIcon } from '../../assets/Icons/ExitIcon';
import { RESOURCE_TYPE_NUMBER_GROUP_CHAT_REACTIONS } from '../../constants/resourceTypes';
import { isExtMsg } from '../../background';
import AppViewerContainer from '../Apps/AppViewerContainer';
import CloseIcon from '@mui/icons-material/Close';
import { throttle } from 'lodash';

const uid = new ShortUniqueId({ length: 5 });

export const ChatGroup = ({
  selectedGroup,
  secretKey,
  setSecretKey,
  getSecretKey,
  myAddress,
  handleNewEncryptionNotification,
  hide,
  handleSecretKeyCreationInProgress,
  triedToFetchSecretKey,
  myName,
  balance,
  getTimestampEnterChatParent,
  hideView,
  isPrivate,
}) => {
  const { isUserBlocked } = useContext(MyContext);
  const [messages, setMessages] = useState([]);
  const [chatReferences, setChatReferences] = useState({});
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isMoved, setIsMoved] = useState(false);
  const [openSnack, setOpenSnack] = React.useState(false);
  const [infoSnack, setInfoSnack] = React.useState(null);
  const hasInitialized = useRef(false);
  const [isFocusedParent, setIsFocusedParent] = useState(false);
  const [replyMessage, setReplyMessage] = useState(null);
  const [onEditMessage, setOnEditMessage] = useState(null);
  const [isOpenQManager, setIsOpenQManager] = useState(null);

  const [messageSize, setMessageSize] = useState(0);
  const hasInitializedWebsocket = useRef(false);
  const socketRef = useRef(null); // WebSocket reference
  const timeoutIdRef = useRef(null); // Timeout ID reference
  const groupSocketTimeoutRef = useRef(null); // Group Socket Timeout reference
  const editorRef = useRef(null);
  const { queueChats, addToQueue, processWithNewMessages } = useMessageQueue();
  const [, forceUpdate] = useReducer((x) => x + 1, 0);
  const lastReadTimestamp = useRef(null);

  const handleUpdateRef = useRef(null);

  const getTimestampEnterChat = async (selectedGroup) => {
    try {
      return new Promise((res, rej) => {
        window
          .sendMessage('getTimestampEnterChat')
          .then((response) => {
            if (!response?.error) {
              if (response && selectedGroup) {
                lastReadTimestamp.current =
                  response[selectedGroup] || undefined;
                window
                  .sendMessage('addTimestampEnterChat', {
                    timestamp: Date.now(),
                    groupId: selectedGroup,
                  })
                  .catch((error) => {
                    console.error(
                      'Failed to add timestamp:',
                      error.message || 'An error occurred'
                    );
                  });

                setTimeout(() => {
                  getTimestampEnterChatParent();
                }, 600);
              }

              res(response);
              return;
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(error.message || 'An error occurred');
          });
      });
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    if (!selectedGroup) return;
    getTimestampEnterChat(selectedGroup);
  }, [selectedGroup]);

  const members = useMemo(() => {
    const uniqueMembers = new Set();

    messages.forEach((message) => {
      if (message?.senderName) {
        uniqueMembers.add(message?.senderName);
      }
    });

    return Array.from(uniqueMembers);
  }, [messages]);

  const triggerRerender = () => {
    forceUpdate(); // Trigger re-render by updating the state
  };
  const setEditorRef = (editorInstance) => {
    editorRef.current = editorInstance;
  };

  const tempMessages = useMemo(() => {
    if (!selectedGroup) return [];
    if (queueChats[selectedGroup]) {
      return queueChats[selectedGroup]?.filter((item) => !item?.chatReference);
    }
    return [];
  }, [selectedGroup, queueChats]);
  const tempChatReferences = useMemo(() => {
    if (!selectedGroup) return [];
    if (queueChats[selectedGroup]) {
      return queueChats[selectedGroup]?.filter((item) => !!item?.chatReference);
    }
    return [];
  }, [selectedGroup, queueChats]);

  const secretKeyRef = useRef(null);

  useEffect(() => {
    if (secretKey) {
      secretKeyRef.current = secretKey;
    }
  }, [secretKey]);

  // const getEncryptedSecretKey = useCallback(()=> {
  //     const response = getResource()
  //     const decryptResponse = decryptResource()
  //     return
  // }, [])

  const checkForFirstSecretKeyNotification = (messages) => {
    messages?.forEach((message) => {
      try {
        const decodeMsg = atob(message.data);
        if (decodeMsg === PUBLIC_NOTIFICATION_CODE_FIRST_SECRET_KEY) {
          handleSecretKeyCreationInProgress();
          return;
        }
      } catch (error) {
        console.log(error);
      }
    });
  };

  const updateChatMessagesWithBlocksFunc = (e) => {
    if (e.detail) {
      setMessages((prev) =>
        prev?.filter((item) => {
          return !isUserBlocked(item?.sender, item?.senderName);
        })
      );
    }
  };

  useEffect(() => {
    subscribeToEvent(
      'updateChatMessagesWithBlocks',
      updateChatMessagesWithBlocksFunc
    );

    return () => {
      unsubscribeFromEvent(
        'updateChatMessagesWithBlocks',
        updateChatMessagesWithBlocksFunc
      );
    };
  }, []);

  const middletierFunc = async (data: any, groupId: string) => {
    try {
      if (hasInitialized.current) {
        const dataRemovedBlock = data?.filter(
          (item) => !isUserBlocked(item?.sender, item?.senderName)
        );

        decryptMessages(dataRemovedBlock, true);
        return;
      }
      hasInitialized.current = true;
      const url = `${getBaseApiReact()}/chat/messages?txGroupId=${groupId}&encoding=BASE64&limit=0&reverse=false`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const responseData = await response.json();
      const dataRemovedBlock = responseData?.filter((item) => {
        return !isUserBlocked(item?.sender, item?.senderName);
      });

      decryptMessages(dataRemovedBlock, false);
    } catch (error) {
      console.error(error);
    }
  };

  const decryptMessages = (encryptedMessages: any[], isInitiated: boolean) => {
    try {
      if (!secretKeyRef.current) {
        checkForFirstSecretKeyNotification(encryptedMessages);
      }
      return new Promise((res, rej) => {
        window
          .sendMessage('decryptSingle', {
            data: encryptedMessages,
            secretKeyObject: secretKey,
          })
          .then((response) => {
            if (!response?.error) {
              const filterUIMessages = encryptedMessages.filter(
                (item) => !isExtMsg(item.data)
              );
              const decodedUIMessages =
                decodeBase64ForUIChatMessages(filterUIMessages);

              const combineUIAndExtensionMsgsBefore = [
                ...decodedUIMessages,
                ...response,
              ];
              const combineUIAndExtensionMsgs = processWithNewMessages(
                combineUIAndExtensionMsgsBefore.map((item) => ({
                  ...item,
                  ...(item?.decryptedData || {}),
                })),
                selectedGroup
              );
              res(combineUIAndExtensionMsgs);

              if (isInitiated) {
                const formatted = combineUIAndExtensionMsgs
                  .filter((rawItem) => !rawItem?.chatReference)
                  .map((item) => {
                    const additionalFields =
                      item?.data === 'NDAwMQ=='
                        ? {
                            text: '<p>First group key created.</p>',
                          }
                        : {};
                    return {
                      ...item,
                      id: item.signature,
                      text: item?.decryptedData?.message || '',
                      repliedTo:
                        item?.repliedTo || item?.decryptedData?.repliedTo,
                      unread:
                        item?.sender === myAddress
                          ? false
                          : !!item?.chatReference
                            ? false
                            : true,
                      isNotEncrypted: !!item?.messageText,
                      ...additionalFields,
                    };
                  });
                setMessages((prev) => [...prev, ...formatted]);

                setChatReferences((prev) => {
                  const organizedChatReferences = { ...prev };
                  combineUIAndExtensionMsgs
                    .filter(
                      (rawItem) =>
                        rawItem &&
                        rawItem.chatReference &&
                        (rawItem?.decryptedData?.type === 'reaction' ||
                          rawItem?.decryptedData?.type === 'edit' ||
                          rawItem?.type === 'edit' ||
                          rawItem?.isEdited ||
                          rawItem?.type === 'reaction')
                    )
                    .forEach((item) => {
                      try {
                        if (item?.decryptedData?.type === 'edit') {
                          organizedChatReferences[item.chatReference] = {
                            ...(organizedChatReferences[item.chatReference] ||
                              {}),
                            edit: item.decryptedData,
                          };
                        } else if (item?.type === 'edit' || item?.isEdited) {
                          organizedChatReferences[item.chatReference] = {
                            ...(organizedChatReferences[item.chatReference] ||
                              {}),
                            edit: item,
                          };
                        } else {
                          const content =
                            item?.content || item.decryptedData?.content;
                          const sender = item.sender;
                          const newTimestamp = item.timestamp;
                          const contentState =
                            item?.contentState !== undefined
                              ? item?.contentState
                              : item.decryptedData?.contentState;

                          if (
                            !content ||
                            typeof content !== 'string' ||
                            !sender ||
                            typeof sender !== 'string' ||
                            !newTimestamp
                          ) {
                            console.warn(
                              'Invalid content, sender, or timestamp in reaction data',
                              item
                            );
                            return;
                          }

                          organizedChatReferences[item.chatReference] = {
                            ...(organizedChatReferences[item.chatReference] ||
                              {}),
                            reactions:
                              organizedChatReferences[item.chatReference]
                                ?.reactions || {},
                          };

                          organizedChatReferences[item.chatReference].reactions[
                            content
                          ] =
                            organizedChatReferences[item.chatReference]
                              .reactions[content] || [];

                          let latestTimestampForSender = null;

                          organizedChatReferences[item.chatReference].reactions[
                            content
                          ] = organizedChatReferences[
                            item.chatReference
                          ].reactions[content].filter((reaction) => {
                            if (reaction.sender === sender) {
                              latestTimestampForSender = Math.max(
                                latestTimestampForSender || 0,
                                reaction.timestamp
                              );
                            }
                            return reaction.sender !== sender;
                          });

                          if (
                            latestTimestampForSender &&
                            newTimestamp < latestTimestampForSender
                          ) {
                            return;
                          }

                          if (contentState !== false) {
                            organizedChatReferences[
                              item.chatReference
                            ].reactions[content].push(item);
                          }

                          if (
                            organizedChatReferences[item.chatReference]
                              .reactions[content].length === 0
                          ) {
                            delete organizedChatReferences[item.chatReference]
                              .reactions[content];
                          }
                        }
                      } catch (error) {
                        console.error(
                          'Error processing reaction/edit item:',
                          error,
                          item
                        );
                      }
                    });

                  return organizedChatReferences;
                });
              } else {
                let firstUnreadFound = false;
                const formatted = combineUIAndExtensionMsgs
                  .filter((rawItem) => !rawItem?.chatReference)
                  .map((item) => {
                    const additionalFields =
                      item?.data === 'NDAwMQ=='
                        ? {
                            text: '<p>First group key created.</p>',
                          }
                        : {};
                    const divide =
                      lastReadTimestamp.current &&
                      !firstUnreadFound &&
                      item.timestamp > lastReadTimestamp.current &&
                      myAddress !== item?.sender;

                    if (divide) {
                      firstUnreadFound = true;
                    }
                    return {
                      ...item,
                      id: item.signature,
                      text: item?.decryptedData?.message || '',
                      repliedTo:
                        item?.repliedTo || item?.decryptedData?.repliedTo,
                      isNotEncrypted: !!item?.messageText,
                      unread: false,
                      divide,
                      ...additionalFields,
                    };
                  });
                setMessages(formatted);

                setChatReferences((prev) => {
                  const organizedChatReferences = { ...prev };

                  combineUIAndExtensionMsgs
                    .filter(
                      (rawItem) =>
                        rawItem &&
                        rawItem.chatReference &&
                        (rawItem?.decryptedData?.type === 'reaction' ||
                          rawItem?.decryptedData?.type === 'edit' ||
                          rawItem?.type === 'edit' ||
                          rawItem?.isEdited ||
                          rawItem?.type === 'reaction')
                    )
                    .forEach((item) => {
                      try {
                        if (item?.decryptedData?.type === 'edit') {
                          organizedChatReferences[item.chatReference] = {
                            ...(organizedChatReferences[item.chatReference] ||
                              {}),
                            edit: item.decryptedData,
                          };
                        } else if (item?.type === 'edit' || item?.isEdited) {
                          organizedChatReferences[item.chatReference] = {
                            ...(organizedChatReferences[item.chatReference] ||
                              {}),
                            edit: item,
                          };
                        } else {
                          const content =
                            item?.content || item.decryptedData?.content;
                          const sender = item.sender;
                          const newTimestamp = item.timestamp;
                          const contentState =
                            item?.contentState !== undefined
                              ? item?.contentState
                              : item.decryptedData?.contentState;

                          if (
                            !content ||
                            typeof content !== 'string' ||
                            !sender ||
                            typeof sender !== 'string' ||
                            !newTimestamp
                          ) {
                            console.warn(
                              'Invalid content, sender, or timestamp in reaction data',
                              item
                            );
                            return;
                          }

                          organizedChatReferences[item.chatReference] = {
                            ...(organizedChatReferences[item.chatReference] ||
                              {}),
                            reactions:
                              organizedChatReferences[item.chatReference]
                                ?.reactions || {},
                          };

                          organizedChatReferences[item.chatReference].reactions[
                            content
                          ] =
                            organizedChatReferences[item.chatReference]
                              .reactions[content] || [];

                          let latestTimestampForSender = null;

                          organizedChatReferences[item.chatReference].reactions[
                            content
                          ] = organizedChatReferences[
                            item.chatReference
                          ].reactions[content].filter((reaction) => {
                            if (reaction.sender === sender) {
                              latestTimestampForSender = Math.max(
                                latestTimestampForSender || 0,
                                reaction.timestamp
                              );
                            }
                            return reaction.sender !== sender;
                          });

                          if (
                            latestTimestampForSender &&
                            newTimestamp < latestTimestampForSender
                          ) {
                            return;
                          }

                          if (contentState !== false) {
                            organizedChatReferences[
                              item.chatReference
                            ].reactions[content].push(item);
                          }

                          if (
                            organizedChatReferences[item.chatReference]
                              .reactions[content].length === 0
                          ) {
                            delete organizedChatReferences[item.chatReference]
                              .reactions[content];
                          }
                        }
                      } catch (error) {
                        console.error(
                          'Error processing reaction item:',
                          error,
                          item
                        );
                      }
                    });

                  return organizedChatReferences;
                });
              }
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(error.message || 'An error occurred');
          });
      });
    } catch (error) {
      console.log(error);
    }
  };

  const forceCloseWebSocket = () => {
    if (socketRef.current) {
      clearTimeout(timeoutIdRef.current);
      clearTimeout(groupSocketTimeoutRef.current);
      socketRef.current.close(1000, 'forced');
      socketRef.current = null;
    }
  };

  const pingGroupSocket = () => {
    try {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send('ping');
        timeoutIdRef.current = setTimeout(() => {
          if (socketRef.current) {
            socketRef.current.close();
            clearTimeout(groupSocketTimeoutRef.current);
          }
        }, 5000); // Close if no pong in 5 seconds
      }
    } catch (error) {
      console.error('Error during ping:', error);
    }
  };
  const initWebsocketMessageGroup = () => {
    let socketLink = `${getBaseApiReactSocket()}/websockets/chat/messages?txGroupId=${selectedGroup}&encoding=BASE64&limit=100`;
    socketRef.current = new WebSocket(socketLink);

    socketRef.current.onopen = () => {
      setTimeout(pingGroupSocket, 50);
    };
    socketRef.current.onmessage = (e) => {
      try {
        if (e.data === 'pong') {
          clearTimeout(timeoutIdRef.current);
          groupSocketTimeoutRef.current = setTimeout(pingGroupSocket, 45000); // Ping every 45 seconds
        } else {
          middletierFunc(JSON.parse(e.data), selectedGroup);
          setIsLoading(false);
        }
      } catch (error) {
        console.log(error);
      }
    };
    socketRef.current.onclose = () => {
      clearTimeout(groupSocketTimeoutRef.current);
      clearTimeout(timeoutIdRef.current);
      console.warn(`WebSocket closed: ${event.reason || 'unknown reason'}`);
      if (event.reason !== 'forced' && event.code !== 1000) {
        setTimeout(() => initWebsocketMessageGroup(), 1000); // Retry after 10 seconds
      }
    };
    socketRef.current.onerror = (e) => {
      clearTimeout(groupSocketTimeoutRef.current);
      clearTimeout(timeoutIdRef.current);
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  };

  useEffect(() => {
    if (hasInitializedWebsocket.current) return;
    if (triedToFetchSecretKey && !secretKey) {
      forceCloseWebSocket();
      setMessages([]);
      setIsLoading(true);
      initWebsocketMessageGroup();
    }
  }, [triedToFetchSecretKey, secretKey, isPrivate]);

  useEffect(() => {
    if (isPrivate === null) return;
    if (isPrivate === false || !secretKey || hasInitializedWebsocket.current)
      return;
    forceCloseWebSocket();
    setMessages([]);
    setIsLoading(true);
    pauseAllQueues();
    setTimeout(() => {
      resumeAllQueues();
    }, 6000);
    initWebsocketMessageGroup();
    hasInitializedWebsocket.current = true;
  }, [secretKey, isPrivate]);

  useEffect(() => {
    const notifications = messages.filter(
      (message) => message?.decryptedData?.type === 'notification'
    );
    if (notifications.length === 0) return;
    const latestNotification = notifications.reduce((latest, current) => {
      return current.timestamp > latest.timestamp ? current : latest;
    }, notifications[0]);
    handleNewEncryptionNotification(latestNotification);
  }, [messages]);

  const encryptChatMessage = async (
    data: string,
    secretKeyObject: any,
    reactiontypeNumber?: number
  ) => {
    try {
      return new Promise((res, rej) => {
        window
          .sendMessage('encryptSingle', {
            data,
            secretKeyObject,
            typeNumber: reactiontypeNumber,
          })
          .then((response) => {
            if (!response?.error) {
              res(response);
              return;
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(error.message || 'An error occurred');
          });
      });
    } catch (error) {
      console.log(error);
    }
  };

  const sendChatGroup = async ({
    groupId,
    typeMessage = undefined,
    chatReference = undefined,
    messageText,
  }: any) => {
    try {
      return new Promise((res, rej) => {
        window
          .sendMessage(
            'sendChatGroup',
            {
              groupId,
              typeMessage,
              chatReference,
              messageText,
            },
            120000
          )
          .then((response) => {
            if (!response?.error) {
              res(response);
              return;
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(error.message || 'An error occurred');
          });
      });
    } catch (error) {
      throw new Error(error);
    }
  };
  const clearEditorContent = () => {
    if (editorRef.current) {
      setMessageSize(0);
      editorRef.current.chain().focus().clearContent().run();
    }
  };

  const sendMessage = async () => {
    try {
      if (messageSize > 4000) return;
      if (isPrivate === null)
        throw new Error('Unable to determine if group is private');
      if (isSending) return;
      if (+balance < 4)
        throw new Error('You need at least 4 QORT to send a message');
      pauseAllQueues();
      if (editorRef.current) {
        const htmlContent = editorRef.current.getHTML();

        if (!htmlContent?.trim() || htmlContent?.trim() === '<p></p>') return;

        setIsSending(true);
        const message =
          isPrivate === false ? editorRef.current.getJSON() : htmlContent;
        const secretKeyObject = await getSecretKey(false, true);

        let repliedTo = replyMessage?.signature;

        if (replyMessage?.chatReference) {
          repliedTo = replyMessage?.chatReference;
        }
        let chatReference = onEditMessage?.signature;

        const publicData = isPrivate
          ? {}
          : {
              isEdited: chatReference ? true : false,
            };
        const otherData = {
          repliedTo,
          ...(onEditMessage?.decryptedData || {}),
          type: chatReference ? 'edit' : '',
          specialId: uid.rnd(),
          ...publicData,
        };
        const objectMessage = {
          ...(otherData || {}),
          [isPrivate ? 'message' : 'messageText']: message,
          version: 3,
        };
        const message64: any = await objectToBase64(objectMessage);

        const encryptSingle =
          isPrivate === false
            ? JSON.stringify(objectMessage)
            : await encryptChatMessage(message64, secretKeyObject);
        // const res = await sendChatGroup({groupId: selectedGroup,messageText: encryptSingle})

        const sendMessageFunc = async () => {
          return await sendChatGroup({
            groupId: selectedGroup,
            messageText: encryptSingle,
            chatReference,
          });
        };

        // Add the function to the queue
        const messageObj = {
          message: {
            text: htmlContent,
            timestamp: Date.now(),
            senderName: myName,
            sender: myAddress,
            ...(otherData || {}),
          },
          chatReference,
        };
        addToQueue(sendMessageFunc, messageObj, 'chat', selectedGroup);
        setTimeout(() => {
          executeEvent('sent-new-message-group', {});
        }, 150);
        clearEditorContent();
        setReplyMessage(null);
        setOnEditMessage(null);
      }
      // send chat message
    } catch (error) {
      const errorMsg = error?.message || error;
      setInfoSnack({
        type: 'error',
        message: errorMsg,
      });
      setOpenSnack(true);
      console.error(error);
    } finally {
      setIsSending(false);
      resumeAllQueues();
    }
  };

  useEffect(() => {
    if (!editorRef?.current) return;

    handleUpdateRef.current = throttle(async () => {
      try {
        if (isPrivate) {
          const htmlContent = editorRef.current.getHTML();
          const message64 = await objectToBase64(JSON.stringify(htmlContent));
          const secretKeyObject = await getSecretKey(false, true);
          const encryptSingle = await encryptChatMessage(
            message64,
            secretKeyObject
          );
          setMessageSize((encryptSingle?.length || 0) + 200);
        } else {
          const htmlContent = editorRef.current.getJSON();
          const message = JSON.stringify(htmlContent);
          const size = new Blob([message]).size;
          setMessageSize(size + 300);
        }
      } catch (error) {
        // calc size error
      }
    }, 1200);

    const currentEditor = editorRef.current;

    currentEditor.on('update', handleUpdateRef.current);

    return () => {
      currentEditor.off('update', handleUpdateRef.current);
    };
  }, [editorRef, setMessageSize, isPrivate]);

  useEffect(() => {
    if (hide) {
      setTimeout(() => setIsMoved(true), 500); // Wait for the fade-out to complete before moving
    } else {
      setIsMoved(false); // Reset the position immediately when showing
    }
  }, [hide]);

  const onReply = useCallback(
    (message) => {
      if (onEditMessage) {
        clearEditorContent();
      }
      setReplyMessage(message);
      setOnEditMessage(null);
      editorRef?.current?.chain().focus();
    },
    [onEditMessage]
  );

  const onEdit = useCallback((message) => {
    setOnEditMessage(message);
    setReplyMessage(null);
    editorRef.current
      .chain()
      .focus()
      .setContent(message?.messageText || message?.text)
      .run();
  }, []);
  const handleReaction = useCallback(
    async (reaction, chatMessage, reactionState = true) => {
      try {
        if (isSending) return;
        if (+balance < 4)
          throw new Error('You need at least 4 QORT to send a message');
        pauseAllQueues();

        setIsSending(true);
        const message = '';
        const secretKeyObject = await getSecretKey(false, true);

        const otherData = {
          specialId: uid.rnd(),
          type: 'reaction',
          content: reaction,
          contentState: reactionState,
        };
        const objectMessage = {
          message,
          ...(otherData || {}),
        };
        const message64: any = await objectToBase64(objectMessage);
        const reactiontypeNumber = RESOURCE_TYPE_NUMBER_GROUP_CHAT_REACTIONS;
        const encryptSingle =
          isPrivate === false
            ? JSON.stringify(objectMessage)
            : await encryptChatMessage(
                message64,
                secretKeyObject,
                reactiontypeNumber
              );
        // const res = await sendChatGroup({groupId: selectedGroup,messageText: encryptSingle})

        const sendMessageFunc = async () => {
          return await sendChatGroup({
            groupId: selectedGroup,
            messageText: encryptSingle,
            chatReference: chatMessage.signature,
          });
        };

        // Add the function to the queue
        const messageObj = {
          message: {
            text: message,
            timestamp: Date.now(),
            senderName: myName,
            sender: myAddress,
            ...(otherData || {}),
          },
          chatReference: chatMessage.signature,
        };
        addToQueue(sendMessageFunc, messageObj, 'chat-reaction', selectedGroup);
        // setTimeout(() => {
        //   executeEvent("sent-new-message-group", {})
        // }, 150);
        // clearEditorContent()
        // setReplyMessage(null)

        // send chat message
      } catch (error) {
        const errorMsg = error?.message || error;
        setInfoSnack({
          type: 'error',
          message: errorMsg,
        });
        setOpenSnack(true);
        console.error(error);
      } finally {
        setIsSending(false);
        resumeAllQueues();
      }
    },
    [isPrivate]
  );

  const openQManager = useCallback(() => {
    setIsOpenQManager(true);
  }, []);

  const theme = useTheme();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        left: hide && '-100000px',
        opacity: hide ? 0 : 1,
        position: hide ? 'absolute' : 'relative',
        width: '100%',
        padding: '10px',
      }}
    >
      <ChatList
        isPrivate={isPrivate}
        hasSecretKey={!!secretKey}
        openQManager={openQManager}
        enableMentions
        onReply={onReply}
        onEdit={onEdit}
        chatId={selectedGroup}
        initialMessages={messages}
        myAddress={myAddress}
        tempMessages={tempMessages}
        handleReaction={handleReaction}
        chatReferences={chatReferences}
        tempChatReferences={tempChatReferences}
        members={members}
        myName={myName}
        selectedGroup={selectedGroup}
      />

      {(!!secretKey || isPrivate === false) && (
        <div
          style={{
            backgroundColor: theme.palette.background.surface,
            bottom: isFocusedParent ? '0px' : 'unset',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'row',
            flexShrink: 0,
            minHeight: '150px',
            overflow: 'hidden',
            padding: '20px',
            position: isFocusedParent ? 'fixed' : 'relative',
            top: isFocusedParent ? '0px' : 'unset',
            width: '100%',
            zIndex: isFocusedParent ? 5 : 'unset',
            border: `1px solid ${theme.palette.border.subtle}`,
            borderRadius: '10px',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flexGrow: 1,
              flexShrink: 0,
              justifyContent: 'flex-end',
              overflow: 'auto',
              width: 'calc(100% - 100px)',
            }}
          >
            {replyMessage && (
              <Box
                sx={{
                  alignItems: 'flex-start',
                  display: 'flex',
                  gap: '5px',
                  width: '100%',
                }}
              >
                <ReplyPreview message={replyMessage} />

                <ButtonBase
                  onClick={() => {
                    setReplyMessage(null);

                    setOnEditMessage(null);
                  }}
                >
                  <ExitIcon />
                </ButtonBase>
              </Box>
            )}
            {onEditMessage && (
              <Box
                sx={{
                  alignItems: 'flex-start',
                  display: 'flex',
                  gap: '5px',
                  width: '100%',
                }}
              >
                <ReplyPreview isEdit message={onEditMessage} />

                <ButtonBase
                  onClick={() => {
                    setReplyMessage(null);
                    setOnEditMessage(null);

                    clearEditorContent();
                  }}
                >
                  <ExitIcon />
                </ButtonBase>
              </Box>
            )}

            <Tiptap
              enableMentions
              setEditorRef={setEditorRef}
              onEnter={sendMessage}
              isChat
              disableEnter={false}
              isFocusedParent={isFocusedParent}
              setIsFocusedParent={setIsFocusedParent}
              membersWithNames={members}
            />
            {messageSize > 750 && (
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'flex-start',
                  position: 'relative',
                  width: '100%',
                }}
              >
                <Typography
                  sx={{
                    fontSize: '12px',
                    color: messageSize > 4000 ? 'var(--danger)' : 'unset',
                  }}
                >{`Your message size is of ${messageSize} bytes out of a maximum of 4000`}</Typography>
              </Box>
            )}
          </div>

          <Box
            sx={{
              display: 'flex',
              flexShrink: 0,
              gap: '10px',
              justifyContent: 'center',
              position: 'relative',
              width: '100px',
            }}
          >
            <CustomButton
              onClick={() => {
                if (isSending) return;
                sendMessage();
              }}
              style={{
                alignSelf: 'center',
                background: isSending
                  ? theme.palette.background.default
                  : theme.palette.background.paper,
                cursor: isSending ? 'default' : 'pointer',
                flexShrink: 0,
                marginTop: 'auto',
                minWidth: 'auto',
                padding: '5px',
                width: '100px',
              }}
            >
              {isSending && (
                <CircularProgress
                  size={18}
                  sx={{
                    color: theme.palette.text.primary,
                    left: '50%',
                    marginLeft: '-12px',
                    marginTop: '-12px',
                    position: 'absolute',
                    top: '50%',
                  }}
                />
              )}
              {` Send`}
            </CustomButton>
          </Box>
        </div>
      )}
      {isOpenQManager !== null && (
        <Box
          sx={{
            backgroundColor: theme.palette.background.default,
            borderTopLeftRadius: '10px',
            borderTopRightRadius: '10px',
            bottom: 0,
            boxShadow: 4,
            display: hideView
              ? 'none'
              : isOpenQManager === true
                ? 'block'
                : 'none',
            height: '600px',
            maxHeight: '100vh',
            maxWidth: '100vw',
            overflow: 'hidden',
            position: 'fixed',
            right: 0,
            width: '400px',
            zIndex: 100,
          }}
        >
          <Box
            sx={{
              height: '100%',
              width: '100%',
            }}
          >
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                height: '40px',
                justifyContent: 'space-between',
                padding: '5px',
              }}
            >
              <Typography>Q-Manager</Typography>
              <ButtonBase
                onClick={() => {
                  setIsOpenQManager(false);
                }}
              >
                <CloseIcon
                  sx={{
                    color: 'white',
                  }}
                />
              </ButtonBase>
            </Box>
            <Divider />
            <AppViewerContainer
              customHeight="560px"
              app={{
                tabId: '5558588',
                name: 'Q-Manager',
                service: 'APP',
                path: `?groupId=${selectedGroup}`,
              }}
              isSelected
            />
          </Box>
        </Box>
      )}

      {/* <ChatContainerComp messages={formatMessages} /> */}

      <LoadingSnackbar
        open={isLoading}
        info={{
          message: 'Loading chat... please wait.',
        }}
      />

      <CustomizedSnackbars
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />
    </div>
  );
};
