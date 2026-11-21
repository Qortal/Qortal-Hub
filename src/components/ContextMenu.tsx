import { useId, useState, useRef, useMemo, useContext, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Box,
  Checkbox,
  Divider,
  Menu as MuiMenu,
  Typography,
  styled,
  useTheme,
} from '@mui/material';
import { Menu, Item, Separator, contextMenu } from 'react-contexify';
import 'react-contexify/dist/ReactContexify.css';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import FolderRoundedIcon from '@mui/icons-material/FolderRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import { useTranslation } from 'react-i18next';
import { executeEvent } from '../utils/events';
import { txListAtom, notificationSettingsCacheAtom } from '../atoms/global';
import { useSetAtom, useAtomValue } from 'jotai';
import { getBaseApiReact, QORTAL_APP_CONTEXT } from '../App';
import { getFee } from '../background/background.ts';
import { QORTAL_PROTOCOL } from '../constants/constants.ts';
import { CustomizedSnackbars } from './Snackbar/Snackbar';
import { GroupScoreBadge } from './Group/ReticulumGroupLevel';
import { NotificationSettingsSubmenu } from './NotificationSettingsSubmenu';
import { MuteSubmenu } from './MuteSubmenu';
import { SortGroupsSubmenu } from './Group/SortGroupsSubmenu';
import { setHideMutedChannels } from '../utils/qChatNotificationSettings';
import { useReticulumGroupScore } from './Group/reticulumGroupScore';

export const CustomStyledMenu = styled(MuiMenu, {
  shouldForwardProp: (prop) => prop !== 'reticulumMenu',
})(({ theme, reticulumMenu }) => ({
  '& .MuiPaper-root': {
    ...(reticulumMenu
      ? {
          backgroundImage: 'none',
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: '8px',
          boxShadow: '0 12px 28px rgba(0, 0, 0, 0.28)',
          minWidth: 220,
          padding: theme.spacing(0.65),
        }
      : {
          borderRadius: '12px',
          boxShadow: '0 5px 15px rgba(0, 0, 0, 0.2)',
          padding: theme.spacing(1),
        }),
  },
  '& .MuiMenuItem-root': {
    fontSize: '13px',
    ...(reticulumMenu
      ? {
          borderRadius: '6px',
          fontWeight: 600,
          minHeight: 36,
          padding: theme.spacing(0.65, 1),
          transition: 'background-color 120ms ease',
        }
      : { transition: '0.3s background-color' }),
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
  },
}));

const ReticulumMenuGroupScore = ({
  groupId,
}: {
  groupId?: string | number;
}) => {
  const score = useReticulumGroupScore(groupId);
  if (!score) return null;
  return (
    <Box sx={{ px: 0.15, pt: 0.25 }}>
      <GroupScoreBadge score={score} size="menu" />
    </Box>
  );
};

const itemIconSx = { fontSize: 18, mr: 1.5 } as const;
const itemTextSx = { fontSize: '14px', fontWeight: 600 } as const;

function HideMutedChannelsItem({ groupId }: { groupId: string | number }) {
  const { t } = useTranslation(['group']);
  const cache = useAtomValue(notificationSettingsCacheAtom);
  const groupSettings = cache[String(groupId)];
  const hideMuted = groupSettings?.hideMutedChannels === true;

  const toggle = () => {
    void setHideMutedChannels(groupId, !hideMuted);
  };

  return (
    <Item closeOnClick={false} onClick={toggle}>
      <Checkbox
        size="small"
        checked={hideMuted}
        sx={{
          mr: 1.5,
          pointerEvents: 'none',
          padding: 0,
          '& .MuiSvgIcon-root': { fontSize: 18 },
        }}
      />
      <Typography component="span" sx={itemTextSx}>
        {t('group:context_menu.hide_muted_channels')}
      </Typography>
    </Item>
  );
}

