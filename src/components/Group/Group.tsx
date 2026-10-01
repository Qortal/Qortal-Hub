import {
  Box,
  ButtonBase,
  IconButton,
  Paper,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import {
  lazy,
  memo,
  Profiler,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { ChatGroup } from '../Chat/ChatGroup';
import { CreateCommonSecret } from '../Chat/CreateCommonSecret';
import { base64ToUint8Array } from '../../qdn/encryption/group-encryption';
import { uint8ArrayToObject } from '../../encryption/encryption';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import CallIcon from '@mui/icons-material/Call';
import CallEndRoundedIcon from '@mui/icons-material/CallEndRounded';
import CircularProgress from '@mui/material/CircularProgress';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import FolderRoundedIcon from '@mui/icons-material/FolderRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SecurityRoundedIcon from '@mui/icons-material/SecurityRounded';
import { ReticulumUnreadCountBadge } from '../common/ReticulumUnreadCountBadge';
import { ReticulumModePill } from './ReticulumModePill';

import {
  clearAllQueues,
  getBaseApiReact,
  pauseAllQueues,
  resumeAllQueues,
} from '../../App';
import { ChatDirect } from '../Chat/ChatDirect';
import {
  applyReticulumJoinUnreadBaseline,
  resolveReticulumMembershipJoinedAt,
} from '../Chat/reticulumJoinUnreadBaseline';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { LoadingButton } from '@mui/lab';
import { LoadingSnackbar } from '../Snackbar/LoadingSnackbar';
import { GroupAnnouncements } from '../Chat/GroupAnnouncements';
import { GroupForum } from '../Chat/GroupForum';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { WebSocketActive } from './WebsocketActive';
import { WebSocketNotifications } from './WebsocketNotifications';
import {
  getGroupAdmins,
  getGroupMembers,
  getNameInfo,
  getPublishesFromAdmins,
} from './groupApi';
import { timeDifferenceForNotificationChats } from './groupConstants';
import { decryptResource } from './groupDataPublishes';
import { requestQueueMemberNames } from './groupQueues';
import {
  groupSectionUsesSecretKey,
  shouldLoadSecretKeyForSection,
  shouldLoadSecretKeyOnGroupEntry,
} from './groupSecretKeyPolicy';
import type { GroupProps } from './groupTypes';
import { areKeysEqual, validateSecretKey } from './groupValidation';
import { useMessageQueue } from '../../messaging/MessageQueueContext';
import { HomeDesktop } from './HomeDesktop';
import { DesktopHeader } from '../Desktop/DesktopHeader';
import { AppsDesktop } from '../Apps/AppsDesktop';
import { DesktopSideBar } from '../Desktop/DesktopLeftSideBar';
import { AdminSpace } from '../Chat/AdminSpace';
import {
  addressInfoControllerAtom,
  chatWidgetClosedAtom,
  enabledDevModeAtom,
  groupAnnouncementsAtom,
  groupChatTimestampsAtom,
  groupsOwnerNamesAtom,
  groupsPropertiesAtom,
  isDisabledEditorEnterAtom,
  isOpenBlockedModalAtom,
  isRunningPublicNodeAtom,
  memberGroupsAtom,
  memberGroupsLoadedAddressAtom,
  memberGroupsWithReticulumChatAtom,
  mutedGroupsAtom,
  myGroupsWhereIAmAdminAtom,
  reticulumDirectSummariesAtom,
  reticulumChatSummariesAtom,
  reticulumChatEnabledAtom,
  reticulumEnabledAtom,
  reticulumLegacyThreadsEnabledAtom,
  selectedGroupIdAtom,
  timestampEnterDataAtom,
  userInfoAtom,
  qortalGroupVoiceCallMinimizedAtom,
  qortalGroupCallPrimaryNamesAtom,
  dmFriendsByAddressAtom,
} from '../../atoms/global';
import { mergeDirectsWithFriends } from '../../lib/dm/mergeDirectsWithFriends';
import { validateAddress } from '../../utils/validateAddress';
import { sortArrayByTimestampAndGroupName } from '../../utils/time';
import { WalletsAppWrapper } from './WalletsAppWrapper';
import { useTranslation } from 'react-i18next';
import { GroupList } from './GroupList';
import { ReticulumGroupAboutModal } from './ReticulumGroupAbout';
import { FirstTimeQChatEmptyState } from './FirstTimeQChatEmptyState';
import { ReturningUserActivityDashboard } from './ReturningUserActivityDashboard';
import { ReturningUserCaughtUpState } from './ReturningUserCaughtUpState';
import { startReticulumGroupScoreScheduler } from './reticulumGroupScore';
import { reticulumVisibleSearchTextFromPayload } from './reticulumSearchText';
import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { useGroupCallContext } from '../../contexts/GroupCallContext';
import { useCallSwitchGuard } from '../../contexts/CallSwitchGuardContext';
import { traceGcallAudioSurface } from '../../lib/group-call/gcallAudioSurfaceTrace';
import {
  TIME_MINUTES_10_IN_MILLISECONDS,
  TIME_MINUTES_2_IN_MILLISECONDS,
  TIME_DAYS_1_IN_MILLISECONDS,
} from '../../constants/constants';
import { useWebsocketStatus } from './useWebsocketStatus';
import { DirectsSidebar } from './DirectsSidebar';
import { GlobalChatWidget } from './GlobalChatWidget';
import { openQChatTab, QCHAT_INTERNAL_TAB_ID } from '../../utils/openQChatTab';
import { HubOnboardingTour } from '../Onboarding/HubOnboardingTour';
import { OnboardingQChatPreview } from '../Onboarding/OnboardingQChatPreview';
import { QORTAL_PROJECT_GROUP_ID } from './findGroupsPinned';
import {
  orderReticulumGroups,
  readReticulumGroupOrder,
} from './reticulumGroupRail';
import {
  beginReticulumSummaryRefresh,
  getReticulumMentionBadgeCount,
  scheduleReticulumSummaryRefresh,
} from './reticulumSummaryRefresh';
import {
  AdminRowBox,
  CenterBox,
  ChatContentBox,
  EncryptionKeyMessageDiv,
  FloatingButtonContainerBox,
  InnerChatBox,
  MainContentBox,
  NewChatOverlay,
  NoSelectionTypography,
  NotPartAdminListBox,
  NotPartGroupDiv,
  RootBox,
  SelectedDirectOverlay,
  SelectedGroupWrapper,
} from './Group.styles';

const RETICULUM_ACTIVE_BLUE = '#2563eb';

// Keeps the Reticulum chat tree out of unrelated Group-shell re-renders. The
// legacy ChatGroup instance below deliberately retains its existing behavior.
const ReticulumChatGroup = memo(ChatGroup);

const LazyAddGroup = lazy(() =>
  import('./AddGroup').then((m) => ({ default: m.AddGroup }))
);
const LazyFindGroupModal = lazy(() =>
  import('./FindGroupModal').then((m) => ({ default: m.FindGroupModal }))
);
const LazyFindGroupOverviewModal = lazy(() =>
  import('./FindGroupModal').then((m) => ({
    default: m.FindGroupOverviewModal,
  }))
);
const LazyManageMembers = lazy(() =>
  import('./ManageMembers').then((m) => ({ default: m.ManageMembers }))
);
const LazyBlockedUsersModal = lazy(() =>
  import('./BlockedUsersModal').then((m) => ({ default: m.BlockedUsersModal }))
);
const loadQortalLandModule = () => import('../QortalLand/QortalLand');
const LazyQortalLand = lazy(() =>
  loadQortalLandModule().then((m) => ({ default: m.QortalLand }))
);

// Re-export for backward compatibility with existing imports from Group.tsx
export {
  getAllPublishesFromAdmins,
  getGroupAdmins,
  getGroupAdminsAddress,
  getNameInfo,
  getNames,
  getNamesForAdmins,
  getGroupMembers,
  getPublishesFromAdmins,
} from './groupApi';
export { timeDifferenceForNotificationChats } from './groupConstants';
export {
  addDataPublishesFunc,
  decryptResource,
  getDataPublishesFunc,
} from './groupDataPublishes';
export {
  requestQueueAdminMemberNames,
  requestQueueMemberNames,
} from './groupQueues';
export type { GroupProps } from './groupTypes';
export { validateSecretKey } from './groupValidation';

type ReticulumBackgroundEvent = {
  authorAddress?: string;
  authorPrimaryName?: string;
  channelId?: string;
  directMentionAuthorized?: boolean;
  encryptedPayload?: string;
  eventId?: string;
  eventType?: string;
  groupId?: number;
  mentionTargets?: Array<Record<string, unknown>>;
  privilegedMentionAuthorized?: boolean;
  targetEventId?: string;
  timestamp?: number;
  readByOwner?: boolean;
};

const RETICULUM_RENDERER_ONLINE_SINCE_MS = Date.now();

type ReticulumNotificationSummary = {
  groupId?: number;
  channelId?: string;
  lastEvent?: ReticulumBackgroundEvent | null;
  unreadCount?: number;
  replyCount?: number;
  mentionCount?: number;
  hasUnreadMention?: boolean;
  updatedAt?: number;
  channels?: ReticulumNotificationSummary[];
};

const RETICULUM_BACKGROUND_PROCESSED_EVENT_TTL_MS = 2 * 60 * 60_000;
const RETICULUM_BACKGROUND_PROCESSED_EVENT_MAX = 10_000;
const RETICULUM_DIRECT_NAME_RETRY_DELAY_MS = 5 * 60_000;

const getGroupIdFromGroupLike = (group: unknown): number | null => {
  if (!group || typeof group !== 'object') return null;
  const candidate =
    (group as { groupId?: unknown }).groupId ??
    (group as { groupid?: unknown }).groupid ??
    (group as { group_id?: unknown }).group_id ??
    (group as { id?: unknown }).id;
  const groupId = Number(candidate);
  return Number.isInteger(groupId) && groupId > 0 ? groupId : null;
};

const getGroupIdsFromGroupLikeList = (groups: unknown): number[] => {
  if (!Array.isArray(groups)) return [];
  return [
    ...new Set(
      groups
        .map(getGroupIdFromGroupLike)
        .filter((groupId): groupId is number => groupId != null)
    ),
  ];
};

const getReticulumGroupMembershipsFromGroupLikeList = (
  groups: unknown,
  groupsProperties: Record<string, unknown>,
  localAddress: string | undefined,
  adminGroupIds: ReadonlySet<number>
): Array<{
  groupId: number;
  isPrivate: boolean;
  isAdmin: boolean;
  adminStatusAuthoritative: true;
  joinedAt?: number;
  localAddress?: string;
}> => {
  if (!Array.isArray(groups)) return [];
  const byGroupId = new Map<
    number,
    { isPrivate: boolean; joinedAt?: number }
  >();
  const normalizedLocalAddress =
    typeof localAddress === 'string' ? localAddress.trim() : '';
  for (const group of groups) {
    const groupId = getGroupIdFromGroupLike(group);
    if (groupId == null) continue;
    const groupObject =
      group && typeof group === 'object'
        ? (group as { isOpen?: unknown; isPrivate?: unknown })
        : {};
    const groupProperty = groupsProperties[String(groupId)] as
      | { isOpen?: unknown; isPrivate?: unknown }
      | undefined;
    const isPrivate =
      groupObject.isPrivate === true ||
      groupProperty?.isPrivate === true ||
      groupObject.isOpen === false ||
      groupProperty?.isOpen === false;
    const joinedAt = Number(
      (group as { reticulumJoinedAt?: unknown; joinedAt?: unknown })
        ?.reticulumJoinedAt ?? (group as { joinedAt?: unknown })?.joinedAt
    );
    const previous = byGroupId.get(groupId);
    byGroupId.set(groupId, {
      isPrivate: previous?.isPrivate === true || isPrivate,
      joinedAt:
        previous?.joinedAt ||
        (Number.isFinite(joinedAt) && joinedAt > 0 ? joinedAt : undefined),
    });
  }
  return [...byGroupId.entries()].map(([groupId, { isPrivate, joinedAt }]) => ({
    groupId,
    isPrivate,
    isAdmin: adminGroupIds.has(groupId),
    adminStatusAuthoritative: true,
    ...(joinedAt ? { joinedAt } : {}),
    ...(normalizedLocalAddress ? { localAddress: normalizedLocalAddress } : {}),
  }));
};

const parseReticulumPublicPayload = (value: unknown): unknown => {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const reticulumChannelDisplayName = (channelId?: string): string =>
  `#${String(channelId || 'general').replace(/^#/, '')}`;

const reticulumMentionedAddressesFromPayload = (payload: unknown): string[] => {
  if (!payload || typeof payload !== 'object') return [];
  const value = (payload as { mentionedAddresses?: unknown })
    .mentionedAddresses;
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((address) => (typeof address === 'string' ? address.trim() : ''))
        .filter(Boolean)
    ),
  ];
};

const resolveReticulumMentionAddressesFromPayload = (
  payload: unknown,
  nameToAddress: Map<string, string>
): string[] => {
  const mentioned = new Set<string>();
  const inspectHtml = (html: string) => {
    if (
      typeof DOMParser === 'undefined' ||
      !html.includes('data-type=') ||
      !html.includes('mention')
    )
      return;
    const document = new DOMParser().parseFromString(html, 'text/html');
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
      const address = nameToAddress.get(label.toLowerCase());
      if (address) mentioned.add(address);
    }
  };
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      inspectHtml(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>
    )) {
      if (key === 'mentionedAddresses') continue;
      if (
        key === 'data' ||
        key === 'message' ||
        key === 'messageText' ||
        key === 'text' ||
        key === 'htmlContent'
      ) {
        visit(child);
      }
    }
  };
  visit(payload);
  return [...mentioned];
};

const authorizedReticulumBroadcastApplies = (
  event: ReticulumBackgroundEvent
): boolean => {
  if (event.privilegedMentionAuthorized !== true) return false;
  const groupId = Number(event.groupId);
  const eventChannelId = String(event.channelId || 'general');
  for (const target of event.mentionTargets || []) {
    if (Number(target?.groupId) !== groupId) continue;
    if (target?.type === 'everyone') return true;
    if (
      target?.type === 'here' &&
      String(target?.channelId || eventChannelId) === eventChannelId &&
      Number(event.timestamp || 0) >= RETICULUM_RENDERER_ONLINE_SINCE_MS
    ) {
      return true;
    }
  }
  return false;
};

/** Subscribes to memberGroupsAtom and runs effects (Group does not subscribe). */
function MemberGroupsEffects({
  getGroupsWhereIAmAMember,
  getGroupsProperties,
  myAddress,
  groupsPropertiesRef,
  hasInitializedWebsocketRef,
}: {
  getGroupsWhereIAmAMember: (groups: any[]) => Promise<boolean>;
  getGroupsProperties: (address: string) => void;
  myAddress: string;
  groupsPropertiesRef: React.MutableRefObject<Record<string, unknown>>;
  hasInitializedWebsocketRef: React.MutableRefObject<boolean>;
}) {
  const memberGroups = useAtomValue(memberGroupsAtom);
  useEffect(() => {
    if (!myAddress) return;
    let cancelled = false;
    let refreshTimer: number | null = null;
    const refresh = async () => {
      const succeeded = await getGroupsWhereIAmAMember(memberGroups || []);
      if (cancelled) return;
      refreshTimer = window.setTimeout(
        refresh,
        succeeded ? TIME_MINUTES_10_IN_MILLISECONDS / 2 : 10_000
      );
    };
    void refresh();
    return () => {
      cancelled = true;
      if (refreshTimer != null) window.clearTimeout(refreshTimer);
    };
  }, [memberGroups, myAddress, getGroupsWhereIAmAMember]);
  useEffect(() => {
    if (!myAddress) return;
    if (
      !areKeysEqual(
        getGroupIdsFromGroupLikeList(memberGroups),
        Object.keys(groupsPropertiesRef.current || {})
      )
    ) {
      getGroupsProperties(myAddress);
    }
  }, [memberGroups, myAddress, getGroupsProperties, groupsPropertiesRef]);
  useEffect(() => {
    if (
      !myAddress ||
      hasInitializedWebsocketRef.current ||
      !memberGroups?.length
    )
      return;
    window.sendMessage('setupGroupWebsocket', {}).catch((error: Error) => {
      console.error(
        'Failed to setup group websocket:',
        error?.message || 'An error occurred'
      );
    });
    hasInitializedWebsocketRef.current = true;
  }, [myAddress, memberGroups, hasInitializedWebsocketRef]);
  return null;
}

function PersistentSectionLayer({
  active,
  children,
  topOffset = 0,
}: {
  active: boolean;
  children: ReactNode;
  topOffset?: number;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (active) return;
    const focusedElement = document.activeElement;
    if (
      focusedElement instanceof HTMLElement &&
      layerRef.current?.contains(focusedElement)
    ) {
      focusedElement.blur();
    }
  }, [active]);

  return (
    <Box
      aria-hidden={!active}
      ref={layerRef}
      sx={{
        bottom: 0,
        display: 'flex',
        left: 0,
        minHeight: 0,
        minWidth: 0,
        opacity: active ? 1 : 0,
        overflow: 'hidden',
        pointerEvents: active ? 'auto' : 'none',
        position: 'absolute',
        right: 0,
        top: topOffset,
        width: '100%',
        zIndex: active ? 1 : 0,
      }}
    >
      {children}
    </Box>
  );
}

