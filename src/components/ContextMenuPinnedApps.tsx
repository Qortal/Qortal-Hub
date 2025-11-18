import { useState, useRef } from 'react';
import {
  ListItemIcon,
  Menu,
  MenuItem,
  Typography,
  styled,
  useTheme,
} from '@mui/material';
import PushPinIcon from '@mui/icons-material/PushPin';
import { saveToLocalStorage } from './Apps/AppsNavBarDesktop';
import { sortablePinnedAppsAtom } from '../atoms/global';
import { useSetAtom } from 'jotai';
import { TIME_MILLISECONDS_1500, TIME_MILLISECONDS_500 } from '../constants/constants';

const CustomStyledMenu = styled(Menu)(({ theme }) => ({
  '& .MuiPaper-root': {
    borderRadius: '12px',
    padding: theme.spacing(1),
    boxShadow: '0 5px 15px rgba(0, 0, 0, 0.2)',
  },
  '& .MuiMenuItem-root': {
    fontSize: '14px',
    color: '#444',
    transition: '0.3s background-color',
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
  },
}));

export const ContextMenuPinnedApps = ({ children, app, isMine }) => {
  const [menuPosition, setMenuPosition] = useState(null);
  const longPressTimeout = useRef(null);
  const maxHoldTimeout = useRef(null);
  const preventClick = useRef(false);
  const startTouchPosition = useRef({ x: 0, y: 0 }); // Track initial touch position

  const setSortablePinnedApps = useSetAtom(sortablePinnedAppsAtom);

  const theme = useTheme();

  const handleContextMenu = (event) => {
    if (isMine) return;
    event.preventDefault();
    event.stopPropagation();
    preventClick.current = true;
    setMenuPosition({
      mouseX: event.clientX,
      mouseY: event.clientY,
    });
  };

  const handleTouchStart = (event) => {
    if (isMine) return;

    const { clientX, clientY } = event.touches[0];
    startTouchPosition.current = { x: clientX, y: clientY };

    longPressTimeout.current = setTimeout(() => {
      preventClick.current = true;

      event.stopPropagation();
      setMenuPosition({
        mouseX: clientX,
        mouseY: clientY,
      });
    }, TIME_MILLISECONDS_500);

    // Set a maximum hold duration
    maxHoldTimeout.current = setTimeout(() => {
      clearTimeout(longPressTimeout.current);
    }, TIME_MILLISECONDS_1500);
  };

  const handleTouchMove = (event) => {
    if (isMine) return;

    const { clientX, clientY } = event.touches[0];
    const { x, y } = startTouchPosition.current;

    // Determine if the touch has moved beyond a small threshold (e.g., 10px)
    const movedEnough =
      Math.abs(clientX - x) > 10 || Math.abs(clientY - y) > 10;

    if (movedEnough) {
      clearTimeout(longPressTimeout.current);
      clearTimeout(maxHoldTimeout.current);
    }
  };

  const handleTouchEnd = (event) => {
    if (isMine) return;

    clearTimeout(longPressTimeout.current);
    clearTimeout(maxHoldTimeout.current);
    if (preventClick.current) {
      event.preventDefault();
      event.stopPropagation();
      preventClick.current = false;
    }
  };

  const handleClose = (e) => {
    if (isMine) return;

    e.preventDefault();
    e.stopPropagation();
    setMenuPosition(null);
  };

  return (
    <div
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ touchAction: 'none' }}
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
            setSortablePinnedApps((prev) => {
              if (app?.isPrivate) {
                const updatedApps = prev.filter(
                  (item) =>
                    !(
                      item?.privateAppProperties?.name ===
                        app?.privateAppProperties?.name &&
                      item?.privateAppProperties?.service ===
                        app?.privateAppProperties?.service &&
                      item?.privateAppProperties?.identifier ===
                        app?.privateAppProperties?.identifier
                    )
                );
                saveToLocalStorage(
                  'ext_saved_settings',
                  'sortablePinnedApps',
                  updatedApps
                );
                return updatedApps;
              } else {
                const updatedApps = prev.filter(
                  (item) =>
                    !(
                      item?.name === app?.name && item?.service === app?.service
                    )
                );
                saveToLocalStorage(
                  'ext_saved_settings',
                  'sortablePinnedApps',
                  updatedApps
                );
                return updatedApps;
              }
            });
          }}
        >
          <ListItemIcon sx={{ minWidth: '32px' }}>
            <PushPinIcon
              sx={{
                color: theme.palette.text.primary,
              }}
              fontSize="small"
            />
          </ListItemIcon>
          <Typography sx={{ fontSize: '14px' }} color="text.primary">
            Unpin app
          </Typography>
        </MenuItem>
      </CustomStyledMenu>
    </div>
  );
};
