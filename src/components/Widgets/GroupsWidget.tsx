import CampaignRoundedIcon from '@mui/icons-material/CampaignRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import GroupAddRoundedIcon from '@mui/icons-material/GroupAddRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import MarkChatUnreadRoundedIcon from '@mui/icons-material/MarkChatUnreadRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { LoadingButton } from '@mui/lab';
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Select,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAtom, useAtomValue } from 'jotai';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  QORTAL_APP_CONTEXT,
  getArbitraryEndpointReact,
  getBaseApiReact,
} from '../../App';
import {
  GROUP_ACTIVITY_CACHE_TTL_MS,
  groupChatTimestampsAtom,
  groupInvitesCacheAtom,
  groupsOwnerNamesAtom,
  joinRequestsCacheAtom,
  memberGroupsAtom,
  myGroupsWhereIAmAdminAtom,
  timestampEnterDataAtom,
  userInfoAtom,
} from '../../atoms/global';
import { getFee } from '../../background/background';
import { executeEvent } from '../../utils/events';
import { formatTimestamp } from '../../utils/time';
import {
  APP_BLUE_SURFACE_TEXT,
  getBlueTier1ButtonSx,
  getBlueTier1PillSurface,
} from '../Group/groupActivityColorSystem';
import { GroupActivityEmptyStateGraphic } from '../Group/GroupActivityEmptyStateGraphic';
import { QAppWidgetContainer } from './QAppWidgetContainer';
import type { WidgetDisplayMode } from './DashboardWidgetFrame';

type GroupsWidgetTab = 'notifications' | 'invites' | 'requests' | 'promoted';

type GroupsWidgetProps = {
  displayMode: WidgetDisplayMode;
  myAddress: string;
  onRefreshStateChange?: (refreshing: boolean) => void;
  refreshToken?: number;
};

type GroupNotificationItem = {
  avatarUrl: string | null;
  groupId: string;
  groupName: string;
  id: string;
  isEncryptedLike: boolean;
  isUnread: boolean;
  openedAt: number;
  senderLabel: string;
  snippet: string;
  timestamp: number;
};

const sortGroupNotificationItems = (
  left: GroupNotificationItem,
  right: GroupNotificationItem
) => {
  if (left.isUnread !== right.isUnread) {
    return left.isUnread ? -1 : 1;
  }

  if (left.isUnread && right.isUnread) {
    return right.timestamp - left.timestamp;
  }

  if (left.openedAt !== right.openedAt) {
    return left.openedAt - right.openedAt;
  }

  return right.timestamp - left.timestamp;
};

type GroupInviteItem = {
  description?: string;
  groupId: number;
  groupName: string;
  id: string;
  isOpen?: boolean;
  participantCount?: number;
};

type GroupJoinRequestItem = {
  groupId: number;
  groupName: string;
  id: string;
  joiner: string;
  requesterLabel: string;
};

type GroupPromotionItem = {
  created: number;
  description?: string;
  groupId: number;
  groupName: string;
  id: string;
  isOpen?: boolean;
  memberCount?: number;
  promoterName: string;
  snippet: string;
};

type GroupPromotionVisualState =
  | 'connecting'
  | 'join'
  | 'member'
  | 'processing'
  | 'request'
  | 'request_sent';

type PromotionActionState = 'connecting' | 'processing' | 'request_sent';

const GROUP_PROMOTION_IDENTIFIER_PREFIX = 'group-promotions-ui24-';
const GROUP_PROMOTION_MAX_ITEMS = 8;
const GROUP_NOTIFICATION_PREVIEW_LIMIT = 20;
const GROUP_ACTIVITY_MISC_STORAGE_PREFIX = 'group_activity_dismissed';
/** Latest chat payload to omit from Group Activity list + unread count (system/meta). */
const GROUP_ACTIVITY_EXCLUDED_MESSAGE_DATA = 'NDAwMQ==';
const GROUP_WIDGET_CARD_RADIUS = '10px';

const getDismissedStorageKey = (
  address: string,
  type: 'invites' | 'requests'
) => `${GROUP_ACTIVITY_MISC_STORAGE_PREFIX}:${address}:${type}`;

const normalizeStoredIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.filter((id): id is string => typeof id === 'string' && !!id))
  );
};

const loadMiscStoredIds = async (key: string): Promise<string[]> => {
  if (typeof window === 'undefined') return [];
  try {
    if (window.miscStorage) {
      return normalizeStoredIds(await window.miscStorage.get(key));
    }
    const raw = window.localStorage?.getItem(key);
    return normalizeStoredIds(raw ? JSON.parse(raw) : []);
  } catch (error) {
    console.error('[GroupsWidget] Failed to load dismissed ids:', error);
    return [];
  }
};

const saveMiscStoredIds = async (key: string, ids: string[]): Promise<void> => {
  if (typeof window === 'undefined') return;
  const nextIds = normalizeStoredIds(ids);
  try {
    if (window.miscStorage) {
      await window.miscStorage.set(key, nextIds);
      return;
    }
    window.localStorage?.setItem(key, JSON.stringify(nextIds));
  } catch (error) {
    console.error('[GroupsWidget] Failed to save dismissed ids:', error);
  }
};

const stripHtml = (value: string) =>
  value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const truncateAddress = (value: string) =>
  value.length > 14 ? `${value.slice(0, 7)}...${value.slice(-5)}` : value;

const getGroupAvatarUrl = (
  ownerName: string | null,
  groupId: string | number
) =>
  ownerName
    ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${encodeURIComponent(ownerName)}/qortal_group_avatar_${groupId}?async=true`
    : null;

const normalizeSnippet = (value: unknown, fallback: string) => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const cleaned = stripHtml(value);
  return cleaned || fallback;
};

const isLikelyEncryptedSnippet = (value: unknown) => {
  if (typeof value !== 'string') {
    return false;
  }

  const cleaned = stripHtml(value).trim();

  if (cleaned.length < 48) {
    return false;
  }

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const compressed = cleaned.replace(/\s+/g, '');
  const base64LikeChars = compressed.match(/[A-Za-z0-9+/=._-]/g)?.length ?? 0;
  const base64LikeRatio =
    compressed.length > 0 ? base64LikeChars / compressed.length : 0;
  const longestTokenLength = tokens.reduce(
    (maxLength, token) => Math.max(maxLength, token.length),
    0
  );
  const averageTokenLength =
    tokens.length > 0
      ? tokens.reduce((sum, token) => sum + token.length, 0) / tokens.length
      : 0;

  return (
    base64LikeRatio >= 0.9 &&
    longestTokenLength >= 32 &&
    (tokens.length <= 3 || averageTokenLength >= 18)
  );
};

const getGroupInfo = async (groupId: number) => {
  const response = await fetch(`${getBaseApiReact()}/groups/${groupId}`);

  if (!response.ok) {
    throw new Error(`Unable to load group ${groupId} (${response.status})`);
  }

  return response.json();
};

const hydrateGroupsWithNames = async <T extends { groupId: number }>(
  groups: T[]
) => {
  const uniqueGroupIds = [...new Set(groups.map((group) => group.groupId))];
  const groupInfoEntries = await Promise.all(
    uniqueGroupIds.map(async (groupId) => {
      try {
        const groupInfo = await getGroupInfo(groupId);
        return [groupId, groupInfo] as const;
      } catch (error) {
        console.error('Failed to hydrate group metadata for widget', error);
        return [groupId, null] as const;
      }
    })
  );
  const groupInfoById = new Map(groupInfoEntries);

  return groups.map((group) => ({
    ...group,
    ...(groupInfoById.get(group.groupId) ?? {}),
  }));
};

const utf8ToBase64 = (input: string) =>
  btoa(
    encodeURIComponent(input).replace(/%([0-9A-F]{2})/g, (_, code) =>
      String.fromCharCode(Number(`0x${code}`))
    )
  );

const TabButton = ({
  active,
  count,
  label,
  onClick,
  tabId,
  subtle = false,
}: {
  active: boolean;
  count?: number;
  label: string;
  onClick: () => void;
  tabId: GroupsWidgetTab;
  subtle?: boolean;
}) => {
  const theme = useTheme();
  const shouldPulseAttention =
    !active &&
    tabId === 'notifications' &&
    typeof count === 'number' &&
    count > 0;

  return (
    <ButtonBase
      aria-pressed={active}
      aria-selected={active}
      data-active={active ? 'true' : 'false'}
      data-groups-tab={tabId}
      onClick={onClick}
      role="tab"
      sx={{
        alignItems: 'center',
        ...(active ? getBlueTier1PillSurface(theme) : {}),
        backgroundColor: active
          ? undefined
          : alpha(
              theme.palette.text.primary,
              subtle
                ? theme.palette.mode === 'dark'
                  ? 0.026
                  : 0.018
                : theme.palette.mode === 'dark'
                  ? 0.038
                  : 0.024
            ),
        border: `1px solid ${alpha(
          theme.palette.border.main,
          active ? 0.18 : theme.palette.mode === 'dark' ? 0.11 : 0.08
        )}`,
        borderRadius: '999px',
        color: active ? APP_BLUE_SURFACE_TEXT : theme.palette.text.secondary,
        display: 'inline-flex',
        flexShrink: 0,
        fontSize: subtle ? '0.69rem' : '0.72rem',
        fontWeight: active ? 700 : subtle ? 500 : 600,
        gap: '6px',
        minHeight: subtle ? '28px' : '30px',
        opacity: active ? 1 : subtle ? 0.7 : 0.78,
        outline: 'none',
        pointerEvents: 'auto',
        px: subtle ? 1 : 1.2,
        cursor: 'pointer',
        overflow: 'hidden',
        position: 'relative',
        ...(shouldPulseAttention
          ? {
              '@keyframes groupsNotificationsPillInnerGlow': {
                '0%, 100%': {
                  boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.12 : 0.09)}`,
                },
                '50%': {
                  boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.13)}, inset 0 0 18px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.12)}`,
                },
              },
              '@keyframes groupsNotificationsPillInnerVeil': {
                '0%, 100%': {
                  opacity: theme.palette.mode === 'dark' ? 0.24 : 0.18,
                },
                '50%': {
                  opacity: theme.palette.mode === 'dark' ? 0.46 : 0.34,
                },
              },
              animation:
                'groupsNotificationsPillInnerGlow 3.6s ease-in-out infinite',
              '&::before': {
                animation:
                  'groupsNotificationsPillInnerVeil 3.6s ease-in-out infinite',
                background: `radial-gradient(circle at 50% 50%, ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.12)} 0%, ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.08 : 0.06)} 58%, transparent 100%)`,
                borderRadius: 'inherit',
                content: '""',
                inset: '1px',
                pointerEvents: 'none',
                position: 'absolute',
                zIndex: 0,
              },
            }
          : null),
        transition:
          'background-color 140ms ease, color 140ms ease, transform 120ms ease, box-shadow 140ms ease, border-color 140ms ease',
        zIndex: 1,
        whiteSpace: 'nowrap',
        '& > *': {
          position: 'relative',
          zIndex: 1,
        },
        '&:hover': {
          ...(active ? getBlueTier1PillSurface(theme) : {}),
          backgroundColor: active
            ? undefined
            : alpha(
                theme.palette.text.primary,
                theme.palette.mode === 'dark' ? 0.052 : 0.038
              ),
          borderColor: alpha(
            theme.palette.border.main,
            theme.palette.mode === 'dark' ? 0.2 : 0.14
          ),
          color: active ? APP_BLUE_SURFACE_TEXT : theme.palette.text.primary,
          opacity: 1,
          transform: 'translateY(-1px)',
        },
        '&:active': {
          transform: 'translateY(0)',
        },
        '&:focus-visible': {
          borderColor: alpha(theme.palette.primary.main, 0.48),
          boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.18)}`,
          color: active ? APP_BLUE_SURFACE_TEXT : theme.palette.text.primary,
        },
      }}
    >
      <Box component="span">{label}</Box>
      {typeof count === 'number' && count > 0 ? (
        <Box
          component="span"
          sx={{
            alignItems: 'center',
            backgroundColor: active
              ? alpha(theme.palette.common.white, 0.18)
              : alpha(theme.palette.primary.main, 0.12),
            borderRadius: '999px',
            color: active
              ? theme.palette.primary.contrastText
              : theme.palette.primary.main,
            display: 'inline-flex',
            fontSize: '0.64rem',
            fontWeight: 800,
            height: 16,
            justifyContent: 'center',
            minWidth: 16,
            px: '4px',
          }}
        >
          {count}
        </Box>
      ) : null}
    </ButtonBase>
  );
};

