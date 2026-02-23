import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  IconButton,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import { useTranslation } from 'react-i18next';
import { generateHTML } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import Mention from '@tiptap/extension-mention';
import TextStyle from '@tiptap/extension-text-style';
import ShortUniqueId from 'short-unique-id';
import {
  getBaseApiReact,
  getBaseApiReactSocket,
  pauseAllQueues,
  resumeAllQueues,
} from '../../App';
import { isExtMsg } from '../../background/background.ts';
import { useMessageQueue } from '../../messaging/MessageQueueContext';
import {
  decodeBase64ForUIChatMessages,
  objectToBase64,
} from '../../qdn/encryption/group-encryption';
import { executeEvent } from '../../utils/events';
import { ChatList } from './ChatList';
import {
  RESOURCE_TYPE_NUMBER_GROUP_CHAT_REACTIONS,
  TIME_MINUTES_2_IN_MILLISECONDS,
} from '../../constants/constants';

const uid = new ShortUniqueId({ length: 5 });

/** Normalize open-group message content to a string so MessageItem never receives object or invalid data. */
function normalizeOpenMessageContent(raw: unknown): string {
  if (raw == null) return '<p></p>';
  if (typeof raw === 'string') {
    const t = raw.trim();
    return t.length ? t : '<p></p>';
  }
  if (typeof raw === 'object' && raw !== null) {
    try {
      const doc = raw as { type?: string; content?: unknown };
      if (doc.type === 'doc' && Array.isArray(doc.content)) {
        return generateHTML(doc, [
          StarterKit,
          Underline,
          Highlight,
          Mention,
          TextStyle,
        ]);
      }
    } catch {
      // fallback
    }
  }
  return '<p></p>';
}

