import {
  Avatar,
  Box,
  ButtonBase,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Typography,
  useTheme,
} from '@mui/material';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { HubsIcon } from '../../assets/Icons/HubsIcon';
import { MessagingIcon } from '../../assets/Icons/MessagingIcon';
import { ContextMenu } from '../ContextMenu';
import { getBaseApiReact } from '../../App';
import { formatEmailDate } from './qmailUtils';
import CampaignIcon from '@mui/icons-material/Campaign';
import MarkChatUnreadIcon from '@mui/icons-material/MarkChatUnread';
import LockIcon from '@mui/icons-material/Lock';
import { CustomButton } from '../../styles/App-styles';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import PersonOffIcon from '@mui/icons-material/PersonOff';
import {
  groupAnnouncementSelector,
  groupChatTimestampSelector,
  groupPropertySelector,
  groupsAnnHasUnreadAtom,
  groupChatHasUnreadAtom,
  groupsOwnerNamesSelector,
  isRunningPublicNodeAtom,
  memberGroupsAtom,
  timestampEnterDataSelector,
} from '../../atoms/global';
import { timeDifferenceForNotificationChats } from './Group';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { AvatarPreviewModal } from '../Chat/AvatarPreviewModal';
import { getClickableAvatarSx } from '../Chat/clickableAvatarStyles';

