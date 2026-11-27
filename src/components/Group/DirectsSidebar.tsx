import {
  Avatar,
  Box,
  ButtonBase,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import GroupRoundedIcon from '@mui/icons-material/GroupRounded';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';
import CreateIcon from '@mui/icons-material/Create';
import PersonOffIcon from '@mui/icons-material/PersonOff';
import MarkChatUnreadIcon from '@mui/icons-material/MarkChatUnread';
import PhoneMissedRoundedIcon from '@mui/icons-material/PhoneMissedRounded';
import { useTranslation } from 'react-i18next';
import React from 'react';
import { useAtomValue } from 'jotai';
import {
  groupChatHasUnreadAtom,
  groupsAnnHasUnreadAtom,
} from '../../atoms/global';
import { CustomButton } from '../../styles/App-styles';
import { HubsIcon } from '../../assets/Icons/HubsIcon';
import { MessagingIcon } from '../../assets/Icons/MessagingIcon';
import { formatEmailDate } from './qmailUtils';
import { AvatarPreviewModal } from '../Chat/AvatarPreviewModal';
import {
  getClickableAvatarSx,
  getFallbackAvatarOutlineSx,
} from '../Chat/clickableAvatarStyles';
import { effectivePresenceStatusAtomFamily } from '../../atoms/presence';
import type { DmFriendStored } from '../../atoms/global';
import { PresenceStatusBadge } from '../common/PresenceStatusBadge';
import { hasInvisibleCharacters } from '../../utils/hasInvisibleCharacters';
import qortalWhiteLogo from '../../assets/sidebar/qortal-logo-white.png';

const RETICULUM_ACTIVE_BLUE_DARK = '#2563eb';
const RETICULUM_ACTIVE_BLUE_LIGHT = '#5090e1';

/** Renders only the presence badge for a single DM address.
 * Subscribes to per-address atoms so a change to any other peer
 * does NOT trigger a re-render of this component.
 */
const DirectsPresenceBadge = React.memo(
  ({
    address,
    children,
    disabled = false,
  }: {
    address: string;
    children: React.ReactNode;
    disabled?: boolean;
  }) => {
    const status = useAtomValue(effectivePresenceStatusAtomFamily(address));
    if (disabled) return <>{children}</>;
    return (
      <PresenceStatusBadge online={status !== null} status={status}>
        {children}
      </PresenceStatusBadge>
    );
  }
);

export interface DirectsSidebarProps {
  setDesktopSideView: (view: 'groups' | 'directs') => void;
  desktopSideView: string;
  directChatHasUnread: boolean;
  directs: any[];
  dmFriendsByAddress: Record<string, DmFriendStored>;
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
  reticulumChatEnabled?: boolean;
}

export const DirectsSidebar = (props: DirectsSidebarProps) => {
  const groupChatHasUnread = useAtomValue(groupChatHasUnreadAtom);
  const groupsAnnHasUnread = useAtomValue(groupsAnnHasUnreadAtom);
  const {
    setDesktopSideView,
    desktopSideView,
    directChatHasUnread,
    directs,
    dmFriendsByAddress,
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
    reticulumChatEnabled = false,
  } = props;

  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <Box
      sx={{
        alignItems: 'flex-start',
        background: theme.palette.background.surface,
        borderRadius: reticulumChatEnabled ? 0 : '0 15px 15px 0',
        borderRight: reticulumChatEnabled ? '1px solid' : 'none',
        borderColor: 'divider',
        boxShadow: reticulumChatEnabled
          ? 'none'
          : '6px 0 20px rgba(0,0,0,0.18), 2px 0 8px rgba(0,0,0,0.08)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: reticulumChatEnabled ? { xs: 234, md: 286 } : '400px',
        padding: 0,
      }}
    >
      {!reticulumChatEnabled && (
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
      )}
      {reticulumChatEnabled && (
        <Box
          sx={{
            alignItems: 'center',
            borderBottom: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            gap: 1,
            justifyContent: 'space-between',
            minHeight: 62,
            px: '10px',
            py: '10px',
            width: '100%',
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={{
                color: 'text.primary',
                fontSize: 15,
                fontWeight: 800,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              Direct Messages
            </Typography>
            <Typography
              sx={{
                color: 'text.secondary',
                fontSize: 11,
                fontWeight: 600,
                mt: 0.25,
              }}
            >
              Private Reticulum chats
            </Typography>
          </Box>
          <Tooltip
            title={t('core:action.new.chat', {
              postProcess: 'capitalizeFirstChar',
            })}
          >
            <IconButton
              size="small"
              onClick={() => {
                setNewChat(true);
                setSelectedDirect(null);
                setIsOpenDrawer(false);
              }}
              sx={{ color: 'text.secondary', p: 0.5 }}
            >
              <CreateIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      <Box
        sx={{
          alignItems: 'flex-start',
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          overflowY: 'auto',
          padding: reticulumChatEnabled ? '10px' : '12px 8px',
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
          {directs.length === 0 && (
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: 13,
                lineHeight: 1.45,
                px: 1,
                py: 1.5,
              }}
            >
              No current private messages.
            </Typography>
          )}
          {directs.map((direct: any) => {
            const avatarUrl = direct?.savedMessages
              ? ''
              : getUserAvatarUrl(direct?.name);
            const avatarKey =
              direct?.address ||
              direct?.name ||
              `${direct?.timestamp}-${direct?.sender}`;
            const isAvatarLoaded = Boolean(
              avatarUrl && avatarKey && directAvatarLoaded[avatarKey]
            );
            const isSelected = direct?.address === selectedDirect?.address;
            const hasUnread =
              !reticulumChatEnabled &&
              direct?.sender !== myAddress &&
              direct?.timestamp &&
              ((!timestampEnterData[direct?.address] &&
                Date.now() - direct?.timestamp <
                  timeDifferenceForNotificationChats) ||
                timestampEnterData[direct?.address] < direct?.timestamp);
            const hasReticulumUnread =
              reticulumChatEnabled && Number(direct?.unreadCount || 0) > 0;
            const hasMissedCall =
              reticulumChatEnabled &&
              Number(direct?.unreadMissedCallCount || 0) > 0;
            const lastActivityIsCall = Boolean(
              reticulumChatEnabled &&
              direct?.lastCall &&
              Number(direct.lastCall.endedAt || 0) >=
                Number(direct?.lastMessageTimestamp || 0)
            );
            const callActivityLabel =
              direct?.lastCall?.outcome === 'missed'
                ? 'Missed call'
                : direct?.lastCall?.outcome === 'declined'
                  ? 'Declined call'
                  : direct?.lastCall?.outcome === 'no_answer'
                    ? 'No answer'
                    : direct?.lastCall?.outcome === 'cancelled'
                      ? 'Cancelled call'
                      : 'Voice call';
            const isDmFriend = Boolean(
              direct?.address && dmFriendsByAddress[direct.address]
            );
            const directName = direct?.name || direct?.address;
            const hasUnsafeName = Boolean(
              direct?.name && hasInvisibleCharacters(direct.name)
            );

            return (
              <ListItem
                key={direct?.address || avatarKey}
                onClick={() => {
                  setSelectedDirect(direct);
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
                  getTimestampEnterChat();
                }}
                sx={{
                  borderRadius: '10px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  marginBottom: '6px',
                  padding: reticulumChatEnabled ? '8px 9px' : '12px 14px',
                  position: 'relative',
                  width: '100%',
                  backgroundColor: isSelected
                    ? theme.palette.mode === 'dark'
                      ? RETICULUM_ACTIVE_BLUE_DARK
                      : RETICULUM_ACTIVE_BLUE_LIGHT
                    : 'transparent',
                  transition:
                    'background-color 0.15s ease, border-color 0.15s ease',
                  '&:hover': {
                    backgroundColor: isSelected
                      ? theme.palette.mode === 'dark'
                        ? RETICULUM_ACTIVE_BLUE_DARK
                        : RETICULUM_ACTIVE_BLUE_LIGHT
                      : theme.palette.action.hover,
                    '& .dm-friend-indicator': {
                      opacity: 1,
                    },
                  },
                }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    gap: reticulumChatEnabled ? '10px' : '20px',
                    width: '100%',
                  }}
                >
                  <ListItemAvatar sx={{ minWidth: 44, marginRight: 0 }}>
                    <DirectsPresenceBadge
                      address={direct?.address}
                      disabled={direct?.savedMessages === true}
                    >
                      <Avatar
                        sx={{
                          height: reticulumChatEnabled ? 34 : 40,
                          width: reticulumChatEnabled ? 34 : 40,
                          background: theme.palette.background.surface,
                          color: theme.palette.text.primary,
                          ...(!isAvatarLoaded
                            ? getFallbackAvatarOutlineSx(theme)
                            : {}),
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
                        {direct?.savedMessages ? (
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
                        ) : (
                          (direct?.name || direct?.address)?.charAt(0)
                        )}
                      </Avatar>
                    </DirectsPresenceBadge>
                  </ListItemAvatar>

                  <ListItemText
                    primary={directName}
                    secondary={
                      !direct?.timestamp
                        ? t('core:message.generic.no_messages', {
                            postProcess: 'capitalizeFirstChar',
                          })
                        : lastActivityIsCall
                          ? `${callActivityLabel} • ${formatEmailDate(direct?.timestamp)}`
                          : t('group:last_message_date', {
                              date: formatEmailDate(direct?.timestamp),
                              postProcess: 'capitalizeFirstChar',
                            })
                    }
                    primaryTypographyProps={{
                      sx: {
                        color:
                          hasUnread || hasReticulumUnread
                            ? theme.palette.primary.main
                            : theme.palette.text.primary,
                        fontFamily: 'Inter',
                        fontSize: reticulumChatEnabled ? '13px' : '15px',
                        fontWeight: 600,
                        lineHeight: 1.3,
                        ...(hasUnsafeName
                          ? {
                              textDecorationLine: 'line-through',
                              textDecorationThickness: '2px',
                              textDecorationColor: theme.palette.error.main,
                            }
                          : {}),
                      },
                    }}
                    secondaryTypographyProps={{
                      sx: {
                        color:
                          theme.palette.mode === 'dark'
                            ? 'rgb(240, 240, 240)'
                            : 'rgb(21, 26, 35)',
                        fontFamily: 'Inter',
                        fontSize: reticulumChatEnabled ? '11px' : '12px',
                        lineHeight: 1.4,
                        marginTop: '3px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      },
                    }}
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      margin: 0,
                      overflow: 'hidden',
                    }}
                  />

                  {direct?.savedMessages !== true && (
                    <Tooltip title={isDmFriend ? 'Friends' : 'Add Friend'}>
                      {isDmFriend ? (
                        <GroupRoundedIcon
                          className="dm-friend-indicator"
                          aria-label="Friends"
                          sx={{
                            color: theme.palette.primary.main,
                            fontSize: '19px',
                            flexShrink: 0,
                            marginLeft: '4px',
                            opacity: 1,
                            transition: 'opacity 0.15s ease',
                          }}
                        />
                      ) : (
                        <IconButton
                          className="dm-friend-indicator"
                          aria-label="Add Friend"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            window.dispatchEvent(
                              new CustomEvent('qchat:add-dm-friend', {
                                detail: {
                                  address: direct?.address,
                                  name: direct?.name,
                                },
                              })
                            );
                          }}
                          size="small"
                          sx={{
                            color: theme.palette.text.secondary,
                            flexShrink: 0,
                            marginLeft: '4px',
                            opacity: 0,
                            padding: 0,
                            transition: 'opacity 0.15s ease',
                          }}
                        >
                          <GroupOutlinedIcon sx={{ fontSize: '19px' }} />
                        </IconButton>
                      )}
                    </Tooltip>
                  )}
                  {(hasUnread || hasReticulumUnread) &&
                    (hasMissedCall ? (
                      <PhoneMissedRoundedIcon
                        sx={{
                          color: theme.palette.error.main,
                          fontSize: '18px',
                          flexShrink: 0,
                          marginLeft: '4px',
                        }}
                      />
                    ) : (
                      <MarkChatUnreadIcon
                        sx={{
                          color: theme.palette.primary.main,
                          fontSize: '18px',
                          flexShrink: 0,
                          marginLeft: '4px',
                        }}
                      />
                    ))}
                </Box>
              </ListItem>
            );
          })}
        </List>
      </Box>

      {!reticulumChatEnabled && (
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
      )}

      <AvatarPreviewModal
        open={Boolean(avatarPreviewData)}
        src={avatarPreviewData?.src || null}
        alt={avatarPreviewData?.alt}
        onClose={closeAvatarPreview}
      />
    </Box>
  );
};
