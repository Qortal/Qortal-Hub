import BookmarkRemoveOutlinedIcon from '@mui/icons-material/BookmarkRemoveOutlined';
import CreateNewFolderOutlinedIcon from '@mui/icons-material/CreateNewFolderOutlined';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';
import FolderDeleteOutlinedIcon from '@mui/icons-material/FolderDeleteOutlined';
import FolderOffOutlinedIcon from '@mui/icons-material/FolderOffOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import {
  Divider,
  ListItemIcon,
  ListSubheader,
  Menu,
  MenuItem,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { AppBookmarkFolder } from '../AppBookmarks/bookmarkTypes';
import type { LauncherAppItem, LauncherBookmarkItem } from './launcherItems';

/** A tile that is not a folder: a pinned app or a bookmark. */
export type LauncherLeafItem = LauncherAppItem | LauncherBookmarkItem;

/** What was right-clicked, and where. */
export type LauncherMenuTarget = { left: number; top: number } & (
  | { kind: 'tile'; item: LauncherLeafItem; folderId: string | null }
  | { kind: 'folder'; folder: AppBookmarkFolder }
);

interface LauncherTileMenuProps {
  target: LauncherMenuTarget | null;
  folders: AppBookmarkFolder[];
  onClose: () => void;
  onOpen: (item: LauncherLeafItem) => void;
  onMoveToFolder: (item: LauncherLeafItem, folderId: string) => void;
  onNewFolder: (item: LauncherLeafItem) => void;
  onRemoveFromFolder: (item: LauncherLeafItem) => void;
  /** Unpins an app, or removes a bookmark. */
  onRemove: (item: LauncherLeafItem) => void;
  onRenameFolder: (folder: AppBookmarkFolder) => void;
  onDeleteFolder: (folder: AppBookmarkFolder) => void;
}

const iconSx = { fontSize: 18 } as const;

/**
 * The right-click menu of a launcher tile. An app or a bookmark can be
 * opened, moved between folders and removed; a folder can be renamed and
 * deleted. It does with the keyboard and the menu what dragging does with the
 * mouse.
 */
export const LauncherTileMenu = ({
  target,
  folders,
  onClose,
  onOpen,
  onMoveToFolder,
  onNewFolder,
  onRemoveFromFolder,
  onRemove,
  onRenameFolder,
  onDeleteFolder,
}: LauncherTileMenuProps) => {
  const { t } = useTranslation(['core']);
  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  const tileItems = () => {
    if (target?.kind !== 'tile') return [];
    const { item, folderId } = target;
    const pin = item.pin;
    // A private app has no bookmark, so no folder takes it.
    const canBeInFolder = !pin?.app.isPrivate;
    // The account's own app and website are always shown.
    const canBeRemoved = !pin?.isMine;

    return [
      <MenuItem key="open" onClick={run(() => onOpen(item))}>
        <ListItemIcon>
          <OpenInNewRoundedIcon sx={iconSx} />
        </ListItemIcon>
        {t('core:action.open', { postProcess: 'capitalizeFirstChar' })}
      </MenuItem>,
      canBeInFolder ? <Divider key="folders-divider" /> : null,
      canBeInFolder ? (
        <ListSubheader
          key="folders-title"
          sx={{ backgroundColor: 'transparent', lineHeight: '30px' }}
        >
          {t('core:launcher.folder_move_to', {
            postProcess: 'capitalizeFirstChar',
          })}
        </ListSubheader>
      ) : null,
      ...(canBeInFolder
        ? folders
            .filter((folder) => folder.id !== folderId)
            .map((folder) => (
              <MenuItem
                key={`folder-${folder.id}`}
                onClick={run(() => onMoveToFolder(item, folder.id))}
              >
                <ListItemIcon>
                  <FolderOutlinedIcon sx={iconSx} />
                </ListItemIcon>
                {folder.name}
              </MenuItem>
            ))
        : []),
      canBeInFolder ? (
        <MenuItem key="new-folder" onClick={run(() => onNewFolder(item))}>
          <ListItemIcon>
            <CreateNewFolderOutlinedIcon sx={iconSx} />
          </ListItemIcon>
          {t('core:bookmarks.new_folder')}
        </MenuItem>
      ) : null,
      folderId !== null ? (
        <MenuItem
          key="leave-folder"
          onClick={run(() => onRemoveFromFolder(item))}
        >
          <ListItemIcon>
            <FolderOffOutlinedIcon sx={iconSx} />
          </ListItemIcon>
          {t('core:launcher.folder_remove_from', {
            postProcess: 'capitalizeFirstChar',
          })}
        </MenuItem>
      ) : null,
      canBeRemoved ? <Divider key="remove-divider" /> : null,
      canBeRemoved ? (
        <MenuItem key="remove" onClick={run(() => onRemove(item))}>
          <ListItemIcon>
            {pin ? (
              <PushPinOutlinedIcon sx={iconSx} />
            ) : (
              <BookmarkRemoveOutlinedIcon sx={iconSx} />
            )}
          </ListItemIcon>
          {pin
            ? t('core:action.unpin_app', { postProcess: 'capitalizeFirstChar' })
            : t('core:launcher.bookmark_remove', {
                postProcess: 'capitalizeFirstChar',
              })}
        </MenuItem>
      ) : null,
    ];
  };

  const folderItems = () => {
    if (target?.kind !== 'folder') return [];
    const { folder } = target;
    return [
      <MenuItem key="rename" onClick={run(() => onRenameFolder(folder))}>
        <ListItemIcon>
          <DriveFileRenameOutlineIcon sx={iconSx} />
        </ListItemIcon>
        {t('core:bookmarks.rename')}
      </MenuItem>,
      <MenuItem key="delete" onClick={run(() => onDeleteFolder(folder))}>
        <ListItemIcon>
          <FolderDeleteOutlinedIcon sx={iconSx} />
        </ListItemIcon>
        {t('core:launcher.folder_delete', {
          postProcess: 'capitalizeFirstChar',
        })}
      </MenuItem>,
    ];
  };

  return (
    <Menu
      anchorPosition={
        target ? { left: target.left, top: target.top } : undefined
      }
      anchorReference="anchorPosition"
      onClose={onClose}
      open={!!target}
      slotProps={{
        paper: { sx: { borderRadius: '12px', minWidth: 210 } },
      }}
    >
      {target?.kind === 'folder' ? folderItems() : tileItems()}
    </Menu>
  );
};
