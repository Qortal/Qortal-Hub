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
import { memo, useCallback } from 'react';
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
  isRunningPublicNodeAtom,
  timestampEnterDataSelector,
} from '../../atoms/global';
import { timeDifferenceForNotificationChats } from './Group';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';

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

  return (
    <Box
      sx={{
        alignItems: 'flex-start',
        background: theme.palette.background.surface,
        borderRadius: '0px 15px 15px 0px',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '0px 2px',
        width: '380px',
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: '10px',
          justifyContent: 'center',
          width: '100%',
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
            label={t('group:group.group_other', {
              postProcess: 'capitalizeFirstChar',
            })}
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
            label={t('group:group.messaging', {
              postProcess: 'capitalizeFirstChar',
            })}
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

      <Box
        sx={{
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
      </Box>

      <Box
        sx={{
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
                color: theme.palette.text.secondary,
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
                }}
              />
            </CustomButton>
          )}
        </>
      </Box>
    </Box>
  );
};

const GroupItem = memo(
  ({ selectGroupFunc, group, selectedGroup, getUserSettings, myAddress }) => {
    const theme = useTheme();
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
            backgroundColor: 'action.hover',
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
              slotProps={{
                primary: {
                  style: {
                    color:
                      group?.groupId === selectedGroup?.groupId &&
                      theme.palette.text.primary,
                    fontSize: '16px',
                  },
                },
                secondary: {
                  style: {
                    color:
                      group?.groupId === selectedGroup?.groupId &&
                      theme.palette.text.primary,
                    fontSize: '12px',
                  },
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
