import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatList } from './ChatList';
import Tiptap from './TipTap';
import { CustomButton } from '../../styles/App-styles';
import CircularProgress from '@mui/material/CircularProgress';
import { Box, ButtonBase, Input, Typography, useTheme } from '@mui/material';
import { LoadingSnackbar } from '../Snackbar/LoadingSnackbar';
import { getNameInfo } from '../Group/Group';
import { Spacer } from '../../common/Spacer';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import {
  getBaseApiReact,
  getBaseApiReactSocket,
  pauseAllQueues,
  resumeAllQueues,
} from '../../App';
import { getPublicKey } from '../../background/background.ts';
import { useMessageQueue } from '../../messaging/MessageQueueContext.tsx';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ShortUniqueId from 'short-unique-id';
import { ExitIcon } from '../../assets/Icons/ExitIcon';
import { ReplyPreview } from './MessageItem';
import { useTranslation } from 'react-i18next';
import {
  MAX_SIZE_MESSAGE,
  MESSAGE_LIMIT_WARNING,
  MIN_REQUIRED_QORTS,
  TIME_MILLISECONDS_250,
  TIME_MILLISECONDS_400,
  TIME_MILLISECONDS_50,
  TIME_SECONDS_10_IN_MILLISECONDS,
  TIME_SECONDS_120_IN_MILLISECONDS,
  TIME_SECONDS_40_IN_MILLISECONDS,
  TIME_SECONDS_5_IN_MILLISECONDS,
} from '../../constants/constants.ts';

const uid = new ShortUniqueId({ length: 5 });

