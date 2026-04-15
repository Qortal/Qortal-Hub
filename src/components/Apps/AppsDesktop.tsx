import {
  createRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
import { RatingsCacheInitializer, useAppRatings } from '../../hooks/useAppRatings';
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

const uid = new ShortUniqueId({ length: 8 });
const MAX_OPEN_APP_TABS = 10;
const SIDEBAR_CHROME_TRANSITION = '200ms cubic-bezier(0.2, 0, 0, 1)';

function normalizeQortalInput(value: string) {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  if (/^qortal:\/\//i.test(trimmed)) return trimmed;
  return `${QORTAL_PROTOCOL}${trimmed}`;
}

export const AppsDesktop = ({ mode, setMode, show }) => {
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
  const [librarySearchRequest, setLibrarySearchRequest] = useState<{
    nonce: number;
    query: string;
  }>({ nonce: 0, query: '' });
  const tabsToNavTimeoutRef = useRef<number | null>(null);
  const tabActivationTimeoutRef = useRef<number | null>(null);
  const tabEntryCleanupTimeoutRef = useRef<number | null>(null);
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
    return () => {
      if (tabActivationTimeoutRef.current !== null) {
        window.clearTimeout(tabActivationTimeoutRef.current);
      }
      if (tabEntryCleanupTimeoutRef.current !== null) {
        window.clearTimeout(tabEntryCleanupTimeoutRef.current);
      }
    };
  }, []);

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

  const navigateBackFunc = (e) => {
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
      // Handle the various modes as needed
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
      executeEvent(`navigateBackApp-${selectedTab?.tabId}`, {});
    }
  };

  useEffect(() => {
    subscribeToEvent('navigateBack', navigateBackFunc);

    return () => {
      unsubscribeFromEvent('navigateBack', navigateBackFunc);
    };
  }, [mode, selectedTab]);

  const addTabFunc = (e) => {
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

  const setSelectedTabFunc = (e) => {
    const data = e.detail?.data;
    if (e.detail?.isDevMode) return;

    setPendingVisualTabActivationId(null);
    setDelayedVisualActiveTabId(null);
    setEnteringTabIds((prev) => prev.filter((id) => id !== data?.tabId));
    setIsAddTabFocused(false);
    setIsAddTabWaitingForPointerMove(false);
    addTabPointerOriginRef.current = null;
    setSelectedTab(data);
    setMode('viewer');
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

    const copyTabs = [...tabs].filter((tab) => tab?.tabId !== tabId);
    setEnteringTabIds((prev) => prev.filter((id) => id !== tabId));
    setPendingVisualTabActivationId((prev) => (prev === tabId ? null : prev));
    setDelayedVisualActiveTabId((prev) => (prev === tabId ? null : prev));
    setIsAddTabWaitingForPointerMove(false);
    addTabPointerOriginRef.current = null;
    if (copyTabs?.length === 0) {
      setMode('home');
    } else {
      setSelectedTab(copyTabs[0]);
    }
    setTabs(copyTabs);
    setSelectedTab(copyTabs[0]);
    tabsTokenRef.current += 1;
    const tabsToken = tabsTokenRef.current;
    setTimeout(() => {
      executeEvent('setTabsToNav', {
        data: {
          tabs: copyTabs,
          selectedTab: copyTabs[0],
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

  const setNewTabWindowFunc = (e) => {
    setIsNewTabWindow(true);
    setIsAddTabFocused(true);
    setSelectedTab(null);
  };

  useEffect(() => {
    subscribeToEvent('newTabWindow', setNewTabWindowFunc);

    return () => {
      unsubscribeFromEvent('newTabWindow', setNewTabWindowFunc);
    };
  }, [tabs]);

  const openAppsLibrarySearchFunc = useCallback((e) => {
    const query = e.detail?.data?.query || '';
    setIsAddTabFocused(true);
    setSelectedTab(null);
    setIsNewTabWindow(false);
    setLibrarySearchRequest({
      nonce: Date.now(),
      query,
    });
    setMode('library');
  }, []);

  useEffect(() => {
    subscribeToEvent('openAppsLibrarySearch', openAppsLibrarySearchFunc);

    return () => {
      unsubscribeFromEvent(
        'openAppsLibrarySearch',
        openAppsLibrarySearchFunc
      );
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
    setMode('home');
    setIsNewTabWindow(false);
  }, [setIsNewTabWindow, setMode]);

  const duplicateTab = useCallback(
    (tab) => {
      if (!tab) return;

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
    setTabs([]);
    setSelectedTab(null);
    setIsAddTabFocused(false);
    setIsAddTabWaitingForPointerMove(false);
    addTabPointerOriginRef.current = null;
    setIsNewTabWindow(false);
    setMode('home');
    executeEvent('clearNavInput', {});
    executeEvent('open-apps-mode', {});
    tabsTokenRef.current += 1;
    executeEvent('setTabsToNav', {
      data: {
        tabs: [],
        selectedTab: null,
        isNewTabWindow: false,
        tabsToken: tabsTokenRef.current,
      },
    });
    executeEvent('forceNavClear', { data: { tabsToken: tabsTokenRef.current } });
  }, [tabs, setIsNewTabWindow, setMode]);

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

    if (tabs.length === 0 && !isNewTabWindow && mode === 'viewer') {
      setMode('home');
    }
  }, [tabs.length, selectedTab, isNewTabWindow, mode, setMode]);

  const handleTabDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setTabs((prev) => {
      const oldIndex = prev.findIndex((tab) => tab?.tabId === active.id);
      const newIndex = prev.findIndex((tab) => tab?.tabId === over.id);

      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  return (
    <AppsParent
      sx={{
        flexDirection: 'row',
        left: !show && '-200vw',
        position: !show && 'fixed',
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
            marginLeft: `${sidebarOffsetPx}px`,
            transition: `margin-left ${SIDEBAR_CHROME_TRANSITION}, width ${SIDEBAR_CHROME_TRANSITION}, opacity ${show ? '200ms ease-out' : '140ms ease-in'}, transform ${show ? '200ms ease-out' : '140ms ease-in'}`,
            width: sidebarOffsetPx
              ? `calc(100% - ${sidebarOffsetPx}px)`
              : '100%',
            opacity: show ? 1 : 0,
            transform: show ? 'translateY(0px)' : 'translateY(-10px)',
            willChange: 'opacity, transform',
            pointerEvents: show ? 'auto' : 'none',
          }}
        >
          <AppsHorizontalTabScroller
            sx={{
              alignItems: 'stretch',
              gap: '2px',
            }}
          >
            <DndContext
              collisionDetection={closestCenter}
              onDragEnd={handleTabDragEnd}
              sensors={sensors}
            >
              <SortableContext
                items={tabs.map((tab) => tab?.tabId)}
                strategy={horizontalListSortingStrategy}
              >
                <Box
                  sx={{
                    display: 'flex',
                    flex: '0 1 auto',
                    gap: '2px',
                    minWidth: 0,
                  }}
                >
                  {tabs.map((tab) => (
                    <TabComponent
                      key={tab?.tabId}
                      app={tab}
                      isSelected={tab?.tabId === selectedTab?.tabId}
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
                        executeEvent('open-apps-mode', {});
                        executeEvent('setSelectedTab', {
                          data: tab,
                        });
                      }}
                    />
                  ))}
                </Box>
              </SortableContext>
            </DndContext>

            <AppsHorizontalTabAddButton
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
          {mode === 'home' && (
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
            isShow={mode === 'library' && !selectedTab}
            myName={myName}
            myAddress={myAddress}
            setMode={setMode}
          />

          {mode === 'appInfo' && !selectedTab && (
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

          {mode === 'appInfo-from-category' && !selectedTab && (
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
            isShow={mode === 'category' && !selectedTab}
            category={selectedCategory}
            myName={myName}
          />

          {(mode === 'publish' ||
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

          {tabs.map((tab) => {
            if (!iframeRefs.current[tab.tabId]) {
              iframeRefs.current[tab.tabId] = createRef();
            }
            return (
              <AppViewerContainer
                app={tab}
                customHeight="100%"
                hide={isNewTabWindow}
                isDevMode={tab?.service ? false : true}
                isSelected={tab?.tabId === selectedTab?.tabId}
                key={tab?.tabId}
                ref={iframeRefs.current[tab.tabId]}
              />
            );
          })}

          {isNewTabWindow && mode === 'viewer' && (
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
        </Box>
      </Box>

      <Dialog
        open={showCloseTabDialog}
        onClose={handleCloseTabDialogCancel}
        aria-labelledby="close-tab-dialog-title"
        aria-describedby="close-tab-dialog-description"
      >
        <DialogTitle id="close-tab-dialog-title">
          {t('question:permission.close_tab_confirmation', {
            postProcess: 'capitalizeFirstChar',
          })}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="close-tab-dialog-description">
            {t('question:permission.close_tab_permission', {
              postProcess: 'capitalizeFirstChar',
            })}
          </DialogContentText>
          {pendingTabToRemove?.lockMessage && (
            <DialogContentText
              sx={{
                marginTop: 2,
                fontWeight: 500,
                color: theme.palette.text.primary,
              }}
            >
              {pendingTabToRemove.lockMessage}
            </DialogContentText>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseTabDialogCancel} color="primary">
            {t('core:action.cancel', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
          <Button
            onClick={handleCloseTabDialogConfirm}
            color="error"
            variant="contained"
            autoFocus
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
