import {
  Box,
  ButtonBase,
  Collapse,
  CircularProgress,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAtomValue } from 'jotai';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { userInfoAtom } from '../../atoms/global';
import { executeEvent } from '../../utils/events';
import type { WidgetDisplayMode } from './DashboardWidgetFrame';
import {
  QAppWidgetContainer,
  QAppWidgetStatePanel,
} from './QAppWidgetContainer';
import { QuitterFeedCard } from './quitter/QuitterFeedCard';
import {
  fetchQuitterFeedPage,
  fetchQuitterFollowedNames,
} from './quitter/quitterFeedApi';
import type {
  QuitterFeedItem,
  QuitterFeedPage,
} from './quitter/quitterFeedTypes';

type QuitterFeedWidgetProps = {
  batchSize?: number;
  displayMode?: WidgetDisplayMode;
  initialBatchSize?: number;
  onRefreshStateChange?: (refreshing: boolean) => void;
  refreshToken?: number;
  searchLimit?: number;
};

type InitialFeedState = 'error' | 'loading' | 'success';
type QuitterFeedMode = 'following' | 'general';
type FollowingEmptyReason = 'no-following' | 'no-name' | 'no-posts' | null;

const QUITTER_FEED_MODE_STORAGE_PREFIX = 'quitter_dashboard_feed_mode:';

const parseStoredQuitterFeedMode = (
  raw: string | null
): QuitterFeedMode | null =>
  raw === 'general' || raw === 'following' ? raw : null;

const readQuitterFeedMode = (storageKey: string): QuitterFeedMode => {
  if (typeof localStorage === 'undefined') return 'following';
  try {
    return parseStoredQuitterFeedMode(localStorage.getItem(storageKey)) ?? 'following';
  } catch {
    return 'following';
  }
};

const writeQuitterFeedMode = (storageKey: string, mode: QuitterFeedMode) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey, mode);
  } catch {
    // ignore quota / private mode
  }
};

const FOLLOWING_LOAD_TIMEOUT_MS = 40_000;
const FEED_POLL_INTERVAL_MS = 90_000;
const NEW_POST_REVEAL_DURATION_MS = 420;

class FeedLoadTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedLoadTimeoutError';
  }
}

const runAbortableTaskWithTimeout = async <T,>(
  signal: AbortSignal,
  timeoutMs: number,
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMessage: string
) => {
  const controller = new AbortController();
  let didTimeout = false;

  const handleAbort = () => {
    controller.abort();
  };

  if (signal.aborted) {
    controller.abort();
  } else {
    signal.addEventListener('abort', handleAbort, { once: true });
  }

  const timeoutId = window.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await task(controller.signal);
  } catch (error) {
    if (didTimeout) {
      throw new FeedLoadTimeoutError(timeoutMessage);
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    signal.removeEventListener('abort', handleAbort);
  }
};

const prependUniqueFeedItems = (
  incomingItems: QuitterFeedItem[],
  existingItems: QuitterFeedItem[]
) => {
  const mergedItems: QuitterFeedItem[] = [];
  const seenIds = new Set<string>();

  for (const item of incomingItems) {
    if (seenIds.has(item.id)) {
      continue;
    }

    seenIds.add(item.id);
    mergedItems.push(item);
  }

  for (const item of existingItems) {
    if (seenIds.has(item.id)) {
      continue;
    }

    seenIds.add(item.id);
    mergedItems.push(item);
  }

  return mergedItems;
};

