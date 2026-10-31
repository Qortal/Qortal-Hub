import {
  memo,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useInView } from 'react-intersection-observer';
import {
  MessageDisplay,
  type ReticulumChannelLinkAccess,
} from './MessageDisplay';
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
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Popper,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { formatTimestamp } from '../../utils/time';
import { QORTAL_APP_CONTEXT, getBaseApiReact } from '../../App';
import { generateHTML } from '@tiptap/react';
import Highlight from '@tiptap/extension-highlight';
import Mention from '@tiptap/extension-mention';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { WrapperUserAction } from '../WrapperUserAction';
import ReplyIcon from '@mui/icons-material/Reply';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import { ReactionPicker } from '../ReactionPicker';
import KeyOffIcon from '@mui/icons-material/KeyOff';
import EditIcon from '@mui/icons-material/Edit';
import { canEditOwnReticulumMessage } from './reticulumMessagePermissions';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded';
import CancelRoundedIcon from '@mui/icons-material/CancelRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import TextStyle from '@tiptap/extension-text-style';
import messageExpiresIcon from '../../assets/Icons/message-expires-icon.png';
import noExpiryIcon from '../../assets/Icons/no-expiry-icon.png';
import level0Img from '../../assets/badges/level-0.png';
import level1Img from '../../assets/badges/level-1.png';
import level2Img from '../../assets/badges/level-2.png';
import level3Img from '../../assets/badges/level-3.png';
import level4Img from '../../assets/badges/level-4.png';
import level5Img from '../../assets/badges/level-5.png';
import level6Img from '../../assets/badges/level-6.png';
import level7Img from '../../assets/badges/level-7.png';
import level8Img from '../../assets/badges/level-8.png';
import level9Img from '../../assets/badges/level-9.png';
import level10Img from '../../assets/badges/level-10.png';
import { Embed } from '../Embeds/Embed';
import CommentsDisabledIcon from '@mui/icons-material/CommentsDisabled';
import {
  buildImageEmbedLink,
  isHtmlString,
  messageHasImage,
} from '../../utils/chat';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n/i18n';
import { ReactionsMap } from './ChatList';
import { AvatarPreviewModal } from '../Chat/AvatarPreviewModal';
import { useStatus } from '../../hooks/usePresence';
import {
  getClickableAvatarSx,
  getFallbackAvatarOutlineSx,
} from './clickableAvatarStyles';
import { PresenceStatusBadge } from '../common/PresenceStatusBadge';
import { hasInvisibleCharacters } from '../../utils/hasInvisibleCharacters';
import { MinterAvatarOrnament } from './MinterAvatarOrnament';
import { ReticulumImageViewer } from './ReticulumImageViewer';
import { ReticulumGroupInvitePreviews } from './ReticulumGroupInvitePreview';
import {
  parseReticulumQAppLinks,
  ReticulumQAppLinkPreviews,
} from './ReticulumQAppLinkPreview';
import {
  parseReticulumEventLinks,
  ReticulumEventLinkPreviews,
} from './ReticulumEventLinkPreview';
import { CustomStyledMenu } from '../ContextMenu';
import FormatQuoteRoundedIcon from '@mui/icons-material/FormatQuoteRounded';
import { ReticulumRoleBadge } from './ReticulumRoleBadge';
import { createReticulumImageRequestGate } from './reticulumImageRequestGate';
import { useAtomValue } from 'jotai';
import { reticulumHighlightOwnMessagesAtom } from '../../atoms/global';

const QCHAT_FILE_TRANSFER_TTL_MS = 2 * 60 * 60 * 1000;
const RETICULUM_FILE_UNAVAILABLE_TIMEOUT_MS = 12_000;
const RETICULUM_EXPIRING_SOON_MS = 15 * 60 * 60 * 1000;
const RETICULUM_INLINE_IMAGE_THRESHOLD_BYTES = 1_000_000;
const RETICULUM_IMAGE_REQUEST_BACKOFF_MS = 30_000;
const RETICULUM_IMAGE_UNAVAILABLE_TIMEOUT_MS = 12_000;
const RETICULUM_IMAGE_AVAILABILITY_RECHECK_MS = 15_000;
const RETICULUM_IMAGE_REQUEST_TRACK_LIMIT = 500;
const RETICULUM_INLINE_IMAGE_MAX_WIDTH = 640;
const RETICULUM_INLINE_IMAGE_MAX_HEIGHT = 360;
const RETICULUM_INLINE_IMAGE_FALLBACK_WIDTH = 480;
const RETICULUM_INLINE_IMAGE_FALLBACK_ASPECT_RATIO = '4 / 3';

const normalizeReticulumExpiryMs = (value: unknown): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
};

