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
import CloseFullscreenRoundedIcon from '@mui/icons-material/CloseFullscreenRounded';
import LockIcon from '@mui/icons-material/Lock';
import { useRef, useState, type MutableRefObject } from 'react';
import { alpha } from '@mui/material/styles';
import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';
import {
  APP_BLUE_SURFACE_TEXT,
  getBlueTier1PillSurface,
} from '../../styles/blueMaterial';
import {
  AppsHorizontalTabButton,
  AppsHorizontalTabLabel,
} from './Apps-styles';
import { getBaseApiReact } from '../../App';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';

function devTabLabel(app: any): string {
  const base =
    app?.privateAppProperties?.name || app?.metadata?.title || app?.name || '';
  if (base) return base;
  const url = app?.url;
  if (typeof url === 'string' && url) {
    try {
      return new URL(url).hostname || url.slice(0, 28);
    } catch {
      return url.slice(0, 28);
    }
  }
  return 'Dev';
}

type TabComponentProps = {
  app: any;
  onCloseAll: () => void;
  onDuplicate: () => void;
  isEntering?: boolean;
  isSelected: boolean;
  isVisuallySelected?: boolean;
  onClose: () => void;
  onSelect: () => void;
  /** Dev-mode / local preview tabs (label + icon only; same chrome as app tabs) */
  isDevApp?: boolean;
  /** When false and the strip is wide enough, tab stays fixed at ~180px (measured in AppsDesktop). */
  tabStripCompresses?: boolean;
  /** Mutable drag-lock shared from AppsDesktop to avoid rerenders during drag. */
  tabInteractionLockedRef?: MutableRefObject<boolean>;
};

