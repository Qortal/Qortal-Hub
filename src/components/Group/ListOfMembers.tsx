import {
  Avatar,
  alpha,
  Box,
  ButtonBase,
  IconButton,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Popover,
  Typography,
  useTheme,
} from '@mui/material';
import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded';
import Groups2RoundedIcon from '@mui/icons-material/Groups2Rounded';
import LocalFloristRoundedIcon from '@mui/icons-material/LocalFloristRounded';
import NightlifeRoundedIcon from '@mui/icons-material/NightlifeRounded';
import BedtimeRoundedIcon from '@mui/icons-material/BedtimeRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AutoSizer, List } from 'react-virtualized';
import { LoadingButton } from '@mui/lab';
import { getFee } from '../../background/background.ts';
import { getBaseApiReact } from '../../App';
import { useTranslation } from 'react-i18next';
import { useOnlineAddresses } from '../../hooks/usePresence';
import { useAtomValue } from 'jotai';
import { statusMapAtom } from '../../atoms/presence';
import { reticulumChatTextScaleAtom, userInfoAtom } from '../../atoms/global';
import { PresenceStatusBadge } from '../common/PresenceStatusBadge';
import { getFallbackAvatarOutlineSx } from '../Chat/clickableAvatarStyles';
import { hasInvisibleCharacters } from '../../utils/hasInvisibleCharacters';
import { WrapperUserAction } from '../WrapperUserAction';
import {
  QORTAL_LAND_PRESENCE_EVENT,
  getQortalLandPresence,
} from '../QortalLand/qortalLandPresence';
import { QortalLandAvailabilityTags } from '../QortalLand/QortalLandAvailabilityTags';
import { MemberCategoryHeader } from './MemberCategoryHeader';
import { executeEvent } from '../../utils/events';

const MEMBER_ROW_HEIGHT = 64;
const QORTAL_LAND_REMOTE_TTL_MS = 30_000;

