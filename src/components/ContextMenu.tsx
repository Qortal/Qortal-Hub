import { useState, useRef, useMemo } from 'react';
import {
  ListItemIcon,
  Menu,
  MenuItem,
  Typography,
  styled,
  useTheme,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import { executeEvent } from '../utils/events';
import { mutedGroupsAtom } from '../atoms/global';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

const CustomStyledMenu = styled(Menu)(({ theme }) => ({
  '& .MuiPaper-root': {
    // backgroundColor: '#f9f9f9',
    borderRadius: '12px',
    padding: theme.spacing(1),
    boxShadow: '0 5px 15px rgba(0, 0, 0, 0.2)',
  },
  '& .MuiMenuItem-root': {
    fontSize: '14px', // Smaller font size for the menu item text
    // color: '#444',
    transition: '0.3s background-color',
    '&:hover': {
      backgroundColor: theme.palette.action.hover, // Explicit hover state
    },
  },
}));

export const ContextMenu = ({ children, groupId, getUserSettings }) => {
  const [menuPosition, setMenuPosition] = useState(null);
  const longPressTimeout = useRef(null);
  const preventClick = useRef(false); // Flag to prevent click after long-press or right-click
  const theme = useTheme();
  const { t } = useTranslation(['group', 'core']);
  const [mutedGroups] = useAtom(mutedGroupsAtom);

  const isMuted = useMemo(() => {
    return mutedGroups.includes(groupId);
  }, [mutedGroups, groupId]);

  // Handle right-click (context menu) for desktop
  const handleContextMenu = (event) => {
    event.preventDefault();
    event.stopPropagation(); // Prevent parent click

    // Set flag to prevent any click event after right-click
    preventClick.current = true;

    setMenuPosition({
      mouseX: event.clientX,
      mouseY: event.clientY,
    });
  };

  // Handle long-press for mobile
  const handleTouchStart = (event) => {
    longPressTimeout.current = setTimeout(() => {
      preventClick.current = true; // Prevent the next click after long-press
      event.stopPropagation(); // Prevent parent click
      setMenuPosition({
        mouseX: event.touches[0].clientX,
        mouseY: event.touches[0].clientY,
      });
    }, 500); // Long press duration
  };

  const handleTouchEnd = (event) => {
    clearTimeout(longPressTimeout.current);

    if (preventClick.current) {
      event.preventDefault();
      event.stopPropagation(); // Prevent synthetic click after long-press
      preventClick.current = false; // Reset the flag
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
          } else {
            console.log('User settings added successfully');
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
      onContextMenu={handleContextMenu} // For desktop right-click
      onTouchStart={handleTouchStart} // For mobile long-press start
      onTouchEnd={handleTouchEnd} // For mobile long-press end
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
            Mark As Read
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
            {isMuted ? 'Unmute ' : 'Mute '}Push Notifications
          </Typography>
        </MenuItem>
        {!(groupId === 0 || groupId === '0') && (
          <MenuItem
            onClick={async (e) => {
              handleClose(e);
              try {
                const link = `qortal://use-group/action-join/groupid-${groupId}`;
                await navigator.clipboard.writeText(link);
              } catch (err) {
                console.error('Failed to copy join link', err);
              }
            }}
          >
            <ListItemIcon sx={{ minWidth: '32px' }}>
              <ContentCopyIcon
                fontSize="small"
                sx={{ color: theme.palette.text.primary }}
              />
            </ListItemIcon>
            <Typography variant="inherit" sx={{ fontSize: '14px' }}>
              {t('group:join_link', { postProcess: 'capitalizeEachFirstChar' })}: {t(groupId)}
            </Typography>
          </MenuItem>
        )}
      </CustomStyledMenu>
    </div>
  );
}; // TODO translate
