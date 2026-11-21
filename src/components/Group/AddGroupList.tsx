import {
  Avatar,
  Box,
  ButtonBase,
  CircularProgress,
  Dialog,
  DialogContent,
  Divider,
  IconButton,
  InputAdornment,
  ListItem,
  ListItemButton,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import GroupIcon from '@mui/icons-material/Group';
import PersonIcon from '@mui/icons-material/Person';
import DescriptionIcon from '@mui/icons-material/Description';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AutoSizer, List } from 'react-virtualized';
import { QORTAL_APP_CONTEXT, getBaseApiReact } from '../../App';
import { LoadingButton } from '@mui/lab';
import { getFee } from '../../background/background.ts';
import LockIcon from '@mui/icons-material/Lock';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import EmojiEventsRoundedIcon from '@mui/icons-material/EmojiEventsRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded';
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded';
import { useTranslation } from 'react-i18next';
import { useAtom } from 'jotai';
import { memberGroupsAtom, txListAtom, userInfoAtom } from '../../atoms/global';
import qortalWhiteLogo from '../../assets/sidebar/qortal-logo-white.png';
import {
  ensureReticulumGroupScore,
  useReticulumGroupScoreSnapshot,
} from './reticulumGroupScore';
import { GroupScoreBadge } from './ReticulumGroupLevel';
import {
  comparePinnedTopGroups,
  isPinnedTopGroup,
  isQortalProjectGroup,
} from './findGroupsPinned';

const GROUP_ROW_HEIGHT = 82;
const FIND_GROUPS_PAGE_SIZE = 10;
const FIND_GROUPS_AVATAR_LIMIT = 20;

export const isOpenGroup = (group) =>
  group?.isOpen === true ||
  group?.groupType === 0 ||
  group?.groupType === 'OPEN';
const formatMemberCount = (count) =>
  new Intl.NumberFormat().format(Math.max(0, Number(count) || 0));