const ListOfMembers = ({
  members,
  groupId,
  setInfoSnack,
  setOpenSnack,
  isAdmin,
  isOwner,
  show,
  ownerAddress,
  compact = false,
  reticulumUserCards = false,
}) => {
  const [popoverAnchor, setPopoverAnchor] = useState(null); // Track which list item the popover is anchored to
  const [openPopoverIndex, setOpenPopoverIndex] = useState(null); // Track which list item has the popover open
  const [isLoadingKick, setIsLoadingKick] = useState(false);
  const [isLoadingBan, setIsLoadingBan] = useState(false);
  const [isLoadingMakeAdmin, setIsLoadingMakeAdmin] = useState(false);
  const [isLoadingRemoveAdmin, setIsLoadingRemoveAdmin] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    admins: true,
    lounge: true,
    park: true,
    members: true,
    offline: true,
  });
  const [landPresence, setLandPresence] = useState(
    () => getQortalLandPresence(Number(groupId))?.members ?? []
  );
  const landSessionsRef = useRef(new Map());
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core', 'group', 'question']);
  const listRef = useRef(null);
  const onlineAddresses = useOnlineAddresses();
  const statusMap = useAtomValue(statusMapAtom);
  const currentAddress = useAtomValue(userInfoAtom)?.address;
  const reticulumTextScale = useAtomValue(reticulumChatTextScaleAtom);
  const compactTextSize =
    reticulumTextScale === 'high'
      ? 16
      : reticulumTextScale === 'medium'
        ? 14.5
        : 13;
  const compactRowHeight =
    reticulumTextScale === 'high'
      ? 62
      : reticulumTextScale === 'medium'
        ? 57
        : 52;
  const categorizedReticulumMembers = compact && reticulumUserCards;

  useEffect(() => {
    if (!categorizedReticulumMembers) return;
    const numericGroupId = Number(groupId);
    if (!Number.isInteger(numericGroupId) || numericGroupId <= 0) return;

    const initialMembers = getQortalLandPresence(numericGroupId)?.members ?? [];
    landSessionsRef.current = new Map(
      initialMembers.map((presence) => [
        `${presence.address}:snapshot`,
        {
          ...presence,
          sequence: 0,
          sessionId: 'snapshot',
        },
      ])
    );
    setLandPresence(initialMembers);

    const publishCurrentPresence = () => {
      const now = Date.now();
      const newestByAddress = new Map();
      for (const [key, presence] of landSessionsRef.current.entries()) {
        if (now - presence.lastSeenAt > QORTAL_LAND_REMOTE_TTL_MS) {
          landSessionsRef.current.delete(key);
          continue;
        }
        const previous = newestByAddress.get(presence.address);
        if (!previous || presence.lastSeenAt > previous.lastSeenAt) {
          newestByAddress.set(presence.address, presence);
        }
      }
      const nextMembers = [...newestByAddress.values()].map(
        ({ sequence: _sequence, sessionId: _sessionId, ...presence }) =>
          presence
      );
      setLandPresence(nextMembers);
    };

    void window.reticulumChat?.subscribeGroup?.(numericGroupId);
    void window.reticulumChat?.subscribeChannel?.(
      numericGroupId,
      'qortal-land'
    );
    const unsubscribe = window.reticulumChat?.onLandState?.((payload) => {
      if (payload.groupId !== numericGroupId || !payload.authorAddress) return;
      // The mounted QortalLand view is the authoritative source for our own
      // presence. Treating its echoed network state as a remote session can
      // resurrect the local user after leaving or let an old echo outlive the
      // shared snapshot.
      if (payload.authorAddress === currentAddress) return;
      const sessionId = payload.sessionId || 'default';
      const key = `${payload.authorAddress}:${sessionId}`;
      const previous = landSessionsRef.current.get(key);
      if (payload.movement === 'leave') {
        if (!previous || payload.sequence >= previous.sequence) {
          landSessionsRef.current.delete(key);
          publishCurrentPresence();
        }
        return;
      }
      if (previous && payload.sequence < previous.sequence) return;
      landSessionsRef.current.delete(`${payload.authorAddress}:snapshot`);
      landSessionsRef.current.set(key, {
        address: payload.authorAddress,
        afk: payload.afk === true,
        dnd: payload.dnd === true,
        voiceEnabled: payload.voiceEnabled === true,
        voiceMuted:
          payload.voiceEnabled === true && payload.voiceMuted === true,
        lastSeenAt: Date.now(),
        roomId: payload.roomId === 'park' ? 'park' : 'club',
        sequence: payload.sequence,
        sessionId,
      });
      publishCurrentPresence();
    });
    const pruneTimer = window.setInterval(
      publishCurrentPresence,
      Math.min(5_000, QORTAL_LAND_REMOTE_TTL_MS)
    );
    const onSharedPresence = (event) => {
      const snapshot = event.detail;
      if (snapshot?.groupId !== numericGroupId) return;
      for (const key of landSessionsRef.current.keys()) {
        if (key.endsWith(':shared')) {
          landSessionsRef.current.delete(key);
        }
      }
      for (const presence of snapshot.members || []) {
        const key = `${presence.address}:shared`;
        landSessionsRef.current.set(key, {
          ...presence,
          sequence: 0,
          sessionId: 'shared',
        });
      }
      setLandPresence(snapshot.members || []);
    };
    window.addEventListener(QORTAL_LAND_PRESENCE_EVENT, onSharedPresence);
    return () => {
      unsubscribe?.();
      window.clearInterval(pruneTimer);
      window.removeEventListener(QORTAL_LAND_PRESENCE_EVENT, onSharedPresence);
    };
  }, [categorizedReticulumMembers, currentAddress, groupId]);

  const landPresenceByAddress = useMemo(() => {
    const byAddress = new Map();
    for (const presence of landPresence) {
      const previous = byAddress.get(presence.address);
      if (!previous || presence.lastSeenAt > previous.lastSeenAt) {
        byAddress.set(presence.address, presence);
      }
    }
    return byAddress;
  }, [landPresence]);
  const sortedMembers = useMemo(() => {
    return [...(members || [])].sort((a, b) => {
      const aIsOwner = a?.member === ownerAddress;
      const bIsOwner = b?.member === ownerAddress;
      if (aIsOwner !== bIsOwner) return aIsOwner ? -1 : 1;

      const aIsAdmin = Boolean(a?.isAdmin);
      const bIsAdmin = Boolean(b?.isAdmin);
      if (aIsAdmin !== bIsAdmin) return aIsAdmin ? -1 : 1;

      const aLabel = (a?.primaryName || a?.name || a?.member || '').toString();
      const bLabel = (b?.primaryName || b?.name || b?.member || '').toString();
      return aLabel.localeCompare(bLabel, undefined, {
        sensitivity: 'base',
      });
    });
  }, [members, ownerAddress]);
  const categorizedRows = useMemo(() => {
    if (!categorizedReticulumMembers) {
      return sortedMembers.map((member) => ({ member, type: 'member' }));
    }

    const labelForMember = (member) =>
      (member?.primaryName || member?.name || member?.member || '').toString();
    const sortByName = (left, right) => {
      return labelForMember(left).localeCompare(
        labelForMember(right),
        undefined,
        {
          sensitivity: 'base',
        }
      );
    };
    const sortAdmins = (left, right) => {
      const leftIsOwner = left?.member === ownerAddress;
      const rightIsOwner = right?.member === ownerAddress;
      if (leftIsOwner !== rightIsOwner) return leftIsOwner ? -1 : 1;
      return sortByName(left, right);
    };
    const memberByAddress = new Map(
      (members || []).map((member) => [member?.member, member])
    );
    for (const address of landPresenceByAddress.keys()) {
      if (!memberByAddress.has(address)) {
        memberByAddress.set(address, { member: address });
      }
    }
    const allMembers = [...memberByAddress.values()].filter(
      (member) => member?.member
    );
    const isMemberOnline = (member) =>
      landPresenceByAddress.has(member?.member) ||
      onlineAddresses.has(member?.member) ||
      statusMap.has(member?.member);
    const allAdmins = allMembers.filter(
      (member) => member?.member === ownerAddress || Boolean(member?.isAdmin)
    );
    const admins = allAdmins.filter(isMemberOnline).sort(sortAdmins);
    const allRegularMembers = allMembers.filter(
      (member) => member?.member !== ownerAddress && !member?.isAdmin
    );
    const loungeMembers = allRegularMembers
      .filter(
        (member) =>
          isMemberOnline(member) &&
          landPresenceByAddress.has(member.member) &&
          landPresenceByAddress.get(member.member)?.roomId !== 'park'
      )
      .sort(sortByName);
    const parkMembers = allRegularMembers
      .filter(
        (member) =>
          isMemberOnline(member) &&
          landPresenceByAddress.get(member.member)?.roomId === 'park'
      )
      .sort(sortByName);
    const remainingMembers = allRegularMembers
      .filter(
        (member) =>
          isMemberOnline(member) && !landPresenceByAddress.has(member.member)
      )
      .sort(sortByName);
    const offlineMembers = allMembers
      .filter((member) => !isMemberOnline(member))
      .sort(sortByName);

    return [
      {
        count: admins.length,
        totalCount: allAdmins.length,
        expanded: expandedSections.admins,
        first: true,
        label: t('group:member_category.admins'),
        section: 'admins',
        type: 'section',
      },
      ...(expandedSections.admins
        ? admins.map((member) => ({ member, type: 'member' }))
        : []),
      {
        count: loungeMembers.length,
        totalCount: allRegularMembers.length,
        expanded: expandedSections.lounge,
        first: false,
        label: t('group:member_category.lounge'),
        section: 'lounge',
        type: 'section',
      },
      ...(expandedSections.lounge
        ? loungeMembers.map((member) => ({ member, type: 'member' }))
        : []),
      {
        count: parkMembers.length,
        totalCount: allRegularMembers.length,
        expanded: expandedSections.park,
        first: false,
        label: t('group:member_category.park'),
        section: 'park',
        type: 'section',
      },
      ...(expandedSections.park
        ? parkMembers.map((member) => ({ member, type: 'member' }))
        : []),
      {
        count: remainingMembers.length,
        totalCount: allRegularMembers.length,
        expanded: expandedSections.members,
        first: false,
        label: t('group:member_category.members'),
        section: 'members',
        type: 'section',
      },
      ...(expandedSections.members
        ? remainingMembers.map((member) => ({ member, type: 'member' }))
        : []),
      {
        count: offlineMembers.length,
        expanded: expandedSections.offline,
        first: false,
        label: t('group:member_category.offline'),
        section: 'offline',
        type: 'section',
      },
      ...(expandedSections.offline
        ? offlineMembers.map((member) => ({
            member,
            offline: true,
            type: 'member',
          }))
        : []),
    ];
  }, [
    categorizedReticulumMembers,
    expandedSections.admins,
    expandedSections.lounge,
    expandedSections.members,
    expandedSections.offline,
    expandedSections.park,
    landPresenceByAddress,
    members,
    onlineAddresses,
    ownerAddress,
    sortedMembers,
    statusMap,
    t,
  ]);

  const handlePopoverOpen = (event, index) => {
    setPopoverAnchor(event.currentTarget);
    setOpenPopoverIndex(index);
  };

  const handlePopoverClose = () => {
    setPopoverAnchor(null);
    setOpenPopoverIndex(null);
  };

  const handleKick = async (address) => {
    try {
      const fee = await getFee('GROUP_KICK');
      await show({
        message: t('core:message.question.perform_transaction', {
          action: 'GROUP_KICK',
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });

      setIsLoadingKick(true);
      const response = await window.sendMessage('kickFromGroup', {
        groupId,
        qortalAddress: address,
      });
      if (!response?.error) {
        setInfoSnack({
          type: 'success',
          message: t('group:message.success.group_kick', {
            postProcess: 'capitalizeFirstChar',
          }),
        });
        setOpenSnack(true);
        handlePopoverClose();
        setIsLoadingKick(false);
        return;
      }
      setIsLoadingKick(false);
      setInfoSnack({
        type: 'error',
        message:
          response?.message ||
          response?.error ||
          t('core:message.error.generic', {
            postProcess: 'capitalizeFirstChar',
          }),
      });
      setOpenSnack(true);
    } catch (error) {
      console.error('Kick error:', error);
      setIsLoadingKick(false);
      // If user cancelled the modal, don't show an error
      if (error?.isCanceled) {
        return;
      }
      setInfoSnack({
        type: 'error',
        message:
          error?.message ||
          String(error) ||
          t('core:message.error.generic', {
            postProcess: 'capitalizeFirstChar',
          }),
      });
      setOpenSnack(true);
    }
  };

  const handleBan = async (address) => {
    try {
      const fee = await getFee('GROUP_BAN');

      await show({
        message: t('core:message.question.perform_transaction', {
          action: 'GROUP_BAN',
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });

      setIsLoadingBan(true);

      const response = await window.sendMessage('banFromGroup', {
        groupId,
        qortalAddress: address,
        rBanTime: 0,
      });
      if (!response?.error) {
        setInfoSnack({
          type: 'success',
          message: t('group:message.success.group_ban', {
            postProcess: 'capitalizeFirstChar',
          }),
        });
        setOpenSnack(true);
        handlePopoverClose();
        setIsLoadingBan(false);
        return;
      }
      setIsLoadingBan(false);
      setInfoSnack({
        type: 'error',
        message:
          response?.message ||
          response?.error ||
          t('core:message.error.generic', {
            postProcess: 'capitalizeFirstChar',
          }),
      });
      setOpenSnack(true);
    } catch (error) {
      console.error('Ban error:', error);
      setIsLoadingBan(false);
      // If user cancelled the modal, don't show an error
      if (error?.isCanceled) {
        return;
      }
      setInfoSnack({
        type: 'error',
        message:
          error?.message ||
          String(error) ||
          t('core:message.error.generic', {
            postProcess: 'capitalizeFirstChar',
          }),
      });
      setOpenSnack(true);
    }
  };

  const makeAdmin = async (address) => {
    try {
      const fee = await getFee('ADD_GROUP_ADMIN');
      await show({
        message: t('core:message.question.perform_transaction', {
          action: 'ADD_GROUP_ADMIN',
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });
      setIsLoadingMakeAdmin(true);
      await new Promise((res, rej) => {
        window
          .sendMessage('makeAdmin', {
            groupId,
            qortalAddress: address,
          })
          .then((response) => {
            if (!response?.error) {
              setInfoSnack({
                type: 'success',
                message: t('group:message.success.group_member_admin', {
                  postProcess: 'capitalizeFirstChar',
                }),
              });
              setOpenSnack(true);
              handlePopoverClose();
              res(response);
              return;
            }
            setInfoSnack({
              type: 'error',
              message: response?.error,
            });
            setOpenSnack(true);
            rej(response.error);
          })
          .catch((error) => {
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
    } catch (error) {
      console.log(error);
    } finally {
      setIsLoadingMakeAdmin(false);
    }
  };

  const removeAdmin = async (address) => {
    try {
      const fee = await getFee('REMOVE_GROUP_ADMIN');
      await show({
        message: t('core:message.question.perform_transaction', {
          action: 'REMOVE_GROUP_ADMIN',
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });
      setIsLoadingRemoveAdmin(true);
      await new Promise((res, rej) => {
        window
          .sendMessage('removeAdmin', {
            groupId,
            qortalAddress: address,
          })
          .then((response) => {
            if (!response?.error) {
              setInfoSnack({
                type: 'success',
                message: t('group:message.success.group_remove_member', {
                  postProcess: 'capitalizeFirstChar',
                }),
              });
              setOpenSnack(true);
              handlePopoverClose();
              res(response);
              return;
            }
            setInfoSnack({
              type: 'error',
              message: response?.error,
            });
            setOpenSnack(true);
            rej(response.error);
          })
          .catch((error) => {
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
    } catch (error) {
      console.log(error);
    } finally {
      setIsLoadingRemoveAdmin(false);
    }
  };

  const rowRenderer = ({ index, key, style }) => {
    const row = categorizedRows[index];
    const semanticRowKey =
      row?.type === 'section'
        ? `member-section-${row.section}`
        : row?.member?.member
          ? `member-${row.member.member}`
          : key;
    if (row?.type === 'section') {
      const expanded = Boolean(row.expanded);
      const SectionIcon =
        row.section === 'admins'
          ? AdminPanelSettingsRoundedIcon
          : row.section === 'lounge'
            ? NightlifeRoundedIcon
            : row.section === 'park'
              ? LocalFloristRoundedIcon
              : row.section === 'offline'
                ? BedtimeRoundedIcon
                : Groups2RoundedIcon;
      return (
        <div key={semanticRowKey} style={style}>
          <MemberCategoryHeader
            count={row.count}
            totalCount={row.totalCount}
            expanded={expanded}
            first={row.first}
            icon={<SectionIcon sx={{ fontSize: 17 }} />}
            label={row.label}
            onToggle={() =>
              setExpandedSections((current) => ({
                ...current,
                [row.section]: !current[row.section],
              }))
            }
            type={row.section}
          />
        </div>
      );
    }

    const member = row?.member;
    if (!member) return null;
    const isOfflineRow = row?.offline === true;
    const memberLabel = compact
      ? member?.primaryName || member?.name || 'Member'
      : member?.primaryName || member?.member;
    const hasUnsafeMemberName = Boolean(
      member?.primaryName && hasInvisibleCharacters(member.primaryName)
    );
    const popoverWidth =
      popoverAnchor?.getBoundingClientRect?.().width || (compact ? 240 : 325);
    const memberRole =
      member?.member === ownerAddress
        ? 'Owner'
        : member?.isAdmin
          ? 'Admin'
          : null;
    const memberLandPresence =
      landPresenceByAddress.get(member?.member) ?? null;
    const memberRoleColor = isOfflineRow
      ? theme.palette.text.secondary
      : memberRole === 'Owner'
        ? theme.palette.mode === 'dark'
          ? '#ffb454'
          : '#a84a00'
        : memberRole === 'Admin'
          ? theme.palette.mode === 'dark'
            ? '#58a6ff'
            : '#1d4ed8'
          : theme.palette.mode === 'dark'
            ? '#f2f2f4'
            : '#1b1d24';
    const reticulumUserCard =
      reticulumUserCards && member?.member
        ? {
            address: member.member,
            avatarUrl: member?.primaryName
              ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${encodeURIComponent(member.primaryName)}/qortal_avatar?async=true`
              : undefined,
            isMinterResolved: false,
            isOwn: member.member === currentAddress,
            name: member?.primaryName || member?.name,
            role:
              memberRole === 'Owner'
                ? 'owner'
                : memberRole === 'Admin'
                  ? 'admin'
                  : undefined,
            roleColor: memberRole ? memberRoleColor : undefined,
            status: statusMap.get(member.member) ?? null,
          }
        : undefined;
    const reticulumSilenceContext =
      reticulumUserCards &&
      currentAddress &&
      member?.member &&
      (member.member !== currentAddress || memberRole === 'Owner')
        ? {
            disabled: memberRole === 'Owner',
            groupId: Number(groupId),
            ownerAddress: currentAddress,
            scopeType: 'group' as const,
          }
        : undefined;
    const memberContent = (
      <>
        <ListItemAvatar sx={{ minWidth: compact ? 42 : undefined }}>
          <PresenceStatusBadge
            online={
              onlineAddresses.has(member?.member) || Boolean(memberLandPresence)
            }
            status={
              memberLandPresence?.afk
                ? 'idle'
                : (statusMap.get(member?.member) ?? null)
            }
          >
            <Avatar
              alt={memberLabel}
              sx={{
                height: compact ? 34 : undefined,
                width: compact ? 34 : undefined,
                ...(!member?.primaryName
                  ? getFallbackAvatarOutlineSx(theme)
                  : {}),
              }}
              src={
                member?.primaryName
                  ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${member.primaryName}/qortal_avatar?async=true`
                  : ''
              }
            />
          </PresenceStatusBadge>
        </ListItemAvatar>
        <ListItemText
          id={memberLabel}
          primary={
            <Box
              component="span"
              sx={{
                alignItems: 'baseline',
                display: 'flex',
                gap: 0.5,
                minWidth: 0,
              }}
            >
              <Box
                component="span"
                sx={{
                  color: memberRoleColor,
                  fontSize:
                    compact && reticulumUserCards
                      ? compactTextSize
                      : compact
                        ? 13
                        : undefined,
                  fontWeight: compact ? 700 : undefined,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  ...(hasUnsafeMemberName
                    ? {
                        textDecorationColor: theme.palette.error.main,
                        textDecorationLine: 'line-through',
                        textDecorationThickness: '2px',
                      }
                    : {}),
                }}
              >
                {memberLabel}
              </Box>
              {memberRole && memberLandPresence && (
                <Box
                  component="span"
                  sx={{
                    backgroundColor: alpha('#20c7d9', 0.13),
                    border: `1px solid ${alpha('#20c7d9', 0.52)}`,
                    borderRadius: '4px',
                    color:
                      theme.palette.mode === 'dark' ? '#55dcea' : '#087b88',
                    flexShrink: 0,
                    fontSize: 9,
                    fontWeight: 800,
                    letterSpacing: '0.035em',
                    lineHeight: '14px',
                    px: 0.55,
                  }}
                >
                  Q-LAND
                </Box>
              )}
              <QortalLandAvailabilityTags availability={memberLandPresence} />
            </Box>
          }
          primaryTypographyProps={{
            sx: {
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
          }}
        />
      </>
    );

    return ( <div key={semanticRowKey} style={style}>
        {((isOwner || isAdmin) && !member?.isAdmin && member?.member !== ownerAddress || isOwner && member?.isAdmin && member?.member !== ownerAddress) && (
          <Popover
            open={openPopoverIndex === index}
            anchorEl={popoverAnchor}
            onClose={handlePopoverClose}
            transformOrigin={{
              vertical: 'top',
              horizontal: 'left',
            }}
            anchorOrigin={{
              vertical: 'bottom',
              horizontal: 'left',
            }}
            slotProps={{
              paper: {
                sx: {
                  backgroundColor: theme.palette.background.paper,
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: '8px',
                  boxShadow: theme.shadows[8],
                  mt: 0.5,
                  overflow: 'hidden',
                  width: popoverWidth,
                },
              },
            }}
          >
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 0.25,
                p: 0.5,
              }}
            >
              {(isOwner || isAdmin) && !member?.isAdmin && member?.member !== ownerAddress && (
                <>
                  <LoadingButton
                    fullWidth
                    loading={isLoadingKick}
                    loadingPosition="start"
                    onClick={() => handleKick(member?.member)}
                    sx={{
                      borderRadius: '6px',
                      color: 'text.primary',
                      justifyContent: 'flex-start',
                      px: 1.25,
                      textTransform: 'none',
                    }}
                    variant="text"
                  >
                    {t('group:action.kick_member', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </LoadingButton>

                  <LoadingButton
                    fullWidth
                    loading={isLoadingBan}
                    loadingPosition="start"
                    onClick={() => handleBan(member?.member)}
                    sx={{
                      borderRadius: '6px',
                      color: 'error.main',
                      justifyContent: 'flex-start',
                      px: 1.25,
                      textTransform: 'none',
                    }}
                    variant="text"
                  >
                    {t('group:action.ban', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </LoadingButton>
                </>
              )}

              {isOwner && member?.member !== ownerAddress && (
                <>
                  {!member?.isAdmin && (
                    <LoadingButton
                      fullWidth
                      loading={isLoadingMakeAdmin}
                      loadingPosition="start"
                      onClick={() => makeAdmin(member?.member)}
                      sx={{
                        borderRadius: '6px',
                        color: 'text.primary',
                        justifyContent: 'flex-start',
                        px: 1.25,
                        textTransform: 'none',
                      }}
                      variant="text"
                    >
                      {t('group:action.make_admin', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </LoadingButton>
                  )}

                  {member?.isAdmin && (
                    <LoadingButton
                      fullWidth
                      loading={isLoadingRemoveAdmin}
                      loadingPosition="start"
                      onClick={() => removeAdmin(member?.member)}
                      sx={{
                        borderRadius: '6px',
                        color: 'text.primary',
                        justifyContent: 'flex-start',
                        px: 1.25,
                        textTransform: 'none',
                      }}
                      variant="text"
                    >
                      {t('group:action.remove_admin', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </LoadingButton>
                  )}
                </>
              )}
            </Box>
          </Popover>
        )}

        <ListItem key={member?.member} disablePadding>
          {reticulumUserCard ? (
            <WrapperUserAction
              address={member.member}
              fullWidth
              name={memberLabel}
              reticulumUserCard={reticulumUserCard}
              reticulumSilenceContext={reticulumSilenceContext}
            >
              <ListItemButton
                onContextMenu={
                  (isOwner || isAdmin)
                    ? (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        handlePopoverOpen(event, index);
                      }
                    : undefined
                }
                sx={{
                  borderRadius: '6px',
                  cursor: 'pointer',
                  minHeight:
                    compact && reticulumUserCards ? compactRowHeight : 50,
                  px: 1,
                  py: 0.5,
                  opacity: isOfflineRow ? 0.58 : 1,
                  transition: 'opacity 140ms ease',
                  width: '100%',
                  '&:hover': {
                    opacity: isOfflineRow ? 0.78 : 1,
                  },
                }}
              >
                {memberContent}
              </ListItemButton>
            </WrapperUserAction>
          ) : (
            <ListItemButton
              onClick={
                (isOwner || isAdmin) ? (event) => handlePopoverOpen(event, index) : undefined
              }
              sx={{
                borderRadius: compact ? '6px' : undefined,
                cursor: (isOwner || isAdmin) ? 'pointer' : 'default',
                minHeight:
                  compact && reticulumUserCards
                    ? compactRowHeight
                    : compact
                      ? 50
                      : undefined,
                px: compact ? 1 : undefined,
                py: compact ? 0.5 : undefined,
                opacity: isOfflineRow ? 0.58 : 1,
              }}
            >
              {memberContent}
            </ListItemButton>
          )}
        </ListItem>
      </div>
    );
  };

  return (
    <div
      style={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {!compact && (
        <p>
          {t('core:list.members', {
            postProcess: 'capitalizeFirstChar',
          })}
        </p>
      )}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 1,
          height: compact ? '100%' : '500px',
          minHeight: 0,
          boxSizing: 'border-box',
          padding: categorizedReticulumMembers ? '8px 0 8px 10px' : undefined,
          position: 'relative',
          width: '100%',
        }}
      >
        <AutoSizer>
          {({ height, width }) => (
            <List
              height={height}
              overscanRowCount={8}
              ref={listRef}
              rowCount={categorizedRows.length}
              rowHeight={
                categorizedReticulumMembers
                  ? ({ index }) =>
                      categorizedRows[index]?.type === 'section'
                        ? categorizedRows[index]?.first
                          ? 40
                          : 46
                        : compactRowHeight
                  : compact
                    ? 52
                    : MEMBER_ROW_HEIGHT
              }
              rowRenderer={rowRenderer}
              style={{
                boxSizing: 'border-box',
                outline: 'none',
                paddingRight: categorizedReticulumMembers ? 10 : undefined,
              }}
              tabIndex={-1}
              width={width}
            />
          )}
        </AutoSizer>
      </div>
      {categorizedReticulumMembers && (
        <ButtonBase
          aria-label={t('group:chat_group.open_hidden_members')}
          onClick={() =>
            executeEvent('openReticulumHiddenMembers', {
              groupId: Number(groupId),
            })
          }
          sx={{
            alignItems: 'center',
            borderTop: `1px solid ${theme.palette.divider}`,
            color: 'text.secondary',
            display: 'flex',
            flexShrink: 0,
            fontSize: 12,
            fontWeight: 650,
            gap: 0.85,
            justifyContent: 'center',
            minHeight: 38,
            px: 1.5,
            transition: 'background-color 140ms ease, color 140ms ease',
            width: '100%',
            '&:hover': {
              backgroundColor: alpha(theme.palette.text.primary, 0.045),
              color: 'text.primary',
            },
          }}
        >
          <VisibilityOffRoundedIcon sx={{ fontSize: 17 }} />
          {t('group:chat_group.hidden_members')}
        </ButtonBase>
      )}
    </div>
  );
};

export default ListOfMembers;
