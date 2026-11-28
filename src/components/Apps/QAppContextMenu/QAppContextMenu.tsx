import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAtomValue } from 'jotai';
import {
  Box,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import BugReportRoundedIcon from '@mui/icons-material/BugReportRounded';
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import ContentCutRoundedIcon from '@mui/icons-material/ContentCutRounded';
import ContentPasteRoundedIcon from '@mui/icons-material/ContentPasteRounded';
import CropFreeRoundedIcon from '@mui/icons-material/CropFreeRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import InsertLinkRoundedIcon from '@mui/icons-material/InsertLinkRounded';
import LibraryAddRoundedIcon from '@mui/icons-material/LibraryAddRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import OpenInBrowserRoundedIcon from '@mui/icons-material/OpenInBrowserRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PersonSearchRoundedIcon from '@mui/icons-material/PersonSearchRounded';
import PhotoCameraRoundedIcon from '@mui/icons-material/PhotoCameraRounded';
import PictureInPictureAltRoundedIcon from '@mui/icons-material/PictureInPictureAltRounded';
import RedoRoundedIcon from '@mui/icons-material/RedoRounded';
import SelectAllRoundedIcon from '@mui/icons-material/SelectAllRounded';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';
import { enabledDevModeAtom } from '../../../atoms/global';
import { appLockedAtom } from '../../../atoms/presence';
import qortinoHeadUrl from '../../../assets/svgs/QortinoHead.svg';
import { writeQortinoQuestion } from '../../../qortinoAgent/pendingQuestion';
import { executeEvent } from '../../../utils/events';
import { openQortalLink } from '../../../utils/qortalLink/openQortalLink';
import { useQortinoReady } from '../../Group/qortinoHome/useQortinoReady';
import {
  QAPP_MENU_TTL_MS,
  isMenuSeparator,
  type QAppMenuAction,
  type QAppMenuEntry,
  type QAppMenuOpen,
  type QAppMenuResult,
} from '../../../../electron/src/qapp-context-menu-types';

const LABEL_KEYS: Record<
  Exclude<QAppMenuAction, 'replaceMisspelling' | 'lookUp' | 'aboutApp'>,
  string
> = {
  addToDictionary: 'core:qapp_menu.add_to_dictionary',
  undo: 'core:qapp_menu.undo',
  redo: 'core:qapp_menu.redo',
  cut: 'core:qapp_menu.cut',
  copy: 'core:qapp_menu.copy',
  paste: 'core:qapp_menu.paste',
  selectAll: 'core:qapp_menu.select_all',
  savePicture: 'core:qapp_menu.save_picture',
  copyPicture: 'core:qapp_menu.copy_picture',
  saveVideo: 'core:qapp_menu.save_video',
  saveSound: 'core:qapp_menu.save_sound',
  saveLinkedFile: 'core:qapp_menu.save_linked_file',
  copyLink: 'core:qapp_menu.copy_link',
  openLink: 'core:qapp_menu.open_link',
  openQortalLink: 'core:qapp_menu.open_qortal_link',
  openWebLink: 'core:qapp_menu.open_web_link',
  copyPictureLink: 'core:qapp_menu.copy_picture_link',
  copyVideoFrame: 'core:qapp_menu.copy_video_frame',
  saveVideoFrame: 'core:qapp_menu.save_video_frame',
  pictureInPicture: 'core:qapp_menu.picture_in_picture',
  exitPictureInPicture: 'core:qapp_menu.exit_picture_in_picture',
  askQortino: 'core:qapp_menu.ask_qortino',
  copyElement: 'core:qapp_menu.copy_element',
  copyElementPicture: 'core:qapp_menu.copy_element_picture',
  inspectElement: 'core:qapp_menu.inspect_element',
};

const ICON_SIZE = 18;

const ICONS: Partial<Record<QAppMenuAction, ReactNode>> = {
  addToDictionary: <LibraryAddRoundedIcon sx={{ fontSize: ICON_SIZE }} />,
  undo: <UndoRoundedIcon sx={{ fontSize: ICON_SIZE }} />,
  redo: <RedoRoundedIcon sx={{ fontSize: ICON_SIZE }} />,
  cut: <ContentCutRoundedIcon sx={{ fontSize: ICON_SIZE }} />,
  copy: <ContentCopyRoundedIcon sx={{ fontSize: ICON_SIZE }} />,
  paste: <ContentPasteRoundedIcon sx={{ fontSize: ICON_SIZE }} />,
  selectAll: <SelectAllRoundedIcon sx={{ fontSize: ICON_SIZE }} />,
  savePicture: <DownloadRoundedIcon sx={{ fontSize: ICON_SIZE }} />,
  copyPicture: <ContentCopyRoundedIcon sx={{ fontSize: ICON_SIZE }} />,
  saveVideo: <DownloadRoundedIcon sx={{ fontSize: ICON_SIZE }} />,
  saveSound: <DownloadRoundedIcon sx={{ fontSize: ICON_SIZE }} />,
  saveLinkedFile: <DownloadRoundedIcon sx={{ fontSize: ICON_SIZE }} />,
  copyLink: <LinkRoundedIcon sx={{ fontSize: ICON_SIZE }} />,
  openLink: <OpenInNewRoundedIcon sx={{ fontSize: ICON_SIZE }} />,
  openQortalLink: <OpenInNewRoundedIcon sx={{ fontSize: ICON_SIZE }} />,
  openWebLink: <OpenInBrowserRoundedIcon sx={{ fontSize: ICON_SIZE }} />,
  copyPictureLink: <InsertLinkRoundedIcon sx={{ fontSize: ICON_SIZE }} />,
  copyVideoFrame: <PhotoCameraRoundedIcon sx={{ fontSize: ICON_SIZE }} />,
  saveVideoFrame: <DownloadRoundedIcon sx={{ fontSize: ICON_SIZE }} />,
  pictureInPicture: (
    <PictureInPictureAltRoundedIcon sx={{ fontSize: ICON_SIZE }} />
  ),
  exitPictureInPicture: (
    <PictureInPictureAltRoundedIcon sx={{ fontSize: ICON_SIZE }} />
  ),
  lookUp: <PersonSearchRoundedIcon sx={{ fontSize: ICON_SIZE }} />,
  askQortino: (
    <Box
      component="img"
      alt=""
      src={qortinoHeadUrl}
      sx={{ height: ICON_SIZE, objectFit: 'contain', width: ICON_SIZE }}
    />
  ),
  aboutApp: <InfoOutlinedIcon sx={{ fontSize: ICON_SIZE }} />,
  copyElement: <CodeRoundedIcon sx={{ fontSize: ICON_SIZE }} />,
  copyElementPicture: <CropFreeRoundedIcon sx={{ fontSize: ICON_SIZE }} />,
  inspectElement: <BugReportRoundedIcon sx={{ fontSize: ICON_SIZE }} />,
};

/** Time for the app's webview to take the keyboard before main acts in it. */
export const FOCUS_SETTLE_MS = 50;

const contains = (rect: DOMRect, x: number, y: number) =>
  rect.width > 0 &&
  rect.height > 0 &&
  x >= rect.left &&
  x <= rect.right &&
  y >= rect.top &&
  y <= rect.bottom;

/** Whether an app's webview is still on screen at that point. */
function shownAt(view: HTMLElement | null, x: number, y: number) {
  if (!view?.isConnected) return false;
  if (getComputedStyle(view).visibility === 'hidden') return false;
  return contains(view.getBoundingClientRect(), x, y);
}

/** Marks this menu's own layer, which lies over the whole window. */
const MENU_LAYER = 'data-qapp-menu';

/** A menu closes this long before main forgets it (QAPP_MENU_TTL_MS). */
export const MENU_CLOSES_EARLY_MS = 2_000;

/**
 * The app's webview on screen at that point of Hub's page: the one the menu
 * belongs to (a tab, the Q-Wallets or Q-Manager window, a widget). None
 * when something of Hub's covers the point. This menu's own layer is looked
 * through, also while it fades out: a right-click on it is meant for what
 * is under it.
 */
function webviewAt(x: number, y: number): HTMLElement | null {
  const stack: (Element | null | undefined)[] =
    typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(x, y)
      : [document.elementFromPoint?.(x, y)];
  const top = stack.find(
    (element) => element && !element.closest?.(`[${MENU_LAYER}]`)
  );
  const view = top?.closest?.('webview') as HTMLElement | null | undefined;
  return view && shownAt(view, x, y) ? view : null;
}

/**
 * Gives the app the keyboard. Main's own focus() doesn't reach a webview
 * while Hub's page holds the keyboard, and the app's editing (paste, a
 * spelling fix) needs it. The closing menu hands Hub's focus back to the
 * webview element without the app getting the keyboard, so it's blurred
 * first: focus() on the active element does nothing.
 */
function focusApp(view: HTMLElement) {
  view.blur();
  view.focus();
}

/** An item's text: most are fixed, some name what they act on. */
function labelOf(entry: QAppMenuEntry, t: TFunction): string {
  switch (entry.action) {
    case 'replaceMisspelling':
      return entry.label ?? '';
    case 'lookUp':
      return t('core:qapp_menu.look_up', {
        text: entry.label ?? '',
        postProcess: 'capitalizeFirstChar',
      });
    case 'aboutApp':
      // Written capitalized in each language: in some the app's name comes
      // first, and it is shown as it is.
      return t('core:qapp_menu.about_app', { name: entry.label ?? '' });
    default:
      return t(LABEL_KEYS[entry.action], {
        postProcess: 'capitalizeFirstChar',
      });
  }
}

/**
 * What main hands back for the Hub page to carry out, each with Hub's own
 * opener: a Q-App, website or app page link (the link opener reads it
 * again), a name or address for the lookup panel, a question for Qortino.
 */
function carryOut(result: QAppMenuResult | boolean | undefined, t: TFunction) {
  if (!result || typeof result !== 'object') return;
  if ('open' in result && typeof result.open === 'string') {
    void openQortalLink(result.open);
  } else if ('lookUp' in result && typeof result.lookUp === 'string') {
    executeEvent('openUserLookupDrawer', { addressOrName: result.lookUp });
  } else if ('ask' in result && typeof result.ask === 'string') {
    // Written in Qortino's box: the user changes it if they like, and sends.
    writeQortinoQuestion(
      t('core:qapp_menu.ask_qortino_question', { text: result.ask })
    );
  }
}

type ShownMenu = QAppMenuOpen & {
  /** The app's webview the menu belongs to. */
  view: HTMLElement;
};

type Pending = {
  menu: ShownMenu;
  /** The item chosen; none when the menu closed with nothing chosen. */
  entry?: QAppMenuEntry;
};

/**
 * The right-click menu inside Q-Apps and websites. Main asks for it when an
 * app is right-clicked; this shows it at the pointer when that app is on
 * screen there, and tells main only which item was chosen, once the menu has
 * closed and only while the app is still on screen.
 */
export function QAppContextMenu() {
  const { t } = useTranslation(['core']);
  const theme = useTheme();
  const locked = useAtomValue(appLockedAtom);
  const devMode = useAtomValue(enabledDevModeAtom);
  // Qortino AI set up on this PC (a model downloaded): only then "Ask
  // Qortino".
  const qortinoReady = useQortinoReady();
  const [menu, setMenu] = useState<ShownMenu | null>(null);
  // The last menu shown: its items stay while it fades out.
  const [lastMenu, setLastMenu] = useState<ShownMenu | null>(null);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  // What happens once the menu has closed (and MUI has handed focus back).
  const pendingRef = useRef<Pending | null>(null);

  const finish = () => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    const api = window.electronAPI;
    const { menuId, view, x, y } = pending.menu;
    // Its tab hidden meanwhile (a tab shortcut, a close): nothing runs in it.
    if (lockedRef.current || !shownAt(view, x, y)) {
      void api?.qappMenuDismiss?.(menuId);
      return;
    }
    focusApp(view);
    if (!pending.entry) {
      void api?.qappMenuDismiss?.(menuId);
      return;
    }
    const { action, index } = pending.entry;
    window.setTimeout(() => {
      if (!shownAt(view, x, y)) {
        void api?.qappMenuDismiss?.(menuId);
        return;
      }
      void Promise.resolve(api?.qappMenuAct?.(menuId, action, index)).then(
        (result) => {
          // Hub locked, or signed out (this menu gone), meanwhile.
          if (lockedRef.current || !mountedRef.current) return;
          carryOut(result, tRef.current);
        },
        () => undefined
      );
    }, FOCUS_SETTLE_MS);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const tRef = useRef(t);
  tRef.current = t;
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Main offers dev mode's items and "Ask Qortino" only while these say so.
  useEffect(() => {
    void window.electronAPI?.qappMenuSettings?.({
      devMode: devMode === true,
      qortino: qortinoReady === true,
    });
  }, [devMode, qortinoReady]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onQAppMenuOpen) return;
    return api.onQAppMenuOpen((next) => {
      if (!next || typeof next.menuId !== 'string') return;
      const view = lockedRef.current ? null : webviewAt(next.x, next.y);
      if (!view) {
        void api.qappMenuDismiss?.(next.menuId);
        return;
      }
      // A newer right-click: a choice still waiting for the last menu to
      // close is dropped (main has forgotten that menu already).
      pendingRef.current = null;
      const shown = { ...next, view };
      setLastMenu(shown);
      setMenu(shown);
    });
  }, []);

  // Its app leaving the screen (a tab shortcut, the tab closing) closes the
  // menu: nothing chosen runs in an app that isn't shown.
  useEffect(() => {
    if (!menu || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => !entry.isIntersecting)) {
        pendingRef.current = null;
        void window.electronAPI?.qappMenuDismiss?.(menu.menuId);
        setMenu(null);
      }
    });
    observer.observe(menu.view);
    return () => observer.disconnect();
  }, [menu]);

  // Main carries out nothing from a menu left open QAPP_MENU_TTL_MS: it
  // closes a moment before that, so no item on screen does nothing.
  useEffect(() => {
    if (!menu) return;
    const timer = window.setTimeout(() => {
      pendingRef.current = null;
      void window.electronAPI?.qappMenuDismiss?.(menu.menuId);
      setMenu(null);
    }, QAPP_MENU_TTL_MS - MENU_CLOSES_EARLY_MS);
    return () => window.clearTimeout(timer);
  }, [menu]);

  // Locking closes the menu, and main opens none while locked.
  useEffect(() => {
    void window.electronAPI?.qappMenuHubLocked?.(locked);
    if (locked) {
      pendingRef.current = null;
      setMenu(null);
    }
  }, [locked]);

  const close = (entry?: QAppMenuEntry) => {
    if (!menu) return;
    pendingRef.current = { menu, entry };
    setMenu(null);
  };

  const choose = (entry: QAppMenuEntry) => {
    if (!entry.disabled) close(entry);
  };

  /**
   * A right-click on the backdrop: this menu closes, and the right-click
   * goes on to the app under it, which opens its own menu there (Hub's,
   * with Shift held, as for any right-click).
   */
  const rightClickThrough = (x: number, y: number, shift: boolean) => {
    if (!menu) return;
    // The app on top there, under this menu: none where Hub's own panel
    // (Qortino, a save's card) covers it.
    const view = webviewAt(x, y) as
      | (HTMLElement & { getWebContentsId?: () => number })
      | null;
    pendingRef.current = null;
    void window.electronAPI?.qappMenuDismiss?.(menu.menuId);
    setMenu(null);
    const guestId = view?.getWebContentsId?.();
    if (!view || typeof guestId !== 'number') return;
    const rect = view.getBoundingClientRect();
    void window.electronAPI?.qappMenuRightClick?.(
      guestId,
      x - rect.left,
      y - rect.top,
      shift
    );
  };

  const textSx = {
    '& .MuiListItemText-primary': {
      color: theme.palette.text.primary,
      fontSize: '12px',
      fontWeight: 600,
    },
    '& .MuiListItemText-secondary': {
      fontSize: '11px',
      whiteSpace: 'normal',
    },
  };
  const iconSx = { marginRight: '6px', minWidth: '24px !important' };

  return (
    <Menu
      {...{ [MENU_LAYER]: '' }}
      open={!!menu}
      onClose={() => close()}
      // The menu gives the keyboard back to the app itself once it has
      // closed (finish). MUI's own hand-back would take it from the lock
      // screen's password field when Hub locks with a menu open.
      disableRestoreFocus
      anchorReference="anchorPosition"
      anchorPosition={
        lastMenu ? { top: lastMenu.y, left: lastMenu.x } : undefined
      }
      onContextMenu={(event) => {
        event.preventDefault();
        const target = event.target as HTMLElement;
        if (!target.closest?.('.MuiMenu-paper')) {
          rightClickThrough(event.clientX, event.clientY, event.shiftKey);
        }
      }}
      slotProps={{
        list: {
          'aria-label': t('core:qapp_menu.label', {
            postProcess: 'capitalizeFirstChar',
          }),
          dense: true,
        },
        transition: { onExited: () => finishRef.current() },
        paper: {
          sx: {
            backgroundColor: theme.palette.background.default,
            border: `1px solid ${theme.palette.border.subtle}`,
            borderRadius: '6px',
            color: theme.palette.text.primary,
            maxWidth: '320px',
            minWidth: '180px',
          },
        },
      }}
    >
      {(lastMenu?.items ?? []).map((item, position) =>
        isMenuSeparator(item) ? (
          <Divider
            key={`separator-${position}`}
            sx={{ borderColor: theme.palette.border.subtle }}
          />
        ) : (
          <MenuItem
            key={`${item.action}-${item.index ?? position}`}
            disabled={item.disabled}
            onClick={() => choose(item)}
          >
            <ListItemIcon sx={iconSx}>
              {ICONS[item.action] ?? <Box sx={{ width: ICON_SIZE }} />}
            </ListItemIcon>
            <ListItemText
              sx={textSx}
              primary={labelOf(item, t)}
              secondary={
                item.reason === 'streamed'
                  ? t('core:qapp_menu.streamed', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : undefined
              }
            />
          </MenuItem>
        )
      )}
    </Menu>
  );
}
