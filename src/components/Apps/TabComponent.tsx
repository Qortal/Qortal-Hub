import {
  Avatar,
  Box,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  useTheme,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CloseFullscreenRoundedIcon from '@mui/icons-material/CloseFullscreenRounded';
import KeyboardTabRoundedIcon from '@mui/icons-material/KeyboardTabRounded';
import LockIcon from '@mui/icons-material/Lock';
import TabUnselectedRoundedIcon from '@mui/icons-material/TabUnselectedRounded';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import BookmarkAddOutlinedIcon from '@mui/icons-material/BookmarkAddOutlined';
import BookmarkRemoveOutlinedIcon from '@mui/icons-material/BookmarkRemoveOutlined';
import { useRef, useState, type MutableRefObject } from 'react';
import { alpha } from '@mui/material/styles';
import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';
import { AppsHorizontalTabButton, AppsHorizontalTabLabel } from './Apps-styles';
import { getBaseApiReact } from '../../App';
import { AppsIcon } from '../../assets/Icons/AppsIcon';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';
import { useTranslation } from 'react-i18next';
import { isLauncherTab } from './launcherTabs';
import { TAB_IDEAL_WIDTH_PX, tabShowsLabel } from './tabStripLayout';

/** The × of a narrow tab shows on hover through this class. */
const CLOSE_BUTTON_CLASS = 'app-tab-close';

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

/** How a tab was closed. */
export type TabCloseRequest = {
  /** With the mouse: a click on its × or a middle click, not the keyboard. */
  byPointer: boolean;
};

type TabComponentProps = {
  app: any;
  onCloseAll: () => void;
  /** Closes the other tabs. Without it, the menu item is greyed out. */
  onCloseOthers?: () => void;
  /** Closes the tabs after this one. Without it, the item is greyed out. */
  onCloseToTheRight?: () => void;
  onDuplicate: () => void;
  isEntering?: boolean;
  isSelected: boolean;
  isVisuallySelected?: boolean;
  onClose: (request?: TabCloseRequest) => void;
  onSelect: () => void;
  /** Dev-mode / local preview tabs (label + icon only; same chrome as app tabs) */
  isDevApp?: boolean;
  /**
   * A pinned tab shows only its icon, has no ×, and middle-click leaves it
   * open: it closes only once it is unpinned.
   */
  isPinned?: boolean;
  onTogglePin?: () => void;
  /**
   * Its Q-App or website is in the pinned apps and bookmarks (the launcher's
   * and the title bar's), which isn't the same as a pinned tab.
   */
  isPinnedToBookmarks?: boolean;
  /** Pins its app to the bookmarks, or unpins it; none for Hub's own tabs. */
  onTogglePinToBookmarks?: () => void;
  /** The tab's width, worked out for the whole strip in AppsDesktop. */
  widthPx?: number;
  /** Mutable drag-lock shared from AppsDesktop to avoid rerenders during drag. */
  tabInteractionLockedRef?: MutableRefObject<boolean>;
};

/**
 * Opens the menu of the tab at (x, y), under an open menu's backdrop
 * (`menuRoot`): the right-click goes to that tab as if nothing covered it.
 */
const openTabMenuAt = (x: number, y: number, menuRoot: Element) => {
  const tab = (document.elementsFromPoint?.(x, y) ?? []).find(
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      element.dataset.tabId !== undefined &&
      !menuRoot.contains(element)
  );
  tab?.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      button: 2,
      cancelable: true,
      clientX: x,
      clientY: y,
    })
  );
};

