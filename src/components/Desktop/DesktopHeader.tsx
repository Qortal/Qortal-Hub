import { useState } from 'react';
import { useAtomValue } from 'jotai';
import { ButtonBase, Typography, useTheme } from '@mui/material';
import {
  groupChatHasUnreadAtom,
  groupsAnnHasUnreadAtom,
  hasUnreadGroupsAtom,
  isUnreadChatAtomFamily,
} from '../../atoms/global';
import Box from '@mui/material/Box';
import { NotificationIcon2 } from '../../assets/Icons/NotificationIcon2';
import { ChatIcon } from '../../assets/Icons/ChatIcon';
import { ThreadsIcon } from '../../assets/Icons/ThreadsIcon';
import { MembersIcon } from '../../assets/Icons/MembersIcon';
import { AdminsIcon } from '../../assets/Icons/AdminsIcon';
import LockIcon from '@mui/icons-material/Lock';
import NoEncryptionGmailerrorredIcon from '@mui/icons-material/NoEncryptionGmailerrorred';
import { useTranslation } from 'react-i18next';

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
        alignItems: 'center',
        backgroundColor: selected
          ? selectColor || 'rgba(28, 29, 32, 1)'
          : 'transparent',
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        height: customHeight || '60px',
        justifyContent: 'center',
        minWidth: '72px',
        padding: '8px 4px',
        transition: 'background-color 0.15s ease',
      }}
    >
      {children}
      <Typography
        sx={{
          color: color,
          fontFamily: 'Inter',
          fontSize: '11px',
          fontWeight: 500,
          letterSpacing: '0.01em',
          lineHeight: 1.2,
          textAlign: 'center',
          whiteSpace: 'nowrap',
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
  goToChat,
  goToThreads,
  setOpenManageMembers,
  directChatHasUnread,
  chatMode,
  openDrawerGroups,
  goToHome,
  setIsOpenDrawerProfile,
  mobileViewMode,
  setMobileViewMode,
  setMobileViewModeKeepOpen,
  hasUnreadDirects,
  isHome,
  isGroups,
  isDirects,
  setDesktopSideView,
  hasUnreadAnnouncements,
  isAnnouncement,
  isChat,
  isForum,
  setGroupSection,
  isPrivate,
}) => {
  const [value, setValue] = useState(0);
  const theme = useTheme();
  const groupChatHasUnread = useAtomValue(groupChatHasUnreadAtom);
  const groupsAnnHasUnread = useAtomValue(groupsAnnHasUnreadAtom);
  const hasUnreadGroups = useAtomValue(hasUnreadGroupsAtom);
  const isUnreadChat = useAtomValue(
    isUnreadChatAtomFamily(selectedGroup?.groupId ?? '')
  );
  const hasUnreadChat = isUnreadChat;
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  return (
    <Box
      sx={{
        alignItems: 'center',
        borderBottom: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        height: '64px',
        justifyContent: 'space-between',
        padding: '0 16px',
        width: '100%',
        zIndex: 1,
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: '10px',
        }}
      >
        {isPrivate && (
          <LockIcon
            sx={{
              color: theme.palette.other.positive,
              fontSize: '20px',
            }}
          />
        )}

        {isPrivate === false && (
          <NoEncryptionGmailerrorredIcon
            sx={{
              color: theme.palette.other.danger,
              fontSize: '20px',
            }}
          />
        )}

        <Typography
          sx={{
            fontSize: '16px',
            fontWeight: 600,
            letterSpacing: '0.01em',
          }}
        >
          {selectedGroup?.groupId === '0'
            ? t('core:general', { postProcess: 'capitalizeFirstChar' })
            : selectedGroup?.groupName}
        </Typography>
      </Box>

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: '8px',
          visibility: selectedGroup?.groupId === '0' ? 'hidden' : 'visible',
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
            label={t('core:announcement', {
              postProcess: 'capitalizeFirstChar',
            })}
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
          sx={{
            borderRadius: '12px',
            '&:hover': {
              backgroundColor: theme.palette.action.hover,
            },
          }}
        >
          <IconWrapper
            color={
              isChat ? theme.palette.text.primary : theme.palette.text.secondary
            }
            label={t('core:chat', { postProcess: 'capitalizeFirstChar' })}
            selected={isChat}
            selectColor={theme.palette.action.selected}
            customHeight="56px"
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
          sx={{
            borderRadius: '12px',
            '&:hover': {
              backgroundColor: theme.palette.action.hover,
            },
          }}
        >
          <IconWrapper
            color={
              isForum
                ? theme.palette.text.primary
                : theme.palette.text.secondary
            }
            label={t('core:thread_other', {
              postProcess: 'capitalizeFirstChar',
            })}
            selected={isForum}
            selectColor={theme.palette.action.selected}
            customHeight="56px"
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
          sx={{
            borderRadius: '12px',
            '&:hover': {
              backgroundColor: theme.palette.action.hover,
            },
          }}
        >
          <IconWrapper
            color={theme.palette.text.secondary}
            customHeight="56px"
            label={t('group:group.member_other', {
              postProcess: 'capitalizeFirstChar',
            })}
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
          sx={{
            borderRadius: '12px',
            '&:hover': {
              backgroundColor: theme.palette.action.hover,
            },
          }}
        >
          <IconWrapper
            color={
              groupSection === 'adminSpace'
                ? theme.palette.text.primary
                : theme.palette.text.secondary
            }
            label={t('core:admin_other', {
              postProcess: 'capitalizeFirstChar',
            })}
            selected={groupSection === 'adminSpace'}
            customHeight="56px"
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