const GroupListInner = ({
  selectGroupFunc,
  setDesktopSideView,
  desktopSideView,
  directChatHasUnread,
  chatMode,
  selectedGroup,
  getUserSettings,
  setOpenAddGroup,
  setIsOpenBlockedUserModal,
  myAddress,
}) => {
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const [isRunningPublicNode] = useAtom(isRunningPublicNodeAtom);
  const groups = useAtomValue(memberGroupsAtom);
  const groupChatHasUnread = useAtomValue(groupChatHasUnreadAtom);
  const groupsAnnHasUnread = useAtomValue(groupsAnnHasUnreadAtom);

  return (
    <Box
      sx={{
        alignItems: 'flex-start',
        background: theme.palette.background.surface,
        borderRadius: '0 12px 12px 0',
        borderLeft: '1px solid',
        borderColor: 'divider',
        boxShadow: '6px 0 20px rgba(0,0,0,0.18), 2px 0 8px rgba(0,0,0,0.08)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '0',
        width: '400px',
      }}
    >
      <Box
        sx={{
          alignItems: 'stretch',
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          gap: '10px',
          justifyContent: 'center',
          padding: '14px 12px',
          width: '100%',
        }}
      >
        <ButtonBase
          onClick={() => {
            setDesktopSideView('groups');
          }}
          sx={{
            position: 'relative',
            borderRadius: '12px',
            flex: 1,
            minWidth: 0,
            padding: '14px 12px',
            backgroundColor:
              desktopSideView === 'groups'
                ? theme.palette.action.selected
                : 'transparent',
            transition: 'background-color 0.15s ease',
            '&:hover': {
              backgroundColor:
                desktopSideView === 'groups'
                  ? theme.palette.action.selected
                  : theme.palette.action.hover,
            },
          }}
        >
          {(groupChatHasUnread || groupsAnnHasUnread) && (
            <Box
              sx={{
                position: 'absolute',
                top: 8,
                right: 8,
                width: 14,
                height: 14,
                borderRadius: '50%',
                backgroundColor: theme.palette.primary.main,
                border: `2px solid ${theme.palette.background.paper}`,
              }}
              aria-hidden
            />
          )}
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              justifyContent: 'center',
              width: '100%',
            }}
          >
            <HubsIcon
              height={26}
              width={26}
              color={
                groupChatHasUnread || groupsAnnHasUnread
                  ? theme.palette.primary.main
                  : desktopSideView === 'groups'
                    ? theme.palette.text.primary
                    : theme.palette.text.secondary
              }
            />
            <Typography
              sx={{
                color:
                  groupChatHasUnread || groupsAnnHasUnread
                    ? theme.palette.primary.main
                    : desktopSideView === 'groups'
                      ? theme.palette.text.primary
                      : theme.palette.text.secondary,
                fontFamily: 'Inter',
                fontSize: '13px',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              {t('group:group.group_other', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </Box>
        </ButtonBase>

        <ButtonBase
          onClick={() => {
            setDesktopSideView('directs');
          }}
          sx={{
            position: 'relative',
            borderRadius: '12px',
            flex: 1,
            minWidth: 0,
            padding: '14px 12px',
            backgroundColor:
              desktopSideView === 'directs'
                ? theme.palette.action.selected
                : 'transparent',
            transition: 'background-color 0.15s ease',
            '&:hover': {
              backgroundColor:
                desktopSideView === 'directs'
                  ? theme.palette.action.selected
                  : theme.palette.action.hover,
            },
          }}
        >
          {directChatHasUnread && (
            <Box
              sx={{
                position: 'absolute',
                top: 8,
                right: 8,
                width: 14,
                height: 14,
                borderRadius: '50%',
                backgroundColor: theme.palette.primary.main,
                border: `2px solid ${theme.palette.background.paper}`,
              }}
              aria-hidden
            />
          )}
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              justifyContent: 'center',
              width: '100%',
            }}
          >
            <MessagingIcon
              height={26}
              width={26}
              color={
                directChatHasUnread
                  ? theme.palette.primary.main
                  : desktopSideView === 'directs'
                    ? theme.palette.text.primary
                    : theme.palette.text.secondary
              }
            />
            <Typography
              sx={{
                color: directChatHasUnread
                  ? theme.palette.primary.main
                  : desktopSideView === 'directs'
                    ? theme.palette.text.primary
                    : theme.palette.text.secondary,
                fontFamily: 'Inter',
                fontSize: '13px',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              {t('group:group.dm', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </Box>
        </ButtonBase>
      </Box>

      <Box
        sx={{
          alignItems: 'flex-start',
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          left: chatMode === 'directs' && '-1000px',
          overflowY: 'auto',
          padding: '12px 8px',
          position: chatMode === 'directs' && 'fixed',
          visibility: chatMode === 'directs' && 'hidden',
          width: '100%',
        }}
      >
        <List
          sx={{
            width: '100%',
            padding: 0,
          }}
          className="group-list"
          dense={false}
        >
          {groups.map((group: any) => (
            <GroupItem
              selectGroupFunc={selectGroupFunc}
              key={group.groupId}
              group={group}
              selectedGroupId={selectedGroup?.groupId ?? null}
              getUserSettings={getUserSettings}
              myAddress={myAddress}
            />
          ))}
        </List>
      </Box>

      <Box
        sx={{
          borderTop: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          gap: '10px',
          justifyContent: 'center',
          padding: '16px 12px',
          width: '100%',
        }}
      >
        <CustomButton
          onClick={() => {
            setOpenAddGroup(true);
          }}
          sx={{
            flex: 1,
            gap: '8px',
            padding: '10px 16px',
          }}
        >
          <AddCircleOutlineIcon
            sx={{
              color: theme.palette.text.primary,
              fontSize: '20px',
            }}
          />
          {t('group:group.group', { postProcess: 'capitalizeFirstChar' })}
        </CustomButton>

        {!isRunningPublicNode && (
          <CustomButton
            onClick={() => {
              setIsOpenBlockedUserModal(true);
            }}
            sx={{
              minWidth: 'unset',
              padding: '10px',
            }}
          >
            <PersonOffIcon
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '22px',
              }}
            />
          </CustomButton>
        )}
      </Box>
    </Box>
  );
};

GroupListInner.displayName = 'GroupList';

export const GroupList = memo(GroupListInner);

interface GroupItemProps {
  selectGroupFunc: (group: any) => void;
  group: any;
  selectedGroupId: string | null;
  getUserSettings: () => Promise<any>;
  myAddress: string;
}

const GroupItem = memo(
  ({
    selectGroupFunc,
    group,
    selectedGroupId,
    getUserSettings,
    myAddress,
  }: GroupItemProps) => {
    const theme = useTheme();
    const { t } = useTranslation(['core', 'group']);
    const ownerName = useAtomValue(groupsOwnerNamesSelector(group?.groupId));
    const announcement = useAtomValue(
      groupAnnouncementSelector(group?.groupId)
    );
    const groupProperty = useAtomValue(groupPropertySelector(group?.groupId));
    const groupChatTimestamp = useAtomValue(
      groupChatTimestampSelector(group?.groupId)
    );
    const timestampEnterData = useAtomValue(
      timestampEnterDataSelector(group?.groupId)
    );
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [previewSrc, setPreviewSrc] = useState(null);
    const [isAvatarLoaded, setIsAvatarLoaded] = useState(false);
    const avatarUrl = useMemo(() => {
      if (!ownerName) return null;
      return `${getBaseApiReact()}/arbitrary/THUMBNAIL/${ownerName}/qortal_group_avatar_${group?.groupId}?async=true`;
    }, [ownerName, group?.groupId]);
    useEffect(() => {
      setIsAvatarLoaded(false);
    }, [avatarUrl]);

    const selectGroupHandler = useCallback(() => {
      selectGroupFunc(group);
    }, [group, selectGroupFunc]);

    const stopEvent = useCallback((event) => {
      event.stopPropagation();
      if (event.nativeEvent?.stopImmediatePropagation) {
        event.nativeEvent.stopImmediatePropagation();
      }
    }, []);

    const handleAvatarClick = useCallback(
      (event) => {
        if (!avatarUrl || !isAvatarLoaded) return;
        event.preventDefault();
        stopEvent(event);
        setPreviewSrc(avatarUrl);
        setIsPreviewOpen(true);
      },
      [avatarUrl, isAvatarLoaded, stopEvent]
    );

    const handleClosePreview = useCallback(() => {
      setIsPreviewOpen(false);
      setPreviewSrc(null);
    }, [setIsPreviewOpen, setPreviewSrc]);

    const isSelected = group?.groupId === selectedGroupId;

    return (
      <ListItem
        onClick={selectGroupHandler}
        sx={{
          borderRadius: '10px',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          marginBottom: '6px',
          padding: '12px 14px',
          width: '100%',
          backgroundColor: isSelected
            ? theme.palette.action.selected
            : 'transparent',
          borderLeft: isSelected
            ? `3px solid ${theme.palette.primary.main}`
            : '3px solid transparent',
          transition: 'background-color 0.15s ease, border-color 0.15s ease',
          '&:hover': {
            backgroundColor: isSelected
              ? theme.palette.action.selected
              : theme.palette.action.hover,
          },
        }}
      >
        <ContextMenu getUserSettings={getUserSettings} groupId={group.groupId}>
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: '20px',
              width: '100%',
            }}
          >
            <ListItemAvatar sx={{ minWidth: 44, marginRight: 0 }}>
              {ownerName ? (
                <Avatar
                  sx={{
                    height: 40,
                    width: 40,
                    ...getClickableAvatarSx(theme, isAvatarLoaded),
                  }}
                  alt={group?.groupName?.charAt(0)}
                  src={avatarUrl || undefined}
                  onClick={handleAvatarClick}
                  onMouseDown={(event) => {
                    if (isAvatarLoaded) {
                      stopEvent(event);
                    }
                  }}
                  onTouchStart={(event) => {
                    if (isAvatarLoaded) {
                      stopEvent(event);
                    }
                  }}
                  imgProps={{
                    onLoad: () => {
                      setIsAvatarLoaded(true);
                    },
                    onError: () => {
                      setIsAvatarLoaded(false);
                    },
                  }}
                >
                  {group?.groupName?.charAt(0).toUpperCase()}
                </Avatar>
              ) : (
                <Avatar
                  alt={group?.groupName?.charAt(0)}
                  sx={{ height: 40, width: 40 }}
                >
                  {group?.groupName?.charAt(0).toUpperCase() || 'G'}
                </Avatar>
              )}
            </ListItemAvatar>

            <ListItemText
              primary={group.groupId === '0' ? 'General' : group.groupName}
              secondary={
                !group?.timestamp
                  ? t('core:message.generic.no_messages', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : t('group:last_message_date', {
                      date: formatEmailDate(group?.timestamp),
                    })
              }
              primaryTypographyProps={{
                sx: {
                  color: theme.palette.text.primary,
                  fontFamily: 'Inter',
                  fontSize: '15px',
                  fontWeight: 600,
                  lineHeight: 1.3,
                },
              }}
              secondaryTypographyProps={{
                sx: {
                  color: theme.palette.text.secondary,
                  fontFamily: 'Inter',
                  fontSize: '12px',
                  lineHeight: 1.4,
                  marginTop: '3px',
                },
              }}
              sx={{
                flex: 1,
                minWidth: 0,
                margin: 0,
                overflow: 'hidden',
              }}
            />

            {announcement && !announcement?.seentimestamp && (
              <CampaignIcon
                sx={{
                  color: theme.palette.other.unread,
                  fontSize: '20px',
                  flexShrink: 0,
                }}
              />
            )}

            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                flexShrink: 0,
                justifyContent: 'center',
                marginLeft: '4px',
              }}
            >
              {group?.data &&
                groupChatTimestamp &&
                group?.sender !== myAddress &&
                group?.timestamp &&
                ((!timestampEnterData &&
                  Date.now() - group?.timestamp <
                    timeDifferenceForNotificationChats) ||
                  timestampEnterData < group?.timestamp) && (
                  <MarkChatUnreadIcon
                    sx={{
                      color: theme.palette.other.unread,
                      fontSize: '18px',
                    }}
                  />
                )}

              {groupProperty?.isOpen === false && (
                <LockIcon
                  sx={{
                    color: theme.palette.other.positive,
                    fontSize: '18px',
                  }}
                />
              )}
            </Box>
          </Box>
        </ContextMenu>

        <AvatarPreviewModal
          open={isPreviewOpen}
          src={previewSrc}
          alt={group?.groupName}
          onClose={handleClosePreview}
        />
      </ListItem>
    );
  }
);