const TabComponent = ({
  app,
  onCloseAll,
  onCloseOthers,
  onCloseToTheRight,
  onDuplicate,
  isEntering = false,
  isSelected,
  isVisuallySelected = isSelected,
  onClose,
  onSelect,
  isDevApp = false,
  isPinned = false,
  onTogglePin,
  isPinnedToBookmarks = false,
  onTogglePinToBookmarks,
  widthPx = TAB_IDEAL_WIDTH_PX,
  tabInteractionLockedRef,
}: TabComponentProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
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
  const isLauncher = isLauncherTab(app);
  const canDuplicate = !app?.internal && !!app?.service;
  const label = isLauncher
    ? t('core:app_tab.new_tab', { postProcess: 'capitalizeFirstChar' })
    : treatAsDevApp
      ? devTabLabel(app)
      : app?.privateAppProperties?.name ||
        app?.metadata?.title ||
        app?.name ||
        '';
  // A narrow or pinned tab shows its icon, with its title in a tooltip.
  const iconOnly = isPinned || !tabShowsLabel(widthPx);
  // Next to the icon of a narrow tab there is room only for the × of the
  // selected tab; the others show theirs on hover or keyboard focus.
  const closeWaitsForHover = iconOnly && !isVisuallySelected;
  const menuItemTextSx = {
    '& .MuiTypography-root': {
      fontSize: '12px',
      fontWeight: 600,
      color: theme.palette.text.primary,
    },
  };
  const menuItemIconSx = {
    minWidth: '24px !important',
    marginRight: '6px',
  };
  // Active tabs stay close to the normal hover surface so the workspace, not
  // the tab strip, carries the visual focus.
  const selectedTabBackground =
    theme.palette.mode === 'dark'
      ? alpha(theme.palette.common.white, 0.09)
      : alpha(theme.palette.common.black, 0.09);
  const selectedTabHoverBackground =
    theme.palette.mode === 'dark'
      ? alpha(theme.palette.common.white, 0.102)
      : alpha(theme.palette.common.black, 0.102);
  const selectedTabBorder =
    theme.palette.mode === 'dark'
      ? alpha(theme.palette.common.white, 0.06)
      : alpha(theme.palette.common.black, 0.06);
  const selectedTabShadow =
    theme.palette.mode === 'dark'
      ? 'inset 0 1px 0 rgba(255, 255, 255, 0.045), 0 2px 7px rgba(0, 0, 0, 0.12)'
      : 'inset 0 1px 0 rgba(255, 255, 255, 0.34), 0 2px 7px rgba(0, 0, 0, 0.06)';
  const selectedTabTextColor = theme.palette.text.primary;
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

  const tabButton = (
    <AppsHorizontalTabButton
      ref={setNodeRef}
      disableRipple
      {...attributes}
      {...listeners}
      aria-label={label || undefined}
      data-pinned={isPinned ? 'true' : undefined}
      data-tab-id={app?.tabId}
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
        // A pinned tab is unpinned before it closes.
        if (isPinned) return;
        onClose({ byPointer: true });
      }}
      onContextMenu={(event) => {
        if (interactionLockRef.current) {
          event.preventDefault();
          setMenuPosition(null);
          return;
        }
        event.preventDefault();
        // The menu opens for this tab without switching to it.
        setMenuPosition({
          left: event.clientX,
          top: event.clientY,
        });
      }}
      sx={{
        background: isVisuallySelected
          ? selectedTabBackground
          : theme.palette.mode === 'dark'
            ? alpha(theme.palette.common.white, 0.03)
            : alpha(theme.palette.common.black, 0.03),
        borderColor: isVisuallySelected
          ? selectedTabBorder
          : theme.palette.mode === 'dark'
            ? alpha(theme.palette.common.white, 0.03)
            : alpha(theme.palette.common.black, 0.04),
        boxShadow: isVisuallySelected ? selectedTabShadow : 'none',
        color: isVisuallySelected
          ? selectedTabTextColor
          : theme.palette.text.secondary,
        cursor: 'default',
        opacity: isEntering ? 0 : 1,
        ...dndStyle,
        transform:
          `${dndStyle.transform || ''}${isEntering ? ' scale(0.96)' : ''}`.trim(),
        transition: `${transition ? `${transition}, ` : ''}background-color 180ms ease, color 180ms ease, border-color 180ms ease, box-shadow 180ms ease, opacity 180ms ease, transform 180ms ease`,
        animation: isEntering
          ? 'tabEntryFadeScale 190ms ease-out forwards'
          : 'none',
        ...(isDragging && {
          boxShadow:
            theme.palette.mode === 'dark'
              ? '0 10px 22px rgba(0,0,0,0.28)'
              : '0 10px 22px rgba(0,0,0,0.12)',
          opacity: 0.96,
        }),
        '&:hover': {
          background: isVisuallySelected
            ? selectedTabHoverBackground
            : theme.palette.mode === 'dark'
              ? alpha(theme.palette.common.white, 0.06)
              : alpha(theme.palette.common.black, 0.06),
          boxShadow: isVisuallySelected ? selectedTabShadow : undefined,
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
        flex: `0 0 ${widthPx}px`,
        maxWidth: `${widthPx}px`,
        minWidth: `${widthPx}px`,
        width: `${widthPx}px`,
        ...(iconOnly && {
          gap: '4px',
          justifyContent: 'center',
          padding: '0 6px',
        }),
        ...(closeWaitsForHover && {
          [`&:hover .${CLOSE_BUTTON_CLASS}, &:focus-within .${CLOSE_BUTTON_CLASS}`]:
            {
              display: 'inline-flex',
            },
        }),
      }}
    >
      {isLauncher ? (
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
          <AppsIcon color="currentColor" height={14} width={14} />
        </Box>
      ) : app?.isPrivate && !app?.privateAppProperties?.logo ? (
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
            src={app?.customIcon ? app.customIcon : LogoSelected}
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

      {!iconOnly && (
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
      )}

      {!isPinned && (
        <IconButton
          aria-label={t('core:app_tab.close', {
            postProcess: 'capitalizeFirstChar',
          })}
          className={CLOSE_BUTTON_CLASS}
          disableRipple
          onClick={(event) => {
            event.stopPropagation();
            if (interactionLockRef.current) {
              event.preventDefault();
              return;
            }
            // `detail` counts mouse clicks: it is 0 for Enter or Space. A tap
            // leaves no pointer on the strip, so it counts as a key.
            onClose({
              byPointer:
                event.detail > 0 &&
                (event.nativeEvent as PointerEvent).pointerType !== 'touch',
            });
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
            onClose({ byPointer: true });
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
            ...(closeWaitsForHover && { display: 'none' }),
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
      )}

      <Menu
        open={!!menuPosition}
        onClose={() => setMenuPosition(null)}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        // The menu's clicks stay in the menu: reaching the tab it belongs to,
        // they would switch to that tab, or close it on a middle click.
        onClick={(event) => event.stopPropagation()}
        onAuxClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          // A right-click outside the menu closes it, and the tab under the
          // pointer (this one or another) opens its own menu there.
          const target = event.target as HTMLElement;
          if (target.closest?.('.MuiMenu-paper')) return;
          setMenuPosition(null);
          openTabMenuAt(event.clientX, event.clientY, event.currentTarget);
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
              minWidth: '164px',
            },
          },
        }}
      >
        {onTogglePin && (
          <MenuItem
            onClick={() => {
              onTogglePin();
              setMenuPosition(null);
            }}
          >
            <ListItemIcon sx={menuItemIconSx}>
              {isPinned ? (
                <PushPinIcon
                  sx={{
                    color: theme.palette.text.primary,
                    fontSize: 18,
                  }}
                />
              ) : (
                <PushPinOutlinedIcon
                  sx={{
                    color: theme.palette.text.primary,
                    fontSize: 18,
                  }}
                />
              )}
            </ListItemIcon>

            <ListItemText
              sx={menuItemTextSx}
              primary={t(isPinned ? 'core:app_tab.unpin' : 'core:app_tab.pin', {
                postProcess: 'capitalizeFirstChar',
              })}
            />
          </MenuItem>
        )}
        {onTogglePinToBookmarks && (
          <MenuItem
            onClick={() => {
              onTogglePinToBookmarks();
              setMenuPosition(null);
            }}
          >
            <ListItemIcon sx={menuItemIconSx}>
              {isPinnedToBookmarks ? (
                <BookmarkRemoveOutlinedIcon
                  sx={{ color: theme.palette.text.primary, fontSize: 18 }}
                />
              ) : (
                <BookmarkAddOutlinedIcon
                  sx={{ color: theme.palette.text.primary, fontSize: 18 }}
                />
              )}
            </ListItemIcon>
            <ListItemText
              sx={menuItemTextSx}
              primary={t(
                isPinnedToBookmarks
                  ? 'core:app_tab.unpin_from_bookmarks'
                  : 'core:app_tab.pin_to_bookmarks',
                { postProcess: 'capitalizeFirstChar' }
              )}
            />
          </MenuItem>
        )}
        {canDuplicate && (
          <MenuItem
            onClick={() => {
              onDuplicate();
              setMenuPosition(null);
            }}
          >
            <ListItemIcon sx={menuItemIconSx}>
              <ContentCopyIcon
                sx={{
                  color: theme.palette.text.primary,
                  fontSize: 18,
                }}
              />
            </ListItemIcon>

            <ListItemText
              sx={menuItemTextSx}
              primary={t('core:app_tab.duplicate', {
                postProcess: 'capitalizeFirstChar',
              })}
            />
          </MenuItem>
        )}
        {(onTogglePin || onTogglePinToBookmarks || canDuplicate) && (
          <Divider sx={{ borderColor: theme.palette.border.subtle }} />
        )}
        <MenuItem
          disabled={!onCloseOthers}
          onClick={() => {
            onCloseOthers?.();
            setMenuPosition(null);
          }}
        >
          <ListItemIcon sx={menuItemIconSx}>
            <TabUnselectedRoundedIcon
              sx={{
                color: theme.palette.text.primary,
                fontSize: 18,
              }}
            />
          </ListItemIcon>

          <ListItemText
            sx={menuItemTextSx}
            primary={t('core:app_tab.close_others', {
              postProcess: 'capitalizeFirstChar',
            })}
          />
        </MenuItem>
        <MenuItem
          disabled={!onCloseToTheRight}
          onClick={() => {
            onCloseToTheRight?.();
            setMenuPosition(null);
          }}
        >
          <ListItemIcon sx={menuItemIconSx}>
            <KeyboardTabRoundedIcon
              sx={{
                color: theme.palette.text.primary,
                fontSize: 18,
              }}
            />
          </ListItemIcon>

          <ListItemText
            sx={menuItemTextSx}
            primary={t('core:app_tab.close_right', {
              postProcess: 'capitalizeFirstChar',
            })}
          />
        </MenuItem>
        <MenuItem
          onClick={() => {
            onCloseAll();
            setMenuPosition(null);
          }}
        >
          <ListItemIcon sx={menuItemIconSx}>
            <CloseFullscreenRoundedIcon
              sx={{
                color: theme.palette.text.primary,
                fontSize: 18,
              }}
            />
          </ListItemIcon>

          <ListItemText
            sx={menuItemTextSx}
            primary={t('core:app_tab.close_all', {
              postProcess: 'capitalizeFirstChar',
            })}
          />
        </MenuItem>
      </Menu>
    </AppsHorizontalTabButton>
  );

  return (
    <Tooltip
      disableInteractive
      enterDelay={400}
      enterNextDelay={200}
      placement="bottom"
      title={iconOnly && !isDragging && !menuPosition ? label : ''}
    >
      {tabButton}
    </Tooltip>
  );
};

export default TabComponent;
