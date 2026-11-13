import { type MouseEvent, useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { Box, type Theme, Typography } from '@mui/material';
import { useAtom, useSetAtom } from 'jotai';
import ShortUniqueId from 'short-unique-id';
import { useTranslation } from 'react-i18next';
import {
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../../../atoms/global';
import type { PinnedApp } from '../../../utils/pinnedAppsSettings';
import { buildBookmarkLink } from '../AppBookmarks/bookmarkStorage';
import type {
  AppBookmark,
  AppBookmarkFolder,
  AppBookmarksForAddress,
} from '../AppBookmarks/bookmarkTypes';
import { saveToLocalStorage } from '../AppsNavBarDesktop';
import {
  LauncherBookmarkIcon,
  LauncherBookmarkTile,
  openLauncherBookmark,
} from './LauncherBookmarkTile';
import { LauncherDeleteFolderDialog } from './LauncherDeleteFolderDialog';
import {
  DraggedTile,
  dropMarkFor,
  keepTilesInPlace,
  LAUNCHER_REORDER_KEYS,
  launcherCollisionDetection,
  launcherTileGridSx,
  pointerDropOf,
  SortableTile,
  TileDropArea,
} from './LauncherDragTiles';
import { sameLauncherDrop } from './launcherDrop';
import { LauncherFolderPanel } from './LauncherFolderPanel';
import {
  applyLauncherDrop,
  buildLauncherItems,
  createFolderWithItem,
  isFolderItemKey,
  type LauncherArrangement,
  type LauncherChangeContext,
  type LauncherDrop,
  type LauncherFolderItem,
  moveItemToFolder,
  removeFolderItem,
  removeItem,
  removeItemFromFolder,
  renameFolder,
  sameBookmarkLayout,
  setFolderOpen,
} from './launcherItems';
import {
  buildLauncherPins,
  type LauncherPin,
  launcherPinLabel,
  toStoredPin,
} from './launcherPins';
import {
  LauncherPinIcon,
  LauncherPinTile,
  useOpenLauncherPin,
} from './LauncherPinTile';
import {
  type FolderPicture,
  LauncherFolderIcon,
  LauncherTile,
} from './LauncherTile';
import {
  type LauncherLeafItem,
  type LauncherMenuTarget,
  LauncherTileMenu,
} from './LauncherTileMenu';
import { useCountLauncherEdit } from './launcherQdnSync';
import { useLauncherView } from './useLauncherView';

// The same ids as the bookmarks menu makes.
const uid = new ShortUniqueId({ length: 10 });

const folderPictures = (item: LauncherFolderItem): FolderPicture[] =>
  item.children.map((child) => ({
    key: child.key,
    appName: child.bookmark.appName,
  }));

const folderLabel = (item: LauncherFolderItem) =>
  `${item.folder.name} · ${item.children.length}`;

interface LauncherSavedProps {
  availableQapps: PinnedApp[];
  /**
   * The account's bookmarks and bookmark folders, or null when they could not
   * be read. The folders on the launcher are these folders.
   */
  bookmarks: AppBookmarksForAddress | null;
  /** The signed-in account: each account has its own arrangement. */
  myAddress?: string | null;
  myApp?: PinnedApp | null;
  myWebsite?: PinnedApp | null;
  /** Saves the bookmarks and folders after a change made here. */
  onBookmarksChange: (next: AppBookmarksForAddress) => void;
}

/**
 * The pinned apps and the bookmarks as tiles, with the bookmark folders.
 *
 * - A click opens a tile. Dragging reorders; dropping one tile onto another
 *   makes a bookmark folder of the two, and dropping it onto a folder adds
 *   it. The right-click menu does the same without dragging, and removes.
 * - The folders are the folders of the bookmarks menu, with what they hold
 *   there. An app that goes into one stays pinned and gets a bookmark in it.
 * - A folder's tile shows small pictures of what is in it. Clicking it opens
 *   the folder under the tiles, where it stays until it is closed.
 * - The account's own app and website are always there.
 */
export const LauncherSaved = ({
  availableQapps,
  bookmarks,
  myAddress,
  myApp,
  myWebsite,
  onBookmarksChange,
}: LauncherSavedProps) => {
  const { t } = useTranslation(['core']);
  const [pinnedApps, setPinnedApps] = useAtom(sortablePinnedAppsAtom);
  const setSettingsLocalLastUpdated = useSetAtom(settingsLocalLastUpdatedAtom);
  const [view, setView] = useLauncherView(myAddress);
  const countEdit = useCountLauncherEdit(myAddress);
  const openPin = useOpenLauncherPin();

  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [drop, setDrop] = useState<LauncherDrop | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [menu, setMenu] = useState<LauncherMenuTarget | null>(null);
  const [folderToDelete, setFolderToDelete] =
    useState<AppBookmarkFolder | null>(null);

  const pins = useMemo(
    () => buildLauncherPins(pinnedApps, availableQapps, myApp, myWebsite),
    [availableQapps, myApp, myWebsite, pinnedApps]
  );
  const pinsByKey = useMemo(
    () => new Map(pins.map((pin) => [pin.key, pin])),
    [pins]
  );
  const items = useMemo(
    () => buildLauncherItems(pins, bookmarks, view),
    [bookmarks, pins, view]
  );
  const folderItems = useMemo(
    () =>
      items.filter(
        (item): item is LauncherFolderItem => item.type === 'folder'
      ),
    [items]
  );
  const openFolders = useMemo(
    () => folderItems.filter((item) => item.isOpen),
    [folderItems]
  );
  const shownFolders = useMemo(
    () => folderItems.map((item) => item.folder),
    [folderItems]
  );
  const leavesByKey = useMemo(() => {
    const leaves = new Map<string, LauncherLeafItem>();
    for (const item of items) {
      if (item.type !== 'folder') leaves.set(item.key, item);
      else for (const child of item.children) leaves.set(child.key, child);
    }
    return leaves;
  }, [items]);
  /** Every tile on screen, in reading order. */
  const visualKeys = useMemo(
    () => [
      ...items.map((item) => item.key),
      ...openFolders.flatMap((item) => item.children.map((child) => child.key)),
    ],
    [items, openFolders]
  );

  // --- Changing the arrangement ---------------------------------------------

  const pinLabelFallback = t('core:app_private', {
    postProcess: 'capitalizeFirstChar',
  });
  const newFolderName = t('core:bookmarks.new_folder');

  /** What a change works from: the stores as they are, and new ids. */
  const changeContext = useCallback((): LauncherChangeContext => {
    const now = Date.now();
    return {
      data: bookmarks,
      view,
      newFolder: { id: uid.rnd(), name: newFolderName },
      // An app in a folder is a bookmark of the app's start page.
      makeBookmark: (pin: LauncherPin): AppBookmark => {
        const target = {
          service: String(pin.app.service),
          appName: String(pin.app.name),
          path: '',
        };
        return {
          ...target,
          id: uid.rnd(),
          name: launcherPinLabel(pin.app, pinLabelFallback),
          link: buildBookmarkLink(target),
          folderId: null,
          createdAt: now,
          updatedAt: now,
        };
      },
      now,
    };
  }, [bookmarks, newFolderName, pinLabelFallback, view]);

  const applyArrangement = useCallback(
    (arrangement: LauncherArrangement | null) => {
      if (!arrangement) return false;
      const storeChanged = !sameBookmarkLayout(arrangement.data, bookmarks);
      // The bookmarks could not be read: nothing is written over them.
      if (storeChanged && !bookmarks) return false;

      const pinsChanged =
        arrangement.pinOrder.length !== pins.length ||
        arrangement.pinOrder.some((key, index) => key !== pins[index].key);
      if (pinsChanged) {
        // The pin list keeps every app, a folder's apps where the folder
        // stands, so the list saved on QDN has them all.
        const stored = arrangement.pinOrder.flatMap((key) => {
          const pin = pinsByKey.get(key);
          return pin ? [toStoredPin(pin.app)] : [];
        });
        setPinnedApps(stored as typeof pinnedApps);
        saveToLocalStorage('ext_saved_settings', 'sortablePinnedApps', stored);
        setSettingsLocalLastUpdated(Date.now());
      }
      if (storeChanged) onBookmarksChange(arrangement.data);
      const orderChanged =
        arrangement.view.order.length !== view.order.length ||
        arrangement.view.order.some((key, index) => key !== view.order[index]);
      setView(arrangement.view);
      // Something to save to QDN: the window that offers it shows.
      if (pinsChanged || storeChanged || orderChanged) countEdit();
      return true;
    },
    [
      bookmarks,
      countEdit,
      onBookmarksChange,
      pins,
      pinsByKey,
      setPinnedApps,
      setSettingsLocalLastUpdated,
      setView,
      view.order,
    ]
  );

  /** Applies a change; a folder it made asks for its name. */
  const applyChange = useCallback(
    (
      change: (context: LauncherChangeContext) => LauncherArrangement | null
    ) => {
      const context = changeContext();
      const arrangement = change(context);
      if (!applyArrangement(arrangement)) return;
      const madeFolder = arrangement?.data.folders.some(
        (folder) => folder.id === context.newFolder.id
      );
      if (madeFolder) setRenamingFolderId(context.newFolder.id);
    },
    [applyArrangement, changeContext]
  );

  const openItem = useCallback(
    (item: LauncherLeafItem) => {
      if (item.pin) void openPin(item.pin.app);
      else if (item.type === 'bookmark') openLauncherBookmark(item.bookmark);
    },
    [openPin]
  );

  const startRenaming = useCallback(
    (folder: AppBookmarkFolder) => {
      // The name is edited in the open folder.
      setView(setFolderOpen(view, folder.id, true));
      setRenamingFolderId(folder.id);
    },
    [setView, view]
  );

  const endRenaming = useCallback(
    (folder: AppBookmarkFolder, name: string | null) => {
      setRenamingFolderId(null);
      if (name === null || !bookmarks) return;
      const renamed = renameFolder(bookmarks, folder.id, name, Date.now());
      if (renamed === bookmarks) return;
      onBookmarksChange(renamed);
      countEdit();
    },
    [bookmarks, countEdit, onBookmarksChange]
  );

  const deleteFolder = useCallback(
    (folder: AppBookmarkFolder) => {
      setFolderToDelete(null);
      applyChange((context) => removeFolderItem(items, folder.id, context));
    },
    [applyChange, items]
  );

  /** As in the bookmarks menu: a folder that holds something asks first. */
  const askToDeleteFolder = useCallback(
    (folder: AppBookmarkFolder) => {
      const item = folderItems.find((entry) => entry.folder.id === folder.id);
      if (item && item.children.length > 0) setFolderToDelete(folder);
      else deleteFolder(folder);
    },
    [deleteFolder, folderItems]
  );

  // --- Dragging ---------------------------------------------------------------

  const sensors = useSensors(
    // A small move is still a click, not a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: LAUNCHER_REORDER_KEYS,
    })
  );

  /** Where the drag would land, from what the tile is over. */
  const readDrop = useCallback(
    (event: DragMoveEvent | DragEndEvent): LauncherDrop | null => {
      const fromPointer = pointerDropOf(event);
      if (fromPointer) return fromPointer;
      // Moved with the keyboard: take the place of the tile it is over.
      const overKey = event.over ? String(event.over.id) : null;
      const draggedKey = String(event.active.id);
      if (!overKey || overKey === draggedKey) return null;
      if (!visualKeys.includes(overKey)) return null;
      return {
        kind: 'insert',
        key: overKey,
        side:
          visualKeys.indexOf(draggedKey) < visualKeys.indexOf(overKey)
            ? 'after'
            : 'before',
      };
    },
    [visualKeys]
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveKey(String(event.active.id));
    setDrop(null);
  }, []);

  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      const next = readDrop(event);
      setDrop((current) => (sameLauncherDrop(current, next) ? current : next));
    },
    [readDrop]
  );

  const endDrag = useCallback(() => {
    setActiveKey(null);
    setDrop(null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const target = readDrop(event);
      endDrag();
      if (!target) return;
      applyChange((context) =>
        applyLauncherDrop(items, String(event.active.id), target, context)
      );
    },
    [applyChange, endDrag, items, readDrop]
  );

  // --- Tiles ------------------------------------------------------------------

  const renderLeafTile = (item: LauncherLeafItem, folderId: string | null) => {
    const openMenu = (event: MouseEvent) => {
      event.preventDefault();
      setMenu({
        kind: 'tile',
        item,
        folderId,
        left: event.clientX,
        top: event.clientY,
      });
    };
    return (
      <SortableTile
        folderId={folderId}
        id={item.key}
        key={item.key}
        mark={dropMarkFor(drop, item.key)}
        staysInRow={!!item.pin?.app.isPrivate}
      >
        {(buttonProps) =>
          item.pin ? (
            // A pinned app looks the same in the row and in a folder.
            <LauncherPinTile
              {...buttonProps}
              app={item.pin.app}
              onContextMenu={openMenu}
            />
          ) : item.type === 'bookmark' ? (
            <LauncherBookmarkTile
              {...buttonProps}
              bookmark={item.bookmark}
              onContextMenu={openMenu}
            />
          ) : null
        }
      </SortableTile>
    );
  };

  const renderFolderTile = (item: LauncherFolderItem) => (
    <SortableTile
      folderId={null}
      id={item.key}
      key={item.key}
      mark={dropMarkFor(drop, item.key)}
    >
      {({ sx, ...buttonProps }) => (
        <LauncherTile
          {...buttonProps}
          aria-expanded={item.isOpen}
          icon={<LauncherFolderIcon pictures={folderPictures(item)} />}
          label={folderLabel(item)}
          onClick={() =>
            setView(setFolderOpen(view, item.folder.id, !item.isOpen))
          }
          onContextMenu={(event: MouseEvent) => {
            event.preventDefault();
            setMenu({
              kind: 'folder',
              folder: item.folder,
              left: event.clientX,
              top: event.clientY,
            });
          }}
          sx={[
            (theme: Theme) =>
              item.isOpen
                ? { backgroundColor: theme.palette.action.selected }
                : {},
            ...(Array.isArray(sx) ? sx : [sx]),
          ]}
        />
      )}
    </SortableTile>
  );

  const draggedLeaf =
    activeKey && !isFolderItemKey(activeKey)
      ? leavesByKey.get(activeKey)
      : undefined;
  const draggedFolder =
    activeKey && isFolderItemKey(activeKey)
      ? folderItems.find((item) => item.key === activeKey)
      : undefined;

  if (items.length === 0) {
    return (
      <Typography
        sx={(theme) => ({
          color: theme.palette.text.secondary,
          fontSize: '14px',
          padding: '12px 0',
        })}
      >
        {t('core:launcher.pinned_empty', {
          postProcess: 'capitalizeFirstChar',
        })}
      </Typography>
    );
  }

  return (
    <DndContext
      collisionDetection={launcherCollisionDetection}
      onDragCancel={endDrag}
      onDragEnd={handleDragEnd}
      onDragMove={handleDragMove}
      onDragStart={handleDragStart}
      sensors={sensors}
    >
      <SortableContext
        items={items.map((item) => item.key)}
        strategy={keepTilesInPlace}
      >
        <TileDropArea folderId={null}>
          {(areaRef) => (
            <Box ref={areaRef} sx={launcherTileGridSx}>
              {items.map((item) =>
                item.type === 'folder'
                  ? renderFolderTile(item)
                  : renderLeafTile(item, null)
              )}
            </Box>
          )}
        </TileDropArea>
      </SortableContext>

      {openFolders.map((item) => (
        <SortableContext
          items={item.children.map((child) => child.key)}
          key={item.key}
          strategy={keepTilesInPlace}
        >
          <TileDropArea folderId={item.folder.id}>
            {(areaRef) => (
              <LauncherFolderPanel
                bodyRef={areaRef}
                count={item.children.length}
                folder={item.folder}
                isDropTarget={
                  drop?.kind === 'append' && drop.folderId === item.folder.id
                }
                isRenaming={renamingFolderId === item.folder.id}
                onClose={() =>
                  setView(setFolderOpen(view, item.folder.id, false))
                }
                onDelete={() => askToDeleteFolder(item.folder)}
                onRenameEnd={(name) => endRenaming(item.folder, name)}
                onRenameStart={() => setRenamingFolderId(item.folder.id)}
              >
                <Box sx={launcherTileGridSx}>
                  {item.children.map((child) =>
                    renderLeafTile(child, item.folder.id)
                  )}
                </Box>
              </LauncherFolderPanel>
            )}
          </TileDropArea>
        </SortableContext>
      ))}

      {/* On the page itself: an ancestor with a transform would shift it. */}
      {createPortal(
        <DragOverlay>
          {draggedLeaf?.pin ? (
            <DraggedTile>
              <LauncherPinIcon app={draggedLeaf.pin.app} />
            </DraggedTile>
          ) : draggedLeaf?.type === 'bookmark' ? (
            <DraggedTile>
              <LauncherBookmarkIcon bookmark={draggedLeaf.bookmark} />
            </DraggedTile>
          ) : draggedFolder ? (
            <DraggedTile>
              <LauncherFolderIcon pictures={folderPictures(draggedFolder)} />
            </DraggedTile>
          ) : null}
        </DragOverlay>,
        document.body
      )}

      <LauncherTileMenu
        folders={shownFolders}
        onClose={() => setMenu(null)}
        onDeleteFolder={askToDeleteFolder}
        onMoveToFolder={(item, folderId) =>
          applyChange((context) =>
            moveItemToFolder(items, item.key, folderId, context)
          )
        }
        onNewFolder={(item) =>
          applyChange((context) =>
            createFolderWithItem(items, item.key, context)
          )
        }
        onOpen={openItem}
        onRemove={(item) =>
          applyChange((context) => removeItem(items, item.key, context))
        }
        onRemoveFromFolder={(item) =>
          applyChange((context) =>
            removeItemFromFolder(items, item.key, context)
          )
        }
        onRenameFolder={startRenaming}
        target={menu}
      />

      <LauncherDeleteFolderDialog
        folder={folderToDelete}
        onCancel={() => setFolderToDelete(null)}
        onConfirm={deleteFolder}
      />
    </DndContext>
  );
};