function ReticulumGroupSectionHeader({
  activeSection,
  calendarOpen,
  canManageReticulumGroup,
  groupCallDisabled,
  groupCallInCall,
  groupCallJoining,
  groupCallTooltip,
  membersPanelOpen,
  membersNotificationCount,
  onCalendarClick,
  onGroupCallClick,
  onMembersClick,
  onModeSwitchClick,
  onThreadsClick,
  sectionLabel,
}: {
  activeSection: string;
  calendarOpen?: boolean;
  canManageReticulumGroup: boolean;
  groupCallDisabled?: boolean;
  groupCallInCall?: boolean;
  groupCallJoining?: boolean;
  groupCallTooltip?: string;
  membersPanelOpen?: boolean;
  membersNotificationCount?: number;
  onCalendarClick?: () => void;
  onGroupCallClick?: () => void;
  onMembersClick?: () => void;
  onModeSwitchClick?: () => void;
  onThreadsClick?: () => void;
  sectionLabel: string;
}) {
  const theme = useTheme();
  const legacyThreadsEnabled = useAtomValue(reticulumLegacyThreadsEnabledAtom);
  const [isAdminMenuOpen, setIsAdminMenuOpen] = useState(false);
  const [isQManagerOpen, setIsQManagerOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  useEffect(() => {
    const syncAdminMenu = (event: any) => {
      setIsAdminMenuOpen(Boolean(event?.detail?.open ?? event?.open));
    };
    const syncQManager = (event: any) => {
      setIsQManagerOpen(Boolean(event?.detail?.open ?? event?.open));
    };
    const syncSearch = (event: any) => {
      setIsSearchOpen(Boolean(event?.detail?.open ?? event?.open));
    };
    subscribeToEvent('reticulumAdminKeysOpenState', syncAdminMenu);
    subscribeToEvent('reticulumQManagerOpenState', syncQManager);
    subscribeToEvent('reticulumChatSearchOpenState', syncSearch);
    return () => {
      unsubscribeFromEvent('reticulumAdminKeysOpenState', syncAdminMenu);
      unsubscribeFromEvent('reticulumQManagerOpenState', syncQManager);
      unsubscribeFromEvent('reticulumChatSearchOpenState', syncSearch);
    };
  }, []);
  const actionSx = (active?: boolean, showLabel?: boolean) => ({
    alignItems: 'center',
    borderRadius: '8px',
    color: active ? theme.palette.common.white : theme.palette.text.secondary,
    display: 'inline-flex',
    flexShrink: 0,
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: 600,
    gap: showLabel ? 0.6 : 0,
    height: 36,
    justifyContent: 'center',
    lineHeight: 1,
    minWidth: showLabel ? 0 : 36,
    overflow: 'hidden',
    px: showLabel ? 1 : 0,
    textAlign: 'center',
    transition: 'background-color 140ms ease, color 140ms ease',
    width: showLabel ? 'auto' : 36,
    backgroundColor: active ? RETICULUM_ACTIVE_BLUE : 'transparent',
    '&:hover': {
      backgroundColor: active
        ? RETICULUM_ACTIVE_BLUE
        : theme.palette.action.hover,
      color: active ? theme.palette.common.white : theme.palette.text.primary,
    },
  });
  const renderAction = ({
    active,
    disabled,
    icon,
    label,
    onClick,
    showLabel = false,
    tooltip,
  }: {
    active?: boolean;
    disabled?: boolean;
    icon: ReactNode;
    label: string;
    onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
    showLabel?: boolean;
    tooltip?: string;
  }) => {
    if (typeof onClick !== 'function') return null;
    return (
      <Tooltip key={label} title={tooltip || label}>
        <span style={{ display: 'inline-flex' }}>
          <ButtonBase
            disabled={disabled}
            onClick={onClick}
            sx={actionSx(active, showLabel)}
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
      </Tooltip>
    );
  };

  return (
    <Box
      sx={{
        alignItems: 'center',
        borderBottom: `1px solid ${theme.palette.divider}`,
        display: 'flex',
        flexShrink: 0,
        gap: 0.75,
        minHeight: 50,
        overflow: 'hidden',
        px: 1.5,
      }}
    >
      <Typography
        sx={{
          flex: 1,
          fontSize: 17,
          fontWeight: 700,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {sectionLabel}
      </Typography>
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
        {typeof onModeSwitchClick === 'function' && (
          <>
            <ReticulumModePill target="chat" onClick={onModeSwitchClick} />
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
          </>
        )}
        {renderAction({
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
        {renderAction({
          active: calendarOpen,
          label: 'Group Calendar',
          icon: <CalendarMonthRoundedIcon sx={{ fontSize: 19 }} />,
          onClick: onCalendarClick,
        })}
        {legacyThreadsEnabled &&
          renderAction({
            active: activeSection === 'forum',
            label: 'Threads',
            icon: <ForumRoundedIcon sx={{ fontSize: 19 }} />,
            onClick: onThreadsClick,
          })}
        {legacyThreadsEnabled &&
          canManageReticulumGroup &&
          renderAction({
            active: isAdminMenuOpen,
            label: 'Admins',
            icon: <SecurityRoundedIcon sx={{ fontSize: 19 }} />,
            onClick: (event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              executeEvent('toggleReticulumAdminKeys', {
                anchorRect: {
                  bottom: rect.bottom,
                  height: rect.height,
                  left: rect.left,
                  right: rect.right,
                  top: rect.top,
                  width: rect.width,
                },
                toggle: true,
              });
            },
          })}
        {renderAction({
          active: isQManagerOpen,
          label: 'Q-Manager',
          icon: <FolderRoundedIcon sx={{ fontSize: 19 }} />,
          onClick: (event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            executeEvent('openReticulumQManager', {
              anchorRect: {
                bottom: rect.bottom,
                height: rect.height,
                left: rect.left,
                right: rect.right,
                top: rect.top,
                width: rect.width,
              },
              toggle: true,
            });
          },
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
                membersNotificationCount && membersNotificationCount > 0
                  ? `Members, ${membersNotificationCount} pending join ${
                      membersNotificationCount === 1 ? 'request' : 'requests'
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
                color: membersPanelOpen ? 'common.white' : 'text.secondary',
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
            {!!membersNotificationCount && membersNotificationCount > 0 && (
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
        {renderAction({
          active: activeSection !== 'land' && isSearchOpen,
          disabled: activeSection === 'land',
          label: 'Search Chat',
          icon: <SearchRoundedIcon sx={{ fontSize: 18 }} />,
          onClick: () =>
            executeEvent('openReticulumChatSearch', { toggle: true }),
        })}
      </Box>
    </Box>
  );
}

export const Group = ({
  myAddress,
  setDesktopViewMode,
  desktopViewMode,
  onOpenSettings,
}: GroupProps) => {
  const [desktopSideView, setDesktopSideView] = useState('groups');
  const [chatWidgetClosed, setChatWidgetClosed] = useAtom(chatWidgetClosedAtom);
  const [lastQappViewMode, setLastQappViewMode] = useState('apps');
  const [secretKey, setSecretKey] = useState(null);
  const [secretKeyPublishDate, setSecretKeyPublishDate] = useState(null);
  const lastFetchedSecretKey = useRef(null);
  const [secretKeyDetails, setSecretKeyDetails] = useState(null);
  const [newEncryptionNotification, setNewEncryptionNotification] =
    useState(null);
  const [memberCountFromSecretKeyData, setMemberCountFromSecretKeyData] =
    useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [onboardingQChatPreviewOpen, setOnboardingQChatPreviewOpen] =
    useState(false);
  const [selectedDirect, setSelectedDirect] = useState(null);
  const hasInitializedWebsocket = useRef(false);
  const memberGroupsRef = useRef<any[]>([]);
  const memberGroupsLoadedAddressRef = useRef('');
  const [directs, setDirects] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [adminsWithNames, setAdminsWithNames] = useState([]);
  const [members, setMembers] = useState([]);
  const [groupOwner, setGroupOwner] = useState(null);
  const [triedToFetchSecretKey, setTriedToFetchSecretKey] = useState(false);
  const [openAddGroup, setOpenAddGroup] = useState(false);
  const [openFindGroup, setOpenFindGroup] = useState(false);
  const [openAddGroupTab, setOpenAddGroupTab] = useState<0 | 1 | 2>(0);
  const [openManageMembers, setOpenManageMembers] = useState(false);
  const setMemberGroups = useSetAtom(memberGroupsAtom);
  const [timestampEnterData, setTimestampEnterData] = useAtom(
    timestampEnterDataAtom
  );
  const groupsPropertiesRef = useRef({});
  const [chatMode, setChatMode] = useState('groups');
  const [newChat, setNewChat] = useState(false);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const [isLoadingNotifyAdmin, setIsLoadingNotifyAdmin] = useState(false);
  const [isLoadingGroups, setIsLoadingGroups] = useState(true);
  const [isLoadingGroup, setIsLoadingGroup] = useState(false);
  const [isLoadingThreadKey, setIsLoadingThreadKey] = useState(false);
  const [firstSecretKeyInCreation, setFirstSecretKeyInCreation] =
    useState(false);
  const [groupSection, setGroupSection] = useState('home');
  const [groupAnnouncements, setGroupAnnouncements] = useAtom(
    groupAnnouncementsAtom
  );
  const theme = useTheme();

  const [defaultThread, setDefaultThread] = useState(null);
  const [, setIsOpenDrawer] = useState(false);
  const [isOpenBlockedModal, setIsOpenBlockedUserModal] = useAtom(
    isOpenBlockedModalAtom
  );
  const [hideCommonKeyPopup, setHideCommonKeyPopup] = useState(false);
  const [isLoadingGroupMessage, setIsLoadingGroupMessage] = useState('');
  const setMutedGroups = useSetAtom(mutedGroupsAtom);
  const mutedGroups = useAtomValue(mutedGroupsAtom);
  const memberGroupsForReticulum = useAtomValue(memberGroupsAtom);
  const memberGroupsWithReticulumActivity = useAtomValue(
    memberGroupsWithReticulumChatAtom
  );
  const [memberGroupsLoadedAddress, setMemberGroupsLoadedAddress] = useAtom(
    memberGroupsLoadedAddressAtom
  );

  useEffect(() => {
    memberGroupsLoadedAddressRef.current = memberGroupsLoadedAddress;
  }, [memberGroupsLoadedAddress]);
  const [notificationReticulumChannelId, setNotificationReticulumChannelId] =
    useState('');
  const [notificationReticulumMessageId, setNotificationReticulumMessageId] =
    useState('');
  const [reticulumCalendarOpenRequest, setReticulumCalendarOpenRequest] =
    useState(0);
  const [reticulumCalendarOpen, setReticulumCalendarOpen] = useState(false);
  const [reticulumCalendarTarget, setReticulumCalendarTarget] = useState<{
    groupId: number;
    eventId: string;
    occurrenceStart: number;
    timezone: string;
  } | null>(null);
  const [activeReticulumChannelId, setActiveReticulumChannelId] =
    useState('general');
  const [reticulumReadEntryToken, setReticulumReadEntryToken] = useState(0);
  const [mountedLandGroupId, setMountedLandGroupId] = useState<string | null>(
    null
  );
  const [reticulumChatMembersPanelOpen, setReticulumChatMembersPanelOpen] =
    useState(true);
  const [reticulumLandMembersPanelOpen, setReticulumLandMembersPanelOpen] =
    useState(false);
  const [reticulumSearchOverlayOpen, setReticulumSearchOverlayOpen] =
    useState(false);
  const [reticulumJoinRequestCount, setReticulumJoinRequestCount] = useState(0);
  const [mobileViewMode, setMobileViewMode] = useState('home');
  const [, setMobileViewModeKeepOpen] = useState('');
  const [isQChatTabActive, setIsQChatTabActive] = useState(false);
  const timestampEnterDataRef = useRef({});
  const myAddressRef = useRef('');
  const selectedGroupRef = useRef(null);
  const selectedDirectRef = useRef(null);
  const groupSectionRef = useRef(null);
  const isLoadingOpenSectionFromNotification = useRef(false);
  const settimeoutForRefetchSecretKey = useRef(null);
  const threadKeyLoadRef = useRef<{ groupId: string } | null>(null);
  const secretKeyRef = useRef(null);
  const { clearStatesMessageQueueProvider } = useMessageQueue();
  const initiatedGetMembers = useRef(false);
  const [groupChatTimestamps, setGroupChatTimestamps] = useAtom(
    groupChatTimestampsAtom
  );
  const setReticulumChatSummaries = useSetAtom(reticulumChatSummariesAtom);
  const [reticulumChatEnabled, setReticulumChatEnabled] = useAtom(
    reticulumChatEnabledAtom
  );
  const [reticulumEnabled, setReticulumEnabled] = useAtom(reticulumEnabledAtom);
  const [reticulumDirectSummaries, setReticulumDirectSummaries] = useAtom(
    reticulumDirectSummariesAtom
  );
  const [reticulumDirectNamesByAddress, setReticulumDirectNamesByAddress] =
    useState<Record<string, string>>({});
  const reticulumDirectNamesByAddressRef = useRef<Record<string, string>>({});
  const reticulumDirectNameResolutionsRef = useRef(new Set<string>());
  const reticulumDirectNameRetryAfterRef = useRef(new Map<string, number>());
  const reticulumSubscribedGroupIdsRef = useRef<Set<number>>(new Set());
  const reticulumBackgroundProcessedEventIdsRef = useRef<Map<string, number>>(
    new Map()
  );
  const reticulumGroupMentionNameCacheRef = useRef<
    Map<number, Map<string, string>>
  >(new Map());
  const reticulumSummariesRefreshTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const reticulumSummariesRefreshWindowStartedAtRef = useRef<number | null>(
    null
  );
  const reticulumDirectSummariesRefreshTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const reticulumSummariesRefreshSequenceRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let applySequence = 0;
    let settingsChangeReceived = false;
    const applySettings = async (settings?: {
      reticulumEnabled?: boolean;
      reticulumChatEnabled?: boolean;
    }) => {
      const sequence = ++applySequence;
      const globallyEnabled = settings?.reticulumEnabled !== false;
      if (cancelled) return;
      setReticulumEnabled(globallyEnabled);
      if (!globallyEnabled) {
        reticulumSummariesRefreshSequenceRef.current += 1;
        setReticulumChatEnabled(false);
        setReticulumChatSummaries({});
        setReticulumDirectSummaries({});
        void window.reticulumChat?.updateMentionBadge?.(0);
        return;
      }
      const chatEnabled =
        settings?.reticulumChatEnabled !== false &&
        (await window.reticulumChat?.isEnabled?.()) === true;
      if (!cancelled && sequence === applySequence) {
        setReticulumChatEnabled(chatEnabled);
      }
    };

    const unsubscribe = window.electronAPI?.onAppSettingsChanged?.(
      (settings) => {
        settingsChangeReceived = true;
        void applySettings(settings);
      }
    );
    void window.electronAPI?.getAppSettings?.().then((settings) => {
      if (!settingsChangeReceived) void applySettings(settings);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [
    setReticulumChatEnabled,
    setReticulumChatSummaries,
    setReticulumDirectSummaries,
    setReticulumEnabled,
  ]);
  const activeReticulumChannelIdRef = useRef('general');
  const bumpReticulumReadEntryToken = useCallback(() => {
    setReticulumReadEntryToken((token) => token + 1);
  }, []);
  const pruneReticulumBackgroundProcessedEvents = useCallback(() => {
    const now = Date.now();
    const map = reticulumBackgroundProcessedEventIdsRef.current;
    const cutoff = now - RETICULUM_BACKGROUND_PROCESSED_EVENT_TTL_MS;
    for (const [eventId, seenAt] of map.entries()) {
      if (seenAt < cutoff) map.delete(eventId);
    }
    if (map.size <= RETICULUM_BACKGROUND_PROCESSED_EVENT_MAX) return;
    const excess = map.size - RETICULUM_BACKGROUND_PROCESSED_EVENT_MAX;
    const oldest = [...map.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, excess);
    for (const [eventId] of oldest) map.delete(eventId);
  }, []);
  const hasProcessedReticulumBackgroundEvent = useCallback(
    (eventId: string) => {
      pruneReticulumBackgroundProcessedEvents();
      return reticulumBackgroundProcessedEventIdsRef.current.has(eventId);
    },
    [pruneReticulumBackgroundProcessedEvents]
  );
  const noteProcessedReticulumBackgroundEvent = useCallback(
    (eventId: string) => {
      if (!eventId) return;
      reticulumBackgroundProcessedEventIdsRef.current.set(eventId, Date.now());
      pruneReticulumBackgroundProcessedEvents();
    },
    [pruneReticulumBackgroundProcessedEvents]
  );
  const setIsEnabledDevMode = useSetAtom(enabledDevModeAtom);
  const setIsDisabledEditorEnter = useSetAtom(isDisabledEditorEnterAtom);

  useEffect(() => {
    if (!openAddGroup) {
      setOpenAddGroupTab(0);
    }
  }, [openAddGroup]);

  useEffect(() => {
    const isDevModeFromStorage = localStorage.getItem('isEnabledDevMode');
    if (isDevModeFromStorage) {
      setIsEnabledDevMode(JSON.parse(isDevModeFromStorage));
    }
    try {
      const val = localStorage.getItem('settings-disable-editor-enter');
      if (val) {
        const parsedVal = JSON.parse(val);
        if (parsedVal === false || parsedVal === true) {
          setIsDisabledEditorEnter(parsedVal);
        }
      }
    } catch (error) {
      console.log(error);
    }
  }, []);
  const [isRunningPublicNode] = useAtom(isRunningPublicNodeAtom);
  const [avatarPreviewData, setAvatarPreviewData] = useState<{
    alt: string;
    src: string;
  } | null>(null);
  const [directAvatarLoaded, setDirectAvatarLoaded] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    if (desktopViewMode === 'apps' || desktopViewMode === 'dev') {
      setLastQappViewMode(desktopViewMode);
    }
  }, [desktopViewMode]);

  const [appsMode, setAppsMode] = useState('home');
  const [appsModeDev, setAppsModeDev] = useState('home');
  const [isOpenSideViewDirects, setIsOpenSideViewDirects] = useState(false);
  const [isOpenSideViewGroups, setIsOpenSideViewGroups] = useState(false);
  const [isForceShowCreationKeyPopup, setIsForceShowCreationKeyPopup] =
    useState(false);
  const groupsOwnerNamesRef = useRef({});
  const { t } = useTranslation(['auth', 'core', 'group', 'question']);
  useWebsocketStatus();
  const [groupsProperties, setGroupsProperties] = useAtom(groupsPropertiesAtom);
  const setGroupsOwnerNames = useSetAtom(groupsOwnerNamesAtom);
  const userInfo = useAtomValue(userInfoAtom);
  const dmFriendsByAddress = useAtomValue(dmFriendsByAddressAtom);

  const {
    roomState: gcallRoomState,
    joinGroupCall,
    leaveGroupCall,
    roomId: gcallActiveRoomId,
  } = useGroupCallContext();
  const { confirmCallSwitch } = useCallSwitchGuard();
  const setQcallMinimized = useSetAtom(qortalGroupVoiceCallMinimizedAtom);
  const setQcallPrimaryNames = useSetAtom(qortalGroupCallPrimaryNamesAtom);

  const gcallGroupNumericId = useMemo(() => {
    const id = selectedGroup?.groupId;
    if (id === undefined || id === null || id === '0') return null;
    const n = Number(id);
    return Number.isFinite(n) ? n : null;
  }, [selectedGroup?.groupId]);

  const gcallRoomIdForGroup =
    gcallGroupNumericId !== null ? `gcall-qortal-${gcallGroupNumericId}` : '';

  const inThisGroupGcall =
    gcallRoomState !== 'idle' && gcallActiveRoomId === gcallRoomIdForGroup;
  const inOtherGcall =
    gcallRoomState !== 'idle' && gcallActiveRoomId !== gcallRoomIdForGroup;

  const handleGroupCallHeaderClick = useCallback(async () => {
    traceGcallAudioSurface('ui.Group: header call icon clicked', {
      gcallGroupNumericId,
      gcallRoomIdForGroup,
      hasAudioSurface: Boolean(
        typeof window !== 'undefined' &&
        (window as Window & { audioSurface?: unknown }).audioSurface
      ),
      desktopViewMode,
    });
    if (gcallGroupNumericId === null || !gcallRoomIdForGroup) {
      traceGcallAudioSurface(
        'ui.Group: early exit (no room id for selected group)',
        {}
      );
      return;
    }
    if (inThisGroupGcall) {
      traceGcallAudioSurface('ui.Group: leaving call', { gcallRoomIdForGroup });
      await leaveGroupCall();
      return;
    }
    const confirmed = await confirmCallSwitch({
      type: 'group',
      roomId: gcallRoomIdForGroup,
    });
    if (!confirmed) return;
    // Calls deliberately start in the compact nav widget. The stage is opened
    // only when the user explicitly expands it there.
    setQcallMinimized(true);
    let memberGateAddresses: string[] = [];
    const primaryNamesByAddress: Record<string, string> = {};
    try {
      const data = await getGroupMembers(gcallGroupNumericId);
      const addressSet = new Set<string>();
      if (Array.isArray(data?.members)) {
        for (const member of data.members) {
          const address =
            typeof member?.member === 'string' ? member.member.trim() : '';
          if (address) {
            addressSet.add(address);
            const primaryName =
              typeof member?.primaryName === 'string'
                ? member.primaryName.trim()
                : '';
            if (primaryName) {
              primaryNamesByAddress[address] = primaryName;
            }
          }
        }
      }
      memberGateAddresses = [...addressSet];
      setQcallPrimaryNames(primaryNamesByAddress);
      traceGcallAudioSurface('ui.Group: synced group call member gate', {
        groupId: gcallGroupNumericId,
        memberCount: memberGateAddresses.length,
        primaryNameCount: Object.keys(primaryNamesByAddress).length,
        localIncluded: Boolean(
          userInfo?.address && addressSet.has(userInfo.address)
        ),
      });
    } catch (error) {
      traceGcallAudioSurface('ui.Group: failed group call member gate fetch', {
        groupId: gcallGroupNumericId,
        message: error instanceof Error ? error.message : 'unknown',
      });
      setInfoSnack({
        type: 'error',
        message: t('core:group_call_members_fetch_failed', {
          postProcess: 'capitalizeFirstChar',
        }),
      });
      setOpenSnack(true);
      setQcallPrimaryNames({});
      return;
    }
    await joinGroupCall(gcallRoomIdForGroup, `group:${gcallGroupNumericId}`, {
      memberGateGroupId: gcallGroupNumericId,
      memberGateGroupName: selectedGroup?.groupName,
      memberGateAddresses,
    });
  }, [
    desktopViewMode,
    gcallGroupNumericId,
    gcallRoomIdForGroup,
    inThisGroupGcall,
    confirmCallSwitch,
    joinGroupCall,
    leaveGroupCall,
    selectedGroup?.groupName,
    setQcallMinimized,
    setQcallPrimaryNames,
    t,
    userInfo?.address,
  ]);

  const setUserInfoForLevels = useSetAtom(addressInfoControllerAtom);
  const [myGroupsWhereIAmAdmin, setMyGroupsWhereIAmAdmin] = useAtom(
    myGroupsWhereIAmAdminAtom
  );
  const [
    reticulumAdminGroupsLoadedAddress,
    setReticulumAdminGroupsLoadedAddress,
  ] = useState('');
  const [reticulumMembershipsAppliedKey, setReticulumMembershipsAppliedKey] =
    useState('');
  const [
    reticulumSummariesLoadedMembershipKey,
    setReticulumSummariesLoadedMembershipKey,
  ] = useState('');
  const [reticulumTransportReadyRevision, setReticulumTransportReadyRevision] =
    useState(0);
  const [reticulumChatReadinessState, setReticulumChatReadinessState] =
    useState<'idle' | 'starting' | 'ready' | 'failed'>('idle');
  const reticulumAdminGroupIds = useMemo(
    () => new Set(getGroupIdsFromGroupLikeList(myGroupsWhereIAmAdmin)),
    [myGroupsWhereIAmAdmin]
  );
  const isPrivate = useMemo(() => {
    if (selectedGroup?.groupId === '0') return false;
    if (!selectedGroup?.groupId || !groupsProperties[selectedGroup?.groupId])
      return null;
    if (groupsProperties[selectedGroup?.groupId]?.isOpen === true) return false;
    if (groupsProperties[selectedGroup?.groupId]?.isOpen === false) return true;
    return null;
  }, [selectedGroup]);

  const setSelectedGroupId = useSetAtom(selectedGroupIdAtom);

  const toggleSideViewDirects = useCallback(() => {
    if (isOpenSideViewGroups) {
      setIsOpenSideViewGroups(false);
    }
    setIsOpenSideViewDirects((prev) => !prev);
  }, [isOpenSideViewGroups]);

  const toggleSideViewGroups = useCallback(() => {
    if (isOpenSideViewDirects) {
      setIsOpenSideViewDirects(false);
    }
    setIsOpenSideViewGroups((prev) => !prev);
  }, [isOpenSideViewDirects]);

  useEffect(() => {
    timestampEnterDataRef.current = timestampEnterData;
  }, [timestampEnterData]);

  useEffect(() => {
    groupSectionRef.current = groupSection;
  }, [groupSection]);
  useEffect(() => {
    selectedGroupRef.current = selectedGroup;
    setSelectedGroupId(selectedGroup?.groupId);
  }, [selectedGroup]);
  useEffect(() => {
    selectedDirectRef.current = selectedDirect;
  }, [selectedDirect]);
  useEffect(() => {
    activeReticulumChannelIdRef.current = activeReticulumChannelId || 'general';
  }, [activeReticulumChannelId]);

  useEffect(() => {
    setMountedLandGroupId(null);
    setIsLoadingThreadKey(false);
    threadKeyLoadRef.current = null;
    if (settimeoutForRefetchSecretKey.current) {
      clearTimeout(settimeoutForRefetchSecretKey.current);
      settimeoutForRefetchSecretKey.current = null;
    }
  }, [selectedGroup?.groupId]);

  useEffect(() => {
    secretKeyRef.current = secretKey;
  }, [secretKey]);

  useEffect(() => {
    reticulumBackgroundProcessedEventIdsRef.current.clear();
  }, [myAddress]);

  // Track view modes to prevent marking messages as read when not viewing chat
  const desktopViewModeRef = useRef(desktopViewMode);
  const mobileViewModeRef = useRef(mobileViewMode);
  const qChatTabActiveRef = useRef(false);
  const lastNonQappDesktopViewModeRef = useRef(
    desktopViewMode !== 'apps' && desktopViewMode !== 'dev'
      ? desktopViewMode
      : 'home'
  );

  useEffect(() => {
    desktopViewModeRef.current = desktopViewMode;
    if (desktopViewMode !== 'apps' && desktopViewMode !== 'dev') {
      lastNonQappDesktopViewModeRef.current = desktopViewMode;
    }
  }, [desktopViewMode]);

  useEffect(() => {
    mobileViewModeRef.current = mobileViewMode;
  }, [mobileViewMode]);

  useEffect(() => {
    qChatTabActiveRef.current = isQChatTabActive;
  }, [isQChatTabActive]);

  // Track previous view mode to detect when user returns to chat
  const prevDesktopViewModeRef = useRef(desktopViewMode);
  const prevMobileViewModeRef = useRef(mobileViewMode);
  const prevQChatTabActiveRef = useRef(isQChatTabActive);

  // Mark messages as read when user returns to chat view
  useEffect(() => {
    const wasInChatMode =
      prevQChatTabActiveRef.current || prevMobileViewModeRef.current === 'chat';

    const isNowInChatMode = isQChatTabActive || mobileViewMode === 'chat';

    // Only update timestamp when user RETURNS to chat (wasn't in chat, now is in chat)
    if (!wasInChatMode && isNowInChatMode) {
      // Update timestamp for selected group chat
      if (selectedGroupRef.current && groupSectionRef.current === 'chat') {
        window
          .sendMessage('addTimestampEnterChat', {
            timestamp: Date.now(),
            groupId: selectedGroupRef.current.groupId,
          })
          .then(() => {
            // Refresh the timestamp data to update UI
            setTimeout(() => {
              getTimestampEnterChat();
            }, 600);
          })
          .catch((error) => {
            console.error(
              'Failed to add timestamp:',
              error.message || 'An error occurred'
            );
          });
      }

      // Update timestamp for selected direct chat
      if (selectedDirectRef.current) {
        window
          .sendMessage('addTimestampEnterChat', {
            timestamp: Date.now(),
            groupId: selectedDirectRef.current.address,
          })
          .then(() => {
            // Refresh the timestamp data to update UI
            setTimeout(() => {
              getTimestampEnterChat();
            }, 600);
          })
          .catch((error) => {
            console.error(
              'Failed to add timestamp:',
              error.message || 'An error occurred'
            );
          });
      }
    }

    // Update previous view mode refs
    prevDesktopViewModeRef.current = desktopViewMode;
    prevMobileViewModeRef.current = mobileViewMode;
    prevQChatTabActiveRef.current = isQChatTabActive;
  }, [desktopViewMode, isQChatTabActive, mobileViewMode]);

  const getUserSettings = useCallback(async () => {
    try {
      return new Promise((res, rej) => {
        window
          .sendMessage('getUserSettings', {
            key: 'mutedGroups',
          })
          .then((response) => {
            if (!response?.error) {
              setMutedGroups(response || []);
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
      console.error(error);
    }
  }, [setMutedGroups]);

  useEffect(() => {
    getUserSettings();
  }, [getUserSettings]);

  const getTimestampEnterChat = useCallback(async () => {
    try {
      return new Promise((res, rej) => {
        window
          .sendMessage('getTimestampEnterChat')
          .then((response) => {
            if (!response?.error) {
              setTimestampEnterData(response);
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
  }, []);

  const syncReticulumMentionNotifications = useCallback(
    (summaries: Record<string, ReticulumNotificationSummary>) => {
      for (const group of memberGroupsRef.current || []) {
        const groupId = Number(group?.groupId);
        if (!Number.isFinite(groupId)) continue;
        const summary = summaries?.[String(groupId)];
        const channels = Array.isArray(summary?.channels)
          ? summary.channels
          : [];
        const mentionedChannels = channels.filter(
          (channel) => Number(channel?.mentionCount || 0) > 0
        );
        const latestMentionedChannel = mentionedChannels.reduce<
          ReticulumNotificationSummary | undefined
        >((latest, channel) => {
          if (!latest) return channel;
          return Number(channel?.updatedAt || 0) >
            Number(latest?.updatedAt || 0)
            ? channel
            : latest;
        }, undefined);
        const mentionCount = Math.max(0, Number(summary?.mentionCount) || 0);
        executeEvent('q-chat-mention-notification', {
          channelId: String(
            latestMentionedChannel?.channelId || summary?.channelId || 'general'
          ),
          groupId,
          groupName:
            group?.groupName || group?.name || `Group ${String(groupId)}`,
          mentionCount,
          syncUnreadCount: true,
          timestamp: Number(
            latestMentionedChannel?.updatedAt ||
              summary?.updatedAt ||
              Date.now()
          ),
        });
      }
    },
    []
  );

  const refreshReticulumChatSummaries =
    useCallback(async (): Promise<boolean> => {
      const refreshWasSuperseded = beginReticulumSummaryRefresh(
        reticulumSummariesRefreshSequenceRef
      );
      try {
        if (typeof window.reticulumChat?.isEnabled !== 'function') {
          console.error(
            '[ReticulumChat] Activity dashboard cannot initialize: isEnabled bridge is unavailable'
          );
          return false;
        }
        const enabled = await window.reticulumChat?.isEnabled?.();
        if (refreshWasSuperseded()) return true;
        setReticulumChatEnabled(enabled === true);
        if (!enabled) {
          setReticulumChatSummaries({});
          void window.reticulumChat?.updateMentionBadge?.(0);
          return false;
        }
        if (typeof window.reticulumChat?.getSummaries !== 'function') {
          console.error(
            '[ReticulumChat] Activity dashboard cannot initialize: getSummaries bridge is unavailable'
          );
          return false;
        }
        const summaries = await window.reticulumChat?.getSummaries?.(myAddress);
        if (refreshWasSuperseded()) return true;
        if (!Array.isArray(summaries)) {
          console.error(
            '[ReticulumChat] Activity dashboard summary refresh returned an invalid result',
            { resultType: summaries === null ? 'null' : typeof summaries }
          );
          setReticulumChatSummaries({});
          void window.reticulumChat?.updateMentionBadge?.(0);
          return false;
        }
        const next = summaries.reduce(
          (acc, summary: any) => {
            const groupId = Number(summary?.groupId);
            if (!Number.isInteger(groupId) || groupId <= 0) return acc;
            acc[String(groupId)] = summary;
            return acc;
          },
          {} as Record<string, any>
        );
        setReticulumChatSummaries(next);
        syncReticulumMentionNotifications(next);
        void window.reticulumChat?.updateMentionBadge?.(
          getReticulumMentionBadgeCount(next)
        );
        return true;
      } catch (error) {
        if (refreshWasSuperseded()) return true;
        console.error(
          '[ReticulumChat] Failed to refresh group summaries:',
          error
        );
        return false;
      }
    }, [
      myAddress,
      setReticulumChatEnabled,
      setReticulumChatSummaries,
      syncReticulumMentionNotifications,
    ]);

  const scheduleReticulumChatSummariesRefresh = useCallback(() => {
    scheduleReticulumSummaryRefresh(
      reticulumSummariesRefreshTimerRef,
      reticulumSummariesRefreshWindowStartedAtRef,
      refreshReticulumChatSummaries
    );
  }, [refreshReticulumChatSummaries]);

  useEffect(() => {
    reticulumSummariesRefreshSequenceRef.current += 1;
    myAddressRef.current = myAddress || '';
    setReticulumAdminGroupsLoadedAddress('');
    setReticulumMembershipsAppliedKey('');
    setReticulumSummariesLoadedMembershipKey('');
    if (!myAddress) {
      void window.reticulumChat?.updateMentionBadge?.(0);
    }
  }, [myAddress]);

  const reticulumMemberships = useMemo(
    () =>
      getReticulumGroupMembershipsFromGroupLikeList(
        memberGroupsForReticulum,
        groupsProperties,
        myAddress,
        reticulumAdminGroupIds
      ),
    [
      groupsProperties,
      memberGroupsForReticulum,
      myAddress,
      reticulumAdminGroupIds,
    ]
  );
  const reticulumMembershipsKey = useMemo(
    () =>
      JSON.stringify(
        reticulumMemberships.map(
          ({
            groupId,
            isPrivate,
            isAdmin,
            adminStatusAuthoritative,
            joinedAt,
            localAddress,
          }) => ({
            groupId,
            isPrivate,
            isAdmin,
            adminStatusAuthoritative,
            joinedAt: joinedAt || 0,
            localAddress: localAddress || '',
          })
        )
      ),
    [reticulumMemberships]
  );

  useEffect(() => {
    return window.presence?.onStarted?.(() => {
      setReticulumTransportReadyRevision((revision) => revision + 1);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let latestRevision = -1;
    let latestState: 'idle' | 'starting' | 'ready' | 'failed' | undefined;
    const applyReadinessStatus = (status: {
      state: 'idle' | 'starting' | 'ready' | 'failed';
      revision: number;
    }) => {
      if (cancelled || status.revision < latestRevision) {
        return;
      }
      if (
        status.revision === latestRevision &&
        latestState === 'ready' &&
        status.state !== 'ready'
      ) {
        return;
      }
      const becameReady = status.state === 'ready' && latestState !== 'ready';
      latestRevision = status.revision;
      latestState = status.state;
      setReticulumChatReadinessState(status.state);
      if (becameReady) {
        setReticulumTransportReadyRevision((revision) => revision + 1);
      }
    };
    const unsubscribe =
      window.reticulumChat?.onReadinessChanged?.(applyReadinessStatus);

    void window.reticulumChat
      ?.getReadinessStatus?.()
      .then(applyReadinessStatus)
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!myAddress) return;
    if (memberGroupsLoadedAddress !== myAddress) {
      return;
    }
    if (reticulumAdminGroupsLoadedAddress !== myAddress) {
      return;
    }
    const groupIds = getGroupIdsFromGroupLikeList(memberGroupsForReticulum);

    let cancelled = false;
    setReticulumMembershipsAppliedKey('');
    setReticulumSummariesLoadedMembershipKey('');
    void (async () => {
      try {
        if (typeof window.reticulumChat?.isEnabled !== 'function') {
          console.error(
            '[ReticulumChat] Membership sync cannot initialize: isEnabled bridge is unavailable'
          );
          return;
        }
        const enabled = await window.reticulumChat.isEnabled();
        if (cancelled || !enabled) {
          if (!cancelled) {
            reticulumSummariesRefreshSequenceRef.current += 1;
            for (const groupId of reticulumSubscribedGroupIdsRef.current) {
              void window.reticulumChat?.unsubscribeGroup?.(groupId);
            }
            reticulumSubscribedGroupIdsRef.current = new Set();
            void window.reticulumChat?.setLocalGroupMemberships?.([]);
            setReticulumChatSummaries({});
            void window.reticulumChat?.updateMentionBadge?.(0);
          }
          return;
        }
        if (
          typeof window.reticulumChat?.setLocalGroupMemberships !== 'function'
        ) {
          console.error(
            '[ReticulumChat] Membership sync cannot initialize: setLocalGroupMemberships bridge is unavailable'
          );
          return;
        }
        const resolvedReticulumMemberships = await Promise.all(
          reticulumMemberships.map(async (membership) => {
            if (membership.joinedAt || !membership.localAddress) {
              return membership;
            }
            const joinedAt = await resolveReticulumMembershipJoinedAt(
              membership.groupId,
              membership.localAddress
            ).catch(() => null);
            return joinedAt ? { ...membership, joinedAt } : membership;
          })
        );
        if (cancelled) return;
        const membershipResult =
          await window.reticulumChat.setLocalGroupMemberships(
            resolvedReticulumMemberships
          );
        if (cancelled) return;
        if (membershipResult?.success !== true) {
          console.error('[ReticulumChat] Membership sync was rejected', {
            groupCount: groupIds.length,
            failureCode:
              typeof membershipResult?.error === 'string'
                ? membershipResult.error
                : 'unknown',
          });
          return;
        }
        await Promise.all(
          resolvedReticulumMemberships.map(
            ({ groupId, joinedAt, localAddress }) =>
              joinedAt && localAddress
                ? applyReticulumJoinUnreadBaseline({
                    address: localAddress,
                    groupId,
                    joinedAt,
                  })
                : Promise.resolve(false)
          )
        );
        if (cancelled) return;
        setReticulumMembershipsAppliedKey(reticulumMembershipsKey);
        const nextIds = new Set(groupIds);
        const activeSubscriptionIds =
          typeof window.reticulumChat?.getSubscriptions === 'function'
            ? await window.reticulumChat
                .getSubscriptions()
                .catch(() => [] as number[])
            : [];
        if (cancelled) return;
        const previousIds = new Set(
          (Array.isArray(activeSubscriptionIds)
            ? activeSubscriptionIds
            : []
          ).filter((groupId) => Number.isInteger(groupId) && groupId > 0)
        );
        for (const groupId of previousIds) {
          if (!nextIds.has(groupId)) {
            void window.reticulumChat?.unsubscribeGroup?.(groupId);
          }
        }
        for (const groupId of nextIds) {
          if (!previousIds.has(groupId)) {
            void window.reticulumChat?.subscribeGroup?.(groupId);
          }
        }
        reticulumSubscribedGroupIdsRef.current = nextIds;
        if (groupIds.length === 0) {
          reticulumSummariesRefreshSequenceRef.current += 1;
          setReticulumChatSummaries({});
          void window.reticulumChat?.updateMentionBadge?.(0);
          return;
        }
        const summariesLoaded = await refreshReticulumChatSummaries();
        if (cancelled) return;
        if (!summariesLoaded) {
          console.error(
            '[ReticulumChat] Activity dashboard did not load after membership sync',
            { groupCount: groupIds.length }
          );
          return;
        }
        setReticulumSummariesLoadedMembershipKey(reticulumMembershipsKey);
        scheduleReticulumChatSummariesRefresh();
      } catch (error) {
        if (!cancelled) {
          console.error(
            '[ReticulumChat] Membership and activity dashboard initialization failed:',
            error
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    memberGroupsLoadedAddress,
    memberGroupsForReticulum,
    myAddress,
    reticulumAdminGroupsLoadedAddress,
    reticulumMemberships,
    reticulumMembershipsKey,
    reticulumTransportReadyRevision,
    refreshReticulumChatSummaries,
    scheduleReticulumChatSummariesRefresh,
    setReticulumChatSummaries,
  ]);

  useEffect(() => {
    const offSummaryChanged = window.reticulumChat?.onSummaryChanged?.(
      (payload) => {
        const groupId = Number(payload?.groupId);
        if (
          Number.isInteger(groupId) &&
          groupId > 0 &&
          !reticulumSubscribedGroupIdsRef.current.has(groupId)
        ) {
          return;
        }
        scheduleReticulumChatSummariesRefresh();
      }
    );
    const refreshHandler = () => {
      scheduleReticulumChatSummariesRefresh();
    };
    subscribeToEvent('reticulum-chat-summaries-refresh', refreshHandler);
    void refreshReticulumChatSummaries();
    return () => {
      offSummaryChanged?.();
      unsubscribeFromEvent('reticulum-chat-summaries-refresh', refreshHandler);
      if (reticulumSummariesRefreshTimerRef.current) {
        clearTimeout(reticulumSummariesRefreshTimerRef.current);
        reticulumSummariesRefreshTimerRef.current = null;
      }
      reticulumSummariesRefreshWindowStartedAtRef.current = null;
    };
  }, [refreshReticulumChatSummaries, scheduleReticulumChatSummariesRefresh]);

  const refreshReticulumDirectSummaries = useCallback(
    async (enabled = reticulumChatEnabled) => {
      if (!myAddress || !enabled) {
        setReticulumDirectSummaries({});
        return;
      }
      try {
        const summaries =
          await window.reticulumChat?.getDirectSummaries?.(myAddress);
        if (!Array.isArray(summaries)) {
          setReticulumDirectSummaries({});
          return;
        }
        const next = summaries.reduce(
          (acc, summary: any) => {
            const peerAddress = String(summary?.peerAddress || '').trim();
            if (!peerAddress) return acc;
            acc[peerAddress] = summary;
            return acc;
          },
          {} as Record<string, any>
        );
        setReticulumDirectSummaries(next);
      } catch (error) {
        console.error('[ReticulumChat] Failed to refresh DM summaries:', error);
      }
    },
    [myAddress, reticulumChatEnabled, setReticulumDirectSummaries]
  );

  const refreshReticulumDirectSummary = useCallback(
    async (peerAddress: string) => {
      const peer = String(peerAddress || '').trim();
      if (!myAddress || !reticulumChatEnabled || !peer) return;
      try {
        const summaries = await window.reticulumChat?.getDirectSummaries?.(
          myAddress,
          peer
        );
        const summary = Array.isArray(summaries)
          ? summaries.find(
              (candidate: any) =>
                String(candidate?.peerAddress || '').trim() === peer
            )
          : undefined;
        setReticulumDirectSummaries((previous) => {
          const next = { ...previous };
          if (summary) next[peer] = summary;
          else delete next[peer];
          return next;
        });
      } catch (error) {
        console.error('[ReticulumChat] Failed to refresh DM summary:', error);
      }
    },
    [myAddress, reticulumChatEnabled, setReticulumDirectSummaries]
  );

  const scheduleReticulumDirectSummariesRefresh = useCallback(
    (delayMs = 150) => {
      if (reticulumDirectSummariesRefreshTimerRef.current) {
        clearTimeout(reticulumDirectSummariesRefreshTimerRef.current);
      }
      reticulumDirectSummariesRefreshTimerRef.current = setTimeout(() => {
        reticulumDirectSummariesRefreshTimerRef.current = null;
        void refreshReticulumDirectSummaries();
      }, delayMs);
    },
    [refreshReticulumDirectSummaries]
  );

  useEffect(() => {
    let cancelled = false;
    const retryTimers: ReturnType<typeof setTimeout>[] = [];
    void (async () => {
      const enabled = (await window.reticulumChat?.isEnabled?.()) === true;
      if (cancelled) return;
      setReticulumChatEnabled(enabled);
      if (!enabled || !myAddress) {
        setReticulumDirectSummaries({});
        return;
      }
      await refreshReticulumDirectSummaries(true);
      for (const delayMs of [750, 2000, 5000]) {
        retryTimers.push(
          setTimeout(() => {
            if (!cancelled) {
              void refreshReticulumDirectSummaries(true);
            }
          }, delayMs)
        );
      }
    })();
    return () => {
      cancelled = true;
      retryTimers.forEach((timer) => clearTimeout(timer));
      if (reticulumDirectSummariesRefreshTimerRef.current) {
        clearTimeout(reticulumDirectSummariesRefreshTimerRef.current);
        reticulumDirectSummariesRefreshTimerRef.current = null;
      }
    };
  }, [
    myAddress,
    refreshReticulumDirectSummaries,
    setReticulumChatEnabled,
    setReticulumDirectSummaries,
  ]);

  useEffect(() => {
    if (!reticulumChatEnabled || !myAddress) return;
    const offSummaryChanged = window.reticulumChat?.onDirectSummaryChanged?.(
      (payload) => {
        if (payload.reason === 'expiry' && payload.peerAddress) {
          void refreshReticulumDirectSummary(payload.peerAddress);
          return;
        }
        scheduleReticulumDirectSummariesRefresh();
      }
    );
    scheduleReticulumDirectSummariesRefresh();
    return () => {
      offSummaryChanged?.();
      if (reticulumDirectSummariesRefreshTimerRef.current) {
        clearTimeout(reticulumDirectSummariesRefreshTimerRef.current);
        reticulumDirectSummariesRefreshTimerRef.current = null;
      }
    };
  }, [
    myAddress,
    refreshReticulumDirectSummary,
    reticulumChatEnabled,
    scheduleReticulumDirectSummariesRefresh,
  ]);

  useEffect(() => {
    if (desktopSideView !== 'directs' || !reticulumChatEnabled || !myAddress) {
      return;
    }
    scheduleReticulumDirectSummariesRefresh();
  }, [
    desktopSideView,
    myAddress,
    reticulumChatEnabled,
    scheduleReticulumDirectSummariesRefresh,
  ]);

  useEffect(() => {
    if (!reticulumChatEnabled || !myAddress) return;
    const timer = setInterval(() => {
      scheduleReticulumDirectSummariesRefresh();
    }, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, [
    myAddress,
    reticulumChatEnabled,
    scheduleReticulumDirectSummariesRefresh,
  ]);

  const refreshHomeDataFunc = useCallback(() => {
    setGroupSection('default');
    setTimeout(() => {
      setGroupSection('home');
    }, 300);
  }, []);

  const getGroupAnnouncements = useCallback(async () => {
    try {
      return new Promise((res, rej) => {
        window
          .sendMessage('getGroupNotificationTimestamp')
          .then((response) => {
            if (!response?.error) {
              setGroupAnnouncements(response);
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
  }, [t]);

  useEffect(() => {
    if (myAddress) {
      getGroupAnnouncements();
      getTimestampEnterChat();
    }
  }, [myAddress, getGroupAnnouncements, getTimestampEnterChat]);

  const getGroupOwner = useCallback(async (groupId) => {
    if (groupId == '0') return; // general group has id=0
    try {
      const url = `${getBaseApiReact()}/groups/${groupId}`;
      const response = await fetch(url);
      const data = await response.json();

      const name = await getNameInfo(data?.owner);
      if (
        String(selectedGroupRef.current?.groupId || '') !==
        String(groupId || '')
      ) {
        return;
      }
      if (name) {
        data.name = name;
      }
      setGroupOwner(data);
    } catch (error) {
      console.log(error);
    }
  }, []);

  useEffect(() => {
    if (!reticulumChatEnabled) {
      reticulumDirectNameResolutionsRef.current.clear();
      reticulumDirectNameRetryAfterRef.current.clear();
      reticulumDirectNamesByAddressRef.current = {};
      setReticulumDirectNamesByAddress((previous) =>
        Object.keys(previous).length ? {} : previous
      );
      return;
    }

    const knownNames: Record<string, string> = {};
    for (const direct of directs || []) {
      const address = typeof direct?.address === 'string' ? direct.address : '';
      const name = typeof direct?.name === 'string' ? direct.name.trim() : '';
      if (address && name && name !== address) knownNames[address] = name;
    }
    for (const [address, friend] of Object.entries(dmFriendsByAddress || {})) {
      const name = friend?.name?.trim();
      if (address && name) knownNames[address] = name;
    }
    if (Object.keys(knownNames).length) {
      setReticulumDirectNamesByAddress((previous) => {
        const changed = Object.entries(knownNames).some(
          ([address, name]) => previous[address] !== name
        );
        if (!changed) return previous;
        const next = { ...previous, ...knownNames };
        reticulumDirectNamesByAddressRef.current = next;
        return next;
      });
    }

    const now = Date.now();
    const unresolvedAddresses = Object.values(reticulumDirectSummaries || {})
      .map((summary: any) => String(summary?.peerAddress || '').trim())
      .filter(
        (address) =>
          address &&
          !knownNames[address] &&
          !reticulumDirectNamesByAddressRef.current[address] &&
          !reticulumDirectNameResolutionsRef.current.has(address) &&
          (reticulumDirectNameRetryAfterRef.current.get(address) || 0) <= now
      );
    if (!unresolvedAddresses.length) return;
    unresolvedAddresses.forEach((address) =>
      reticulumDirectNameResolutionsRef.current.add(address)
    );
    void Promise.all(
      unresolvedAddresses.map(async (address) => {
        try {
          const name = await requestQueueMemberNames.enqueue(() =>
            getNameInfo(address)
          );
          return [address, name || null] as const;
        } catch {
          return [address, null] as const;
        } finally {
          reticulumDirectNameResolutionsRef.current.delete(address);
        }
      })
    ).then((resolved) => {
      const entries = resolved.filter(
        (entry): entry is readonly [string, string] => Boolean(entry[1])
      );
      for (const [address, name] of resolved) {
        if (name) {
          reticulumDirectNameRetryAfterRef.current.delete(address);
        } else {
          reticulumDirectNameRetryAfterRef.current.set(
            address,
            Date.now() + RETICULUM_DIRECT_NAME_RETRY_DELAY_MS
          );
        }
      }
      if (!entries.length) return;
      setReticulumDirectNamesByAddress((previous) => {
        const additions = Object.fromEntries(entries);
        const changed = Object.entries(additions).some(
          ([address, name]) => previous[address] !== name
        );
        if (!changed) return previous;
        const next = { ...previous, ...additions };
        reticulumDirectNamesByAddressRef.current = next;
        return next;
      });
    });
  }, [
    directs,
    dmFriendsByAddress,
    reticulumChatEnabled,
    reticulumDirectSummaries,
  ]);

  const reticulumDirectRows = useMemo(() => {
    if (!reticulumChatEnabled) return [];
    const rows = Object.values(reticulumDirectSummaries || {})
      .map((summary: any) => {
        const peerAddress = String(summary?.peerAddress || '').trim();
        const lastEvent = summary?.lastEvent || null;
        const lastCall = summary?.lastCall || null;
        const silenced = summary?.silenced === true;
        if (
          !validateAddress(peerAddress) ||
          (!lastEvent && !lastCall && !silenced)
        )
          return null;
        const friend = dmFriendsByAddress?.[peerAddress];
        const resolvedName =
          friend?.name || reticulumDirectNamesByAddress[peerAddress];
        return {
          address: peerAddress,
          name: resolvedName || peerAddress,
          timestamp: Number(
            summary?.updatedAt || lastCall?.endedAt || lastEvent?.timestamp || 0
          ),
          sender: lastEvent?.senderAddress || '',
          senderName:
            lastEvent?.senderAddress === myAddress
              ? userInfo?.name
              : resolvedName || peerAddress,
          reticulumDirect: true,
          reticulumSilenced: silenced,
          unreadCount: Number(summary?.unreadCount || 0),
          unreadMissedCallCount: Number(summary?.unreadMissedCallCount || 0),
          lastCall,
          lastMessageTimestamp: Number(lastEvent?.timestamp || 0),
        };
      })
      .filter(Boolean);
    if (!validateAddress(myAddress)) return rows;
    const savedSummary = reticulumDirectSummaries?.[myAddress];
    const savedLastEvent = savedSummary?.lastEvent || null;
    return [
      {
        address: myAddress,
        name: 'Saved Messages',
        timestamp: Number(
          savedSummary?.updatedAt || savedLastEvent?.timestamp || 0
        ),
        sender: myAddress,
        senderName: userInfo?.name || myAddress,
        reticulumDirect: true,
        savedMessages: true,
        unreadCount: 0,
      },
      ...rows.filter((row: any) => row?.address !== myAddress),
    ];
  }, [
    dmFriendsByAddress,
    myAddress,
    reticulumChatEnabled,
    reticulumDirectSummaries,
    reticulumDirectNamesByAddress,
    userInfo?.name,
  ]);

  const mergedDirectRows = useMemo(() => {
    if (reticulumChatEnabled) return reticulumDirectRows;
    return directs;
  }, [directs, reticulumChatEnabled, reticulumDirectRows]);

  const directChatHasUnread = useMemo(() => {
    let hasUnread = false;
    mergedDirectRows.forEach((direct) => {
      if (
        Number(direct?.unreadCount || 0) > 0 ||
        (!reticulumChatEnabled &&
          direct?.sender !== myAddress &&
          direct?.timestamp &&
          ((!timestampEnterData[direct?.address] &&
            Date.now() - direct?.timestamp <
              timeDifferenceForNotificationChats) ||
            timestampEnterData[direct?.address] < direct?.timestamp))
      ) {
        hasUnread = true;
      }
    });
    return hasUnread;
  }, [timestampEnterData, mergedDirectRows, myAddress, reticulumChatEnabled]);

  const reticulumDirectUnreadCount = useMemo(() => {
    if (!reticulumChatEnabled) return 0;
    return mergedDirectRows.reduce(
      (total, direct) => total + Math.max(0, Number(direct?.unreadCount || 0)),
      0
    );
  }, [mergedDirectRows, reticulumChatEnabled]);

  const displayDirects = useMemo(() => {
    if (reticulumChatEnabled) {
      const merged = mergeDirectsWithFriends(
        mergedDirectRows,
        dmFriendsByAddress,
        myAddress,
        userInfo?.name
      );
      return merged.sort((a: any, b: any) => {
        if (a?.savedMessages !== b?.savedMessages) {
          return a?.savedMessages ? -1 : 1;
        }
        const timestampA = Number(a?.timestamp || 0);
        const timestampB = Number(b?.timestamp || 0);
        if (timestampA !== timestampB) return timestampB - timestampA;
        return String(a?.name || a?.address || '').localeCompare(
          String(b?.name || b?.address || '')
        );
      });
    }
    const merged = mergeDirectsWithFriends(
      mergedDirectRows,
      dmFriendsByAddress,
      myAddress,
      userInfo?.name
    );
    return merged;
  }, [
    mergedDirectRows,
    dmFriendsByAddress,
    myAddress,
    reticulumChatEnabled,
    userInfo?.name,
  ]);

  useEffect(() => {
    if (!reticulumChatEnabled || desktopSideView !== 'directs') return;
    if (selectedDirect || newChat) return;
    const firstDirect = displayDirects[0];
    if (!firstDirect?.address) {
      return;
    }
    setSelectedDirect(firstDirect);
    window
      .sendMessage('addTimestampEnterChat', {
        timestamp: Date.now(),
        groupId: firstDirect.address,
      })
      .catch((error) => {
        console.error(
          'Failed to add timestamp:',
          error.message || 'An error occurred'
        );
      });
    getTimestampEnterChat();
  }, [
    desktopSideView,
    displayDirects,
    getTimestampEnterChat,
    newChat,
    reticulumChatEnabled,
    selectedDirect,
  ]);

  const getSecretKey = useCallback(
    async (loadingGroupParam?: boolean, secretKeyToPublish?: boolean) => {
      const useLegacyGroupKeyLoading = !reticulumChatEnabled;
      try {
        if (useLegacyGroupKeyLoading) {
          setIsLoadingGroupMessage(
            t('auth:message.generic.locating_encryption_keys', {
              postProcess: 'capitalizeFirstChar',
            })
          );
          pauseAllQueues();
        }

        let dataFromStorage;
        let publishFromStorage;
        let adminsFromStorage;

        if (
          secretKeyToPublish &&
          secretKeyRef.current &&
          lastFetchedSecretKey.current &&
          Date.now() - lastFetchedSecretKey.current <
            TIME_MINUTES_10_IN_MILLISECONDS
        ) {
          return secretKeyRef.current;
        }

        if (loadingGroupParam && useLegacyGroupKeyLoading) {
          setIsLoadingGroup(true);
        }

        if (selectedGroup?.groupId !== selectedGroupRef.current.groupId) {
          if (settimeoutForRefetchSecretKey.current) {
            clearTimeout(settimeoutForRefetchSecretKey.current);
          }
          return;
        }

        const prevGroupId = selectedGroupRef.current.groupId;
        const selectedGroupIsCurrent = () =>
          String(selectedGroupRef.current?.groupId || '') ===
          String(prevGroupId || '');

        const { names, addresses, both } =
          adminsFromStorage || (await getGroupAdmins(selectedGroup?.groupId));
        if (!selectedGroupIsCurrent()) return;
        setAdmins(addresses);
        setAdminsWithNames(both);

        if (!names.length) throw new Error('Network error');

        const publish =
          publishFromStorage ||
          (await getPublishesFromAdmins(names, selectedGroup?.groupId));

        if (!selectedGroupIsCurrent()) {
          if (settimeoutForRefetchSecretKey.current) {
            clearTimeout(settimeoutForRefetchSecretKey.current);
          }
          return;
        }

        if (publish === false) {
          setTriedToFetchSecretKey(true);
          if (
            groupSectionUsesSecretKey(
              reticulumChatEnabled,
              groupSectionRef.current || ''
            )
          ) {
            settimeoutForRefetchSecretKey.current = setTimeout(() => {
              getSecretKey();
            }, TIME_MINUTES_2_IN_MILLISECONDS);
          }
          return false;
        }

        setSecretKeyPublishDate(publish?.updated || publish?.created);

        let data;
        if (dataFromStorage) {
          data = dataFromStorage;
        } else {
          if (useLegacyGroupKeyLoading) {
            setIsLoadingGroupMessage(
              t('auth:message.generic.downloading_encryption_keys', {
                postProcess: 'capitalizeFirstChar',
              })
            );
          }
          const res = await fetch(
            `${getBaseApiReact()}/arbitrary/DOCUMENT_PRIVATE/${publish.name}/${publish.identifier}?encoding=base64&rebuild=true`
          );
          data = await res.text();
        }

        const decryptedKey: any = await decryptResource(data, null);
        const dataint8Array = base64ToUint8Array(decryptedKey.data);
        const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);

        if (!validateSecretKey(decryptedKeyToObject)) {
          throw new Error('SecretKey is not valid');
        }
        if (!selectedGroupIsCurrent()) return;

        setSecretKeyDetails(publish);
        setSecretKey(decryptedKeyToObject);
        lastFetchedSecretKey.current = Date.now();
        setMemberCountFromSecretKeyData(decryptedKey.count);

        window
          .sendMessage('setGroupData', {
            groupId: selectedGroup?.groupId,
            secretKeyData: data,
            secretKeyResource: publish,
            admins: { names, addresses, both },
          })
          .catch((error) => {
            console.error(
              'Failed to set group data:',
              error.message || 'An error occurred'
            );
          });

        if (decryptedKeyToObject) {
          setTriedToFetchSecretKey(true);
          setFirstSecretKeyInCreation(false);
          return decryptedKeyToObject;
        } else {
          setTriedToFetchSecretKey(true);
        }
      } catch (error) {
        if (
          error === 'Unable to decrypt data' ||
          error === 'Unable to decrypt'
        ) {
          setTriedToFetchSecretKey(true);
          if (
            groupSectionUsesSecretKey(
              reticulumChatEnabled,
              groupSectionRef.current || ''
            )
          ) {
            settimeoutForRefetchSecretKey.current = setTimeout(() => {
              getSecretKey();
            }, TIME_MINUTES_2_IN_MILLISECONDS);
          }
        }
      } finally {
        if (useLegacyGroupKeyLoading) {
          setIsLoadingGroup(false);
          setIsLoadingGroupMessage('');
          resumeAllQueues();
        }
      }
    },
    [
      selectedGroup?.groupId,
      setIsLoadingGroup,
      setIsLoadingGroupMessage,
      setSecretKey,
      setSecretKeyDetails,
      setTriedToFetchSecretKey,
      setFirstSecretKeyInCreation,
      setMemberCountFromSecretKeyData,
      setAdmins,
      setAdminsWithNames,
      setSecretKeyPublishDate,
      reticulumChatEnabled,
    ]
  );

  /** Fetch secret key for an arbitrary group (e.g. for widget). Same flow as full chat: try cache, then network; cache on success; retry on decrypt failure. */
  const getSecretKeyForGroup = useCallback(
    async (group: { groupId: string } | null): Promise<any> => {
      if (!group?.groupId) return null;
      const groupIdStr = String(group.groupId);
      try {
        // 1. Try cached key (same as full chat when it would use storage)
        const cached: any = await window
          .sendMessage('getGroupDataSingle', { groupId: groupIdStr })
          .catch(() => null);
        if (cached?.secretKeyData && !cached?.error) {
          try {
            const decryptedKey: any = await decryptResource(
              cached.secretKeyData,
              null
            );
            const dataint8Array = base64ToUint8Array(decryptedKey.data);
            const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);
            if (validateSecretKey(decryptedKeyToObject))
              return decryptedKeyToObject;
          } catch {
            // Cached key invalid or decrypt failed, fall through to fetch
          }
        }

        // 2. Fetch from network (same as full getSecretKey)
        const groupIdNum = Number(group.groupId);
        const { names, addresses, both } = await getGroupAdmins(groupIdNum);
        if (!names?.length) return null;
        const publish = await getPublishesFromAdmins(names, groupIdStr);
        if (publish === false) {
          return new Promise((resolve) => {
            setTimeout(
              () => resolve(getSecretKeyForGroup(group)),
              TIME_MINUTES_2_IN_MILLISECONDS
            );
          });
        }
        const res = await fetch(
          `${getBaseApiReact()}/arbitrary/DOCUMENT_PRIVATE/${publish.name}/${publish.identifier}?encoding=base64&rebuild=true`
        );
        const data = await res.text();
        const decryptedKey: any = await decryptResource(data, null);
        const dataint8Array = base64ToUint8Array(decryptedKey.data);
        const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);
        if (!validateSecretKey(decryptedKeyToObject)) return null;

        // 3. Cache for next time (same as full chat setGroupData)
        window
          .sendMessage('setGroupData', {
            groupId: groupIdStr,
            secretKeyData: data,
            secretKeyResource: publish,
            admins: { names, addresses, both },
          })
          .catch(() => {});

        return decryptedKeyToObject;
      } catch (e) {
        if (e === 'Unable to decrypt data') {
          return new Promise((resolve) => {
            setTimeout(
              () => resolve(getSecretKeyForGroup(group)),
              TIME_MINUTES_2_IN_MILLISECONDS
            );
          });
        }
        console.error(e);
        return null;
      }
    },
    []
  );

  const getReticulumMentionNameMap = useCallback(
    async (groupId: number): Promise<Map<string, string>> => {
      const cached = reticulumGroupMentionNameCacheRef.current.get(groupId);
      if (cached) return cached;
      const map = new Map<string, string>();
      let loadedMembers = false;
      try {
        const data = await getGroupMembers(groupId);
        loadedMembers = true;
        if (Array.isArray(data?.members)) {
          for (const member of data.members) {
            const address =
              typeof member?.member === 'string' ? member.member.trim() : '';
            const name =
              typeof member?.primaryName === 'string'
                ? member.primaryName.trim()
                : '';
            if (address && name) map.set(name.toLowerCase(), address);
          }
        }
      } catch (error) {
        console.error(
          '[ReticulumChat] Failed to load members for background mentions:',
          error
        );
      }
      if (myAddress && userInfo?.name) {
        map.set(String(userInfo.name).toLowerCase(), myAddress);
      }
      if (loadedMembers) {
        reticulumGroupMentionNameCacheRef.current.set(groupId, map);
      }
      return map;
    },
    [myAddress, userInfo?.name]
  );

  useEffect(() => {
    reticulumGroupMentionNameCacheRef.current.clear();
  }, [memberGroupsForReticulum, myAddress, userInfo?.name]);

  const recordReticulumMentionNotification = useCallback(
    (
      event: ReticulumBackgroundEvent,
      groupId: number,
      mentionedAddresses: string[]
    ) => {
      const eventId = String(event?.eventId || '');
      if (
        event.eventType === 'edit' ||
        event.readByOwner === true ||
        !eventId ||
        !myAddressRef.current ||
        event.authorAddress === myAddressRef.current ||
        !mentionedAddresses.includes(myAddressRef.current) ||
        (Array.isArray(mutedGroups) &&
          mutedGroups.some(
            (mutedGroupId) => String(mutedGroupId) === String(groupId)
          ))
      ) {
        return;
      }

      const group = memberGroupsRef.current?.find(
        (item: any) => Number(item?.groupId) === groupId
      );
      const groupName =
        group?.groupName || group?.name || `Group ${String(groupId)}`;
      const channelId = String(event.channelId || 'general');
      const timestamp = Number(event.timestamp || Date.now());

      executeEvent('q-chat-mention-notification', {
        channelId,
        eventId,
        groupId,
        groupName,
        timestamp,
      });
    },
    [mutedGroups]
  );

  const processReticulumBackgroundEvent = useCallback(
    async (
      event: ReticulumBackgroundEvent,
      options: { recordMentionNotification?: boolean } = {}
    ) => {
      if (!event?.eventId || !event?.groupId || !event?.eventType) return;
      const alreadyProcessed = hasProcessedReticulumBackgroundEvent(
        event.eventId
      );
      if (alreadyProcessed && options.recordMentionNotification !== true) {
        return;
      }

      if (event.eventType === 'delete') {
        if (alreadyProcessed) return;
        if (event.targetEventId) {
          await window.reticulumChat?.deleteSearchText?.(event.targetEventId);
          await window.reticulumChat?.deleteMentions?.(event.targetEventId);
          noteProcessedReticulumBackgroundEvent(event.eventId);
          scheduleReticulumChatSummariesRefresh();
        }
        return;
      }

      if (
        event.eventType !== 'message' &&
        event.eventType !== 'edit' &&
        event.eventType !== 'attachment_manifest'
      ) {
        return;
      }

      const groupId = Number(event.groupId);
      if (!Number.isInteger(groupId) || groupId <= 0) return;
      const groupProperty = groupsPropertiesRef.current?.[String(groupId)] as
        | { isOpen?: boolean }
        | undefined;
      if (groupProperty?.isOpen !== true && groupProperty?.isOpen !== false) {
        return;
      }

      let payload: unknown = null;
      try {
        payload = JSON.parse(String(event.encryptedPayload || ''));
      } catch {
        payload = event.encryptedPayload || '';
      }

      const text = reticulumVisibleSearchTextFromPayload(payload);
      const targetEventId =
        event.eventType === 'edit' && event.targetEventId
          ? event.targetEventId
          : event.eventId;
      if (!targetEventId || !text) {
        noteProcessedReticulumBackgroundEvent(event.eventId);
        scheduleReticulumChatSummariesRefresh();
        return;
      }

      await window.reticulumChat?.indexSearchText?.(targetEventId, text);
      const mentionMap = await getReticulumMentionNameMap(groupId);
      const mentionedAddresses = [
        ...new Set([
          ...reticulumMentionedAddressesFromPayload(payload),
          ...resolveReticulumMentionAddressesFromPayload(payload, mentionMap),
        ]),
      ];
      await window.reticulumChat?.replaceMentions?.(
        targetEventId,
        mentionedAddresses
      );
      if (options.recordMentionNotification === true) {
        const localAddress = myAddressRef.current || '';
        const authorizedBroadcast = authorizedReticulumBroadcastApplies(event);
        const directMention = event.directMentionAuthorized === true;
        const notificationMentionedAddresses =
          localAddress && (authorizedBroadcast || directMention)
            ? [localAddress]
            : [];
        recordReticulumMentionNotification(
          event,
          groupId,
          notificationMentionedAddresses
        );
      }
      noteProcessedReticulumBackgroundEvent(event.eventId);
      scheduleReticulumChatSummariesRefresh();
    },
    [
      getReticulumMentionNameMap,
      hasProcessedReticulumBackgroundEvent,
      noteProcessedReticulumBackgroundEvent,
      recordReticulumMentionNotification,
      scheduleReticulumChatSummariesRefresh,
    ]
  );

  useEffect(() => {
    if (!myAddress) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      const enabled = await window.reticulumChat?.isEnabled?.();
      if (cancelled || enabled !== true) return;
      unsubscribe = window.reticulumChat?.onEvent?.((payload) => {
        const event = payload?.event as ReticulumBackgroundEvent | undefined;
        if (!event?.eventId) return;
        void processReticulumBackgroundEvent(event, {
          recordMentionNotification: true,
        }).catch((error) => {
          console.error(
            '[ReticulumChat] Background event processing failed:',
            error
          );
        });
      });
      if (cancelled) unsubscribe?.();
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [myAddress, processReticulumBackgroundEvent]);

  useEffect(() => {
    if (!myAddress) return;
    const groupIds = getGroupIdsFromGroupLikeList(memberGroupsForReticulum);
    if (groupIds.length === 0) return;
    let cancelled = false;
    void (async () => {
      const enabled = await window.reticulumChat?.isEnabled?.();
      if (cancelled || enabled !== true) return;
      for (const groupId of groupIds) {
        if (cancelled) return;
        const history = await window.reticulumChat?.getHistory?.(
          groupId,
          'general',
          50,
          { repairNetwork: false }
        );
        if (cancelled || !Array.isArray(history)) continue;
        for (const event of history as ReticulumBackgroundEvent[]) {
          if (cancelled) return;
          await processReticulumBackgroundEvent(event);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    groupsProperties,
    memberGroupsForReticulum,
    myAddress,
    processReticulumBackgroundEvent,
  ]);

  const getAdminsForGroup = useCallback(async (selectedGroup) => {
    try {
      const groupId = selectedGroup?.groupId;
      const { names, addresses, both } = await getGroupAdmins(groupId);
      if (
        String(selectedGroupRef.current?.groupId || '') !==
        String(groupId || '')
      ) {
        return;
      }
      setAdmins(addresses);
      setAdminsWithNames(both);
    } catch (error) {
      console.log(error);
    }
  }, []);

  useEffect(() => {
    if (selectedGroup && isPrivate !== null) {
      if (isPrivate) {
        if (shouldLoadSecretKeyOnGroupEntry(reticulumChatEnabled, isPrivate)) {
          setTriedToFetchSecretKey(false);
          getSecretKey(true);
        } else {
          // Reticulum group chat authorizes private-group access through Core
          // membership. Load role metadata here, but leave the legacy group key
          // to the Threads view that still needs it.
          getAdminsForGroup(selectedGroup);
        }
      }

      getGroupOwner(selectedGroup?.groupId);
    }
    if (isPrivate === false) {
      setTriedToFetchSecretKey(true);
      if (selectedGroup?.groupId !== '0') {
        getAdminsForGroup(selectedGroup);
      }
    }
  }, [
    selectedGroup,
    isPrivate,
    reticulumChatEnabled,
    getSecretKey,
    getGroupOwner,
    getAdminsForGroup,
  ]);

  useEffect(() => {
    if (
      !shouldLoadSecretKeyForSection(
        reticulumChatEnabled,
        isPrivate === true,
        groupSection
      ) ||
      !selectedGroup?.groupId ||
      secretKey
    ) {
      return;
    }

    const groupId = String(selectedGroup.groupId);
    if (threadKeyLoadRef.current?.groupId === groupId) return;
    const request = { groupId };
    threadKeyLoadRef.current = request;
    setTriedToFetchSecretKey(false);
    setIsLoadingThreadKey(true);

    void getSecretKey(false).finally(() => {
      if (threadKeyLoadRef.current !== request) return;
      if (String(selectedGroupRef.current?.groupId || '') === groupId) {
        setTriedToFetchSecretKey(true);
        setIsLoadingThreadKey(false);
      }
      threadKeyLoadRef.current = null;
    });
  }, [
    getSecretKey,
    groupSection,
    isPrivate,
    reticulumChatEnabled,
    secretKey,
    selectedGroup?.groupId,
  ]);

  useEffect(() => {
    if (!reticulumChatEnabled || groupSection === 'forum') return;
    if (settimeoutForRefetchSecretKey.current) {
      clearTimeout(settimeoutForRefetchSecretKey.current);
      settimeoutForRefetchSecretKey.current = null;
    }
  }, [groupSection, reticulumChatEnabled]);

  const getCountNewMesg = async (groupId, after) => {
    try {
      const response = await fetch(
        `${getBaseApiReact()}/chat/messages?after=${after}&txGroupId=${groupId}&haschatreference=false&encoding=BASE64&limit=1`
      );
      const data = await response.json();
      if (data && data[0]) return data[0].timestamp;
    } catch (error) {
      console.log(error);
    }
  };

  const getLatestRegularChat = useCallback(async (groups) => {
    try {
      const groupData = {};

      const getGroupData = groups.map(async (group) => {
        if (!group.groupId || !group?.timestamp) return null;
        if (
          !groupData[group.groupId] ||
          groupData[group.groupId] < group.timestamp
        ) {
          const hasMoreRecentMsg = await getCountNewMesg(
            group.groupId,
            timestampEnterDataRef.current[group?.groupId] ||
              Date.now() - TIME_DAYS_1_IN_MILLISECONDS
          );
          if (hasMoreRecentMsg) {
            groupData[group.groupId] = hasMoreRecentMsg;
          }
        } else {
          return null;
        }
      });

      await Promise.all(getGroupData);
      setGroupChatTimestamps(groupData);
    } catch (error) {
      console.log(error);
    }
  }, []);

  useEffect(() => {
    groupsPropertiesRef.current = groupsProperties;
  }, [groupsProperties]);

  const getGroupsProperties = useCallback(async (address) => {
    try {
      const url = `${getBaseApiReact()}/groups/member/${address}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Cannot get group properties');
      const data = await response.json();
      const transformToObject = data.reduce((result, item) => {
        result[item.groupId] = item;
        return result;
      }, {});
      setGroupsProperties(transformToObject);

      // Use ownerPrimaryName from API when present (no fallback — missing means no primary name)
      const ownerNamesFromApi: Record<string, string> = {};
      Object.keys(transformToObject).forEach((key) => {
        const item = transformToObject[key];
        if (item?.ownerPrimaryName) {
          ownerNamesFromApi[key] = item.ownerPrimaryName;
          groupsOwnerNamesRef.current[key] = item.ownerPrimaryName;
        }
      });
      if (Object.keys(ownerNamesFromApi).length > 0) {
        setGroupsOwnerNames((prev) => ({ ...prev, ...ownerNamesFromApi }));
      }
    } catch (error) {
      console.log(error);
    }
  }, []);

  const getGroupsWhereIAmAMember = useCallback(
    async (_groups) => {
      if (!myAddress) return false;
      const requestedAddress = myAddress;
      try {
        const response = await fetch(
          `${getBaseApiReact()}/groups/member/${requestedAddress}?adminOnly=true`
        );
        if (!response.ok) {
          throw new Error(`Unable to load group admins: ${response.status}`);
        }
        const data = await response.json();
        if (myAddressRef.current !== requestedAddress) return false;
        const groupsAsAdmin = Array.isArray(data) ? data : (data?.groups ?? []);
        setMyGroupsWhereIAmAdmin((current) =>
          areKeysEqual(
            getGroupIdsFromGroupLikeList(current),
            getGroupIdsFromGroupLikeList(groupsAsAdmin)
          )
            ? current
            : groupsAsAdmin
        );
        setReticulumAdminGroupsLoadedAddress(requestedAddress);
        return true;
      } catch (error) {
        console.error(
          '[ReticulumChat] Failed to load admin-group metadata required by membership sync:',
          error
        );
        if (myAddressRef.current === requestedAddress) {
          setMyGroupsWhereIAmAdmin([]);
          setReticulumAdminGroupsLoadedAddress(requestedAddress);
        }
        return false;
      }
    },
    [myAddress, setMyGroupsWhereIAmAdmin]
  );

  useEffect(() => {
    // Handler function for incoming messages
    const messageHandler = (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      const message = event.data;
      if (message?.action === 'SET_GROUPS') {
        const sortedFiltered = sortArrayByTimestampAndGroupName(
          message.payload || []
        ).filter((item: any) => item?.groupId !== '0');
        setMemberGroups(sortedFiltered);
        if (myAddressRef.current) {
          setMemberGroupsLoadedAddress(myAddressRef.current);
        }
        memberGroupsRef.current = sortedFiltered;
        getLatestRegularChat(sortedFiltered);

        // Only mark messages as read if user is actually viewing the chat
        if (
          selectedGroupRef.current &&
          groupSectionRef.current === 'chat' &&
          (desktopViewModeRef.current === 'chat' ||
            qChatTabActiveRef.current ||
            mobileViewModeRef.current === 'chat')
        ) {
          window
            .sendMessage('addTimestampEnterChat', {
              timestamp: Date.now(),
              groupId: selectedGroupRef.current.groupId,
            })
            .catch((error) => {
              console.error(
                'Failed to add timestamp:',
                error.message || 'An error occurred'
              );
            });
        }

        // Only mark direct messages as read if user is actually viewing the chat
        if (
          selectedDirectRef.current &&
          (desktopViewModeRef.current === 'chat' ||
            qChatTabActiveRef.current ||
            mobileViewModeRef.current === 'chat')
        ) {
          window
            .sendMessage('addTimestampEnterChat', {
              timestamp: Date.now(),
              groupId: selectedDirectRef.current.address,
            })
            .catch((error) => {
              console.error(
                'Failed to add timestamp:',
                error.message || 'An error occurred'
              );
            });
        }

        setTimeout(() => {
          getTimestampEnterChat();
        }, 600);
      }

      if (message?.action === 'SET_GROUP_ANNOUNCEMENTS') {
        // Update the component state with the received 'sendqort' state
        setGroupAnnouncements(message.payload);

        // Only mark announcements as read if user is actually viewing the announcement section
        if (
          selectedGroupRef.current &&
          groupSectionRef.current === 'announcement' &&
          (desktopViewModeRef.current === 'chat' ||
            qChatTabActiveRef.current ||
            mobileViewModeRef.current === 'group')
        ) {
          window
            .sendMessage('addGroupNotificationTimestamp', {
              timestamp: Date.now(),
              groupId: selectedGroupRef.current.groupId,
            })
            .catch((error) => {
              console.error(
                'Failed to add group notification timestamp:',
                error.message || 'An error occurred'
              );
            });

          setTimeout(() => {
            getGroupAnnouncements();
          }, 200);
        }
      }

      if (message?.action === 'SET_DIRECTS') {
        // Update the component state with the received 'sendqort' state
        setDirects(message.payload);
      } else if (message?.action === 'PLAY_NOTIFICATION_SOUND') {
        // audio.play();
      }
    };

    // Attach the event listener
    window.addEventListener('message', messageHandler);

    // Clean up the event listener on component unmount
    return () => {
      window.removeEventListener('message', messageHandler);
    };
  }, []);

  const getMembers = useCallback(async (groupId) => {
    try {
      const res = await getGroupMembers(groupId);
      if (groupId !== selectedGroupRef.current?.groupId) return;
      setMembers(res);
    } catch (error) {
      console.log(error);
    }
  }, []);

  useEffect(() => {
    if (
      !initiatedGetMembers.current &&
      selectedGroup?.groupId &&
      secretKey &&
      admins.includes(myAddress) &&
      selectedGroup?.groupId !== '0'
    ) {
      // getAdmins(selectedGroup?.groupId);
      getMembers(selectedGroup?.groupId);
      initiatedGetMembers.current = true;
    }
  }, [selectedGroup?.groupId, secretKey, myAddress, admins]);

  const shouldReEncrypt = useMemo(() => {
    if (triedToFetchSecretKey && !secretKeyPublishDate) return true;
    if (
      !secretKeyPublishDate ||
      !memberCountFromSecretKeyData ||
      members?.length === 0
    )
      return false;
    const isDiffMemberNumber =
      memberCountFromSecretKeyData !== members?.memberCount &&
      newEncryptionNotification?.decryptedData?.data?.numberOfMembers !==
        members?.memberCount;

    if (isDiffMemberNumber) return true;

    const latestJoined = members?.members.reduce((maxJoined, current) => {
      return current.joined > maxJoined ? current.joined : maxJoined;
    }, members?.members[0].joined);

    if (
      secretKeyPublishDate < latestJoined &&
      newEncryptionNotification?.data?.timestamp < latestJoined
    ) {
      return true;
    }
    return false;
  }, [
    memberCountFromSecretKeyData,
    members,
    secretKeyPublishDate,
    newEncryptionNotification,
    triedToFetchSecretKey,
  ]);

  const notifyAdmin = useCallback(
    async (admin) => {
      try {
        setIsLoadingNotifyAdmin(true);
        await new Promise((res, rej) => {
          window
            .sendMessage('notifyAdminRegenerateSecretKey', {
              adminAddress: admin.address,
              groupName: selectedGroup?.groupName,
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
        setInfoSnack({
          type: 'success',
          message: 'Successfully sent notification.',
        });
        setOpenSnack(true);
      } catch (error) {
        setInfoSnack({
          type: 'error',
          message: 'Unable to send notification',
        });
      } finally {
        setIsLoadingNotifyAdmin(false);
      }
    },
    [selectedGroup?.groupName, t]
  );

  const isUnread = useMemo(() => {
    if (!selectedGroup) return false;
    return (
      groupAnnouncements?.[selectedGroup?.groupId]?.seentimestamp === false
    );
  }, [groupAnnouncements, selectedGroup]);

  const openDirectChatFromNotification = useCallback(
    (e) => {
      if (isLoadingOpenSectionFromNotification.current) return;
      isLoadingOpenSectionFromNotification.current = true;
      const directAddress = e.detail?.from;

      const findDirect = displayDirects?.find(
        (direct) => direct?.address === directAddress
      );
      if (findDirect?.address === selectedDirect?.address) {
        openQChatTab();
        isLoadingOpenSectionFromNotification.current = false;
        return;
      }
      if (findDirect) {
        setDesktopSideView('directs');
        openQChatTab();
        setSelectedDirect(null);

        setNewChat(false);

        window
          .sendMessage('addTimestampEnterChat', {
            timestamp: Date.now(),
            groupId: findDirect.address,
          })
          .catch((error) => {
            console.error(
              'Failed to add timestamp:',
              error.message || 'An error occurred'
            );
          });

        setTimeout(() => {
          setSelectedDirect(findDirect);
          getTimestampEnterChat();
          isLoadingOpenSectionFromNotification.current = false;
        }, 200);
      } else {
        isLoadingOpenSectionFromNotification.current = false;
      }
    },
    [displayDirects, selectedDirect?.address, getTimestampEnterChat]
  );

  const openDirectChatFromInternal = useCallback(
    (e) => {
      const directAddress = e.detail?.address;
      const name = e.detail?.name;
      const findDirect = displayDirects?.find(
        (direct) => direct?.address === directAddress || direct?.name === name
      );

      if (findDirect) {
        openQChatTab();
        setDesktopSideView('directs');
        setSelectedDirect(null);

        setNewChat(false);

        window
          .sendMessage('addTimestampEnterChat', {
            timestamp: Date.now(),
            groupId: findDirect.address,
          })
          .catch((error) => {
            console.error(
              'Failed to add timestamp:',
              error.message || 'An error occurred'
            );
          });

        setTimeout(() => {
          setSelectedDirect(findDirect);
          getTimestampEnterChat();
        }, 200);
      } else {
        openQChatTab();
        setDesktopSideView('directs');
        setNewChat(true);
        setTimeout(() => {
          executeEvent('setDirectToValueNewChat', {
            directToValue: name || directAddress,
          });
        }, 500);
      }
    },
    [displayDirects, getTimestampEnterChat]
  );

  useEffect(() => {
    subscribeToEvent('openDirectMessageInternal', openDirectChatFromInternal);

    return () => {
      unsubscribeFromEvent(
        'openDirectMessageInternal',
        openDirectChatFromInternal
      );
    };
  }, [displayDirects, selectedDirect, openDirectChatFromInternal]);

  useEffect(() => {
    subscribeToEvent('openDirectMessage', openDirectChatFromNotification);

    return () => {
      unsubscribeFromEvent('openDirectMessage', openDirectChatFromNotification);
    };
  }, [
    displayDirects,
    selectedDirect,
    openDirectChatFromNotification,
    openDirectChatFromInternal,
  ]);

  const markReticulumGroupsRead = useCallback(
    async (groupIds: Array<string | number>) => {
      if (
        !reticulumChatEnabled ||
        !myAddress ||
        typeof window.reticulumChat?.markGroupsRead !== 'function'
      ) {
        return;
      }

      const requestedGroupIds = [
        ...new Set(
          groupIds
            .map((groupId) => Number(groupId))
            .filter((groupId) => Number.isInteger(groupId) && groupId > 0)
        ),
      ];
      if (!requestedGroupIds.length) return;

      try {
        const result = await window.reticulumChat.markGroupsRead(
          requestedGroupIds,
          myAddress
        );
        if (result?.success !== true) {
          throw new Error(result?.error || 'Reticulum chat is unavailable');
        }
        executeEvent('reticulum-chat-summaries-refresh', {});
      } catch (error) {
        console.error(
          '[ReticulumChat] Failed to mark group chat as read:',
          error
        );
      }
    },
    [myAddress, reticulumChatEnabled]
  );

  const handleMarkAsRead = useCallback(
    (e) => {
      const { groupId } = e.detail;
      void markReticulumGroupsRead([groupId]);
      window
        .sendMessage('addTimestampEnterChat', {
          timestamp: Date.now(),
          groupId,
        })
        .catch((error) => {
          console.error(
            'Failed to add timestamp:',
            error.message || 'An error occurred'
          );
        });

      window
        .sendMessage('addGroupNotificationTimestamp', {
          timestamp: Date.now(),
          groupId,
        })
        .catch((error) => {
          console.error(
            'Failed to add group notification timestamp:',
            error.message || 'An error occurred'
          );
        });

      setTimeout(() => {
        getGroupAnnouncements();
        getTimestampEnterChat();
      }, 200);
    },
    [getGroupAnnouncements, getTimestampEnterChat, markReticulumGroupsRead]
  );

  const handleMarkAllMemberGroupsRead = useCallback(() => {
    const ids = (memberGroupsRef.current || [])
      .map((g) => g?.groupId)
      .filter((id) => id != null && id !== '');
    if (!ids.length) return;

    void markReticulumGroupsRead(ids);

    window
      .sendMessage('markAllMemberGroupsRead', { groupIds: ids })
      .then((response) => {
        if (response?.error) {
          console.error('Failed to mark all groups read:', response.error);
        }
      })
      .catch((error) => {
        console.error(
          'Failed to mark all groups read:',
          error.message || 'An error occurred'
        );
      });

    setTimeout(() => {
      getGroupAnnouncements();
      getTimestampEnterChat();
    }, 200);
  }, [getGroupAnnouncements, getTimestampEnterChat, markReticulumGroupsRead]);

  useEffect(() => {
    subscribeToEvent('markAsRead', handleMarkAsRead);

    return () => {
      unsubscribeFromEvent('markAsRead', handleMarkAsRead);
    };
  }, [handleMarkAsRead]);

  useEffect(() => {
    subscribeToEvent('markAllMemberGroupsRead', handleMarkAllMemberGroupsRead);

    return () => {
      unsubscribeFromEvent(
        'markAllMemberGroupsRead',
        handleMarkAllMemberGroupsRead
      );
    };
  }, [handleMarkAllMemberGroupsRead]);

  const resetAllStatesAndRefs = useCallback(() => {
    // Reset all useState values to their initial states
    setSecretKey(null);
    secretKeyRef.current = null;
    lastFetchedSecretKey.current = null;
    reticulumBackgroundProcessedEventIdsRef.current.clear();
    setSecretKeyPublishDate(null);
    setSecretKeyDetails(null);
    setNewEncryptionNotification(null);
    setMemberCountFromSecretKeyData(null);
    setIsForceShowCreationKeyPopup(false);
    setSelectedGroup(null);
    setSelectedDirect(null);
    setMemberGroups([]);
    setMemberGroupsLoadedAddress('');
    memberGroupsRef.current = [];
    setDirects([]);
    setAdmins([]);
    setAdminsWithNames([]);
    setMembers([]);
    setGroupOwner(null);
    setTriedToFetchSecretKey(false);
    setHideCommonKeyPopup(false);
    setOpenAddGroup(false);
    setOpenManageMembers(false);
    setTimestampEnterData({});
    setChatMode('groups');
    setNewChat(false);
    setOpenSnack(false);
    setInfoSnack(null);
    setIsLoadingNotifyAdmin(false);
    setIsLoadingGroups(false);
    setIsLoadingGroup(false);
    setIsLoadingThreadKey(false);
    setFirstSecretKeyInCreation(false);
    setMountedLandGroupId(null);
    setNotificationReticulumChannelId('');
    setNotificationReticulumMessageId('');
    setGroupSection('home');
    setGroupAnnouncements({});
    setDefaultThread(null);
    setMobileViewMode('home');
    setIsQChatTabActive(false);
    // Reset all useRef values to their initial states
    hasInitializedWebsocket.current = false;
    myAddressRef.current = '';
    selectedGroupRef.current = null;
    selectedDirectRef.current = null;
    groupSectionRef.current = null;
    qChatTabActiveRef.current = false;
    isLoadingOpenSectionFromNotification.current = false;
    settimeoutForRefetchSecretKey.current = null;
    threadKeyLoadRef.current = null;
    initiatedGetMembers.current = false;
    setDesktopViewMode('home');
  }, []);

  const logoutEventFunc = useCallback(() => {
    resetAllStatesAndRefs();
    clearStatesMessageQueueProvider();
  }, [resetAllStatesAndRefs, clearStatesMessageQueueProvider]);

  useEffect(() => {
    subscribeToEvent('logout-event', logoutEventFunc);

    return () => {
      unsubscribeFromEvent('logout-event', logoutEventFunc);
    };
  }, [logoutEventFunc]);

  const openAppsMode = useCallback(() => {
    setDesktopViewMode('apps');
  }, []);

  useEffect(() => {
    subscribeToEvent('open-apps-mode', openAppsMode);

    return () => {
      unsubscribeFromEvent('open-apps-mode', openAppsMode);
    };
  }, [openAppsMode]);

  const openHomeMode = useCallback(() => {
    setDesktopViewMode('home');
  }, []);

  useEffect(() => {
    subscribeToEvent('open-home-mode', openHomeMode);

    return () => {
      unsubscribeFromEvent('open-home-mode', openHomeMode);
    };
  }, [openHomeMode]);

  const returnFromAppsMode = useCallback(() => {
    setDesktopViewMode(lastNonQappDesktopViewModeRef.current || 'home');
  }, [setDesktopViewMode]);

  useEffect(() => {
    subscribeToEvent('return-from-apps-mode', returnFromAppsMode);

    return () => {
      unsubscribeFromEvent('return-from-apps-mode', returnFromAppsMode);
    };
  }, [returnFromAppsMode]);

  const openGroupDiscovery = useCallback(
    (event?: CustomEvent<{ modalOnly?: boolean }>) => {
      setOnboardingQChatPreviewOpen(false);
      if (!event?.detail?.modalOnly) {
        setChatMode('groups');
        setDesktopSideView('groups');
        setSelectedGroup(null);
        setSelectedDirect(null);
        setNewChat(false);
        openQChatTab();
      }
      setOpenAddGroup(false);
      setOpenFindGroup(true);
    },
    []
  );

  const hasConfirmedNoReticulumGroups =
    reticulumChatEnabled &&
    memberGroupsLoadedAddress === myAddress &&
    getGroupIdsFromGroupLikeList(memberGroupsForReticulum).length === 0;
  const hasConfirmedReticulumGroups =
    reticulumChatEnabled &&
    memberGroupsLoadedAddress === myAddress &&
    getGroupIdsFromGroupLikeList(memberGroupsForReticulum).length > 0;
  const qortalProjectMember =
    memberGroupsLoadedAddress === myAddress
      ? memberGroupsForReticulum.some(
          (group) => Number(group?.groupId) === QORTAL_PROJECT_GROUP_ID
        )
      : null;
  const reticulumActivityDashboardReady =
    hasConfirmedReticulumGroups &&
    reticulumMembershipsAppliedKey === reticulumMembershipsKey &&
    reticulumSummariesLoadedMembershipKey === reticulumMembershipsKey;
  useEffect(() => {
    if (
      !isQChatTabActive ||
      !hasConfirmedReticulumGroups ||
      reticulumChatReadinessState !== 'ready' ||
      reticulumActivityDashboardReady ||
      selectedGroup ||
      selectedDirect ||
      newChat
    ) {
      return undefined;
    }
    const timeout = window.setTimeout(() => {
      console.error(
        '[ReticulumChat] Activity dashboard is still not ready after 10 seconds',
        {
          adminMetadataReady: reticulumAdminGroupsLoadedAddress === myAddress,
          bridgeAvailable: Boolean(window.reticulumChat),
          groupCount: getGroupIdsFromGroupLikeList(memberGroupsForReticulum)
            .length,
          membershipsApplied:
            reticulumMembershipsAppliedKey === reticulumMembershipsKey,
          summariesLoaded:
            reticulumSummariesLoadedMembershipKey === reticulumMembershipsKey,
        }
      );
    }, 10_000);
    return () => window.clearTimeout(timeout);
  }, [
    hasConfirmedReticulumGroups,
    isQChatTabActive,
    memberGroupsForReticulum,
    myAddress,
    newChat,
    reticulumActivityDashboardReady,
    reticulumAdminGroupsLoadedAddress,
    reticulumChatReadinessState,
    reticulumMembershipsAppliedKey,
    reticulumMembershipsKey,
    reticulumSummariesLoadedMembershipKey,
    selectedDirect,
    selectedGroup,
  ]);
  const reticulumHasUnreadActivity = memberGroupsWithReticulumActivity.some(
    (group: any) => {
      const summary = group?.reticulumChatSummary;
      return (
        Number(summary?.unreadCount || 0) > 0 ||
        Number(summary?.mentionCount || 0) > 0 ||
        summary?.hasUnreadMention === true
      );
    }
  );
  const reticulumWelcomeDisplayName =
    typeof userInfo?.name === 'string' &&
    userInfo.name.trim() &&
    userInfo.name.trim() !== myAddress
      ? userInfo.name.trim()
      : undefined;

  useEffect(() => {
    if (!reticulumChatEnabled) return undefined;
    return startReticulumGroupScoreScheduler();
  }, [reticulumChatEnabled]);

  useEffect(() => {
    subscribeToEvent('open-group-discovery', openGroupDiscovery);

    return () => {
      unsubscribeFromEvent('open-group-discovery', openGroupDiscovery);
    };
  }, [openGroupDiscovery]);

  const openDevMode = useCallback(() => {
    setDesktopViewMode('dev');
  }, []);

  useEffect(() => {
    subscribeToEvent('open-dev-mode', openDevMode);

    return () => {
      unsubscribeFromEvent('open-dev-mode', openDevMode);
    };
  }, [openDevMode]);

  const openGroupChatFromNotification = useCallback(
    (e) => {
      if (isLoadingOpenSectionFromNotification.current) return;

      const groupId = e.detail?.from;
      const channelId =
        typeof e.detail?.channelId === 'string' ? e.detail.channelId : '';
      const eventId =
        typeof e.detail?.eventId === 'string' ? e.detail.eventId : '';
      const openCalendar = e.detail?.openCalendar === true;
      if (openCalendar) {
        setReticulumCalendarTarget({
          groupId: Number(groupId),
          eventId,
          occurrenceStart: Number(e.detail?.occurrenceStart || Date.now()),
          timezone: String(e.detail?.timezone || ''),
        });
        setReticulumCalendarOpenRequest((value) => value + 1);
      } else {
        if (channelId) {
          setNotificationReticulumChannelId(channelId);
        }
        setNotificationReticulumMessageId(eventId);
      }
      const findGroup = memberGroupsRef.current?.find(
        (group: any) => +group?.groupId === +groupId
      );
      if (findGroup?.groupId === selectedGroup?.groupId) {
        isLoadingOpenSectionFromNotification.current = false;
        setChatMode('groups');
        setGroupSection('chat');
        bumpReticulumReadEntryToken();
        openQChatTab();
        return;
      }
      if (findGroup) {
        setChatMode('groups');
        setSelectedGroup(null);
        setSelectedDirect(null);

        setNewChat(false);
        setSecretKey(null);
        secretKeyRef.current = null;
        setGroupOwner(null);
        lastFetchedSecretKey.current = null;
        initiatedGetMembers.current = false;
        setSecretKeyPublishDate(null);
        setAdmins([]);
        setSecretKeyDetails(null);
        setAdminsWithNames([]);
        setMembers([]);
        setMemberCountFromSecretKeyData(null);
        setIsForceShowCreationKeyPopup(false);
        setTriedToFetchSecretKey(false);
        setFirstSecretKeyInCreation(false);
        setGroupSection('chat');
        bumpReticulumReadEntryToken();
        openQChatTab();

        window
          .sendMessage('addTimestampEnterChat', {
            timestamp: Date.now(),
            groupId: findGroup.groupId,
          })
          .catch((error) => {
            console.error(
              'Failed to add timestamp:',
              error.message || 'An error occurred'
            );
          });

        setTimeout(() => {
          setSelectedGroup(findGroup);
          setMobileViewMode('group');
          setDesktopSideView('groups');
          getTimestampEnterChat();
          isLoadingOpenSectionFromNotification.current = false;
        }, 350);
      } else {
        isLoadingOpenSectionFromNotification.current = false;
      }
    },
    [bumpReticulumReadEntryToken, selectedGroup?.groupId, getTimestampEnterChat]
  );

  useEffect(() => {
    subscribeToEvent('openGroupMessage', openGroupChatFromNotification);

    return () => {
      unsubscribeFromEvent('openGroupMessage', openGroupChatFromNotification);
    };
  }, [openGroupChatFromNotification]);

  const openGroupAnnouncementFromNotification = useCallback(
    (e) => {
      const groupId = e.detail?.from;

      const findGroup = memberGroupsRef.current?.find(
        (group: any) => +group?.groupId === +groupId
      );
      if (findGroup?.groupId === selectedGroup?.groupId) {
        setGroupSection('announcement');
        openQChatTab();
        return;
      }
      if (findGroup) {
        setChatMode('groups');
        setSelectedGroup(null);
        setSecretKey(null);
        secretKeyRef.current = null;
        setGroupOwner(null);
        lastFetchedSecretKey.current = null;
        initiatedGetMembers.current = false;
        setSecretKeyPublishDate(null);
        setAdmins([]);
        setSecretKeyDetails(null);
        setAdminsWithNames([]);
        setMembers([]);
        setMemberCountFromSecretKeyData(null);
        setIsForceShowCreationKeyPopup(false);
        setTriedToFetchSecretKey(false);
        setFirstSecretKeyInCreation(false);
        setGroupSection('announcement');
        openQChatTab();
        window
          .sendMessage('addGroupNotificationTimestamp', {
            timestamp: Date.now(),
            groupId: findGroup.groupId,
          })
          .catch((error) => {
            console.error(
              'Failed to add group notification timestamp:',
              error.message || 'An error occurred'
            );
          });

        setTimeout(() => {
          setSelectedGroup(findGroup);
          setMobileViewMode('group');
          setDesktopSideView('groups');
          getGroupAnnouncements();
        }, 350);
      }
    },
    [selectedGroup?.groupId, getGroupAnnouncements]
  );

  useEffect(() => {
    subscribeToEvent(
      'openGroupAnnouncement',
      openGroupAnnouncementFromNotification
    );

    return () => {
      unsubscribeFromEvent(
        'openGroupAnnouncement',
        openGroupAnnouncementFromNotification
      );
    };
  }, [openGroupAnnouncementFromNotification]);

  const openThreadNewPostFunc = useCallback(
    (e) => {
      const data = e.detail?.data;
      const { groupId } = data;
      const findGroup = memberGroupsRef.current?.find(
        (group: any) => +group?.groupId === +groupId
      );
      if (findGroup?.groupId === selectedGroup?.groupId) {
        setGroupSection('forum');
        setDefaultThread(data);
        openQChatTab();

        return;
      }
      if (findGroup) {
        setChatMode('groups');
        setSelectedGroup(null);
        setSecretKey(null);
        secretKeyRef.current = null;
        setGroupOwner(null);
        lastFetchedSecretKey.current = null;
        initiatedGetMembers.current = false;
        setSecretKeyPublishDate(null);
        setAdmins([]);
        setSecretKeyDetails(null);
        setAdminsWithNames([]);
        setMembers([]);
        setMemberCountFromSecretKeyData(null);
        setIsForceShowCreationKeyPopup(false);
        setTriedToFetchSecretKey(false);
        setFirstSecretKeyInCreation(false);
        setGroupSection('forum');
        setDefaultThread(data);
        openQChatTab();
        setTimeout(() => {
          setSelectedGroup(findGroup);
          setMobileViewMode('group');
          setDesktopSideView('groups');
          getGroupAnnouncements();
        }, 350);
      }
    },
    [selectedGroup?.groupId, getGroupAnnouncements]
  );

  useEffect(() => {
    subscribeToEvent('openThreadNewPost', openThreadNewPostFunc);

    return () => {
      unsubscribeFromEvent('openThreadNewPost', openThreadNewPostFunc);
    };
  }, [openThreadNewPostFunc]);

  const handleSecretKeyCreationInProgress = useCallback(() => {
    setFirstSecretKeyInCreation(true);
  }, []);

  const getUserAvatarUrl = useCallback((name?: string) => {
    return name
      ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${name}/qortal_avatar?async=true`
      : '';
  }, []);

  const openAvatarPreview = useCallback(
    (src: string | null, alt?: string) => {
      if (!src) return;
      setAvatarPreviewData({
        src,
        alt: alt || '',
      });
    },
    [setAvatarPreviewData]
  );

  const closeAvatarPreview = useCallback(() => {
    setAvatarPreviewData(null);
  }, [setAvatarPreviewData]);

  const goToHome = useCallback(async () => {
    setDesktopViewMode('home');

    await new Promise((res) => {
      setTimeout(() => {
        res(null);
      }, 200);
    });
  }, []);

  const goToAnnouncements = useCallback(() => {
    setSelectedDirect(null);
    setNewChat(false);
    setGroupSection('announcement');
    window
      .sendMessage('addGroupNotificationTimestamp', {
        timestamp: Date.now(),
        groupId: selectedGroupRef.current.groupId,
      })
      .catch((error) => {
        console.error(
          'Failed to add group notification timestamp:',
          error.message || 'An error occurred'
        );
      });

    setTimeout(() => {
      getGroupAnnouncements();
    }, 200);
  }, [getGroupAnnouncements]);

  const openDrawerGroups = useCallback(() => {
    setIsOpenDrawer(true);
  }, []);

  const goToThreads = useCallback(() => {
    setSelectedDirect(null);
    setNewChat(false);
    if (reticulumChatEnabled && groupSection === 'forum') {
      setGroupSection('chat');
      bumpReticulumReadEntryToken();
      return;
    }
    setGroupSection('forum');
  }, [bumpReticulumReadEntryToken, groupSection, reticulumChatEnabled]);

  const goToQortalLand = useCallback(() => {
    const groupId = selectedGroupRef.current?.groupId;
    if (groupId !== undefined && groupId !== null) {
      setMountedLandGroupId(String(groupId));
    }
    setSelectedDirect(null);
    setNewChat(false);
    setGroupSection('land');
  }, []);

  const goToChat = useCallback(() => {
    setGroupSection('chat');
    bumpReticulumReadEntryToken();
    setNewChat(false);
    setSelectedDirect(null);
    if (selectedGroupRef.current) {
      window
        .sendMessage('addTimestampEnterChat', {
          timestamp: Date.now(),
          groupId: selectedGroupRef.current.groupId,
        })
        .catch((error) => {
          console.error(
            'Failed to add timestamp:',
            error.message || 'An error occurred'
          );
        });

      setTimeout(() => {
        getTimestampEnterChat();
      }, 200);
    }
  }, [bumpReticulumReadEntryToken, getTimestampEnterChat]);

  const closeOnboardingGroupDiscovery = useCallback(() => {
    setOpenFindGroup(false);
  }, []);

  const navigateOnboardingHome = useCallback(() => {
    setOnboardingQChatPreviewOpen(false);
    void goToHome();
  }, [goToHome]);

  const navigateOnboardingQChat = useCallback(() => {
    openQChatTab();
  }, []);

  const showOnboardingQortalProject = useCallback(async () => {
    const startedAt = Date.now();
    while (
      memberGroupsLoadedAddressRef.current !== myAddressRef.current &&
      Date.now() - startedAt < 10_000
    ) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 80));
    }

    const qortalProjectGroup = (memberGroupsRef.current || []).find(
      (group) => Number(group?.groupId) === QORTAL_PROJECT_GROUP_ID
    );

    setOpenFindGroup(false);
    setDesktopSideView('groups');
    setSelectedDirect(null);
    setNewChat(false);
    setGroupSection('chat');

    if (
      memberGroupsLoadedAddressRef.current === myAddressRef.current &&
      qortalProjectGroup
    ) {
      setOnboardingQChatPreviewOpen(false);
      setSelectedGroup(qortalProjectGroup);
      return 'member' as const;
    }

    setSelectedGroup(null);
    setOnboardingQChatPreviewOpen(true);
    return 'preview' as const;
  }, []);

  const closeOnboardingQChatPreview = useCallback(() => {
    setOnboardingQChatPreviewOpen(false);
  }, []);

  const showOnboardingDirectMessages = useCallback(() => {
    setOnboardingQChatPreviewOpen(false);
    setDesktopSideView('directs');
    setSelectedGroup(null);
    setNewChat(false);
    setSelectedDirect((current) => current ?? displayDirects[0] ?? null);
    setGroupSection('chat');
  }, [displayDirects]);

  useEffect(() => {
    if (
      reticulumChatEnabled &&
      (groupSection === 'announcement' || groupSection === 'adminSpace')
    ) {
      setGroupSection('chat');
    }
  }, [groupSection, reticulumChatEnabled]);

  const reticulumMembersPanelOpen =
    groupSection === 'land'
      ? reticulumLandMembersPanelOpen
      : reticulumChatMembersPanelOpen;
  const toggleReticulumMembersPanel = useCallback(() => {
    if (groupSection === 'land') {
      setReticulumLandMembersPanelOpen((open) => !open);
      return;
    }
    setReticulumChatMembersPanelOpen((open) => !open);
  }, [groupSection]);

  const handleReticulumChannelSelected = useCallback(
    (channelId: string) => {
      const normalizedChannelId = channelId || 'general';
      setActiveReticulumChannelId((previousChannelId) => {
        const previous = previousChannelId || 'general';
        if (previous !== normalizedChannelId) {
          bumpReticulumReadEntryToken();
        }
        return normalizedChannelId;
      });
      if (
        notificationReticulumChannelId &&
        notificationReticulumChannelId === normalizedChannelId
      ) {
        setNotificationReticulumChannelId('');
        setNotificationReticulumMessageId('');
      }
    },
    [bumpReticulumReadEntryToken, notificationReticulumChannelId]
  );
  const handleReticulumNotificationHandled = useCallback(() => {
    setNotificationReticulumChannelId('');
    setNotificationReticulumMessageId('');
  }, []);

  useEffect(() => {
    if (!reticulumChatEnabled) return;
    const closeMembersPanel = () => {
      if (groupSection === 'land') {
        setReticulumLandMembersPanelOpen(false);
      }
    };
    subscribeToEvent('closeReticulumMembersPanel', closeMembersPanel);
    return () =>
      unsubscribeFromEvent('closeReticulumMembersPanel', closeMembersPanel);
  }, [groupSection, reticulumChatEnabled]);

  useEffect(() => {
    const syncSearchOverlayState = (event: any) => {
      setReticulumSearchOverlayOpen(
        Boolean(event?.detail?.open ?? event?.open)
      );
    };
    subscribeToEvent('reticulumSearchOverlayOpenState', syncSearchOverlayState);
    return () =>
      unsubscribeFromEvent(
        'reticulumSearchOverlayOpenState',
        syncSearchOverlayState
      );
  }, []);

  const loadingGroupSnackbarInfo = useMemo(
    () => ({
      message:
        isLoadingGroupMessage ||
        t('group:message.generic.setting_group', {
          postProcess: 'capitalizeFirstChar',
        }),
    }),
    [isLoadingGroupMessage, t]
  );

  const loadingGroupsSnackbarInfo = useMemo(
    () => ({
      message: t('group:message.generic.setting_group', {
        postProcess: 'capitalizeFirstChar',
      }),
    }),
    [t]
  );

  const notPartOfKeys = useMemo(() => {
    return (
      isPrivate &&
      !admins.includes(myAddress) &&
      !secretKey &&
      triedToFetchSecretKey
    );
  }, [isPrivate, admins, myAddress, secretKey, triedToFetchSecretKey]);
  const activeSectionUsesSecretKey = groupSectionUsesSecretKey(
    reticulumChatEnabled,
    groupSection
  );

  const closeChatDirect = useCallback(() => {
    setSelectedDirect(null);
    setNewChat(false);
  }, []);
  const getNoReticulumGroupSecretKey = useCallback(async () => null, []);

  const isReticulumDirectOverlayOpen =
    reticulumChatEnabled && desktopSideView === 'directs';

  const setDesktopSideViewFromRail = useCallback(
    (view: 'groups' | 'directs') => {
      if (reticulumChatEnabled && view === 'directs') {
        setDesktopSideView((currentView) =>
          currentView === 'directs' ? 'groups' : 'directs'
        );
        return;
      }
      setDesktopSideView(view);
    },
    [reticulumChatEnabled]
  );

  const handleNotifyAdminClick = useCallback(
    (e: { currentTarget: HTMLElement | null }) => {
      const address = e.currentTarget?.getAttribute('data-admin-address');
      const admin = adminsWithNames.find((a) => a?.address === address);
      if (admin) notifyAdmin(admin);
    },
    [adminsWithNames, notifyAdmin]
  );

  const selectGroupFunc = useCallback(
    (group) => {
      setMobileViewMode('group');
      setDesktopSideView('groups');
      initiatedGetMembers.current = false;
      clearAllQueues();
      setSelectedDirect(null);
      setTriedToFetchSecretKey(false);
      setNewChat(false);
      setSelectedGroup(group);
      setUserInfoForLevels({});
      setSecretKey(null);
      secretKeyRef.current = null;
      threadKeyLoadRef.current = null;
      setIsLoadingThreadKey(false);
      lastFetchedSecretKey.current = null;
      setSecretKeyPublishDate(null);
      setAdmins([]);
      setSecretKeyDetails(null);
      setAdminsWithNames([]);
      setGroupOwner(null);
      setMembers([]);
      setMemberCountFromSecretKeyData(null);
      setHideCommonKeyPopup(false);
      setFirstSecretKeyInCreation(false);
      setGroupSection('chat');
      bumpReticulumReadEntryToken();
      setIsOpenDrawer(false);
      setIsForceShowCreationKeyPopup(false);
    },
    [bumpReticulumReadEntryToken]
  );

  const openTopGroupQortalLand = useCallback(() => {
    if (!reticulumEnabled) {
      executeEvent('openGlobalSnackBar', {
        message: 'Enable Reticulum to enter QortalLand.',
        type: 'info',
        duration: 4800,
      });
      return;
    }

    const availableGroups =
      memberGroupsWithReticulumActivity.length > 0
        ? memberGroupsWithReticulumActivity
        : memberGroupsForReticulum;
    const [topGroup] = orderReticulumGroups(
      availableGroups,
      readReticulumGroupOrder()
    );

    if (!topGroup?.groupId) {
      executeEvent('openGlobalSnackBar', {
        message: 'Join a Q-Chat group to enter QortalLand.',
        type: 'info',
        duration: 4800,
      });
      return;
    }

    // Begin downloading the game bundle while Q-Chat resolves the selected
    // group's membership/key state instead of waiting for that work to finish.
    void loadQortalLandModule();
    selectGroupFunc(topGroup);
    setMountedLandGroupId(String(topGroup.groupId));
    setGroupSection('land');
    openQChatTab();
  }, [
    memberGroupsForReticulum,
    memberGroupsWithReticulumActivity,
    reticulumEnabled,
    selectGroupFunc,
  ]);

  const selectedGroupIdKey = selectedGroup?.groupId
    ? String(selectedGroup.groupId)
    : '';
  const canManageReticulumGroup = Boolean(
    reticulumAdminGroupIds.has(Number(selectedGroup?.groupId)) ||
    admins.includes(myAddress) ||
    groupOwner?.owner === myAddress
  );
  useEffect(() => {
    if (
      !reticulumChatEnabled ||
      isPrivate !== true ||
      !canManageReticulumGroup ||
      !selectedGroupIdKey
    ) {
      setReticulumJoinRequestCount(0);
      return;
    }

    let cancelled = false;
    const refreshJoinRequestCount = async () => {
      try {
        const response = await fetch(
          `${getBaseApiReact()}/groups/joinrequests/${selectedGroupIdKey}?limit=0`
        );
        if (!response.ok) {
          throw new Error(`Unable to load join requests (${response.status})`);
        }
        const requests = await response.json();
        if (!cancelled) {
          setReticulumJoinRequestCount(
            Array.isArray(requests) ? requests.length : 0
          );
        }
      } catch (error) {
        console.error(
          '[ReticulumChat] Failed to refresh selected-group join requests:',
          error
        );
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshJoinRequestCount();
      }
    };

    void refreshJoinRequestCount();
    const refreshTimer = window.setInterval(refreshJoinRequestCount, 30_000);
    window.addEventListener('focus', refreshJoinRequestCount);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
      window.removeEventListener('focus', refreshJoinRequestCount);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [
    canManageReticulumGroup,
    isPrivate,
    reticulumChatEnabled,
    selectedGroupIdKey,
  ]);
  const handleReticulumJoinRequestCountChange = useCallback((count: number) => {
    setReticulumJoinRequestCount(Math.max(0, Number(count) || 0));
  }, []);
  const canMountQortalLand = Boolean(
    reticulumEnabled &&
    selectedGroup &&
    (reticulumChatEnabled ||
      (triedToFetchSecretKey &&
        !notPartOfKeys &&
        !(admins.includes(myAddress) && !secretKey && isPrivate)))
  );
  const shouldMountGroupSection = useCallback(
    (section: string) => {
      if (section === 'land') {
        if (!reticulumEnabled) return false;
        return (
          groupSection === section || mountedLandGroupId === selectedGroupIdKey
        );
      }
      return groupSection === section;
    },
    [groupSection, mountedLandGroupId, reticulumEnabled, selectedGroupIdKey]
  );

  useEffect(() => {
    if (!reticulumEnabled && groupSection === 'land') {
      setGroupSection('chat');
    }
  }, [groupSection, reticulumEnabled]);

  const renderQChatTabContent = ({
    hide = false,
    isSelected,
  }: {
    hide?: boolean;
    isSelected: boolean;
  }) => {
    const isVisible = isSelected && !hide;
    const isGroupContentVisible =
      isVisible &&
      !isReticulumDirectOverlayOpen &&
      !(
        !reticulumChatEnabled &&
        desktopSideView === 'directs' &&
        (newChat || selectedDirect)
      );

    return (
      <Box
        sx={{
          backgroundColor: 'background.default',
          display: 'flex',
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
          width: '100%',
        }}
      >
        {reticulumChatEnabled && <ReticulumGroupAboutModal />}
        {reticulumChatEnabled && (
          <Suspense fallback={null}>
            <LazyFindGroupOverviewModal />
          </Suspense>
        )}
        {reticulumChatEnabled || desktopSideView !== 'directs' ? (
          <GroupList
            selectGroupFunc={selectGroupFunc}
            setDesktopSideView={setDesktopSideViewFromRail}
            desktopSideView={desktopSideView}
            directChatHasUnread={directChatHasUnread}
            directChatUnreadCount={reticulumDirectUnreadCount}
            chatMode={chatMode}
            selectedGroup={selectedGroup}
            getUserSettings={getUserSettings}
            setOpenAddGroup={setOpenAddGroup}
            setOpenFindGroup={setOpenFindGroup}
            setIsOpenBlockedUserModal={setIsOpenBlockedUserModal}
            myAddress={myAddress}
            reticulumChatEnabled={reticulumChatEnabled}
          />
        ) : null}
        {!reticulumChatEnabled && desktopSideView === 'directs' && (
          <DirectsSidebar
            setDesktopSideView={setDesktopSideViewFromRail}
            desktopSideView={desktopSideView}
            directChatHasUnread={directChatHasUnread}
            directs={displayDirects}
            dmFriendsByAddress={dmFriendsByAddress}
            getUserAvatarUrl={getUserAvatarUrl}
            directAvatarLoaded={directAvatarLoaded}
            setDirectAvatarLoaded={setDirectAvatarLoaded}
            setSelectedDirect={setSelectedDirect}
            setNewChat={setNewChat}
            setIsOpenDrawer={setIsOpenDrawer}
            getTimestampEnterChat={getTimestampEnterChat}
            selectedDirect={selectedDirect}
            timestampEnterData={timestampEnterData}
            timeDifferenceForNotificationChats={
              timeDifferenceForNotificationChats
            }
            myAddress={myAddress}
            openAvatarPreview={openAvatarPreview}
            avatarPreviewData={avatarPreviewData}
            closeAvatarPreview={closeAvatarPreview}
            isRunningPublicNode={isRunningPublicNode}
            setIsOpenBlockedUserModal={setIsOpenBlockedUserModal}
            reticulumChatEnabled={reticulumChatEnabled}
          />
        )}

        <Box
          sx={{
            flex: 1,
            height: '100%',
            minHeight: 0,
            minWidth: 0,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {newChat && !reticulumChatEnabled && (
            <NewChatOverlay isChatMode={isVisible}>
              <ChatDirect
                myAddress={myAddress}
                isNewChat={newChat}
                selectedDirect={undefined}
                setSelectedDirect={setSelectedDirect}
                setNewChat={setNewChat}
                getTimestampEnterChat={getTimestampEnterChat}
                close={closeChatDirect}
                setMobileViewModeKeepOpen={setMobileViewModeKeepOpen}
                reticulumEnabled={reticulumEnabled}
                reticulumChatEnabled={reticulumChatEnabled}
              />
            </NewChatOverlay>
          )}

          {isVisible &&
            !selectedDirect &&
            !newChat &&
            !selectedGroup &&
            !isReticulumDirectOverlayOpen &&
            (reticulumChatEnabled ? (
              hasConfirmedNoReticulumGroups ? (
                <FirstTimeQChatEmptyState
                  onFindCommunities={openGroupDiscovery}
                />
              ) : reticulumActivityDashboardReady ? (
                reticulumHasUnreadActivity ? (
                  <ReturningUserActivityDashboard
                    displayName={reticulumWelcomeDisplayName}
                    groups={memberGroupsWithReticulumActivity}
                    onBrowseCommunities={openGroupDiscovery}
                    onSelectGroup={selectGroupFunc}
                  />
                ) : (
                  <ReturningUserCaughtUpState
                    displayName={reticulumWelcomeDisplayName}
                    onBrowseCommunities={openGroupDiscovery}
                  />
                )
              ) : (
                <CenterBox>
                  <CircularProgress size={28} />
                </CenterBox>
              )
            ) : (
              <CenterBox>
                <NoSelectionTypography>
                  {t('group:message.generic.no_selection', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </NoSelectionTypography>
              </CenterBox>
            ))}

          <SelectedGroupWrapper
            isVisible={
              isVisible &&
              !!selectedGroup &&
              (reticulumChatEnabled ||
                (desktopSideView !== 'directs' && !selectedDirect && !newChat))
            }
          >
            {reticulumChatEnabled && (
              <Box
                aria-hidden={groupSection === 'chat'}
                sx={{
                  left: 0,
                  pointerEvents: groupSection === 'chat' ? 'none' : 'auto',
                  position: 'absolute',
                  right: 0,
                  top: 0,
                  visibility: groupSection === 'chat' ? 'hidden' : 'visible',
                  zIndex: 3,
                }}
              >
                <ReticulumGroupSectionHeader
                  activeSection={groupSection}
                  calendarOpen={reticulumCalendarOpen}
                  canManageReticulumGroup={canManageReticulumGroup}
                  sectionLabel={
                    groupSection === 'land'
                      ? `QortalLand - ${selectedGroup?.groupName || 'Group'}`
                      : groupSection === 'forum'
                        ? 'Threads'
                        : groupSection === 'members'
                          ? 'Members'
                          : selectedGroup?.groupName || 'Group'
                  }
                  onCalendarClick={() => {
                    const groupId = Number(selectedGroup?.groupId);
                    if (!Number.isInteger(groupId) || groupId <= 0) return;
                    setReticulumCalendarTarget({
                      groupId,
                      eventId: '',
                      occurrenceStart: Date.now(),
                      timezone: '',
                    });
                    setReticulumCalendarOpenRequest((value) => value + 1);
                  }}
                  onGroupCallClick={
                    reticulumEnabled && gcallGroupNumericId !== null
                      ? handleGroupCallHeaderClick
                      : undefined
                  }
                  onModeSwitchClick={
                    groupSection === 'land' ? goToChat : undefined
                  }
                  onThreadsClick={goToThreads}
                  groupCallInCall={
                    inThisGroupGcall && gcallRoomState === 'connected'
                  }
                  groupCallJoining={gcallRoomState === 'joining'}
                  groupCallDisabled={inOtherGcall}
                  groupCallTooltip={
                    inOtherGcall
                      ? t('core:group_call_blocked', {
                          postProcess: 'capitalizeFirstChar',
                        })
                      : ''
                  }
                  membersPanelOpen={reticulumMembersPanelOpen}
                  membersNotificationCount={reticulumJoinRequestCount}
                  onMembersClick={toggleReticulumMembersPanel}
                />
              </Box>
            )}
            {!reticulumChatEnabled && (
              <DesktopHeader
                isPrivate={isPrivate}
                selectedGroup={selectedGroup}
                groupSection={groupSection}
                isUnread={isUnread}
                goToAnnouncements={goToAnnouncements}
                goToChat={goToChat}
                goToThreads={goToThreads}
                setOpenManageMembers={setOpenManageMembers}
                directChatHasUnread={directChatHasUnread}
                chatMode={chatMode}
                openDrawerGroups={openDrawerGroups}
                goToHome={goToHome}
                mobileViewMode={mobileViewMode}
                setMobileViewMode={setMobileViewMode}
                setMobileViewModeKeepOpen={setMobileViewModeKeepOpen}
                hasUnreadDirects={directChatHasUnread}
                isHome={groupSection === 'home'}
                isGroups={desktopSideView === 'groups'}
                isDirects={desktopSideView === 'directs'}
                setDesktopSideView={setDesktopSideView}
                hasUnreadAnnouncements={isUnread}
                isAnnouncement={groupSection === 'announcement'}
                isChat={groupSection === 'chat'}
                isQortalLand={groupSection === 'land'}
                setGroupSection={setGroupSection}
                isForum={groupSection === 'forum'}
                onGroupCallClick={
                  reticulumEnabled && gcallGroupNumericId !== null
                    ? handleGroupCallHeaderClick
                    : undefined
                }
                onQortalLandClick={
                  reticulumEnabled ? goToQortalLand : undefined
                }
                groupCallInCall={
                  inThisGroupGcall && gcallRoomState === 'connected'
                }
                groupCallJoining={gcallRoomState === 'joining'}
                groupCallDisabled={inOtherGcall}
                groupCallTooltip={
                  inOtherGcall
                    ? t('core:group_call_blocked', {
                        postProcess: 'capitalizeFirstChar',
                      })
                    : ''
                }
              />
            )}

            <ChatContentBox
              sx={{
                mr: 0,
              }}
            >
              {reticulumChatEnabled && !!selectedGroup && (
                <PersistentSectionLayer active={groupSection === 'chat'}>
                  <ReticulumChatGroup
                    myAddress={myAddress}
                    adminsWithNames={adminsWithNames}
                    isReticulumChannelAdmin={canManageReticulumGroup}
                    reticulumChannelAccessReady={
                      reticulumAdminGroupsLoadedAddress === myAddress &&
                      reticulumMembershipsAppliedKey === reticulumMembershipsKey
                    }
                    selectedGroup={selectedGroup?.groupId}
                    selectedGroupName={
                      selectedGroup?.groupName || selectedGroup?.name || ''
                    }
                    getSecretKey={getNoReticulumGroupSecretKey}
                    secretKey={null}
                    isPrivate={isPrivate}
                    isActive={
                      isVisible &&
                      groupSection === 'chat' &&
                      !isReticulumDirectOverlayOpen
                    }
                    handleNewEncryptionNotification={
                      setNewEncryptionNotification
                    }
                    hide={false}
                    hideView={
                      !(isVisible && selectedGroup) ||
                      (desktopViewMode !== 'apps' && desktopViewMode !== 'dev')
                    }
                    handleSecretKeyCreationInProgress={
                      handleSecretKeyCreationInProgress
                    }
                    triedToFetchSecretKey={true}
                    getTimestampEnterChatParent={getTimestampEnterChat}
                    notificationReticulumChannelId={
                      notificationReticulumChannelId
                    }
                    notificationReticulumMessageId={
                      notificationReticulumMessageId
                    }
                    onGroupCallClick={
                      reticulumEnabled && gcallGroupNumericId !== null
                        ? handleGroupCallHeaderClick
                        : undefined
                    }
                    onQortalLandClick={goToQortalLand}
                    onThreadsClick={goToThreads}
                    onMembersClick={toggleReticulumMembersPanel}
                    membersPanelOpen={reticulumMembersPanelOpen}
                    membersNotificationCount={reticulumJoinRequestCount}
                    groupCallInCall={
                      inThisGroupGcall && gcallRoomState === 'connected'
                    }
                    groupCallJoining={gcallRoomState === 'joining'}
                    groupCallDisabled={inOtherGcall}
                    groupCallTooltip={
                      inOtherGcall
                        ? t('core:group_call_blocked', {
                            postProcess: 'capitalizeFirstChar',
                          })
                        : ''
                    }
                    onReticulumChannelSelected={handleReticulumChannelSelected}
                    onReticulumNotificationHandled={
                      handleReticulumNotificationHandled
                    }
                    reticulumReadEntryToken={reticulumReadEntryToken}
                    reticulumCalendarOpenRequest={reticulumCalendarOpenRequest}
                    reticulumCalendarTarget={reticulumCalendarTarget}
                    onReticulumCalendarOpenChange={setReticulumCalendarOpen}
                    isGroupOwner={groupOwner?.owner === myAddress}
                  />
                </PersistentSectionLayer>
              )}
              {!reticulumChatEnabled && triedToFetchSecretKey && (
                <PersistentSectionLayer
                  active={
                    groupSection === 'chat' && !selectedDirect && !newChat
                  }
                >
                  <ChatGroup
                    myAddress={myAddress}
                    selectedGroup={selectedGroup?.groupId}
                    selectedGroupName={
                      selectedGroup?.groupName || selectedGroup?.name || ''
                    }
                    getSecretKey={getSecretKey}
                    secretKey={secretKey}
                    isPrivate={isPrivate}
                    isActive={
                      isVisible &&
                      groupSection === 'chat' &&
                      !selectedDirect &&
                      !newChat
                    }
                    setSecretKey={setSecretKey}
                    handleNewEncryptionNotification={
                      setNewEncryptionNotification
                    }
                    hide={false}
                    hideView={
                      !(isVisible && selectedGroup) ||
                      (desktopViewMode !== 'apps' && desktopViewMode !== 'dev')
                    }
                    handleSecretKeyCreationInProgress={
                      handleSecretKeyCreationInProgress
                    }
                    triedToFetchSecretKey={triedToFetchSecretKey}
                    getTimestampEnterChatParent={getTimestampEnterChat}
                    notificationReticulumChannelId={
                      notificationReticulumChannelId
                    }
                    onGroupCallClick={
                      reticulumEnabled && gcallGroupNumericId !== null
                        ? handleGroupCallHeaderClick
                        : undefined
                    }
                    onQortalLandClick={
                      reticulumEnabled ? goToQortalLand : undefined
                    }
                    onAnnouncementsClick={goToAnnouncements}
                    onThreadsClick={goToThreads}
                    onMembersClick={() => setGroupSection('members')}
                    onAdminsClick={() => setGroupSection('adminSpace')}
                    groupCallInCall={
                      inThisGroupGcall && gcallRoomState === 'connected'
                    }
                    groupCallJoining={gcallRoomState === 'joining'}
                    groupCallDisabled={inOtherGcall}
                    groupCallTooltip={
                      inOtherGcall
                        ? t('core:group_call_blocked', {
                            postProcess: 'capitalizeFirstChar',
                          })
                        : ''
                    }
                    hasUnreadAnnouncements={isUnread}
                    onReticulumChannelSelected={(channelId) => {
                      const normalizedChannelId = channelId || 'general';
                      setActiveReticulumChannelId((previousChannelId) => {
                        const previous = previousChannelId || 'general';
                        if (previous !== normalizedChannelId) {
                          bumpReticulumReadEntryToken();
                        }
                        return normalizedChannelId;
                      });
                      if (
                        notificationReticulumChannelId &&
                        notificationReticulumChannelId === normalizedChannelId
                      ) {
                        setNotificationReticulumChannelId('');
                      }
                    }}
                    reticulumReadEntryToken={reticulumReadEntryToken}
                  />
                </PersistentSectionLayer>
              )}
              {isPrivate &&
                activeSectionUsesSecretKey &&
                firstSecretKeyInCreation &&
                triedToFetchSecretKey &&
                !secretKeyPublishDate && (
                  <EncryptionKeyMessageDiv>
                    <Typography>
                      {t('group:message.generic.encryption_key', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Typography>
                  </EncryptionKeyMessageDiv>
                )}

              {reticulumChatEnabled &&
                groupSection === 'forum' &&
                isPrivate &&
                isLoadingThreadKey && (
                  <PersistentSectionLayer active topOffset={50}>
                    <CenterBox
                      sx={{
                        backgroundColor: 'background.default',
                        flexDirection: 'column',
                        gap: 1.5,
                      }}
                    >
                      <CircularProgress size={28} />
                      <Typography color="text.secondary" variant="body2">
                        Preparing Threads…
                      </Typography>
                    </CenterBox>
                  </PersistentSectionLayer>
                )}

              {notPartOfKeys && activeSectionUsesSecretKey ? (
                <>
                  {secretKeyPublishDate ||
                  (!secretKeyPublishDate && !firstSecretKeyInCreation) ? (
                    <NotPartGroupDiv>
                      <Paper
                        elevation={0}
                        sx={{
                          maxWidth: 480,
                          p: 3,
                          textAlign: 'center',
                          border: `1px solid ${theme.palette.divider}`,
                          borderRadius: 2,
                          mb: 3,
                        }}
                      >
                        <LockOutlinedIcon
                          sx={{
                            fontSize: 48,
                            color: theme.palette.text.secondary,
                            mb: 2,
                          }}
                        />
                        <Typography
                          variant="subtitle1"
                          sx={{
                            color: theme.palette.text.primary,
                            fontWeight: 500,
                            mb: 1.5,
                          }}
                        >
                          {t('group:message.generic.not_part_group', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{
                            color: theme.palette.warning.main,
                            fontWeight: 600,
                            px: 1,
                          }}
                        >
                          {t('group:message.generic.only_encrypted', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </Typography>
                      </Paper>
                      <Typography
                        variant="body2"
                        sx={{
                          color: theme.palette.text.secondary,
                          mb: 2,
                          textAlign: 'center',
                        }}
                      >
                        {t('group:message.error.notify_admins', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>
                      <NotPartAdminListBox>
                        {adminsWithNames.map((admin) => (
                          <AdminRowBox key={admin?.address}>
                            <Typography
                              variant="body1"
                              sx={{
                                fontWeight: 500,
                                color: theme.palette.text.primary,
                              }}
                            >
                              {admin?.name}
                            </Typography>
                            <LoadingButton
                              data-admin-address={admin?.address}
                              loading={isLoadingNotifyAdmin}
                              loadingPosition="start"
                              size="small"
                              variant="contained"
                              onClick={handleNotifyAdminClick}
                              sx={{
                                textTransform: 'none',
                                fontWeight: 600,
                              }}
                            >
                              {t('core:action.notify', {
                                postProcess: 'capitalizeFirstChar',
                              })}
                            </LoadingButton>
                          </AdminRowBox>
                        ))}
                      </NotPartAdminListBox>
                    </NotPartGroupDiv>
                  ) : null}
                </>
              ) : admins.includes(myAddress) &&
                !secretKey &&
                isPrivate &&
                triedToFetchSecretKey ? null : !triedToFetchSecretKey ? null : reticulumChatEnabled ? (
                <>
                  {groupSection === 'forum' && (
                    <PersistentSectionLayer
                      active={groupSection === 'forum'}
                      topOffset={50}
                    >
                      <GroupForum
                        myAddress={myAddress}
                        selectedGroup={selectedGroup}
                        getSecretKey={getSecretKey}
                        secretKey={secretKey}
                        setSecretKey={setSecretKey}
                        isAdmin={admins.includes(myAddress)}
                        hide={false}
                        defaultThread={defaultThread}
                        setDefaultThread={setDefaultThread}
                        isPrivate={isPrivate}
                      />
                    </PersistentSectionLayer>
                  )}
                </>
              ) : (
                <>
                  <GroupAnnouncements
                    myAddress={myAddress}
                    selectedGroup={selectedGroup?.groupId}
                    getSecretKey={getSecretKey}
                    secretKey={secretKey}
                    setSecretKey={setSecretKey}
                    isAdmin={admins.includes(myAddress)}
                    handleNewEncryptionNotification={
                      setNewEncryptionNotification
                    }
                    hide={groupSection !== 'announcement'}
                    isPrivate={isPrivate}
                  />
                  <GroupForum
                    myAddress={myAddress}
                    selectedGroup={selectedGroup}
                    getSecretKey={getSecretKey}
                    secretKey={secretKey}
                    setSecretKey={setSecretKey}
                    isAdmin={admins.includes(myAddress)}
                    hide={groupSection !== 'forum'}
                    defaultThread={defaultThread}
                    setDefaultThread={setDefaultThread}
                    isPrivate={isPrivate}
                  />
                  {groupSection === 'adminSpace' && (
                    <AdminSpace
                      adminsWithNames={adminsWithNames}
                      hide={groupSection !== 'adminSpace'}
                      isAdmin={admins.includes(myAddress)}
                      isOwner={groupOwner?.owner === myAddress}
                      selectedGroup={selectedGroup?.groupId}
                    />
                  )}
                  {groupSection === 'members' && (
                    <Suspense fallback={null}>
                      <LazyManageMembers
                        inline
                        selectedGroup={selectedGroup}
                        address={myAddress}
                        open
                        setOpen={setOpenManageMembers}
                        isAdmin={admins.includes(myAddress)}
                        isOwner={groupOwner?.owner === myAddress}
                      />
                    </Suspense>
                  )}
                </>
              )}

              {canMountQortalLand && shouldMountGroupSection('land') && (
                <PersistentSectionLayer
                  active={groupSection === 'land'}
                  topOffset={reticulumChatEnabled ? 50 : 0}
                >
                  <Suspense
                    fallback={
                      <CenterBox
                        sx={{
                          backgroundColor: 'background.default',
                          flexDirection: 'column',
                          gap: 1.5,
                        }}
                      >
                        <CircularProgress size={28} />
                        <Typography color="text.secondary" variant="body2">
                          Entering QortalLand…
                        </Typography>
                      </CenterBox>
                    }
                  >
                    <LazyQortalLand
                      key={selectedGroup?.groupId}
                      groupId={Number(selectedGroup?.groupId)}
                      groupName={
                        selectedGroup?.groupName || selectedGroup?.name || ''
                      }
                      myAddress={myAddress}
                      isActive={
                        isGroupContentVisible && groupSection === 'land'
                      }
                    />
                  </Suspense>
                </PersistentSectionLayer>
              )}

              {!canMountQortalLand &&
                groupSection === 'land' &&
                selectedGroup && (
                  <PersistentSectionLayer
                    active
                    topOffset={reticulumChatEnabled ? 50 : 0}
                  >
                    <CenterBox
                      sx={{
                        backgroundColor: 'background.default',
                        flexDirection: 'column',
                        gap: 1.5,
                      }}
                    >
                      <CircularProgress size={28} />
                      <Typography color="text.secondary" variant="body2">
                        Preparing QortalLand…
                      </Typography>
                    </CenterBox>
                  </PersistentSectionLayer>
                )}

              <FloatingButtonContainerBox>
                {activeSectionUsesSecretKey &&
                  ((isPrivate &&
                    admins.includes(myAddress) &&
                    shouldReEncrypt &&
                    triedToFetchSecretKey &&
                    !firstSecretKeyInCreation &&
                    !hideCommonKeyPopup) ||
                    isForceShowCreationKeyPopup) && (
                    <CreateCommonSecret
                      isForceShowCreationKeyPopup={isForceShowCreationKeyPopup}
                      setHideCommonKeyPopup={setHideCommonKeyPopup}
                      groupId={selectedGroup?.groupId}
                      secretKey={secretKey}
                      secretKeyDetails={secretKeyDetails}
                      myAddress={myAddress}
                      isOwner={groupOwner?.owner === myAddress}
                      setIsForceShowCreationKeyPopup={
                        setIsForceShowCreationKeyPopup
                      }
                      noSecretKey={
                        admins.includes(myAddress) &&
                        !secretKey &&
                        triedToFetchSecretKey
                      }
                    />
                  )}
              </FloatingButtonContainerBox>
            </ChatContentBox>

            {reticulumChatEnabled &&
              selectedGroup &&
              reticulumMembersPanelOpen && (
                <Box
                  sx={{
                    borderLeft: `1px solid ${theme.palette.divider}`,
                    bottom: 0,
                    boxShadow:
                      groupSection === 'land'
                        ? '-12px 0 24px rgba(0, 0, 0, 0.22)'
                        : 'none',
                    position: 'absolute',
                    right: 0,
                    top: 50,
                    width: 280,
                    zIndex: reticulumSearchOverlayOpen ? 0 : 8,
                  }}
                >
                  <Suspense fallback={null}>
                    <LazyManageMembers
                      inline
                      reticulumSidebar
                      selectedGroup={selectedGroup}
                      address={myAddress}
                      open
                      setOpen={setOpenManageMembers}
                      isAdmin={admins.includes(myAddress)}
                      isOwner={groupOwner?.owner === myAddress}
                      isPrivate={isPrivate === true}
                      joinRequestCount={reticulumJoinRequestCount}
                      onJoinRequestCountChange={
                        handleReticulumJoinRequestCountChange
                      }
                    />
                  </Suspense>
                </Box>
              )}

            {openManageMembers && !reticulumChatEnabled && (
              <Suspense fallback={null}>
                <LazyManageMembers
                  selectedGroup={selectedGroup}
                  address={myAddress}
                  open={openManageMembers}
                  setOpen={setOpenManageMembers}
                  isAdmin={admins.includes(myAddress)}
                  isOwner={groupOwner?.owner === myAddress}
                />
              </Suspense>
            )}
          </SelectedGroupWrapper>

          <Suspense fallback={null}>
            <LazyBlockedUsersModal />
          </Suspense>

          {isReticulumDirectOverlayOpen && (
            <Box
              sx={{
                backgroundColor: 'background.default',
                bottom: 0,
                boxShadow: '-18px 0 36px rgba(0, 0, 0, 0.26)',
                display: 'flex',
                left: 0,
                minHeight: 0,
                minWidth: 0,
                position: 'absolute',
                right: 0,
                top: 0,
                zIndex: 16,
              }}
            >
              <DirectsSidebar
                setDesktopSideView={setDesktopSideViewFromRail}
                desktopSideView={desktopSideView}
                directChatHasUnread={directChatHasUnread}
                directs={displayDirects}
                dmFriendsByAddress={dmFriendsByAddress}
                getUserAvatarUrl={getUserAvatarUrl}
                directAvatarLoaded={directAvatarLoaded}
                setDirectAvatarLoaded={setDirectAvatarLoaded}
                setSelectedDirect={setSelectedDirect}
                setNewChat={setNewChat}
                setIsOpenDrawer={setIsOpenDrawer}
                getTimestampEnterChat={getTimestampEnterChat}
                selectedDirect={selectedDirect}
                timestampEnterData={timestampEnterData}
                timeDifferenceForNotificationChats={
                  timeDifferenceForNotificationChats
                }
                myAddress={myAddress}
                openAvatarPreview={openAvatarPreview}
                avatarPreviewData={avatarPreviewData}
                closeAvatarPreview={closeAvatarPreview}
                isRunningPublicNode={isRunningPublicNode}
                setIsOpenBlockedUserModal={setIsOpenBlockedUserModal}
                reticulumChatEnabled={reticulumChatEnabled}
              />
              <Box
                sx={{
                  backgroundColor: 'background.default',
                  display: 'flex',
                  flex: 1,
                  minHeight: 0,
                  minWidth: 0,
                  position: 'relative',
                }}
              >
                {newChat ? (
                  <ChatDirect
                    myAddress={myAddress}
                    isNewChat={newChat}
                    selectedDirect={undefined}
                    setSelectedDirect={setSelectedDirect}
                    setNewChat={setNewChat}
                    getTimestampEnterChat={getTimestampEnterChat}
                    close={closeChatDirect}
                    setMobileViewModeKeepOpen={setMobileViewModeKeepOpen}
                    isActive={isVisible && isReticulumDirectOverlayOpen}
                    reticulumEnabled={reticulumEnabled}
                    reticulumChatEnabled={reticulumChatEnabled}
                  />
                ) : selectedDirect ? (
                  <ChatDirect
                    myAddress={myAddress}
                    isNewChat={newChat}
                    selectedDirect={selectedDirect}
                    setSelectedDirect={setSelectedDirect}
                    setNewChat={setNewChat}
                    getTimestampEnterChat={getTimestampEnterChat}
                    close={closeChatDirect}
                    setMobileViewModeKeepOpen={setMobileViewModeKeepOpen}
                    isActive={isVisible && isReticulumDirectOverlayOpen}
                    reticulumEnabled={reticulumEnabled}
                    reticulumChatEnabled={reticulumChatEnabled}
                  />
                ) : (
                  <CenterBox>
                    <NoSelectionTypography>
                      No current private messages.
                    </NoSelectionTypography>
                  </CenterBox>
                )}
              </Box>
            </Box>
          )}

          {selectedDirect &&
            !newChat &&
            desktopSideView === 'directs' &&
            !reticulumChatEnabled && (
              <SelectedDirectOverlay isChatMode={isVisible}>
                <InnerChatBox>
                  <ChatDirect
                    myAddress={myAddress}
                    isNewChat={newChat}
                    selectedDirect={selectedDirect}
                    setSelectedDirect={setSelectedDirect}
                    setNewChat={setNewChat}
                    getTimestampEnterChat={getTimestampEnterChat}
                    close={closeChatDirect}
                    setMobileViewModeKeepOpen={setMobileViewModeKeepOpen}
                    isActive={isVisible && desktopSideView === 'directs'}
                    reticulumEnabled={reticulumEnabled}
                    reticulumChatEnabled={reticulumChatEnabled}
                  />
                </InnerChatBox>
              </SelectedDirectOverlay>
            )}
        </Box>
        {onboardingQChatPreviewOpen && <OnboardingQChatPreview />}
      </Box>
    );
  };

  return (
    <>
      <WebSocketNotifications
        myAddress={userInfo?.address || myAddress}
        userName={userInfo?.name}
      />
      <WebSocketActive
        myAddress={myAddress}
        setIsLoadingGroups={setIsLoadingGroups}
      />

      <CustomizedSnackbars
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />

      <RootBox>
        <MemberGroupsEffects
          getGroupsWhereIAmAMember={getGroupsWhereIAmAMember}
          getGroupsProperties={getGroupsProperties}
          myAddress={myAddress}
          groupsPropertiesRef={groupsPropertiesRef}
          hasInitializedWebsocketRef={hasInitializedWebsocket}
        />
        <DesktopSideBar
          desktopViewMode={desktopViewMode}
          toggleSideViewGroups={toggleSideViewGroups}
          toggleSideViewDirects={toggleSideViewDirects}
          goToHome={goToHome}
          mode={appsMode}
          setMode={setAppsMode}
          setDesktopSideView={setDesktopSideView}
          hasUnreadDirects={directChatHasUnread}
          isApps={desktopViewMode === 'apps'}
          isGroups={isOpenSideViewGroups}
          isDirects={isOpenSideViewDirects}
          setDesktopViewMode={setDesktopViewMode}
          lastQappViewMode={lastQappViewMode}
          setAppsModeDev={setAppsModeDev}
        />

        <MainContentBox>
          {openAddGroup && (
            <Suspense fallback={null}>
              <LazyAddGroup
                address={myAddress}
                open={openAddGroup}
                initialTab={openAddGroupTab}
                setOpen={setOpenAddGroup}
              />
            </Suspense>
          )}

          {openFindGroup && (
            <Suspense fallback={null}>
              <LazyFindGroupModal
                open={openFindGroup}
                onOpenJoinedGroup={selectGroupFunc}
                setOpen={setOpenFindGroup}
              />
            </Suspense>
          )}

          <AppsDesktop
            desktopViewMode={desktopViewMode}
            setDesktopViewMode={setDesktopViewMode}
            devMode={appsModeDev}
            setDevMode={setAppsModeDev}
            mode={appsMode}
            setMode={setAppsMode}
            onInternalTabVisibilityChange={({ isVisible, tab }) => {
              setIsQChatTabActive(
                isVisible && tab?.internal === QCHAT_INTERNAL_TAB_ID
              );
            }}
            renderInternalTab={({ hide, isSelected, tab }) =>
              tab?.internal === QCHAT_INTERNAL_TAB_ID
                ? renderQChatTabContent({ hide, isSelected })
                : null
            }
            show={desktopViewMode === 'apps' || desktopViewMode === 'dev'}
          />

          <HomeDesktop
            refreshHomeDataFunc={refreshHomeDataFunc}
            myAddress={myAddress}
            isLoadingGroups={isLoadingGroups}
            onOpenSettings={onOpenSettings}
            setGroupSection={setGroupSection}
            getTimestampEnterChat={getTimestampEnterChat}
            setOpenManageMembers={setOpenManageMembers}
            setOpenAddGroup={setOpenAddGroup}
            setOpenAddGroupTab={setOpenAddGroupTab}
            setMobileViewMode={setMobileViewMode}
            setDesktopViewMode={setDesktopViewMode}
            desktopViewMode={desktopViewMode}
            onOpenQortalLand={openTopGroupQortalLand}
          />
        </MainContentBox>

        <LoadingSnackbar
          open={isLoadingGroup}
          info={loadingGroupSnackbarInfo}
        />

        <LoadingSnackbar
          open={isLoadingGroups}
          info={loadingGroupsSnackbarInfo}
        />
        <WalletsAppWrapper />

        {!chatWidgetClosed && (
          <GlobalChatWidget
            directs={displayDirects}
            getUserAvatarUrl={getUserAvatarUrl}
            directChatHasUnread={directChatHasUnread}
            timestampEnterData={timestampEnterData}
            timeDifferenceForNotificationChats={
              timeDifferenceForNotificationChats
            }
            myAddress={myAddress}
            directAvatarLoaded={directAvatarLoaded}
            setDirectAvatarLoaded={setDirectAvatarLoaded}
            getTimestampEnterChat={getTimestampEnterChat}
            getSecretKeyForGroup={getSecretKeyForGroup}
            onClose={() => setChatWidgetClosed(true)}
          />
        )}
      </RootBox>
      <HubOnboardingTour
        closeGroupDiscovery={closeOnboardingGroupDiscovery}
        closeQChatPreview={closeOnboardingQChatPreview}
        navigateHome={navigateOnboardingHome}
        navigateQChat={navigateOnboardingQChat}
        openQortalProject={showOnboardingQortalProject}
        qortalProjectMember={qortalProjectMember}
        showDirectMessages={showOnboardingDirectMessages}
        showGroupDiscovery={openGroupDiscovery}
      />
    </>
  );
};
