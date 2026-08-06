import {
  useCallback,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
} from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { MessageItem } from './MessageItem';
import { DirectCallHistoryRow } from './DirectCallHistoryRow';
import { DirectFriendEventRow } from './DirectFriendEventRow';
import type { ReticulumChannelLinkAccess } from './MessageDisplay';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { Box, Button, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import { ChatOptions } from './ChatOptions';
import ErrorBoundary from '../../common/ErrorBoundary';
import { useTranslation } from 'react-i18next';

type ReactionItem = {
  sender: string;
  senderName?: string;
};

export type ReactionsMap = {
  [reactionType: string]: ReactionItem[];
};

const RETICULUM_BOTTOM_PIN_THRESHOLD_PX = 16;

const getReactionLayoutSignature = (reactions: ReactionsMap | null) => {
  if (!reactions) return '';
  const visibleReactions = Object.entries(reactions)
    .map(([reaction, items]) => [reaction, items?.length ?? 0] as const)
    .filter(([, count]) => count > 0);
  return visibleReactions.length > 0 ? JSON.stringify(visibleReactions) : '';
};

const getMessageTimestampMs = (message: any): number | null => {
  const value = Number(message?.timestamp);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value < 1_000_000_000_000 ? value * 1000 : value;
};

const isReticulumMessageContinuation = (
  previousMessage: any,
  message: any
): boolean => {
  if (
    !previousMessage ||
    !message ||
    previousMessage?.divide ||
    message?.divide
  ) {
    return false;
  }
  if (!previousMessage?.sender || previousMessage.sender !== message?.sender) {
    return false;
  }
  const previousSystemType =
    previousMessage?.qchatSystem?.type ||
    previousMessage?.decryptedData?.qchatSystem?.type;
  const systemType =
    message?.qchatSystem?.type || message?.decryptedData?.qchatSystem?.type;
  if (previousSystemType || systemType) return false;

  const previousTimestamp = getMessageTimestampMs(previousMessage);
  const timestamp = getMessageTimestampMs(message);
  if (previousTimestamp === null || timestamp === null) return false;

  const elapsed = timestamp - previousTimestamp;
  return elapsed >= 0 && elapsed <= 2 * 60 * 1000;
};

type ChatListProps = {
  [key: string]: any;
  initialMessages: any;
  myAddress: any;
  tempMessages: any;
  onReply: any;
  onEdit: any;
  onDelete?: any;
  handleReaction: any;
  chatReferences: any;
  tempChatReferences: any;
  members?: any;
  myName?: any;
  selectedGroup?: any;
  enableMentions?: any;
  openQManager?: any;
  onAcceptQchatFileTransfer?: (message: any) => void;
  qchatFileTransferStates?: Record<string, any>;
  qchatCompletedTransfers?: Record<string, any>;
  hasSecretKey?: any;
  isPrivate?: any;
  reticulumChatEnabled?: boolean;
  reticulumInitialHistoryReady?: boolean;
  reticulumNavigationPending?: boolean;
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
  reticulumUnreadCount?: number;
  onReticulumUnreadAcknowledged?: () => void;
  reticulumViewActive?: boolean;
  reticulumReadEntryToken?: number;
  reticulumDiscussionReplyCounts?: Record<string, number>;
  onOpenReticulumDiscussion?: (message: any) => void;
  secretKeyObject?: any;
  compactScrollButton?: boolean;
  chatId?: any;
  hasOlderMessages?: boolean;
  hasNewerMessages?: boolean;
  isLoadingOlderMessages?: boolean;
  isLoadingNewerMessages?: boolean;
  onLoadOlder?: () =>
    | void
    | { added?: number }
    | Promise<void | { added?: number }>;
  onLoadNewer?: () =>
    | void
    | { added?: number }
    | Promise<void | { added?: number }>;
  onJumpToLatest?: () =>
    | void
    | { success?: boolean }
    | Promise<void | { success?: boolean }>;
  scrollToMessageId?: string;
  scrollToMessageNonce?: number;
};

export const ChatList = ({
  initialMessages,
  myAddress,
  tempMessages,
  onReply,
  onEdit,
  onDelete,
  handleReaction,
  chatReferences,
  tempChatReferences,
  members,
  myName,
  selectedGroup,
  enableMentions,
  openQManager,
  onAcceptQchatFileTransfer,
  qchatFileTransferStates,
  qchatCompletedTransfers,
  hasSecretKey,
  isPrivate,
  reticulumChatEnabled = false,
  reticulumInitialHistoryReady = true,
  reticulumNavigationPending = false,
  reticulumGroupAvatarOwnerName,
  reticulumGroupDisplayName,
  reticulumMentionUsers,
  reticulumChannelLinkAccess,
  reticulumMemberJoinedByAddress,
  reticulumMemberRolesByAddress,
  reticulumMemberRolesReady = true,
  reticulumUnreadCount = 0,
  onReticulumUnreadAcknowledged,
  reticulumViewActive = true,
  reticulumReadEntryToken,
  reticulumDiscussionReplyCounts,
  onOpenReticulumDiscussion,
  secretKeyObject,
  compactScrollButton = false,
  chatId,
  hasOlderMessages,
  hasNewerMessages = false,
  isLoadingOlderMessages = false,
  isLoadingNewerMessages = false,
  onLoadOlder,
  onLoadNewer,
  onJumpToLatest,
  scrollToMessageId,
  scrollToMessageNonce,
}: ChatListProps) => {
  const theme = useTheme();
  const parentRef = useRef(null);
  const [messages, setMessages] = useState(initialMessages);
  const appliedInitialMessagesRef = useRef(initialMessages);
  const appliedTempMessagesRef = useRef(tempMessages);
  const reticulumMessageInputsReadyRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showScrollDownButton, setShowScrollDownButton] = useState(false);
  const [highlightedMessageIndex, setHighlightedMessageIndex] = useState<
    number | null
  >(null);
  const [reticulumUnreadBoundaryIndex, setReticulumUnreadBoundaryIndex] =
    useState<number | null>(null);
  const hasLoadedInitialRef = useRef(false);
  const scrollingIntervalRef = useRef(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const scrollRetryTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const scrollRetryFrameRef = useRef<number | null>(null);
  const scrollRetrySequenceRef = useRef(0);
  const lastHandledScrollTargetRef = useRef('');
  const lastSeenUnreadMessageTimestamp = useRef(null);
  const loadingOlderFromScrollRef = useRef(false);
  const loadingNewerFromScrollRef = useRef(false);
  const lastAutoFillMessageCountRef = useRef(-1);
  const previousMessageCountRef = useRef(0);
  const reticulumUnreadPromptShownRef = useRef(false);
  const lastReticulumReadEntryTokenRef = useRef<number | null>(null);
  const reticulumViewWasActiveRef = useRef(false);
  const reticulumPinnedToBottomRef = useRef(false);
  const reticulumFollowBottomRef = useRef(false);
  const reticulumReadingPositionLockedRef = useRef(false);
  const reticulumReactionLayoutRef = useRef<{
    chatIdentity: string;
    signatures: Map<string, string>;
  }>({ chatIdentity: '', signatures: new Map() });
  const lastScrollMetricsRef = useRef({
    clientHeight: 0,
    scrollHeight: 0,
    scrollTop: 0,
  });
  const pendingInitialReticulumBottomRef = useRef(false);
  const pendingInitialReticulumUnreadIndexRef = useRef<number | null>(null);
  const initialReticulumRevealFrameRef = useRef<number | null>(null);
  const [positionedReticulumChatIdentity, setPositionedReticulumChatIdentity] =
    useState('');
  const [
    positionedReticulumScrollTargetKey,
    setPositionedReticulumScrollTargetKey,
  ] = useState('');

  const chatIdentity = useMemo(() => {
    if (chatId != null) {
      if (typeof chatId === 'object') {
        if (chatId.groupId != null) return `group:${chatId.groupId}`;
        if (chatId.id != null) return `chat:${chatId.id}`;
        if (chatId.address != null) return `direct:${chatId.address}`;
      }
      return String(chatId);
    }
    if (selectedGroup?.groupId != null) return `group:${selectedGroup.groupId}`;
    if (selectedGroup?.id != null) return `group:${selectedGroup.id}`;
    return 'chat';
  }, [chatId, selectedGroup?.groupId, selectedGroup?.id]);
  const mountedChatIdentityRef = useRef(chatIdentity);
  const reticulumScrollTargetKey = scrollToMessageId
    ? `${scrollToMessageId}:${scrollToMessageNonce ?? 0}`
    : '';
  const reticulumScrollTargetKeyRef = useRef(reticulumScrollTargetKey);
  reticulumScrollTargetKeyRef.current = reticulumScrollTargetKey;

  // Shared scroll button styling (memoized so Button sx refs stay stable)
  const scrollButtonSx = useMemo(
    () => ({
      position: 'absolute' as const,
      right: 20,
      bottom: 20,
      zIndex: 10,
      borderRadius: '24px',
      textTransform: 'none' as const,
      fontWeight: 600,
      fontSize: '0.875rem',
      px: 2,
      py: 1.25,
      boxShadow:
        theme.palette.mode === 'dark'
          ? '0 4px 20px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.08)'
          : '0 4px 14px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)',
      backgroundColor: theme.palette.background.paper,
      color: theme.palette.text.primary,
      border: `1px solid ${theme.palette.divider}`,
      transition:
        'box-shadow 0.2s ease, transform 0.15s ease, background-color 0.2s ease',
      '&:hover': {
        backgroundColor: theme.palette.action.hover,
        boxShadow:
          theme.palette.mode === 'dark'
            ? `0 6px 24px rgba(0,0,0,0.5), 0 0 0 1px ${theme.palette.primary.main}40`
            : `0 6px 20px rgba(0,0,0,0.15), 0 0 0 1px ${theme.palette.primary.light}60`,
      },
      '&:active': {
        transform: 'scale(0.98)',
      },
    }),
    [theme]
  );
  const scrollButtonCompactSx = useMemo(
    () => ({
      ...scrollButtonSx,
      right: 16,
      bottom: 16,
      borderRadius: '50%',
      px: 0,
      py: 0,
      minWidth: 40,
      width: 40,
      height: 40,
      '& .MuiButton-startIcon': { margin: 0 },
    }),
    [scrollButtonSx]
  );
  const getMessageKey = useCallback(
    (message: any, index: number) =>
      message?.tempSignature ||
      message?.signature ||
      message?.identifier ||
      `${chatIdentity}:row:${index}`,
    [chatIdentity]
  );

  const initialReticulumLandingIndex = useMemo(() => {
    if (
      !reticulumChatEnabled ||
      !reticulumInitialHistoryReady ||
      messages.length === 0
    ) {
      return -1;
    }
    if (scrollToMessageId) {
      const targetIndex = messages.findIndex(
        (message) =>
          message?.signature === scrollToMessageId ||
          message?.tempSignature === scrollToMessageId ||
          message?.identifier === scrollToMessageId ||
          message?.message?.signature === scrollToMessageId
      );
      if (targetIndex >= 0) return targetIndex;
    }
    const unreadCount = Math.max(0, Number(reticulumUnreadCount) || 0);
    if (unreadCount > 0) {
      const unreadIndexes = messages.reduce<number[]>(
        (indexes, message, index) => {
          if (
            !message?.chatReference &&
            !message?.isTemp &&
            message?.sender !== myAddress
          ) {
            indexes.push(index);
          }
          return indexes;
        },
        []
      );
      if (unreadIndexes.length > 0) {
        return unreadIndexes[Math.max(0, unreadIndexes.length - unreadCount)];
      }
    }
    return messages.length - 1;
  }, [
    messages,
    myAddress,
    reticulumChatEnabled,
    reticulumInitialHistoryReady,
    reticulumUnreadCount,
    scrollToMessageId,
  ]);

  const pendingReticulumScrollTargetIndex = useMemo(() => {
    if (
      !reticulumChatEnabled ||
      !scrollToMessageId ||
      !reticulumScrollTargetKey ||
      positionedReticulumScrollTargetKey === reticulumScrollTargetKey
    ) {
      return -1;
    }
    return messages.findIndex(
      (message) =>
        message?.signature === scrollToMessageId ||
        message?.tempSignature === scrollToMessageId ||
        message?.identifier === scrollToMessageId ||
        message?.message?.signature === scrollToMessageId
    );
  }, [
    messages,
    positionedReticulumScrollTargetKey,
    reticulumChatEnabled,
    reticulumScrollTargetKey,
    scrollToMessageId,
  ]);

  const extractVirtualRows = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      const indexes = defaultRangeExtractor(range);
      if (
        pendingReticulumScrollTargetIndex < 0 ||
        indexes.includes(pendingReticulumScrollTargetIndex)
      ) {
        return indexes;
      }
      // A search target can be dozens of variable-height rows away from the
      // currently mounted range. Keep that one row mounted until positioning
      // completes so the first navigation has real DOM geometry to align to,
      // rather than depending on a cache populated by a previous click.
      return [...indexes, pendingReticulumScrollTargetIndex].sort(
        (left, right) => left - right
      );
    },
    [pendingReticulumScrollTargetIndex]
  );

  // Initialize the virtualizer
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getItemKey: (index) => getMessageKey(messages[index], index),
    getScrollElement: () => parentRef?.current,
    estimateSize: useCallback(() => 80, []), // Provide an estimated height of items, adjust this as needed
    initialOffset:
      reticulumChatEnabled && initialReticulumLandingIndex >= 0
        ? initialReticulumLandingIndex * 80
        : 0,
    rangeExtractor: extractVirtualRows,
    overscan: reticulumChatEnabled ? 5 : 10,
    useAnimationFrameWithResizeObserver: reticulumChatEnabled,
    // Keep the visible Reticulum content anchored when a reply preview or image
    // settles to a different measured height. If the reader was pinned to the
    // end, preserve that anchor even when the final row itself grows (for
    // example when its first reaction is displayed).
    shouldAdjustScrollPositionOnItemSizeChange: (item, _delta, instance) => {
      if (!reticulumChatEnabled) return true;
      if (reticulumPinnedToBottomRef.current) return true;
      return (
        item.start < instance.getScrollOffset() + instance.scrollAdjustments
      );
    },
  });
  const virtualContentHeight = rowVirtualizer.getTotalSize();

  const clearScrollRetries = useCallback(() => {
    scrollRetrySequenceRef.current += 1;
    if (scrollRetryFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollRetryFrameRef.current);
      scrollRetryFrameRef.current = null;
    }
    scrollRetryTimeoutsRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    scrollRetryTimeoutsRef.current = [];
  }, []);

  const clearInitialReticulumReveal = useCallback(() => {
    if (initialReticulumRevealFrameRef.current !== null) {
      window.cancelAnimationFrame(initialReticulumRevealFrameRef.current);
      initialReticulumRevealFrameRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    if (
      !reticulumChatEnabled ||
      mountedChatIdentityRef.current === chatIdentity
    ) {
      return;
    }
    mountedChatIdentityRef.current = chatIdentity;
    clearScrollRetries();
    clearInitialReticulumReveal();
    if (highlightTimeoutRef.current) {
      window.clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = null;
    }
    hasLoadedInitialRef.current = false;
    lastHandledScrollTargetRef.current = '';
    lastSeenUnreadMessageTimestamp.current = null;
    loadingOlderFromScrollRef.current = false;
    loadingNewerFromScrollRef.current = false;
    lastAutoFillMessageCountRef.current = -1;
    previousMessageCountRef.current = 0;
    reticulumUnreadPromptShownRef.current = false;
    lastReticulumReadEntryTokenRef.current = null;
    reticulumViewWasActiveRef.current = false;
    reticulumPinnedToBottomRef.current = false;
    reticulumFollowBottomRef.current = false;
    reticulumReadingPositionLockedRef.current = false;
    pendingInitialReticulumBottomRef.current = false;
    pendingInitialReticulumUnreadIndexRef.current = null;
    lastScrollMetricsRef.current = {
      clientHeight: 0,
      scrollHeight: 0,
      scrollTop: 0,
    };
    setHighlightedMessageIndex(null);
    setReticulumUnreadBoundaryIndex(null);
    setPositionedReticulumScrollTargetKey('');
    setShowScrollButton(false);
    setShowScrollDownButton(false);
  }, [
    chatIdentity,
    clearInitialReticulumReveal,
    clearScrollRetries,
    reticulumChatEnabled,
  ]);

  const scrollToIndexAfterMeasurements = useCallback(
    (
      index: number,
      align: 'start' | 'end' = 'end',
      retryDelays: number[] = [50, 150, 350, 700]
    ) => {
      if (index < 0) return;

      clearScrollRetries();
      const sequence = scrollRetrySequenceRef.current;
      const scroll = () => {
        if (scrollRetrySequenceRef.current !== sequence) return;
        if (reticulumChatEnabled) {
          const scrollElement = parentRef.current as HTMLDivElement | null;
          const target = rowVirtualizer.getOffsetForIndex(index, align);
          if (!scrollElement || !target) return;
          // Reticulum owns its measurement retries so reader input can cancel
          // them without issuing another programmatic scroll. TanStack's
          // scrollToIndex creates a private recursive timeout in dynamic mode.
          scrollElement.scrollTop = target[0];
          return;
        }
        rowVirtualizer.scrollToIndex(index, { align });
      };

      scroll();
      scrollRetryFrameRef.current = window.requestAnimationFrame(scroll);
      retryDelays.forEach((delay) => {
        const timeoutId = window.setTimeout(scroll, delay);
        scrollRetryTimeoutsRef.current.push(timeoutId);
      });
    },
    [clearScrollRetries, reticulumChatEnabled, rowVirtualizer]
  );

  const scrollToIndexBeforeReveal = useCallback(
    (index: number, targetKey: string) => {
      if (index < 0 || !targetKey) return;

      clearScrollRetries();
      const sequence = scrollRetrySequenceRef.current;
      let previousOffset: number | null = null;
      let stableFrames = 0;
      let attempts = 0;

      // Let TanStack own the initial dynamic-row jump. Unlike a single
      // getOffsetForIndex call, scrollToIndex keeps correcting its estimate as
      // the replacement history window mounts and rows are measured. The
      // viewport stays hidden until the target DOM row is actually aligned,
      // so none of those measurement corrections are visible to the reader.
      rowVirtualizer.scrollToIndex(index, { align: 'start' });

      const positionAndMeasure = () => {
        if (
          scrollRetrySequenceRef.current !== sequence ||
          reticulumScrollTargetKeyRef.current !== targetKey
        ) {
          return;
        }
        const scrollElement = parentRef.current as HTMLDivElement | null;
        const target = rowVirtualizer.getOffsetForIndex(index, 'start');
        if (!scrollElement || !target) {
          attempts += 1;
          if (attempts >= 30) {
            scrollRetryFrameRef.current = null;
            if (scrollElement) {
              // Cancel any remaining private scrollToIndex measurement retry
              // before exposing the viewport.
              rowVirtualizer.scrollToOffset(scrollElement.scrollTop, {
                align: 'start',
              });
            }
            setPositionedReticulumScrollTargetKey(targetKey);
            return;
          }
          scrollRetryFrameRef.current =
            window.requestAnimationFrame(positionAndMeasure);
          return;
        }

        const nextOffset = target[0];
        // The estimated jump makes an off-window target mountable. Its actual
        // DOM geometry below is the authority for the final position.
        scrollElement.scrollTop = nextOffset;
        const targetRow = scrollElement.querySelector<HTMLElement>(
          `[data-index="${index}"]`
        );
        attempts += 1;
        const offsetIsStable =
          previousOffset !== null &&
          Math.abs(previousOffset - nextOffset) <= 0.5;
        let rowIsAligned = false;
        if (targetRow) {
          const viewportTop = scrollElement.getBoundingClientRect().top;
          const rowTop = targetRow.getBoundingClientRect().top;
          const correction = rowTop - viewportTop;
          if (Math.abs(correction) > 0.5) {
            scrollElement.scrollTop += correction;
          } else {
            rowIsAligned = true;
          }
        }
        if (targetRow && offsetIsStable && rowIsAligned) {
          stableFrames += 1;
        } else {
          stableFrames = 0;
        }
        previousOffset = nextOffset;

        // Dynamic rows are measured through an animation-frame ResizeObserver.
        // Do not reveal based only on a stable estimated offset: the real row
        // must be mounted and aligned for consecutive frames. The attempt cap
        // prevents an unexpected virtualizer failure from hiding chat forever.
        if (stableFrames >= 2 || attempts >= 30) {
          scrollRetryFrameRef.current = null;
          // scrollToOffset cancels TanStack's recursive scrollToIndex timeout.
          // Keeping the current offset makes that cancellation position-neutral.
          rowVirtualizer.scrollToOffset(scrollElement.scrollTop, {
            align: 'start',
          });
          setPositionedReticulumScrollTargetKey(targetKey);
          return;
        }
        scrollRetryFrameRef.current =
          window.requestAnimationFrame(positionAndMeasure);
      };

      positionAndMeasure();
    },
    [clearScrollRetries, rowVirtualizer]
  );

  useEffect(() => {
    hasLoadedInitialRef.current = false;
    lastSeenUnreadMessageTimestamp.current = null;
    previousMessageCountRef.current = 0;
    reticulumUnreadPromptShownRef.current = false;
    reticulumPinnedToBottomRef.current = false;
    reticulumFollowBottomRef.current = false;
    reticulumReadingPositionLockedRef.current = false;
    lastScrollMetricsRef.current = {
      clientHeight: 0,
      scrollHeight: 0,
      scrollTop: 0,
    };
    pendingInitialReticulumBottomRef.current = false;
    pendingInitialReticulumUnreadIndexRef.current = null;
    setReticulumUnreadBoundaryIndex(null);
    setPositionedReticulumChatIdentity('');
    setPositionedReticulumScrollTargetKey('');
    clearInitialReticulumReveal();
    clearScrollRetries();
  }, [chatIdentity, clearInitialReticulumReveal, clearScrollRetries]);

  useEffect(() => {
    return () => {
      clearScrollRetries();
      clearInitialReticulumReveal();
    };
  }, [clearInitialReticulumReveal, clearScrollRetries]);

  const isPinnedToBottom = useCallback(() => {
    const scrollElement = parentRef.current as HTMLDivElement | null;
    if (!scrollElement) return false;

    // Reticulum follows only when the reader is actually at the end. A tiny
    // tolerance accounts for sub-pixel layout without treating an upward read
    // position as pinned.
    const isPinned =
      scrollElement.scrollHeight -
        scrollElement.scrollTop -
        scrollElement.clientHeight <=
      1;
    if (reticulumChatEnabled) {
      const readingPositionLocked = reticulumReadingPositionLockedRef.current;
      reticulumPinnedToBottomRef.current = isPinned && !readingPositionLocked;
      if (isPinned && !readingPositionLocked) {
        reticulumFollowBottomRef.current = true;
      }
      // Once bottom-following is active, only an explicit reader gesture may
      // release it. A transient virtualizer offset during a state refresh must
      // still count as following the bottom.
      return (
        !readingPositionLocked && (isPinned || reticulumFollowBottomRef.current)
      );
    }
    return isPinned;
  }, [reticulumChatEnabled]);

  const loadOlderFromTop = useCallback(async () => {
    if (!onLoadOlder) return;
    if (hasOlderMessages === false) return;
    if (isLoadingOlderMessages || loadingOlderFromScrollRef.current) return;

    const scrollElement = parentRef.current as HTMLDivElement | null;
    if (!scrollElement) return;

    const previousScrollHeight = scrollElement.scrollHeight;
    const previousScrollTop = scrollElement.scrollTop;
    loadingOlderFromScrollRef.current = true;
    try {
      await onLoadOlder();
      window.requestAnimationFrame(() => {
        const nextScrollElement = parentRef.current as HTMLDivElement | null;
        if (!nextScrollElement) return;
        const heightDelta =
          nextScrollElement.scrollHeight - previousScrollHeight;
        if (heightDelta > 0) {
          nextScrollElement.scrollTop = previousScrollTop + heightDelta;
        }
      });
    } finally {
      loadingOlderFromScrollRef.current = false;
    }
  }, [hasOlderMessages, isLoadingOlderMessages, onLoadOlder]);

  const loadNewerFromBottom = useCallback(async () => {
    if (!onLoadNewer || hasNewerMessages === false) return;
    if (isLoadingNewerMessages || loadingNewerFromScrollRef.current) return;
    loadingNewerFromScrollRef.current = true;
    try {
      await onLoadNewer();
    } finally {
      loadingNewerFromScrollRef.current = false;
    }
  }, [hasNewerMessages, isLoadingNewerMessages, onLoadNewer]);

  const handleScroll = useCallback(() => {
    const scrollElement = parentRef.current as HTMLDivElement | null;
    if (!scrollElement) return;
    if (reticulumChatEnabled) {
      const isPinned =
        scrollElement.scrollHeight -
          scrollElement.scrollTop -
          scrollElement.clientHeight <=
        RETICULUM_BOTTOM_PIN_THRESHOLD_PX;
      const previousMetrics = lastScrollMetricsRef.current;
      const contentSizeChanged =
        previousMetrics.scrollHeight !== 0 &&
        (previousMetrics.scrollHeight !== scrollElement.scrollHeight ||
          previousMetrics.clientHeight !== scrollElement.clientHeight);

      reticulumPinnedToBottomRef.current =
        isPinned && !reticulumReadingPositionLockedRef.current;
      if (
        isPinned &&
        !hasNewerMessages &&
        !reticulumReadingPositionLockedRef.current
      ) {
        reticulumFollowBottomRef.current = true;
      } else if (hasNewerMessages) {
        reticulumFollowBottomRef.current = false;
      } else if (reticulumFollowBottomRef.current && !contentSizeChanged) {
        // Dynamic virtual-row correction can emit a second scroll event after
        // the new height has already been recorded. It is still a layout
        // movement, not reader intent. User wheel/touch/pointer interaction
        // disables following before its corresponding scroll event arrives.
        scrollElement.scrollTop = scrollElement.scrollHeight;
        reticulumPinnedToBottomRef.current = true;
      }
      lastScrollMetricsRef.current = {
        clientHeight: scrollElement.clientHeight,
        scrollHeight: scrollElement.scrollHeight,
        scrollTop: scrollElement.scrollTop,
      };
      if (isPinned) {
        setShowScrollButton(false);
        setShowScrollDownButton(false);
      }
    }
    if (scrollElement.scrollTop <= 160) {
      void loadOlderFromTop();
    }
    const distanceFromBottom =
      scrollElement.scrollHeight -
      scrollElement.scrollTop -
      scrollElement.clientHeight;
    if (
      distanceFromBottom <= 160 &&
      hasNewerMessages &&
      !reticulumReadingPositionLockedRef.current
    ) {
      void loadNewerFromBottom();
    }
  }, [
    hasNewerMessages,
    loadNewerFromBottom,
    loadOlderFromTop,
    reticulumChatEnabled,
  ]);

  useLayoutEffect(() => {
    if (!reticulumChatEnabled || !reticulumFollowBottomRef.current) return;
    const scrollElement = parentRef.current as HTMLDivElement | null;
    if (!scrollElement) return;

    const pinToBottom = () => {
      const currentElement = parentRef.current as HTMLDivElement | null;
      if (!currentElement || !reticulumFollowBottomRef.current) return;
      currentElement.scrollTop = currentElement.scrollHeight;
      reticulumPinnedToBottomRef.current = true;
      lastScrollMetricsRef.current = {
        clientHeight: currentElement.clientHeight,
        scrollHeight: currentElement.scrollHeight,
        scrollTop: currentElement.scrollTop,
      };
    };

    pinToBottom();
    const frameId = window.requestAnimationFrame(pinToBottom);
    return () => window.cancelAnimationFrame(frameId);
  }, [reticulumChatEnabled, virtualContentHeight]);

  const cancelReticulumScrollRetries = useCallback(() => {
    if (!reticulumChatEnabled) return;
    clearScrollRetries();
  }, [clearScrollRetries, reticulumChatEnabled]);

  const releaseReticulumBottomFollow = useCallback(() => {
    reticulumReadingPositionLockedRef.current = false;
    reticulumFollowBottomRef.current = false;
    reticulumPinnedToBottomRef.current = false;
    pendingInitialReticulumBottomRef.current = false;
    cancelReticulumScrollRetries();
  }, [cancelReticulumScrollRetries]);

  const handleReticulumPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      cancelReticulumScrollRetries();
      const scrollElement = event.currentTarget;
      const scrollbarWidth = Math.max(
        6,
        scrollElement.offsetWidth - scrollElement.clientWidth
      );
      const bounds = scrollElement.getBoundingClientRect();
      if (event.clientX >= bounds.right - scrollbarWidth - 2) {
        reticulumReadingPositionLockedRef.current = false;
        reticulumFollowBottomRef.current = false;
        reticulumPinnedToBottomRef.current = false;
        pendingInitialReticulumBottomRef.current = false;
      }
    },
    [cancelReticulumScrollRetries]
  );

  useEffect(() => {
    if (!onLoadOlder || hasOlderMessages === false) return;
    const scrollElement = parentRef.current as HTMLDivElement | null;
    if (!scrollElement) return;
    if (lastAutoFillMessageCountRef.current === messages.length) return;
    if (scrollElement.scrollHeight > scrollElement.clientHeight + 32) return;
    lastAutoFillMessageCountRef.current = messages.length;
    void loadOlderFromTop();
  }, [hasOlderMessages, loadOlderFromTop, messages.length, onLoadOlder]);

  useEffect(() => {
    if (scrollingIntervalRef.current) {
      window.clearTimeout(scrollingIntervalRef.current);
      scrollingIntervalRef.current = null;
    }

    const scrollElement = parentRef.current as HTMLDivElement | null;
    if (!scrollElement || rowVirtualizer.isScrolling) {
      setShowScrollDownButton(false);
      return undefined;
    }

    const shouldShowScrollDownButton = () => {
      const currentElement = parentRef.current as HTMLDivElement | null;
      if (!currentElement) return false;
      const { scrollTop, scrollHeight, clientHeight } = currentElement;
      const hasScrollableOverflow = scrollHeight > clientHeight + 4;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      return hasScrollableOverflow && distanceFromBottom > 4;
    };

    if (!shouldShowScrollDownButton()) {
      setShowScrollDownButton(false);
      return undefined;
    }

    scrollingIntervalRef.current = window.setTimeout(() => {
      scrollingIntervalRef.current = null;
      setShowScrollDownButton(shouldShowScrollDownButton());
    }, 250);

    return () => {
      if (scrollingIntervalRef.current) {
        window.clearTimeout(scrollingIntervalRef.current);
        scrollingIntervalRef.current = null;
      }
    };
  }, [
    chatIdentity,
    messages.length,
    rowVirtualizer.isScrolling,
    virtualContentHeight,
  ]);

  // Update message list with unique signatures and tempMessages
  useEffect(() => {
    if (reticulumChatEnabled && !reticulumInitialHistoryReady) {
      reticulumMessageInputsReadyRef.current = false;
      previousMessageCountRef.current = 0;
      // The viewport is already hidden for the new chat identity. Retaining
      // the old internal rows until the replacement history arrives avoids an
      // otherwise wasted empty-list render; they can never become visible
      // under the new channel.
      return;
    }

    const uniqueInitialMessagesMap = new Map();

    // Only add a message if it doesn't already exist in the Map
    initialMessages.forEach((message) => {
      if (!message || typeof message !== 'object') return;
      const signature = message.signature || message.tempSignature;
      if (!signature) return;
      if (!uniqueInitialMessagesMap.has(signature)) {
        uniqueInitialMessagesMap.set(signature, message);
      }
    });

    const uniqueInitialMessages = Array.from(uniqueInitialMessagesMap.values())
      .filter((message) => {
        const directType =
          message?.type ||
          message?.decryptedData?.type ||
          message?.decryptedData?.data?.type;
        const directStatus =
          message?.status ||
          message?.data?.status ||
          message?.decryptedData?.status ||
          message?.decryptedData?.data?.status ||
          message?.decryptedData?.data?.data?.status;
        return !(
          directType === 'qchat-dm-file-transfer' && directStatus === 'accepted'
        );
      })
      .sort((a, b) => a.timestamp - b.timestamp);
    const totalMessages = [
      ...uniqueInitialMessages,
      ...(tempMessages || []),
    ].filter(
      (message) =>
        message &&
        typeof message === 'object' &&
        (message.signature || message.tempSignature)
    );

    if (totalMessages.length === 0) {
      appliedInitialMessagesRef.current = initialMessages;
      appliedTempMessagesRef.current = tempMessages;
      reticulumMessageInputsReadyRef.current = true;
      previousMessageCountRef.current = 0;
      setMessages([]);
      setShowScrollButton(false);
      setShowScrollDownButton(false);
      if (reticulumChatEnabled) {
        setPositionedReticulumChatIdentity(chatIdentity);
      }
      return;
    }

    const hasNewMessages =
      hasLoadedInitialRef.current &&
      totalMessages.length > previousMessageCountRef.current;
    const scrollTargetRequestKey = scrollToMessageId
      ? `${scrollToMessageId}:${scrollToMessageNonce ?? 0}`
      : '';
    const hasPendingScrollTarget = Boolean(
      scrollTargetRequestKey &&
      lastHandledScrollTargetRef.current !== scrollTargetRequestKey &&
      totalMessages.some(
        (message) =>
          message?.signature === scrollToMessageId ||
          message?.tempSignature === scrollToMessageId ||
          message?.identifier === scrollToMessageId ||
          message?.message?.signature === scrollToMessageId
      )
    );
    const normalizedReticulumReadEntryToken =
      typeof reticulumReadEntryToken === 'number'
        ? reticulumReadEntryToken
        : null;
    const reticulumViewBecameActive =
      reticulumViewActive && !reticulumViewWasActiveRef.current;
    reticulumViewWasActiveRef.current = reticulumViewActive;
    if (
      reticulumViewBecameActive ||
      (normalizedReticulumReadEntryToken !== null &&
        normalizedReticulumReadEntryToken !==
          lastReticulumReadEntryTokenRef.current)
    ) {
      reticulumUnreadPromptShownRef.current = false;
    }
    if (normalizedReticulumReadEntryToken !== null) {
      lastReticulumReadEntryTokenRef.current =
        normalizedReticulumReadEntryToken;
    }
    const latestMessage = totalMessages[totalMessages.length - 1];
    const isLatestMessageMine =
      latestMessage?.sender === myAddress ||
      latestMessage?.message?.sender === myAddress;
    const followIncomingReticulumMessages =
      reticulumChatEnabled &&
      hasNewMessages &&
      !hasPendingScrollTarget &&
      isPinnedToBottom();
    previousMessageCountRef.current = totalMessages.length;

    appliedInitialMessagesRef.current = initialMessages;
    appliedTempMessagesRef.current = tempMessages;
    reticulumMessageInputsReadyRef.current = true;
    setMessages((currentMessages) =>
      currentMessages.length === totalMessages.length &&
      currentMessages.every(
        (message, index) => message === totalMessages[index]
      )
        ? currentMessages
        : totalMessages
    );

    const updatePosition = () => {
      if (followIncomingReticulumMessages) {
        scrollToBottom(totalMessages, undefined, true, isLatestMessageMine);
        return;
      }

      const isInitialLoad = !hasLoadedInitialRef.current;
      const initialReticulumUnreadCount = Math.max(
        0,
        Number(reticulumUnreadCount) || 0
      );
      const initialReticulumUnreadIndexes = totalMessages.reduce<number[]>(
        (indexes, message, index) => {
          if (
            !message?.chatReference &&
            !message?.isTemp &&
            message?.sender !== myAddress
          ) {
            indexes.push(index);
          }
          return indexes;
        },
        []
      );
      const shouldAcknowledgeInitialReticulumUnread =
        reticulumChatEnabled &&
        reticulumViewActive &&
        !reticulumUnreadPromptShownRef.current &&
        initialReticulumUnreadCount > 0 &&
        initialReticulumUnreadIndexes.length > 0;
      const firstReticulumUnreadIndex = shouldAcknowledgeInitialReticulumUnread
        ? initialReticulumUnreadIndexes[
            Math.max(
              0,
              initialReticulumUnreadIndexes.length - initialReticulumUnreadCount
            )
          ]
        : null;

      if (
        typeof firstReticulumUnreadIndex === 'number' &&
        Number.isInteger(firstReticulumUnreadIndex)
      ) {
        reticulumUnreadPromptShownRef.current = true;
        pendingInitialReticulumUnreadIndexRef.current =
          firstReticulumUnreadIndex;
        setReticulumUnreadBoundaryIndex(firstReticulumUnreadIndex);
        onReticulumUnreadAcknowledged?.();
      }

      const hasUnreadMessages = totalMessages.some(
        (msg) =>
          msg.unread &&
          !msg?.chatReference &&
          !msg?.isTemp &&
          ((!msg?.chatReference &&
            msg?.timestamp > lastSeenUnreadMessageTimestamp.current) ||
            0)
      );

      if (reticulumChatEnabled) {
        if (!isInitialLoad && hasNewMessages && !hasPendingScrollTarget) {
          setShowScrollButton(true);
          setShowScrollDownButton(false);
        }
      } else if (parentRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
        const atBottom = scrollTop + clientHeight >= scrollHeight - 10; // Adjust threshold as needed
        if (!atBottom && hasUnreadMessages) {
          setShowScrollButton(hasUnreadMessages);
          setShowScrollDownButton(false);
        } else {
          handleMessageSeen();
        }
      }
      if (isInitialLoad) {
        if (scrollToMessageId && !reticulumChatEnabled) {
          hasLoadedInitialRef.current = true;
          return;
        }
        const reticulumScrollTargetIndex =
          reticulumChatEnabled && scrollToMessageId
            ? totalMessages.findIndex(
                (message) =>
                  message.signature === scrollToMessageId ||
                  message.tempSignature === scrollToMessageId ||
                  message.identifier === scrollToMessageId ||
                  message.message?.signature === scrollToMessageId
              )
            : -1;
        const findDivideIndex = totalMessages.findIndex(
          (item) => !!item?.divide
        );
        const divideIndex = reticulumChatEnabled
          ? undefined
          : findDivideIndex !== -1
            ? findDivideIndex
            : undefined;
        if (reticulumChatEnabled) {
          // Position the hidden Reticulum viewport before revealing it. This
          // prevents history, stale rows, and virtual row measurements from
          // becoming visible as a sequence of scroll jumps.
          const unreadIndex = pendingInitialReticulumUnreadIndexRef.current;
          pendingInitialReticulumUnreadIndexRef.current = null;
          const shouldLandAtBottom =
            reticulumScrollTargetIndex < 0 && typeof unreadIndex !== 'number';
          pendingInitialReticulumBottomRef.current = shouldLandAtBottom;
          reticulumPinnedToBottomRef.current = shouldLandAtBottom;
          reticulumFollowBottomRef.current = shouldLandAtBottom;
          if (reticulumScrollTargetIndex >= 0) {
            scrollToIndexBeforeReveal(
              reticulumScrollTargetIndex,
              scrollTargetRequestKey
            );
          } else if (typeof unreadIndex === 'number') {
            scrollToIndexAfterMeasurements(unreadIndex, 'start', []);
          }
          clearInitialReticulumReveal();
          if (shouldLandAtBottom) {
            const pinAndRevealAtBottom = () => {
              const scrollElement = parentRef.current as HTMLDivElement | null;
              if (!scrollElement) {
                initialReticulumRevealFrameRef.current = null;
                return;
              }
              scrollElement.scrollTop = scrollElement.scrollHeight;
              reticulumPinnedToBottomRef.current = true;
              reticulumFollowBottomRef.current = true;
              lastScrollMetricsRef.current = {
                clientHeight: scrollElement.clientHeight,
                scrollHeight: scrollElement.scrollHeight,
                scrollTop: scrollElement.scrollTop,
              };
              // The virtualizer has already committed the new row window by
              // this frame. Reveal it now; ResizeObserver and the pinned-bottom
              // guards below keep following any later row measurements. Waiting
              // for several arbitrary frames made each channel switch inherit
              // multiple expensive layout passes before anything was visible.
              clearScrollRetries();
              pendingInitialReticulumBottomRef.current = false;
              setPositionedReticulumChatIdentity(chatIdentity);
              initialReticulumRevealFrameRef.current = null;
            };
            initialReticulumRevealFrameRef.current =
              window.requestAnimationFrame(pinAndRevealAtBottom);
          } else {
            initialReticulumRevealFrameRef.current =
              window.requestAnimationFrame(() => {
                // A cross-channel search target has its own measurement loop.
                // Cancelling it here leaves the loaded window at its default
                // offset, so the same result only works on a second click.
                if (reticulumScrollTargetIndex < 0) {
                  clearScrollRetries();
                }
                setPositionedReticulumChatIdentity(chatIdentity);
                initialReticulumRevealFrameRef.current = null;
              });
          }
        } else {
          scrollToBottom(totalMessages, divideIndex, true);
        }
        hasLoadedInitialRef.current = true;
      }
    };

    let updateTimeout: ReturnType<typeof setTimeout> | null = null;
    let updateFrame: number | null = null;
    if (reticulumChatEnabled) {
      updateFrame = window.requestAnimationFrame(updatePosition);
    } else {
      updateTimeout = window.setTimeout(updatePosition, 500);
    }

    return () => {
      if (updateTimeout !== null) window.clearTimeout(updateTimeout);
      if (updateFrame !== null) window.cancelAnimationFrame(updateFrame);
    };
  }, [
    chatIdentity,
    initialMessages,
    isPinnedToBottom,
    myAddress,
    onReticulumUnreadAcknowledged,
    reticulumReadEntryToken,
    reticulumChatEnabled,
    reticulumInitialHistoryReady,
    reticulumUnreadCount,
    reticulumViewActive,
    tempMessages,
    scrollToMessageId,
    scrollToMessageNonce,
    clearInitialReticulumReveal,
    clearScrollRetries,
    scrollToIndexAfterMeasurements,
    scrollToIndexBeforeReveal,
  ]);

  const scrollToBottom = (
    initialMsgs?: unknown[],
    divideIndex?: number,
    markSeen = true,
    settleReticulumLayout = false
  ) => {
    const index = initialMsgs ? initialMsgs.length - 1 : messages.length - 1;
    if (reticulumChatEnabled && divideIndex === undefined) {
      clearScrollRetries();
      reticulumReadingPositionLockedRef.current = false;
      const pinToBottom = () => {
        const scrollElement = parentRef.current as HTMLDivElement | null;
        if (!scrollElement) return;
        reticulumPinnedToBottomRef.current = true;
        reticulumFollowBottomRef.current = true;
        // Directly pinning avoids scrollToIndex's recursive dynamic-size retry.
        // Scheduled calls below still follow late Reticulum row measurements.
        scrollElement.scrollTop = scrollElement.scrollHeight;
        lastScrollMetricsRef.current = {
          clientHeight: scrollElement.clientHeight,
          scrollHeight: scrollElement.scrollHeight,
          scrollTop: scrollElement.scrollTop,
        };
      };
      pinToBottom();
      scrollRetryFrameRef.current = window.requestAnimationFrame(() => {
        pinToBottom();
        scrollRetryFrameRef.current = window.requestAnimationFrame(pinToBottom);
      });
      // Invite previews and message media can finish measuring after the first
      // virtualizer pass. Only hold the initial channel landing at the bottom
      // long enough for those rows to settle; regular incoming messages keep
      // the immediate, non-intrusive follow behavior.
      if (settleReticulumLayout) {
        [80, 220, 500, 950, 1500].forEach((delay) => {
          const timeoutId = window.setTimeout(pinToBottom, delay);
          scrollRetryTimeoutsRef.current.push(timeoutId);
        });
      }
    } else if (rowVirtualizer) {
      if (divideIndex !== undefined) {
        scrollToIndexAfterMeasurements(divideIndex, 'start');
      } else {
        scrollToIndexAfterMeasurements(
          index,
          'end',
          reticulumChatEnabled && !initialMsgs ? [50] : [50, 150, 350, 700]
        );
      }
    }
    if (markSeen) handleMessageSeen();
  };

  const handleMessageSeen = useCallback(() => {
    setMessages((prevMessages) =>
      prevMessages.map((msg) => ({
        ...msg,
        unread: false,
      }))
    );
    setShowScrollButton(false);
    lastSeenUnreadMessageTimestamp.current = Date.now();
  }, []);

  const handleGoToLatest = async () => {
    if (hasNewerMessages && onJumpToLatest) {
      if (isLoadingNewerMessages) return;
      const result = await onJumpToLatest();
      if (result && result.success === false) return;
      scrollToBottom(undefined, undefined, true, true);
      return;
    }
    scrollToBottom();
  };

  const sentNewMessageGroupFunc = useCallback(() => {
    // Reticulum follows locally-authored messages from the state update above.
    // The legacy event can run before the optimistic row has mounted and pull
    // the reader back to the previous last message.
    if (reticulumChatEnabled) return;
    const { scrollHeight, scrollTop, clientHeight } = parentRef.current;

    // Check if the user is within 200px from the bottom
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    if (distanceFromBottom <= 700) {
      scrollToBottom();
    }
  }, [messages, reticulumChatEnabled]);

  useEffect(() => {
    subscribeToEvent('sent-new-message-group', sentNewMessageGroupFunc);
    return () => {
      unsubscribeFromEvent('sent-new-message-group', sentNewMessageGroupFunc);
    };
  }, [sentNewMessageGroupFunc]);

  const lastSignature = useMemo(() => {
    if (!messages || messages?.length === 0) return null;
    const lastIndex = messages.length - 1;
    return messages[lastIndex]?.signature;
  }, [messages]);

  const goToMessage = useCallback(
    (idx: number, hiddenScrollTargetKey?: string) => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
        highlightTimeoutRef.current = null;
      }
      if (reticulumChatEnabled) {
        // A deliberate message jump is a new reading position. Release the
        // previous bottom-follow state before changing scrollTop; otherwise
        // the ensuing scroll event can interpret the jump as a virtual-row
        // correction and immediately snap the viewport back to the bottom.
        reticulumReadingPositionLockedRef.current = true;
        reticulumFollowBottomRef.current = false;
        reticulumPinnedToBottomRef.current = false;
        pendingInitialReticulumBottomRef.current = false;
        if (hiddenScrollTargetKey) {
          scrollToIndexBeforeReveal(idx, hiddenScrollTargetKey);
        } else {
          scrollToIndexAfterMeasurements(idx, 'start');
        }
      } else {
        rowVirtualizer.scrollToIndex(idx);
      }
      setHighlightedMessageIndex(idx);
      highlightTimeoutRef.current = setTimeout(() => {
        setHighlightedMessageIndex(null);
        highlightTimeoutRef.current = null;
      }, 1200);
    },
    [
      reticulumChatEnabled,
      rowVirtualizer,
      scrollToIndexAfterMeasurements,
      scrollToIndexBeforeReveal,
    ]
  );

  useLayoutEffect(() => {
    if (!scrollToMessageId) return;
    if (
      reticulumChatEnabled &&
      (reticulumNavigationPending ||
        !reticulumMessageInputsReadyRef.current ||
        appliedInitialMessagesRef.current !== initialMessages ||
        appliedTempMessagesRef.current !== tempMessages)
    ) {
      // The parent has opened the replacement history, but this list has not
      // committed those rows yet. Keep the request pending instead of marking
      // it handled against the stale window.
      return;
    }
    const targetRequestKey = `${scrollToMessageId}:${
      scrollToMessageNonce ?? 0
    }`;
    if (lastHandledScrollTargetRef.current === targetRequestKey) return;
    const targetIndex = messages.findIndex((message) => {
      if (!message || typeof message !== 'object') return false;
      return (
        message.signature === scrollToMessageId ||
        message.tempSignature === scrollToMessageId ||
        message.identifier === scrollToMessageId ||
        message.message?.signature === scrollToMessageId
      );
    });
    if (targetIndex === -1) return;
    lastHandledScrollTargetRef.current = targetRequestKey;
    goToMessage(
      targetIndex,
      reticulumChatEnabled ? targetRequestKey : undefined
    );
    handleMessageSeen();
  }, [
    goToMessage,
    handleMessageSeen,
    initialMessages,
    messages,
    reticulumNavigationPending,
    reticulumChatEnabled,
    scrollToMessageId,
    scrollToMessageNonce,
    tempMessages,
  ]);

  // Memoize per-row payload so MessageItem receives stable references and memo can skip re-renders
  const processedRows = useMemo(() => {
    const messageIndexBySignature = new Map<string, number>();
    messages.forEach((message, index) => {
      const signature = message?.signature;
      if (
        typeof signature === 'string' &&
        !messageIndexBySignature.has(signature)
      ) {
        messageIndexBySignature.set(signature, index);
      }
    });
    const updatingReferenceIds = new Set(
      (tempChatReferences || [])
        .map((item) => item?.chatReference)
        .filter(
          (signature): signature is string => typeof signature === 'string'
        )
    );

    return messages.map((msg, index) => {
      let message = msg || null;
      let replyIndex = -1;
      let reply = null;
      let replyExpiredMeta = null;
      let reactions = null;
      let isUpdating = false;
      try {
        if (message) {
          replyIndex = message?.repliedTo
            ? (messageIndexBySignature.get(message.repliedTo) ?? -1)
            : -1;
          if (message?.repliedTo && replyIndex !== -1) {
            reply = { ...(messages[replyIndex] || {}) };
            if (chatReferences?.[reply?.signature]?.edit) {
              const edit = chatReferences[reply?.signature]?.edit;
              reply.decryptedData = edit;
              reply.text = edit?.message;
              reply.messageText = edit?.messageText;
              reply.editTimestamp = edit?.timestamp;
            }
          } else if (message?.repliedTo && replyIndex === -1) {
            const editMeta = chatReferences?.[message?.repliedTo]?.edit;
            const replyWasDeleted =
              message?.replyTargetDeleted === true ||
              chatReferences?.[message?.repliedTo]?.deleted === true;
            if (replyWasDeleted) {
              replyExpiredMeta = { deleted: true };
            } else if (editMeta) {
              replyExpiredMeta = {
                senderName: editMeta?.senderName,
                sender: editMeta?.sender,
                messageText:
                  editMeta?.messageText !== undefined
                    ? editMeta?.messageText
                    : undefined,
                text:
                  editMeta?.message !== undefined
                    ? editMeta?.message
                    : undefined,
                decryptedData: editMeta,
                editTimestamp: editMeta?.timestamp,
              };
            } else {
              replyExpiredMeta = { missing: true };
            }
          }
          if (message?.message && message?.groupDirectId) {
            replyIndex = message?.message?.repliedTo
              ? (messageIndexBySignature.get(message.message.repliedTo) ?? -1)
              : -1;
            if (message?.message?.repliedTo && replyIndex !== -1) {
              reply = messages[replyIndex] || null;
            }
            message = {
              ...(message?.message || {}),
              isTemp: true,
              unread: false,
              status: message?.status,
            };
          }
          if (chatReferences?.[message.signature]) {
            reactions = chatReferences[message.signature]?.reactions || null;
            if (chatReferences[message.signature]?.edit) {
              message = {
                ...message,
                text: chatReferences[message.signature]?.edit?.message,
                messageText:
                  chatReferences[message.signature]?.edit?.messageText,
                images: chatReferences[message.signature]?.edit?.images,
                isEdit: true,
                editTimestamp:
                  chatReferences[message.signature]?.edit?.timestamp,
              };
            }
          }
          if (updatingReferenceIds.has(message?.signature)) {
            isUpdating = true;
          }
          if (reticulumChatEnabled && index === reticulumUnreadBoundaryIndex) {
            message = { ...message, divide: true };
          }
        }
      } catch (err) {
        message = null;
        reply = null;
        reactions = null;
      }
      return {
        message,
        reply,
        replyIndex,
        replyExpiredMeta,
        reactions,
        reactionLayoutSignature: getReactionLayoutSignature(reactions),
        isUpdating,
      };
    });
  }, [
    chatReferences,
    messages,
    reticulumChatEnabled,
    reticulumUnreadBoundaryIndex,
    tempChatReferences,
  ]);

  useLayoutEffect(() => {
    if (
      reticulumChatEnabled &&
      (appliedInitialMessagesRef.current !== initialMessages ||
        appliedTempMessagesRef.current !== tempMessages)
    ) {
      // The parent has supplied a replacement history/search window, but the
      // internal row state is still the previous window until the sync effect
      // runs. Do not measure that stale combination of rows and references.
      return;
    }
    const previous = reticulumReactionLayoutRef.current;
    const nextSignatures = new Map<string, string>();
    const changedIndexes: number[] = [];
    const canCompare =
      reticulumChatEnabled && previous.chatIdentity === chatIdentity;

    processedRows.forEach((row, index) => {
      const key = String(getMessageKey(messages[index], index));
      const signature = row.reactionLayoutSignature;
      nextSignatures.set(key, signature);
      if (
        canCompare &&
        previous.signatures.has(key) &&
        previous.signatures.get(key) !== signature
      ) {
        changedIndexes.push(index);
      }
    });

    reticulumReactionLayoutRef.current = {
      chatIdentity,
      signatures: nextSignatures,
    };

    if (!reticulumChatEnabled || changedIndexes.length === 0) return;
    const scrollElement = parentRef.current as HTMLDivElement | null;
    if (!scrollElement) return;

    // Reaction rows change a virtual message's real height. Measure only the
    // mounted rows that actually changed, before paint, so the following
    // absolute-positioned row never uses the previous cached height. Rows from
    // a new channel/history/search window establish a baseline above and do
    // not add work to initial positioning.
    changedIndexes.forEach((index) => {
      const row = scrollElement.querySelector<HTMLElement>(
        `[data-index="${index}"]`
      );
      if (row) rowVirtualizer.measureElement(row);
    });
  }, [
    chatIdentity,
    getMessageKey,
    initialMessages,
    messages,
    processedRows,
    reticulumChatEnabled,
    rowVirtualizer,
    tempMessages,
  ]);

  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  return (
    <Box
      data-reticulum-chat-root={reticulumChatEnabled ? 'true' : undefined}
      sx={{
        display: 'flex',
        height: '100%',
        width: '100%',
      }}
    >
      <Box
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          position: 'relative',
          width: '100%',
        }}
      >
        <Box
          data-reticulum-chat-scroll-viewport={
            reticulumChatEnabled ? 'true' : undefined
          }
          ref={parentRef}
          onScroll={handleScroll}
          onWheel={releaseReticulumBottomFollow}
          onTouchStart={cancelReticulumScrollRetries}
          onTouchMove={releaseReticulumBottomFollow}
          onPointerDown={handleReticulumPointerDown}
          style={{
            display: 'flex',
            flexGrow: 1,
            height: '0px',
            overflow: 'auto',
            overflowX: reticulumChatEnabled ? 'hidden' : undefined,
            position: 'relative',
            visibility:
              reticulumChatEnabled &&
              (positionedReticulumChatIdentity !== chatIdentity ||
                reticulumNavigationPending ||
                (reticulumScrollTargetKey &&
                  positionedReticulumScrollTargetKey !==
                    reticulumScrollTargetKey))
                ? 'hidden'
                : 'visible',
          }}
          sx={
            reticulumChatEnabled
              ? {
                  scrollbarColor: 'transparent transparent',
                  scrollbarWidth: 'thin',
                  '&::-webkit-scrollbar': { width: '6px' },
                  '&::-webkit-scrollbar-button, &::-webkit-scrollbar-button:single-button':
                    {
                      display: 'none',
                      height: 0,
                      width: 0,
                    },
                  '&::-webkit-scrollbar-track': {
                    backgroundColor: 'transparent',
                  },
                  '&::-webkit-scrollbar-thumb': {
                    backgroundColor: 'transparent',
                    backgroundClip: 'padding-box',
                    border: '1px solid transparent',
                    borderRadius: '999px',
                    minHeight: '40px',
                  },
                  '&:hover': {
                    scrollbarColor: `${alpha(theme.palette.text.secondary, 0.42)} transparent`,
                    '&::-webkit-scrollbar-thumb': {
                      backgroundColor: alpha(
                        theme.palette.text.secondary,
                        0.42
                      ),
                      backgroundClip: 'padding-box',
                    },
                    '&::-webkit-scrollbar-thumb:hover': {
                      backgroundColor: alpha(
                        theme.palette.text.secondary,
                        0.59
                      ),
                      backgroundClip: 'padding-box',
                    },
                  },
                }
              : undefined
          }
        >
          <Box
            sx={{
              height: virtualContentHeight,
              width: '100%',
            }}
          >
            <Box
              sx={{
                left: 0,
                position: 'absolute',
                top: 0,
                width: '100%',
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const index = virtualRow.index;
                const rowPayload = processedRows[index];
                if (!rowPayload) {
                  return (
                    <Box
                      key={virtualRow.index}
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '5px',
                        left: '50%',
                        padding: '10px 0',
                        position: 'absolute',
                        top: 0,
                        transform: `translateY(${virtualRow.start}px) translateX(-50%)`,
                        width: '100%',
                      }}
                    >
                      <Typography>
                        {t('core:message.error.message_loading', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>
                    </Box>
                  );
                }
                const {
                  message,
                  reply,
                  replyIndex,
                  replyExpiredMeta,
                  reactions,
                  isUpdating,
                } = rowPayload;
                const isGroupedWithPrevious =
                  reticulumChatEnabled &&
                  isReticulumMessageContinuation(
                    processedRows[index - 1]?.message,
                    message
                  );
                const rowKey = getMessageKey(
                  messages[virtualRow.index],
                  virtualRow.index
                );
                if (!message) {
                  return (
                    <Box
                      key={rowKey}
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '5px',
                        left: '50%',
                        padding: '10px 0',
                        position: 'absolute',
                        top: 0,
                        transform: `translateY(${virtualRow.start}px) translateX(-50%)`,
                        width: '100%',
                      }}
                    >
                      <Typography>
                        {t('core:message.error.message_loading', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>
                    </Box>
                  );
                }

                return (
                  <Box
                    data-index={virtualRow.index} //needed for dynamic row height measurement
                    ref={rowVirtualizer.measureElement} //measure dynamic row height
                    key={rowKey}
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '5px',
                      left: '50%', // Move to the center horizontally
                      overscrollBehavior: 'none',
                      padding: reticulumChatEnabled ? '3px 0' : '10px 0',
                      position: 'absolute',
                      top: 0,
                      transform: `translateY(${virtualRow.start}px) translateX(-50%)`, // Adjust for centering
                      width: '100%', // Control width (90% of the parent)
                    }}
                  >
                    <ErrorBoundary
                      fallback={
                        <Typography>
                          {t('group:message.generic.invalid_data', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </Typography>
                      }
                    >
                      {message?.directCallHistory ? (
                        <DirectCallHistoryRow
                          record={message.directCallHistory}
                        />
                      ) : message?.type === 'dm_friend_added' ||
                        message?.dmFriendEvent ? (
                        <DirectFriendEventRow
                          message={message}
                          myAddress={myAddress}
                        />
                      ) : (
                        <MessageItem
                          key={rowKey}
                          handleReaction={handleReaction}
                          isLast={index === messages.length - 1}
                          isGroupedWithPrevious={isGroupedWithPrevious}
                          isPrivate={isPrivate}
                          isScrollTarget={
                            highlightedMessageIndex === virtualRow.index
                          }
                          isTemp={!!message?.isTemp}
                          isUpdating={isUpdating}
                          lastSignature={lastSignature}
                          message={message}
                          myAddress={myAddress}
                          selectedGroup={selectedGroup}
                          secretKeyObject={secretKeyObject}
                          onEdit={onEdit}
                          onDelete={onDelete}
                          onReply={onReply}
                          onAcceptQchatFileTransfer={onAcceptQchatFileTransfer}
                          qchatFileTransferStates={qchatFileTransferStates}
                          qchatCompletedTransfers={qchatCompletedTransfers}
                          onSeen={handleMessageSeen}
                          reactions={reactions}
                          reply={reply}
                          replyIndex={replyIndex}
                          replyExpiredMeta={replyExpiredMeta}
                          reticulumChatEnabled={reticulumChatEnabled}
                          reticulumDiscussionReplyCount={
                            reticulumDiscussionReplyCounts?.[
                              String(message?.signature || '')
                            ] || 0
                          }
                          onOpenReticulumDiscussion={onOpenReticulumDiscussion}
                          reticulumGroupAvatarOwnerName={
                            reticulumGroupAvatarOwnerName
                          }
                          reticulumGroupDisplayName={reticulumGroupDisplayName}
                          reticulumMentionUsers={reticulumMentionUsers}
                          reticulumChannelLinkAccess={
                            reticulumChannelLinkAccess
                          }
                          reticulumMemberJoinedByAddress={
                            reticulumMemberJoinedByAddress
                          }
                          reticulumMemberRolesByAddress={
                            reticulumMemberRolesByAddress
                          }
                          reticulumMemberRolesReady={reticulumMemberRolesReady}
                          scrollToItem={goToMessage}
                        />
                      )}
                    </ErrorBoundary>
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Box>

        {(showScrollButton || hasNewerMessages) && (
          <Button
            onClick={() => void handleGoToLatest()}
            disabled={hasNewerMessages && isLoadingNewerMessages}
            startIcon={<KeyboardArrowDownRoundedIcon sx={{ fontSize: 20 }} />}
            sx={{
              ...scrollButtonSx,
              backgroundColor: theme.palette.primary.dark,
              color: theme.palette.primary.contrastText,
              border: `1px solid ${theme.palette.primary.main}`,
              '&:hover': {
                ...scrollButtonSx['&:hover'],
                backgroundColor: theme.palette.primary.main,
                color: theme.palette.primary.contrastText,
              },
            }}
          >
            {hasNewerMessages
              ? t('group:action.jump_latest', {
                  defaultValue: 'Jump to latest',
                  postProcess: 'capitalizeFirstChar',
                })
              : t('group:action.scroll_unread_messages', {
                  postProcess: 'capitalizeFirstChar',
                })}
          </Button>
        )}

        {showScrollDownButton &&
          !showScrollButton &&
          !hasNewerMessages &&
          (compactScrollButton ? (
            <Button
              onClick={() => void handleGoToLatest()}
              aria-label={t('group:action.scroll_bottom', {
                postProcess: 'capitalizeFirstChar',
              })}
              sx={scrollButtonCompactSx}
            >
              <KeyboardArrowDownRoundedIcon sx={{ fontSize: 22 }} />
            </Button>
          ) : (
            <Button
              onClick={() => void handleGoToLatest()}
              startIcon={<KeyboardArrowDownRoundedIcon sx={{ fontSize: 20 }} />}
              sx={scrollButtonSx}
            >
              {t('group:action.scroll_bottom', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
          ))}
      </Box>

      {enableMentions &&
        !reticulumChatEnabled &&
        (hasSecretKey || isPrivate === false) && (
          <ChatOptions
            goToMessage={goToMessage}
            isPrivate={isPrivate}
            members={members}
            messages={messages}
            myName={myName}
            openQManager={openQManager}
            reticulumChatEnabled={reticulumChatEnabled}
            selectedGroup={selectedGroup}
          />
        )}
    </Box>
  );
};