export const QuitterFeedWidget = ({
  batchSize = 4,
  displayMode = 'compact',
  initialBatchSize = 6,
  onRefreshStateChange,
  refreshToken = 0,
  searchLimit = 8,
}: QuitterFeedWidgetProps) => {
  const theme = useTheme();
  const { t } = useTranslation('core');
  const userInfo = useAtomValue(userInfoAtom);
  const isCompact = displayMode === 'compact';
  const currentUserName =
    typeof userInfo?.name === 'string' && userInfo.name.trim().length > 0
      ? userInfo.name.trim()
      : null;
  const feedModeStorageKey = useMemo(() => {
    const addr =
      typeof userInfo?.address === 'string' &&
      userInfo.address.trim().length > 0
        ? userInfo.address.trim()
        : 'anonymous';
    return `${QUITTER_FEED_MODE_STORAGE_PREFIX}${addr}`;
  }, [userInfo?.address]);
  const [error, setError] = useState<string | null>(null);
  const [feedMode, setFeedMode] = useState<QuitterFeedMode>('following');
  const [followingEmptyReason, setFollowingEmptyReason] =
    useState<FollowingEmptyReason>(null);
  const [initialFeedState, setInitialFeedState] =
    useState<InitialFeedState>('loading');
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [items, setItems] = useState<QuitterFeedItem[]>([]);
  const [pendingItems, setPendingItems] = useState<QuitterFeedItem[]>([]);
  const [revealedItemIds, setRevealedItemIds] = useState<string[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const itemsRef = useRef<QuitterFeedItem[]>([]);
  const pendingItemsRef = useRef<QuitterFeedItem[]>([]);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const previousRefreshTokenRef = useRef(refreshToken);
  const activeFeedRequestIdRef = useRef(0);
  const activeUpdateRequestIdRef = useRef(0);
  const isUpdateCheckInFlightRef = useRef(false);
  const isFollowingFeed = feedMode === 'following';
  const loadedPostLabel = useMemo(
    () => t('quitter_feed.posts_showing', { count: items.length }),
    [items.length, t]
  );
  const pendingPostLabel = useMemo(
    () => t('quitter_feed.new_posts', { count: pendingItems.length }),
    [pendingItems.length, t]
  );
  const revealedItemIdSet = useMemo(
    () => new Set(revealedItemIds),
    [revealedItemIds]
  );

  const rowGapPx = isCompact ? 9 : 12;
  const scrollListBottomPadPx = 10;

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getItemKey: useCallback(
      (index: number) => items[index]?.id ?? String(index),
      [items]
    ),
    getScrollElement: () => scrollerRef.current,
    estimateSize: useCallback(() => (isCompact ? 220 : 285), [isCompact]),
    overscan: 6,
  });

  const feedKey = `${feedMode}:${currentUserName ?? ''}`;

  useEffect(() => {
    setFeedMode(readQuitterFeedMode(feedModeStorageKey));
  }, [feedModeStorageKey]);

  const commitVisibleItems = useCallback((nextItems: QuitterFeedItem[]) => {
    itemsRef.current = nextItems;
    setItems(nextItems);
  }, []);

  const commitPendingItems = useCallback((nextItems: QuitterFeedItem[]) => {
    pendingItemsRef.current = nextItems;
    setPendingItems(nextItems);
  }, []);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    pendingItemsRef.current = pendingItems;
  }, [pendingItems]);

  useEffect(() => {
    onRefreshStateChange?.(isRefreshing);
  }, [isRefreshing, onRefreshStateChange]);

  useEffect(
    () => () => {
      onRefreshStateChange?.(false);
    },
    [onRefreshStateChange]
  );

  useEffect(() => {
    if (revealedItemIds.length === 0) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setRevealedItemIds([]);
    }, NEW_POST_REVEAL_DURATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [revealedItemIds]);

  const fetchFeedPageForMode = useEffectEvent(
    async (
      signal: AbortSignal,
      options: {
        feedMode?: QuitterFeedMode;
        itemLimit?: number;
      } = {}
    ) => {
      const resolvedFeedMode = options.feedMode ?? feedMode;
      const requestedItemLimit = options.itemLimit ?? initialBatchSize;

      if (resolvedFeedMode === 'following' && currentUserName) {
        return runAbortableTaskWithTimeout(
          signal,
          FOLLOWING_LOAD_TIMEOUT_MS,
          async (timedSignal) => {
            const followedNames = await fetchQuitterFollowedNames(
              currentUserName,
              timedSignal
            );

            if (timedSignal.aborted) {
              return {
                hasMore: false,
                items: [],
                nextOffset: 0,
              };
            }

            return fetchQuitterFeedPage({
              allowedAuthors: followedNames,
              itemLimit: requestedItemLimit,
              offset: 0,
              searchLimit,
              signal: timedSignal,
            });
          },
          t('quitter_feed.error_timeout')
        );
      }

      if (resolvedFeedMode === 'following') {
        return {
          hasMore: false,
          items: [],
          nextOffset: 0,
        };
      }

      return fetchQuitterFeedPage({
        itemLimit: requestedItemLimit,
        offset: 0,
        searchLimit,
        signal,
      });
    }
  );

  const loadFeed = useEffectEvent(
    async (
      signal: AbortSignal,
      options: {
        feedMode?: QuitterFeedMode;
      } = {}
    ) => {
      const requestId = activeFeedRequestIdRef.current + 1;
      const resolvedFeedMode = options.feedMode ?? feedMode;

      activeFeedRequestIdRef.current = requestId;
      activeUpdateRequestIdRef.current = 0;
      isUpdateCheckInFlightRef.current = false;
      setError(null);
      setFollowingEmptyReason(null);
      setInitialFeedState('loading');
      setIsInitialLoading(true);
      setIsRefreshing(false);

      try {
        let nextPage: QuitterFeedPage;
        let nextFollowingEmptyReason: FollowingEmptyReason = null;

        if (resolvedFeedMode === 'following') {
          if (!currentUserName) {
            nextPage = {
              hasMore: false,
              items: [],
              nextOffset: 0,
            };
            nextFollowingEmptyReason = 'no-name';
          } else {
            const followingResult = await runAbortableTaskWithTimeout(
              signal,
              FOLLOWING_LOAD_TIMEOUT_MS,
              async (timedSignal) => {
                const followedNames = await fetchQuitterFollowedNames(
                  currentUserName,
                  timedSignal
                );

                if (timedSignal.aborted) {
                  return {
                    followedCount: followedNames.length,
                    page: {
                      hasMore: false,
                      items: [],
                      nextOffset: 0,
                    },
                  };
                }

                const page = await fetchQuitterFeedPage({
                  allowedAuthors: followedNames,
                  itemLimit: initialBatchSize,
                  offset: 0,
                  searchLimit,
                  signal: timedSignal,
                });

                return {
                  followedCount: followedNames.length,
                  page,
                };
              },
              t('quitter_feed.error_timeout')
            );

            nextPage = followingResult.page;
            nextFollowingEmptyReason =
              followingResult.followedCount === 0
                ? 'no-following'
                : followingResult.page.items.length === 0
                  ? 'no-posts'
                  : null;
          }
        } else {
          nextPage = await fetchFeedPageForMode(signal, {
            feedMode: resolvedFeedMode,
            itemLimit: initialBatchSize,
          });
        }

        if (signal.aborted || activeFeedRequestIdRef.current !== requestId) {
          return;
        }

        commitVisibleItems(nextPage.items);
        commitPendingItems([]);
        setFollowingEmptyReason(nextFollowingEmptyReason);
        setInitialFeedState('success');
      } catch (error) {
        if (signal.aborted || activeFeedRequestIdRef.current !== requestId) {
          return;
        }

        console.error('Failed to load Quitter feed widget', error);
        commitVisibleItems([]);
        commitPendingItems([]);
        setFollowingEmptyReason(null);
        setInitialFeedState('error');
        setError(
          error instanceof FeedLoadTimeoutError
            ? error.message
            : resolvedFeedMode === 'following'
              ? t('quitter_feed.error_following')
              : t('quitter_feed.error_generic')
        );
      } finally {
        if (activeFeedRequestIdRef.current === requestId) {
          setIsInitialLoading(false);
        }
      }
    }
  );

  const checkForNewPosts = useEffectEvent(
    async (
      signal: AbortSignal,
      options: {
        feedMode?: QuitterFeedMode;
        showRefreshIndicator?: boolean;
      } = {}
    ) => {
      if (isInitialLoading || itemsRef.current.length === 0) {
        return;
      }

      if (isUpdateCheckInFlightRef.current) {
        return;
      }

      const requestId = activeUpdateRequestIdRef.current + 1;
      const resolvedFeedMode = options.feedMode ?? feedMode;
      const showRefreshIndicator = !!options.showRefreshIndicator;
      const pollItemLimit = Math.min(
        Math.max(initialBatchSize, batchSize) +
          Math.min(pendingItemsRef.current.length, 6) +
          2,
        18
      );

      activeUpdateRequestIdRef.current = requestId;
      isUpdateCheckInFlightRef.current = true;

      if (showRefreshIndicator) {
        setIsRefreshing(true);
      }

      try {
        const nextPage = await fetchFeedPageForMode(signal, {
          feedMode: resolvedFeedMode,
          itemLimit: pollItemLimit,
        });

        if (signal.aborted || activeUpdateRequestIdRef.current !== requestId) {
          return;
        }

        const knownIds = new Set([
          ...itemsRef.current.map((item) => item.id),
          ...pendingItemsRef.current.map((item) => item.id),
        ]);
        const currentTopItemId = itemsRef.current[0]?.id ?? null;
        const firstKnownIndex = nextPage.items.findIndex((item) =>
          knownIds.has(item.id)
        );
        const currentTopIndex = currentTopItemId
          ? nextPage.items.findIndex((item) => item.id === currentTopItemId)
          : -1;
        const cutoffIndex =
          currentTopIndex >= 0
            ? currentTopIndex
            : firstKnownIndex >= 0
              ? firstKnownIndex
              : nextPage.items.length;
        const nextPendingItems = nextPage.items
          .slice(0, cutoffIndex)
          .filter((item) => !knownIds.has(item.id));

        if (nextPendingItems.length === 0) {
          return;
        }

        commitPendingItems(
          prependUniqueFeedItems(nextPendingItems, pendingItemsRef.current)
        );
      } catch (error) {
        if (signal.aborted || activeUpdateRequestIdRef.current !== requestId) {
          return;
        }

        console.error('Failed to refresh Quitter feed widget', error);
      } finally {
        if (activeUpdateRequestIdRef.current === requestId) {
          isUpdateCheckInFlightRef.current = false;

          if (showRefreshIndicator) {
            setIsRefreshing(false);
          }
        }
      }
    }
  );

  useEffect(() => {
    const controller = new AbortController();

    previousRefreshTokenRef.current = refreshToken;
    commitVisibleItems([]);
    commitPendingItems([]);
    setRevealedItemIds([]);
    setError(null);

    void loadFeed(controller.signal, {
      feedMode,
    });

    return () => {
      controller.abort();
    };
  }, [commitPendingItems, commitVisibleItems, feedKey, feedMode, reloadToken]);

  useEffect(() => {
    if (refreshToken <= previousRefreshTokenRef.current) {
      return undefined;
    }

    previousRefreshTokenRef.current = refreshToken;

    if (isInitialLoading || initialFeedState === 'loading') {
      return undefined;
    }

    if (itemsRef.current.length === 0) {
      setReloadToken((value) => value + 1);
      return undefined;
    }

    const controller = new AbortController();

    void checkForNewPosts(controller.signal, {
      feedMode,
      showRefreshIndicator: true,
    });

    return () => {
      controller.abort();
    };
  }, [feedMode, initialFeedState, isInitialLoading, refreshToken]);

  useEffect(() => {
    if (initialFeedState !== 'success' || items.length === 0) {
      return undefined;
    }

    let isCancelled = false;
    let timeoutId: number | null = null;
    let activeController: AbortController | null = null;

    const scheduleNextPoll = () => {
      if (isCancelled) {
        return;
      }

      timeoutId = window.setTimeout(() => {
        if (isCancelled) {
          return;
        }

        activeController = new AbortController();

        void checkForNewPosts(activeController.signal, {
          feedMode,
        }).finally(() => {
          activeController = null;
          scheduleNextPoll();
        });
      }, FEED_POLL_INTERVAL_MS);
    };

    scheduleNextPoll();

    return () => {
      isCancelled = true;

      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }

      activeController?.abort();
    };
  }, [feedMode, initialFeedState, items.length]);

  const handleOpenPost = useCallback((item: QuitterFeedItem) => {
    executeEvent('addTab', {
      data: {
        identifier: '',
        name: 'Quitter',
        path: `post/${encodeURIComponent(item.author)}/${encodeURIComponent(item.identifier)}`,
        service: 'APP',
      },
    });
    executeEvent('open-apps-mode', {});
  }, []);

  const handleApplyPendingPosts = useCallback(() => {
    const nextPendingItems = pendingItemsRef.current;

    if (nextPendingItems.length === 0) {
      return;
    }

    const scrollNode = scrollerRef.current;
    const previousScrollTop = scrollNode?.scrollTop ?? 0;
    const previousScrollHeight = scrollNode?.scrollHeight ?? 0;
    const shouldPreserveViewport = previousScrollTop > 24;
    const nextVisibleItems = prependUniqueFeedItems(
      nextPendingItems,
      itemsRef.current
    );
    const nextRevealedIds = nextPendingItems.map((item) => item.id);

    commitPendingItems([]);
    commitVisibleItems(nextVisibleItems);
    setRevealedItemIds(nextRevealedIds);

    if (
      shouldPreserveViewport &&
      typeof window !== 'undefined' &&
      typeof window.requestAnimationFrame === 'function'
    ) {
      window.requestAnimationFrame(() => {
        const nextScrollNode = scrollerRef.current;

        if (!nextScrollNode) {
          return;
        }

        const scrollDelta = nextScrollNode.scrollHeight - previousScrollHeight;
        nextScrollNode.scrollTop = previousScrollTop + Math.max(scrollDelta, 0);
      });
    }
  }, [commitPendingItems, commitVisibleItems]);

  const showInitialLoadingState = isInitialLoading && items.length === 0;
  const showInitialErrorState =
    !isInitialLoading && initialFeedState === 'error' && items.length === 0;
  const showEmptyState =
    !isInitialLoading && initialFeedState === 'success' && items.length === 0;

  const handleRetryInitialFeed = useCallback(() => {
    setError(null);
    commitPendingItems([]);
    commitVisibleItems([]);
    setInitialFeedState('loading');
    setIsInitialLoading(true);
    setReloadToken((value) => value + 1);
  }, [commitPendingItems, commitVisibleItems]);

  const handleSelectFollowingFeed = useCallback(() => {
    if (feedMode === 'following') {
      return;
    }

    setFeedMode('following');
    writeQuitterFeedMode(feedModeStorageKey, 'following');
  }, [feedMode, feedModeStorageKey]);

  const handleSelectGeneralFeed = useCallback(() => {
    setFeedMode('general');
    writeQuitterFeedMode(feedModeStorageKey, 'general');
  }, [feedModeStorageKey]);

  const loadingLabel = useMemo(
    () =>
      isFollowingFeed
        ? t('quitter_feed.loading_following')
        : t('quitter_feed.loading_general'),
    [isFollowingFeed, t]
  );

  const errorTitle = useMemo(
    () =>
      isFollowingFeed
        ? t('quitter_feed.error_title_following')
        : t('quitter_feed.error_title_general'),
    [isFollowingFeed, t]
  );

  const emptyTitle = useMemo(() => {
    if (!isFollowingFeed) {
      return t('quitter_feed.empty_title_general');
    }
    if (followingEmptyReason === 'no-name') {
      return t('quitter_feed.empty_title_no_name');
    }
    if (followingEmptyReason === 'no-following') {
      return t('quitter_feed.empty_title_no_following');
    }
    return t('quitter_feed.empty_title_no_posts');
  }, [followingEmptyReason, isFollowingFeed, t]);

  const emptyMessage = useMemo(() => {
    if (!isFollowingFeed) {
      return null;
    }
    if (followingEmptyReason === 'no-name') {
      return t('quitter_feed.empty_message_no_name');
    }
    if (followingEmptyReason === 'no-following') {
      return t('quitter_feed.empty_message_no_following');
    }
    return t('quitter_feed.empty_message_no_posts');
  }, [followingEmptyReason, isFollowingFeed, t]);
  const showStatePanel =
    showInitialLoadingState || showInitialErrorState || showEmptyState;
  const segmentedToggleSx = {
    alignItems: 'center',
    borderRadius: '999px',
    display: 'inline-flex',
    fontSize: '0.69rem',
    fontWeight: 700,
    minHeight: '28px',
    px: 1.25,
    transition:
      'background-color 140ms ease, border-color 140ms ease, color 140ms ease',
    whiteSpace: 'nowrap',
  } as const;

  return (
    <>
      <QAppWidgetContainer hasContent>
        <Box
          sx={{
            display: 'flex',
            flex: '1 1 auto',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexShrink: 0,
              gap: '8px',
              justifyContent: 'space-between',
              mt: '-3px',
              pb: '8px',
            }}
          >
            <Box
              sx={{
                alignItems: 'center',
                backgroundColor:
                  theme.palette.mode === 'dark'
                    ? alpha(theme.palette.common.white, 0.04)
                    : alpha(theme.palette.text.primary, 0.04),
                border: `1px solid ${alpha(
                  theme.palette.border.main,
                  theme.palette.mode === 'dark' ? 0.16 : 0.1
                )}`,
                borderRadius: '999px',
                display: 'inline-flex',
                gap: '4px',
                p: '2px',
              }}
            >
              <ButtonBase
                disableRipple
                onClick={handleSelectGeneralFeed}
                sx={{
                  ...segmentedToggleSx,
                  backgroundColor:
                    feedMode === 'general'
                      ? alpha(theme.palette.primary.main, 0.18)
                      : 'transparent',
                  border: `1px solid ${alpha(
                    theme.palette.border.main,
                    feedMode === 'general'
                      ? theme.palette.mode === 'dark'
                        ? 0.28
                        : 0.18
                      : 0
                  )}`,
                  color:
                    feedMode === 'general'
                      ? theme.palette.text.primary
                      : theme.palette.text.secondary,
                }}
              >
                {t('quitter_feed.tab_general')}
              </ButtonBase>
              <ButtonBase
                disableRipple
                onClick={handleSelectFollowingFeed}
                sx={{
                  ...segmentedToggleSx,
                  backgroundColor:
                    feedMode === 'following'
                      ? alpha(theme.palette.primary.main, 0.18)
                      : 'transparent',
                  border: `1px solid ${alpha(
                    theme.palette.border.main,
                    feedMode === 'following'
                      ? theme.palette.mode === 'dark'
                        ? 0.28
                        : 0.18
                      : 0
                  )}`,
                  color:
                    feedMode === 'following'
                      ? theme.palette.text.primary
                      : theme.palette.text.secondary,
                }}
              >
                {t('quitter_feed.tab_following')}
              </ButtonBase>
            </Box>
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.67rem',
                fontWeight: 600,
                letterSpacing: '0.01em',
                whiteSpace: 'nowrap',
              }}
            >
              {feedMode === 'following'
                ? t('quitter_feed.subtitle_personalized')
                : t('quitter_feed.subtitle_public')}
            </Typography>
          </Box>

          {!showStatePanel && items.length > 0 ? (
            <Collapse in={pendingItems.length > 0} mountOnEnter unmountOnExit>
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'center',
                  mb: '26px',
                  mt: '-15px',
                  width: '100%',
                }}
              >
                <ButtonBase
                  disableRipple
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleApplyPendingPosts();
                  }}
                  sx={{
                    alignItems: 'center',
                    animation:
                      'quitterNewPostsThresholdFade 5.8s ease-in-out infinite',
                    display: 'inline-flex',
                    gap: '9px',
                    maxWidth: '100%',
                    position: 'relative',
                    px: '4px',
                    py: '2px',
                    zIndex: 1,
                    '@keyframes quitterNewPostsThresholdFade': {
                      '0%, 100%': {
                        opacity: 0.84,
                      },
                      '50%': {
                        opacity: 1,
                      },
                    },
                    '&:hover': {
                      opacity: 1,
                    },
                  }}
                >
                  <Box
                    sx={{
                      background: `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0)} 0%, ${alpha(theme.palette.primary.main, 0.07)} 100%)`,
                      flexShrink: 0,
                      height: '1px',
                      width: '26px',
                    }}
                  />
                  <Typography
                    sx={{
                      alignItems: 'center',
                      color: alpha(theme.palette.text.primary, 0.9),
                      display: 'inline-flex',
                      flexShrink: 0,
                      fontSize: '0.73rem',
                      fontWeight: 760,
                      gap: '7px',
                      justifyContent: 'center',
                      letterSpacing: '0.01em',
                      lineHeight: 1.2,
                    }}
                  >
                    <Box
                      component="span"
                      sx={{
                        animation:
                          'quitterNewPostsDotBreathe 4.4s ease-in-out infinite',
                        bgcolor: alpha(theme.palette.primary.main, 0.96),
                        borderRadius: '50%',
                        display: 'inline-block',
                        flexShrink: 0,
                        height: 6,
                        width: 6,
                        '@keyframes quitterNewPostsDotBreathe': {
                          '0%, 100%': {
                            opacity: 0.86,
                            transform: 'scale(0.86)',
                          },
                          '50%': {
                            opacity: 1,
                            transform: 'scale(1.12)',
                          },
                        },
                      }}
                    />
                    {pendingPostLabel}
                  </Typography>
                  <Box
                    sx={{
                      background: `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.07)} 0%, ${alpha(theme.palette.primary.main, 0)} 100%)`,
                      flexShrink: 0,
                      height: '1px',
                      width: '26px',
                    }}
                  />
                </ButtonBase>
              </Box>
            </Collapse>
          ) : null}

          {showStatePanel ? (
            <QAppWidgetStatePanel
              description={
                showInitialErrorState
                  ? error
                  : showEmptyState
                    ? emptyMessage
                    : null
              }
              loadingLabel={showInitialLoadingState ? loadingLabel : undefined}
              onRetry={
                showInitialErrorState ? handleRetryInitialFeed : undefined
              }
              onSecondaryAction={
                (showInitialErrorState || showEmptyState) && isFollowingFeed
                  ? handleSelectGeneralFeed
                  : undefined
              }
              retryLabel={
                isFollowingFeed
                  ? t('quitter_feed.retry_following')
                  : t('quitter_feed.retry_general')
              }
              secondaryActionLabel={
                (showInitialErrorState || showEmptyState) && isFollowingFeed
                  ? t('quitter_feed.return_to_general')
                  : undefined
              }
              title={
                showInitialLoadingState
                  ? loadingLabel
                  : showInitialErrorState
                    ? errorTitle
                    : emptyTitle
              }
            />
          ) : (
            <>
              <Box
                ref={scrollerRef}
                sx={{
                  flex: '1 1 auto',
                  minHeight: 0,
                  // Avoid browser scroll anchoring fighting virtual row layout / height totals.
                  overflowAnchor: 'none',
                  overflowY: 'auto',
                  pr: '2px',
                  scrollbarColor: `${alpha(theme.palette.text.secondary, 0.3)} transparent`,
                  scrollbarWidth: 'thin',
                  '&::-webkit-scrollbar': {
                    width: '10px',
                  },
                  '&::-webkit-scrollbar-thumb': {
                    backgroundClip: 'padding-box',
                    backgroundColor: alpha(theme.palette.text.secondary, 0.24),
                    border: '3px solid transparent',
                    borderRadius: '999px',
                  },
                }}
              >
                <Box
                  sx={{
                    height:
                      rowVirtualizer.getTotalSize() + scrollListBottomPadPx,
                    position: 'relative',
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
                      const item = items[virtualRow.index];
                      if (!item) {
                        return null;
                      }

                      const revealSx = revealedItemIdSet.has(item.id)
                        ? {
                            '@keyframes quitterFeedInsert': {
                              '0%': {
                                opacity: 0,
                                transform: 'translateY(-6px)',
                              },
                              '100%': {
                                opacity: 1,
                                transform: 'translateY(0)',
                              },
                            },
                            animation: 'quitterFeedInsert 280ms ease both',
                          }
                        : undefined;

                      return (
                        <Box
                          key={virtualRow.key}
                          data-index={virtualRow.index}
                          ref={rowVirtualizer.measureElement}
                          sx={{
                            boxSizing: 'border-box',
                            left: 0,
                            paddingBottom:
                              virtualRow.index < items.length - 1
                                ? `${rowGapPx}px`
                                : 0,
                            position: 'absolute',
                            top: 0,
                            transform: `translate3d(0, ${virtualRow.start}px, 0)`,
                            width: '100%',
                          }}
                        >
                          <Box sx={revealSx}>
                            <QuitterFeedCard
                              displayMode={displayMode}
                              item={item}
                              onOpen={() => {
                                handleOpenPost(item);
                              }}
                            />
                          </Box>
                        </Box>
                      );
                    })}
                  </Box>
                </Box>
              </Box>
              {items.length > 0 && (
                <Box
                  data-quitters-footer="true"
                  sx={{
                    alignItems: 'center',
                    borderTop: `1px solid ${alpha(
                      theme.palette.border.main,
                      theme.palette.mode === 'dark' ? 0.18 : 0.1
                    )}`,
                    display: 'flex',
                    flexShrink: 0,
                    gap: '8px',
                    justifyContent: 'flex-start',
                    mx: '-8px',
                    mb: '-8px',
                    mt: 0,
                    pb: '10px',
                    pt: '10px',
                    px: '8px',
                  }}
                >
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'inline-flex',
                      gap: '7px',
                      minWidth: 0,
                    }}
                  >
                    {isRefreshing ? (
                      <CircularProgress
                        size={13}
                        sx={{
                          color: theme.palette.text.secondary,
                          flexShrink: 0,
                        }}
                      />
                    ) : (
                      <Box
                        sx={{
                          bgcolor: alpha(theme.palette.primary.main, 0.68),
                          borderRadius: '50%',
                          flexShrink: 0,
                          height: 6,
                          width: 6,
                        }}
                      />
                    )}
                    <Typography
                      sx={{
                        color: isRefreshing
                          ? theme.palette.text.primary
                          : theme.palette.text.secondary,
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        letterSpacing: '0.01em',
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {loadedPostLabel}
                    </Typography>
                  </Box>
                </Box>
              )}
            </>
          )}
        </Box>
      </QAppWidgetContainer>
    </>
  );
};
