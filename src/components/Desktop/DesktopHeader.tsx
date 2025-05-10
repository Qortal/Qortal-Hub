import { useState } from 'react';
import { ButtonBase, Typography, useTheme } from '@mui/material';
import Box from '@mui/material/Box';
import { NotificationIcon2 } from '../../assets/Icons/NotificationIcon2';
import { ChatIcon } from '../../assets/Icons/ChatIcon';
import { ThreadsIcon } from '../../assets/Icons/ThreadsIcon';
import { MembersIcon } from '../../assets/Icons/MembersIcon';
import { AdminsIcon } from '../../assets/Icons/AdminsIcon';
import LockIcon from '@mui/icons-material/Lock';
import NoEncryptionGmailerrorredIcon from '@mui/icons-material/NoEncryptionGmailerrorred';

const IconWrapper = ({
  children,
  label,
  color,
  selected,
  selectColor,
  customHeight,
}) => {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '5px',
        flexDirection: 'column',
        height: customHeight ? customHeight : '65px',
        width: customHeight ? customHeight : '65px',
        borderRadius: '50%',
        backgroundColor: selected
          ? selectColor || 'rgba(28, 29, 32, 1)'
          : 'transparent',
      }}
    >
      {children}
      <Typography
        sx={{
          fontFamily: 'Inter',
          fontSize: '10px',
          fontWeight: 500,
          color: color,
        }}
      >
        {label}
      </Typography>
    </Box>
  );
};

export const DesktopHeader = ({
  selectedGroup,
  groupSection,
  isUnread,
  goToAnnouncements,
  isUnreadChat,
  goToChat,
  goToThreads,
  setOpenManageMembers,
  groupChatHasUnread,
  groupsAnnHasUnread,
  directChatHasUnread,
  chatMode,
  openDrawerGroups,
  goToHome,
  setIsOpenDrawerProfile,
  mobileViewMode,
  setMobileViewMode,
  setMobileViewModeKeepOpen,
  hasUnreadGroups,
  hasUnreadDirects,
  isHome,
  isGroups,
  isDirects,
  setDesktopSideView,
  hasUnreadAnnouncements,
  isAnnouncement,
  hasUnreadChat,
  isChat,
  isForum,
  setGroupSection,
  isPrivate,
}) => {
  const [value, setValue] = useState(0);
  const theme = useTheme();
  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        height: '70px', // Footer height
        justifyContent: 'space-between',
        padding: '10px',
        width: '100%',
        zIndex: 1,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          gap: '10px',
        }}
      >
        {isPrivate && (
          <LockIcon
            sx={{
              color: theme.palette.other.positive,
            }}
          />
        )}
        {isPrivate === false && (
          <NoEncryptionGmailerrorredIcon
            sx={{
              color: theme.palette.other.danger,
            }}
          />
        )}
        <Typography
          sx={{
            fontSize: '16px',
            fontWeight: 600,
          }}
        >
          {selectedGroup?.groupId === '0'
            ? 'General'
            : selectedGroup?.groupName}
        </Typography>
      </Box>

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: '20px',
          visibility: selectedGroup?.groupId === '0' ? 'hidden' : 'visibile',
        }}
      >
        <ButtonBase
          onClick={() => {
            goToAnnouncements();
          }}
        >
          <IconWrapper
            color={
              isAnnouncement
                ? theme.palette.text.primary
                : theme.palette.text.secondary
            }
            label="ANN"
            selected={isAnnouncement}
            selectColor={theme.palette.action.selected}
            customHeight="55px"
          >
            <NotificationIcon2
              height={25}
              width={20}
              color={
                isUnread
                  ? theme.palette.other.unread
                  : isAnnouncement
                    ? theme.palette.text.primary
                    : theme.palette.text.secondary
              }
            />
          </IconWrapper>
        </ButtonBase>

        <ButtonBase
          onClick={() => {
            goToChat();
          }}
        >
          <IconWrapper
            color={
              isChat ? theme.palette.text.primary : theme.palette.text.secondary
            }
            label="Chat"
            selected={isChat}
            selectColor={theme.palette.action.selected}
            customHeight="55px"
          >
            <ChatIcon
              height={25}
              width={20}
              color={
                isUnreadChat
                  ? theme.palette.other.unread
                  : isChat
                    ? theme.palette.text.primary
                    : theme.palette.text.secondary
              }
            />
          </IconWrapper>
        </ButtonBase>

        <ButtonBase
          onClick={() => {
            setGroupSection('forum');
          }}
        >
          <IconWrapper
            color={
              isForum
                ? theme.palette.text.primary
                : theme.palette.text.secondary
            }
            label="Threads"
            selected={isForum}
            selectColor={theme.palette.action.selected}
            customHeight="55px"
          >
            <ThreadsIcon
              height={25}
              width={20}
              color={
                isForum
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary
              }
            />
          </IconWrapper>
        </ButtonBase>

        <ButtonBase
          onClick={() => {
            setOpenManageMembers(true);
          }}
        >
          <IconWrapper
            color={theme.palette.text.secondary}
            customHeight="55px"
            label="Members"
            selected={false}
          >
            <MembersIcon
              color={theme.palette.text.secondary}
              height={25}
              width={20}
            />
          </IconWrapper>
        </ButtonBase>

        <ButtonBase
          onClick={() => {
            setGroupSection('adminSpace');
          }}
        >
          <IconWrapper
            color={
              groupSection === 'adminSpace'
                ? theme.palette.text.primary
                : theme.palette.text.secondary
            }
            label="Admins"
            selected={groupSection === 'adminSpace'}
            customHeight="55px"
            selectColor={theme.palette.action.selected}
          >
            <AdminsIcon
              height={25}
              width={20}
              color={
                groupSection === 'adminSpace'
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary
              }
            />
          </IconWrapper>
        </ButtonBase>
      </Box>
    </Box>
  );
};
