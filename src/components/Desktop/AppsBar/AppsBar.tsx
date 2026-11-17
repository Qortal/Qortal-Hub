import {
  type MouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import { useTranslation } from 'react-i18next';
import { executeEvent } from '../../../utils/events';
import { bookmarkSubtitle } from '../../Apps/AppBookmarks/bookmarkList';
import {
  type FolderPicture,
  LauncherAppIcon,
  LauncherFolderIcon,
} from '../../Apps/AppsLauncher/LauncherTile';
import {
  LauncherPinIcon,
  useOpenLauncherPin,
} from '../../Apps/AppsLauncher/LauncherPinTile';
import {
  type AppsBarFolderItem,
  type AppsBarItem,
  bookmarkTabData,
} from './appsBarItems';
import { APPS_BAR_NAME_MAX_LENGTH } from './appsBarSettings';
import { useAppsBarItems, useAppsBarSettings } from './useAppsBar';

/** How big the pictures in the bar are. */
export const APPS_BAR_ICON_PX = 24;

/** How big the pictures in the lists the bar opens are. */
const LIST_ICON_PX = 22;

/** The room kept at the end of the row for the button holding the rest. */
const MORE_BUTTON_PX = 36;

/**
 * The title bar maximizes the window when it is double-clicked, and the bar
 * sits inside it. What the bar holds keeps its double-clicks to itself, so
 * opening a bookmark twice does not resize the window; the empty title-bar
 * space around the bar still works. What the bar opens is in a portal, which
 * React still lets events climb out of, so those keep them too.
 */
const keepDoubleClick = (event: MouseEvent<HTMLElement>) =>
  event.stopPropagation();

type AppsBarProps = {
  address: string;
};

/** The small pictures on a folder: the apps of the bookmarks it holds. */
const folderPicturesOf = (item: AppsBarFolderItem): FolderPicture[] =>
  item.items.map(({ bookmark }) => ({
    key: bookmark.id,
    appName: bookmark.appName,
  }));

/** The picture of one item: the pinned app's, the folder's or the app's. */
const AppsBarIcon = ({
  item,
  size = APPS_BAR_ICON_PX,
}: {
  item: AppsBarItem;
  size?: number;
}) => {
  if (item.type === 'pin') {
    return <LauncherPinIcon app={item.pin} size={size} />;
  }
  if (item.type === 'folder') {
    return <LauncherFolderIcon pictures={folderPicturesOf(item)} size={size} />;
  }
  return <LauncherAppIcon appName={item.bookmark.appName} size={size} />;
};

/**
 * The pinned apps, bookmark folders and bookmarks along the top of the
 * window: a picture and a name each, a click away from opening. A folder
 * opens a list of what is inside, to pick from, and whatever does not fit in
 * the row waits in a list at its end. A right-click renames an item, or
 * takes its name away so only the picture shows.
 *
 * It is the row the bookmarks menu turns on. What it shows is the pin list
 * and the bookmarks store, so it needs nothing of its own except the names
 * the user gave it.
 */
export function AppsBar({ address }: AppsBarProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const { settings, rename } = useAppsBarSettings(address);
  const items = useAppsBarItems(address, true);
  const openPin = useOpenLauncherPin();

  const rowRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  /** How many items the row has room for; every one of them while null. */
  const [shownCount, setShownCount] = useState<number | null>(null);

  const [menuItem, setMenuItem] = useState<AppsBarItem | null>(null);
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folderAnchor, setFolderAnchor] = useState<HTMLElement | null>(null);
  const [isShowingRest, setIsShowingRest] = useState(false);
  const [renamingItem, setRenamingItem] = useState<AppsBarItem | null>(null);
  const [draftName, setDraftName] = useState('');

  /** The folder being looked at, as it stands now, not as it was clicked. */
  const openFolder = items.find(
    (item): item is AppsBarFolderItem =>
      item.type === 'folder' && item.id === folderId
  );
  const hiddenItems = shownCount === null ? [] : items.slice(shownCount);

  /**
   * What the row has room for. An item that does not fit stays where it is,
   * out of sight, so the ones before it keep their place while the window is
   * made wider or narrower again.
   */
  const measure = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const width = row.clientWidth;
    const children = Array.from(
      row.querySelectorAll<HTMLElement>('[data-apps-bar-item]')
    );
    // Before the window has laid the row out there is nothing to measure.
    if (!width || children.length === 0) {
      setShownCount(null);
      return;
    }
    const end = (child: HTMLElement) => child.offsetLeft + child.offsetWidth;
    if (end(children[children.length - 1]) <= width) {
      setShownCount(null);
      return;
    }
    const room = width - MORE_BUTTON_PX;
    let count = 0;
    while (count < children.length && end(children[count]) <= room) count++;
    setShownCount(count);
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [items, measure, settings.showNames]);

  // The row again whenever the window changes size, and the items too: a
  // picture or a name that arrives late makes them wider than they were.
  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(row);
    row
      .querySelectorAll<HTMLElement>('[data-apps-bar-item]')
      .forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [items, measure, settings.showNames]);

  const closeMenu = () => {
    setMenuItem(null);
    setMenuPosition(null);
  };

  const closeFolder = () => {
    setFolderId(null);
    setFolderAnchor(null);
  };

  const labelOfService = (service: string) =>
    service === 'WEBSITE'
      ? t('core:website', { postProcess: 'capitalizeFirstChar' })
      : t('core:app', { postProcess: 'capitalizeFirstChar' });

  const openItem = useCallback(
    async (item: AppsBarItem) => {
      if (item.type === 'folder') return;
      if (item.type === 'pin') {
        if (!(await openPin(item.pin))) return;
      } else {
        executeEvent('addTab', { data: bookmarkTabData(item.bookmark) });
      }
      executeEvent('open-apps-mode', {});
    },
    [openPin]
  );

  /** A folder shows what is inside, to pick from; anything else opens. */
  const clickItem = (item: AppsBarItem, element: HTMLElement | null) => {
    setIsShowingRest(false);
    if (item.type !== 'folder') {
      // What opens leaves no list behind it.
      closeFolder();
      void openItem(item);
      return;
    }
    setFolderId(item.id);
    setFolderAnchor(element);
  };

  /**
   * The menu of one item, where it was right-clicked. A list the item was
   * right-clicked in stays open underneath, so renaming something in a folder
   * does not put the folder away.
   */
  const openItemMenu = (item: AppsBarItem, event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setMenuItem(item);
    setMenuPosition({ left: event.clientX, top: event.clientY });
  };

  const startRename = (item: AppsBarItem) => {
    setRenamingItem(item);
    setDraftName(item.customName ?? item.ownName);
    closeMenu();
  };

  const saveName = () => {
    if (renamingItem) rename(renamingItem.id, draftName);
    setRenamingItem(null);
  };

  const hoverBackground =
    theme.palette.mode === 'dark'
      ? 'rgba(255, 255, 255, 0.09)'
      : theme.palette.action.hover;

  /** The line under a name in a list: where it goes, or what a folder holds. */
  const subtitleOf = (item: AppsBarItem) => {
    if (item.type === 'folder') {
      return t('core:bookmarks.bookmark_count', { count: item.items.length });
    }
    if (item.type === 'bookmark') {
      return bookmarkSubtitle(item.bookmark, labelOfService);
    }
    return '';
  };

  /** What an item says of itself while the pointer rests on it. */
  const tooltipOf = (item: AppsBarItem) => {
    if (item.type === 'folder') return `${item.ownName} · ${subtitleOf(item)}`;
    if (item.type === 'bookmark' && item.folderName) {
      return `${item.ownName} · ${item.folderName}`;
    }
    return item.ownName;
  };

  /** One row of a list the bar opens: a picture, a name and that line. */
  const listRow = (item: AppsBarItem, onClick: () => void) => {
    const subtitle = subtitleOf(item);
    return (
      <MenuItem
        key={item.id}
        onClick={onClick}
        onContextMenu={(event: MouseEvent<HTMLElement>) =>
          openItemMenu(item, event)
        }
        sx={{ gap: 1.25, py: 0.75 }}
      >
        <AppsBarIcon item={item} size={LIST_ICON_PX} />
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              fontSize: 13,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.label || item.ownName}
          </Typography>
          {!!subtitle && (
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: 11,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {subtitle}
            </Typography>
          )}
        </Box>
      </MenuItem>
    );
  };

  return (
    <>
      <Box
        aria-label={t('core:apps_bar.label')}
        role="toolbar"
        sx={{
          alignItems: 'center',
          display: 'flex',
          flex: 1,
          minWidth: 0,
          position: 'relative',
          // Room so the last item does not run into the window's buttons.
          pr: 1,
        }}
      >
        <Box
          ref={rowRef}
          sx={{
            alignItems: 'center',
            display: 'flex',
            flex: 1,
            gap: 0.25,
            minWidth: 0,
            overflow: 'hidden',
            pl: 0.5,
            position: 'relative',
          }}
        >
          {items.length === 0 && (
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: 11.5,
                px: 1,
                whiteSpace: 'nowrap',
              }}
            >
              {t('core:apps_bar.empty')}
            </Typography>
          )}

          {items.map((item, index) => {
            const isHidden = shownCount !== null && index >= shownCount;
            return (
              <Tooltip key={item.id} title={isHidden ? '' : tooltipOf(item)}>
                <ButtonBase
                  aria-expanded={
                    item.type === 'folder' ? folderId === item.id : undefined
                  }
                  aria-haspopup={item.type === 'folder' ? 'menu' : undefined}
                  aria-hidden={isHidden || undefined}
                  aria-label={item.label || item.ownName}
                  data-apps-bar-item=""
                  onClick={(event: MouseEvent<HTMLElement>) =>
                    clickItem(item, event.currentTarget)
                  }
                  onContextMenu={(event: MouseEvent<HTMLElement>) =>
                    openItemMenu(item, event)
                  }
                  onDoubleClick={keepDoubleClick}
                  tabIndex={isHidden ? -1 : 0}
                  sx={{
                    alignItems: 'center',
                    borderRadius: '8px',
                    display: 'flex',
                    flexShrink: 0,
                    gap: 0.75,
                    maxWidth: 170,
                    px: 0.75,
                    py: 0.5,
                    WebkitAppRegion: 'no-drag',
                    // Out of sight, but still where it was: the row does not
                    // shuffle while the window changes size.
                    pointerEvents: isHidden ? 'none' : undefined,
                    visibility: isHidden ? 'hidden' : undefined,
                    '&:hover': { backgroundColor: hoverBackground },
                    '&:focus-visible': {
                      outline: `1px solid ${theme.palette.primary.main}`,
                      outlineOffset: '-1px',
                    },
                  }}
                >
                  <AppsBarIcon item={item} />
                  {settings.showNames && !!item.label && (
                    <Typography
                      sx={{
                        color: theme.palette.text.primary,
                        fontSize: 12,
                        fontWeight: 500,
                        lineHeight: 1.2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.label}
                    </Typography>
                  )}
                  {item.type === 'folder' && (
                    <KeyboardArrowDownRoundedIcon
                      sx={{
                        color: theme.palette.text.secondary,
                        flexShrink: 0,
                        fontSize: 15,
                        ml: -0.25,
                      }}
                    />
                  )}
                </ButtonBase>
              </Tooltip>
            );
          })}
        </Box>

        {hiddenItems.length > 0 && (
          <Tooltip title={t('core:apps_bar.more')}>
            <IconButton
              aria-expanded={isShowingRest}
              aria-haspopup="menu"
              aria-label={t('core:apps_bar.more')}
              onClick={() => {
                closeFolder();
                setIsShowingRest(true);
              }}
              onDoubleClick={keepDoubleClick}
              ref={moreRef}
              size="small"
              sx={{
                backgroundColor: theme.palette.background.default,
                color: theme.palette.text.secondary,
                flexShrink: 0,
                position: 'absolute',
                right: 8,
                WebkitAppRegion: 'no-drag',
                '&:hover': { backgroundColor: hoverBackground },
              }}
            >
              <MoreHorizRoundedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <Menu
        anchorEl={moreRef.current}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        MenuListProps={{ 'aria-label': t('core:apps_bar.more'), dense: true }}
        onClose={() => setIsShowingRest(false)}
        onDoubleClick={keepDoubleClick}
        open={isShowingRest && hiddenItems.length > 0}
        slotProps={{ paper: { sx: { maxHeight: 420, minWidth: 220 } } }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
      >
        {hiddenItems.map((item) =>
          listRow(item, () => clickItem(item, moreRef.current))
        )}
      </Menu>

      <Menu
        anchorEl={folderAnchor}
        anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
        MenuListProps={{ 'aria-label': openFolder?.ownName, dense: true }}
        onClose={closeFolder}
        onDoubleClick={keepDoubleClick}
        open={!!openFolder && !!folderAnchor}
        slotProps={{ paper: { sx: { maxHeight: 420, minWidth: 220 } } }}
        transformOrigin={{ horizontal: 'left', vertical: 'top' }}
      >
        {openFolder?.items.length === 0 && (
          <MenuItem disabled>
            {t('core:bookmarks.no_bookmarks_folder')}
          </MenuItem>
        )}

        {openFolder?.items.map((item) =>
          listRow(item, () => clickItem(item, null))
        )}
      </Menu>

      <Menu
        anchorReference="anchorPosition"
        anchorPosition={menuPosition ?? undefined}
        open={!!menuItem && !!menuPosition}
        onClose={closeMenu}
        onDoubleClick={keepDoubleClick}
      >
        {!!menuItem && menuItem.type !== 'folder' && (
          <MenuItem
            onClick={() => {
              if (menuItem) clickItem(menuItem, null);
              closeMenu();
            }}
          >
            {t('core:action.open', { postProcess: 'capitalizeFirstChar' })}
          </MenuItem>
        )}
        <MenuItem onClick={() => menuItem && startRename(menuItem)}>
          {t('core:bookmarks.rename')}
        </MenuItem>
        {!!menuItem && menuItem.customName !== null && (
          <MenuItem
            onClick={() => {
              if (menuItem) rename(menuItem.id, null);
              closeMenu();
            }}
          >
            {t('core:apps_bar.reset_name')}
          </MenuItem>
        )}
      </Menu>

      <Dialog
        open={!!renamingItem}
        onClose={() => setRenamingItem(null)}
        onDoubleClick={keepDoubleClick}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{t('core:apps_bar.rename_title')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            helperText={t('core:apps_bar.rename_hint')}
            inputProps={{ maxLength: APPS_BAR_NAME_MAX_LENGTH }}
            label={t('core:bookmarks.name')}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                saveName();
              }
            }}
            size="small"
            sx={{ mt: 1 }}
            value={draftName}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenamingItem(null)}>
            {t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
          </Button>
          <Button onClick={saveName} variant="contained">
            {t('core:action.save', { postProcess: 'capitalizeFirstChar' })}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
