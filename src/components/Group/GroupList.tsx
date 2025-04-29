import {
  Avatar,
  Box,
  ButtonBase,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  useTheme,
} from '@mui/material';
import React, { useCallback } from 'react';
import { IconWrapper } from '../Desktop/DesktopFooter';
import { HubsIcon } from '../../assets/Icons/HubsIcon';
import { MessagingIcon } from '../../assets/Icons/MessagingIcon';
import { ContextMenu } from '../ContextMenu';
import { getBaseApiReact } from '../../App';
import { formatEmailDate } from './QMailMessages';
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
  groupsOwnerNamesSelector,
  timestampEnterDataSelector,
} from '../../atoms/global';
import { useRecoilValue } from 'recoil';
import { timeDifferenceForNotificationChats } from './Group';

export const GroupList = ({
  selectGroupFunc,
  setDesktopSideView,
  groupChatHasUnread,
  groupsAnnHasUnread,
  desktopSideView,
  directChatHasUnread,
  chatMode,
  groups,
  selectedGroup,
  getUserSettings,
  setOpenAddGroup,
  isRunningPublicNode,
  setIsOpenBlockedUserModal,
  myAddress,
}) => {
  const theme = useTheme();
  return (
    <div
      style={{
        display: 'flex',
        width: '380px',
        flexDirection: 'column',
        alignItems: 'flex-start',
        height: '100%',
        background: theme.palette.background.surface,
        borderRadius: '0px 15px 15px 0px',
        padding: '0px 2px',
      }}
    >
      <Box
        sx={{
          width: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          display: 'flex',
          gap: '10px',
        }}
      >
        <ButtonBase
          onClick={() => {
            setDesktopSideView('groups');
          }}
        >
          <IconWrapper
            color={
              groupChatHasUnread || groupsAnnHasUnread
                ? theme.palette.other.unread
                : desktopSideView === 'groups'
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary
            }
            label="Groups"
            selected={desktopSideView === 'groups'}
            customWidth="75px"
          >
            <HubsIcon
              height={24}
              color={
                groupChatHasUnread || groupsAnnHasUnread
                  ? theme.palette.other.unread
                  : desktopSideView === 'groups'
                    ? theme.palette.text.primary
                    : theme.palette.text.secondary
              }
            />
          </IconWrapper>
        </ButtonBase>
        <ButtonBase
          onClick={() => {
            setDesktopSideView('directs');
          }}
        >
          <IconWrapper
            customWidth="75px"
            color={
              directChatHasUnread
                ? theme.palette.other.unread
                : desktopSideView === 'directs'
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary
            }
            label="Messaging"
            selected={desktopSideView === 'directs'}
          >
            <MessagingIcon
              height={24}
              color={
                directChatHasUnread
                  ? theme.palette.other.unread
                  : desktopSideView === 'directs'
                    ? theme.palette.text.primary
                    : theme.palette.text.secondary
              }
            />
          </IconWrapper>
        </ButtonBase>
      </Box>

      <div
        style={{
          alignItems: 'flex-start',
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          left: chatMode === 'directs' && '-1000px',
          overflowY: 'auto',
          position: chatMode === 'directs' && 'fixed',
          visibility: chatMode === 'directs' && 'hidden',
          width: '100%',
        }}
      >
        <List
          sx={{
            width: '100%',
          }}
          className="group-list"
          dense={false}
        >
          {groups.map((group: any) => (
            <GroupItem
              selectGroupFunc={selectGroupFunc}
              key={group.groupId}
              group={group}
              selectedGroup={selectedGroup}
              getUserSettings={getUserSettings}
              myAddress={myAddress}
            />
          ))}
        </List>
      </div>
      <div
        style={{
          display: 'flex',
          gap: '10px',
          justifyContent: 'center',
          padding: '10px',
          width: '100%',
        }}
      >
        <>
          <CustomButton
            onClick={() => {
              setOpenAddGroup(true);
            }}
          >
            <AddCircleOutlineIcon
              sx={{
                color: theme.palette.text.primary,
              }}
            />
            Group
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
                  color: theme.palette.text.primary,
                }}
              />
            </CustomButton>
          )}
        </>
      </div>
    </div>
  );
};

const GroupItem = React.memo(
  ({ selectGroupFunc, group, selectedGroup, getUserSettings, myAddress }) => {
    const theme = useTheme();
    const ownerName = useRecoilValue(groupsOwnerNamesSelector(group?.groupId));
    const announcement = useRecoilValue(
      groupAnnouncementSelector(group?.groupId)
    );
    const groupProperty = useRecoilValue(groupPropertySelector(group?.groupId));
    const groupChatTimestamp = useRecoilValue(
      groupChatTimestampSelector(group?.groupId)
    );
    const timestampEnterData = useRecoilValue(
      timestampEnterDataSelector(group?.groupId)
    );
    const selectGroupHandler = useCallback(() => {
      selectGroupFunc(group);
    }, [group, selectGroupFunc]);

    return (
      <ListItem
        onClick={selectGroupHandler}
        sx={{
          display: 'flex',
          background:
            group?.groupId === selectedGroup?.groupId &&
            theme.palette.action.selected,
          borderRadius: '2px',
          cursor: 'pointer',
          flexDirection: 'column',
          padding: '10px',
          width: '100%',
          '&:hover': {
            backgroundColor: 'action.hover', // background on hover
          },
        }}
      >
        <ContextMenu getUserSettings={getUserSettings} groupId={group.groupId}>
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              width: '100%',
            }}
          >
            <ListItemAvatar>
              {ownerName ? (
                <Avatar
                  alt={group?.groupName?.charAt(0)}
                  src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${
                    ownerName
                  }/qortal_group_avatar_${group?.groupId}?async=true`}
                >
                  {group?.groupName?.charAt(0).toUpperCase()}
                </Avatar>
              ) : (
                <Avatar alt={group?.groupName?.charAt(0)}>
                  {' '}
                  {group?.groupName?.charAt(0).toUpperCase() || 'G'}
                </Avatar>
              )}
            </ListItemAvatar>
            <ListItemText
              primary={group.groupId === '0' ? 'General' : group.groupName}
              secondary={
                !group?.timestamp
                  ? 'no messages'
                  : `last message: ${formatEmailDate(group?.timestamp)}`
              }
              primaryTypographyProps={{
                style: {
                  color:
                    group?.groupId === selectedGroup?.groupId &&
                    theme.palette.text.primary,
                  fontSize: '16px',
                },
              }} // Change the color of the primary text
              secondaryTypographyProps={{
                style: {
                  color:
                    group?.groupId === selectedGroup?.groupId &&
                    theme.palette.text.primary,
                  fontSize: '12px',
                },
              }}
              sx={{
                width: '150px',
                fontFamily: 'Inter',
                fontSize: '16px',
              }}
            />
            {announcement && !announcement?.seentimestamp && (
              <CampaignIcon
                sx={{
                  color: theme.palette.other.unread,
                  marginRight: '5px',
                  marginBottom: 'auto',
                }}
              />
            )}
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
                justifyContent: 'flex-start',
                height: '100%',
                marginBottom: 'auto',
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
                    }}
                  />
                )}
              {groupProperty?.isOpen === false && (
                <LockIcon
                  sx={{
                    color: theme.palette.other.positive,
                    marginBottom: 'auto',
                  }}
                />
              )}
            </Box>
          </Box>
        </ContextMenu>
      </ListItem>
    );
  }
);