export const ChatDirect = ({
  myAddress,
  isNewChat,
  selectedDirect,
  setSelectedDirect,
  setNewChat,
  getTimestampEnterChat,
  myName,
  balance,
  close,
  setMobileViewModeKeepOpen,
}) => {
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const { queueChats, addToQueue, processWithNewMessages } = useMessageQueue();
  const [isFocusedParent, setIsFocusedParent] = useState(false);
  const [onEditMessage, setOnEditMessage] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [directToValue, setDirectToValue] = useState('');
  const hasInitialized = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const [publicKeyOfRecipient, setPublicKeyOfRecipient] = useState('');
  const hasInitializedWebsocket = useRef(false);
  const [chatReferences, setChatReferences] = useState({});
  const editorRef = useRef(null);
  const socketRef = useRef(null);
  const timeoutIdRef = useRef(null);
  const [messageSize, setMessageSize] = useState(0);
  const groupSocketTimeoutRef = useRef(null);
  const [replyMessage, setReplyMessage] = useState(null);
  const setEditorRef = (editorInstance) => {
    editorRef.current = editorInstance;
  };
  const publicKeyOfRecipientRef = useRef(null);

  const getPublicKeyFunc = async (address) => {
    try {
      const publicKey = await getPublicKey(address);
      if (publicKeyOfRecipientRef.current !== selectedDirect?.address) return;
      setPublicKeyOfRecipient(publicKey);
    } catch (error) {
      console.log(error);
    }
  };

  const tempMessages = useMemo(() => {
    if (!selectedDirect?.address) return [];
    if (queueChats[selectedDirect?.address]) {
      return queueChats[selectedDirect?.address]?.filter(
        (item) => !item?.chatReference
      );
    }
    return [];
  }, [selectedDirect?.address, queueChats]);

  const tempChatReferences = useMemo(() => {
    if (!selectedDirect?.address) return [];
    if (queueChats[selectedDirect?.address]) {
      return queueChats[selectedDirect?.address]?.filter(
        (item) => !!item?.chatReference
      );
    }
    return [];
  }, [selectedDirect?.address, queueChats]);

  useEffect(() => {
    if (selectedDirect?.address) {
      publicKeyOfRecipientRef.current = selectedDirect?.address;
      getPublicKeyFunc(publicKeyOfRecipientRef.current);
    }
  }, [selectedDirect?.address]);

  const middletierFunc = async (
    data: any,
    selectedDirectAddress: string,
    myAddress: string
  ) => {
    try {
      if (hasInitialized.current) {
        decryptMessages(data, true);
        return;
      }
      hasInitialized.current = true;
      const url = `${getBaseApiReact()}/chat/messages?involving=${selectedDirectAddress}&involving=${myAddress}&encoding=BASE64&limit=0&reverse=false`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const responseData = await response.json();
      decryptMessages(responseData, false);
    } catch (error) {
      console.error(error);
    }
  };

  const decryptMessages = (encryptedMessages: any[], isInitiated: boolean) => {
    try {
      return new Promise((res, rej) => {
        window
          .sendMessage('decryptDirect', {
            data: encryptedMessages,
            involvingAddress: selectedDirect?.address,
          })
          .then((decryptResponse) => {
            if (!decryptResponse?.error) {
              const response = processWithNewMessages(
                decryptResponse,
                selectedDirect?.address
              );
              res(response);

              if (isInitiated) {
                const formatted = response
                  .filter((rawItem) => !rawItem?.chatReference)
                  .map((item) => ({
                    ...item,
                    id: item.signature,
                    text: item.message,
                    unread: item?.sender === myAddress ? false : true,
                  }));

                setMessages((prev) => [...prev, ...formatted]);
                setChatReferences((prev) => {
                  const organizedChatReferences = { ...prev };

                  response
                    .filter(
                      (rawItem) =>
                        !!rawItem?.chatReference && rawItem?.type === 'edit'
                    )
                    .forEach((item) => {
                      try {
                        organizedChatReferences[item.chatReference] = {
                          ...(organizedChatReferences[item.chatReference] ||
                            {}),
                          edit: item,
                        };
                      } catch (error) {
                        console.log(error);
                      }
                    });
                  return organizedChatReferences;
                });
              } else {
                hasInitialized.current = true;
                const formatted = response
                  .filter((rawItem) => !rawItem?.chatReference)
                  .map((item) => ({
                    ...item,
                    id: item.signature,
                    text: item.message,
                    unread: false,
                  }));
                setMessages(formatted);

                setChatReferences((prev) => {
                  const organizedChatReferences = { ...prev };

                  response
                    .filter(
                      (rawItem) =>
                        !!rawItem?.chatReference && rawItem?.type === 'edit'
                    )
                    .forEach((item) => {
                      try {
                        organizedChatReferences[item.chatReference] = {
                          ...(organizedChatReferences[item.chatReference] ||
                            {}),
                          edit: item,
                        };
                      } catch (error) {
                        console.log(error);
                      }
                    });
                  return organizedChatReferences;
                });
              }
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

  const forceCloseWebSocket = () => {
    if (socketRef.current) {
      clearTimeout(timeoutIdRef.current);
      clearTimeout(groupSocketTimeoutRef.current);
      socketRef.current.close(1000, 'forced');
      socketRef.current = null;
    }
  };

  const pingWebSocket = () => {
    try {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send('ping');
        timeoutIdRef.current = setTimeout(() => {
          if (socketRef.current) {
            socketRef.current.close();
            clearTimeout(groupSocketTimeoutRef.current);
          }
        }, TIME_SECONDS_5_IN_MILLISECONDS); // Close if no pong in 5 seconds
      }
    } catch (error) {
      console.error('Error during ping:', error);
    }
  };

  const initWebsocketMessageGroup = () => {
    forceCloseWebSocket(); // Close any existing connection

    if (!selectedDirect?.address || !myAddress) return;

    const socketLink = `${getBaseApiReactSocket()}/websockets/chat/messages?involving=${selectedDirect?.address}&involving=${myAddress}&encoding=BASE64&limit=100`;
    socketRef.current = new WebSocket(socketLink);

    socketRef.current.onopen = () => {
      setTimeout(pingWebSocket, TIME_MILLISECONDS_50); // Initial ping
    };

    socketRef.current.onmessage = (e) => {
      try {
        if (e.data === 'pong') {
          clearTimeout(timeoutIdRef.current);
          groupSocketTimeoutRef.current = setTimeout(pingWebSocket, TIME_SECONDS_40_IN_MILLISECONDS); // Ping every 40 seconds
        } else {
          middletierFunc(
            JSON.parse(e.data),
            selectedDirect?.address,
            myAddress
          );

          setIsLoading(false);
        }
      } catch (error) {
        console.error('Error handling WebSocket message:', error);
      }
    };

    socketRef.current.onclose = (event) => {
      clearTimeout(groupSocketTimeoutRef.current);
      clearTimeout(timeoutIdRef.current);
      console.warn(`WebSocket closed: ${event.reason || 'unknown reason'}`);
      if (event.reason !== 'forced' && event.code !== 1000) {
        setTimeout(() => initWebsocketMessageGroup(), TIME_SECONDS_10_IN_MILLISECONDS); // Retry after 10 seconds
      }
    };

    socketRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      clearTimeout(groupSocketTimeoutRef.current);
      clearTimeout(timeoutIdRef.current);
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  };

  const setDirectChatValueFunc = async (e) => {
    setDirectToValue(e.detail.directToValue);
  };
  useEffect(() => {
    subscribeToEvent('setDirectToValueNewChat', setDirectChatValueFunc);

    return () => {
      unsubscribeFromEvent('setDirectToValueNewChat', setDirectChatValueFunc);
    };
  }, []);

  useEffect(() => {
    if (hasInitializedWebsocket.current || isNewChat) return;
    setIsLoading(true);
    initWebsocketMessageGroup();
    hasInitializedWebsocket.current = true;

    return () => {
      forceCloseWebSocket(); // Clean up WebSocket on component unmount
    };
  }, [selectedDirect?.address, myAddress, isNewChat]);

  const sendChatDirect = async (
    { chatReference = undefined, messageText, otherData }: any,
    address,
    publicKeyOfRecipient,
    isNewChatVar
  ) => {
    try {
      const directTo = isNewChatVar ? directToValue : address;

      if (!directTo) return;
      return new Promise((res, rej) => {
        window
          .sendMessage(
            'sendChatDirect',
            {
              directTo,
              chatReference,
              messageText,
              otherData,
              publicKeyOfRecipient,
              address: directTo,
            },
            TIME_SECONDS_120_IN_MILLISECONDS
          )
          .then(async (response) => {
            if (!response?.error) {
              if (isNewChatVar) {
                let getRecipientName = null;
                try {
                  getRecipientName = await getNameInfo(response.recipient);
                } catch (error) {
                  console.error('Error fetching recipient name:', error);
                }
                setSelectedDirect({
                  address: response.recipient,
                  name: getRecipientName,
                  timestamp: Date.now(),
                  sender: myAddress,
                  senderName: myName,
                });
                setNewChat(null);
                window
                  .sendMessage('addTimestampEnterChat', {
                    timestamp: Date.now(),
                    groupId: response.recipient,
                  })
                  .catch((error) => {
                    console.error(
                      'Failed to add timestamp:',
                      error.message || 'An error occurred'
                    );
                  });

                setTimeout(() => {
                  getTimestampEnterChat();
                }, TIME_MILLISECONDS_400);
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
      if (error instanceof Error) {
        throw new Error(error.message);
      } else {
        throw new Error(String(error));
      }
    }
  };
  const clearEditorContent = () => {
    if (editorRef.current) {
      setMessageSize(0);
      editorRef.current.chain().focus().clearContent().run();
    }
  };
  useEffect(() => {
    if (!editorRef?.current) return;
    const handleUpdate = () => {
      const htmlContent = editorRef?.current.getHTML();
      const stringified = JSON.stringify(htmlContent);
      const size = new Blob([stringified]).size;
      setMessageSize(size + 200);
    };

    // Add a listener for the editorRef?.current's content updates
    editorRef?.current.on('update', handleUpdate);

    // Cleanup the listener on unmount
    return () => {
      editorRef?.current.off('update', handleUpdate);
    };
  }, [editorRef?.current]);

  const sendMessage = async () => {
    try {
      if (messageSize > MAX_SIZE_MESSAGE) return;
      if (+balance < MIN_REQUIRED_QORTS)
        throw new Error(
          t('group:message.error.qortals_required', {
            quantity: MIN_REQUIRED_QORTS,
            postProcess: 'capitalizeFirstChar',
          })
        );
      if (isSending) return;
      if (editorRef.current) {
        const htmlContent = editorRef.current.getHTML();

        if (!htmlContent?.trim() || htmlContent?.trim() === '<p></p>') return;
        setIsSending(true);
        pauseAllQueues();
        const message = JSON.stringify(htmlContent);

        if (isNewChat) {
          await sendChatDirect({ messageText: htmlContent }, null, null, true);
          return;
        }
        let repliedTo = replyMessage?.signature;

        if (replyMessage?.chatReference) {
          repliedTo = replyMessage?.chatReference;
        }
        let chatReference = onEditMessage?.signature;

        const otherData = {
          ...(onEditMessage?.decryptedData || {}),
          specialId: uid.rnd(),
          repliedTo: onEditMessage ? onEditMessage?.repliedTo : repliedTo,
          type: chatReference ? 'edit' : '',
        };
        const sendMessageFunc = async () => {
          return await sendChatDirect(
            { chatReference, messageText: htmlContent, otherData },
            selectedDirect?.address,
            publicKeyOfRecipient,
            false
          );
        };

        // Add the function to the queue
        const messageObj = {
          message: {
            timestamp: Date.now(),
            senderName: myName,
            sender: myAddress,
            ...(otherData || {}),
            text: htmlContent,
          },
          chatReference,
        };
        addToQueue(
          sendMessageFunc,
          messageObj,
          'chat-direct',
          selectedDirect?.address
        );
        setTimeout(() => {
          executeEvent('sent-new-message-group', {});
        }, TIME_MILLISECONDS_250);
        clearEditorContent();
        setReplyMessage(null);
        setOnEditMessage(null);
      }
      // send chat message
    } catch (error) {
      const errorMsg = error?.message || error;
      setInfoSnack({
        type: 'error',
        message:
          errorMsg === 'invalid signature'
            ? t('group:message.error.qortals_required', {
                quantity: MIN_REQUIRED_QORTS,
                postProcess: 'capitalizeFirstChar',
              })
            : errorMsg,
      });
      setOpenSnack(true);
      console.error(error);
    } finally {
      setIsSending(false);
      resumeAllQueues();
    }
  };

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
    editorRef.current.chain().focus().setContent(message?.text).run();
  }, []);

  return (
    <Box
      style={{
        background: theme.palette.background.default,
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100%',
      }}
    >
      <Box
        onClick={close}
        sx={{
          alignItems: 'center',
          alignSelf: 'center',
          background: theme.palette.background.default,
          borderRadius: '3px',
          cursor: 'pointer',
          display: 'flex',
          gap: '5px',
          margin: '10px 0px',
          padding: '4px 6px',
          width: 'fit-content',
        }}
      >
        <ArrowBackIcon
          sx={{
            color: theme.palette.text.primary,
            fontSize: '20px',
          }}
        />
        <Typography
          sx={{
            color: theme.palette.text.primary,
            fontSize: '14px',
          }}
        >
          {t('core:action.close_chat', { postProcess: 'capitalizeFirstChar' })}
        </Typography>
      </Box>

      {isNewChat && (
        <>
          <Spacer height="30px" />

          <Input
            sx={{
              fontSize: '18px',
              padding: '5px',
            }}
            placeholder={t('auth:message.generic.name_address', {
              postProcess: 'capitalizeFirstChar',
            })}
            value={directToValue}
            onChange={(e) => setDirectToValue(e.target.value)}
          />
        </>
      )}

      <ChatList
        chatReferences={chatReferences}
        onEdit={onEdit}
        onReply={onReply}
        chatId={selectedDirect?.address}
        initialMessages={messages}
        myAddress={myAddress}
        tempMessages={tempMessages}
        tempChatReferences={tempChatReferences}
      />

      <Box
        style={{
          backgroundColor: theme.palette.background.default,
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
        <Box
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
                justifyContent: 'flex-end',
                width: 'calc(100% - 100px)',
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
            isFocusedParent={isFocusedParent}
            setEditorRef={setEditorRef}
            onEnter={sendMessage}
            isChat
            disableEnter={false}
            setIsFocusedParent={setIsFocusedParent}
          />
          {messageSize > MESSAGE_LIMIT_WARNING && (
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
        </Box>

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
      </Box>

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
    </Box>
  );
};