function stripHtmlToPlain(html: string): string {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** Same as ChatGroup: merge edit/reaction items from combined/decoded response into chatReferences */
function mergeGroupChatReferences(
  combineUIAndExtensionMsgs: any[],
  prev: Record<string, { edit?: any; reactions?: Record<string, any[]> }>
): Record<string, { edit?: any; reactions?: Record<string, any[]> }> {
  const organizedChatReferences = { ...prev };
  (combineUIAndExtensionMsgs || [])
    .filter(
      (rawItem: any) =>
        rawItem &&
        rawItem.chatReference &&
        (rawItem?.decryptedData?.type === 'reaction' ||
          rawItem?.decryptedData?.type === 'edit' ||
          rawItem?.type === 'edit' ||
          rawItem?.isEdited ||
          rawItem?.type === 'reaction')
    )
    .forEach((item: any) => {
      try {
        if (item?.decryptedData?.type === 'edit') {
          organizedChatReferences[item.chatReference] = {
            ...(organizedChatReferences[item.chatReference] || {}),
            edit: item.decryptedData,
          };
        } else if (item?.type === 'edit' || item?.isEdited) {
          organizedChatReferences[item.chatReference] = {
            ...(organizedChatReferences[item.chatReference] || {}),
            edit: item,
          };
        } else {
          const content = item?.content || item.decryptedData?.content;
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
            return;
          }
          organizedChatReferences[item.chatReference] = {
            ...(organizedChatReferences[item.chatReference] || {}),
            reactions:
              organizedChatReferences[item.chatReference]?.reactions || {},
          };
          organizedChatReferences[item.chatReference].reactions[content] =
            organizedChatReferences[item.chatReference].reactions[content] ||
            [];
          let latestTimestampForSender: number | null = null;
          organizedChatReferences[item.chatReference].reactions[content] =
            organizedChatReferences[item.chatReference].reactions[
              content
            ].filter((reaction: any) => {
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
            organizedChatReferences[item.chatReference].reactions[content].push(
              item
            );
          }
          if (
            organizedChatReferences[item.chatReference].reactions[content]
              .length === 0
          ) {
            delete organizedChatReferences[item.chatReference].reactions[
              content
            ];
          }
        }
      } catch (err) {
        console.error('MiniGroupThread mergeGroupChatReferences:', err, item);
      }
    });
  return organizedChatReferences;
}

export function MiniGroupThread({
  group,
  isPrivate: isPrivateProp,
  getSecretKeyForGroup,
  myAddress,
  myName,
  onBack,
  onOpenInApp,
  getTimestampEnterChat,
  getUserAvatarUrl,
}: {
  group: any;
  isPrivate: boolean | null;
  getSecretKeyForGroup: (g: any) => Promise<any>;
  myAddress: string;
  myName?: string;
  onBack: () => void;
  onOpenInApp?: () => void;
  getTimestampEnterChat: () => Promise<any>;
  getUserAvatarUrl: (name?: string) => string;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core', 'group']);
  const { queueChats, addToQueue, processWithNewMessages } = useMessageQueue();
  const [messages, setMessages] = useState<any[]>([]);
  const [chatReferences, setChatReferences] = useState<
    Record<string, { edit?: any; reactions?: Record<string, any[]> }>
  >({});
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [replyMessage, setReplyMessage] = useState<any>(null);
  const [onEditMessage, setOnEditMessage] = useState<any>(null);
  const [secretKey, setSecretKey] = useState<any>(null);
  const [keyError, setKeyError] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const groupId = group?.groupId;
  /** From parent (groupsProperties), same as Group.tsx; open group when false */
  const isPrivate = isPrivateProp ?? group?.isOpen === false;
  const socketRef = useRef<WebSocket | null>(null);
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appendOpenRef = useRef<(data: any) => void>(() => {});
  const appendPrivateRef = useRef<(data: any) => Promise<void>>(() =>
    Promise.resolve()
  );

  const tempMessages = useMemo(() => {
    if (!groupId) return [];
    return (
      queueChats[groupId]?.filter((item: any) => !item?.chatReference) ?? []
    );
  }, [groupId, queueChats]);

  const tempChatReferences = useMemo(() => {
    if (!groupId) return [];
    return (
      queueChats[groupId]?.filter((item: any) => !!item?.chatReference) ?? []
    );
  }, [groupId, queueChats]);

  /** Load messages for private groups: same API + decryptSingle, same as ChatGroup */
  const loadMessagesPrivate = useCallback(async () => {
    if (!groupId || !secretKey) return;
    setLoading(true);
    try {
      const url = `${getBaseApiReact()}/chat/messages?txGroupId=${groupId}&encoding=BASE64&limit=0&reverse=false`;
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const responseData = await res.json();
      const encrypted = Array.isArray(responseData) ? responseData : [];
      if (encrypted.length === 0) {
        setMessages([]);
        setLoading(false);
        return;
      }
      const decrypted = await new Promise<any[]>((resolve, reject) => {
        window
          .sendMessage('decryptSingle', {
            data: encrypted,
            secretKeyObject: secretKey,
          })
          .then((r: any) => (r?.error ? reject(r.error) : resolve(r || [])))
          .catch(reject);
      });
      const filterUIMessages = encrypted.filter(
        (item: any) => !isExtMsg(item?.data)
      );
      const decodedUI = decodeBase64ForUIChatMessages(filterUIMessages);
      const combined = (decrypted || []).map((item: any, i: number) => ({
        ...(decodedUI[i] || {}),
        ...item,
        ...(item?.decryptedData || {}),
      }));
      processWithNewMessages(combined, groupId);
      const formatted = combined
        .filter((item: any) => !item?.chatReference)
        .map((item: any) => {
          const text = item?.decryptedData?.message || item?.message || '';
          return {
            ...item,
            id: item.signature,
            text,
            message: text,
            sender: item.sender,
            senderName: item.senderName,
            timestamp: item.timestamp,
          };
        });
      setMessages(formatted);
      setChatReferences((prev) => mergeGroupChatReferences(combined, prev));
    } catch (e) {
      console.error(e);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [groupId, secretKey]);

  /** Load messages for open (public) groups: same API + decodeBase64 only, no decrypt, same as ChatGroup */
  const loadMessagesOpen = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    try {
      const url = `${getBaseApiReact()}/chat/messages?txGroupId=${groupId}&encoding=BASE64&limit=0&reverse=false`;
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const responseData = await res.json();
      const raw = Array.isArray(responseData) ? responseData : [];
      const filterUIMessages = raw.filter((item: any) => !isExtMsg(item?.data));
      if (filterUIMessages.length === 0) {
        setMessages([]);
        setLoading(false);
        return;
      }
      const decodedUI = decodeBase64ForUIChatMessages(filterUIMessages);
      processWithNewMessages(decodedUI, groupId);
      const formatted = decodedUI
        .filter((item: any) => item?.signature && !item?.chatReference)
        .map((item: any) => {
          const rawContent =
            item?.messageText ?? item?.decryptedData?.message ?? item?.message;
          const contentStr = normalizeOpenMessageContent(rawContent);
          return {
            ...item,
            id: item.signature,
            text: contentStr,
            message: contentStr,
            messageText: contentStr,
            sender: item.sender,
            senderName: item.senderName,
            timestamp: item.timestamp,
          };
        });
      setMessages(formatted);
      setChatReferences((prev) => mergeGroupChatReferences(decodedUI, prev));
    } catch (e) {
      console.error(e);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    if (isPrivate !== false) {
      let cancelled = false;
      setKeyError(false);
      getSecretKeyForGroup(group)
        .then((key) => {
          if (!cancelled && key) setSecretKey(key);
          else if (!cancelled && !key) setKeyError(true);
        })
        .catch(() => {
          if (!cancelled) setKeyError(true);
        });
      return () => {
        cancelled = true;
      };
    }
  }, [group, getSecretKeyForGroup, isPrivate]);

  useEffect(() => {
    if (!groupId) {
      setLoading(false);
      return;
    }
    if (isPrivate === false || isPrivate === null) {
      loadMessagesOpen();
    } else if (secretKey && isPrivate === true) {
      loadMessagesPrivate();
    }
  }, [isPrivate, secretKey, groupId, loadMessagesOpen, loadMessagesPrivate]);

  const forceCloseWebSocket = useCallback(() => {
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }
    if (pingTimeoutRef.current) {
      clearTimeout(pingTimeoutRef.current);
      pingTimeoutRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.close(1000, 'forced');
      socketRef.current = null;
    }
  }, []);

  const appendIncomingMessagesOpen = useCallback(
    (rawData: any) => {
      const raw = Array.isArray(rawData) ? rawData : [rawData];
      const filterUIMessages = raw.filter((item: any) => !isExtMsg(item?.data));
      if (filterUIMessages.length === 0) return;
      const decodedUI = decodeBase64ForUIChatMessages(filterUIMessages);
      processWithNewMessages(decodedUI, groupId ?? '');
      setChatReferences((prev) => mergeGroupChatReferences(decodedUI, prev));
      const formatted = decodedUI
        .filter((item: any) => item?.signature && !item?.chatReference)
        .map((item: any) => {
          const rawContent =
            item?.messageText ?? item?.decryptedData?.message ?? item?.message;
          const contentStr = normalizeOpenMessageContent(rawContent);
          return {
            ...item,
            id: item.signature,
            text: contentStr,
            message: contentStr,
            messageText: contentStr,
            sender: item.sender,
            senderName: item.senderName,
            timestamp: item.timestamp,
          };
        });
      if (formatted.length > 0) {
        setMessages((prev) => {
          const existing = new Set(prev.map((m) => m.signature));
          const newOnes = formatted.filter((f) => !existing.has(f.signature));
          if (newOnes.length === 0) return prev;
          return [...prev, ...newOnes].sort(
            (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
          );
        });
      }
    },
    [groupId, processWithNewMessages]
  );

  const appendIncomingMessagesPrivate = useCallback(
    async (encryptedData: any) => {
      const encrypted = Array.isArray(encryptedData)
        ? encryptedData
        : [encryptedData];
      if (encrypted.length === 0 || !secretKey) return;
      try {
        const decrypted = await new Promise<any[]>((resolve, reject) => {
          window
            .sendMessage('decryptSingle', {
              data: encrypted,
              secretKeyObject: secretKey,
            })
            .then((r: any) => (r?.error ? reject(r.error) : resolve(r || [])))
            .catch(reject);
        });
        const filterUIMessages = encrypted.filter(
          (item: any) => !isExtMsg(item?.data)
        );
        const decodedUI = decodeBase64ForUIChatMessages(filterUIMessages);
        const combined = (decrypted || []).map((item: any, i: number) => ({
          ...(decodedUI[i] || {}),
          ...item,
          ...(item?.decryptedData || {}),
        }));
        processWithNewMessages(combined, groupId ?? '');
        setChatReferences((prev) => mergeGroupChatReferences(combined, prev));
        const formatted = combined
          .filter((item: any) => !item?.chatReference)
          .map((item: any) => {
            const text = item?.decryptedData?.message || item?.message || '';
            return {
              ...item,
              id: item.signature,
              text,
              message: text,
              sender: item.sender,
              senderName: item.senderName,
              timestamp: item.timestamp,
            };
          });
        if (formatted.length > 0) {
          setMessages((prev) => {
            const existing = new Set(prev.map((m) => m.signature));
            const newOnes = formatted.filter((f) => !existing.has(f.signature));
            if (newOnes.length === 0) return prev;
            return [...prev, ...newOnes].sort(
              (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
            );
          });
        }
      } catch (e) {
        console.error('MiniGroupThread appendIncomingMessagesPrivate:', e);
      }
    },
    [groupId, secretKey, processWithNewMessages]
  );

  appendOpenRef.current = appendIncomingMessagesOpen;
  appendPrivateRef.current = appendIncomingMessagesPrivate;

  const initWebsocket = useCallback(() => {
    forceCloseWebSocket();
    if (!groupId) return;
    if (isPrivate === true && !secretKey) return;
    const socketLink = `${getBaseApiReactSocket()}/websockets/chat/messages?txGroupId=${groupId}&encoding=BASE64&limit=100`;
    const socket = new WebSocket(socketLink);
    socketRef.current = socket;
    const isPrivateGroup = isPrivate === true;

    const pingWebSocket = () => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send('ping');
        timeoutIdRef.current = setTimeout(() => {
          if (socketRef.current) socketRef.current.close();
        }, 5000);
      }
    };

    socket.onopen = () => {
      pingTimeoutRef.current = setTimeout(pingWebSocket, 50);
    };

    socket.onmessage = (e) => {
      try {
        if (e.data === 'pong') {
          if (timeoutIdRef.current) {
            clearTimeout(timeoutIdRef.current);
            timeoutIdRef.current = null;
          }
          pingTimeoutRef.current = setTimeout(pingWebSocket, 20000);
        } else {
          const data = JSON.parse(e.data);
          const dataArray = Array.isArray(data) ? data : [data];
          if (isPrivateGroup) {
            appendPrivateRef.current(dataArray);
          } else {
            appendOpenRef.current(dataArray);
          }
          setLoading(false);
        }
      } catch (err) {
        console.error('MiniGroupThread websocket onmessage:', err);
      }
    };

    socket.onclose = (event) => {
      if (pingTimeoutRef.current) {
        clearTimeout(pingTimeoutRef.current);
        pingTimeoutRef.current = null;
      }
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
      if (event.reason !== 'forced' && event.code !== 1000) {
        setTimeout(initWebsocket, 10000);
      }
    };

    socket.onerror = () => {
      if (pingTimeoutRef.current) clearTimeout(pingTimeoutRef.current);
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
      if (socketRef.current) socketRef.current.close();
    };
  }, [groupId, isPrivate, secretKey, forceCloseWebSocket]);

  useEffect(() => {
    if (!groupId) return;
    if (
      isPrivate === false ||
      isPrivate === null ||
      (isPrivate === true && secretKey)
    ) {
      initWebsocket();
      return () => forceCloseWebSocket();
    }
  }, [groupId, isPrivate, secretKey, initWebsocket, forceCloseWebSocket]);

  const encryptMessage = async (data: string, typeNumber?: number) => {
    return new Promise<string>((res, rej) => {
      const payload: any = { data, secretKeyObject: secretKey };
      if (typeNumber != null) payload.typeNumber = typeNumber;
      window
        .sendMessage('encryptSingle', payload)
        .then((r: any) => (r?.error ? rej(r.error) : res(r)))
        .catch(rej);
    });
  };

  const handleReaction = useCallback(
    async (reaction: string, chatMessage: any, reactionState = true) => {
      if (sending || !groupId) return;
      if (isPrivate === true && !secretKey) return;
      pauseAllQueues();
      setSending(true);
      try {
        const message = '';
        const otherData = {
          specialId: uid.rnd(),
          type: 'reaction',
          content: reaction,
          contentState: reactionState,
        };
        const objectMessage = { message, ...(otherData || {}) };
        const message64: string = await objectToBase64(objectMessage);
        const encryptSingle =
          isPrivate === false
            ? JSON.stringify(objectMessage)
            : await encryptMessage(
                message64,
                RESOURCE_TYPE_NUMBER_GROUP_CHAT_REACTIONS
              );
        const sendMessageFunc = async () =>
          new Promise<void>((resolve, reject) => {
            window
              .sendMessage(
                'sendChatGroup',
                {
                  groupId,
                  messageText: encryptSingle,
                  chatReference: chatMessage?.signature,
                },
                TIME_MINUTES_2_IN_MILLISECONDS
              )
              .then((r: any) => (r?.error ? reject(r.error) : resolve()))
              .catch(reject);
          });
        const messageObj = {
          message: {
            text: message,
            timestamp: Date.now(),
            senderName: myName,
            sender: myAddress,
            ...(otherData || {}),
          },
          chatReference: chatMessage?.signature,
        };
        addToQueue(sendMessageFunc, messageObj, 'chat-reaction', groupId);
      } finally {
        setSending(false);
        resumeAllQueues();
      }
    },
    [sending, groupId, isPrivate, secretKey, myName, myAddress]
  );

  const handleReply = useCallback((message: any) => {
    setReplyMessage(message);
    setOnEditMessage(null);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const handleEdit = useCallback((message: any) => {
    setOnEditMessage(message);
    setReplyMessage(null);
    const raw =
      message?.text ??
      message?.message ??
      message?.messageText ??
      message?.decryptedData?.message ??
      message?.decryptedData?.data?.message ??
      '';
    const contentStr =
      typeof raw === 'string' ? raw : normalizeOpenMessageContent(raw);
    const plain = stripHtmlToPlain(contentStr);
    setInputValue(plain);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const clearReplyEdit = useCallback(() => {
    setReplyMessage(null);
    setOnEditMessage(null);
    setInputValue('');
  }, []);

  const handleSend = async () => {
    const trimmed = inputValue?.trim();
    if (!trimmed || sending || !groupId) return;
    if (isPrivate === true && !secretKey) return;
    const htmlContent = `<p>${trimmed.replace(/\n/g, '<br/>')}</p>`;
    setInputValue('');
    setReplyMessage(null);
    setOnEditMessage(null);
    pauseAllQueues();
    setSending(true);
    try {
      let repliedTo = replyMessage?.signature;
      if (replyMessage?.chatReference) repliedTo = replyMessage.chatReference;
      const chatReference = onEditMessage?.signature;
      const specialId = uid.rnd();
      const publicData = isPrivate ? {} : { isEdited: !!chatReference };
      let messageText: string;
      if (isPrivate === false) {
        messageText = JSON.stringify({
          messageText: htmlContent,
          version: 3,
          specialId,
          images: [],
          repliedTo,
          type: chatReference ? 'edit' : '',
          ...publicData,
        });
      } else {
        const objectMessage = {
          message: htmlContent,
          version: 3,
          specialId,
          images: [],
          repliedTo,
          type: chatReference ? 'edit' : '',
          ...(onEditMessage?.decryptedData || {}),
        };
        const message64 = await objectToBase64(objectMessage);
        messageText = await encryptMessage(message64);
      }
      const sendMessageFunc = async () =>
        new Promise<void>((resolve, reject) => {
          window
            .sendMessage(
              'sendChatGroup',
              { groupId, messageText, chatReference },
              TIME_MINUTES_2_IN_MILLISECONDS
            )
            .then((r: any) => (r?.error ? reject(r.error) : resolve()))
            .catch(reject);
        });
      const messageObj = {
        message: {
          text: htmlContent,
          timestamp: Date.now(),
          senderName: myName,
          sender: myAddress,
          specialId,
          repliedTo,
          chatReference,
        },
        ...(chatReference ? { chatReference } : {}),
      };
      if (chatReference) {
        setChatReferences((prev) => ({
          ...prev,
          [chatReference]: {
            ...(prev[chatReference] || {}),
            edit: {
              message: htmlContent,
              messageText: htmlContent,
              timestamp: Date.now(),
            },
          },
        }));
      }
      addToQueue(sendMessageFunc, messageObj, 'chat', groupId);
      setTimeout(() => {
        getTimestampEnterChat?.();
        if (!chatReference) {
          executeEvent('sent-new-message-group', {});
        }
      }, 150);
    } finally {
      setSending(false);
      resumeAllQueues();
    }
  };

  const groupName =
    group?.groupName || group?.name || `Group ${group?.groupId}`;
  const ownerName = group?.ownerName || group?.name;
  const avatarUrl = ownerName
    ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${ownerName}/qortal_group_avatar_${groupId}?async=true`
    : null;

  if (keyError && isPrivate !== false) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Box
          sx={{
            alignItems: 'center',
            borderBottom: '1px solid',
            borderColor: theme.palette.divider,
            display: 'flex',
            gap: 1,
            flexShrink: 0,
            padding: '10px 12px',
          }}
        >
          <IconButton
            onClick={onBack}
            size="small"
            sx={{
              color: theme.palette.text.secondary,
              '&:hover': { backgroundColor: theme.palette.action.hover },
            }}
            aria-label={t('core:action.return', {
              postProcess: 'capitalizeFirstChar',
            })}
          >
            <ArrowBackRoundedIcon sx={{ fontSize: 22 }} />
          </IconButton>
          <Typography
            sx={{
              flex: 1,
              fontFamily: 'Inter',
              fontSize: '15px',
              fontWeight: 600,
            }}
          >
            {groupName}
          </Typography>
          {onOpenInApp && (
            <IconButton
              size="small"
              onClick={onOpenInApp}
              sx={{
                color: theme.palette.text.secondary,
                '&:hover': {
                  backgroundColor: theme.palette.action.hover,
                  color: theme.palette.text.primary,
                },
              }}
              aria-label={t('core:action.open_in_new', {
                postProcess: 'capitalizeFirstChar',
              })}
            >
              <OpenInNewRoundedIcon sx={{ fontSize: 20 }} />
            </IconButton>
          )}
        </Box>
        <Box
          sx={{
            flex: 1,
            padding: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: theme.palette.text.secondary,
            fontFamily: 'Inter',
            fontSize: '14px',
            textAlign: 'center',
          }}
        >
          {t('group:message.generic.encryption_key', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Box>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          borderBottom: '1px solid',
          borderColor: theme.palette.divider,
          display: 'flex',
          gap: 1,
          flexShrink: 0,
          padding: '10px 12px',
        }}
      >
        <IconButton
          onClick={onBack}
          size="small"
          sx={{
            color: theme.palette.text.secondary,
            '&:hover': { backgroundColor: theme.palette.action.hover },
          }}
          aria-label={t('core:action.return', {
            postProcess: 'capitalizeFirstChar',
          })}
        >
          <ArrowBackRoundedIcon sx={{ fontSize: 22 }} />
        </IconButton>
        <Avatar
          sx={{
            width: 36,
            height: 36,
            bgcolor: theme.palette.background.default,
            color: theme.palette.text.primary,
            fontSize: '14px',
          }}
          src={avatarUrl}
        >
          {groupName?.charAt(0)}
        </Avatar>
        <Typography
          sx={{
            flex: 1,
            fontFamily: 'Inter',
            fontSize: '15px',
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {groupName}
        </Typography>
        {onOpenInApp && (
          <IconButton
            size="small"
            onClick={onOpenInApp}
            sx={{
              color: theme.palette.text.secondary,
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
                color: theme.palette.text.primary,
              },
            }}
            aria-label={t('core:action.open_in_new', {
              postProcess: 'capitalizeFirstChar',
            })}
          >
            <OpenInNewRoundedIcon sx={{ fontSize: 20 }} />
          </IconButton>
        )}
      </Box>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {loading ? (
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontFamily: 'Inter',
              fontSize: '13px',
              padding: 2,
            }}
          >
            {t('core:loading.generic', { postProcess: 'capitalizeFirstChar' })}
          </Typography>
        ) : (
          <ChatList
            chatReferences={chatReferences}
            compactScrollButton
            enableMentions={false}
            handleReaction={handleReaction}
            hasSecretKey={!!secretKey}
            initialMessages={messages}
            isPrivate={isPrivate}
            members={[]}
            myAddress={myAddress}
            myName={myName}
            onEdit={handleEdit}
            onReply={handleReply}
            openQManager={() => {}}
            selectedGroup={group}
            tempChatReferences={tempChatReferences}
            tempMessages={tempMessages}
          />
        )}
      </Box>

      <Box
        sx={{
          borderTop: '1px solid',
          borderColor: theme.palette.divider,
          padding: '10px 12px',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
        }}
      >
        {(replyMessage || onEditMessage) && (
          <Box
            sx={{
              alignItems: 'center',
              backgroundColor: theme.palette.action.hover,
              borderRadius: 1,
              display: 'flex',
              gap: 0.5,
              padding: '6px 8px',
            }}
          >
            <Typography
              sx={{
                flex: 1,
                fontFamily: 'Inter',
                fontSize: '12px',
                color: theme.palette.text.secondary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {onEditMessage
                ? t('core:message.generic.editing_message', {
                    postProcess: 'capitalizeFirstChar',
                  })
                : t('core:message.generic.replying_to', {
                    name:
                      replyMessage?.senderName || replyMessage?.sender || '',
                    postProcess: 'capitalizeFirstChar',
                  })}
            </Typography>
            <IconButton
              size="small"
              onClick={clearReplyEdit}
              sx={{ padding: 0.25 }}
              aria-label={t('core:action.cancel', {
                postProcess: 'capitalizeFirstChar',
              })}
            >
              <CloseRoundedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        )}
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
          <TextField
            inputRef={inputRef}
            size="small"
            fullWidth
            multiline
            maxRows={4}
            placeholder={t('core:action.start_typing', {
              postProcess: 'capitalizeFirstChar',
            })}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={sending || (isPrivate === true && !secretKey)}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: '20px',
                backgroundColor: theme.palette.background.default,
                fontFamily: 'Inter',
                fontSize: '14px',
                '& fieldset': { borderColor: theme.palette.divider },
                '&:hover fieldset': {
                  borderColor: theme.palette.text.secondary,
                },
              },
            }}
          />
          <IconButton
            onClick={handleSend}
            disabled={
              sending ||
              !inputValue?.trim() ||
              (isPrivate === true && !secretKey)
            }
            sx={{
              color: theme.palette.primary.main,
              bgcolor: theme.palette.action.hover,
              '&:hover': { bgcolor: theme.palette.action.selected },
              '&.Mui-disabled': { color: theme.palette.text.disabled },
            }}
            aria-label={t('core:action.send', {
              postProcess: 'capitalizeFirstChar',
            })}
          >
            <SendRoundedIcon sx={{ fontSize: 22 }} />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
}