const IllustratedEmptyState = ({
  actionLabel,
  compact = false,
  description,
  onAction,
  title,
  variant,
}: {
  actionLabel: string;
  compact?: boolean;
  description: string;
  onAction: () => void;
  title: string;
  variant: 'invites' | 'requests';
}) => {
  const theme = useTheme();

  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flex: '1 1 auto',
        flexDirection: 'column',
        justifyContent: 'center',
        minHeight: 0,
        px: 2,
        py: compact ? 2.25 : 2.75,
        textAlign: 'center',
      }}
    >
      <GroupActivityEmptyStateGraphic
        size={compact ? 176 : 198}
        sx={{
          filter: 'none',
          margin: '0 auto 8px',
          opacity: theme.palette.mode === 'dark' ? 0.94 : 0.88,
        }}
        variant={variant}
      />
      <Typography
        sx={{
          color: theme.palette.text.primary,
          fontSize: compact ? '0.92rem' : '0.96rem',
          fontWeight: 700,
          letterSpacing: '-0.01em',
          maxWidth: '18ch',
        }}
      >
        {title}
      </Typography>
      <Typography
        sx={{
          color: theme.palette.text.secondary,
          fontSize: compact ? '0.73rem' : '0.76rem',
          lineHeight: 1.55,
          maxWidth: '30ch',
          mt: '5px',
        }}
      >
        {description}
      </Typography>
      <ButtonBase
        onClick={onAction}
        sx={{
          alignItems: 'center',
          border: `1px solid ${alpha(
            theme.palette.border.main,
            theme.palette.mode === 'dark' ? 0.26 : 0.16
          )}`,
          borderRadius: '999px',
          color: theme.palette.text.secondary,
          display: 'inline-flex',
          fontSize: '0.7rem',
          fontWeight: 700,
          minHeight: '30px',
          mt: '12px',
          px: 1.4,
          '&:hover': {
            backgroundColor: theme.palette.action.hover,
            color: theme.palette.text.primary,
          },
        }}
      >
        {actionLabel}
      </ButtonBase>
    </Box>
  );
};

const InlineFeedback = ({
  message,
  tone,
}: {
  message: string;
  tone: 'error' | 'success';
}) => {
  const theme = useTheme();

  return (
    <Box
      sx={{
        backgroundColor:
          tone === 'success'
            ? alpha(theme.palette.success.main, 0.1)
            : alpha(theme.palette.error.main, 0.1),
        border: `1px solid ${alpha(
          tone === 'success'
            ? theme.palette.success.main
            : theme.palette.error.main,
          0.18
        )}`,
        borderRadius: GROUP_WIDGET_CARD_RADIUS,
        color:
          tone === 'success'
            ? theme.palette.success.main
            : theme.palette.error.main,
        fontSize: '0.72rem',
        fontWeight: 600,
        lineHeight: 1.45,
        px: 1.1,
        py: 0.8,
      }}
    >
      {message}
    </Box>
  );
};

