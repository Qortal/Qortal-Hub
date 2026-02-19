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
import ShortUniqueId from 'short-unique-id';
import {
  getBaseApiReact,
  getBaseApiReactSocket,
  pauseAllQueues,
  resumeAllQueues,
} from '../../App';
import { getPublicKey } from '../../background/background.ts';
import { useMessageQueue } from '../../messaging/MessageQueueContext';
import { executeEvent } from '../../utils/events';
import { ChatList } from './ChatList';
import { TIME_MINUTES_2_IN_MILLISECONDS } from '../../constants/constants';

const uid = new ShortUniqueId({ length: 5 });

function stripHtmlToPlain(html: string): string {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** Same as ChatDirect: merge edit/reaction items from decrypt response into chatReferences */
function mergeDirectChatReferences(
  response: any[],
  prev: Record<string, { edit?: any; reactions?: Record<string, any[]> }>
): Record<string, { edit?: any; reactions?: Record<string, any[]> }> {
  const organizedChatReferences = { ...prev };
  (response || [])
    .filter(
      (rawItem: any) =>
        rawItem &&
        rawItem.chatReference &&
        (rawItem?.type === 'reaction' || rawItem?.type === 'edit' || rawItem?.isEdited)
    )
    .forEach((item: any) => {
      try {
        if (item?.type === 'edit' || item?.isEdited) {
          organizedChatReferences[item.chatReference] = {
            ...(organizedChatReferences[item.chatReference] || {}),
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
            ...(organizedChatReferences[item.chatReference] || {}),
            reactions: organizedChatReferences[item.chatReference]?.reactions || {},
          };
          organizedChatReferences[item.chatReference].reactions[content] =
            organizedChatReferences[item.chatReference].reactions[content] || [];
          let latestTimestampForSender: number | null = null;
          organizedChatReferences[item.chatReference].reactions[content] = organizedChatReferences[
            item.chatReference
          ].reactions[content].filter((reaction: any) => {
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
            organizedChatReferences[item.chatReference].reactions[content].push(item);
          }
          if (
            organizedChatReferences[item.chatReference].reactions[content].length === 0
          ) {
            delete organizedChatReferences[item.chatReference].reactions[content];
          }
        }
      } catch (err) {
        console.error('MiniDirectThread mergeDirectChatReferences:', err, item);
      }
    });
  return organizedChatReferences;
}

export function MiniDirectThread({
  direct,
  myAddress,
  myName,
  onBack,
  onOpenInApp,
  getTimestampEnterChat,
  getUserAvatarUrl,
}: {
  direct: any;
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
  const [chatReferences, setChatReferences] = useState<Record<string, { edit?: any; reactions?: Record<string, any[]> }>>({});
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [replyMessage, setReplyMessage] = useState<any>(null);
  const [onEditMessage, setOnEditMessage] = useState<any>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appendIncomingMessagesRef = useRef<(data: any) => Promise<void>>(() => Promise.resolve());
  const processWithNewMessagesRef = useRef(processWithNewMessages);
  processWithNewMessagesRef.current = processWithNewMessages;

  const tempMessages = useMemo(() => {
    if (!direct?.address) return [];
    return queueChats[direct.address]?.filter((item: any) => !item?.chatReference) ?? [];
  }, [direct?.address, queueChats]);

  const tempChatReferences = useMemo(() => {
    if (!direct?.address) return [];
    return queueChats[direct.address]?.filter((item: any) => !!item?.chatReference) ?? [];
  }, [direct?.address, queueChats]);

  const loadMessages = useCallback(async () => {
    if (!direct?.address || !myAddress) return;
    setLoading(true);
    try {
      const url = `${getBaseApiReact()}/chat/messages?involving=${direct.address}&involving=${myAddress}&encoding=BASE64&limit=0&reverse=false`;
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      const encrypted = Array.isArray(data) ? data : [];
      if (encrypted.length === 0) {
        setMessages([]);
        setLoading(false);
        return;
      }
      const decrypted = await new Promise<any[]>((resolve, reject) => {
        window
          .sendMessage('decryptDirect', {
            data: encrypted,
            involvingAddress: direct.address,
          })
          .then((r: any) => (r?.error ? reject(r.error) : resolve(r || [])))
          .catch(reject);
      });
      const processFn = processWithNewMessagesRef.current;
      const processed = processFn(decrypted || [], direct.address);
      const response = Array.isArray(processed) ? processed : decrypted || [];
      const formatted = response
        .filter((item: any) => !item?.chatReference)
        .map((item: any) => ({
          ...item,
          id: item.signature,
          text: item.message,
          message: item.message,
        }));
      setMessages(formatted);
      setChatReferences((prev) => mergeDirectChatReferences(response, prev));
    } catch (e) {
      console.error(e);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [direct?.address, myAddress]);

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

  const appendIncomingMessages = useCallback(
    async (encryptedData: any) => {
      const encrypted = Array.isArray(encryptedData) ? encryptedData : [encryptedData];
      if (encrypted.length === 0) return;
      try {
        const decrypted = await new Promise<any[]>((resolve, reject) => {
          window
            .sendMessage('decryptDirect', {
              data: encrypted,
              involvingAddress: direct?.address,
            })
            .then((r: any) => (r?.error ? reject(r.error) : resolve(r || [])))
            .catch(reject);
        });
        const processed = processWithNewMessages(decrypted || [], direct?.address ?? '');
        const response = Array.isArray(processed) ? processed : decrypted || [];
        const formatted = response
          .filter((item: any) => !item?.chatReference)
          .map((item: any) => ({
            ...item,
            id: item.signature,
            text: item.message,
            message: item.message,
          }));
        setChatReferences((prev) => mergeDirectChatReferences(response, prev));
        if (formatted.length > 0) {
          setMessages((prev) => {
            const existing = new Set(prev.map((m) => m.signature));
            const newOnes = formatted.filter((f) => !existing.has(f.signature));
            if (newOnes.length === 0) return prev;
            return [...prev, ...newOnes].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
          });
        }
      } catch (e) {
        console.error('MiniDirectThread appendIncomingMessages:', e);
      }
    },
    [direct?.address, processWithNewMessages]
  );

  appendIncomingMessagesRef.current = appendIncomingMessages;

  const initWebsocket = useCallback(() => {
    forceCloseWebSocket();
    if (!direct?.address || !myAddress) return;
    const socketLink = `${getBaseApiReactSocket()}/websockets/chat/messages?involving=${direct.address}&involving=${myAddress}&encoding=BASE64&limit=100`;
    const socket = new WebSocket(socketLink);
    socketRef.current = socket;

    const pingWebSocket = () => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send('ping');
        timeoutIdRef.current = setTimeout(() => {
          if (socketRef.current) {
            socketRef.current.close();
          }
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
          pingTimeoutRef.current = setTimeout(pingWebSocket, 45000);
        } else {
          const data = JSON.parse(e.data);
          appendIncomingMessagesRef.current(data);
          setLoading(false);
        }
      } catch (err) {
        console.error('MiniDirectThread websocket onmessage:', err);
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
  }, [direct?.address, myAddress, forceCloseWebSocket]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    initWebsocket();
    return () => forceCloseWebSocket();
  }, [initWebsocket, forceCloseWebSocket]);

  useEffect(() => {
    let cancelled = false;
    getPublicKey(direct?.address).then((key) => {
      if (!cancelled) setPublicKey(key || '');
    });
    return () => {
      cancelled = true;
    };
  }, [direct?.address]);


  const handleReply = useCallback((message: any) => {
    setReplyMessage(message);
    setOnEditMessage(null);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const handleEdit = useCallback((message: any) => {
    setOnEditMessage(message);
    setReplyMessage(null);
    const plain = stripHtmlToPlain(message?.text ?? message?.message ?? '');
    setInputValue(plain);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const clearReplyEdit = useCallback(() => {
    setReplyMessage(null);
    setOnEditMessage(null);
    setInputValue('');
  }, []);

  const handleReaction = useCallback(
    (reaction: string, chatMessage: any, reactionState = true) => {
      if (sending || !publicKey || !direct?.address) return;
      pauseAllQueues();
      setSending(true);
      const otherData = {
        specialId: uid.rnd(),
        type: 'reaction',
        content: reaction,
        contentState: reactionState,
      };
      const sendMessageFunc = async () =>
        new Promise<void>((resolve, reject) => {
          window
            .sendMessage(
              'sendChatDirect',
              {
                directTo: direct.address,
                messageText: '',
                publicKeyOfRecipient: publicKey,
                address: direct.address,
                chatReference: chatMessage?.signature,
                otherData,
              },
              TIME_MINUTES_2_IN_MILLISECONDS
            )
            .then((r: any) => (r?.error ? reject(r.error) : resolve()))
            .catch(reject);
        });
      const messageObj = {
        message: {
          timestamp: Date.now(),
          senderName: myName,
          sender: myAddress,
          ...(otherData || {}),
        },
        chatReference: chatMessage?.signature,
      };
      addToQueue(sendMessageFunc, messageObj, 'chat-direct', direct.address);
      setSending(false);
      resumeAllQueues();
    },
    [sending, publicKey, direct?.address, myName, myAddress]
  );

  const handleSend = () => {
    const trimmed = inputValue?.trim();
    if (!trimmed || !publicKey || sending || !direct?.address) return;
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
      const otherData = {
        ...(onEditMessage?.decryptedData || {}),
        specialId: uid.rnd(),
        repliedTo: onEditMessage ? onEditMessage?.repliedTo : repliedTo,
        type: chatReference ? 'edit' : '',
      };
      const sendMessageFunc = async () =>
        new Promise<void>((resolve, reject) => {
          window
            .sendMessage(
              'sendChatDirect',
              {
                directTo: direct.address,
                messageText: htmlContent,
                publicKeyOfRecipient: publicKey,
                address: direct.address,
                chatReference,
                otherData,
              },
              TIME_MINUTES_2_IN_MILLISECONDS
            )
            .then((r: any) => (r?.error ? reject(r.error) : resolve()))
            .catch(reject);
        });
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
      addToQueue(sendMessageFunc, messageObj, 'chat-direct', direct.address);
      setTimeout(() => {
        getTimestampEnterChat?.();
        executeEvent('sent-new-message-group', {});
      }, 150);
    } finally {
      setSending(false);
      resumeAllQueues();
    }
  };

  const avatarUrl = getUserAvatarUrl(direct?.name);

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
          {(direct?.name || direct?.address)?.charAt(0)}
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
          {direct?.name || direct?.address}
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
            hasSecretKey={true}
            initialMessages={messages}
            isPrivate={false}
            members={[
              { address: myAddress, name: myName },
              { address: direct?.address, name: direct?.name },
            ]}
            myAddress={myAddress}
            myName={myName}
            onEdit={handleEdit}
            onReply={handleReply}
            openQManager={() => {}}
            selectedGroup={null}
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
                    name: replyMessage?.senderName || replyMessage?.sender || '',
                    postProcess: 'capitalizeFirstChar',
                  })}
            </Typography>
            <IconButton
              size="small"
              onClick={clearReplyEdit}
              sx={{ padding: 0.25 }}
              aria-label={t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
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
            disabled={sending}
            sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: '20px',
              backgroundColor: theme.palette.background.default,
              fontFamily: 'Inter',
              fontSize: '14px',
              '& fieldset': { borderColor: theme.palette.divider },
              '&:hover fieldset': { borderColor: theme.palette.text.secondary },
            },
          }}
        />
        <IconButton
          onClick={handleSend}
          disabled={sending || !inputValue?.trim()}
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
