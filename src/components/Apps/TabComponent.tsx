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
          ? theme.palette.background.paper
          : theme.palette.action.hover,
        borderColor: isSelected
          ? theme.palette.border.subtle
          : 'transparent',
        boxShadow: isSelected ? theme.shadows[1] : 'none',
        color: isSelected
          ? theme.palette.text.primary
          : theme.palette.text.secondary,
        opacity: isSelected ? 1 : 0.82,
        transition:
          'background-color 180ms ease, color 180ms ease, opacity 180ms ease, box-shadow 180ms ease',
        '&:hover': {
          backgroundColor: isSelected
            ? theme.palette.background.paper
            : theme.palette.action.selected,
          opacity: 1,
        },
      }}
    >
      {app?.isPrivate && !app?.privateAppProperties?.logo ? (
        <Box
          sx={{
            alignItems: 'center',
            color: isSelected
              ? theme.palette.text.primary
              : theme.palette.text.secondary,
            display: 'flex',
            height: '26px',
            justifyContent: 'center',
            width: '26px',
          }}
        >
          <LockIcon sx={{ fontSize: 18 }} />
        </Box>
      ) : (
        <Avatar
          sx={{
            height: '26px',
            width: '26px',
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
              width: '26px',
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
            ? theme.palette.text.primary
            : theme.palette.text.secondary,
        }}
      >
        {label}
      </AppsHorizontalTabLabel>

      <IconButton
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        size="small"
        sx={{
          color: isSelected
            ? theme.palette.text.primary
            : theme.palette.text.secondary,
          flexShrink: 0,
          height: 24,
          width: 24,
          '&:hover': {
            backgroundColor: theme.palette.action.selected,
            color: theme.palette.text.primary,
          },
        }}
      >
        <CloseRoundedIcon sx={{ fontSize: 16 }} />
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
              borderRadius: '8px',
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