export const GroupsWidget = ({
  displayMode,
  myAddress,
  onRefreshStateChange,
  refreshToken = 0,
}: GroupsWidgetProps) => {
  const theme = useTheme();
  const { t } = useTranslation('group');
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const memberGroups = useAtomValue(memberGroupsAtom);
  const myGroupsWhereIAmAdmin = useAtomValue(myGroupsWhereIAmAdminAtom);
  const ownerNamesByGroupId = useAtomValue(groupsOwnerNamesAtom) as Record<
    string,
    string | null
  >;
  const groupChatTimestamps = useAtomValue(groupChatTimestampsAtom) as Record<
    string,
    number | undefined
  >;
  const timestampEnterData = useAtomValue(timestampEnterDataAtom) as Record<
    string,
    number | undefined
  >;
  const userInfo = useAtomValue(userInfoAtom);
  const [groupInvitesCache, setGroupInvitesCache] = useAtom(
    groupInvitesCacheAtom
  );
  const [joinRequestsCache, setJoinRequestsCache] = useAtom(
    joinRequestsCacheAtom
  );
  const groupInvitesCacheRef = useRef(groupInvitesCache);
  const joinRequestsCacheRef = useRef(joinRequestsCache);
  const [activeTab, setActiveTab] = useState<GroupsWidgetTab>('notifications');
  const [actionFeedback, setActionFeedback] = useState<{
    message: string;
    tone: 'error' | 'success';
  } | null>(null);
  const [dismissedInviteIds, setDismissedInviteIds] = useState<string[]>([]);
  const [dismissedRequestIds, setDismissedRequestIds] = useState<string[]>([]);
  const [showIgnoredInvites, setShowIgnoredInvites] = useState(false);
  const [showIgnoredRequests, setShowIgnoredRequests] = useState(false);
  const [invites, setInvites] = useState<GroupInviteItem[]>([]);
  const [invitesError, setInvitesError] = useState<string | null>(null);
  const [hasLoadedInvitesOnce, setHasLoadedInvitesOnce] = useState(false);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [joiningGroupId, setJoiningGroupId] = useState<number | null>(null);
  const [joiningPromotionGroupId, setJoiningPromotionGroupId] = useState<
    number | null
  >(null);
  const [promotionActionStates, setPromotionActionStates] = useState<
    Record<string, PromotionActionState>
  >({});
  const [promotions, setPromotions] = useState<GroupPromotionItem[]>([]);
  const [promotionsError, setPromotionsError] = useState<string | null>(null);
  const [hasLoadedPromotionsOnce, setHasLoadedPromotionsOnce] = useState(false);
  const [promotionsLoading, setPromotionsLoading] = useState(false);
  const [promotionDialogOpen, setPromotionDialogOpen] = useState(false);
  const [promotionFee, setPromotionFee] = useState<string | null>(null);
  const [promotionGroupId, setPromotionGroupId] = useState<string>('');
  const [promotionText, setPromotionText] = useState('');
  const [publishingPromotion, setPublishingPromotion] = useState(false);
  const [requests, setRequests] = useState<GroupJoinRequestItem[]>([]);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [hasLoadedRequestsOnce, setHasLoadedRequestsOnce] = useState(false);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [resolvingRequestId, setResolvingRequestId] = useState<string | null>(
    null
  );
  const dismissedInviteStorageKey = useMemo(
    () => getDismissedStorageKey(myAddress, 'invites'),
    [myAddress]
  );
  const dismissedRequestStorageKey = useMemo(
    () => getDismissedStorageKey(myAddress, 'requests'),
    [myAddress]
  );
  const isCompact = displayMode === 'compact';
  const rowPadding = isCompact ? '11px 12px' : '13px 13px';
  const rowGap = isCompact ? '9px' : '11px';
  const bodyGap = isCompact ? '10px' : '13px';
  const messageLineClamp = isCompact ? 1 : 2;
  const currentAddress = userInfo?.address;
  const isAnyLoading = invitesLoading || requestsLoading || promotionsLoading;
  const memberGroupIds = useMemo(
    () =>
      new Set(
        [...(memberGroups ?? [])]
          .map((group: any) => Number(group?.groupId))
          .filter((groupId) => Number.isFinite(groupId))
      ),
    [memberGroups]
  );

  useEffect(() => {
    groupInvitesCacheRef.current = groupInvitesCache;
  }, [groupInvitesCache]);

  useEffect(() => {
    joinRequestsCacheRef.current = joinRequestsCache;
  }, [joinRequestsCache]);

  useEffect(() => {
    let isMounted = true;

    void (async () => {
      try {
        const fee = await getFee('ARBITRARY');

        if (isMounted) {
          setPromotionFee(fee?.fee ?? null);
        }
      } catch (error) {
        console.error('Failed to load promotion fee for groups widget', error);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    onRefreshStateChange?.(isAnyLoading);

    return () => {
      onRefreshStateChange?.(false);
    };
  }, [isAnyLoading, onRefreshStateChange]);

  const notificationItems = useMemo<GroupNotificationItem[]>(() => {
    return [...(memberGroups ?? [])]
      .filter(
        (group: any) =>
          group?.groupId != null &&
          group?.data !== GROUP_ACTIVITY_EXCLUDED_MESSAGE_DATA
      )
      .map((group: any) => {
        const groupId = String(group.groupId);
        const timestamp =
          typeof group.timestamp === 'number' ? group.timestamp : 0;
        const snippet = normalizeSnippet(
          group.data,
          t('groups_widget.recent_activity_placeholder')
        );
        const groupName =
          group.groupId === '0'
            ? t('groups_widget.group_general')
            : group.groupName ||
              t('groups_widget.group_named', { id: groupId });
        const senderLabel =
          group.sender === currentAddress
            ? t('groups_widget.you')
            : group.senderName ||
              truncateAddress(
                String(group.sender || t('groups_widget.unknown'))
              );
        const isUnread =
          !!group.data &&
          !!groupChatTimestamps[groupId] &&
          group.sender !== currentAddress &&
          !!timestamp &&
          ((!timestampEnterData[groupId] && Date.now() - timestamp < 900000) ||
            (timestampEnterData[groupId] ?? 0) < timestamp);
        const ownerName = ownerNamesByGroupId?.[groupId] ?? null;

        return {
          avatarUrl: getGroupAvatarUrl(ownerName, groupId),
          groupId,
          groupName,
          id: `${groupId}:${timestamp}:${group.sender ?? 'unknown'}`,
          isEncryptedLike: isLikelyEncryptedSnippet(group.data),
          isUnread,
          openedAt: timestampEnterData[groupId] ?? 0,
          senderLabel,
          snippet,
          timestamp,
        };
      })
      .filter((item) => item.timestamp > 0)
      .sort(sortGroupNotificationItems)
      .slice(0, GROUP_NOTIFICATION_PREVIEW_LIMIT);
  }, [
    currentAddress,
    groupChatTimestamps,
    memberGroups,
    ownerNamesByGroupId,
    t,
    timestampEnterData,
  ]);

  const unreadNotificationCount = useMemo(
    () => notificationItems.filter((item) => item.isUnread).length,
    [notificationItems]
  );

  const adminGroupIds = useMemo(
    () =>
      [...(myGroupsWhereIAmAdmin ?? [])]
        .map((group: any) => group?.groupId)
        .filter((groupId): groupId is number => typeof groupId === 'number')
        .sort((left, right) => left - right),
    [myGroupsWhereIAmAdmin]
  );

  const promotionAdminGroups = useMemo(
    () => [...(myGroupsWhereIAmAdmin ?? [])],
    [myGroupsWhereIAmAdmin]
  );

  const hasPromotionAdminAccess = promotionAdminGroups.length > 0;

  useEffect(() => {
    setPromotionActionStates((currentStates) => {
      let didChange = false;
      const nextStates = { ...currentStates };

      for (const promotion of promotions) {
        if (
          memberGroupIds.has(Number(promotion.groupId)) &&
          nextStates[promotion.id] != null
        ) {
          delete nextStates[promotion.id];
          didChange = true;
        }
      }

      return didChange ? nextStates : currentStates;
    });
  }, [memberGroupIds, promotions]);

  const fetchInvites = useCallback(
    async (force = false) => {
      if (!myAddress) {
        setInvites([]);
        setHasLoadedInvitesOnce(true);
        setInvitesLoading(false);
        return;
      }

      const currentCache = groupInvitesCacheRef.current;
      const cacheIsFresh =
        !force &&
        currentCache?.address === myAddress &&
        Date.now() - currentCache.fetchedAt < GROUP_ACTIVITY_CACHE_TTL_MS;

      if (cacheIsFresh && currentCache?.data) {
        setInvites(
          currentCache.data.map((group: any) => ({
            description: group.description,
            groupId: group.groupId,
            groupName:
              group.groupName ??
              t('groups_widget.group_named', { id: group.groupId }),
            id: `invite:${group.groupId}`,
            isOpen: group.isOpen,
            participantCount:
              group.participantCount ?? group.memberCount ?? undefined,
          }))
        );
        setInvitesError(null);
        setHasLoadedInvitesOnce(true);
        setInvitesLoading(false);
        return;
      }

      setInvitesLoading(true);
      setInvitesError(null);

      try {
        const response = await fetch(
          `${getBaseApiReact()}/groups/invites/${myAddress}/?limit=0`
        );

        if (!response.ok) {
          throw new Error(`Unable to load invites (${response.status})`);
        }

        const data = await response.json();
        const withNames = await hydrateGroupsWithNames(
          Array.isArray(data) ? data : []
        );
        const nextInvites = withNames.map((group: any) => ({
          description: group.description,
          groupId: group.groupId,
          groupName:
            group.groupName ??
            t('groups_widget.group_named', { id: group.groupId }),
          id: `invite:${group.groupId}`,
          isOpen: group.isOpen,
          participantCount:
            group.participantCount ?? group.memberCount ?? undefined,
        }));

        setInvites(nextInvites);
        setGroupInvitesCache({
          address: myAddress,
          data: withNames,
          fetchedAt: Date.now(),
        });
      } catch (error) {
        console.error('Failed to load group invites widget data', error);
        setInvitesError(t('groups_widget.error_load_invites'));
      } finally {
        setHasLoadedInvitesOnce(true);
        setInvitesLoading(false);
      }
    },
    [myAddress, setGroupInvitesCache, t]
  );

  const fetchJoinRequests = useCallback(
    async (force = false) => {
      if (!myAddress || adminGroupIds.length === 0) {
        setRequests([]);
        setHasLoadedRequestsOnce(true);
        setRequestsLoading(false);
        return;
      }

      const currentCache = joinRequestsCacheRef.current;
      const cacheIsFresh =
        !force &&
        currentCache != null &&
        Date.now() - currentCache.fetchedAt < GROUP_ACTIVITY_CACHE_TTL_MS &&
        currentCache.adminGroupIds.length === adminGroupIds.length &&
        currentCache.adminGroupIds.every(
          (value, index) => value === adminGroupIds[index]
        );
      if (cacheIsFresh && currentCache?.data) {
        const nextRequests = currentCache.data.flatMap((entry: any) =>
          (entry?.data ?? []).map((request: any) => ({
            groupId: entry.group?.groupId,
            groupName:
              entry.group?.groupName ??
              t('groups_widget.group_named', { id: entry.group?.groupId }),
            id: `request:${entry.group?.groupId}:${request?.joiner}`,
            joiner: request?.joiner ?? '',
            requesterLabel:
              request?.name ||
              truncateAddress(
                String(request?.joiner ?? t('groups_widget.unknown'))
              ),
          }))
        );
        setRequests(nextRequests);
        setRequestsError(null);
        setHasLoadedRequestsOnce(true);
        setRequestsLoading(false);
        return;
      }

      setRequestsLoading(true);
      setRequestsError(null);

      try {
        const response = await fetch(
          `${getBaseApiReact()}/groups/joinrequests/admin/${myAddress}`
        );

        if (!response.ok) {
          throw new Error(`Unable to load join requests (${response.status})`);
        }

        const data = await response.json();
        const normalized = Array.isArray(data)
          ? data.map((entry: any) => ({
              data: entry.joinRequests ?? [],
              group: entry.group,
            }))
          : [];
        const nextRequests = normalized.flatMap((entry: any) =>
          (entry?.data ?? []).map((request: any) => ({
            groupId: entry.group?.groupId,
            groupName:
              entry.group?.groupName ??
              t('groups_widget.group_named', { id: entry.group?.groupId }),
            id: `request:${entry.group?.groupId}:${request?.joiner}`,
            joiner: request?.joiner ?? '',
            requesterLabel:
              request?.name ||
              truncateAddress(
                String(request?.joiner ?? t('groups_widget.unknown'))
              ),
          }))
        );
        setRequests(nextRequests);
        setJoinRequestsCache({
          adminGroupIds: [...adminGroupIds],
          data: normalized,
          fetchedAt: Date.now(),
        });
      } catch (error) {
        console.error('Failed to load group join requests widget data', error);
        setRequestsError(t('groups_widget.error_load_requests'));
      } finally {
        setHasLoadedRequestsOnce(true);
        setRequestsLoading(false);
      }
    },
    [adminGroupIds, myAddress, setJoinRequestsCache, t]
  );

  const fetchPromotions = useCallback(async () => {
    setPromotionsLoading(true);
    setPromotionsError(null);

    try {
      const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=DOCUMENT&identifier=${GROUP_PROMOTION_IDENTIFIER_PREFIX}&limit=18&includemetadata=false&reverse=true&prefix=true`;
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error(`Unable to load promotions (${response.status})`);
      }

      const resources = await response.json();

      if (!Array.isArray(resources)) {
        setPromotions([]);
        setHasLoadedPromotionsOnce(true);
        return;
      }

      const promotionCandidates = resources
        .filter(
          (resource: any) =>
            resource?.identifier &&
            resource?.service === 'DOCUMENT' &&
            typeof resource?.created === 'number' &&
            (!resource?.size || resource.size < 260)
        )
        .slice(0, 18);

      const hydrated = await Promise.all(
        promotionCandidates.map(async (resource: any) => {
          const textResponse = await fetch(
            `${getBaseApiReact()}/arbitrary/${resource.service}/${resource.name}/${resource.identifier}`,
            {
              method: 'GET',
            }
          );

          if (!textResponse.ok) {
            return null;
          }

          const groupIdMatch = /group-(\d+)-/.exec(resource.identifier);
          const groupId = groupIdMatch ? Number(groupIdMatch[1]) : NaN;

          if (!Number.isFinite(groupId)) {
            return null;
          }

          return {
            created: resource.created,
            data: await textResponse.text(),
            groupId,
            identifier: resource.identifier,
            name: resource.name,
          };
        })
      );

      const uniqueGroupIds = new Set<number>();
      const normalized = hydrated
        .filter((item): item is NonNullable<typeof item> => item != null)
        .sort((left, right) => right.created - left.created)
        .filter((item) => {
          if (uniqueGroupIds.has(item.groupId)) {
            return false;
          }

          uniqueGroupIds.add(item.groupId);
          return true;
        })
        .slice(0, GROUP_PROMOTION_MAX_ITEMS);

      const withGroupNames = await hydrateGroupsWithNames(normalized);
      setPromotions(
        withGroupNames.map((promotion: any) => ({
          created: promotion.created,
          description: promotion.description,
          groupId: promotion.groupId,
          groupName:
            promotion.groupName ??
            t('groups_widget.group_named', { id: promotion.groupId }),
          id: `promotion:${promotion.identifier}`,
          isOpen:
            typeof promotion.isOpen === 'boolean'
              ? promotion.isOpen
              : undefined,
          memberCount:
            promotion.memberCount ?? promotion.participantCount ?? undefined,
          promoterName: promotion.name ?? t('groups_widget.unknown'),
          snippet: normalizeSnippet(
            promotion.data,
            t('groups_widget.fresh_promotion_snippet')
          ),
        }))
      );
      setHasLoadedPromotionsOnce(true);
    } catch (error) {
      console.error('Failed to load group promotions widget data', error);
      setPromotionsError(t('groups_widget.error_load_promotions'));
    } finally {
      setHasLoadedPromotionsOnce(true);
      setPromotionsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    setActionFeedback(null);
    setShowIgnoredInvites(false);
    setShowIgnoredRequests(false);
    void (async () => {
      const [storedInvites, storedRequests] = await Promise.all([
        loadMiscStoredIds(dismissedInviteStorageKey),
        loadMiscStoredIds(dismissedRequestStorageKey),
      ]);
      if (cancelled) return;
      setDismissedInviteIds(storedInvites);
      setDismissedRequestIds(storedRequests);
    })();
    void fetchInvites(false);
    void fetchJoinRequests(false);
    return () => {
      cancelled = true;
    };
  }, [
    dismissedInviteStorageKey,
    dismissedRequestStorageKey,
    fetchInvites,
    fetchJoinRequests,
  ]);

  useEffect(() => {
    if (!hasLoadedInvitesOnce || invitesError || invites.length === 0) return;
    const liveIds = new Set(invites.map((invite) => invite.id));
    setDismissedInviteIds((current) => {
      const next = current.filter((id) => liveIds.has(id));
      if (next.length === current.length) return current;
      void saveMiscStoredIds(dismissedInviteStorageKey, next);
      return next;
    });
  }, [dismissedInviteStorageKey, hasLoadedInvitesOnce, invites, invitesError]);

  useEffect(() => {
    if (!hasLoadedRequestsOnce || requestsError || requests.length === 0)
      return;
    const liveIds = new Set(requests.map((request) => request.id));
    setDismissedRequestIds((current) => {
      const next = current.filter((id) => liveIds.has(id));
      if (next.length === current.length) return current;
      void saveMiscStoredIds(dismissedRequestStorageKey, next);
      return next;
    });
  }, [
    dismissedRequestStorageKey,
    hasLoadedRequestsOnce,
    requests,
    requestsError,
  ]);

  useEffect(() => {
    if (refreshToken === 0) {
      return;
    }

    setActionFeedback(null);
    void fetchInvites(true);
    void fetchJoinRequests(true);
  }, [fetchInvites, fetchJoinRequests, refreshToken]);

  useEffect(() => {
    if (activeTab !== 'promoted') {
      return;
    }
    void fetchPromotions();
  }, [activeTab, fetchPromotions, refreshToken]);

  const visibleInvites = useMemo(
    () => invites.filter((invite) => !dismissedInviteIds.includes(invite.id)),
    [dismissedInviteIds, invites]
  );
  const ignoredInvites = useMemo(
    () => invites.filter((invite) => dismissedInviteIds.includes(invite.id)),
    [dismissedInviteIds, invites]
  );

  const visibleRequests = useMemo(
    () =>
      requests.filter((request) => !dismissedRequestIds.includes(request.id)),
    [dismissedRequestIds, requests]
  );
  const ignoredRequests = useMemo(
    () =>
      requests.filter((request) => dismissedRequestIds.includes(request.id)),
    [dismissedRequestIds, requests]
  );

  const showInitialInvitesLoading =
    invitesLoading && !hasLoadedInvitesOnce && visibleInvites.length === 0;
  const showInitialRequestsLoading =
    requestsLoading && !hasLoadedRequestsOnce && visibleRequests.length === 0;
  const showInitialPromotionsLoading =
    promotionsLoading && !hasLoadedPromotionsOnce && promotions.length === 0;

  const handleOpenGroupChat = useCallback((groupId: string) => {
    executeEvent('openGroupMessage', {
      from: groupId,
    });
  }, []);

  const handleOpenGroupDiscovery = useCallback(() => {
    executeEvent('open-group-discovery', {});
  }, []);

  const handleAcceptInvite = useCallback(
    async (invite: GroupInviteItem) => {
      try {
        const fee = await getFee('JOIN_GROUP');
        await show({
          message: t('groups_widget.confirm_join_group'),
          publishFee: `${fee.fee} QORT`,
        });
        setJoiningGroupId(invite.groupId);
        setActionFeedback(null);

        const response = await window.sendMessage('joinGroup', {
          groupId: invite.groupId,
        });

        if (response?.error) {
          throw new Error(response.error);
        }

        setInvites((current) =>
          current.filter((currentInvite) => currentInvite.id !== invite.id)
        );
        setDismissedInviteIds((current) => {
          const next = current.filter((id) => id !== invite.id);
          void saveMiscStoredIds(dismissedInviteStorageKey, next);
          return next;
        });
        setGroupInvitesCache(null);
        setActionFeedback({
          message: t('groups_widget.joined_group', { name: invite.groupName }),
          tone: 'success',
        });
      } catch (error: any) {
        console.error('Failed to join group invite from widget', error);
        setActionFeedback({
          message: error?.message || t('groups_widget.error_accept_invite'),
          tone: 'error',
        });
      } finally {
        setJoiningGroupId(null);
      }
    },
    [dismissedInviteStorageKey, setGroupInvitesCache, show, t]
  );

  const handleIgnoreInvite = useCallback(
    async (inviteId: string) => {
      const next = dismissedInviteIds.includes(inviteId)
        ? dismissedInviteIds
        : [...dismissedInviteIds, inviteId];
      await saveMiscStoredIds(dismissedInviteStorageKey, next);
      setDismissedInviteIds(next);
      setActionFeedback({
        message: t('groups_widget.invite_hidden'),
        tone: 'success',
      });
    },
    [dismissedInviteIds, dismissedInviteStorageKey, t]
  );

  const handleRestoreInvite = useCallback(
    async (inviteId: string) => {
      const next = dismissedInviteIds.filter((id) => id !== inviteId);
      await saveMiscStoredIds(dismissedInviteStorageKey, next);
      setDismissedInviteIds(next);
    },
    [dismissedInviteIds, dismissedInviteStorageKey]
  );

  const handleApproveRequest = useCallback(
    async (request: GroupJoinRequestItem) => {
      try {
        const fee = await getFee('GROUP_INVITE');
        await show({
          message: t('groups_widget.confirm_approve_request'),
          publishFee: `${fee.fee} QORT`,
        });
        setResolvingRequestId(request.id);
        setActionFeedback(null);

        const response = await window.sendMessage('inviteToGroup', {
          groupId: request.groupId,
          inviteTime: 10800,
          qortalAddress: request.joiner,
        });

        if (response?.error) {
          throw new Error(response.error);
        }

        setRequests((current) =>
          current.filter((currentRequest) => currentRequest.id !== request.id)
        );
        setDismissedRequestIds((current) => {
          const next = current.filter((id) => id !== request.id);
          void saveMiscStoredIds(dismissedRequestStorageKey, next);
          return next;
        });
        setJoinRequestsCache(null);
        setActionFeedback({
          message: t('groups_widget.request_approved', {
            requester: request.requesterLabel,
            group: request.groupName,
          }),
          tone: 'success',
        });
      } catch (error: any) {
        console.error('Failed to approve join request from widget', error);
        setActionFeedback({
          message: error?.message || t('groups_widget.error_approve_request'),
          tone: 'error',
        });
      } finally {
        setResolvingRequestId(null);
      }
    },
    [dismissedRequestStorageKey, setJoinRequestsCache, show, t]
  );

  const handleRejectRequest = useCallback(
    async (requestId: string) => {
      const next = dismissedRequestIds.includes(requestId)
        ? dismissedRequestIds
        : [...dismissedRequestIds, requestId];
      await saveMiscStoredIds(dismissedRequestStorageKey, next);
      setDismissedRequestIds(next);
      setActionFeedback({
        message: t('groups_widget.request_removed'),
        tone: 'success',
      });
    },
    [dismissedRequestIds, dismissedRequestStorageKey, t]
  );

  const handleRestoreRequest = useCallback(
    async (requestId: string) => {
      const next = dismissedRequestIds.filter((id) => id !== requestId);
      await saveMiscStoredIds(dismissedRequestStorageKey, next);
      setDismissedRequestIds(next);
    },
    [dismissedRequestIds, dismissedRequestStorageKey]
  );

  const handleJoinPromotedGroup = useCallback(
    async (promotion: GroupPromotionItem) => {
      try {
        const fee = await getFee('JOIN_GROUP');
        await show({
          message: promotion.isOpen
            ? t('groups_widget.confirm_join_promoted_open')
            : t('groups_widget.confirm_join_promoted_closed'),
          publishFee: `${fee.fee} QORT`,
        });
        setPromotionActionStates((currentStates) => ({
          ...currentStates,
          [promotion.id]: 'connecting',
        }));
        setJoiningPromotionGroupId(promotion.groupId);
        setActionFeedback(null);

        const response = await window.sendMessage('joinGroup', {
          groupId: promotion.groupId,
        });

        if (response?.error) {
          throw new Error(response.error);
        }

        setPromotionActionStates((currentStates) => ({
          ...currentStates,
          [promotion.id]:
            promotion.isOpen === false ? 'request_sent' : 'processing',
        }));
        setActionFeedback({
          message: promotion.isOpen
            ? t('groups_widget.joined_promoted', { name: promotion.groupName })
            : t('groups_widget.join_request_sent', {
                name: promotion.groupName,
              }),
          tone: 'success',
        });
      } catch (error: any) {
        console.error('Failed to join promoted group from widget', error);
        setPromotionActionStates((currentStates) => {
          const nextStates = { ...currentStates };
          delete nextStates[promotion.id];
          return nextStates;
        });
        setActionFeedback({
          message: error?.message || t('groups_widget.error_promoted'),
          tone: 'error',
        });
      } finally {
        setJoiningPromotionGroupId(null);
      }
    },
    [show, t]
  );

  const handlePublishPromotion = useCallback(async () => {
    try {
      if (!promotionGroupId || !promotionText.trim()) {
        return;
      }

      setPublishingPromotion(true);
      setActionFeedback(null);

      const identifier = `group-promotions-ui24-group-${promotionGroupId}-${Date.now().toString(36)}`;

      const response = await window.sendMessage('publishOnQDN', {
        data: utf8ToBase64(promotionText.trim()),
        identifier,
        service: 'DOCUMENT',
        uploadType: 'base64',
      });

      if (response?.error) {
        throw new Error(response.error);
      }

      setPromotionDialogOpen(false);
      setPromotionGroupId('');
      setPromotionText('');
      setActionFeedback({
        message: t('groups_widget.promotion_published'),
        tone: 'success',
      });
      await fetchPromotions();
      setActiveTab('promoted');
    } catch (error: any) {
      console.error('Failed to publish group promotion from widget', error);
      setActionFeedback({
        message: error?.message || t('groups_widget.error_publish_promotion'),
        tone: 'error',
      });
    } finally {
      setPublishingPromotion(false);
    }
  }, [fetchPromotions, promotionGroupId, promotionText, t]);

  const handleOpenPromotionDialog = useCallback(() => {
    if (!hasPromotionAdminAccess) {
      return;
    }

    setPromotionGroupId((currentValue) => {
      if (currentValue) {
        return currentValue;
      }

      const firstGroupId = promotionAdminGroups[0]?.groupId;
      return firstGroupId != null ? String(firstGroupId) : currentValue;
    });
    setPromotionDialogOpen(true);
  }, [hasPromotionAdminAccess, promotionAdminGroups]);

  const sharedScrollerSx = {
    display: 'flex',
    flex: '1 1 auto',
    flexDirection: 'column',
    gap: bodyGap,
    minHeight: 0,
    // Virtualized lists adjust total height as rows measure — disable scroll anchoring.
    overflowAnchor: 'none',
    overflowY: 'auto',

    pr: '4px',
    scrollbarColor: `${alpha(theme.palette.text.secondary, 0.3)} transparent`,
    scrollbarWidth: 'thin',
    '&::-webkit-scrollbar': {
      width: '10px',
    },
    '&::-webkit-scrollbar-thumb': {
      backgroundColor: alpha(theme.palette.text.secondary, 0.24),
      border: '3px solid transparent',
      borderRadius: '999px',
      backgroundClip: 'padding-box',
    },
  } as const;

  const promotionPrimaryActionSx = {
    ...getBlueTier1ButtonSx(),
    borderRadius: '999px',
    fontSize: '0.67rem',
    fontWeight: 800,
    minHeight: '27px',
    minWidth: '102px',
    px: 1.15,
    py: 0.35,
    textTransform: 'none',
    whiteSpace: 'nowrap',
  } as const;

  const promotionSecondaryActionSx = {
    alignItems: 'center',
    backgroundColor:
      theme.palette.mode === 'dark'
        ? alpha(theme.palette.common.white, 0.045)
        : alpha(theme.palette.text.primary, 0.045),
    border: `1px solid ${alpha(
      theme.palette.border.main,
      theme.palette.mode === 'dark' ? 0.22 : 0.14
    )}`,
    borderRadius: '999px',
    color: theme.palette.text.secondary,
    display: 'inline-flex',
    fontSize: '0.67rem',
    fontWeight: 700,
    justifyContent: 'center',
    minHeight: '27px',
    minWidth: '102px',
    px: 1.05,
    py: 0.35,
    textTransform: 'none',
    whiteSpace: 'nowrap',
    '&.Mui-disabled': {
      color: alpha(theme.palette.text.secondary, 0.84),
      opacity: 1,
    },
  } as const;

  const ignoredItemsActionSx = {
    alignItems: 'center',
    border: `1px solid ${alpha(
      theme.palette.border.main,
      theme.palette.mode === 'dark' ? 0.22 : 0.14
    )}`,
    borderRadius: '999px',
    color: theme.palette.text.secondary,
    display: 'inline-flex',
    flexShrink: 0,
    fontSize: '0.7rem',
    fontWeight: 700,
    minHeight: '30px',
    px: 1.25,
    textTransform: 'none',
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
      color: theme.palette.text.primary,
    },
  } as const;

  const headerUtilityActionSx = {
    alignItems: 'center',
    backgroundColor:
      theme.palette.mode === 'dark'
        ? alpha(theme.palette.common.white, 0.03)
        : alpha(theme.palette.text.primary, 0.035),
    border: `1px solid ${alpha(
      theme.palette.border.main,
      theme.palette.mode === 'dark' ? 0.16 : 0.1
    )}`,
    borderRadius: '999px',
    color: theme.palette.text.secondary,
    display: 'inline-flex',
    fontSize: '0.69rem',
    fontWeight: 700,
    gap: '6px',
    minHeight: '28px',
    px: 1.15,
    textTransform: 'none',
    transition:
      'background-color 140ms ease, border-color 140ms ease, color 140ms ease, transform 120ms ease',
    whiteSpace: 'nowrap',
    '&:hover': {
      backgroundColor:
        theme.palette.mode === 'dark'
          ? alpha(theme.palette.common.white, 0.05)
          : alpha(theme.palette.text.primary, 0.05),
      borderColor: alpha(
        theme.palette.border.main,
        theme.palette.mode === 'dark' ? 0.24 : 0.16
      ),
      color: theme.palette.text.primary,
      transform: 'translateY(-1px)',
    },
    '&:active': {
      transform: 'translateY(0)',
    },
    '&.Mui-disabled': {
      color: alpha(theme.palette.text.secondary, 0.7),
      opacity: 0.72,
    },
  } as const;

  const discoverGroupsActionSx = {
    ...headerUtilityActionSx,
    background:
      theme.palette.mode === 'dark'
        ? 'rgba(88, 122, 178, 0.34)'
        : 'rgba(117, 161, 227, 0.18)',
    border: `1px solid ${alpha(
      '#8FB8F3',
      theme.palette.mode === 'dark' ? 0.18 : 0.24
    )}`,
    boxShadow:
      theme.palette.mode === 'dark'
        ? '0 0 0 1px rgba(255,255,255,0.028) inset, 0 0 12px rgba(132,175,240,0.1)'
        : '0 0 0 1px rgba(255,255,255,0.05) inset, 0 0 10px rgba(132,175,240,0.08)',
    color:
      theme.palette.mode === 'dark'
        ? alpha('#8FB8F3', 0.92)
        : alpha('#5A8FE0', 0.9),
    '&:hover': {
      ...getBlueTier1ButtonSx()['&:hover'],
      borderColor: 'rgba(143, 184, 243, 0.22)',
      color: APP_BLUE_SURFACE_TEXT,
      transform: 'translateY(-1px)',
    },
    '&:active': {
      ...getBlueTier1ButtonSx()['&:active'],
      transform: 'scale(0.97)',
    },
  } as const;

  const widgetItemSurfaceColor =
    theme.palette.mode === 'dark'
      ? 'linear-gradient(180deg, rgba(45, 49, 60, 0.9) 0%, rgba(36, 40, 50, 0.96) 100%)'
      : alpha(theme.palette.text.primary, 0.036);

  const widgetItemHoverSurfaceColor =
    theme.palette.mode === 'dark'
      ? 'linear-gradient(180deg, rgba(49, 54, 66, 0.94) 0%, rgba(39, 43, 53, 0.98) 100%)'
      : alpha(theme.palette.text.primary, 0.048);

  const widgetItemBorderColor =
    theme.palette.mode === 'dark'
      ? 'rgba(255,255,255,0.06)'
      : alpha(theme.palette.border.main, 0.12);

  const widgetItemHoverBorderColor =
    theme.palette.mode === 'dark'
      ? 'rgba(255,255,255,0.085)'
      : alpha(theme.palette.border.main, 0.18);

  const widgetItemInsetShadow =
    theme.palette.mode === 'dark'
      ? `0 10px 24px rgba(0,0,0,0.18), inset 0 1px 0 ${alpha(theme.palette.common.white, 0.045)}`
      : `inset 0 1px 0 ${alpha(theme.palette.common.white, 0.72)}`;
  const readNotificationSurfaceColor =
    theme.palette.mode === 'dark'
      ? 'linear-gradient(180deg, rgba(43, 47, 58, 0.88) 0%, rgba(34, 38, 48, 0.95) 100%)'
      : alpha(theme.palette.text.primary, 0.03);
  const readNotificationHoverSurfaceColor =
    theme.palette.mode === 'dark'
      ? 'linear-gradient(180deg, rgba(47, 52, 63, 0.92) 0%, rgba(37, 41, 51, 0.98) 100%)'
      : alpha(theme.palette.text.primary, 0.04);
  const unreadNotificationSurfaceColor =
    theme.palette.mode === 'dark'
      ? `linear-gradient(180deg, ${alpha(theme.palette.primary.main, 0.14)} 0%, rgba(40, 49, 63, 0.94) 20%, rgba(34, 40, 50, 0.98) 100%)`
      : alpha(theme.palette.primary.main, 0.03);
  const unreadNotificationHoverSurfaceColor =
    theme.palette.mode === 'dark'
      ? `linear-gradient(180deg, ${alpha(theme.palette.primary.main, 0.18)} 0%, rgba(44, 53, 68, 0.97) 22%, rgba(37, 43, 54, 1) 100%)`
      : alpha(theme.palette.primary.main, 0.04);
  const unreadNotificationBorderColor =
    theme.palette.mode === 'dark'
      ? alpha(theme.palette.primary.main, 0.16)
      : alpha(theme.palette.primary.main, 0.085);

  const effectiveNotificationItems = useMemo(
    () => [...notificationItems].sort(sortGroupNotificationItems),
    [notificationItems]
  );
  const effectiveInvites = showIgnoredInvites ? ignoredInvites : visibleInvites;
  const effectiveRequests = showIgnoredRequests
    ? ignoredRequests
    : visibleRequests;
  const effectivePromotions = promotions;
  const effectiveUnreadNotificationCount = unreadNotificationCount;

  const getPromotionVisualState = useCallback(
    (
      promotion: GroupPromotionItem,
      isMember: boolean
    ): GroupPromotionVisualState => {
      if (isMember) {
        return 'member';
      }

      if (joiningPromotionGroupId === promotion.groupId) {
        return 'connecting';
      }

      return (
        promotionActionStates[promotion.id] ??
        (promotion.isOpen === false ? 'request' : 'join')
      );
    },
    [joiningPromotionGroupId, promotionActionStates]
  );

  const groupsListScrollRef = useRef<HTMLDivElement | null>(null);
  const bodyGapPx = isCompact ? 10 : 13;

  const virtualListLength =
    activeTab === 'notifications'
      ? effectiveNotificationItems.length
      : activeTab === 'invites'
        ? effectiveInvites.length
        : activeTab === 'requests'
          ? effectiveRequests.length
          : effectivePromotions.length;

  const rowVirtualizer = useVirtualizer({
    count: virtualListLength,
    getScrollElement: () => groupsListScrollRef.current,
    estimateSize: useCallback(() => {
      switch (activeTab) {
        case 'notifications':
          return isCompact ? 132 : 152;
        case 'invites':
          return isCompact ? 168 : 182;
        case 'requests':
          return isCompact ? 185 : 200;
        case 'promoted':
          return isCompact ? 210 : 230;
        default:
          return 160;
      }
    }, [activeTab, isCompact]),
    getItemKey: useCallback(
      (index: number) => {
        switch (activeTab) {
          case 'notifications':
            return `n:${effectiveNotificationItems[index]?.id ?? index}`;
          case 'invites':
            return `i:${effectiveInvites[index]?.id ?? index}`;
          case 'requests':
            return `r:${effectiveRequests[index]?.id ?? index}`;
          case 'promoted':
            return `p:${effectivePromotions[index]?.id ?? index}`;
          default:
            return `x:${index}`;
        }
      },
      [
        activeTab,
        effectiveNotificationItems,
        effectiveInvites,
        effectiveRequests,
        effectivePromotions,
      ]
    ),
    overscan: 6,
  });

  const renderVirtualizedList = (
    itemCount: number,
    renderRow: (index: number) => ReactElement | null
  ) => (
    <Box
      ref={groupsListScrollRef}
      sx={{
        ...sharedScrollerSx,
        gap: 0,
      }}
    >
      <Box
        sx={{
          height: rowVirtualizer.getTotalSize() + 6,
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
            const node = renderRow(virtualRow.index);
            if (!node) {
              return null;
            }
            return (
              <Box
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                sx={{
                  boxSizing: 'border-box',
                  left: 0,
                  paddingBottom:
                    virtualRow.index < itemCount - 1 ? `${bodyGapPx}px` : 0,
                  position: 'absolute',
                  top: 0,
                  transform: `translate3d(0, ${virtualRow.start}px, 0)`,
                  width: '100%',
                }}
              >
                {node}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );

  const renderNotificationList = () => (
    <QAppWidgetContainer
      emptyMessage={t('groups_widget.notifications_empty_message')}
      emptyTitle={t('groups_widget.notifications_empty_title')}
      hasContent={effectiveNotificationItems.length > 0}
      isEmpty={effectiveNotificationItems.length === 0}
      isLoading={false}
      loadingLabel={t('groups_widget.loading_notifications')}
      onSecondaryAction={handleOpenGroupDiscovery}
      secondaryActionLabel={t('groups_widget.discover_groups')}
      secondaryActionVariant="link"
      stateVerticalOffset="-24px"
    >
      <Box
        sx={{
          display: 'flex',
          flex: '1 1 auto',
          flexDirection: 'column',
          gap: bodyGap,
          minHeight: 0,
        }}
      >
        {actionFeedback ? (
          <InlineFeedback
            message={actionFeedback.message}
            tone={actionFeedback.tone}
          />
        ) : null}
        {renderVirtualizedList(effectiveNotificationItems.length, (index) => {
          const item = effectiveNotificationItems[index];
          if (!item) return null;

          return (
            <ButtonBase
              onClick={() => handleOpenGroupChat(item.groupId)}
              sx={{
                alignItems: 'flex-start',
                background: item.isUnread
                  ? unreadNotificationSurfaceColor
                  : readNotificationSurfaceColor,
                border: `1px solid ${
                  item.isUnread
                    ? unreadNotificationBorderColor
                    : widgetItemBorderColor
                }`,
                borderRadius: GROUP_WIDGET_CARD_RADIUS,
                boxShadow: widgetItemInsetShadow,
                display: 'flex',
                flexShrink: 0,
                gap: rowGap,
                overflow: 'hidden',
                p: rowPadding,
                position: 'relative',
                textAlign: 'left',
                transition:
                  'background 140ms ease, border-color 140ms ease, transform 120ms ease, box-shadow 140ms ease',
                width: '100%',
                '&::before': item.isUnread
                  ? {
                      backgroundColor: alpha(
                        theme.palette.primary.main,
                        theme.palette.mode === 'dark' ? 0.34 : 0.28
                      ),
                      borderBottomLeftRadius: GROUP_WIDGET_CARD_RADIUS,
                      borderTopLeftRadius: GROUP_WIDGET_CARD_RADIUS,
                      content: '""',
                      left: 0,
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      width: '3px',
                    }
                  : undefined,
                '&:hover': {
                  background: item.isUnread
                    ? unreadNotificationHoverSurfaceColor
                    : readNotificationHoverSurfaceColor,
                  borderColor: item.isUnread
                    ? alpha(
                        theme.palette.primary.main,
                        theme.palette.mode === 'dark' ? 0.18 : 0.13
                      )
                    : widgetItemHoverBorderColor,
                  boxShadow:
                    theme.palette.mode === 'dark'
                      ? `0 14px 28px rgba(0,0,0,0.22), inset 0 1px 0 ${alpha(theme.palette.common.white, 0.05)}`
                      : widgetItemInsetShadow,
                  transform: 'translateY(-1px)',
                },
              }}
            >
              <Avatar
                alt={item.groupName}
                src={item.avatarUrl ?? undefined}
                sx={{
                  bgcolor: alpha(theme.palette.primary.main, 0.12),
                  color: theme.palette.text.primary,
                  flexShrink: 0,
                  height: isCompact ? 34 : 38,
                  width: isCompact ? 34 : 38,
                }}
              >
                {item.groupName.charAt(0).toUpperCase()}
              </Avatar>

              <Box
                sx={{
                  display: 'flex',
                  flex: '1 1 auto',
                  flexDirection: 'column',
                  gap: isCompact ? '4px' : '5px',
                  minWidth: 0,
                }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    gap: '8px',
                    justifyContent: 'space-between',
                    minWidth: 0,
                  }}
                >
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'inline-flex',
                      gap: '8px',
                      minWidth: 0,
                    }}
                  >
                    <Typography
                      sx={{
                        color: theme.palette.text.primary,
                        fontSize: isCompact ? '0.8rem' : '0.84rem',
                        fontWeight: item.isUnread ? 760 : 680,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.groupName}
                    </Typography>
                    {item.isUnread ? (
                      <MarkChatUnreadRoundedIcon
                        sx={{
                          color: theme.palette.primary.main,
                          flexShrink: 0,
                          fontSize: '0.95rem',
                        }}
                      />
                    ) : null}
                  </Box>
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      flexShrink: 0,
                      fontSize: '0.67rem',
                      fontWeight: 600,
                    }}
                  >
                    {formatTimestamp(item.timestamp)}
                  </Typography>
                </Box>
                <Box
                  sx={{
                    alignItems: 'baseline',
                    display: 'inline-flex',
                    fontSize: '0.7rem',
                    gap: '4px',
                  }}
                >
                  <Typography
                    component="span"
                    sx={{
                      color: alpha(theme.palette.text.secondary, 0.72),
                      fontSize: 'inherit',
                      fontWeight: 600,
                      lineHeight: 1.3,
                    }}
                  >
                    {t('groups_widget.from_label')}
                  </Typography>
                  <Typography
                    component="span"
                    sx={{
                      color: theme.palette.primary.main,
                      fontSize: 'inherit',
                      fontWeight: 700,
                      lineHeight: 1.3,
                    }}
                  >
                    {item.senderLabel}
                  </Typography>
                </Box>
                <Box
                  sx={{
                    color: theme.palette.text.secondary,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: item.isEncryptedLike ? '4px' : 0,
                    minWidth: 0,
                    pb: item.isEncryptedLike ? '4px' : 0,
                  }}
                >
                  {item.isEncryptedLike ? (
                    <Box
                      sx={{
                        alignItems: 'baseline',
                        color: alpha(theme.palette.text.secondary, 0.82),
                        display: 'inline-flex',
                        gap: '5px',
                        minWidth: 0,
                      }}
                    >
                      <LockRoundedIcon
                        sx={{
                          fontSize: '0.8rem',
                          transform: 'translateY(1px)',
                        }}
                      />
                      <Typography
                        component="span"
                        sx={{
                          color: 'inherit',
                          fontSize: '0.68rem',
                          fontWeight: 600,
                          lineHeight: 1.25,
                        }}
                      >
                        {t('groups_widget.new_encrypted_message')}
                      </Typography>
                    </Box>
                  ) : (
                    <Typography
                      sx={{
                        color: theme.palette.text.secondary,
                        display: '-webkit-box',
                        flex: '1 1 auto',
                        fontSize: isCompact ? '0.73rem' : '0.76rem',
                        lineHeight: 1.5,
                        minWidth: 0,
                        overflow: 'hidden',
                        WebkitBoxOrient: 'vertical',
                        WebkitLineClamp: messageLineClamp,
                        wordBreak: 'break-word',
                      }}
                    >
                      {item.snippet}
                    </Typography>
                  )}
                </Box>
                <Box
                  sx={{
                    alignItems: 'center',
                    color: theme.palette.text.secondary,
                    display: 'inline-flex',
                    fontSize: '0.67rem',
                    fontWeight: 700,
                    gap: '5px',
                    mt: '2px',
                  }}
                >
                  <OpenInNewRoundedIcon sx={{ fontSize: '0.82rem' }} />
                  {item.isEncryptedLike
                    ? t('groups_widget.view_conversation')
                    : t('groups_widget.open_conversation')}
                </Box>
              </Box>
            </ButtonBase>
          );
        })}
      </Box>
    </QAppWidgetContainer>
  );

  const renderInvitesList = () => (
    <QAppWidgetContainer
      error={invitesError}
      hasContent={effectiveInvites.length > 0}
      isEmpty={false}
      isLoading={showInitialInvitesLoading}
      loadingLabel={t('groups_widget.loading_invites')}
      onRetry={() => void fetchInvites(true)}
      stateVerticalOffset="-24px"
    >
      <Box
        sx={{
          display: 'flex',
          flex: '1 1 auto',
          flexDirection: 'column',
          gap: bodyGap,
          minHeight: 0,
        }}
      >
        {actionFeedback ? (
          <InlineFeedback
            message={actionFeedback.message}
            tone={actionFeedback.tone}
          />
        ) : null}
        {(ignoredInvites.length > 0 || showIgnoredInvites) && (
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              justifyContent: 'space-between',
              gap: 1,
            }}
          >
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.72rem',
                fontWeight: 700,
              }}
            >
              {showIgnoredInvites
                ? t('groups_widget.ignored_invites', {
                    count: ignoredInvites.length,
                    defaultValue: 'Ignored invites ({{count}})',
                  })
                : t('groups_widget.hidden_invites_count', {
                    count: ignoredInvites.length,
                    defaultValue: '{{count}} ignored',
                  })}
            </Typography>
            <ButtonBase
              onClick={() => setShowIgnoredInvites((prev) => !prev)}
              sx={ignoredItemsActionSx}
            >
              {showIgnoredInvites
                ? t('groups_widget.back_to_invites', {
                    defaultValue: 'Back to invites',
                  })
                : t('groups_widget.show_ignored', {
                    defaultValue: 'Show ignored',
                  })}
            </ButtonBase>
          </Box>
        )}
        {effectiveInvites.length === 0 &&
        !showInitialInvitesLoading &&
        !invitesError ? (
          <IllustratedEmptyState
            actionLabel={t('groups_widget.refresh')}
            compact={isCompact}
            description={
              showIgnoredInvites
                ? t('groups_widget.ignored_invites_empty_description', {
                    defaultValue:
                      'Ignored invites are checked against your current pending invites.',
                  })
                : t('groups_widget.invites_empty_description')
            }
            onAction={() => void fetchInvites(true)}
            title={
              showIgnoredInvites
                ? t('groups_widget.ignored_invites_empty_title', {
                    defaultValue: 'No ignored invites',
                  })
                : t('groups_widget.invites_empty_title')
            }
            variant="invites"
          />
        ) : (
          renderVirtualizedList(effectiveInvites.length, (index) => {
            const invite = effectiveInvites[index];
            if (!invite) return null;

            return (
              <Box
                sx={{
                  background: widgetItemSurfaceColor,
                  border: `1px solid ${widgetItemBorderColor}`,
                  borderRadius: GROUP_WIDGET_CARD_RADIUS,
                  boxShadow: widgetItemInsetShadow,
                  display: 'flex',
                  flexDirection: 'column',
                  flexShrink: 0,
                  gap: isCompact ? '7px' : '8px',
                  p: rowPadding,
                  transition:
                    'background 140ms ease, border-color 140ms ease, transform 120ms ease, box-shadow 140ms ease',
                  width: '100%',
                  '&:hover': {
                    background: widgetItemHoverSurfaceColor,
                    borderColor: widgetItemHoverBorderColor,
                    boxShadow:
                      theme.palette.mode === 'dark'
                        ? `0 14px 28px rgba(0,0,0,0.22), inset 0 1px 0 ${alpha(theme.palette.common.white, 0.05)}`
                        : widgetItemInsetShadow,
                    transform: 'translateY(-1px)',
                  },
                }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    gap: '9px',
                    minWidth: 0,
                  }}
                >
                  <Avatar
                    sx={{
                      bgcolor: alpha(theme.palette.primary.main, 0.12),
                      color: theme.palette.text.primary,
                      height: isCompact ? 34 : 38,
                      width: isCompact ? 34 : 38,
                    }}
                  >
                    <GroupAddRoundedIcon sx={{ fontSize: '1rem' }} />
                  </Avatar>
                  <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
                    <Typography
                      sx={{
                        color: theme.palette.text.primary,
                        fontSize: isCompact ? '0.8rem' : '0.84rem',
                        fontWeight: 700,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {invite.groupName}
                    </Typography>
                    <Typography
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: '0.72rem',
                        lineHeight: 1.5,
                        mt: '2px',
                      }}
                    >
                      {invite.description
                        ? normalizeSnippet(
                            invite.description,
                            t('groups_widget.private_group_invite')
                          )
                        : invite.participantCount != null
                          ? t('groups_widget.members_count', {
                              count: invite.participantCount,
                            })
                          : t('groups_widget.invitation_ready')}
                    </Typography>
                  </Box>
                </Box>
                <Box
                  sx={{
                    display: 'flex',
                    gap: '8px',
                    justifyContent: 'flex-end',
                  }}
                >
                  <ButtonBase
                    onClick={() =>
                      void (showIgnoredInvites
                        ? handleRestoreInvite(invite.id)
                        : handleIgnoreInvite(invite.id))
                    }
                    sx={ignoredItemsActionSx}
                  >
                    {showIgnoredInvites
                      ? t('groups_widget.restore', {
                          defaultValue: 'Restore',
                        })
                      : t('groups_widget.ignore')}
                  </ButtonBase>
                  <LoadingButton
                    loading={joiningGroupId === invite.groupId}
                    onClick={() => void handleAcceptInvite(invite)}
                    sx={{
                      borderRadius: '999px',
                      fontSize: '0.7rem',
                      fontWeight: 800,
                      minHeight: '30px',
                      px: 1.35,
                      textTransform: 'none',
                    }}
                    variant="contained"
                  >
                    {t('groups_widget.accept')}
                  </LoadingButton>
                </Box>
              </Box>
            );
          })
        )}
      </Box>
    </QAppWidgetContainer>
  );

  const renderRequestsList = () => (
    <QAppWidgetContainer
      error={requestsError}
      hasContent={effectiveRequests.length > 0}
      isEmpty={false}
      isLoading={showInitialRequestsLoading}
      loadingLabel={t('groups_widget.loading_requests')}
      onRetry={() => void fetchJoinRequests(true)}
      stateVerticalOffset="-24px"
    >
      <Box
        sx={{
          display: 'flex',
          flex: '1 1 auto',
          flexDirection: 'column',
          gap: bodyGap,
          minHeight: 0,
        }}
      >
        {actionFeedback ? (
          <InlineFeedback
            message={actionFeedback.message}
            tone={actionFeedback.tone}
          />
        ) : null}
        {(ignoredRequests.length > 0 || showIgnoredRequests) && (
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              justifyContent: 'space-between',
              gap: 1,
            }}
          >
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.72rem',
                fontWeight: 700,
              }}
            >
              {showIgnoredRequests
                ? t('groups_widget.ignored_requests', {
                    count: ignoredRequests.length,
                    defaultValue: 'Ignored requests ({{count}})',
                  })
                : t('groups_widget.hidden_requests_count', {
                    count: ignoredRequests.length,
                    defaultValue: '{{count}} ignored',
                  })}
            </Typography>
            <ButtonBase
              onClick={() => setShowIgnoredRequests((prev) => !prev)}
              sx={ignoredItemsActionSx}
            >
              {showIgnoredRequests
                ? t('groups_widget.back_to_requests', {
                    defaultValue: 'Back to requests',
                  })
                : t('groups_widget.show_ignored', {
                    defaultValue: 'Show ignored',
                  })}
            </ButtonBase>
          </Box>
        )}
        {effectiveRequests.length === 0 &&
        !showInitialRequestsLoading &&
        !requestsError ? (
          <IllustratedEmptyState
            actionLabel={t('groups_widget.refresh')}
            compact={isCompact}
            description={
              showIgnoredRequests
                ? t('groups_widget.ignored_requests_empty_description', {
                    defaultValue:
                      'Ignored requests are checked against your current pending requests.',
                  })
                : t('groups_widget.requests_empty_description')
            }
            onAction={() => void fetchJoinRequests(true)}
            title={
              showIgnoredRequests
                ? t('groups_widget.ignored_requests_empty_title', {
                    defaultValue: 'No ignored requests',
                  })
                : t('groups_widget.requests_empty_title')
            }
            variant="requests"
          />
        ) : (
          renderVirtualizedList(effectiveRequests.length, (index) => {
            const request = effectiveRequests[index];
            if (!request) return null;

            return (
              <Box
                sx={{
                  background: widgetItemSurfaceColor,
                  border: `1px solid ${widgetItemBorderColor}`,
                  borderRadius: GROUP_WIDGET_CARD_RADIUS,
                  boxShadow: widgetItemInsetShadow,
                  display: 'flex',
                  flexDirection: 'column',
                  flexShrink: 0,
                  gap: isCompact ? '7px' : '8px',
                  p: rowPadding,
                  transition:
                    'background 140ms ease, border-color 140ms ease, transform 120ms ease, box-shadow 140ms ease',
                  width: '100%',
                  '&:hover': {
                    background: widgetItemHoverSurfaceColor,
                    borderColor: widgetItemHoverBorderColor,
                    boxShadow:
                      theme.palette.mode === 'dark'
                        ? `0 14px 28px rgba(0,0,0,0.22), inset 0 1px 0 ${alpha(theme.palette.common.white, 0.05)}`
                        : widgetItemInsetShadow,
                    transform: 'translateY(-1px)',
                  },
                }}
              >
                <Box sx={{ display: 'flex', gap: '9px', minWidth: 0 }}>
                  <Avatar
                    sx={{
                      bgcolor: alpha(theme.palette.primary.main, 0.12),
                      color: theme.palette.text.primary,
                      height: isCompact ? 34 : 38,
                      width: isCompact ? 34 : 38,
                    }}
                  >
                    <ForumRoundedIcon sx={{ fontSize: '1rem' }} />
                  </Avatar>
                  <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
                    <Typography
                      sx={{
                        color: theme.palette.text.primary,
                        fontSize: isCompact ? '0.8rem' : '0.84rem',
                        fontWeight: 700,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {request.groupName}
                    </Typography>
                    <Typography
                      sx={{
                        color: theme.palette.primary.main,
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        mt: '2px',
                      }}
                    >
                      {request.requesterLabel}
                    </Typography>
                    <Typography
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: '0.72rem',
                        lineHeight: 1.5,
                        mt: '2px',
                      }}
                    >
                      {t('groups_widget.wants_to_join')}
                    </Typography>
                  </Box>
                </Box>
                <Box
                  sx={{
                    display: 'flex',
                    gap: '8px',
                    justifyContent: 'flex-end',
                  }}
                >
                  <ButtonBase
                    onClick={() =>
                      void (showIgnoredRequests
                        ? handleRestoreRequest(request.id)
                        : handleRejectRequest(request.id))
                    }
                    sx={ignoredItemsActionSx}
                  >
                    {showIgnoredRequests
                      ? t('groups_widget.restore', {
                          defaultValue: 'Restore',
                        })
                      : t('groups_widget.ignore')}
                  </ButtonBase>
                  <LoadingButton
                    loading={resolvingRequestId === request.id}
                    onClick={() => void handleApproveRequest(request)}
                    sx={{
                      borderRadius: '999px',
                      fontSize: '0.7rem',
                      fontWeight: 800,
                      minHeight: '30px',
                      px: 1.35,
                      textTransform: 'none',
                    }}
                    variant="contained"
                  >
                    {t('groups_widget.approve')}
                  </LoadingButton>
                </Box>
              </Box>
            );
          })
        )}
      </Box>
    </QAppWidgetContainer>
  );

  const renderPromotionsList = () => (
    <QAppWidgetContainer
      emptyMessage={t('groups_widget.promoted_empty_message')}
      emptyTitle={t('groups_widget.promoted_empty_title')}
      error={promotionsError}
      hasContent={effectivePromotions.length > 0}
      isEmpty={
        !showInitialPromotionsLoading && effectivePromotions.length === 0
      }
      isLoading={showInitialPromotionsLoading}
      loadingLabel={t('groups_widget.loading_promoted')}
      onRetry={() => void fetchPromotions()}
      stateVerticalOffset="-24px"
    >
      <Box
        sx={{
          display: 'flex',
          flex: '1 1 auto',
          flexDirection: 'column',
          gap: bodyGap,
          minHeight: 0,
        }}
      >
        {actionFeedback ? (
          <InlineFeedback
            message={actionFeedback.message}
            tone={actionFeedback.tone}
          />
        ) : null}
        {renderVirtualizedList(effectivePromotions.length, (index) => {
          const promotion = effectivePromotions[index];
          if (!promotion) return null;

          const isMember = memberGroupIds.has(Number(promotion.groupId));
          const promotionVisualState = getPromotionVisualState(
            promotion,
            isMember
          );

          return (
            <Box
              sx={{
                background: widgetItemSurfaceColor,
                border: `1px solid ${widgetItemBorderColor}`,
                borderRadius: GROUP_WIDGET_CARD_RADIUS,
                boxShadow: widgetItemInsetShadow,
                display: 'flex',
                flexDirection: 'column',
                flexShrink: 0,
                gap: isCompact ? '6px' : '7px',
                px: isCompact ? '11px' : '12px',
                py: isCompact ? '9px' : '10px',
                transition:
                  'background 140ms ease, border-color 140ms ease, transform 120ms ease, box-shadow 140ms ease',
                width: '100%',
                '&:hover': {
                  background: widgetItemHoverSurfaceColor,
                  borderColor: widgetItemHoverBorderColor,
                  boxShadow:
                    theme.palette.mode === 'dark'
                      ? `0 14px 28px rgba(0,0,0,0.22), inset 0 1px 0 ${alpha(theme.palette.common.white, 0.05)}`
                      : widgetItemInsetShadow,
                  transform: 'translateY(-1px)',
                },
              }}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: '9px',
                  minWidth: 0,
                }}
              >
                <Avatar
                  sx={{
                    bgcolor:
                      theme.palette.mode === 'dark'
                        ? alpha(theme.palette.primary.main, 0.18)
                        : alpha(theme.palette.primary.main, 0.1),
                    color:
                      theme.palette.mode === 'dark'
                        ? alpha(theme.palette.common.white, 0.92)
                        : theme.palette.primary.dark,
                    height: isCompact ? 34 : 38,
                    width: isCompact ? 34 : 38,
                  }}
                >
                  <CampaignRoundedIcon sx={{ fontSize: '1rem' }} />
                </Avatar>
                <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
                  <Typography
                    sx={{
                      color: theme.palette.text.primary,
                      fontSize: isCompact ? '0.8rem' : '0.84rem',
                      fontWeight: 700,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {promotion.groupName}
                  </Typography>
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      lineHeight: 1.35,
                      mt: '1px',
                    }}
                  >
                    {t('groups_widget.promoted_by', {
                      name: promotion.promoterName,
                    })}
                  </Typography>
                </Box>
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    flexShrink: 0,
                    fontSize: '0.67rem',
                    fontWeight: 600,
                  }}
                >
                  {formatTimestamp(promotion.created)}
                </Typography>
              </Box>
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  display: '-webkit-box',
                  fontSize: isCompact ? '0.72rem' : '0.75rem',
                  lineHeight: 1.38,
                  maxWidth: { xs: '100%', sm: '62%' },
                  overflow: 'hidden',
                  pr: { sm: '8px' },
                  WebkitBoxOrient: 'vertical',
                  WebkitLineClamp: 2,
                  wordBreak: 'break-word',
                }}
              >
                {promotion.snippet}
              </Typography>
              <Box
                sx={{
                  alignItems: 'center',
                  color: theme.palette.text.secondary,
                  columnGap: '12px',
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) auto' },
                  pt: '2px',
                  rowGap: '8px',
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '0.67rem',
                      fontWeight: 600,
                      lineHeight: 1.3,
                    }}
                  >
                    {promotion.memberCount != null
                      ? t('groups_widget.members_count', {
                          count: promotion.memberCount,
                        })
                      : promotion.isOpen === false
                        ? t('groups_widget.private_group')
                        : t('groups_widget.public_group')}
                  </Typography>
                </Box>
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    justifySelf: { xs: 'stretch', sm: 'end' },
                    justifyContent: { xs: 'stretch', sm: 'flex-end' },
                    minHeight: '27px',
                  }}
                >
                  {promotionVisualState === 'member' ? (
                    <Button
                      disableElevation
                      onClick={() =>
                        handleOpenGroupChat(String(promotion.groupId))
                      }
                      startIcon={
                        <OpenInNewRoundedIcon sx={{ fontSize: '0.85rem' }} />
                      }
                      sx={promotionPrimaryActionSx}
                    >
                      {t('groups_widget.open')}
                    </Button>
                  ) : promotionVisualState === 'connecting' ? (
                    <LoadingButton
                      disabled
                      loading
                      sx={promotionPrimaryActionSx}
                    >
                      {t('groups_widget.connecting')}
                    </LoadingButton>
                  ) : promotionVisualState === 'processing' ? (
                    <Button disabled sx={promotionSecondaryActionSx}>
                      {t('groups_widget.processing')}
                    </Button>
                  ) : promotionVisualState === 'request_sent' ? (
                    <Button disabled sx={promotionSecondaryActionSx}>
                      {t('groups_widget.request_sent')}
                    </Button>
                  ) : (
                    <Button
                      disableElevation
                      onClick={() => void handleJoinPromotedGroup(promotion)}
                      sx={promotionPrimaryActionSx}
                    >
                      {promotionVisualState === 'request'
                        ? t('groups_widget.request_access')
                        : t('groups_widget.join_group')}
                    </Button>
                  )}
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>
    </QAppWidgetContainer>
  );

  const invitesCount = visibleInvites.length;
  const requestsCount = visibleRequests.length;

  return (
    <Box
      sx={{
        display: 'flex',
        flex: '1 1 auto',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        width: '100%',
      }}
    >
      <Box
        role="tablist"
        sx={{
          alignItems: 'center',
          borderBottom: `1px solid ${alpha(
            theme.palette.border.main,
            theme.palette.mode === 'dark' ? 0.18 : 0.1
          )}`,
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px 12px',
          position: 'relative',
          pb: '6px',
          px: '8px',
          pt: '5px',
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flex: '1 1 auto',
            flexWrap: 'wrap',
            gap: '8px',
            minWidth: 0,
          }}
        >
          <TabButton
            active={activeTab === 'notifications'}
            count={effectiveUnreadNotificationCount}
            label={t('groups_widget.tab_notifications')}
            onClick={() => {
              setActiveTab('notifications');
            }}
            tabId="notifications"
          />
          <TabButton
            active={activeTab === 'invites'}
            count={invitesCount}
            label={t('groups_widget.tab_invites')}
            onClick={() => {
              setActiveTab('invites');
            }}
            tabId="invites"
          />
          <TabButton
            active={activeTab === 'requests'}
            count={requestsCount}
            label={t('groups_widget.tab_requests')}
            onClick={() => {
              setActiveTab('requests');
            }}
            tabId="requests"
          />
          <TabButton
            active={activeTab === 'promoted'}
            label={t('groups_widget.tab_promoted')}
            onClick={() => {
              setActiveTab('promoted');
            }}
            tabId="promoted"
            subtle
          />
        </Box>
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexShrink: 0,
            flexWrap: 'wrap',
            gap: '8px',
            justifyContent: 'flex-end',
          }}
        >
          <ButtonBase
            onClick={handleOpenGroupDiscovery}
            sx={discoverGroupsActionSx}
          >
            <SearchRoundedIcon sx={{ fontSize: '0.9rem' }} />
            {t('groups_widget.discover_groups')}
          </ButtonBase>
          {activeTab === 'promoted' ? (
            <Tooltip
              disableHoverListener={hasPromotionAdminAccess}
              placement="top"
              title={t('groups_widget.group_admin_only')}
            >
              <Box sx={{ display: 'inline-flex' }}>
                <ButtonBase
                  disabled={!hasPromotionAdminAccess}
                  onClick={handleOpenPromotionDialog}
                  sx={headerUtilityActionSx}
                  title={
                    hasPromotionAdminAccess
                      ? t('groups_widget.promote_page_title')
                      : undefined
                  }
                >
                  <CampaignRoundedIcon sx={{ fontSize: '0.9rem' }} />
                  {t('groups_widget.promote_group')}
                </ButtonBase>
              </Box>
            </Tooltip>
          ) : null}
        </Box>
      </Box>

      <Box
        key={activeTab}
        sx={{
          display: 'flex',
          flex: '1 1 auto',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {activeTab === 'notifications'
          ? renderNotificationList()
          : activeTab === 'invites'
            ? renderInvitesList()
            : activeTab === 'requests'
              ? renderRequestsList()
              : renderPromotionsList()}
      </Box>

      <Dialog
        fullWidth
        maxWidth="xs"
        open={promotionDialogOpen}
        onClose={() => {
          if (!publishingPromotion) {
            setPromotionDialogOpen(false);
          }
        }}
      >
        <DialogTitle sx={{ fontSize: '1rem', fontWeight: 700 }}>
          {t('groups_widget.promote_group')}
        </DialogTitle>
        <DialogContent
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
            pt: '10px !important',
          }}
        >
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '0.78rem',
              lineHeight: 1.5,
            }}
          >
            {t('groups_widget.promote_dialog_intro')}
            {promotionFee
              ? t('groups_widget.promote_dialog_fee', { fee: promotionFee })
              : ''}
          </Typography>
          <Select
            displayEmpty
            value={promotionGroupId}
            onChange={(event) => {
              setPromotionGroupId(String(event.target.value));
            }}
            size="small"
          >
            <MenuItem disabled value="">
              {t('groups_widget.select_admin_group')}
            </MenuItem>
            {promotionAdminGroups.map((group: any) => (
              <MenuItem key={group?.groupId} value={String(group?.groupId)}>
                {group?.groupName}
              </MenuItem>
            ))}
          </Select>
          <TextField
            minRows={4}
            multiline
            placeholder={t('groups_widget.promotion_placeholder')}
            value={promotionText}
            onChange={(event) => {
              setPromotionText(event.target.value.slice(0, 200));
            }}
          />
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '0.7rem',
              textAlign: 'right',
            }}
          >
            {t('groups_widget.characters_count', {
              current: promotionText.length,
              max: 200,
            })}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, pt: 0 }}>
          <Button
            disabled={publishingPromotion}
            onClick={() => {
              setPromotionDialogOpen(false);
            }}
            sx={{ textTransform: 'none' }}
          >
            {t('groups_widget.cancel')}
          </Button>
          <LoadingButton
            disabled={!promotionGroupId || !promotionText.trim()}
            loading={publishingPromotion}
            onClick={() => {
              void handlePublishPromotion();
            }}
            sx={{
              borderRadius: '999px',
              px: 1.8,
              textTransform: 'none',
              ...getBlueTier1ButtonSx(),
            }}
          >
            {t('groups_widget.publish')}
          </LoadingButton>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
