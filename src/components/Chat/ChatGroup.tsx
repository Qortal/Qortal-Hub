import {
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
import Tiptap from './TipTap';
import { CustomButton } from '../../styles/App-styles';
import CircularProgress from '@mui/material/CircularProgress';
import { LoadingSnackbar } from '../Snackbar/LoadingSnackbar';
import {
  getBaseApiReact,
  getBaseApiReactSocket,
  QORTAL_APP_CONTEXT,
  pauseAllQueues,
  resumeAllQueues,
} from '../../App';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import {
  MAX_SIZE_MESSAGE,
  MIN_REQUIRED_QORTS,
  PUBLIC_NOTIFICATION_CODE_FIRST_SECRET_KEY,
} from '../../constants/constants';
import { useMessageQueue } from '../../messaging/MessageQueueContext.tsx';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import {
  Box,
  ButtonBase,
  Divider,
  IconButton,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import ShortUniqueId from 'short-unique-id';
import { ReplyPreview } from './MessageItem';
import { ExitIcon } from '../../assets/Icons/ExitIcon';
import { RESOURCE_TYPE_NUMBER_GROUP_CHAT_REACTIONS } from '../../constants/constants';
import { getFee, isExtMsg } from '../../background/background.ts';
import AppViewerContainer from '../Apps/AppViewerContainer';
import CloseIcon from '@mui/icons-material/Close';
import { throttle } from 'lodash';
import ImageIcon from '@mui/icons-material/Image';
import { messageHasImage } from '../../utils/chat';
import { useTranslation } from 'react-i18next';

const uid = new ShortUniqueId({ length: 5 });
const uidImages = new ShortUniqueId({ length: 12 });

export const ChatGroup = ({
  selectedGroup,
  secretKey,
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
  const { isUserBlocked, show } = useContext(QORTAL_APP_CONTEXT);
  const [messages, setMessages] = useState([]);
  const [chatReferences, setChatReferences] = useState({});
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isMoved, setIsMoved] = useState(false);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const hasInitialized = useRef(false);
  const [isFocusedParent, setIsFocusedParent] = useState(false);
  const [replyMessage, setReplyMessage] = useState(null);
  const [onEditMessage, setOnEditMessage] = useState(null);
  const [isOpenQManager, setIsOpenQManager] = useState(null);
  const [isDeleteImage, setIsDeleteImage] = useState(false);
  const [messageSize, setMessageSize] = useState(0);
  const [chatImagesToSave, setChatImagesToSave] = useState([]);
  const hasInitializedWebsocket = useRef(false);
  const socketRef = useRef(null); // WebSocket reference
  const timeoutIdRef = useRef(null); // Timeout ID reference
  const groupSocketTimeoutRef = useRef(null); // Group Socket Timeout reference
  const editorRef = useRef(null);
  const { queueChats, addToQueue, processWithNewMessages } = useMessageQueue();
  const [, forceUpdate] = useReducer((x) => x + 1, 0);
  const lastReadTimestamp = useRef(null);
  const handleUpdateRef = useRef(null);
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

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
            rej(
              error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
            );
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
                      item?.data === 'NDAwMQ==' // TODO put magic string somewhere in a file
                        ? {
                            text: `<p>${t(
                              'group:message.generic.group_key_created',
                              {
                                postProcess: 'capitalizeFirstChar',
                              }
                            )}</p>`,
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
                              t('group:message.generic.invalid_content', {
                                postProcess: 'capitalizeFirstChar',
                              }),
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
                            text: `<p>${t(
                              'group:message.generic.group_key_created',
                              {
                                postProcess: 'capitalizeFirstChar',
                              }
                            )}</p>`,
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
                              t('group:message.generic.invalid_content', {
                                postProcess: 'capitalizeFirstChar',
                              }),
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
            rej(
              error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
            );
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
            rej(
              error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
            );
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
            rej(
              error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
            );
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
      if (messageSize > MAX_SIZE_MESSAGE) return;
      if (isPrivate === null)
        throw new Error(
          t('group:message.error:determine_group_private', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      if (isSending) return;
      if (+balance < MIN_REQUIRED_QORTS)
        throw new Error(
          t('group:message.error.qortals_required', {
            quantity: MIN_REQUIRED_QORTS,
            postProcess: 'capitalizeFirstChar',
          })
        );
      pauseAllQueues();
      if (editorRef.current) {
        let htmlContent = editorRef.current.getHTML();
        const deleteImage =
          onEditMessage && isDeleteImage && messageHasImage(onEditMessage);

        const hasImage =
          chatImagesToSave?.length > 0 || onEditMessage?.images?.length > 0;
        if (
          (!htmlContent?.trim() || htmlContent?.trim() === '<p></p>') &&
          !hasImage &&
          !deleteImage
        )
          return;
        if (htmlContent?.trim() === '<p></p>') {
          htmlContent = null;
        }
        setIsSending(true);
        const message =
          isPrivate === false
            ? !htmlContent
              ? '<p></p>'
              : editorRef.current.getJSON()
            : htmlContent;
        const secretKeyObject = await getSecretKey(false, true);

        let repliedTo = replyMessage?.signature;

        if (replyMessage?.chatReference) {
          repliedTo = replyMessage?.chatReference;
        }

        const chatReference = onEditMessage?.signature;

        const publicData = isPrivate
          ? {}
          : {
              isEdited: chatReference ? true : false,
            };

        interface ImageToPublish {
          service: string;
          identifier: string;
          name: string;
          base64: string;
        }

        const imagesToPublish: ImageToPublish[] = [];

        if (deleteImage) {
          const fee = await getFee('ARBITRARY');
          await show({
            publishFee: fee.fee + ' QORT',
            message: t('core:message.question.delete_chat_image', {
              postProcess: 'capitalizeFirstChar',
            }),
          });

          // TODO magic string
          await window.sendMessage('publishOnQDN', {
            data: 'RA==',
            identifier: onEditMessage?.images[0]?.identifier,
            service: onEditMessage?.images[0]?.service,
            uploadType: 'base64',
          });
        }

        if (chatImagesToSave?.length > 0) {
          const imageToSave = chatImagesToSave[0];

          const base64ToSave = isPrivate
            ? await encryptChatMessage(imageToSave, secretKeyObject)
            : imageToSave;

          // 1 represents public group, 0 is private
          const identifier = `grp-q-manager_${isPrivate ? 0 : 1}_group_${selectedGroup}_${uidImages.rnd()}`;
          imagesToPublish.push({
            service: 'IMAGE',
            identifier,
            name: myName,
            base64: base64ToSave,
          });

          const res = await window.sendMessage(
            'PUBLISH_MULTIPLE_QDN_RESOURCES',
            {
              resources: imagesToPublish,
            },
            240000,
            true
          );
          if (res?.error)
            throw new Error(
              t('core:message.error.publish_image', {
                postProcess: 'capitalizeFirstChar',
              })
            );
        }

        const images =
          imagesToPublish?.length > 0
            ? imagesToPublish.map((item) => {
                return {
                  name: item.name,
                  identifier: item.identifier,
                  service: item.service,
                  timestamp: Date.now(),
                };
              })
            : chatReference
              ? isDeleteImage
                ? []
                : onEditMessage?.images || []
              : [];

        const otherData = {
          repliedTo,
          ...(onEditMessage?.decryptedData || {}),
          type: chatReference ? 'edit' : '',
          specialId: uid.rnd(),
          images: images,
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
        setIsDeleteImage(false);
        setChatImagesToSave([]);
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
      setIsDeleteImage(false);
      setChatImagesToSave([]);
      editorRef?.current?.chain().focus();
    },
    [onEditMessage]
  );

  const onEdit = useCallback((message) => {
    setOnEditMessage(message);
    setReplyMessage(null);
    try {
      editorRef.current
        .chain()
        .focus()
        .setContent(message?.messageText || message?.text || '<p></p>')
        .run();
    } catch (error) {
      console.error(error);
    }
  }, []);

  const handleReaction = useCallback(
    async (reaction, chatMessage, reactionState = true) => {
      try {
        if (isSending) return;
        if (+balance < MIN_REQUIRED_QORTS)
          throw new Error(
            t('group:message.error.qortals_required', {
              quantity: MIN_REQUIRED_QORTS,
              postProcess: 'capitalizeFirstChar',
            })
          );

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

  const insertImage = useCallback(
    (img) => {
      if (
        chatImagesToSave?.length > 0 ||
        (messageHasImage(onEditMessage) && !isDeleteImage)
      ) {
        setInfoSnack({
          type: 'error',
          message: t('core:message.generic.message_with_image', {
            postProcess: 'capitalizeFirstChar',
          }),
        });
        setOpenSnack(true);
        return;
      }
      setChatImagesToSave((prev) => [...prev, img]);
    },
    [chatImagesToSave, onEditMessage?.images, isDeleteImage]
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        left: hide && '-100000px',
        opacity: hide ? 0 : 1,
        padding: '10px',
        position: hide ? 'absolute' : 'relative',
        width: '100%',
      }}
    >
      <ChatList
        chatId={selectedGroup}
        chatReferences={chatReferences}
        enableMentions
        handleReaction={handleReaction}
        hasSecretKey={!!secretKey}
        initialMessages={messages}
        isPrivate={isPrivate}
        members={members}
        myAddress={myAddress}
        myName={myName}
        onEdit={onEdit}
        onReply={onReply}
        openQManager={openQManager}
        selectedGroup={selectedGroup}
        tempChatReferences={tempChatReferences}
        tempMessages={tempMessages}
      />

      {(!!secretKey || isPrivate === false) && (
        <div
          style={{
            backgroundColor: theme.palette.background.surface,
            border: `1px solid ${theme.palette.border.subtle}`,
            borderRadius: '10px',
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
            <Box
              sx={{
                alignItems: 'flex-start',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '10px',
                width: '100%',
              }}
            >
              {!isDeleteImage &&
                onEditMessage &&
                messageHasImage(onEditMessage) &&
                onEditMessage?.images?.map((_, index) => (
                  <div
                    key={index}
                    style={{
                      height: '50px',
                      position: 'relative',
                      width: '50px',
                    }}
                  >
                    <ImageIcon
                      color="primary"
                      sx={{
                        borderRadius: '3px',
                        height: '100%',
                        width: '100%',
                      }}
                    />

                    <Tooltip title="Delete image">
                      <IconButton
                        onClick={() => setIsDeleteImage(true)}
                        size="small"
                        sx={{
                          position: 'absolute',
                          top: '50%',
                          left: '50%',
                          transform: 'translate(-50%, -50%)',
                          backgroundColor: (theme) =>
                            theme.palette.background.paper,
                          color: (theme) => theme.palette.text.primary,
                          borderRadius: '50%',
                          opacity: 0,
                          transition: 'opacity 0.2s',
                          boxShadow: (theme) => theme.shadows[2],
                          '&:hover': {
                            backgroundColor: (theme) =>
                              theme.palette.background.default,
                            opacity: 1,
                          },
                          pointerEvents: 'auto',
                        }}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </div>
                ))}

              {chatImagesToSave.map((imgBase64, index) => (
                <div
                  key={index}
                  style={{
                    height: '50px',
                    position: 'relative',
                    width: '50px',
                  }}
                >
                  <img
                    src={`data:image/webp;base64,${imgBase64}`}
                    style={{
                      height: '100%',
                      width: '100%',
                      objectFit: 'contain',
                      borderRadius: '3px',
                    }}
                  />

                  <Tooltip title="Remove image">
                    <IconButton
                      onClick={() =>
                        setChatImagesToSave((prev) =>
                          prev.filter((_, i) => i !== index)
                        )
                      }
                      size="small"
                      sx={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        backgroundColor: (theme) =>
                          theme.palette.background.paper,
                        color: (theme) => theme.palette.text.primary,
                        borderRadius: '50%',
                        opacity: 0,
                        transition: 'opacity 0.2s',
                        boxShadow: (theme) => theme.shadows[2],
                        '&:hover': {
                          backgroundColor: (theme) =>
                            theme.palette.background.default,
                          opacity: 1,
                        },
                        pointerEvents: 'auto',
                      }}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </div>
              ))}
            </Box>

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
                    setIsDeleteImage(false);
                    setChatImagesToSave([]);
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
                    setIsDeleteImage(false);
                    setChatImagesToSave([]);
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
              insertImage={insertImage}
            />
            {messageSize > 750 && ( // TODO magic number
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
                    color:
                      messageSize > MAX_SIZE_MESSAGE
                        ? theme.palette.other.danger
                        : 'unset',
                  }}
                >
                  {t('core:message.error.message_size', {
                    maximum: MAX_SIZE_MESSAGE,
                    size: messageSize,
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
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
                    color: theme.palette.text.primary,
                  }}
                />
              </ButtonBase>
            </Box>

            <Divider />

            <AppViewerContainer
              customHeight="560px"
              app={{
                name: 'Q-Manager',
                path: `?groupId=${selectedGroup}`,
                service: 'APP',
                tabId: '5558588',
              }}
              isSelected
            />
          </Box>
        </Box>
      )}

      <LoadingSnackbar
        open={isLoading}
        info={{
          message: t('core:loading.chat', {
            postProcess: 'capitalizeFirstChar',
          }),
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
