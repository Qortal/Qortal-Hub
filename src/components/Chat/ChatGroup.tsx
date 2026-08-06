import {
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useAtom, useAtomValue, useStore } from 'jotai';
import { Rnd } from 'react-rnd';
import {
  userInfoAtom,
  balanceAtom,
  blockedAddressesAtom,
  groupQManagerPopupSizeAtom,
  reticulumChatTextScaleAtom,
  reticulumLegacyThreadsEnabledAtom,
  reticulumChatSummariesAtom,
  type ReticulumChatSummaryAtomEntry,
} from '../../atoms/global';
import {
  decodeBase64ForUIChatMessages,
  objectToBase64,
} from '../../qdn/encryption/group-encryption';
import { ChatList } from './ChatList';
import { AdminSpaceInner } from './AdminSpaceInner';
import Tiptap, { type MentionSuggestionItem } from './TipTap';
import { normalizeExactReticulumMentions } from './reticulumMentionNormalization';
import { shouldBlockChatForLowBalance } from './chatTransportBalance';
import './chat.css';
import { CustomButton } from '../../styles/App-styles';
import CircularProgress from '@mui/material/CircularProgress';
import { LoadingSnackbar } from '../Snackbar/LoadingSnackbar';
import { ReactionPicker } from '../ReactionPicker';
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
  TIME_DAYS_1_IN_MILLISECONDS,
  TIME_MONTHS_1_IN_MILLISECONDS,
  TIME_MINUTES_2_IN_MILLISECONDS,
} from '../../constants/constants';
import { useMessageQueue } from '../../messaging/MessageQueueContext.tsx';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import {
  Box,
  Button,
  ButtonBase,
  Chip,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  GlobalStyles,
  IconButton,
  InputAdornment,
  ListItemIcon,
  Menu,
  MenuItem,
  Popover,
  Portal,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ShortUniqueId from 'short-unique-id';
import { ReplyPreview } from './MessageItem';
import { ExitIcon } from '../../assets/Icons/ExitIcon';
import { RESOURCE_TYPE_NUMBER_GROUP_CHAT_REACTIONS } from '../../constants/constants';
import { getFee, isExtMsg } from '../../background/background.ts';
import { appHeighOffset, appHeighOffsetPx } from '../Desktop/CustomTitleBar';
import AppViewerContainer from '../Apps/AppViewerContainer';
import CloseIcon from '@mui/icons-material/Close';
import { throttle } from 'lodash';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CallIcon from '@mui/icons-material/Call';
import CallEndRoundedIcon from '@mui/icons-material/CallEndRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import EmojiEmotionsRoundedIcon from '@mui/icons-material/EmojiEmotionsRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import ImageIcon from '@mui/icons-material/Image';
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded';
import FolderRoundedIcon from '@mui/icons-material/FolderRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import SendIcon from '@mui/icons-material/Send';
import SecurityRoundedIcon from '@mui/icons-material/SecurityRounded';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import TagRoundedIcon from '@mui/icons-material/TagRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import { ContextMenu, CustomStyledMenu } from '../ContextMenu';
import { GroupAvatar } from './GroupAvatar';
import { messageHasImage } from '../../utils/chat';
import { useTranslation } from 'react-i18next';
import {
  isDisabledTyping,
  useReticulumGroupChat,
} from '../../hooks/useReticulumGroupChat';
import { ReticulumGifCompressionStatus } from './ReticulumGifCompressionStatus';
import { MessageSizeLimitLip } from './MessageSizeLimitLip';
import { ReticulumUnreadCountBadge } from '../common/ReticulumUnreadCountBadge';
import { ReticulumModePill } from '../Group/ReticulumModePill';
import {
  ReticulumDiscussionDialog,
  type ReticulumDiscussionDraft,
  type ReticulumDiscussionFile,
} from './ReticulumDiscussionDialog';
import { fileToBase64 } from '../../utils/fileReading';
import {
  getGroupAdminsAddress,
  getGroupMembers,
  getPrimaryNamesForAddresses,
} from '../Group/groupApi';
import {
  compressReticulumImageFile,
  convertReticulumGifFile,
  isReticulumCompressibleImage,
  isReticulumGifFile,
} from './reticulumImagePreparation';
import { ReticulumLargeImageDialog } from './ReticulumLargeImageDialog';
import { ReticulumGroupCalendarDialog } from './ReticulumGroupCalendarDialog';
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react';
import { ReticulumMessageExpiryButton } from './ReticulumMessageExpiryButton';
import { applyReticulumJoinUnreadBaseline } from './reticulumJoinUnreadBaseline';
import { projectReticulumReactionReferences } from '../../utils/reticulumReactionProjection';
import {
  buildReticulumEditReference,
  buildReticulumInitialHistoryState,
  isSameReticulumEditReference,
  reticulumHistoryEnvelopeNeedsRefresh,
  reticulumHistoryItemSpecialId,
} from './reticulumInitialHistory';
import { normalizeReticulumChatHtmlContent } from './reticulumMessageHtml';
import { mergeReticulumPayloadWithVerifiedEnvelope } from '../../utils/reticulumEventEnvelope';
import {
  buildReticulumMessageExpiryPayload,
  formatReticulumExpiryDuration,
  isReticulumMessageExpiryOptionAllowed,
  RETICULUM_MESSAGE_EXPIRY_OPTIONS,
} from './reticulumMessageExpiry';

type PendingReticulumResourceFile = {
  filePath?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
  previewUrl?: string;
  base64?: string;
  width?: number;
  height?: number;
  temporaryFilePath?: string;
};

type ReticulumGroupChannel = {
  channelId: string;
  groupId: number;
  categoryId?: string;
  name: string;
  description?: string;
  position: number;
  archived: boolean;
  writeMode?: ReticulumGroupChannelWriteMode;
  readMode?: ReticulumGroupChannelReadMode;
  expiryDurationMs?: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

type ReticulumGroupChannelWriteMode = 'members' | 'admins';
type ReticulumGroupChannelReadMode = 'members' | 'admins';
type ReticulumGroupChannelAccessMode =
  | 'regular'
  | 'admin_write'
  | 'admin_private';

type ReticulumSearchResult = {
  event: {
    eventId: string;
    groupId: number;
    channelId?: string;
    authorAddress?: string;
    authorPrimaryName?: string;
    senderName?: string;
    timestamp?: number;
    eventType?: string;
    encryptedPayload?: string;
  };
  snippet?: string;
  cursor?: ReticulumSearchCursor;
};

type ReticulumSearchCursor = {
  createdAt: number;
  eventId: string;
};

const RETICULUM_SEARCH_CHANNEL_CURRENT = '__current__';
const RETICULUM_SEARCH_CHANNEL_ALL = '__all__';
const RETICULUM_SEARCH_HAS_ANY = 'any';
const RETICULUM_SEARCH_HAS_ATTACHMENT = 'attachment';
const RETICULUM_SEARCH_HAS_LINK = 'link';
const RETICULUM_SEARCH_PAGE_SIZE = 20;

const RETICULUM_CHANNEL_WRITE_MODE_MEMBERS: ReticulumGroupChannelWriteMode =
  'members';
const RETICULUM_CHANNEL_WRITE_MODE_ADMINS: ReticulumGroupChannelWriteMode =
  'admins';
const RETICULUM_CHANNEL_READ_MODE_MEMBERS: ReticulumGroupChannelReadMode =
  'members';
const RETICULUM_CHANNEL_READ_MODE_ADMINS: ReticulumGroupChannelReadMode =
  'admins';
const RETICULUM_CHANNEL_ACCESS_REGULAR: ReticulumGroupChannelAccessMode =
  'regular';
const RETICULUM_CHANNEL_ACCESS_ADMIN_WRITE: ReticulumGroupChannelAccessMode =
  'admin_write';
const RETICULUM_CHANNEL_ACCESS_ADMIN_PRIVATE: ReticulumGroupChannelAccessMode =
  'admin_private';

function reticulumChannelAccessFromModes(
  writeMode?: ReticulumGroupChannelWriteMode,
  readMode?: ReticulumGroupChannelReadMode
): ReticulumGroupChannelAccessMode {
  if (readMode === RETICULUM_CHANNEL_READ_MODE_ADMINS) {
    return RETICULUM_CHANNEL_ACCESS_ADMIN_PRIVATE;
  }
  if (writeMode === RETICULUM_CHANNEL_WRITE_MODE_ADMINS) {
    return RETICULUM_CHANNEL_ACCESS_ADMIN_WRITE;
  }
  return RETICULUM_CHANNEL_ACCESS_REGULAR;
}

function reticulumChannelModesFromAccess(
  accessMode: ReticulumGroupChannelAccessMode
): {
  writeMode: ReticulumGroupChannelWriteMode;
  readMode: ReticulumGroupChannelReadMode;
} {
  if (accessMode === RETICULUM_CHANNEL_ACCESS_ADMIN_PRIVATE) {
    return {
      writeMode: RETICULUM_CHANNEL_WRITE_MODE_ADMINS,
      readMode: RETICULUM_CHANNEL_READ_MODE_ADMINS,
    };
  }
  if (accessMode === RETICULUM_CHANNEL_ACCESS_ADMIN_WRITE) {
    return {
      writeMode: RETICULUM_CHANNEL_WRITE_MODE_ADMINS,
      readMode: RETICULUM_CHANNEL_READ_MODE_MEMBERS,
    };
  }
  return {
    writeMode: RETICULUM_CHANNEL_WRITE_MODE_MEMBERS,
    readMode: RETICULUM_CHANNEL_READ_MODE_MEMBERS,
  };
}

function cleanReticulumSearchSnippet(snippet?: string): string {
  return (typeof snippet === 'string' ? snippet : '')
    .replace(/<\s*br\s*\/?>/gi, ' ')
    .replace(/<\/\s*(p|div|li|h[1-6]|blockquote)\s*>/gi, ' ')
    .replace(/<(?!\/?mark\b)[^>]+>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function renderReticulumSearchSnippet(snippet?: string): ReactNode {
  const text = cleanReticulumSearchSnippet(snippet);
  if (!text) return '';
  const parts = text.split(/(<mark>|<\/mark>)/g);
  let highlighted = false;
  return parts
    .filter((part) => part.length > 0)
    .map((part, index) => {
      if (part === '<mark>') {
        highlighted = true;
        return null;
      }
      if (part === '</mark>') {
        highlighted = false;
        return null;
      }
      return highlighted ? (
        <Box
          component="mark"
          key={`${part}-${index}`}
          sx={{
            backgroundColor: (theme) => alpha(theme.palette.warning.main, 0.3),
            borderRadius: '3px',
            color: 'inherit',
            px: '2px',
          }}
        >
          {part}
        </Box>
      ) : (
        <span key={`${part}-${index}`}>{part}</span>
      );
    });
}

function reticulumAttachmentNamesFromRecord(record: unknown): string[] {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return [];
  const attachments = (record as Record<string, unknown>).attachments;
  if (!Array.isArray(attachments)) return [];
  return [
    ...new Set(
      attachments
        .map((attachment) => {
          if (!attachment || typeof attachment !== 'object') return '';
          const item = attachment as Record<string, unknown>;
          return typeof item.fileName === 'string' && item.fileName.trim()
            ? item.fileName.trim()
            : typeof item.name === 'string' && item.name.trim()
              ? item.name.trim()
              : '';
        })
        .filter(Boolean)
    ),
  ];
}

function reticulumAttachmentNamesFromPayload(payload?: string): string[] {
  if (!payload) return [];
  try {
    return reticulumAttachmentNamesFromRecord(JSON.parse(payload));
  } catch {
    return [];
  }
}

function localDateStringToTimestamp(dateString: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return undefined;
  const [year, month, day] = dateString.split('-').map(Number);
  const timestamp = new Date(year, month - 1, day).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

type ReticulumGroupCategory = {
  categoryId: string;
  groupId: number;
  name: string;
  position: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

const DEFAULT_RETICULUM_CHANNEL_ID = 'general';
const QORTAL_LAND_RETICULUM_CHANNEL_ID = 'qortal-land';
const DEFAULT_RETICULUM_CATEGORY_METADATA_ID = 'cat-qchat-default';
const HIDDEN_RETICULUM_DEFAULT_CATEGORY_NAME = 'QCHAT_DEFAULT_CATEGORY_HIDDEN';
const isReticulumSystemChannelId = (channelId: string) =>
  channelId === DEFAULT_RETICULUM_CHANNEL_ID ||
  channelId === QORTAL_LAND_RETICULUM_CHANNEL_ID;
const RETICULUM_CHANNEL_LOAD_RETRY_DELAYS_MS = [100, 250, 500, 1_000];
const RETICULUM_CHANNEL_DRAG_PREFIX = 'reticulum-channel:';
const RETICULUM_CATEGORY_DRAG_PREFIX = 'reticulum-category-drag:';
const RETICULUM_CATEGORY_DROP_PREFIX = 'reticulum-category:';

const normalizeReticulumChannelName = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

const normalizeReticulumDisplayName = (value: unknown) =>
  (typeof value === 'string' ? value : '')
    .normalize('NFC')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim()
    .slice(0, 80);

const reticulumDisplayNameKey = (value: unknown) =>
  normalizeReticulumDisplayName(value).toLocaleLowerCase();

const uid = new ShortUniqueId({ length: 5 });
const uidImages = new ShortUniqueId({ length: 12 });
const RETICULUM_ACTIVE_BLUE = '#2563eb';
const RETICULUM_ACTIVE_BLUE_HOVER = '#1e40af';
const Q_MANAGER_DEFAULT_WIDTH = 600;
const Q_MANAGER_DEFAULT_HEIGHT = 720;
const Q_MANAGER_MIN_WIDTH = 540;
const Q_MANAGER_MIN_HEIGHT = 560;
const Q_MANAGER_HEADER_HEIGHT = 40;
const RETICULUM_INLINE_IMAGE_THRESHOLD_BYTES = 1_000_000;
const RETICULUM_TYPING_IDLE_STOP_MS = 5_000;
const RETICULUM_MEMBER_REFRESH_MS = 60_000;
const RETICULUM_SELF_WELCOME_RECENT_JOIN_MS = 24 * 60 * 60 * 1000;
const RETICULUM_SELF_WELCOME_STORAGE_PREFIX = 'qchat-reticulum-self-welcome-v1';
const RETICULUM_CALENDAR_SYSTEM_RANGE_MS = 365 * 24 * 60 * 60 * 1000;
const RETICULUM_CALENDAR_TEN_MINUTES_MS = 10 * 60 * 1000;
const RETICULUM_CALENDAR_TIMER_MAX_DELAY_MS = 2_147_000_000;

const shortenReticulumAddress = (address: string) =>
  address.length <= 15
    ? address
    : `${address.slice(0, 6)}...${address.slice(-6)}`;

const escapeReticulumMessageHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const RETICULUM_GROUP_WELCOME_TEMPLATES = [
  (mention: string) =>
    `Welcome to the group, ${mention}! Glad to have you here.`,
  (mention: string) =>
    `Hey ${mention}, welcome in! Feel free to introduce yourself.`,
  (mention: string) =>
    `${mention} just joined the group. Make them feel at home!`,
  (mention: string) => `Good to have you with us, ${mention}. Welcome!`,
  (mention: string) =>
    `Welcome aboard, ${mention}! Jump into the conversation anytime.`,
];

const deterministicWelcomeTemplateIndex = (key: string) => {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return hash % RETICULUM_GROUP_WELCOME_TEMPLATES.length;
};

const reticulumDialogPaperSx = {
  backgroundImage: 'none',
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: '10px',
  boxShadow: '0 24px 70px rgba(0,0,0,0.45)',
} as const;

const reticulumDialogTitleSx = {
  fontFamily: 'Inter',
  fontSize: 18,
  fontWeight: 800,
  pb: 1,
} as const;

const reticulumDialogContentSx = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1.5,
  pt: '8px !important',
} as const;

const reticulumSecondaryButtonSx = {
  borderRadius: '8px',
  color: 'text.secondary',
  fontWeight: 700,
  px: 2,
  textTransform: 'none',
  '&:hover': {
    backgroundColor: 'action.hover',
    color: 'text.primary',
  },
} as const;

const reticulumPrimaryButtonSx = {
  backgroundColor: RETICULUM_ACTIVE_BLUE,
  borderRadius: '8px',
  color: 'common.white',
  fontWeight: 700,
  px: 2.25,
  textTransform: 'none',
  '&:hover': {
    backgroundColor: RETICULUM_ACTIVE_BLUE_HOVER,
  },
} as const;

const reticulumDialogTextFieldSx = {
  '& .MuiOutlinedInput-root': {
    backgroundColor: 'background.default',
    borderRadius: '8px',
  },
  '& .MuiInputLabel-root.Mui-focused': {
    color: RETICULUM_ACTIVE_BLUE,
  },
  '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
    borderColor: RETICULUM_ACTIVE_BLUE,
  },
} as const;

function ReticulumChannelExpiryField({
  id,
  onChange,
  value,
}: {
  id: string;
  onChange: (durationMs: number | undefined) => void;
  value?: number;
}) {
  const normalizedValue =
    Number.isFinite(value) && Number(value) > 0 ? Number(value) : '';
  const hasCustomValue =
    normalizedValue !== '' &&
    !RETICULUM_MESSAGE_EXPIRY_OPTIONS.some(
      (option) => option.durationMs === normalizedValue
    );
  return (
    <Box>
      <Typography
        component="label"
        htmlFor={id}
        sx={{
          color: 'text.primary',
          display: 'block',
          fontSize: 15,
          fontWeight: 800,
          mb: 1,
        }}
      >
        Channel expiry
      </Typography>
      <TextField
        fullWidth
        id={id}
        onChange={(event) => {
          const durationMs = Number(event.target.value);
          onChange(
            Number.isFinite(durationMs) && durationMs > 0
              ? durationMs
              : undefined
          );
        }}
        select
        SelectProps={{
          displayEmpty: true,
          renderValue: (selected) => {
            const durationMs = Number(selected);
            return Number.isFinite(durationMs) && durationMs > 0
              ? formatReticulumExpiryDuration(durationMs)
              : 'No Expiry';
          },
        }}
        sx={reticulumDialogTextFieldSx}
        value={normalizedValue}
      >
        <MenuItem value="">No Expiry</MenuItem>
        {hasCustomValue && (
          <MenuItem value={normalizedValue}>
            {formatReticulumExpiryDuration(Number(normalizedValue))}
          </MenuItem>
        )}
        {RETICULUM_MESSAGE_EXPIRY_OPTIONS.map((option) => (
          <MenuItem key={option.durationMs} value={option.durationMs}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>
      <Typography
        sx={{
          color: 'text.secondary',
          fontSize: 12.5,
          lineHeight: '18px',
          mt: 0.75,
        }}
      >
        Applies to existing and future messages. A message can choose a shorter
        expiry.
      </Typography>
    </Box>
  );
}

const ReticulumMegaphoneIcon = (props) => (
  <SvgIcon {...props} viewBox="0 0 24 24">
    <path d="M20.5 4.75c0-.79-.87-1.27-1.54-.85L10.1 9.4H5.25A2.25 2.25 0 0 0 3 11.65v.7a2.25 2.25 0 0 0 2.25 2.25H6.4l1.52 4.18c.22.6.78.99 1.42.99h2.06c.72 0 1.2-.74.91-1.4l-1.63-3.75 8.28 5.48c.67.43 1.54-.05 1.54-.85V4.75Z" />
  </SvgIcon>
);
const reticulumChannelTypeOptions = [
  {
    description: 'Everyone can\nread and write.',
    icon: PublicRoundedIcon,
    label: 'Open',
    value: RETICULUM_CHANNEL_ACCESS_REGULAR,
  },
  {
    description: 'Only admins can post. Everyone can read.',
    icon: LockRoundedIcon,
    label: 'Read-only',
    value: RETICULUM_CHANNEL_ACCESS_ADMIN_WRITE,
  },
  {
    description: 'Only admins and the group owner can access.',
    icon: VisibilityOffRoundedIcon,
    label: 'Admin',
    value: RETICULUM_CHANNEL_ACCESS_ADMIN_PRIVATE,
  },
] as const;

const reticulumChannelTypeOptionByAccess = (
  accessMode: ReticulumGroupChannelAccessMode
) =>
  reticulumChannelTypeOptions.find((option) => option.value === accessMode) ||
  reticulumChannelTypeOptions[0];

type QManagerAnchorRect = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
};

const formatReticulumFileSize = (bytes?: number) => {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return '0 bytes';
  if (size < 1024) return `${size} ${size === 1 ? 'byte' : 'bytes'}`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.ceil(size / 1024))} KB`;
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const reticulumChannelDragId = (channelId: string) =>
  `${RETICULUM_CHANNEL_DRAG_PREFIX}${channelId}`;

const reticulumCategoryDragId = (categoryId: string) =>
  `${RETICULUM_CATEGORY_DRAG_PREFIX}${categoryId}`;

const reticulumCategoryDropId = (categoryId: string) =>
  `${RETICULUM_CATEGORY_DROP_PREFIX}${categoryId}`;

type ReticulumDragInsertionPosition = 'before' | 'after';

type ReticulumDragTarget = {
  activeId: string;
  overId: string;
  position: ReticulumDragInsertionPosition;
};

const reticulumDragInsertionPosition = (
  event: DragEndEvent | DragOverEvent
): ReticulumDragInsertionPosition => {
  const translated = event.active.rect.current.translated;
  if (!translated || !event.over) return 'before';
  const activeMiddle = translated.top + translated.height / 2;
  const overMiddle = event.over.rect.top + event.over.rect.height / 2;
  return activeMiddle > overMiddle ? 'after' : 'before';
};

const moveReticulumItemByInsertion = <T,>(
  items: T[],
  sourceIndex: number,
  targetIndex: number,
  position: ReticulumDragInsertionPosition
) => {
  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  const rawIndex = targetIndex + (position === 'after' ? 1 : 0);
  const insertionIndex = Math.max(
    0,
    Math.min(rawIndex - (sourceIndex < rawIndex ? 1 : 0), next.length)
  );
  next.splice(insertionIndex, 0, moved);
  return next;
};

function ReticulumDropIndicator({
  position,
}: {
  position: ReticulumDragInsertionPosition;
}) {
  return (
    <Box
      aria-hidden
      sx={{
        backgroundColor: RETICULUM_ACTIVE_BLUE,
        borderRadius: '999px',
        boxShadow: '0 0 0 1px rgba(37, 99, 235, 0.22)',
        height: 2,
        left: 6,
        pointerEvents: 'none',
        position: 'absolute',
        right: 6,
        ...(position === 'before' ? { top: -4 } : { bottom: -4 }),
        zIndex: 7,
      }}
    />
  );
}

const parseReticulumChannelDragId = (id: unknown) =>
  typeof id === 'string' && id.startsWith(RETICULUM_CHANNEL_DRAG_PREFIX)
    ? id.slice(RETICULUM_CHANNEL_DRAG_PREFIX.length)
    : '';

const parseReticulumCategoryDragId = (id: unknown) =>
  typeof id === 'string' && id.startsWith(RETICULUM_CATEGORY_DRAG_PREFIX)
    ? id.slice(RETICULUM_CATEGORY_DRAG_PREFIX.length)
    : '';

const parseReticulumCategoryDropId = (id: unknown) =>
  typeof id === 'string' && id.startsWith(RETICULUM_CATEGORY_DROP_PREFIX)
    ? id.slice(RETICULUM_CATEGORY_DROP_PREFIX.length)
    : '';

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const mentionAddressHash = (address: string) =>
  sha256Hex(`reticulum-chat-mention:${address.trim()}`);

const buildMentionAddressHashes = async (addresses: string[]) => [
  ...new Set(
    await Promise.all(
      addresses
        .map((address) => address.trim())
        .filter(Boolean)
        .map((address) => mentionAddressHash(address))
    )
  ),
];

type ReticulumSortableChannelButtonProps = {
  channel: ReticulumGroupChannel;
  dropPosition?: ReticulumDragInsertionPosition;
  hasUnreadMention: boolean;
  isAdmin: boolean;
  mentionCount: number;
  onContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    channel: ReticulumGroupChannel
  ) => void;
  onSelect: (channelId: string) => void;
  selected: boolean;
  textScale: 'default' | 'medium' | 'high';
  unreadCount: number;
  replyCount: number;
};

const reticulumTextSize = (
  scale: 'default' | 'medium' | 'high',
  base: number
) => (scale === 'high' ? base + 3 : scale === 'medium' ? base + 1.5 : base);

const reticulumChannelAutoDeleteLabel = (durationMs: number) => {
  const option = RETICULUM_MESSAGE_EXPIRY_OPTIONS.find(
    (candidate) => candidate.durationMs === durationMs
  );
  if (!option) return formatReticulumExpiryDuration(durationMs);
  if (option.label === '1 week') return '1 week';
  return option.label.replace(' hours', 'H');
};

function ReticulumChannelAutoDeleteIcon() {
  return (
    <Box
      aria-hidden
      component="svg"
      viewBox="0 0 16 16"
      sx={{
        color: 'text.disabled',
        display: 'block',
        height: 13,
        width: 13,
      }}
    >
      <path
        d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1ZM7.35 3.4h1.3v3.95h2.95v1.3H7.35V3.4Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </Box>
  );
}

function ReticulumSortableChannelButton({
  channel,
  dropPosition,
  hasUnreadMention,
  isAdmin,
  mentionCount,
  onContextMenu,
  onSelect,
  selected,
  textScale,
  unreadCount,
  replyCount,
}: ReticulumSortableChannelButtonProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({
    id: reticulumChannelDragId(channel.channelId),
    disabled: !isAdmin,
  });
  const hasUnread = unreadCount > 0 || hasUnreadMention;
  const emphasized = selected || hasUnread;
  const channelTypeOption = reticulumChannelTypeOptionByAccess(
    reticulumChannelAccessFromModes(channel.writeMode, channel.readMode)
  );
  const ChannelTypeIcon = channelTypeOption.icon;
  const expiryDurationMs = Number(channel.expiryDurationMs);
  const hasAutoExpiry =
    Number.isFinite(expiryDurationMs) && expiryDurationMs > 0;
  const autoDeleteTooltip = hasAutoExpiry
    ? `Messages Auto-Delete in ${reticulumChannelAutoDeleteLabel(expiryDurationMs)}`
    : '';

  return (
    <ButtonBase
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onSelect(channel.channelId)}
      onContextMenu={(event) => {
        if (!isAdmin) return;
        onContextMenu(event, channel);
      }}
      sx={{
        alignItems: 'center',
        backgroundColor: selected ? 'action.selected' : 'transparent',
        borderRadius: '6px',
        color: emphasized ? 'text.primary' : 'text.secondary',
        cursor: 'pointer',
        display: 'flex',
        fontSize: reticulumTextSize(textScale, 14),
        fontWeight: 500,
        justifyContent: 'space-between',
        mb: 0.5,
        minHeight: textScale === 'high' ? 36 : textScale === 'medium' ? 33 : 30,
        opacity: isDragging ? 0.55 : 1,
        overflow: 'hidden',
        pl: '12px',
        pr: 0.75,
        py: 0.5,
        position: 'relative',
        textAlign: 'left',
        lineHeight: 1.25,
        width: '100%',
        zIndex: isDragging ? 3 : 'auto',
        '&:before': {
          backgroundColor: selected ? 'primary.main' : 'transparent',
          borderRadius: 0,
          content: '""',
          bottom: 0,
          left: 0,
          position: 'absolute',
          top: 0,
          width: 3,
        },
        textRendering: 'geometricPrecision',
        WebkitFontSmoothing: 'antialiased',
        '&:hover': {
          backgroundColor: selected ? 'action.selected' : 'action.hover',
          color: 'text.primary',
        },
      }}
    >
      {dropPosition && <ReticulumDropIndicator position={dropPosition} />}
      <Box
        component="span"
        sx={{
          alignItems: 'center',
          display: 'inline-flex',
          gap: 0.75,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        <ChannelTypeIcon
          aria-hidden
          sx={{
            color: emphasized ? 'inherit' : 'text.disabled',
            flexShrink: 0,
            fontSize: 18,
          }}
        />
        <Box
          component="span"
          sx={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {channel.name || channel.channelId}
        </Box>
      </Box>
      <Box
        component="span"
        sx={{
          alignItems: 'center',
          display: 'inline-flex',
          flexShrink: 0,
          gap: 0.5,
          ml: 1,
        }}
      >
        {hasAutoExpiry && (
          <Tooltip title={autoDeleteTooltip}>
            <Box
              aria-label={autoDeleteTooltip}
              component="span"
              role="img"
              sx={{
                alignItems: 'center',
                display: 'inline-flex',
                flexShrink: 0,
                justifyContent: 'center',
              }}
            >
              <ReticulumChannelAutoDeleteIcon />
            </Box>
          </Tooltip>
        )}
        {hasUnreadMention && (
          <Tooltip
            title={
              mentionCount > 1
                ? `${mentionCount} unread mentions`
                : 'Unread mention'
            }
          >
            <Box
              component="span"
              sx={{
                alignItems: 'center',
                backgroundColor: 'error.main',
                borderRadius: '999px',
                color: 'error.contrastText',
                display: 'inline-flex',
                fontSize: 11,
                fontWeight: 800,
                height: 18,
                justifyContent: 'center',
                lineHeight: 1,
                minWidth: 18,
                px: 0.5,
              }}
            >
              <Box
                component="span"
                sx={{
                  position: 'relative',
                  top: mentionCount > 1 ? 0 : '-0.5px',
                }}
              >
                {mentionCount > 1 ? mentionCount : '@'}
              </Box>
            </Box>
          </Tooltip>
        )}
        {(replyCount > 0 || (unreadCount > 0 && !hasUnreadMention)) && (
          <Tooltip
            title={
              replyCount > 1
                ? `${replyCount} unread replies`
                : replyCount === 1
                  ? 'Unread reply'
                  : 'Unread messages'
            }
          >
            <Box
              component="span"
              sx={{
                alignItems: 'center',
                backgroundColor: 'error.main',
                borderRadius: '999px',
                color: 'error.contrastText',
                display: 'inline-flex',
                fontSize: 11,
                fontWeight: 800,
                height: replyCount > 0 ? 18 : 8,
                justifyContent: 'center',
                lineHeight: 1,
                minWidth: replyCount > 0 ? 18 : 8,
                px: replyCount > 0 ? 0.5 : 0,
              }}
            >
              {replyCount > 0 ? (replyCount > 99 ? '99+' : replyCount) : null}
            </Box>
          </Tooltip>
        )}
      </Box>
    </ButtonBase>
  );
}

function ReticulumCategoryDropZone({
  children,
  disabled,
  dropPosition,
  id,
}: {
  children: ReactNode;
  disabled: boolean;
  dropPosition?: ReticulumDragInsertionPosition;
  id: string;
}) {
  const { isOver, setNodeRef } = useDroppable({ id, disabled });

  return (
    <Box
      ref={setNodeRef}
      sx={{
        borderRadius: '8px',
        mb: 0,
        minHeight: isOver ? 8 : 0,
        position: 'relative',
      }}
    >
      {dropPosition && <ReticulumDropIndicator position={dropPosition} />}
      {children}
    </Box>
  );
}

function ReticulumSortableCategory({
  category,
  channelDropPosition,
  children,
  dropPosition,
  isAdmin,
  isCollapsed,
  onContextMenu,
  onCreateChannel,
  onToggleCollapsed,
}: {
  category: ReticulumGroupCategory;
  channelDropPosition?: ReticulumDragInsertionPosition;
  children: ReactNode;
  dropPosition?: ReticulumDragInsertionPosition;
  isAdmin: boolean;
  isCollapsed: boolean;
  onContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    category: ReticulumGroupCategory
  ) => void;
  onCreateChannel: (categoryId: string) => void;
  onToggleCollapsed: (categoryId: string) => void;
}) {
  const theme = useTheme();
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({
    id: reticulumCategoryDragId(category.categoryId),
    disabled: !isAdmin,
  });

  return (
    <ReticulumCategoryDropZone
      disabled={!isAdmin}
      dropPosition={channelDropPosition}
      id={reticulumCategoryDropId(category.categoryId)}
    >
      <Box
        ref={setNodeRef}
        sx={{
          opacity: isDragging ? 0.55 : 1,
          position: 'relative',
          zIndex: isDragging ? 3 : 'auto',
        }}
      >
        {dropPosition && <ReticulumDropIndicator position={dropPosition} />}
        <Box
          {...attributes}
          {...listeners}
          aria-expanded={!isCollapsed}
          aria-label={`${category.name} category`}
          onClick={() => onToggleCollapsed(category.categoryId)}
          onContextMenu={(event) => onContextMenu(event, category)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            onToggleCollapsed(category.categoryId);
          }}
          role="button"
          tabIndex={0}
          sx={{
            alignItems: 'center',
            backgroundColor:
              theme.palette.mode === 'dark'
                ? '#242831'
                : theme.palette.grey[200],
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: '7px',
            boxShadow:
              theme.palette.mode === 'dark'
                ? 'inset 0 1px 0 rgba(255, 255, 255, 0.025), 0 2px 5px rgba(0, 0, 0, 0.20)'
                : '0 1px 3px rgba(35, 42, 54, 0.1)',
            color: 'text.secondary',
            cursor: 'pointer',
            display: 'flex',
            fontFamily: 'Inter, sans-serif',
            fontSize: 10,
            fontWeight: 600,
            justifyContent: 'space-between',
            letterSpacing: '0.08em',
            minHeight: 32,
            mt: '14px',
            overflow: 'hidden',
            px: '12px',
            position: 'relative',
            textTransform: 'uppercase',
            touchAction: isAdmin ? 'none' : 'auto',
            userSelect: 'none',
            width: '100%',
            '&:hover': {
              backgroundColor:
                theme.palette.mode === 'dark'
                  ? '#292E38'
                  : theme.palette.grey[300],
              borderColor: 'divider',
            },
            '&:hover .reticulum-category-create-channel, &:focus-within .reticulum-category-create-channel':
              {
                opacity: 1,
                pointerEvents: 'auto',
              },
            '&:focus-visible': {
              outline: '2px solid rgba(37, 99, 235, 0.72)',
              outlineOffset: 2,
            },
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              color: 'inherit',
              display: 'inline-flex',
              font: 'inherit',
              fontWeight: 'inherit',
              gap: '6px',
              minWidth: 0,
              overflow: 'hidden',
              textTransform: 'inherit',
            }}
          >
            <Box
              component="span"
              sx={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {category.name}
            </Box>
            {isCollapsed ? (
              <ChevronRightRoundedIcon sx={{ fontSize: 14 }} />
            ) : (
              <ExpandMoreRoundedIcon sx={{ fontSize: 14 }} />
            )}
          </Box>
          {isAdmin && (
            <Tooltip title="Create Channel">
              <IconButton
                className="reticulum-category-create-channel"
                size="small"
                onClick={(event) => {
                  event.stopPropagation();
                  onCreateChannel(category.categoryId);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                sx={{
                  color: 'text.secondary',
                  cursor: 'pointer',
                  mr: -0.5,
                  opacity: 0,
                  p: 0.25,
                  pointerEvents: 'none',
                  transition: 'opacity 120ms ease, color 120ms ease',
                  '&:hover': { color: 'text.primary' },
                }}
              >
                <AddIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
        {!isCollapsed && (
          <Box sx={{ pb: 0, pt: '7px', px: '8px' }}>{children}</Box>
        )}
      </Box>
    </ReticulumCategoryDropZone>
  );
}

const mentionNodeIdsFromHtml = (html: string): Set<string> => {
  if (!html || typeof DOMParser === 'undefined') return new Set();
  const document = new DOMParser().parseFromString(html, 'text/html');
  return new Set(
    [...document.querySelectorAll('[data-type="mention"][data-id]')]
      .map((node) => node.getAttribute('data-id')?.trim().toLowerCase() || '')
      .filter(Boolean)
  );
};

const reticulumGroupLinkMentionId = (
  groupId: number,
  channelId = DEFAULT_RETICULUM_CHANNEL_ID
): string => `reticulum-group:${groupId}:${encodeURIComponent(channelId)}`;

const reticulumChannelLinkMentionId = (
  groupId: number,
  channelId: string
): string => `reticulum-channel:${groupId}:${encodeURIComponent(channelId)}`;

type ReticulumSilenceState = {
  ownerAddress: string;
  targetAddress: string;
  scopeType: 'group' | 'dm';
  scopeId: string;
  createdAt: number;
  expiresAt: number | null;
  ignoredThrough: number;
  updatedAt: number;
  active: boolean;
};

const normalizeReticulumHideAddress = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const areStringSetsEqual = (left: Set<string>, right: Set<string>): boolean => {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
};

const activeReticulumHiddenAuthorsForGroup = (
  silences: ReticulumSilenceState[],
  groupId: number
): Set<string> =>
  new Set(
    silences
      .filter(
        (silence) =>
          silence.active &&
          silence.scopeType === 'group' &&
          silence.scopeId === String(groupId)
      )
      .map((silence) => normalizeReticulumHideAddress(silence.targetAddress))
      .filter(Boolean)
  );

export const ChatGroup = ({
  selectedGroup,
  selectedGroupName = '',
  secretKey,
  getSecretKey,
  myAddress,
  adminsWithNames = [],
  isReticulumChannelAdmin = false,
  reticulumChannelAccessReady = false,
  handleNewEncryptionNotification,
  hide,
  handleSecretKeyCreationInProgress,
  triedToFetchSecretKey,
  getTimestampEnterChatParent,
  hideView,
  isActive,
  isPrivate,
  notificationReticulumChannelId,
  notificationReticulumMessageId,
  onReticulumChannelSelected,
  onReticulumNotificationHandled,
  onGroupCallClick,
  onQortalLandClick,
  onThreadsClick,
  onMembersClick,
  membersPanelOpen = false,
  membersNotificationCount = 0,
  groupCallInCall = false,
  groupCallJoining = false,
  groupCallDisabled = false,
  groupCallTooltip = '',
  reticulumReadEntryToken,
  reticulumCalendarOpenRequest = 0,
  reticulumCalendarTarget = null,
  onReticulumCalendarOpenChange,
  isGroupOwner = false,
}) => {
  const userInfo = useAtomValue(userInfoAtom);
  const balance = useAtomValue(balanceAtom);
  const reticulumChatTextScale = useAtomValue(reticulumChatTextScaleAtom);
  const legacyThreadsEnabled = useAtomValue(
    reticulumLegacyThreadsEnabledAtom
  );
  const [qManagerPopupSize, setQManagerPopupSize] = useAtom(
    groupQManagerPopupSizeAtom
  );
  const myName = userInfo?.name;
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const jotaiStore = useStore();
  const isChatSenderBlocked = useCallback(
    (item?: { sender?: string }) => {
      const addresses = jotaiStore.get(blockedAddressesAtom);
      const sender = item?.sender;
      return !!(sender && addresses[sender]);
    },
    [jotaiStore]
  );
  const [messages, setMessages] = useState([]);
  const [chatReferences, setChatReferences] = useState({});
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGroupAvatarDialogOpen, setIsGroupAvatarDialogOpen] = useState(false);
  const [isReticulumModeResolved, setIsReticulumModeResolved] = useState(false);
  const [isReticulumModeDetected, setIsReticulumModeDetected] = useState(false);
  const [isMoved, setIsMoved] = useState(false);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const hasInitialized = useRef(false);
  const [isFocusedParent, setIsFocusedParent] = useState(false);
  const [replyMessage, setReplyMessage] = useState(null);
  const [reticulumDiscussionRootId, setReticulumDiscussionRootId] =
    useState('');
  const [reticulumDiscussionMessages, setReticulumDiscussionMessages] =
    useState<any[]>([]);
  const [isReticulumDiscussionLoading, setIsReticulumDiscussionLoading] =
    useState(false);
  const [reticulumDiscussionFiles, setReticulumDiscussionFiles] = useState<
    ReticulumDiscussionFile[]
  >([]);
  const [
    isPreparingReticulumDiscussionFile,
    setIsPreparingReticulumDiscussionFile,
  ] = useState(false);
  const [
    isCompressingReticulumDiscussionGif,
    setIsCompressingReticulumDiscussionGif,
  ] = useState(false);
  const reticulumDiscussionLoadSequenceRef = useRef(0);
  const reticulumDiscussionFileSequenceRef = useRef(0);
  const [onEditMessage, setOnEditMessage] = useState(null);
  const [groupMentionMembers, setGroupMentionMembers] = useState<
    {
      name: string;
      address: string;
      joined?: number;
      role?: 'owner' | 'admin';
    }[]
  >([]);
  const [reticulumGroupOwnerName, setReticulumGroupOwnerName] = useState('');
  const [reticulumMemberDataGroupId, setReticulumMemberDataGroupId] = useState<
    number | null
  >(null);
  const reticulumWelcomePublishInFlightRef = useRef<Set<string>>(new Set());
  const [
    reticulumPrivilegedMemberRolesByAddress,
    setReticulumPrivilegedMemberRolesByAddress,
  ] = useState<Record<string, 'owner' | 'admin'>>({});
  const [reticulumMemberRolesReady, setReticulumMemberRolesReady] =
    useState(false);
  const [reticulumHiddenAuthorAddresses, setReticulumHiddenAuthorAddresses] =
    useState<Set<string>>(() => new Set());
  const [
    isReticulumHiddenUsersDialogOpen,
    setIsReticulumHiddenUsersDialogOpen,
  ] = useState(false);
  const [reticulumUnhidingAddress, setReticulumUnhidingAddress] = useState('');
  const [reticulumHiddenUsersError, setReticulumHiddenUsersError] =
    useState('');
  useEffect(() => {
    const openHiddenMembers = (event: Event) => {
      const requestedGroupId = Number(
        (event as CustomEvent<{ groupId?: number }>).detail?.groupId
      );
      const activeGroupId = Number(
        typeof selectedGroup === 'object'
          ? (selectedGroup?.groupId ?? selectedGroup?.id)
          : selectedGroup
      );
      if (
        !Number.isInteger(requestedGroupId) ||
        requestedGroupId <= 0 ||
        requestedGroupId !== activeGroupId
      ) {
        return;
      }
      setReticulumHiddenUsersError('');
      setIsReticulumHiddenUsersDialogOpen(true);
    };

    subscribeToEvent('openReticulumHiddenMembers', openHiddenMembers);
    return () =>
      unsubscribeFromEvent('openReticulumHiddenMembers', openHiddenMembers);
  }, [selectedGroup]);
  const [isOpenQManager, setIsOpenQManager] = useState(null);
  const [reticulumAdminAnchorEl, setReticulumAdminAnchorEl] =
    useState<HTMLElement | null>(null);
  const [reticulumAdminAnchorPosition, setReticulumAdminAnchorPosition] =
    useState<{
      left: number;
      top: number;
    } | null>(null);
  const reticulumAdminPopoverRef = useRef<HTMLDivElement | null>(null);
  const [isDeleteImage, setIsDeleteImage] = useState(false);
  const [messageSize, setMessageSize] = useState(0);
  const [messageSizeLimitShakeKey, setMessageSizeLimitShakeKey] = useState(0);
  const groupNameLabelRef = useRef<HTMLSpanElement | null>(null);
  const [isGroupNameTruncated, setIsGroupNameTruncated] = useState(false);
  const [chatImagesToSave, setChatImagesToSave] = useState([]);
  const [pendingReticulumFiles, setPendingReticulumFiles] = useState<
    PendingReticulumResourceFile[]
  >([]);
  const [isReticulumAttachmentDragActive, setIsReticulumAttachmentDragActive] =
    useState(false);
  const reticulumAttachmentDragDepthRef = useRef(0);
  const [
    reticulumMessageExpiryDurationMs,
    setReticulumMessageExpiryDurationMs,
  ] = useState<number | undefined>(undefined);
  const [reticulumChannels, setReticulumChannels] = useState<
    ReticulumGroupChannel[]
  >([]);
  const [reticulumCategories, setReticulumCategories] = useState<
    ReticulumGroupCategory[]
  >([]);
  const [reticulumDragTarget, setReticulumDragTarget] =
    useState<ReticulumDragTarget | null>(null);
  const reticulumDragTargetRef = useRef<ReticulumDragTarget | null>(null);
  const [reticulumChannelStateGroupId, setReticulumChannelStateGroupId] =
    useState('');
  const [
    reticulumChannelMetadataVisibleGroupId,
    setReticulumChannelMetadataVisibleGroupId,
  ] = useState('');
  const reticulumChannelSnapshotGroupIdRef = useRef('');
  const [selectedReticulumChannelId, setSelectedReticulumChannelId] = useState(
    DEFAULT_RETICULUM_CHANNEL_ID
  );
  const [reticulumChannelSidebarOpen, setReticulumChannelSidebarOpen] =
    useState(false);
  const [reticulumChannelSidebarWidth, setReticulumChannelSidebarWidth] =
    useState(242);
  const reticulumChannelSidebarResizeCleanupRef = useRef<(() => void) | null>(
    null
  );
  const [reticulumSearchOpen, setReticulumSearchOpen] = useState(false);
  const [reticulumCalendarOpen, setReticulumCalendarOpen] = useState(false);
  const [reticulumCalendarSystemOccurrences, setReticulumCalendarSystemOccurrences] =
    useState<ReticulumCalendarOccurrence[]>([]);
  const [reticulumCalendarSystemNow, setReticulumCalendarSystemNow] = useState(
    Date.now()
  );
  const [activeReticulumCalendarTarget, setActiveReticulumCalendarTarget] =
    useState(reticulumCalendarTarget);
  const handledReticulumCalendarRequestRef = useRef(0);
  useEffect(() => {
    onReticulumCalendarOpenChange?.(reticulumCalendarOpen);
  }, [onReticulumCalendarOpenChange, reticulumCalendarOpen]);
  useEffect(
    () => () => onReticulumCalendarOpenChange?.(false),
    [onReticulumCalendarOpenChange]
  );
  useEffect(() => {
    executeEvent('reticulumSearchOverlayOpenState', {
      open: reticulumSearchOpen,
    });
    return () => {
      executeEvent('reticulumSearchOverlayOpenState', { open: false });
    };
  }, [reticulumSearchOpen]);
  const [qManagerAnchorRect, setQManagerAnchorRect] =
    useState<QManagerAnchorRect | null>(null);
  const [reticulumSearchQuery, setReticulumSearchQuery] = useState('');
  const [reticulumSearchChannelFilter, setReticulumSearchChannelFilter] =
    useState(RETICULUM_SEARCH_CHANNEL_CURRENT);
  const [reticulumSearchAuthorFilter, setReticulumSearchAuthorFilter] =
    useState('');
  const [reticulumSearchHasFilter, setReticulumSearchHasFilter] = useState(
    RETICULUM_SEARCH_HAS_ANY
  );
  const [reticulumSearchAfterDate, setReticulumSearchAfterDate] = useState('');
  const [reticulumSearchBeforeDate, setReticulumSearchBeforeDate] =
    useState('');
  const [reticulumSearchSort, setReticulumSearchSort] = useState<
    'relevance' | 'newest' | 'oldest'
  >('relevance');
  const [reticulumSearchFilterMenu, setReticulumSearchFilterMenu] = useState<
    'in' | 'from' | 'has' | 'date' | 'sort' | null
  >(null);
  const [reticulumSearchFilterAnchorEl, setReticulumSearchFilterAnchorEl] =
    useState<HTMLElement | null>(null);

  useEffect(() => {
    setIsGroupAvatarDialogOpen(false);
    setReticulumCalendarOpen(false);
    setActiveReticulumCalendarTarget(null);
  }, [selectedGroup]);
  useEffect(() => {
    if (
      reticulumCalendarOpenRequest >
        handledReticulumCalendarRequestRef.current &&
      Number(reticulumCalendarTarget?.groupId) === Number(selectedGroup)
    ) {
      handledReticulumCalendarRequestRef.current = reticulumCalendarOpenRequest;
      setActiveReticulumCalendarTarget(reticulumCalendarTarget);
      setReticulumCalendarOpen(true);
    }
  }, [reticulumCalendarOpenRequest, reticulumCalendarTarget, selectedGroup]);
  const [reticulumSearchResults, setReticulumSearchResults] = useState<
    ReticulumSearchResult[]
  >([]);
  const [reticulumSearchPage, setReticulumSearchPage] = useState(0);
  const [reticulumSearchHasNextPage, setReticulumSearchHasNextPage] =
    useState(false);
  const [isReticulumSearchLoading, setIsReticulumSearchLoading] =
    useState(false);
  const [reticulumSearchError, setReticulumSearchError] = useState('');
  const [reticulumSearchScrollTarget, setReticulumSearchScrollTarget] =
    useState<{
      messageId: string;
      nonce: number;
      requestId?: number;
    } | null>(null);
  const [
    pendingReticulumSearchNavigation,
    setPendingReticulumSearchNavigation,
  ] = useState<{
    groupId: number;
    channelId: string;
    eventId: string;
    requestId: number;
  } | null>(null);
  const reticulumSearchNavigationRequestRef = useRef(0);
  const pendingReticulumSearchNavigationRef = useRef(
    pendingReticulumSearchNavigation
  );
  pendingReticulumSearchNavigationRef.current =
    pendingReticulumSearchNavigation;
  const reticulumSearchNavigationInFlightRef = useRef(0);
  const reticulumSearchWindowOpenedRef = useRef(0);
  const reticulumSearchRequestSeqRef = useRef(0);
  const lastReticulumNotificationScrollTargetRef = useRef('');
  const reticulumSearchPageCursorsRef = useRef<
    Array<ReticulumSearchCursor | null>
  >([null]);
  const reticulumPrimaryNameCacheRef = useRef<Map<string, string>>(new Map());
  const [isCreateReticulumChannelOpen, setIsCreateReticulumChannelOpen] =
    useState(false);
  const [isCreatingReticulumChannel, setIsCreatingReticulumChannel] =
    useState(false);
  const [newReticulumChannelName, setNewReticulumChannelName] = useState('');
  const [newReticulumChannelError, setNewReticulumChannelError] = useState('');
  const [newReticulumChannelCategoryId, setNewReticulumChannelCategoryId] =
    useState('');
  const [newReticulumChannelAccessMode, setNewReticulumChannelAccessMode] =
    useState<ReticulumGroupChannelAccessMode>(RETICULUM_CHANNEL_ACCESS_REGULAR);
  const [
    newReticulumChannelExpiryDurationMs,
    setNewReticulumChannelExpiryDurationMs,
  ] = useState<number | undefined>(TIME_MONTHS_1_IN_MILLISECONDS);
  const [reticulumChannelSettingsOpen, setReticulumChannelSettingsOpen] =
    useState(false);
  const [editingReticulumChannel, setEditingReticulumChannel] =
    useState<ReticulumGroupChannel | null>(null);
  const [reticulumChannelName, setReticulumChannelName] = useState('');
  const [reticulumChannelAccessMode, setReticulumChannelAccessMode] =
    useState<ReticulumGroupChannelAccessMode>(RETICULUM_CHANNEL_ACCESS_REGULAR);
  const [
    reticulumChannelExpiryDurationMs,
    setReticulumChannelExpiryDurationMs,
  ] = useState<number | undefined>(undefined);
  const [reticulumChannelError, setReticulumChannelError] = useState('');
  const [reticulumNameEmojiPicker, setReticulumNameEmojiPicker] = useState<{
    anchorEl: HTMLElement;
    target: 'channel-create' | 'channel-settings' | 'category';
  } | null>(null);
  const [reticulumChannelSettingsView, setReticulumChannelSettingsView] =
    useState<'settings' | 'confirm-delete'>('settings');
  const [reticulumDeleteConfirmationName, setReticulumDeleteConfirmationName] =
    useState('');
  const [
    reticulumDeleteConfirmationError,
    setReticulumDeleteConfirmationError,
  ] = useState('');
  const [isDeletingReticulumChannel, setIsDeletingReticulumChannel] =
    useState(false);
  const reticulumRemoveChannelButtonRef = useRef<HTMLButtonElement | null>(
    null
  );
  const reticulumDeleteConfirmationInputRef = useRef<HTMLInputElement | null>(
    null
  );
  const [isReticulumCategoryDialogOpen, setIsReticulumCategoryDialogOpen] =
    useState(false);
  const [reticulumCategoryDialogMode, setReticulumCategoryDialogMode] =
    useState<'create' | 'rename'>('create');
  const [reticulumCategorySettingsView, setReticulumCategorySettingsView] =
    useState<'settings' | 'confirm-delete'>('settings');
  const [editingReticulumCategory, setEditingReticulumCategory] =
    useState<ReticulumGroupCategory | null>(null);
  const [reticulumCategoryName, setReticulumCategoryName] = useState('');
  const [reticulumCategoryError, setReticulumCategoryError] = useState('');
  const [
    reticulumCategoryDeleteConfirmationName,
    setReticulumCategoryDeleteConfirmationName,
  ] = useState('');
  const [
    reticulumCategoryDeleteConfirmationError,
    setReticulumCategoryDeleteConfirmationError,
  ] = useState('');
  const [isDeletingReticulumCategory, setIsDeletingReticulumCategory] =
    useState(false);
  const reticulumRemoveCategoryButtonRef = useRef<HTMLButtonElement | null>(
    null
  );
  const reticulumCategoryDeleteConfirmationInputRef =
    useRef<HTMLInputElement | null>(null);
  const [collapsedReticulumCategoryIds, setCollapsedReticulumCategoryIds] =
    useState<Set<string>>(() => new Set());
  const [reticulumCategoryMenuPosition, setReticulumCategoryMenuPosition] =
    useState<{
      mouseX: number;
      mouseY: number;
    } | null>(null);
  const [reticulumCategoryMenuCategory, setReticulumCategoryMenuCategory] =
    useState<ReticulumGroupCategory | null>(null);
  const [reticulumChannelMenuPosition, setReticulumChannelMenuPosition] =
    useState<{
      mouseX: number;
      mouseY: number;
    } | null>(null);
  const [reticulumChannelMenuChannel, setReticulumChannelMenuChannel] =
    useState<ReticulumGroupChannel | null>(null);
  const [
    reticulumChannelAreaMenuPosition,
    setReticulumChannelAreaMenuPosition,
  ] = useState<{
    mouseX: number;
    mouseY: number;
  } | null>(null);
  const [reticulumLargeImageChoice, setReticulumLargeImageChoice] = useState<{
    file: File;
    filePath: string;
    target: 'channel' | 'discussion';
  } | null>(null);
  const [isCompressingReticulumImage, setIsCompressingReticulumImage] =
    useState(false);
  const [isCompressingReticulumGif, setIsCompressingReticulumGif] =
    useState(false);
  const pendingReticulumFilesRef = useRef<PendingReticulumResourceFile[]>([]);
  const reticulumGifConversionSequenceRef = useRef(0);
  const reticulumGifConversionContextRef = useRef('');
  reticulumGifConversionContextRef.current = `${selectedGroup || ''}:${
    selectedReticulumChannelId || DEFAULT_RETICULUM_CHANNEL_ID
  }`;
  useEffect(() => {
    reticulumGifConversionSequenceRef.current += 1;
    setIsCompressingReticulumGif(false);
  }, [selectedGroup, selectedReticulumChannelId]);
  const reticulumChannelRefreshSeqRef = useRef(0);
  const reticulumChannelMetadataRefreshTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const hasInitializedWebsocket = useRef(false);
  const socketRef = useRef(null); // WebSocket reference
  const timeoutIdRef = useRef(null); // Timeout ID reference
  const groupSocketTimeoutRef = useRef(null); // Group Socket Timeout reference
  const editorRef = useRef(null);
  const [formattingTrayResetKey, setFormattingTrayResetKey] = useState(0);
  const { queueChats, addToQueue, processWithNewMessages } = useMessageQueue();
  const queueChatsRef = useRef(queueChats);
  queueChatsRef.current = queueChats;
  const {
    enabled: reticulumChatEnabled,
    events: reticulumChatEvents,
    initialHistoryReady: reticulumInitialHistoryReady,
    hasOlder: reticulumHasOlderMessages,
    hasNewer: reticulumHasNewerMessages,
    historyWindowRevision: reticulumHistoryWindowRevision,
    loadingOlder: reticulumLoadingOlderMessages,
    loadingNewer: reticulumLoadingNewerMessages,
    loadOlder: loadOlderReticulumMessages,
    loadNewer: loadNewerReticulumMessages,
    jumpToLatest: jumpToLatestReticulumMessages,
    openAroundEvent: openReticulumHistoryAroundEvent,
    publishEvent: publishReticulumChatEvent,
    sendTyping: sendReticulumTypingSignal,
    typing: reticulumTyping,
    visibilityChange: reticulumVisibilityChange,
    discussionIndex: reticulumDiscussionIndex,
    getDiscussionMessages: getReticulumDiscussionMessages,
  } = useReticulumGroupChat(selectedGroup, selectedReticulumChannelId);
  const [reticulumProcessedHistoryKey, setReticulumProcessedHistoryKey] =
    useState('');
  const shouldSuppressLegacyGroupChat =
    !reticulumChatEnabled && !isReticulumModeResolved;

  useEffect(() => {
    let cancelled = false;
    setIsReticulumModeResolved(false);
    setIsReticulumModeDetected(false);

    if (reticulumChatEnabled) {
      setIsReticulumModeDetected(true);
      setIsReticulumModeResolved(true);
      return () => {
        cancelled = true;
      };
    }

    void Promise.resolve(window.reticulumChat?.isEnabled?.())
      .then((enabled) => {
        if (!cancelled) setIsReticulumModeDetected(Boolean(enabled));
      })
      .catch(() => {
        if (!cancelled) setIsReticulumModeDetected(false);
      })
      .finally(() => {
        if (!cancelled) setIsReticulumModeResolved(true);
      });

    return () => {
      cancelled = true;
    };
  }, [reticulumChatEnabled, selectedGroup]);

  useEffect(() => {
    if (!reticulumChatEnabled) {
      setIsGroupNameTruncated(false);
      return;
    }
    const label = groupNameLabelRef.current;
    if (!label) return;
    const updateTruncation = () => {
      setIsGroupNameTruncated(label.scrollWidth > label.clientWidth + 1);
    };
    updateTruncation();
    const observer = new ResizeObserver(updateTruncation);
    observer.observe(label);
    return () => observer.disconnect();
  }, [reticulumChatEnabled, selectedGroupName]);

  const reticulumChatQueueId =
    reticulumChatEnabled && selectedGroup
      ? `${selectedGroup}:${selectedReticulumChannelId}`
      : selectedGroup;
  const reticulumChatEnabledRef = useRef(false);
  const [, forceUpdate] = useReducer((x) => x + 1, 0);
  const lastReadTimestamp = useRef(null);
  const handleUpdateRef = useRef(null);
  const iframeRef = useRef(null);
  const appliedReticulumEventIdsRef = useRef<Set<string>>(new Set());
  const reticulumInitialHistoryBatchSequenceRef = useRef(0);
  const appliedReticulumChannelMetadataEventIdsRef = useRef<Set<string>>(
    new Set()
  );
  const reticulumEventContextRef = useRef('');
  reticulumEventContextRef.current = `${selectedGroup || ''}:${
    selectedReticulumChannelId || DEFAULT_RETICULUM_CHANNEL_ID
  }:${reticulumVisibilityChange?.revision || 0}:${reticulumHistoryWindowRevision}`;
  const reticulumTypingStopTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const reticulumTypingActiveRef = useRef(false);
  const reticulumChatSummaries = useAtomValue(reticulumChatSummariesAtom);
  const [windowSize, setWindowSize] = useState(() =>
    typeof window !== 'undefined'
      ? {
          width: window.innerWidth,
          height: window.innerHeight,
        }
      : { width: 800, height: 600 }
  );
  const [qManagerSize, setQManagerSize] = useState(() => {
    const maxWidth =
      typeof window !== 'undefined'
        ? Math.max(Q_MANAGER_MIN_WIDTH, window.innerWidth)
        : 800;
    const maxHeight =
      typeof window !== 'undefined'
        ? Math.max(Q_MANAGER_MIN_HEIGHT, window.innerHeight - appHeighOffset)
        : 600;
    return {
      width: Math.min(
        maxWidth,
        Math.max(
          Q_MANAGER_MIN_WIDTH,
          qManagerPopupSize?.width ?? Q_MANAGER_DEFAULT_WIDTH
        )
      ),
      height: Math.min(
        maxHeight,
        Math.max(
          Q_MANAGER_MIN_HEIGHT,
          qManagerPopupSize?.height ?? Q_MANAGER_DEFAULT_HEIGHT
        )
      ),
    };
  });
  const [isResizingQManager, setIsResizingQManager] = useState(false);
  const qManagerResizeInitialSizeRef = useRef(qManagerSize);

  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const maxQManagerWidth = Math.max(Q_MANAGER_MIN_WIDTH, windowSize.width);
  const maxQManagerHeight = Math.max(
    Q_MANAGER_MIN_HEIGHT,
    windowSize.height - appHeighOffset
  );

  const clampQManagerSize = useCallback(
    (size: { width: number; height: number }) => ({
      width: Math.min(
        maxQManagerWidth,
        Math.max(Q_MANAGER_MIN_WIDTH, size.width)
      ),
      height: Math.min(
        maxQManagerHeight,
        Math.max(Q_MANAGER_MIN_HEIGHT, size.height)
      ),
    }),
    [maxQManagerWidth, maxQManagerHeight]
  );

  const qManagerPosition = useMemo(() => {
    const anchorBottom = qManagerAnchorRect?.bottom ?? appHeighOffset + 50;
    const anchorCenter =
      qManagerAnchorRect !== null
        ? qManagerAnchorRect.left + qManagerAnchorRect.width / 2
        : windowSize.width - 120;
    return {
      x: Math.max(
        8,
        Math.min(
          windowSize.width - qManagerSize.width - 8,
          anchorCenter - qManagerSize.width / 2
        )
      ),
      y: Math.max(
        appHeighOffset + 8,
        Math.min(windowSize.height - qManagerSize.height - 8, anchorBottom + 8)
      ),
    };
  }, [
    windowSize.width,
    windowSize.height,
    qManagerSize.width,
    qManagerSize.height,
    qManagerAnchorRect,
  ]);

  useEffect(() => {
    reticulumChatEnabledRef.current = reticulumChatEnabled;
  }, [reticulumChatEnabled]);

  useEffect(() => {
    const onResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!qManagerPopupSize) return;
    setQManagerSize(clampQManagerSize(qManagerPopupSize));
  }, [qManagerPopupSize, clampQManagerSize]);

  useEffect(() => {
    setQManagerSize((current) => clampQManagerSize(current));
  }, [clampQManagerSize]);

  const handleQManagerResizeStart = useCallback(() => {
    qManagerResizeInitialSizeRef.current = qManagerSize;
    setIsResizingQManager(true);
  }, [qManagerSize]);

  const handleQManagerResize = useCallback(
    (
      _event,
      _direction,
      _elementRef,
      delta: { width: number; height: number }
    ) => {
      const initialSize = qManagerResizeInitialSizeRef.current;
      setQManagerSize(
        clampQManagerSize({
          width: initialSize.width + delta.width,
          height: initialSize.height + delta.height,
        })
      );
    },
    [clampQManagerSize]
  );

  const handleQManagerResizeStop = useCallback(
    (_event, _direction, elementRef: HTMLElement) => {
      const nextSize = clampQManagerSize({
        width: elementRef.offsetWidth,
        height: elementRef.offsetHeight,
      });

      setQManagerSize(nextSize);
      setQManagerPopupSize(nextSize);
      setIsResizingQManager(false);
    },
    [clampQManagerSize, setQManagerPopupSize]
  );

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
    if (!selectedGroup || !isActive) return;
    getTimestampEnterChat(selectedGroup);
  }, [selectedGroup, isActive]);

  useEffect(() => {
    // A channel selection belongs to the group, not to the asynchronous
    // Reticulum-enabled probe. The Reticulum and legacy ChatGroup instances
    // are mounted separately when that mode changes, so resetting here on a
    // late mode update only overrides a channel the reader already selected.
    reticulumChannelRefreshSeqRef.current += 1;
    setReticulumChannels([]);
    setReticulumCategories([]);
    setReticulumChannelMetadataVisibleGroupId('');
    reticulumChannelSnapshotGroupIdRef.current = '';
    setSelectedReticulumChannelId(DEFAULT_RETICULUM_CHANNEL_ID);
    setReticulumChannelSettingsOpen(false);
    setEditingReticulumChannel(null);
  }, [selectedGroup]);

  const refreshReticulumChannels = useCallback(async (): Promise<boolean> => {
    const groupId = Number(selectedGroup);
    const refreshSeq = ++reticulumChannelRefreshSeqRef.current;
    if (!Number.isInteger(groupId) || groupId <= 0) {
      setReticulumChannels([]);
      setReticulumCategories([]);
      setReticulumChannelStateGroupId('');
      setReticulumChannelMetadataVisibleGroupId('');
      reticulumChannelSnapshotGroupIdRef.current = '';
      setSelectedReticulumChannelId(DEFAULT_RETICULUM_CHANNEL_ID);
      return false;
    }
    const metadata =
      await window.reticulumChat?.getChannelMetadataBundle?.(groupId);
    const parsedChannels = Array.isArray(metadata?.channels)
      ? (metadata.channels as ReticulumGroupChannel[])
      : [];
    const parsedCategories = Array.isArray(metadata?.categories)
      ? (metadata.categories as ReticulumGroupCategory[])
      : [];
    if (reticulumChannelRefreshSeqRef.current !== refreshSeq) return false;
    // Do not briefly render the synthetic fallback channels while metadata is
    // still arriving; it produces a misleading default-category selection.
    if (parsedChannels.length === 0) return false;
    reticulumChannelSnapshotGroupIdRef.current = String(groupId);
    setReticulumChannelStateGroupId(String(groupId));
    const availableChannels = parsedChannels.filter(
      (channel) => !channel.archived
    );
    setReticulumCategories(parsedCategories);
    setReticulumChannels(availableChannels);
    setSelectedReticulumChannelId((current) =>
      availableChannels.some((channel) => channel.channelId === current)
        ? current
        : (availableChannels.find(
            (channel) => channel.channelId === DEFAULT_RETICULUM_CHANNEL_ID
          )?.channelId ??
          availableChannels[0]?.channelId ??
          DEFAULT_RETICULUM_CHANNEL_ID)
    );
    const metadataReady = metadata?.ready === true;
    if (metadataReady) {
      setReticulumChannelMetadataVisibleGroupId(String(groupId));
    }
    return metadataReady;
  }, [selectedGroup]);

  useEffect(() => {
    if (!reticulumChatEnabled || !selectedGroup) return;
    const groupId = Number(selectedGroup);
    if (!Number.isInteger(groupId) || groupId <= 0) return;
    let cancelled = false;

    void (async () => {
      const retryDelays = [0, ...RETICULUM_CHANNEL_LOAD_RETRY_DELAYS_MS];
      let lastError: unknown = null;
      let subscriptionRequested = false;
      for (const delayMs of retryDelays) {
        if (delayMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        }
        if (cancelled) return;

        try {
          // Subscription establishes the local group hint before membership-backed
          // channel read. Once accepted, avoid repeating its projection repair
          // and sync scheduling work while merely polling for the snapshot.
          if (!subscriptionRequested) {
            await window.reticulumChat?.subscribeGroup?.(groupId);
            subscriptionRequested = true;
          }
          if (cancelled) return;
          if (await refreshReticulumChannels()) return;
        } catch (error) {
          lastError = error;
        }
      }
      // A group can legitimately have no custom categories. Keep the tree
      // hidden while metadata is settling, then reveal that uncategorized
      // layout only after the bounded retry window completes.
      if (
        !cancelled &&
        reticulumChannelSnapshotGroupIdRef.current === String(groupId)
      ) {
        setReticulumChannelMetadataVisibleGroupId(String(groupId));
      }
      if (!cancelled && lastError) {
        console.warn(
          'Unable to finish loading Reticulum chat channels',
          lastError
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isReticulumChannelAdmin,
    refreshReticulumChannels,
    reticulumChannelAccessReady,
    reticulumChatEnabled,
    selectedGroup,
  ]);

  useEffect(() => {
    if (!reticulumChatEnabled || !selectedGroup) return;
    const groupId = Number(selectedGroup);
    if (!Number.isInteger(groupId) || groupId <= 0) return;
    const offSummaryChanged = window.reticulumChat?.onSummaryChanged?.(
      (payload) => {
        if (
          payload?.metadataChanged !== true ||
          Number(payload.groupId) !== groupId
        )
          return;
        if (reticulumChannelMetadataRefreshTimerRef.current) {
          clearTimeout(reticulumChannelMetadataRefreshTimerRef.current);
        }
        reticulumChannelMetadataRefreshTimerRef.current = setTimeout(() => {
          reticulumChannelMetadataRefreshTimerRef.current = null;
          void refreshReticulumChannels().catch((error) => {
            console.warn('Unable to refresh Reticulum chat metadata', error);
          });
        }, 50);
      }
    );
    return () => {
      offSummaryChanged?.();
      if (reticulumChannelMetadataRefreshTimerRef.current) {
        clearTimeout(reticulumChannelMetadataRefreshTimerRef.current);
        reticulumChannelMetadataRefreshTimerRef.current = null;
      }
    };
  }, [refreshReticulumChannels, reticulumChatEnabled, selectedGroup]);

  const reticulumChannelSummariesById = useMemo(() => {
    const groupId = Number(selectedGroup);
    if (!Number.isInteger(groupId) || groupId <= 0) {
      return new Map<string, ReticulumChatSummaryAtomEntry>();
    }
    const summary = reticulumChatSummaries?.[String(groupId)];
    const channels = Array.isArray(summary?.channels) ? summary.channels : [];
    const entries: Array<[string, ReticulumChatSummaryAtomEntry]> = [];
    for (const channelSummary of channels) {
      const channelId =
        normalizeReticulumChannelName(channelSummary?.channelId || '') ||
        DEFAULT_RETICULUM_CHANNEL_ID;
      entries.push([channelId, channelSummary]);
    }
    return new Map(entries);
  }, [reticulumChatSummaries, selectedGroup]);

  const selectedReticulumGroupKey = selectedGroup ? String(selectedGroup) : '';
  const reticulumAllChannelsForSelectedGroup =
    reticulumChannelStateGroupId === selectedReticulumGroupKey
      ? reticulumChannels
      : [];
  const reticulumAllCategoriesForSelectedGroup =
    reticulumChannelStateGroupId === selectedReticulumGroupKey
      ? reticulumCategories
      : [];
  const reticulumDefaultCategoryMetadata = useMemo(
    () =>
      reticulumAllCategoriesForSelectedGroup.find(
        (category) =>
          category.categoryId === DEFAULT_RETICULUM_CATEGORY_METADATA_ID
      ) || null,
    [reticulumAllCategoriesForSelectedGroup]
  );
  const reticulumRegularCategoriesForSelectedGroup = useMemo(
    () =>
      reticulumAllCategoriesForSelectedGroup.filter(
        (category) =>
          category.categoryId !== DEFAULT_RETICULUM_CATEGORY_METADATA_ID
      ),
    [reticulumAllCategoriesForSelectedGroup]
  );
  const isReticulumChannelMetadataVisible =
    reticulumChannelMetadataVisibleGroupId === selectedReticulumGroupKey;
  const reticulumChannelsForSelectedGroup = useMemo(
    () =>
      reticulumAllChannelsForSelectedGroup.filter(
        (channel) =>
          channel.readMode !== RETICULUM_CHANNEL_READ_MODE_ADMINS ||
          isReticulumChannelAdmin
      ),
    [isReticulumChannelAdmin, reticulumAllChannelsForSelectedGroup]
  );
  const reticulumCategoriesForSelectedGroup = useMemo(() => {
    if (isReticulumChannelAdmin)
      return reticulumRegularCategoriesForSelectedGroup;
    const visibleCategoryIds = new Set(
      reticulumChannelsForSelectedGroup
        .map((channel) => channel.categoryId)
        .filter((categoryId): categoryId is string => Boolean(categoryId))
    );
    return reticulumRegularCategoriesForSelectedGroup.filter((category) =>
      visibleCategoryIds.has(category.categoryId)
    );
  }, [
    isReticulumChannelAdmin,
    reticulumRegularCategoriesForSelectedGroup,
    reticulumChannelsForSelectedGroup,
  ]);

  useEffect(() => {
    if (!reticulumChatEnabled) return;
    if (
      reticulumChannelsForSelectedGroup.some(
        (channel) => channel.channelId === selectedReticulumChannelId
      )
    ) {
      return;
    }
    setSelectedReticulumChannelId(
      reticulumChannelsForSelectedGroup.find(
        (channel) => channel.channelId === DEFAULT_RETICULUM_CHANNEL_ID
      )?.channelId ??
        reticulumChannelsForSelectedGroup[0]?.channelId ??
        DEFAULT_RETICULUM_CHANNEL_ID
    );
  }, [
    reticulumChannelsForSelectedGroup,
    reticulumChatEnabled,
    selectedReticulumChannelId,
  ]);

  const reticulumChannelsByCategory = useMemo(() => {
    const categoryIds = new Set(
      reticulumCategoriesForSelectedGroup.map((category) => category.categoryId)
    );
    const grouped = new Map<string, ReticulumGroupChannel[]>();
    for (const category of reticulumCategoriesForSelectedGroup)
      grouped.set(category.categoryId, []);
    grouped.set('', []);
    for (const channel of reticulumChannelsForSelectedGroup) {
      const categoryId =
        channel.categoryId && categoryIds.has(channel.categoryId)
          ? channel.categoryId
          : '';
      grouped.set(categoryId, [...(grouped.get(categoryId) ?? []), channel]);
    }
    for (const [categoryId, channels] of grouped.entries()) {
      grouped.set(
        categoryId,
        [...channels].sort(
          (a, b) => a.position - b.position || a.name.localeCompare(b.name)
        )
      );
    }
    return grouped;
  }, [reticulumCategoriesForSelectedGroup, reticulumChannelsForSelectedGroup]);
  const reticulumDefaultCategoryChannels =
    reticulumChannelsByCategory.get('') ?? [];
  const reticulumDefaultCategoryHasProtectedChannels =
    reticulumDefaultCategoryChannels.some((channel) =>
      isReticulumSystemChannelId(channel.channelId)
    );
  const reticulumDefaultCategoryIsHidden =
    reticulumDefaultCategoryMetadata?.name ===
      HIDDEN_RETICULUM_DEFAULT_CATEGORY_NAME &&
    !reticulumDefaultCategoryHasProtectedChannels;
  const reticulumDefaultCategoryName =
    reticulumDefaultCategoryMetadata &&
    reticulumDefaultCategoryMetadata.name !==
      HIDDEN_RETICULUM_DEFAULT_CATEGORY_NAME
      ? reticulumDefaultCategoryMetadata.name
      : 'Channels';
  const reticulumDefaultCategoryUi = useMemo<ReticulumGroupCategory>(
    () => ({
      categoryId: DEFAULT_RETICULUM_CATEGORY_METADATA_ID,
      groupId: Number(selectedGroup) || 0,
      name: reticulumDefaultCategoryName,
      position: 0,
      createdBy: reticulumDefaultCategoryMetadata?.createdBy || '',
      createdAt: reticulumDefaultCategoryMetadata?.createdAt || 0,
      updatedAt: reticulumDefaultCategoryMetadata?.updatedAt || 0,
    }),
    [
      reticulumDefaultCategoryMetadata?.createdAt,
      reticulumDefaultCategoryMetadata?.createdBy,
      reticulumDefaultCategoryMetadata?.updatedAt,
      reticulumDefaultCategoryName,
      selectedGroup,
    ]
  );

  const selectedReticulumChannel = useMemo(
    () =>
      reticulumChannelsForSelectedGroup.find(
        (channel) => channel.channelId === selectedReticulumChannelId
      ) || null,
    [reticulumChannelsForSelectedGroup, selectedReticulumChannelId]
  );
  const selectedReticulumChannelExpiryDurationMs =
    selectedReticulumChannel?.expiryDurationMs ??
    (selectedReticulumChannelId === DEFAULT_RETICULUM_CHANNEL_ID
      ? TIME_MONTHS_1_IN_MILLISECONDS
      : selectedReticulumChannelId === QORTAL_LAND_RETICULUM_CHANNEL_ID
        ? TIME_DAYS_1_IN_MILLISECONDS
        : undefined);

  useEffect(() => {
    setReticulumMessageExpiryDurationMs(undefined);
  }, [selectedGroup, selectedReticulumChannelId]);

  useEffect(() => {
    setReticulumMessageExpiryDurationMs((current) =>
      current === undefined ||
      isReticulumMessageExpiryOptionAllowed(
        current,
        selectedReticulumChannelExpiryDurationMs
      )
        ? current
        : undefined
    );
  }, [selectedReticulumChannelExpiryDurationMs]);

  useEffect(() => {
    if (onEditMessage) setReticulumMessageExpiryDurationMs(undefined);
  }, [onEditMessage]);
  const reticulumVisibleChannelIds = useMemo(
    () =>
      new Set(
        reticulumChannelsForSelectedGroup.map((channel) =>
          normalizeReticulumChannelName(channel.channelId)
        )
      ),
    [reticulumChannelsForSelectedGroup]
  );
  const reticulumVisibleChannelNameById = useMemo(() => {
    const entries: Array<[string, string]> =
      reticulumChannelsForSelectedGroup.map((channel) => [
        normalizeReticulumChannelName(channel.channelId),
        channel.name || channel.channelId,
      ]);
    return new Map(entries);
  }, [reticulumChannelsForSelectedGroup]);
  const reticulumChannelLinkAccess = useMemo(
    () => ({
      groupId: Number(selectedGroup),
      ready:
        Number.isInteger(Number(selectedGroup)) &&
        Number(selectedGroup) > 0 &&
        isReticulumChannelMetadataVisible,
      visibleChannelNameById: reticulumVisibleChannelNameById,
    }),
    [
      isReticulumChannelMetadataVisible,
      reticulumVisibleChannelNameById,
      selectedGroup,
    ]
  );
  const reticulumMemberNameByAddress = useMemo(() => {
    const entries = groupMentionMembers
      .filter((member) => member.address)
      .map((member) => [
        member.address,
        member.name || shortenReticulumAddress(member.address),
      ]);
    if (myAddress && myName) entries.push([myAddress, myName]);
    return new Map(entries);
  }, [groupMentionMembers, myAddress, myName]);

  useEffect(() => {
    const groupId = Number(selectedGroup);
    if (
      !reticulumChatEnabled ||
      !Number.isInteger(groupId) ||
      groupId <= 0 ||
      !window.reticulumChat?.getCalendarEvents
    ) {
      setReticulumCalendarSystemOccurrences([]);
      return;
    }

    let cancelled = false;
    const refresh = async () => {
      const now = Date.now();
      try {
        const occurrences = await window.reticulumChat.getCalendarEvents(
          groupId,
          now - RETICULUM_CALENDAR_SYSTEM_RANGE_MS,
          now + RETICULUM_CALENDAR_SYSTEM_RANGE_MS
        );
        if (!cancelled) {
          setReticulumCalendarSystemOccurrences(occurrences);
          setReticulumCalendarSystemNow(now);
        }
      } catch {
        if (!cancelled) setReticulumCalendarSystemOccurrences([]);
      }
    };

    void refresh();
    const unsubscribe = window.reticulumChat.onCalendarChanged?.((payload) => {
      if (Number(payload?.groupId) === groupId) void refresh();
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [reticulumChatEnabled, selectedGroup]);

  useEffect(() => {
    if (
      reticulumChatEnabled &&
      selectedReticulumChannelId === DEFAULT_RETICULUM_CHANNEL_ID
    ) {
      setReticulumCalendarSystemNow(Date.now());
    }
  }, [reticulumChatEnabled, selectedReticulumChannelId]);

  useEffect(() => {
    if (
      !reticulumChatEnabled ||
      selectedReticulumChannelId !== DEFAULT_RETICULUM_CHANNEL_ID ||
      reticulumCalendarSystemOccurrences.length === 0
    ) {
      return;
    }

    const nextBoundary = reticulumCalendarSystemOccurrences.reduce(
      (closest, occurrence) => {
        const boundaries = [
          occurrence.occurrenceStart -
            RETICULUM_CALENDAR_TEN_MINUTES_MS,
          occurrence.occurrenceStart,
        ];
        for (const boundary of boundaries) {
          if (
            boundary > reticulumCalendarSystemNow &&
            (closest === null || boundary < closest)
          ) {
            closest = boundary;
          }
        }
        return closest;
      },
      null as number | null
    );
    if (nextBoundary === null) return;

    const delay = Math.min(
      RETICULUM_CALENDAR_TIMER_MAX_DELAY_MS,
      Math.max(0, nextBoundary - Date.now() + 25)
    );
    const timer = window.setTimeout(() => {
      setReticulumCalendarSystemNow(Date.now());
    }, delay);
    return () => window.clearTimeout(timer);
  }, [
    reticulumCalendarSystemNow,
    reticulumCalendarSystemOccurrences,
    reticulumChatEnabled,
    selectedReticulumChannelId,
  ]);

  const reticulumCalendarSystemMessages = useMemo(() => {
    if (
      !reticulumChatEnabled ||
      selectedReticulumChannelId !== DEFAULT_RETICULUM_CHANNEL_ID
    ) {
      return [];
    }

    const groupId = Number(selectedGroup);
    const groupName = selectedGroupName || 'Group';
    const buildMessage = (
      occurrence: ReticulumCalendarOccurrence,
      kind: 'ten-minutes' | 'started',
      timestamp: number,
      html: string
    ) => {
      const signature = `calendar-system:${kind}:${occurrence.occurrenceId}`;
      const qchatSystem = {
        type: `calendar-event-${kind}`,
        groupId,
        groupName,
        groupAvatarOwnerName: reticulumGroupOwnerName,
        eventId: occurrence.eventId,
        occurrenceId: occurrence.occurrenceId,
      };
      return {
        signature,
        id: signature,
        groupId,
        channelId: DEFAULT_RETICULUM_CHANNEL_ID,
        sender: '__qortal_calendar_system__',
        senderName: groupName,
        timestamp,
        eventType: 'calendar_system',
        reticulumChat: true,
        syntheticReticulumCalendarSystem: true,
        qchatSystem,
        decryptedData: { messageText: html, qchatSystem },
        message: html,
        messageText: html,
        text: html,
        isNotEncrypted: true,
        unread: false,
      };
    };

    const messages: any[] = [];
    for (const occurrence of reticulumCalendarSystemOccurrences) {
      const creatorName =
        reticulumMemberNameByAddress.get(occurrence.creatorAddress) ||
        shortenReticulumAddress(occurrence.creatorAddress);
      const creator = escapeReticulumMessageHtml(creatorName);
      const title = escapeReticulumMessageHtml(occurrence.title);
      const description = escapeReticulumMessageHtml(
        occurrence.description || 'Not specified'
      );

      if (
        reticulumCalendarSystemNow >=
        occurrence.occurrenceStart - RETICULUM_CALENDAR_TEN_MINUTES_MS
      ) {
        messages.push(
          buildMessage(
            occurrence,
            'ten-minutes',
            occurrence.occurrenceStart - RETICULUM_CALENDAR_TEN_MINUTES_MS,
            `<p><strong>${creator}'s Event will start in 10 minutes.</strong><br><strong>Details</strong><br>Title: ${title}<br>Description: ${description}</p>`
          )
        );
      }

      if (reticulumCalendarSystemNow >= occurrence.occurrenceStart) {
        messages.push(
          buildMessage(
            occurrence,
            'started',
            occurrence.occurrenceStart,
            `<p><strong>${creator}'s Event has begun!</strong><br><strong>Details</strong><br>Title: ${title}<br>Description: ${description}</p>`
          )
        );
      }
    }
    return messages;
  }, [
    reticulumCalendarSystemNow,
    reticulumCalendarSystemOccurrences,
    reticulumChatEnabled,
    reticulumGroupOwnerName,
    reticulumMemberNameByAddress,
    selectedGroup,
    selectedGroupName,
    selectedReticulumChannelId,
  ]);

  const renderedMessages = useMemo(
    () =>
      reticulumCalendarSystemMessages.length
        ? [...messages, ...reticulumCalendarSystemMessages]
        : messages,
    [messages, reticulumCalendarSystemMessages]
  );

  const reticulumMentionUsers = useMemo(() => {
    const users: Record<
      string,
      { address: string; name?: string; role?: 'admin' | 'owner' }
    > = {};
    for (const member of groupMentionMembers) {
      if (!member.address) continue;
      const displayName =
        member.name || shortenReticulumAddress(member.address);
      users[displayName.toLowerCase()] = {
        address: member.address,
        name: displayName,
        role: member.role,
      };
      users[member.address.toLowerCase()] = {
        address: member.address,
        name: displayName,
        role: member.role,
      };
    }
    if (myAddress) {
      const displayName = myName || shortenReticulumAddress(myAddress);
      const role = groupMentionMembers.find(
        (member) => member.address === myAddress
      )?.role;
      users[displayName.toLowerCase()] = {
        address: myAddress,
        name: displayName,
        role,
      };
      users[myAddress.toLowerCase()] = {
        address: myAddress,
        name: displayName,
        role,
      };
    }
    return users;
  }, [groupMentionMembers, myAddress, myName]);

  const reticulumMemberJoinedByAddress = useMemo(() => {
    const joinedByAddress: Record<string, number> = {};
    for (const member of groupMentionMembers) {
      const joined = Number(member.joined);
      if (member.address && Number.isFinite(joined) && joined > 0) {
        joinedByAddress[member.address] = joined;
      }
    }
    return joinedByAddress;
  }, [groupMentionMembers]);

  const loadActiveReticulumGroupSilences = useCallback(async () => {
    const groupId = Number(selectedGroup);
    if (
      !reticulumChatEnabled ||
      !myAddress ||
      !Number.isInteger(groupId) ||
      groupId <= 0 ||
      !window.reticulumChat?.listSilences
    ) {
      return [];
    }
    const silences = await window.reticulumChat.listSilences(
      myAddress,
      'group',
      groupId
    );
    return silences.filter(
      (silence): silence is ReticulumSilenceState =>
        silence.active && silence.scopeId === String(groupId)
    );
  }, [myAddress, reticulumChatEnabled, selectedGroup]);

  const setReticulumHiddenAuthorsFromSilences = useCallback(
    (silences: ReticulumSilenceState[]) => {
      const groupId = Number(selectedGroup);
      const nextHiddenAuthors =
        Number.isInteger(groupId) && groupId > 0
          ? activeReticulumHiddenAuthorsForGroup(silences, groupId)
          : new Set<string>();
      setReticulumHiddenAuthorAddresses((current) =>
        areStringSetsEqual(current, nextHiddenAuthors)
          ? current
          : nextHiddenAuthors
      );
    },
    [selectedGroup]
  );

  const isReticulumHiddenAuthor = useCallback(
    (address: unknown) => {
      const normalizedAddress = normalizeReticulumHideAddress(address);
      return (
        Boolean(normalizedAddress) &&
        reticulumHiddenAuthorAddresses.has(normalizedAddress)
      );
    },
    [reticulumHiddenAuthorAddresses]
  );

  const filterReticulumVisibleMessages = useCallback(
    <T extends { sender?: unknown }>(items: T[]): T[] =>
      items.filter((item) => !isReticulumHiddenAuthor(item?.sender)),
    [isReticulumHiddenAuthor]
  );

  const reticulumReactionReferences = useMemo(() => {
    if (!reticulumChatEnabled) return {};
    return projectReticulumReactionReferences(
      reticulumChatEvents.filter(
        (event: any) =>
          !isChatSenderBlocked({ sender: event?.authorAddress }) &&
          !isReticulumHiddenAuthor(event?.authorAddress)
      )
    );
  }, [
    isChatSenderBlocked,
    isReticulumHiddenAuthor,
    reticulumChatEnabled,
    reticulumChatEvents,
  ]);
  const renderedChatReferences = useMemo(() => {
    if (!reticulumChatEnabled) return chatReferences;
    const next: Record<string, any> = {};
    for (const [targetEventId, reference] of Object.entries(
      chatReferences as Record<string, any>
    )) {
      const { reactions: _incrementalReactions, ...otherReferenceState } =
        reference || {};
      const projectedReactions =
        reticulumReactionReferences[targetEventId]?.reactions;
      if (projectedReactions || Object.keys(otherReferenceState).length > 0) {
        next[targetEventId] = {
          ...otherReferenceState,
          ...(projectedReactions ? { reactions: projectedReactions } : {}),
        };
      }
    }
    for (const [targetEventId, reference] of Object.entries(
      reticulumReactionReferences
    )) {
      if (!next[targetEventId]) next[targetEventId] = reference;
    }
    return next;
  }, [chatReferences, reticulumChatEnabled, reticulumReactionReferences]);

  useEffect(() => {
    let cancelled = false;
    const groupId = Number(selectedGroup);
    if (!reticulumChatEnabled || !Number.isInteger(groupId) || groupId <= 0) {
      setReticulumHiddenAuthorAddresses((current) =>
        current.size === 0 ? current : new Set<string>()
      );
      return;
    }
    void loadActiveReticulumGroupSilences()
      .then((silences) => {
        if (cancelled) return;
        setReticulumHiddenAuthorsFromSilences(silences);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[ReticulumChat] Failed to load hidden users:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [
    loadActiveReticulumGroupSilences,
    reticulumChatEnabled,
    selectedGroup,
    setReticulumHiddenAuthorsFromSilences,
  ]);

  useEffect(() => {
    const groupId = Number(selectedGroup);
    if (!reticulumChatEnabled || !Number.isInteger(groupId) || groupId <= 0)
      return;
    return window.reticulumChat?.onSilenceChanged?.((payload) => {
      if (
        payload.scopeType === 'group' &&
        Number(payload.scopeId) === groupId
      ) {
        const targetAddress = normalizeReticulumHideAddress(
          payload.targetAddress
        );
        if (targetAddress) {
          setReticulumHiddenAuthorAddresses((current) => {
            const next = new Set(current);
            if (payload.active) {
              next.add(targetAddress);
            } else {
              next.delete(targetAddress);
            }
            return areStringSetsEqual(current, next) ? current : next;
          });
        }
      }
    });
  }, [reticulumChatEnabled, selectedGroup]);

  const reticulumHiddenUsersForSelectedGroup = useMemo(
    () =>
      [...reticulumHiddenAuthorAddresses]
        .map((address) => {
          const member = groupMentionMembers.find(
            (candidate) => candidate.address === address
          );
          return {
            address,
            name:
              member?.name ||
              reticulumMemberNameByAddress.get(address) ||
              address,
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name)),
    [
      groupMentionMembers,
      reticulumHiddenAuthorAddresses,
      reticulumMemberNameByAddress,
    ]
  );

  const unhideReticulumGroupUser = useCallback(
    async (address: string) => {
      const groupId = Number(selectedGroup);
      if (
        reticulumUnhidingAddress ||
        !myAddress ||
        !Number.isInteger(groupId) ||
        groupId <= 0 ||
        !window.reticulumChat?.clearSilence
      ) {
        return;
      }
      setReticulumUnhidingAddress(address);
      setReticulumHiddenUsersError('');
      try {
        const result = await window.reticulumChat.clearSilence(
          myAddress,
          address,
          'group',
          groupId
        );
        if (!result?.success) {
          throw new Error(result?.error || 'Unable to unhide user');
        }
        setReticulumHiddenAuthorAddresses((current) => {
          if (!current.has(address)) return current;
          const next = new Set(current);
          next.delete(address);
          return next;
        });
      } catch (error) {
        setReticulumHiddenUsersError(
          error instanceof Error ? error.message : 'Unable to unhide user'
        );
      } finally {
        setReticulumUnhidingAddress('');
      }
    },
    [myAddress, reticulumUnhidingAddress, selectedGroup]
  );

  const reticulumSearchAuthorOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of groupMentionMembers) {
      if (member.address && !isReticulumHiddenAuthor(member.address))
        map.set(member.address, member.name || member.address);
    }
    for (const message of messages) {
      if (message?.sender) {
        map.set(
          message.sender,
          message.senderName ||
            reticulumMemberNameByAddress.get(message.sender) ||
            message.sender
        );
      }
    }
    if (myAddress) map.set(myAddress, myName || myAddress);
    return [...map.entries()]
      .map(([address, name]) => ({ address, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [
    groupMentionMembers,
    isReticulumHiddenAuthor,
    messages,
    myAddress,
    myName,
    reticulumMemberNameByAddress,
  ]);
  const reticulumSearchActiveFilterCount = useMemo(() => {
    return [
      reticulumSearchChannelFilter !== RETICULUM_SEARCH_CHANNEL_CURRENT,
      Boolean(reticulumSearchAuthorFilter),
      reticulumSearchHasFilter !== RETICULUM_SEARCH_HAS_ANY,
      Boolean(reticulumSearchAfterDate),
      Boolean(reticulumSearchBeforeDate),
      reticulumSearchSort !== 'relevance',
    ].filter(Boolean).length;
  }, [
    reticulumSearchAfterDate,
    reticulumSearchAuthorFilter,
    reticulumSearchBeforeDate,
    reticulumSearchChannelFilter,
    reticulumSearchHasFilter,
    reticulumSearchSort,
  ]);
  const reticulumSearchChannelFilterLabel = useMemo(() => {
    if (reticulumSearchChannelFilter === RETICULUM_SEARCH_CHANNEL_CURRENT) {
      const selectedChannelName =
        reticulumVisibleChannelNameById.get(selectedReticulumChannelId) ||
        selectedReticulumChannelId;
      return `#${selectedChannelName}`;
    }
    if (reticulumSearchChannelFilter === RETICULUM_SEARCH_CHANNEL_ALL) {
      return 'All channels';
    }
    return `#${
      reticulumVisibleChannelNameById.get(reticulumSearchChannelFilter) ||
      reticulumSearchChannelFilter
    }`;
  }, [
    reticulumSearchChannelFilter,
    reticulumVisibleChannelNameById,
    selectedReticulumChannelId,
  ]);
  const reticulumSearchAuthorFilterLabel = useMemo(() => {
    if (!reticulumSearchAuthorFilter) return 'Anyone';
    return (
      reticulumSearchAuthorOptions.find(
        (author) => author.address === reticulumSearchAuthorFilter
      )?.name || reticulumSearchAuthorFilter
    );
  }, [reticulumSearchAuthorFilter, reticulumSearchAuthorOptions]);
  const reticulumSearchHasFilterLabel =
    reticulumSearchHasFilter === RETICULUM_SEARCH_HAS_ATTACHMENT
      ? 'Attachment'
      : reticulumSearchHasFilter === RETICULUM_SEARCH_HAS_LINK
        ? 'Link'
        : 'Anything';
  const reticulumSearchSortLabel =
    reticulumSearchSort === 'newest'
      ? 'Newest'
      : reticulumSearchSort === 'oldest'
        ? 'Oldest'
        : 'Relevant';
  const reticulumSearchDateFilterLabel =
    reticulumSearchAfterDate || reticulumSearchBeforeDate
      ? `${reticulumSearchAfterDate || 'any'} -> ${reticulumSearchBeforeDate || 'any'}`
      : 'Any time';
  const reticulumSearchVisiblePageNumbers = useMemo(() => {
    const pages = new Set<number>([0, reticulumSearchPage]);
    if (reticulumSearchPage > 0) pages.add(reticulumSearchPage - 1);
    if (reticulumSearchHasNextPage) pages.add(reticulumSearchPage + 1);
    return [...pages].sort((a, b) => a - b);
  }, [reticulumSearchHasNextPage, reticulumSearchPage]);
  const clearReticulumSearchFilters = useCallback(() => {
    setReticulumSearchChannelFilter(RETICULUM_SEARCH_CHANNEL_CURRENT);
    setReticulumSearchAuthorFilter('');
    setReticulumSearchHasFilter(RETICULUM_SEARCH_HAS_ANY);
    setReticulumSearchAfterDate('');
    setReticulumSearchBeforeDate('');
    setReticulumSearchSort('relevance');
  }, []);
  const openReticulumSearchFilterMenu = useCallback(
    (
      menu: 'in' | 'from' | 'has' | 'date' | 'sort',
      event: ReactMouseEvent<HTMLElement>
    ) => {
      setReticulumSearchFilterMenu(menu);
      setReticulumSearchFilterAnchorEl(event.currentTarget);
    },
    []
  );
  const closeReticulumSearchFilterMenu = useCallback(() => {
    setReticulumSearchFilterMenu(null);
    setReticulumSearchFilterAnchorEl(null);
  }, []);
  const selectedReticulumChannelWriteMode =
    selectedReticulumChannel?.writeMode === RETICULUM_CHANNEL_WRITE_MODE_ADMINS
      ? RETICULUM_CHANNEL_WRITE_MODE_ADMINS
      : RETICULUM_CHANNEL_WRITE_MODE_MEMBERS;
  const canWriteSelectedReticulumChannel =
    !reticulumChatEnabled ||
    selectedReticulumChannelWriteMode !== RETICULUM_CHANNEL_WRITE_MODE_ADMINS ||
    isReticulumChannelAdmin;

  useEffect(() => {
    const groupId = Number(selectedGroup);
    if (!Number.isInteger(groupId) || groupId <= 0) {
      setGroupMentionMembers([]);
      setReticulumGroupOwnerName('');
      setReticulumMemberDataGroupId(null);
      setReticulumPrivilegedMemberRolesByAddress({});
      setReticulumMemberRolesReady(false);
      return;
    }
    let cancelled = false;
    setReticulumMemberDataGroupId(null);
    setReticulumMemberRolesReady(false);
    void getGroupMembers(groupId)
      .then(async (data) => {
        if (cancelled) return;
        const [adminAddresses, groupDetails] = await Promise.all([
          getGroupAdminsAddress(groupId).catch(() => []),
          fetch(`${getBaseApiReact()}/groups/${groupId}`)
            .then((response) => (response.ok ? response.json() : null))
            .catch(() => null),
        ]);
        if (cancelled) return;
        const adminAddressSet = new Set(adminAddresses);
        const ownerAddress =
          typeof groupDetails?.owner === 'string' ? groupDetails.owner : '';
        const ownerName =
          typeof groupDetails?.ownerPrimaryName === 'string'
            ? groupDetails.ownerPrimaryName.trim()
            : '';
        const privilegedRoles: Record<string, 'owner' | 'admin'> = {};
        if (ownerAddress) {
          privilegedRoles[ownerAddress] = 'owner';
        }
        for (const adminAddress of adminAddressSet) {
          const normalizedAdminAddress =
            typeof adminAddress === 'string' ? adminAddress.trim() : '';
          if (
            normalizedAdminAddress &&
            normalizedAdminAddress !== ownerAddress
          ) {
            privilegedRoles[normalizedAdminAddress] = 'admin';
          }
        }
        const membersWithNames = Array.isArray(data?.members)
          ? data.members
              .map((member: any) => ({
                address:
                  typeof member?.member === 'string'
                    ? member.member.trim()
                    : '',
                name:
                  typeof member?.primaryName === 'string'
                    ? member.primaryName.trim()
                    : '',
                joined: Number.isFinite(Number(member?.joined))
                  ? Number(member.joined)
                  : undefined,
                role:
                  member?.member === ownerAddress
                    ? ('owner' as const)
                    : member?.isAdmin || adminAddressSet.has(member?.member)
                      ? ('admin' as const)
                      : undefined,
              }))
              .filter((member) => member.address)
          : [];
        setReticulumGroupOwnerName(ownerName);
        setReticulumPrivilegedMemberRolesByAddress(privilegedRoles);
        setGroupMentionMembers(membersWithNames);
        setReticulumMemberDataGroupId(groupId);
        setReticulumMemberRolesReady(true);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to load group members for mentions:', error);
          setGroupMentionMembers([]);
          setReticulumGroupOwnerName('');
          setReticulumMemberDataGroupId(null);
          setReticulumPrivilegedMemberRolesByAddress({});
          setReticulumMemberRolesReady(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedGroup]);

  useEffect(() => {
    const groupId = Number(selectedGroup);
    if (!reticulumChatEnabled || !Number.isInteger(groupId) || groupId <= 0) {
      return;
    }
    let cancelled = false;
    let refreshInFlight = false;
    const refreshMembers = async () => {
      if (
        cancelled ||
        refreshInFlight ||
        document.visibilityState === 'hidden'
      ) {
        return;
      }
      refreshInFlight = true;
      try {
        const data = await getGroupMembers(groupId);
        if (cancelled || !Array.isArray(data?.members)) return;
        setGroupMentionMembers((current) => {
          const currentByAddress = new Map(
            current.map((member) => [member.address, member])
          );
          const next = data.members
            .map((member: any) => {
              const address =
                typeof member?.member === 'string' ? member.member.trim() : '';
              const previous = currentByAddress.get(address);
              return {
                address,
                name:
                  typeof member?.primaryName === 'string'
                    ? member.primaryName.trim()
                    : previous?.name || '',
                joined: Number.isFinite(Number(member?.joined))
                  ? Number(member.joined)
                  : previous?.joined,
                role: previous?.role,
              };
            })
            .filter((member) => member.address);
          const unchanged =
            next.length === current.length &&
            next.every((member, index) => {
              const previous = current[index];
              return (
                previous?.address === member.address &&
                previous?.name === member.name &&
                previous?.joined === member.joined &&
                previous?.role === member.role
              );
            });
          return unchanged ? current : next;
        });
      } catch (error) {
        console.error('Failed to refresh Reticulum group members:', error);
      } finally {
        refreshInFlight = false;
      }
    };
    const interval = window.setInterval(
      () => void refreshMembers(),
      RETICULUM_MEMBER_REFRESH_MS
    );
    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') void refreshMembers();
    };
    document.addEventListener('visibilitychange', refreshOnVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshOnVisible);
    };
  }, [reticulumChatEnabled, selectedGroup]);

  const reticulumMemberRolesReadyForSelectedGroup =
    reticulumMemberRolesReady &&
    reticulumMemberDataGroupId === Number(selectedGroup);

  const reticulumMemberRolesByAddress = useMemo(() => {
    const roles: Record<string, 'owner' | 'admin'> = {
      ...reticulumPrivilegedMemberRolesByAddress,
    };
    for (const member of groupMentionMembers) {
      if (member.address && member.role) {
        roles[member.address] = member.role;
      }
    }
    return roles;
  }, [groupMentionMembers, reticulumPrivilegedMemberRolesByAddress]);

  const mentionNameToAddress = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of groupMentionMembers) {
      if (member.address) {
        const displayName =
          member.name || shortenReticulumAddress(member.address);
        map.set(displayName.toLowerCase(), member.address);
      }
    }
    if (myName && myAddress) map.set(myName.toLowerCase(), myAddress);
    for (const message of messages) {
      if (message?.senderName && message?.sender) {
        map.set(String(message.senderName).toLowerCase(), message.sender);
      }
    }
    return map;
  }, [groupMentionMembers, messages, myAddress, myName]);

  const resolveMentionedAddresses = useCallback(
    (html: string): string[] => {
      if (!html || typeof DOMParser === 'undefined') return [];
      const document = new DOMParser().parseFromString(html, 'text/html');
      const mentioned = new Set<string>();
      for (const node of document.querySelectorAll(
        '[data-type="mention"][data-id]'
      )) {
        const id = node.getAttribute('data-id')?.trim() || '';
        if (
          !id ||
          id === 'here' ||
          id === 'everyone' ||
          id.startsWith('reticulum-group:') ||
          id.startsWith('reticulum-channel:')
        )
          continue;
        if (/^Q[1-9A-HJ-NP-Za-km-z]{20,}$/.test(id)) {
          mentioned.add(id);
          continue;
        }
        const label =
          node.getAttribute('data-label')?.trim().replace(/^@/, '') || id;
        const address = mentionNameToAddress.get(label.toLowerCase());
        if (address) mentioned.add(address);
      }
      return [...mentioned];
    },
    [mentionNameToAddress]
  );

  const members = useMemo(() => {
    const uniqueMembers = new Set();
    uniqueMembers.add('here');
    uniqueMembers.add('everyone');
    if (selectedGroupName) uniqueMembers.add(selectedGroupName);
    reticulumChannelsForSelectedGroup.forEach((channel) => {
      if (channel?.name) uniqueMembers.add(channel.name);
    });
    groupMentionMembers.forEach((member) => {
      if (member.address) {
        uniqueMembers.add(
          member.name || shortenReticulumAddress(member.address)
        );
      }
    });
    messages.forEach((message) => {
      if (message?.senderName) {
        uniqueMembers.add(message?.senderName);
      }
    });

    return Array.from(uniqueMembers);
  }, [
    groupMentionMembers,
    messages,
    reticulumChannelsForSelectedGroup,
    selectedGroupName,
  ]);

  const reticulumMentionSuggestions = useMemo<MentionSuggestionItem[]>(() => {
    if (!reticulumChatEnabled) return [];

    const peopleByAddress = new Map<
      string,
      { address: string; name: string; role: 'Member' | 'Admin' }
    >();
    for (const member of groupMentionMembers) {
      if (!member.address) continue;
      peopleByAddress.set(member.address, {
        address: member.address,
        name: member.name || shortenReticulumAddress(member.address),
        role:
          member.role === 'admin' || member.role === 'owner'
            ? 'Admin'
            : 'Member',
      });
    }
    if (myAddress && !peopleByAddress.has(myAddress)) {
      peopleByAddress.set(myAddress, {
        address: myAddress,
        name: myName || shortenReticulumAddress(myAddress),
        role: isReticulumChannelAdmin ? 'Admin' : 'Member',
      });
    }

    const people: MentionSuggestionItem[] = [...peopleByAddress.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((member) => ({
        id: member.address,
        label: member.name,
        section: 'people',
        kind: 'person',
        description: member.role,
      }));

    const special: MentionSuggestionItem[] = isReticulumChannelAdmin
      ? [
          {
            id: 'here',
            label: 'here',
            section: 'special',
            kind: 'here',
            description: 'Notify members currently online',
          },
          {
            id: 'everyone',
            label: 'everyone',
            section: 'special',
            kind: 'everyone',
            description: 'Notify all members in this space',
          },
        ]
      : [];

    const groupLink: MentionSuggestionItem[] = selectedGroupName
      ? [
          {
            id: reticulumGroupLinkMentionId(Number(selectedGroup)),
            label: selectedGroupName,
            section: 'channels',
            kind: 'group',
            description: 'Open group chat',
            iconText: '@',
          },
        ]
      : [];

    const channels: MentionSuggestionItem[] = reticulumChannelsForSelectedGroup
      .sort(
        (left, right) =>
          left.position - right.position || left.name.localeCompare(right.name)
      )
      .map((channel) => ({
        id: reticulumChannelLinkMentionId(
          Number(selectedGroup),
          channel.channelId
        ),
        label: channel.name,
        section: 'channels',
        kind: 'channel',
        description: 'Channel',
        iconText:
          channel.name.match(
            /\p{Extended_Pictographic}(?:\uFE0E|\uFE0F)?/u
          )?.[0] || '@',
      }));

    return [...people, ...special, ...groupLink, ...channels];
  }, [
    groupMentionMembers,
    isReticulumChannelAdmin,
    myAddress,
    myName,
    reticulumChannelsForSelectedGroup,
    reticulumChatEnabled,
    selectedGroup,
    selectedGroupName,
  ]);

  const reticulumTypingText = useMemo(() => {
    if (isDisabledTyping || !reticulumChatEnabled) return '';
    const nameByAddress = new Map<string, string>();
    for (const member of groupMentionMembers) {
      if (member.address && member.name)
        nameByAddress.set(member.address, member.name);
    }
    const addresses = Object.entries(reticulumTyping || {})
      .filter(
        ([address, active]) =>
          active === true && address && address !== myAddress
      )
      .map(([address]) => address)
      .slice(0, 4);
    if (addresses.length === 0) return '';
    const names = addresses.map((address) => {
      const name = nameByAddress.get(address)?.trim();
      return name || `${address.slice(0, 8)}...`;
    });
    if (names.length === 1) return `${names[0]} is typing...`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`;
    return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more are typing...`;
  }, [groupMentionMembers, myAddress, reticulumChatEnabled, reticulumTyping]);

  const resolveMentionTargets = useCallback(
    (html: string) => {
      const mentionNodeIds = mentionNodeIdsFromHtml(html);
      const groupId = Number(selectedGroup);
      const channelId =
        normalizeReticulumChannelName(selectedReticulumChannelId) ||
        DEFAULT_RETICULUM_CHANNEL_ID;
      if (
        mentionNodeIds.size === 0 ||
        !Number.isInteger(groupId) ||
        groupId <= 0
      )
        return [];

      const targets = [];
      const seen = new Set<string>();
      const addTarget = (target) => {
        const key = JSON.stringify(target);
        if (seen.has(key)) return;
        seen.add(key);
        targets.push(target);
      };

      if (mentionNodeIds.has('here')) {
        addTarget({
          type: 'here',
          groupId,
          channelId,
          createdAt: Date.now(),
        });
      }
      if (mentionNodeIds.has('everyone')) {
        addTarget({ type: 'everyone', groupId });
      }
      return targets;
    },
    [selectedGroup, selectedReticulumChannelId]
  );

  const setEditorRef = (editorInstance) => {
    editorRef.current = editorInstance;
  };

  const stopReticulumTyping = useCallback(() => {
    if (reticulumTypingStopTimerRef.current) {
      clearTimeout(reticulumTypingStopTimerRef.current);
      reticulumTypingStopTimerRef.current = null;
    }
    if (
      isDisabledTyping ||
      !reticulumChatEnabled ||
      !reticulumTypingActiveRef.current ||
      !myAddress
    ) {
      reticulumTypingActiveRef.current = false;
      return;
    }
    reticulumTypingActiveRef.current = false;
    void sendReticulumTypingSignal(myAddress, false);
  }, [myAddress, reticulumChatEnabled, sendReticulumTypingSignal]);

  const noteReticulumComposerActivity = useCallback(
    (hasText: boolean) => {
      if (isDisabledTyping || !reticulumChatEnabled || !myAddress) return;
      if (!hasText) {
        stopReticulumTyping();
        return;
      }
      reticulumTypingActiveRef.current = true;
      void sendReticulumTypingSignal(myAddress, true);
      if (reticulumTypingStopTimerRef.current) {
        clearTimeout(reticulumTypingStopTimerRef.current);
      }
      reticulumTypingStopTimerRef.current = setTimeout(() => {
        stopReticulumTyping();
      }, RETICULUM_TYPING_IDLE_STOP_MS);
    },
    [
      myAddress,
      reticulumChatEnabled,
      sendReticulumTypingSignal,
      stopReticulumTyping,
    ]
  );

  useEffect(() => () => stopReticulumTyping(), [stopReticulumTyping]);

  const tempMessages = useMemo(() => {
    if (!reticulumChatQueueId) return [];
    if (queueChats[reticulumChatQueueId]) {
      return queueChats[reticulumChatQueueId]?.filter(
        (item) => !item?.chatReference
      );
    }
    return [];
  }, [queueChats, reticulumChatQueueId]);

  const tempChatReferences = useMemo(() => {
    if (!reticulumChatQueueId) return [];
    if (queueChats[reticulumChatQueueId]) {
      return queueChats[reticulumChatQueueId]?.filter(
        (item) => !!item?.chatReference
      );
    }
    return [];
  }, [queueChats, reticulumChatQueueId]);

  const secretKeyRef = useRef(null);
  const reticulumReadWasActiveRef = useRef(false);
  const lastReticulumReadEntryTokenRef = useRef<number | null>(null);
  const lastReticulumReadChannelKeyRef = useRef<string | null>(null);
  const deferredReticulumUnreadReadKeysRef = useRef(new Set<string>());
  const lastReticulumMarkedReadRef = useRef<{
    key: string;
    timestamp: number;
  } | null>(null);

  useEffect(() => {
    if (secretKey) {
      secretKeyRef.current = secretKey;
    }
  }, [secretKey]);

  useEffect(() => {
    appliedReticulumEventIdsRef.current.clear();
    appliedReticulumChannelMetadataEventIdsRef.current.clear();
  }, [selectedGroup]);

  useEffect(() => {
    const groupId = Number(selectedGroup);
    const member = groupMentionMembers.find(
      (candidate) => candidate.address === myAddress
    );
    const joinedAt = Number(member?.joined);
    if (
      !reticulumChatEnabled ||
      !reticulumMemberRolesReadyForSelectedGroup ||
      !Number.isInteger(groupId) ||
      groupId <= 0 ||
      !myAddress ||
      !Number.isFinite(joinedAt) ||
      joinedAt <= 0
    ) {
      return;
    }
    void applyReticulumJoinUnreadBaseline({
      address: myAddress,
      groupId,
      joinedAt,
      knownChannelIds: reticulumChannels.map((channel) => channel.channelId),
    });
  }, [
    groupMentionMembers,
    myAddress,
    reticulumChannels,
    reticulumChatEnabled,
    reticulumMemberRolesReadyForSelectedGroup,
    selectedGroup,
  ]);

  useEffect(() => {
    if (!reticulumChatEnabled) return;
    setMessages([]);
    setChatReferences({});
    const pendingSearch = pendingReticulumSearchNavigationRef.current;
    const preservePendingSearchTarget = Boolean(
      pendingSearch &&
      pendingSearch.groupId === Number(selectedGroup) &&
      pendingSearch.channelId === selectedReticulumChannelId
    );
    if (!preservePendingSearchTarget) {
      setReticulumSearchScrollTarget(null);
    }
    lastReticulumNotificationScrollTargetRef.current = '';
    appliedReticulumEventIdsRef.current.clear();
  }, [reticulumChatEnabled, selectedGroup, selectedReticulumChannelId]);

  useEffect(() => {
    if (
      !reticulumChatEnabled ||
      !reticulumVisibilityChange ||
      reticulumVisibilityChange.groupId !== Number(selectedGroup)
    ) {
      return;
    }
    appliedReticulumEventIdsRef.current.clear();
    setChatReferences({});
    if (!reticulumVisibilityChange.active) return;
    setMessages((previous) =>
      previous.filter(
        (message) =>
          String(message?.sender || '').trim() !==
          reticulumVisibilityChange.targetAddress
      )
    );
  }, [reticulumChatEnabled, reticulumVisibilityChange, selectedGroup]);

  useEffect(() => {
    if (!reticulumChatEnabled || reticulumHiddenAuthorAddresses.size === 0)
      return;
    setMessages((previous) => {
      const filtered = filterReticulumVisibleMessages(previous);
      return filtered.length === previous.length ? previous : filtered;
    });
    setChatReferences({});
  }, [
    filterReticulumVisibleMessages,
    reticulumChatEnabled,
    reticulumHiddenAuthorAddresses,
  ]);

  useEffect(() => {
    // Draft text is intentionally shared, but a reply target belongs to one channel.
    if (!reticulumChatEnabled) return;
    setReplyMessage(null);
  }, [reticulumChatEnabled, selectedGroup, selectedReticulumChannelId]);

  useEffect(() => {
    if (!reticulumChatEnabled || !notificationReticulumChannelId) return;
    if (
      reticulumChannelsForSelectedGroup.some(
        (channel) => channel.channelId === notificationReticulumChannelId
      )
    ) {
      setSelectedReticulumChannelId(notificationReticulumChannelId);
    }
  }, [
    notificationReticulumChannelId,
    reticulumChannelsForSelectedGroup,
    reticulumChatEnabled,
  ]);

  useEffect(() => {
    if (
      !reticulumChatEnabled ||
      !notificationReticulumChannelId ||
      selectedReticulumChannelId !== notificationReticulumChannelId
    ) {
      return;
    }
    if (!notificationReticulumMessageId) {
      onReticulumNotificationHandled?.();
      return;
    }
    const targetKey = `${selectedGroup}:${notificationReticulumChannelId}:${notificationReticulumMessageId}`;
    if (lastReticulumNotificationScrollTargetRef.current === targetKey) return;
    lastReticulumNotificationScrollTargetRef.current = targetKey;
    setReticulumSearchScrollTarget((current) => ({
      messageId: notificationReticulumMessageId,
      nonce: (current?.nonce ?? 0) + 1,
    }));
    onReticulumNotificationHandled?.();
  }, [
    notificationReticulumChannelId,
    notificationReticulumMessageId,
    onReticulumNotificationHandled,
    reticulumChatEnabled,
    selectedGroup,
    selectedReticulumChannelId,
  ]);

  useEffect(() => {
    if (!reticulumChatEnabled) return;
    onReticulumChannelSelected?.(selectedReticulumChannelId);
  }, [
    onReticulumChannelSelected,
    reticulumChatEnabled,
    selectedReticulumChannelId,
  ]);

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

  const updateChatMessagesWithBlocksFunc = useCallback(
    (e) => {
      if (e.detail) {
        setMessages((prev) =>
          prev?.filter((item) => !isChatSenderBlocked(item))
        );
      }
    },
    [isChatSenderBlocked]
  );

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
  }, [updateChatMessagesWithBlocksFunc]);

  const middletierFunc = async (data: any, groupId: string) => {
    try {
      if (hasInitialized.current) {
        const dataRemovedBlock = data?.filter(
          (item) => !isChatSenderBlocked(item)
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
        return !isChatSenderBlocked(item);
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
            secretKeyObject: secretKeyRef.current,
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

              if (reticulumChatEnabledRef.current) return;

              if (isInitiated) {
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
                    return {
                      ...item,
                      id: item.signature,
                      text: item?.decryptedData?.message || '',
                      repliedTo:
                        item?.repliedTo || item?.decryptedData?.repliedTo,
                      unread:
                        item?.sender === myAddress
                          ? false
                          : item?.chatReference
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
    if (reticulumChatEnabled) return;
    const socketLink = `${getBaseApiReactSocket()}/websockets/chat/messages?txGroupId=${selectedGroup}&encoding=BASE64&limit=100`;
    socketRef.current = new WebSocket(socketLink);

    socketRef.current.onopen = () => {
      setTimeout(pingGroupSocket, 50);
    };
    socketRef.current.onmessage = (e) => {
      try {
        if (e.data === 'pong') {
          clearTimeout(timeoutIdRef.current);
          groupSocketTimeoutRef.current = setTimeout(pingGroupSocket, 20000); // Ping every 20 seconds
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
    if (reticulumChatEnabled) {
      forceCloseWebSocket();
      setIsLoading(false);
      return;
    }
    if (hasInitializedWebsocket.current) return;
    if (triedToFetchSecretKey && !secretKey) {
      forceCloseWebSocket();
      setMessages([]);
      setIsLoading(true);
      initWebsocketMessageGroup();
    }
  }, [triedToFetchSecretKey, secretKey, isPrivate, reticulumChatEnabled]);

  useEffect(() => {
    if (reticulumChatEnabled) {
      forceCloseWebSocket();
      setIsLoading(false);
      return;
    }
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
  }, [secretKey, isPrivate, reticulumChatEnabled]);

  useEffect(() => {
    const logoutEventFunc = () => {
      forceCloseWebSocket();
    };
    subscribeToEvent('logout-event', logoutEventFunc);
    return () => {
      unsubscribeFromEvent('logout-event', logoutEventFunc);
      forceCloseWebSocket();
    };
  }, []);

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

  const publishReticulumGroupChatEvent = useCallback(
    async ({
      encryptedPayload,
      eventType,
      channelId,
      targetEventId,
      replyToEventId,
      mentionAddressHashes = [],
      mentionTargets = [],
    }: {
      encryptedPayload: string;
      eventType:
        | 'message'
        | 'edit'
        | 'delete'
        | 'reaction_add'
        | 'reaction_remove'
        | 'attachment_manifest'
        | 'channel_create'
        | 'channel_update'
        | 'channel_archive'
        | 'channel_restore'
        | 'channel_reorder'
        | 'category_create'
        | 'category_update'
        | 'category_delete';
      channelId?: string;
      targetEventId?: string;
      replyToEventId?: string;
      mentionAddressHashes?: string[];
      mentionTargets?: Array<Record<string, unknown>>;
    }) => {
      const groupId = Number(selectedGroup);
      if (!reticulumChatEnabled || !Number.isInteger(groupId) || groupId <= 0) {
        return { success: false, error: 'Reticulum chat is disabled' };
      }
      const timestamp = Date.now();
      const eventId = crypto.randomUUID?.() || `${timestamp}-${uid.rnd()}`;
      const payloadHash = await sha256Hex(encryptedPayload);
      const eventChannelId =
        normalizeReticulumChannelName(
          channelId || selectedReticulumChannelId
        ) || DEFAULT_RETICULUM_CHANNEL_ID;
      const normalizedMentionTargets = Array.isArray(mentionTargets)
        ? mentionTargets.map((target) =>
            target?.type === 'here'
              ? { ...target, createdAt: timestamp }
              : target
          )
        : [];
      const authorSequence =
        await window.reticulumChat?.reserveAuthorSequence?.(groupId, myAddress);
      if (
        !authorSequence ||
        !/^[0-9a-f]{32}$/.test(authorSequence.authorStreamId) ||
        !Number.isInteger(authorSequence.authorSeq) ||
        authorSequence.authorSeq <= 0
      ) {
        throw new Error('Unable to reserve Reticulum chat event sequence');
      }
      let sequenceCommitted = false;
      try {
        const baseFields = {
          eventId,
          groupId,
          channelId: eventChannelId,
          authorStreamId: authorSequence.authorStreamId,
          authorSeq: authorSequence.authorSeq,
          timestamp,
          eventType,
          targetEventId: targetEventId ?? null,
          replyToEventId: replyToEventId ?? null,
          encryptedPayload,
          payloadHash,
          mentionAddressHashes,
          ...(normalizedMentionTargets.length > 0
            ? { mentionTargets: normalizedMentionTargets }
            : {}),
        };
        const signed = await window.sendMessage(
          'signReticulumChatEvent',
          baseFields
        );
        if (!signed || signed.error) {
          throw new Error(
            signed?.error || 'Unable to sign Reticulum chat event'
          );
        }
        if (signed.authorAddress !== myAddress) {
          throw new Error('Signed Reticulum chat author mismatch');
        }
        const event = {
          ...baseFields,
          authorAddress: signed.authorAddress,
          authorPublicKey: signed.authorPublicKey,
          signature: signed.signature,
        };
        const result = await publishReticulumChatEvent(event);
        if (!result?.success) {
          throw new Error(result?.error || 'Reticulum chat publish failed');
        }
        sequenceCommitted = true;
        return { ...result, event };
      } finally {
        if (!sequenceCommitted) {
          try {
            await window.reticulumChat?.releaseAuthorSequence?.(
              groupId,
              myAddress,
              authorSequence.authorStreamId,
              authorSequence.authorSeq
            );
          } catch (releaseError) {
            console.warn(
              'Unable to release Reticulum chat event sequence',
              releaseError
            );
          }
        }
      }
    },
    [
      myAddress,
      publishReticulumChatEvent,
      reticulumChatEnabled,
      selectedGroup,
      selectedReticulumChannelId,
    ]
  );

  useEffect(() => {
    const groupId = Number(selectedGroup);
    if (
      !reticulumChatEnabled ||
      !reticulumMemberRolesReadyForSelectedGroup ||
      !myAddress ||
      !Number.isInteger(groupId) ||
      groupId <= 0
    ) {
      return;
    }

    const member = groupMentionMembers.find(
      (candidate) => candidate.address === myAddress
    );
    const joinedAt = Number(member?.joined);
    if (!member || !Number.isFinite(joinedAt) || joinedAt <= 0) return;

    const welcomeKey = `${groupId}:${myAddress}:${joinedAt}`;
    const storageKey = `${RETICULUM_SELF_WELCOME_STORAGE_PREFIX}:${welcomeKey}`;
    try {
      if (window.localStorage.getItem(storageKey)) return;
    } catch {
      // History and in-memory guards still prevent normal duplicate sends.
    }

    if (Date.now() - joinedAt > RETICULUM_SELF_WELCOME_RECENT_JOIN_MS) {
      try {
        window.localStorage.setItem(storageKey, 'baseline');
      } catch {
        // Storage can be unavailable without affecting chat.
      }
      return;
    }
    if (reticulumWelcomePublishInFlightRef.current.has(welcomeKey)) return;

    void (async () => {
      reticulumWelcomePublishInFlightRef.current.add(welcomeKey);
      try {
        const alreadyPublished = messages.some((message) => {
          const system =
            message?.qchatSystem || message?.decryptedData?.qchatSystem;
          return (
            system?.type === 'group-welcome' &&
            system?.welcomeKey === welcomeKey
          );
        });
        let historyAlreadyPublished = false;
        if (!alreadyPublished) {
          const history = await window.reticulumChat?.getMessageHistory?.(
            groupId,
            DEFAULT_RETICULUM_CHANNEL_ID,
            500,
            { repairNetwork: false }
          );
          historyAlreadyPublished =
            Array.isArray(history) &&
            history.some((event: any) => {
              try {
                const payload = JSON.parse(
                  String(event?.encryptedPayload || '')
                );
                return (
                  payload?.qchatSystem?.type === 'group-welcome' &&
                  payload.qchatSystem.welcomeKey === welcomeKey
                );
              } catch {
                return false;
              }
            });
        }
        if (alreadyPublished || historyAlreadyPublished) {
          try {
            window.localStorage.setItem(storageKey, 'published');
          } catch {
            // History remains the authoritative duplicate guard.
          }
          return;
        }

        const displayName =
          member.name || myName || shortenReticulumAddress(myAddress);
        const safeDisplayName = escapeReticulumMessageHtml(displayName);
        const mentionHtml = `<span class="mention" data-type="mention" data-id="${safeDisplayName}" data-label="${safeDisplayName}">@${safeDisplayName}</span>`;
        const templateIndex = deterministicWelcomeTemplateIndex(welcomeKey);
        const messageText = `<p>${RETICULUM_GROUP_WELCOME_TEMPLATES[templateIndex](mentionHtml)}</p>`;
        const mentionAddressHashes = await buildMentionAddressHashes([
          myAddress,
        ]);
        const objectMessage = {
          messageText,
          mentionedAddresses: [myAddress],
          mentionTargets: mentionAddressHashes.map((addressHash) => ({
            type: 'user',
            addressHash,
          })),
          qchatSystem: {
            type: 'group-welcome',
            welcomeKey,
            groupId,
            groupName: selectedGroupName || 'Group',
            groupAvatarOwnerName: reticulumGroupOwnerName,
            joinedAddress: myAddress,
            joinedAt,
            joinedName: displayName,
          },
          version: 3,
        };
        const result = await publishReticulumGroupChatEvent({
          channelId: DEFAULT_RETICULUM_CHANNEL_ID,
          encryptedPayload: JSON.stringify(objectMessage),
          eventType: 'message',
          mentionAddressHashes,
          mentionTargets: objectMessage.mentionTargets,
        });
        if (!result?.success) {
          throw new Error(result?.error || 'Reticulum welcome publish failed');
        }
        try {
          window.localStorage.setItem(storageKey, 'published');
        } catch {
          // The persisted history guard is sufficient when storage is unavailable.
        }
      } catch (error) {
        console.error('Unable to publish automatic group welcome:', error);
      } finally {
        reticulumWelcomePublishInFlightRef.current.delete(welcomeKey);
      }
    })();
  }, [
    groupMentionMembers,
    messages,
    myAddress,
    myName,
    publishReticulumGroupChatEvent,
    reticulumChatEnabled,
    reticulumGroupOwnerName,
    reticulumMemberRolesReadyForSelectedGroup,
    selectedGroup,
    selectedGroupName,
  ]);

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
            TIME_MINUTES_2_IN_MILLISECONDS
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

  const applyReticulumChatItem = useCallback(
    (item) => {
      if (
        !item ||
        isChatSenderBlocked(item) ||
        isReticulumHiddenAuthor(item?.sender)
      )
        return;
      const targetReference = item.chatReference;
      const itemType =
        item?.eventType || item?.decryptedData?.type || item?.type;
      const isReactionItem =
        itemType === 'reaction' ||
        itemType === 'reaction_add' ||
        itemType === 'reaction_remove';

      if (targetReference && itemType === 'delete') {
        setMessages((prev) =>
          prev.some(
            (message) =>
              message?.signature === targetReference ||
              message?.tempSignature === targetReference
          )
            ? prev.filter(
                (message) =>
                  message?.signature !== targetReference &&
                  message?.tempSignature !== targetReference
              )
            : prev
        );
        setChatReferences((prev) => {
          if (prev?.[targetReference]?.deleted === true) return prev;
          return {
            ...prev,
            [targetReference]: {
              deleted: true,
            },
          };
        });
        return;
      }

      // Reference-only events never correspond to an optimistic message row.
      // Sending deletes through the shared queue processor creates an unrelated
      // provider state update (and a second delayed one) on every listener pass.
      const incomingSpecialId =
        item?.specialId || item?.decryptedData?.specialId;
      const hasPendingOptimisticMatch = Boolean(
        incomingSpecialId &&
        queueChatsRef.current?.[reticulumChatQueueId]?.some(
          (queuedItem) => queuedItem?.message?.specialId === incomingSpecialId
        )
      );
      // Historical Reticulum events are already persisted messages. Running
      // every replayed event through the shared optimistic queue schedules a
      // provider update (plus a delayed cleanup) even when there is nothing to
      // reconcile. A large replay can therefore exceed React's nested-update
      // limit while another Q-Chat surface, such as Qortal Land, is mounting.
      const processed = hasPendingOptimisticMatch
        ? processWithNewMessages([item], reticulumChatQueueId)
        : [item];
      const nextItem = processed?.[0] || item;
      if (
        isChatSenderBlocked(nextItem) ||
        isReticulumHiddenAuthor(nextItem?.sender)
      )
        return;

      if (
        targetReference &&
        (itemType === 'edit' || nextItem?.isEdited || isReactionItem)
      ) {
        setChatReferences((prev) => {
          const organized = { ...prev };
          if (itemType === 'edit' || nextItem?.isEdited) {
            const nextEdit = buildReticulumEditReference(nextItem);
            if (
              isSameReticulumEditReference(
                organized[targetReference]?.edit,
                nextEdit
              )
            ) {
              return prev;
            }
            organized[targetReference] = {
              ...(organized[targetReference] || {}),
              edit: nextEdit,
            };
            return organized;
          }

          const content = nextItem?.content || nextItem?.decryptedData?.content;
          const sender = nextItem.sender;
          const contentState =
            nextItem?.contentState !== undefined
              ? nextItem.contentState
              : nextItem?.decryptedData?.contentState;
          if (!content || !sender) return organized;
          organized[targetReference] = {
            ...(organized[targetReference] || {}),
            reactions: organized[targetReference]?.reactions || {},
          };
          organized[targetReference].reactions[content] =
            organized[targetReference].reactions[content] || [];
          organized[targetReference].reactions[content] = organized[
            targetReference
          ].reactions[content].filter((reaction) => reaction.sender !== sender);
          if (contentState !== false) {
            organized[targetReference].reactions[content].push(nextItem);
          }
          if (organized[targetReference].reactions[content].length === 0) {
            delete organized[targetReference].reactions[content];
          }
          return organized;
        });
        return;
      }

      setMessages((prev) => {
        const existingIndex = prev.findIndex(
          (message) => message.signature === nextItem.signature
        );
        if (existingIndex !== -1) {
          const existingMessage = prev[existingIndex];
          if (
            existingMessage?.privilegedMentionAuthorized !==
            nextItem?.privilegedMentionAuthorized
          ) {
            const next = [...prev];
            next[existingIndex] = {
              ...existingMessage,
              directMentionAuthorized:
                nextItem.directMentionAuthorized === true,
              privilegedMentionAuthorized:
                nextItem.privilegedMentionAuthorized === true,
            };
            return next;
          }
          if (
            nextItem.senderName &&
            existingMessage?.senderName !== nextItem.senderName
          ) {
            const next = [...prev];
            next[existingIndex] = {
              ...existingMessage,
              senderName: nextItem.senderName,
            };
            return next;
          }
          return prev;
        }
        return [...prev, nextItem];
      });
    },
    [
      isChatSenderBlocked,
      isReticulumHiddenAuthor,
      processWithNewMessages,
      reticulumChatQueueId,
    ]
  );

  const convertReticulumEventToChatItem = useCallback(
    async (
      event,
      options?: {
        channelId?: string;
      }
    ) => {
      if (!event || Number(event.groupId) !== Number(selectedGroup))
        return null;
      const activeChannelId =
        normalizeReticulumChannelName(options?.channelId || '') ||
        selectedReticulumChannelId;
      const eventChannelId =
        normalizeReticulumChannelName(
          event.channelId || DEFAULT_RETICULUM_CHANNEL_ID
        ) || DEFAULT_RETICULUM_CHANNEL_ID;
      const isChannelMetadataEvent =
        typeof event.eventType === 'string' &&
        (event.eventType.startsWith('channel_') ||
          event.eventType.startsWith('category_'));
      if (
        !isChannelMetadataEvent &&
        isReticulumHiddenAuthor(event.authorAddress)
      ) {
        return null;
      }
      const eventChannel = reticulumAllChannelsForSelectedGroup.find(
        (channel) => channel.channelId === eventChannelId
      );
      if (
        !isChannelMetadataEvent &&
        eventChannel?.readMode === RETICULUM_CHANNEL_READ_MODE_ADMINS &&
        !isReticulumChannelAdmin
      ) {
        return null;
      }
      if (!isChannelMetadataEvent && eventChannelId !== activeChannelId) {
        return null;
      }
      const eventExpiresAt = Number(event.expiresAt);
      const baseItem = {
        signature: event.eventId,
        id: event.eventId,
        groupId: event.groupId,
        channelId: eventChannelId,
        sender: event.authorAddress,
        senderName:
          event.authorPrimaryName ||
          (event.senderName && event.senderName !== event.authorAddress
            ? event.senderName
            : undefined) ||
          reticulumMemberNameByAddress.get(event.authorAddress) ||
          (event.authorAddress === myAddress ? myName : undefined),
        timestamp: event.timestamp,
        expiresAt:
          Number.isFinite(eventExpiresAt) && eventExpiresAt > 0
            ? Math.floor(eventExpiresAt)
            : null,
        data: event.encryptedPayload,
        chatReference: event.targetEventId || undefined,
        eventType: event.eventType,
        repliedTo: event.replyToEventId || undefined,
        replyTargetDeleted: event.replyTargetDeleted === true,
        directMentionAuthorized: event.directMentionAuthorized === true,
        privilegedMentionAuthorized: event.privilegedMentionAuthorized === true,
        reticulumChat: true,
        syntheticReticulumCalendarSystem: false,
      };
      let decryptedData = null;
      if (reticulumChatEnabled || isPrivate === false) {
        try {
          decryptedData = JSON.parse(event.encryptedPayload);
        } catch {
          decryptedData = { messageText: event.encryptedPayload };
        }
      } else {
        if (!secretKeyRef.current) return null;
        const decrypted = await window.sendMessage('decryptSingle', {
          data: [baseItem],
          secretKeyObject: secretKeyRef.current,
        });
        decryptedData = decrypted?.[0]?.decryptedData;
      }
      if (!decryptedData) return null;
      if (isChannelMetadataEvent) {
        const eventId = typeof event.eventId === 'string' ? event.eventId : '';
        if (
          eventId &&
          appliedReticulumChannelMetadataEventIdsRef.current.has(eventId)
        ) {
          return null;
        }
        const result = await window.reticulumChat?.applyChannelMetadata?.(
          event.eventId,
          decryptedData
        );
        if (result?.success) {
          if (eventId)
            appliedReticulumChannelMetadataEventIdsRef.current.add(eventId);
          await refreshReticulumChannels();
        }
        return null;
      }
      const normalizedText = normalizeReticulumChatHtmlContent(
        decryptedData.message || decryptedData.messageText
      );
      const normalizedDecryptedData = {
        ...decryptedData,
        ...(decryptedData.message !== undefined
          ? { message: normalizedText }
          : {}),
        ...(decryptedData.messageText !== undefined
          ? { messageText: normalizedText }
          : {}),
        ...(Array.isArray(decryptedData.images)
          ? {
              images: decryptedData.images.map((image) => {
                if (
                  !image ||
                  typeof image !== 'object' ||
                  image.reticulumResource !== true
                ) {
                  return image;
                }
                const fileHash =
                  typeof image.fileHash === 'string' ? image.fileHash : '';
                return {
                  ...image,
                  fileHash,
                };
              }),
            }
          : {}),
        ...(Array.isArray(decryptedData.attachments)
          ? {
              attachments: decryptedData.attachments.map((attachment) => {
                if (
                  !attachment ||
                  typeof attachment !== 'object' ||
                  attachment.reticulumResource !== true
                ) {
                  return attachment;
                }
                const fileHash =
                  typeof attachment.fileHash === 'string'
                    ? attachment.fileHash
                    : '';
                return {
                  ...attachment,
                  fileHash,
                };
              }),
            }
          : {}),
      };
      const payloadHasDataField = Object.prototype.hasOwnProperty.call(
        normalizedDecryptedData,
        'data'
      );
      return {
        ...mergeReticulumPayloadWithVerifiedEnvelope(normalizedDecryptedData, {
          ...baseItem,
          chatReference:
            event.targetEventId || normalizedDecryptedData.chatReference,
          repliedTo: event.replyToEventId || normalizedDecryptedData.repliedTo,
        }),
        // `data` is an application-content field in older chat payloads, not
        // event identity. Preserve the previous payload-first behavior for it
        // while keeping the raw event payload as the fallback.
        data: payloadHasDataField
          ? normalizedDecryptedData.data
          : baseItem.data,
        message: normalizedText,
        messageText: normalizedText,
        text: normalizedText,
        isNotEncrypted: reticulumChatEnabled || isPrivate === false,
        unread: event.authorAddress === myAddress ? false : true,
      };
    },
    [
      isPrivate,
      isReticulumChannelAdmin,
      myAddress,
      myName,
      refreshReticulumChannels,
      reticulumChatEnabled,
      reticulumAllChannelsForSelectedGroup,
      isReticulumHiddenAuthor,
      reticulumMemberNameByAddress,
      selectedGroup,
      selectedReticulumChannelId,
    ]
  );

  const loadReticulumDiscussion = useCallback(
    async (rootEventId: string, showLoading = true) => {
      if (!rootEventId || !reticulumChatEnabled) return;
      const sequence = ++reticulumDiscussionLoadSequenceRef.current;
      if (showLoading) setIsReticulumDiscussionLoading(true);
      try {
        const events = await getReticulumDiscussionMessages(rootEventId);
        const converted = await Promise.all(
          events.map((event) => convertReticulumEventToChatItem(event))
        );
        if (
          reticulumDiscussionLoadSequenceRef.current !== sequence ||
          reticulumDiscussionRootId !== rootEventId
        ) {
          return;
        }
        setReticulumDiscussionMessages(converted.filter(Boolean));
      } catch (error) {
        if (reticulumDiscussionLoadSequenceRef.current === sequence) {
          console.error('[ReticulumChat] Failed to load discussion', error);
          setReticulumDiscussionMessages([]);
        }
      } finally {
        if (reticulumDiscussionLoadSequenceRef.current === sequence) {
          setIsReticulumDiscussionLoading(false);
        }
      }
    },
    [
      convertReticulumEventToChatItem,
      getReticulumDiscussionMessages,
      reticulumChatEnabled,
      reticulumDiscussionRootId,
    ]
  );

  const openReticulumDiscussion = useCallback(
    (message: any) => {
      const eventId = String(message?.signature || '');
      if (!eventId) return;
      const rootEventId =
        reticulumDiscussionIndex.rootByEventId[eventId] || eventId;
      setReticulumDiscussionRootId(rootEventId);
      setReticulumDiscussionMessages([]);
      setIsReticulumDiscussionLoading(true);
    },
    [reticulumDiscussionIndex.rootByEventId]
  );

  const closeReticulumDiscussion = useCallback(() => {
    reticulumDiscussionLoadSequenceRef.current += 1;
    reticulumDiscussionFileSequenceRef.current += 1;
    setReticulumDiscussionRootId('');
    setReticulumDiscussionMessages([]);
    setIsReticulumDiscussionLoading(false);
    setIsPreparingReticulumDiscussionFile(false);
    setIsCompressingReticulumDiscussionGif(false);
    setReticulumLargeImageChoice((current) =>
      current?.target === 'discussion' ? null : current
    );
    stopReticulumTyping();
    setReticulumDiscussionFiles((current) => {
      current.forEach((file) => {
        if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
        if (file.temporaryFilePath) {
          void window.reticulumResources?.releaseConvertedMedia?.(
            file.temporaryFilePath
          );
        }
      });
      return [];
    });
  }, [stopReticulumTyping]);

  useEffect(() => {
    closeReticulumDiscussion();
  }, [closeReticulumDiscussion, selectedGroup, selectedReticulumChannelId]);

  const activeReticulumDiscussionReplyCount = reticulumDiscussionRootId
    ? reticulumDiscussionIndex.replyCounts[reticulumDiscussionRootId] || 0
    : 0;

  useEffect(() => {
    if (!reticulumDiscussionRootId) return;
    void loadReticulumDiscussion(reticulumDiscussionRootId);
  }, [
    activeReticulumDiscussionReplyCount,
    loadReticulumDiscussion,
    reticulumDiscussionRootId,
  ]);

  const sendReticulumDiscussionReply = useCallback(
    async (draft: ReticulumDiscussionDraft) => {
      if (!reticulumDiscussionRootId || !canWriteSelectedReticulumChannel) {
        return false;
      }
      let ownsSendingState = false;
      try {
        if (isSending) return false;
        if (
          new TextEncoder().encode(JSON.stringify(draft.messageText))
            .byteLength > MAX_SIZE_MESSAGE
        ) {
          throw new Error(
            `Message is too long (maximum ${MAX_SIZE_MESSAGE} bytes)`
          );
        }
        setIsSending(true);
        ownsSendingState = true;
        stopReticulumTyping();
        const images = await Promise.all(
          reticulumDiscussionFiles
            .filter((file) => file.isImage)
            .map(async (file, index) => {
              const metadata = {
                feature: 'reticulum-chat',
                groupId: selectedGroup,
                attachmentKind: 'image',
                originalMimeType: file.mimeType,
                ...(file.width && file.height
                  ? { height: file.height, width: file.width }
                  : {}),
              };
              const imported = file.filePath
                ? await window.reticulumResources?.importFilePath?.({
                    encrypted: false,
                    fileName:
                      file.fileName ||
                      `discussion-image-${Date.now()}-${index}`,
                    filePath: file.filePath,
                    metadata,
                    mimeType: file.mimeType || 'image/webp',
                    namespace: 'reticulum-group-resource',
                    ownerId: `${selectedGroup}:${myAddress}`,
                  })
                : await window.reticulumResources?.importBase64?.({
                    base64: file.base64 || '',
                    encrypted: false,
                    fileName:
                      file.fileName ||
                      `discussion-image-${Date.now()}-${index}`,
                    metadata,
                    mimeType: file.mimeType || 'image/webp',
                    namespace: 'reticulum-group-resource',
                    ownerId: `${selectedGroup}:${myAddress}`,
                  });
              if (!imported?.success || !imported.manifest) {
                throw new Error(
                  imported?.error || 'Reticulum image resource import failed'
                );
              }
              return {
                ...(imported.manifest as Record<string, unknown>),
                ...(file.width && file.height
                  ? { height: file.height, width: file.width }
                  : {}),
                reticulumResource: true,
                timestamp: Date.now(),
              };
            })
        );
        const attachments = await Promise.all(
          reticulumDiscussionFiles
            .filter((file) => !file.isImage)
            .map(async (file) => {
              if (!file.filePath) {
                throw new Error('File attachments require a local file path');
              }
              const imported =
                await window.reticulumResources?.importFilePath?.({
                  encrypted: false,
                  fileName: file.fileName,
                  filePath: file.filePath,
                  metadata: {
                    attachmentKind: 'file',
                    feature: 'reticulum-chat',
                    groupId: selectedGroup,
                  },
                  mimeType: file.mimeType || 'application/octet-stream',
                  namespace: 'reticulum-group-resource',
                  ownerId: `${selectedGroup}:${myAddress}`,
                });
              if (!imported?.success || !imported.manifest) {
                throw new Error(
                  imported?.error || 'Reticulum file resource import failed'
                );
              }
              return {
                ...(imported.manifest as Record<string, unknown>),
                reticulumResource: true,
                timestamp: Date.now(),
              };
            })
        );
        const mentionedAddresses = resolveMentionedAddresses(
          draft.htmlContent || ''
        );
        const mentionTargets = resolveMentionTargets(draft.htmlContent || '');
        const mentionedAddressHashes =
          await buildMentionAddressHashes(mentionedAddresses);
        const messageExpiryPayload = buildReticulumMessageExpiryPayload(
          draft.expiryDurationMs,
          selectedReticulumChannelExpiryDurationMs
        );
        const encryptedPayload = JSON.stringify({
          ...(attachments.length > 0 ? { attachments } : {}),
          repliedTo: reticulumDiscussionRootId,
          type: '',
          specialId: uid.rnd(),
          images,
          mentionedAddresses,
          mentionTargets,
          isEdited: false,
          messageText: draft.messageText,
          ...messageExpiryPayload,
          version: 3,
        });
        const result = await publishReticulumGroupChatEvent({
          encryptedPayload,
          eventType: 'message',
          mentionAddressHashes: mentionedAddressHashes,
          mentionTargets,
          replyToEventId: reticulumDiscussionRootId,
        });
        if (!result?.success) {
          throw new Error(result?.error || 'Unable to send discussion reply');
        }
        setReticulumDiscussionFiles((current) => {
          current.forEach((file) => {
            if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
            if (file.temporaryFilePath) {
              void window.reticulumResources?.releaseConvertedMedia?.(
                file.temporaryFilePath
              );
            }
          });
          return [];
        });
        await loadReticulumDiscussion(reticulumDiscussionRootId, false);
        return true;
      } catch (error) {
        setInfoSnack({
          type: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Unable to send discussion reply',
        });
        setOpenSnack(true);
        return false;
      } finally {
        if (ownsSendingState) setIsSending(false);
      }
    },
    [
      canWriteSelectedReticulumChannel,
      isSending,
      loadReticulumDiscussion,
      myAddress,
      publishReticulumGroupChatEvent,
      resolveMentionedAddresses,
      resolveMentionTargets,
      reticulumDiscussionFiles,
      reticulumDiscussionRootId,
      selectedGroup,
      selectedReticulumChannelExpiryDurationMs,
      setInfoSnack,
      setOpenSnack,
      stopReticulumTyping,
      t,
    ]
  );

  useEffect(() => {
    reticulumSearchPageCursorsRef.current = [null];
    setReticulumSearchPage(0);
  }, [
    reticulumSearchAfterDate,
    reticulumSearchAuthorFilter,
    reticulumSearchBeforeDate,
    reticulumSearchChannelFilter,
    reticulumSearchHasFilter,
    reticulumSearchQuery,
    reticulumSearchSort,
    selectedGroup,
  ]);

  useEffect(() => {
    if (!reticulumChatEnabled || !reticulumSearchOpen || !selectedGroup) {
      setReticulumSearchResults([]);
      setReticulumSearchError('');
      setReticulumSearchHasNextPage(false);
      setIsReticulumSearchLoading(false);
      return;
    }
    const query = reticulumSearchQuery.trim();
    const hasExplicitFilters =
      reticulumSearchChannelFilter !== RETICULUM_SEARCH_CHANNEL_CURRENT ||
      Boolean(reticulumSearchAuthorFilter) ||
      reticulumSearchHasFilter !== RETICULUM_SEARCH_HAS_ANY ||
      Boolean(reticulumSearchAfterDate) ||
      Boolean(reticulumSearchBeforeDate) ||
      reticulumSearchSort !== 'relevance';
    if (query.length < 2 && !hasExplicitFilters) {
      setReticulumSearchResults([]);
      setReticulumSearchError('');
      setReticulumSearchHasNextPage(false);
      setIsReticulumSearchLoading(false);
      return;
    }
    const requestSeq = reticulumSearchRequestSeqRef.current + 1;
    reticulumSearchRequestSeqRef.current = requestSeq;
    setIsReticulumSearchLoading(true);
    setReticulumSearchError('');
    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const channelIds =
            reticulumSearchChannelFilter === RETICULUM_SEARCH_CHANNEL_CURRENT
              ? [selectedReticulumChannelId]
              : reticulumSearchChannelFilter === RETICULUM_SEARCH_CHANNEL_ALL
                ? undefined
                : [reticulumSearchChannelFilter];
          const afterTimestamp = localDateStringToTimestamp(
            reticulumSearchAfterDate
          );
          const beforeTimestamp = localDateStringToTimestamp(
            reticulumSearchBeforeDate
          );
          const canUseCursorPaging =
            reticulumSearchSort === 'newest' ||
            reticulumSearchSort === 'oldest' ||
            query.length < 2;
          const cursor =
            canUseCursorPaging && reticulumSearchPage > 0
              ? reticulumSearchPageCursorsRef.current[reticulumSearchPage]
              : null;
          const results = (await window.reticulumChat?.search?.(query, {
            groupIds: [Number(selectedGroup)],
            channelIds,
            authorAddresses: reticulumSearchAuthorFilter
              ? [reticulumSearchAuthorFilter]
              : undefined,
            beforeTimestamp,
            afterTimestamp,
            hasAttachment:
              reticulumSearchHasFilter === RETICULUM_SEARCH_HAS_ATTACHMENT,
            hasLink: reticulumSearchHasFilter === RETICULUM_SEARCH_HAS_LINK,
            sort: reticulumSearchSort,
            limit: RETICULUM_SEARCH_PAGE_SIZE + 1,
            offset: cursor
              ? undefined
              : reticulumSearchPage * RETICULUM_SEARCH_PAGE_SIZE,
            cursor: cursor ?? undefined,
          })) as ReticulumSearchResult[] | undefined;
          if (reticulumSearchRequestSeqRef.current !== requestSeq) return;
          const visibleResults = (results ?? []).filter((result) => {
            if (isReticulumHiddenAuthor(result?.event?.authorAddress)) {
              return false;
            }
            const channelId =
              normalizeReticulumChannelName(result?.event?.channelId || '') ||
              DEFAULT_RETICULUM_CHANNEL_ID;
            return reticulumVisibleChannelIds.has(channelId);
          });
          setReticulumSearchHasNextPage(
            visibleResults.length > RETICULUM_SEARCH_PAGE_SIZE
          );
          setReticulumSearchResults(
            visibleResults.slice(0, RETICULUM_SEARCH_PAGE_SIZE)
          );
          const pageResults = visibleResults.slice(
            0,
            RETICULUM_SEARCH_PAGE_SIZE
          );
          const nextCursor = pageResults[pageResults.length - 1]?.cursor;
          if (canUseCursorPaging) {
            const nextPageCursors = reticulumSearchPageCursorsRef.current.slice(
              0,
              reticulumSearchPage + 1
            );
            if (
              visibleResults.length > RETICULUM_SEARCH_PAGE_SIZE &&
              nextCursor
            ) {
              nextPageCursors[reticulumSearchPage + 1] = nextCursor;
            }
            reticulumSearchPageCursorsRef.current = nextPageCursors;
          }
        } catch (error) {
          if (reticulumSearchRequestSeqRef.current !== requestSeq) return;
          console.error('[ReticulumChat] search failed', error);
          setReticulumSearchResults([]);
          setReticulumSearchHasNextPage(false);
          setReticulumSearchError('Search failed');
        } finally {
          if (reticulumSearchRequestSeqRef.current === requestSeq) {
            setIsReticulumSearchLoading(false);
          }
        }
      })();
    }, 220);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    myAddress,
    isReticulumHiddenAuthor,
    reticulumChatEnabled,
    reticulumSearchAfterDate,
    reticulumSearchAuthorFilter,
    reticulumSearchBeforeDate,
    reticulumSearchChannelFilter,
    reticulumSearchHasFilter,
    reticulumSearchOpen,
    reticulumSearchPage,
    reticulumSearchQuery,
    reticulumSearchSort,
    reticulumVisibleChannelIds,
    selectedGroup,
    selectedReticulumChannelId,
  ]);

  const reticulumSearchAuthorName = useCallback(
    (event: ReticulumSearchResult['event']) => {
      const address = event?.authorAddress || '';
      return (
        event?.authorPrimaryName ||
        (event?.senderName && event.senderName !== address
          ? event.senderName
          : undefined) ||
        reticulumMemberNameByAddress.get(address) ||
        address
      );
    },
    [reticulumMemberNameByAddress]
  );

  const handleReticulumSearchResultClick = useCallback(
    (result: ReticulumSearchResult) => {
      const event = result?.event;
      if (!event?.eventId || !selectedGroup) return;
      const groupId = Number(selectedGroup);
      if (!Number.isInteger(groupId) || groupId <= 0) return;
      const channelId =
        normalizeReticulumChannelName(event.channelId || '') ||
        DEFAULT_RETICULUM_CHANNEL_ID;
      if (!reticulumVisibleChannelIds.has(channelId)) return;
      const requestId = ++reticulumSearchNavigationRequestRef.current;
      setPendingReticulumSearchNavigation({
        groupId,
        channelId,
        eventId: event.eventId,
        requestId,
      });
      setReticulumSearchScrollTarget((current) => ({
        messageId: event.eventId,
        nonce: (current?.nonce ?? 0) + 1,
        requestId,
      }));
      setSelectedReticulumChannelId(channelId);
      setIsLoading(true);
    },
    [reticulumVisibleChannelIds, selectedGroup]
  );

  useEffect(() => {
    const request = pendingReticulumSearchNavigation;
    if (!request) return;
    if (request.groupId !== Number(selectedGroup)) {
      if (request.requestId === reticulumSearchNavigationRequestRef.current) {
        if (
          reticulumSearchNavigationInFlightRef.current === request.requestId
        ) {
          reticulumSearchNavigationInFlightRef.current = 0;
        }
        if (reticulumSearchWindowOpenedRef.current === request.requestId) {
          reticulumSearchWindowOpenedRef.current = 0;
        }
        setReticulumSearchScrollTarget((current) =>
          current?.requestId === request.requestId ? null : current
        );
        setPendingReticulumSearchNavigation(null);
        setIsLoading(false);
      }
      return;
    }
    if (request.channelId !== selectedReticulumChannelId) {
      // A cross-channel result first updates the requested channel and reaches
      // this branch transiently, before its history request starts. Once a
      // request is in flight (or its window has opened), a later mismatch means
      // the reader navigated elsewhere. Release the global loading state rather
      // than leaving the abandoned search navigation pending indefinitely.
      const navigationStarted =
        reticulumSearchNavigationInFlightRef.current === request.requestId ||
        reticulumSearchWindowOpenedRef.current === request.requestId;
      if (
        navigationStarted &&
        request.requestId === reticulumSearchNavigationRequestRef.current
      ) {
        reticulumSearchNavigationInFlightRef.current = 0;
        reticulumSearchWindowOpenedRef.current = 0;
        setReticulumSearchScrollTarget((current) =>
          current?.requestId === request.requestId ? null : current
        );
        setPendingReticulumSearchNavigation(null);
        setIsLoading(false);
      }
      return;
    }
    if (!reticulumInitialHistoryReady) return;
    if (reticulumSearchNavigationInFlightRef.current === request.requestId) {
      return;
    }

    let cancelled = false;
    reticulumSearchNavigationInFlightRef.current = request.requestId;
    void (async () => {
      let openedWindow = false;
      try {
        const result = await openReticulumHistoryAroundEvent(request.eventId, {
          beforeLimit: 80,
          afterLimit: 40,
        });
        if (!result.success) {
          throw new Error('search_result_window_missing_target');
        }
        if (
          cancelled ||
          request.requestId !== reticulumSearchNavigationRequestRef.current
        ) {
          return;
        }
        openedWindow = true;
        reticulumSearchWindowOpenedRef.current = request.requestId;
      } catch (error) {
        if (
          cancelled ||
          request.requestId !== reticulumSearchNavigationRequestRef.current
        ) {
          return;
        }
        console.error('[ReticulumChat] search result window failed', error);
        setReticulumSearchScrollTarget((current) =>
          current?.requestId === request.requestId ? null : current
        );
        setInfoSnack({
          type: 'error',
          message: 'Unable to load search result',
        });
        setOpenSnack(true);
      } finally {
        if (!openedWindow) {
          if (
            reticulumSearchNavigationInFlightRef.current === request.requestId
          ) {
            reticulumSearchNavigationInFlightRef.current = 0;
          }
          if (reticulumSearchWindowOpenedRef.current === request.requestId) {
            reticulumSearchWindowOpenedRef.current = 0;
          }
          if (
            !cancelled &&
            request.requestId === reticulumSearchNavigationRequestRef.current
          ) {
            setPendingReticulumSearchNavigation((current) =>
              current?.requestId === request.requestId ? null : current
            );
            setIsLoading(false);
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    openReticulumHistoryAroundEvent,
    pendingReticulumSearchNavigation,
    reticulumInitialHistoryReady,
    selectedGroup,
    selectedReticulumChannelId,
  ]);

  useEffect(() => {
    const request = pendingReticulumSearchNavigation;
    if (!request || request.groupId !== Number(selectedGroup)) return;
    if (request.channelId !== selectedReticulumChannelId) return;
    if (reticulumSearchWindowOpenedRef.current !== request.requestId) return;
    const eventContext = `${request.groupId}:${request.channelId}:${
      reticulumVisibilityChange?.revision || 0
    }:${reticulumHistoryWindowRevision}`;
    if (reticulumProcessedHistoryKey !== eventContext) return;

    const targetWasConverted = messages.some(
      (message) =>
        message?.signature === request.eventId ||
        message?.tempSignature === request.eventId ||
        message?.identifier === request.eventId ||
        message?.message?.signature === request.eventId
    );
    if (!targetWasConverted) {
      setReticulumSearchScrollTarget((current) =>
        current?.requestId === request.requestId ? null : current
      );
      setInfoSnack({
        type: 'error',
        message: 'Unable to load search result',
      });
      setOpenSnack(true);
    }
    if (reticulumSearchNavigationInFlightRef.current === request.requestId) {
      reticulumSearchNavigationInFlightRef.current = 0;
    }
    reticulumSearchWindowOpenedRef.current = 0;
    setPendingReticulumSearchNavigation((current) =>
      current?.requestId === request.requestId ? null : current
    );
    setIsLoading(false);
  }, [
    messages,
    pendingReticulumSearchNavigation,
    reticulumHistoryWindowRevision,
    reticulumProcessedHistoryKey,
    reticulumVisibilityChange?.revision,
    selectedGroup,
    selectedReticulumChannelId,
  ]);

  useEffect(() => {
    if (!reticulumChatEnabled) return;
    const eventContext = `${selectedGroup || ''}:${
      selectedReticulumChannelId || DEFAULT_RETICULUM_CHANNEL_ID
    }:${reticulumVisibilityChange?.revision || 0}:${reticulumHistoryWindowRevision}`;
    if (!reticulumInitialHistoryReady) return;
    const convertEventBatch = (events: any[]) =>
      Promise.all(
        events.map(async (event) => {
          const eventId =
            typeof event?.eventId === 'string' ? event.eventId : '';
          try {
            return {
              eventId,
              item: await convertReticulumEventToChatItem(event),
              succeeded: true,
            };
          } catch (error) {
            console.error(
              `[ReticulumChat] Failed to convert event ${eventId || 'unknown'}`,
              error
            );
            return { eventId, item: null, succeeded: false };
          }
        })
      );

    if (reticulumProcessedHistoryKey !== eventContext) {
      const sequence = ++reticulumInitialHistoryBatchSequenceRef.current;
      let cancelled = false;
      void (async () => {
        const conversionResults = await convertEventBatch(reticulumChatEvents);
        if (
          cancelled ||
          sequence !== reticulumInitialHistoryBatchSequenceRef.current ||
          reticulumEventContextRef.current !== eventContext
        ) {
          return;
        }

        const nextHistory = buildReticulumInitialHistoryState(
          conversionResults.map((result) => result.item),
          {
            shouldExclude: (item) =>
              isChatSenderBlocked(item) ||
              isReticulumHiddenAuthor(item?.sender),
            reconcileItem: (item) => {
              const specialId = reticulumHistoryItemSpecialId(item);
              const hasPendingOptimisticMatch = Boolean(
                specialId &&
                queueChatsRef.current?.[reticulumChatQueueId]?.some(
                  (queuedItem) => queuedItem?.message?.specialId === specialId
                )
              );
              if (!hasPendingOptimisticMatch) return item;
              return (
                processWithNewMessages([item], reticulumChatQueueId)?.[0] ||
                item
              );
            },
          }
        );
        if (
          cancelled ||
          sequence !== reticulumInitialHistoryBatchSequenceRef.current ||
          reticulumEventContextRef.current !== eventContext
        ) {
          return;
        }

        const appliedEventIds = new Set(nextHistory.appliedEventIds);
        for (const result of conversionResults) {
          if (result.succeeded && result.eventId) {
            appliedEventIds.add(result.eventId);
          }
        }
        appliedReticulumEventIdsRef.current = appliedEventIds;
        setMessages(nextHistory.messages);
        setChatReferences(nextHistory.chatReferences);
        setReticulumProcessedHistoryKey(eventContext);
      })();
      return () => {
        cancelled = true;
      };
    }

    if (reticulumChatEvents.length === 0) {
      return;
    }
    const existingMessagesById = new Map(
      messages
        .filter((message) => typeof message?.signature === 'string')
        .map((message) => [message.signature, message])
    );
    const eventsToApply = reticulumChatEvents.filter((event) => {
      const eventId = typeof event?.eventId === 'string' ? event.eventId : '';
      const alreadyApplied = Boolean(
        eventId && appliedReticulumEventIdsRef.current.has(eventId)
      );
      if (!alreadyApplied) return true;

      const eventSenderName =
        event?.authorPrimaryName ||
        (event?.senderName && event.senderName !== event.authorAddress
          ? event.senderName
          : undefined) ||
        reticulumMemberNameByAddress.get(event?.authorAddress);
      const existingMessage = existingMessagesById.get(eventId);
      const targetEventId =
        event?.eventType === 'edit' && event?.targetEventId
          ? String(event.targetEventId)
          : '';
      const existingEdit = targetEventId
        ? chatReferences?.[targetEventId]?.edit
        : undefined;
      return Boolean(
        reticulumHistoryEnvelopeNeedsRefresh(
          existingMessage,
          eventSenderName,
          event?.privilegedMentionAuthorized === true
        ) ||
        reticulumHistoryEnvelopeNeedsRefresh(
          existingEdit,
          eventSenderName,
          event?.privilegedMentionAuthorized === true
        )
      );
    });
    if (eventsToApply.length === 0) return;

    const sequence = ++reticulumInitialHistoryBatchSequenceRef.current;
    let cancelled = false;
    void (async () => {
      const conversionResults = await convertEventBatch(eventsToApply);
      if (
        cancelled ||
        sequence !== reticulumInitialHistoryBatchSequenceRef.current ||
        reticulumEventContextRef.current !== eventContext
      ) {
        return;
      }

      const nextHistory = buildReticulumInitialHistoryState(
        conversionResults.map((result) => result.item),
        {
          initialMessages: messages,
          initialChatReferences: chatReferences,
          shouldExclude: (item) =>
            isChatSenderBlocked(item) || isReticulumHiddenAuthor(item?.sender),
          reconcileItem: (item) => {
            const specialId = reticulumHistoryItemSpecialId(item);
            const hasPendingOptimisticMatch = Boolean(
              specialId &&
              queueChatsRef.current?.[reticulumChatQueueId]?.some(
                (queuedItem) => queuedItem?.message?.specialId === specialId
              )
            );
            if (!hasPendingOptimisticMatch) return item;
            return (
              processWithNewMessages([item], reticulumChatQueueId)?.[0] || item
            );
          },
        }
      );
      if (
        cancelled ||
        sequence !== reticulumInitialHistoryBatchSequenceRef.current ||
        reticulumEventContextRef.current !== eventContext
      ) {
        return;
      }

      for (const eventId of nextHistory.appliedEventIds) {
        appliedReticulumEventIdsRef.current.add(eventId);
      }
      for (const result of conversionResults) {
        if (result.succeeded && result.eventId) {
          appliedReticulumEventIdsRef.current.add(result.eventId);
        }
      }
      if (!conversionResults.some((result) => result.item)) return;
      const messagesChanged =
        nextHistory.messages.length !== messages.length ||
        nextHistory.messages.some(
          (message, index) => message !== messages[index]
        );
      const previousReferenceKeys = Object.keys(chatReferences);
      const nextReferenceKeys = Object.keys(nextHistory.chatReferences);
      const referencesChanged =
        previousReferenceKeys.length !== nextReferenceKeys.length ||
        nextReferenceKeys.some(
          (key) => nextHistory.chatReferences[key] !== chatReferences[key]
        );
      if (messagesChanged) setMessages(nextHistory.messages);
      if (referencesChanged) setChatReferences(nextHistory.chatReferences);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    chatReferences,
    convertReticulumEventToChatItem,
    isChatSenderBlocked,
    isReticulumHiddenAuthor,
    messages,
    processWithNewMessages,
    reticulumChatEnabled,
    reticulumChatEvents,
    reticulumInitialHistoryReady,
    reticulumHistoryWindowRevision,
    reticulumMemberNameByAddress,
    reticulumProcessedHistoryKey,
    reticulumChatQueueId,
    reticulumVisibilityChange?.revision,
    selectedGroup,
    selectedReticulumChannelId,
  ]);

  useEffect(() => {
    if (!reticulumChatEnabled || !isActive || !selectedGroup) {
      if (!isActive) {
        reticulumReadWasActiveRef.current = false;
      }
      return;
    }
    const readEntryToken =
      typeof reticulumReadEntryToken === 'number'
        ? reticulumReadEntryToken
        : null;
    const entryTokenChanged =
      readEntryToken !== null &&
      readEntryToken !== lastReticulumReadEntryTokenRef.current;
    const wasAlreadyActive = reticulumReadWasActiveRef.current === true;
    reticulumReadWasActiveRef.current = true;
    if (!entryTokenChanged && !wasAlreadyActive) {
      return;
    }
    const groupId = Number(selectedGroup);
    if (!Number.isInteger(groupId) || groupId <= 0) return;
    const latestVisibleTimestamp = reticulumChatEvents.reduce<number>(
      (latest, event: any) => {
        if (Number(event?.groupId) !== groupId) return latest;
        const eventChannelId =
          normalizeReticulumChannelName(
            event?.channelId || DEFAULT_RETICULUM_CHANNEL_ID
          ) || DEFAULT_RETICULUM_CHANNEL_ID;
        if (eventChannelId !== selectedReticulumChannelId) return latest;
        const timestamp = Number(event?.timestamp);
        return Number.isFinite(timestamp)
          ? Math.max(latest, timestamp)
          : latest;
      },
      0
    );
    const channelSummary = reticulumChannelSummariesById.get(
      selectedReticulumChannelId
    );
    const latestSummaryTimestamp = Math.max(
      Number(channelSummary?.lastEvent?.timestamp) || 0,
      Number(channelSummary?.updatedAt) || 0
    );
    const latestTimestamp = Math.max(
      latestVisibleTimestamp,
      latestSummaryTimestamp
    );
    if (latestTimestamp <= 0) return;
    if (entryTokenChanged) {
      lastReticulumReadEntryTokenRef.current = readEntryToken;
    }
    const readKey = `${groupId}:${selectedReticulumChannelId}:${myAddress || ''}`;
    const enteredChannel = lastReticulumReadChannelKeyRef.current !== readKey;
    lastReticulumReadChannelKeyRef.current = readKey;
    const unreadCount = Math.max(0, Number(channelSummary?.unreadCount) || 0);
    if (
      unreadCount > 0 &&
      (enteredChannel || entryTokenChanged || !wasAlreadyActive)
    ) {
      deferredReticulumUnreadReadKeysRef.current.add(readKey);
      return;
    }
    if (deferredReticulumUnreadReadKeysRef.current.has(readKey)) return;
    const lastMarkedRead = lastReticulumMarkedReadRef.current;
    if (
      lastMarkedRead?.key === readKey &&
      lastMarkedRead.timestamp >= latestTimestamp
    ) {
      return;
    }
    lastReticulumMarkedReadRef.current = {
      key: readKey,
      timestamp: latestTimestamp,
    };
    void window.reticulumChat
      ?.markRead?.(
        groupId,
        selectedReticulumChannelId,
        latestTimestamp,
        myAddress
      )
      .then(() => {
        executeEvent('reticulum-chat-summaries-refresh', {});
      })
      .catch(() => {
        if (
          lastReticulumMarkedReadRef.current?.key === readKey &&
          lastReticulumMarkedReadRef.current?.timestamp === latestTimestamp
        ) {
          lastReticulumMarkedReadRef.current = null;
        }
      });
  }, [
    isActive,
    myAddress,
    reticulumReadEntryToken,
    reticulumChatEnabled,
    reticulumChatEvents,
    reticulumChannelSummariesById,
    selectedGroup,
    selectedReticulumChannelId,
  ]);

  const acknowledgeReticulumUnreadMessages = useCallback(() => {
    const groupId = Number(selectedGroup);
    if (!Number.isInteger(groupId) || groupId <= 0) return;
    const latestVisibleTimestamp = reticulumChatEvents.reduce<number>(
      (latest, event: any) => {
        if (Number(event?.groupId) !== groupId) return latest;
        const eventChannelId =
          normalizeReticulumChannelName(
            event?.channelId || DEFAULT_RETICULUM_CHANNEL_ID
          ) || DEFAULT_RETICULUM_CHANNEL_ID;
        if (eventChannelId !== selectedReticulumChannelId) return latest;
        const timestamp = Number(event?.timestamp);
        return Number.isFinite(timestamp)
          ? Math.max(latest, timestamp)
          : latest;
      },
      0
    );
    const channelSummary = reticulumChannelSummariesById.get(
      selectedReticulumChannelId
    );
    const latestTimestamp = Math.max(
      latestVisibleTimestamp,
      Number(channelSummary?.lastEvent?.timestamp) || 0,
      Number(channelSummary?.updatedAt) || 0
    );
    if (latestTimestamp <= 0) return;
    const readKey = `${groupId}:${selectedReticulumChannelId}:${myAddress || ''}`;
    deferredReticulumUnreadReadKeysRef.current.delete(readKey);
    lastReticulumMarkedReadRef.current = {
      key: readKey,
      timestamp: latestTimestamp,
    };
    void window.reticulumChat
      ?.markRead?.(
        groupId,
        selectedReticulumChannelId,
        latestTimestamp,
        myAddress
      )
      .then(() => {
        executeEvent('reticulum-chat-summaries-refresh', {});
      })
      .catch(() => {
        if (
          lastReticulumMarkedReadRef.current?.key === readKey &&
          lastReticulumMarkedReadRef.current?.timestamp === latestTimestamp
        ) {
          lastReticulumMarkedReadRef.current = null;
        }
      });
  }, [
    myAddress,
    reticulumChatEvents,
    reticulumChannelSummariesById,
    selectedGroup,
    selectedReticulumChannelId,
  ]);

  const clearEditorContent = () => {
    if (editorRef.current) {
      setMessageSize(0);
      editorRef.current.chain().focus().clearContent().run();
    }
  };

  const clearPendingReticulumFiles = useCallback(() => {
    setPendingReticulumFiles((prev) => {
      prev.forEach((file) => {
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
    pendingReticulumFilesRef.current = pendingReticulumFiles;
  }, [pendingReticulumFiles]);

  useEffect(() => {
    return () => {
      pendingReticulumFilesRef.current.forEach((file) => {
        if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
        if (file.temporaryFilePath) {
          void window.reticulumResources?.releaseConvertedMedia?.(
            file.temporaryFilePath
          );
        }
      });
    };
  }, []);

  const getImageFileDimensions = useCallback(
    (file: File): Promise<{ width: number; height: number } | null> => {
      return new Promise((resolve) => {
        if (!file.type?.startsWith('image/')) {
          resolve(null);
          return;
        }
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();
        const timeout = window.setTimeout(() => {
          img.onload = null;
          img.onerror = null;
          URL.revokeObjectURL(objectUrl);
          resolve(null);
        }, 5_000);
        img.onload = () => {
          window.clearTimeout(timeout);
          const width = Number(img.naturalWidth || img.width || 0);
          const height = Number(img.naturalHeight || img.height || 0);
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
        img.onerror = () => {
          window.clearTimeout(timeout);
          URL.revokeObjectURL(objectUrl);
          resolve(null);
        };
        img.src = objectUrl;
      });
    },
    []
  );

  const sendMessage = async () => {
    try {
      if (messageSize > MAX_SIZE_MESSAGE) {
        setMessageSizeLimitShakeKey((key) => key + 1);
        return;
      }
      if (
        reticulumChatEnabled &&
        (isCompressingReticulumImage || isCompressingReticulumGif)
      )
        return;
      if (!canWriteSelectedReticulumChannel) {
        throw new Error('Only group admins can write in this channel');
      }
      if (isPrivate === null)
        throw new Error(
          t('group:message.error:determine_group_private', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      if (isSending) return;
      if (
        shouldBlockChatForLowBalance(
          balance,
          MIN_REQUIRED_QORTS,
          reticulumChatEnabled
        )
      )
        throw new Error(
          t('group:message.error.qortals_required', {
            quantity: MIN_REQUIRED_QORTS,
            postProcess: 'capitalizeFirstChar',
          })
        );
      pauseAllQueues();
      stopReticulumTyping();
      if (editorRef.current) {
        let htmlContent = editorRef.current.getHTML();
        if (reticulumChatEnabled) {
          const normalizedMentions = normalizeExactReticulumMentions(
            editorRef.current.getJSON() as Record<string, unknown>,
            reticulumMentionSuggestions
          );
          if (normalizedMentions.changed) {
            editorRef.current.commands.setContent(
              normalizedMentions.document,
              false
            );
            htmlContent = editorRef.current.getHTML();
          }
        }
        const deleteImage =
          onEditMessage && isDeleteImage && messageHasImage(onEditMessage);

        const hasImage =
          chatImagesToSave?.length > 0 || onEditMessage?.images?.length > 0;
        const hasPendingReticulumFiles =
          reticulumChatEnabled && pendingReticulumFiles.length > 0;
        if (
          (!htmlContent?.trim() || htmlContent?.trim() === '<p></p>') &&
          !hasImage &&
          !hasPendingReticulumFiles &&
          !deleteImage
        )
          return;
        if (reticulumChatEnabled) {
          setFormattingTrayResetKey((key) => key + 1);
        }
        if (htmlContent?.trim() === '<p></p>') {
          htmlContent = null;
        }
        setIsSending(true);
        const reticulumPlainPayload =
          reticulumChatEnabled || isPrivate === false;
        const message = reticulumPlainPayload
          ? !htmlContent
            ? '<p></p>'
            : editorRef.current.getJSON()
          : htmlContent;
        const secretKeyObject = reticulumPlainPayload
          ? null
          : await getSecretKey(false, true);

        let repliedTo = replyMessage?.signature;

        if (replyMessage?.chatReference) {
          repliedTo = replyMessage?.chatReference;
        }

        const chatReference = onEditMessage?.signature;
        const messageExpiryPayload =
          reticulumChatEnabled && !chatReference
            ? buildReticulumMessageExpiryPayload(
                reticulumMessageExpiryDurationMs,
                selectedReticulumChannelExpiryDurationMs
              )
            : {};

        const publicData = reticulumPlainPayload
          ? {
              isEdited: chatReference ? true : false,
            }
          : {};

        interface ImageToPublish {
          service: string;
          identifier: string;
          name: string;
          base64: string;
        }

        const imagesToPublish: ImageToPublish[] = [];
        const getImageDimensions = (
          base64: string,
          mimeType = 'image/webp'
        ): Promise<{ width: number; height: number } | null> => {
          return new Promise((resolve) => {
            if (typeof base64 !== 'string' || !base64.trim()) {
              resolve(null);
              return;
            }
            const img = new Image();
            const timeout = window.setTimeout(() => {
              img.onload = null;
              img.onerror = null;
              resolve(null);
            }, 5_000);
            img.onload = () => {
              window.clearTimeout(timeout);
              const width = Number(img.naturalWidth || img.width || 0);
              const height = Number(img.naturalHeight || img.height || 0);
              resolve(
                Number.isFinite(width) &&
                  width > 0 &&
                  Number.isFinite(height) &&
                  height > 0
                  ? { width, height }
                  : null
              );
            };
            img.onerror = () => {
              window.clearTimeout(timeout);
              resolve(null);
            };
            img.src = `data:${mimeType};base64,${base64}`;
          });
        };

        if (deleteImage && !reticulumChatEnabled) {
          const fee = await getFee('ARBITRARY');
          await show({
            publishFee: fee.fee + ' QORT',
            message: t('core:message.question.delete_chat_image', {
              postProcess: 'capitalizeFirstChar',
            }),
          });

          await window.sendMessage('publishOnQDN', {
            data: 'RA==',
            identifier: onEditMessage?.images[0]?.identifier,
            service: onEditMessage?.images[0]?.service,
            uploadType: 'base64',
          });
        }

        if (chatImagesToSave?.length > 0 && !reticulumChatEnabled) {
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

        const reticulumImages =
          reticulumChatEnabled &&
          (chatImagesToSave?.length > 0 ||
            pendingReticulumFiles.some((file) => file.isImage))
            ? await Promise.all(
                [
                  ...chatImagesToSave.map((base64, index) => ({
                    base64,
                    fileName: `chat-image-${Date.now()}-${index}.webp`,
                    mimeType: 'image/webp',
                    sizeBytes: 0,
                    isImage: true,
                  })),
                  ...pendingReticulumFiles.filter((file) => file.isImage),
                ].map(async (file, index) => {
                  const imageMimeType = file.mimeType || 'image/webp';
                  const base64 =
                    typeof file.base64 === 'string' && file.base64
                      ? file.base64
                      : '';
                  const dimensions =
                    file.width && file.height
                      ? { width: file.width, height: file.height }
                      : base64
                        ? await getImageDimensions(base64, imageMimeType)
                        : null;
                  if (file.filePath) {
                    const imported =
                      await window.reticulumResources?.importFilePath?.({
                        filePath: file.filePath,
                        namespace: 'reticulum-group-resource',
                        ownerId: `${selectedGroup}:${myAddress}`,
                        fileName:
                          file.fileName || `chat-image-${Date.now()}-${index}`,
                        mimeType: imageMimeType,
                        encrypted: false,
                        metadata: {
                          feature: 'reticulum-chat',
                          groupId: selectedGroup,
                          attachmentKind: 'image',
                          originalMimeType: imageMimeType,
                          ...(dimensions
                            ? {
                                width: dimensions.width,
                                height: dimensions.height,
                              }
                            : {}),
                        },
                      });
                    if (!imported?.success || !imported.manifest) {
                      throw new Error(
                        imported?.error ||
                          'Reticulum image resource import failed'
                      );
                    }
                    return {
                      ...(imported.manifest as Record<string, unknown>),
                      ...(dimensions
                        ? {
                            width: dimensions.width,
                            height: dimensions.height,
                          }
                        : {}),
                      reticulumResource: true,
                      timestamp: Date.now(),
                    };
                  }
                  if (!base64) {
                    throw new Error('Reticulum image file is not available');
                  }
                  const imported =
                    await window.reticulumResources?.importBase64?.({
                      base64,
                      namespace: 'reticulum-group-resource',
                      ownerId: `${selectedGroup}:${myAddress}`,
                      fileName:
                        file.fileName ||
                        `chat-image-${Date.now()}-${index}.webp`,
                      mimeType: imageMimeType,
                      encrypted: false,
                      metadata: {
                        feature: 'reticulum-chat',
                        groupId: selectedGroup,
                        attachmentKind: 'image',
                        originalMimeType: imageMimeType,
                        ...(dimensions
                          ? {
                              width: dimensions.width,
                              height: dimensions.height,
                            }
                          : {}),
                      },
                    });
                  if (!imported?.success || !imported.manifest) {
                    throw new Error(
                      imported?.error ||
                        'Reticulum image resource import failed'
                    );
                  }
                  return {
                    ...(imported.manifest as Record<string, unknown>),
                    ...(dimensions
                      ? {
                          width: dimensions.width,
                          height: dimensions.height,
                        }
                      : {}),
                    reticulumResource: true,
                    timestamp: Date.now(),
                  };
                })
              )
            : null;

        const reticulumAttachments =
          reticulumChatEnabled &&
          pendingReticulumFiles.some((file) => !file.isImage)
            ? await Promise.all(
                pendingReticulumFiles
                  .filter((file) => !file.isImage)
                  .map(async (file) => {
                    if (!file.filePath) {
                      throw new Error(
                        'File attachments require a local file path'
                      );
                    }
                    const imported =
                      await window.reticulumResources?.importFilePath?.({
                        filePath: file.filePath,
                        namespace: 'reticulum-group-resource',
                        ownerId: `${selectedGroup}:${myAddress}`,
                        fileName: file.fileName,
                        mimeType: file.mimeType || 'application/octet-stream',
                        encrypted: false,
                        metadata: {
                          feature: 'reticulum-chat',
                          groupId: selectedGroup,
                          attachmentKind: 'file',
                        },
                      });
                    if (!imported?.success || !imported.manifest) {
                      throw new Error(
                        imported?.error ||
                          'Reticulum file resource import failed'
                      );
                    }
                    return {
                      ...(imported.manifest as Record<string, unknown>),
                      reticulumResource: true,
                      timestamp: Date.now(),
                    };
                  })
              )
            : [];

        const images = reticulumImages
          ? reticulumImages
          : imagesToPublish?.length > 0
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

        const mentionedAddresses = resolveMentionedAddresses(htmlContent || '');
        const mentionTargets = resolveMentionTargets(htmlContent || '');
        const mentionedAddressHashes =
          await buildMentionAddressHashes(mentionedAddresses);
        const otherData = {
          repliedTo,
          ...(onEditMessage?.decryptedData || {}),
          type: chatReference ? 'edit' : '',
          specialId: uid.rnd(),
          images: images,
          ...(reticulumAttachments.length > 0
            ? { attachments: reticulumAttachments }
            : {}),
          mentionedAddresses,
          mentionTargets,
          ...publicData,
        };
        const objectMessage = {
          ...(otherData || {}),
          [reticulumPlainPayload ? 'messageText' : 'message']: message,
          ...messageExpiryPayload,
          version: 3,
        };
        const message64: any = await objectToBase64(objectMessage);

        const encryptSingle = reticulumPlainPayload
          ? JSON.stringify(objectMessage)
          : await encryptChatMessage(message64, secretKeyObject);

        const sendMessageFunc = async () => {
          if (reticulumChatEnabled) {
            const result = await publishReticulumGroupChatEvent({
              encryptedPayload: encryptSingle,
              eventType: chatReference ? 'edit' : 'message',
              targetEventId: chatReference || undefined,
              replyToEventId: repliedTo || undefined,
              mentionAddressHashes: mentionedAddressHashes,
              mentionTargets,
            });
            return { ...result, clearQueueOnSuccess: true };
          }
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
        addToQueue(sendMessageFunc, messageObj, 'chat', reticulumChatQueueId);
        if (!onEditMessage) {
          setTimeout(() => {
            executeEvent('sent-new-message-group', {});
          }, 150);
        }

        clearEditorContent();
        setReplyMessage(null);
        setOnEditMessage(null);
        setIsDeleteImage(false);
        setChatImagesToSave([]);
        clearPendingReticulumFiles();
        setReticulumMessageExpiryDurationMs(undefined);
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
        if (isPrivate && !reticulumChatEnabled) {
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
  }, [
    editorRef,
    encryptChatMessage,
    getSecretKey,
    isPrivate,
    reticulumChatEnabled,
    setMessageSize,
  ]);

  useEffect(() => {
    if (hide) {
      setTimeout(() => setIsMoved(true), 500); // Wait for the fade-out to complete before moving
    } else {
      setIsMoved(false); // Reset the position immediately when showing
    }
  }, [hide]);

  const onReply = useCallback(
    (message) => {
      if (!canWriteSelectedReticulumChannel) return;
      if (onEditMessage) {
        clearEditorContent();
      }
      setReplyMessage(message);
      setOnEditMessage(null);
      setIsDeleteImage(false);
      setChatImagesToSave([]);
      editorRef?.current?.chain().focus();
    },
    [canWriteSelectedReticulumChannel, onEditMessage]
  );

  const onEdit = useCallback((message) => {
    setOnEditMessage(message);
    setReplyMessage(null);
    try {
      editorRef.current
        .chain()
        .focus()
        .setContent(
          normalizeReticulumChatHtmlContent(
            message?.messageText || message?.text
          )
        )
        .run();
    } catch (error) {
      console.error(error);
    }
  }, []);

  const getLatestOwnEditableMessage = useCallback(() => {
    let latestMessage = null;
    let latestTimestamp = -Infinity;
    let latestIndex = -1;

    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (!message || typeof message !== 'object') continue;
      if (message.sender !== myAddress) continue;
      if (message.isTemp) continue;
      if (message.chatReference) continue;

      const signature = message.signature || message.id;
      if (!signature) continue;

      const messageType =
        message.eventType || message.decryptedData?.type || message.type;
      if (
        messageType === 'edit' ||
        messageType === 'delete' ||
        messageType === 'reaction' ||
        messageType === 'reaction_add' ||
        messageType === 'reaction_remove' ||
        messageType === 'attachment_manifest'
      ) {
        continue;
      }
      if (
        reticulumChatEnabled &&
        message.reticulumChat &&
        normalizeReticulumChannelName(
          message.channelId || DEFAULT_RETICULUM_CHANNEL_ID
        ) !== selectedReticulumChannelId
      ) {
        continue;
      }

      const timestamp = Number(message.timestamp || 0);
      if (timestamp < latestTimestamp) continue;
      if (timestamp === latestTimestamp && index < latestIndex) continue;

      const edit = chatReferences?.[signature]?.edit;
      latestMessage = edit
        ? {
            ...message,
            text: edit.message,
            messageText: edit.messageText,
            images: edit.images,
            isEdit: true,
            editTimestamp: edit.timestamp,
          }
        : message;
      latestTimestamp = timestamp;
      latestIndex = index;
    }

    return latestMessage;
  }, [
    chatReferences,
    messages,
    myAddress,
    reticulumChatEnabled,
    selectedReticulumChannelId,
  ]);

  const handleComposerKeyDown = useCallback(
    (event, editor) => {
      if (event.key === 'Escape' && reticulumChatEnabled) {
        if (replyMessage) {
          event.preventDefault();
          setReplyMessage(null);
          return true;
        }
        if (onEditMessage) {
          event.preventDefault();
          setOnEditMessage(null);
          setIsDeleteImage(false);
          setChatImagesToSave([]);
          clearPendingReticulumFiles();
          clearEditorContent();
          return true;
        }
      }
      if (event.key !== 'ArrowUp') return false;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return false;
      }
      if (event.isComposing) return false;
      if (
        onEditMessage ||
        replyMessage ||
        chatImagesToSave.length > 0 ||
        pendingReticulumFiles.length > 0
      ) {
        return false;
      }

      const html = editor?.getHTML?.()?.trim() || '';
      const text = editor?.getText?.()?.trim() || '';
      const isEmptyEditor =
        editor?.isEmpty === true || (!text && (!html || html === '<p></p>'));
      if (!isEmptyEditor) return false;

      const latestMessage = getLatestOwnEditableMessage();
      if (!latestMessage) return false;

      event.preventDefault();
      onEdit(latestMessage);
      return true;
    },
    [
      chatImagesToSave.length,
      clearPendingReticulumFiles,
      getLatestOwnEditableMessage,
      onEdit,
      onEditMessage,
      pendingReticulumFiles.length,
      reticulumChatEnabled,
      replyMessage,
    ]
  );

  const onDelete = useCallback(
    async (message) => {
      try {
        if (!reticulumChatEnabled || !message?.reticulumChat) return;
        if (isSending) return;
        if (isPrivate === null)
          throw new Error(
            t('group:message.error:determine_group_private', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        setIsSending(true);

        const targetEventId = message.signature || message.id;
        if (!targetEventId) return;
        const objectMessage = {
          message: '',
          type: 'delete',
          targetEventId,
          specialId: uid.rnd(),
          version: 3,
        };
        const encryptedPayload = JSON.stringify(objectMessage);
        const result = await publishReticulumGroupChatEvent({
          encryptedPayload,
          eventType: 'delete',
          targetEventId,
        });
        if (!result?.success) {
          throw new Error(result?.error || 'Reticulum chat delete failed');
        }
        const eventId =
          typeof result?.event?.eventId === 'string'
            ? result.event.eventId
            : '';
        if (!eventId || !appliedReticulumEventIdsRef.current.has(eventId)) {
          const item = result?.event
            ? await convertReticulumEventToChatItem(result.event)
            : null;
          if (item) {
            // Mark before applying: processWithNewMessages can synchronously
            // update the event source used by the Reticulum listener above.
            if (eventId) appliedReticulumEventIdsRef.current.add(eventId);
            applyReticulumChatItem(item);
          }
        }
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
      }
    },
    [
      applyReticulumChatItem,
      convertReticulumEventToChatItem,
      getSecretKey,
      isPrivate,
      isSending,
      publishReticulumGroupChatEvent,
      reticulumChatEnabled,
      t,
    ]
  );

  const handleReaction = useCallback(
    async (reaction, chatMessage, reactionState = true) => {
      try {
        if (isSending) return;
        if (
          shouldBlockChatForLowBalance(
            balance,
            MIN_REQUIRED_QORTS,
            reticulumChatEnabled
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

        const message = '';
        const reticulumPlainPayload =
          reticulumChatEnabled || isPrivate === false;
        const secretKeyObject = reticulumPlainPayload
          ? null
          : await getSecretKey(false, true);
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
        const encryptSingle = reticulumPlainPayload
          ? JSON.stringify(objectMessage)
          : await encryptChatMessage(
              message64,
              secretKeyObject,
              reactiontypeNumber
            );
        const sendMessageFunc = async () => {
          if (reticulumChatEnabled) {
            const result = await publishReticulumGroupChatEvent({
              encryptedPayload: encryptSingle,
              eventType: reactionState ? 'reaction_add' : 'reaction_remove',
              targetEventId: chatMessage.signature,
            });
            return { ...result, clearQueueOnSuccess: true };
          }
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
        addToQueue(
          sendMessageFunc,
          messageObj,
          'chat-reaction',
          reticulumChatQueueId
        );
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
    [
      applyReticulumChatItem,
      balance,
      convertReticulumEventToChatItem,
      isPrivate,
      publishReticulumGroupChatEvent,
      reticulumChatEnabled,
    ]
  );

  const openQManager = useCallback(
    (eventOrRect?: any) => {
      const shouldToggle = Boolean(
        eventOrRect?.detail?.toggle ?? eventOrRect?.toggle
      );
      if (shouldToggle && isOpenQManager === true) {
        setIsOpenQManager(false);
        return;
      }
      setReticulumAdminAnchorEl(null);
      setReticulumAdminAnchorPosition(null);
      executeEvent('closeReticulumMembersPanel');
      const targetRect =
        eventOrRect?.currentTarget?.getBoundingClientRect?.() ?? null;
      const possibleRect =
        eventOrRect?.detail?.anchorRect ??
        eventOrRect?.anchorRect ??
        targetRect ??
        eventOrRect;
      if (
        possibleRect &&
        typeof possibleRect.left === 'number' &&
        typeof possibleRect.bottom === 'number'
      ) {
        setQManagerAnchorRect({
          bottom: possibleRect.bottom,
          height: possibleRect.height ?? 0,
          left: possibleRect.left,
          right: possibleRect.right ?? possibleRect.left,
          top: possibleRect.top ?? possibleRect.bottom,
          width: possibleRect.width ?? 0,
        });
      }
      setIsOpenQManager(true);
    },
    [isOpenQManager]
  );

  const toggleQManager = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (isOpenQManager === true) {
        setIsOpenQManager(false);
        return;
      }
      openQManager(event);
    },
    [isOpenQManager, openQManager]
  );

  useEffect(() => {
    executeEvent('reticulumQManagerOpenState', {
      open: isOpenQManager === true,
    });
  }, [isOpenQManager]);

  useEffect(() => {
    executeEvent('reticulumAdminKeysOpenState', {
      open: Boolean(reticulumAdminAnchorEl || reticulumAdminAnchorPosition),
    });
  }, [reticulumAdminAnchorEl, reticulumAdminAnchorPosition]);

  useEffect(() => {
    executeEvent('reticulumChatSearchOpenState', {
      open: reticulumSearchOpen,
    });
  }, [reticulumSearchOpen]);

  useEffect(
    () => () => {
      executeEvent('reticulumChatSearchOpenState', { open: false });
    },
    []
  );

  const toggleReticulumAdminPopover = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!isReticulumChannelAdmin) return;
      if (reticulumAdminAnchorEl || reticulumAdminAnchorPosition) {
        setReticulumAdminAnchorEl(null);
        setReticulumAdminAnchorPosition(null);
        return;
      }
      setIsOpenQManager(false);
      executeEvent('closeReticulumMembersPanel');
      setReticulumAdminAnchorEl(event.currentTarget);
    },
    [
      isReticulumChannelAdmin,
      reticulumAdminAnchorEl,
      reticulumAdminAnchorPosition,
    ]
  );

  const toggleReticulumAdminFromEvent = useCallback(
    (eventOrRect?: any) => {
      if (!isReticulumChannelAdmin) {
        setReticulumAdminAnchorEl(null);
        setReticulumAdminAnchorPosition(null);
        return;
      }
      const shouldToggle = Boolean(
        eventOrRect?.detail?.toggle ?? eventOrRect?.toggle
      );
      if (
        shouldToggle &&
        (reticulumAdminAnchorEl || reticulumAdminAnchorPosition)
      ) {
        setReticulumAdminAnchorEl(null);
        setReticulumAdminAnchorPosition(null);
        return;
      }
      const anchorRect =
        eventOrRect?.detail?.anchorRect ?? eventOrRect?.anchorRect ?? null;
      if (anchorRect && typeof anchorRect.left === 'number') {
        setIsOpenQManager(false);
        executeEvent('closeReticulumMembersPanel');
        setReticulumAdminAnchorEl(null);
        setReticulumAdminAnchorPosition({
          left: anchorRect.left + (anchorRect.width ?? 0) / 2,
          top: anchorRect.bottom,
        });
      }
    },
    [
      isReticulumChannelAdmin,
      reticulumAdminAnchorEl,
      reticulumAdminAnchorPosition,
    ]
  );

  useEffect(() => {
    if (!reticulumChatEnabled) return;
    const openSearch = (event: any) => {
      const shouldToggle = Boolean(event?.detail?.toggle ?? event?.toggle);
      setReticulumSearchOpen((open) => (shouldToggle ? !open : true));
    };
    subscribeToEvent('openReticulumChatSearch', openSearch);
    subscribeToEvent('openReticulumQManager', openQManager);
    subscribeToEvent('toggleReticulumAdminKeys', toggleReticulumAdminFromEvent);
    return () => {
      unsubscribeFromEvent('openReticulumChatSearch', openSearch);
      unsubscribeFromEvent('openReticulumQManager', openQManager);
      unsubscribeFromEvent(
        'toggleReticulumAdminKeys',
        toggleReticulumAdminFromEvent
      );
    };
  }, [openQManager, reticulumChatEnabled, toggleReticulumAdminFromEvent]);

  useEffect(() => {
    if (!reticulumAdminAnchorEl && !reticulumAdminAnchorPosition) return;

    const closeAdminPopoverOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        target instanceof Element &&
        target.closest('.reticulum-admin-popover-paper')
      ) {
        return;
      }
      if (reticulumAdminPopoverRef.current?.contains(target)) return;
      if (reticulumAdminAnchorEl?.contains(target)) return;

      setReticulumAdminAnchorEl(null);
      setReticulumAdminAnchorPosition(null);
    };

    document.addEventListener(
      'pointerdown',
      closeAdminPopoverOnOutsidePointerDown,
      true
    );
    return () =>
      document.removeEventListener(
        'pointerdown',
        closeAdminPopoverOnOutsidePointerDown,
        true
      );
  }, [reticulumAdminAnchorEl, reticulumAdminAnchorPosition]);

  const theme = useTheme();

  const insertImage = useCallback(
    (img) => {
      if (
        chatImagesToSave?.length > 0 ||
        pendingReticulumFiles.length > 0 ||
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
    [
      chatImagesToSave,
      pendingReticulumFiles.length,
      onEditMessage?.images,
      isDeleteImage,
    ]
  );

  const addPendingReticulumFile = useCallback(
    async (
      file: File,
      options: { asAttachment?: boolean; filePathOverride?: string } = {}
    ) => {
      const filePath =
        options.filePathOverride ||
        window.reticulumResources?.getPathForFile?.(file) ||
        (typeof (file as File & { path?: unknown }).path === 'string'
          ? String((file as File & { path?: unknown }).path)
          : '');
      const isImage =
        file.type?.startsWith('image/') === true &&
        options.asAttachment !== true;
      if (options.asAttachment && !filePath) {
        setInfoSnack({
          type: 'error',
          message: 'This file source cannot be streamed from disk',
        });
        setOpenSnack(true);
        return false;
      }
      const dimensions = isImage ? await getImageFileDimensions(file) : null;
      const previewUrl = isImage ? URL.createObjectURL(file) : undefined;
      const base64 =
        isImage && !filePath ? await fileToBase64(file) : undefined;
      setPendingReticulumFiles([
        {
          ...(filePath ? { filePath } : {}),
          fileName: file.name || 'resource.bin',
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size || 0,
          isImage,
          ...(previewUrl ? { previewUrl } : {}),
          ...(typeof base64 === 'string' && base64 ? { base64 } : {}),
          ...(dimensions
            ? {
                width: dimensions.width,
                height: dimensions.height,
              }
            : {}),
        },
      ]);
      return true;
    },
    [getImageFileDimensions]
  );

  const insertFiles = useCallback(
    async (files: File[]) => {
      if (isCompressingReticulumImage || isCompressingReticulumGif) return;
      const file = files.find((item) => item && item.size >= 0);
      if (!file) return;
      if (
        chatImagesToSave?.length > 0 ||
        pendingReticulumFiles.length > 0 ||
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

      const isImage = file.type?.startsWith('image/') === true;
      if (!reticulumChatEnabled) {
        if (!isImage) {
          setInfoSnack({
            type: 'error',
            message: 'File attachments require Reticulum chat',
          });
          setOpenSnack(true);
          return;
        }
        const base64 = await fileToBase64(file);
        insertImage(base64);
        return;
      }

      const filePath =
        window.reticulumResources?.getPathForFile?.(file) ||
        (typeof (file as File & { path?: unknown }).path === 'string'
          ? String((file as File & { path?: unknown }).path)
          : '');
      if (await isReticulumGifFile(file)) {
        const conversionSequence = ++reticulumGifConversionSequenceRef.current;
        const conversionContext = reticulumGifConversionContextRef.current;
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
              reticulumGifConversionContextRef.current !== conversionContext
            ) {
              void window.reticulumResources?.releaseConvertedMedia?.(
                converted.filePath
              );
              return;
            }
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
          console.warn('Reticulum animated GIF conversion failed:', error);
        } finally {
          if (
            reticulumGifConversionSequenceRef.current === conversionSequence
          ) {
            setIsCompressingReticulumGif(false);
          }
        }
      }
      if (!isImage && !filePath) {
        setInfoSnack({
          type: 'error',
          message: 'This file source cannot be streamed from disk',
        });
        setOpenSnack(true);
        return;
      }
      if (isImage && isReticulumCompressibleImage(file)) {
        setReticulumLargeImageChoice({
          file,
          filePath,
          target: 'channel',
        });
        return;
      }
      await addPendingReticulumFile(file, { filePathOverride: filePath });
    },
    [
      addPendingReticulumFile,
      chatImagesToSave,
      insertImage,
      isCompressingReticulumGif,
      isCompressingReticulumImage,
      isDeleteImage,
      isPrivate,
      onEditMessage,
      pendingReticulumFiles.length,
      reticulumChatEnabled,
      t,
    ]
  );

  const isReticulumFileDrag = useCallback(
    (event: ReactDragEvent<HTMLElement>) =>
      reticulumChatEnabled &&
      Array.from(event.dataTransfer?.types || []).includes('Files'),
    [reticulumChatEnabled]
  );

  const handleReticulumAttachmentDragEnter = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (!isReticulumFileDrag(event)) return;
      event.preventDefault();
      reticulumAttachmentDragDepthRef.current += 1;
      setIsReticulumAttachmentDragActive(true);
    },
    [isReticulumFileDrag]
  );

  const handleReticulumAttachmentDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (!isReticulumFileDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setIsReticulumAttachmentDragActive(true);
    },
    [isReticulumFileDrag]
  );

  const handleReticulumAttachmentDragLeave = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (!isReticulumFileDrag(event)) return;
      event.preventDefault();
      reticulumAttachmentDragDepthRef.current = Math.max(
        0,
        reticulumAttachmentDragDepthRef.current - 1
      );
      if (reticulumAttachmentDragDepthRef.current === 0) {
        setIsReticulumAttachmentDragActive(false);
      }
    },
    [isReticulumFileDrag]
  );

  const handleReticulumAttachmentDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (!isReticulumFileDrag(event)) return;
      const files = Array.from(event.dataTransfer?.files || []);
      const handledByChild = event.defaultPrevented;
      event.preventDefault();
      reticulumAttachmentDragDepthRef.current = 0;
      setIsReticulumAttachmentDragActive(false);
      // The editor already owns drops made directly over its input surface.
      if (handledByChild || files.length === 0) return;
      event.stopPropagation();
      if (!canWriteSelectedReticulumChannel) return;
      void insertFiles(files);
    },
    [canWriteSelectedReticulumChannel, insertFiles, isReticulumFileDrag]
  );

  const removeReticulumDiscussionFile = useCallback((index: number) => {
    setReticulumDiscussionFiles((current) => {
      const removed = current[index];
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      if (removed?.temporaryFilePath) {
        void window.reticulumResources?.releaseConvertedMedia?.(
          removed.temporaryFilePath
        );
      }
      return current.filter((_, fileIndex) => fileIndex !== index);
    });
  }, []);

  const addReticulumDiscussionFile = useCallback(
    async (
      file: File,
      options: {
        asAttachment?: boolean;
        expectedSequence?: number;
        filePathOverride?: string;
        temporaryFilePath?: string;
      } = {}
    ) => {
      const filePath =
        options.filePathOverride ||
        window.reticulumResources?.getPathForFile?.(file) ||
        (typeof (file as File & { path?: unknown }).path === 'string'
          ? String((file as File & { path?: unknown }).path)
          : '');
      const isImage =
        file.type?.startsWith('image/') === true &&
        options.asAttachment !== true;
      if (!isImage && !filePath) {
        throw new Error('This file source cannot be streamed from disk');
      }
      const dimensions = isImage ? await getImageFileDimensions(file) : null;
      const previewUrl = isImage ? URL.createObjectURL(file) : undefined;
      const base64 =
        isImage && !filePath ? await fileToBase64(file) : undefined;
      if (
        options.expectedSequence !== undefined &&
        options.expectedSequence !== reticulumDiscussionFileSequenceRef.current
      ) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        return false;
      }
      setReticulumDiscussionFiles([
        {
          ...(base64 ? { base64 } : {}),
          fileName: file.name || 'resource.bin',
          ...(filePath ? { filePath } : {}),
          ...(dimensions
            ? { height: dimensions.height, width: dimensions.width }
            : {}),
          isImage,
          mimeType: file.type || 'application/octet-stream',
          ...(previewUrl ? { previewUrl } : {}),
          sizeBytes: file.size || 0,
          ...(options.temporaryFilePath
            ? { temporaryFilePath: options.temporaryFilePath }
            : {}),
        },
      ]);
      return true;
    },
    [getImageFileDimensions]
  );

  const insertReticulumDiscussionFiles = useCallback(
    async (files: File[]) => {
      if (isPreparingReticulumDiscussionFile) return;
      const file = files.find((candidate) => candidate && candidate.size >= 0);
      if (!file) return;
      if (reticulumDiscussionFiles.length > 0) {
        setInfoSnack({
          type: 'error',
          message: t('core:message.generic.message_with_image', {
            postProcess: 'capitalizeFirstChar',
          }),
        });
        setOpenSnack(true);
        return;
      }
      const sequence = ++reticulumDiscussionFileSequenceRef.current;
      setIsPreparingReticulumDiscussionFile(true);
      setIsCompressingReticulumDiscussionGif(false);
      try {
        const filePath =
          window.reticulumResources?.getPathForFile?.(file) ||
          (typeof (file as File & { path?: unknown }).path === 'string'
            ? String((file as File & { path?: unknown }).path)
            : '');
        if (await isReticulumGifFile(file)) {
          setIsCompressingReticulumDiscussionGif(true);
          const converted = await convertReticulumGifFile(file);
          if (sequence !== reticulumDiscussionFileSequenceRef.current) {
            if (converted?.filePath) {
              void window.reticulumResources?.releaseConvertedMedia?.(
                converted.filePath
              );
            }
            return;
          }
          if (
            converted?.success &&
            converted.filePath &&
            converted.fileName &&
            converted.mimeType
          ) {
            setReticulumDiscussionFiles([
              {
                fileName: converted.fileName,
                filePath: converted.filePath,
                ...(converted.height ? { height: converted.height } : {}),
                isImage: true,
                mimeType: converted.mimeType,
                sizeBytes: Number(converted.sizeBytes) || 0,
                temporaryFilePath: converted.filePath,
                ...(converted.width ? { width: converted.width } : {}),
              },
            ]);
            return;
          }
        }
        if (isReticulumCompressibleImage(file)) {
          setReticulumLargeImageChoice({
            file,
            filePath,
            target: 'discussion',
          });
          return;
        }
        await addReticulumDiscussionFile(file, {
          expectedSequence: sequence,
          filePathOverride: filePath,
        });
      } catch (error) {
        setInfoSnack({
          type: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Unable to prepare attachment',
        });
        setOpenSnack(true);
      } finally {
        if (sequence === reticulumDiscussionFileSequenceRef.current) {
          setIsPreparingReticulumDiscussionFile(false);
          setIsCompressingReticulumDiscussionGif(false);
        }
      }
    },
    [
      addReticulumDiscussionFile,
      isPreparingReticulumDiscussionFile,
      reticulumDiscussionFiles.length,
      t,
    ]
  );

  const closeReticulumLargeImageChoice = useCallback(() => {
    if (isCompressingReticulumImage) return;
    setReticulumLargeImageChoice(null);
  }, [isCompressingReticulumImage]);

  const useReticulumCompressedImage = useCallback(async () => {
    const choice = reticulumLargeImageChoice;
    if (!choice || isCompressingReticulumImage) return;
    setIsCompressingReticulumImage(true);
    if (choice.target === 'discussion') {
      setIsPreparingReticulumDiscussionFile(true);
    }
    try {
      const compressed = await compressReticulumImageFile(choice.file);
      if (choice.target === 'discussion') {
        await addReticulumDiscussionFile(compressed, {
          expectedSequence: reticulumDiscussionFileSequenceRef.current,
        });
      } else {
        await addPendingReticulumFile(compressed);
      }
      setReticulumLargeImageChoice(null);
    } finally {
      setIsCompressingReticulumImage(false);
      if (choice.target === 'discussion') {
        setIsPreparingReticulumDiscussionFile(false);
      }
    }
  }, [
    addReticulumDiscussionFile,
    addPendingReticulumFile,
    isCompressingReticulumImage,
    reticulumLargeImageChoice,
  ]);

  const useReticulumImageAsAttachment = useCallback(async () => {
    const choice = reticulumLargeImageChoice;
    if (!choice || isCompressingReticulumImage) return;
    const added =
      choice.target === 'discussion'
        ? await addReticulumDiscussionFile(choice.file, {
            asAttachment: true,
            expectedSequence: reticulumDiscussionFileSequenceRef.current,
            filePathOverride: choice.filePath,
          })
        : await addPendingReticulumFile(choice.file, {
            asAttachment: true,
            filePathOverride: choice.filePath,
          });
    if (added) {
      setReticulumLargeImageChoice(null);
    }
  }, [
    addReticulumDiscussionFile,
    addPendingReticulumFile,
    isCompressingReticulumImage,
    reticulumLargeImageChoice,
  ]);

  const publishReticulumChannelMetadata = useCallback(
    async (
      eventType:
        | 'channel_create'
        | 'channel_update'
        | 'channel_archive'
        | 'channel_reorder'
        | 'category_create'
        | 'category_update'
        | 'category_delete',
      payload: Record<string, unknown>,
      options: { refresh?: boolean } = {}
    ) => {
      if (!reticulumChatEnabled || !isReticulumChannelAdmin) return;
      const payloadText = JSON.stringify(payload);
      const result = await publishReticulumGroupChatEvent({
        encryptedPayload: payloadText,
        eventType,
        channelId:
          typeof payload.channelId === 'string'
            ? payload.channelId
            : DEFAULT_RETICULUM_CHANNEL_ID,
      });
      if (result?.event) {
        const applyResult = window.reticulumChat?.applyChannelMetadata?.(
          result.event.eventId,
          payload
        );
        if (options.refresh === false) {
          await applyResult;
        } else {
          void applyResult?.then(() => {
            void refreshReticulumChannels();
          });
        }
      }
    },
    [
      isReticulumChannelAdmin,
      publishReticulumGroupChatEvent,
      refreshReticulumChannels,
      reticulumChatEnabled,
    ]
  );

  const openReticulumNameEmojiPicker = useCallback(
    (
      event: ReactMouseEvent<HTMLElement>,
      target: 'channel-create' | 'channel-settings' | 'category'
    ) => {
      event.preventDefault();
      setReticulumNameEmojiPicker({ anchorEl: event.currentTarget, target });
    },
    []
  );

  const closeReticulumNameEmojiPicker = useCallback(() => {
    setReticulumNameEmojiPicker(null);
  }, []);

  const appendReticulumNameEmoji = useCallback(
    (emojiData: { emoji?: string }) => {
      const emoji = emojiData?.emoji;
      if (!emoji || !reticulumNameEmojiPicker) return;
      if (reticulumNameEmojiPicker.target === 'channel-create') {
        setNewReticulumChannelName((current) => `${current}${emoji}`);
        setNewReticulumChannelError('');
      } else if (reticulumNameEmojiPicker.target === 'channel-settings') {
        setReticulumChannelName((current) => `${current}${emoji}`);
        setReticulumChannelError('');
      } else {
        setReticulumCategoryName((current) => `${current}${emoji}`);
        setReticulumCategoryError('');
      }
      closeReticulumNameEmojiPicker();
    },
    [closeReticulumNameEmojiPicker, reticulumNameEmojiPicker]
  );

  const renderReticulumNameEmojiAdornment = (
    target: 'channel-create' | 'channel-settings' | 'category'
  ) => (
    <InputAdornment position="end">
      <Tooltip title="Choose emoji">
        <IconButton
          aria-label="Choose emoji"
          edge="end"
          onClick={(event) => openReticulumNameEmojiPicker(event, target)}
          onMouseDown={(event) => event.preventDefault()}
          size="small"
          sx={{
            borderRadius: '5px',
            color: 'text.secondary',
            height: 28,
            width: 28,
            '&:hover': {
              backgroundColor: 'action.hover',
              color: 'text.primary',
            },
          }}
        >
          <EmojiEmotionsRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </InputAdornment>
  );

  const openCreateReticulumChannelDialog = useCallback((categoryId = '') => {
    setNewReticulumChannelCategoryId(categoryId);
    setNewReticulumChannelName('');
    setNewReticulumChannelAccessMode(RETICULUM_CHANNEL_ACCESS_REGULAR);
    setNewReticulumChannelExpiryDurationMs(TIME_MONTHS_1_IN_MILLISECONDS);
    setNewReticulumChannelError('');
    setIsCreateReticulumChannelOpen(true);
  }, []);

  const closeCreateReticulumChannelDialog = useCallback(() => {
    setIsCreateReticulumChannelOpen(false);
    setNewReticulumChannelName('');
    setNewReticulumChannelError('');
    setNewReticulumChannelCategoryId('');
    setNewReticulumChannelAccessMode(RETICULUM_CHANNEL_ACCESS_REGULAR);
    setNewReticulumChannelExpiryDurationMs(TIME_MONTHS_1_IN_MILLISECONDS);
    setReticulumNameEmojiPicker(null);
  }, []);

  const createReticulumChannel = useCallback(async () => {
    if (isCreatingReticulumChannel) return;
    const name = normalizeReticulumDisplayName(newReticulumChannelName);
    if (!name) {
      setNewReticulumChannelError('Enter a channel name');
      return;
    }
    if (
      reticulumChannelsForSelectedGroup.some(
        (channel) =>
          reticulumDisplayNameKey(channel.name) ===
          reticulumDisplayNameKey(name)
      )
    ) {
      setNewReticulumChannelError('Channel already exists');
      return;
    }
    const channelId =
      reticulumDisplayNameKey(name) === DEFAULT_RETICULUM_CHANNEL_ID
        ? DEFAULT_RETICULUM_CHANNEL_ID
        : `ch-${crypto.randomUUID?.() || `${Date.now()}-${uid.rnd()}`}`;
    const categoryIds = new Set(
      reticulumCategoriesForSelectedGroup.map((category) => category.categoryId)
    );
    const categoryId = categoryIds.has(newReticulumChannelCategoryId)
      ? newReticulumChannelCategoryId
      : '';
    const position = reticulumChannelsByCategory.get(categoryId)?.length ?? 0;
    const channelModes = reticulumChannelModesFromAccess(
      newReticulumChannelAccessMode
    );
    setIsCreatingReticulumChannel(true);
    try {
      await publishReticulumChannelMetadata('channel_create', {
        channelId,
        categoryId,
        name,
        position,
        writeMode: channelModes.writeMode,
        readMode: channelModes.readMode,
        expiryDurationMs: newReticulumChannelExpiryDurationMs ?? 0,
      });
      setSelectedReticulumChannelId(channelId);
      closeCreateReticulumChannelDialog();
    } finally {
      setIsCreatingReticulumChannel(false);
    }
  }, [
    closeCreateReticulumChannelDialog,
    isCreatingReticulumChannel,
    newReticulumChannelCategoryId,
    newReticulumChannelAccessMode,
    newReticulumChannelExpiryDurationMs,
    newReticulumChannelName,
    publishReticulumChannelMetadata,
    reticulumCategoriesForSelectedGroup,
    reticulumChannelsForSelectedGroup,
    reticulumChannelsByCategory,
  ]);

  const openReticulumChannelSettings = useCallback(
    (channel: ReticulumGroupChannel) => {
      setEditingReticulumChannel(channel);
      setReticulumChannelName(channel.name || channel.channelId);
      setReticulumChannelAccessMode(
        isReticulumSystemChannelId(channel.channelId)
          ? RETICULUM_CHANNEL_ACCESS_REGULAR
          : reticulumChannelAccessFromModes(channel.writeMode, channel.readMode)
      );
      setReticulumChannelExpiryDurationMs(channel.expiryDurationMs);
      setReticulumChannelError('');
      setReticulumChannelSettingsView('settings');
      setReticulumDeleteConfirmationName('');
      setReticulumDeleteConfirmationError('');
      setIsDeletingReticulumChannel(false);
      setReticulumChannelSettingsOpen(true);
    },
    []
  );

  const closeReticulumChannelSettings = useCallback(() => {
    setReticulumChannelSettingsOpen(false);
    setEditingReticulumChannel(null);
    setReticulumChannelName('');
    setReticulumChannelAccessMode(RETICULUM_CHANNEL_ACCESS_REGULAR);
    setReticulumChannelExpiryDurationMs(undefined);
    setReticulumChannelError('');
    setReticulumChannelSettingsView('settings');
    setReticulumDeleteConfirmationName('');
    setReticulumDeleteConfirmationError('');
    setIsDeletingReticulumChannel(false);
    setReticulumNameEmojiPicker(null);
  }, []);

  const saveReticulumChannelSettings = useCallback(async () => {
    if (!editingReticulumChannel) return;
    const name = normalizeReticulumDisplayName(reticulumChannelName);
    if (!name) {
      setReticulumChannelError('Enter a channel name');
      return;
    }
    const duplicate = reticulumChannelsForSelectedGroup.some(
      (channel) =>
        channel.channelId !== editingReticulumChannel.channelId &&
        reticulumDisplayNameKey(channel.name) === reticulumDisplayNameKey(name)
    );
    if (duplicate) {
      setReticulumChannelError('Channel already exists');
      return;
    }
    const channelModes = isReticulumSystemChannelId(
      editingReticulumChannel.channelId
    )
      ? reticulumChannelModesFromAccess(RETICULUM_CHANNEL_ACCESS_REGULAR)
      : reticulumChannelModesFromAccess(reticulumChannelAccessMode);
    const expiryPayload = isReticulumSystemChannelId(
      editingReticulumChannel.channelId
    )
      ? {}
      : { expiryDurationMs: reticulumChannelExpiryDurationMs ?? 0 };
    await publishReticulumChannelMetadata('channel_update', {
      channelId: editingReticulumChannel.channelId,
      categoryId: editingReticulumChannel.categoryId || '',
      name,
      position: editingReticulumChannel.position,
      writeMode: channelModes.writeMode,
      readMode: channelModes.readMode,
      ...expiryPayload,
    });
    closeReticulumChannelSettings();
  }, [
    closeReticulumChannelSettings,
    editingReticulumChannel,
    publishReticulumChannelMetadata,
    reticulumChannelAccessMode,
    reticulumChannelExpiryDurationMs,
    reticulumChannelName,
    reticulumChannelsForSelectedGroup,
  ]);

  const openCreateReticulumCategoryDialog = useCallback(() => {
    setReticulumCategoryDialogMode('create');
    setEditingReticulumCategory(null);
    setReticulumCategoryName('');
    setReticulumCategoryError('');
    setReticulumCategorySettingsView('settings');
    setReticulumCategoryDeleteConfirmationName('');
    setReticulumCategoryDeleteConfirmationError('');
    setIsDeletingReticulumCategory(false);
    setIsReticulumCategoryDialogOpen(true);
  }, []);

  const openRenameReticulumCategoryDialog = useCallback(
    (category: ReticulumGroupCategory) => {
      setReticulumCategoryDialogMode('rename');
      setEditingReticulumCategory(category);
      setReticulumCategoryName(category.name);
      setReticulumCategoryError('');
      setReticulumCategorySettingsView('settings');
      setReticulumCategoryDeleteConfirmationName('');
      setReticulumCategoryDeleteConfirmationError('');
      setIsDeletingReticulumCategory(false);
      setIsReticulumCategoryDialogOpen(true);
    },
    []
  );

  const closeReticulumCategoryDialog = useCallback(() => {
    setIsReticulumCategoryDialogOpen(false);
    setEditingReticulumCategory(null);
    setReticulumCategoryName('');
    setReticulumCategoryError('');
    setReticulumCategorySettingsView('settings');
    setReticulumCategoryDeleteConfirmationName('');
    setReticulumCategoryDeleteConfirmationError('');
    setIsDeletingReticulumCategory(false);
    setReticulumNameEmojiPicker(null);
  }, []);

  const saveReticulumCategory = useCallback(async () => {
    const name = normalizeReticulumDisplayName(reticulumCategoryName);
    if (!name) {
      setReticulumCategoryError('Enter a category name');
      return;
    }
    const duplicate = [
      reticulumDefaultCategoryUi,
      ...reticulumCategoriesForSelectedGroup,
    ].some(
      (category) =>
        reticulumDisplayNameKey(category.name) ===
          reticulumDisplayNameKey(name) &&
        category.categoryId !== editingReticulumCategory?.categoryId
    );
    if (duplicate) {
      setReticulumCategoryError('Category already exists');
      return;
    }
    if (reticulumCategoryDialogMode === 'rename' && editingReticulumCategory) {
      const isDefaultCategory =
        editingReticulumCategory.categoryId ===
        DEFAULT_RETICULUM_CATEGORY_METADATA_ID;
      await publishReticulumChannelMetadata(
        isDefaultCategory && !reticulumDefaultCategoryMetadata
          ? 'category_create'
          : 'category_update',
        {
          categoryId: editingReticulumCategory.categoryId,
          name,
          position: editingReticulumCategory.position,
        }
      );
    } else {
      await publishReticulumChannelMetadata('category_create', {
        categoryId: `cat-${crypto.randomUUID?.() || `${Date.now()}-${uid.rnd()}`}`,
        name,
        position: reticulumCategoriesForSelectedGroup.length,
      });
    }
    closeReticulumCategoryDialog();
  }, [
    closeReticulumCategoryDialog,
    editingReticulumCategory,
    publishReticulumChannelMetadata,
    reticulumCategoriesForSelectedGroup,
    reticulumCategoryDialogMode,
    reticulumCategoryName,
    reticulumDefaultCategoryMetadata,
    reticulumDefaultCategoryUi,
  ]);

  const deleteReticulumCategory = useCallback(
    async (category: ReticulumGroupCategory) => {
      if (category.categoryId === DEFAULT_RETICULUM_CATEGORY_METADATA_ID) {
        if (reticulumDefaultCategoryHasProtectedChannels) return;
        await publishReticulumChannelMetadata(
          reticulumDefaultCategoryMetadata
            ? 'category_update'
            : 'category_create',
          {
            categoryId: DEFAULT_RETICULUM_CATEGORY_METADATA_ID,
            name: HIDDEN_RETICULUM_DEFAULT_CATEGORY_NAME,
            position: 0,
          }
        );
        await refreshReticulumChannels();
        return;
      }
      await publishReticulumChannelMetadata('category_delete', {
        categoryId: category.categoryId,
      });
      await refreshReticulumChannels();
    },
    [
      publishReticulumChannelMetadata,
      refreshReticulumChannels,
      reticulumDefaultCategoryHasProtectedChannels,
      reticulumDefaultCategoryMetadata,
    ]
  );

  const isReticulumCategoryDeleteConfirmationMatched =
    reticulumCategoryDeleteConfirmationName.trim().toLowerCase() === 'delete';

  const returnToReticulumCategorySettings = useCallback(() => {
    if (isDeletingReticulumCategory) return;
    setReticulumCategorySettingsView('settings');
    setReticulumCategoryDeleteConfirmationName('');
    setReticulumCategoryDeleteConfirmationError('');
    requestAnimationFrame(() => {
      reticulumRemoveCategoryButtonRef.current?.focus();
    });
  }, [isDeletingReticulumCategory]);

  const openReticulumCategoryDeleteConfirmation = useCallback(
    (category?: ReticulumGroupCategory) => {
      const target = category || editingReticulumCategory;
      if (!target || isDeletingReticulumCategory) return;
      if (
        target.categoryId === DEFAULT_RETICULUM_CATEGORY_METADATA_ID &&
        reticulumDefaultCategoryHasProtectedChannels
      ) {
        return;
      }
      setReticulumCategoryDialogMode('rename');
      setEditingReticulumCategory(target);
      setReticulumCategoryName(target.name);
      setReticulumCategoryError('');
      setReticulumCategoryDeleteConfirmationName('');
      setReticulumCategoryDeleteConfirmationError('');
      setReticulumCategorySettingsView('confirm-delete');
      setIsReticulumCategoryDialogOpen(true);
    },
    [
      editingReticulumCategory,
      isDeletingReticulumCategory,
      reticulumDefaultCategoryHasProtectedChannels,
    ]
  );

  const confirmReticulumCategoryDeletion = useCallback(async () => {
    if (
      !editingReticulumCategory ||
      !isReticulumCategoryDeleteConfirmationMatched ||
      isDeletingReticulumCategory ||
      (editingReticulumCategory.categoryId ===
        DEFAULT_RETICULUM_CATEGORY_METADATA_ID &&
        reticulumDefaultCategoryHasProtectedChannels)
    ) {
      return;
    }

    setReticulumCategoryDeleteConfirmationError('');
    setIsDeletingReticulumCategory(true);
    try {
      await deleteReticulumCategory(editingReticulumCategory);
      closeReticulumCategoryDialog();
    } catch (error) {
      setReticulumCategoryDeleteConfirmationError(
        error instanceof Error && error.message
          ? error.message
          : 'Unable to delete category'
      );
    } finally {
      setIsDeletingReticulumCategory(false);
    }
  }, [
    closeReticulumCategoryDialog,
    deleteReticulumCategory,
    editingReticulumCategory,
    isDeletingReticulumCategory,
    isReticulumCategoryDeleteConfirmationMatched,
    reticulumDefaultCategoryHasProtectedChannels,
  ]);

  const handleReticulumCategoryDialogClose = useCallback(() => {
    if (isDeletingReticulumCategory) return;
    if (reticulumCategorySettingsView === 'confirm-delete') {
      returnToReticulumCategorySettings();
      return;
    }
    closeReticulumCategoryDialog();
  }, [
    closeReticulumCategoryDialog,
    isDeletingReticulumCategory,
    reticulumCategorySettingsView,
    returnToReticulumCategorySettings,
  ]);

  useEffect(() => {
    if (
      !isReticulumCategoryDialogOpen ||
      reticulumCategorySettingsView !== 'confirm-delete'
    ) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      reticulumCategoryDeleteConfirmationInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isReticulumCategoryDialogOpen, reticulumCategorySettingsView]);

  const toggleReticulumCategoryCollapsed = useCallback((categoryId: string) => {
    setCollapsedReticulumCategoryIds((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  }, []);

  const openReticulumCategoryContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, category: ReticulumGroupCategory) => {
      if (!isReticulumChannelAdmin) return;
      event.preventDefault();
      setReticulumChannelMenuPosition(null);
      setReticulumChannelMenuChannel(null);
      setReticulumCategoryMenuCategory(category);
      setReticulumCategoryMenuPosition({
        mouseX: event.clientX + 2,
        mouseY: event.clientY - 6,
      });
    },
    [isReticulumChannelAdmin]
  );

  const closeReticulumCategoryContextMenu = useCallback(() => {
    setReticulumCategoryMenuPosition(null);
    setReticulumCategoryMenuCategory(null);
  }, []);

  const openReticulumChannelContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, channel: ReticulumGroupChannel) => {
      if (!isReticulumChannelAdmin) return;
      event.preventDefault();
      event.stopPropagation();
      setReticulumCategoryMenuPosition(null);
      setReticulumCategoryMenuCategory(null);
      setReticulumChannelMenuChannel(channel);
      setReticulumChannelMenuPosition({
        mouseX: event.clientX + 2,
        mouseY: event.clientY - 6,
      });
    },
    [isReticulumChannelAdmin]
  );

  const closeReticulumChannelContextMenu = useCallback(() => {
    setReticulumChannelMenuPosition(null);
    setReticulumChannelMenuChannel(null);
  }, []);

  const openReticulumChannelAreaContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!isReticulumChannelAdmin || event.target !== event.currentTarget)
        return;
      event.preventDefault();
      event.stopPropagation();
      closeReticulumCategoryContextMenu();
      closeReticulumChannelContextMenu();
      setReticulumChannelAreaMenuPosition({
        mouseX: event.clientX + 2,
        mouseY: event.clientY - 6,
      });
    },
    [
      closeReticulumCategoryContextMenu,
      closeReticulumChannelContextMenu,
      isReticulumChannelAdmin,
    ]
  );

  const closeReticulumChannelAreaContextMenu = useCallback(() => {
    setReticulumChannelAreaMenuPosition(null);
  }, []);

  useEffect(() => {
    if (
      !reticulumChannelMenuPosition &&
      !reticulumCategoryMenuPosition &&
      !reticulumChannelAreaMenuPosition
    ) {
      return undefined;
    }
    const closeOnSecondaryClick = (event: MouseEvent) => {
      event.preventDefault();
      closeReticulumChannelContextMenu();
      closeReticulumCategoryContextMenu();
      closeReticulumChannelAreaContextMenu();
    };
    document.addEventListener('contextmenu', closeOnSecondaryClick, true);
    return () => {
      document.removeEventListener('contextmenu', closeOnSecondaryClick, true);
    };
  }, [
    closeReticulumCategoryContextMenu,
    closeReticulumChannelAreaContextMenu,
    closeReticulumChannelContextMenu,
    reticulumCategoryMenuPosition,
    reticulumChannelAreaMenuPosition,
    reticulumChannelMenuPosition,
  ]);

  const reticulumChannelDndSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 140, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const reticulumChannelDragItems = useMemo(
    () =>
      reticulumChannelsForSelectedGroup.map((channel) =>
        reticulumChannelDragId(channel.channelId)
      ),
    [reticulumChannelsForSelectedGroup]
  );

  const reticulumCategoryDragItems = useMemo(
    () =>
      reticulumCategoriesForSelectedGroup.map((category) =>
        reticulumCategoryDragId(category.categoryId)
      ),
    [reticulumCategoriesForSelectedGroup]
  );

  const persistReticulumChannelOrder = useCallback(
    async (channels: ReticulumGroupChannel[], categoryId: string) => {
      const normalizedCategoryId = categoryId || '';
      for (let index = 0; index < channels.length; index += 1) {
        const channel = channels[index];
        if (
          channel.position === index &&
          (channel.categoryId || '') === normalizedCategoryId
        ) {
          continue;
        }
        await publishReticulumChannelMetadata(
          'channel_reorder',
          {
            channelId: channel.channelId,
            categoryId: normalizedCategoryId,
            position: index,
          },
          { refresh: false }
        );
      }
    },
    [publishReticulumChannelMetadata]
  );

  const handleReticulumChannelDragEnd = useCallback(
    async (event: DragEndEvent) => {
      if (!isReticulumChannelAdmin || !event.over) return;
      const activeChannelId = parseReticulumChannelDragId(event.active.id);
      if (!activeChannelId) return;
      const activeChannel = reticulumChannelsForSelectedGroup.find(
        (channel) => channel.channelId === activeChannelId
      );
      if (!activeChannel) return;
      const dropPosition = reticulumDragInsertionPosition(event);

      const categoryIds = new Set(
        reticulumCategoriesForSelectedGroup.map(
          (category) => category.categoryId
        )
      );
      const sourceCategoryId =
        activeChannel.categoryId && categoryIds.has(activeChannel.categoryId)
          ? activeChannel.categoryId
          : '';
      const overChannelId = parseReticulumChannelDragId(event.over.id);
      const overChannel = overChannelId
        ? reticulumChannelsForSelectedGroup.find(
            (channel) => channel.channelId === overChannelId
          )
        : null;
      const targetCategoryId = overChannel
        ? overChannel.categoryId && categoryIds.has(overChannel.categoryId)
          ? overChannel.categoryId
          : ''
        : parseReticulumCategoryDropId(event.over.id);
      if (targetCategoryId && !categoryIds.has(targetCategoryId)) return;

      const sourceChannels = [
        ...(reticulumChannelsByCategory.get(sourceCategoryId) ?? []),
      ];
      const targetChannels = [
        ...(reticulumChannelsByCategory.get(targetCategoryId) ?? []),
      ];
      const sourceIndex = sourceChannels.findIndex(
        (channel) => channel.channelId === activeChannelId
      );
      if (sourceIndex < 0) return;

      if (sourceCategoryId === targetCategoryId) {
        const targetIndex = overChannel
          ? targetChannels.findIndex(
              (channel) => channel.channelId === overChannel.channelId
            )
          : targetChannels.length - 1;
        if (targetIndex < 0 || sourceIndex === targetIndex) return;
        await persistReticulumChannelOrder(
          moveReticulumItemByInsertion(
            sourceChannels,
            sourceIndex,
            targetIndex,
            dropPosition
          ),
          sourceCategoryId
        );
      } else {
        const [movedChannel] = sourceChannels.splice(sourceIndex, 1);
        const targetIndex = overChannel
          ? targetChannels.findIndex(
              (channel) => channel.channelId === overChannel.channelId
            ) + (dropPosition === 'after' ? 1 : 0)
          : targetChannels.length;
        targetChannels.splice(Math.max(0, targetIndex), 0, movedChannel);
        await persistReticulumChannelOrder(sourceChannels, sourceCategoryId);
        await persistReticulumChannelOrder(targetChannels, targetCategoryId);
      }
      await refreshReticulumChannels();
    },
    [
      isReticulumChannelAdmin,
      persistReticulumChannelOrder,
      refreshReticulumChannels,
      reticulumCategoriesForSelectedGroup,
      reticulumChannelsForSelectedGroup,
      reticulumChannelsByCategory,
    ]
  );

  const persistReticulumCategoryOrder = useCallback(
    async (categories: ReticulumGroupCategory[]) => {
      for (let index = 0; index < categories.length; index += 1) {
        const category = categories[index];
        if (category.position === index) continue;
        await publishReticulumChannelMetadata(
          'category_update',
          {
            categoryId: category.categoryId,
            name: category.name,
            position: index,
          },
          { refresh: false }
        );
      }
    },
    [publishReticulumChannelMetadata]
  );

  const handleReticulumCategoryDragEnd = useCallback(
    async (event: DragEndEvent) => {
      if (!isReticulumChannelAdmin || !event.over) return;
      const activeCategoryId = parseReticulumCategoryDragId(event.active.id);
      const overChannelId = parseReticulumChannelDragId(event.over.id);
      const overChannel = overChannelId
        ? reticulumChannelsForSelectedGroup.find(
            (channel) => channel.channelId === overChannelId
          )
        : null;
      const overCategoryId =
        parseReticulumCategoryDragId(event.over.id) ||
        parseReticulumCategoryDropId(event.over.id) ||
        overChannel?.categoryId ||
        '';
      if (!activeCategoryId || !overCategoryId) return;
      const sourceIndex = reticulumCategoriesForSelectedGroup.findIndex(
        (category) => category.categoryId === activeCategoryId
      );
      const targetIndex = reticulumCategoriesForSelectedGroup.findIndex(
        (category) => category.categoryId === overCategoryId
      );
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return;
      }
      await persistReticulumCategoryOrder(
        moveReticulumItemByInsertion(
          reticulumCategoriesForSelectedGroup,
          sourceIndex,
          targetIndex,
          reticulumDragInsertionPosition(event)
        )
      );
      await refreshReticulumChannels();
    },
    [
      isReticulumChannelAdmin,
      persistReticulumCategoryOrder,
      refreshReticulumChannels,
      reticulumCategoriesForSelectedGroup,
      reticulumChannelsForSelectedGroup,
    ]
  );

  const updateReticulumDragTarget = useCallback(
    (nextTarget: ReticulumDragTarget | null) => {
      const currentTarget = reticulumDragTargetRef.current;
      if (
        currentTarget?.activeId === nextTarget?.activeId &&
        currentTarget?.overId === nextTarget?.overId &&
        currentTarget?.position === nextTarget?.position
      ) {
        return;
      }
      reticulumDragTargetRef.current = nextTarget;
      setReticulumDragTarget(nextTarget);
    },
    []
  );

  const openReticulumChannelDeleteConfirmation = useCallback(
    (channel: ReticulumGroupChannel) => {
      if (
        isReticulumSystemChannelId(channel.channelId) ||
        isDeletingReticulumChannel
      ) {
        return;
      }

      setEditingReticulumChannel(channel);
      setReticulumChannelName(channel.name || channel.channelId);
      setReticulumChannelAccessMode(
        reticulumChannelAccessFromModes(channel.writeMode, channel.readMode)
      );
      setReticulumChannelError('');
      setReticulumDeleteConfirmationName('');
      setReticulumDeleteConfirmationError('');
      setIsDeletingReticulumChannel(false);
      setReticulumChannelSettingsView('confirm-delete');
      setReticulumChannelSettingsOpen(true);
    },
    [isDeletingReticulumChannel]
  );

  const handleReticulumDragOver = useCallback(
    (event: DragOverEvent) => {
      if (!event.over) {
        updateReticulumDragTarget(null);
        return;
      }
      const activeId = String(event.active.id);
      if (
        !parseReticulumChannelDragId(activeId) &&
        !parseReticulumCategoryDragId(activeId)
      ) {
        updateReticulumDragTarget(null);
        return;
      }
      updateReticulumDragTarget({
        activeId,
        overId: String(event.over.id),
        position: reticulumDragInsertionPosition(event),
      });
    },
    [updateReticulumDragTarget]
  );

  const archiveReticulumChannel = useCallback(
    async (channel: ReticulumGroupChannel) => {
      if (isReticulumSystemChannelId(channel.channelId)) return;
      await publishReticulumChannelMetadata('channel_archive', {
        channelId: channel.channelId,
      });
      setSelectedReticulumChannelId(DEFAULT_RETICULUM_CHANNEL_ID);
    },
    [publishReticulumChannelMetadata]
  );

  const isReticulumDeleteConfirmationMatched =
    reticulumDeleteConfirmationName.trim().toLowerCase() === 'delete';

  const returnToReticulumChannelSettings = useCallback(() => {
    if (isDeletingReticulumChannel) return;
    setReticulumChannelSettingsView('settings');
    setReticulumDeleteConfirmationName('');
    setReticulumDeleteConfirmationError('');
    requestAnimationFrame(() => {
      reticulumRemoveChannelButtonRef.current?.focus();
    });
  }, [isDeletingReticulumChannel]);

  const openReticulumDeleteConfirmation = useCallback(() => {
    if (!editingReticulumChannel || isDeletingReticulumChannel) return;
    setReticulumDeleteConfirmationName('');
    setReticulumDeleteConfirmationError('');
    setReticulumChannelSettingsView('confirm-delete');
  }, [editingReticulumChannel, isDeletingReticulumChannel]);

  const confirmReticulumChannelDeletion = useCallback(async () => {
    if (
      !editingReticulumChannel ||
      !isReticulumDeleteConfirmationMatched ||
      isDeletingReticulumChannel
    ) {
      return;
    }

    setReticulumDeleteConfirmationError('');
    setIsDeletingReticulumChannel(true);
    try {
      await archiveReticulumChannel(editingReticulumChannel);
      closeReticulumChannelSettings();
    } catch (error) {
      setReticulumDeleteConfirmationError(
        error instanceof Error && error.message
          ? error.message
          : 'Unable to delete channel'
      );
    } finally {
      setIsDeletingReticulumChannel(false);
    }
  }, [
    archiveReticulumChannel,
    closeReticulumChannelSettings,
    editingReticulumChannel,
    isDeletingReticulumChannel,
    isReticulumDeleteConfirmationMatched,
  ]);

  const handleReticulumChannelSettingsDialogClose = useCallback(() => {
    if (isDeletingReticulumChannel) return;
    if (reticulumChannelSettingsView === 'confirm-delete') {
      returnToReticulumChannelSettings();
      return;
    }
    closeReticulumChannelSettings();
  }, [
    closeReticulumChannelSettings,
    isDeletingReticulumChannel,
    reticulumChannelSettingsView,
    returnToReticulumChannelSettings,
  ]);

  useEffect(() => {
    if (
      !reticulumChannelSettingsOpen ||
      reticulumChannelSettingsView !== 'confirm-delete'
    ) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      reticulumDeleteConfirmationInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [reticulumChannelSettingsOpen, reticulumChannelSettingsView]);

  const renderReticulumChannelButton = (channel: ReticulumGroupChannel) => {
    const selected = channel.channelId === selectedReticulumChannelId;
    const channelSummary = reticulumChannelSummariesById.get(channel.channelId);
    const unreadCount = Math.max(0, Number(channelSummary?.unreadCount) || 0);
    const replyCount = Math.max(0, Number(channelSummary?.replyCount) || 0);
    const mentionCount = Math.max(0, Number(channelSummary?.mentionCount) || 0);
    const hasUnreadMention =
      channelSummary?.hasUnreadMention === true || mentionCount > 0;
    return (
      <ReticulumSortableChannelButton
        key={channel.channelId}
        channel={channel}
        dropPosition={
          parseReticulumChannelDragId(reticulumDragTarget?.activeId) &&
          reticulumDragTarget?.overId ===
            reticulumChannelDragId(channel.channelId)
            ? reticulumDragTarget.position
            : undefined
        }
        hasUnreadMention={hasUnreadMention}
        isAdmin={isReticulumChannelAdmin}
        mentionCount={mentionCount}
        onContextMenu={openReticulumChannelContextMenu}
        onSelect={(channelId) => {
          if (channelId === selectedReticulumChannelId) return;
          setSelectedReticulumChannelId(channelId);
          setMessages([]);
          setChatReferences({});
          appliedReticulumEventIdsRef.current.clear();
        }}
        selected={selected}
        textScale={reticulumChatTextScale}
        unreadCount={unreadCount}
        replyCount={replyCount}
      />
    );
  };

  const selectedReticulumChannelName =
    selectedReticulumChannel?.name || selectedReticulumChannelId;
  const selectedReticulumCategoryId = reticulumCategoriesForSelectedGroup.some(
    (category) => category.categoryId === selectedReticulumChannel?.categoryId
  )
    ? selectedReticulumChannel?.categoryId || ''
    : '';
  const handleReticulumChannelSidebarResizeStart = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = reticulumChannelSidebarWidth;
      reticulumChannelSidebarResizeCleanupRef.current?.();

      const onPointerMove = (moveEvent: PointerEvent) => {
        const nextWidth = Math.min(
          264,
          Math.max(220, startWidth + moveEvent.clientX - startX)
        );
        setReticulumChannelSidebarWidth(nextWidth);
      };
      const cleanup = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', cleanup);
        window.removeEventListener('pointercancel', cleanup);
        reticulumChannelSidebarResizeCleanupRef.current = null;
      };

      reticulumChannelSidebarResizeCleanupRef.current = cleanup;
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', cleanup, { once: true });
      window.addEventListener('pointercancel', cleanup, { once: true });
    },
    [reticulumChannelSidebarWidth]
  );

  useEffect(
    () => () => reticulumChannelSidebarResizeCleanupRef.current?.(),
    []
  );
  const newReticulumChannelNormalizedName = normalizeReticulumDisplayName(
    newReticulumChannelName
  );
  const isNewReticulumChannelNameValid = Boolean(
    newReticulumChannelNormalizedName
  );
  const isEditingReticulumSystemChannel = Boolean(
    editingReticulumChannel &&
    isReticulumSystemChannelId(editingReticulumChannel.channelId)
  );
  const handleReticulumChannelTypeKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
    currentIndex: number,
    target: 'create' | 'settings' = 'create'
  ) => {
    const selectAccessMode =
      target === 'settings'
        ? setReticulumChannelAccessMode
        : setNewReticulumChannelAccessMode;
    const elementIdPrefix =
      target === 'settings'
        ? 'reticulum-channel-settings-type'
        : 'reticulum-channel-type';
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      selectAccessMode(reticulumChannelTypeOptions[currentIndex].value);
      return;
    }
    if (
      event.key !== 'ArrowLeft' &&
      event.key !== 'ArrowRight' &&
      event.key !== 'ArrowUp' &&
      event.key !== 'ArrowDown'
    ) {
      return;
    }
    event.preventDefault();
    const direction =
      event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const nextIndex =
      (currentIndex + direction + reticulumChannelTypeOptions.length) %
      reticulumChannelTypeOptions.length;
    selectAccessMode(reticulumChannelTypeOptions[nextIndex].value);
    requestAnimationFrame(() => {
      document.getElementById(`${elementIdPrefix}-${nextIndex}`)?.focus();
    });
  };
  const reticulumHeaderActionSx = (active?: boolean, showLabel?: boolean) =>
    ({
      alignItems: 'center',
      borderRadius: '8px',
      backgroundColor: active ? RETICULUM_ACTIVE_BLUE : 'transparent',
      color: active ? theme.palette.common.white : theme.palette.text.secondary,
      display: 'inline-flex',
      flexShrink: 0,
      fontFamily: 'Inter',
      fontSize: 12,
      fontWeight: 600,
      gap: showLabel ? 0.6 : 0,
      height: 36,
      justifyContent: 'center',
      minWidth: showLabel ? 0 : 36,
      overflow: 'hidden',
      px: showLabel ? 1 : 0,
      textAlign: 'center',
      transition: 'background-color 140ms ease, color 140ms ease',
      width: showLabel ? 'auto' : 36,
      '&:hover': {
        backgroundColor: active
          ? RETICULUM_ACTIVE_BLUE
          : theme.palette.action.hover,
        color: active ? theme.palette.common.white : theme.palette.text.primary,
      },
    }) as const;
  const renderReticulumHeaderAction = ({
    active = false,
    label,
    icon,
    onClick,
    disabled = false,
    showLabel = false,
    tooltip = '',
  }: {
    active?: boolean;
    label: string;
    icon: ReactNode;
    onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
    disabled?: boolean;
    showLabel?: boolean;
    tooltip?: string;
  }) => {
    if (typeof onClick !== 'function') return null;
    const button = (
      <span style={{ display: 'inline-flex' }}>
        <ButtonBase
          disabled={disabled}
          onClick={onClick}
          sx={{
            ...reticulumHeaderActionSx(active, showLabel),
            opacity: disabled ? 0.45 : 1,
          }}
        >
          {icon}
          {showLabel && (
            <Box
              component="span"
              sx={{
                fontSize: 12,
                fontWeight: 600,
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
              }}
            >
              {label}
            </Box>
          )}
        </ButtonBase>
      </span>
    );
    return (
      <Tooltip key={label} title={tooltip || label}>
        {button}
      </Tooltip>
    );
  };

  const reticulumHistoryChannelKey = `${selectedGroup || ''}:${
    selectedReticulumChannelId || DEFAULT_RETICULUM_CHANNEL_ID
  }:${reticulumVisibilityChange?.revision || 0}:${reticulumHistoryWindowRevision}`;
  const reticulumHistoryDisplayReady =
    !reticulumChatEnabled ||
    (reticulumInitialHistoryReady &&
      reticulumProcessedHistoryKey === reticulumHistoryChannelKey);
  const hasMountedReticulumChatListRef = useRef(false);
  if (!reticulumChatEnabled) {
    hasMountedReticulumChatListRef.current = false;
  } else if (reticulumHistoryDisplayReady) {
    hasMountedReticulumChatListRef.current = true;
  }

  return (
    <div
      className={
        reticulumChatEnabled
          ? `reticulum-chat-text-scale--${reticulumChatTextScale}`
          : undefined
      }
      style={{
        display: 'flex',
        flex: hide ? undefined : 1,
        flexDirection: 'column',
        height: hide ? undefined : '100%',
        left: hide && '-100000px',
        minHeight: hide ? undefined : 0,
        opacity: hide ? 0 : 1,
        padding: reticulumChatEnabled ? 0 : '10px',
        position: hide ? 'absolute' : 'relative',
        width: '100%',
      }}
    >
      {reticulumChatEnabled && (
        <GlobalStyles
          styles={{
            '.MuiTooltip-tooltip': {
              backgroundColor: `color-mix(in srgb, ${theme.palette.background.surface} 70%, #000) !important`,
              border: `1px solid ${alpha(theme.palette.divider, 0.86)} !important`,
              borderRadius: '6px',
              boxShadow: '0 8px 18px rgba(0, 0, 0, 0.28)',
              color: theme.palette.text.primary,
              fontSize: 12,
              fontWeight: 600,
              padding: '6px 8px',
            },
            '.MuiTooltip-arrow': {
              color: `color-mix(in srgb, ${theme.palette.background.surface} 70%, #000) !important`,
            },
          }}
        />
      )}
      <Box
        sx={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          width: '100%',
        }}
      >
        {reticulumChatEnabled && (
          <Box
            onContextMenu={openReticulumChannelAreaContextMenu}
            sx={{
              backgroundColor: theme.palette.background.surface,
              borderRight: `1px solid ${theme.palette.divider}`,
              flexShrink: 0,
              height: '100%',
              left: { xs: reticulumChannelSidebarOpen ? 0 : '-240px', md: 0 },
              overflowY: 'auto',
              p: 0,
              position: { xs: 'absolute', md: 'relative' },
              scrollbarWidth: 'none',
              top: 0,
              transition: { xs: 'left 0.18s ease', md: 'none' },
              width: { xs: 224, md: reticulumChannelSidebarWidth },
              minWidth: { xs: 224, md: 220 },
              maxWidth: { xs: 224, md: 264 },
              zIndex: { xs: 9, md: 'auto' },
              '&::-webkit-scrollbar': {
                display: 'none',
              },
            }}
          >
            <Box
              aria-label="Resize channel list"
              onPointerDown={handleReticulumChannelSidebarResizeStart}
              role="separator"
              sx={{
                bottom: 0,
                cursor: 'col-resize',
                display: { xs: 'none', md: 'block' },
                position: 'absolute',
                right: -4,
                top: 0,
                touchAction: 'none',
                width: 8,
                zIndex: 12,
                '&::after': {
                  backgroundColor: 'primary.main',
                  bottom: 0,
                  content: '""',
                  left: 3,
                  opacity: 0,
                  position: 'absolute',
                  top: 0,
                  transition: 'opacity 120ms ease',
                  width: 1,
                },
                '&:hover::after': { opacity: 0.45 },
              }}
            />
            <Box
              sx={{
                alignItems: 'center',
                borderBottom: `1px solid ${alpha(theme.palette.divider, 0.72)}`,
                display: 'flex',
                gap: 1,
                justifyContent: 'space-between',
                minHeight: 50,
                px: '10px',
                py: 0,
              }}
            >
              <ContextMenu
                getUserSettings={() => Promise.resolve()}
                groupId={selectedGroup}
                myAddress={myAddress}
                openOnClick
                reticulumGroup={{
                  groupId: selectedGroup,
                  groupName: selectedGroupName,
                  isOwner: isGroupOwner,
                }}
                onChangeAvatar={
                  isGroupOwner
                    ? () => setIsGroupAvatarDialogOpen(true)
                    : undefined
                }
                onCreateCategory={
                  isReticulumChannelAdmin
                    ? openCreateReticulumCategoryDialog
                    : undefined
                }
                onCreateChannel={
                  isReticulumChannelAdmin
                    ? () => openCreateReticulumChannelDialog()
                    : undefined
                }
                onOpenHiddenUsers={() => {
                  setReticulumHiddenUsersError('');
                  setIsReticulumHiddenUsersDialogOpen(true);
                }}
                showGroupInfo={false}
                showStandardActions={false}
              >
                <Tooltip
                  disableFocusListener={!isGroupNameTruncated}
                  disableHoverListener={!isGroupNameTruncated}
                  disableTouchListener={!isGroupNameTruncated}
                  title={selectedGroupName || 'Group'}
                >
                  <Box
                    sx={{
                      alignItems: 'center',
                      color: 'text.primary',
                      cursor: 'pointer',
                      display: 'flex',
                      gap: 0.5,
                      minWidth: 0,
                      px: 0.25,
                    }}
                  >
                    {isPrivate && (
                      <Tooltip title="Private Encrypted Group">
                        <LockRoundedIcon
                          sx={{
                            color: 'text.secondary',
                            flexShrink: 0,
                            fontSize: 15,
                            transition: 'color 140ms ease',
                            '&:hover': { color: 'text.primary' },
                          }}
                        />
                      </Tooltip>
                    )}
                    {reticulumChatEnabled && isPrivate === false && (
                      <Tooltip title="Open Group">
                        <PublicRoundedIcon
                          sx={{
                            color: 'text.secondary',
                            flexShrink: 0,
                            fontSize: 15,
                            transition: 'color 140ms ease',
                            '&:hover': { color: 'text.primary' },
                          }}
                        />
                      </Tooltip>
                    )}
                    <Typography
                      ref={groupNameLabelRef}
                      sx={{
                        color: 'inherit',
                        flex: 1,
                        fontFamily: 'Inter, sans-serif',
                        fontSize: 15,
                        fontWeight: 650,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        WebkitFontSmoothing: 'antialiased',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {selectedGroupName || 'Group'}
                    </Typography>
                    <ExpandMoreRoundedIcon
                      sx={{
                        color: 'text.secondary',
                        flexShrink: 0,
                        fontSize: 17,
                      }}
                    />
                  </Box>
                </Tooltip>
              </ContextMenu>
            </Box>
            {isReticulumChannelMetadataVisible && (
              <DndContext
                collisionDetection={closestCenter}
                onDragCancel={() => updateReticulumDragTarget(null)}
                onDragEnd={(event) => {
                  updateReticulumDragTarget(null);
                  if (parseReticulumCategoryDragId(event.active.id)) {
                    void handleReticulumCategoryDragEnd(event);
                    return;
                  }
                  void handleReticulumChannelDragEnd(event);
                }}
                onDragOver={handleReticulumDragOver}
                sensors={reticulumChannelDndSensors}
              >
                <SortableContext
                  items={reticulumChannelDragItems}
                  strategy={verticalListSortingStrategy}
                >
                  <Box sx={{ px: '8px' }}>
                    {!reticulumDefaultCategoryIsHidden && (
                      <Box
                        aria-expanded={!collapsedReticulumCategoryIds.has('')}
                        aria-label={`${reticulumDefaultCategoryName} category`}
                        onClick={() => toggleReticulumCategoryCollapsed('')}
                        onContextMenu={(event) =>
                          openReticulumCategoryContextMenu(
                            event,
                            reticulumDefaultCategoryUi
                          )
                        }
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ')
                            return;
                          event.preventDefault();
                          toggleReticulumCategoryCollapsed('');
                        }}
                        role="button"
                        tabIndex={0}
                        sx={{
                          alignItems: 'center',
                          backgroundColor:
                            theme.palette.mode === 'dark'
                              ? '#242831'
                              : theme.palette.grey[200],
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: '7px',
                          boxShadow:
                            theme.palette.mode === 'dark'
                              ? 'inset 0 1px 0 rgba(255, 255, 255, 0.025), 0 2px 5px rgba(0, 0, 0, 0.20)'
                              : '0 1px 3px rgba(35, 42, 54, 0.1)',
                          color: 'text.secondary',
                          cursor: 'pointer',
                          display: 'flex',
                          fontFamily: 'Inter, sans-serif',
                          fontSize: 10,
                          fontWeight: 600,
                          justifyContent: 'space-between',
                          letterSpacing: '0.08em',
                          minHeight: 32,
                          overflow: 'hidden',
                          px: '12px',
                          position: 'relative',
                          textTransform: 'uppercase',
                          width: '100%',
                          '&:hover': {
                            backgroundColor:
                              theme.palette.mode === 'dark'
                                ? '#292E38'
                                : theme.palette.grey[300],
                            borderColor: 'divider',
                          },
                          '&:hover .reticulum-category-create-channel, &:focus-within .reticulum-category-create-channel':
                            {
                              opacity: 1,
                              pointerEvents: 'auto',
                            },
                          '&:focus-visible': {
                            outline: '2px solid rgba(37, 99, 235, 0.72)',
                            outlineOffset: 2,
                          },
                        }}
                      >
                        <Box
                          sx={{
                            alignItems: 'center',
                            display: 'inline-flex',
                            gap: '6px',
                          }}
                        >
                          <Box component="span">
                            {reticulumDefaultCategoryName}
                          </Box>
                          {collapsedReticulumCategoryIds.has('') ? (
                            <ChevronRightRoundedIcon sx={{ fontSize: 14 }} />
                          ) : (
                            <ExpandMoreRoundedIcon sx={{ fontSize: 14 }} />
                          )}
                        </Box>
                        {isReticulumChannelAdmin && (
                          <Tooltip title="Create Channel">
                            <IconButton
                              className="reticulum-category-create-channel"
                              size="small"
                              onClick={(event) => {
                                event.stopPropagation();
                                openCreateReticulumChannelDialog();
                              }}
                              onPointerDown={(event) => event.stopPropagation()}
                              sx={{
                                color: 'text.secondary',
                                cursor: 'pointer',
                                mr: -0.5,
                                opacity: 0,
                                p: 0.25,
                                pointerEvents: 'none',
                                transition:
                                  'opacity 120ms ease, color 120ms ease',
                                '&:hover': { color: 'text.primary' },
                              }}
                            >
                              <AddIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>
                    )}
                    <ReticulumCategoryDropZone
                      disabled={!isReticulumChannelAdmin}
                      dropPosition={
                        parseReticulumChannelDragId(
                          reticulumDragTarget?.activeId
                        ) &&
                        reticulumDragTarget?.overId ===
                          reticulumCategoryDropId('')
                          ? reticulumDragTarget.position
                          : undefined
                      }
                      id={reticulumCategoryDropId('')}
                    >
                      {(reticulumDefaultCategoryIsHidden ||
                        !collapsedReticulumCategoryIds.has('')) && (
                        <Box
                          sx={{
                            pb: 0,
                            pt: reticulumDefaultCategoryIsHidden
                              ? '2px'
                              : '7px',
                            px: '8px',
                          }}
                        >
                          {reticulumDefaultCategoryChannels.map(
                            renderReticulumChannelButton
                          )}
                        </Box>
                      )}
                    </ReticulumCategoryDropZone>
                    <SortableContext
                      items={reticulumCategoryDragItems}
                      strategy={verticalListSortingStrategy}
                    >
                      {reticulumCategoriesForSelectedGroup.map((category) => {
                        const channels =
                          reticulumChannelsByCategory.get(
                            category.categoryId
                          ) ?? [];
                        return (
                          <ReticulumSortableCategory
                            category={category}
                            channelDropPosition={
                              parseReticulumChannelDragId(
                                reticulumDragTarget?.activeId
                              ) &&
                              reticulumDragTarget?.overId ===
                                reticulumCategoryDropId(category.categoryId)
                                ? reticulumDragTarget.position
                                : undefined
                            }
                            dropPosition={
                              parseReticulumCategoryDragId(
                                reticulumDragTarget?.activeId
                              ) &&
                              (reticulumDragTarget?.overId ===
                                reticulumCategoryDragId(category.categoryId) ||
                                reticulumDragTarget?.overId ===
                                  reticulumCategoryDropId(category.categoryId))
                                ? reticulumDragTarget.position
                                : undefined
                            }
                            isAdmin={isReticulumChannelAdmin}
                            isCollapsed={collapsedReticulumCategoryIds.has(
                              category.categoryId
                            )}
                            key={category.categoryId}
                            onContextMenu={openReticulumCategoryContextMenu}
                            onCreateChannel={openCreateReticulumChannelDialog}
                            onToggleCollapsed={toggleReticulumCategoryCollapsed}
                          >
                            {channels.map(renderReticulumChannelButton)}
                          </ReticulumSortableCategory>
                        );
                      })}
                    </SortableContext>
                  </Box>
                </SortableContext>
              </DndContext>
            )}
            <CustomStyledMenu
              reticulumMenu
              disableAutoFocus
              disableAutoFocusItem
              disableEnforceFocus
              disableRestoreFocus
              open={Boolean(reticulumChannelAreaMenuPosition)}
              onClose={closeReticulumChannelAreaContextMenu}
              anchorReference="anchorPosition"
              anchorPosition={
                reticulumChannelAreaMenuPosition
                  ? {
                      left: reticulumChannelAreaMenuPosition.mouseX,
                      top: reticulumChannelAreaMenuPosition.mouseY,
                    }
                  : undefined
              }
              slotProps={{
                paper: { sx: { minWidth: '180px !important' } },
              }}
            >
              <MenuItem
                onClick={() => {
                  closeReticulumChannelAreaContextMenu();
                  openCreateReticulumChannelDialog();
                }}
              >
                <ListItemIcon sx={{ minWidth: '32px' }}>
                  <ForumRoundedIcon fontSize="small" />
                </ListItemIcon>
                <Typography variant="inherit" sx={{ fontSize: '14px' }}>
                  Create Channel
                </Typography>
              </MenuItem>
              <MenuItem
                onClick={() => {
                  closeReticulumChannelAreaContextMenu();
                  openCreateReticulumCategoryDialog();
                }}
              >
                <ListItemIcon sx={{ minWidth: '32px' }}>
                  <FolderRoundedIcon fontSize="small" />
                </ListItemIcon>
                <Typography variant="inherit" sx={{ fontSize: '14px' }}>
                  Create Category
                </Typography>
              </MenuItem>
            </CustomStyledMenu>
            <CustomStyledMenu
              reticulumMenu
              disableAutoFocus
              disableAutoFocusItem
              disableEnforceFocus
              disableRestoreFocus
              open={Boolean(reticulumCategoryMenuPosition)}
              onClose={closeReticulumCategoryContextMenu}
              anchorReference="anchorPosition"
              anchorPosition={
                reticulumCategoryMenuPosition
                  ? {
                      left: reticulumCategoryMenuPosition.mouseX,
                      top: reticulumCategoryMenuPosition.mouseY,
                    }
                  : undefined
              }
              slotProps={{
                paper: {
                  sx: {
                    minWidth: '180px !important',
                  },
                },
              }}
            >
              <MenuItem
                onClick={() => {
                  if (reticulumCategoryMenuCategory) {
                    openRenameReticulumCategoryDialog(
                      reticulumCategoryMenuCategory
                    );
                  }
                  closeReticulumCategoryContextMenu();
                }}
              >
                <ListItemIcon sx={{ minWidth: '32px' }}>
                  <SettingsOutlinedIcon fontSize="small" />
                </ListItemIcon>
                <Typography variant="inherit" sx={{ fontSize: '14px' }}>
                  Category Settings
                </Typography>
              </MenuItem>
              <Divider sx={{ borderColor: 'divider', my: 0.5 }} />
              <Tooltip
                arrow
                placement="right"
                title={
                  reticulumCategoryMenuCategory?.categoryId ===
                    DEFAULT_RETICULUM_CATEGORY_METADATA_ID &&
                  reticulumDefaultCategoryHasProtectedChannels
                    ? 'Default Channels inside Category'
                    : ''
                }
              >
                <Box component="span" sx={{ display: 'block' }}>
                  <MenuItem
                    disabled={
                      reticulumCategoryMenuCategory?.categoryId ===
                        DEFAULT_RETICULUM_CATEGORY_METADATA_ID &&
                      reticulumDefaultCategoryHasProtectedChannels
                    }
                    onClick={() => {
                      if (reticulumCategoryMenuCategory) {
                        openReticulumCategoryDeleteConfirmation(
                          reticulumCategoryMenuCategory
                        );
                      }
                      closeReticulumCategoryContextMenu();
                    }}
                    sx={{ color: 'error.main' }}
                  >
                    <ListItemIcon sx={{ color: 'inherit', minWidth: '32px' }}>
                      <DeleteOutlineRoundedIcon fontSize="small" />
                    </ListItemIcon>
                    <Typography variant="inherit" sx={{ fontSize: '14px' }}>
                      Remove Category
                    </Typography>
                  </MenuItem>
                </Box>
              </Tooltip>
            </CustomStyledMenu>
            <CustomStyledMenu
              reticulumMenu
              disableAutoFocus
              disableAutoFocusItem
              disableEnforceFocus
              disableRestoreFocus
              open={Boolean(reticulumChannelMenuPosition)}
              onClose={closeReticulumChannelContextMenu}
              anchorReference="anchorPosition"
              anchorPosition={
                reticulumChannelMenuPosition
                  ? {
                      left: reticulumChannelMenuPosition.mouseX,
                      top: reticulumChannelMenuPosition.mouseY,
                    }
                  : undefined
              }
              slotProps={{
                paper: {
                  sx: {
                    minWidth: '180px !important',
                  },
                },
              }}
            >
              <MenuItem
                onClick={() => {
                  if (reticulumChannelMenuChannel) {
                    openReticulumChannelSettings(reticulumChannelMenuChannel);
                  }
                  closeReticulumChannelContextMenu();
                }}
              >
                <ListItemIcon sx={{ minWidth: '32px' }}>
                  <SettingsOutlinedIcon fontSize="small" />
                </ListItemIcon>
                <Typography variant="inherit" sx={{ fontSize: '14px' }}>
                  Channel Settings
                </Typography>
              </MenuItem>
              {reticulumChannelMenuChannel &&
                !isReticulumSystemChannelId(
                  reticulumChannelMenuChannel.channelId
                ) && (
                  <>
                    <Divider
                      sx={{ borderColor: 'rgba(255, 255, 255, 0.08)', my: 0.5 }}
                    />
                    <MenuItem
                      onClick={() => {
                        openReticulumChannelDeleteConfirmation(
                          reticulumChannelMenuChannel
                        );
                        closeReticulumChannelContextMenu();
                      }}
                      sx={{ color: 'error.main' }}
                    >
                      <ListItemIcon sx={{ color: 'inherit', minWidth: '32px' }}>
                        <DeleteOutlineRoundedIcon fontSize="small" />
                      </ListItemIcon>
                      <Typography variant="inherit" sx={{ fontSize: '14px' }}>
                        Remove Channel
                      </Typography>
                    </MenuItem>
                  </>
                )}
            </CustomStyledMenu>
          </Box>
        )}

        {reticulumChatEnabled && reticulumChannelSidebarOpen && (
          <Box
            onClick={() => setReticulumChannelSidebarOpen(false)}
            sx={{
              backgroundColor: alpha(theme.palette.common.black, 0.38),
              bottom: 0,
              display: { xs: 'block', md: 'none' },
              left: 0,
              position: 'absolute',
              right: 0,
              top: 0,
              zIndex: 8,
            }}
          />
        )}

        <Box
          sx={{
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            minHeight: 0,
            minWidth: 0,
          }}
        >
          {reticulumChatEnabled && (
            <Box
              sx={{
                alignItems: 'center',
                borderBottom: `1px solid ${theme.palette.divider}`,
                display: 'flex',
                flexWrap: 'nowrap',
                flexShrink: 0,
                gap: 0.75,
                minHeight: 50,
                overflow: 'hidden',
                px: 1.5,
              }}
            >
              <Tooltip title="Channels">
                <IconButton
                  onClick={() =>
                    setReticulumChannelSidebarOpen((open) => !open)
                  }
                  size="small"
                  sx={{
                    color: 'text.secondary',
                    display: { xs: 'inline-flex', md: 'none' },
                    flexShrink: 0,
                  }}
                >
                  <TagRoundedIcon sx={{ fontSize: 20 }} />
                </IconButton>
              </Tooltip>
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  flex: 1,
                  gap: 0.75,
                  fontSize: 17,
                  fontWeight: 700,
                  minWidth: 0,
                  overflow: 'hidden',
                }}
              >
                <Box
                  component="span"
                  sx={{
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {selectedReticulumChannelName}
                </Box>
                {selectedReticulumChannel?.description && (
                  <Box
                    component="span"
                    sx={{
                      color: theme.palette.text.secondary,
                      display: { xs: 'none', lg: 'inline' },
                      fontSize: 13,
                      fontWeight: 400,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {selectedReticulumChannel.description}
                  </Box>
                )}
              </Box>
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  flexShrink: 0,
                  gap: 0.25,
                  minWidth: 0,
                  ml: 'auto',
                  overflowX: 'auto',
                }}
              >
                {typeof onQortalLandClick === 'function' && (
                  <ReticulumModePill
                    label="Qortal Land"
                    onClick={onQortalLandClick}
                  />
                )}
                <Box
                  aria-hidden
                  sx={{
                    backgroundColor: theme.palette.divider,
                    flexShrink: 0,
                    height: 22,
                    mx: 0.5,
                    width: '1px',
                  }}
                />
                {renderReticulumHeaderAction({
                  label: groupCallJoining
                    ? 'Joining'
                    : groupCallInCall
                      ? 'Leave Call'
                      : 'Group Call',
                  icon: groupCallJoining ? (
                    <CircularProgress size={17} sx={{ color: 'inherit' }} />
                  ) : groupCallInCall ? (
                    <CallEndRoundedIcon sx={{ fontSize: 19 }} />
                  ) : (
                    <CallIcon sx={{ fontSize: 19 }} />
                  ),
                  onClick: onGroupCallClick,
                  disabled: groupCallDisabled || groupCallJoining,
                  tooltip: groupCallTooltip || 'Group Call',
                })}
                {renderReticulumHeaderAction({
                  active: reticulumCalendarOpen,
                  label: t('calendar.title', 'Group Calendar'),
                  icon: <CalendarMonthRoundedIcon sx={{ fontSize: 19 }} />,
                  onClick: () => {
                    setActiveReticulumCalendarTarget(null);
                    setReticulumCalendarOpen((current) => !current);
                  },
                })}
                {legacyThreadsEnabled && (
                  <>
                    {renderReticulumHeaderAction({
                      label: 'Threads',
                      icon: <ForumRoundedIcon sx={{ fontSize: 19 }} />,
                      onClick: onThreadsClick,
                    })}
                    {renderReticulumHeaderAction({
                      active: Boolean(reticulumAdminAnchorEl),
                      label: 'Admins',
                      icon: <SecurityRoundedIcon sx={{ fontSize: 19 }} />,
                      onClick: toggleReticulumAdminPopover,
                    })}
                  </>
                )}
                {renderReticulumHeaderAction({
                  active: isOpenQManager === true,
                  label: 'Q-Manager',
                  icon: <FolderRoundedIcon sx={{ fontSize: 19 }} />,
                  onClick: toggleQManager,
                })}
                <Tooltip title={membersPanelOpen ? 'Hide Members' : 'Members'}>
                  <Box
                    component="span"
                    sx={{
                      display: 'inline-flex',
                      flexShrink: 0,
                      overflow: 'visible',
                      position: 'relative',
                    }}
                  >
                    <IconButton
                      aria-label={
                        membersNotificationCount > 0
                          ? `Members, ${membersNotificationCount} pending join ${
                              membersNotificationCount === 1
                                ? 'request'
                                : 'requests'
                            }`
                          : 'Members'
                      }
                      onClick={onMembersClick}
                      size="small"
                      sx={{
                        backgroundColor: membersPanelOpen
                          ? RETICULUM_ACTIVE_BLUE
                          : 'transparent',
                        borderRadius: '8px',
                        color: membersPanelOpen
                          ? 'common.white'
                          : 'text.secondary',
                        flexShrink: 0,
                        height: 36,
                        width: 36,
                        '&:hover': {
                          backgroundColor: membersPanelOpen
                            ? RETICULUM_ACTIVE_BLUE
                            : theme.palette.action.hover,
                          color: membersPanelOpen
                            ? 'common.white'
                            : theme.palette.text.primary,
                        },
                      }}
                    >
                      <PeopleAltRoundedIcon sx={{ fontSize: 19 }} />
                    </IconButton>
                    {membersNotificationCount > 0 && (
                      <ReticulumUnreadCountBadge
                        count={membersNotificationCount}
                        outlineColor={theme.palette.background.surface}
                        size={13}
                        fontSize={8}
                        sx={{
                          position: 'absolute',
                          right: -4,
                          top: -4,
                          zIndex: 2,
                        }}
                      />
                    )}
                  </Box>
                </Tooltip>
                {renderReticulumHeaderAction({
                  active: reticulumSearchOpen,
                  label: 'Search Chat',
                  icon: <SearchRoundedIcon sx={{ fontSize: 18 }} />,
                  onClick: () => setReticulumSearchOpen((open) => !open),
                })}
              </Box>
            </Box>
          )}
          <Box
            onDragEnter={handleReticulumAttachmentDragEnter}
            onDragLeave={handleReticulumAttachmentDragLeave}
            onDragOver={handleReticulumAttachmentDragOver}
            onDrop={handleReticulumAttachmentDrop}
            sx={{
              display: 'flex',
              flex: 1,
              flexDirection: 'column',
              mr: reticulumChatEnabled && membersPanelOpen ? '280px' : 0,
              minHeight: 0,
              minWidth: 0,
              position: 'relative',
              transition: 'margin-right 160ms ease',
            }}
          >
            {reticulumChatEnabled &&
              !hasMountedReticulumChatListRef.current && (
                <Box
                  aria-hidden="true"
                  sx={{ flex: 1, minHeight: 0, width: '100%' }}
                />
              )}
            {!shouldSuppressLegacyGroupChat &&
              (!reticulumChatEnabled ||
                hasMountedReticulumChatListRef.current) && (
                <ChatList
                  key={
                    reticulumChatEnabled
                      ? 'reticulum-group-chat'
                      : 'legacy-group-chat'
                  }
                  chatId={
                    reticulumChatEnabled
                      ? `${selectedGroup}:${selectedReticulumChannelId}`
                      : selectedGroup
                  }
                  chatReferences={renderedChatReferences}
                  enableMentions
                  handleReaction={handleReaction}
                  hasSecretKey={!!secretKey}
                  initialMessages={renderedMessages}
                  isPrivate={isPrivate}
                  members={members}
                  reticulumGroupAvatarOwnerName={reticulumGroupOwnerName}
                  reticulumGroupDisplayName={selectedGroupName}
                  reticulumMentionUsers={reticulumMentionUsers}
                  reticulumChannelLinkAccess={reticulumChannelLinkAccess}
                  reticulumMemberJoinedByAddress={
                    reticulumMemberJoinedByAddress
                  }
                  reticulumMemberRolesByAddress={reticulumMemberRolesByAddress}
                  reticulumMemberRolesReady={
                    reticulumMemberRolesReadyForSelectedGroup
                  }
                  reticulumUnreadCount={
                    reticulumChatEnabled
                      ? Math.max(
                          0,
                          Number(
                            reticulumChannelSummariesById.get(
                              selectedReticulumChannelId
                            )?.unreadCount
                          ) || 0
                        )
                      : 0
                  }
                  onReticulumUnreadAcknowledged={
                    reticulumChatEnabled
                      ? acknowledgeReticulumUnreadMessages
                      : undefined
                  }
                  reticulumViewActive={isActive}
                  reticulumReadEntryToken={reticulumReadEntryToken}
                  reticulumDiscussionReplyCounts={
                    reticulumChatEnabled
                      ? reticulumDiscussionIndex.replyCounts
                      : undefined
                  }
                  onOpenReticulumDiscussion={
                    reticulumChatEnabled ? openReticulumDiscussion : undefined
                  }
                  myAddress={myAddress}
                  myName={myName}
                  hasOlderMessages={
                    reticulumChatEnabled ? reticulumHasOlderMessages : undefined
                  }
                  hasNewerMessages={
                    reticulumChatEnabled ? reticulumHasNewerMessages : undefined
                  }
                  isLoadingOlderMessages={
                    reticulumChatEnabled
                      ? reticulumLoadingOlderMessages
                      : undefined
                  }
                  isLoadingNewerMessages={
                    reticulumChatEnabled
                      ? reticulumLoadingNewerMessages
                      : undefined
                  }
                  onLoadOlder={
                    reticulumChatEnabled
                      ? loadOlderReticulumMessages
                      : undefined
                  }
                  onLoadNewer={
                    reticulumChatEnabled
                      ? loadNewerReticulumMessages
                      : undefined
                  }
                  onJumpToLatest={
                    reticulumChatEnabled
                      ? jumpToLatestReticulumMessages
                      : undefined
                  }
                  onDelete={onDelete}
                  onEdit={onEdit}
                  onReply={onReply}
                  openQManager={openQManager}
                  reticulumChatEnabled={reticulumChatEnabled}
                  reticulumInitialHistoryReady={reticulumHistoryDisplayReady}
                  reticulumNavigationPending={Boolean(
                    pendingReticulumSearchNavigation
                  )}
                  selectedGroup={selectedGroup}
                  secretKeyObject={secretKey}
                  tempChatReferences={tempChatReferences}
                  tempMessages={tempMessages}
                  scrollToMessageId={reticulumSearchScrollTarget?.messageId}
                  scrollToMessageNonce={reticulumSearchScrollTarget?.nonce}
                />
              )}

            {reticulumChatEnabled && (
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  flexShrink: 0,
                  fontSize: '12px',
                  height: '24px',
                  lineHeight: '20px',
                  overflow: 'hidden',
                  px: 2.25,
                  pt: '2px',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {reticulumTypingText}
              </Typography>
            )}

            {!shouldSuppressLegacyGroupChat &&
              (reticulumChatEnabled || !!secretKey || isPrivate === false) && (
                <Box
                  sx={{
                    alignItems: 'flex-end',
                    backgroundColor: reticulumChatEnabled
                      ? alpha(theme.palette.background.paper, 0.72)
                      : theme.palette.background.default,
                    border: `1px solid ${theme.palette.divider}`,
                    borderRadius: reticulumChatEnabled ? 0 : '8px',
                    borderLeft: reticulumChatEnabled ? 'none' : undefined,
                    borderRight: reticulumChatEnabled ? 'none' : undefined,
                    borderBottom: reticulumChatEnabled ? 'none' : undefined,
                    bottom: isFocusedParent ? '0px' : 'unset',
                    boxSizing: 'border-box',
                    display: 'flex',
                    flexDirection: 'row',
                    flexShrink: 0,
                    gap: reticulumChatEnabled ? '8px' : '12px',
                    minHeight: reticulumChatEnabled ? '58px' : '150px',
                    overflow: reticulumChatEnabled ? 'visible' : 'hidden',
                    padding: reticulumChatEnabled
                      ? '8px 12px'
                      : '16px 20px 20px',
                    position: isFocusedParent ? 'fixed' : 'relative',
                    top: isFocusedParent ? '0px' : 'unset',
                    width: '100%',
                    zIndex: isFocusedParent ? 5 : 'unset',
                  }}
                >
                  {reticulumChatEnabled && (
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
                      justifyContent: reticulumChatEnabled
                        ? 'center'
                        : 'flex-end',
                      minWidth: 0,
                      overflow: reticulumChatEnabled ? 'visible' : 'auto',
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

                      {isCompressingReticulumGif && (
                        <ReticulumGifCompressionStatus />
                      )}

                      {pendingReticulumFiles.map((file, index) => (
                        <Box
                          key={`${file.fileName}-${index}`}
                          sx={{
                            alignItems: 'center',
                            border: '1px solid',
                            borderColor: theme.palette.divider,
                            borderRadius: '8px',
                            display: 'flex',
                            gap: '8px',
                            maxWidth: 260,
                            minHeight: '50px',
                            p: '6px 8px',
                            position: 'relative',
                          }}
                        >
                          {file.isImage && file.previewUrl ? (
                            <Box
                              component="img"
                              src={file.previewUrl}
                              sx={{
                                borderRadius: '4px',
                                flexShrink: 0,
                                height: 38,
                                objectFit: 'cover',
                                width: 38,
                              }}
                            />
                          ) : (
                            <InsertDriveFileRoundedIcon
                              sx={{
                                color: theme.palette.text.secondary,
                                flexShrink: 0,
                              }}
                            />
                          )}
                          <Box sx={{ minWidth: 0 }}>
                            <Typography
                              sx={{
                                fontSize: '12px',
                                fontWeight: 600,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {file.fileName}
                            </Typography>
                            <Typography
                              sx={{
                                color: theme.palette.text.secondary,
                                fontSize: '11px',
                              }}
                            >
                              {file.mimeType || 'application/octet-stream'}
                            </Typography>
                          </Box>
                          <Tooltip title="Remove file">
                            <IconButton
                              onClick={() => {
                                setPendingReticulumFiles((prev) => {
                                  const removed = prev[index];
                                  if (removed?.previewUrl) {
                                    URL.revokeObjectURL(removed.previewUrl);
                                  }
                                  if (removed?.temporaryFilePath) {
                                    void window.reticulumResources?.releaseConvertedMedia?.(
                                      removed.temporaryFilePath
                                    );
                                  }
                                  return prev.filter((_, i) => i !== index);
                                });
                              }}
                              size="small"
                              sx={{
                                ml: 'auto',
                                flexShrink: 0,
                              }}
                            >
                              <CloseIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      ))}
                    </Box>

                    {replyMessage && (
                      <Box
                        sx={{
                          alignItems: 'center',
                          backgroundColor: alpha(theme.palette.text.primary, 0.07),
                          border: `1px solid ${theme.palette.divider}`,
                          borderBottom: 0,
                          borderRadius: '8px 8px 0 0',
                          boxSizing: 'border-box',
                          display: 'flex',
                          gap: '5px',
                          minHeight: '34px',
                          px: 1.25,
                          py: 0.5,
                          width: '100%',
                        }}
                      >
                        <Typography
                          sx={{
                            color: theme.palette.text.secondary,
                            fontSize: '12px',
                            lineHeight: 1.3,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Replying to{' '}
                          <Box
                            component="span"
                            sx={{ color: 'text.primary', fontWeight: 700 }}
                          >
                            {replyMessage?.senderName ||
                              replyMessage?.sender ||
                              'Unknown'}
                          </Box>
                        </Typography>

                        <IconButton
                          aria-label="Cancel reply"
                          onClick={() => setReplyMessage(null)}
                          size="small"
                          sx={{ color: 'text.secondary', ml: 'auto' }}
                        >
                          <CloseIcon sx={{ fontSize: 17 }} />
                        </IconButton>
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
                          reticulumOnlyContent={reticulumChatEnabled}
                        />

                        <ButtonBase
                          onClick={() => {
                            setReplyMessage(null);
                            setOnEditMessage(null);
                            setIsDeleteImage(false);
                            setChatImagesToSave([]);
                            clearPendingReticulumFiles();
                            clearEditorContent();
                          }}
                        >
                          <ExitIcon />
                        </ButtonBase>
                      </Box>
                    )}

                    <Tiptap
                      enableMentions
                      mentionSuggestions={
                        reticulumChatEnabled
                          ? reticulumMentionSuggestions
                          : undefined
                      }
                      setEditorRef={setEditorRef}
                      onEnter={sendMessage}
                      onKeyDown={handleComposerKeyDown}
                      onContentUpdate={(editor) => {
                        noteReticulumComposerActivity(
                          Boolean(editor.getText().trim())
                        );
                      }}
                      isChat
                      readOnly={!canWriteSelectedReticulumChannel}
                      disableEnter={!canWriteSelectedReticulumChannel}
                      isFocusedParent={isFocusedParent}
                      setIsFocusedParent={setIsFocusedParent}
                      membersWithNames={members}
                      insertImage={insertImage}
                      insertFiles={insertFiles}
                      compactChat={reticulumChatEnabled}
                      collapseFormattingTraySignal={formattingTrayResetKey}
                      placeholder={
                        reticulumChatEnabled
                          ? canWriteSelectedReticulumChannel
                            ? 'Message channel...'
                            : 'Only group admins can write in this channel'
                          : undefined
                      }
                    />
                    {messageSize >= 3200 && (
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
                      flexShrink: 0,
                      gap: '8px',
                      minHeight: reticulumChatEnabled ? '44px' : undefined,
                      paddingBottom: reticulumChatEnabled ? 0 : '2px',
                    }}
                  >
                    {reticulumChatEnabled && (
                      <>
                        <Tooltip title="Choose Emoji">
                          <Box
                            sx={{
                              alignItems: 'center',
                              display: 'inline-flex',
                              justifyContent: 'center',
                            }}
                          >
                            <ReactionPicker
                              compactComposer
                              neutralIcon
                              onReaction={(emoji: string) => {
                                editorRef.current
                                  ?.chain()
                                  .focus()
                                  .insertContent(emoji)
                                  .run();
                              }}
                            />
                          </Box>
                        </Tooltip>
                      </>
                    )}
                    <Box
                      sx={
                        reticulumChatEnabled
                          ? {
                              alignItems: 'stretch',
                              border: `1px solid ${theme.palette.divider}`,
                              borderRadius: '10px',
                              display: 'inline-flex',
                              flexShrink: 0,
                              height: '38px',
                              overflow: 'hidden',
                            }
                          : { display: 'contents' }
                      }
                    >
                      {reticulumChatEnabled && (
                        <ReticulumMessageExpiryButton
                          channelExpiryDurationMs={
                            selectedReticulumChannelExpiryDurationMs
                          }
                          disabled={
                            Boolean(onEditMessage) ||
                            !canWriteSelectedReticulumChannel
                          }
                          disabledReason={
                            onEditMessage
                              ? 'Expiry cannot be changed while editing'
                              : 'You cannot write in this channel'
                          }
                          onChange={setReticulumMessageExpiryDurationMs}
                          segmented
                          value={reticulumMessageExpiryDurationMs}
                        />
                      )}
                      <CustomButton
                        onClick={() => {
                          if (
                            isSending ||
                            isCompressingReticulumGif ||
                            isCompressingReticulumImage ||
                            !canWriteSelectedReticulumChannel
                          )
                            return;
                          sendMessage();
                        }}
                        sx={{
                          alignItems: 'center',
                          backgroundColor:
                            isSending ||
                            isCompressingReticulumGif ||
                            isCompressingReticulumImage ||
                            !canWriteSelectedReticulumChannel
                              ? theme.palette.action.disabledBackground
                              : reticulumChatEnabled
                                ? RETICULUM_ACTIVE_BLUE
                                : theme.palette.background.paper,
                          border: reticulumChatEnabled ? 'none' : '1px solid',
                          borderColor: reticulumChatEnabled
                            ? 'transparent'
                            : theme.palette.divider,
                          borderRadius: reticulumChatEnabled ? 0 : '8px',
                          color: reticulumChatEnabled
                            ? theme.palette.common.white
                            : theme.palette.text.primary,
                          cursor:
                            isSending ||
                            isCompressingReticulumGif ||
                            isCompressingReticulumImage ||
                            !canWriteSelectedReticulumChannel
                              ? 'default'
                              : 'pointer',
                          display: 'inline-flex',
                          gap: '6px',
                          fontSize: '14px',
                          fontWeight: 500,
                          justifyContent: 'center',
                          height: reticulumChatEnabled ? '38px' : undefined,
                          minHeight: reticulumChatEnabled ? '38px' : '44px',
                          minWidth: reticulumChatEnabled ? '74px' : '88px',
                          padding: reticulumChatEnabled
                            ? '8px 14px'
                            : '10px 16px',
                          position: 'relative',
                          transition:
                            'background-color 0.2s ease, border-color 0.2s ease',
                          '&:hover':
                            isSending ||
                            isCompressingReticulumGif ||
                            isCompressingReticulumImage ||
                            !canWriteSelectedReticulumChannel
                              ? {}
                              : {
                                  backgroundColor: reticulumChatEnabled
                                    ? '#1e40af'
                                    : theme.palette.action.hover,
                                  borderColor: reticulumChatEnabled
                                    ? '#1e40af'
                                    : theme.palette.divider,
                                },
                          '& .MuiSvgIcon-root': {
                            color: reticulumChatEnabled
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
                              color: reticulumChatEnabled
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
              )}

            {reticulumChatEnabled && isReticulumAttachmentDragActive && (
              <Box
                aria-hidden
                sx={{
                  alignItems: 'center',
                  backgroundColor: alpha(theme.palette.primary.main, 0.2),
                  border: `2px solid ${alpha(theme.palette.primary.light, 0.72)}`,
                  bottom: 0,
                  display: 'flex',
                  justifyContent: 'center',
                  left: 0,
                  pointerEvents: 'none',
                  position: 'absolute',
                  right: 0,
                  top: 0,
                  zIndex: 20,
                }}
              >
                <Typography
                  sx={{
                    backgroundColor: alpha(
                      theme.palette.background.paper,
                      0.92
                    ),
                    border: `1px solid ${alpha(theme.palette.primary.light, 0.68)}`,
                    borderRadius: '8px',
                    boxShadow: '0 10px 28px rgba(0, 0, 0, 0.28)',
                    color: theme.palette.text.primary,
                    fontSize: 15,
                    fontWeight: 700,
                    px: 2,
                    py: 1,
                  }}
                >
                  Drop to Attach
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      {reticulumChatEnabled && Number(selectedGroup) > 0 && (
        <ReticulumGroupCalendarDialog
          open={reticulumCalendarOpen}
          groupId={Number(selectedGroup)}
          ownerAddress={myAddress || ''}
          canManage={isReticulumChannelAdmin || isGroupOwner}
          members={groupMentionMembers}
          rolesByAddress={reticulumMemberRolesByAddress}
          targetEventId={activeReticulumCalendarTarget?.eventId || ''}
          targetOccurrenceStart={
            Number(activeReticulumCalendarTarget?.occurrenceStart) || 0
          }
          targetTimezone={activeReticulumCalendarTarget?.timezone || ''}
          onClose={() => {
            setReticulumCalendarOpen(false);
            setActiveReticulumCalendarTarget(null);
          }}
        />
      )}

      {reticulumChatEnabled && reticulumSearchOpen && (
        <Box
          sx={{
            backgroundColor: theme.palette.background.paper,
            borderLeft: `1px solid ${theme.palette.divider}`,
            bottom: 0,
            boxShadow: '-12px 0 24px rgba(0, 0, 0, 0.18)',
            display: 'flex',
            flexDirection: 'column',
            position: 'absolute',
            right: 0,
            top: 50,
            width: { xs: '100%', sm: 390 },
            zIndex: 12,
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              borderBottom: `1px solid ${theme.palette.divider}`,
              display: 'flex',
              gap: 1,
              p: 2,
            }}
          >
            <SearchRoundedIcon sx={{ color: theme.palette.text.secondary }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: 16, fontWeight: 800 }}>
                Search Results
              </Typography>
            </Box>
          </Box>
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1.5,
              p: 2,
            }}
          >
            <TextField
              autoFocus
              fullWidth
              onChange={(event) => setReticulumSearchQuery(event.target.value)}
              placeholder={`Search ${
                reticulumSearchChannelFilter ===
                RETICULUM_SEARCH_CHANNEL_CURRENT
                  ? reticulumSearchChannelFilterLabel
                  : 'messages'
              }`}
              size="small"
              sx={{
                '& .MuiOutlinedInput-root': {
                  backgroundColor: alpha(theme.palette.common.black, 0.24),
                  borderRadius: '4px',
                  fontSize: 14,
                  height: 40,
                  '& fieldset': {
                    borderColor: alpha(theme.palette.common.white, 0.16),
                  },
                  '&:hover fieldset': {
                    borderColor: alpha(theme.palette.primary.main, 0.55),
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: theme.palette.primary.main,
                  },
                },
              }}
              value={reticulumSearchQuery}
            />
            {reticulumSearchActiveFilterCount > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {reticulumSearchChannelFilter !==
                  RETICULUM_SEARCH_CHANNEL_CURRENT && (
                  <Chip
                    label={`in: ${reticulumSearchChannelFilterLabel}`}
                    onDelete={() =>
                      setReticulumSearchChannelFilter(
                        RETICULUM_SEARCH_CHANNEL_CURRENT
                      )
                    }
                    size="small"
                    sx={{
                      backgroundColor: alpha(theme.palette.primary.main, 0.18),
                      borderRadius: '4px',
                      color: theme.palette.primary.light,
                      height: 24,
                    }}
                  />
                )}
                {reticulumSearchAuthorFilter && (
                  <Chip
                    label={`from: ${reticulumSearchAuthorFilterLabel}`}
                    onDelete={() => setReticulumSearchAuthorFilter('')}
                    size="small"
                    sx={{
                      backgroundColor: alpha(theme.palette.primary.main, 0.18),
                      borderRadius: '4px',
                      color: theme.palette.primary.light,
                      height: 24,
                    }}
                  />
                )}
                {reticulumSearchHasFilter !== RETICULUM_SEARCH_HAS_ANY && (
                  <Chip
                    label={`has: ${reticulumSearchHasFilterLabel}`}
                    onDelete={() =>
                      setReticulumSearchHasFilter(RETICULUM_SEARCH_HAS_ANY)
                    }
                    size="small"
                    sx={{
                      backgroundColor: alpha(theme.palette.primary.main, 0.18),
                      borderRadius: '4px',
                      color: theme.palette.primary.light,
                      height: 24,
                    }}
                  />
                )}
                {(reticulumSearchAfterDate || reticulumSearchBeforeDate) && (
                  <Chip
                    label={`date: ${reticulumSearchDateFilterLabel}`}
                    onDelete={() => {
                      setReticulumSearchAfterDate('');
                      setReticulumSearchBeforeDate('');
                    }}
                    size="small"
                    sx={{
                      backgroundColor: alpha(theme.palette.primary.main, 0.18),
                      borderRadius: '4px',
                      color: theme.palette.primary.light,
                      height: 24,
                    }}
                  />
                )}
                {reticulumSearchSort !== 'relevance' && (
                  <Chip
                    label={`sort: ${reticulumSearchSortLabel}`}
                    onDelete={() => setReticulumSearchSort('relevance')}
                    size="small"
                    sx={{
                      backgroundColor: alpha(theme.palette.primary.main, 0.18),
                      borderRadius: '4px',
                      color: theme.palette.primary.light,
                      height: 24,
                    }}
                  />
                )}
              </Box>
            )}
            <Box>
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  justifyContent: 'space-between',
                  mb: 0.75,
                }}
              >
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: 0.4,
                    textTransform: 'uppercase',
                  }}
                >
                  Filter By
                </Typography>
                {reticulumSearchActiveFilterCount > 0 && (
                  <Button
                    onClick={clearReticulumSearchFilters}
                    size="small"
                    sx={{ fontSize: 11, minWidth: 0, p: 0 }}
                    variant="text"
                  >
                    Clear
                  </Button>
                )}
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {[
                  {
                    key: 'from' as const,
                    label: 'from:',
                    value: reticulumSearchAuthorFilter
                      ? reticulumSearchAuthorFilterLabel
                      : '',
                  },
                  {
                    key: 'in' as const,
                    label: 'in:',
                    value:
                      reticulumSearchChannelFilter !==
                      RETICULUM_SEARCH_CHANNEL_CURRENT
                        ? reticulumSearchChannelFilterLabel
                        : '',
                  },
                  {
                    key: 'has' as const,
                    label: 'has:',
                    value:
                      reticulumSearchHasFilter !== RETICULUM_SEARCH_HAS_ANY
                        ? reticulumSearchHasFilterLabel
                        : '',
                  },
                  {
                    key: 'date' as const,
                    label: 'date:',
                    value:
                      reticulumSearchAfterDate || reticulumSearchBeforeDate
                        ? reticulumSearchDateFilterLabel
                        : '',
                  },
                  {
                    key: 'sort' as const,
                    label: 'sort:',
                    value:
                      reticulumSearchSort !== 'relevance'
                        ? reticulumSearchSortLabel
                        : '',
                  },
                ].map((option) => (
                  <ButtonBase
                    key={option.key}
                    onClick={(event) =>
                      openReticulumSearchFilterMenu(option.key, event)
                    }
                    sx={{
                      alignItems: 'center',
                      backgroundColor: alpha(theme.palette.common.black, 0.12),
                      border: `1px solid ${alpha(theme.palette.common.white, 0.12)}`,
                      borderRadius: '4px',
                      display: 'flex',
                      gap: 0.5,
                      justifyContent: 'flex-start',
                      maxWidth: '100%',
                      minHeight: 28,
                      px: 0.75,
                      py: 0.35,
                      textAlign: 'left',
                      '&:hover': {
                        backgroundColor: alpha(
                          theme.palette.primary.main,
                          0.12
                        ),
                        borderColor: alpha(theme.palette.primary.main, 0.45),
                      },
                    }}
                  >
                    <Typography
                      sx={{
                        color: theme.palette.primary.main,
                        fontSize: 12,
                        fontWeight: 800,
                      }}
                    >
                      {option.label}
                    </Typography>
                    <Typography
                      sx={{
                        color: theme.palette.text.primary,
                        display: option.value ? 'block' : 'none',
                        fontSize: 12,
                        maxWidth: 142,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {option.value}
                    </Typography>
                    <ChevronRightRoundedIcon
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: 14,
                      }}
                    />
                  </ButtonBase>
                ))}
              </Box>
            </Box>
          </Box>
          <Menu
            anchorEl={reticulumSearchFilterAnchorEl}
            onClose={closeReticulumSearchFilterMenu}
            open={Boolean(reticulumSearchFilterAnchorEl)}
            PaperProps={{
              sx: {
                maxHeight: 340,
                minWidth: 260,
              },
            }}
          >
            {reticulumSearchFilterMenu === 'from' && (
              <>
                <MenuItem
                  onClick={() => {
                    setReticulumSearchAuthorFilter('');
                    closeReticulumSearchFilterMenu();
                  }}
                >
                  Anyone
                </MenuItem>
                <Divider />
                {reticulumSearchAuthorOptions.map((author) => (
                  <MenuItem
                    key={author.address}
                    onClick={() => {
                      setReticulumSearchAuthorFilter(author.address);
                      closeReticulumSearchFilterMenu();
                    }}
                  >
                    {author.name}
                  </MenuItem>
                ))}
              </>
            )}
            {reticulumSearchFilterMenu === 'in' && (
              <>
                <MenuItem
                  onClick={() => {
                    setReticulumSearchChannelFilter(
                      RETICULUM_SEARCH_CHANNEL_CURRENT
                    );
                    closeReticulumSearchFilterMenu();
                  }}
                >
                  Current channel
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setReticulumSearchChannelFilter(
                      RETICULUM_SEARCH_CHANNEL_ALL
                    );
                    closeReticulumSearchFilterMenu();
                  }}
                >
                  All channels
                </MenuItem>
                <Divider />
                {reticulumChannelsForSelectedGroup.map((channel) => {
                  const option = reticulumChannelTypeOptionByAccess(
                    reticulumChannelAccessFromModes(
                      channel.writeMode,
                      channel.readMode
                    )
                  );
                  const ChannelIcon = option.icon;
                  return (
                    <MenuItem
                      key={channel.channelId}
                      onClick={() => {
                        setReticulumSearchChannelFilter(channel.channelId);
                        closeReticulumSearchFilterMenu();
                      }}
                    >
                      <ChannelIcon
                        aria-hidden
                        sx={{
                          color: 'text.secondary',
                          fontSize: 18,
                          mr: 1,
                        }}
                      />
                      {channel.name || channel.channelId}
                    </MenuItem>
                  );
                })}
              </>
            )}
            {reticulumSearchFilterMenu === 'has' && (
              <>
                {[
                  [RETICULUM_SEARCH_HAS_ANY, 'Anything'],
                  [RETICULUM_SEARCH_HAS_ATTACHMENT, 'Attachment'],
                  [RETICULUM_SEARCH_HAS_LINK, 'Link'],
                ].map(([value, label]) => (
                  <MenuItem
                    key={value}
                    onClick={() => {
                      setReticulumSearchHasFilter(value);
                      closeReticulumSearchFilterMenu();
                    }}
                  >
                    {label}
                  </MenuItem>
                ))}
              </>
            )}
            {reticulumSearchFilterMenu === 'sort' && (
              <>
                {[
                  ['relevance', 'Relevant'],
                  ['newest', 'Newest'],
                  ['oldest', 'Oldest'],
                ].map(([value, label]) => (
                  <MenuItem
                    key={value}
                    onClick={() => {
                      setReticulumSearchSort(
                        value as 'relevance' | 'newest' | 'oldest'
                      );
                      closeReticulumSearchFilterMenu();
                    }}
                  >
                    {label}
                  </MenuItem>
                ))}
              </>
            )}
            {reticulumSearchFilterMenu === 'date' && (
              <Box sx={{ display: 'grid', gap: 1, p: 1.5, width: 280 }}>
                <TextField
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  label="After"
                  onChange={(event) =>
                    setReticulumSearchAfterDate(event.target.value)
                  }
                  size="small"
                  type="date"
                  value={reticulumSearchAfterDate}
                />
                <TextField
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  label="Before"
                  onChange={(event) =>
                    setReticulumSearchBeforeDate(event.target.value)
                  }
                  size="small"
                  type="date"
                  value={reticulumSearchBeforeDate}
                />
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Button
                    onClick={() => {
                      setReticulumSearchAfterDate('');
                      setReticulumSearchBeforeDate('');
                    }}
                    size="small"
                  >
                    Clear dates
                  </Button>
                  <Button
                    onClick={closeReticulumSearchFilterMenu}
                    size="small"
                    variant="contained"
                  >
                    Done
                  </Button>
                </Box>
              </Box>
            )}
          </Menu>
          <Box
            sx={{
              borderTop: `1px solid ${theme.palette.divider}`,
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              p: 1,
            }}
          >
            {isReticulumSearchLoading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                <CircularProgress size={22} />
              </Box>
            )}
            {!isReticulumSearchLoading && reticulumSearchError && (
              <Typography
                sx={{
                  color: theme.palette.error.main,
                  fontSize: 13,
                  px: 1,
                  py: 2,
                }}
              >
                {reticulumSearchError}
              </Typography>
            )}
            {!isReticulumSearchLoading &&
              !reticulumSearchError &&
              (reticulumSearchQuery.trim().length >= 2 ||
                reticulumSearchActiveFilterCount > 0) &&
              reticulumSearchResults.length === 0 && (
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    fontSize: 13,
                    px: 1,
                    py: 2,
                  }}
                >
                  No results
                </Typography>
              )}
            {!isReticulumSearchLoading &&
              !reticulumSearchError &&
              reticulumSearchQuery.trim().length < 2 &&
              reticulumSearchActiveFilterCount === 0 && (
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    fontSize: 13,
                    px: 1,
                    py: 2,
                  }}
                >
                  Type at least 2 characters or choose a filter.
                </Typography>
              )}
            {reticulumSearchResults.map((result) => {
              const event = result.event;
              const channelId =
                normalizeReticulumChannelName(event.channelId || '') ||
                DEFAULT_RETICULUM_CHANNEL_ID;
              const channelName =
                reticulumVisibleChannelNameById.get(channelId) || channelId;
              const searchResultChannel =
                reticulumChannelsForSelectedGroup.find(
                  (channel) => channel.channelId === channelId
                );
              const searchResultChannelOption =
                reticulumChannelTypeOptionByAccess(
                  reticulumChannelAccessFromModes(
                    searchResultChannel?.writeMode,
                    searchResultChannel?.readMode
                  )
                );
              const SearchResultChannelIcon = searchResultChannelOption.icon;
              const authorName = reticulumSearchAuthorName(event);
              const timestamp = Number(event.timestamp || 0);
              const attachmentNames = reticulumAttachmentNamesFromPayload(
                event.encryptedPayload
              );
              return (
                <ButtonBase
                  key={event.eventId}
                  onClick={() => void handleReticulumSearchResultClick(result)}
                  sx={{
                    alignItems: 'stretch',
                    backgroundColor: alpha(theme.palette.action.hover, 0.35),
                    border: `1px solid ${theme.palette.divider}`,
                    borderRadius: '8px',
                    display: 'flex',
                    mb: 1,
                    p: 1.25,
                    textAlign: 'left',
                    width: '100%',
                    transition:
                      'background-color 0.15s ease, border-color 0.15s ease',
                    '&:hover': {
                      backgroundColor: theme.palette.action.hover,
                      borderColor: alpha(theme.palette.primary.main, 0.45),
                    },
                  }}
                >
                  <Box sx={{ minWidth: 0, width: '100%' }}>
                    <Box
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        gap: 0.75,
                        minWidth: 0,
                      }}
                    >
                      <SearchResultChannelIcon
                        aria-hidden
                        sx={{
                          flexShrink: 0,
                          fontSize: 16,
                        }}
                      />
                      <Typography
                        sx={{
                          color: theme.palette.primary.main,
                          fontSize: 12,
                          fontWeight: 700,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {channelName}
                      </Typography>
                      <Typography
                        sx={{
                          color: theme.palette.text.secondary,
                          fontSize: 11,
                          ml: 'auto',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {timestamp
                          ? new Date(timestamp).toLocaleString([], {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })
                          : ''}
                      </Typography>
                    </Box>
                    <Typography
                      sx={{
                        color: theme.palette.text.primary,
                        fontSize: 12,
                        fontWeight: 700,
                        mt: 0.5,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {authorName}
                    </Typography>
                    <Typography
                      component="div"
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: 12,
                        lineHeight: 1.45,
                        mt: 0.5,
                        maxHeight: 52,
                        overflow: 'hidden',
                        wordBreak: 'break-word',
                      }}
                    >
                      {renderReticulumSearchSnippet(result.snippet)}
                    </Typography>
                    {attachmentNames.length > 0 && (
                      <Box
                        sx={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 0.5,
                          mt: 0.75,
                        }}
                      >
                        {attachmentNames.slice(0, 3).map((fileName) => (
                          <Box
                            key={fileName}
                            sx={{
                              alignItems: 'center',
                              backgroundColor: alpha(
                                theme.palette.common.black,
                                0.18
                              ),
                              border: `1px solid ${alpha(theme.palette.common.white, 0.1)}`,
                              borderRadius: '6px',
                              color: theme.palette.text.primary,
                              display: 'flex',
                              gap: 0.75,
                              maxWidth: '100%',
                              px: 0.75,
                              py: 0.5,
                            }}
                          >
                            <InsertDriveFileRoundedIcon
                              sx={{
                                color: theme.palette.text.secondary,
                                flexShrink: 0,
                                fontSize: 16,
                              }}
                            />
                            <Typography
                              sx={{
                                fontSize: 12,
                                minWidth: 0,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {fileName}
                            </Typography>
                          </Box>
                        ))}
                      </Box>
                    )}
                  </Box>
                </ButtonBase>
              );
            })}
          </Box>
          {(reticulumSearchPage > 0 || reticulumSearchHasNextPage) && (
            <Box
              sx={{
                alignItems: 'center',
                backgroundColor: theme.palette.background.paper,
                borderTop: `1px solid ${theme.palette.divider}`,
                display: 'flex',
                flexShrink: 0,
                gap: 0.5,
                justifyContent: 'center',
                minHeight: 52,
                px: 1.5,
              }}
            >
              <ButtonBase
                disabled={reticulumSearchPage === 0 || isReticulumSearchLoading}
                onClick={() => {
                  setReticulumSearchHasNextPage(false);
                  setReticulumSearchPage((page) => Math.max(0, page - 1));
                }}
                sx={{
                  alignItems: 'center',
                  borderRadius: '4px',
                  color:
                    reticulumSearchPage === 0 || isReticulumSearchLoading
                      ? theme.palette.text.disabled
                      : theme.palette.text.secondary,
                  display: 'inline-flex',
                  fontSize: 13,
                  fontWeight: 700,
                  gap: 0.25,
                  minHeight: 32,
                  px: 0.75,
                  '&:hover': {
                    backgroundColor:
                      reticulumSearchPage === 0 || isReticulumSearchLoading
                        ? 'transparent'
                        : theme.palette.action.hover,
                  },
                }}
              >
                <ChevronRightRoundedIcon
                  sx={{ fontSize: 17, transform: 'rotate(180deg)' }}
                />
                Back
              </ButtonBase>
              {reticulumSearchVisiblePageNumbers.map((pageNumber, index) => (
                <Box
                  key={pageNumber}
                  sx={{ alignItems: 'center', display: 'inline-flex' }}
                >
                  {index > 0 &&
                    pageNumber >
                      reticulumSearchVisiblePageNumbers[index - 1] + 1 && (
                      <Typography
                        sx={{
                          color: theme.palette.text.secondary,
                          fontSize: 13,
                          fontWeight: 700,
                          px: 0.5,
                        }}
                      >
                        ...
                      </Typography>
                    )}
                  <ButtonBase
                    disabled={
                      isReticulumSearchLoading ||
                      pageNumber === reticulumSearchPage
                    }
                    onClick={() => {
                      if (pageNumber !== reticulumSearchPage) {
                        setReticulumSearchHasNextPage(false);
                        setReticulumSearchPage(pageNumber);
                      }
                    }}
                    sx={{
                      alignItems: 'center',
                      backgroundColor:
                        pageNumber === reticulumSearchPage
                          ? theme.palette.primary.main
                          : 'transparent',
                      borderRadius: '50%',
                      color:
                        pageNumber === reticulumSearchPage
                          ? theme.palette.primary.contrastText
                          : theme.palette.text.primary,
                      display: 'inline-flex',
                      fontSize: 13,
                      fontWeight: 800,
                      height: 30,
                      justifyContent: 'center',
                      width: 30,
                      '&:hover': {
                        backgroundColor:
                          pageNumber === reticulumSearchPage
                            ? theme.palette.primary.main
                            : theme.palette.action.hover,
                      },
                    }}
                  >
                    {pageNumber + 1}
                  </ButtonBase>
                </Box>
              ))}
              {reticulumSearchHasNextPage &&
                reticulumSearchVisiblePageNumbers[
                  reticulumSearchVisiblePageNumbers.length - 1
                ] >
                  reticulumSearchPage + 1 && (
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: 13,
                      fontWeight: 700,
                      px: 0.5,
                    }}
                  >
                    ...
                  </Typography>
                )}
              <ButtonBase
                disabled={
                  !reticulumSearchHasNextPage || isReticulumSearchLoading
                }
                onClick={() => {
                  setReticulumSearchHasNextPage(false);
                  setReticulumSearchPage((page) =>
                    reticulumSearchHasNextPage ? page + 1 : page
                  );
                }}
                sx={{
                  alignItems: 'center',
                  borderRadius: '4px',
                  color:
                    !reticulumSearchHasNextPage || isReticulumSearchLoading
                      ? theme.palette.text.disabled
                      : theme.palette.text.primary,
                  display: 'inline-flex',
                  fontSize: 13,
                  fontWeight: 800,
                  gap: 0.25,
                  minHeight: 32,
                  px: 0.75,
                  '&:hover': {
                    backgroundColor:
                      !reticulumSearchHasNextPage || isReticulumSearchLoading
                        ? 'transparent'
                        : theme.palette.action.hover,
                  },
                }}
              >
                Next
                <ChevronRightRoundedIcon sx={{ fontSize: 17 }} />
              </ButtonBase>
            </Box>
          )}
        </Box>
      )}

      <ReticulumLargeImageDialog
        open={Boolean(reticulumLargeImageChoice)}
        onClose={closeReticulumLargeImageChoice}
        fileSize={formatReticulumFileSize(reticulumLargeImageChoice?.file.size)}
        loading={isCompressingReticulumImage}
        onCompress={useReticulumCompressedImage}
        onUseAsAttachment={useReticulumImageAsAttachment}
      />

      <Dialog
        open={isCreateReticulumChannelOpen}
        onClose={closeCreateReticulumChannelDialog}
        fullWidth
        maxWidth={false}
        PaperProps={{
          sx: {
            ...reticulumDialogPaperSx,
            boxSizing: 'border-box',
            m: 2,
            maxHeight: 'calc(100vh - 32px)',
            maxWidth: 'calc(100vw - 32px)',
            overflow: 'hidden',
            width: 680,
          },
        }}
      >
        <DialogContent
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2.5,
            maxHeight: 'calc(100vh - 96px)',
            overflowY: 'auto',
            px: { xs: 2.5, sm: 4 },
            py: { xs: 2.5, sm: 3.5 },
          }}
        >
          <Box>
            <DialogTitle
              sx={{
                ...reticulumDialogTitleSx,
                fontSize: { xs: 25, sm: 28 },
                lineHeight: 1.15,
                p: 0,
              }}
            >
              Create text channel
            </DialogTitle>
            <Typography
              sx={{
                color: 'text.secondary',
                fontSize: 14,
                lineHeight: '20px',
                mt: 0.75,
              }}
            >
              Choose a name and decide who can view or post in this channel.
            </Typography>
          </Box>

          <Box>
            <Typography
              component="label"
              htmlFor="reticulum-channel-name-input"
              sx={{
                color: 'text.primary',
                display: 'block',
                fontSize: 15,
                fontWeight: 800,
                mb: 1,
              }}
            >
              Channel name
            </Typography>
            <TextField
              autoFocus
              fullWidth
              id="reticulum-channel-name-input"
              placeholder="e.g. support-chat"
              sx={{
                ...reticulumDialogTextFieldSx,
                '& .MuiOutlinedInput-root': {
                  ...reticulumDialogTextFieldSx['& .MuiOutlinedInput-root'],
                  height: 48,
                },
                '& .MuiOutlinedInput-input': {
                  py: 1.5,
                },
              }}
              value={newReticulumChannelName}
              error={Boolean(newReticulumChannelError)}
              FormHelperTextProps={{
                sx: {
                  fontSize: 12.5,
                  lineHeight: '18px',
                  minHeight: 18,
                  ml: 0,
                  mt: 0.75,
                },
              }}
              helperText={
                newReticulumChannelError ||
                'Use letters, numbers, special characters and emojis.'
              }
              InputProps={{
                endAdornment:
                  renderReticulumNameEmojiAdornment('channel-create'),
              }}
              onChange={(event) => {
                setNewReticulumChannelName(event.target.value);
                if (newReticulumChannelError) setNewReticulumChannelError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && isNewReticulumChannelNameValid) {
                  event.preventDefault();
                  void createReticulumChannel();
                }
              }}
            />
          </Box>

          <Box>
            <Typography
              id="reticulum-channel-type-label"
              sx={{
                color: 'text.primary',
                fontSize: 15,
                fontWeight: 800,
                mb: 1,
              }}
            >
              Channel type
            </Typography>
            <Box
              aria-labelledby="reticulum-channel-type-label"
              role="radiogroup"
              sx={{
                backgroundColor:
                  theme.palette.mode === 'dark'
                    ? '#0c0e13'
                    : theme.palette.background.default,
                border: '1px solid',
                borderColor:
                  theme.palette.mode === 'dark'
                    ? 'rgba(0, 0, 0, 0.72)'
                    : alpha(theme.palette.text.primary, 0.42),
                borderRadius: '10px',
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                overflow: 'hidden',
              }}
            >
              {reticulumChannelTypeOptions.map((option, index) => {
                const selected = newReticulumChannelAccessMode === option.value;
                const Icon = option.icon;
                return (
                  <ButtonBase
                    aria-checked={selected}
                    aria-describedby={`reticulum-channel-type-description-${index}`}
                    aria-label={`${option.label}. ${option.description}`}
                    id={`reticulum-channel-type-${index}`}
                    key={option.value}
                    onClick={() =>
                      setNewReticulumChannelAccessMode(option.value)
                    }
                    onKeyDown={(event) =>
                      handleReticulumChannelTypeKeyDown(event, index)
                    }
                    role="radio"
                    sx={{
                      alignItems: 'center',
                      backgroundColor: selected
                        ? alpha(
                            theme.palette.primary.main,
                            theme.palette.mode === 'dark' ? 0.12 : 0.14
                          )
                        : 'background.default',
                      borderColor: selected
                        ? RETICULUM_ACTIVE_BLUE
                        : 'rgba(0, 0, 0, 0.72)',
                      borderLeft:
                        index === 0
                          ? 'none'
                          : `1px solid ${
                              theme.palette.mode === 'dark'
                                ? 'rgba(0, 0, 0, 0.72)'
                                : alpha(theme.palette.text.primary, 0.42)
                            }`,
                      borderRadius:
                        index === 0
                          ? '9px 0 0 9px'
                          : index === reticulumChannelTypeOptions.length - 1
                            ? '0 9px 9px 0'
                            : 0,
                      borderTop: 'none',
                      boxShadow: selected
                        ? `inset 0 0 0 1px ${RETICULUM_ACTIVE_BLUE}`
                        : 'none',
                      color:
                        selected && theme.palette.mode === 'dark'
                          ? 'common.white'
                          : selected
                            ? 'primary.dark'
                            : 'text.primary',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 0.75,
                      justifyContent: 'center',
                      minHeight: { xs: 148, sm: 135 },
                      p: { xs: 1.25, sm: 1.5 },
                      position: 'relative',
                      textAlign: 'center',
                      transition:
                        'background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease',
                      '&:hover': {
                        backgroundColor: selected
                          ? alpha(
                              theme.palette.primary.main,
                              theme.palette.mode === 'dark' ? 0.16 : 0.2
                            )
                          : 'action.hover',
                        borderColor: selected
                          ? RETICULUM_ACTIVE_BLUE
                          : 'text.secondary',
                      },
                      '&.Mui-focusVisible': {
                        outline: `2px solid ${RETICULUM_ACTIVE_BLUE}`,
                        outlineOffset: -4,
                      },
                      zIndex: selected ? 1 : 0,
                    }}
                    tabIndex={selected ? 0 : -1}
                  >
                    {selected && (
                      <CheckCircleRoundedIcon
                        sx={{
                          color: RETICULUM_ACTIVE_BLUE,
                          fontSize: 19,
                          position: 'absolute',
                          right: 9,
                          top: 9,
                        }}
                      />
                    )}
                    <Icon
                      sx={{
                        color: selected ? 'common.white' : 'text.secondary',
                        fontSize: 26,
                        transition: 'color 140ms ease',
                      }}
                    />
                    <Typography
                      sx={{
                        color: selected ? 'common.white' : 'text.primary',
                        fontSize: 15,
                        fontWeight: 800,
                        lineHeight: '18px',
                      }}
                    >
                      {option.label}
                    </Typography>
                    <Typography
                      id={`reticulum-channel-type-description-${index}`}
                      sx={{
                        color: 'text.secondary',
                        fontSize: 13,
                        lineHeight: '18px',
                        maxWidth: 180,
                        whiteSpace: 'pre-line',
                      }}
                    >
                      {option.description}
                    </Typography>
                  </ButtonBase>
                );
              })}
            </Box>
          </Box>

          <ReticulumChannelExpiryField
            id="reticulum-channel-expiry-input"
            onChange={setNewReticulumChannelExpiryDurationMs}
            value={newReticulumChannelExpiryDurationMs}
          />
        </DialogContent>
        <DialogActions
          sx={{
            borderTop: '1px solid',
            borderColor: 'divider',
            gap: 1,
            px: { xs: 2.5, sm: 4 },
            py: 1.5,
          }}
        >
          <Button
            onClick={closeCreateReticulumChannelDialog}
            sx={{ ...reticulumSecondaryButtonSx, minHeight: 40 }}
          >
            Cancel
          </Button>
          <Button
            disabled={
              !isNewReticulumChannelNameValid || isCreatingReticulumChannel
            }
            variant="contained"
            onClick={() => void createReticulumChannel()}
            sx={{
              ...reticulumPrimaryButtonSx,
              minHeight: 40,
              minWidth: 150,
              '&.Mui-disabled': {
                backgroundColor: 'action.disabledBackground',
                color: 'text.disabled',
              },
            }}
          >
            {isCreatingReticulumChannel ? (
              <CircularProgress size={18} sx={{ color: 'common.white' }} />
            ) : (
              'Create channel'
            )}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={reticulumChannelSettingsOpen}
        onClose={handleReticulumChannelSettingsDialogClose}
        fullWidth
        maxWidth={false}
        PaperProps={{
          sx: {
            ...reticulumDialogPaperSx,
            boxSizing: 'border-box',
            m: 2,
            maxHeight: 'calc(100vh - 32px)',
            maxWidth: 'calc(100vw - 32px)',
            overflow: 'hidden',
            transition: 'width 160ms ease',
            width:
              reticulumChannelSettingsView === 'confirm-delete' ? 480 : 680,
          },
        }}
      >
        {reticulumChannelSettingsView === 'confirm-delete' ? (
          <>
            <DialogContent
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2.25,
                px: { xs: 2.5, sm: 3.5 },
                py: { xs: 2.5, sm: 3 },
              }}
            >
              <Box sx={{ alignItems: 'center', display: 'flex', gap: 1 }}>
                <Tooltip title="Back to channel settings">
                  <span>
                    <IconButton
                      aria-label="Back to channel settings"
                      disabled={isDeletingReticulumChannel}
                      onClick={returnToReticulumChannelSettings}
                      size="small"
                      sx={{ color: 'text.secondary', ml: -0.5 }}
                    >
                      <ArrowBackRoundedIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <DeleteOutlineRoundedIcon
                  sx={{ color: 'error.main', fontSize: 26 }}
                />
                <DialogTitle
                  sx={{
                    ...reticulumDialogTitleSx,
                    fontSize: { xs: 24, sm: 26 },
                    lineHeight: 1.15,
                    p: 0,
                  }}
                >
                  Delete channel
                </DialogTitle>
              </Box>

              <Typography
                sx={{
                  color: 'text.secondary',
                  fontSize: 14,
                  lineHeight: '21px',
                }}
              >
                This action cannot be undone. Type delete below to permanently
                remove this channel.
              </Typography>

              <Box>
                <Typography
                  component="label"
                  htmlFor="reticulum-channel-delete-confirmation-input"
                  sx={{
                    color: 'text.primary',
                    display: 'block',
                    fontSize: 15,
                    fontWeight: 800,
                    mb: 1,
                  }}
                >
                  Type delete to confirm
                </Typography>
                <TextField
                  aria-describedby={
                    reticulumDeleteConfirmationError
                      ? 'reticulum-channel-delete-confirmation-error'
                      : undefined
                  }
                  aria-label="Type delete to confirm channel deletion"
                  autoComplete="off"
                  disabled={isDeletingReticulumChannel}
                  fullWidth
                  id="reticulum-channel-delete-confirmation-input"
                  inputRef={reticulumDeleteConfirmationInputRef}
                  onChange={(event) => {
                    setReticulumDeleteConfirmationName(event.target.value);
                    if (reticulumDeleteConfirmationError) {
                      setReticulumDeleteConfirmationError('');
                    }
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      isReticulumDeleteConfirmationMatched
                    ) {
                      event.preventDefault();
                      void confirmReticulumChannelDeletion();
                    }
                  }}
                  placeholder="delete"
                  sx={{
                    ...reticulumDialogTextFieldSx,
                    '& .MuiOutlinedInput-root': {
                      ...reticulumDialogTextFieldSx['& .MuiOutlinedInput-root'],
                      height: 48,
                    },
                    '& .MuiOutlinedInput-input': { py: 1.5 },
                  }}
                  value={reticulumDeleteConfirmationName}
                  InputProps={{
                    endAdornment: isReticulumDeleteConfirmationMatched ? (
                      <InputAdornment position="end">
                        <CheckCircleRoundedIcon
                          aria-label="Channel name confirmed"
                          color="primary"
                          fontSize="small"
                        />
                      </InputAdornment>
                    ) : undefined,
                  }}
                />
                {reticulumDeleteConfirmationError && (
                  <Typography
                    id="reticulum-channel-delete-confirmation-error"
                    role="alert"
                    sx={{
                      color: 'error.main',
                      fontSize: 12.5,
                      lineHeight: '18px',
                      mt: 0.75,
                    }}
                  >
                    {reticulumDeleteConfirmationError}
                  </Typography>
                )}
              </Box>
            </DialogContent>
            <DialogActions
              sx={{
                borderTop: '1px solid',
                borderColor: 'divider',
                gap: 1,
                justifyContent: 'flex-end',
                px: { xs: 2.5, sm: 3.5 },
                py: 1.25,
              }}
            >
              <Button
                disabled={isDeletingReticulumChannel}
                onClick={returnToReticulumChannelSettings}
                sx={{ ...reticulumSecondaryButtonSx, minHeight: 40 }}
              >
                Cancel
              </Button>
              <Button
                aria-disabled={!isReticulumDeleteConfirmationMatched}
                disabled={
                  !isReticulumDeleteConfirmationMatched ||
                  isDeletingReticulumChannel
                }
                onClick={() => void confirmReticulumChannelDeletion()}
                sx={{
                  '&.Mui-disabled': {
                    backgroundColor: 'rgba(220, 38, 38, 0.28)',
                    color: 'rgba(255, 255, 255, 0.48)',
                  },
                  '&:hover': { backgroundColor: '#b91c1c' },
                  backgroundColor: '#dc2626',
                  color: 'common.white',
                  minHeight: 40,
                  minWidth: 142,
                }}
                variant="contained"
              >
                {isDeletingReticulumChannel ? (
                  <CircularProgress size={18} sx={{ color: 'common.white' }} />
                ) : (
                  'Delete channel'
                )}
              </Button>
            </DialogActions>
          </>
        ) : (
          <>
            <DialogContent
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2.5,
                maxHeight: 'calc(100vh - 96px)',
                overflowY: 'auto',
                px: { xs: 2.5, sm: 4 },
                py: { xs: 2.5, sm: 3.5 },
              }}
            >
              <Box>
                <DialogTitle
                  sx={{
                    ...reticulumDialogTitleSx,
                    fontSize: { xs: 25, sm: 28 },
                    lineHeight: 1.15,
                    p: 0,
                  }}
                >
                  Channel settings
                </DialogTitle>
                <Typography
                  sx={{
                    color: 'text.secondary',
                    fontSize: 14,
                    lineHeight: '20px',
                    mt: 0.75,
                  }}
                >
                  Update this channel&apos;s name and permissions.
                </Typography>
              </Box>

              <Box>
                <Typography
                  component="label"
                  htmlFor="reticulum-channel-settings-name-input"
                  sx={{
                    color: 'text.primary',
                    display: 'block',
                    fontSize: 15,
                    fontWeight: 800,
                    mb: 1,
                  }}
                >
                  Channel name
                </Typography>
                <TextField
                  autoFocus
                  fullWidth
                  id="reticulum-channel-settings-name-input"
                  sx={{
                    ...reticulumDialogTextFieldSx,
                    '& .MuiOutlinedInput-root': {
                      ...reticulumDialogTextFieldSx['& .MuiOutlinedInput-root'],
                      height: 48,
                    },
                    '& .MuiOutlinedInput-input': {
                      py: 1.5,
                    },
                  }}
                  value={reticulumChannelName}
                  error={Boolean(reticulumChannelError)}
                  FormHelperTextProps={{
                    sx: {
                      fontSize: 12.5,
                      lineHeight: '18px',
                      minHeight: 18,
                      ml: 0,
                      mt: 0.75,
                    },
                  }}
                  helperText={
                    reticulumChannelError ||
                    'Use letters, numbers, special characters and emojis.'
                  }
                  InputProps={{
                    endAdornment:
                      renderReticulumNameEmojiAdornment('channel-settings'),
                  }}
                  onChange={(event) => {
                    setReticulumChannelName(event.target.value);
                    if (reticulumChannelError) setReticulumChannelError('');
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void saveReticulumChannelSettings();
                    }
                  }}
                />
              </Box>

              <Box>
                <Typography
                  id="reticulum-channel-settings-type-label"
                  sx={{
                    color: 'text.primary',
                    fontSize: 15,
                    fontWeight: 800,
                    mb: 1,
                  }}
                >
                  Channel type
                </Typography>
                <Box
                  aria-labelledby="reticulum-channel-settings-type-label"
                  role="radiogroup"
                  sx={{
                    backgroundColor:
                      theme.palette.mode === 'dark'
                        ? '#0c0e13'
                        : theme.palette.background.default,
                    border: '1px solid',
                    borderColor:
                      theme.palette.mode === 'dark'
                        ? 'rgba(0, 0, 0, 0.72)'
                        : alpha(theme.palette.text.primary, 0.42),
                    borderRadius: '10px',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                    overflow: 'hidden',
                  }}
                >
                  {reticulumChannelTypeOptions.map((option, index) => {
                    const selected =
                      reticulumChannelAccessMode === option.value;
                    const disabled =
                      isEditingReticulumSystemChannel &&
                      option.value !== RETICULUM_CHANNEL_ACCESS_REGULAR;
                    const Icon = option.icon;
                    return (
                      <ButtonBase
                        aria-checked={selected}
                        aria-describedby={`reticulum-channel-settings-type-description-${index}`}
                        aria-label={`${option.label}. ${option.description}`}
                        disabled={disabled}
                        id={`reticulum-channel-settings-type-${index}`}
                        key={option.value}
                        onClick={
                          disabled
                            ? undefined
                            : () => setReticulumChannelAccessMode(option.value)
                        }
                        onKeyDown={
                          isEditingReticulumSystemChannel || disabled
                            ? undefined
                            : (event) =>
                                handleReticulumChannelTypeKeyDown(
                                  event,
                                  index,
                                  'settings'
                                )
                        }
                        role="radio"
                        sx={{
                          alignItems: 'center',
                          backgroundColor: selected
                            ? alpha(
                                theme.palette.primary.main,
                                theme.palette.mode === 'dark' ? 0.12 : 0.14
                              )
                            : disabled
                              ? alpha(theme.palette.text.primary, 0.025)
                              : 'background.default',
                          borderColor: selected
                            ? RETICULUM_ACTIVE_BLUE
                            : 'rgba(0, 0, 0, 0.72)',
                          borderLeft:
                            index === 0
                              ? 'none'
                              : `1px solid ${
                                  theme.palette.mode === 'dark'
                                    ? 'rgba(0, 0, 0, 0.72)'
                                    : alpha(theme.palette.text.primary, 0.42)
                                }`,
                          borderRadius:
                            index === 0
                              ? '9px 0 0 9px'
                              : index === reticulumChannelTypeOptions.length - 1
                                ? '0 9px 9px 0'
                                : 0,
                          borderTop: 'none',
                          boxShadow: selected
                            ? `inset 0 0 0 1px ${RETICULUM_ACTIVE_BLUE}`
                            : 'none',
                          color: disabled
                            ? 'text.disabled'
                            : selected && theme.palette.mode === 'dark'
                              ? 'common.white'
                              : selected
                                ? 'primary.dark'
                                : 'text.primary',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 0.75,
                          justifyContent: 'center',
                          minHeight: { xs: 148, sm: 135 },
                          p: { xs: 1.25, sm: 1.5 },
                          position: 'relative',
                          textAlign: 'center',
                          transition:
                            'background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease',
                          '&:hover': {
                            backgroundColor: selected
                              ? alpha(
                                  theme.palette.primary.main,
                                  theme.palette.mode === 'dark' ? 0.16 : 0.2
                                )
                              : 'action.hover',
                            borderColor: selected
                              ? RETICULUM_ACTIVE_BLUE
                              : 'text.secondary',
                          },
                          '&.Mui-disabled': {
                            opacity: 1,
                          },
                          '&.Mui-focusVisible': {
                            outline: `2px solid ${RETICULUM_ACTIVE_BLUE}`,
                            outlineOffset: -4,
                          },
                          zIndex: selected ? 1 : 0,
                        }}
                        tabIndex={disabled ? -1 : selected ? 0 : -1}
                      >
                        {selected && (
                          <CheckCircleRoundedIcon
                            sx={{
                              color: RETICULUM_ACTIVE_BLUE,
                              fontSize: 19,
                              position: 'absolute',
                              right: 9,
                              top: 9,
                            }}
                          />
                        )}
                        <Icon
                          sx={{
                            color: disabled
                              ? 'text.disabled'
                              : selected && theme.palette.mode === 'dark'
                                ? 'common.white'
                                : selected
                                  ? 'primary.dark'
                                  : 'text.secondary',
                            fontSize: 26,
                            transition: 'color 140ms ease',
                          }}
                        />
                        <Typography
                          sx={{
                            color: disabled
                              ? 'text.disabled'
                              : selected && theme.palette.mode === 'dark'
                                ? 'common.white'
                                : selected
                                  ? 'primary.dark'
                                  : 'text.primary',
                            fontSize: 15,
                            fontWeight: 800,
                            lineHeight: '18px',
                          }}
                        >
                          {option.label}
                        </Typography>
                        <Typography
                          id={`reticulum-channel-settings-type-description-${index}`}
                          sx={{
                            color: disabled
                              ? 'text.disabled'
                              : 'text.secondary',
                            fontSize: 13,
                            lineHeight: '18px',
                            maxWidth: 180,
                            whiteSpace: 'pre-line',
                          }}
                        >
                          {option.description}
                        </Typography>
                      </ButtonBase>
                    );
                  })}
                </Box>
              </Box>

              {editingReticulumChannel &&
                !isReticulumSystemChannelId(
                  editingReticulumChannel.channelId
                ) && (
                  <ReticulumChannelExpiryField
                    id="reticulum-channel-settings-expiry-input"
                    onChange={setReticulumChannelExpiryDurationMs}
                    value={reticulumChannelExpiryDurationMs}
                  />
                )}
            </DialogContent>
            <DialogActions
              sx={{
                borderTop: '1px solid',
                borderColor: 'divider',
                flexWrap: 'wrap',
                gap: 1,
                justifyContent: 'space-between',
                px: { xs: 2.5, sm: 4 },
                py: 1.5,
              }}
            >
              <Box sx={{ width: { xs: '100%', sm: 'auto' } }}>
                {editingReticulumChannel &&
                  !isReticulumSystemChannelId(
                    editingReticulumChannel.channelId
                  ) && (
                    <Button
                      ref={reticulumRemoveChannelButtonRef}
                      color="error"
                      startIcon={<DeleteOutlineRoundedIcon />}
                      onClick={openReticulumDeleteConfirmation}
                      sx={{
                        minHeight: 40,
                        px: 1,
                        textTransform: 'none',
                      }}
                    >
                      Remove channel
                    </Button>
                  )}
              </Box>
              <Box
                sx={{
                  display: 'flex',
                  gap: 1,
                  justifyContent: 'flex-end',
                  width: { xs: '100%', sm: 'auto' },
                }}
              >
                <Button
                  onClick={closeReticulumChannelSettings}
                  sx={{ ...reticulumSecondaryButtonSx, minHeight: 40 }}
                >
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  onClick={() => void saveReticulumChannelSettings()}
                  sx={{
                    ...reticulumPrimaryButtonSx,
                    minHeight: 40,
                    minWidth: 140,
                  }}
                >
                  Save changes
                </Button>
              </Box>
            </DialogActions>
          </>
        )}
      </Dialog>

      <Dialog
        open={
          isReticulumCategoryDialogOpen &&
          reticulumCategoryDialogMode === 'create'
        }
        onClose={closeReticulumCategoryDialog}
        fullWidth
        maxWidth={false}
        PaperProps={{
          sx: {
            ...reticulumDialogPaperSx,
            boxSizing: 'border-box',
            m: 2,
            maxWidth: 'calc(100vw - 32px)',
            overflow: 'hidden',
            width: 680,
          },
        }}
      >
        <DialogContent
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2.5,
            px: { xs: 2.5, sm: 4 },
            py: { xs: 2.5, sm: 3.5 },
          }}
        >
          <Box>
            <DialogTitle
              sx={{
                ...reticulumDialogTitleSx,
                fontSize: { xs: 25, sm: 28 },
                lineHeight: 1.15,
                p: 0,
              }}
            >
              Create category
            </DialogTitle>
            <Typography
              sx={{
                color: 'text.secondary',
                fontSize: 14,
                lineHeight: '20px',
                mt: 0.75,
              }}
            >
              Choose a name for your category.
            </Typography>
          </Box>
          <Box>
            <Typography
              component="label"
              htmlFor="reticulum-create-category-name-input"
              sx={{
                color: 'text.primary',
                display: 'block',
                fontSize: 15,
                fontWeight: 800,
                mb: 1,
              }}
            >
              Category name
            </Typography>
            <TextField
              autoFocus
              error={Boolean(reticulumCategoryError)}
              FormHelperTextProps={{
                sx: {
                  fontSize: 12.5,
                  lineHeight: '18px',
                  minHeight: 18,
                  ml: 0,
                  mt: 0.75,
                },
              }}
              fullWidth
              helperText={
                reticulumCategoryError ||
                'Use letters, numbers, special characters and emojis.'
              }
              id="reticulum-create-category-name-input"
              InputProps={{
                endAdornment: renderReticulumNameEmojiAdornment('category'),
              }}
              onChange={(event) => {
                setReticulumCategoryName(event.target.value);
                if (reticulumCategoryError) setReticulumCategoryError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void saveReticulumCategory();
                }
              }}
              placeholder="e.g. SUPPORT"
              sx={{
                ...reticulumDialogTextFieldSx,
                '& .MuiOutlinedInput-root': {
                  ...reticulumDialogTextFieldSx['& .MuiOutlinedInput-root'],
                  height: 48,
                },
                '& .MuiOutlinedInput-input': { py: 1.5 },
              }}
              value={reticulumCategoryName}
            />
          </Box>
        </DialogContent>
        <DialogActions
          sx={{
            borderTop: '1px solid',
            borderColor: 'divider',
            gap: 1,
            justifyContent: 'flex-end',
            px: { xs: 2.5, sm: 4 },
            py: 1.5,
          }}
        >
          <Button
            onClick={closeReticulumCategoryDialog}
            sx={{ ...reticulumSecondaryButtonSx, minHeight: 40 }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => void saveReticulumCategory()}
            sx={{ ...reticulumPrimaryButtonSx, minHeight: 40, minWidth: 140 }}
          >
            Create category
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={
          isReticulumCategoryDialogOpen &&
          reticulumCategoryDialogMode === 'rename'
        }
        onClose={handleReticulumCategoryDialogClose}
        fullWidth
        maxWidth={false}
        PaperProps={{
          sx: {
            ...reticulumDialogPaperSx,
            boxSizing: 'border-box',
            m: 2,
            maxWidth: 'calc(100vw - 32px)',
            overflow: 'hidden',
            transition: 'width 160ms ease',
            width:
              reticulumCategorySettingsView === 'confirm-delete' ? 480 : 680,
          },
        }}
      >
        {reticulumCategorySettingsView === 'confirm-delete' ? (
          <>
            <DialogContent
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2.25,
                px: { xs: 2.5, sm: 3.5 },
                py: { xs: 2.5, sm: 3 },
              }}
            >
              <Box sx={{ alignItems: 'center', display: 'flex', gap: 1 }}>
                <Tooltip title="Back to category settings">
                  <span>
                    <IconButton
                      aria-label="Back to category settings"
                      disabled={isDeletingReticulumCategory}
                      onClick={returnToReticulumCategorySettings}
                      size="small"
                      sx={{ color: 'text.secondary', ml: -0.5 }}
                    >
                      <ArrowBackRoundedIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <DeleteOutlineRoundedIcon
                  sx={{ color: 'error.main', fontSize: 26 }}
                />
                <DialogTitle
                  sx={{
                    ...reticulumDialogTitleSx,
                    fontSize: { xs: 24, sm: 26 },
                    lineHeight: 1.15,
                    p: 0,
                  }}
                >
                  Delete category
                </DialogTitle>
              </Box>
              <Typography
                sx={{
                  color: 'text.secondary',
                  fontSize: 14,
                  lineHeight: '21px',
                }}
              >
                This action cannot be undone. Type delete below to permanently
                remove this category.
              </Typography>
              <Box>
                <Typography
                  component="label"
                  htmlFor="reticulum-category-delete-confirmation-input"
                  sx={{
                    color: 'text.primary',
                    display: 'block',
                    fontSize: 15,
                    fontWeight: 800,
                    mb: 1,
                  }}
                >
                  Type delete to confirm
                </Typography>
                <TextField
                  aria-describedby={
                    reticulumCategoryDeleteConfirmationError
                      ? 'reticulum-category-delete-confirmation-error'
                      : undefined
                  }
                  aria-label="Type delete to confirm category deletion"
                  autoComplete="off"
                  disabled={isDeletingReticulumCategory}
                  fullWidth
                  id="reticulum-category-delete-confirmation-input"
                  inputRef={reticulumCategoryDeleteConfirmationInputRef}
                  onChange={(event) => {
                    setReticulumCategoryDeleteConfirmationName(
                      event.target.value
                    );
                    if (reticulumCategoryDeleteConfirmationError) {
                      setReticulumCategoryDeleteConfirmationError('');
                    }
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      isReticulumCategoryDeleteConfirmationMatched
                    ) {
                      event.preventDefault();
                      void confirmReticulumCategoryDeletion();
                    }
                  }}
                  placeholder="delete"
                  sx={{
                    ...reticulumDialogTextFieldSx,
                    '& .MuiOutlinedInput-root': {
                      ...reticulumDialogTextFieldSx['& .MuiOutlinedInput-root'],
                      height: 48,
                    },
                    '& .MuiOutlinedInput-input': { py: 1.5 },
                  }}
                  value={reticulumCategoryDeleteConfirmationName}
                  InputProps={{
                    endAdornment:
                      isReticulumCategoryDeleteConfirmationMatched ? (
                        <InputAdornment position="end">
                          <CheckCircleRoundedIcon
                            aria-label="Category name confirmed"
                            color="primary"
                            fontSize="small"
                          />
                        </InputAdornment>
                      ) : undefined,
                  }}
                />
                {reticulumCategoryDeleteConfirmationError && (
                  <Typography
                    id="reticulum-category-delete-confirmation-error"
                    role="alert"
                    sx={{
                      color: 'error.main',
                      fontSize: 12.5,
                      lineHeight: '18px',
                      mt: 0.75,
                    }}
                  >
                    {reticulumCategoryDeleteConfirmationError}
                  </Typography>
                )}
              </Box>
            </DialogContent>
            <DialogActions
              sx={{
                borderTop: '1px solid',
                borderColor: 'divider',
                gap: 1,
                justifyContent: 'flex-end',
                px: { xs: 2.5, sm: 3.5 },
                py: 1.25,
              }}
            >
              <Button
                disabled={isDeletingReticulumCategory}
                onClick={returnToReticulumCategorySettings}
                sx={{ ...reticulumSecondaryButtonSx, minHeight: 40 }}
              >
                Cancel
              </Button>
              <Button
                aria-disabled={!isReticulumCategoryDeleteConfirmationMatched}
                disabled={
                  !isReticulumCategoryDeleteConfirmationMatched ||
                  isDeletingReticulumCategory
                }
                onClick={() => void confirmReticulumCategoryDeletion()}
                sx={{
                  '&.Mui-disabled': {
                    backgroundColor: 'rgba(220, 38, 38, 0.28)',
                    color: 'rgba(255, 255, 255, 0.48)',
                  },
                  '&:hover': { backgroundColor: '#b91c1c' },
                  backgroundColor: '#dc2626',
                  color: 'common.white',
                  minHeight: 40,
                  minWidth: 142,
                }}
                variant="contained"
              >
                {isDeletingReticulumCategory ? (
                  <CircularProgress size={18} sx={{ color: 'common.white' }} />
                ) : (
                  'Delete category'
                )}
              </Button>
            </DialogActions>
          </>
        ) : (
          <>
            <DialogContent
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2.5,
                px: { xs: 2.5, sm: 4 },
                py: { xs: 2.5, sm: 3.5 },
              }}
            >
              <Box>
                <DialogTitle
                  sx={{
                    ...reticulumDialogTitleSx,
                    fontSize: { xs: 25, sm: 28 },
                    lineHeight: 1.15,
                    p: 0,
                  }}
                >
                  Category settings
                </DialogTitle>
                <Typography
                  sx={{
                    color: 'text.secondary',
                    fontSize: 14,
                    lineHeight: '20px',
                    mt: 0.75,
                  }}
                >
                  Update this category&apos;s name.
                </Typography>
              </Box>
              <Box>
                <Typography
                  component="label"
                  htmlFor="reticulum-category-settings-name-input"
                  sx={{
                    color: 'text.primary',
                    display: 'block',
                    fontSize: 15,
                    fontWeight: 800,
                    mb: 1,
                  }}
                >
                  Category name
                </Typography>
                <TextField
                  autoFocus
                  error={Boolean(reticulumCategoryError)}
                  FormHelperTextProps={{
                    sx: {
                      fontSize: 12.5,
                      lineHeight: '18px',
                      minHeight: 18,
                      ml: 0,
                      mt: 0.75,
                    },
                  }}
                  fullWidth
                  helperText={
                    reticulumCategoryError ||
                    'Use letters, numbers, special characters and emojis.'
                  }
                  id="reticulum-category-settings-name-input"
                  InputProps={{
                    endAdornment: renderReticulumNameEmojiAdornment('category'),
                  }}
                  onChange={(event) => {
                    setReticulumCategoryName(event.target.value);
                    if (reticulumCategoryError) setReticulumCategoryError('');
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void saveReticulumCategory();
                    }
                  }}
                  sx={{
                    ...reticulumDialogTextFieldSx,
                    '& .MuiOutlinedInput-root': {
                      ...reticulumDialogTextFieldSx['& .MuiOutlinedInput-root'],
                      height: 48,
                    },
                    '& .MuiOutlinedInput-input': { py: 1.5 },
                  }}
                  value={reticulumCategoryName}
                />
              </Box>
            </DialogContent>
            <DialogActions
              sx={{
                borderTop: '1px solid',
                borderColor: 'divider',
                flexWrap: 'wrap',
                gap: 1,
                justifyContent: 'space-between',
                px: { xs: 2.5, sm: 4 },
                py: 1.5,
              }}
            >
              <Box sx={{ width: { xs: '100%', sm: 'auto' } }}>
                <Tooltip
                  arrow
                  placement="top"
                  title={
                    editingReticulumCategory?.categoryId ===
                      DEFAULT_RETICULUM_CATEGORY_METADATA_ID &&
                    reticulumDefaultCategoryHasProtectedChannels
                      ? 'Default Channels inside Category'
                      : ''
                  }
                >
                  <Box component="span" sx={{ display: 'inline-block' }}>
                    <Button
                      ref={reticulumRemoveCategoryButtonRef}
                      color="error"
                      disabled={
                        editingReticulumCategory?.categoryId ===
                          DEFAULT_RETICULUM_CATEGORY_METADATA_ID &&
                        reticulumDefaultCategoryHasProtectedChannels
                      }
                      startIcon={<DeleteOutlineRoundedIcon />}
                      onClick={() => openReticulumCategoryDeleteConfirmation()}
                      sx={{ minHeight: 40, px: 1, textTransform: 'none' }}
                    >
                      Remove category
                    </Button>
                  </Box>
                </Tooltip>
              </Box>
              <Box
                sx={{
                  display: 'flex',
                  gap: 1,
                  justifyContent: 'flex-end',
                  width: { xs: '100%', sm: 'auto' },
                }}
              >
                <Button
                  onClick={closeReticulumCategoryDialog}
                  sx={{ ...reticulumSecondaryButtonSx, minHeight: 40 }}
                >
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  onClick={() => void saveReticulumCategory()}
                  sx={{
                    ...reticulumPrimaryButtonSx,
                    minHeight: 40,
                    minWidth: 140,
                  }}
                >
                  Save changes
                </Button>
              </Box>
            </DialogActions>
          </>
        )}
      </Dialog>

      <Popover
        anchorEl={reticulumNameEmojiPicker?.anchorEl}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        onClose={closeReticulumNameEmojiPicker}
        open={Boolean(reticulumNameEmojiPicker)}
        PaperProps={{
          sx: {
            backgroundColor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: '10px',
            boxShadow: '0 18px 48px rgba(0, 0, 0, 0.45)',
            overflow: 'hidden',
          },
        }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
      >
        <EmojiPicker
          autoFocusSearch
          emojiStyle={EmojiStyle.NATIVE}
          height={390}
          onEmojiClick={appendReticulumNameEmoji}
          previewConfig={{ showPreview: false }}
          searchPlaceHolder="Find an emoji"
          theme={Theme.DARK}
          width={340}
        />
      </Popover>

      <Popover
        anchorEl={reticulumAdminAnchorEl}
        anchorPosition={
          reticulumAdminAnchorPosition
            ? {
                left: reticulumAdminAnchorPosition.left,
                top: reticulumAdminAnchorPosition.top,
              }
            : undefined
        }
        anchorOrigin={{ horizontal: 'center', vertical: 'bottom' }}
        anchorReference={
          reticulumAdminAnchorPosition ? 'anchorPosition' : 'anchorEl'
        }
        onClose={() => {
          setReticulumAdminAnchorEl(null);
          setReticulumAdminAnchorPosition(null);
        }}
        open={Boolean(reticulumAdminAnchorEl || reticulumAdminAnchorPosition)}
        hideBackdrop
        disableAutoFocus
        disableEnforceFocus
        slotProps={{
          root: { sx: { pointerEvents: 'none' } },
          paper: {
            className: 'reticulum-admin-popover-paper',
            sx: {
              backgroundColor: `${theme.palette.background.surface} !important`,
              boxSizing: 'border-box',
              maxWidth: 'calc(100vw - 24px) !important',
              minWidth: '0 !important',
              pointerEvents: 'auto',
              width: '390px !important',
            },
          },
        }}
        PaperProps={{
          className: 'reticulum-admin-popover-paper',
          ref: reticulumAdminPopoverRef,
          sx: {
            backgroundColor: `${theme.palette.background.surface} !important`,
            border: `1px solid ${alpha(theme.palette.divider, 0.82)}`,
            borderRadius: '10px',
            boxShadow:
              theme.palette.mode === 'dark'
                ? `0 18px 44px ${alpha(theme.palette.common.black, 0.48)}, 0 1px 0 ${alpha(theme.palette.common.white, 0.05)}`
                : `0 18px 44px ${alpha(theme.palette.common.black, 0.16)}, 0 1px 0 ${alpha(theme.palette.common.white, 0.72)}`,
            mt: 1,
            overflow: 'hidden',
            maxWidth: 'calc(100vw - 24px)',
            width: '390px !important',
          },
        }}
        transformOrigin={{ horizontal: 'center', vertical: 'top' }}
      >
        <Box
          sx={{
            backgroundColor: theme.palette.background.surface,
            boxSizing: 'border-box',
            position: 'relative',
            width: '390px',
            zIndex: 1,
          }}
        >
          {isReticulumChannelAdmin ? (
            <AdminSpaceInner
              adminsWithNames={adminsWithNames}
              compact
              isOwner={isGroupOwner}
              selectedGroup={selectedGroup}
            />
          ) : (
            <Typography
              sx={{
                color: 'text.secondary',
                fontSize: 13,
                p: 2,
                width: '390px',
              }}
            >
              This area is available to group admins.
            </Typography>
          )}
        </Box>
      </Popover>

      {(isResizingQManager || isOpenQManager === true) && (
        <Portal>
          {isResizingQManager && (
            <Box
              aria-hidden
              sx={{
                backgroundColor: 'transparent',
                inset: 0,
                pointerEvents: 'auto',
                position: 'fixed',
                zIndex: 1399,
              }}
            />
          )}

          {isOpenQManager === true && (
            <Rnd
              position={qManagerPosition}
              size={qManagerSize}
              minWidth={Q_MANAGER_MIN_WIDTH}
              minHeight={Q_MANAGER_MIN_HEIGHT}
              maxWidth={maxQManagerWidth}
              maxHeight={maxQManagerHeight}
              bounds="window"
              disableDragging
              enableResizing={
                isOpenQManager === true && !hideView
                  ? {
                      top: false,
                      left: true,
                      topLeft: false,
                      topRight: false,
                      right: true,
                      bottom: true,
                      bottomLeft: false,
                      bottomRight: true,
                    }
                  : false
              }
              resizeHandleStyles={{
                top: { height: 24, top: -12, zIndex: 25, cursor: 'ns-resize' },
                left: { width: 24, left: -12, zIndex: 25, cursor: 'ew-resize' },
                topLeft: {
                  width: 28,
                  height: 28,
                  left: -14,
                  top: -14,
                  zIndex: 25,
                  cursor: 'nwse-resize',
                },
              }}
              resizeHandleWrapperStyle={{ pointerEvents: 'auto' }}
              onResizeStart={handleQManagerResizeStart}
              onResize={handleQManagerResize}
              onResizeStop={handleQManagerResizeStop}
              style={{
                display: hideView || isOpenQManager !== true ? 'none' : 'block',
                position: 'fixed',
                zIndex: 1400,
              }}
            >
              <Box
                sx={{
                  backgroundColor: `color-mix(in srgb, ${theme.palette.background.surface} 68%, #000)`,
                  border: `1px solid ${alpha(theme.palette.divider, 0.82)}`,
                  borderRadius: '10px',
                  boxShadow:
                    theme.palette.mode === 'dark'
                      ? `0 20px 50px ${alpha(theme.palette.common.black, 0.48)}, 0 1px 0 ${alpha(theme.palette.common.white, 0.05)}`
                      : `0 18px 44px ${alpha(theme.palette.common.black, 0.16)}, 0 1px 0 ${alpha(theme.palette.common.white, 0.72)}`,
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  maxHeight: `calc(100vh - ${appHeighOffsetPx})`,
                  maxWidth: '100vw',
                  minHeight: Q_MANAGER_MIN_HEIGHT,
                  minWidth: Q_MANAGER_MIN_WIDTH,
                  overflow: 'hidden',
                  position: 'relative',
                  width: '100%',
                }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    backgroundColor:
                      theme.palette.mode === 'dark'
                        ? alpha(theme.palette.background.default, 0.58)
                        : alpha(theme.palette.background.paper, 0.72),
                    borderBottom: `1px solid ${alpha(theme.palette.divider, 0.72)}`,
                    display: 'flex',
                    flex: `0 0 ${Q_MANAGER_HEADER_HEIGHT}px`,
                    gap: 1,
                    height: `${Q_MANAGER_HEADER_HEIGHT}px`,
                    justifyContent: 'space-between',
                    padding: '0 8px 0 12px',
                  }}
                >
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: 1,
                      minWidth: 0,
                    }}
                  >
                    <Box
                      aria-hidden
                      sx={{
                        backgroundColor: theme.palette.primary.main,
                        borderRadius: '999px',
                        boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.16)}`,
                        flexShrink: 0,
                        height: 8,
                        width: 8,
                      }}
                    />
                    <Typography
                      noWrap
                      sx={{
                        color: theme.palette.text.primary,
                        fontFamily: 'Inter',
                        fontSize: '14px',
                        fontWeight: 700,
                      }}
                    >
                      Q-Manager
                    </Typography>
                  </Box>

                  <ButtonBase
                    onClick={() => {
                      setIsOpenQManager(false);
                    }}
                    sx={{
                      alignItems: 'center',
                      borderRadius: '8px',
                      color: theme.palette.text.secondary,
                      display: 'inline-flex',
                      height: 30,
                      justifyContent: 'center',
                      transition:
                        'background-color 0.18s ease, color 0.18s ease',
                      width: 30,
                      '&:hover': {
                        backgroundColor: alpha(
                          theme.palette.text.primary,
                          0.08
                        ),
                        color: theme.palette.text.primary,
                      },
                    }}
                  >
                    <CloseIcon
                      sx={{
                        color: 'currentColor',
                        fontSize: 20,
                      }}
                    />
                  </ButtonBase>
                </Box>

                <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                  <AppViewerContainer
                    customHeight="100%"
                    app={{
                      name: 'Q-Manager',
                      path: `?groupId=${selectedGroup}`,
                      service: 'APP',
                      tabId: '5558588',
                    }}
                    isSelected
                    ref={iframeRef}
                  />
                </Box>
              </Box>
            </Rnd>
          )}
        </Portal>
      )}

      <LoadingSnackbar
        open={
          isReticulumModeResolved &&
          !isReticulumModeDetected &&
          !reticulumChatEnabled &&
          isLoading
        }
        info={{
          message: t('core:loading.chat', {
            postProcess: 'capitalizeFirstChar',
          }),
        }}
      />

      <Dialog
        fullWidth
        maxWidth={false}
        open={isReticulumHiddenUsersDialogOpen}
        onClose={() => {
          if (reticulumUnhidingAddress) return;
          setIsReticulumHiddenUsersDialogOpen(false);
          setReticulumHiddenUsersError('');
        }}
        PaperProps={{
          sx: {
            ...reticulumDialogPaperSx,
            boxSizing: 'border-box',
            m: 2,
            maxHeight: 'min(560px, calc(100vh - 32px))',
            maxWidth: 'calc(100vw - 32px)',
            overflow: 'hidden',
            width: 500,
          },
        }}
      >
        <DialogTitle
          sx={{
            ...reticulumDialogTitleSx,
            alignItems: 'center',
            borderBottom: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.25 }}>
            <VisibilityOffRoundedIcon sx={{ color: 'text.secondary' }} />
            Hidden Members
          </Box>
          <IconButton
            aria-label="Close hidden members"
            disabled={Boolean(reticulumUnhidingAddress)}
            onClick={() => {
              setIsReticulumHiddenUsersDialogOpen(false);
              setReticulumHiddenUsersError('');
            }}
            size="small"
            sx={{ color: 'text.secondary' }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent
          sx={{
            display: 'flex',
            flexDirection: 'column',
            minHeight: 160,
            overflowY: 'auto',
            px: { xs: 2.5, sm: 3.5 },
            py: 2.5,
          }}
        >
          <Typography
            sx={{
              color: 'text.secondary',
              fontSize: 14,
              lineHeight: '20px',
              mb: 2,
            }}
          >
            People hidden in {selectedGroupName || 'this group'} stay out of
            this group&apos;s Reticulum chat until you unhide them.
          </Typography>
          {reticulumHiddenUsersForSelectedGroup.length === 0 ? (
            <Box
              sx={{
                alignItems: 'center',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: '10px',
                color: 'text.secondary',
                display: 'flex',
                fontSize: 14,
                justifyContent: 'center',
                minHeight: 88,
              }}
            >
              No users hidden
            </Box>
          ) : (
            <Box
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: '10px',
                overflow: 'hidden',
              }}
            >
              {reticulumHiddenUsersForSelectedGroup.map(
                ({ address, name }, index) => (
                  <Box
                    key={address}
                    sx={{
                      alignItems: 'center',
                      borderTop: index === 0 ? 'none' : '1px solid',
                      borderColor: 'divider',
                      display: 'flex',
                      gap: 1.5,
                      minHeight: 64,
                      px: 2,
                      py: 1,
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        sx={{
                          color: 'text.primary',
                          fontSize: 14,
                          fontWeight: 650,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {name}
                      </Typography>
                      {name !== address && (
                        <Typography
                          sx={{
                            color: 'text.secondary',
                            fontSize: 11,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {address}
                        </Typography>
                      )}
                    </Box>
                    <Tooltip title="Unhide">
                      <span>
                        <IconButton
                          aria-label={`Unhide ${name}`}
                          disabled={Boolean(reticulumUnhidingAddress)}
                          onClick={() => void unhideReticulumGroupUser(address)}
                          size="small"
                          sx={{ color: 'text.secondary' }}
                        >
                          {reticulumUnhidingAddress === address ? (
                            <CircularProgress size={18} />
                          ) : (
                            <VisibilityRoundedIcon sx={{ fontSize: 20 }} />
                          )}
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>
                )
              )}
            </Box>
          )}
          {reticulumHiddenUsersError && (
            <Typography
              color="error"
              role="alert"
              sx={{ fontSize: 12.5, mt: 1 }}
            >
              {reticulumHiddenUsersError}
            </Typography>
          )}
        </DialogContent>
      </Dialog>

      <ReticulumDiscussionDialog
        canWrite={canWriteSelectedReticulumChannel}
        channelExpiryDurationMs={selectedReticulumChannelExpiryDurationMs}
        compressingGif={isCompressingReticulumDiscussionGif}
        files={reticulumDiscussionFiles}
        loading={isReticulumDiscussionLoading}
        membersWithNames={members}
        mentionSuggestions={reticulumMentionSuggestions}
        messages={reticulumDiscussionMessages}
        myAddress={myAddress}
        onClose={closeReticulumDiscussion}
        onRemoveFile={removeReticulumDiscussionFile}
        onSelectFiles={insertReticulumDiscussionFiles}
        onSend={sendReticulumDiscussionReply}
        onTypingChange={noteReticulumComposerActivity}
        open={Boolean(reticulumDiscussionRootId)}
        preparingFile={isPreparingReticulumDiscussionFile}
        replyCount={activeReticulumDiscussionReplyCount}
        reticulumGroupAvatarOwnerName={reticulumGroupOwnerName}
        reticulumGroupDisplayName={selectedGroupName}
        reticulumMemberJoinedByAddress={reticulumMemberJoinedByAddress}
        reticulumMemberRolesByAddress={reticulumMemberRolesByAddress}
        reticulumMemberRolesReady={reticulumMemberRolesReadyForSelectedGroup}
        reticulumMentionUsers={reticulumMentionUsers}
        reticulumChannelLinkAccess={reticulumChannelLinkAccess}
        selectedGroup={selectedGroup}
      />

      {reticulumChatEnabled && (
        <GroupAvatar
          balance={balance}
          dialogOpen={isGroupAvatarDialogOpen}
          externalOnly
          groupId={selectedGroup}
          myName={myName}
          onDialogClose={() => setIsGroupAvatarDialogOpen(false)}
          setInfoSnack={setInfoSnack}
          setOpenSnack={setOpenSnack}
        />
      )}

      <CustomizedSnackbars
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />
    </div>
  );
};
