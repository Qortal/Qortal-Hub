import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import {
  userInfoAtom,
  balanceAtom,
  dmFriendsByAddressAtom,
  p2pHealthAtom,
} from '../../atoms/global';
import { ChatList } from './ChatList';
import Tiptap from './TipTap';
import { SpellCheckContextMenu } from './SpellCheckContextMenu';
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
  SvgIcon,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CallEndRoundedIcon from '@mui/icons-material/CallEndRounded';
import CallRoundedIcon from '@mui/icons-material/CallRounded';
import PersonAddRoundedIcon from '@mui/icons-material/PersonAddRounded';
import PersonRemoveRoundedIcon from '@mui/icons-material/PersonRemoveRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SendIcon from '@mui/icons-material/Send';
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
import { resolveDirectTarget } from '../../lib/dm/resolveDirectTarget';
import {
  MAX_SIZE_MESSAGE,
  MESSAGE_LIMIT_WARNING,
  MIN_REQUIRED_QORTS,
  TIME_MONTHS_1_IN_MILLISECONDS,
  TIME_MINUTES_2_IN_MILLISECONDS,
} from '../../constants/constants.ts';
import { useVoiceCallContext } from '../../context/VoiceCallContext';
import { useCallSwitchGuard } from '../../contexts/CallSwitchGuardContext';
import { buildDirectVoiceCallChatId } from '../../lib/call/directVoiceCallChatId';
import { useIsOnline } from '../../hooks/usePresence';
import { hasInvisibleCharacters } from '../../utils/hasInvisibleCharacters';
import { useReticulumDirectChat } from '../../hooks/useReticulumDirectChat';
import { fileToBase64 } from '../../utils/fileReading';
import { ReticulumGifCompressionStatus } from './ReticulumGifCompressionStatus';
import { MessageSizeLimitLip } from './MessageSizeLimitLip';
import {
  compressReticulumImageFile,
  convertReticulumGifFile,
  isReticulumCompressibleImage,
  isReticulumGifFile,
} from './reticulumImagePreparation';
import { ReticulumLargeImageDialog } from './ReticulumLargeImageDialog';
import { shouldBlockChatForLowBalance } from './chatTransportBalance';
import { ReticulumMessageExpiryButton } from './ReticulumMessageExpiryButton';
import { ReactionPicker } from '../ReactionPicker';

const uid = new ShortUniqueId({ length: 5 });
const RETICULUM_ACTIVE_BLUE = '#2563eb';
const RETICULUM_DIRECT_TYPING_STOP_MS = 2500;
const DM_EXPIRY_NOTICE_STORAGE_PREFIX = 'qchat-dm-expiry-notice-dismissed-v1';

const normalizeEditContent = (raw: unknown): string => {
  if (raw == null) return '<p></p>';
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed.length ? trimmed : '<p></p>';
  }
  return '<p></p>';
};
const QCHAT_FILE_DEFAULT_EXPIRY_HOURS = 2;
const QCHAT_FILE_COMPLETED_CACHE_KEY = 'qchat-dm-file-transfer-completed-v1';
const QCHAT_FILE_COMPLETED_CACHE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const QCHAT_FILE_COMPLETED_CACHE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

type ReticulumDirectSilenceState = {
  ownerAddress: string;
  targetAddress: string;
  scopeType: 'group' | 'dm';
  scopeId: string;
  expiresAt: number | null;
  ignoredThrough: number;
  active: boolean;
};

const isReticulumChatInternalTransferEvent = (payload: any): boolean => {
  const resourceType = String(
    payload?.resourceType ??
      payload?.resource_type ??
      payload?.metadata?.resourceType ??
      payload?.metadata?.logicalResourceType ??
      ''
  ).trim();
  if (
    resourceType === 'reticulum_chat_event' ||
    resourceType === 'reticulum_chat_event_page' ||
    resourceType === 'reticulum_chat_history_page' ||
    resourceType === 'reticulum_chat_dm_page' ||
    resourceType === 'reticulum_group_resource' ||
    resourceType === 'reticulum_group_resource_range' ||
    resourceType === 'reticulum_resource_dm' ||
    resourceType === 'reticulum_resource_dm_range'
  ) {
    return true;
  }
  return String(payload?.reason || '') === 'channel_read_forbidden';
};

type PendingReticulumDirectFile = {
  filePath?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
  base64?: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  temporaryFilePath?: string;
};

const sha256Hex = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const reticulumDirectConversationId = async (
  addressA: string,
  addressB: string
) => {
  const [a, b] = [
    String(addressA || '').trim(),
    String(addressB || '').trim(),
  ].sort();
  if (!a || !b) return '';
  return sha256Hex(`rchat-dm-v1:${a}:${b}`);
};

const formatQchatFileSize = (bytes?: number) => {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return '0 KB';
  if (size < 1024 * 1024) return `${Math.max(1, Math.ceil(size / 1024))} KB`;
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const ReticulumFileTransferIcon = (props) => (
  <SvgIcon viewBox="0 0 24 24" {...props}>
    <circle cx="5" cy="12" r="2" fill="currentColor" />
    <circle cx="19" cy="6" r="2" fill="currentColor" />
    <circle cx="19" cy="18" r="2" fill="currentColor" />
    <path
      d="M7 12C12 12 12 6 17 6"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      opacity="0.45"
      fill="none"
    />
    <path
      d="M7 12C12 12 12 18 17 18"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      opacity="0.45"
      fill="none"
    />
    <path
      d="M8 12H15"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M13 9L16 12L13 15"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </SvgIcon>
);

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
        if (expiresAt)
          return expiresAt + QCHAT_FILE_COMPLETED_CACHE_GRACE_MS > now;
        return (
          !completedAt ||
          completedAt + QCHAT_FILE_COMPLETED_CACHE_MAX_AGE_MS > now
        );
      })
      .slice(-5000);
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
};

