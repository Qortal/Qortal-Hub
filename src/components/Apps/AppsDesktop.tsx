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
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
} from '@dnd-kit/sortable';
import { AppsHomeDesktop } from './AppsHomeDesktop';
import { AppsDevModeHome } from './AppsDevModeHome';
import { Spacer } from '../../common/Spacer';
import { getBaseApiReact } from '../../App';
import { AppInfo } from './AppInfo';
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
  AppsHorizontalTabScroller,
  AppsParent,
} from './Apps-styles';
import AppViewerContainer from './AppViewerContainer';
import TabComponent from './TabComponent';
import ShortUniqueId from 'short-unique-id';
import { AppPublish } from './AppPublish';
import {
  RatingsCacheInitializer,
  useAppRatings,
} from '../../hooks/useAppRatings';
import { AppsLibraryDesktop } from './AppsLibraryDesktop';
import { AppsCategoryDesktop } from './AppsCategoryDesktop';
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
  navigationControllerAtom,
  isNewTabWindowAtom,
  userInfoAtom,
} from '../../atoms/global';
import { publishEditTargetAtom } from '../../atoms/appsAtoms';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { TIME_MINUTES_20_IN_MILLISECONDS } from '../../constants/constants';
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

const uid = new ShortUniqueId({ length: 8 });
const MAX_OPEN_APP_TABS = 10;
/** Bounded MRU stack (tab ids only) for "last visited" after closing the active tab */
const MAX_TAB_MRU_DEPTH = 64;

