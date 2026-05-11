import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import {
  userInfoAtom,
  balanceAtom,
  dmFriendsByAddressAtom,
} from '../../atoms/global';
import { ChatList } from './ChatList';
import Tiptap from './TipTap';
import './chat.css';
import { CustomButton } from '../../styles/App-styles';
import CircularProgress from '@mui/material/CircularProgress';
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  ClickAwayListener,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Paper,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import CallEndRoundedIcon from '@mui/icons-material/CallEndRounded';
import CallRoundedIcon from '@mui/icons-material/CallRounded';
import PersonAddRoundedIcon from '@mui/icons-material/PersonAddRounded';
import PersonRemoveRoundedIcon from '@mui/icons-material/PersonRemoveRounded';
import MicOffRoundedIcon from '@mui/icons-material/MicOffRounded';
import MicRoundedIcon from '@mui/icons-material/MicRounded';
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded';
import VolumeOffRoundedIcon from '@mui/icons-material/VolumeOffRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SendIcon from '@mui/icons-material/Send';
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded';
import { LoadingSnackbar } from '../Snackbar/LoadingSnackbar';
import { getNameInfo } from '../Group/Group';
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
import { useNameSearch } from '../../hooks/useNameSearch';
import { validateAddress } from '../../utils/validateAddress';
import {
  MAX_SIZE_MESSAGE,
  MESSAGE_LIMIT_WARNING,
  MIN_REQUIRED_QORTS,
  TIME_MINUTES_2_IN_MILLISECONDS,
} from '../../constants/constants.ts';
import { appHeighOffsetPx } from '../Desktop/CustomTitleBar';
import { useVoiceCallContext } from '../../context/VoiceCallContext';
import { buildDirectVoiceCallChatId } from '../../lib/call/directVoiceCallChatId';
import { CallAudioSettingsButton } from './CallAudioDeviceSelectors';
import { useIsOnline } from '../../hooks/usePresence';

const uid = new ShortUniqueId({ length: 5 });
const QCHAT_FILE_DEFAULT_EXPIRY_HOURS = 2;
const QCHAT_FILE_COMPLETED_CACHE_KEY = 'qchat-dm-file-transfer-completed-v1';
const QCHAT_FILE_COMPLETED_CACHE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const QCHAT_FILE_COMPLETED_CACHE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

const loadQchatCompletedTransfers = (address?: string) => {
  if (!address || typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(QCHAT_FILE_COMPLETED_CACHE_KEY) || '{}'
    );
    const scoped = parsed?.[address] || {};
    const now = Date.now();
    const entries = Object.entries(scoped)
      .filter(([, value]: any) => {
        const expiresAt = Number(value?.expiresAt || 0);
        const completedAt = Number(value?.completedAt || 0);
        if (expiresAt) return expiresAt + QCHAT_FILE_COMPLETED_CACHE_GRACE_MS > now;
        return !completedAt || completedAt + QCHAT_FILE_COMPLETED_CACHE_MAX_AGE_MS > now;
      })
      .slice(-5000);
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
};

const saveQchatCompletedTransfers = (address: string, records: Record<string, any>) => {
  if (!address || typeof window === 'undefined') return;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(QCHAT_FILE_COMPLETED_CACHE_KEY) || '{}'
    );
    parsed[address] = records;
    window.localStorage.setItem(
      QCHAT_FILE_COMPLETED_CACHE_KEY,
      JSON.stringify(parsed)
    );
  } catch {
    // Ignore storage failures; transfer state still works for the current session.
  }
};

const getQchatFileTransferData = (message: any) => {
  if (message?.decryptedData?.type === 'qchat-dm-file-transfer') {
    return { ...(message.decryptedData || {}), ...(message.decryptedData.data || {}) };
  }
  if (message?.decryptedData?.data?.type === 'qchat-dm-file-transfer') {
    return {
      ...(message.decryptedData.data || {}),
      ...(message.decryptedData.data.data || {}),
    };
  }
  if (message?.type === 'qchat-dm-file-transfer') {
    return { ...(message || {}), ...(message.data || {}) };
  }
  return null;
};

const buildQchatFileLinkAuthSignedFields = (payload: {
  transferId: string;
  senderAddress: string;
  downloaderAddress: string;
  downloaderPublicKey: string;
  downloaderReticulumDestinationHash: string;
  downloaderReticulumIdentityPublicKeyBase64: string;
  timestamp: number;
}) => ({
  type: 'QCHAT_FILE_LINK_AUTH',
  transferId: payload.transferId,
  senderAddress: payload.senderAddress,
  downloaderAddress: payload.downloaderAddress,
  downloaderPublicKey: payload.downloaderPublicKey,
  downloaderReticulumDestinationHash:
    payload.downloaderReticulumDestinationHash,
  downloaderReticulumIdentityPublicKeyBase64:
    payload.downloaderReticulumIdentityPublicKeyBase64,
  timestamp: payload.timestamp,
});

