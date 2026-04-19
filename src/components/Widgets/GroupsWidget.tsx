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
import { useAtom, useAtomValue } from 'jotai';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
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
  senderLabel: string;
  snippet: string;
  timestamp: number;
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
  debugState?: GroupPromotionVisualState;
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
const GROUP_WIDGET_CARD_RADIUS = '8px';

const stripHtml = (value: string) =>
  value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const truncateAddress = (value: string) =>
  value.length > 14 ? `${value.slice(0, 7)}...${value.slice(-5)}` : value;

const getGroupAvatarUrl = (ownerName: string | null, groupId: string | number) =>
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
    encodeURIComponent(input).replace(
      /%([0-9A-F]{2})/g,
      (_, code) => String.fromCharCode(Number(`0x${code}`))
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
    !active && tabId === 'notifications' && typeof count === 'number' && count > 0;

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
        color: active
          ? APP_BLUE_SURFACE_TEXT
          : theme.palette.text.secondary,
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
              animation: 'groupsNotificationsPillInnerGlow 3.6s ease-in-out infinite',
              '&::before': {
                animation: 'groupsNotificationsPillInnerVeil 3.6s ease-in-out infinite',
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
            : alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.052 : 0.038),
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
  actionLabel = 'Refresh',
  compact = false,
  description,
  onAction,
  title,
  variant,
}: {
  actionLabel?: string;
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
  const [groupInvitesCache, setGroupInvitesCache] = useAtom(groupInvitesCacheAtom);
  const [joinRequestsCache, setJoinRequestsCache] = useAtom(joinRequestsCacheAtom);
  const groupInvitesCacheRef = useRef(groupInvitesCache);
  const joinRequestsCacheRef = useRef(joinRequestsCache);
  const [activeTab, setActiveTab] = useState<GroupsWidgetTab>('notifications');
  const [actionFeedback, setActionFeedback] = useState<{
    message: string;
    tone: 'error' | 'success';
  } | null>(null);
  const [dismissedInviteIds, setDismissedInviteIds] = useState<string[]>([]);
  const [dismissedRequestIds, setDismissedRequestIds] = useState<string[]>([]);
  const [invites, setInvites] = useState<GroupInviteItem[]>([]);
  const [invitesError, setInvitesError] = useState<string | null>(null);
  const [hasLoadedInvitesOnce, setHasLoadedInvitesOnce] = useState(false);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [joiningGroupId, setJoiningGroupId] = useState<number | null>(null);
  const [joiningPromotionGroupId, setJoiningPromotionGroupId] = useState<number | null>(null);
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
  const [resolvingRequestId, setResolvingRequestId] = useState<string | null>(null);
  const isCompact = displayMode === 'compact';
  const rowPadding = isCompact ? '11px 12px' : '13px 13px';
  const rowGap = isCompact ? '9px' : '11px';
  const bodyGap = isCompact ? '10px' : '13px';
  const messageLineClamp = isCompact ? 1 : 2;
  const currentAddress = userInfo?.address;
  const isAnyLoading = invitesLoading || requestsLoading || promotionsLoading;
  const [isGroupsDebugMode, setIsGroupsDebugMode] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    try {
      const params = new URLSearchParams(window.location.search);
      const queryToggle = (
        params.get('groupsWidgetDebug') ??
        params.get('widgetDebug') ??
        ''
      )
        .trim()
        .toLowerCase();
      const storedToggle = (
        window.localStorage.getItem('hub.groupsWidgetDebug') ?? ''
      )
        .trim()
        .toLowerCase();

      return (
        queryToggle === '1' ||
        queryToggle === 'true' ||
        queryToggle === 'groups' ||
        queryToggle === 'all' ||
        storedToggle === '1' ||
        storedToggle === 'true'
      );
    } catch (error) {
      console.error('Failed to read groups widget debug toggle', error);
      return false;
    }
  });
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
      .filter((group: any) => group?.groupId != null)
      .map((group: any) => {
        const groupId = String(group.groupId);
        const timestamp = typeof group.timestamp === 'number' ? group.timestamp : 0;
        const snippet = normalizeSnippet(
          group.data,
          'Recent group activity will appear here.'
        );
        const groupName =
          group.groupId === '0'
            ? 'General'
            : group.groupName || `Group ${groupId}`;
        const senderLabel =
          group.sender === currentAddress
            ? 'You'
            : group.senderName || truncateAddress(String(group.sender || 'Unknown'));
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
          senderLabel,
          snippet,
          timestamp,
        };
      })
      .filter((item) => item.timestamp > 0)
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, GROUP_NOTIFICATION_PREVIEW_LIMIT);
  }, [
    currentAddress,
    groupChatTimestamps,
    memberGroups,
    ownerNamesByGroupId,
    timestampEnterData,
  ]);

  const unreadNotificationCount = useMemo(
    () => notificationItems.filter((item) => item.isUnread).length,
    [notificationItems]
  );

  const debugNotificationItems = useMemo<GroupNotificationItem[]>(
    () => [
      {
        avatarUrl: null,
        groupId: '101',
        groupName: 'Core Builders',
        id: 'debug-notification-1',
        isEncryptedLike: false,
        isUnread: true,
        senderLabel: 'Q-Bot',
        snippet: 'The new weekly roadmap summary is ready for review.',
        timestamp: Date.now() - 1000 * 60 * 12,
      },
      {
        avatarUrl: null,
        groupId: '102',
        groupName: 'Design Loop',
        id: 'debug-notification-2',
        isEncryptedLike: false,
        isUnread: false,
        senderLabel: 'Luna',
        snippet: 'Updated concepts just landed in the shared folder.',
        timestamp: Date.now() - 1000 * 60 * 54,
      },
      {
        avatarUrl: null,
        groupId: '103',
        groupName: 'Marketplace',
        id: 'debug-notification-3',
        isEncryptedLike: false,
        isUnread: true,
        senderLabel: 'Marek',
        snippet: 'Can someone confirm the onboarding copy before tonight?',
        timestamp: Date.now() - 1000 * 60 * 115,
      },
    ],
    []
  );

  const debugInviteItems = useMemo<GroupInviteItem[]>(
    () => [
      {
        description: 'Private working group for launch partners',
        groupId: 201,
        groupName: 'Launch Partners',
        id: 'debug-invite-1',
        isOpen: false,
        participantCount: 18,
      },
      {
        description: 'Open discussion around UI experiments and feedback',
        groupId: 202,
        groupName: 'UX Sandbox',
        id: 'debug-invite-2',
        isOpen: true,
        participantCount: 64,
      },
    ],
    []
  );

  const debugRequestItems = useMemo<GroupJoinRequestItem[]>(
    () => [
      {
        groupId: 301,
        groupName: 'Moderators',
        id: 'debug-request-1',
        joiner: 'Qd3bugjoiner1111111111111111111111111',
        requesterLabel: 'Ayla',
      },
      {
        groupId: 302,
        groupName: 'Builders Guild',
        id: 'debug-request-2',
        joiner: 'Qd3bugjoiner2222222222222222222222222',
        requesterLabel: 'Torin',
      },
    ],
    []
  );

  const debugPromotions = useMemo<GroupPromotionItem[]>(
    () => [
      {
        created: Date.now() - 1000 * 60 * 22,
        debugState: 'join',
        groupId: 401,
        groupName: 'Open Traders',
        id: 'debug-promotion-join',
        isOpen: true,
        memberCount: 148,
        promoterName: 'Q-Trade Hub',
        snippet:
          'Real-time trade chatter, listings, and quick peer support for active market sessions.',
      },
      {
        created: Date.now() - 1000 * 60 * 45,
        debugState: 'request',
        groupId: 402,
        groupName: 'Creators Circle',
        id: 'debug-promotion-request',
        isOpen: false,
        memberCount: 41,
        promoterName: 'Mina',
        snippet:
          'A curated space for launches, feedback swaps, and collaboration invites across Q-Apps.',
      },
      {
        created: Date.now() - 1000 * 60 * 78,
        debugState: 'connecting',
        groupId: 403,
        groupName: 'Node Builders',
        id: 'debug-promotion-connecting',
        isOpen: true,
        memberCount: 26,
        promoterName: 'Nox',
        snippet:
          'Diagnostics, setup help, and coordination for users bringing fresh infrastructure online.',
      },
      {
        created: Date.now() - 1000 * 60 * 124,
        debugState: 'request_sent',
        groupId: 404,
        groupName: 'Audio Garden',
        id: 'debug-promotion-request-sent',
        isOpen: false,
        memberCount: 12,
        promoterName: 'Carys',
        snippet:
          'Shared listening sessions, release previews, and artist feedback inside a smaller private room.',
      },
      {
        created: Date.now() - 1000 * 60 * 170,
        debugState: 'member',
        groupId: 405,
        groupName: 'Hub Operators',
        id: 'debug-promotion-member',
        isOpen: true,
        memberCount: 9,
        promoterName: 'George',
        snippet:
          'Already joined. This card previews the member-state action and compact promoted layout.',
      },
    ],
    []
  );

  const debugPromotionAdminGroups = useMemo(
    () => [
      {
        groupId: 801,
        groupName: 'Debug Launch Council',
      },
      {
        groupId: 802,
        groupName: 'Debug Creator Circle',
      },
    ],
    []
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
    () =>
      isGroupsDebugMode
        ? [...(myGroupsWhereIAmAdmin?.length ? myGroupsWhereIAmAdmin : debugPromotionAdminGroups)]
        : [...(myGroupsWhereIAmAdmin ?? [])],
    [debugPromotionAdminGroups, isGroupsDebugMode, myGroupsWhereIAmAdmin]
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
            groupName: group.groupName ?? `Group ${group.groupId}`,
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
          groupName: group.groupName ?? `Group ${group.groupId}`,
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
        setInvitesError('Could not load group invites right now.');
      } finally {
        setHasLoadedInvitesOnce(true);
        setInvitesLoading(false);
      }
    },
    [myAddress, setGroupInvitesCache]
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
            groupName: entry.group?.groupName ?? `Group ${entry.group?.groupId}`,
            id: `request:${entry.group?.groupId}:${request?.joiner}`,
            joiner: request?.joiner ?? '',
            requesterLabel:
              request?.name || truncateAddress(String(request?.joiner ?? 'Unknown')),
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
            groupName: entry.group?.groupName ?? `Group ${entry.group?.groupId}`,
            id: `request:${entry.group?.groupId}:${request?.joiner}`,
            joiner: request?.joiner ?? '',
            requesterLabel:
              request?.name || truncateAddress(String(request?.joiner ?? 'Unknown')),
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
        setRequestsError('Could not load join requests right now.');
      } finally {
        setHasLoadedRequestsOnce(true);
        setRequestsLoading(false);
      }
    },
    [adminGroupIds, myAddress, setJoinRequestsCache]
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
          groupName: promotion.groupName ?? `Group ${promotion.groupId}`,
          id: `promotion:${promotion.identifier}`,
          isOpen:
            typeof promotion.isOpen === 'boolean' ? promotion.isOpen : undefined,
          memberCount:
            promotion.memberCount ?? promotion.participantCount ?? undefined,
          promoterName: promotion.name ?? 'Unknown',
          snippet: normalizeSnippet(
            promotion.data,
            'This group has a fresh promoted update.'
          ),
        }))
      );
      setHasLoadedPromotionsOnce(true);
    } catch (error) {
      console.error('Failed to load group promotions widget data', error);
      setPromotionsError('Could not load promoted groups right now.');
    } finally {
      setHasLoadedPromotionsOnce(true);
      setPromotionsLoading(false);
    }
  }, []);

  useEffect(() => {
    setDismissedInviteIds([]);
    setDismissedRequestIds([]);
    setActionFeedback(null);
    void fetchInvites(false);
    void fetchJoinRequests(false);
    void fetchPromotions();
  }, [fetchInvites, fetchJoinRequests, fetchPromotions, myAddress]);

  useEffect(() => {
    if (refreshToken === 0) {
      return;
    }

    setDismissedInviteIds([]);
    setDismissedRequestIds([]);
    setActionFeedback(null);
    void fetchInvites(true);
    void fetchJoinRequests(true);
    void fetchPromotions();
  }, [fetchInvites, fetchJoinRequests, fetchPromotions, refreshToken]);

  const visibleInvites = useMemo(
    () => invites.filter((invite) => !dismissedInviteIds.includes(invite.id)),
    [dismissedInviteIds, invites]
  );

  const visibleRequests = useMemo(
    () => requests.filter((request) => !dismissedRequestIds.includes(request.id)),
    [dismissedRequestIds, requests]
  );

  const showInitialInvitesLoading =
    !isGroupsDebugMode &&
    invitesLoading &&
    !hasLoadedInvitesOnce &&
    visibleInvites.length === 0;
  const showInitialRequestsLoading =
    !isGroupsDebugMode &&
    requestsLoading &&
    !hasLoadedRequestsOnce &&
    visibleRequests.length === 0;
  const showInitialPromotionsLoading =
    !isGroupsDebugMode &&
    promotionsLoading &&
    !hasLoadedPromotionsOnce &&
    promotions.length === 0;

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
          message: 'Join this group now?',
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

        setDismissedInviteIds((current) => [...current, invite.id]);
        setGroupInvitesCache(null);
        setActionFeedback({
          message: `Joined ${invite.groupName}.`,
          tone: 'success',
        });
      } catch (error: any) {
        console.error('Failed to join group invite from widget', error);
        setActionFeedback({
          message:
            error?.message || 'Could not accept that invite right now.',
          tone: 'error',
        });
      } finally {
        setJoiningGroupId(null);
      }
    },
    [setGroupInvitesCache, show]
  );

  const handleIgnoreInvite = useCallback((inviteId: string) => {
    setDismissedInviteIds((current) =>
      current.includes(inviteId) ? current : [...current, inviteId]
    );
    setActionFeedback({
      message: 'Invite hidden from this widget for now.',
      tone: 'success',
    });
  }, []);

  const handleApproveRequest = useCallback(
    async (request: GroupJoinRequestItem) => {
      try {
        const fee = await getFee('GROUP_INVITE');
        await show({
          message: 'Approve this request and invite them into the group?',
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

        setDismissedRequestIds((current) => [...current, request.id]);
        setJoinRequestsCache(null);
        setActionFeedback({
          message: `${request.requesterLabel} was approved for ${request.groupName}.`,
          tone: 'success',
        });
      } catch (error: any) {
        console.error('Failed to approve join request from widget', error);
        setActionFeedback({
          message:
            error?.message || 'Could not approve that request right now.',
          tone: 'error',
        });
      } finally {
        setResolvingRequestId(null);
      }
    },
    [setJoinRequestsCache, show]
  );

  const handleRejectRequest = useCallback((requestId: string) => {
    setDismissedRequestIds((current) =>
      current.includes(requestId) ? current : [...current, requestId]
    );
    setActionFeedback({
      message: 'Request removed from this widget for now.',
      tone: 'success',
    });
  }, []);

  const handleJoinPromotedGroup = useCallback(
    async (promotion: GroupPromotionItem) => {
      try {
        const fee = await getFee('JOIN_GROUP');
        await show({
          message: promotion.isOpen
            ? 'Join this promoted group now?'
            : 'Send a join request to this promoted group?',
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
            ? `Joined ${promotion.groupName}.`
            : `Join request sent for ${promotion.groupName}.`,
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
          message:
            error?.message || 'Could not act on that promoted group right now.',
          tone: 'error',
        });
      } finally {
        setJoiningPromotionGroupId(null);
      }
    },
    [show]
  );

  const handlePublishPromotion = useCallback(async () => {
    try {
      if (!promotionGroupId || !promotionText.trim()) {
        return;
      }

      setPublishingPromotion(true);
      setActionFeedback(null);

      if (isGroupsDebugMode) {
        await new Promise((resolve) => {
          window.setTimeout(resolve, 420);
        });

        setPromotionDialogOpen(false);
        setPromotionGroupId('');
        setPromotionText('');
        setActionFeedback({
          message: 'Debug promotion preview submitted.',
          tone: 'success',
        });
        setActiveTab('promoted');
        return;
      }

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
        message: 'Group promotion published.',
        tone: 'success',
      });
      await fetchPromotions();
      setActiveTab('promoted');
    } catch (error: any) {
      console.error('Failed to publish group promotion from widget', error);
      setActionFeedback({
        message:
          error?.message || 'Could not publish that promotion right now.',
        tone: 'error',
      });
    } finally {
      setPublishingPromotion(false);
    }
  }, [fetchPromotions, isGroupsDebugMode, promotionGroupId, promotionText]);

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
    overflowY: 'auto',
    overscrollBehavior: 'contain',
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

  const widgetItemSurfaceColor =
    theme.palette.mode === 'dark'
      ? alpha(theme.palette.common.white, 0.044)
      : alpha(theme.palette.text.primary, 0.036);

  const widgetItemHoverSurfaceColor =
    theme.palette.mode === 'dark'
      ? alpha(theme.palette.common.white, 0.062)
      : alpha(theme.palette.text.primary, 0.048);

  const widgetItemBorderColor = alpha(
    theme.palette.border.main,
    theme.palette.mode === 'dark' ? 0.2 : 0.12
  );

  const widgetItemHoverBorderColor = alpha(
    theme.palette.border.main,
    theme.palette.mode === 'dark' ? 0.28 : 0.18
  );

  const widgetItemInsetShadow =
    theme.palette.mode === 'dark'
      ? `inset 0 1px 0 ${alpha(theme.palette.common.white, 0.05)}`
      : `inset 0 1px 0 ${alpha(theme.palette.common.white, 0.72)}`;
  const readNotificationSurfaceColor =
    theme.palette.mode === 'dark'
      ? alpha(theme.palette.common.white, 0.038)
      : alpha(theme.palette.text.primary, 0.03);
  const readNotificationHoverSurfaceColor =
    theme.palette.mode === 'dark'
      ? alpha(theme.palette.common.white, 0.052)
      : alpha(theme.palette.text.primary, 0.04);
  const unreadNotificationSurfaceColor =
    theme.palette.mode === 'dark'
      ? alpha(theme.palette.primary.main, 0.032)
      : alpha(theme.palette.primary.main, 0.02);
  const unreadNotificationHoverSurfaceColor =
    theme.palette.mode === 'dark'
      ? alpha(theme.palette.primary.main, 0.042)
      : alpha(theme.palette.primary.main, 0.027);
  const unreadNotificationBorderColor = alpha(
    theme.palette.primary.main,
    theme.palette.mode === 'dark' ? 0.09 : 0.06
  );

  const effectiveNotificationItems = isGroupsDebugMode
    ? debugNotificationItems
    : notificationItems;
  const effectiveInvites = isGroupsDebugMode ? debugInviteItems : visibleInvites;
  const effectiveRequests = isGroupsDebugMode ? debugRequestItems : visibleRequests;
  const effectivePromotions = isGroupsDebugMode ? debugPromotions : promotions;
  const effectiveUnreadNotificationCount = isGroupsDebugMode
    ? debugNotificationItems.filter((item) => item.isUnread).length
    : unreadNotificationCount;

  useEffect(() => {
    const handleSetGroupsWidgetDebug = (event: CustomEvent) => {
      const nextEnabled = !!event.detail?.data?.enabled;
      setIsGroupsDebugMode(nextEnabled);
    };

    subscribeToEvent('setGroupsWidgetDebug', handleSetGroupsWidgetDebug);

    return () => {
      unsubscribeFromEvent('setGroupsWidgetDebug', handleSetGroupsWidgetDebug);
    };
  }, []);

  const getPromotionVisualState = useCallback(
    (
      promotion: GroupPromotionItem,
      isMember: boolean
    ): GroupPromotionVisualState => {
      if (isGroupsDebugMode && promotion.debugState) {
        return promotion.debugState;
      }

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
    [isGroupsDebugMode, joiningPromotionGroupId, promotionActionStates]
  );

  const renderNotificationList = () => (
    <QAppWidgetContainer
      emptyMessage="Recent group conversations will surface here once your groups have message activity."
      emptyTitle={
        isGroupsDebugMode ? 'Debug notifications' : 'No recent group notifications'
      }
      hasContent={effectiveNotificationItems.length > 0}
      isEmpty={effectiveNotificationItems.length === 0}
      isLoading={false}
      loadingLabel="Loading notifications"
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
        <Box sx={sharedScrollerSx}>
          {effectiveNotificationItems.map((item) => (
            <ButtonBase
              key={item.id}
              onClick={() => {
                if (!isGroupsDebugMode) {
                  handleOpenGroupChat(item.groupId);
                }
              }}
              sx={{
                alignItems: 'flex-start',
                backgroundColor: item.isUnread
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
                gap: rowGap,
                overflow: 'hidden',
                p: rowPadding,
                position: 'relative',
                textAlign: 'left',
                transition:
                  'background-color 140ms ease, border-color 140ms ease, transform 120ms ease',
                width: '100%',
                '&::before': item.isUnread
                  ? {
                      background: `linear-gradient(180deg, transparent 0%, ${alpha(
                        theme.palette.primary.main,
                        theme.palette.mode === 'dark' ? 0.34 : 0.28
                      )} 12%, ${alpha(
                        theme.palette.primary.main,
                        theme.palette.mode === 'dark' ? 0.34 : 0.28
                      )} 88%, transparent 100%)`,
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
                  backgroundColor: item.isUnread
                    ? unreadNotificationHoverSurfaceColor
                    : readNotificationHoverSurfaceColor,
                  borderColor: item.isUnread
                    ? alpha(
                        theme.palette.primary.main,
                        theme.palette.mode === 'dark' ? 0.18 : 0.13
                      )
                    : widgetItemHoverBorderColor,
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

              <Box sx={{ display: 'flex', flex: '1 1 auto', flexDirection: 'column', gap: isCompact ? '4px' : '5px', minWidth: 0 }}>
                <Box sx={{ alignItems: 'center', display: 'flex', gap: '8px', justifyContent: 'space-between', minWidth: 0 }}>
                  <Box sx={{ alignItems: 'center', display: 'inline-flex', gap: '8px', minWidth: 0 }}>
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
                    from
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
                        New encrypted message
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
                  {item.isEncryptedLike ? 'View conversation' : 'Open conversation'}
                </Box>
              </Box>
            </ButtonBase>
          ))}
        </Box>
      </Box>
    </QAppWidgetContainer>
  );

  const renderInvitesList = () => (
    <QAppWidgetContainer
      error={isGroupsDebugMode ? null : invitesError}
      hasContent={effectiveInvites.length > 0}
      isEmpty={false}
      isLoading={!isGroupsDebugMode && showInitialInvitesLoading}
      loadingLabel="Loading invites"
      onRetry={() => {
        if (!isGroupsDebugMode) {
          void fetchInvites(true);
        }
      }}
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
        {effectiveInvites.length === 0 &&
        !showInitialInvitesLoading &&
        !(isGroupsDebugMode ? null : invitesError) ? (
          <IllustratedEmptyState
            compact={isCompact}
            description="Fresh group invitations will appear here as they arrive."
            onAction={() => {
              if (!isGroupsDebugMode) {
                void fetchInvites(true);
              }
            }}
            title={isGroupsDebugMode ? 'Debug invites' : 'No pending invites'}
            variant="invites"
          />
        ) : (
          <Box sx={sharedScrollerSx}>
            {effectiveInvites.map((invite) => (
              <Box
                key={invite.id}
                sx={{
                  backgroundColor: widgetItemSurfaceColor,
                  border: `1px solid ${widgetItemBorderColor}`,
                  borderRadius: GROUP_WIDGET_CARD_RADIUS,
                  boxShadow: widgetItemInsetShadow,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: isCompact ? '7px' : '8px',
                  p: rowPadding,
                  transition:
                    'background-color 140ms ease, border-color 140ms ease, transform 120ms ease',
                  '&:hover': {
                    backgroundColor: widgetItemHoverSurfaceColor,
                    borderColor: widgetItemHoverBorderColor,
                    transform: 'translateY(-1px)',
                  },
                }}
              >
                <Box sx={{ alignItems: 'center', display: 'flex', gap: '9px', minWidth: 0 }}>
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
                        ? normalizeSnippet(invite.description, 'Private group invite')
                        : invite.participantCount
                          ? `${invite.participantCount} members`
                          : 'Invitation ready to review'}
                    </Typography>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <ButtonBase
                    onClick={() => {
                      if (!isGroupsDebugMode) {
                        handleIgnoreInvite(invite.id);
                      }
                    }}
                    sx={{
                      alignItems: 'center',
                      border: `1px solid ${alpha(
                        theme.palette.border.main,
                        theme.palette.mode === 'dark' ? 0.22 : 0.14
                      )}`,
                      borderRadius: '999px',
                      color: theme.palette.text.secondary,
                      display: 'inline-flex',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      minHeight: '30px',
                      px: 1.25,
                      textTransform: 'none',
                      '&:hover': {
                        backgroundColor: theme.palette.action.hover,
                        color: theme.palette.text.primary,
                      },
                    }}
                  >
                    Ignore
                  </ButtonBase>
                  <LoadingButton
                    loading={joiningGroupId === invite.groupId}
                    onClick={() => {
                      if (!isGroupsDebugMode) {
                        void handleAcceptInvite(invite);
                      }
                    }}
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
                    Accept
                  </LoadingButton>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </QAppWidgetContainer>
  );

  const renderRequestsList = () => (
    <QAppWidgetContainer
      error={isGroupsDebugMode ? null : requestsError}
      hasContent={effectiveRequests.length > 0}
      isEmpty={false}
      isLoading={!isGroupsDebugMode && showInitialRequestsLoading}
      loadingLabel="Loading requests"
      onRetry={() => {
        if (!isGroupsDebugMode) {
          void fetchJoinRequests(true);
        }
      }}
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
        {effectiveRequests.length === 0 &&
        !showInitialRequestsLoading &&
        !(isGroupsDebugMode ? null : requestsError) ? (
          <IllustratedEmptyState
            compact={isCompact}
            description="Join requests from groups you manage will appear here."
            onAction={() => {
              if (!isGroupsDebugMode) {
                void fetchJoinRequests(true);
              }
            }}
            title={isGroupsDebugMode ? 'Debug requests' : 'No pending requests'}
            variant="requests"
          />
        ) : (
          <Box sx={sharedScrollerSx}>
            {effectiveRequests.map((request) => (
              <Box
                key={request.id}
                sx={{
                  backgroundColor: widgetItemSurfaceColor,
                  border: `1px solid ${widgetItemBorderColor}`,
                  borderRadius: GROUP_WIDGET_CARD_RADIUS,
                  boxShadow: widgetItemInsetShadow,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: isCompact ? '7px' : '8px',
                  p: rowPadding,
                  transition:
                    'background-color 140ms ease, border-color 140ms ease, transform 120ms ease',
                  '&:hover': {
                    backgroundColor: widgetItemHoverSurfaceColor,
                    borderColor: widgetItemHoverBorderColor,
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
                      Wants to join this group.
                    </Typography>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <ButtonBase
                    onClick={() => {
                      if (!isGroupsDebugMode) {
                        handleRejectRequest(request.id);
                      }
                    }}
                    sx={{
                      alignItems: 'center',
                      border: `1px solid ${alpha(
                        theme.palette.border.main,
                        theme.palette.mode === 'dark' ? 0.22 : 0.14
                      )}`,
                      borderRadius: '999px',
                      color: theme.palette.text.secondary,
                      display: 'inline-flex',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      minHeight: '30px',
                      px: 1.25,
                      '&:hover': {
                        backgroundColor: theme.palette.action.hover,
                        color: theme.palette.text.primary,
                      },
                    }}
                  >
                    Reject
                  </ButtonBase>
                  <LoadingButton
                    loading={resolvingRequestId === request.id}
                    onClick={() => {
                      if (!isGroupsDebugMode) {
                        void handleApproveRequest(request);
                      }
                    }}
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
                    Approve
                  </LoadingButton>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </QAppWidgetContainer>
  );

  const renderPromotionsList = () => (
    <QAppWidgetContainer
      emptyMessage="Promoted groups will appear here when fresh highlights are available."
      emptyTitle={isGroupsDebugMode ? 'Debug promoted groups' : 'No promoted groups'}
      error={isGroupsDebugMode ? null : promotionsError}
      hasContent={effectivePromotions.length > 0}
      isEmpty={!showInitialPromotionsLoading && effectivePromotions.length === 0}
      isLoading={!isGroupsDebugMode && showInitialPromotionsLoading}
      loadingLabel="Loading promoted groups"
      onRetry={() => {
        if (!isGroupsDebugMode) {
          void fetchPromotions();
        }
      }}
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
        <Box sx={sharedScrollerSx}>
          {effectivePromotions.map((promotion) => {
            const isMember = memberGroupIds.has(Number(promotion.groupId));
            const promotionVisualState = getPromotionVisualState(
              promotion,
              isMember
            );

            return (
              <Box
                key={promotion.id}
                sx={{
                  backgroundColor: widgetItemSurfaceColor,
                  border: `1px solid ${widgetItemBorderColor}`,
                  borderRadius: GROUP_WIDGET_CARD_RADIUS,
                  boxShadow: widgetItemInsetShadow,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: isCompact ? '6px' : '7px',
                  px: isCompact ? '11px' : '12px',
                  py: isCompact ? '9px' : '10px',
                  transition:
                    'background-color 140ms ease, border-color 140ms ease, transform 120ms ease',
                  '&:hover': {
                    backgroundColor: widgetItemHoverSurfaceColor,
                    borderColor: widgetItemHoverBorderColor,
                    transform: 'translateY(-1px)',
                  },
                }}
              >
                <Box sx={{ alignItems: 'center', display: 'flex', gap: '9px', minWidth: 0 }}>
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
                      Promoted by {promotion.promoterName}
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
                        ? `${promotion.memberCount} members`
                        : promotion.isOpen === false
                          ? 'Private group'
                          : 'Public group'}
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
                        onClick={() => {
                          if (!isGroupsDebugMode) {
                            handleOpenGroupChat(String(promotion.groupId));
                          }
                        }}
                        startIcon={<OpenInNewRoundedIcon sx={{ fontSize: '0.85rem' }} />}
                        sx={promotionPrimaryActionSx}
                      >
                        Open
                      </Button>
                    ) : promotionVisualState === 'connecting' ? (
                      <LoadingButton
                        disabled
                        loading
                        sx={promotionPrimaryActionSx}
                      >
                        Connecting...
                      </LoadingButton>
                    ) : promotionVisualState === 'processing' ? (
                      <Button disabled sx={promotionSecondaryActionSx}>
                        Processing...
                      </Button>
                    ) : promotionVisualState === 'request_sent' ? (
                      <Button disabled sx={promotionSecondaryActionSx}>
                        Request sent
                      </Button>
                    ) : (
                      <Button
                        disableElevation
                        onClick={() => {
                          if (!isGroupsDebugMode) {
                            void handleJoinPromotedGroup(promotion);
                          }
                        }}
                        sx={promotionPrimaryActionSx}
                      >
                        {promotionVisualState === 'request'
                          ? 'Request access'
                          : 'Join group'}
                      </Button>
                    )}
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </QAppWidgetContainer>
  );

  const invitesCount = effectiveInvites.length;
  const requestsCount = effectiveRequests.length;

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
            label="Notifications"
            onClick={() => {
              setActiveTab('notifications');
            }}
            tabId="notifications"
          />
          <TabButton
            active={activeTab === 'invites'}
            count={invitesCount}
            label="Invites"
            onClick={() => {
              setActiveTab('invites');
            }}
            tabId="invites"
          />
          <TabButton
            active={activeTab === 'requests'}
            count={requestsCount}
            label="Requests"
            onClick={() => {
              setActiveTab('requests');
            }}
            tabId="requests"
          />
          <TabButton
            active={activeTab === 'promoted'}
            label="Promoted"
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
            sx={headerUtilityActionSx}
          >
            <SearchRoundedIcon sx={{ fontSize: '0.9rem' }} />
            Discover Groups
          </ButtonBase>
          {activeTab === 'promoted' ? (
            <Tooltip
              disableHoverListener={hasPromotionAdminAccess}
              placement="top"
              title="Group admin only"
            >
              <Box sx={{ display: 'inline-flex' }}>
                <ButtonBase
                  disabled={!hasPromotionAdminAccess}
                  onClick={handleOpenPromotionDialog}
                  sx={headerUtilityActionSx}
                  title={
                    hasPromotionAdminAccess
                      ? 'Promote one of your groups'
                      : undefined
                  }
                >
                  <CampaignRoundedIcon sx={{ fontSize: '0.9rem' }} />
                  Promote Group
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
          Promote Group
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
            Share a short highlighted update for one of your admin groups.
            {promotionFee ? ` Publish fee: ${promotionFee} QORT.` : ''}
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
              Select a group you admin
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
            placeholder="Write a short promotion for this group."
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
            {promotionText.length}/200
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
            Cancel
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
            Publish
          </LoadingButton>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