export const ContextMenu = ({
  children,
  groupId,
  getUserSettings,
  myAddress = '',
  onMenuOpenChange = undefined,
  openOnClick = false,
  reticulumGroup = null,
  onCreateCategory = undefined,
  onCreateChannel = undefined,
  onOpenHiddenUsers = undefined,
  onOpenUpdateGroup = undefined,
  showGroupInfo = true,
  showStandardActions = true,
}) => {
  const menuId = useId();
  const [groupInfo, setGroupInfo] = useState(null);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const [isVisible, setIsVisible] = useState(false);
  const longPressTimeout = useRef(null);
  const preventClick = useRef(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const theme = useTheme();
  const setTxList = useSetAtom(txListAtom);
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const { t } = useTranslation(['core', 'group', 'reticulum']);

  const handleContextMenu = (event) => {
    if (!wrapperRef.current?.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    preventClick.current = true;
    contextMenu.show({ id: menuId, event });
  };

  const handleClick = (event) => {
    if (!openOnClick) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    contextMenu.show({
      id: menuId,
      event,
      position: { x: bounds.left, y: bounds.bottom + 4 },
    });
  };

  const handleTouchStart = (event) => {
    longPressTimeout.current = setTimeout(() => {
      preventClick.current = true;
      event.stopPropagation();
      const touch = event.touches[0];
      contextMenu.show({
        id: menuId,
        event,
        position: { x: touch.clientX, y: touch.clientY },
      });
    }, 500);
  };

  const handleTouchEnd = (event) => {
    clearTimeout(longPressTimeout.current);
    if (preventClick.current) {
      event.preventDefault();
      event.stopPropagation();
      preventClick.current = false;
    }
  };

  useEffect(() => {
    if (!isVisible || !reticulumGroup?.groupId) return undefined;
    const controller = new AbortController();
    fetch(`${getBaseApiReact()}/groups/${reticulumGroup.groupId}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('Unable to load group information');
        return response.json();
      })
      .then((data) => setGroupInfo(data))
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          console.error('Failed to load group information:', error);
        }
      });
    return () => controller.abort();
  }, [isVisible, reticulumGroup?.groupId]);

  const displayedGroupInfo = useMemo(
    () => ({
      ...reticulumGroup,
      ...groupInfo,
      groupId: groupInfo?.groupId ?? reticulumGroup?.groupId ?? groupId,
      groupName:
        groupInfo?.groupName ??
        reticulumGroup?.groupName ??
        reticulumGroup?.name ??
        t('reticulum:group_fallback_name'),
      memberCount: groupInfo?.memberCount ?? reticulumGroup?.memberCount ?? '-',
    }),
    [groupId, groupInfo, reticulumGroup, t]
  );
  const isGroupOwner =
    reticulumGroup?.isOwner === true ||
    Boolean(
      myAddress &&
      displayedGroupInfo?.owner &&
      displayedGroupInfo.owner === myAddress
    );
  const isClosedGroup =
    displayedGroupInfo?.isOpen === false ||
    Number(displayedGroupInfo?.groupType) === 1 ||
    displayedGroupInfo?.groupType === 'CLOSED';
  const groupTypeLabel = t(
    isClosedGroup ? 'reticulum:group_type.closed' : 'reticulum:group_type.open',
    { postProcess: 'capitalizeFirstChar' }
  );

  const copyInviteLink = async () => {
    contextMenu.hideAll();
    try {
      const link = `${QORTAL_PROTOCOL}use-group/action-join/groupid-${displayedGroupInfo.groupId}`;
      await navigator.clipboard.writeText(link);
      setInfoSnack({
        type: 'success',
        message: t('group:context_menu.invite_link_copied'),
      });
      setOpenSnack(true);
    } catch (error) {
      setInfoSnack({
        type: 'error',
        message: t('group:context_menu.invite_link_copy_failed'),
      });
      setOpenSnack(true);
    }
  };

  const leaveGroup = async () => {
    contextMenu.hideAll();
    try {
      const fee = await getFee('LEAVE_GROUP');
      await show({
        message: t('core:message.question.perform_transaction', {
          action: 'LEAVE_GROUP',
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: `${fee.fee} QORT`,
      });
      const response = await window.sendMessage('leaveGroup', {
        groupId: displayedGroupInfo.groupId,
      });
      if (response && typeof response === 'object' && 'error' in response)
        throw new Error((response as { error: string }).error);
      setTxList((previous) => [
        {
          ...(typeof response === 'object' && response ? response : {}),
          type: 'leave-group',
          label: t('group:message.success.group_leave_name', {
            group_name: displayedGroupInfo.groupName,
            postProcess: 'capitalizeFirstChar',
          }),
          labelDone: t('group:message.success.group_leave_label', {
            group_name: displayedGroupInfo.groupName,
            postProcess: 'capitalizeFirstChar',
          }),
          done: false,
          groupId: displayedGroupInfo.groupId,
        },
        ...previous,
      ]);
      setInfoSnack({
        type: 'success',
        message: t('group:message.success.group_leave', {
          postProcess: 'capitalizeFirstChar',
        }),
      });
      setOpenSnack(true);
    } catch (error) {
      if (error?.message) {
        setInfoSnack({ type: 'error', message: error.message });
        setOpenSnack(true);
      }
    }
  };

  const menuStyle = {
    '--contexify-menu-bgColor': theme.palette.background.paper,
    '--contexify-menu-shadow': '0 12px 28px rgba(0, 0, 0, 0.28)',
    '--contexify-menu-radius': '8px',
    '--contexify-menu-padding': '6px',
    '--contexify-menu-minWidth': '220px',
    '--contexify-item-color': theme.palette.text.primary,
    '--contexify-activeItem-color': theme.palette.text.primary,
    '--contexify-activeItem-bgColor': theme.palette.action.hover,
    '--contexify-activeItem-radius': '6px',
    '--contexify-itemContent-padding': '8px',
    '--contexify-separator-color': theme.palette.divider,
    '--contexify-separator-margin': '5px',
    '--contexify-rightSlot-color': theme.palette.text.secondary,
    '--contexify-arrow-color': theme.palette.text.primary,
    fontFamily: theme.typography.fontFamily,
  } as React.CSSProperties;

  return (
    <>
      <div
        ref={wrapperRef}
        onContextMenu={handleContextMenu}
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{ width: '100%', height: '100%' }}
      >
        {children}
      </div>
      {createPortal(
        <Menu
          id={menuId}
          theme={theme.palette.mode as 'light' | 'dark'}
          animation="fade"
          style={menuStyle}
          onVisibilityChange={(isVisible) => {
            setIsVisible(isVisible);
            onMenuOpenChange?.(isVisible);
          }}
        >
          {showStandardActions && (
            <>
              <Item onClick={() => executeEvent('markAsRead', { groupId })}>
                <MailOutlineIcon sx={itemIconSx} />
                <Typography component="span" sx={itemTextSx}>
                  {t('group:context_menu.mark_as_read')}
                </Typography>
              </Item>
              <Item onClick={() => executeEvent('markAllMemberGroupsRead', {})}>
                <DoneAllRoundedIcon sx={itemIconSx} />
                <Typography component="span" sx={itemTextSx}>
                  {t('group:context_menu.mark_all_groups_read')}
                </Typography>
              </Item>
              <SortGroupsSubmenu />
              <NotificationSettingsSubmenu scope={{ groupId }} />
              <MuteSubmenu scope={{ groupId }} scopeType="Group" />
              <HideMutedChannelsItem groupId={groupId} />
            </>
          )}
          {reticulumGroup && (
            <Item onClick={copyInviteLink}>
              <ContentCopyRoundedIcon sx={itemIconSx} />
              <Typography component="span" sx={itemTextSx}>
                {t('reticulum:copy_invite_link', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </Item>
          )}
          {reticulumGroup && isGroupOwner && onOpenUpdateGroup && (
            <Item
              onClick={() => {
                contextMenu.hideAll();
                onOpenUpdateGroup();
              }}
            >
              <EditRoundedIcon sx={itemIconSx} />
              <Typography component="span" sx={itemTextSx}>
                {t('group:context_menu.update_group')}
              </Typography>
            </Item>
          )}
          {reticulumGroup && onCreateChannel && (
            <Item
              onClick={() => {
                contextMenu.hideAll();
                onCreateChannel();
              }}
            >
              <ForumRoundedIcon sx={itemIconSx} />
              <Typography component="span" sx={itemTextSx}>
                {t('group:context_menu.create_channel')}
              </Typography>
            </Item>
          )}
          {reticulumGroup && onCreateCategory && (
            <Item
              onClick={() => {
                contextMenu.hideAll();
                onCreateCategory();
              }}
            >
              <FolderRoundedIcon sx={itemIconSx} />
              <Typography component="span" sx={itemTextSx}>
                {t('group:context_menu.create_category')}
              </Typography>
            </Item>
          )}
          {reticulumGroup && onOpenHiddenUsers && (
            <Item
              onClick={() => {
                contextMenu.hideAll();
                onOpenHiddenUsers();
              }}
            >
              <VisibilityOffRoundedIcon sx={itemIconSx} />
              <Typography component="span" sx={itemTextSx}>
                {t('group:context_menu.hidden_users')}
              </Typography>
            </Item>
          )}
          {reticulumGroup && !isGroupOwner && (
            <Item onClick={leaveGroup}>
              <LogoutRoundedIcon sx={{ ...itemIconSx, color: 'error.main' }} />
              <Typography
                component="span"
                sx={{ ...itemTextSx, color: 'error.main' }}
              >
                {t('group:context_menu.leave_group')}
              </Typography>
            </Item>
          )}
          {reticulumGroup && (
            <Item
              onClick={() => {
                contextMenu.hideAll();
                executeEvent('openReticulumGroupAbout', {
                  group: displayedGroupInfo,
                });
              }}
            >
              <InfoOutlinedIcon
                sx={{
                  ...itemIconSx,
                  color: theme.palette.mode === 'dark' ? '#a9c9ff' : '#1e40af',
                }}
              />
              <Typography
                component="span"
                sx={{
                  ...itemTextSx,
                  color: theme.palette.mode === 'dark' ? '#d7e6ff' : '#1e40af',
                }}
              >
                {t('group:context_menu.about_group')}
              </Typography>
            </Item>
          )}
          {reticulumGroup && isVisible && (
            <ReticulumMenuGroupScore groupId={displayedGroupInfo.groupId} />
          )}
          {reticulumGroup && showGroupInfo && (
            <>
              <div className="contexify_separator" />
              <Box
                sx={{
                  display: 'grid',
                  gap: 0.75,
                  minWidth: 230,
                  px: 1.25,
                  py: 0.5,
                }}
              >
                {[
                  {
                    id: 'group-name',
                    label: t('group:group.name'),
                    value: displayedGroupInfo.groupName,
                  },
                  {
                    id: 'members',
                    label: t('group:group.member_other'),
                    value: displayedGroupInfo.memberCount,
                  },
                  {
                    id: 'group-type',
                    label: t('group:group.type'),
                    value: groupTypeLabel,
                  },
                  {
                    id: 'group-id',
                    label: t('group:group.id'),
                    value: displayedGroupInfo.groupId,
                  },
                ].map(({ id, label, value }) => (
                  <Box
                    key={id}
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: 2,
                      justifyContent: 'space-between',
                    }}
                  >
                    <Typography
                      sx={{
                        color: 'text.secondary',
                        fontSize: 10,
                        fontWeight: 800,
                        textTransform: 'uppercase',
                      }}
                    >
                      {label}
                    </Typography>
                    <Typography
                      title={String(value ?? '-')}
                      sx={{
                        fontSize: 12,
                        fontWeight: 700,
                        maxWidth: 145,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {value ?? '-'}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </>
          )}
        </Menu>,
        document.body
      )}
      <CustomizedSnackbars
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />
    </>
  );
};