export const AddGroupList = ({
  initialSelectedGroup = null,
  onJoinedGroupOpen,
  onOverviewClose,
  overviewOnly = false,
  setInfoSnack,
  setOpenSnack,
}) => {
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const [memberGroups] = useAtom(memberGroupsAtom);
  const [txList, setTxList] = useAtom(txListAtom);
  const [userInfo] = useAtom(userInfoAtom);
  const { t } = useTranslation(['auth', 'core', 'group', 'question']);
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState(initialSelectedGroup);
  const [ownerAddress, setOwnerAddress] = useState(null);
  const [ownerPrimaryName, setOwnerPrimaryName] = useState(null);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const listRef = useRef(null);
  const [inputValue, setInputValue] = useState('');
  const [sortMode, setSortMode] = useState<
    'top' | 'active' | 'newest' | 'largest' | 'holdings'
  >('top');
  const [accessFilter, setAccessFilter] = useState<'all' | 'open' | 'private'>(
    'all'
  );
  const [visibleCount, setVisibleCount] = useState(FIND_GROUPS_PAGE_SIZE);
  const [groupOwnerNames, setGroupOwnerNames] = useState({});
  const avatarOwnerLookupAttemptedRef = useRef<Set<string>>(new Set());
  const groupScoreSnapshot = useReticulumGroupScoreSnapshot();
  const [isLoading, setIsLoading] = useState(false);
  const [joiningGroupId, setJoiningGroupId] = useState<string | null>(null);
  const joiningGroupIdRef = useRef<string | null>(null);
  const [joinError, setJoinError] = useState('');
  const [ownerAddressCopied, setOwnerAddressCopied] = useState(false);
  const ownerCopyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const theme = useTheme();

  useEffect(() => {
    if (overviewOnly) setSelectedGroup(initialSelectedGroup);
  }, [initialSelectedGroup, overviewOnly]);

  useEffect(
    () => () => {
      if (ownerCopyResetTimerRef.current) {
        clearTimeout(ownerCopyResetTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!selectedGroup?.groupId) {
      setOwnerAddress(null);
      setOwnerPrimaryName(null);
      return;
    }
    let cancelled = false;
    setOwnerLoading(true);
    setOwnerAddress(null);
    setOwnerPrimaryName(null);
    const fetchOwner = async () => {
      try {
        const res = await fetch(
          `${getBaseApiReact()}/groups/${selectedGroup.groupId}`
        );
        const data = await res.json();
        if (cancelled || !data?.owner) return;
        setOwnerAddress(data.owner);
        if (!cancelled && data.ownerPrimaryName)
          setOwnerPrimaryName(data.ownerPrimaryName);
      } catch (err) {
        if (!cancelled) {
          setOwnerAddress(null);
          setOwnerPrimaryName(null);
        }
      } finally {
        if (!cancelled) setOwnerLoading(false);
      }
    };
    fetchOwner();
    return () => {
      cancelled = true;
    };
  }, [selectedGroup?.groupId]);

  // Derive filtered list from groups + search so refetches (e.g. when memberGroups updates) don't clear the filter
  const filteredItems = useMemo(() => {
    const query = (inputValue || '').trim().toLowerCase();
    const scoreFor = (group) =>
      groupScoreSnapshot.groups[String(group?.groupId)];
    const compareCreated = (a, b) =>
      Number(b?.created || 0) - Number(a?.created || 0);
    const compareMembers = (a, b) =>
      Number(b?.memberCount || 0) - Number(a?.memberCount || 0);
    const compareHoldings = (a, b) => {
      const aKey = String(a?.groupId ?? '');
      const bKey = String(b?.groupId ?? '');
      const aKnown = Object.prototype.hasOwnProperty.call(
        groupScoreSnapshot.holdings,
        aKey
      );
      const bKnown = Object.prototype.hasOwnProperty.call(
        groupScoreSnapshot.holdings,
        bKey
      );
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      return (
        Number(groupScoreSnapshot.holdings[bKey] || 0) -
        Number(groupScoreSnapshot.holdings[aKey] || 0)
      );
    };
    const compareOptionalScore = (aScore, bScore, key) => {
      if (!aScore && !bScore) return 0;
      if (!aScore) return 1;
      if (!bScore) return -1;
      return Number(bScore?.[key] || 0) - Number(aScore?.[key] || 0);
    };
    return groups
      .filter((item) => {
        const matchesQuery =
          !query ||
          String(item?.groupName || '')
            .toLowerCase()
            .includes(query) ||
          String(item?.description || '')
            .toLowerCase()
            .includes(query);
        const matchesAccess =
          accessFilter === 'all' ||
          (accessFilter === 'open' && isOpenGroup(item)) ||
          (accessFilter === 'private' && !isOpenGroup(item));
        return matchesQuery && matchesAccess;
      })
      .sort((a, b) => {
        const aScore = scoreFor(a);
        const bScore = scoreFor(b);
        if (sortMode === 'top') {
          return (
            comparePinnedTopGroups(a, b) ||
            compareOptionalScore(aScore, bScore, 'score') ||
            compareOptionalScore(aScore, bScore, 'activityScore') ||
            compareMembers(a, b) ||
            compareCreated(a, b)
          );
        }
        if (sortMode === 'active') {
          return (
            compareOptionalScore(aScore, bScore, 'activityScore') ||
            Number(bScore?.activity?.activeAuthors7d || 0) -
              Number(aScore?.activity?.activeAuthors7d || 0) ||
            Number(bScore?.activity?.messages7d || 0) -
              Number(aScore?.activity?.messages7d || 0) ||
            compareOptionalScore(aScore, bScore, 'score') ||
            compareMembers(a, b) ||
            compareCreated(a, b)
          );
        }
        if (sortMode === 'newest') {
          return (
            compareCreated(a, b) ||
            Number(b?.groupId || 0) - Number(a?.groupId || 0)
          );
        }
        if (sortMode === 'holdings') {
          return (
            compareHoldings(a, b) ||
            compareMembers(a, b) ||
            compareCreated(a, b)
          );
        }
        return (
          compareMembers(a, b) ||
          compareOptionalScore(aScore, bScore, 'score') ||
          compareCreated(a, b)
        );
      });
  }, [groups, inputValue, groupScoreSnapshot, accessFilter, sortMode]);

  const visibleItems = useMemo(
    () => filteredItems.slice(0, visibleCount),
    [filteredItems, visibleCount]
  );
  const avatarEligibleGroupIds = useMemo(() => {
    const ids = new Set(
      [...groups]
        .sort(
          (a, b) => Number(b?.memberCount || 0) - Number(a?.memberCount || 0)
        )
        .slice(0, FIND_GROUPS_AVATAR_LIMIT)
        .map((group) => String(group.groupId))
    );
    visibleItems.forEach((group) => ids.add(String(group?.groupId)));
    return ids;
  }, [groups, visibleItems]);

  useEffect(() => {
    setVisibleCount(FIND_GROUPS_PAGE_SIZE);
    listRef.current?.scrollToRow?.(0);
  }, [inputValue, accessFilter, sortMode]);

  // Load the first twenty directory avatars, then retain every additional avatar
  // the user discovers by searching or loading more results during this session.
  useEffect(() => {
    let cancelled = false;
    const eligibleGroups = groups.filter((group) =>
      avatarEligibleGroupIds.has(String(group?.groupId))
    );
    const groupsToResolve = eligibleGroups.filter((group) => {
      const key = String(group?.groupId);
      if (!key || avatarOwnerLookupAttemptedRef.current.has(key)) return false;
      avatarOwnerLookupAttemptedRef.current.add(key);
      return true;
    });
    if (groupsToResolve.length === 0) {
      return undefined;
    }
    void Promise.all(
      groupsToResolve.map(async (group) => {
        if (group?.ownerPrimaryName) {
          return [String(group.groupId), group.ownerPrimaryName];
        }
        try {
          const response = await fetch(
            `${getBaseApiReact()}/groups/${group.groupId}`
          );
          const data = await response.json();
          return [String(group.groupId), data?.ownerPrimaryName || null];
        } catch {
          return [String(group.groupId), null];
        }
      })
    ).then((entries) => {
      if (!cancelled) {
        setGroupOwnerNames((previous) => ({
          ...previous,
          ...Object.fromEntries(entries),
        }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [avatarEligibleGroupIds, groups]);

  const handleChange = (event) => {
    setInputValue(event.target.value);
  };

  const handleSortChange = (
    nextSortMode: 'top' | 'active' | 'newest' | 'largest' | 'holdings'
  ) => {
    setSortMode(nextSortMode);
  };

  const isJoinedGroup = (groupId) =>
    (memberGroups || []).some(
      (group) => String(group?.groupId) === String(groupId)
    );
  const isPendingGroup = (groupId) =>
    (txList || []).some(
      (tx) =>
        tx?.type === 'joined-group' &&
        tx?.done !== true &&
        String(tx?.groupId) === String(groupId)
    );

  const getGroups = async () => {
    setGroupsLoading(true);
    try {
      const response = await fetch(`${getBaseApiReact()}/groups/?limit=0`);
      const groupData = await response.json();
      void ensureReticulumGroupScore();
      setGroups(Array.isArray(groupData) ? groupData : []);
    } catch (error) {
      console.error(error);
    } finally {
      setGroupsLoading(false);
    }
  };

  useEffect(() => {
    getGroups();
  }, [memberGroups]);

  const handleOpenDialog = (group) => {
    setJoinError('');
    setOwnerAddressCopied(false);
    setSelectedGroup(group);
  };

  const handleGroupClick = (group) => {
    if (isJoinedGroup(group?.groupId) && onJoinedGroupOpen) {
      const joinedGroup = (memberGroups || []).find(
        (memberGroup) => String(memberGroup?.groupId) === String(group?.groupId)
      );
      onJoinedGroupOpen(joinedGroup || group);
      return;
    }
    handleOpenDialog(group);
  };

  const handleCloseDialog = () => {
    setJoinError('');
    setOwnerAddressCopied(false);
    setSelectedGroup(null);
    onOverviewClose?.();
  };

  const handleCopyAddress = () => {
    if (ownerAddress) {
      navigator.clipboard
        .writeText(ownerAddress)
        .then(() => {
          if (ownerCopyResetTimerRef.current) {
            clearTimeout(ownerCopyResetTimerRef.current);
          }
          setOwnerAddressCopied(true);
          ownerCopyResetTimerRef.current = setTimeout(
            () => setOwnerAddressCopied(false),
            1600
          );
          setInfoSnack({
            type: 'success',
            message: t('auth:action.copy_address', {
              postProcess: 'capitalizeFirstChar',
            }),
          });
          setOpenSnack(true);
        })
        .catch(() => {
          setInfoSnack({
            type: 'error',
            message: t('question:message.error.copy_clipboard', {
              postProcess: 'capitalizeFirstChar',
            }),
          });
          setOpenSnack(true);
        });
    }
  };

  const handleJoinGroup = async (group, isOpen) => {
    const groupIdKey = String(group?.groupId || '');
    if (!groupIdKey || joiningGroupIdRef.current) return;
    joiningGroupIdRef.current = groupIdKey;
    setJoiningGroupId(groupIdKey);
    setJoinError('');
    try {
      const groupId = group.groupId;

      const fee = await getFee('JOIN_GROUP');

      await show({
        message: t('core:message.question.perform_transaction', {
          action: 'JOIN_GROUP',
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });
      setIsLoading(true);

      await new Promise((res, rej) => {
        window
          .sendMessage('joinGroup', {
            groupId,
          })
          .then((response) => {
            if (!response?.error) {
              setInfoSnack({
                type: 'success',
                message: t('group:message.success.group_join', {
                  postProcess: 'capitalizeFirstChar',
                }),
              });

              if (isOpen) {
                setTxList((prev) => [
                  {
                    ...response,
                    type: 'joined-group',
                    label: t('group:message.success.group_join_label', {
                      group_name: group?.groupName,
                      postProcess: 'capitalizeFirstChar',
                    }),
                    labelDone: t('group:message.success.group_join_label', {
                      group_name: group?.groupName,
                      postProcess: 'capitalizeFirstChar',
                    }),
                    done: false,
                    groupId,
                    memberAddress: userInfo?.address,
                  },
                  ...prev,
                ]);
              } else {
                setTxList((prev) => [
                  {
                    ...response,
                    type: 'joined-group-request',
                    label: t('group:message.success.group_join_request', {
                      group_name: group?.groupName,
                      postProcess: 'capitalizeFirstChar',
                    }),
                    labelDone: t('group:message.success.group_join_outcome', {
                      group_name: group?.groupName,
                      postProcess: 'capitalizeFirstChar',
                    }),
                    done: false,
                    groupId,
                  },
                  ...prev,
                ]);
              }
              setOpenSnack(true);
              handleCloseDialog();
              res(response);
              return;
            } else {
              setJoinError(t('group:find_groups.join_error'));
              setInfoSnack({
                type: 'error',
                message: response?.error,
              });
              setOpenSnack(true);
              rej(response.error);
            }
          })
          .catch((error) => {
            setJoinError(t('group:find_groups.join_error'));
            setInfoSnack({
              type: 'error',
              message:
                error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                }),
            });
            setOpenSnack(true);
            rej(error);
          });
      });
      setIsLoading(false);
    } catch (error) {
      if (!error?.isCanceled) {
        setJoinError(t('group:find_groups.join_error'));
        console.log(error);
      }
    } finally {
      setIsLoading(false);
      joiningGroupIdRef.current = null;
      setJoiningGroupId(null);
    }
  };

  const rowRenderer = ({ index, key, parent, style }) => {
    if (index === visibleItems.length) {
      return (
        <div key={key} style={style}>
          <Box
            sx={{
              alignItems: 'center',
              borderTop: `1px solid ${theme.palette.divider}`,
              display: 'flex',
              height: '100%',
              justifyContent: 'center',
            }}
          >
            <ButtonBase
              onClick={() =>
                setVisibleCount((count) =>
                  Math.min(count + FIND_GROUPS_PAGE_SIZE, filteredItems.length)
                )
              }
              sx={{
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: '7px',
                color: 'text.secondary',
                fontSize: 13.5,
                fontWeight: 650,
                minHeight: 34,
                px: 3.5,
                '&:hover': {
                  backgroundColor: theme.palette.action.hover,
                  color: 'text.primary',
                },
              }}
            >
              {t('group:find_groups.load_more')}
            </ButtonBase>
          </Box>
        </div>
      );
    }
    const group = visibleItems[index];
    const memberCount = group?.memberCount ?? 0;
    const openGroup = isOpenGroup(group);
    const joinedGroup = isJoinedGroup(group?.groupId);
    const pendingGroup = isPendingGroup(group?.groupId);
    const joiningGroup = joiningGroupId === String(group?.groupId);
    const pinnedGroup = isPinnedTopGroup(sortMode, group);
    const membershipUnavailable = joinedGroup || pendingGroup;
    const groupScore = groupScoreSnapshot.groups[String(group?.groupId)];
    const ownerName =
      groupOwnerNames[String(group?.groupId)] || group?.ownerPrimaryName;
    const showRemoteAvatar = Boolean(ownerName);
    const avatarUrl = showRemoteAvatar
      ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${encodeURIComponent(ownerName)}/qortal_group_avatar_${group.groupId}?async=true`
      : undefined;
    return (
      <div key={key} style={style}>
        <ListItem
          disablePadding
          sx={{
            backgroundColor: pinnedGroup
              ? alpha(theme.palette.primary.main, 0.1)
              : 'transparent',
            borderBottom: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
            px: 0,
          }}
        >
          <ListItemButton
            onClick={() => handleGroupClick(group)}
            sx={{
              borderRadius: 0,
              alignItems: 'center',
              columnGap: { xs: 1.25, sm: 1.75, md: 2.5 },
              display: 'grid',
              gridTemplateColumns: {
                xs: '46px minmax(0, 1fr) 36px 72px',
                sm: '46px minmax(0, 1fr) 36px 88px 76px',
                md: '52px minmax(0, 1fr) 38px 108px 80px',
              },
              minHeight: GROUP_ROW_HEIGHT,
              px: { xs: 1.25, sm: 1.75, md: 2.25 },
              py: 1.25,
              '&:hover': {
                bgcolor: 'action.hover',
              },
              '&:focus-visible': {
                boxShadow: 'inset 0 0 0 2px rgba(96,165,250,0.7)',
              },
            }}
          >
            <Avatar
              alt=""
              imgProps={{ loading: 'lazy' }}
              src={avatarUrl}
              sx={{
                backgroundColor: 'background.default',
                border: `1px solid ${theme.palette.divider}`,
                flexShrink: 0,
                height: { xs: 46, md: 52 },
                width: { xs: 46, md: 52 },
                '& .MuiAvatar-img': { objectFit: 'cover' },
              }}
            >
              <Box
                alt=""
                aria-hidden
                component="img"
                src={qortalWhiteLogo}
                sx={{
                  height: 22,
                  objectFit: 'contain',
                  opacity: 0.15,
                  width: 22,
                }}
              />
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: 0.75,
                  minWidth: 0,
                }}
              >
                <Typography
                  variant="h1"
                  sx={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: theme.palette.text.primary,
                    letterSpacing: '-0.015em',
                    lineHeight: '16px',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {group?.groupName}
                </Typography>
                <Tooltip
                  title={
                    openGroup
                      ? t('group:find_groups.open_group')
                      : t('group:find_groups.encrypted_group')
                  }
                >
                  {openGroup ? (
                    <PublicRoundedIcon
                      aria-label={t('group:find_groups.open_group')}
                      sx={{
                        color: '#3f8cff',
                        flexShrink: 0,
                        fontSize: 15,
                      }}
                    />
                  ) : (
                    <LockIcon
                      aria-label={t('group:find_groups.encrypted_group')}
                      sx={{
                        color: '#dc2626',
                        flexShrink: 0,
                        fontSize: 15,
                      }}
                    />
                  )}
                </Tooltip>
                {pinnedGroup && (
                  <Tooltip title={t('group:find_groups.pinned_group')}>
                    <PushPinRoundedIcon
                      aria-label={t('group:find_groups.pinned_group')}
                      sx={{
                        color: 'primary.light',
                        flexShrink: 0,
                        fontSize: 15,
                      }}
                    />
                  </Tooltip>
                )}
              </Box>
              {group?.description && (
                <Tooltip
                  disableInteractive
                  placement="top-start"
                  title={group.description}
                >
                  <Typography
                    variant="body2"
                    sx={{
                      color: theme.palette.text.secondary,
                      WebkitBoxOrient: 'vertical',
                      WebkitLineClamp: { xs: 1, sm: 2 },
                      display: '-webkit-box',
                      fontSize: 14,
                      fontWeight: 400,
                      lineHeight: '18px',
                      maxWidth: 540,
                      mt: '3px',
                      overflow: 'hidden',
                    }}
                  >
                    {group.description}
                  </Typography>
                </Tooltip>
              )}
              <Typography
                noWrap
                sx={{
                  color: 'text.secondary',
                  display: { xs: 'block', sm: 'none' },
                  fontSize: 11.5,
                  lineHeight: '16px',
                  mt: 0.15,
                }}
              >
                {formatMemberCount(memberCount)}{' '}
                {t('group:group.member', { count: memberCount })}
              </Typography>
            </Box>
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                justifyContent: 'center',
              }}
            >
              {groupScore ? (
                <GroupScoreBadge
                  circleSize={36}
                  popoverAlign="center"
                  score={groupScore}
                  size="compact"
                  triggerVariant="circle"
                />
              ) : null}
            </Box>
            <Box
              sx={{
                color: 'text.secondary',
                display: { xs: 'none', sm: 'block' },
                width: '100%',
              }}
            >
              <Typography
                noWrap
                sx={{
                  fontSize: 14,
                  fontWeight: 400,
                  letterSpacing: '-0.005em',
                  lineHeight: '20px',
                  textAlign: 'left',
                }}
              >
                {formatMemberCount(memberCount)}{' '}
                {t('group:group.member', { count: memberCount })}
              </Typography>
            </Box>
            <ButtonBase
              data-tour={
                isQortalProjectGroup(group)
                  ? 'hub-qortal-project-action'
                  : !joinedGroup && !pendingGroup
                    ? 'hub-join-group'
                    : undefined
              }
              aria-label={t('group:find_groups.card_action_aria', {
                action: joinedGroup
                  ? t('group:find_groups.action_open')
                  : pendingGroup
                    ? t('group:find_groups.action_pending')
                    : openGroup
                      ? t('group:find_groups.action_join')
                      : t('group:find_groups.action_request_to_join'),
                name: group?.groupName,
              })}
              disabled={pendingGroup || Boolean(joiningGroupId)}
              onClick={(event) => {
                event.stopPropagation();
                if (joinedGroup) {
                  handleGroupClick(group);
                  return;
                }
                if (!pendingGroup && !joiningGroupIdRef.current)
                  handleJoinGroup(group, openGroup);
              }}
              sx={{
                background: membershipUnavailable
                  ? theme.palette.action.selected
                  : 'linear-gradient(180deg, #3f8cff 0%, #2f6fd8 100%)',
                border: `1px solid ${membershipUnavailable ? theme.palette.divider : '#5ea2ff'}`,
                borderRadius: '8px',
                boxShadow: !joinedGroup
                  ? '0 3px 10px rgba(47,111,216,0.22), inset 0 1px 0 rgba(255,255,255,0.12)'
                  : 'none',
                color: membershipUnavailable
                  ? 'text.secondary'
                  : openGroup
                    ? '#ffffff'
                    : '#ffffff',
                fontSize: 14,
                fontWeight: 600,
                height: 38,
                justifySelf: 'end',
                letterSpacing: '0.005em',
                lineHeight: 1,
                minWidth: 0,
                p: 0,
                width: { xs: 72, sm: 76, md: 80 },
                '&:hover': {
                  background: membershipUnavailable
                    ? theme.palette.action.selected
                    : 'linear-gradient(180deg, #4b96ff 0%, #3779e8 100%)',
                  borderColor: !membershipUnavailable ? '#78b1ff' : undefined,
                  color: membershipUnavailable ? 'text.secondary' : '#ffffff',
                },
                '&:active': {
                  background: !membershipUnavailable ? '#2b63c5' : undefined,
                  boxShadow: 'none',
                },
                '&:focus-visible': {
                  outline: '2px solid #93c5fd',
                  outlineOffset: 2,
                },
                '&.Mui-disabled': {
                  color: membershipUnavailable
                    ? theme.palette.text.secondary
                    : '#ffffff',
                  cursor: pendingGroup ? 'not-allowed' : undefined,
                  opacity: membershipUnavailable ? 0.72 : 0.5,
                },
              }}
            >
              {joiningGroup ? (
                <CircularProgress color="inherit" size={15} thickness={5} />
              ) : joinedGroup ? (
                t('group:find_groups.action_joined')
              ) : pendingGroup ? (
                t('group:find_groups.action_pending')
              ) : openGroup ? (
                t('group:find_groups.action_join')
              ) : (
                t('group:find_groups.action_request')
              )}
            </ButtonBase>
          </ListItemButton>
        </ListItem>
      </div>
    );
  };

  const isSelectedGroupOpen =
    selectedGroup != null && isOpenGroup(selectedGroup);
  const isSelectedGroupJoined = isJoinedGroup(selectedGroup?.groupId);
  const isSelectedGroupPending = isPendingGroup(selectedGroup?.groupId);
  const selectedGroupMemberCount = Math.max(
    0,
    Number(selectedGroup?.memberCount) || 0
  );
  const selectedOwnerDisplayName =
    ownerPrimaryName ||
    ownerAddress ||
    t('core:unknown', { postProcess: 'capitalizeFirstChar' });
  const selectedOwnerAvatarUrl = ownerPrimaryName
    ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${encodeURIComponent(ownerPrimaryName)}/qortal_avatar?async=true`
    : undefined;
  const sortDescription = {
    top: t('group:find_groups.sorted_by_top'),
    active: t('group:find_groups.sorted_by_active'),
    newest: t('group:find_groups.sorted_by_newest'),
    largest: t('group:find_groups.sorted_by_largest'),
    holdings: t('group:find_groups.sorted_by_holdings'),
  }[sortMode];

  return (
    <>
      <Dialog
        open={selectedGroup != null}
        onClose={handleCloseDialog}
        fullWidth
        maxWidth={false}
        PaperProps={{
          sx: {
            backgroundColor: theme.palette.background.default,
            backgroundImage: 'none',
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: '12px',
            boxShadow: theme.shadows[12],
            m: 2,
            maxHeight: 'min(720px, calc(100vh - 32px))',
            maxWidth: 'none',
            overflow: 'hidden',
            width: 'min(480px, calc(100vw - 32px))',
          },
        }}
        sx={{
          '& .MuiDialog-container': {
            alignItems: 'center',
            justifyContent: 'center',
          },
        }}
      >
        {selectedGroup && (
          <DialogContent
            sx={{
              p: 3,
              overflowY: 'auto',
              scrollbarColor: 'rgba(143,150,165,0.45) transparent',
              scrollbarWidth: 'thin',
              '&::-webkit-scrollbar': { width: 5 },
              '&::-webkit-scrollbar-thumb': {
                backgroundColor: 'rgba(143,150,165,0.45)',
                borderRadius: 8,
              },
              '&::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
            }}
          >
            <Box component="header" sx={{ position: 'relative', pr: 5 }}>
              <Typography
                sx={{
                  color: 'text.secondary',
                  fontSize: 14,
                  fontWeight: 500,
                  lineHeight: '20px',
                }}
              >
                {t('group:find_groups.join_group_heading')}
              </Typography>
              <Typography
                component="h2"
                sx={{
                  WebkitBoxOrient: 'vertical',
                  WebkitLineClamp: 2,
                  display: '-webkit-box',
                  fontSize: 28,
                  fontWeight: 700,
                  letterSpacing: '-0.025em',
                  lineHeight: '34px',
                  mt: 1,
                  overflow: 'hidden',
                  overflowWrap: 'anywhere',
                }}
              >
                {selectedGroup.groupName}
              </Typography>
              <Box
                sx={{
                  alignItems: 'center',
                  color: 'text.secondary',
                  display: 'flex',
                  fontSize: 14,
                  lineHeight: '20px',
                  mt: 1.25,
                }}
              >
                {isSelectedGroupOpen ? (
                  <PublicRoundedIcon
                    sx={{
                      flexShrink: 0,
                      fontSize: 17,
                      mr: 1,
                      color: '#3f8cff',
                    }}
                  />
                ) : (
                  <LockIcon
                    sx={{
                      flexShrink: 0,
                      fontSize: 16,
                      mr: 1,
                      color: '#dc2626',
                    }}
                  />
                )}
                <Typography component="span" sx={{ fontSize: 14 }}>
                  {isSelectedGroupOpen
                    ? t('group:find_groups.visibility_public')
                    : t('group:find_groups.visibility_private')}
                </Typography>
                <Box component="span" sx={{ mx: 1 }}>
                  •
                </Box>
                <Typography component="span" sx={{ fontSize: 14 }}>
                  {formatMemberCount(selectedGroupMemberCount)}{' '}
                  {t('group:group.member', { count: selectedGroupMemberCount })}
                </Typography>
              </Box>
              <IconButton
                aria-label={t('group:find_groups.close_preview')}
                onClick={handleCloseDialog}
                sx={{
                  borderRadius: '8px',
                  color: 'text.secondary',
                  height: 34,
                  position: 'absolute',
                  right: -2,
                  top: -2,
                  width: 34,
                  '&:hover': {
                    backgroundColor: 'action.hover',
                    color: 'text.primary',
                  },
                  '&:focus-visible': {
                    outline: '2px solid #60a5fa',
                    outlineOffset: 2,
                  },
                }}
              >
                <CloseRoundedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>

            <Divider sx={{ my: 2.75 }} />

            <Box>
              <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.125 }}>
                <DescriptionIcon sx={{ color: 'primary.main', fontSize: 16 }} />
                <Typography
                  sx={{
                    color: 'text.secondary',
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: '0.09em',
                    lineHeight: '16px',
                  }}
                >
                  {t('group:find_groups.section_description')}
                </Typography>
              </Box>
              <Typography
                sx={{
                  color: 'text.primary',
                  fontSize: 16,
                  fontWeight: 400,
                  letterSpacing: '-0.005em',
                  lineHeight: '25px',
                  mt: 1.5,
                  overflowWrap: 'anywhere',
                }}
              >
                {selectedGroup.description?.trim() || '—'}
              </Typography>
            </Box>

            <Divider sx={{ my: 2.75 }} />

            <Box>
              <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.125 }}>
                <GroupIcon sx={{ color: 'primary.main', fontSize: 16 }} />
                <Typography
                  sx={{
                    color: 'text.secondary',
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: '0.09em',
                    lineHeight: '16px',
                  }}
                >
                  {t('group:find_groups.section_members')}
                </Typography>
              </Box>
              <Box
                sx={{
                  alignItems: 'center',
                  backgroundColor: 'rgba(255,255,255,0.025)',
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: '9px',
                  display: 'inline-flex',
                  height: 48,
                  mt: 1.5,
                  pl: 1.25,
                  pr: 2,
                }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    backgroundColor: 'rgba(59,130,246,0.12)',
                    border: '1px solid rgba(96,165,250,0.28)',
                    borderRadius: '50%',
                    color: 'primary.main',
                    display: 'flex',
                    height: 32,
                    justifyContent: 'center',
                    mr: 1.5,
                    width: 32,
                  }}
                >
                  <GroupIcon sx={{ fontSize: 18 }} />
                </Box>
                <Typography
                  sx={{
                    fontSize: 16,
                    fontWeight: 600,
                    letterSpacing: '-0.01em',
                    lineHeight: '20px',
                  }}
                >
                  {formatMemberCount(selectedGroupMemberCount)}{' '}
                  {t('group:group.member', { count: selectedGroupMemberCount })}
                </Typography>
              </Box>
            </Box>

            <Divider sx={{ my: 2.75 }} />

            <Box>
              <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.125 }}>
                <PersonIcon sx={{ color: 'primary.main', fontSize: 16 }} />
                <Typography
                  sx={{
                    color: 'text.secondary',
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: '0.09em',
                    lineHeight: '16px',
                  }}
                >
                  {t('group:find_groups.section_owner')}
                </Typography>
              </Box>
              <Box
                sx={{
                  alignItems: 'center',
                  backgroundColor: 'rgba(255,255,255,0.025)',
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: '9px',
                  columnGap: 1.5,
                  display: 'grid',
                  gridTemplateColumns: '44px minmax(0,1fr) 34px',
                  minHeight: 66,
                  mt: 1.5,
                  px: 1.5,
                  py: 1.25,
                }}
              >
                {ownerLoading ? (
                  <Skeleton height={44} variant="circular" width={44} />
                ) : (
                  <Avatar
                    src={selectedOwnerAvatarUrl}
                    sx={{
                      backgroundColor: 'rgba(96,165,250,0.18)',
                      border: '1px solid rgba(96,165,250,0.35)',
                      fontSize: 18,
                      fontWeight: 600,
                      height: 44,
                      width: 44,
                    }}
                  >
                    {String(selectedOwnerDisplayName).charAt(0).toUpperCase() ||
                      '?'}
                  </Avatar>
                )}
                <Box sx={{ minWidth: 0 }}>
                  {ownerLoading ? (
                    <Stack spacing={0.4}>
                      <Skeleton height={20} width="45%" />
                      <Skeleton height={18} width="90%" />
                    </Stack>
                  ) : (
                    <>
                      <Typography
                        noWrap
                        sx={{
                          fontSize: 15,
                          fontWeight: 600,
                          letterSpacing: '-0.01em',
                          lineHeight: '20px',
                        }}
                      >
                        {selectedOwnerDisplayName}
                      </Typography>
                      <Tooltip arrow title={ownerAddress || ''}>
                        <Typography
                          component="span"
                          tabIndex={ownerAddress ? 0 : -1}
                          sx={{
                            color: 'text.secondary',
                            display: 'block',
                            fontSize: 13,
                            lineHeight: '18px',
                            mt: '3px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {ownerAddress || '—'}
                        </Typography>
                      </Tooltip>
                    </>
                  )}
                </Box>
                <Tooltip
                  arrow
                  title={
                    ownerAddressCopied
                      ? t('group:find_groups.copied')
                      : t('core:message.generic.copy_address')
                  }
                >
                  <span>
                    <IconButton
                      aria-label={
                        ownerAddressCopied
                          ? t('group:find_groups.address_copied')
                          : t('group:find_groups.copy_owner_address')
                      }
                      disabled={!ownerAddress || ownerLoading}
                      onClick={handleCopyAddress}
                      sx={{
                        border: `1px solid ${theme.palette.divider}`,
                        borderRadius: '8px',
                        color: ownerAddressCopied
                          ? 'success.main'
                          : 'text.secondary',
                        height: 34,
                        width: 34,
                        '&:hover': {
                          backgroundColor: 'action.hover',
                          color: ownerAddressCopied
                            ? 'success.main'
                            : 'primary.main',
                        },
                        '&:focus-visible': {
                          outline: '2px solid #60a5fa',
                          outlineOffset: 2,
                        },
                      }}
                    >
                      {ownerAddressCopied ? (
                        <CheckRoundedIcon sx={{ fontSize: 17 }} />
                      ) : (
                        <ContentCopyIcon sx={{ fontSize: 17 }} />
                      )}
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            </Box>

            <Box sx={{ mt: 3 }}>
              {joinError ? (
                <Typography
                  role="alert"
                  sx={{
                    color: 'error.main',
                    fontSize: 13,
                    lineHeight: '18px',
                    mb: 1,
                  }}
                >
                  {joinError}
                </Typography>
              ) : null}
              <LoadingButton
                data-tour={
                  !isSelectedGroupJoined && !isSelectedGroupPending
                    ? 'hub-join-group'
                    : undefined
                }
                aria-label={t('group:find_groups.card_action_aria', {
                  action: isSelectedGroupOpen
                    ? t('group:find_groups.action_join')
                    : t('group:find_groups.action_apply_to_join'),
                  name: selectedGroup.groupName,
                })}
                disabled={
                  isSelectedGroupJoined ||
                  isSelectedGroupPending ||
                  Boolean(joiningGroupId)
                }
                fullWidth
                loading={
                  isLoading && joiningGroupId === String(selectedGroup.groupId)
                }
                onClick={() =>
                  handleJoinGroup(selectedGroup, isSelectedGroupOpen)
                }
                sx={{
                  background:
                    isSelectedGroupJoined || isSelectedGroupPending
                      ? theme.palette.action.selected
                      : 'linear-gradient(180deg, #3f8cff 0%, #2f6fd8 100%)',
                  border: `1px solid ${isSelectedGroupJoined || isSelectedGroupPending ? theme.palette.divider : '#5ea2ff'}`,
                  borderRadius: '9px',
                  boxShadow:
                    isSelectedGroupJoined || isSelectedGroupPending
                      ? 'none'
                      : '0 3px 10px rgba(47,111,216,0.22), inset 0 1px 0 rgba(255,255,255,0.12)',
                  color:
                    isSelectedGroupJoined || isSelectedGroupPending
                      ? 'text.secondary'
                      : '#ffffff',
                  fontSize: 14,
                  fontWeight: 600,
                  height: 46,
                  letterSpacing: '0.01em',
                  lineHeight: 1,
                  textTransform: 'none',
                  '&:hover': {
                    background:
                      isSelectedGroupJoined || isSelectedGroupPending
                        ? theme.palette.action.selected
                        : 'linear-gradient(180deg, #4b96ff 0%, #3779e8 100%)',
                    borderColor:
                      isSelectedGroupJoined || isSelectedGroupPending
                        ? theme.palette.divider
                        : '#78b1ff',
                  },
                  '&:active': {
                    background:
                      isSelectedGroupJoined || isSelectedGroupPending
                        ? theme.palette.action.selected
                        : '#2b63c5',
                    boxShadow: 'none',
                  },
                  '&:focus-visible': {
                    outline: '2px solid #93c5fd',
                    outlineOffset: 2,
                  },
                  '&.Mui-disabled': {
                    color:
                      isSelectedGroupJoined || isSelectedGroupPending
                        ? theme.palette.text.secondary
                        : '#ffffff',
                    opacity:
                      isSelectedGroupJoined || isSelectedGroupPending
                        ? 0.72
                        : 0.5,
                  },
                }}
              >
                {isSelectedGroupJoined
                  ? t('group:find_groups.action_joined')
                  : isSelectedGroupPending
                    ? t('group:find_groups.action_pending')
                    : isSelectedGroupOpen
                      ? t('group:find_groups.action_join_group')
                      : t('group:find_groups.action_apply_to_join')}
              </LoadingButton>
            </Box>
          </DialogContent>
        )}
      </Dialog>
      {!overviewOnly && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            gap: 1.5,
            minHeight: 0,
          }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1 }}>
            <TextField
              data-tour="hub-group-search"
              inputProps={{ 'aria-label': t('group:find_groups.search_aria') }}
              placeholder={t('group:find_groups.search_placeholder')}
              variant="outlined"
              fullWidth
              value={inputValue}
              onChange={handleChange}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon
                      sx={{ color: 'text.secondary', fontSize: 18, mr: 0.5 }}
                    />
                  </InputAdornment>
                ),
                endAdornment: inputValue ? (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={t('group:find_groups.clear_search')}
                      onClick={() => setInputValue('')}
                      size="small"
                    >
                      <CloseRoundedIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : undefined,
              }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: '9px',
                  bgcolor: 'background.default',
                  color: 'text.primary',
                  fontSize: 15,
                  height: 44,
                  letterSpacing: '-0.005em',
                  px: 2,
                  '& .MuiOutlinedInput-notchedOutline': {
                    borderColor: 'divider',
                  },
                  '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: 'text.secondary',
                  },
                  '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                    borderColor: '#2563eb',
                    borderWidth: 1,
                  },
                },
              }}
            />
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 1.25,
              }}
            >
              {[
                {
                  icon: <EmojiEventsRoundedIcon sx={{ fontSize: 17 }} />,
                  label: t('group:find_groups.sort_top'),
                  selected: sortMode === 'top',
                  onClick: () => handleSortChange('top'),
                },
                {
                  icon: <BoltRoundedIcon sx={{ fontSize: 17 }} />,
                  label: t('group:find_groups.sort_active'),
                  selected: sortMode === 'active',
                  onClick: () => handleSortChange('active'),
                },
                {
                  icon: <ScheduleRoundedIcon sx={{ fontSize: 17 }} />,
                  label: t('group:find_groups.sort_newest'),
                  selected: sortMode === 'newest',
                  onClick: () => handleSortChange('newest'),
                },
                {
                  icon: <GroupsRoundedIcon sx={{ fontSize: 17 }} />,
                  label: t('group:find_groups.sort_largest'),
                  selected: sortMode === 'largest',
                  onClick: () => handleSortChange('largest'),
                },
                {
                  icon: (
                    <AccountBalanceWalletRoundedIcon sx={{ fontSize: 17 }} />
                  ),
                  label: t('group:find_groups.sort_holdings'),
                  selected: sortMode === 'holdings',
                  onClick: () => handleSortChange('holdings'),
                },
              ].map((filter) => (
                <ButtonBase
                  aria-pressed={filter.selected}
                  key={filter.label}
                  onClick={filter.onClick}
                  sx={{
                    backgroundColor: filter.selected
                      ? 'primary.main'
                      : 'transparent',
                    border: `1px solid ${filter.selected ? theme.palette.primary.main : theme.palette.divider}`,
                    borderRadius: '9px',
                    color: filter.selected
                      ? 'primary.contrastText'
                      : 'text.secondary',
                    fontSize: 14,
                    fontWeight: 600,
                    gap: 1,
                    height: 40,
                    letterSpacing: '-0.01em',
                    px: 1.75,
                    '&:hover': {
                      backgroundColor: filter.selected
                        ? 'primary.dark'
                        : theme.palette.action.hover,
                    },
                    '&:focus-visible': {
                      outline: '2px solid #60a5fa',
                      outlineOffset: 2,
                    },
                  }}
                >
                  {filter.icon}
                  {filter.label}
                </ButtonBase>
              ))}
            </Box>
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 1.25,
              }}
            >
              {[
                {
                  label: t('group:find_groups.filter_all'),
                  value: 'all' as const,
                },
                {
                  icon: <PublicRoundedIcon sx={{ fontSize: 17 }} />,
                  label: t('group:find_groups.filter_open'),
                  value: 'open' as const,
                },
                {
                  icon: <LockIcon sx={{ fontSize: 17 }} />,
                  label: t('group:find_groups.filter_private'),
                  value: 'private' as const,
                },
              ].map((filter) => (
                <ButtonBase
                  aria-pressed={accessFilter === filter.value}
                  key={filter.value}
                  onClick={() => setAccessFilter(filter.value)}
                  sx={{
                    backgroundColor:
                      accessFilter === filter.value
                        ? 'primary.main'
                        : 'transparent',
                    border: `1px solid ${accessFilter === filter.value ? theme.palette.primary.main : theme.palette.divider}`,
                    borderRadius: '9px',
                    color:
                      accessFilter === filter.value
                        ? 'primary.contrastText'
                        : 'text.secondary',
                    fontSize: 14,
                    fontWeight: 600,
                    gap: 1,
                    height: 40,
                    letterSpacing: '-0.01em',
                    px: 1.75,
                    '&:hover': {
                      backgroundColor:
                        accessFilter === filter.value
                          ? 'primary.dark'
                          : theme.palette.action.hover,
                    },
                    '&:focus-visible': {
                      outline: '2px solid #60a5fa',
                      outlineOffset: 2,
                    },
                  }}
                >
                  {filter.icon}
                  {filter.label}
                </ButtonBase>
              ))}
            </Box>
          </Box>

          <Box
            sx={{
              position: 'relative',
              width: '100%',
              flexGrow: 1,
              minHeight: 0,
              backgroundColor: 'background.default',
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: '10px',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                alignItems: 'center',
                backgroundColor: 'background.paper',
                borderBottom: `1px solid ${theme.palette.divider}`,
                boxSizing: 'border-box',
                display: 'flex',
                flexShrink: 0,
                height: 44,
                justifyContent: 'space-between',
                px: 2,
              }}
            >
              <Typography
                sx={{
                  fontSize: 15,
                  fontWeight: 700,
                  letterSpacing: '-0.01em',
                  lineHeight: '21px',
                }}
              >
                {t('group:group.group_other', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
              <Typography
                sx={{
                  color: 'text.secondary',
                  fontSize: 13.5,
                  fontWeight: 500,
                }}
              >
                {sortDescription}
              </Typography>
            </Box>
            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                '& .ReactVirtualized__List': {
                  scrollbarColor: 'rgba(143,150,165,0.62) transparent',
                  scrollbarGutter: 'stable',
                  scrollbarWidth: 'thin',
                  '&::-webkit-scrollbar': { width: 6 },
                  '&::-webkit-scrollbar-thumb': {
                    backgroundColor: 'rgba(143,150,165,0.62)',
                    borderRadius: 8,
                  },
                  '&::-webkit-scrollbar-track': {
                    backgroundColor: 'transparent',
                  },
                },
              }}
            >
              {groupsLoading ? (
                <Stack
                  alignItems="center"
                  justifyContent="center"
                  spacing={1.5}
                  sx={{
                    width: '100%',
                    height: '100%',
                    minHeight: 200,
                  }}
                >
                  <CircularProgress size={32} thickness={4} />
                  <Typography variant="body2" color="text.secondary">
                    {t('core:loading.generic', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                </Stack>
              ) : filteredItems.length === 0 ? (
                <Stack
                  alignItems="center"
                  justifyContent="center"
                  sx={{
                    width: '100%',
                    height: '100%',
                    minHeight: 200,
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    {t('group:group.no_groups_found', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                </Stack>
              ) : (
                <AutoSizer>
                  {({ height, width }) => (
                    <List
                      ref={listRef}
                      width={width}
                      height={height}
                      rowCount={
                        visibleItems.length +
                        (visibleItems.length < filteredItems.length ? 1 : 0)
                      }
                      rowHeight={({ index }) =>
                        index === visibleItems.length ? 60 : GROUP_ROW_HEIGHT
                      }
                      rowRenderer={rowRenderer}
                    />
                  )}
                </AutoSizer>
              )}
            </Box>
          </Box>
        </Box>
      )}
    </>
  );
};
