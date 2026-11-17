import {
  createRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { flushSync } from 'react-dom';

import type { ReactNode } from 'react';
import {
  closestCenter,
  type CollisionDetection,
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  horizontalListSortingStrategy,
  SortableContext,
} from '@dnd-kit/sortable';
import { isLauncherSubPage } from './AppsLauncher';
import { AppsDevModeHome } from './AppsDevModeHome';
import { Spacer } from '../../common/Spacer';
import { getBaseApiReact } from '../../App';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { clearSessionPermissionsByTabId } from '../../qortal/qortal-requests';
import {
  APPS_HORIZONTAL_TAB_HEIGHT_PX,
  AppsHorizontalTabAddButton,
  AppsHorizontalTabBar,
  AppsHorizontalTabScrollArea,
  AppsHorizontalTabScroller,
  AppsParent,
} from './Apps-styles';
import AppViewerContainer from './AppViewerContainer';
import TabComponent from './TabComponent';
import ShortUniqueId from 'short-unique-id';
import {
  RatingsCacheInitializer,
  useAppRatings,
} from '../../hooks/useAppRatings';
import { PendingVotesWatcher } from './AppPage/PendingVotesWatcher';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  appsSubPageCanGoBackAtom,
  navigationControllerAtom,
  isNewTabWindowAtom,
  userInfoAtom,
} from '../../atoms/global';
import { availableQappsAtom } from '../../atoms/appsAtoms';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  TIME_MINUTES_2_IN_MILLISECONDS,
  TIME_MINUTES_20_IN_MILLISECONDS,
} from '../../constants/constants';
import { appChromeOffsetPx } from '../Desktop/CustomTitleBar';
import { extractComponents } from '../Chat/MessageDisplay';
import { QORTAL_PROTOCOL } from '../../constants/constants';
import { QCHAT_INTERNAL_TAB_ID } from '../../utils/openQChatTab';
import {
  dialogActionsSx,
  dialogContentSx,
  dialogContentTextSx,
  dialogTitleSx,
  getDialogDangerButtonSx,
  getDialogPaperSx,
  getDialogSecondaryButtonSx,
} from '../App/dialogSurface';

import {
  closeAllKeptNoteKey,
  pickNextTabFromMru,
  tabsLeftByCloseAll,
} from './tabSelection';
import { namesOwnResources } from './libraryResources';
import {
  isPinnedTab,
  moveTabWithinGroup,
  pinnedFirst,
  setTabPinned,
} from './tabPinning';
import {
  layoutTabStrip,
  PINNED_TAB_WIDTH_PX,
  scrollLeftToShow,
  TAB_IDEAL_WIDTH_PX,
  TAB_STRIP_GAP_PX,
  wheelScrollPx,
} from './tabStripLayout';
import {
  createTabSessionWriter,
  isPrivateTabToReopen,
  loadTabSession,
  reportedAppPath,
  restoredTab,
  serializeTabSession,
  tabFlags,
  type TabSession,
  type TabSessionWriter,
} from './tabSession';
import { useHandlePrivateApps } from '../../hooks/useHandlePrivateApps';
import { isSamePrivateApp } from '../../hooks/privatePinnedApps';
import { isSameResourceIdentifier } from './resourceIdentifier';
import {
  canGoBackInLauncher,
  isLauncherTab,
  keepOpenLauncherStates,
  launcherPageBack,
  launcherTabToShow,
  type LauncherTabState,
  newLauncherTab,
  newLauncherTabState,
  restartLauncher,
  showAppInfo,
  showCategory,
} from './launcherTabs';
import { LauncherTabView } from './LauncherTabView';

import { useTabShortcuts } from './useTabShortcuts';


const uid = new ShortUniqueId({ length: 8 });
const MAX_OPEN_APP_TABS = 10;
/** A launcher tab's page until it has one of its own. */
const INITIAL_LAUNCHER_TAB_STATE = newLauncherTabState();
const MIN_LIBRARY_APPS_BEFORE_SLOW_POLL = 10;
/** Bounded MRU stack (tab ids only) for "last visited" after closing the active tab */
const MAX_TAB_MRU_DEPTH = 64;

/** A restored private app being downloaded and decrypted again. */
type PrivateReopenRequest = { tabId: string; address: string };

/** Prefer the tab that was to the right of the closed tab; if closed tab was last, use the new last tab */
function positionalTabAfterClose(
  remainingTabs: { tabId: string }[],
  removedTabId: string,
  tabsBeforeRemove: { tabId: string }[]
): { tabId: string } | null {
  if (!remainingTabs.length) return null;
  const removedIndex = tabsBeforeRemove.findIndex(
    (tab) => tab?.tabId === removedTabId
  );
  if (removedIndex === -1) {
    return remainingTabs[remainingTabs.length - 1] ?? remainingTabs[0] ?? null;
  }
  if (removedIndex < remainingTabs.length) {
    return remainingTabs[removedIndex] ?? null;
  }
  return remainingTabs[removedIndex - 1] ?? null;
}
const SIDEBAR_CHROME_TRANSITION = '200ms cubic-bezier(0.2, 0, 0, 1)';

const restrictTabsToHorizontalAxis = ({ transform }) => ({
  ...transform,
  y: 0,
});

const restrictTabsToStrip = ({
  activeNodeRect,
  containerNodeRect,
  transform,
}) => {
  if (!activeNodeRect || !containerNodeRect) {
    return {
      ...transform,
      y: 0,
    };
  }

  const minX = containerNodeRect.left - activeNodeRect.left;
  const maxX = containerNodeRect.right - activeNodeRect.right;

  return {
    ...transform,
    x: Math.min(Math.max(transform.x, minX), maxX),
    y: 0,
  };
};