export const ChatDirect = ({
  myAddress,
  isNewChat,
  selectedDirect,
  setSelectedDirect,
  setNewChat,
  getTimestampEnterChat,
  close,
  setMobileViewModeKeepOpen,
}) => {
  const userInfo = useAtomValue(userInfoAtom);
  const balance = useAtomValue(balanceAtom);
  const [dmFriendsByAddress, setDmFriendsByAddress] = useAtom(
    dmFriendsByAddressAtom
  );
  const myName = userInfo?.name;
  const theme = useTheme();

  const {
    callState,
    audioMode,
    isMuted,
    hearCall,
    callDuration,
    activeCallChatId,
    initiateCall: initiateVoiceCall,
    hangUp,
    toggleMute,
    toggleHearCall,
  } = useVoiceCallContext();

  const peerOnline = useIsOnline(selectedDirect?.address);

  const directVoiceChatId = useMemo(() => {
    if (!myAddress || !selectedDirect?.address) return null;
    return buildDirectVoiceCallChatId(myAddress, selectedDirect.address);
  }, [myAddress, selectedDirect?.address]);

  const callMatchesThisDirect = Boolean(
    directVoiceChatId &&
      ((callState === 'calling' && activeCallChatId === directVoiceChatId) ||
        (callState === 'connected' && activeCallChatId === directVoiceChatId))
  );

  const signCallRequest = useCallback(
    async (fields: Record<string, unknown>) => {
      const res = await (window as any).sendMessage(
        'signPresenceMessage',
        fields,
        10_000
      );
      return {
        signature: res?.signature ?? '',
        publicKey: userInfo?.publicKey ?? '',
      };
    },
    [userInfo?.publicKey]
  );

  const signQchatFileFields = useCallback(
    async (fields: Record<string, unknown>) => {
      const res = await (window as any).sendMessage(
        'signPresenceMessage',
        fields,
        10_000
      );
      if (!res?.signature || !userInfo?.publicKey) {
        throw new Error('Unable to sign file transfer message');
      }
      return {
        signature: res.signature,
        publicKey: userInfo.publicKey,
      };
    },
    [userInfo?.publicKey]
  );

  const handleStartDirectVoiceCall = useCallback(() => {
    if (
      !directVoiceChatId ||
      !selectedDirect?.address ||
      callState !== 'idle'
    )
      return;
    if (!peerOnline) return;
    initiateVoiceCall(
      selectedDirect.address,
      directVoiceChatId,
      signCallRequest
    );
  }, [
    callState,
    directVoiceChatId,
    initiateVoiceCall,
    peerOnline,
    selectedDirect?.address,
    signCallRequest,
  ]);

  const fmtCallDuration = useCallback((secs: number): string => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }, [myAddress]);
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
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const nameSearchInputRef = useRef<HTMLDivElement>(null);
  const searchQuery =
    directToValue.trim().length >= 1 ? directToValue.trim() : '';
  const { results: nameSearchResults, isLoading: nameSearchLoading } =
    useNameSearch(searchQuery, 15);
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
  const [qchatFileTransferStates, setQchatFileTransferStates] = useState({});
  const [qchatCompletedTransfers, setQchatCompletedTransfers] = useState({});
  const [pendingQchatFileOffer, setPendingQchatFileOffer] = useState(null);
  const [qchatFileExpiryHours, setQchatFileExpiryHours] = useState(
    QCHAT_FILE_DEFAULT_EXPIRY_HOURS
  );
  const outgoingQchatFileTransfersRef = useRef(new Map());
  const qchatAcceptedOfferMetaRef = useRef(new Map());
  const qchatTerminalTransferIdsRef = useRef(new Set<string>());
  const setEditorRef = (editorInstance) => {
    editorRef.current = editorInstance;
  };
  const publicKeyOfRecipientRef = useRef(null);

  useEffect(() => {
    const records = loadQchatCompletedTransfers(myAddress);
    setQchatCompletedTransfers(records);
    qchatTerminalTransferIdsRef.current = new Set(Object.keys(records));
    saveQchatCompletedTransfers(myAddress, records);
  }, [myAddress]);

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

        const otherData = {
          specialId: uid.rnd(),
          type: 'reaction',
          content: reaction,
          contentState: reactionState,
        };

        const sendMessageFunc = async () => {
          return await sendChatDirect(
            {
              chatReference: chatMessage.signature,
              messageText: '',
              otherData,
            },
            selectedDirect?.address,
            publicKeyOfRecipient,
            false
          );
        };

        // Add the function to the queue for optimistic UI
        const messageObj = {
          message: {
            timestamp: Date.now(),
            senderName: myName,
            sender: myAddress,
            ...(otherData || {}),
          },
          chatReference: chatMessage.signature,
        };
        addToQueue(
          sendMessageFunc,
          messageObj,
          'chat-direct',
          selectedDirect?.address
        );
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
    [
      isSending,
      balance,
      selectedDirect?.address,
      publicKeyOfRecipient,
      myName,
      myAddress,
    ]
  );

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
                        rawItem &&
                        rawItem.chatReference &&
                        (rawItem?.type === 'reaction' ||
                          rawItem?.type === 'edit' ||
                          rawItem?.isEdited)
                    )
                    .forEach((item) => {
                      try {
                        if (item?.type === 'edit' || item?.isEdited) {
                          organizedChatReferences[item.chatReference] = {
                            ...(organizedChatReferences[item.chatReference] ||
                              {}),
                            edit: item,
                          };
                        } else {
                          const content = item?.content;
                          const sender = item.sender;
                          const newTimestamp = item.timestamp;
                          const contentState = item?.contentState;

                          if (
                            !content ||
                            typeof content !== 'string' ||
                            !sender ||
                            typeof sender !== 'string' ||
                            !newTimestamp
                          ) {
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
                        rawItem &&
                        rawItem.chatReference &&
                        (rawItem?.type === 'reaction' ||
                          rawItem?.type === 'edit' ||
                          rawItem?.isEdited)
                    )
                    .forEach((item) => {
                      try {
                        if (item?.type === 'edit' || item?.isEdited) {
                          organizedChatReferences[item.chatReference] = {
                            ...(organizedChatReferences[item.chatReference] ||
                              {}),
                            edit: item,
                          };
                        } else {
                          const content = item?.content;
                          const sender = item.sender;
                          const newTimestamp = item.timestamp;
                          const contentState = item?.contentState;

                          if (
                            !content ||
                            typeof content !== 'string' ||
                            !sender ||
                            typeof sender !== 'string' ||
                            !newTimestamp
                          ) {
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
        }, 5000); // Close if no pong in 5 seconds
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
      setTimeout(pingWebSocket, 50); // Initial ping
    };

    socketRef.current.onmessage = (e) => {
      try {
        if (e.data === 'pong') {
          clearTimeout(timeoutIdRef.current);
          groupSocketTimeoutRef.current = setTimeout(pingWebSocket, 20000); // Ping every 20 seconds
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
        setTimeout(() => initWebsocketMessageGroup(), 10000); // Retry after 10 seconds
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

  type NameOrAddressOption = string | { name: string; address: string };
  const nameOptions = useMemo((): NameOrAddressOption[] => {
    const trimmed = directToValue.trim();
    if (validateAddress(trimmed)) return [trimmed];
    return nameSearchResults ?? [];
  }, [directToValue, nameSearchResults]);

  const resolvedNewChatTarget = useMemo(() => {
    const trimmed = directToValue.trim();
    if (!trimmed) return null;
    if (validateAddress(trimmed)) {
      return { address: trimmed, name: trimmed };
    }
    const exact = (nameSearchResults || []).filter((r) => r.name === trimmed);
    if (exact.length === 1) {
      return { address: exact[0].address, name: exact[0].name };
    }
    return null;
  }, [directToValue, nameSearchResults]);

  const [friendActionBusy, setFriendActionBusy] = useState(false);

  const handleToggleDmFriend = useCallback(
    async (
      address: string,
      displayName: string | undefined,
      isCurrentlyFriend: boolean
    ) => {
      if (!address || address === myAddress) return;
      if (isCurrentlyFriend) {
        setDmFriendsByAddress((prev) => {
          if (!prev[address]) return prev;
          const next = { ...prev };
          delete next[address];
          return next;
        });
        setInfoSnack({
          type: 'success',
          message: t('core:dm_friends.removed', {
            postProcess: 'capitalizeFirstChar',
          }),
        });
        setOpenSnack(true);
        return;
      }
      setFriendActionBusy(true);
      try {
        const pk = await getPublicKey(address);
        if (!pk) {
          throw new Error('no public key');
        }
        let name = displayName;
        if (!name || name === address) {
          try {
            const resolvedName = await getNameInfo(address);
            name = resolvedName || address;
          } catch {
            name = address;
          }
        }
        setDmFriendsByAddress((prev) => ({
          ...prev,
          [address]: { publicKey: pk, name, addedAt: Date.now() },
        }));
        setInfoSnack({
          type: 'success',
          message: t('core:dm_friends.added', {
            postProcess: 'capitalizeFirstChar',
          }),
        });
        setOpenSnack(true);
      } catch {
        setInfoSnack({
          type: 'error',
          message: t('core:dm_friends.add_failed', {
            postProcess: 'capitalizeFirstChar',
          }),
        });
        setOpenSnack(true);
      } finally {
        setFriendActionBusy(false);
      }
    },
    [myAddress, setDmFriendsByAddress, t]
  );

  const handleSelectNameOrAddress = useCallback(
    async (option: NameOrAddressOption | null) => {
      if (!option) return;
      if (typeof option === 'string') {
        const address = option;
        let name: string | null = null;
        try {
          name = await getNameInfo(address);
        } catch {
          name = address;
        }
        setSelectedDirect({
          address,
          name: name ?? address,
          timestamp: Date.now(),
          sender: myAddress,
          senderName: myName,
        });
        setNewChat(null);
      } else {
        setSelectedDirect({
          address: option.address,
          name: option.name,
          timestamp: Date.now(),
          sender: myAddress,
          senderName: myName,
        });
        setNewChat(null);
      }
      setDirectToValue('');
    },
    [myAddress, myName, setSelectedDirect, setNewChat]
  );

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
            TIME_MINUTES_2_IN_MILLISECONDS
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
                }, 400);
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

  const getLocalReticulumIdentityForQchatFile = useCallback(async () => {
    const api = (window as any).electronAPI;
    const [hashResult, keyResult] = await Promise.all([
      api?.reticulumGetLocalDestinationHash?.(),
      api?.reticulumGetLocalIdentityPublicKeyBase64?.(),
    ]);
    const destinationHash = hashResult?.destinationHash;
    const identityPublicKeyBase64 = keyResult?.publicKeyBase64;
    if (!destinationHash || !identityPublicKeyBase64) {
      throw new Error('Reticulum identity is unavailable');
    }
    return {
      destinationHash,
      identityPublicKeyBase64,
    };
  }, []);

  const handleSendQchatFileOffer = useCallback(async () => {
    try {
      if (isNewChat || !selectedDirect?.address) return;
      if (isSending) return;
      const api = (window as any).electronAPI;
      if (!api?.qchatFileSelect) {
        throw new Error('Reticulum file transfer is unavailable');
      }
      const selected = await api.qchatFileSelect();
      if (!selected?.ok || !selected.file) return;
      setPendingQchatFileOffer(selected.file);
      setQchatFileExpiryHours(QCHAT_FILE_DEFAULT_EXPIRY_HOURS);
    } catch (error) {
      setInfoSnack({
        type: 'error',
        message: error?.message || String(error),
      });
      setOpenSnack(true);
    }
  }, [isNewChat, isSending, selectedDirect?.address]);

  const handleConfirmQchatFileOffer = useCallback(async () => {
    try {
      if (isNewChat || !selectedDirect?.address || !pendingQchatFileOffer) return;
      if (isSending) return;
      const api = (window as any).electronAPI;
      if (!api?.qchatFileSend) {
        throw new Error('Reticulum file transfer is unavailable');
      }
      const selectedFile = pendingQchatFileOffer;
      const reticulumIdentity = await getLocalReticulumIdentityForQchatFile();
      const transferId = `qft-${Date.now()}-${uid.rnd()}`;
      const expiryHours = Math.max(
        0.05,
        Math.min(168, Number(qchatFileExpiryHours) || QCHAT_FILE_DEFAULT_EXPIRY_HOURS)
      );
      const expiresAt = Date.now() + expiryHours * 60 * 60 * 1000;
      outgoingQchatFileTransfersRef.current.set(transferId, {
        ...selectedFile,
        recipientAddress: selectedDirect.address,
        senderAddress: myAddress,
        expiresAt,
      });
      const otherData = {
        specialId: transferId,
        type: 'qchat-dm-file-transfer',
        status: 'offer',
        transferId,
        fileName: selectedFile.name,
        size: selectedFile.size,
        sha256: selectedFile.sha256,
        expiresAt,
        senderAddress: myAddress,
        recipientAddress: selectedDirect.address,
        senderReticulumDestinationHash: reticulumIdentity.destinationHash,
        senderReticulumIdentityPublicKeyBase64:
          reticulumIdentity.identityPublicKeyBase64,
        data: {
          status: 'offer',
          transferId,
          fileName: selectedFile.name,
          size: selectedFile.size,
          sha256: selectedFile.sha256,
          expiresAt,
          senderAddress: myAddress,
          recipientAddress: selectedDirect.address,
          senderReticulumDestinationHash: reticulumIdentity.destinationHash,
          senderReticulumIdentityPublicKeyBase64:
            reticulumIdentity.identityPublicKeyBase64,
        },
      };
      const sendMessageFunc = async () => {
        const registered = await api.qchatFileSend({
          transferId,
          senderAddress: myAddress,
          allowedRecipientAddress: selectedDirect.address,
          recipientAddress: selectedDirect.address,
          filePath: selectedFile.path,
          fileName: selectedFile.name,
          size: selectedFile.size,
          sha256: selectedFile.sha256,
          expiresAt,
        });
        if (!registered?.ok) {
          throw new Error(
            registered?.error || 'Unable to register file transfer'
          );
        }
        const sent = await sendChatDirect(
          { messageText: '', otherData },
          selectedDirect.address,
          publicKeyOfRecipient,
          false
        );
        return sent;
      };
      addToQueue(
        sendMessageFunc,
        {
          message: {
            timestamp: Date.now(),
            senderName: myName,
            sender: myAddress,
            ...otherData,
          },
        },
        'chat-direct',
        selectedDirect.address
      );
      setPendingQchatFileOffer(null);
    } catch (error) {
      setInfoSnack({
        type: 'error',
        message: error?.message || String(error),
      });
      setOpenSnack(true);
    }
  }, [
    addToQueue,
    getLocalReticulumIdentityForQchatFile,
    isNewChat,
    isSending,
    myAddress,
    myName,
    pendingQchatFileOffer,
    publicKeyOfRecipient,
    qchatFileExpiryHours,
    selectedDirect?.address,
  ]);

  const handleAcceptQchatFileTransfer = useCallback(
    async (message) => {
      try {
        const data = getQchatFileTransferData(message);
        if (!data?.transferId || !message?.sender) return;
        if (qchatCompletedTransfers[data.transferId]) {
          throw new Error('This file has already been downloaded');
        }
        if (Number(data.expiresAt || 0) > 0 && Number(data.expiresAt) <= Date.now()) {
          throw new Error('This file transfer offer has expired');
        }
        const senderAddress = data.senderAddress || message.sender;
        if (senderAddress !== message.sender) {
          throw new Error('File offer sender mismatch');
        }
        if (data.recipientAddress && data.recipientAddress !== myAddress) {
          throw new Error('File offer is not addressed to this account');
        }
        const api = (window as any).electronAPI;
        if (!api?.qchatFileChooseSavePath || !api?.qchatFileAccept) {
          throw new Error('Reticulum file transfer is unavailable');
        }
        const save = await api.qchatFileChooseSavePath(
          data.fileName || 'received-file'
        );
        if (!save?.ok || !save.path) return;
        const reticulumIdentity = await getLocalReticulumIdentityForQchatFile();
        const authTimestamp = Date.now();
        const downloaderPublicKey = userInfo?.publicKey || '';
        if (!downloaderPublicKey) {
          throw new Error('Missing local Qortal public key');
        }
        const authSignedFields = buildQchatFileLinkAuthSignedFields({
          transferId: data.transferId,
          senderAddress,
          downloaderAddress: myAddress,
          downloaderPublicKey,
          downloaderReticulumDestinationHash: reticulumIdentity.destinationHash,
          downloaderReticulumIdentityPublicKeyBase64:
            reticulumIdentity.identityPublicKeyBase64,
          timestamp: authTimestamp,
        });
        const authSigned = await signQchatFileFields(authSignedFields);
        const authMessage = {
          ...authSignedFields,
          signature: authSigned.signature,
        };
        const accepted = await api.qchatFileAccept({
          transferId: data.transferId,
          senderAddress,
          recipientAddress: myAddress,
          authMessage,
          senderReticulumDestinationHash: data.senderReticulumDestinationHash,
          senderReticulumIdentityPublicKeyBase64:
            data.senderReticulumIdentityPublicKeyBase64,
          savePath: save.path,
          fileName: data.fileName || 'received-file',
          size: Number(data.size || 0),
          sha256: data.sha256,
        });
        if (!accepted?.ok) {
          throw new Error(accepted?.error || 'Unable to accept file transfer');
        }
        qchatAcceptedOfferMetaRef.current.set(data.transferId, {
          expiresAt: Number(data.expiresAt || 0),
        });
      } catch (error) {
        setInfoSnack({
          type: 'error',
          message: error?.message || String(error),
        });
        setOpenSnack(true);
      }
    },
    [
      getLocalReticulumIdentityForQchatFile,
      myAddress,
      qchatCompletedTransfers,
      signQchatFileFields,
      userInfo?.publicKey,
    ]
  );

  useEffect(() => {
    const unsubscribe = (window as any).electronAPI?.onQchatFileTransferEvent?.(
      (payload) => {
        if (!payload?.status || !payload?.transferId) return;
        const incomingFailure =
          payload.status === 'failed' || payload.status === 'rejected';
        if (
          incomingFailure &&
          qchatTerminalTransferIdsRef.current.has(payload.transferId)
        ) {
          return;
        }
        if (payload.status === 'sent' || payload.status === 'received') {
          qchatTerminalTransferIdsRef.current.add(payload.transferId);
        }
        setQchatFileTransferStates((prev) => {
          const current = prev[payload.transferId] || {};
          const currentDone =
            current.status === 'sent' || current.status === 'received';
          if (currentDone && incomingFailure) {
            return prev;
          }
          const currentHasTransferProgress =
            (current.status === 'receiving' || current.status === 'sending') &&
            typeof current.progress === 'number';
          const incomingLinkSetup =
            payload.status === 'accepted' ||
            payload.status === 'connecting' ||
            payload.status === 'retrying' ||
            payload.status === 'link_established' ||
            payload.status === 'auth_sent' ||
            payload.status === 'auth' ||
            payload.status === 'authorized';
          const nextPayload =
            currentHasTransferProgress && incomingLinkSetup
              ? {
                  ...payload,
                  status: current.status,
                  progress: current.progress,
                }
              : payload;
          return {
            ...prev,
            [payload.transferId]: {
              ...current,
              ...nextPayload,
              updatedAt: Date.now(),
            },
          };
        });
        if (payload.status === 'sent' || payload.status === 'received') {
          if (payload.status === 'received') {
            const offerMeta = qchatAcceptedOfferMetaRef.current.get(
              payload.transferId
            );
            setQchatCompletedTransfers((prev) => {
              const next = {
                ...prev,
                [payload.transferId]: {
                  transferId: payload.transferId,
                  fileName: payload.fileName || '',
                  path: payload.path || '',
                  sha256: payload.sha256 || '',
                  expiresAt: Number(offerMeta?.expiresAt || 0),
                  completedAt: Date.now(),
                },
              };
              saveQchatCompletedTransfers(myAddress, next);
              return next;
            });
            qchatAcceptedOfferMetaRef.current.delete(payload.transferId);
          }
          setInfoSnack({
            type: 'success',
            message:
              payload.status === 'sent'
                ? `Sent ${payload.fileName || 'file'}`
                : `Received ${payload.fileName || 'file'}`,
          });
          setOpenSnack(true);
        } else if (payload.status === 'failed' || payload.status === 'rejected') {
          setInfoSnack({
            type: 'error',
            message: `File transfer failed: ${payload.reason || 'unknown error'}`,
          });
          setOpenSnack(true);
        }
      }
    );
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

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
        height: `calc(100vh - ${appHeighOffsetPx})`,
        width: '100%',
      }}
    >
      {/* Header: back button + optional new-chat title */}
      <Box
        sx={{
          alignItems: 'center',
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          flexShrink: 0,
          gap: '8px',
          padding: '12px 16px',
          width: '100%',
        }}
      >
        <ButtonBase
          onClick={close}
          sx={{
            alignItems: 'center',
            borderRadius: '8px',
            color: theme.palette.text.secondary,
            display: 'flex',
            gap: '6px',
            padding: '6px 10px',
            transition: 'background-color 0.15s ease, color 0.15s ease',
            '&:hover': {
              backgroundColor: theme.palette.action.hover,
              color: theme.palette.text.primary,
            },
          }}
        >
          <ArrowBackIcon sx={{ fontSize: '20px' }} />
          <Typography sx={{ fontSize: '14px', fontWeight: 500 }}>
            {t('core:action.close_chat', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </ButtonBase>
        {isNewChat && (
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '13px',
              fontWeight: 500,
              marginLeft: '8px',
            }}
          >
            {t('core:action.new.chat', { postProcess: 'capitalizeFirstChar' })}
          </Typography>
        )}
        {!isNewChat && selectedDirect?.address && (
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexShrink: 0,
              gap: 1,
              marginLeft: 'auto',
            }}
          >
            <Tooltip
              title={
                peerOnline
                  ? t('core:presence.peer_online_hint')
                  : t('core:presence.peer_offline_hint')
              }
            >
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  flexShrink: 0,
                  gap: 0.5,
                }}
              >
                <Box
                  sx={{
                    backgroundColor: peerOnline
                      ? '#44b700'
                      : theme.palette.action.disabled,
                    borderRadius: '50%',
                    flexShrink: 0,
                    height: 8,
                    width: 8,
                  }}
                />
                <Typography
                  variant="caption"
                  sx={{
                    color: peerOnline ? 'success.main' : 'text.disabled',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: 0.2,
                  }}
                >
                  {peerOnline
                    ? t('core:presence.online')
                    : t('core:presence.offline')}
                </Typography>
              </Box>
            </Tooltip>
            <Tooltip
              title={
                dmFriendsByAddress[selectedDirect.address]
                  ? t('core:dm_friends.remove_friend', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : t('core:dm_friends.add_friend', {
                      postProcess: 'capitalizeFirstChar',
                    })
              }
            >
              <span>
                <IconButton
                  size="small"
                  disabled={friendActionBusy}
                  onClick={() =>
                    handleToggleDmFriend(
                      selectedDirect.address,
                      selectedDirect.name,
                      Boolean(dmFriendsByAddress[selectedDirect.address])
                    )
                  }
                  sx={{ color: 'text.secondary' }}
                >
                  {dmFriendsByAddress[selectedDirect.address] ? (
                    <PersonRemoveRoundedIcon sx={{ fontSize: 20 }} />
                  ) : (
                    <PersonAddRoundedIcon sx={{ fontSize: 20 }} />
                  )}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip
              title={
                callState === 'connected'
                  ? 'In call'
                  : callState === 'calling'
                    ? ''
                    : callState !== 'idle'
                      ? ''
                      : !peerOnline
                        ? t('core:presence.call_offline_tooltip')
                        : 'Start voice call'
              }
            >
              <span>
                <IconButton
                  size="small"
                  disabled={
                    !(
                      (callState === 'idle' && peerOnline) ||
                      callState === 'connected'
                    )
                  }
                  onClick={
                    callState === 'connected' ? hangUp : handleStartDirectVoiceCall
                  }
                  sx={{
                    color:
                      callState === 'connected' ? '#ef4444' : 'text.secondary',
                    '&:hover': {
                      color:
                        callState === 'connected' ? '#dc2626' : 'text.primary',
                    },
                    '&.Mui-disabled': {
                      color: theme.palette.action.disabled,
                    },
                  }}
                >
                  {callState === 'connected' ? (
                    <CallEndRoundedIcon sx={{ fontSize: 20 }} />
                  ) : (
                    <CallRoundedIcon sx={{ fontSize: 20 }} />
                  )}
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        )}
      </Box>

      {!isNewChat && callMatchesThisDirect && callState === 'calling' && (
        <Box
          sx={{
            alignItems: 'center',
            backgroundColor: 'action.selected',
            display: 'flex',
            flexShrink: 0,
            gap: 1.5,
            px: 2,
            py: 1,
          }}
        >
          <CircularProgress size={14} thickness={5} />
          <Typography
            variant="body2"
            sx={{ flex: 1, fontSize: 12, fontWeight: 600 }}
          >
            Calling…
          </Typography>
          <IconButton size="small" onClick={hangUp} sx={{ color: '#ef4444' }}>
            <CallEndRoundedIcon fontSize="small" />
          </IconButton>
        </Box>
      )}

      {isNewChat && (
        <>
          <ClickAwayListener onClickAway={() => setSuggestionsOpen(false)}>
            <Box
              ref={nameSearchInputRef}
              sx={{
                flexShrink: 0,
                padding: '20px 16px 16px',
                position: 'relative',
                width: '100%',
              }}
            >
              <TextField
                fullWidth
                variant="outlined"
                placeholder={t('auth:message.generic.name_address', {
                  postProcess: 'capitalizeFirstChar',
                })}
                value={directToValue}
                onChange={(e) => {
                  setDirectToValue(e.target.value);
                  setSuggestionsOpen(true);
                }}
                onFocus={() => setSuggestionsOpen(true)}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    directToValue.trim() &&
                    validateAddress(directToValue.trim())
                  ) {
                    e.preventDefault();
                    handleSelectNameOrAddress(directToValue.trim());
                    setSuggestionsOpen(false);
                  }
                }}
                autoFocus
                slotProps={{
                  htmlInput: {
                    'aria-label': t('auth:message.generic.name_address', {
                      postProcess: 'capitalizeFirstChar',
                    }),
                  },
                }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRoundedIcon
                        sx={{
                          color: theme.palette.text.secondary,
                          fontSize: '22px',
                        }}
                      />
                    </InputAdornment>
                  ),
                  endAdornment:
                    (resolvedNewChatTarget &&
                      resolvedNewChatTarget.address !== myAddress) ||
                    nameSearchLoading ? (
                      <InputAdornment
                        position="end"
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.5,
                          maxHeight: 40,
                        }}
                      >
                        {resolvedNewChatTarget &&
                          resolvedNewChatTarget.address !== myAddress && (
                            <Tooltip
                              title={
                                dmFriendsByAddress[
                                  resolvedNewChatTarget.address
                                ]
                                  ? t('core:dm_friends.remove_friend', {
                                      postProcess: 'capitalizeFirstChar',
                                    })
                                  : t('core:dm_friends.add_friend', {
                                      postProcess: 'capitalizeFirstChar',
                                    })
                              }
                            >
                              <span>
                                <IconButton
                                  size="small"
                                  tabIndex={-1}
                                  disabled={friendActionBusy}
                                  onClick={() =>
                                    handleToggleDmFriend(
                                      resolvedNewChatTarget.address,
                                      resolvedNewChatTarget.name,
                                      Boolean(
                                        dmFriendsByAddress[
                                          resolvedNewChatTarget.address
                                        ]
                                      )
                                    )
                                  }
                                  sx={{ color: 'text.secondary' }}
                                >
                                  {dmFriendsByAddress[
                                    resolvedNewChatTarget.address
                                  ] ? (
                                    <PersonRemoveRoundedIcon
                                      sx={{ fontSize: 22 }}
                                    />
                                  ) : (
                                    <PersonAddRoundedIcon
                                      sx={{ fontSize: 22 }}
                                    />
                                  )}
                                </IconButton>
                              </span>
                            </Tooltip>
                          )}
                        {nameSearchLoading ? (
                          <CircularProgress size={20} />
                        ) : null}
                      </InputAdornment>
                    ) : null,
                  sx: {
                    backgroundColor: theme.palette.background.paper,
                    borderRadius: '14px',
                    fontFamily: 'Inter',
                    fontSize: '15px',
                    transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
                    '& fieldset': {
                      borderColor: theme.palette.divider,
                      borderRadius: '14px',
                      transition: 'border-color 0.2s ease',
                    },
                    '&:hover fieldset': {
                      borderColor: theme.palette.text.secondary,
                    },
                    '&.Mui-focused fieldset': {
                      borderWidth: '2px',
                      borderColor: theme.palette.primary.main,
                      boxShadow: `0 0 0 3px ${theme.palette.mode === 'dark' ? 'rgba(25, 118, 210, 0.2)' : 'rgba(25, 118, 210, 0.12)'}`,
                    },
                  },
                }}
              />
              {suggestionsOpen &&
                (nameOptions.length > 0 || nameSearchLoading) && (
                  <Paper
                    elevation={8}
                    sx={{
                      position: 'absolute',
                      left: 16,
                      right: 16,
                      top: '100%',
                      marginTop: 8,
                      maxHeight: 300,
                      overflow: 'hidden',
                      overflowY: 'auto',
                      zIndex: 1400,
                      borderRadius: '14px',
                      border: `1px solid ${theme.palette.divider}`,
                      boxShadow:
                        theme.palette.mode === 'dark'
                          ? '0 8px 32px rgba(0,0,0,0.4)'
                          : '0 8px 32px rgba(0,0,0,0.12)',
                      '&::-webkit-scrollbar': { width: 8 },
                      '&::-webkit-scrollbar-thumb': {
                        backgroundColor: theme.palette.divider,
                        borderRadius: 4,
                      },
                    }}
                  >
                    {nameSearchLoading && nameOptions.length === 0 ? (
                      <Box
                        sx={{
                          py: 3,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 1.5,
                        }}
                      >
                        <CircularProgress size={22} />
                        <Typography variant="body2" color="text.secondary">
                          {t('core:loading.generic', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </Typography>
                      </Box>
                    ) : (
                      <List disablePadding sx={{ py: 0.5 }}>
                        {nameOptions.map((opt) => {
                          const label =
                            typeof opt === 'string' ? opt : opt.name;
                          const key =
                            typeof opt === 'string' ? opt : opt.address;
                          const initial = (label || '?')
                            .charAt(0)
                            .toUpperCase();
                          return (
                            <ListItem key={key} disablePadding sx={{ px: 1 }}>
                              <ListItemButton
                                onClick={() => {
                                  const valueToSet =
                                    typeof opt === 'string' ? opt : opt.name;
                                  setDirectToValue(valueToSet);
                                  setSuggestionsOpen(false);
                                }}
                                sx={{
                                  borderRadius: '10px',
                                  py: 1.25,
                                  px: 1.5,
                                  mx: 0.5,
                                  transition: 'background-color 0.15s ease',
                                  '&:hover': {
                                    backgroundColor: theme.palette.action.hover,
                                  },
                                }}
                              >
                                <Avatar
                                  sx={{
                                    width: 36,
                                    height: 36,
                                    mr: 1.5,
                                    fontSize: '1rem',
                                    fontWeight: 600,
                                    bgcolor: theme.palette.primary.main,
                                    color: theme.palette.primary.contrastText,
                                  }}
                                >
                                  {initial}
                                </Avatar>
                                <ListItemText
                                  primary={label}
                                  primaryTypographyProps={{
                                    fontWeight: 500,
                                    fontSize: '0.9375rem',
                                  }}
                                />
                              </ListItemButton>
                            </ListItem>
                          );
                        })}
                      </List>
                    )}
                  </Paper>
                )}
            </Box>
          </ClickAwayListener>
          <Box sx={{ padding: '0 16px 20px', width: '100%' }}>
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '13px',
                lineHeight: 1.4,
                paddingLeft: '4px',
              }}
            >
              {t('auth:message.generic.insert_name_address', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </Box>
        </>
      )}

      {!isNewChat && callMatchesThisDirect && callState === 'connected' && (
        <Box
          sx={{
            alignItems: 'center',
            backgroundColor:
              theme.palette.mode === 'dark'
                ? 'rgba(34,197,94,0.12)'
                : 'rgba(34,197,94,0.08)',
            borderRadius: 1.5,
            display: 'flex',
            flexShrink: 0,
            flexWrap: 'wrap',
            gap: 1,
            mb: 1,
            mx: 2,
            mt: 1,
            px: 2,
            py: 0.75,
          }}
        >
          <Box
            sx={{
              backgroundColor: '#22c55e',
              borderRadius: '50%',
              flexShrink: 0,
              height: 8,
              width: 8,
            }}
          />
          <Typography
            variant="caption"
            sx={{
              color: 'success.main',
              flex: 1,
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            In call — {fmtCallDuration(callDuration)}
          </Typography>
          {audioMode === 'reticulum' && (
            <Typography
              variant="caption"
              sx={{
                backgroundColor: 'primary.main',
                borderRadius: 1,
                color: '#fff',
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 0.3,
                px: 0.75,
                py: 0.2,
              }}
            >
              Reticulum
            </Typography>
          )}
          <CallAudioSettingsButton />
          <Tooltip
            title={
              isMuted
                ? t('core:group_call_unmute', {
                    postProcess: 'capitalizeFirstChar',
                  })
                : t('core:group_call_mute', { postProcess: 'capitalizeFirstChar' })
            }
          >
            <IconButton
              size="small"
              onClick={toggleMute}
              sx={{
                color: isMuted ? 'error.main' : 'text.secondary',
                height: 26,
                width: 26,
              }}
            >
              {isMuted ? (
                <MicOffRoundedIcon sx={{ fontSize: 15 }} />
              ) : (
                <MicRoundedIcon sx={{ fontSize: 15 }} />
              )}
            </IconButton>
          </Tooltip>
          <Tooltip
            title={
              hearCall
                ? t('core:call_audio_mute', {
                    postProcess: 'capitalizeFirstChar',
                  })
                : t('core:call_audio_hear', {
                    postProcess: 'capitalizeFirstChar',
                  })
            }
          >
            <IconButton
              size="small"
              onClick={toggleHearCall}
              sx={{
                color: hearCall ? 'text.secondary' : 'error.main',
                height: 26,
                width: 26,
              }}
            >
              {hearCall ? (
                <VolumeUpRoundedIcon sx={{ fontSize: 15 }} />
              ) : (
                <VolumeOffRoundedIcon sx={{ fontSize: 15 }} />
              )}
            </IconButton>
          </Tooltip>
          <IconButton
            size="small"
            onClick={hangUp}
            sx={{
              backgroundColor: '#ef4444',
              color: '#fff',
              height: 26,
              width: 26,
              '&:hover': { backgroundColor: '#dc2626' },
            }}
          >
            <CallEndRoundedIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Box>
      )}

      <ChatList
        chatReferences={chatReferences}
        handleReaction={handleReaction}
        onEdit={onEdit}
        onReply={onReply}
        chatId={selectedDirect?.address}
        initialMessages={messages}
        myAddress={myAddress}
        tempMessages={tempMessages}
        tempChatReferences={tempChatReferences}
        onAcceptQchatFileTransfer={handleAcceptQchatFileTransfer}
        qchatFileTransferStates={qchatFileTransferStates}
        qchatCompletedTransfers={qchatCompletedTransfers}
      />

      <Dialog
        open={!!pendingQchatFileOffer}
        onClose={() => setPendingQchatFileOffer(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Send file</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'grid', gap: 1.5, pt: 0.5 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
              {pendingQchatFileOffer?.name || 'Selected file'}
            </Typography>
            <Typography sx={{ color: theme.palette.text.secondary, fontSize: 12 }}>
              {Math.max(
                1,
                Math.ceil((pendingQchatFileOffer?.size || 0) / 1024)
              )}{' '}
              KB
            </Typography>
            <TextField
              label="Expires in hours"
              type="number"
              value={qchatFileExpiryHours}
              onChange={(event) => setQchatFileExpiryHours(event.target.value)}
              inputProps={{ min: 0.05, max: 168, step: 0.25 }}
              size="small"
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setPendingQchatFileOffer(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleConfirmQchatFileOffer}
            disabled={isSending}
          >
            Send offer
          </Button>
        </DialogActions>
      </Dialog>

      <Box
        sx={{
          alignItems: 'flex-end',
          backgroundColor: theme.palette.background.default,
          borderTop: '1px solid',
          borderColor: 'divider',
          bottom: isFocusedParent ? '0px' : 'unset',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'row',
          flexShrink: 0,
          gap: '12px',
          minHeight: '150px',
          overflow: 'hidden',
          padding: '16px 20px 20px',
          position: isFocusedParent ? 'fixed' : 'relative',
          top: isFocusedParent ? '0px' : 'unset',
          width: '100%',
          zIndex: isFocusedParent ? 5 : 'unset',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            flexShrink: 0,
            justifyContent: 'flex-end',
            minWidth: 0,
            overflow: 'auto',
          }}
        >
          {replyMessage && (
            <Box
              sx={{
                alignItems: 'flex-start',
                display: 'flex',
                gap: '5px',
                justifyContent: 'flex-end',
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
            alignItems: 'center',
            display: 'flex',
            gap: '8px',
            flexShrink: 0,
            paddingBottom: '2px',
          }}
        >
          <Tooltip title="Transfer file with Reticulum">
            <span>
              <IconButton
                onClick={handleSendQchatFileOffer}
                disabled={isSending || isNewChat || !selectedDirect?.address}
                sx={{
                  border: '1px solid',
                  borderColor: theme.palette.divider,
                  borderRadius: '8px',
                  height: 44,
                  width: 44,
                }}
              >
                <AttachFileRoundedIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </span>
          </Tooltip>
          <CustomButton
            onClick={() => {
              if (isSending) return;
              sendMessage();
            }}
            sx={{
              alignItems: 'center',
              backgroundColor: isSending
                ? theme.palette.action.disabledBackground
                : theme.palette.background.paper,
              border: '1px solid',
              borderColor: theme.palette.divider,
              borderRadius: '8px',
              color: theme.palette.text.primary,
              cursor: isSending ? 'default' : 'pointer',
              display: 'inline-flex',
              gap: '6px',
              fontSize: '14px',
              fontWeight: 500,
              justifyContent: 'center',
              minHeight: '44px',
              minWidth: '88px',
              padding: '10px 16px',
              position: 'relative',
              transition: 'background-color 0.2s ease, border-color 0.2s ease',
              '&:hover': isSending
                ? {}
                : {
                    backgroundColor: theme.palette.action.hover,
                    borderColor: theme.palette.divider,
                  },
            }}
          >
            {isSending ? (
              <CircularProgress
                size={18}
                sx={{ color: theme.palette.text.secondary }}
              />
            ) : (
              <>
                <SendIcon sx={{ fontSize: '18px' }} />
                Send
              </>
            )}
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