const formatReticulumExpiry = (value: number | null): string => {
  if (!value)
    return i18n.t('reticulum:expiry.no_expiry', {
      postProcess: 'capitalizeEachFirstChar',
    });
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    return i18n.t('reticulum:expiry.no_expiry', {
      postProcess: 'capitalizeEachFirstChar',
    });
  const pad = (part: number) => String(part).padStart(2, '0');
  const monthAndDay = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  return `${monthAndDay} | ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const RETICULUM_QUICK_REACTIONS = ['👍', '💯', '😂', '❤️'] as const;

const reticulumImageRequestGate = createReticulumImageRequestGate(
  RETICULUM_IMAGE_REQUEST_BACKOFF_MS,
  RETICULUM_IMAGE_REQUEST_TRACK_LIMIT
);
const reticulumMintershipCache = new Map<string, boolean>();
const reticulumMintershipRequests = new Map<string, Promise<boolean>>();

function getReticulumInlineImageDisplaySize(
  width: number | null,
  height: number | null
): { width: number; height: number; aspectRatio: string } {
  if (!width || !height) {
    return {
      width: RETICULUM_INLINE_IMAGE_FALLBACK_WIDTH,
      height: Math.round(RETICULUM_INLINE_IMAGE_FALLBACK_WIDTH * 0.75),
      aspectRatio: RETICULUM_INLINE_IMAGE_FALLBACK_ASPECT_RATIO,
    };
  }

  const scale = Math.min(
    1,
    RETICULUM_INLINE_IMAGE_MAX_WIDTH / width,
    RETICULUM_INLINE_IMAGE_MAX_HEIGHT / height
  );
  const displayWidth = Math.max(1, Math.round(width * scale));
  const displayHeight = Math.max(1, Math.round(height * scale));
  return {
    width: displayWidth,
    height: displayHeight,
    aspectRatio: `${displayWidth} / ${displayHeight}`,
  };
}

const getReticulumMintership = (address: string): Promise<boolean> => {
  const normalizedAddress = address.trim();
  if (!normalizedAddress) return Promise.resolve(false);

  const cachedResult = reticulumMintershipCache.get(normalizedAddress);
  if (cachedResult !== undefined) return Promise.resolve(cachedResult);

  const existingRequest = reticulumMintershipRequests.get(normalizedAddress);
  if (existingRequest) return existingRequest;

  const request = fetch(
    `${getBaseApiReact()}/groups/member/${encodeURIComponent(normalizedAddress)}`
  )
    .then(async (response) => {
      if (!response.ok) return false;
      const data = await response.json();
      const groups = Array.isArray(data) ? data : (data?.groups ?? []);
      return groups.some(
        (group) =>
          String(group?.groupName ?? '')
            .trim()
            .toUpperCase() === 'MINTER'
      );
    })
    .catch(() => false)
    .then((isMinter) => {
      reticulumMintershipCache.set(normalizedAddress, isMinter);
      return isMinter;
    })
    .finally(() => {
      reticulumMintershipRequests.delete(normalizedAddress);
    });

  reticulumMintershipRequests.set(normalizedAddress, request);
  return request;
};

const normalizeMessageHtmlContent = (raw: unknown): string | null => {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof raw === 'object') {
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
      return null;
    }
  }
  return null;
};

const formatQchatFileSize = (bytes?: number) => {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return '0 bytes';
  if (size < 1024) return `${size} ${size === 1 ? 'byte' : 'bytes'}`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.ceil(size / 1024))} KB`;
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const formatQchatFileSpeed = (bytesPerSecond?: number) => {
  const speed = Number(bytesPerSecond || 0);
  if (!Number.isFinite(speed) || speed <= 0) return '';
  return `${formatQchatFileSize(speed)}/s`;
};

const getBadgeImg = (level) => {
  switch (level?.toString()) {
    case '0':
      return level0Img;
    case '1':
      return level1Img;
    case '2':
      return level2Img;
    case '3':
      return level3Img;
    case '4':
      return level4Img;
    case '5':
      return level5Img;
    case '6':
      return level6Img;
    case '7':
      return level7Img;
    case '8':
      return level8Img;
    case '9':
      return level9Img;
    case '10':
      return level10Img;
    default:
      return level0Img;
  }
};

const UserBadge = memo(({ userInfo }) => {
  return (
    <Tooltip disableFocusListener title={`level ${userInfo ?? 0}`}>
      <img
        style={{
          visibility: userInfo !== undefined ? 'visible' : 'hidden',
          width: '30px',
          height: 'auto',
        }}
        src={getBadgeImg(userInfo)}
      />
    </Tooltip>
  );
});

const getQchatFileTransfer = (message: any) => {
  if (message?.decryptedData?.type === 'qchat-dm-file-transfer') {
    return {
      ...(message.decryptedData || {}),
      data: message.decryptedData.data || {},
    };
  }
  if (message?.decryptedData?.data?.type === 'qchat-dm-file-transfer') {
    return {
      ...(message.decryptedData.data || {}),
      data: message.decryptedData.data.data || {},
    };
  }
  if (message?.type === 'qchat-dm-file-transfer') {
    return {
      ...message,
      data: message.data || {},
    };
  }
  return null;
};

type MessageItemProps = {
  handleReaction: (reaction: string, messageId: string) => void;
  isLast: boolean;
  isGroupedWithPrevious?: boolean;
  isPrivate: boolean;
  isScrollTarget?: boolean;
  isShowingAsReply?: boolean;
  isTemp: boolean;
  isUpdating: boolean;
  lastSignature: string;
  message: string;
  myAddress: string;
  onEdit: (messageId: string) => void;
  onDelete?: (message: any) => void;
  onReply: (messageId: string) => void;
  onAcceptQchatFileTransfer?: (message: any) => void;
  qchatFileTransferStates?: Record<string, any>;
  qchatCompletedTransfers?: Record<string, any>;
  selectedGroup?: any;
  secretKeyObject?: any;
  onSeen: () => void;
  reactions: ReactionsMap | null;
  reply: string | null;
  replyIndex: number;
  replyExpiredMeta?: any;
  reticulumChatEnabled?: boolean;
  reticulumDiscussionReplyCount?: number;
  onOpenReticulumDiscussion?: (message: any) => void;
  reticulumDiscussionRootId?: string;
  reticulumDiscussionView?: boolean;
  reticulumGroupAvatarOwnerName?: string;
  reticulumGroupDisplayName?: string;
  reticulumMentionUsers?: Record<
    string,
    { address: string; name?: string; role?: 'admin' | 'owner' }
  >;
  reticulumChannelLinkAccess?: ReticulumChannelLinkAccess;
  reticulumMemberJoinedByAddress?: Record<string, number>;
  reticulumMemberRolesByAddress?: Record<string, 'owner' | 'admin'>;
  reticulumMemberRolesReady?: boolean;
  scrollToItem: (index: number) => void;
};

export const MessageItemComponent = ({
  handleReaction,
  isLast,
  isGroupedWithPrevious = false,
  isPrivate,
  isScrollTarget,
  isShowingAsReply,
  isTemp,
  isUpdating,
  lastSignature,
  message,
  myAddress,
  onEdit,
  onDelete,
  onReply,
  onAcceptQchatFileTransfer,
  qchatFileTransferStates,
  qchatCompletedTransfers,
  selectedGroup,
  secretKeyObject,
  onSeen,
  reactions,
  reply,
  replyIndex,
  replyExpiredMeta,
  reticulumChatEnabled = false,
  reticulumDiscussionReplyCount = 0,
  onOpenReticulumDiscussion,
  reticulumDiscussionRootId,
  reticulumDiscussionView = false,
  reticulumGroupAvatarOwnerName,
  reticulumGroupDisplayName,
  reticulumMentionUsers,
  reticulumChannelLinkAccess,
  reticulumMemberJoinedByAddress,
  reticulumMemberRolesByAddress,
  reticulumMemberRolesReady = true,
  scrollToItem,
}: MessageItemProps) => {
  const { getIndividualUserInfo } = useContext(QORTAL_APP_CONTEXT);
  const highlightOwnReticulumMessages = useAtomValue(
    reticulumHighlightOwnMessagesAtom
  );
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [selectedReaction, setSelectedReaction] = useState<string | null>(null);
  const [userInfo, setUserInfo] = useState(null);
  const [isUserInfoResolved, setIsUserInfoResolved] = useState(false);
  const [isReticulumMinter, setIsReticulumMinter] = useState(false);
  const [isReticulumMinterResolved, setIsReticulumMinterResolved] =
    useState(false);
  const [isAvatarPreviewOpen, setIsAvatarPreviewOpen] = useState(false);
  const [avatarPreviewSrc, setAvatarPreviewSrc] = useState(null);
  const [isAvatarLoaded, setIsAvatarLoaded] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [expiryClockMs, setExpiryClockMs] = useState(Date.now());
  const [reticulumMessageMenuPosition, setReticulumMessageMenuPosition] =
    useState<{ mouseX: number; mouseY: number } | null>(null);
  const signedGroupWelcomeSystem =
    message?.qchatSystem?.type === 'group-welcome'
      ? message.qchatSystem
      : message?.decryptedData?.qchatSystem?.type === 'group-welcome'
        ? message.decryptedData.qchatSystem
        : null;
  const signedWelcomeJoinedAt = Number(signedGroupWelcomeSystem?.joinedAt);
  const recordedWelcomeJoinedAt = Number(
    reticulumMemberJoinedByAddress?.[message?.sender]
  );
  const groupWelcomeSystem =
    reticulumChatEnabled &&
    reticulumMemberRolesReady &&
    signedGroupWelcomeSystem?.joinedAddress === message?.sender &&
    Number(signedGroupWelcomeSystem?.groupId) === Number(message?.groupId) &&
    Number.isFinite(signedWelcomeJoinedAt) &&
    signedWelcomeJoinedAt > 0 &&
    signedWelcomeJoinedAt === recordedWelcomeJoinedAt
      ? signedGroupWelcomeSystem
      : null;
  const shouldSuppressUnvalidatedGroupWelcome =
    reticulumChatEnabled &&
    Boolean(signedGroupWelcomeSystem) &&
    (!reticulumMemberRolesReady || !groupWelcomeSystem);
  const isOfficialGroupWelcome = Boolean(
    reticulumChatEnabled && groupWelcomeSystem
  );
  const calendarSystem =
    reticulumChatEnabled &&
    message?.syntheticReticulumCalendarSystem === true &&
    typeof message?.qchatSystem?.type === 'string' &&
    message.qchatSystem.type.startsWith('calendar-event-') &&
    Number(message.qchatSystem.groupId) === Number(message?.groupId)
      ? message.qchatSystem
      : null;
  const officialGroupSystem = groupWelcomeSystem || calendarSystem;
  const isOfficialGroupSystem = Boolean(
    isOfficialGroupWelcome || calendarSystem
  );
  const displaySenderName = isOfficialGroupSystem
    ? reticulumGroupDisplayName || officialGroupSystem?.groupName || 'Group'
    : message?.senderName || message?.sender;

  useEffect(() => {
    const getInfo = async () => {
      if (isOfficialGroupSystem) {
        setUserInfo(null);
        setIsUserInfoResolved(true);
        return;
      }
      if (!message?.sender) {
        setIsUserInfoResolved(true);
        return;
      }
      setIsUserInfoResolved(false);
      try {
        const res = await getIndividualUserInfo(message?.sender);
        if (!res && !(reticulumChatEnabled && res === 0)) return null;
        setUserInfo(res);
      } catch (error) {
        //
      } finally {
        setIsUserInfoResolved(true);
      }
    };

    getInfo();
  }, [
    getIndividualUserInfo,
    isOfficialGroupSystem,
    message?.sender,
    reticulumChatEnabled,
  ]);

  useEffect(() => {
    let cancelled = false;
    const senderAddress = message?.sender;

    if (!reticulumChatEnabled || !senderAddress || isOfficialGroupSystem) {
      setIsReticulumMinter(false);
      setIsReticulumMinterResolved(isOfficialGroupSystem);
      return () => {
        cancelled = true;
      };
    }

    setIsReticulumMinter(false);
    setIsReticulumMinterResolved(false);
    void getReticulumMintership(senderAddress).then((isMinter) => {
      if (!cancelled) {
        setIsReticulumMinter(isMinter);
        setIsReticulumMinterResolved(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isOfficialGroupSystem, message?.sender, reticulumChatEnabled]);

  // Defer only main message body so generateHTML runs when React has time (reduces scroll-time CPU spikes).
  // Reply block uses reply/replyExpiredMeta directly so the reply preview always shows.
  const deferredMessage = useDeferredValue(message);

  const htmlText = useMemo(() => {
    const source = deferredMessage?.messageText;
    if (source) {
      const isHtml = isHtmlString(source);
      if (isHtml) return source;
      return normalizeMessageHtmlContent(source);
    }
  }, [deferredMessage?.messageText, deferredMessage?.editTimestamp]);

  const reticulumInviteSource = useMemo(() => {
    const candidates = reticulumChatEnabled
      ? [
          deferredMessage?.messageText,
          deferredMessage?.text,
          message?.decryptedData?.data?.message,
        ]
      : [
          deferredMessage?.text,
          message?.decryptedData?.data?.message,
          deferredMessage?.messageText,
        ];
    for (const candidate of candidates) {
      const normalized = normalizeMessageHtmlContent(candidate);
      if (normalized) return normalized;
    }
    return '';
  }, [
    deferredMessage?.messageText,
    deferredMessage?.text,
    message?.decryptedData?.data?.message,
    reticulumChatEnabled,
  ]);
  const reticulumQAppPreviewLinks = useMemo(
    () =>
      reticulumChatEnabled
        ? parseReticulumQAppLinks(reticulumInviteSource).map(
            (previewLink) => previewLink.link
          )
        : [],
    [reticulumChatEnabled, reticulumInviteSource]
  );
  const reticulumEventPreviewLinks = useMemo(
    () =>
      parseReticulumEventLinks(deferredMessage).map(
        (previewLink) => previewLink.link
      ),
    [deferredMessage]
  );
  const reticulumHiddenPreviewLinks = useMemo(
    () => [...reticulumQAppPreviewLinks, ...reticulumEventPreviewLinks],
    [reticulumEventPreviewLinks, reticulumQAppPreviewLinks]
  );

  const htmlReply = useMemo(() => {
    const source = reply?.messageText;
    if (source) {
      const isHtml = isHtmlString(source);
      if (isHtml) return source;
      return normalizeMessageHtmlContent(source);
    }
  }, [reply?.messageText, reply?.editTimestamp]);

  const htmlReplyExpired = useMemo(() => {
    if (!replyExpiredMeta) return null;
    const source = replyExpiredMeta?.messageText;
    if (source) {
      const isHtml = isHtmlString(source);
      if (isHtml) return source;
      return normalizeMessageHtmlContent(source);
    }
    return null;
  }, [replyExpiredMeta?.messageText, replyExpiredMeta?.editTimestamp]);

  const userAvatarUrl = useMemo(() => {
    if (
      isOfficialGroupSystem &&
      (reticulumGroupAvatarOwnerName ||
        officialGroupSystem?.groupAvatarOwnerName) &&
      officialGroupSystem?.groupId
    ) {
      return `${getBaseApiReact()}/arbitrary/THUMBNAIL/${encodeURIComponent(
        reticulumGroupAvatarOwnerName ||
          officialGroupSystem.groupAvatarOwnerName
      )}/qortal_group_avatar_${officialGroupSystem.groupId}?async=true`;
    }
    return message?.senderName
      ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${
          message?.senderName
        }/qortal_avatar?async=true`
      : '';
  }, [
    isOfficialGroupSystem,
    message?.senderName,
    officialGroupSystem?.groupAvatarOwnerName,
    officialGroupSystem?.groupId,
    reticulumGroupAvatarOwnerName,
  ]);

  useEffect(() => {
    setIsAvatarLoaded(false);
  }, [userAvatarUrl]);

  const handleAvatarPreview = useCallback(
    (event, src = userAvatarUrl, requireLoaded = true) => {
      if (!src || (requireLoaded && !isAvatarLoaded)) return;
      event.preventDefault();
      event.stopPropagation();
      setAvatarPreviewSrc(src);
      setIsAvatarPreviewOpen(true);
    },
    [isAvatarLoaded, setAvatarPreviewSrc, setIsAvatarPreviewOpen, userAvatarUrl]
  );

  const closeAvatarPreview = useCallback(() => {
    setIsAvatarPreviewOpen(false);
    setAvatarPreviewSrc(null);
  }, [setIsAvatarPreviewOpen, setAvatarPreviewSrc]);

  const onSeenFunc = useCallback(() => {
    onSeen(message.id);
  }, [message?.id]);

  const theme = useTheme();
  const reticulumMemberRole = reticulumChatEnabled
    ? reticulumMemberRolesByAddress?.[message?.sender]
    : undefined;
  const reticulumMemberRoleColor =
    reticulumMemberRole === 'owner'
      ? theme.palette.mode === 'dark'
        ? '#ffb454'
        : '#a84a00'
      : reticulumMemberRole === 'admin'
        ? theme.palette.mode === 'dark'
          ? '#58a6ff'
          : '#1d4ed8'
        : theme.palette.mode === 'dark'
          ? '#f2f2f4'
          : '#1b1d24';
  const reticulumMinterLevel =
    reticulumChatEnabled &&
    isReticulumMinter &&
    typeof userInfo === 'number' &&
    Number.isFinite(userInfo) &&
    userInfo >= 0
      ? Math.trunc(userInfo)
      : null;
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'reticulum',
  ]);
  const hasUnsafeSenderName = Boolean(
    message?.senderName && hasInvisibleCharacters(message.senderName)
  );
  const hasUnsafeReplyName = Boolean(
    reply?.senderName && hasInvisibleCharacters(reply.senderName)
  );
  const hasUnsafeExpiredReplyName = Boolean(
    replyExpiredMeta?.senderName &&
    hasInvisibleCharacters(replyExpiredMeta.senderName)
  );

  const qchatFileTransfer = getQchatFileTransfer(message);
  const isReticulumMessageWithResources =
    message?.reticulumChat === true || message?.reticulumDirect === true;
  const isReticulumDirectResourceMessage = message?.reticulumDirect === true;
  const reticulumDirectPeerAddress = isReticulumDirectResourceMessage
    ? message?.sender === myAddress
      ? typeof message?.recipientAddress === 'string'
        ? message.recipientAddress
        : ''
      : typeof message?.sender === 'string'
        ? message.sender
        : ''
    : '';
  const isReticulumResourceImage =
    isReticulumMessageWithResources &&
    message?.images?.[0]?.reticulumResource === true &&
    typeof message?.images?.[0]?.fileHash === 'string';
  const imageResourceId = isReticulumResourceImage
    ? message.images[0].fileHash
    : '';
  const imageResourceManifest =
    isReticulumResourceImage &&
    message?.images?.[0] &&
    typeof message.images[0] === 'object'
      ? message.images[0]
      : null;
  const imageResourceManifestRef = useRef(imageResourceManifest);
  imageResourceManifestRef.current = imageResourceManifest;
  const imageResourceFileHash =
    typeof imageResourceManifest?.fileHash === 'string'
      ? imageResourceManifest.fileHash
      : '';
  const imageResourceSize =
    typeof imageResourceManifest?.sizeBytes === 'number'
      ? imageResourceManifest.sizeBytes
      : 0;
  const shouldAutoDownloadReticulumImage =
    isReticulumResourceImage &&
    (!imageResourceSize ||
      imageResourceSize < RETICULUM_INLINE_IMAGE_THRESHOLD_BYTES);
  const largeReticulumImageAttachment =
    isReticulumResourceImage && !shouldAutoDownloadReticulumImage
      ? imageResourceManifest
      : null;
  const imageResourceMetadataWidth = (() => {
    const direct = Number(imageResourceManifest?.width);
    const metadata = Number(
      (imageResourceManifest?.metadata as Record<string, unknown> | undefined)
        ?.width
    );
    const value = Number.isFinite(direct) && direct > 0 ? direct : metadata;
    return Number.isFinite(value) && value > 0 ? value : null;
  })();
  const imageResourceMetadataHeight = (() => {
    const direct = Number(imageResourceManifest?.height);
    const metadata = Number(
      (imageResourceManifest?.metadata as Record<string, unknown> | undefined)
        ?.height
    );
    const value = Number.isFinite(direct) && direct > 0 ? direct : metadata;
    return Number.isFinite(value) && value > 0 ? value : null;
  })();
  const [loadedResourceImageSize, setLoadedResourceImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const imageResourceWidth =
    loadedResourceImageSize?.width ?? imageResourceMetadataWidth;
  const imageResourceHeight =
    loadedResourceImageSize?.height ?? imageResourceMetadataHeight;
  const imageResourceDisplaySize = getReticulumInlineImageDisplaySize(
    imageResourceWidth,
    imageResourceHeight
  );
  const imageResourceAspectRatio = imageResourceDisplaySize.aspectRatio;
  const imageResourceDisplayWidth = imageResourceDisplaySize.width;
  const reticulumFileAttachment =
    isReticulumMessageWithResources && Array.isArray(message?.attachments)
      ? message.attachments.find(
          (attachment) =>
            attachment &&
            typeof attachment === 'object' &&
            attachment.reticulumResource === true &&
            typeof attachment.fileHash === 'string'
        )
      : null;
  const reticulumDownloadAttachment =
    reticulumFileAttachment || largeReticulumImageAttachment;
  const reticulumFileResourceId =
    typeof reticulumDownloadAttachment?.fileHash === 'string'
      ? reticulumDownloadAttachment.fileHash
      : '';
  const reticulumFileName =
    typeof reticulumDownloadAttachment?.fileName === 'string' &&
    reticulumDownloadAttachment.fileName.trim()
      ? reticulumDownloadAttachment.fileName.trim()
      : largeReticulumImageAttachment
        ? t('group:message_item.image_attachment')
        : t('group:message_item.file_attachment');
  const reticulumFileSize =
    typeof reticulumDownloadAttachment?.sizeBytes === 'number'
      ? reticulumDownloadAttachment.sizeBytes
      : 0;
  const reticulumResourceGroupId = Number(
    message?.groupId ??
      message?.decryptedData?.groupId ??
      selectedGroup?.groupId ??
      selectedGroup?.id ??
      0
  );
  const reticulumSilenceContext = useMemo(() => {
    if (!reticulumChatEnabled || !myAddress) {
      return undefined;
    }
    if (message?.reticulumDirect === true) {
      if (myAddress === message?.sender) return undefined;
      return {
        ownerAddress: myAddress,
        scopeType: 'dm' as const,
      };
    }
    if (!reticulumMemberRolesReady) {
      return undefined;
    }
    const groupId = Number(
      message?.groupId ??
        selectedGroup?.groupId ??
        selectedGroup?.id ??
        selectedGroup
    );
    if (!Number.isInteger(groupId) || groupId <= 0) return undefined;
    if (myAddress === message?.sender && reticulumMemberRole !== 'owner') {
      return undefined;
    }
    return {
      disabled: reticulumMemberRole === 'owner',
      ownerAddress: myAddress,
      scopeType: 'group' as const,
      groupId,
    };
  }, [
    message?.groupId,
    message?.reticulumDirect,
    message?.sender,
    myAddress,
    reticulumChatEnabled,
    reticulumMemberRole,
    reticulumMemberRolesReady,
    selectedGroup,
  ]);
  const reticulumResourceEventId =
    typeof message?.signature === 'string'
      ? message.signature
      : typeof message?.tempSignature === 'string'
        ? message.tempSignature
        : '';
  const imageEmbedLink = messageHasImage(message)
    ? buildImageEmbedLink(message.images[0])
    : null;
  const [localResourceImageUrl, setLocalResourceImageUrl] = useState<
    string | null
  >(null);
  const [isReticulumImageViewerOpen, setIsReticulumImageViewerOpen] =
    useState(false);
  const [reticulumImageViewerSrc, setReticulumImageViewerSrc] = useState<
    string | null
  >(null);
  const [reticulumImageViewerContainer, setReticulumImageViewerContainer] =
    useState<HTMLElement | null>(null);
  const displayImageUrl = localResourceImageUrl || imageEmbedLink;
  useEffect(() => {
    setLoadedResourceImageSize(null);
  }, [imageResourceId]);
  const reticulumImageFileName =
    typeof imageResourceManifest?.fileName === 'string' &&
    imageResourceManifest.fileName.trim()
      ? imageResourceManifest.fileName.trim()
      : 'image.png';
  const reticulumImageMimeType =
    typeof imageResourceManifest?.mimeType === 'string'
      ? imageResourceManifest.mimeType
      : typeof imageResourceManifest?.metadata?.originalMimeType === 'string'
        ? imageResourceManifest.metadata.originalMimeType
        : 'image/png';
  const canOpenReticulumImage =
    reticulumChatEnabled &&
    Boolean(
      displayImageUrl &&
      (localResourceImageUrl || displayImageUrl.startsWith('data:image/'))
    );
  const [resourceReloadNonce, setResourceReloadNonce] = useState(0);
  const [reticulumImageDownloadIssue, setReticulumImageDownloadIssue] =
    useState<'unavailable' | 'error' | 'disk_full' | null>(null);
  const allowReticulumImageDiskRetryRef = useRef(false);
  const reticulumImageRequestKey =
    isReticulumResourceImage && imageResourceId
      ? isReticulumDirectResourceMessage
        ? myAddress && reticulumDirectPeerAddress
          ? `dm:${myAddress}:${reticulumDirectPeerAddress}:${imageResourceId}:${
              reticulumResourceEventId || ''
            }`
          : ''
        : Number.isInteger(reticulumResourceGroupId) &&
            reticulumResourceGroupId > 0
          ? `${reticulumResourceGroupId}:${imageResourceId}:${
              reticulumResourceEventId || ''
            }`
          : ''
      : '';
  useEffect(() => {
    allowReticulumImageDiskRetryRef.current = false;
    setReticulumImageDownloadIssue(null);
  }, [imageResourceId]);
  const retryReticulumImageDownload = useCallback(() => {
    allowReticulumImageDiskRetryRef.current = true;
    if (reticulumImageRequestKey) {
      reticulumImageRequestGate.clear(reticulumImageRequestKey);
    }
    setReticulumImageDownloadIssue(null);
    setResourceReloadNonce((value) => value + 1);
  }, [reticulumImageRequestKey]);
  const openReticulumImageViewer = useCallback(
    async (containerElement: HTMLElement | null) => {
      let viewerSrc = displayImageUrl;
      if (
        imageResourceId &&
        localResourceImageUrl?.startsWith('qortal-reticulum-resource:')
      ) {
        const refreshed = await window.reticulumResources
          ?.getUrl?.(imageResourceId)
          .catch(() => null);
        if (!refreshed?.success || !refreshed.url) {
          setLocalResourceImageUrl(null);
          setResourceReloadNonce((value) => value + 1);
          return;
        }
        viewerSrc = refreshed.url;
        setLocalResourceImageUrl(refreshed.url);
      }
      if (!viewerSrc) return;
      setReticulumImageViewerContainer(containerElement);
      setReticulumImageViewerSrc(viewerSrc);
      setIsReticulumImageViewerOpen(true);
    },
    [displayImageUrl, imageResourceId, localResourceImageUrl]
  );
  const [fileResourceStatus, setFileResourceStatus] = useState<
    'idle' | 'downloading' | 'ready' | 'saving' | 'error'
  >('idle');
  const [fileResourceFailureReason, setFileResourceFailureReason] = useState<
    'verification_failed' | 'disk_full' | null
  >(null);
  const [fileResourceProgress, setFileResourceProgress] = useState<
    number | null
  >(null);
  const [fileResourceBytes, setFileResourceBytes] = useState<{
    received: number;
    total: number;
  } | null>(null);
  const [fileResourceLastChunkAt, setFileResourceLastChunkAt] = useState<
    number | null
  >(null);
  const [fileResourceCheckedAt, setFileResourceCheckedAt] = useState<
    number | null
  >(null);
  const [fileResourceStartedAt, setFileResourceStartedAt] = useState<
    number | null
  >(null);
  const [fileResourceRuntime, setFileResourceRuntime] = useState<{
    active?: boolean;
    peerCount?: number;
    candidatePeerCount?: number;
    advertisedPeerCount?: number;
    activeTransfers?: number;
    pendingTransfers?: number;
    requestedRangeCount?: number;
    inFlightRangeCount?: number;
    currentBytesPerSecond?: number;
    averageBytesPerSecond?: number;
    nextRequestAt?: number | null;
    failureReason?: 'verification_failed' | 'disk_full';
  } | null>(null);
  const fileResourceFailureCheckRef = useRef(0);
  const [isFileOpenWarningOpen, setIsFileOpenWarningOpen] = useState(false);
  const [isOpeningFile, setIsOpeningFile] = useState(false);
  const [fileOpenError, setFileOpenError] = useState<string | null>(null);
  useEffect(() => {
    if (
      !isReticulumResourceImage ||
      !shouldAutoDownloadReticulumImage ||
      !imageResourceId ||
      !imageResourceManifest ||
      (!isReticulumDirectResourceMessage &&
        (!Number.isInteger(reticulumResourceGroupId) ||
          reticulumResourceGroupId <= 0)) ||
      (isReticulumDirectResourceMessage &&
        (!myAddress || !reticulumDirectPeerAddress))
    ) {
      return;
    }

    let cancelled = false;
    let availabilityTimer: number | null = null;
    const key = reticulumImageRequestKey;
    const nowMs = Date.now();
    const requestBackoffRemainingMs = reticulumImageRequestGate.getRemainingMs(
      key,
      nowMs
    );

    const clearAvailabilityTimer = () => {
      if (availabilityTimer === null) return;
      window.clearTimeout(availabilityTimer);
      availabilityTimer = null;
    };
    const scheduleAvailabilityCheck = (delayMs: number) => {
      clearAvailabilityTimer();
      availabilityTimer = window.setTimeout(
        () => {
          availabilityTimer = null;
          void window.reticulumResources
            ?.getStatus?.(imageResourceId)
            .then((status) => {
              if (cancelled) return;
              if (status?.success && status.complete) {
                reticulumImageRequestGate.clear(key);
                setReticulumImageDownloadIssue(null);
                setResourceReloadNonce((value) => value + 1);
                return;
              }

              const runtime = status?.runtime;
              if (runtime?.failureReason === 'disk_full') {
                setReticulumImageDownloadIssue('disk_full');
                return;
              }
              const hasActiveTransfer = Boolean(
                (runtime?.activeTransfers ?? 0) > 0 ||
                (runtime?.pendingTransfers ?? 0) > 0 ||
                (runtime?.inFlightRangeCount ?? 0) > 0
              );
              if (hasActiveTransfer) {
                scheduleAvailabilityCheck(
                  RETICULUM_IMAGE_AVAILABILITY_RECHECK_MS
                );
                return;
              }
              setReticulumImageDownloadIssue('unavailable');
            })
            .catch(() => {
              if (!cancelled) setReticulumImageDownloadIssue('error');
            });
        },
        Math.max(0, delayMs)
      );
    };

    if (requestBackoffRemainingMs > 0) {
      const remainingAvailabilityWait = Math.max(
        0,
        RETICULUM_IMAGE_UNAVAILABLE_TIMEOUT_MS -
          (RETICULUM_IMAGE_REQUEST_BACKOFF_MS - requestBackoffRemainingMs)
      );
      scheduleAvailabilityCheck(remainingAvailabilityWait);
      return () => {
        cancelled = true;
        clearAvailabilityTimer();
      };
    }

    setReticulumImageDownloadIssue(null);
    void (async () => {
      try {
        const status =
          await window.reticulumResources?.getStatus?.(imageResourceId);
        if (cancelled) return;
        if (status?.success && status.complete) {
          clearAvailabilityTimer();
          reticulumImageRequestGate.clear(key);
          setReticulumImageDownloadIssue(null);
          return;
        }
        if (
          status?.runtime?.failureReason === 'disk_full' &&
          !allowReticulumImageDiskRetryRef.current
        ) {
          setReticulumImageDownloadIssue('disk_full');
          return;
        }

        const requestStartedAt = Date.now();
        if (!reticulumImageRequestGate.claim(key, requestStartedAt)) {
          const remainingMs = reticulumImageRequestGate.getRemainingMs(
            key,
            requestStartedAt
          );
          scheduleAvailabilityCheck(
            Math.max(
              0,
              RETICULUM_IMAGE_UNAVAILABLE_TIMEOUT_MS -
                (RETICULUM_IMAGE_REQUEST_BACKOFF_MS - remainingMs)
            )
          );
          return;
        }

        const currentManifest = imageResourceManifestRef.current;
        if (!currentManifest || currentManifest.fileHash !== imageResourceId) {
          allowReticulumImageDiskRetryRef.current = false;
          reticulumImageRequestGate.clear(key);
          setReticulumImageDownloadIssue('error');
          return;
        }

        scheduleAvailabilityCheck(RETICULUM_IMAGE_UNAVAILABLE_TIMEOUT_MS);

        const response = isReticulumDirectResourceMessage
          ? await window.reticulumChat?.requestDirectResource?.(
              myAddress,
              reticulumDirectPeerAddress,
              currentManifest,
              reticulumResourceEventId || undefined
            )
          : await window.reticulumChat?.requestResource?.(
              reticulumResourceGroupId,
              currentManifest,
              reticulumResourceEventId || undefined
            );
        allowReticulumImageDiskRetryRef.current = false;
        if (!response?.success) {
          reticulumImageRequestGate.clear(key);
          if (cancelled) return;
          clearAvailabilityTimer();
          setReticulumImageDownloadIssue('error');
          console.warn(
            '[ReticulumResource] Image resource request failed:',
            response?.error || 'request API unavailable',
            imageResourceId
          );
        }
      } catch (error) {
        allowReticulumImageDiskRetryRef.current = false;
        reticulumImageRequestGate.clear(key);
        if (cancelled) return;
        clearAvailabilityTimer();
        setReticulumImageDownloadIssue('error');
        console.warn(
          '[ReticulumResource] Image resource request failed:',
          error instanceof Error ? error.message : error,
          imageResourceId
        );
      }
    })();

    return () => {
      cancelled = true;
      clearAvailabilityTimer();
    };
  }, [
    imageResourceId,
    isReticulumResourceImage,
    isReticulumDirectResourceMessage,
    myAddress,
    reticulumDirectPeerAddress,
    reticulumResourceEventId,
    reticulumResourceGroupId,
    reticulumImageRequestKey,
    resourceReloadNonce,
    shouldAutoDownloadReticulumImage,
  ]);

  const qchatFileData = qchatFileTransfer?.data || {};
  const qchatTransferState =
    qchatFileData?.transferId && qchatFileTransferStates
      ? qchatFileTransferStates[qchatFileData.transferId]
      : null;
  const qchatDownloaded =
    !!qchatFileData?.transferId &&
    !!qchatCompletedTransfers?.[qchatFileData.transferId];
  const qchatDisplayStatus = qchatDownloaded
    ? 'received'
    : qchatTransferState?.status || qchatFileData?.status || 'offer';
  const qchatProgress =
    typeof qchatTransferState?.progress === 'number'
      ? Math.max(
          0,
          Math.min(100, Math.round(qchatTransferState.progress * 100))
        )
      : null;
  const qchatTransferBusy =
    qchatDisplayStatus === 'accepted' ||
    qchatDisplayStatus === 'connecting' ||
    qchatDisplayStatus === 'retrying' ||
    qchatDisplayStatus === 'link_established' ||
    qchatDisplayStatus === 'auth_sent' ||
    qchatDisplayStatus === 'auth' ||
    qchatDisplayStatus === 'authorized' ||
    qchatDisplayStatus === 'sending' ||
    qchatDisplayStatus === 'receiving';
  const qchatTransferDone =
    qchatDisplayStatus === 'sent' ||
    qchatDisplayStatus === 'received' ||
    qchatDownloaded;
  const qchatTransferError =
    qchatDisplayStatus === 'failed' || qchatDisplayStatus === 'rejected';
  const qchatShowOfferExpiry =
    qchatDisplayStatus === 'offer' || qchatDisplayStatus === 'registered';
  const qchatExpiresAt =
    typeof qchatFileData?.expiresAt === 'number'
      ? qchatFileData.expiresAt
      : typeof message?.timestamp === 'number'
        ? message.timestamp + QCHAT_FILE_TRANSFER_TTL_MS
        : null;
  const qchatMsLeft =
    qchatShowOfferExpiry &&
    qchatExpiresAt &&
    !qchatTransferDone &&
    !qchatTransferError
      ? Math.max(0, qchatExpiresAt - nowMs)
      : null;
  const qchatOfferExpired =
    qchatShowOfferExpiry &&
    !qchatTransferDone &&
    !qchatTransferError &&
    !!qchatExpiresAt &&
    qchatExpiresAt <= nowMs;
  const qchatExpiryText =
    qchatMsLeft === null
      ? ''
      : qchatMsLeft <= 0
        ? 'expired'
        : `${Math.floor(qchatMsLeft / 60000)}:${Math.floor(
            (qchatMsLeft % 60000) / 1000
          )
            .toString()
            .padStart(2, '0')} left`;
  const qchatStatusText = (() => {
    switch (qchatDisplayStatus) {
      case 'offer':
        if (qchatDownloaded) return 'downloaded';
        if (qchatOfferExpired) return 'expired';
        return 'offer';
      case 'registered':
        return 'waiting for downloader';
      case 'accepted':
      case 'connecting':
        return 'creating link';
      case 'retrying':
        return `retrying link ${qchatTransferState?.attempt || ''}`.trim();
      case 'link_established':
        return 'link established';
      case 'auth_sent':
        return 'waiting for sender authorization';
      case 'auth':
        return 'verifying downloader';
      case 'authorized':
        return 'authorized';
      case 'sending':
        return qchatProgress !== null
          ? `uploading ${qchatProgress}%`
          : 'uploading';
      case 'receiving':
        return qchatProgress !== null
          ? `downloading ${qchatProgress}%`
          : 'downloading';
      case 'sent':
        return 'sent';
      case 'received':
        return 'downloaded';
      case 'failed':
      case 'rejected':
        return `error: ${
          qchatTransferState?.error ||
          qchatTransferState?.reason ||
          'transfer failed'
        }`;
      default:
        return qchatDisplayStatus;
    }
  })();

  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    setLocalResourceImageUrl(null);
    if (!imageResourceId || !shouldAutoDownloadReticulumImage) return;
    const arrayBufferToBinaryString = (buffer: ArrayBuffer): string => {
      const bytes = new Uint8Array(buffer);
      const chunkSize = 0x8000;
      let out = '';
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        out += String.fromCharCode(
          ...bytes.subarray(offset, offset + chunkSize)
        );
      }
      return out;
    };
    const load = async (attempt = 0) => {
      const result = await window.reticulumResources?.getUrl?.(imageResourceId);
      if (cancelled) return;
      if (result?.success && result.url) {
        const manifest = result.manifest as
          | {
              encrypted?: boolean;
              metadata?: Record<string, unknown>;
            }
          | undefined;
        if (manifest?.encrypted) {
          if (!secretKeyObject) return;
          try {
            const response = await fetch(result.url);
            if (response.ok) {
              const encryptedPayload = arrayBufferToBinaryString(
                await response.arrayBuffer()
              );
              const decrypted = await window.sendMessage?.('decryptSingle', {
                data: [{ data: encryptedPayload }],
                secretKeyObject,
              });
              if (cancelled) return;
              const decryptedData = decrypted?.[0]?.decryptedData;
              const imageBase64 =
                typeof decryptedData?.imageBase64 === 'string'
                  ? decryptedData.imageBase64
                  : '';
              if (imageBase64) {
                const mimeType =
                  typeof decryptedData?.mimeType === 'string'
                    ? decryptedData.mimeType
                    : typeof manifest.metadata?.originalMimeType === 'string'
                      ? manifest.metadata.originalMimeType
                      : 'image/webp';
                setLocalResourceImageUrl(
                  `data:${mimeType};base64,${imageBase64}`
                );
                return;
              }
            }
          } catch (error) {
            console.error(
              '[ReticulumResource] Failed to load encrypted image:',
              error
            );
          }
        }
        if (!manifest?.encrypted) {
          setLocalResourceImageUrl(result.url);
          return;
        }
      }
      if (attempt < 5) {
        const delay = attempt === 0 ? 1_500 : Math.min(8_000, 2_000 * attempt);
        timers.push(window.setTimeout(() => void load(attempt + 1), delay));
      }
    };
    void load();
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [
    imageResourceFileHash,
    imageResourceId,
    resourceReloadNonce,
    secretKeyObject,
    shouldAutoDownloadReticulumImage,
  ]);

  const applyFileResourceStatus = useCallback(
    (payload?: {
      bytesTransferred?: number;
      totalBytes?: number;
      progress?: number;
      complete?: boolean;
      failed?: boolean;
      failureReason?: 'verification_failed' | 'disk_full';
      latestRangeUpdatedAt?: number | null;
      checkedAt?: number;
      runtime?: {
        active?: boolean;
        peerCount?: number;
        candidatePeerCount?: number;
        advertisedPeerCount?: number;
        activeTransfers?: number;
        pendingTransfers?: number;
        requestedRangeCount?: number;
        inFlightRangeCount?: number;
        currentBytesPerSecond?: number;
        averageBytesPerSecond?: number;
        nextRequestAt?: number | null;
        failureReason?: 'verification_failed' | 'disk_full';
      } | null;
    }) => {
      if (!payload) return;
      if (
        payload.failureReason === 'disk_full' ||
        payload.runtime?.failureReason === 'disk_full'
      ) {
        fileResourceFailureCheckRef.current += 1;
        setFileResourceFailureReason('disk_full');
        setFileResourceStatus('error');
        setFileResourceRuntime(payload.runtime ?? null);
        return;
      }
      const verificationFailed =
        payload.failureReason === 'verification_failed';
      if (verificationFailed) {
        fileResourceFailureCheckRef.current += 1;
        const restartedAt = Date.now();
        setFileResourceFailureReason('verification_failed');
        setFileResourceProgress(0);
        setFileResourceBytes(
          typeof payload.totalBytes === 'number' && payload.totalBytes > 0
            ? { received: 0, total: payload.totalBytes }
            : null
        );
        setFileResourceLastChunkAt(null);
        setFileResourceStartedAt(restartedAt);
        setFileResourceStatus(payload.failed ? 'error' : 'downloading');
      } else if (
        payload.complete ||
        (typeof payload.bytesTransferred === 'number' &&
          payload.bytesTransferred > 0)
      ) {
        setFileResourceFailureReason(null);
      }
      if (typeof payload.checkedAt === 'number') {
        setFileResourceCheckedAt(payload.checkedAt);
      }
      if (payload.runtime && typeof payload.runtime === 'object') {
        setFileResourceRuntime(payload.runtime);
      }
      if (typeof payload.progress === 'number') {
        const maximumProgress = payload.complete ? 100 : 99;
        const nextProgress = Math.max(
          0,
          Math.min(maximumProgress, Math.round(payload.progress * 100))
        );
        setFileResourceProgress((progress) =>
          typeof progress === 'number'
            ? Math.max(progress, nextProgress)
            : nextProgress
        );
        if (nextProgress > 0) {
          setFileResourceLastChunkAt(Date.now());
        }
      }
      if (
        typeof payload.bytesTransferred === 'number' &&
        typeof payload.totalBytes === 'number' &&
        payload.totalBytes > 0
      ) {
        const received = Math.max(
          0,
          Math.min(payload.bytesTransferred, payload.totalBytes)
        );
        const byteProgress = Math.max(
          0,
          Math.min(
            payload.complete ? 100 : 99,
            Math.round((received / payload.totalBytes) * 100)
          )
        );
        setFileResourceBytes((bytes) => ({
          received:
            bytes && bytes.total === payload.totalBytes
              ? Math.max(bytes.received, received)
              : received,
          total: payload.totalBytes,
        }));
        setFileResourceProgress((progress) =>
          typeof progress === 'number'
            ? Math.max(progress, byteProgress)
            : byteProgress
        );
        if (received > 0) {
          setFileResourceLastChunkAt(Date.now());
        }
      }
      if (
        typeof payload.latestRangeUpdatedAt === 'number' &&
        payload.latestRangeUpdatedAt > 0
      ) {
        setFileResourceLastChunkAt(payload.latestRangeUpdatedAt);
      }
      if (payload.canceled) {
        fileResourceFailureCheckRef.current += 1;
        setFileResourceFailureReason(null);
        setFileResourceStatus('idle');
        setFileResourceProgress(null);
        setFileResourceBytes(null);
        setFileResourceRuntime(null);
        setFileResourceStartedAt(null);
        setFileResourceLastChunkAt(null);
        return;
      }
      if (payload.complete) {
        fileResourceFailureCheckRef.current += 1;
        setFileResourceFailureReason(null);
        setFileResourceStatus('ready');
        setFileResourceProgress(100);
        setFileResourceBytes(null);
      }
    },
    []
  );

  const markFileResourceReadyIfComplete = useCallback(async () => {
    if (!reticulumFileResourceId) return false;
    const status = await window.reticulumResources?.getStatus?.(
      reticulumFileResourceId
    );
    if (!status?.success) return false;
    applyFileResourceStatus(status);
    return status.complete === true;
  }, [applyFileResourceStatus, reticulumFileResourceId]);

  const reconcileFileResourceFailure = useCallback(async () => {
    if (!reticulumFileResourceId) return;
    const checkId = fileResourceFailureCheckRef.current + 1;
    fileResourceFailureCheckRef.current = checkId;
    const status = await window.reticulumResources
      ?.getStatus?.(reticulumFileResourceId)
      .catch(() => null);
    if (fileResourceFailureCheckRef.current !== checkId) return;
    if (status?.success && status.complete) {
      applyFileResourceStatus(status);
      return;
    }
    if (status?.runtime?.failureReason === 'disk_full') {
      applyFileResourceStatus(status);
      return;
    }
    if (status?.success && status.runtime?.active) {
      applyFileResourceStatus(status);
      setFileResourceFailureReason(null);
      setFileResourceStatus('downloading');
      return;
    }
    setFileResourceRuntime(status?.success ? (status.runtime ?? null) : null);
    setFileResourceFailureReason(null);
    setFileResourceStatus('error');
  }, [applyFileResourceStatus, reticulumFileResourceId]);

  useEffect(() => {
    if (
      (!imageResourceId && !reticulumFileResourceId) ||
      typeof window.reticulumChat?.onResource !== 'function'
    )
      return;
    return window.reticulumChat.onResource((payload) => {
      if (
        shouldAutoDownloadReticulumImage &&
        payload?.fileHash === imageResourceId
      ) {
        if (payload.complete === true) {
          if (reticulumImageRequestKey) {
            reticulumImageRequestGate.clear(reticulumImageRequestKey);
          }
          setReticulumImageDownloadIssue(null);
          setResourceReloadNonce((value) => value + 1);
        } else if (payload.failed === true) {
          setReticulumImageDownloadIssue(
            payload.failureReason === 'disk_full' ? 'disk_full' : 'error'
          );
        }
      }
      if (payload?.fileHash === reticulumFileResourceId) {
        applyFileResourceStatus(payload);
        if (payload.complete) {
          void markFileResourceReadyIfComplete();
        } else if (
          payload.failed &&
          payload.failureReason !== 'verification_failed' &&
          payload.failureReason !== 'disk_full'
        ) {
          void reconcileFileResourceFailure();
        } else if (!payload.failed && !payload.canceled) {
          fileResourceFailureCheckRef.current += 1;
          setFileResourceStatus((status) =>
            status === 'ready' || status === 'saving' ? status : 'downloading'
          );
        }
      }
    });
  }, [
    applyFileResourceStatus,
    imageResourceId,
    markFileResourceReadyIfComplete,
    reconcileFileResourceFailure,
    reticulumFileResourceId,
    reticulumImageRequestKey,
    shouldAutoDownloadReticulumImage,
  ]);

  const requestReticulumFileResource = useCallback(async () => {
    if (
      !reticulumDownloadAttachment ||
      !reticulumFileResourceId ||
      (!isReticulumDirectResourceMessage &&
        (!Number.isInteger(reticulumResourceGroupId) ||
          reticulumResourceGroupId <= 0)) ||
      (isReticulumDirectResourceMessage &&
        (!myAddress || !reticulumDirectPeerAddress))
    ) {
      return {
        success: false,
        error: t('group:message_item.invalid_attachment'),
      };
    }
    const ready = await markFileResourceReadyIfComplete();
    if (ready) {
      return { success: true };
    }
    fileResourceFailureCheckRef.current += 1;
    setFileResourceStatus('downloading');
    setFileResourceFailureReason(null);
    setFileResourceProgress((progress) =>
      typeof progress === 'number' ? progress : 0
    );
    setFileResourceLastChunkAt(null);
    const startedAt = Date.now();
    setFileResourceCheckedAt(startedAt);
    setFileResourceStartedAt(startedAt);
    setFileResourceRuntime(null);
    setFileResourceBytes(
      reticulumFileSize > 0
        ? {
            received: 0,
            total: reticulumFileSize,
          }
        : null
    );
    const response = isReticulumDirectResourceMessage
      ? await window.reticulumChat?.requestDirectResource?.(
          myAddress,
          reticulumDirectPeerAddress,
          reticulumDownloadAttachment,
          reticulumResourceEventId || undefined
        )
      : await window.reticulumChat?.requestResource?.(
          reticulumResourceGroupId,
          reticulumDownloadAttachment,
          reticulumResourceEventId || undefined
        );
    if (response?.success === false) {
      await reconcileFileResourceFailure();
      return response;
    }
    return { success: true };
  }, [
    reticulumDownloadAttachment,
    reticulumFileSize,
    reticulumFileResourceId,
    reticulumResourceEventId,
    reticulumResourceGroupId,
    isReticulumDirectResourceMessage,
    markFileResourceReadyIfComplete,
    reconcileFileResourceFailure,
    myAddress,
    reticulumDirectPeerAddress,
  ]);

  const cancelReticulumFileResource = useCallback(async () => {
    if (!reticulumFileResourceId) return;
    fileResourceFailureCheckRef.current += 1;
    setFileResourceStatus('idle');
    setFileResourceFailureReason(null);
    setFileResourceProgress(null);
    setFileResourceBytes(null);
    setFileResourceRuntime(null);
    setFileResourceStartedAt(null);
    setFileResourceLastChunkAt(null);
    await window.reticulumChat?.cancelResource?.(reticulumFileResourceId);
  }, [reticulumFileResourceId]);

  const saveReticulumFileResource = useCallback(async () => {
    if (!reticulumFileResourceId) return;
    setFileResourceStatus((status) => (status === 'ready' ? 'saving' : status));
    const ready = await markFileResourceReadyIfComplete();
    if (!ready) {
      const requested = await requestReticulumFileResource();
      if (requested?.success === false) return;
      return;
    }
    const saved = await window.reticulumResources?.saveAs?.(
      reticulumFileResourceId,
      reticulumFileName
    );
    if (saved?.success) {
      setFileResourceStatus('ready');
      return;
    }
    setFileResourceStatus(saved?.canceled ? 'ready' : 'error');
  }, [
    markFileResourceReadyIfComplete,
    requestReticulumFileResource,
    reticulumFileName,
    reticulumFileResourceId,
  ]);

  const openReticulumFileResource = useCallback(async () => {
    if (!reticulumFileResourceId || fileResourceStatus !== 'ready') return;
    setIsOpeningFile(true);
    setFileOpenError(null);
    try {
      const result = await window.reticulumResources?.open?.(
        reticulumFileResourceId,
        reticulumFileName
      );
      if (!result?.success) {
        setFileOpenError(result?.error || t('group:message_item.open_failed'));
        return;
      }
      setIsFileOpenWarningOpen(false);
    } catch (error) {
      setFileOpenError(
        error instanceof Error
          ? error.message
          : t('group:message_item.open_failed')
      );
    } finally {
      setIsOpeningFile(false);
    }
  }, [fileResourceStatus, reticulumFileName, reticulumFileResourceId]);

  useEffect(() => {
    let cancelled = false;
    const checkId = fileResourceFailureCheckRef.current + 1;
    fileResourceFailureCheckRef.current = checkId;
    if (!reticulumFileResourceId) {
      setFileResourceStatus('idle');
      setFileResourceFailureReason(null);
      setFileResourceProgress(null);
      setFileResourceBytes(null);
      return;
    }
    void window.reticulumResources
      ?.getStatus?.(reticulumFileResourceId)
      .then((result) => {
        if (cancelled || fileResourceFailureCheckRef.current !== checkId)
          return;
        if (result?.success && result.complete) {
          applyFileResourceStatus(result);
        } else if (
          result?.success &&
          result.runtime?.failureReason === 'disk_full'
        ) {
          applyFileResourceStatus(result);
        } else if (result?.success && result.runtime?.active) {
          applyFileResourceStatus(result);
          setFileResourceStatus('downloading');
        } else {
          setFileResourceStatus('idle');
          setFileResourceFailureReason(null);
          setFileResourceProgress(null);
          setFileResourceBytes(null);
          setFileResourceLastChunkAt(null);
          setFileResourceCheckedAt(null);
          setFileResourceStartedAt(null);
          setFileResourceRuntime(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [applyFileResourceStatus, reticulumFileResourceId, resourceReloadNonce]);

  useEffect(() => {
    if (!reticulumFileResourceId || fileResourceStatus !== 'downloading')
      return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void window.reticulumResources
        ?.getStatus?.(reticulumFileResourceId)
        .then((status) => {
          if (cancelled || !status?.success) return;
          applyFileResourceStatus(status);
          if (status.complete) {
            window.clearInterval(timer);
          }
        });
    }, 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [applyFileResourceStatus, fileResourceStatus, reticulumFileResourceId]);
  useEffect(() => {
    if (!qchatFileTransfer) return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [qchatFileTransfer]);
  useEffect(() => {
    if (fileResourceStatus !== 'downloading') return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [fileResourceStatus]);
  const reticulumExpiryMs = reticulumChatEnabled
    ? normalizeReticulumExpiryMs(message?.expiresAt)
    : null;
  useEffect(() => {
    if (!reticulumExpiryMs) return;
    const currentTime = Date.now();
    const nextBoundary =
      reticulumExpiryMs - currentTime > RETICULUM_EXPIRING_SOON_MS
        ? reticulumExpiryMs - RETICULUM_EXPIRING_SOON_MS
        : reticulumExpiryMs;
    const delay = nextBoundary - currentTime;
    if (delay <= 0) return;
    const timer = window.setTimeout(
      () => setExpiryClockMs(Date.now()),
      Math.min(delay + 50, 2_147_483_647)
    );
    return () => window.clearTimeout(timer);
  }, [expiryClockMs, reticulumExpiryMs]);
  const fileResourceActivityText = (() => {
    if (fileResourceStatus !== 'downloading') return '';
    const referenceAt = fileResourceLastChunkAt || fileResourceStartedAt;
    if (!referenceAt) return 'waiting for first range';
    const ageSeconds = Math.max(0, Math.floor((nowMs - referenceAt) / 1000));
    const activeTransfers = Number(fileResourceRuntime?.activeTransfers || 0);
    const isReceivingBundle =
      Boolean(fileResourceRuntime?.active) && activeTransfers > 0;
    if (!fileResourceBytes?.received) {
      if (isReceivingBundle) {
        if ((fileResourceProgress ?? 0) > 0) return 'receiving first range';
        return `receiving first range ${ageSeconds}s`;
      }
      if (ageSeconds < 8) return 'requesting ranges';
      if (ageSeconds < 30) return `waiting for first range ${ageSeconds}s`;
      return `retrying / waiting for first range ${ageSeconds}s`;
    }
    if (ageSeconds < 8) return 'receiving';
    if (ageSeconds < 30) return `waiting ${ageSeconds}s`;
    return `retrying / waiting for peers ${ageSeconds}s`;
  })();
  const fileResourcePeerText = (() => {
    if (fileResourceStatus !== 'downloading' || !fileResourceRuntime?.active) {
      return '';
    }
    const peerCount = Number(fileResourceRuntime.peerCount || 0);
    const candidatePeerCount = Number(
      fileResourceRuntime.candidatePeerCount || 0
    );
    const advertisedPeerCount = Number(
      fileResourceRuntime.advertisedPeerCount || 0
    );
    const activeTransfers = Number(fileResourceRuntime.activeTransfers || 0);
    const pendingTransfers = Number(fileResourceRuntime.pendingTransfers || 0);
    const currentSpeedText = formatQchatFileSpeed(
      Number(fileResourceRuntime.currentBytesPerSecond || 0)
    );
    const averageSpeedText = formatQchatFileSpeed(
      Number(fileResourceRuntime.averageBytesPerSecond || 0)
    );
    const sourceCount = Math.max(peerCount, advertisedPeerCount);
    const peersText =
      sourceCount > 0
        ? `sources ${sourceCount}`
        : candidatePeerCount > 0
          ? `checking ${candidatePeerCount} peer${candidatePeerCount !== 1 ? 's' : ''}`
          : '';
    const transferParts: string[] = [];
    if (activeTransfers > 0) {
      transferParts.push(`${activeTransfers} active`);
    }
    if (pendingTransfers > 0) {
      transferParts.push(`${pendingTransfers} queued`);
    }
    const transfersText =
      transferParts.length > 0 ? `transfers ${transferParts.join(', ')}` : '';
    const speedText = currentSpeedText
      ? `speed ${currentSpeedText}`
      : averageSpeedText
        ? `avg ${averageSpeedText}`
        : '';
    return [peersText, transfersText, speedText].filter(Boolean).join(' · ');
  })();
  const fileResourceUnavailableNoPeers = (() => {
    if (
      (fileResourceStatus !== 'downloading' &&
        fileResourceStatus !== 'error') ||
      fileResourceFailureReason === 'disk_full' ||
      !fileResourceStartedAt ||
      nowMs - fileResourceStartedAt < RETICULUM_FILE_UNAVAILABLE_TIMEOUT_MS ||
      fileResourceBytes?.received
    ) {
      return false;
    }
    const runtime = fileResourceRuntime;
    if (!runtime?.active) return false;
    const providerCount = Math.max(
      Number(runtime.peerCount || 0),
      Number(runtime.advertisedPeerCount || 0)
    );
    const activeTransferCount =
      Number(runtime.activeTransfers || 0) +
      Number(runtime.pendingTransfers || 0) +
      Number(runtime.inFlightRangeCount || 0);
    return providerCount === 0 && activeTransferCount === 0;
  })();
  const fileResourceStatusText = (() => {
    if (fileResourceFailureReason === 'disk_full')
      return t('group:message_item.attachment_disk_full');
    if (fileResourceStatus === 'ready') return 'ready';
    if (fileResourceStatus === 'saving') return 'saving';
    if (fileResourceUnavailableNoPeers) {
      return 'file unavailable right now (no peers)';
    }
    if (fileResourceFailureReason === 'verification_failed') {
      return fileResourceStatus === 'error'
        ? 'file verification failed'
        : 'file verification failed · retrying';
    }
    if (fileResourceStatus === 'downloading') {
      if (fileResourceProgress === null) return 'downloading';
      const bytesText =
        fileResourceBytes && fileResourceBytes.total > 0
          ? `${formatQchatFileSize(fileResourceBytes.received)} / ${formatQchatFileSize(fileResourceBytes.total)}`
          : '';
      const details = [fileResourceActivityText, fileResourcePeerText]
        .filter(Boolean)
        .join(' · ');
      return `downloading ${fileResourceProgress}%${
        bytesText ? ` · ${bytesText}` : ''
      }${details ? ` · ${details}` : ''}`;
    }
    if (fileResourceStatus === 'error') {
      if (!fileResourceBytes?.received) return 'download failed';
      return `download paused at ${fileResourceProgress ?? 0}%`;
    }
    return 'not downloaded';
  })();
  const fileResourceStatusLabel = (() => {
    if (fileResourceFailureReason === 'disk_full')
      return t('group:message_item.attachment_disk_full');
    if (fileResourceStatus === 'ready') return 'Downloaded';
    if (fileResourceStatus === 'saving') return 'Saving...';
    if (fileResourceUnavailableNoPeers)
      return t('group:message_item.file_unavailable');
    if (fileResourceFailureReason === 'verification_failed') {
      return t('group:message_item.verification_failed');
    }
    if (fileResourceStatus === 'error')
      return t('group:message_item.download_failed');
    if (fileResourceStatus === 'downloading') {
      return fileResourceProgress === null
        ? 'Downloading...'
        : `Downloading ${fileResourceProgress}%`;
    }
    return t('group:message_item.not_downloaded');
  })();
  const fileResourceActionLabel =
    fileResourceStatus === 'downloading' && !fileResourceUnavailableNoPeers
      ? 'Cancel'
      : fileResourceUnavailableNoPeers || fileResourceStatus === 'error'
        ? t('group:message_item.try_again')
        : fileResourceStatus === 'ready'
          ? 'Save'
          : fileResourceStatus === 'saving'
            ? 'Saving...'
            : 'Download';
  const fileResourceActionAriaLabel = `${fileResourceActionLabel} ${reticulumFileName}, ${formatQchatFileSize(
    reticulumFileSize
  )}`;
  const hasNoMessage =
    !qchatFileTransfer &&
    !reticulumDownloadAttachment &&
    (!message.decryptedData?.data?.message ||
      message.decryptedData?.data?.message === '<p></p>') &&
    (message?.images || [])?.length === 0 &&
    (!message?.messageText || message?.messageText === '<p></p>') &&
    (!message?.text || message?.text === '<p></p>');

  const isOwn = message?.sender === myAddress;
  const mentionedAddresses = [
    ...(Array.isArray(message?.mentionedAddresses)
      ? message.mentionedAddresses
      : []),
    ...(Array.isArray(message?.decryptedData?.mentionedAddresses)
      ? message.decryptedData.mentionedAddresses
      : []),
    ...(Array.isArray(message?.decryptedData?.data?.mentionedAddresses)
      ? message.decryptedData.data.mentionedAddresses
      : []),
  ];
  const isCurrentUserMentioned =
    reticulumChatEnabled &&
    !isOwn &&
    Boolean(myAddress) &&
    (message?.reticulumChat
      ? message?.directMentionAuthorized === true ||
        message?.privilegedMentionAuthorized === true
      : mentionedAddresses.some(
          (address) => String(address).trim() === myAddress
        ));
  const isOwnReticulumDeletable =
    isOwn &&
    !isOfficialGroupSystem &&
    message?.reticulumChat &&
    typeof onDelete === 'function';
  const isOwnReticulumEditable = canEditOwnReticulumMessage({
    isOfficialGroupWelcome: isOfficialGroupSystem,
    message,
    myAddress,
  });
  const copyReticulumMessage = useCallback(async () => {
    const html = String(
      message?.decryptedData?.data?.message ??
        message?.messageText ??
        message?.text ??
        ''
    );
    const text = html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .trim();
    if (!text || !navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(text);
  }, [message]);
  const [isOwnReticulumMessageHovered, setIsOwnReticulumMessageHovered] =
    useState(false);

  useEffect(() => {
    if (!isOwnReticulumMessageHovered || !isOwnReticulumDeletable) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Delete' ||
        !event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.repeat
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      event.preventDefault();
      onDelete(message);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isOwnReticulumDeletable,
    isOwnReticulumMessageHovered,
    message,
    onDelete,
  ]);

  const senderStatus = useStatus(message?.sender);
  const reticulumUserCard =
    reticulumChatEnabled && message?.sender && !isOfficialGroupSystem
      ? {
          address: message.sender,
          avatarUrl: userAvatarUrl,
          isMinterResolved: isReticulumMinterResolved && isUserInfoResolved,
          isOwn,
          minterLevel:
            isReticulumMinterResolved && isUserInfoResolved
              ? reticulumMinterLevel
              : undefined,
          name: message.senderName,
          onAvatarPreview: (event, src) =>
            handleAvatarPreview(event, src, false),
          role: reticulumMemberRole,
          roleColor: reticulumMemberRoleColor,
          status: senderStatus,
        }
      : undefined;
  const isRepliedToMe =
    reply?.sender === myAddress || replyExpiredMeta?.sender === myAddress;
  const isQchatFileOffer = qchatFileTransfer?.data?.status === 'offer';
  const displayTimestamp = reticulumChatEnabled
    ? (() => {
        const timestamp = Number(message?.timestamp);
        if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
        const timestampMs =
          timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
        const date = new Date(timestampMs);
        const now = new Date();
        const isToday =
          date.getFullYear() === now.getFullYear() &&
          date.getMonth() === now.getMonth() &&
          date.getDate() === now.getDate();
        const time = date.toLocaleTimeString(undefined, {
          hour: 'numeric',
          minute: '2-digit',
        });
        const minutesAgo = Math.max(
          0,
          Math.floor((Date.now() - timestampMs) / 60_000)
        );
        if (minutesAgo < 60) {
          return `${time} (${minutesAgo}min ago)`;
        }
        return isToday ? time : `${date.toLocaleDateString()} ${time}`;
      })()
    : formatTimestamp(message.timestamp);
  const hasReticulumDiscussion =
    reticulumChatEnabled && reticulumDiscussionReplyCount > 0;
  const collapseGroupedHeader = isGroupedWithPrevious;
  const reticulumExpiryText = formatReticulumExpiry(reticulumExpiryMs);
  const hasReticulumExpiry = Boolean(reticulumExpiryMs);
  const isReticulumExpiringSoon = Boolean(
    reticulumExpiryMs &&
    reticulumExpiryMs > expiryClockMs &&
    reticulumExpiryMs - expiryClockMs < RETICULUM_EXPIRING_SOON_MS
  );
  const reticulumExpiringSoonLabel = isReticulumExpiringSoon ? (
    <Tooltip title={`Message Expiry: ${reticulumExpiryText}`}>
      <Typography
        component="span"
        sx={{
          color: alpha(theme.palette.warning.main, 0.9),
          cursor: 'help',
          flexShrink: 0,
          fontSize: '9.5px',
          fontWeight: 500,
          letterSpacing: '0.035em',
          lineHeight: 1,
          marginLeft: '6px',
          whiteSpace: 'nowrap',
        }}
      >
        (EXPIRING SOON)
      </Typography>
    </Tooltip>
  ) : null;
  const isReticulumDiscussionInitialPost =
    reticulumDiscussionView &&
    String(message?.signature || '') === reticulumDiscussionRootId;
  const showReplyPreview =
    !isReticulumDiscussionInitialPost &&
    (!reticulumDiscussionView ||
      String(message?.repliedTo || '') !== reticulumDiscussionRootId);
  const reticulumDiscussionButton =
    hasReticulumDiscussion && onOpenReticulumDiscussion ? (
      <Tooltip
        title={`View ${reticulumDiscussionReplyCount} ${
          reticulumDiscussionReplyCount === 1 ? 'reply' : 'replies'
        }`}
        slotProps={{
          tooltip: {
            sx: {
              backgroundColor:
                theme.palette.mode === 'light' ? '#f8fafc' : undefined,
              border:
                theme.palette.mode === 'light'
                  ? '1px solid rgba(15, 23, 42, 0.16)'
                  : undefined,
              color: theme.palette.mode === 'light' ? '#111827' : undefined,
              fontWeight: 600,
            },
          },
        }}
      >
        <ButtonBase
          aria-label={`View ${reticulumDiscussionReplyCount} ${
            reticulumDiscussionReplyCount === 1 ? 'reply' : 'replies'
          }`}
          onClick={() => onOpenReticulumDiscussion(message)}
          sx={{
            alignItems: 'center',
            backgroundColor:
              theme.palette.mode === 'light'
                ? alpha('#174ea6', 0.14)
                : alpha(theme.palette.primary.main, 0.12),
            border:
              theme.palette.mode === 'light'
                ? '1px solid rgba(23, 78, 166, 0.24)'
                : '1px solid transparent',
            borderRadius: '50%',
            color:
              theme.palette.mode === 'light'
                ? '#174ea6'
                : theme.palette.primary.main,
            display: 'inline-flex',
            flexShrink: 0,
            fontSize: '10px',
            fontWeight: 700,
            height: 24,
            justifyContent: 'center',
            lineHeight: 1,
            minWidth: 24,
            px: reticulumDiscussionReplyCount > 99 ? 0.5 : 0,
            '&:hover': {
              backgroundColor:
                theme.palette.mode === 'light'
                  ? alpha('#174ea6', 0.22)
                  : alpha(theme.palette.primary.main, 0.2),
            },
          }}
        >
          +{reticulumDiscussionReplyCount}
        </ButtonBase>
      </Tooltip>
    ) : null;

  if (shouldSuppressUnvalidatedGroupWelcome) return null;

  return (
    <>
      {message?.divide && (
        <div
          className={`unread-divider${reticulumChatEnabled ? ' reticulum-unread-divider' : ''}`}
          id="unread-divider-id"
        >
          {reticulumChatEnabled
            ? t('group:message_item.new_messages')
            : t('core:message.generic.unread_messages', {
                postProcess: 'capitalizeFirstChar',
              })}
        </div>
      )}

      <MessageWragger
        lastMessage={lastSignature === message?.signature}
        isLast={isLast}
        onSeen={onSeenFunc}
      >
        <Box
          className="message-item-row"
          onContextMenu={
            reticulumChatEnabled
              ? (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setReticulumMessageMenuPosition({
                    mouseX: event.clientX + 2,
                    mouseY: event.clientY - 6,
                  });
                }
              : undefined
          }
          onMouseEnter={
            isOwnReticulumDeletable
              ? () => setIsOwnReticulumMessageHovered(true)
              : undefined
          }
          onMouseLeave={
            isOwnReticulumDeletable
              ? () => setIsOwnReticulumMessageHovered(false)
              : undefined
          }
          sx={{
            display: 'flex',
            flexDirection: 'row',
            gap: reticulumChatEnabled ? '10px' : '12px',
            opacity: isTemp || isUpdating ? 0.5 : 1,
            padding: isShowingAsReply
              ? '2px 8px'
              : reticulumChatEnabled
                ? isGroupedWithPrevious
                  ? '1px 14px 2px'
                  : '5px 14px 6px'
                : '8px 16px 10px',
            marginBottom: isShowingAsReply
              ? 0
              : reticulumChatEnabled
                ? 0
                : '3px',
            position: 'relative',
            transition: 'background-color 0.1s ease',
            width: '100%',
            ...(isOfficialGroupSystem && {
              backgroundColor: alpha(theme.palette.primary.main, 0.085),
              boxShadow: `inset 3px 0 0 ${alpha(
                theme.palette.primary.main,
                0.9
              )}`,
            }),
            ...(isCurrentUserMentioned && {
              backgroundColor: alpha(theme.palette.warning.main, 0.06),
              boxShadow: `inset 3px 0 0 ${theme.palette.warning.main}`,
            }),
            ...(isOwn &&
              reticulumChatEnabled &&
              highlightOwnReticulumMessages &&
              !isOfficialGroupSystem &&
              !isScrollTarget && {
                backgroundColor: alpha(
                  theme.palette.mode === 'dark'
                    ? theme.palette.common.white
                    : theme.palette.common.black,
                  theme.palette.mode === 'dark' ? 0.028 : 0.025
                ),
              }),
            ...(isOwn &&
              !reticulumChatEnabled &&
              !isScrollTarget && {
                backgroundColor: alpha(theme.palette.primary.main, 0.045),
                ...(!reticulumChatEnabled
                  ? {
                      borderLeft: `2px solid ${alpha(theme.palette.primary.main, 0.5)}`,
                      paddingLeft: '14px',
                    }
                  : {}),
              }),
            ...(!isOwn &&
              !reticulumChatEnabled &&
              !isScrollTarget && {
                borderLeft: `2px solid ${alpha(theme.palette.text.secondary, 0.35)}`,
                paddingLeft: '14px',
              }),
            ...(isScrollTarget && {
              backgroundColor: alpha(theme.palette.primary.main, 0.07),
              ...(!reticulumChatEnabled
                ? {
                    borderLeft: `2px solid ${theme.palette.primary.main}`,
                    paddingLeft: '14px',
                  }
                : {}),
            }),
            ...(!isShowingAsReply && {
              '& .message-item-toolbar': {
                opacity: 0,
                pointerEvents: 'none',
              },
              '&:hover': {
                backgroundColor: reticulumChatEnabled
                  ? isOfficialGroupSystem || isCurrentUserMentioned
                    ? isCurrentUserMentioned
                      ? alpha(theme.palette.warning.main, 0.1)
                      : alpha(theme.palette.primary.main, 0.14)
                    : isOwn && highlightOwnReticulumMessages
                      ? alpha(
                          theme.palette.mode === 'dark'
                            ? theme.palette.common.white
                            : theme.palette.common.black,
                          theme.palette.mode === 'dark' ? 0.045 : 0.04
                        )
                      : alpha(theme.palette.text.primary, 0.035)
                  : undefined,
              },
              '&:hover .message-item-toolbar': {
                opacity: 1,
                pointerEvents: 'auto',
              },
            }),
          }}
          id={message?.signature}
        >
          {/* Left column: avatar + badge */}
          {isShowingAsReply ? (
            <ReplyIcon
              sx={{
                color: theme.palette.text.secondary,
                flexShrink: 0,
                fontSize: '18px',
                mt: '2px',
              }}
            />
          ) : isGroupedWithPrevious ? (
            <Box
              sx={{
                flexShrink: 0,
                width: reticulumMinterLevel !== null ? '44px' : '38px',
              }}
            />
          ) : (
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexDirection: 'column',
                flexShrink: 0,
                gap: '4px',
                paddingTop: '2px',
              }}
            >
              <WrapperUserAction
                disabled={
                  isOfficialGroupSystem ||
                  (!reticulumChatEnabled && myAddress === message?.sender)
                }
                address={message?.sender}
                name={message?.senderName}
                reticulumMenu={reticulumChatEnabled}
                reticulumSilenceContext={reticulumSilenceContext}
                reticulumUserCard={reticulumUserCard}
                trigger={reticulumChatEnabled ? 'contextMenu' : 'click'}
              >
                {isOfficialGroupSystem ? (
                  <Avatar
                    alt={displaySenderName}
                    src={userAvatarUrl}
                    sx={{
                      backgroundColor: 'transparent',
                      border: 'none',
                      borderRadius: 0,
                      boxShadow: 'none',
                      color:
                        theme.palette.mode === 'light'
                          ? theme.palette.primary.dark
                          : theme.palette.primary.light,
                      fontSize: '15px',
                      fontWeight: 700,
                      height: '38px',
                      overflow: 'visible',
                      width: '38px',
                      '& .MuiAvatar-img': {
                        borderRadius: 0,
                        objectFit: 'contain',
                      },
                    }}
                  >
                    {(officialGroupSystem?.groupName || 'G').charAt(0)}
                  </Avatar>
                ) : reticulumMinterLevel !== null ? (
                  <MinterAvatarOrnament
                    accentColor={
                      reticulumMemberRole ? reticulumMemberRoleColor : undefined
                    }
                    level={reticulumMinterLevel}
                  >
                    <PresenceStatusBadge
                      online={Boolean(senderStatus)}
                      status={senderStatus}
                    >
                      <Avatar
                        sx={{
                          backgroundColor: alpha(
                            theme.palette.text.primary,
                            0.06
                          ),
                          color: theme.palette.text.primary,
                          height: '38px',
                          width: '38px',
                          fontSize: '15px',
                          fontWeight: 600,
                          ...(!isAvatarLoaded
                            ? getFallbackAvatarOutlineSx(theme)
                            : {}),
                          ...getClickableAvatarSx(theme, isAvatarLoaded),
                        }}
                        alt={message?.senderName}
                        src={userAvatarUrl}
                        onClick={
                          reticulumChatEnabled ? undefined : handleAvatarPreview
                        }
                        imgProps={{
                          onLoad: () => {
                            setIsAvatarLoaded(true);
                          },
                          onError: () => {
                            setIsAvatarLoaded(false);
                          },
                        }}
                      >
                        {message?.senderName?.charAt(0)}
                      </Avatar>
                    </PresenceStatusBadge>
                  </MinterAvatarOrnament>
                ) : (
                  <PresenceStatusBadge
                    online={Boolean(senderStatus)}
                    status={senderStatus}
                  >
                    <Avatar
                      sx={{
                        backgroundColor: alpha(
                          theme.palette.text.primary,
                          0.06
                        ),
                        color: theme.palette.text.primary,
                        height: '38px',
                        width: '38px',
                        fontSize: '15px',
                        fontWeight: 600,
                        ...(!isAvatarLoaded
                          ? getFallbackAvatarOutlineSx(theme)
                          : {}),
                        ...getClickableAvatarSx(theme, isAvatarLoaded),
                      }}
                      alt={message?.senderName}
                      src={userAvatarUrl}
                      onClick={
                        reticulumChatEnabled ? undefined : handleAvatarPreview
                      }
                      imgProps={{
                        onLoad: () => {
                          setIsAvatarLoaded(true);
                        },
                        onError: () => {
                          setIsAvatarLoaded(false);
                        },
                      }}
                    >
                      {message?.senderName?.charAt(0)}
                    </Avatar>
                  </PresenceStatusBadge>
                )}
              </WrapperUserAction>
              {!reticulumChatEnabled && <UserBadge userInfo={userInfo} />}
            </Box>
          )}

          {/* Right column: header + body + reactions */}
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: isGroupedWithPrevious ? 0 : '4px',
              height: isShowingAsReply ? '40px' : undefined,
              minWidth: 0,
              width: '100%',
            }}
          >
            {/* Header: sender name + timestamp + edited label inline, toolbar on the right */}
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                justifyContent: 'space-between',
                height: collapseGroupedHeader ? 0 : undefined,
                minHeight: collapseGroupedHeader ? 0 : '32px',
                overflow: collapseGroupedHeader ? 'visible' : undefined,
                ...(collapseGroupedHeader
                  ? {
                      alignSelf: 'flex-end',
                      position: 'absolute',
                      right: '14px',
                      top: '1px',
                      width: 'auto',
                      zIndex: 3,
                    }
                  : {}),
              }}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px',
                  minWidth: 0,
                  display: collapseGroupedHeader ? 'none' : 'flex',
                }}
              >
                <WrapperUserAction
                  disabled={
                    isOfficialGroupSystem ||
                    (!reticulumChatEnabled && myAddress === message?.sender)
                  }
                  address={message?.sender}
                  name={message?.senderName}
                  reticulumMenu={reticulumChatEnabled}
                  reticulumSilenceContext={reticulumSilenceContext}
                  reticulumUserCard={reticulumUserCard}
                  trigger={reticulumChatEnabled ? 'contextMenu' : 'click'}
                >
                  <Typography
                    sx={{
                      color: reticulumChatEnabled
                        ? isOfficialGroupSystem
                          ? theme.palette.mode === 'light'
                            ? theme.palette.primary.dark
                            : theme.palette.primary.light
                          : reticulumMemberRoleColor
                        : isOwn
                          ? theme.palette.primary.main
                          : theme.palette.text.primary,
                      fontFamily: 'Inter',
                      fontSize: reticulumDiscussionView ? '18px' : '15.5px',
                      fontWeight: reticulumDiscussionView ? 700 : 600,
                      lineHeight: reticulumDiscussionView ? '22px' : 1.3,
                      letterSpacing: reticulumDiscussionView
                        ? '-0.015em'
                        : undefined,
                      maxWidth: reticulumChatEnabled
                        ? { xs: 170, sm: 260, md: 360 }
                        : undefined,
                      overflow: reticulumChatEnabled ? 'hidden' : undefined,
                      textOverflow: reticulumChatEnabled
                        ? 'ellipsis'
                        : undefined,
                      whiteSpace: reticulumChatEnabled ? 'nowrap' : undefined,
                      ...(hasUnsafeSenderName
                        ? {
                            textDecorationLine: 'line-through',
                            textDecorationThickness: '2px',
                            textDecorationColor: theme.palette.error.main,
                          }
                        : {}),
                    }}
                  >
                    {displaySenderName}
                  </Typography>
                </WrapperUserAction>

                {reticulumChatEnabled &&
                  !isOfficialGroupSystem &&
                  reticulumMemberRole && (
                    <ReticulumRoleBadge
                      color={reticulumMemberRoleColor}
                      role={reticulumMemberRole}
                      size={reticulumDiscussionView ? 'card' : 'message'}
                    />
                  )}

                {!isUpdating && !isTemp && (
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      flexShrink: 0,
                      fontFamily: 'Inter',
                      fontSize: reticulumDiscussionView ? '13px' : '11px',
                      fontWeight: reticulumDiscussionView ? 400 : undefined,
                      lineHeight: reticulumDiscussionView ? '18px' : 1,
                    }}
                  >
                    {displayTimestamp}
                  </Typography>
                )}

                {!collapseGroupedHeader && reticulumExpiringSoonLabel}

                {!collapseGroupedHeader && reticulumDiscussionButton}

                {message?.isEdit && !isUpdating && !isTemp && (
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      fontFamily: 'Inter',
                      fontSize: '11px',
                      fontStyle: 'italic',
                      lineHeight: 1,
                    }}
                  >
                    {t('core:message.generic.edited', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                )}
              </Box>

              {/* Action toolbar in header row so it never overlaps message body */}
              {!isShowingAsReply && !reticulumDiscussionView && (
                <Box
                  className="message-item-toolbar"
                  sx={{
                    alignItems: 'center',
                    backgroundColor: theme.palette.background.paper,
                    border: '1px solid',
                    borderColor: theme.palette.divider,
                    borderRadius: '8px',
                    boxShadow: theme.shadows[2],
                    display: 'flex',
                    flexShrink: 0,
                    gap: '2px',
                    padding: '3px 6px',
                    transition: 'opacity 0.15s ease',
                    zIndex: 2,
                  }}
                >
                  {reticulumChatEnabled &&
                    RETICULUM_QUICK_REACTIONS.map((emoji) => (
                      <Tooltip
                        key={emoji}
                        title={`React with ${emoji}`}
                        disableFocusListener
                      >
                        <ButtonBase
                          aria-label={`React with ${emoji}`}
                          sx={{
                            borderRadius: '6px',
                            fontSize: '18px',
                            lineHeight: 1,
                            padding: '4px',
                            '&:hover': {
                              backgroundColor: theme.palette.action.hover,
                            },
                          }}
                          onClick={() => {
                            const hasReacted = reactions?.[emoji]?.some(
                              (item) => item?.sender === myAddress
                            );
                            handleReaction(emoji, message, !hasReacted);
                          }}
                        >
                          {emoji}
                        </ButtonBase>
                      </Tooltip>
                    ))}

                  {handleReaction && (
                    <ReactionPicker
                      neutralIcon={reticulumChatEnabled}
                      onReaction={(val) => {
                        if (
                          reactions &&
                          reactions[val] &&
                          reactions[val]?.find(
                            (item) => item?.sender === myAddress
                          )
                        ) {
                          handleReaction(val, message, false);
                        } else {
                          handleReaction(val, message, true);
                        }
                      }}
                    />
                  )}

                  {isOwnReticulumEditable && (
                    <Tooltip
                      title={t('core:action.edit', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                      disableFocusListener
                    >
                      <ButtonBase
                        sx={{
                          borderRadius: '6px',
                          color: theme.palette.text.secondary,
                          padding: '4px',
                          '&:hover': {
                            backgroundColor: theme.palette.action.hover,
                            color: theme.palette.text.primary,
                          },
                        }}
                        onClick={() => {
                          onEdit(message);
                        }}
                      >
                        <EditIcon sx={{ fontSize: '18px' }} />
                      </ButtonBase>
                    </Tooltip>
                  )}

                  <Tooltip
                    title={t('core:action.reply', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    disableFocusListener
                  >
                    <ButtonBase
                      sx={{
                        borderRadius: '6px',
                        color: theme.palette.text.secondary,
                        padding: '4px',
                        '&:hover': {
                          backgroundColor: theme.palette.action.hover,
                          color: theme.palette.text.primary,
                        },
                      }}
                      onClick={() => {
                        onReply(message);
                      }}
                    >
                      <ReplyIcon sx={{ fontSize: '18px' }} />
                    </ButtonBase>
                  </Tooltip>

                  {isOwnReticulumDeletable && (
                    <Tooltip
                      title={t('group:message_item.delete_shortcut')}
                      disableFocusListener
                    >
                      <ButtonBase
                        sx={{
                          borderRadius: '6px',
                          color: theme.palette.error.main,
                          padding: '4px',
                          '&:hover': {
                            backgroundColor: theme.palette.action.hover,
                            color: theme.palette.error.light,
                          },
                        }}
                        onClick={() => {
                          onDelete(message);
                        }}
                      >
                        <DeleteOutlineIcon sx={{ fontSize: '18px' }} />
                      </ButtonBase>
                    </Tooltip>
                  )}
                </Box>
              )}
            </Box>

            {/* Reply preview - active reply */}
            {showReplyPreview && reply && (
              <ButtonBase
                className={
                  reticulumChatEnabled
                    ? 'reticulum-inline-reply-card'
                    : undefined
                }
                sx={{
                  borderLeft: reticulumChatEnabled
                    ? `4px solid ${theme.palette.warning.main}`
                    : isRepliedToMe
                      ? `2px solid ${theme.palette.warning.main}`
                      : `2px solid ${alpha(theme.palette.primary.main, 0.5)}`,
                  backgroundColor: reticulumChatEnabled
                    ? theme.palette.mode === 'dark'
                      ? '#17181d'
                      : theme.palette.background.paper
                    : isRepliedToMe
                      ? alpha(theme.palette.warning.main, 0.06)
                      : 'transparent',
                  borderRadius: reticulumChatEnabled ? '9px' : '0 6px 6px 0',
                  ...(reticulumChatEnabled
                    ? {
                        borderBottom: `1px solid ${alpha(theme.palette.divider, 0.72)}`,
                        borderRight: `1px solid ${alpha(theme.palette.divider, 0.72)}`,
                        borderTop: `1px solid ${alpha(theme.palette.divider, 0.72)}`,
                      }
                    : {}),
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'row',
                  justifyContent: 'flex-start',
                  marginTop: reticulumChatEnabled ? '5px' : '4px',
                  marginBottom: reticulumChatEnabled ? '8px' : '6px',
                  marginLeft: '2px',
                  height:
                    !reticulumChatEnabled && isRepliedToMe ? '72px' : undefined,
                  maxHeight: reticulumChatEnabled ? '92px' : '72px',
                  minHeight: reticulumChatEnabled ? '72px' : undefined,
                  minWidth: reticulumChatEnabled ? 'min(540px, 100%)' : 0,
                  maxWidth: '100%',
                  overflow: 'hidden',
                  padding: reticulumChatEnabled
                    ? '10px 100px 10px 14px'
                    : '4px 0 4px 10px',
                  position: 'relative',
                  textAlign: 'left',
                  transition:
                    'background-color 0.15s ease, border-color 0.15s ease, opacity 0.1s ease',
                  width: reticulumChatEnabled ? 'fit-content' : 'auto',
                  alignSelf: reticulumChatEnabled ? 'flex-start' : 'stretch',
                  boxSizing: 'border-box',
                  opacity: reticulumChatEnabled ? 1 : isRepliedToMe ? 1 : 0.72,
                  '& *': {
                    cursor: 'pointer',
                  },
                  '&:hover': {
                    opacity: 1,
                    ...(reticulumChatEnabled
                      ? {
                          backgroundColor: alpha(
                            theme.palette.text.primary,
                            theme.palette.mode === 'dark' ? 0.055 : 0.035
                          ),
                          borderColor: alpha(theme.palette.warning.main, 0.36),
                        }
                      : {}),
                  },
                }}
                onClick={() => {
                  scrollToItem(replyIndex);
                }}
              >
                {reticulumChatEnabled && (
                  <FormatQuoteRoundedIcon
                    aria-hidden
                    sx={{
                      color: alpha(theme.palette.text.secondary, 0.7),
                      fontSize: '24px',
                      position: 'absolute',
                      right: 16,
                      top: 10,
                    }}
                  />
                )}
                <Box sx={{ minWidth: 0, overflow: 'hidden', width: '100%' }}>
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: '6px',
                      marginBottom: '2px',
                    }}
                  >
                    <ReplyIcon
                      sx={{
                        color: isRepliedToMe
                          ? theme.palette.warning.main
                          : theme.palette.mode === 'light'
                            ? theme.palette.text.primary
                            : theme.palette.primary.main,
                        fontSize: reticulumChatEnabled ? '17px' : '14px',
                        flexShrink: 0,
                      }}
                    />
                    <Typography
                      sx={{
                        color: isRepliedToMe
                          ? theme.palette.warning.main
                          : theme.palette.mode === 'light'
                            ? theme.palette.text.primary
                            : theme.palette.primary.main,
                        fontSize: reticulumChatEnabled ? '14px' : '13px',
                        fontWeight: reticulumChatEnabled
                          ? 650
                          : isRepliedToMe
                            ? 600
                            : 500,
                        ...(hasUnsafeReplyName
                          ? {
                              textDecorationLine: 'line-through',
                              textDecorationThickness: '2px',
                              textDecorationColor: theme.palette.error.main,
                            }
                          : {}),
                      }}
                    >
                      {reticulumChatEnabled
                        ? isRepliedToMe
                          ? t('group:message_item.replying_to_you')
                          : `Replying to ${
                              reply?.senderName ||
                              reply?.senderAddress ||
                              'message'
                            }`
                        : isRepliedToMe
                          ? t('core:message.generic.replied_to_you', {
                              postProcess: 'capitalizeFirstChar',
                            })
                          : t('core:message.generic.replied_to', {
                              person: reply?.senderName || reply?.senderAddress,
                              postProcess: 'capitalizeFirstChar',
                            })}
                    </Typography>
                  </Box>

                  {reticulumChatEnabled ? (
                    htmlReply ? (
                      <MessageDisplay
                        isReply
                        htmlContent={htmlReply}
                        privilegedMentionAuthorized={
                          reply?.privilegedMentionAuthorized === true
                        }
                        reticulumChannelLinkAccess={reticulumChannelLinkAccess}
                      />
                    ) : reply?.decryptedData?.type === 'notification' ? (
                      <MessageDisplay
                        isReply
                        htmlContent={reply.decryptedData?.data?.message}
                        privilegedMentionAuthorized={
                          reply?.privilegedMentionAuthorized === true
                        }
                        reticulumChannelLinkAccess={reticulumChannelLinkAccess}
                      />
                    ) : reply?.text ? (
                      <MessageDisplay
                        isReply
                        htmlContent={reply.text}
                        privilegedMentionAuthorized={
                          reply?.privilegedMentionAuthorized === true
                        }
                        reticulumChannelLinkAccess={reticulumChannelLinkAccess}
                      />
                    ) : null
                  ) : (
                    <>
                      {reply?.messageText && (
                        <MessageDisplay isReply htmlContent={htmlReply} />
                      )}
                      {reply?.decryptedData?.type === 'notification' ? (
                        <MessageDisplay
                          isReply
                          htmlContent={reply.decryptedData?.data?.message}
                        />
                      ) : (
                        <MessageDisplay isReply htmlContent={reply.text} />
                      )}
                    </>
                  )}
                </Box>
              </ButtonBase>
            )}

            {/* Reply preview - expired/missing reply */}
            {showReplyPreview &&
              !reply &&
              (replyExpiredMeta || message?.repliedTo) && (
                <Box
                  sx={{
                    borderLeft: isRepliedToMe
                      ? `2px solid ${theme.palette.warning.main}`
                      : `2px solid ${alpha(theme.palette.text.secondary, 0.4)}`,
                    backgroundColor: isRepliedToMe
                      ? alpha(theme.palette.warning.main, 0.06)
                      : 'transparent',
                    borderRadius: '0 6px 6px 0',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'row',
                    marginTop: '4px',
                    marginBottom: '6px',
                    marginLeft: '2px',
                    height: isRepliedToMe ? '72px' : undefined,
                    maxHeight: '72px',
                    minWidth: 0,
                    overflow: 'hidden',
                    padding: '4px 0 4px 10px',
                    width: 'auto',
                    alignSelf: 'stretch',
                    boxSizing: 'border-box',
                    opacity: isRepliedToMe ? 1 : 0.6,
                    '& *': {
                      cursor: 'pointer',
                    },
                  }}
                >
                  <Box sx={{ minWidth: 0, overflow: 'hidden', width: '100%' }}>
                    <Box
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        gap: '6px',
                        marginBottom: '2px',
                      }}
                    >
                      <ReplyIcon
                        sx={{
                          color:
                            theme.palette.mode === 'light'
                              ? theme.palette.text.primary
                              : theme.palette.text.secondary,
                          fontSize: '14px',
                          flexShrink: 0,
                        }}
                      />
                      <Typography
                        sx={{
                          color:
                            theme.palette.mode === 'light'
                              ? theme.palette.text.primary
                              : theme.palette.text.secondary,
                          fontSize: '13px',
                          fontWeight: 500,
                          ...(hasUnsafeExpiredReplyName
                            ? {
                                textDecorationLine: 'line-through',
                                textDecorationThickness: '2px',
                                textDecorationColor: theme.palette.error.main,
                              }
                            : {}),
                        }}
                      >
                        {replyExpiredMeta?.deleted === true
                          ? t(
                              'core:message.generic.replied_to_deleted_message',
                              {
                                defaultValue: t(
                                  'group:message_item.replied_to_deleted'
                                ),
                              }
                            )
                          : replyExpiredMeta?.senderName ||
                              replyExpiredMeta?.sender
                            ? t('core:message.generic.replied_to', {
                                person:
                                  replyExpiredMeta?.senderName ||
                                  replyExpiredMeta?.sender,
                                postProcess: 'capitalizeFirstChar',
                              })
                            : t('core:message.generic.replied_to', {
                                person: t('core:message.error.missing_fields', {
                                  fields: t('core:message.message'),
                                }),
                                postProcess: 'capitalizeFirstChar',
                              })}
                      </Typography>
                    </Box>

                    {reticulumChatEnabled ? (
                      htmlReplyExpired ? (
                        <MessageDisplay
                          isReply
                          htmlContent={htmlReplyExpired}
                          reticulumChannelLinkAccess={
                            reticulumChannelLinkAccess
                          }
                        />
                      ) : replyExpiredMeta?.text ? (
                        <MessageDisplay
                          isReply
                          htmlContent={replyExpiredMeta.text}
                          reticulumChannelLinkAccess={
                            reticulumChannelLinkAccess
                          }
                        />
                      ) : null
                    ) : (
                      <>
                        {replyExpiredMeta?.messageText && (
                          <MessageDisplay
                            isReply
                            htmlContent={htmlReplyExpired}
                          />
                        )}
                        {replyExpiredMeta?.text && (
                          <MessageDisplay
                            isReply
                            htmlContent={replyExpiredMeta.text}
                          />
                        )}
                      </>
                    )}
                  </Box>
                </Box>
              )}

            {reticulumChatEnabled && reticulumInviteSource && (
              <>
                <ReticulumGroupInvitePreviews source={reticulumInviteSource} />
                <ReticulumQAppLinkPreviews source={reticulumInviteSource} />
              </>
            )}
            <ReticulumEventLinkPreviews source={deferredMessage} />

            {/* Message body - show only one of htmlText or message.text to avoid duplicate for open groups */}
            {qchatFileTransfer ? (
              <Box
                sx={{
                  alignItems: 'center',
                  border: '1px solid',
                  borderColor: theme.palette.divider,
                  borderRadius: '8px',
                  display: 'flex',
                  gap: '10px',
                  maxWidth: 420,
                  p: 1.25,
                }}
              >
                <InsertDriveFileRoundedIcon
                  sx={{ color: theme.palette.text.secondary, flexShrink: 0 }}
                />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography
                    sx={{
                      fontSize: 13,
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {qchatFileData?.fileName ||
                      t('group:message_item.file_transfer')}
                  </Typography>
                  <Typography
                    sx={{
                      color: qchatTransferError
                        ? theme.palette.error.main
                        : theme.palette.text.secondary,
                      fontSize: 12,
                    }}
                  >
                    {formatQchatFileSize(qchatFileData?.size)} ·{' '}
                    {qchatStatusText}
                  </Typography>
                  {qchatExpiryText && (
                    <Typography
                      sx={{
                        color:
                          qchatMsLeft === 0
                            ? theme.palette.error.main
                            : theme.palette.text.secondary,
                        fontSize: 11,
                        mt: 0.25,
                      }}
                    >
                      expires: {qchatExpiryText}
                    </Typography>
                  )}
                  {(qchatProgress !== null ||
                    qchatTransferBusy ||
                    (qchatTransferDone && !qchatDownloaded)) &&
                    !qchatTransferError && (
                      <LinearProgress
                        variant={
                          qchatProgress !== null
                            ? 'determinate'
                            : 'indeterminate'
                        }
                        value={
                          qchatTransferDone ? 100 : (qchatProgress ?? undefined)
                        }
                        color="primary"
                        sx={{
                          mt: 0.75,
                          height: 4,
                          borderRadius: 1,
                        }}
                      />
                    )}
                </Box>
                {!isOwn && isQchatFileOffer && onAcceptQchatFileTransfer && (
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<DownloadRoundedIcon />}
                    disabled={
                      qchatTransferBusy ||
                      qchatTransferDone ||
                      qchatOfferExpired
                    }
                    onClick={() => onAcceptQchatFileTransfer(message)}
                    sx={{ flexShrink: 0, textTransform: 'none' }}
                  >
                    {qchatDownloaded
                      ? 'Downloaded'
                      : qchatOfferExpired
                        ? 'Expired'
                        : 'Accept'}
                  </Button>
                )}
              </Box>
            ) : message?.decryptedData?.type === 'notification' ? (
              <MessageDisplay
                htmlContent={message.decryptedData?.data?.message}
                trailingContent={
                  collapseGroupedHeader ? reticulumExpiringSoonLabel : null
                }
                mentionedAddresses={mentionedAddresses}
                mentionUsers={reticulumMentionUsers}
                myAddress={myAddress}
                privilegedMentionAuthorized={
                  message?.privilegedMentionAuthorized === true
                }
                reticulumChannelLinkAccess={reticulumChannelLinkAccess}
              />
            ) : hasNoMessage ? null : htmlText ? (
              <MessageDisplay
                htmlContent={htmlText}
                trailingContent={
                  collapseGroupedHeader ? reticulumExpiringSoonLabel : null
                }
                hiddenQortalUrls={reticulumHiddenPreviewLinks}
                mentionedAddresses={mentionedAddresses}
                mentionUsers={reticulumMentionUsers}
                myAddress={myAddress}
                privilegedMentionAuthorized={
                  message?.privilegedMentionAuthorized === true
                }
                reticulumChannelLinkAccess={reticulumChannelLinkAccess}
                textColor={
                  isOfficialGroupSystem
                    ? theme.palette.mode === 'light'
                      ? theme.palette.primary.dark
                      : theme.palette.primary.light
                    : undefined
                }
              />
            ) : (
              <MessageDisplay
                htmlContent={message.text}
                trailingContent={
                  collapseGroupedHeader ? reticulumExpiringSoonLabel : null
                }
                hiddenQortalUrls={reticulumHiddenPreviewLinks}
                mentionedAddresses={mentionedAddresses}
                mentionUsers={reticulumMentionUsers}
                myAddress={myAddress}
                privilegedMentionAuthorized={
                  message?.privilegedMentionAuthorized === true
                }
                reticulumChannelLinkAccess={reticulumChannelLinkAccess}
                textColor={
                  isOfficialGroupSystem
                    ? theme.palette.mode === 'light'
                      ? theme.palette.primary.dark
                      : theme.palette.primary.light
                    : undefined
                }
              />
            )}

            {hasNoMessage && (
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: '8px',
                }}
              >
                <CommentsDisabledIcon
                  color="primary"
                  sx={{ fontSize: '18px' }}
                />
                <Typography color="primary" sx={{ fontSize: '14px' }}>
                  {t('core:message.generic.no_message', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
              </Box>
            )}

            {(displayImageUrl ||
              (isReticulumResourceImage && shouldAutoDownloadReticulumImage)) &&
              (displayImageUrl &&
              (localResourceImageUrl ||
                displayImageUrl.startsWith('data:image/')) ? (
                <Box
                  sx={{
                    aspectRatio: imageResourceAspectRatio,
                    alignSelf: 'flex-start',
                    borderRadius: '8px',
                    contain: 'layout paint',
                    isolation: 'isolate',
                    margin: '8px 0 0',
                    overflow: 'hidden',
                    width: `min(100%, ${imageResourceDisplayWidth}px)`,
                  }}
                >
                  <Box
                    component="img"
                    src={displayImageUrl}
                    alt={reticulumImageFileName}
                    loading="lazy"
                    decoding="async"
                    onClick={(event) => {
                      if (canOpenReticulumImage) {
                        void openReticulumImageViewer(
                          event.currentTarget.closest(
                            '[data-reticulum-chat-root="true"]'
                          ) as HTMLElement | null
                        );
                      }
                    }}
                    onError={() => {
                      if (!isReticulumResourceImage || !localResourceImageUrl)
                        return;
                      setLocalResourceImageUrl(null);
                      setResourceReloadNonce((value) => value + 1);
                    }}
                    onLoad={(event) => {
                      const width = Number(
                        event.currentTarget.naturalWidth || 0
                      );
                      const height = Number(
                        event.currentTarget.naturalHeight || 0
                      );
                      if (
                        !Number.isFinite(width) ||
                        !Number.isFinite(height) ||
                        width <= 0 ||
                        height <= 0
                      ) {
                        return;
                      }
                      setLoadedResourceImageSize((previous) =>
                        previous?.width === width && previous?.height === height
                          ? previous
                          : { width, height }
                      );
                    }}
                    sx={{
                      cursor: canOpenReticulumImage ? 'pointer' : 'default',
                      display: 'block',
                      height: '100%',
                      objectFit: 'contain',
                      width: '100%',
                    }}
                  />
                </Box>
              ) : imageEmbedLink ? (
                <Embed embedLink={imageEmbedLink} />
              ) : isReticulumResourceImage &&
                shouldAutoDownloadReticulumImage ? (
                <Box
                  sx={{
                    alignItems: 'center',
                    aspectRatio: imageResourceAspectRatio,
                    backgroundColor: alpha(theme.palette.text.primary, 0.045),
                    border: '1px solid',
                    borderColor: alpha(theme.palette.text.primary, 0.08),
                    borderRadius: '8px',
                    color: theme.palette.text.secondary,
                    display: 'flex',
                    justifyContent: 'center',
                    marginTop: '8px',
                    maxHeight: 360,
                    minHeight: 96,
                    overflow: 'hidden',
                    position: 'relative',
                    width: `min(100%, ${imageResourceDisplayWidth}px)`,
                  }}
                >
                  {reticulumImageDownloadIssue ? (
                    <Box
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        padding: '16px',
                        textAlign: 'center',
                      }}
                    >
                      <Typography
                        sx={{
                          color: theme.palette.text.primary,
                          fontSize: '13px',
                          fontWeight: 500,
                          lineHeight: 1.35,
                        }}
                      >
                        {reticulumImageDownloadIssue === 'unavailable'
                          ? t('group:message_item.image_unavailable_no_peers')
                          : reticulumImageDownloadIssue === 'disk_full'
                            ? t('group:message_item.image_disk_full')
                            : t('group:message_item.image_download_failed')}
                      </Typography>
                      <Button
                        size="small"
                        onClick={retryReticulumImageDownload}
                        sx={{
                          backgroundColor: alpha(
                            theme.palette.primary.main,
                            0.1
                          ),
                          borderRadius: '999px',
                          fontSize: '12px',
                          fontWeight: 600,
                          lineHeight: 1,
                          minWidth: 0,
                          padding: '7px 14px',
                          textTransform: 'none',
                          '&:hover': {
                            backgroundColor: alpha(
                              theme.palette.primary.main,
                              0.17
                            ),
                          },
                        }}
                      >
                        {t('group:message_item.try_again')}
                      </Button>
                    </Box>
                  ) : (
                    <>
                      <Typography sx={{ fontSize: '13px' }}>
                        Downloading image...
                      </Typography>
                      <LinearProgress
                        sx={{
                          bottom: 0,
                          left: 0,
                          position: 'absolute',
                          right: 0,
                        }}
                      />
                    </>
                  )}
                </Box>
              ) : null)}

            {reticulumDownloadAttachment && (
              <Box
                sx={{
                  alignItems: 'center',
                  backgroundColor:
                    theme.palette.mode === 'dark'
                      ? alpha(theme.palette.common.white, 0.035)
                      : alpha(theme.palette.common.black, 0.025),
                  border: '1px solid',
                  borderColor:
                    theme.palette.mode === 'dark'
                      ? alpha(theme.palette.text.secondary, 0.23)
                      : alpha(theme.palette.text.primary, 0.16),
                  borderRadius: '12px',
                  boxSizing: 'border-box',
                  boxShadow:
                    theme.palette.mode === 'dark'
                      ? '0 8px 24px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.018)'
                      : '0 8px 24px rgba(32, 42, 58, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.45)',
                  columnGap: '18px',
                  display: 'grid',
                  gridTemplateColumns: '56px minmax(0, 1fr) auto',
                  marginTop: '4px',
                  maxWidth: '640px',
                  minHeight: '100px',
                  overflow: 'hidden',
                  padding: '18px 20px',
                  position: 'relative',
                  transition:
                    'background-color 150ms ease, border-color 150ms ease',
                  width: 'min(100%, 640px)',
                  '&:hover': {
                    backgroundColor:
                      theme.palette.mode === 'dark'
                        ? alpha(theme.palette.common.white, 0.055)
                        : alpha(theme.palette.primary.main, 0.045),
                    borderColor: alpha(theme.palette.primary.main, 0.38),
                  },
                  '@media (max-width: 600px)': {
                    columnGap: '14px',
                    gridTemplateColumns: '48px minmax(0, 1fr) auto',
                    padding: '15px',
                  },
                  '@media (max-width: 460px)': {
                    gridTemplateColumns: '48px minmax(0, 1fr)',
                  },
                }}
              >
                <Box
                  aria-hidden="true"
                  sx={{
                    alignItems: 'center',
                    alignSelf: 'center',
                    backgroundColor:
                      theme.palette.mode === 'dark'
                        ? alpha(theme.palette.text.secondary, 0.13)
                        : alpha(theme.palette.text.primary, 0.07),
                    border: '1px solid',
                    borderColor:
                      theme.palette.mode === 'dark'
                        ? alpha(theme.palette.text.secondary, 0.12)
                        : alpha(theme.palette.text.primary, 0.09),
                    borderRadius: '10px',
                    display: 'flex',
                    height: '56px',
                    justifyContent: 'center',
                    width: '56px',
                    '@media (max-width: 600px)': {
                      height: '48px',
                      width: '48px',
                    },
                  }}
                >
                  <InsertDriveFileRoundedIcon
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '30px',
                      '@media (max-width: 600px)': {
                        fontSize: '26px',
                      },
                    }}
                  />
                </Box>
                <Box
                  sx={{
                    alignSelf: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    minWidth: 0,
                  }}
                >
                  <Tooltip
                    arrow
                    disableFocusListener={false}
                    title={reticulumFileName}
                  >
                    <Typography
                      component="span"
                      tabIndex={0}
                      sx={{
                        color: theme.palette.text.primary,
                        fontSize: '17px',
                        fontWeight: 700,
                        letterSpacing: '-0.018em',
                        lineHeight: '22px',
                        outline: 'none',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        '&:focus-visible': {
                          borderRadius: '3px',
                          boxShadow: `0 0 0 2px ${alpha(
                            theme.palette.primary.main,
                            0.65
                          )}`,
                        },
                      }}
                    >
                      {reticulumFileName}
                    </Typography>
                  </Tooltip>
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '10px',
                      marginTop: '6px',
                      minWidth: 0,
                    }}
                  >
                    <Typography
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: '13.5px',
                        fontWeight: 400,
                        lineHeight: '18px',
                      }}
                    >
                      {formatQchatFileSize(reticulumFileSize)}
                    </Typography>
                    <Box
                      aria-hidden="true"
                      sx={{
                        backgroundColor: theme.palette.text.disabled,
                        borderRadius: '50%',
                        height: '3px',
                        width: '3px',
                      }}
                    />
                    <Box
                      aria-label={fileResourceStatusLabel}
                      title={fileResourceStatusText}
                      sx={{
                        alignItems: 'center',
                        backgroundColor:
                          theme.palette.mode === 'dark'
                            ? alpha(theme.palette.common.white, 0.055)
                            : alpha(theme.palette.common.black, 0.045),
                        border: '1px solid',
                        borderColor:
                          theme.palette.mode === 'dark'
                            ? alpha(theme.palette.common.white, 0.055)
                            : alpha(theme.palette.common.black, 0.055),
                        borderRadius: '999px',
                        color:
                          fileResourceStatus === 'error' ||
                          fileResourceUnavailableNoPeers ||
                          fileResourceFailureReason === 'verification_failed'
                            ? theme.palette.error.main
                            : theme.palette.text.secondary,
                        display: 'inline-flex',
                        fontSize: '13px',
                        fontWeight: 400,
                        gap: '8px',
                        height: '26px',
                        lineHeight: 1,
                        maxWidth: '100%',
                        padding: '0 12px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <Box
                        aria-hidden="true"
                        sx={{
                          backgroundColor:
                            fileResourceStatus === 'ready'
                              ? theme.palette.success.main
                              : fileResourceStatus === 'downloading' ||
                                  fileResourceStatus === 'saving'
                                ? theme.palette.primary.main
                                : fileResourceStatus === 'error' ||
                                    fileResourceUnavailableNoPeers ||
                                    fileResourceFailureReason ===
                                      'verification_failed'
                                  ? theme.palette.error.main
                                  : theme.palette.text.disabled,
                          borderRadius: '50%',
                          flexShrink: 0,
                          height: '7px',
                          width: '7px',
                        }}
                      />
                      <Box
                        component="span"
                        sx={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {fileResourceStatusLabel}
                      </Box>
                    </Box>
                  </Box>
                </Box>
                <Box
                  sx={{
                    alignItems: 'center',
                    alignSelf: 'center',
                    display: 'flex',
                    flexShrink: 0,
                    gap: '8px',
                    justifyContent: 'flex-end',
                    '@media (max-width: 460px)': {
                      gridColumn: '1 / -1',
                      marginTop: '12px',
                      width: '100%',
                    },
                  }}
                >
                  {fileResourceStatus === 'downloading' &&
                  !fileResourceUnavailableNoPeers ? (
                    <Button
                      size="small"
                      variant="outlined"
                      color="inherit"
                      startIcon={<CancelRoundedIcon />}
                      onClick={() => {
                        void cancelReticulumFileResource();
                      }}
                      aria-label={fileResourceActionAriaLabel}
                      sx={{
                        borderRadius: '9px',
                        flexShrink: 0,
                        fontSize: '14px',
                        fontWeight: 600,
                        height: '42px',
                        minWidth: '128px',
                        padding: '0 18px',
                        textTransform: 'none',
                        '@media (max-width: 600px)': {
                          minWidth: '108px',
                        },
                        '@media (max-width: 460px)': {
                          width: '100%',
                        },
                      }}
                    >
                      Cancel
                    </Button>
                  ) : fileResourceStatus === 'ready' ? (
                    <>
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<OpenInNewRoundedIcon />}
                        onClick={() => {
                          setFileOpenError(null);
                          setIsFileOpenWarningOpen(true);
                        }}
                        aria-label={`Open ${reticulumFileName}, ${formatQchatFileSize(
                          reticulumFileSize
                        )}`}
                        sx={{
                          background:
                            'linear-gradient(180deg, #5b96ee 0%, #3f7ed8 100%)',
                          border: '1px solid #69a4f2',
                          borderRadius: '9px',
                          boxShadow:
                            '0 4px 12px rgba(46, 111, 207, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.14)',
                          color: '#ffffff',
                          flexShrink: 0,
                          fontSize: '14px',
                          fontWeight: 600,
                          height: '42px',
                          minWidth: '104px',
                          padding: '0 15px',
                          textTransform: 'none',
                          '&:hover': {
                            background:
                              'linear-gradient(180deg, #68a1f5 0%, #4a88e3 100%)',
                            borderColor: '#82b5f6',
                          },
                          '@media (max-width: 600px)': {
                            minWidth: '92px',
                          },
                          '@media (max-width: 460px)': {
                            flex: 1,
                          },
                        }}
                      >
                        Open
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="inherit"
                        startIcon={<DownloadRoundedIcon />}
                        onClick={() => {
                          void saveReticulumFileResource();
                        }}
                        aria-label={fileResourceActionAriaLabel}
                        sx={{
                          borderColor: alpha(theme.palette.text.primary, 0.3),
                          borderRadius: '9px',
                          flexShrink: 0,
                          fontSize: '14px',
                          fontWeight: 600,
                          height: '42px',
                          minWidth: '104px',
                          padding: '0 15px',
                          textTransform: 'none',
                          '&:hover': {
                            backgroundColor: alpha(
                              theme.palette.text.primary,
                              0.06
                            ),
                            borderColor: alpha(
                              theme.palette.text.primary,
                              0.45
                            ),
                          },
                          '@media (max-width: 600px)': {
                            minWidth: '92px',
                          },
                          '@media (max-width: 460px)': {
                            flex: 1,
                          },
                        }}
                      >
                        Save
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<DownloadRoundedIcon />}
                      disabled={fileResourceStatus === 'saving'}
                      onClick={() => {
                        if (fileResourceUnavailableNoPeers) {
                          void requestReticulumFileResource();
                          return;
                        }
                        void saveReticulumFileResource();
                      }}
                      aria-label={fileResourceActionAriaLabel}
                      sx={{
                        background:
                          'linear-gradient(180deg, #5b96ee 0%, #3f7ed8 100%)',
                        border: '1px solid #69a4f2',
                        borderRadius: '9px',
                        boxShadow:
                          '0 4px 12px rgba(46, 111, 207, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.14)',
                        color: '#ffffff',
                        flexShrink: 0,
                        fontSize: '14px',
                        fontWeight: 600,
                        height: '42px',
                        letterSpacing: '-0.005em',
                        lineHeight: 1,
                        minWidth: '128px',
                        padding: '0 18px',
                        textTransform: 'none',
                        '& .MuiButton-startIcon svg': {
                          fontSize: '20px',
                        },
                        '&:hover': {
                          background:
                            'linear-gradient(180deg, #68a1f5 0%, #4a88e3 100%)',
                          borderColor: '#82b5f6',
                          boxShadow:
                            '0 5px 14px rgba(46, 111, 207, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.16)',
                        },
                        '&:active': {
                          background: '#3772ca',
                          boxShadow: 'none',
                        },
                        '&:focus-visible': {
                          outline: `3px solid ${alpha(
                            theme.palette.primary.light,
                            0.55
                          )}`,
                          outlineOffset: '2px',
                        },
                        '&.Mui-disabled': {
                          background:
                            'linear-gradient(180deg, #5b96ee 0%, #3f7ed8 100%)',
                          color: '#ffffff',
                          opacity: 0.55,
                        },
                        '@media (max-width: 600px)': {
                          minWidth: '108px',
                        },
                        '@media (max-width: 460px)': {
                          width: '100%',
                        },
                      }}
                    >
                      {fileResourceActionLabel}
                    </Button>
                  )}
                </Box>
                {(fileResourceStatus === 'downloading' ||
                  fileResourceStatus === 'saving') && (
                  <LinearProgress
                    aria-hidden="true"
                    variant={
                      fileResourceProgress !== null
                        ? 'determinate'
                        : 'indeterminate'
                    }
                    value={fileResourceProgress ?? undefined}
                    sx={{
                      bottom: 0,
                      height: '2px',
                      left: 0,
                      position: 'absolute',
                      right: 0,
                      '& .MuiLinearProgress-bar': {
                        backgroundColor: theme.palette.primary.main,
                      },
                    }}
                  />
                )}
              </Box>
            )}

            {collapseGroupedHeader && reticulumDiscussionButton && (
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  marginTop: '4px',
                }}
              >
                {reticulumDiscussionButton}
              </Box>
            )}

            {/* Failure status. Reticulum sends and mutations update in place,
                so pending state must not add a transient status row. */}
            {(isUpdating || isTemp) &&
              (!reticulumChatEnabled ||
                message?.status === 'failed-permanent') && (
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    fontFamily: 'Inter',
                    fontSize: '12px',
                    fontStyle: 'italic',
                    marginTop: '2px',
                  }}
                >
                  {!isTemp
                    ? message?.status === 'failed-permanent'
                      ? t('core:message.error.update_failed', {
                          postProcess: 'capitalizeFirstChar',
                        })
                      : t('core:message.generic.updating', {
                          postProcess: 'capitalizeFirstChar',
                        })
                    : message?.status === 'failed-permanent'
                      ? t('core:message.error.send_failed', {
                          postProcess: 'capitalizeFirstChar',
                        })
                      : t('core:message.generic.sending', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                </Typography>
              )}

            {/* Reactions row */}
            {reactions &&
              Object.keys(reactions).some(
                (r) => (reactions[r]?.length ?? 0) > 0
              ) && (
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '4px',
                    marginTop: '4px',
                  }}
                >
                  {message?.isNotEncrypted &&
                    isPrivate &&
                    !reticulumChatEnabled && (
                      <Tooltip
                        title={t('group:message_item.unencrypted')}
                        disableFocusListener
                      >
                        <KeyOffIcon
                          sx={{
                            color: theme.palette.text.secondary,
                            fontSize: '16px',
                            mr: '4px',
                          }}
                        />
                      </Tooltip>
                    )}

                  {Object.keys(reactions).map((reaction) => {
                    const numberOfReactions = reactions[reaction]?.length;
                    if (numberOfReactions === 0) return null;
                    const isMine = !!reactions[reaction]?.find(
                      (item) => item?.sender === myAddress
                    );
                    return (
                      <ButtonBase
                        key={reaction}
                        sx={{
                          background: isMine
                            ? `${theme.palette.primary.main}22`
                            : theme.palette.background.surface,
                          border: '1px solid',
                          borderColor: isMine
                            ? theme.palette.primary.main
                            : theme.palette.divider,
                          borderRadius: '14px',
                          height: '28px',
                          minWidth: '44px',
                          padding: '0 10px',
                          transition:
                            'background-color 0.1s ease, border-color 0.1s ease',
                          '&:hover': {
                            backgroundColor: theme.palette.action.hover,
                          },
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleReaction(reaction, message, !isMine);
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setAnchorEl(event.currentTarget);
                          setSelectedReaction(reaction);
                        }}
                      >
                        <span style={{ fontSize: '14px', lineHeight: 1 }}>
                          {reaction}
                        </span>
                        {numberOfReactions > 1 && (
                          <Typography
                            sx={{
                              color: isMine
                                ? theme.palette.primary.main
                                : theme.palette.text.secondary,
                              fontFamily: 'Inter',
                              fontSize: '12px',
                              fontWeight: 600,
                              marginLeft: '4px',
                            }}
                          >
                            {numberOfReactions}
                          </Typography>
                        )}
                      </ButtonBase>
                    );
                  })}
                </Box>
              )}

            {/* KeyOff when no reactions to show it beside */}
            {message?.isNotEncrypted &&
              isPrivate &&
              !reticulumChatEnabled &&
              !(
                reactions &&
                Object.keys(reactions).some(
                  (r) => (reactions[r]?.length ?? 0) > 0
                )
              ) && (
                <Tooltip
                  title={t('group:message_item.unencrypted')}
                  disableFocusListener
                >
                  <KeyOffIcon
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '16px',
                      marginTop: '2px',
                    }}
                  />
                </Tooltip>
              )}

            {/* Reaction popover — zIndex 1400 so it appears above GlobalChatWidget (1300) */}
            {selectedReaction && (
              <Popper
                open={Boolean(anchorEl)}
                anchorEl={anchorEl}
                container={
                  anchorEl?.closest('[data-reticulum-chat-root="true"]') ||
                  undefined
                }
                modifiers={[
                  {
                    name: 'offset',
                    options: { offset: [0, 10] },
                  },
                  {
                    enabled: false,
                    name: 'flip',
                  },
                  {
                    name: 'preventOverflow',
                    options: {
                      altAxis: true,
                      mainAxis: false,
                      padding: 10,
                    },
                  },
                ]}
                placement="top-start"
                popperOptions={{ strategy: 'fixed' }}
                sx={{ zIndex: 1400 }}
              >
                <ClickAwayListener
                  onClickAway={() => {
                    setAnchorEl(null);
                    setSelectedReaction(null);
                  }}
                >
                  <Box
                    sx={{
                      backgroundColor:
                        theme.palette.mode === 'dark'
                          ? '#1e2027'
                          : theme.palette.background.paper,
                      backgroundImage: 'none',
                      border: '1px solid',
                      borderColor:
                        theme.palette.mode === 'dark'
                          ? '#3a414d'
                          : theme.palette.divider,
                      borderRadius: '10px',
                      boxShadow:
                        theme.palette.mode === 'dark'
                          ? '0 14px 32px rgba(0, 0, 0, 0.42)'
                          : theme.shadows[8],
                      maxWidth: '320px',
                      minWidth: '260px',
                      padding: '16px 16px 12px',
                    }}
                  >
                    <Box
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        gap: '8px',
                        marginBottom: '12px',
                      }}
                    >
                      <Box
                        sx={{
                          alignItems: 'center',
                          backgroundColor: theme.palette.action.hover,
                          borderRadius: '8px',
                          display: 'flex',
                          fontSize: '18px',
                          height: '36px',
                          justifyContent: 'center',
                          width: '36px',
                        }}
                      >
                        {selectedReaction}
                      </Box>
                      <Typography
                        sx={{
                          fontSize: '14px',
                          fontWeight: 600,
                          color: theme.palette.text.primary,
                        }}
                      >
                        {t('core:message.generic.people_reaction', {
                          reaction: selectedReaction,
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>
                    </Box>

                    <List
                      disablePadding
                      sx={{
                        maxHeight: '240px',
                        overflow: 'auto',
                      }}
                    >
                      {reactions[selectedReaction]?.map((reactionItem) => {
                        const hasUnsafeReactionName = Boolean(
                          reactionItem.senderName &&
                          hasInvisibleCharacters(reactionItem.senderName)
                        );

                        return (
                          <ListItem
                            key={reactionItem.sender}
                            disablePadding
                            sx={{
                              borderRadius: '8px',
                              marginBottom: '2px',
                              '&:last-of-type': { marginBottom: 0 },
                              '&:hover': {
                                backgroundColor: theme.palette.action.hover,
                              },
                            }}
                          >
                            <ListItemText
                              primary={
                                reactionItem.senderName || reactionItem.sender
                              }
                              primaryTypographyProps={{
                                sx: {
                                  fontSize: '14px',
                                  fontWeight: 500,
                                  ...(hasUnsafeReactionName
                                    ? {
                                        textDecorationLine: 'line-through',
                                        textDecorationThickness: '2px',
                                        textDecorationColor:
                                          theme.palette.error.main,
                                      }
                                    : {}),
                                },
                              }}
                              sx={{ py: '8px', px: '12px' }}
                            />
                          </ListItem>
                        );
                      })}
                    </List>
                  </Box>
                </ClickAwayListener>
              </Popper>
            )}
          </Box>
        </Box>
        <AvatarPreviewModal
          open={isAvatarPreviewOpen}
          src={avatarPreviewSrc}
          alt={message?.senderName}
          onClose={closeAvatarPreview}
        />
        {canOpenReticulumImage && reticulumImageViewerSrc && (
          <ReticulumImageViewer
            alt={reticulumImageFileName}
            containerElement={reticulumImageViewerContainer}
            fileName={reticulumImageFileName}
            mimeType={reticulumImageMimeType}
            open={isReticulumImageViewerOpen}
            src={reticulumImageViewerSrc}
            onClose={() => {
              setIsReticulumImageViewerOpen(false);
              setReticulumImageViewerSrc(null);
            }}
          />
        )}
      </MessageWragger>
      <Dialog
        aria-describedby="reticulum-file-open-warning-description"
        aria-labelledby="reticulum-file-open-warning-title"
        maxWidth="xs"
        fullWidth
        open={isFileOpenWarningOpen}
        onClose={() => {
          if (isOpeningFile) return;
          setIsFileOpenWarningOpen(false);
          setFileOpenError(null);
        }}
        slotProps={{
          backdrop: {
            sx: {
              backgroundColor: 'rgba(3, 6, 12, 0.78)',
              backdropFilter: 'blur(2px)',
            },
          },
          paper: {
            sx: {
              backgroundColor: theme.palette.background.paper,
              backgroundImage:
                theme.palette.mode === 'dark'
                  ? `linear-gradient(180deg, ${alpha(
                      theme.palette.common.white,
                      0.035
                    )} 0%, transparent 100%)`
                  : 'none',
              border: '1px solid',
              borderColor: alpha(theme.palette.text.secondary, 0.22),
              borderRadius: '16px',
              boxShadow: '0 24px 70px rgba(0, 0, 0, 0.48)',
              overflow: 'hidden',
            },
          },
        }}
      >
        <DialogTitle
          id="reticulum-file-open-warning-title"
          sx={{
            alignItems: 'center',
            borderBottom: '1px solid',
            borderColor: alpha(theme.palette.text.secondary, 0.14),
            display: 'flex',
            fontSize: '18px',
            fontWeight: 750,
            gap: '12px',
            padding: '20px 22px 17px',
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              backgroundColor: alpha(theme.palette.warning.main, 0.12),
              border: '1px solid',
              borderColor: alpha(theme.palette.warning.main, 0.28),
              borderRadius: '10px',
              display: 'flex',
              flexShrink: 0,
              height: '38px',
              justifyContent: 'center',
              width: '38px',
            }}
          >
            <WarningAmberRoundedIcon
              sx={{ color: theme.palette.warning.main, fontSize: '22px' }}
            />
          </Box>
          Open attachment?
        </DialogTitle>
        <DialogContent sx={{ padding: '20px 22px 8px !important' }}>
          <Typography
            id="reticulum-file-open-warning-description"
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '14px',
              lineHeight: 1.6,
            }}
          >
            Attachments can contain harmful content. Only open this file if you
            trust who sent it and were expecting it.
          </Typography>
          <Box
            sx={{
              alignItems: 'center',
              backgroundColor: alpha(theme.palette.text.primary, 0.035),
              border: '1px solid',
              borderColor: alpha(theme.palette.text.secondary, 0.15),
              borderRadius: '11px',
              display: 'grid',
              gap: '12px',
              gridTemplateColumns: '38px minmax(0, 1fr)',
              marginTop: '17px',
              padding: '12px 14px',
            }}
          >
            <InsertDriveFileRoundedIcon
              sx={{ color: theme.palette.text.secondary, fontSize: '28px' }}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography
                title={reticulumFileName}
                sx={{
                  fontSize: '14px',
                  fontWeight: 650,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {reticulumFileName}
              </Typography>
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: '12px',
                  marginTop: '2px',
                }}
              >
                {formatQchatFileSize(reticulumFileSize)} · Opens with your
                default app
              </Typography>
            </Box>
          </Box>
          {fileOpenError && (
            <Box
              role="alert"
              sx={{
                backgroundColor: alpha(theme.palette.error.main, 0.09),
                border: '1px solid',
                borderColor: alpha(theme.palette.error.main, 0.24),
                borderRadius: '9px',
                color: theme.palette.error.light,
                fontSize: '13px',
                lineHeight: 1.45,
                marginTop: '13px',
                padding: '10px 12px',
              }}
            >
              {fileOpenError}
            </Box>
          )}
        </DialogContent>
        <DialogActions
          sx={{
            gap: '8px',
            padding: '14px 22px 20px',
          }}
        >
          <Button
            autoFocus
            color="inherit"
            disabled={isOpeningFile}
            onClick={() => {
              setIsFileOpenWarningOpen(false);
              setFileOpenError(null);
            }}
            sx={{
              borderRadius: '9px',
              color: theme.palette.text.secondary,
              fontWeight: 650,
              minHeight: '40px',
              minWidth: '96px',
              textTransform: 'none',
            }}
          >
            Cancel
          </Button>
          <Button
            disabled={isOpeningFile}
            startIcon={<OpenInNewRoundedIcon />}
            variant="contained"
            onClick={() => {
              void openReticulumFileResource();
            }}
            sx={{
              borderRadius: '9px',
              fontWeight: 650,
              minHeight: '40px',
              minWidth: '112px',
              textTransform: 'none',
            }}
          >
            {isOpeningFile ? 'Opening...' : t('group:message_item.open_file')}
          </Button>
        </DialogActions>
      </Dialog>
      <CustomStyledMenu
        reticulumMenu
        anchorReference="anchorPosition"
        anchorPosition={
          reticulumMessageMenuPosition
            ? {
                left: reticulumMessageMenuPosition.mouseX,
                top: reticulumMessageMenuPosition.mouseY,
              }
            : undefined
        }
        onClose={() => setReticulumMessageMenuPosition(null)}
        open={Boolean(reticulumMessageMenuPosition)}
        slotProps={{
          paper: {
            sx: {
              backdropFilter: 'none !important',
              background: 'transparent !important',
              backgroundColor: 'transparent !important',
              backgroundImage: 'none !important',
              border: 'none !important',
              borderRadius: '0 !important',
              boxShadow: 'none !important',
              minWidth: '190px !important',
              padding: '0 !important',
              WebkitBackdropFilter: 'none !important',
              '& .MuiMenu-list': {
                background: 'transparent !important',
                backgroundColor: 'transparent !important',
                backgroundImage: 'none !important',
              },
            },
          },
        }}
        MenuListProps={{
          sx: {
            background: 'transparent !important',
            backgroundColor: 'transparent !important',
            backgroundImage: 'none !important',
            padding: 0,
          },
        }}
      >
        <Box
          aria-label={t('group:message_item.quick_reactions')}
          role="group"
          sx={{
            alignItems: 'center',
            backgroundColor: theme.palette.background.surface,
            border: '1px solid',
            borderColor: theme.palette.divider,
            borderRadius: '8px',
            boxShadow: '0 12px 28px rgba(0, 0, 0, 0.28)',
            display: 'flex',
            gap: '8px',
            justifyContent: 'center',
            boxSizing: 'border-box',
            minWidth: '212px',
            padding: '7px 10px',
            width: '100%',
          }}
        >
          {RETICULUM_QUICK_REACTIONS.map((emoji) => (
            <Tooltip
              key={emoji}
              title={`React with ${emoji}`}
              disableFocusListener
            >
              <ButtonBase
                aria-label={`React with ${emoji}`}
                sx={{
                  borderRadius: '6px',
                  fontSize: '20px',
                  lineHeight: 1,
                  padding: '5px 8px',
                  '&:hover': {
                    backgroundColor: theme.palette.action.hover,
                  },
                }}
                onClick={() => {
                  const hasReacted = reactions?.[emoji]?.some(
                    (item) => item?.sender === myAddress
                  );
                  setReticulumMessageMenuPosition(null);
                  handleReaction(emoji, message, !hasReacted);
                }}
              >
                {emoji}
              </ButtonBase>
            </Tooltip>
          ))}
        </Box>
        <Box
          sx={{
            backgroundColor: theme.palette.background.surface,
            border: '1px solid',
            borderColor: theme.palette.divider,
            borderBottomColor: 'transparent',
            borderRadius: '8px',
            boxShadow: '0 12px 28px rgba(0, 0, 0, 0.28)',
            boxSizing: 'border-box',
            marginTop: '6px',
            minWidth: '212px',
            padding: '5px',
            width: '100%',
          }}
        >
          <MenuItem
            onClick={() => {
              setReticulumMessageMenuPosition(null);
              void copyReticulumMessage();
            }}
          >
            <ListItemIcon sx={{ minWidth: '32px' }}>
              <ContentCopyRoundedIcon fontSize="small" />
            </ListItemIcon>
            <Typography variant="inherit" sx={{ fontSize: '14px' }}>
              Copy Message
            </Typography>
          </MenuItem>
          <MenuItem
            onClick={() => {
              setReticulumMessageMenuPosition(null);
              onReply(message);
            }}
          >
            <ListItemIcon sx={{ minWidth: '32px' }}>
              <ReplyIcon fontSize="small" />
            </ListItemIcon>
            <Typography variant="inherit" sx={{ fontSize: '14px' }}>
              Reply Message
            </Typography>
          </MenuItem>
          {isOwnReticulumEditable && (
            <MenuItem
              onClick={() => {
                setReticulumMessageMenuPosition(null);
                onEdit(message);
              }}
            >
              <ListItemIcon sx={{ minWidth: '32px' }}>
                <EditIcon fontSize="small" />
              </ListItemIcon>
              <Typography variant="inherit" sx={{ fontSize: '14px' }}>
                Edit Message
              </Typography>
            </MenuItem>
          )}
          {isOwnReticulumDeletable && (
            <MenuItem
              onClick={() => {
                setReticulumMessageMenuPosition(null);
                onDelete(message);
              }}
              sx={{ color: 'error.main' }}
            >
              <ListItemIcon sx={{ color: 'inherit', minWidth: '32px' }}>
                <DeleteOutlineIcon fontSize="small" />
              </ListItemIcon>
              <Typography variant="inherit" sx={{ fontSize: '14px' }}>
                Delete Message
              </Typography>
            </MenuItem>
          )}
        </Box>
        <Box
          aria-label={
            hasReticulumExpiry
              ? `Message expires ${reticulumExpiryText}`
              : t('reticulum:expiry.no_expiry', {
                  postProcess: 'capitalizeEachFirstChar',
                })
          }
          role="status"
          sx={{
            boxSizing: 'border-box',
            marginTop: '6px',
            minWidth: '212px',
            width: '100%',
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              backgroundColor: hasReticulumExpiry
                ? `color-mix(in srgb, ${theme.palette.background.surface} 91%, ${theme.palette.error.main} 9%)`
                : theme.palette.background.surface,
              backgroundImage: 'none',
              border: '1px solid',
              borderColor: hasReticulumExpiry
                ? alpha(theme.palette.error.main, 0.4)
                : alpha(theme.palette.text.secondary, 0.28),
              borderRadius: '8px',
              boxSizing: 'border-box',
              display: 'grid',
              gridTemplateColumns: '42px 1px minmax(0, 1fr)',
              minHeight: '62px',
              padding: '8px 10px',
              isolation: 'isolate',
              width: '100%',
            }}
          >
            <Box
              alt=""
              aria-hidden="true"
              component="img"
              src={hasReticulumExpiry ? messageExpiresIcon : noExpiryIcon}
              sx={{
                display: 'block',
                filter: hasReticulumExpiry ? 'none' : 'brightness(1.2)',
                height: '34px',
                justifySelf: 'center',
                objectFit: 'contain',
                opacity: hasReticulumExpiry ? 0.94 : 0.9,
                width: '34px',
              }}
            />
            <Box
              aria-hidden="true"
              sx={{
                alignSelf: 'stretch',
                backgroundColor: hasReticulumExpiry
                  ? alpha(theme.palette.error.main, 0.48)
                  : alpha(theme.palette.text.secondary, 0.32),
                marginY: '2px',
                width: '1px',
              }}
            />
            <Box
              sx={{
                alignSelf: 'center',
                minWidth: 0,
                paddingLeft: '10px',
              }}
            >
              {hasReticulumExpiry ? (
                <>
                  <Typography
                    sx={{
                      color: alpha(theme.palette.error.light, 0.92),
                      fontSize: '11px',
                      fontWeight: 600,
                      lineHeight: 1.2,
                    }}
                  >
                    Message expires
                  </Typography>
                  <Typography
                    sx={{
                      color:
                        theme.palette.mode === 'dark'
                          ? theme.palette.common.white
                          : theme.palette.text.primary,
                      fontSize: '14px',
                      fontWeight: 600,
                      lineHeight: 1.35,
                      marginTop: '2px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {reticulumExpiryText}
                  </Typography>
                </>
              ) : (
                <Typography
                  sx={{
                    color:
                      theme.palette.mode === 'dark'
                        ? alpha(theme.palette.common.white, 0.8)
                        : theme.palette.text.secondary,
                    fontSize: '14px',
                    fontWeight: 600,
                    lineHeight: 1.35,
                    whiteSpace: 'nowrap',
                  }}
                >
                  No Expiry
                </Typography>
              )}
            </Box>
          </Box>
        </Box>
      </CustomStyledMenu>
    </>
  );
};

const MemoizedMessageItem = memo(MessageItemComponent);
MemoizedMessageItem.displayName = 'MessageItem'; // It ensures React DevTools shows MessageItem as the name (instead of "Anonymous" or "Memo")

export const MessageItem = MemoizedMessageItem;

export const ReplyPreview = ({
  message,
  isEdit = false,
  reticulumOnlyContent = false,
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core', 'group', 'question']);

  const replyMessageText = useMemo(() => {
    if (!message?.messageText) return null;
    const isHtml = isHtmlString(message?.messageText);
    if (isHtml) return message?.messageText;
    return normalizeMessageHtmlContent(message?.messageText);
  }, [message?.messageText]);

  if (isEdit) {
    return (
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: '6px',
          minHeight: '28px',
          padding: '4px 2px',
          width: '100%',
        }}
      >
        <EditIcon
          sx={{
            color: theme.palette.text.secondary,
            flexShrink: 0,
            fontSize: '14px',
          }}
        />
        <Typography
          sx={{
            color: theme.palette.text.secondary,
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
          }}
        >
          {t('core:message.generic.editing_message', {
            postProcess: 'capitalizeFirstChar',
          })}
          :
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        backgroundColor: theme.palette.background.surface,
        border: '1px solid',
        borderColor: theme.palette.divider,
        borderRadius: '0 8px 8px 0',
        cursor: 'pointer',
        display: 'flex',
        marginTop: '8px',
        maxHeight: '72px',
        overflow: 'hidden',
        width: '100%',
      }}
    >
      <Box
        sx={{
          background: theme.palette.primary.main,
          borderRadius: '4px 0 0 4px',
          flexShrink: 0,
          width: '4px',
        }}
      />
      <Box sx={{ padding: '8px 12px', minWidth: 0 }}>
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: '6px',
            marginBottom: '4px',
          }}
        >
          <ReplyIcon
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '14px',
              flexShrink: 0,
            }}
          />
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
            }}
          >
            {t('core:message.generic.replied_to', {
              person: message?.senderName || message?.senderAddress,
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </Box>

        {reticulumOnlyContent ? (
          replyMessageText ? (
            <MessageDisplay isReply htmlContent={replyMessageText} />
          ) : message?.decryptedData?.type === 'notification' ? (
            <MessageDisplay
              isReply
              htmlContent={message.decryptedData?.data?.message}
            />
          ) : message?.text ? (
            <MessageDisplay isReply htmlContent={message.text} />
          ) : null
        ) : (
          <>
            {replyMessageText && (
              <MessageDisplay isReply htmlContent={replyMessageText} />
            )}
            {message?.decryptedData?.type === 'notification' ? (
              <MessageDisplay
                isReply
                htmlContent={message.decryptedData?.data?.message}
              />
            ) : (
              <MessageDisplay isReply htmlContent={message.text} />
            )}
          </>
        )}
      </Box>
    </Box>
  );
};

const MessageWragger = ({ lastMessage, onSeen, isLast, children }) => {
  if (lastMessage) {
    return (
      <WatchComponent onSeen={onSeen} isLast={isLast}>
        {children}
      </WatchComponent>
    );
  }
  return children;
};

const WatchComponent = ({ onSeen, isLast, children }) => {
  const { ref, inView } = useInView({
    threshold: 0.7, // Fully visible
    triggerOnce: true, // Only trigger once when it becomes visible
    delay: 100,
    trackVisibility: false,
  });

  useEffect(() => {
    if (inView && isLast && onSeen) {
      setTimeout(() => {
        onSeen();
      }, 100);
    }
  }, [inView, isLast, onSeen]);

  return (
    <div
      ref={ref}
      style={{
        display: 'flex',
        justifyContent: 'center',
        width: '100%',
      }}
    >
      {children}
    </div>
  );
};