function normalizeQortalInput(value: string) {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  if (/^qortal:\/\//i.test(trimmed)) return trimmed;
  return `${QORTAL_PROTOCOL}${trimmed}`;
}

/** Local dev / preview iframe tab (not a published Q-App); has no `service` (Q-Chat uses INTERNAL). */
function isLocalDevTab(tab: { service?: string } | null | undefined) {
  return !!tab && !tab.service;
}

const DEV_MODE_SIDEBAR_SAFE_INSET_PX = 88;

type InternalTabVisibilityArgs = {
  isVisible: boolean;
  tab: any;
};

type RenderInternalTabArgs = {
  hide: boolean;
  isSelected: boolean;
  tab: any;
};

type AppsDesktopProps = {
  mode: string;
  setMode: (mode: string) => void;
  devMode: string;
  setDevMode: (mode: string) => void;
  desktopViewMode: string;
  setDesktopViewMode: (mode: string) => void;
  onInternalTabVisibilityChange?: (args: InternalTabVisibilityArgs) => void;
  renderInternalTab?: (args: RenderInternalTabArgs) => ReactNode;
  show: boolean;
};

export const AppsDesktop = ({
  mode,
  setMode,
  devMode,
  setDevMode,
  desktopViewMode,
  setDesktopViewMode,
  onInternalTabVisibilityChange,
  renderInternalTab,
  show,
}: AppsDesktopProps) => {
  const theme = useTheme();
  const navigationController = useAtomValue(navigationControllerAtom);
  const userInfo = useAtomValue(userInfoAtom);
  const myName = userInfo?.name;
  const myAddress = userInfo?.address;
  const [availableQapps, setAvailableQapps] = useAtom(availableQappsAtom);
  const availableQappsCountRef = useRef(0);
  const [tabs, setTabs] = useState([]);
  const [viewerTabOrder, setViewerTabOrder] = useState<string[]>([]);
  const [selectedTab, setSelectedTab] = useState(null);
  const selectedTabRef = useRef(selectedTab);
  selectedTabRef.current = selectedTab;
  // Each launcher tab's page (launcherTabs.ts), by tab id.
  const [launcherTabStates, setLauncherTabStates] = useState<
    Record<string, LauncherTabState>
  >({});
  // Only Dev Mode's own new tab page sets it now: the launcher is a tab.
  const [isNewTabWindow, setIsNewTabWindow] = useAtom(isNewTabWindowAtom);
  const [categories, setCategories] = useState([]);
  const iframeRefs = useRef({});
  const tabsTokenRef = useRef(0);
  const { refreshRatings } = useAppRatings();
  const [showCloseTabDialog, setShowCloseTabDialog] = useState(false);
  const [pendingTabToRemove, setPendingTabToRemove] = useState(null);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState<{
    message: string;
    type: 'warning' | 'error' | 'success' | 'info';
  } | null>(null);
  const [sidebarOffsetPx, setSidebarOffsetPx] = useState(0);
  const [enteringTabIds, setEnteringTabIds] = useState<string[]>([]);
  const [tabWidthPx, setTabWidthPx] = useState(TAB_IDEAL_WIDTH_PX);
  const tabScrollerRef = useRef<HTMLDivElement | null>(null);
  const tabScrollAreaRef = useRef<HTMLDivElement | null>(null);
  const tabAddButtonRef = useRef<HTMLButtonElement | null>(null);
  const tabsToNavTimeoutRef = useRef<number | null>(null);
  const tabEntryCleanupTimeoutRef = useRef<number | null>(null);
  const recentTabIdsRef = useRef<string[]>([]);
  const tabPointerUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const tabInteractionLockedRef = useRef(false);
  // The account whose open tabs are kept (tabSession.ts), once they are read.
  const [sessionAddress, setSessionAddress] = useState<string | null>(null);
  const storedSessionRef = useRef<TabSession | null>(null);
  const sessionWriterRef = useRef<TabSessionWriter | null>(null);
  // Tabs whose app has been shown. A restored tab loads the first time it is
  // selected, then stays loaded like the others.
  const [shownTabIds, setShownTabIds] = useState<Set<string>>(() => new Set());
  const { openApp: openPrivateApp } = useHandlePrivateApps();
  // The hook hands out a new `openApp` on every render: keep the latest.
  const openPrivateAppRef = useRef(openPrivateApp);
  openPrivateAppRef.current = openPrivateApp;
  // Restored private apps being downloaded and decrypted again, by tab.
  const reopenRequestsRef = useRef<Map<string, PrivateReopenRequest>>(
    new Map()
  );
  // What a request is checked against when it ends: the tabs and the account
  // as last drawn, and whether this view is still there (signing out removes
  // it, and the next account gets a new one).
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const myAddressRef = useRef(myAddress);
  myAddressRef.current = myAddress;
  const isMountedRef = useRef(true);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );
  const { t } = useTranslation(['auth', 'core', 'group', 'question']);

  // The open tabs come back after a restart: once, when the account is first
  // known, and never over tabs already opened in this run.
  useEffect(() => {
    if (!myAddress || sessionAddress) return;
    const saved = loadTabSession(myAddress, MAX_OPEN_APP_TABS);
    storedSessionRef.current = saved;
    if (tabs.length === 0 && saved.tabs.length > 0) {
      setTabs(pinnedFirst(saved.tabs.map(restoredTab)));
      // Hub starts on Home and its Apps button opens the launcher, so no
      // restored tab is selected, and none loads, until one is chosen. The
      // one that was selected is the first Hub falls back to.
      recentTabIdsRef.current = saved.selectedTabId
        ? [saved.selectedTabId]
        : [];
    }
    setSessionAddress(myAddress);
  }, [myAddress, sessionAddress, tabs.length]);

  useEffect(() => {
    if (!sessionAddress) return;
    const writer = createTabSessionWriter(sessionAddress, {
      saved: storedSessionRef.current ?? undefined,
    });
    sessionWriterRef.current = writer;
    const flush = () => writer.flush();
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      writer.flush();
      sessionWriterRef.current = null;
    };
  }, [sessionAddress]);

  // Saves the tabs, their order, the selected one (or, while none is, the
  // last one selected) and where each app is. Launcher tabs are not kept, so
  // while one shows, the tab kept as selected is the last other one viewed.
  useEffect(() => {
    if (!sessionAddress || myAddress !== sessionAddress) return;
    const selectedTabId =
      (isLauncherTab(selectedTab) ? null : selectedTab?.tabId) ??
      pickNextTabFromMru(
        tabs.filter((tab) => !isLauncherTab(tab)),
        recentTabIdsRef.current
      )?.tabId;
    sessionWriterRef.current?.update(
      serializeTabSession(tabs, selectedTabId, MAX_OPEN_APP_TABS, (tab) =>
        reportedAppPath(tab, navigationController?.[tab.tabId]?.currentLink)
      )
    );
  }, [
    myAddress,
    navigationController,
    selectedTab?.tabId,
    sessionAddress,
    tabs,
  ]);

  useEffect(() => {
    const tabId = selectedTab?.tabId;
    if (!tabId) return;
    setShownTabIds((prev) =>
      prev.has(tabId) ? prev : new Set(prev).add(tabId)
    );
  }, [selectedTab?.tabId]);

  useEffect(() => {
    isMountedRef.current = true;
    const requests = reopenRequestsRef.current;
    return () => {
      isMountedRef.current = false;
      requests.clear();
    };
  }, []);

  // A request still counts while this view shows the account that made it
  // and its tab is still in the strip, waiting for its app.
  const isReopenWanted = useCallback(
    (request: PrivateReopenRequest) =>
      isMountedRef.current &&
      myAddressRef.current === request.address &&
      reopenRequestsRef.current.get(request.tabId) === request &&
      tabsRef.current.some(
        (tab) => tab?.tabId === request.tabId && isPrivateTabToReopen(tab)
      ),
    []
  );

  // The reopened app takes its tab's place and keeps the tab's marks. The
  // selection stays as it is: the app shows only if its tab is selected.
  const finishReopen = useCallback(
    (request: PrivateReopenRequest, appTab) => {
      if (!isReopenWanted(request)) return;
      const waiting = tabsRef.current.find(
        (tab) => tab?.tabId === request.tabId
      );
      const reopened = {
        ...tabFlags(waiting),
        ...appTab,
        tabId: request.tabId,
      };
      setTabs((prev) =>
        prev.map((tab) =>
          tab?.tabId === request.tabId && isPrivateTabToReopen(tab)
            ? reopened
            : tab
        )
      );
      setSelectedTab((selected) =>
        selected?.tabId === request.tabId ? reopened : selected
      );
    },
    [isReopenWanted]
  );

  // A restored private app is downloaded and decrypted again when its tab is
  // selected. The request belongs to that tab and to the account that made
  // it: closing the tab, or signing out, drops it.
  const reopenPrivateTab = useCallback(
    (tab) => {
      if (!isPrivateTabToReopen(tab)) return;
      const address = myAddressRef.current;
      const requests = reopenRequestsRef.current;
      if (!address || requests.has(tab.tabId)) return;
      const request: PrivateReopenRequest = { tabId: tab.tabId, address };
      requests.set(tab.tabId, request);
      Promise.resolve()
        .then(() =>
          openPrivateAppRef.current(
            tab.privateAppProperties,
            false,
            undefined,
            {
              isWanted: () => isReopenWanted(request),
              openTab: (appTab) => finishReopen(request, appTab),
            }
          )
        )
        .catch((error) => console.error(error))
        .finally(() => {
          if (requests.get(tab.tabId) === request) {
            requests.delete(tab.tabId);
          }
        });
    },
    [finishReopen, isReopenWanted]
  );

  useEffect(() => {
    if (isPrivateTabToReopen(selectedTab)) reopenPrivateTab(selectedTab);
  }, [reopenPrivateTab, selectedTab]);

  const myApp = useMemo(() => {
    return availableQapps.find(
      (app) =>
        app.name === myName &&
        app.service ===
          t('core:app', {
            postProcess: 'capitalizeAll',
          })
    );
  }, [myName, availableQapps]);

  const myWebsite = useMemo(() => {
    return availableQapps.find(
      (app) =>
        app.name === myName &&
        app.service ===
          t('core:website', {
            postProcess: 'capitalizeAll',
          })
    );
  }, [myName, availableQapps]);

  useEffect(() => {
    setViewerTabOrder((prev) => {
      const nextIds = tabs
        .map((tab) => tab?.tabId)
        .filter((tabId): tabId is string => !!tabId);
      const nextIdSet = new Set(nextIds);
      const kept = prev.filter((tabId) => nextIdSet.has(tabId));
      const keptSet = new Set(kept);
      const appended = nextIds.filter((tabId) => !keptSet.has(tabId));
      const next = [...kept, ...appended];

      if (
        next.length === prev.length &&
        next.every((tabId, index) => tabId === prev[index])
      ) {
        return prev;
      }

      return next;
    });
  }, [tabs]);

  const tabsById = useMemo(() => {
    const byId = new Map<string, any>();
    tabs.forEach((tab) => {
      if (tab?.tabId) {
        byId.set(tab.tabId, tab);
      }
    });
    return byId;
  }, [tabs]);

  const viewerTabs = useMemo(() => {
    return viewerTabOrder.map((tabId) => tabsById.get(tabId)).filter(Boolean);
  }, [tabsById, viewerTabOrder]);

  // `tabs` keeps the pinned tabs first; they sit apart from the others,
  // which scroll once they are at their narrowest.
  const pinnedTabs = useMemo(() => tabs.filter(isPinnedTab), [tabs]);
  const unpinnedTabs = useMemo(
    () => tabs.filter((tab) => !isPinnedTab(tab)),
    [tabs]
  );
  const pinnedTabIds = useMemo(
    () => new Set(pinnedTabs.map((tab) => tab.tabId)),
    [pinnedTabs]
  );

  useEffect(() => {
    if (tabsToNavTimeoutRef.current !== null) {
      window.clearTimeout(tabsToNavTimeoutRef.current);
    }
    tabsTokenRef.current += 1;
    const tabsToken = tabsTokenRef.current;
    tabsToNavTimeoutRef.current = window.setTimeout(() => {
      executeEvent('setTabsToNav', {
        data: {
          tabs: tabs,
          selectedTab: selectedTab,
          isNewTabWindow: isNewTabWindow,
          tabsToken,
        },
      });
    }, 100);
    return () => {
      if (tabsToNavTimeoutRef.current !== null) {
        window.clearTimeout(tabsToNavTimeoutRef.current);
        tabsToNavTimeoutRef.current = null;
      }
    };
  }, [show, tabs, selectedTab, isNewTabWindow]);

  useEffect(() => {
    if (desktopViewMode !== 'dev' || devMode !== 'home' || isNewTabWindow) {
      return;
    }

    if (selectedTab) {
      setSelectedTab(null);
    }

    tabsTokenRef.current += 1;
    const tabsToken = tabsTokenRef.current;
    executeEvent('setTabsToNav', {
      data: {
        tabs,
        selectedTab: null,
        isNewTabWindow: false,
        tabsToken,
      },
    });
    executeEvent('forceNavClear', { data: { tabsToken } });
    executeEvent('clearNavInput', {});
  }, [desktopViewMode, devMode, isNewTabWindow, selectedTab, tabs]);

  useEffect(() => {
    const id = selectedTab?.tabId;
    if (!id) return;
    const prev = recentTabIdsRef.current;
    const filtered = prev.filter((x) => x !== id);
    filtered.push(id);
    recentTabIdsRef.current =
      filtered.length > MAX_TAB_MRU_DEPTH
        ? filtered.slice(-MAX_TAB_MRU_DEPTH)
        : filtered;
  }, [selectedTab?.tabId]);

  useEffect(() => {
    return () => {
      if (tabEntryCleanupTimeoutRef.current !== null) {
        window.clearTimeout(tabEntryCleanupTimeoutRef.current);
      }
      if (tabPointerUnlockTimerRef.current !== null) {
        clearTimeout(tabPointerUnlockTimerRef.current);
        tabPointerUnlockTimerRef.current = null;
      }
      tabInteractionLockedRef.current = false;
    };
  }, []);

  useEffect(() => {
    onInternalTabVisibilityChange?.({
      isVisible:
        !!show &&
        !isNewTabWindow &&
        selectedTab?.internal === QCHAT_INTERNAL_TAB_ID,
      tab: selectedTab,
    });
  }, [isNewTabWindow, onInternalTabVisibilityChange, selectedTab, show]);

  // Tabs stay at their ideal width while they fit, then shrink evenly down to
  // a minimum, after which they scroll (tabStripLayout.ts).
  const updateTabStripLayout = useCallback(() => {
    const scroller = tabScrollerRef.current;
    if (!scroller || unpinnedTabs.length === 0) {
      setTabWidthPx(TAB_IDEAL_WIDTH_PX);
      return;
    }
    if (!show || scroller.clientWidth < 32) {
      return;
    }
    const cs = getComputedStyle(scroller);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const { tabWidthPx: nextTabWidthPx } = layoutTabStrip({
      addButtonPx: tabAddButtonRef.current?.offsetWidth ?? 36,
      availablePx: Math.floor(scroller.clientWidth - padL - padR),
      gapPx: parseFloat(cs.columnGap) || TAB_STRIP_GAP_PX,
      pinnedCount: pinnedTabs.length,
      unpinnedCount: unpinnedTabs.length,
    });
    setTabWidthPx(nextTabWidthPx);
  }, [show, pinnedTabs.length, unpinnedTabs.length]);

  useLayoutEffect(() => {
    updateTabStripLayout();
    const id = window.requestAnimationFrame(() => updateTabStripLayout());
    return () => window.cancelAnimationFrame(id);
  }, [updateTabStripLayout, sidebarOffsetPx]);

  useLayoutEffect(() => {
    const scroller = tabScrollerRef.current;
    const addBtn = tabAddButtonRef.current;
    if (!scroller) return;
    const ro = new ResizeObserver(() => updateTabStripLayout());
    ro.observe(scroller);
    if (addBtn) {
      ro.observe(addBtn);
    }
    return () => ro.disconnect();
  }, [updateTabStripLayout]);

  // Keeps the selected tab in view when the tabs scroll, a new one included.
  useLayoutEffect(() => {
    const area = tabScrollAreaRef.current;
    const selectedTabId = selectedTab?.tabId;
    if (!area || !selectedTabId) return;
    const tabElement = Array.from(
      area.querySelectorAll<HTMLElement>('[data-tab-id]')
    ).find((element) => element.dataset.tabId === selectedTabId);
    if (!tabElement) return;
    const nextScrollLeft = scrollLeftToShow({
      endPx: tabElement.offsetLeft + tabElement.offsetWidth,
      scrollLeft: area.scrollLeft,
      startPx: tabElement.offsetLeft,
      viewPx: area.clientWidth,
    });
    if (nextScrollLeft !== area.scrollLeft) {
      area.scrollLeft = nextScrollLeft;
    }
  }, [
    pinnedTabs.length,
    selectedTab?.tabId,
    show,
    tabWidthPx,
    unpinnedTabs.length,
  ]);

  // A mouse wheel over the strip moves the scrolling tabs sideways. The
  // listener is not passive, so the page underneath doesn't scroll too.
  useEffect(() => {
    const scroller = tabScrollerRef.current;
    if (!scroller) return;
    const handleWheel = (event: WheelEvent) => {
      const area = tabScrollAreaRef.current;
      if (!area || event.ctrlKey) return;
      const maxScrollLeft = area.scrollWidth - area.clientWidth;
      if (maxScrollLeft <= 0) return;
      // A sideways swipe over the tabs already scrolls them.
      const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (sideways && area.contains(event.target as Node)) return;
      event.preventDefault();
      const nextScrollLeft = Math.min(
        maxScrollLeft,
        Math.max(0, area.scrollLeft + wheelScrollPx(event, area.clientWidth))
      );
      if (nextScrollLeft !== area.scrollLeft) {
        area.scrollLeft = nextScrollLeft;
      }
    };
    scroller.addEventListener('wheel', handleWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', handleWheel);
  }, []);

  // A new launcher tab fades in where the + is.
  const animateTabEntry = useCallback((tabId: string) => {
    if (tabEntryCleanupTimeoutRef.current !== null) {
      window.clearTimeout(tabEntryCleanupTimeoutRef.current);
    }
    setEnteringTabIds([tabId]);
    tabEntryCleanupTimeoutRef.current = window.setTimeout(() => {
      tabEntryCleanupTimeoutRef.current = null;
      setEnteringTabIds([]);
    }, 220);
  }, []);

  const getCategories = useCallback(async () => {
    try {
      const url = `${getBaseApiReact()}/arbitrary/categories`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response?.ok) return;
      const responseData = await response.json();

      setCategories(responseData);
    } catch (error) {
      console.log(error);
    }
  }, []);

  const getQapps = useCallback(async () => {
    try {
      let apps = [];
      let websites = [];
      const url = `${getBaseApiReact()}/arbitrary/resources/search?service=APP&default=true&mode=ALL&limit=0&includestatus=true&includemetadata=true`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response?.ok) return;
      const responseData = await response.json();
      const urlWebsites = `${getBaseApiReact()}/arbitrary/resources/search?service=WEBSITE&default=true&mode=ALL&limit=0&includestatus=true&includemetadata=true`;

      const responseWebsites = await fetch(urlWebsites, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!responseWebsites?.ok) return;
      const responseDataWebsites = await responseWebsites.json();

      apps = responseData;
      websites = responseDataWebsites;
      const combine = [...apps, ...websites];
      const nextAvailableQapps = namesOwnResources(combine);
      availableQappsCountRef.current = nextAvailableQapps.length;
      setAvailableQapps(nextAvailableQapps);
    } catch (error) {
      console.log(error);
    }
  }, []);
  useEffect(() => {
    getCategories();
  }, [getCategories]);

  useEffect(() => {
    let isMounted = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const scheduleNextFetch = () => {
      if (!isMounted) {
        return;
      }

      const delay =
        availableQappsCountRef.current < MIN_LIBRARY_APPS_BEFORE_SLOW_POLL
          ? TIME_MINUTES_2_IN_MILLISECONDS
          : TIME_MINUTES_20_IN_MILLISECONDS;

      timeoutId = setTimeout(() => {
        void fetchAndSchedule();
      }, delay);
    };

    const fetchAndSchedule = async () => {
      await getQapps();
      scheduleNextFetch();
    };

    void fetchAndSchedule();

    return () => {
      isMounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [getQapps]);

  const updateLauncherTab = useCallback(
    (tabId: string, change: (state: LauncherTabState) => LauncherTabState) => {
      setLauncherTabStates((prev) => {
        const current = prev[tabId] ?? newLauncherTabState();
        const next = change(current);
        return next === prev[tabId] ? prev : { ...prev, [tabId]: next };
      });
    },
    []
  );

  // A closed launcher tab, or one an app took the place of, leaves its page.
  useEffect(() => {
    setLauncherTabStates((prev) => keepOpenLauncherStates(prev, tabs));
  }, [tabs]);

  // A category, and an app's details opened from one, open in the launcher
  // tab on screen: only that one can be clicked. (What opens in a tab says
  // where it came from: addTabFunc. An app's page itself: showAppPage.)
  useEffect(() => {
    const showInLauncherTab = (
      change: (state: LauncherTabState) => LauncherTabState
    ) => {
      const tab = selectedTabRef.current;
      if (isLauncherTab(tab)) updateLauncherTab(tab.tabId, change);
    };
    const onAppInfoFromCategory = (e) =>
      showInLauncherTab((state) => showAppInfo(state, e.detail?.data, true));
    const onCategory = (e) =>
      showInLauncherTab((state) => showCategory(state, e.detail?.data));

    subscribeToEvent('selectedAppInfoCategory', onAppInfoFromCategory);
    subscribeToEvent('selectedCategory', onCategory);

    return () => {
      unsubscribeFromEvent('selectedAppInfoCategory', onAppInfoFromCategory);
      unsubscribeFromEvent('selectedCategory', onCategory);
    };
  }, [updateLauncherTab]);

  // A launcher tab whose publish form holds input that is not published yet
  // is locked: it asks before it closes, as a Q-App's locked tab does. The
  // ids are also kept here as they are told, for an app that arrives after
  // the click that opened it (a private app is decrypted first): it does not
  // take the place of such a tab.
  const unsavedLauncherTabIdsRef = useRef(new Set<string>());
  const setLauncherTabUnsaved = useCallback(
    (tabId: string, hasUnsavedInput: boolean) => {
      if (hasUnsavedInput) unsavedLauncherTabIdsRef.current.add(tabId);
      else unsavedLauncherTabIdsRef.current.delete(tabId);
      setTabs((prev) => {
        const index = prev.findIndex((tab) => tab?.tabId === tabId);
        const tab = prev[index];
        if (!isLauncherTab(tab) || !!tab.lock === hasUnsavedInput) {
          return prev;
        }
        const { lock: _lock, ...unlocked } = tab;
        const next = [...prev];
        next[index] = hasUnsavedInput ? { ...unlocked, lock: true } : unlocked;
        return next;
      });
    },
    []
  );

  const navigateBackFunc = useCallback(() => {
    if (desktopViewMode === 'dev') {
      if (
        [
          'category',
          'appInfo-from-category',
          'appInfo',
          'library',
          'publish',
        ].includes(devMode)
      ) {
        if (devMode === 'category') {
          setDevMode('library');
        } else if (devMode === 'appInfo-from-category') {
          setDevMode('category');
        } else if (devMode === 'appInfo') {
          setDevMode('library');
        } else if (devMode === 'library') {
          if (isNewTabWindow) {
            setDevMode('viewer');
          } else {
            setDevMode('home');
          }
        } else if (devMode === 'publish') {
          setDevMode('library');
        }
      } else if (selectedTab?.tabId) {
        executeEvent(`navigateBackApp-${selectedTab.tabId}`, {});
      }
      return;
    }

    // A launcher tab goes back among its own pages.
    if (isLauncherTab(selectedTab)) {
      updateLauncherTab(selectedTab.tabId, launcherPageBack);
    } else if (selectedTab?.tabId) {
      executeEvent(`navigateBackApp-${selectedTab.tabId}`, {});
    }
  }, [
    desktopViewMode,
    devMode,
    isNewTabWindow,
    selectedTab,
    setDevMode,
    updateLauncherTab,
  ]);

  useEffect(() => {
    subscribeToEvent('navigateBack', navigateBackFunc);

    return () => {
      unsubscribeFromEvent('navigateBack', navigateBackFunc);
    };
  }, [navigateBackFunc]);

  useEffect(() => {
    subscribeToEvent('devModeNavigateBack', navigateBackFunc);

    return () => {
      unsubscribeFromEvent('devModeNavigateBack', navigateBackFunc);
    };
  }, [navigateBackFunc]);

  const setAppsSubPageCanGoBack = useSetAtom(appsSubPageCanGoBackAtom);

  useEffect(() => {
    // In Apps mode the launcher's pages are in launcher tabs.
    const isSubPage =
      desktopViewMode === 'apps'
        ? isLauncherTab(selectedTab) &&
          canGoBackInLauncher(launcherTabStates[selectedTab.tabId])
        : desktopViewMode === 'dev' &&
          !selectedTab &&
          (isLauncherSubPage(devMode) || devMode === 'library');
    setAppsSubPageCanGoBack(isSubPage);
  }, [
    desktopViewMode,
    devMode,
    launcherTabStates,
    selectedTab,
    setAppsSubPageCanGoBack,
  ]);

  useEffect(() => {
    return () => setAppsSubPageCanGoBack(false);
  }, [setAppsSubPageCanGoBack]);

  /** Shows a tab that is already in the strip, where it is. */
  const showTabInPlace = (tab) => {
    setEnteringTabIds((prev) => prev.filter((id) => id !== tab.tabId));
    setSelectedTab(tab);
    setMode('viewer');
    setDesktopViewMode('apps');
    setIsNewTabWindow(false);
  };

  const noteTabLimit = () => {
    setInfoSnack({
      message: t('core:app_tab.limit_reached', {
        postProcess: 'capitalizeFirstChar',
      }),
      type: 'warning',
    });
    setOpenSnack(true);
  };

  /** `tabs` with `newTab` after the tab `afterTabId`, or at the end. */
  const withTabAfter = (prev, newTab, afterTabId?: string) => {
    const sourceIndex = afterTabId
      ? prev.findIndex((tab) => tab?.tabId === afterTabId)
      : -1;
    if (sourceIndex === -1) return [...prev, newTab];
    const nextTabs = [...prev];
    nextTabs.splice(sourceIndex + 1, 0, newTab);
    return pinnedFirst(nextTabs);
  };

  /**
   * What the strip's + does: a new launcher tab, with `query` searched. False
   * at the tab limit, where only the note shows.
   */
  const openNewLauncherTab = ({
    afterTabId,
    query = '',
    state,
  }: {
    afterTabId?: string;
    query?: string;
    /** Its first page, when it is not the launcher with `query`. */
    state?: LauncherTabState;
  } = {}): boolean => {
    if (tabs.length >= MAX_OPEN_APP_TABS) {
      noteTabLimit();
      return false;
    }
    const newTab = newLauncherTab(uid.rnd());
    setTabs((prev) => withTabAfter(prev, newTab, afterTabId));
    setLauncherTabStates((prev) => ({
      ...prev,
      [newTab.tabId]: state ?? newLauncherTabState(query),
    }));
    setSelectedTab(newTab);
    setMode('viewer');
    setDesktopViewMode('apps');
    setIsNewTabWindow(false);
    animateTabEntry(newTab.tabId);
    return true;
  };

  /**
   * The launcher, from an Apps button or a library search: the launcher tab
   * on screen, else the one viewed last, else a new one. A search (`query`,
   * '' included) starts it over with the search, but never over a publish
   * form holding unsaved input: the search gets a new launcher tab instead.
   */
  const showLauncherTab = (query?: string) => {
    const target = launcherTabToShow(
      tabs,
      selectedTab?.tabId,
      recentTabIdsRef.current
    );
    const isSearch = typeof query === 'string';
    if (!target || (isSearch && target.lock)) {
      // At the tab limit the tab viewed last shows, under the note, rather
      // than an empty page.
      if (!openNewLauncherTab({ query })) setMode('viewer');
      return;
    }
    if (isSearch) {
      updateLauncherTab(target.tabId, (state) => restartLauncher(state, query));
    }
    showTabInPlace(target);
  };

  /**
   * An app's or website's page. A link in a page's text names the launcher
   * tab it is in (`fromLauncherTabId`), and the new page takes that page's
   * place. Anything else takes a launcher tab only from its launcher page:
   * the library's cards, from the launcher tab on screen, and a page link
   * from elsewhere (as from chat), which goes to the launcher tab viewed
   * last. An app's page, a category or a publish form another launcher tab
   * holds is left as it is, and the page gets a new launcher tab instead.
   */
  const showAppPage = (data) => {
    if (!data) return;
    const { fromLauncherTabId, ...app } = data;
    const launcherTabs = tabs.filter(isLauncherTab);
    const fromTab = fromLauncherTabId
      ? launcherTabs.find((tab) => tab.tabId === fromLauncherTabId)
      : null;
    const target =
      fromTab ??
      launcherTabToShow(
        launcherTabs.filter(
          (tab) =>
            (launcherTabStates[tab.tabId] ?? INITIAL_LAUNCHER_TAB_STATE)
              .page === 'launcher'
        ),
        selectedTab?.tabId,
        recentTabIdsRef.current
      );
    if (!target || target.lock) {
      const state = showAppInfo(newLauncherTabState(), app);
      // At the tab limit the tab viewed last shows, under the note.
      if (!openNewLauncherTab({ state })) setMode('viewer');
      return;
    }
    updateLauncherTab(target.tabId, (state) => showAppInfo(state, app));
    showTabInPlace(target);
  };

  const addTabFunc = (e) => {
    const { fromLauncherTabId, ...data } = e.detail?.data ?? {};
    // A launcher tab reopened (Ctrl+Shift+T) is a new one: nothing it held
    // was kept.
    if (isLauncherTab(data)) {
      openNewLauncherTab({ afterTabId: data.afterTabId });
      return;
    }
    if (data?.internal) {
      const existingInternalTab = tabs.find(
        (tab) => tab?.internal === data.internal
      );
      if (existingInternalTab) {
        showTabInPlace(existingInternalTab);
        return;
      }
    }
    // A private app opened from elsewhere (its list, a pinned app) takes the
    // place of its restored tab, and keeps that tab's marks.
    if (data?.isPrivate && !isPrivateTabToReopen(data)) {
      const waiting = tabs.filter(
        (tab) =>
          isPrivateTabToReopen(tab) &&
          isSamePrivateApp(tab.privateAppProperties, data.privateAppProperties)
      );
      const restored =
        waiting.find((tab) => reopenRequestsRef.current.has(tab.tabId)) ??
        waiting[0];
      if (restored) {
        const reopened = {
          ...tabFlags(restored),
          ...data,
          tabId: restored.tabId,
        };
        setTabs((prev) =>
          prev.map((tab) => (tab?.tabId === restored.tabId ? reopened : tab))
        );
        showTabInPlace(reopened);
        return;
      }
    }
    if (data?.navigateIfAlreadyOpen) {
      const { navigateIfAlreadyOpen, path, ...tabIdentity } = data;
      // The same resource only: without an identifier, the name's default
      // resource, not a tab of another resource of it.
      const existingTab = tabs.find(
        (tab) =>
          tab.service === tabIdentity.service &&
          tab.name?.toLowerCase() === tabIdentity.name?.toLowerCase() &&
          isSameResourceIdentifier(tab.identifier, tabIdentity.identifier)
      );

      if (existingTab) {
        flushSync(() => {
          setDesktopViewMode('apps');
          setSelectedTab(existingTab);
          setMode('viewer');
          setIsNewTabWindow(false);
        });

        setTimeout(() => {
          executeEvent(`navigateToPath-${existingTab.tabId}`, {
            path: path || '',
          });
        }, 200);

        return;
      }
    }

    // Only the tab menu pins a tab: a tab opened any other way starts
    // unpinned, a duplicate of a pinned tab too.
    const { pinned: _pinned, ...tabData } = data;

    // Opened from inside a launcher tab: the app takes that tab's place, as
    // a page opened from a browser's new tab does, unless the tab's publish
    // form holds unsaved input by now. Opened any other way, it gets a tab
    // of its own.
    const launcherTab =
      fromLauncherTabId &&
      !unsavedLauncherTabIdsRef.current.has(fromLauncherTabId)
        ? tabs.find(
            (tab) => tab?.tabId === fromLauncherTabId && isLauncherTab(tab)
          )
        : null;
    if (launcherTab) {
      const appTab = { ...tabData, tabId: launcherTab.tabId };
      setTabs((prev) =>
        prev.map((tab) => (tab?.tabId === appTab.tabId ? appTab : tab))
      );
      showTabInPlace(appTab);
      return;
    }

    // Only a new tab needs a free slot: an open one is reused above.
    if (tabs.length >= MAX_OPEN_APP_TABS) {
      noteTabLimit();
      return;
    }

    const newTab = {
      ...tabData,
      tabId: uid.rnd(),
    };
    setTabs((prev) => withTabAfter(prev, newTab, data.afterTabId));
    setSelectedTab(newTab);
    setMode('viewer');
    setDesktopViewMode('apps');
    setIsNewTabWindow(false);
  };

  useEffect(() => {
    subscribeToEvent('addTab', addTabFunc);

    return () => {
      unsubscribeFromEvent('addTab', addTabFunc);
    };
  }, [tabs]);

  const addDevTabFunc = (e) => {
    const data = e.detail?.data;
    if (tabs.length >= MAX_OPEN_APP_TABS) {
      noteTabLimit();
      return;
    }
    const newTab = {
      ...data,
      tabId: uid.rnd(),
    };
    setTabs((prev) => [...prev, newTab]);
    setSelectedTab(newTab);
    setDevMode('viewer');
    setDesktopViewMode('dev');
    setIsNewTabWindow(false);
  };

  useEffect(() => {
    subscribeToEvent('appsDevModeAddTab', addDevTabFunc);

    return () => {
      unsubscribeFromEvent('appsDevModeAddTab', addDevTabFunc);
    };
  }, [tabs]);

  const updateDevTabFunc = (e) => {
    const data = e.detail?.data;
    if (!data.tabId) return;
    const findIndexTab = tabs.findIndex((tab) => tab?.tabId === data?.tabId);
    if (findIndexTab === -1) return;
    const copyTabs = [...tabs];
    const newTab = {
      ...copyTabs[findIndexTab],
      url: data.url,
    };
    copyTabs[findIndexTab] = newTab;

    setTabs(copyTabs);
    setSelectedTab(newTab);
    setDevMode('viewer');
    setDesktopViewMode('dev');
    setIsNewTabWindow(false);
  };

  useEffect(() => {
    subscribeToEvent('appsDevModeUpdateTab', updateDevTabFunc);

    return () => {
      unsubscribeFromEvent('appsDevModeUpdateTab', updateDevTabFunc);
    };
  }, [tabs]);

  const updateAppUrlFunc = useCallback((e) => {
    const { tabId, url } = e.detail ?? {};
    if (!tabId || !url) return;

    setTabs((currentTabs) =>
      currentTabs.map((tab) => (tab?.tabId === tabId ? { ...tab, url } : tab))
    );
    setSelectedTab((currentTab) =>
      currentTab?.tabId === tabId ? { ...currentTab, url } : currentTab
    );
  }, []);

  useEffect(() => {
    subscribeToEvent('updateAppUrl', updateAppUrlFunc);

    return () => {
      unsubscribeFromEvent('updateAppUrl', updateAppUrlFunc);
    };
  }, [updateAppUrlFunc]);

  const setSelectedTabFunc = (e) => {
    const data = e.detail?.data;
    const isDev = e.detail?.isDevMode;

    setEnteringTabIds((prev) => prev.filter((id) => id !== data?.tabId));
    setSelectedTab(data);
    // Choosing it again retries a private app that could not be reopened.
    reopenPrivateTab(data);
    if (isDev) {
      setDesktopViewMode('dev');
      setDevMode('viewer');
    } else {
      setDesktopViewMode('apps');
      setMode('viewer');
    }
    tabsTokenRef.current += 1;
    const tabsToken = tabsTokenRef.current;
    setTimeout(() => {
      executeEvent('setTabsToNav', {
        data: {
          tabs: tabs,
          selectedTab: data,
          isNewTabWindow: isNewTabWindow,
          tabsToken,
        },
      });
    }, 100);
    setIsNewTabWindow(false);
  };

  useEffect(() => {
    subscribeToEvent('setSelectedTab', setSelectedTabFunc);

    return () => {
      unsubscribeFromEvent('setSelectedTab', setSelectedTabFunc);
    };
  }, [tabs, isNewTabWindow]);

  const addLockFunc = (e) => {
    const data = e.detail?.data;
    const { tabId, lockMessage = '' } = data;

    setTabs((prevTabs) =>
      prevTabs.map((tab) =>
        tab?.tabId === tabId ? { ...tab, lock: true, lockMessage } : tab
      )
    );
  };

  useEffect(() => {
    subscribeToEvent('addLock', addLockFunc);

    return () => {
      unsubscribeFromEvent('addLock', addLockFunc);
    };
  }, []);

  const removeLockFunc = (e) => {
    const data = e.detail?.data;
    const { tabId } = data;

    setTabs((prevTabs) =>
      prevTabs.map((tab) => {
        if (tab?.tabId === tabId) {
          const { lock, lockMessage, ...rest } = tab;
          return rest;
        }
        return tab;
      })
    );
  };

  useEffect(() => {
    subscribeToEvent('removeLock', removeLockFunc);

    return () => {
      unsubscribeFromEvent('removeLock', removeLockFunc);
    };
  }, []);

  const performTabRemoval = (tabId) => {
    // Clear session permissions for this tab
    clearSessionPermissionsByTabId(tabId);

    recentTabIdsRef.current = recentTabIdsRef.current.filter(
      (id) => id !== tabId
    );

    const wasClosingActive = selectedTab?.tabId === tabId;
    const copyTabs = [...tabs].filter((tab) => tab?.tabId !== tabId);
    const remainingIds = new Set(copyTabs.map((t) => t.tabId));

    setEnteringTabIds((prev) => prev.filter((id) => id !== tabId));
    if (copyTabs?.length === 0) {
      recentTabIdsRef.current = [];
      setTabs(copyTabs);
      setSelectedTab(null);
      tabsTokenRef.current += 1;
      const tabsToken = tabsTokenRef.current;
      executeEvent('setTabsToNav', {
        data: {
          tabs: copyTabs,
          selectedTab: null,
          tabsToken,
        },
      });
      executeEvent('forceNavClear', { data: { tabsToken } });
      executeEvent('clearNavInput', {});
      returnFromAppsMode();
      window.setTimeout(() => {
        setMode('home');
        setDevMode('home');
      }, 0);
      return;
    }

    let nextTab = null;
    if (
      !wasClosingActive &&
      selectedTab?.tabId &&
      remainingIds.has(selectedTab.tabId)
    ) {
      nextTab = selectedTab;
    } else if (wasClosingActive) {
      nextTab =
        pickNextTabFromMru(copyTabs, recentTabIdsRef.current) ||
        positionalTabAfterClose(copyTabs, tabId, tabs);
    } else {
      nextTab = copyTabs[0] ?? null;
    }

    setTabs(copyTabs);
    setSelectedTab(nextTab);
    if (wasClosingActive && nextTab) {
      if (isLocalDevTab(nextTab)) {
        setDesktopViewMode('dev');
        setDevMode('viewer');
      } else {
        setDesktopViewMode('apps');
        setMode('viewer');
      }
    }
    tabsTokenRef.current += 1;
    const tabsToken = tabsTokenRef.current;
    setTimeout(() => {
      executeEvent('setTabsToNav', {
        data: {
          tabs: copyTabs,
          selectedTab: nextTab,
          tabsToken,
        },
      });
    }, 400);
  };

  const removeTabFunc = (e) => {
    const data = e.detail?.data;
    const tabToRemove = tabs.find((tab) => tab?.tabId === data?.tabId);

    // Check if the tab has a lock
    if (tabToRemove?.lock) {
      setPendingTabToRemove(tabToRemove);
      setShowCloseTabDialog(true);
      return;
    }

    // Proceed with removal if no lock
    performTabRemoval(data?.tabId);
  };

  const handleCloseTabDialogConfirm = () => {
    if (pendingTabToRemove) {
      performTabRemoval(pendingTabToRemove.tabId);
    }
    setShowCloseTabDialog(false);
    setPendingTabToRemove(null);
  };

  const handleCloseTabDialogCancel = () => {
    setShowCloseTabDialog(false);
    setPendingTabToRemove(null);
  };

  // Closing goes by this render's tabs and selection. Selecting a tab
  // changes only the selection, so a listener subscribed with the tab list
  // would still see the tab that was on screen when the list last changed.
  const removeTabFuncRef = useRef(removeTabFunc);
  removeTabFuncRef.current = removeTabFunc;

  useEffect(() => {
    const onRemoveTab = (e) => removeTabFuncRef.current(e);
    subscribeToEvent('removeTab', onRemoveTab);
    subscribeToEvent('removeTabDevMode', onRemoveTab);

    return () => {
      unsubscribeFromEvent('removeTab', onRemoveTab);
      unsubscribeFromEvent('removeTabDevMode', onRemoveTab);
    };
  }, []);

  // The launcher's events go by this render's tabs and selection, as closing
  // does: `newTabWindow` (the + and Ctrl+T) opens a new launcher tab, the Apps
  // buttons' `showLauncherTab` and a library search go to the one there is,
  // and an app's page (`selectedAppInfo`) shows in one.
  const launcherEventsRef = useRef({
    openNewLauncherTab,
    showAppPage,
    showLauncherTab,
  });
  launcherEventsRef.current = {
    openNewLauncherTab,
    showAppPage,
    showLauncherTab,
  };

  useEffect(() => {
    const onNewTab = () => launcherEventsRef.current.openNewLauncherTab();
    const onShowLauncher = () => launcherEventsRef.current.showLauncherTab();
    const onLibrarySearch = (e) =>
      launcherEventsRef.current.showLauncherTab(e.detail?.data?.query || '');
    const onAppInfo = (e) =>
      launcherEventsRef.current.showAppPage(e.detail?.data);

    subscribeToEvent('newTabWindow', onNewTab);
    subscribeToEvent('showLauncherTab', onShowLauncher);
    subscribeToEvent('openAppsLibrarySearch', onLibrarySearch);
    subscribeToEvent('selectedAppInfo', onAppInfo);

    return () => {
      unsubscribeFromEvent('newTabWindow', onNewTab);
      unsubscribeFromEvent('showLauncherTab', onShowLauncher);
      unsubscribeFromEvent('openAppsLibrarySearch', onLibrarySearch);
      unsubscribeFromEvent('selectedAppInfo', onAppInfo);
    };
  }, []);

  // Apps mode never opens on an empty page. Entered with no tab on screen
  // (the top bar's Apps button on Home, say, with no tab open or only the
  // restored ones), it shows the launcher, as the Apps buttons do: the
  // launcher tab there is, or a new one. Closing the last tab goes Home.
  const wasInAppsModeRef = useRef(desktopViewMode === 'apps');
  useLayoutEffect(() => {
    const inAppsMode = desktopViewMode === 'apps';
    const entered = inAppsMode && !wasInAppsModeRef.current;
    wasInAppsModeRef.current = inAppsMode;
    if (entered && !selectedTabRef.current && !isNewTabWindow) {
      launcherEventsRef.current.showLauncherTab();
    }
  }, [desktopViewMode, isNewTabWindow]);

  const devModeNewTabWindowFunc = () => {
    setIsNewTabWindow(true);
    setSelectedTab(null);
    setDevMode('viewer');
    setDesktopViewMode('dev');
  };

  useEffect(() => {
    subscribeToEvent('devModeNewTabWindow', devModeNewTabWindowFunc);

    return () => {
      unsubscribeFromEvent('devModeNewTabWindow', devModeNewTabWindowFunc);
    };
  }, []);

  useEffect(() => {
    const handleSidebarOverlayVisibility = (e: CustomEvent) => {
      const isVisible = !!e.detail?.data?.isVisible;
      const width = Number(e.detail?.data?.width || 0);
      setSidebarOffsetPx(isVisible ? width : 0);
    };

    subscribeToEvent(
      'sidebarOverlayVisibility',
      handleSidebarOverlayVisibility
    );

    return () => {
      unsubscribeFromEvent(
        'sidebarOverlayVisibility',
        handleSidebarOverlayVisibility
      );
    };
  }, []);

  const appsContentHeight = `calc(100vh - ${appChromeOffsetPx} - ${APPS_HORIZONTAL_TAB_HEIGHT_PX}px)`;

  const refreshLibrary = useCallback(async () => {
    await getQapps();
    refreshRatings();
  }, [getQapps, refreshRatings]);

  // The strip's + and Ctrl+T.
  const openNewTab = useCallback(
    () => launcherEventsRef.current.openNewLauncherTab(),
    []
  );

  useTabShortcuts({
    isNewTabWindow,
    maxTabs: MAX_OPEN_APP_TABS,
    openNewTab,
    selectedTab,
    show,
    tabs,
  });

  const returnFromAppsMode = useCallback(() => {
    executeEvent('return-from-apps-mode', {});
  }, []);

  const duplicateTab = useCallback(
    (tab) => {
      if (!tab) return;
      if (tab.internal) return;
      if (isLocalDevTab(tab)) return;

      const currentLink = tab?.tabId
        ? navigationController?.[tab.tabId]?.currentLink || ''
        : '';
      const parsedLink = currentLink
        ? extractComponents(normalizeQortalInput(currentLink))
        : null;

      executeEvent('addTab', {
        data: {
          afterTabId: tab?.tabId,
          ...tab,
          identifier: parsedLink?.identifier ?? tab?.identifier,
          name: parsedLink?.name ?? tab?.name,
          path: parsedLink?.path ?? tab?.path,
          service: parsedLink?.service ?? tab?.service,
        },
      });
      executeEvent('open-apps-mode', {});
    },
    [navigationController]
  );

  // A launcher tab has no Pin: it is a page on the way to an app.
  const toggleTabPinned = useCallback((tabId: string) => {
    setTabs((prev) => {
      const tab = prev.find((item) => item?.tabId === tabId);
      return tab && !isLauncherTab(tab)
        ? setTabPinned(prev, tabId, !isPinnedTab(tab))
        : prev;
    });
  }, []);

  const closeAllTabs = useCallback(() => {
    // A locked tab asks before it closes (removeTabFunc), and a pinned tab
    // closes only once it is unpinned, so Close All keeps both open rather
    // than closing them without asking.
    const { kept: keptTabs, nextTab } = tabsLeftByCloseAll(
      tabs,
      selectedTab?.tabId,
      recentTabIdsRef.current
    );
    const keptIds = new Set(keptTabs.map((tab) => tab.tabId));
    tabs.forEach((tab) => {
      if (tab?.tabId && !keptIds.has(tab.tabId)) {
        clearSessionPermissionsByTabId(tab.tabId);
      }
    });
    if (keptTabs.length > 0) {
      recentTabIdsRef.current = recentTabIdsRef.current.filter((id) =>
        keptIds.has(id)
      );
      setEnteringTabIds((prev) => prev.filter((id) => keptIds.has(id)));
      setIsNewTabWindow(false);
      setTabs(keptTabs);
      setSelectedTab(nextTab);
      if (isLocalDevTab(nextTab)) {
        setDesktopViewMode('dev');
        setDevMode('viewer');
      } else {
        setDesktopViewMode('apps');
        setMode('viewer');
      }
      tabsTokenRef.current += 1;
      executeEvent('setTabsToNav', {
        data: {
          tabs: keptTabs,
          selectedTab: nextTab,
          isNewTabWindow: false,
          tabsToken: tabsTokenRef.current,
        },
      });
      setInfoSnack({
        type: 'info',
        message: t(closeAllKeptNoteKey(keptTabs), {
          postProcess: 'capitalizeFirstChar',
        }),
      });
      setOpenSnack(true);
      return;
    }
    recentTabIdsRef.current = [];
    setTabs([]);
    setSelectedTab(null);
    setIsNewTabWindow(false);
    executeEvent('clearNavInput', {});
    tabsTokenRef.current += 1;
    executeEvent('setTabsToNav', {
      data: {
        tabs: [],
        selectedTab: null,
        isNewTabWindow: false,
        tabsToken: tabsTokenRef.current,
      },
    });
    executeEvent('forceNavClear', {
      data: { tabsToken: tabsTokenRef.current },
    });
    setMode('home');
    setDevMode('home');
    returnFromAppsMode();
    window.setTimeout(() => {
      setMode('home');
      setDevMode('home');
    }, 0);
  }, [
    tabs,
    selectedTab,
    t,
    returnFromAppsMode,
    setIsNewTabWindow,
    setMode,
    setDevMode,
  ]);

  useEffect(() => {
    if (tabs.length === 0 && selectedTab) {
      setSelectedTab(null);
    }

    if (
      tabs.length === 0 &&
      !isNewTabWindow &&
      (mode === 'viewer' || devMode === 'viewer')
    ) {
      returnFromAppsMode();
      window.setTimeout(() => {
        setMode('home');
        setDevMode('home');
      }, 0);
    }
  }, [
    tabs.length,
    selectedTab,
    isNewTabWindow,
    mode,
    devMode,
    returnFromAppsMode,
    setMode,
    setDevMode,
  ]);

  useEffect(() => {
    const inViewer =
      desktopViewMode === 'dev' ? devMode === 'viewer' : mode === 'viewer';
    if (!inViewer || isNewTabWindow || tabs.length === 0) {
      return;
    }

    const selectedTabId = selectedTab?.tabId;
    const selectedTabStillExists =
      !!selectedTabId && tabs.some((tab) => tab?.tabId === selectedTabId);

    if (selectedTabStillExists) {
      return;
    }

    const fallbackTab =
      pickNextTabFromMru(tabs, recentTabIdsRef.current) ||
      tabs[tabs.length - 1] ||
      tabs[0];
    if (!fallbackTab) {
      return;
    }

    setSelectedTab(fallbackTab);
    if (isLocalDevTab(fallbackTab)) {
      setDesktopViewMode('dev');
      setDevMode('viewer');
    } else {
      setDesktopViewMode('apps');
      setMode('viewer');
    }
    tabsTokenRef.current += 1;
    const tabsToken = tabsTokenRef.current;
    window.setTimeout(() => {
      executeEvent('setTabsToNav', {
        data: {
          tabs,
          selectedTab: fallbackTab,
          isNewTabWindow: false,
          tabsToken,
        },
      });
    }, 0);
  }, [
    isNewTabWindow,
    mode,
    devMode,
    desktopViewMode,
    selectedTab,
    tabs,
    setDesktopViewMode,
    setDevMode,
    setMode,
  ]);

  const scheduleTabPointerUnlock = useCallback(() => {
    if (tabPointerUnlockTimerRef.current !== null) {
      clearTimeout(tabPointerUnlockTimerRef.current);
    }
    tabPointerUnlockTimerRef.current = setTimeout(() => {
      tabInteractionLockedRef.current = false;
      tabPointerUnlockTimerRef.current = null;
    }, 200);
  }, []);

  const handleTabDragStart = useCallback(() => {
    if (tabPointerUnlockTimerRef.current !== null) {
      clearTimeout(tabPointerUnlockTimerRef.current);
      tabPointerUnlockTimerRef.current = null;
    }
    tabInteractionLockedRef.current = true;
  }, []);

  const handleTabDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        setTabs((prev) =>
          moveTabWithinGroup(prev, String(active.id), String(over.id))
        );
      }
      scheduleTabPointerUnlock();
    },
    [scheduleTabPointerUnlock]
  );

  const handleTabDragCancel = useCallback(() => {
    scheduleTabPointerUnlock();
  }, [scheduleTabPointerUnlock]);

  // A dragged tab only trades places with tabs of its own group, pinned or
  // not.
  const tabCollisionDetection = useCallback<CollisionDetection>(
    (args) => {
      const draggingPinned = pinnedTabIds.has(String(args.active.id));
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter(
          (container) =>
            pinnedTabIds.has(String(container.id)) === draggingPinned
        ),
      });
    },
    [pinnedTabIds]
  );

  const renderTab = (tab) => (
    <TabComponent
      key={tab?.tabId}
      app={tab}
      isDevApp={isLocalDevTab(tab)}
      isPinned={isPinnedTab(tab)}
      isSelected={tab?.tabId === selectedTab?.tabId}
      tabInteractionLockedRef={tabInteractionLockedRef}
      widthPx={isPinnedTab(tab) ? PINNED_TAB_WIDTH_PX : tabWidthPx}
      isEntering={enteringTabIds.includes(tab?.tabId)}
      onCloseAll={closeAllTabs}
      onDuplicate={() => duplicateTab(tab)}
      onTogglePin={
        isLauncherTab(tab) ? undefined : () => toggleTabPinned(tab?.tabId)
      }
      onClose={() => {
        executeEvent('removeTab', {
          data: tab,
        });
      }}
      onSelect={() => {
        if (isLocalDevTab(tab)) {
          executeEvent('open-dev-mode', {});
          executeEvent('setSelectedTab', {
            data: tab,
            isDevMode: true,
          });
        } else {
          executeEvent('open-apps-mode', {});
          executeEvent('setSelectedTab', {
            data: tab,
          });
        }
      }}
    />
  );

  // A launcher tab is locked only while its publish form holds unsaved input.
  const closeTabNote = isLauncherTab(pendingTabToRemove)
    ? t('core:app_tab.unsaved_publish', { postProcess: 'capitalizeFirstChar' })
    : pendingTabToRemove?.lockMessage;

  const hasOpenTabs = tabs.length > 0;
  const hideAppsShellOffScreen = !show && hasOpenTabs;
  const appsShellPosition = hideAppsShellOffScreen ? 'absolute' : 'relative';

  return (
    <AppsParent
      aria-hidden={!show}
      sx={{
        display: hideAppsShellOffScreen || show ? 'flex' : 'none',
        flexDirection: 'row',
        height: '100%',
        left: hideAppsShellOffScreen ? '-200vw' : 0,
        maxWidth: '100vw',
        overflow: 'hidden',
        pointerEvents: show ? 'auto' : 'none',
        position: appsShellPosition,
        top: 0,
        width: '100%',
        ...(hideAppsShellOffScreen
          ? {
              zIndex: -1,
            }
          : {}),
      }}
    >
      <RatingsCacheInitializer />
      {/* A vote whose app page closed before the node had it. */}
      <PendingVotesWatcher />
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          width: '100%',
        }}
      >
        <AppsHorizontalTabBar
          sx={{
            transition: `opacity ${show ? '200ms ease-out' : '140ms ease-in'}, transform ${show ? '200ms ease-out' : '140ms ease-in'}`,
            opacity: show ? 1 : 0,
            transform: show ? 'translateY(0px)' : 'translateY(-10px)',
            willChange: 'opacity, transform',
            pointerEvents: show ? 'auto' : 'none',
          }}
        >
          <AppsHorizontalTabScroller
            ref={tabScrollerRef}
            sx={{
              gap: `${TAB_STRIP_GAP_PX}px`,
              paddingLeft: `calc(6px + ${sidebarOffsetPx}px)`,
              transition: `padding-left ${SIDEBAR_CHROME_TRANSITION}`,
            }}
          >
            <DndContext
              collisionDetection={tabCollisionDetection}
              modifiers={[restrictTabsToHorizontalAxis, restrictTabsToStrip]}
              onDragCancel={handleTabDragCancel}
              onDragEnd={handleTabDragEnd}
              onDragStart={handleTabDragStart}
              sensors={sensors}
            >
              {pinnedTabs.length > 0 && (
                <SortableContext
                  items={pinnedTabs.map((tab) => tab.tabId)}
                  strategy={horizontalListSortingStrategy}
                >
                  <Box
                    data-tab-group="pinned"
                    sx={{
                      display: 'flex',
                      flex: '0 0 auto',
                      gap: `${TAB_STRIP_GAP_PX}px`,
                    }}
                  >
                    {pinnedTabs.map(renderTab)}
                  </Box>
                </SortableContext>
              )}
              {unpinnedTabs.length > 0 && (
                <AppsHorizontalTabScrollArea
                  data-tab-group="unpinned"
                  ref={tabScrollAreaRef}
                >
                  <SortableContext
                    items={unpinnedTabs.map((tab) => tab.tabId)}
                    strategy={horizontalListSortingStrategy}
                  >
                    <Box
                      sx={{
                        display: 'flex',
                        gap: `${TAB_STRIP_GAP_PX}px`,
                        width: 'max-content',
                      }}
                    >
                      {unpinnedTabs.map(renderTab)}
                    </Box>
                  </SortableContext>
                </AppsHorizontalTabScrollArea>
              )}
            </DndContext>

            <AppsHorizontalTabAddButton
              ref={tabAddButtonRef}
              aria-label={t('core:app_tab.new_tab', {
                postProcess: 'capitalizeFirstChar',
              })}
              disableRipple
              onClick={openNewTab}
              sx={(theme) => ({
                '&:hover': {
                  backgroundColor:
                    theme.palette.mode === 'dark'
                      ? alpha(theme.palette.common.white, 0.08)
                      : alpha(theme.palette.common.black, 0.06),
                  color: theme.palette.text.primary,
                },
              })}
            >
              <AddRoundedIcon sx={{ fontSize: 20 }} />
            </AppsHorizontalTabAddButton>
          </AppsHorizontalTabScroller>
        </AppsHorizontalTabBar>

        <Box
          sx={{
            height: appsContentHeight,
            minHeight: 0,
            overflow: 'hidden',
            position: 'relative',
            width: '100%',
          }}
        >
          {desktopViewMode === 'dev' &&
            devMode === 'home' &&
            !isNewTabWindow && (
              <Box
                sx={{
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  height: appsContentHeight,
                  overflow: 'auto',
                  pl: `${DEV_MODE_SIDEBAR_SAFE_INSET_PX}px`,
                  pr: '24px',
                  width: '100%',
                }}
              >
                <Spacer height="30px" />

                <AppsDevModeHome
                  availableQapps={availableQapps}
                  myApp={null}
                  myName={myName}
                  myWebsite={null}
                  setMode={setDevMode}
                />
              </Box>
            )}

          {viewerTabs.map((tab) => {
            // A restored tab loads the first time it is selected; a private
            // app's waits until it is reopened.
            const isLoaded =
              !isPrivateTabToReopen(tab) &&
              (shownTabIds.has(tab?.tabId) ||
                tab?.tabId === selectedTab?.tabId);
            if (!isLoaded) return null;
            if (isLauncherTab(tab)) {
              return (
                <LauncherTabView
                  availableQapps={availableQapps}
                  categories={categories}
                  contentHeight={appsContentHeight}
                  getQapps={refreshLibrary}
                  isShown={
                    show &&
                    desktopViewMode === 'apps' &&
                    tab.tabId === selectedTab?.tabId
                  }
                  key={tab.tabId}
                  myAddress={myAddress}
                  myApp={myApp}
                  myName={myName}
                  myWebsite={myWebsite}
                  onChange={updateLauncherTab}
                  onUnsavedPublishChange={setLauncherTabUnsaved}
                  state={
                    launcherTabStates[tab.tabId] ?? INITIAL_LAUNCHER_TAB_STATE
                  }
                  tabId={tab.tabId}
                />
              );
            }
            const hideContentForDevHome =
              desktopViewMode === 'dev' &&
              devMode === 'home' &&
              !isNewTabWindow;
            const internalTabContent = renderInternalTab?.({
              hide: isNewTabWindow,
              isSelected: tab?.tabId === selectedTab?.tabId,
              tab,
            });
            if (internalTabContent) {
              const isInternalTabActive =
                tab?.tabId === selectedTab?.tabId &&
                !isNewTabWindow &&
                !hideContentForDevHome;
              return (
                <Box
                  key={tab?.tabId}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    minHeight: 0,
                    overflow: 'hidden',
                    width: '100%',
                    ...(!isInternalTabActive
                      ? {
                          left: '-200vw',
                          position: 'absolute',
                          top: 0,
                        }
                      : {}),
                  }}
                >
                  {internalTabContent}
                </Box>
              );
            }
            if (!iframeRefs.current[tab.tabId]) {
              iframeRefs.current[tab.tabId] = createRef();
            }
            return (
              <AppViewerContainer
                app={tab}
                customHeight="100%"
                hide={isNewTabWindow || hideContentForDevHome}
                isDevMode={isLocalDevTab(tab)}
                isSelected={tab?.tabId === selectedTab?.tabId}
                key={tab?.tabId}
                ref={iframeRefs.current[tab.tabId]}
              />
            );
          })}

          {isNewTabWindow &&
            desktopViewMode === 'dev' &&
            devMode === 'viewer' && (
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  height: appsContentHeight,
                  overflow: 'auto',
                  width: '100%',
                }}
              >
                <Spacer height="30px" />

                <AppsDevModeHome
                  availableQapps={availableQapps}
                  myApp={null}
                  myName={myName}
                  myWebsite={null}
                  setMode={setDevMode}
                />
              </Box>
            )}
        </Box>
      </Box>

      <Dialog
        open={showCloseTabDialog}
        onClose={handleCloseTabDialogCancel}
        aria-labelledby="close-tab-dialog-title"
        aria-describedby="close-tab-dialog-description"
        PaperProps={{
          sx: getDialogPaperSx(theme, { maxWidth: 430 }),
        }}
      >
        <DialogTitle id="close-tab-dialog-title" sx={dialogTitleSx}>
          {t('question:permission.close_tab_confirmation', {
            postProcess: 'capitalizeFirstChar',
          })}
        </DialogTitle>
        <DialogContent sx={dialogContentSx}>
          <DialogContentText
            id="close-tab-dialog-description"
            sx={dialogContentTextSx}
          >
            {t('question:permission.close_tab_permission', {
              postProcess: 'capitalizeFirstChar',
            })}
          </DialogContentText>
          {closeTabNote && (
            <DialogContentText
              sx={{
                ...dialogContentTextSx,
                color: 'rgba(246,248,252,0.9)',
                fontWeight: 600,
                marginTop: 1.4,
              }}
            >
              {closeTabNote}
            </DialogContentText>
          )}
        </DialogContent>
        <DialogActions sx={dialogActionsSx}>
          <Button
            onClick={handleCloseTabDialogCancel}
            variant="outlined"
            sx={getDialogSecondaryButtonSx(theme)}
          >
            {t('core:action.cancel', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
          <Button
            onClick={handleCloseTabDialogConfirm}
            variant="contained"
            autoFocus
            sx={getDialogDangerButtonSx()}
          >
            {t('question:permission.close_tab', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
        </DialogActions>
      </Dialog>

      <CustomizedSnackbars
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />
    </AppsParent>
  );
};
