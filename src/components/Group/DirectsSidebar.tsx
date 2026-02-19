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
import CreateIcon from '@mui/icons-material/Create';
import PersonOffIcon from '@mui/icons-material/PersonOff';
import MarkChatUnreadIcon from '@mui/icons-material/MarkChatUnread';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import {
  groupChatHasUnreadAtom,
  groupsAnnHasUnreadAtom,
} from '../../atoms/global';
import { CustomButton } from '../../styles/App-styles';
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
      sx={{
        alignItems: 'flex-start',
        background: theme.palette.background.surface,
        borderRadius: '0 15px 15px 0',
        boxShadow: '6px 0 20px rgba(0,0,0,0.18), 2px 0 8px rgba(0,0,0,0.08)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '400px',
        padding: '0 2px 0 0',
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
          overflowY: 'auto',
          padding: '12px 8px',
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
          {directs.map((direct: any) => {
            const avatarUrl = getUserAvatarUrl(direct?.name);
            const avatarKey =
              direct?.address ||
              direct?.name ||
              `${direct?.timestamp}-${direct?.sender}`;
            const isAvatarLoaded = Boolean(
              avatarUrl && avatarKey && directAvatarLoaded[avatarKey]
            );
            const isSelected = direct?.address === selectedDirect?.address;
            const hasUnread =
              direct?.sender !== myAddress &&
              direct?.timestamp &&
              ((!timestampEnterData[direct?.address] &&
                Date.now() - direct?.timestamp <
                  timeDifferenceForNotificationChats) ||
                timestampEnterData[direct?.address] < direct?.timestamp);

            return (
              <ListItem
                key={direct?.timestamp + direct?.sender}
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
                  transition:
                    'background-color 0.15s ease, border-color 0.15s ease',
                  '&:hover': {
                    backgroundColor: isSelected
                      ? theme.palette.action.selected
                      : theme.palette.action.hover,
                  },
                }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    gap: '20px',
                    width: '100%',
                  }}
                >
                  <ListItemAvatar sx={{ minWidth: 44, marginRight: 0 }}>
                    <Avatar
                      sx={{
                        height: 40,
                        width: 40,
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
                    primaryTypographyProps={{
                      sx: {
                        color: hasUnread
                          ? theme.palette.primary.main
                          : theme.palette.text.primary,
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

                  {hasUnread && (
                    <MarkChatUnreadIcon
                      sx={{
                        color: theme.palette.primary.main,
                        fontSize: '18px',
                        flexShrink: 0,
                        marginLeft: '4px',
                      }}
                    />
                  )}
                </Box>
              </ListItem>
            );
          })}
        </List>
      </Box>

      <Box
        sx={{
          borderTop: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          width: '100%',
          gap: '10px',
          justifyContent: 'center',
          padding: '16px 12px',
        }}
      >
        <CustomButton
          onClick={() => {
            setNewChat(true);
            setSelectedDirect(null);
            setIsOpenDrawer(false);
          }}
          sx={{
            flex: 1,
            gap: '8px',
            padding: '10px 16px',
          }}
        >
          <CreateIcon
            sx={{
              color: theme.palette.text.primary,
              fontSize: '20px',
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
                color: theme.palette.text.secondary,
                fontSize: '22px',
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
