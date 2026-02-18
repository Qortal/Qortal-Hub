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
import CreateIcon from '@mui/icons-material/Create';
import PersonOffIcon from '@mui/icons-material/PersonOff';
import MarkChatUnreadIcon from '@mui/icons-material/MarkChatUnread';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import { groupChatHasUnreadAtom, groupsAnnHasUnreadAtom } from '../../atoms/global';
import { CustomButton } from '../../styles/App-styles';
import { IconWrapper } from '../Desktop/DesktopFooter';
import { HubsIcon } from '../../assets/Icons/HubsIcon';
import { MessagingIcon } from '../../assets/Icons/MessagingIcon';
import { formatEmailDate } from './QMailMessages';
import { AvatarPreviewModal } from '../Chat/AvatarPreviewModal';
import { getClickableAvatarSx } from '../Chat/clickableAvatarStyles';

export interface DirectsSidebarProps {
  setDesktopSideView: (view: 'groups' | 'directs') => void;
  desktopSideView: string;
  directChatHasUnread: boolean;
  directs: any[];
  getUserAvatarUrl: (name?: string) => string;
  directAvatarLoaded: Record<string, boolean>;
  setDirectAvatarLoaded: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  setSelectedDirect: (direct: any) => void;
  setNewChat: (value: boolean) => void;
  setIsOpenDrawer: (value: boolean) => void;
  getTimestampEnterChat: () => Promise<any>;
  selectedDirect: any;
  timestampEnterData: Record<string, number>;
  timeDifferenceForNotificationChats: number;
  myAddress: string;
  openAvatarPreview: (src: string | null, alt?: string) => void;
  avatarPreviewData: { src: string; alt: string } | null;
  closeAvatarPreview: () => void;
  isRunningPublicNode: boolean;
  setIsOpenBlockedUserModal: (value: boolean) => void;
}

export const DirectsSidebar = (props: DirectsSidebarProps) => {
  const groupChatHasUnread = useAtomValue(groupChatHasUnreadAtom);
  const groupsAnnHasUnread = useAtomValue(groupsAnnHasUnreadAtom);
  const {
    setDesktopSideView,
    desktopSideView,
    directChatHasUnread,
    directs,
    getUserAvatarUrl,
    directAvatarLoaded,
    setDirectAvatarLoaded,
    setSelectedDirect,
    setNewChat,
    setIsOpenDrawer,
    getTimestampEnterChat,
    selectedDirect,
    timestampEnterData,
    timeDifferenceForNotificationChats,
    myAddress,
    openAvatarPreview,
    avatarPreviewData,
    closeAvatarPreview,
    isRunningPublicNode,
    setIsOpenBlockedUserModal,
  } = props;

  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <Box
      style={{
        alignItems: 'flex-start',
        background: theme.palette.background.surface,
        borderRadius: '0px 15px 15px 0px',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '380px',
        padding: '0px 2px',
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
          overflowY: 'auto',
          width: '100%',
        }}
      >
        {directs.map((direct: any) => {
          const avatarUrl = getUserAvatarUrl(direct?.name);
          const avatarKey =
            direct?.address ||
            direct?.name ||
            `${direct?.timestamp}-${direct?.sender}`;
          const isAvatarLoaded = Boolean(
            avatarUrl && avatarKey && directAvatarLoaded[avatarKey]
          );

          return (
            <List
              key={direct?.timestamp + direct?.sender}
              sx={{
                width: '100%',
              }}
              className="group-list"
              dense={true}
            >
              <ListItem
                onClick={() => {
                  setSelectedDirect(null);
                  setNewChat(false);
                  setIsOpenDrawer(false);
                  window
                    .sendMessage('addTimestampEnterChat', {
                      timestamp: Date.now(),
                      groupId: direct.address,
                    })
                    .catch((error) => {
                      console.error(
                        'Failed to add timestamp:',
                        error.message || 'An error occurred'
                      );
                    });

                  setTimeout(() => {
                    setSelectedDirect(direct);

                    getTimestampEnterChat();
                  }, 200);
                }}
                sx={{
                  background:
                    direct?.address === selectedDirect?.address &&
                    theme.palette.background.surface,
                  borderRadius: '2px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '2px',
                  width: '100%',
                }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    width: '100%',
                  }}
                >
                  <ListItemAvatar>
                    <Avatar
                      sx={{
                        background: theme.palette.background.surface,
                        color: theme.palette.text.primary,
                        ...getClickableAvatarSx(theme, isAvatarLoaded),
                      }}
                      alt={direct?.name || direct?.address}
                      src={avatarUrl}
                      onClick={(event) => {
                        if (!avatarUrl || !isAvatarLoaded) return;
                        event.preventDefault();
                        event.stopPropagation();
                        openAvatarPreview(
                          avatarUrl,
                          direct?.name || direct?.address
                        );
                      }}
                      imgProps={{
                        onLoad: () => {
                          if (!avatarKey) return;
                          setDirectAvatarLoaded((prev) => {
                            if (prev[avatarKey]) return prev;
                            return {
                              ...prev,
                              [avatarKey]: true,
                            };
                          });
                        },
                        onError: () => {
                          if (!avatarKey) return;
                          setDirectAvatarLoaded((prev) => {
                            if (prev[avatarKey] === false) return prev;
                            return {
                              ...prev,
                              [avatarKey]: false,
                            };
                          });
                        },
                      }}
                    >
                      {(direct?.name || direct?.address)?.charAt(0)}
                    </Avatar>
                  </ListItemAvatar>

                  <ListItemText
                    primary={direct?.name || direct?.address}
                    secondary={
                      !direct?.timestamp
                        ? t('core:message.generic.no_messages', {
                            postProcess: 'capitalizeFirstChar',
                          })
                        : t('group:last_message_date', {
                            date: formatEmailDate(direct?.timestamp),
                            postProcess: 'capitalizeFirstChar',
                          })
                    }
                    slotProps={{
                      primary: {
                        style: {
                          color:
                            direct?.address === selectedDirect?.address &&
                            theme.palette.text.primary,
                          textWrap: 'wrap',
                          overflow: 'hidden',
                          fontSize: '16px',
                        },
                      },
                      secondary: {
                        style: {
                          color:
                            direct?.address === selectedDirect?.address &&
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

                  {direct?.sender !== myAddress &&
                    direct?.timestamp &&
                    ((!timestampEnterData[direct?.address] &&
                      Date.now() - direct?.timestamp <
                        timeDifferenceForNotificationChats) ||
                      timestampEnterData[direct?.address] <
                        direct?.timestamp) && (
                      <MarkChatUnreadIcon
                        sx={{
                          color: theme.palette.other.unread,
                        }}
                      />
                    )}
                </Box>
              </ListItem>
            </List>
          );
        })}
      </Box>

      <Box
        sx={{
          display: 'flex',
          width: '100%',
          gap: '10px',
          justifyContent: 'center',
          padding: '10px',
        }}
      >
        <CustomButton
          onClick={() => {
            setNewChat(true);
            setSelectedDirect(null);
            setIsOpenDrawer(false);
          }}
        >
          <CreateIcon
            sx={{
              color: theme.palette.text.primary,
            }}
          />
          {t('core:action.new.chat', {
            postProcess: 'capitalizeFirstChar',
          })}
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
      </Box>

      <AvatarPreviewModal
        open={Boolean(avatarPreviewData)}
        src={avatarPreviewData?.src || null}
        alt={avatarPreviewData?.alt}
        onClose={closeAvatarPreview}
      />
    </Box>
  );
};