function pickNextTabFromMru(
  remainingTabs: { tabId: string }[],
  mruIds: string[]
): { tabId: string } | null {
  if (!remainingTabs.length) return null;
  const ids = new Set(remainingTabs.map((t) => t.tabId));
  for (let i = mruIds.length - 1; i >= 0; i--) {
    const id = mruIds[i];
    if (ids.has(id)) {
      return remainingTabs.find((t) => t.tabId === id) ?? null;
    }
  }
  return null;
}

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
/** Match `AppsHorizontalTabButton` ideal width for strip width math */
const TAB_STRIP_IDEAL_TAB_PX = 180;
const TAB_STRIP_INNER_GAP_PX = 2;

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
  const publishEditTarget = useAtomValue(publishEditTargetAtom);
  const setPublishEditTarget = useSetAtom(publishEditTargetAtom);
  const myName = userInfo?.name;
  const myAddress = userInfo?.address;
  const [availableQapps, setAvailableQapps] = useState([]);
  const [selectedAppInfo, setSelectedAppInfo] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [tabs, setTabs] = useState([]);
  const [viewerTabOrder, setViewerTabOrder] = useState<string[]>([]);
  const [selectedTab, setSelectedTab] = useState(null);
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
  const [isAddTabFocused, setIsAddTabFocused] = useState(false);
  const [isAddTabWaitingForPointerMove, setIsAddTabWaitingForPointerMove] =
    useState(false);
  const addTabPointerOriginRef = useRef<{ x: number; y: number } | null>(null);
  const latestPointerPositionRef = useRef<{ x: number; y: number } | null>(
    null
  );
  const [pendingVisualTabActivationId, setPendingVisualTabActivationId] =
    useState<string | null>(null);
  const [delayedVisualActiveTabId, setDelayedVisualActiveTabId] = useState<
    string | null
  >(null);
  const [enteringTabIds, setEnteringTabIds] = useState<string[]>([]);
  const [tabStripCompresses, setTabStripCompresses] = useState(false);
  const tabScrollerRef = useRef<HTMLDivElement | null>(null);
  const tabAddButtonRef = useRef<HTMLButtonElement | null>(null);
  const [librarySearchRequest, setLibrarySearchRequest] = useState<{
    nonce: number;
    query: string;
  }>({ nonce: 0, query: '' });
  const tabsToNavTimeoutRef = useRef<number | null>(null);
  const tabActivationTimeoutRef = useRef<number | null>(null);
  const tabEntryCleanupTimeoutRef = useRef<number | null>(null);
  const recentTabIdsRef = useRef<string[]>([]);
  const tabPointerUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const tabInteractionLockedRef = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

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
      if (tabActivationTimeoutRef.current !== null) {
        window.clearTimeout(tabActivationTimeoutRef.current);
      }
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

  const updateTabStripCompression = useCallback(() => {
    const scroller = tabScrollerRef.current;
    if (!show || !scroller || tabs.length === 0) {
      setTabStripCompresses(false);
      return;
    }
    if (scroller.clientWidth < 32) {
      return;
    }
    const addEl = tabAddButtonRef.current;
    const addW = addEl?.offsetWidth ?? 36;
    const cs = getComputedStyle(scroller);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const rowGap = parseFloat(cs.gap) || TAB_STRIP_INNER_GAP_PX;
    const available = scroller.clientWidth - padL - padR - addW - rowGap;

    const tabsNeed =
      tabs.length * TAB_STRIP_IDEAL_TAB_PX +
      Math.max(0, tabs.length - 1) * TAB_STRIP_INNER_GAP_PX;

    setTabStripCompresses(tabsNeed > available + 0.5);
  }, [show, tabs.length]);

  useLayoutEffect(() => {
    updateTabStripCompression();
    const id = window.requestAnimationFrame(() => updateTabStripCompression());
    return () => window.cancelAnimationFrame(id);
  }, [updateTabStripCompression, sidebarOffsetPx]);

  useLayoutEffect(() => {
    const scroller = tabScrollerRef.current;
    const addBtn = tabAddButtonRef.current;
    if (!scroller) return;
    const ro = new ResizeObserver(() => updateTabStripCompression());
    ro.observe(scroller);
    if (addBtn) {
      ro.observe(addBtn);
    }
    return () => ro.disconnect();
  }, [updateTabStripCompression]);

  useEffect(() => {
    const trackPointer = (event: PointerEvent) => {
      latestPointerPositionRef.current = {
        x: event.clientX,
        y: event.clientY,
      };
    };

    window.addEventListener('pointermove', trackPointer, { passive: true });

    return () => {
      window.removeEventListener('pointermove', trackPointer);
    };
  }, []);

  useEffect(() => {
    if (!isAddTabWaitingForPointerMove) return;

    const handlePointerMove = (event: PointerEvent) => {
      const origin = addTabPointerOriginRef.current;
      if (origin) {
        const dx = Math.abs(event.clientX - origin.x);
        const dy = Math.abs(event.clientY - origin.y);
        if (dx < 6 && dy < 6) {
          return;
        }
      }
      setIsAddTabFocused(false);
      setIsAddTabWaitingForPointerMove(false);
      addTabPointerOriginRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove, {
      passive: true,
    });

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
    };
  }, [isAddTabWaitingForPointerMove]);

  const scheduleVisualTabActivation = useCallback(
    (tabId: string) => {
      if (tabActivationTimeoutRef.current !== null) {
        window.clearTimeout(tabActivationTimeoutRef.current);
      }
      if (tabEntryCleanupTimeoutRef.current !== null) {
        window.clearTimeout(tabEntryCleanupTimeoutRef.current);
      }

      setPendingVisualTabActivationId(tabId);
      setDelayedVisualActiveTabId(null);
      setEnteringTabIds((prev) =>
        prev.includes(tabId) ? prev : [...prev, tabId]
      );
      addTabPointerOriginRef.current = latestPointerPositionRef.current;
      setIsAddTabWaitingForPointerMove(true);

      tabActivationTimeoutRef.current = window.setTimeout(() => {
        setDelayedVisualActiveTabId(tabId);
        setPendingVisualTabActivationId(null);
      }, 85);

      tabEntryCleanupTimeoutRef.current = window.setTimeout(() => {
        setEnteringTabIds((prev) => prev.filter((id) => id !== tabId));
        setDelayedVisualActiveTabId((prev) => (prev === tabId ? null : prev));
      }, 220);
    },
    [setIsAddTabFocused]
  );

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
      const url = `${getBaseApiReact()}/arbitrary/resources/search?service=APP&mode=ALL&limit=0&includestatus=true&includemetadata=true`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response?.ok) return;
      const responseData = await response.json();
      const urlWebsites = `${getBaseApiReact()}/arbitrary/resources/search?service=WEBSITE&mode=ALL&limit=0&includestatus=true&includemetadata=true`;

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
      setAvailableQapps(combine);
    } catch (error) {
      console.log(error);
    }
  }, []);
  useEffect(() => {
    getCategories();
  }, [getCategories]);

  useEffect(() => {
    getQapps();

    const interval = setInterval(() => {
      getQapps();
    }, TIME_MINUTES_20_IN_MILLISECONDS);

    return () => clearInterval(interval);
  }, [getQapps]);

  const selectedAppInfoFunc = (e) => {
    const data = e.detail?.data;
    setSelectedAppInfo(data);
    setMode('appInfo');
  };

  useEffect(() => {
    subscribeToEvent('selectedAppInfo', selectedAppInfoFunc);

    return () => {
      unsubscribeFromEvent('selectedAppInfo', selectedAppInfoFunc);
    };
  }, []);

  const selectedAppInfoCategoryFunc = (e) => {
    const data = e.detail?.data;
    setSelectedAppInfo(data);
    setMode('appInfo-from-category');
  };

  useEffect(() => {
    subscribeToEvent('selectedAppInfoCategory', selectedAppInfoCategoryFunc);

    return () => {
      unsubscribeFromEvent(
        'selectedAppInfoCategory',
        selectedAppInfoCategoryFunc
      );
    };
  }, []);

  const selectedCategoryFunc = (e) => {
    const data = e.detail?.data;
    setSelectedCategory(data);
    setMode('category');
  };

  useEffect(() => {
    subscribeToEvent('selectedCategory', selectedCategoryFunc);

    return () => {
      unsubscribeFromEvent('selectedCategory', selectedCategoryFunc);
    };
  }, []);

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
          setSelectedCategory(null);
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

    if (
      [
        'category',
        'appInfo-from-category',
        'appInfo',
        'library',
        'publish',
        'publish-app',
        'publish-website',
      ].includes(mode)
    ) {
      if (mode === 'category') {
        setMode('library');
        setSelectedCategory(null);
      } else if (mode === 'appInfo-from-category') {
        setMode('category');
      } else if (mode === 'appInfo') {
        setMode('library');
      } else if (mode === 'library') {
        if (isNewTabWindow) {
          setMode('viewer');
        } else {
          setMode('home');
        }
      } else if (
        mode === 'publish' ||
        mode === 'publish-app' ||
        mode === 'publish-website'
      ) {
        setPublishEditTarget(null);
        setMode('library');
      }
    } else if (selectedTab?.tabId) {
      executeEvent(`navigateBackApp-${selectedTab.tabId}`, {});
    }
  }, [
    desktopViewMode,
    devMode,
    isNewTabWindow,
    mode,
    selectedTab?.tabId,
    setDevMode,
    setMode,
    setPublishEditTarget,
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

  const addTabFunc = (e) => {
    const data = e.detail?.data;
    if (data?.internal) {
      const existingInternalTab = tabs.find(
        (tab) => tab?.internal === data.internal
      );
      if (existingInternalTab) {
        setPendingVisualTabActivationId(null);
        setDelayedVisualActiveTabId(null);
        setEnteringTabIds((prev) =>
          prev.filter((id) => id !== existingInternalTab.tabId)
        );
        setIsAddTabFocused(false);
        setIsAddTabWaitingForPointerMove(false);
        addTabPointerOriginRef.current = null;
        setSelectedTab(existingInternalTab);
        setMode('viewer');
        setDesktopViewMode('apps');
        setIsNewTabWindow(false);
        return;
      }
    }
    if (tabs.length >= MAX_OPEN_APP_TABS) {
      setInfoSnack({
        message: 'Maximum number of tabs reached. Close one to open another.',
        type: 'warning',
      });
      setOpenSnack(true);
      return;
    }

    if (data?.navigateIfAlreadyOpen) {
      const { navigateIfAlreadyOpen, path, ...tabIdentity } = data;
      const existingTab = tabs.find(
        (tab) =>
          tab.service === tabIdentity.service &&
          tab.name?.toLowerCase() === tabIdentity.name?.toLowerCase() &&
          (tabIdentity.identifier == null ||
            tab.identifier === tabIdentity.identifier)
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
    const newTab = {
      ...data,
      tabId: uid.rnd(),
    };
    const shouldUseSmoothHandoff = isAddTabFocused;
    if (!shouldUseSmoothHandoff) {
      setIsAddTabFocused(false);
      setIsAddTabWaitingForPointerMove(false);
      addTabPointerOriginRef.current = null;
    }
    setTabs((prev) => {
      const afterTabId = data?.afterTabId;
      if (!afterTabId) {
        return [...prev, newTab];
      }

      const sourceIndex = prev.findIndex((tab) => tab?.tabId === afterTabId);
      if (sourceIndex === -1) {
        return [...prev, newTab];
      }

      const nextTabs = [...prev];
      nextTabs.splice(sourceIndex + 1, 0, newTab);
      return nextTabs;
    });
    setSelectedTab(newTab);
    setMode('viewer');
    setDesktopViewMode('apps');
    setIsNewTabWindow(false);
    if (shouldUseSmoothHandoff) {
      scheduleVisualTabActivation(newTab.tabId);
    } else {
      setPendingVisualTabActivationId(null);
      setDelayedVisualActiveTabId(null);
      setEnteringTabIds((prev) => prev.filter((id) => id !== newTab.tabId));
      setIsAddTabFocused(false);
    }
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
      setInfoSnack({
        message: 'Maximum number of tabs reached. Close one to open another.',
        type: 'warning',
      });
      setOpenSnack(true);
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

  const setSelectedTabFunc = (e) => {
    const data = e.detail?.data;
    const isDev = e.detail?.isDevMode;

    setPendingVisualTabActivationId(null);
    setDelayedVisualActiveTabId(null);
    setEnteringTabIds((prev) => prev.filter((id) => id !== data?.tabId));
    setIsAddTabFocused(false);
    setIsAddTabWaitingForPointerMove(false);
    addTabPointerOriginRef.current = null;
    setSelectedTab(data);
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
    setPendingVisualTabActivationId((prev) => (prev === tabId ? null : prev));
    setDelayedVisualActiveTabId((prev) => (prev === tabId ? null : prev));
    setIsAddTabWaitingForPointerMove(false);
    addTabPointerOriginRef.current = null;
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

  useEffect(() => {
    subscribeToEvent('removeTab', removeTabFunc);

    return () => {
      unsubscribeFromEvent('removeTab', removeTabFunc);
    };
  }, [tabs]);

  useEffect(() => {
    subscribeToEvent('removeTabDevMode', removeTabFunc);

    return () => {
      unsubscribeFromEvent('removeTabDevMode', removeTabFunc);
    };
  }, [tabs]);

  const setNewTabWindowFunc = (e) => {
    setIsNewTabWindow(true);
    setIsAddTabFocused(true);
    setSelectedTab(null);
    setDesktopViewMode('apps');
  };

  useEffect(() => {
    subscribeToEvent('newTabWindow', setNewTabWindowFunc);

    return () => {
      unsubscribeFromEvent('newTabWindow', setNewTabWindowFunc);
    };
  }, [tabs]);

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

  const openAppsLibrarySearchFunc = useCallback(
    (e) => {
      const query = e.detail?.data?.query || '';
      setDesktopViewMode('apps');
      setIsAddTabFocused(true);
      setSelectedTab(null);
      setIsNewTabWindow(false);
      setLibrarySearchRequest({
        nonce: Date.now(),
        query,
      });
      setMode('library');
    },
    [setDesktopViewMode, setMode]
  );

  useEffect(() => {
    subscribeToEvent('openAppsLibrarySearch', openAppsLibrarySearchFunc);

    return () => {
      unsubscribeFromEvent('openAppsLibrarySearch', openAppsLibrarySearchFunc);
    };
  }, [openAppsLibrarySearchFunc]);

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

  const openDashboardFromTabs = useCallback(() => {
    setIsAddTabFocused(true);
    setIsAddTabWaitingForPointerMove(false);
    addTabPointerOriginRef.current = null;
    setPendingVisualTabActivationId(null);
    setDelayedVisualActiveTabId(null);
    setSelectedTab(null);
    setLibrarySearchRequest({
      nonce: Date.now(),
      query: '',
    });
    executeEvent('open-apps-mode', {});
    setMode('home');
    setIsNewTabWindow(false);
  }, [setIsNewTabWindow, setMode]);

  const returnFromAppsMode = useCallback(() => {
    executeEvent('return-from-apps-mode', {});
  }, []);

  const duplicateTab = useCallback(
    (tab) => {
      if (!tab) return;

      if (isLocalDevTab(tab)) {
        executeEvent('appsDevModeAddTab', {
          data: {
            afterTabId: tab?.tabId,
            url: tab.url,
            customIcon: tab.customIcon,
            name: tab.name,
          },
        });
        executeEvent('open-dev-mode', {});
        return;
      }

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

  const closeAllTabs = useCallback(() => {
    tabs.forEach((tab) => {
      if (tab?.tabId) {
        clearSessionPermissionsByTabId(tab.tabId);
      }
    });
    recentTabIdsRef.current = [];
    setTabs([]);
    setSelectedTab(null);
    setIsAddTabFocused(false);
    setIsAddTabWaitingForPointerMove(false);
    addTabPointerOriginRef.current = null;
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
  }, [tabs, returnFromAppsMode, setIsNewTabWindow, setMode, setDevMode]);

  useEffect(() => {
    if (!show) {
      setIsAddTabFocused(false);
      setIsAddTabWaitingForPointerMove(false);
      addTabPointerOriginRef.current = null;
      setPendingVisualTabActivationId(null);
      setDelayedVisualActiveTabId(null);
    }
  }, [show]);

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
        setTabs((prev) => {
          const oldIndex = prev.findIndex((tab) => tab?.tabId === active.id);
          const newIndex = prev.findIndex((tab) => tab?.tabId === over.id);

          if (oldIndex === -1 || newIndex === -1) return prev;
          return arrayMove(prev, oldIndex, newIndex);
        });
      }
      scheduleTabPointerUnlock();
    },
    [scheduleTabPointerUnlock]
  );

  const handleTabDragCancel = useCallback(() => {
    scheduleTabPointerUnlock();
  }, [scheduleTabPointerUnlock]);

  const hasOpenTabs = tabs.length > 0;
  const hideAppsShellOffScreen = !show && hasOpenTabs;

  return (
    <AppsParent
      sx={{
        display: hideAppsShellOffScreen || show ? 'flex' : 'none',
        flexDirection: 'row',
        ...(hideAppsShellOffScreen
          ? {
              height: `calc(100vh - ${appChromeOffsetPx})`,
              left: '-200vw',
              maxWidth: '100vw',
              pointerEvents: 'none',
              position: 'fixed',
              top: 0,
              width: '100%',
            }
          : {}),
      }}
    >
      <RatingsCacheInitializer />
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
              alignItems: 'stretch',
              gap: '2px',
              paddingLeft: `calc(6px + ${sidebarOffsetPx}px)`,
              transition: `padding-left ${SIDEBAR_CHROME_TRANSITION}`,
            }}
          >
            <DndContext
              collisionDetection={closestCenter}
              modifiers={[restrictTabsToHorizontalAxis, restrictTabsToStrip]}
              onDragCancel={handleTabDragCancel}
              onDragEnd={handleTabDragEnd}
              onDragStart={handleTabDragStart}
              sensors={sensors}
            >
              <SortableContext
                items={tabs.map((tab) => tab?.tabId)}
                strategy={horizontalListSortingStrategy}
              >
                <Box
                  sx={{
                    display: 'flex',
                    gap: '2px',
                    ...(tabStripCompresses
                      ? {
                          flex: '1 1 auto',
                          maxWidth: '100%',
                          minWidth: 0,
                          overflow: 'hidden',
                        }
                      : {
                          flex: '0 0 auto',
                          overflow: 'visible',
                          width: 'max-content',
                        }),
                  }}
                >
                  {tabs.map((tab) => (
                    <TabComponent
                      key={tab?.tabId}
                      app={tab}
                      isDevApp={isLocalDevTab(tab)}
                      isSelected={tab?.tabId === selectedTab?.tabId}
                      tabInteractionLockedRef={tabInteractionLockedRef}
                      tabStripCompresses={tabStripCompresses}
                      isEntering={enteringTabIds.includes(tab?.tabId)}
                      isVisuallySelected={
                        delayedVisualActiveTabId === tab?.tabId ||
                        (tab?.tabId === selectedTab?.tabId &&
                          pendingVisualTabActivationId !== tab?.tabId)
                      }
                      onCloseAll={closeAllTabs}
                      onDuplicate={() => duplicateTab(tab)}
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
                  ))}
                </Box>
              </SortableContext>
            </DndContext>

            <AppsHorizontalTabAddButton
              ref={tabAddButtonRef}
              disableRipple
              onClick={openDashboardFromTabs}
              sx={(theme) => ({
                backgroundColor: isAddTabFocused
                  ? alpha(
                      theme.palette.primary.main,
                      theme.palette.mode === 'dark' ? 0.78 : 0.88
                    )
                  : undefined,
                borderColor: isAddTabFocused ? 'transparent' : undefined,
                color: isAddTabFocused
                  ? theme.palette.mode === 'dark'
                    ? theme.palette.common.white
                    : theme.palette.primary.contrastText
                  : undefined,
                '&:hover': {
                  backgroundColor: isAddTabFocused
                    ? alpha(
                        theme.palette.primary.main,
                        theme.palette.mode === 'dark' ? 0.86 : 0.94
                      )
                    : theme.palette.mode === 'dark'
                      ? 'rgba(255, 255, 255, 0.08)'
                      : 'rgba(0, 0, 0, 0.06)',
                  color: isAddTabFocused
                    ? theme.palette.mode === 'dark'
                      ? theme.palette.common.white
                      : theme.palette.primary.contrastText
                    : theme.palette.text.primary,
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
            width: '100%',
          }}
        >
          {desktopViewMode === 'apps' && mode === 'home' && (
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

              <AppsHomeDesktop
                myName={myName}
                availableQapps={availableQapps}
                setMode={setMode}
                myApp={myApp}
                myWebsite={myWebsite}
                myAddress={myAddress}
              />
            </Box>
          )}

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

          <AppsLibraryDesktop
            availableQapps={availableQapps}
            categories={categories}
            contentHeight={appsContentHeight}
            externalSearchRequest={librarySearchRequest}
            getQapps={async () => {
              await getQapps();
              refreshRatings();
            }}
            hasPublishApp={!!(myApp || myWebsite)}
            isShow={
              desktopViewMode === 'apps' && mode === 'library' && !selectedTab
            }
            myName={myName}
            myAddress={myAddress}
            setMode={setMode}
          />

          {desktopViewMode === 'apps' && mode === 'appInfo' && !selectedTab && (
            <Box
              sx={{
                height: appsContentHeight,
                overflow: 'auto',
                width: '100%',
              }}
            >
              <AppInfo app={selectedAppInfo} myName={myName} />
            </Box>
          )}

          {desktopViewMode === 'apps' &&
            mode === 'appInfo-from-category' &&
            !selectedTab && (
              <Box
                sx={{
                  height: appsContentHeight,
                  overflow: 'auto',
                  width: '100%',
                }}
              >
                <AppInfo app={selectedAppInfo} myName={myName} />
              </Box>
            )}

          <AppsCategoryDesktop
            availableQapps={availableQapps}
            contentHeight={appsContentHeight}
            isShow={
              desktopViewMode === 'apps' && mode === 'category' && !selectedTab
            }
            category={selectedCategory}
            myName={myName}
          />

          {desktopViewMode === 'apps' &&
            (mode === 'publish' ||
              mode === 'publish-app' ||
              mode === 'publish-website') &&
            !selectedTab && (
              <Box
                sx={{
                  height: appsContentHeight,
                  overflow: 'auto',
                  width: '100%',
                }}
              >
                <AppPublish
                  categories={categories}
                  myAddress={myAddress}
                  myName={myName}
                  initialName={publishEditTarget?.name}
                  initialAppType={
                    publishEditTarget?.service ??
                    (mode === 'publish-website' ? 'WEBSITE' : 'APP')
                  }
                  isAppTypeLocked={
                    mode === 'publish-app' ||
                    mode === 'publish-website' ||
                    !!publishEditTarget
                  }
                />
              </Box>
            )}

          {viewerTabs.map((tab) => {
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
                          position: 'fixed',
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
            desktopViewMode === 'apps' &&
            mode === 'viewer' && (
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

                <AppsHomeDesktop
                  availableQapps={availableQapps}
                  myApp={myApp}
                  myName={myName}
                  myWebsite={myWebsite}
                  myAddress={myAddress}
                  setMode={setMode}
                />
              </Box>
            )}

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
          {pendingTabToRemove?.lockMessage && (
            <DialogContentText
              sx={{
                ...dialogContentTextSx,
                color: 'rgba(246,248,252,0.9)',
                fontWeight: 600,
                marginTop: 1.4,
              }}
            >
              {pendingTabToRemove.lockMessage}
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
