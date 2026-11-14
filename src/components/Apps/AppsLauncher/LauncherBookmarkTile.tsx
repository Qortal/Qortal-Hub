import type { ComponentProps } from 'react';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import { executeEvent } from '../../../utils/events';
import type { AppBookmark } from '../AppBookmarks/bookmarkTypes';
import { LauncherAppIcon, LauncherTile } from './LauncherTile';

/** Opens a bookmarked page in a tab. */
export const openLauncherBookmark = (bookmark: AppBookmark) => {
  executeEvent('addTab', {
    data: {
      service: bookmark.service,
      name: bookmark.appName,
      identifier: bookmark.identifier,
      path: bookmark.path,
    },
  });
  executeEvent('open-apps-mode', {});
};

/** The picture of a bookmark: its app's picture, with a bookmark mark. */
export const LauncherBookmarkIcon = ({
  bookmark,
}: {
  bookmark: AppBookmark;
}) => (
  <LauncherAppIcon
    appName={bookmark.appName}
    badge={<BookmarkIcon sx={{ fontSize: 12 }} />}
  />
);

type LauncherBookmarkTileProps = {
  bookmark: AppBookmark;
  /** Called after the page was asked to open. */
  onOpened?: () => void;
} & Omit<ComponentProps<typeof LauncherTile>, 'icon' | 'label' | 'onClick'>;

/** A bookmark as a tile, with the bookmark's name. A click opens the page. */
export const LauncherBookmarkTile = ({
  bookmark,
  onOpened,
  ...tileProps
}: LauncherBookmarkTileProps) => (
  <LauncherTile
    {...tileProps}
    icon={<LauncherBookmarkIcon bookmark={bookmark} />}
    label={bookmark.name || bookmark.appName}
    onClick={() => {
      openLauncherBookmark(bookmark);
      onOpened?.();
    }}
  />
);
