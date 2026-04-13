import {
  Avatar,
  Box,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  useTheme,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LockIcon from '@mui/icons-material/Lock';
import { useState } from 'react';
import { alpha } from '@mui/material/styles';
import {
  AppsHorizontalTabButton,
  AppsHorizontalTabLabel,
} from './Apps-styles';
import { getBaseApiReact } from '../../App';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';

type TabComponentProps = {
  app: any;
  onDuplicate: () => void;
  isSelected: boolean;
  onClose: () => void;
  onSelect: () => void;
};

const TabComponent = ({
  app,
  onDuplicate,
  isSelected,
  onClose,
  onSelect,
}: TabComponentProps) => {
  const theme = useTheme();
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const label =
    app?.privateAppProperties?.name || app?.metadata?.title || app?.name || '';

  return (
    <AppsHorizontalTabButton
      disableRipple
      onClick={onSelect}
      onContextMenu={(event) => {
        event.preventDefault();
        onSelect();
        setMenuPosition({
          left: event.clientX,
          top: event.clientY,
        });
      }}
      sx={{
        backgroundColor: isSelected
          ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.78 : 0.88)
          : theme.palette.mode === 'dark'
            ? alpha(theme.palette.common.white, 0.03)
            : alpha(theme.palette.common.black, 0.03),
        borderColor: isSelected
          ? 'transparent'
          : theme.palette.mode === 'dark'
            ? alpha(theme.palette.common.white, 0.03)
            : alpha(theme.palette.common.black, 0.04),
        boxShadow: 'none',
        color: isSelected
          ? theme.palette.primary.contrastText
          : theme.palette.text.secondary,
        opacity: 1,
        transition:
          'background-color 180ms ease, color 180ms ease, border-color 180ms ease',
        '&:hover': {
          backgroundColor: isSelected
            ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.86 : 0.94)
            : theme.palette.mode === 'dark'
              ? alpha(theme.palette.common.white, 0.06)
              : alpha(theme.palette.common.black, 0.06),
          color: theme.palette.text.primary,
        },
      }}
    >
      {app?.isPrivate && !app?.privateAppProperties?.logo ? (
        <Box
          sx={{
            alignItems: 'center',
            color: isSelected
              ? theme.palette.primary.contrastText
              : theme.palette.text.secondary,
            display: 'flex',
            height: '22px',
            justifyContent: 'center',
            width: '22px',
          }}
        >
          <LockIcon sx={{ fontSize: 16 }} />
        </Box>
      ) : (
        <Avatar
          sx={{
            height: '22px',
            width: '22px',
          }}
          alt={label}
          src={
            app?.privateAppProperties?.logo
              ? app?.privateAppProperties?.logo
              : `${getBaseApiReact()}/arbitrary/THUMBNAIL/${
                  app?.name
                }/qortal_avatar?async=true`
          }
        >
          <img
            style={{
              width: '22px',
              height: 'auto',
            }}
            src={LogoSelected}
            alt="center-icon"
          />
        </Avatar>
      )}

      <AppsHorizontalTabLabel
        sx={{
          color: isSelected
            ? theme.palette.primary.contrastText
            : theme.palette.text.secondary,
          fontWeight: 500,
        }}
      >
        {label}
      </AppsHorizontalTabLabel>

      <IconButton
        disableRipple
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        size="small"
        sx={{
          color: isSelected
            ? alpha(theme.palette.primary.contrastText, 0.92)
            : theme.palette.text.secondary,
          flexShrink: 0,
          height: 22,
          width: 22,
          opacity: isSelected ? 0.92 : 0.76,
          '&:hover': {
            backgroundColor: isSelected
              ? alpha(theme.palette.primary.contrastText, 0.14)
              : theme.palette.action.selected,
            color: isSelected
              ? theme.palette.primary.contrastText
              : theme.palette.text.primary,
            opacity: 1,
          },
        }}
      >
        <CloseRoundedIcon sx={{ fontSize: 15 }} />
      </IconButton>

      <Menu
        open={!!menuPosition}
        onClose={() => setMenuPosition(null)}
        anchorReference="anchorPosition"
        anchorPosition={
          menuPosition
            ? { top: menuPosition.top, left: menuPosition.left }
            : undefined
        }
        slotProps={{
          paper: {
            sx: {
              backgroundColor: theme.palette.background.default,
              border: `1px solid ${theme.palette.border.subtle}`,
              borderRadius: '6px',
              color: theme.palette.text.primary,
              width: '164px',
            },
          },
        }}
      >
        <MenuItem
          onClick={() => {
            onDuplicate();
            setMenuPosition(null);
          }}
        >
          <ListItemIcon
            sx={{
              minWidth: '24px !important',
              marginRight: '6px',
            }}
          >
            <ContentCopyIcon
              sx={{
                color: theme.palette.text.primary,
                fontSize: 18,
              }}
            />
          </ListItemIcon>

          <ListItemText
            sx={{
              '& .MuiTypography-root': {
                fontSize: '12px',
                fontWeight: 600,
                color: theme.palette.text.primary,
              },
            }}
            primary="Duplicate Tab"
          />
        </MenuItem>
      </Menu>
    </AppsHorizontalTabButton>
  );
};

export default TabComponent;