const saveQchatCompletedTransfers = (
  address: string,
  records: Record<string, any>
) => {
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
    return {
      ...(message.decryptedData || {}),
      ...(message.decryptedData.data || {}),
    };
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
  isActive = true,
  reticulumEnabled = true,
  reticulumChatEnabled = false,
}) => {
  const userInfo = useAtomValue(userInfoAtom);
  const balance = useAtomValue(balanceAtom);
  const [dmFriendsByAddress, setDmFriendsByAddress] = useAtom(
    dmFriendsByAddressAtom
  );
  const myName = userInfo?.name;
  const theme = useTheme();
  const p2pHealth = useAtomValue(p2pHealthAtom);

  const {
    callState,
    activeCallChatId,
    initiateCall: initiateVoiceCall,
    hangUp,
  } = useVoiceCallContext();
  const { confirmCallSwitch } = useCallSwitchGuard();

  const peerOnline = useIsOnline(selectedDirect?.address);
  const isSelfDirect = Boolean(
    myAddress && selectedDirect?.address === myAddress
  );

  const directVoiceChatId = useMemo(() => {
    if (!myAddress || !selectedDirect?.address) return null;
    return buildDirectVoiceCallChatId(myAddress, selectedDirect.address);
  }, [myAddress, selectedDirect?.address]);

  const callMatchesThisDirect = Boolean(
    directVoiceChatId &&
    ((callState === 'calling' && activeCallChatId === directVoiceChatId) ||
      (callState === 'connected' && activeCallChatId === directVoiceChatId))
  );
  const p2pHealthGood = p2pHealth === 'good';
  const directVoiceBlockedByP2p = !callMatchesThisDirect && !p2pHealthGood;
  const directVoiceBlockedByFriend = Boolean(
    selectedDirect?.address && !dmFriendsByAddress[selectedDirect.address]
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
        throw new Error(t('group:dm.sign_transfer_failed'));
      }
      return {
        signature: res.signature,
        publicKey: userInfo.publicKey,
      };
    },
    [userInfo?.publicKey]
  );

  const handleStartDirectVoiceCall = useCallback(async () => {
    if (!directVoiceChatId || !selectedDirect?.address) return;
    if (callMatchesThisDirect) return;
    if (!peerOnline) return;
    if (directVoiceBlockedByP2p) return;
    if (directVoiceBlockedByFriend) return;
    const confirmed = await confirmCallSwitch({
      type: 'direct',
      chatId: directVoiceChatId,
    });
    if (!confirmed) return;
    initiateVoiceCall(
      selectedDirect.address,
      directVoiceChatId,
      signCallRequest,
      selectedDirect.name && selectedDirect.name !== selectedDirect.address
        ? selectedDirect.name
        : undefined
    );
  }, [
    callMatchesThisDirect,
    confirmCallSwitch,
    directVoiceChatId,
    directVoiceBlockedByFriend,
    directVoiceBlockedByP2p,
    initiateVoiceCall,
    peerOnline,
    selectedDirect?.address,
    selectedDirect?.name,
    signCallRequest,
  ]);

  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'reticulum',
  ]);
  const p2pHealthBadTooltip = t('core:p2p_health_bad_call_tooltip');
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
  const [formattingTrayResetKey, setFormattingTrayResetKey] = useState(0);
  const socketRef = useRef(null);
  const timeoutIdRef = useRef(null);
  const [messageSize, setMessageSize] = useState(0);
  const [messageSizeLimitShakeKey, setMessageSizeLimitShakeKey] = useState(0);
  const [showDmExpiryNotice, setShowDmExpiryNotice] = useState(false);
  const groupSocketTimeoutRef = useRef(null);
  const [replyMessage, setReplyMessage] = useState(null);
  const [qchatFileTransferStates, setQchatFileTransferStates] = useState({});
  const [qchatCompletedTransfers, setQchatCompletedTransfers] = useState({});
  const [pendingReticulumFiles, setPendingReticulumFiles] = useState<
    PendingReticulumDirectFile[]
  >([]);
  const [isCompressingReticulumGif, setIsCompressingReticulumGif] =
    useState(false);
  const [reticulumImageChoice, setReticulumImageChoice] = useState<{
    file: File;
    filePath: string;
  } | null>(null);
  const [isCompressingReticulumImage, setIsCompressingReticulumImage] =
    useState(false);
  const reticulumImagePreparationSequenceRef = useRef(0);
  const reticulumGifConversionSequenceRef = useRef(0);
  const reticulumDirectPeerRef = useRef('');
  reticulumDirectPeerRef.current = String(selectedDirect?.address || '').trim();
  useEffect(() => {
    reticulumImagePreparationSequenceRef.current += 1;
    reticulumGifConversionSequenceRef.current += 1;
    setReticulumImageChoice(null);
    setIsCompressingReticulumImage(false);
    setIsCompressingReticulumGif(false);
  }, [selectedDirect?.address]);
  const {
    enabled: reticulumDirectEnabled,
    messages: reticulumDirectMessages,
    chatReferences: reticulumDirectChatReferences,
    initialHistoryReady: reticulumDirectInitialHistoryReady,
    typingUsers: reticulumDirectTypingUsers,
    publish: publishReticulumDirectEvent,
    markRead: markReticulumDirectRead,
    sendTyping: sendReticulumDirectTyping,
  } = useReticulumDirectChat(myAddress, selectedDirect?.address);
  const reticulumDirectUiEnabled = Boolean(
    reticulumChatEnabled || (reticulumDirectEnabled && !isNewChat)
  );
  useEffect(() => {
    if (!reticulumDirectUiEnabled || !myAddress) {
      setShowDmExpiryNotice(false);
      return;
    }
    try {
      setShowDmExpiryNotice(
        localStorage.getItem(
          `${DM_EXPIRY_NOTICE_STORAGE_PREFIX}:${myAddress}`
        ) !== '1'
      );
    } catch {
      setShowDmExpiryNotice(true);
    }
  }, [myAddress, reticulumDirectUiEnabled]);

  const dismissDmExpiryNotice = useCallback(() => {
    setShowDmExpiryNotice(false);
    if (!myAddress) return;
    try {
      localStorage.setItem(
        `${DM_EXPIRY_NOTICE_STORAGE_PREFIX}:${myAddress}`,
        '1'
      );
    } catch {
      // The notice can still be dismissed for this session when storage is unavailable.
    }
  }, [myAddress]);
  const [reticulumDirectCallHistory, setReticulumDirectCallHistory] = useState<
    any[]
  >([]);
  const [reticulumDirectCallHistoryReady, setReticulumDirectCallHistoryReady] =
    useState(false);
  useEffect(() => {
    const ownerAddress = String(myAddress || '').trim();
    const peerAddress = String(selectedDirect?.address || '').trim();
    if (!reticulumDirectUiEnabled || !ownerAddress || !peerAddress) {
      setReticulumDirectCallHistory([]);
      setReticulumDirectCallHistoryReady(false);
      return;
    }
    let cancelled = false;
    setReticulumDirectCallHistoryReady(false);
    const reload = async () => {
      const records = await window.reticulumChat
        ?.getDirectCallHistory(ownerAddress, peerAddress, 100)
        .catch(() => []);
      if (!cancelled) {
        setReticulumDirectCallHistory(records || []);
        setReticulumDirectCallHistoryReady(true);
      }
    };
    void reload();
    const off = window.reticulumChat?.onDirectCallHistory?.((payload: any) => {
      const record = payload?.record;
      if (
        record?.ownerAddress === ownerAddress &&
        record?.peerAddress === peerAddress
      )
        void reload();
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [myAddress, reticulumDirectUiEnabled, selectedDirect?.address]);

  const reticulumDirectMessagesWithCalls = useMemo(() => {
    if (!reticulumDirectUiEnabled || reticulumDirectCallHistory.length === 0) {
      return reticulumDirectMessages;
    }
    const calls = reticulumDirectCallHistory.map((record: any) => ({
      signature: `direct-call:${record.callId}`,
      timestamp: Number(record.endedAt || 0),
      sender:
        record.direction === 'incoming'
          ? record.peerAddress
          : record.ownerAddress,
      directCallHistory: record,
    }));
    return [...reticulumDirectMessages, ...calls].sort(
      (a: any, b: any) =>
        Number(a?.timestamp || 0) - Number(b?.timestamp || 0) ||
        String(a?.signature || '').localeCompare(String(b?.signature || ''))
    );
  }, [
    reticulumDirectCallHistory,
    reticulumDirectMessages,
    reticulumDirectUiEnabled,
  ]);
  const reticulumDirectPending =
    !isNewChat && reticulumDirectUiEnabled && !reticulumDirectEnabled;
  const [reticulumDirectLinkActive, setReticulumDirectLinkActive] =
    useState(false);
  const [reticulumDirectExpiryDurationMs, setReticulumDirectExpiryDurationMs] =
    useState<number | null>(TIME_MONTHS_1_IN_MILLISECONDS);
  const [reticulumDirectExpiryLoading, setReticulumDirectExpiryLoading] =
    useState(false);
  const reticulumDirectExpiryLoadRef = useRef(0);
  const [reticulumPeerSilence, setReticulumPeerSilence] =
    useState<ReticulumDirectSilenceState | null>(null);
  const [reticulumSilenceBusy, setReticulumSilenceBusy] = useState(false);
  const reticulumSilencePeerRef = useRef('');
  const reticulumDirectTypingActiveRef = useRef(false);
  const reticulumDirectTypingStopTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const clearReticulumDirectTypingStopTimer = useCallback(() => {
    if (reticulumDirectTypingStopTimerRef.current) {
      clearTimeout(reticulumDirectTypingStopTimerRef.current);
      reticulumDirectTypingStopTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const peerAddress = String(selectedDirect?.address || '').trim();
    if (
      !reticulumDirectUiEnabled ||
      isNewChat ||
      isSelfDirect ||
      !myAddress ||
      !peerAddress ||
      !window.reticulumChat?.getSilence
    ) {
      reticulumSilencePeerRef.current = '';
      setReticulumPeerSilence(null);
      setReticulumSilenceBusy(false);
      return;
    }
    reticulumSilencePeerRef.current = peerAddress;
    setReticulumPeerSilence(null);
    setReticulumSilenceBusy(false);
    let cancelled = false;
    const refresh = async () => {
      try {
        if (cancelled) return;
        const silence = await window.reticulumChat?.getSilence?.(
          myAddress,
          peerAddress,
          'dm'
        );
        if (!cancelled) {
          setReticulumPeerSilence(silence?.active ? silence : null);
        }
      } catch {
        if (!cancelled) setReticulumPeerSilence(null);
      }
    };
    void refresh();
    const offSilence = window.reticulumChat?.onSilenceChanged?.((payload) => {
      if (
        payload.ownerAddress === myAddress &&
        payload.targetAddress === peerAddress &&
        payload.scopeType === 'dm'
      ) {
        void refresh();
      }
    });
    return () => {
      cancelled = true;
      offSilence?.();
    };
  }, [
    isNewChat,
    isSelfDirect,
    myAddress,
    reticulumDirectUiEnabled,
    selectedDirect?.address,
  ]);

  const unsilenceReticulumDirectPeer = useCallback(async () => {
    const peerAddress = String(selectedDirect?.address || '').trim();
    if (
      !myAddress ||
      !peerAddress ||
      !reticulumPeerSilence?.active ||
      !window.reticulumChat?.clearSilence
    ) {
      return;
    }
    setReticulumSilenceBusy(true);
    try {
      const result = await window.reticulumChat.clearSilence(
        myAddress,
        peerAddress,
        'dm'
      );
      if (!result?.success) {
        throw new Error(
          result?.error ||
            t('reticulum:hide_user.error_unhide', {
              postProcess: 'capitalizeFirstChar',
            })
        );
      }
      if (reticulumSilencePeerRef.current === peerAddress) {
        setReticulumPeerSilence(null);
      }
    } catch (error) {
      if (reticulumSilencePeerRef.current !== peerAddress) return;
      setInfoSnack({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : t('reticulum:hide_user.error_unhide', {
                postProcess: 'capitalizeFirstChar',
              }),
      });
      setOpenSnack(true);
    } finally {
      if (reticulumSilencePeerRef.current === peerAddress) {
        setReticulumSilenceBusy(false);
      }
    }
  }, [myAddress, reticulumPeerSilence?.active, selectedDirect?.address]);

  const sendReticulumDirectTypingState = useCallback(
    async (active: boolean, allowGrace = false) => {
      if (
        !reticulumDirectEnabled ||
        isSelfDirect ||
        !selectedDirect?.address ||
        isNewChat ||
        !peerOnline ||
        (!reticulumDirectLinkActive && !allowGrace)
      ) {
        return;
      }
      const result = await sendReticulumDirectTyping(active);
      if (active) {
        if (result?.success) reticulumDirectTypingActiveRef.current = true;
      } else {
        reticulumDirectTypingActiveRef.current = false;
      }
    },
    [
      isNewChat,
      isSelfDirect,
      peerOnline,
      reticulumDirectEnabled,
      reticulumDirectLinkActive,
      selectedDirect?.address,
      sendReticulumDirectTyping,
    ]
  );

  useEffect(() => {
    if (
      !reticulumDirectEnabled ||
      isSelfDirect ||
      !myAddress ||
      !selectedDirect?.address ||
      isNewChat ||
      !peerOnline
    ) {
      setReticulumDirectLinkActive(false);
      return;
    }
    let cancelled = false;
    setReticulumDirectLinkActive(false);
    void window.reticulumChat
      ?.setActiveDirectChat?.(myAddress, selectedDirect.address, true)
      ?.then((result) => {
        if (!cancelled) setReticulumDirectLinkActive(result?.success === true);
      });
    return () => {
      cancelled = true;
      clearReticulumDirectTypingStopTimer();
      reticulumDirectTypingActiveRef.current = false;
      void sendReticulumDirectTyping(false);
      setReticulumDirectLinkActive(false);
      void window.reticulumChat?.setActiveDirectChat?.(
        myAddress,
        selectedDirect.address,
        false
      );
    };
  }, [
    isNewChat,
    isSelfDirect,
    myAddress,
    peerOnline,
    clearReticulumDirectTypingStopTimer,
    reticulumDirectEnabled,
    sendReticulumDirectTyping,
    selectedDirect?.address,
  ]);
  const [pendingQchatFileOffer, setPendingQchatFileOffer] = useState(null);
  const [qchatFileExpiryHours, setQchatFileExpiryHours] = useState(
    QCHAT_FILE_DEFAULT_EXPIRY_HOURS
  );
  const outgoingQchatFileTransfersRef = useRef(new Map());
  const qchatAcceptedOfferMetaRef = useRef(new Map());
  const qchatUserTransferIdsRef = useRef(new Set<string>());
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
        if (
          shouldBlockChatForLowBalance(
            balance,
            MIN_REQUIRED_QORTS,
            reticulumDirectEnabled
          )
        )
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
      reticulumDirectEnabled,
    ]
  );

  const handleReticulumDirectDelete = useCallback(
    async (chatMessage) => {
      try {
        if (
          !reticulumDirectEnabled ||
          chatMessage?.reticulumDirect !== true ||
          chatMessage?.sender !== myAddress ||
          isSending
        ) {
          return;
        }
        const targetEventId = String(
          chatMessage?.signature || chatMessage?.id || ''
        ).trim();
        if (!targetEventId) return;
        setIsSending(true);
        const result = await sendChatDirect(
          {
            chatReference: targetEventId,
            messageText: '',
            otherData: {
              specialId: uid.rnd(),
              type: 'delete',
            },
          },
          selectedDirect?.address,
          publicKeyOfRecipient,
          false
        );
        if (result?.error) {
          throw new Error(result.error);
        }
      } catch (error) {
        const errorMsg = error?.message || error;
        setInfoSnack({ type: 'error', message: errorMsg });
        setOpenSnack(true);
        console.error(error);
      } finally {
        setIsSending(false);
      }
    },
    [
      isSending,
      myAddress,
      publicKeyOfRecipient,
      reticulumDirectEnabled,
      selectedDirect?.address,
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

  useEffect(() => {
    if (
      !reticulumDirectEnabled ||
      !reticulumDirectCallHistoryReady ||
      !selectedDirect?.address ||
      !isActive
    )
      return;
    const latestTimestamp = reticulumDirectMessagesWithCalls.reduce(
      (max, message: any) => Math.max(max, Number(message?.timestamp || 0)),
      0
    );
    if (latestTimestamp <= 0) return;
    void markReticulumDirectRead(latestTimestamp);
    window.reticulumChat?.dismissNotifications?.(NaN, selectedDirect.address);
  }, [
    markReticulumDirectRead,
    reticulumDirectEnabled,
    reticulumDirectCallHistoryReady,
    reticulumDirectMessagesWithCalls,
    isActive,
    selectedDirect?.address,
  ]);

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
            console.warn(
              '[DirectChat] Unable to decrypt direct messages',
              decryptResponse.error
            );
            res([]);
          })
          .catch((error) => {
            console.warn(
              '[DirectChat] Unable to decrypt direct messages',
              error?.message || error
            );
            res([]);
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
    return resolveDirectTarget(directToValue, nameSearchResults || []);
  }, [directToValue, nameSearchResults]);

  const reticulumDirectExpiryPeerAddress = String(
    (isNewChat ? resolvedNewChatTarget?.address : selectedDirect?.address) || ''
  ).trim();

  useEffect(() => {
    const generation = reticulumDirectExpiryLoadRef.current + 1;
    reticulumDirectExpiryLoadRef.current = generation;
    setReticulumDirectExpiryDurationMs(TIME_MONTHS_1_IN_MILLISECONDS);
    if (
      !reticulumDirectUiEnabled ||
      !myAddress ||
      !reticulumDirectExpiryPeerAddress
    ) {
      setReticulumDirectExpiryLoading(false);
      return;
    }
    setReticulumDirectExpiryLoading(true);
    const request = window.reticulumChat?.getDirectExpiryPreference?.(
      myAddress,
      reticulumDirectExpiryPeerAddress
    );
    if (!request) {
      setReticulumDirectExpiryLoading(false);
      return;
    }
    void request
      .then((result) => {
        if (
          reticulumDirectExpiryLoadRef.current !== generation ||
          !result?.success ||
          !result.preference
        ) {
          return;
        }
        setReticulumDirectExpiryDurationMs(result.preference.durationMs);
      })
      .catch(() => undefined)
      .finally(() => {
        if (reticulumDirectExpiryLoadRef.current === generation) {
          setReticulumDirectExpiryLoading(false);
        }
      });
  }, [myAddress, reticulumDirectExpiryPeerAddress, reticulumDirectUiEnabled]);

  const changeReticulumDirectExpiry = useCallback(
    (durationMs: number | undefined) => {
      const normalized = durationMs ?? null;
      setReticulumDirectExpiryDurationMs(normalized);
      if (!myAddress || !reticulumDirectExpiryPeerAddress) return;
      void window.reticulumChat?.setDirectExpiryPreference?.(
        myAddress,
        reticulumDirectExpiryPeerAddress,
        normalized
      );
    },
    [myAddress, reticulumDirectExpiryPeerAddress]
  );

  const [friendActionBusy, setFriendActionBusy] = useState(false);

  const handleToggleDmFriend = useCallback(
    async (
      address: string,
      displayName: string | undefined,
      isCurrentlyFriend: boolean
    ) => {
      if (!address || address === myAddress) return;
      if (isCurrentlyFriend) {
        setFriendActionBusy(true);
        try {
          const storedEventId = String(
            dmFriendsByAddress[address]?.eventId || ''
          ).trim();
          const latestOwnFriendEvent = [...reticulumDirectMessages]
            .reverse()
            .find((message: any) => {
              const friendEvent = message?.dmFriendEvent;
              return (
                String(friendEvent?.actorAddress || '') === myAddress &&
                String(friendEvent?.targetAddress || '') === address
              );
            });
          const eventId =
            storedEventId ||
            String(
              latestOwnFriendEvent?.signature ||
                latestOwnFriendEvent?.eventId ||
                latestOwnFriendEvent?.id ||
                ''
            ).trim();
          if (eventId) {
            const result = await publishReticulumDirectEvent({
              chatReference: eventId,
              messageText: '',
              otherData: {
                specialId: uid.rnd(),
                type: 'delete',
              },
              peerAddressOverride: address,
            });
            if (result?.error || result?.success === false) {
              throw new Error(result?.error || 'Could not remove friend');
            }
          }
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
        } catch (error) {
          setInfoSnack({
            type: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'Could not remove friend',
          });
          setOpenSnack(true);
        } finally {
          setFriendActionBusy(false);
        }
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
        const actorLabel = myName || myAddress;
        const targetLabel = name || address;
        const callsAvailable = reticulumDirectMessages.some((message: any) => {
          const friendEvent = message?.dmFriendEvent;
          return (
            String(friendEvent?.actorAddress || '') === address &&
            String(friendEvent?.targetAddress || '') === myAddress
          );
        });
        const result = await publishReticulumDirectEvent({
          messageText: `${actorLabel} added ${targetLabel} as a friend.`,
          otherData: {
            type: 'dm_friend_added',
            dmFriendEvent: {
              actorAddress: myAddress,
              actorName: actorLabel,
              targetAddress: address,
              targetName: targetLabel,
              callsAvailable,
            },
          },
          peerAddressOverride: address,
          expiryDurationMs: null,
        });
        if (result?.error || result?.success === false) {
          throw new Error(result?.error || t('group:dm.friend_event_failed'));
        }
        const eventId = String(result?.eventId || '').trim();
        if (eventId) {
          setDmFriendsByAddress((prev) => {
            const current = prev[address];
            if (!current) return prev;
            return {
              ...prev,
              [address]: { ...current, eventId },
            };
          });
        }
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
    [
      myAddress,
      myName,
      dmFriendsByAddress,
      publishReticulumDirectEvent,
      reticulumDirectMessages,
      setDmFriendsByAddress,
      t,
    ]
  );

  useEffect(() => {
    const addFriendFromRail = (event: Event) => {
      const detail = (event as CustomEvent<{ address?: string; name?: string }>)
        .detail;
      const address = String(detail?.address || '').trim();
      if (!address || dmFriendsByAddress[address]) return;
      void handleToggleDmFriend(address, detail?.name, false);
    };
    window.addEventListener('qchat:add-dm-friend', addFriendFromRail);
    return () =>
      window.removeEventListener('qchat:add-dm-friend', addFriendFromRail);
  }, [dmFriendsByAddress, handleToggleDmFriend]);

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
    if (reticulumChatEnabled || reticulumDirectEnabled) {
      forceCloseWebSocket();
      setIsLoading(false);
      hasInitializedWebsocket.current = false;
      return;
    }
    if (hasInitializedWebsocket.current || isNewChat) return;
    setIsLoading(true);
    initWebsocketMessageGroup();
    hasInitializedWebsocket.current = true;

    return () => {
      forceCloseWebSocket(); // Clean up WebSocket on component unmount
    };
  }, [
    selectedDirect?.address,
    myAddress,
    isNewChat,
    reticulumChatEnabled,
    reticulumDirectEnabled,
  ]);

  const sendChatDirect = async (
    {
      chatReference = undefined,
      messageText,
      otherData,
      expiryDurationMs,
    }: any,
    address,
    publicKeyOfRecipient,
    isNewChatVar
  ) => {
    try {
      const newChatTarget = isNewChatVar ? resolvedNewChatTarget : null;
      const directTo = isNewChatVar ? newChatTarget?.address : address;

      if (!directTo) {
        throw new Error(t('group:dm.select_valid_name'));
      }
      if (reticulumDirectEnabled) {
        const result = await publishReticulumDirectEvent({
          chatReference,
          messageText,
          otherData,
          peerAddressOverride: directTo,
          expiryDurationMs,
        });
        if (!result?.success) {
          throw new Error(result?.error || t('group:dm.message_failed'));
        }
        if (isNewChatVar) {
          let getRecipientName = null;
          try {
            getRecipientName = await getNameInfo(directTo);
          } catch (error) {
            console.error('Error fetching recipient name:', error);
          }
          setSelectedDirect({
            address: directTo,
            name: newChatTarget?.name || getRecipientName || directTo,
            timestamp: Date.now(),
            sender: myAddress,
            senderName: myName,
          });
          setNewChat(null);
          void window.reticulumChat?.setDirectExpiryPreference?.(
            myAddress,
            directTo,
            expiryDurationMs === undefined
              ? TIME_MONTHS_1_IN_MILLISECONDS
              : expiryDurationMs
          );
        }
        return {
          clearQueueOnSuccess: true,
          recipient: directTo,
          timestamp: Date.now(),
          reticulumDirect: true,
        };
      }
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
                      error.message ||
                        t('core:message.error.generic', {
                          postProcess: 'capitalizeFirstChar',
                        })
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
      throw new Error(t('group:dm.identity_unavailable'));
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
      if (
        shouldBlockChatForLowBalance(
          balance,
          MIN_REQUIRED_QORTS,
          reticulumDirectEnabled
        )
      ) {
        throw new Error(
          t('group:message.error.qortals_required', {
            quantity: MIN_REQUIRED_QORTS,
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
      const api = (window as any).electronAPI;
      if (!api?.qchatFileSelect) {
        throw new Error(t('group:dm.transfer_unavailable'));
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
  }, [
    balance,
    isNewChat,
    isSending,
    reticulumDirectEnabled,
    selectedDirect?.address,
    t,
  ]);

  const handleConfirmQchatFileOffer = useCallback(async () => {
    try {
      if (isNewChat || !selectedDirect?.address || !pendingQchatFileOffer)
        return;
      if (isSending) return;
      if (
        shouldBlockChatForLowBalance(
          balance,
          MIN_REQUIRED_QORTS,
          reticulumDirectEnabled
        )
      ) {
        throw new Error(
          t('group:message.error.qortals_required', {
            quantity: MIN_REQUIRED_QORTS,
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
      const api = (window as any).electronAPI;
      if (!api?.qchatFileSend) {
        throw new Error(t('group:dm.transfer_unavailable'));
      }
      const selectedFile = pendingQchatFileOffer;
      const reticulumIdentity = await getLocalReticulumIdentityForQchatFile();
      const transferId = `qft-${Date.now()}-${uid.rnd()}`;
      const expiryHours = Math.max(
        0.05,
        Math.min(
          168,
          Number(qchatFileExpiryHours) || QCHAT_FILE_DEFAULT_EXPIRY_HOURS
        )
      );
      const expiresAt = Date.now() + expiryHours * 60 * 60 * 1000;
      qchatUserTransferIdsRef.current.add(transferId);
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
            registered?.error || t('group:dm.transfer_register_failed')
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
    balance,
    getLocalReticulumIdentityForQchatFile,
    isNewChat,
    isSending,
    myAddress,
    myName,
    pendingQchatFileOffer,
    publicKeyOfRecipient,
    qchatFileExpiryHours,
    reticulumDirectEnabled,
    selectedDirect?.address,
    t,
  ]);

  const handleAcceptQchatFileTransfer = useCallback(
    async (message) => {
      try {
        const data = getQchatFileTransferData(message);
        if (!data?.transferId || !message?.sender) {
          console.error(
            '[QchatFileTransfer] accept aborted: missing transfer id or sender',
            {
              hasTransferId: Boolean(data?.transferId),
              hasSender: Boolean(message?.sender),
              data,
            }
          );
          return;
        }
        console.log('[QchatFileTransfer] accept started', {
          transferId: data.transferId,
          fileName: data.fileName,
          size: data.size,
          sender: message.sender,
        });
        if (qchatCompletedTransfers[data.transferId]) {
          throw new Error(t('group:dm.file_already_downloaded'));
        }
        if (
          Number(data.expiresAt || 0) > 0 &&
          Number(data.expiresAt) <= Date.now()
        ) {
          throw new Error(t('group:dm.file_offer_expired'));
        }
        const senderAddress = data.senderAddress || message.sender;
        if (senderAddress !== message.sender) {
          console.error('[QchatFileTransfer] accept aborted: sender mismatch', {
            transferId: data.transferId,
            senderAddress,
            messageSender: message.sender,
          });
          throw new Error(t('group:dm.file_sender_mismatch'));
        }
        if (data.recipientAddress && data.recipientAddress !== myAddress) {
          console.error(
            '[QchatFileTransfer] accept aborted: recipient mismatch',
            {
              transferId: data.transferId,
              recipientAddress: data.recipientAddress,
              myAddress,
            }
          );
          throw new Error(t('group:dm.file_not_addressed'));
        }
        const api = (window as any).electronAPI;
        if (!api?.qchatFileChooseSavePath || !api?.qchatFileAccept) {
          console.error(
            '[QchatFileTransfer] accept aborted: electron API unavailable',
            {
              transferId: data.transferId,
              hasChooseSavePath: Boolean(api?.qchatFileChooseSavePath),
              hasAccept: Boolean(api?.qchatFileAccept),
            }
          );
          throw new Error(t('group:dm.transfer_unavailable'));
        }
        console.log('[QchatFileTransfer] choosing save path', {
          transferId: data.transferId,
          fileName: data.fileName || 'received-file',
        });
        const save = await api.qchatFileChooseSavePath(
          data.fileName || 'received-file'
        );
        if (!save?.ok || !save.path) {
          console.error(
            '[QchatFileTransfer] accept aborted: save path not selected',
            {
              transferId: data.transferId,
              save,
            }
          );
          return;
        }
        console.log('[QchatFileTransfer] save path selected', {
          transferId: data.transferId,
          savePath: save.path,
        });
        console.log('[QchatFileTransfer] loading local Reticulum identity', {
          transferId: data.transferId,
        });
        const reticulumIdentity = await getLocalReticulumIdentityForQchatFile();
        console.log('[QchatFileTransfer] local Reticulum identity ready', {
          transferId: data.transferId,
          destinationHash: reticulumIdentity.destinationHash,
          hasIdentityPublicKey: Boolean(
            reticulumIdentity.identityPublicKeyBase64
          ),
        });
        const authTimestamp = Date.now();
        const downloaderPublicKey = userInfo?.publicKey || '';
        if (!downloaderPublicKey) {
          console.error(
            '[QchatFileTransfer] accept aborted: missing local public key',
            {
              transferId: data.transferId,
            }
          );
          throw new Error(t('group:dm.missing_public_key'));
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
        console.log('[QchatFileTransfer] signing accept auth message', {
          transferId: data.transferId,
          senderAddress,
          downloaderAddress: myAddress,
        });
        const authSigned = await signQchatFileFields(authSignedFields);
        console.log('[QchatFileTransfer] accept auth message signed', {
          transferId: data.transferId,
          hasSignature: Boolean(authSigned?.signature),
        });
        const authMessage = {
          ...authSignedFields,
          signature: authSigned.signature,
        };
        console.log('[QchatFileTransfer] invoking qchatFileAccept', {
          transferId: data.transferId,
          fileName: data.fileName || 'received-file',
          size: Number(data.size || 0),
          hasSenderDestinationHash: Boolean(
            data.senderReticulumDestinationHash
          ),
          hasSenderIdentityPublicKey: Boolean(
            data.senderReticulumIdentityPublicKeyBase64
          ),
          hasSha256: Boolean(data.sha256),
        });
        qchatUserTransferIdsRef.current.add(data.transferId);
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
        console.log('[QchatFileTransfer] qchatFileAccept result', {
          transferId: data.transferId,
          accepted,
        });
        if (!accepted?.ok) {
          console.error(
            '[QchatFileTransfer] accept failed in electron/bridge',
            {
              transferId: data.transferId,
              accepted,
            }
          );
          qchatUserTransferIdsRef.current.delete(data.transferId);
          throw new Error(
            accepted?.error || t('group:dm.transfer_accept_failed')
          );
        }
        qchatAcceptedOfferMetaRef.current.set(data.transferId, {
          expiresAt: Number(data.expiresAt || 0),
        });
        console.log('[QchatFileTransfer] accept registered', {
          transferId: data.transferId,
        });
      } catch (error) {
        console.error('[QchatFileTransfer] accept exception', {
          message: error?.message || String(error),
          error,
        });
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
        if (isReticulumChatInternalTransferEvent(payload)) return;
        const transferId = String(payload.transferId || '');
        const isKnownUserFileTransfer =
          transferId.startsWith('qft-') ||
          qchatUserTransferIdsRef.current.has(transferId) ||
          outgoingQchatFileTransfersRef.current.has(transferId) ||
          qchatAcceptedOfferMetaRef.current.has(transferId) ||
          qchatTerminalTransferIdsRef.current.has(transferId);
        if (!isKnownUserFileTransfer) return;
        const incomingFailure =
          payload.status === 'failed' || payload.status === 'rejected';
        if (
          incomingFailure &&
          qchatTerminalTransferIdsRef.current.has(transferId)
        ) {
          return;
        }
        if (payload.status === 'sent' || payload.status === 'received') {
          qchatTerminalTransferIdsRef.current.add(transferId);
        }
        setQchatFileTransferStates((prev) => {
          const current = prev[transferId] || {};
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
            [transferId]: {
              ...current,
              ...nextPayload,
              updatedAt: Date.now(),
            },
          };
        });
        if (payload.status === 'sent' || payload.status === 'received') {
          if (payload.status === 'received') {
            const offerMeta = qchatAcceptedOfferMetaRef.current.get(transferId);
            setQchatCompletedTransfers((prev) => {
              const next = {
                ...prev,
                [transferId]: {
                  transferId,
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
            qchatAcceptedOfferMetaRef.current.delete(transferId);
          }
        }
      }
    );
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const clearPendingReticulumFiles = useCallback(() => {
    setPendingReticulumFiles((files) => {
      files.forEach((file) => {
        if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
        if (file.temporaryFilePath) {
          void window.reticulumResources?.releaseConvertedMedia?.(
            file.temporaryFilePath
          );
        }
      });
      return [];
    });
  }, []);

  useEffect(() => {
    return () => {
      pendingReticulumFiles.forEach((file) => {
        if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
        if (file.temporaryFilePath) {
          void window.reticulumResources?.releaseConvertedMedia?.(
            file.temporaryFilePath
          );
        }
      });
    };
  }, [pendingReticulumFiles]);

  const getReticulumImageFileDimensions = useCallback(
    (file: File): Promise<{ width: number; height: number } | null> =>
      new Promise((resolve) => {
        if (!file.type?.startsWith('image/')) {
          resolve(null);
          return;
        }
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();
        const timeout = window.setTimeout(() => {
          image.onload = null;
          image.onerror = null;
          URL.revokeObjectURL(objectUrl);
          resolve(null);
        }, 5_000);
        image.onload = () => {
          window.clearTimeout(timeout);
          const width = Number(image.naturalWidth || image.width || 0);
          const height = Number(image.naturalHeight || image.height || 0);
          URL.revokeObjectURL(objectUrl);
          resolve(
            Number.isFinite(width) &&
              width > 0 &&
              Number.isFinite(height) &&
              height > 0
              ? { width, height }
              : null
          );
        };
        image.onerror = () => {
          window.clearTimeout(timeout);
          URL.revokeObjectURL(objectUrl);
          resolve(null);
        };
        image.src = objectUrl;
      }),
    []
  );

  const addPendingReticulumFile = useCallback(
    async (
      file: File,
      options: { asAttachment?: boolean; filePathOverride?: string } = {}
    ) => {
      if (!reticulumDirectEnabled) return false;
      const targetPeerAddress = String(selectedDirect?.address || '').trim();
      if (!targetPeerAddress || isNewChat) {
        setInfoSnack({
          type: 'error',
          message: t('group:dm.attach_select_chat'),
        });
        setOpenSnack(true);
        return false;
      }
      const filePath =
        options.filePathOverride ||
        window.reticulumResources?.getPathForFile?.(file) ||
        (typeof (file as File & { path?: unknown }).path === 'string'
          ? String((file as File & { path?: unknown }).path)
          : '');
      const sourceIsImage = file.type?.startsWith('image/') === true;
      const isImage = sourceIsImage && options.asAttachment !== true;
      if (!sourceIsImage && !filePath) {
        setInfoSnack({
          type: 'error',
          message: t('group:dm.file_source_not_streamable'),
        });
        setOpenSnack(true);
        return false;
      }
      const dimensions = isImage
        ? await getReticulumImageFileDimensions(file)
        : null;
      const previewUrl = isImage ? URL.createObjectURL(file) : undefined;
      const base64 = !filePath ? await fileToBase64(file) : undefined;
      if (reticulumDirectPeerRef.current !== targetPeerAddress) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        return false;
      }
      clearPendingReticulumFiles();
      setPendingReticulumFiles([
        {
          ...(filePath ? { filePath } : {}),
          fileName: file.name || 'resource.bin',
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size || 0,
          isImage,
          ...(typeof base64 === 'string' && base64 ? { base64 } : {}),
          ...(previewUrl ? { previewUrl } : {}),
          ...(dimensions
            ? { width: dimensions.width, height: dimensions.height }
            : {}),
        },
      ]);
      return true;
    },
    [
      clearPendingReticulumFiles,
      getReticulumImageFileDimensions,
      isNewChat,
      reticulumDirectEnabled,
      selectedDirect?.address,
    ]
  );

  const insertFiles = useCallback(
    async (files: File[]) => {
      if (isCompressingReticulumGif || isCompressingReticulumImage) return;
      const file = files.find((item) => item && item.size >= 0);
      if (!file) return;
      if (!reticulumDirectEnabled) {
        setInfoSnack({
          type: 'error',
          message: t('reticulum:dm.required_for_attachments'),
        });
        setOpenSnack(true);
        return;
      }
      if (pendingReticulumFiles.length > 0) {
        setInfoSnack({
          type: 'error',
          message: 'Send or remove the current attachment first',
        });
        setOpenSnack(true);
        return;
      }
      if (await isReticulumGifFile(file)) {
        const conversionSequence = ++reticulumGifConversionSequenceRef.current;
        const conversionPeer = reticulumDirectPeerRef.current;
        setIsCompressingReticulumGif(true);
        try {
          const converted = await convertReticulumGifFile(file);
          if (
            converted?.success &&
            converted.filePath &&
            converted.fileName &&
            converted.mimeType &&
            typeof converted.sizeBytes === 'number'
          ) {
            if (
              reticulumGifConversionSequenceRef.current !==
                conversionSequence ||
              reticulumDirectPeerRef.current !== conversionPeer
            ) {
              void window.reticulumResources?.releaseConvertedMedia?.(
                converted.filePath
              );
              return;
            }
            clearPendingReticulumFiles();
            setPendingReticulumFiles([
              {
                filePath: converted.filePath,
                temporaryFilePath: converted.filePath,
                fileName: converted.fileName,
                mimeType: converted.mimeType,
                sizeBytes: converted.sizeBytes,
                isImage: true,
                ...(converted.width ? { width: converted.width } : {}),
                ...(converted.height ? { height: converted.height } : {}),
              },
            ]);
            return;
          }
        } catch (error) {
          console.warn('Reticulum direct GIF conversion failed:', error);
        } finally {
          if (
            reticulumGifConversionSequenceRef.current === conversionSequence
          ) {
            setIsCompressingReticulumGif(false);
          }
        }
      }
      if (isReticulumCompressibleImage(file)) {
        const filePath =
          window.reticulumResources?.getPathForFile?.(file) ||
          (typeof (file as File & { path?: unknown }).path === 'string'
            ? String((file as File & { path?: unknown }).path)
            : '');
        setReticulumImageChoice({ file, filePath });
        return;
      }
      await addPendingReticulumFile(file);
    },
    [
      addPendingReticulumFile,
      clearPendingReticulumFiles,
      isCompressingReticulumGif,
      isCompressingReticulumImage,
      pendingReticulumFiles.length,
      reticulumDirectEnabled,
    ]
  );

  const closeReticulumImageChoice = useCallback(() => {
    if (isCompressingReticulumImage) return;
    setReticulumImageChoice(null);
  }, [isCompressingReticulumImage]);

  const useReticulumCompressedImage = useCallback(async () => {
    const choice = reticulumImageChoice;
    if (!choice || isCompressingReticulumImage) return;
    const preparationSequence = ++reticulumImagePreparationSequenceRef.current;
    const targetPeerAddress = reticulumDirectPeerRef.current;
    setIsCompressingReticulumImage(true);
    try {
      const compressed = await compressReticulumImageFile(choice.file);
      if (
        reticulumImagePreparationSequenceRef.current !== preparationSequence ||
        reticulumDirectPeerRef.current !== targetPeerAddress
      ) {
        return;
      }
      const added = await addPendingReticulumFile(compressed);
      if (added) setReticulumImageChoice(null);
    } finally {
      if (
        reticulumImagePreparationSequenceRef.current === preparationSequence
      ) {
        setIsCompressingReticulumImage(false);
      }
    }
  }, [
    addPendingReticulumFile,
    isCompressingReticulumImage,
    reticulumImageChoice,
  ]);

  const useReticulumImageAsAttachment = useCallback(async () => {
    const choice = reticulumImageChoice;
    if (!choice || isCompressingReticulumImage) return;
    const added = await addPendingReticulumFile(choice.file, {
      asAttachment: true,
      filePathOverride: choice.filePath,
    });
    if (added) setReticulumImageChoice(null);
  }, [
    addPendingReticulumFile,
    isCompressingReticulumImage,
    reticulumImageChoice,
  ]);

  const buildReticulumDirectResourcePayload = useCallback(async () => {
    if (!reticulumDirectEnabled || pendingReticulumFiles.length === 0) {
      return { images: [], attachments: [] };
    }
    if (!myAddress || !selectedDirect?.address) {
      throw new Error(t('group:dm.missing_participants'));
    }
    const conversationId = await reticulumDirectConversationId(
      myAddress,
      selectedDirect.address
    );
    if (!conversationId) throw new Error(t('group:dm.invalid_conversation'));
    const images: Record<string, unknown>[] = [];
    const attachments: Record<string, unknown>[] = [];
    for (const [index, file] of pendingReticulumFiles.entries()) {
      const metadata = {
        feature: 'reticulum-direct-chat',
        conversationId,
        senderAddress: myAddress,
        recipientAddress: selectedDirect.address,
        attachmentKind: file.isImage ? 'image' : 'file',
        originalMimeType: file.mimeType,
        ...(file.width && file.height
          ? { width: file.width, height: file.height }
          : {}),
      };
      const commonPayload = {
        namespace: 'reticulum-dm-resource',
        ownerId: `dm:${conversationId}:${myAddress}`,
        fileName:
          file.fileName ||
          `${file.isImage ? 'direct-image' : 'direct-file'}-${Date.now()}-${index}`,
        mimeType: file.mimeType || 'application/octet-stream',
        encrypted: false,
        metadata,
      };
      const imported = file.filePath
        ? await window.reticulumResources?.importFilePath?.({
            ...commonPayload,
            filePath: file.filePath,
          })
        : await window.reticulumResources?.importBase64?.({
            ...commonPayload,
            base64: file.base64,
          });
      if (!imported?.success || !imported.manifest) {
        throw new Error(
          imported?.error || 'Reticulum direct resource import failed'
        );
      }
      const resource = {
        ...(imported.manifest as Record<string, unknown>),
        ...(file.width && file.height
          ? { width: file.width, height: file.height }
          : {}),
        reticulumResource: true,
        reticulumDirectResource: true,
        conversationId,
        senderAddress: myAddress,
        recipientAddress: selectedDirect.address,
        timestamp: Date.now(),
      };
      if (file.isImage) images.push(resource);
      else attachments.push(resource);
    }
    return { images, attachments };
  }, [
    myAddress,
    pendingReticulumFiles,
    reticulumDirectEnabled,
    selectedDirect?.address,
  ]);

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

  useEffect(() => {
    if (!editorRef?.current) return;
    const handleTypingUpdate = () => {
      if (
        !reticulumDirectEnabled ||
        !reticulumDirectLinkActive ||
        !selectedDirect?.address ||
        isNewChat ||
        !peerOnline
      ) {
        return;
      }
      const htmlContent = String(editorRef?.current?.getHTML?.() || '').trim();
      const hasContent = Boolean(htmlContent && htmlContent !== '<p></p>');
      clearReticulumDirectTypingStopTimer();
      if (!hasContent) {
        if (reticulumDirectTypingActiveRef.current) {
          void sendReticulumDirectTypingState(false, true);
        }
        return;
      }
      if (!reticulumDirectTypingActiveRef.current) {
        void sendReticulumDirectTypingState(true);
      }
      reticulumDirectTypingStopTimerRef.current = setTimeout(() => {
        reticulumDirectTypingStopTimerRef.current = null;
        if (reticulumDirectTypingActiveRef.current) {
          void sendReticulumDirectTypingState(false, true);
        }
      }, RETICULUM_DIRECT_TYPING_STOP_MS);
    };

    editorRef.current.on('update', handleTypingUpdate);
    return () => {
      editorRef?.current?.off('update', handleTypingUpdate);
      clearReticulumDirectTypingStopTimer();
    };
  }, [
    clearReticulumDirectTypingStopTimer,
    isNewChat,
    peerOnline,
    reticulumDirectEnabled,
    reticulumDirectLinkActive,
    selectedDirect?.address,
    sendReticulumDirectTypingState,
    editorRef?.current,
  ]);

  const sendMessage = async () => {
    try {
      if (messageSize > MAX_SIZE_MESSAGE) {
        setMessageSizeLimitShakeKey((key) => key + 1);
        return;
      }
      if (
        reticulumDirectEnabled &&
        (isCompressingReticulumGif || isCompressingReticulumImage)
      )
        return;
      if (reticulumDirectPending || reticulumDirectExpiryLoading) return;
      if (
        shouldBlockChatForLowBalance(
          balance,
          MIN_REQUIRED_QORTS,
          reticulumDirectEnabled
        )
      )
        throw new Error(
          t('group:message.error.qortals_required', {
            quantity: MIN_REQUIRED_QORTS,
            postProcess: 'capitalizeFirstChar',
          })
        );
      if (isSending) return;
      if (editorRef.current) {
        const htmlContent = editorRef.current.getHTML();
        const hasPendingReticulumResources =
          reticulumDirectEnabled && pendingReticulumFiles.length > 0;

        if (
          (!htmlContent?.trim() || htmlContent?.trim() === '<p></p>') &&
          !hasPendingReticulumResources
        )
          return;
        if (reticulumDirectUiEnabled) {
          setFormattingTrayResetKey((key) => key + 1);
        }
        setIsSending(true);
        pauseAllQueues();
        const message = JSON.stringify(htmlContent);

        if (isNewChat) {
          await sendChatDirect(
            {
              messageText: htmlContent,
              ...(reticulumDirectUiEnabled
                ? { expiryDurationMs: reticulumDirectExpiryDurationMs }
                : {}),
            },
            null,
            null,
            true
          );
          return;
        }
        let repliedTo = replyMessage?.signature;

        if (replyMessage?.chatReference) {
          repliedTo = replyMessage?.chatReference;
        }
        const chatReference = onEditMessage?.signature;

        const reticulumResources = hasPendingReticulumResources
          ? await buildReticulumDirectResourcePayload()
          : { images: [], attachments: [] };

        const otherData = {
          ...(onEditMessage?.decryptedData || {}),
          specialId: uid.rnd(),
          repliedTo: onEditMessage ? onEditMessage?.repliedTo : repliedTo,
          type: chatReference ? 'edit' : '',
          ...(reticulumResources.images.length > 0
            ? { images: reticulumResources.images }
            : {}),
          ...(reticulumResources.attachments.length > 0
            ? { attachments: reticulumResources.attachments }
            : {}),
        };
        const sendMessageFunc = async () => {
          return await sendChatDirect(
            {
              chatReference,
              messageText: htmlContent,
              otherData,
              ...(reticulumDirectEnabled && !onEditMessage
                ? { expiryDurationMs: reticulumDirectExpiryDurationMs }
                : {}),
            },
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
        if (reticulumDirectEnabled) {
          await sendMessageFunc();
        } else {
          addToQueue(
            sendMessageFunc,
            messageObj,
            'chat-direct',
            selectedDirect?.address
          );
        }
        setTimeout(() => {
          executeEvent('sent-new-message-group', {});
        }, 150);
        clearReticulumDirectTypingStopTimer();
        if (reticulumDirectTypingActiveRef.current) {
          void sendReticulumDirectTypingState(false, true);
        }
        clearEditorContent();
        clearPendingReticulumFiles();
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
    editorRef.current
      .chain()
      .focus()
      .setContent(normalizeEditContent(message?.text))
      .run();
  }, []);

  return (
    <Box
      style={{
        background: theme.palette.background.default,
        boxSizing: 'border-box',
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: reticulumDirectUiEnabled ? 0 : '10px',
        width: '100%',
      }}
    >
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
        {!reticulumDirectUiEnabled && (
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
        )}
        {isNewChat ? (
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
        ) : (
          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={{
                color: theme.palette.text.primary,
                fontSize: 17,
                fontWeight: 700,
                lineHeight: 1.2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {selectedDirect?.name ||
                selectedDirect?.address ||
                t('group:dm.direct_message')}
            </Typography>
            {!isSelfDirect &&
              selectedDirect?.name &&
              selectedDirect?.address && (
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    fontSize: 11,
                    lineHeight: 1.3,
                    mt: 0.25,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {selectedDirect.address}
                </Typography>
              )}
          </Box>
        )}
        {!isNewChat && selectedDirect?.address && !isSelfDirect && (
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexShrink: 0,
              gap: 1,
              marginLeft: 'auto',
            }}
          >
            {reticulumDirectUiEnabled && reticulumPeerSilence?.active && (
              <Tooltip
                title={t('reticulum:hide_user.unhide', {
                  postProcess: 'capitalizeFirstChar',
                })}
              >
                <span>
                  <IconButton
                    aria-label={t('reticulum:hide_user.unhide', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    disabled={reticulumSilenceBusy}
                    onClick={() => void unsilenceReticulumDirectPeer()}
                    size="small"
                    sx={{
                      color: 'warning.main',
                      '&:hover': { color: 'warning.dark' },
                    }}
                  >
                    {reticulumSilenceBusy ? (
                      <CircularProgress size={18} />
                    ) : (
                      <VisibilityRoundedIcon sx={{ fontSize: 20 }} />
                    )}
                  </IconButton>
                </span>
              </Tooltip>
            )}
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
            {reticulumEnabled && (
              <Tooltip
                title={
                  callMatchesThisDirect && callState === 'connected'
                    ? t('group:support.in_call')
                    : callMatchesThisDirect && callState === 'calling'
                      ? ''
                      : !peerOnline
                        ? t('core:presence.call_offline_tooltip')
                        : directVoiceBlockedByFriend
                          ? t('group:dm.add_friend_before_calling')
                          : directVoiceBlockedByP2p
                            ? p2pHealthBadTooltip
                            : t('group:support.start_voice_call')
                }
              >
                <span>
                  <IconButton
                    size="small"
                    disabled={
                      !(
                        (peerOnline &&
                          !callMatchesThisDirect &&
                          !directVoiceBlockedByFriend &&
                          !directVoiceBlockedByP2p) ||
                        (callMatchesThisDirect && callState === 'connected')
                      )
                    }
                    onClick={
                      callMatchesThisDirect && callState === 'connected'
                        ? hangUp
                        : handleStartDirectVoiceCall
                    }
                    sx={{
                      color:
                        callMatchesThisDirect && callState === 'connected'
                          ? '#ef4444'
                          : 'text.secondary',
                      '&:hover': {
                        color:
                          callMatchesThisDirect && callState === 'connected'
                            ? '#dc2626'
                            : 'text.primary',
                      },
                      '&.Mui-disabled': {
                        color: theme.palette.action.disabled,
                      },
                    }}
                  >
                    {callMatchesThisDirect && callState === 'connected' ? (
                      <CallEndRoundedIcon sx={{ fontSize: 20 }} />
                    ) : (
                      <CallRoundedIcon sx={{ fontSize: 20 }} />
                    )}
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </Box>
        )}
      </Box>

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
                          const hasUnsafeName =
                            typeof opt !== 'string' &&
                            hasInvisibleCharacters(opt.name);
                          const key =
                            typeof opt === 'string' ? opt : opt.address;
                          const initial = (label || '?')
                            .charAt(0)
                            .toUpperCase();
                          return (
                            <ListItem key={key} disablePadding sx={{ px: 1 }}>
                              <ListItemButton
                                onClick={() => {
                                  void handleSelectNameOrAddress(opt);
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
                                    sx: {
                                      fontWeight: 500,
                                      fontSize: '0.9375rem',
                                      ...(hasUnsafeName
                                        ? {
                                            textDecorationLine: 'line-through',
                                            textDecorationThickness: '2px',
                                            textDecorationColor:
                                              theme.palette.error.main,
                                          }
                                        : {}),
                                    },
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

      <Box
        sx={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
          width: '100%',
        }}
      >
        <ChatList
          key={
            reticulumDirectUiEnabled
              ? `reticulum-direct:${selectedDirect?.address || ''}`
              : 'legacy-direct-chat'
          }
          chatReferences={
            reticulumDirectUiEnabled
              ? reticulumDirectChatReferences
              : chatReferences
          }
          handleReaction={handleReaction}
          onEdit={onEdit}
          onDelete={
            reticulumDirectUiEnabled ? handleReticulumDirectDelete : undefined
          }
          onReply={onReply}
          chatId={selectedDirect?.address}
          initialMessages={
            reticulumDirectUiEnabled
              ? reticulumDirectMessagesWithCalls
              : messages
          }
          myAddress={myAddress}
          tempMessages={tempMessages}
          tempChatReferences={tempChatReferences}
          onAcceptQchatFileTransfer={handleAcceptQchatFileTransfer}
          qchatFileTransferStates={qchatFileTransferStates}
          qchatCompletedTransfers={qchatCompletedTransfers}
          reticulumChatEnabled={reticulumDirectUiEnabled}
          reticulumInitialHistoryReady={
            reticulumDirectInitialHistoryReady &&
            reticulumDirectCallHistoryReady
          }
        />
        {reticulumDirectUiEnabled && (
          <Typography
            variant="caption"
            sx={{
              color: 'text.secondary',
              flexShrink: 0,
              fontStyle: 'italic',
              height: '24px',
              lineHeight: '20px',
              overflow: 'hidden',
              px: 2.25,
              pt: '2px',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {reticulumDirectTypingUsers.size > 0
              ? `${selectedDirect?.name || selectedDirect?.address} is typing...`
              : ''}
          </Typography>
        )}
      </Box>

      <Dialog
        open={!reticulumDirectUiEnabled && !!pendingQchatFileOffer}
        onClose={() => setPendingQchatFileOffer(null)}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            backgroundImage: 'none',
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: '8px',
            boxShadow:
              theme.palette.mode === 'dark'
                ? '0 18px 48px rgba(0,0,0,0.48)'
                : '0 18px 48px rgba(15,23,42,0.18)',
            overflow: 'hidden',
          },
        }}
      >
        <DialogTitle
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: 1.25,
            px: 3,
            py: 2,
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              border: '1px solid',
              borderColor: theme.palette.divider,
              borderRadius: '8px',
              color: theme.palette.primary.main,
              display: 'flex',
              height: 36,
              justifyContent: 'center',
              width: 36,
            }}
          >
            <ReticulumFileTransferIcon sx={{ fontSize: 22 }} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={{ fontSize: 16, fontWeight: 700, lineHeight: 1.25 }}
            >
              Send file
            </Typography>
            <Typography
              sx={{ color: theme.palette.text.secondary, fontSize: 12 }}
            >
              Reticulum direct transfer offer
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent
          dividers
          sx={{
            borderColor: theme.palette.divider,
            px: 3,
            py: 2.25,
          }}
        >
          <Box sx={{ display: 'grid', gap: 2 }}>
            <Box
              sx={{
                border: '1px solid',
                borderColor: theme.palette.divider,
                borderRadius: '8px',
                display: 'grid',
                gap: 0.5,
                p: 1.5,
              }}
            >
              <Typography
                sx={{
                  fontSize: 13,
                  fontWeight: 700,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={
                  pendingQchatFileOffer?.name || t('group:dm.selected_file')
                }
              >
                {pendingQchatFileOffer?.name || t('group:dm.selected_file')}
              </Typography>
              <Typography
                sx={{ color: theme.palette.text.secondary, fontSize: 12 }}
              >
                {formatQchatFileSize(pendingQchatFileOffer?.size)}
              </Typography>
            </Box>
            <TextField
              label={t('group:dm.expires_in_hours')}
              type="number"
              value={qchatFileExpiryHours}
              onChange={(event) =>
                setQchatFileExpiryHours(Number(event.target.value))
              }
              inputProps={{ min: 0.05, max: 168, step: 0.25 }}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <Typography
                      sx={{ color: theme.palette.text.secondary, fontSize: 12 }}
                    >
                      hours
                    </Typography>
                  </InputAdornment>
                ),
              }}
              size="small"
              fullWidth
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: '8px',
                },
              }}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ gap: 1, px: 3, py: 2 }}>
          <Button
            onClick={() => setPendingQchatFileOffer(null)}
            sx={{ borderRadius: '8px', px: 2, textTransform: 'none' }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleConfirmQchatFileOffer}
            disabled={isSending}
            sx={{ borderRadius: '8px', px: 2.25, textTransform: 'none' }}
          >
            Send offer
          </Button>
        </DialogActions>
      </Dialog>

      <Box
        sx={{
          alignItems: reticulumDirectUiEnabled ? 'center' : 'flex-end',
          backgroundColor: reticulumDirectUiEnabled
            ? alpha(theme.palette.background.paper, 0.72)
            : theme.palette.background.default,
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: reticulumDirectUiEnabled ? 0 : '8px',
          borderBottom: reticulumDirectUiEnabled ? 'none' : undefined,
          borderLeft: reticulumDirectUiEnabled ? 'none' : undefined,
          borderRight: reticulumDirectUiEnabled ? 'none' : undefined,
          bottom: isFocusedParent ? '0px' : 'unset',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'row',
          flexShrink: 0,
          gap: reticulumDirectUiEnabled ? '8px' : '12px',
          minHeight: reticulumDirectUiEnabled ? '58px' : '150px',
          overflow: reticulumDirectUiEnabled ? 'visible' : 'hidden',
          padding: reticulumDirectUiEnabled ? '8px 12px' : '16px 20px 20px',
          position: isFocusedParent ? 'fixed' : 'relative',
          top: isFocusedParent ? '0px' : 'unset',
          width: '100%',
          zIndex: isFocusedParent ? 5 : 'unset',
        }}
      >
        {reticulumDirectUiEnabled && showDmExpiryNotice && (
          <Box
            role="status"
            sx={{
              alignItems: 'center',
              backgroundColor: alpha(theme.palette.info.main, 0.12),
              border: `1px solid ${alpha(theme.palette.info.main, 0.42)}`,
              borderRadius: '8px 8px 0 0',
              bottom: '100%',
              color: theme.palette.info.main,
              display: 'flex',
              gap: '10px',
              left: '12px',
              minHeight: 38,
              padding: '7px 8px 7px 12px',
              position: 'absolute',
              right: '12px',
              zIndex: 4,
            }}
          >
            <Typography sx={{ color: 'inherit', flex: 1, fontSize: 12.5 }}>
              <strong>{t('group:dm.expiry_notice')}</strong> to reduce local
              storage use. You can change this setting, but only for new
              messages. Existing messages will keep their current expiry period.
            </Typography>
            <IconButton
              aria-label={t('group:dm.dismiss_expiry_notice')}
              onClick={dismissDmExpiryNotice}
              size="small"
              sx={{ color: 'inherit', flexShrink: 0 }}
            >
              <ExitIcon />
            </IconButton>
          </Box>
        )}
        {reticulumDirectUiEnabled && (
          <MessageSizeLimitLip
            floating
            maximum={MAX_SIZE_MESSAGE}
            shakeKey={messageSizeLimitShakeKey}
            size={messageSize}
          />
        )}
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            flexShrink: 0,
            justifyContent: reticulumDirectUiEnabled ? 'center' : 'flex-end',
            minWidth: 0,
            overflow: reticulumDirectUiEnabled ? 'visible' : 'auto',
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
              <ReplyPreview
                message={replyMessage}
                reticulumOnlyContent={reticulumDirectUiEnabled}
              />

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
              <ReplyPreview
                isEdit
                message={onEditMessage}
                reticulumOnlyContent={reticulumDirectUiEnabled}
              />

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

          <SpellCheckContextMenu editorRef={editorRef}>
            <Tiptap
              isFocusedParent={isFocusedParent}
              setEditorRef={setEditorRef}
              onEnter={sendMessage}
              isChat
              disableEnter={false}
              setIsFocusedParent={setIsFocusedParent}
              insertFiles={insertFiles}
              compactChat={reticulumDirectUiEnabled}
              collapseFormattingTraySignal={formattingTrayResetKey}
              placeholder={
                reticulumDirectUiEnabled
                  ? t('group:dm.send_placeholder')
                  : undefined
              }
            />
          </SpellCheckContextMenu>
          {isCompressingReticulumGif && <ReticulumGifCompressionStatus />}
          {pendingReticulumFiles.length > 0 && (
            <Box
              sx={{
                alignItems: 'center',
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: '8px',
                display: 'flex',
                gap: '10px',
                maxWidth: '100%',
                padding: '8px 10px',
                width: 'fit-content',
              }}
            >
              {pendingReticulumFiles[0].previewUrl ? (
                <Box
                  component="img"
                  src={pendingReticulumFiles[0].previewUrl}
                  sx={{
                    borderRadius: '6px',
                    height: 38,
                    objectFit: 'cover',
                    width: 38,
                  }}
                />
              ) : (
                <ReticulumFileTransferIcon sx={{ fontSize: 26 }} />
              )}
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  sx={{
                    fontSize: 13,
                    fontWeight: 600,
                    maxWidth: 260,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {pendingReticulumFiles[0].fileName}
                </Typography>
                <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>
                  {formatQchatFileSize(pendingReticulumFiles[0].sizeBytes)}
                </Typography>
              </Box>
              <IconButton size="small" onClick={clearPendingReticulumFiles}>
                <ExitIcon />
              </IconButton>
            </Box>
          )}
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
            paddingBottom: reticulumDirectUiEnabled ? 0 : '2px',
          }}
        >
          {!reticulumDirectUiEnabled && (
            <Tooltip title={t('group:dm.transfer_file_reticulum')}>
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
                  <ReticulumFileTransferIcon sx={{ fontSize: 22 }} />
                </IconButton>
              </span>
            </Tooltip>
          )}
          {reticulumDirectUiEnabled && (
            <ReactionPicker
              compactComposer
              neutralIcon
              onReaction={(emoji) =>
                editorRef.current?.chain().focus().insertContent(emoji).run()
              }
            />
          )}
          <Box
            sx={{
              alignItems: 'stretch',
              border: reticulumDirectUiEnabled ? '1px solid' : 'none',
              borderColor: 'divider',
              borderRadius: reticulumDirectUiEnabled ? '10px' : 0,
              display: 'flex',
              height: reticulumDirectUiEnabled ? 38 : 'auto',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {reticulumDirectUiEnabled && (
              <>
                <ReticulumMessageExpiryButton
                  direct
                  segmented
                  disabled={
                    Boolean(onEditMessage) ||
                    reticulumDirectPending ||
                    reticulumDirectExpiryLoading
                  }
                  disabledReason={
                    onEditMessage
                      ? t('group:dm.expiry_locked_editing')
                      : t('group:dm.expiry_unavailable_loading')
                  }
                  onChange={changeReticulumDirectExpiry}
                  value={reticulumDirectExpiryDurationMs}
                />
                <Box
                  aria-hidden
                  sx={{
                    alignSelf: 'center',
                    backgroundColor: 'divider',
                    height: 20,
                    width: '1px',
                  }}
                />
              </>
            )}
            <CustomButton
              onClick={() => {
                if (
                  isSending ||
                  isCompressingReticulumGif ||
                  isCompressingReticulumImage ||
                  reticulumDirectPending ||
                  reticulumDirectExpiryLoading
                )
                  return;
                sendMessage();
              }}
              sx={{
                alignItems: 'center',
                backgroundColor:
                  isSending ||
                  isCompressingReticulumGif ||
                  isCompressingReticulumImage
                    ? theme.palette.action.disabledBackground
                    : reticulumDirectUiEnabled
                      ? RETICULUM_ACTIVE_BLUE
                      : theme.palette.background.paper,
                border: reticulumDirectUiEnabled ? 'none' : '1px solid',
                borderColor: reticulumDirectUiEnabled
                  ? RETICULUM_ACTIVE_BLUE
                  : theme.palette.divider,
                borderRadius: reticulumDirectUiEnabled ? 0 : '8px',
                color: reticulumDirectUiEnabled
                  ? theme.palette.common.white
                  : theme.palette.text.primary,
                cursor:
                  isSending ||
                  isCompressingReticulumGif ||
                  isCompressingReticulumImage ||
                  reticulumDirectPending ||
                  reticulumDirectExpiryLoading
                    ? 'default'
                    : 'pointer',
                display: 'inline-flex',
                gap: '6px',
                fontSize: '14px',
                fontWeight: 500,
                justifyContent: 'center',
                minHeight: reticulumDirectUiEnabled ? '38px' : '44px',
                minWidth: reticulumDirectUiEnabled ? '74px' : '88px',
                padding: reticulumDirectUiEnabled ? '8px 14px' : '10px 16px',
                position: 'relative',
                transition:
                  'background-color 0.2s ease, border-color 0.2s ease',
                '&:hover':
                  isSending ||
                  isCompressingReticulumGif ||
                  isCompressingReticulumImage ||
                  reticulumDirectPending ||
                  reticulumDirectExpiryLoading
                    ? {}
                    : {
                        backgroundColor: reticulumDirectUiEnabled
                          ? '#1e40af'
                          : theme.palette.action.hover,
                        borderColor: reticulumDirectUiEnabled
                          ? '#1e40af'
                          : theme.palette.divider,
                      },
                '& .MuiSvgIcon-root': {
                  color: reticulumDirectUiEnabled
                    ? theme.palette.common.white
                    : 'inherit',
                },
              }}
            >
              {isSending ||
              isCompressingReticulumGif ||
              isCompressingReticulumImage ? (
                <CircularProgress
                  size={18}
                  sx={{
                    color: reticulumDirectUiEnabled
                      ? theme.palette.common.white
                      : theme.palette.text.secondary,
                  }}
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
      </Box>

      <ReticulumLargeImageDialog
        open={Boolean(reticulumImageChoice)}
        onClose={closeReticulumImageChoice}
        fileSize={formatQchatFileSize(reticulumImageChoice?.file.size)}
        loading={isCompressingReticulumImage}
        onCompress={useReticulumCompressedImage}
        onUseAsAttachment={useReticulumImageAsAttachment}
      />

      <LoadingSnackbar
        open={!reticulumDirectUiEnabled && isLoading}
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