const TabComponent = ({
  app,
  onCloseAll,
  onDuplicate,
  isEntering = false,
  isSelected,
  isVisuallySelected = isSelected,
  onClose,
  onSelect,
  isDevApp = false,
  tabStripCompresses = true,
  tabInteractionLockedRef,
}: TabComponentProps) => {
  const theme = useTheme();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: app?.tabId,
  });
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const localInteractionLockRef = useRef(false);
  const interactionLockRef = tabInteractionLockedRef ?? localInteractionLockRef;

  const treatAsDevApp = Boolean(isDevApp);
  const label = treatAsDevApp
    ? devTabLabel(app)
    : app?.privateAppProperties?.name ||
      app?.metadata?.title ||
      app?.name ||
      '';
  const selectedTabSurface = getBlueTier1PillSurface(theme);
  const selectedTabTextColor = APP_BLUE_SURFACE_TEXT;
  const dndStyle = {
    transform: CSS.Transform.toString(
      transform
        ? {
            ...transform,
            scaleX: 1,
            scaleY: 1,
          }
        : null
    ),
    transition,
    zIndex: isDragging ? 5 : 'auto',
  };

  return (
    <AppsHorizontalTabButton
      ref={setNodeRef}
      disableRipple
      {...attributes}
      {...listeners}
      onClick={(event) => {
        if (interactionLockRef.current) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onSelect();
      }}
      onMouseDown={(event) => {
        if (interactionLockRef.current) {
          event.preventDefault();
          return;
        }
        if (event.button === 1) {
          event.preventDefault();
        }
      }}
      onAuxClick={(event) => {
        if (interactionLockRef.current) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (event.button !== 1) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onContextMenu={(event) => {
        if (interactionLockRef.current) {
          event.preventDefault();
          setMenuPosition(null);
          return;
        }
        event.preventDefault();
        onSelect();
        setMenuPosition({
          left: event.clientX,
          top: event.clientY,
        });
      }}
      sx={{
        background: isVisuallySelected
          ? selectedTabSurface.background
          : theme.palette.mode === 'dark'
            ? alpha(theme.palette.common.white, 0.03)
            : alpha(theme.palette.common.black, 0.03),
        borderColor: isVisuallySelected
          ? alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.045 : 0.035)
          : theme.palette.mode === 'dark'
            ? alpha(theme.palette.common.white, 0.03)
            : alpha(theme.palette.common.black, 0.04),
        boxShadow: isVisuallySelected ? selectedTabSurface.boxShadow : 'none',
        color: isVisuallySelected
          ? selectedTabTextColor
          : theme.palette.text.secondary,
        cursor: interactionLockRef.current || isDragging ? 'grabbing' : 'grab',
        opacity: isEntering ? 0 : 1,
        ...dndStyle,
        transform: `${dndStyle.transform || ''}${isEntering ? ' scale(0.96)' : ''}`.trim(),
        transition:
          `${transition ? `${transition}, ` : ''}background-color 180ms ease, color 180ms ease, border-color 180ms ease, box-shadow 180ms ease, opacity 180ms ease, transform 180ms ease`,
        animation: isEntering ? 'tabEntryFadeScale 190ms ease-out forwards' : 'none',
        ...(isDragging && {
          boxShadow:
            theme.palette.mode === 'dark'
              ? '0 10px 22px rgba(0,0,0,0.28)'
              : '0 10px 22px rgba(0,0,0,0.12)',
          opacity: 0.96,
        }),
        '&:hover': {
          background: isVisuallySelected
            ? selectedTabSurface.background
            : theme.palette.mode === 'dark'
              ? alpha(theme.palette.common.white, 0.06)
              : alpha(theme.palette.common.black, 0.06),
          boxShadow: isVisuallySelected ? selectedTabSurface.boxShadow : undefined,
          color: isVisuallySelected
            ? selectedTabTextColor
            : theme.palette.text.primary,
        },
        '@keyframes tabEntryFadeScale': {
          from: {
            opacity: 0,
            transform: `${dndStyle.transform || ''} scale(0.96)`.trim(),
          },
          to: {
            opacity: 1,
            transform: `${dndStyle.transform || ''} scale(1)`.trim(),
          },
        },
        ...(!tabStripCompresses && {
          flex: '0 0 180px',
          flexShrink: 0,
          maxWidth: '180px',
          minWidth: '180px',
          width: '180px',
        }),
      }}
    >
      {app?.isPrivate && !app?.privateAppProperties?.logo ? (
        <Box
          sx={{
            alignItems: 'center',
            color: isVisuallySelected
              ? selectedTabTextColor
              : theme.palette.text.secondary,
            display: 'flex',
            flexShrink: 0,
            height: '22px',
            justifyContent: 'center',
            width: '22px',
          }}
        >
          <LockIcon sx={{ fontSize: 16 }} />
        </Box>
      ) : treatAsDevApp ? (
        <Avatar
          sx={{
            flexShrink: 0,
            height: '22px',
            width: '22px',
          }}
          alt={label}
          src=""
        >
          <img
            style={{
              width: '22px',
              height: 'auto',
            }}
            src={
              app?.customIcon
                ? app.customIcon
                : LogoSelected
            }
            alt=""
          />
        </Avatar>
      ) : (
        <Avatar
          sx={{
            flexShrink: 0,
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
          color: isVisuallySelected
            ? selectedTabTextColor
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
          if (interactionLockRef.current) {
            event.preventDefault();
            return;
          }
          onClose();
        }}
        onAuxClick={(event) => {
          if (interactionLockRef.current) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (event.button !== 1) return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        size="small"
        sx={{
          color: isVisuallySelected
            ? alpha(selectedTabTextColor, 0.92)
            : theme.palette.text.secondary,
          flexShrink: 0,
          height: 22,
          width: 22,
          opacity: isVisuallySelected ? 1 : 0.76,
          '&:hover': {
            backgroundColor: isVisuallySelected
              ? alpha(selectedTabTextColor, 0.18)
              : theme.palette.action.selected,
            color: isVisuallySelected
              ? selectedTabTextColor
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
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
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
        <MenuItem
          onClick={() => {
            onCloseAll();
            setMenuPosition(null);
          }}
        >
          <ListItemIcon
            sx={{
              minWidth: '24px !important',
              marginRight: '6px',
            }}
          >
            <CloseFullscreenRoundedIcon
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
            primary="Close All Tabs"
          />
        </MenuItem>
      </Menu>
    </AppsHorizontalTabButton>
  );
};

export default TabComponent;
