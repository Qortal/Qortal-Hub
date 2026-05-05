import { useState, useRef, useMemo } from 'react';
import {
  Divider,
  ListItemIcon,
  Menu,
  MenuItem,
  Typography,
  styled,
  useTheme,
} from '@mui/material';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import { useTranslation } from 'react-i18next';
import { executeEvent } from '../utils/events';
import { mutedGroupsAtom } from '../atoms/global';
import { useAtom } from 'jotai';

const CustomStyledMenu = styled(Menu)(({ theme }) => ({
  '& .MuiPaper-root': {
    borderRadius: '12px',
    padding: theme.spacing(1),
    boxShadow: '0 5px 15px rgba(0, 0, 0, 0.2)',
  },
  '& .MuiMenuItem-root': {
    fontSize: '14px',
    transition: '0.3s background-color',
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
  },
}));

export const ContextMenu = ({ children, groupId, getUserSettings }) => {
  const [menuPosition, setMenuPosition] = useState(null);
  const longPressTimeout = useRef(null);
  const preventClick = useRef(false);
  const theme = useTheme();
  const [mutedGroups] = useAtom(mutedGroupsAtom);
  const { t } = useTranslation(['group']);

  const isMuted = useMemo(() => {
    return mutedGroups.includes(groupId);
  }, [mutedGroups, groupId]);

  const handleContextMenu = (event) => {
    event.preventDefault();
    event.stopPropagation();

    preventClick.current = true;

    setMenuPosition({
      mouseX: event.clientX,
      mouseY: event.clientY,
    });
  };

  const handleTouchStart = (event) => {
    longPressTimeout.current = setTimeout(() => {
      preventClick.current = true;
      event.stopPropagation();
      setMenuPosition({
        mouseX: event.touches[0].clientX,
        mouseY: event.touches[0].clientY,
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

  const handleSetGroupMute = () => {
    try {
      let value = [...mutedGroups];
      if (isMuted) {
        value = value.filter((group) => group !== groupId);
      } else {
        value.push(groupId);
      }
      window
        .sendMessage('addUserSettings', {
          keyValue: {
            key: 'mutedGroups',
            value,
          },
        })
        .then((response) => {
          if (response?.error) {
            console.error('Error adding user settings:', response.error);
          }
        })
        .catch((error) => {
          console.error(
            'Failed to add user settings:',
            error.message || 'An error occurred'
          );
        });

      setTimeout(() => {
        getUserSettings();
      }, 400);
    } catch (error) {}
  };

  const handleClose = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuPosition(null);
  };

  return (
    <div
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{ width: '100%', height: '100%' }}
    >
      {children}

      <CustomStyledMenu
        disableAutoFocusItem
        open={!!menuPosition}
        onClose={handleClose}
        anchorReference="anchorPosition"
        anchorPosition={
          menuPosition
            ? { top: menuPosition.mouseY, left: menuPosition.mouseX }
            : undefined
        }
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <MenuItem
          onClick={(e) => {
            handleClose(e);
            executeEvent('markAsRead', {
              groupId,
            });
          }}
        >
          <ListItemIcon sx={{ minWidth: '32px' }}>
            <MailOutlineIcon
              sx={{
                color: theme.palette.text.primary,
              }}
              fontSize="small"
            />
          </ListItemIcon>
          <Typography variant="inherit" sx={{ fontSize: '14px' }}>
            {t('group:context_menu.mark_as_read')}
          </Typography>
        </MenuItem>
        <MenuItem
          onClick={(e) => {
            handleClose(e);
            handleSetGroupMute();
          }}
        >
          <ListItemIcon sx={{ minWidth: '32px' }}>
            <NotificationsOffIcon
              fontSize="small"
              sx={{
                color: isMuted ? 'red' : theme.palette.text.primary,
              }}
            />
          </ListItemIcon>
          <Typography
            variant="inherit"
            sx={{ fontSize: '14px', color: isMuted && 'red' }}
          >
            {isMuted
              ? t('group:context_menu.unmute_push_notifications')
              : t('group:context_menu.mute_push_notifications')}
          </Typography>
        </MenuItem>
        <Divider
          sx={{
            marginY: 1,
            marginX: 0.75,
            borderColor: theme.palette.divider,
          }}
        />
        <MenuItem
          onClick={(e) => {
            handleClose(e);
            executeEvent('markAllMemberGroupsRead', {});
          }}
        >
          <ListItemIcon sx={{ minWidth: '32px' }}>
            <DoneAllRoundedIcon
              fontSize="small"
              sx={{
                color: theme.palette.text.primary,
              }}
            />
          </ListItemIcon>
          <Typography variant="inherit" sx={{ fontSize: '14px' }}>
            {t('group:context_menu.mark_all_read')}
          </Typography>
        </MenuItem>
      </CustomStyledMenu>
    </div>
  );
};
