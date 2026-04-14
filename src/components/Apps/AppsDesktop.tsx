import {
  createRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  const { refreshRatings } = useAppRatings();
  const [showCloseTabDialog, setShowCloseTabDialog] = useState(false);
  const [pendingTabToRemove, setPendingTabToRemove] = useState(null);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState<{
    message: string;
    type: 'warning' | 'error' | 'success' | 'info';
  } | null>(null);
  const [librarySearchRequest, setLibrarySearchRequest] = useState<{
    nonce: number;
    query: string;
  }>({ nonce: 0, query: '' });
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
    setTimeout(() => {
      executeEvent('setTabsToNav', {
        data: {
          tabs: tabs,
          selectedTab: selectedTab,
          isNewTabWindow: isNewTabWindow,
        },
      });
    }, 100);
  }, [show, tabs, selectedTab, isNewTabWindow]);

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
    setTabs((prev) => [...prev, newTab]);
    setSelectedTab(newTab);
    setMode('viewer');
    setIsNewTabWindow(false);
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

    setSelectedTab(data);
    setTimeout(() => {
      executeEvent('setTabsToNav', {
        data: {
          tabs: tabs,
          selectedTab: data,
          isNewTabWindow: isNewTabWindow,
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
    if (copyTabs?.length === 0) {
      setMode('home');
    } else {
      setSelectedTab(copyTabs[0]);
    }
    setTabs(copyTabs);
    setSelectedTab(copyTabs[0]);
    setTimeout(() => {
      executeEvent('setTabsToNav', {
        data: {
          tabs: copyTabs,
          selectedTab: copyTabs[0],
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

  const appsContentHeight = `calc(100vh - ${appChromeOffsetPx} - ${APPS_HORIZONTAL_TAB_HEIGHT_PX}px)`;

  const openDashboardFromTabs = useCallback(() => {
    setSelectedTab(null);
    setLibrarySearchRequest({
      nonce: Date.now(),
      query: '',
    });
    setMode('viewer');
    setIsNewTabWindow(true);
    executeEvent('open-apps-mode', {});
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
        <AppsHorizontalTabBar>
          <AppsHorizontalTabScroller>
            {tabs.map((tab) => (
              <TabComponent
                key={tab?.tabId}
                app={tab}
                isSelected={tab?.tabId === selectedTab?.tabId}
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

            <AppsHorizontalTabAddButton
              disableRipple
              onClick={openDashboardFromTabs}
              sx={(theme) => ({
                '&:hover': {
                  backgroundColor:
                    theme.palette.mode === 'dark'
                      ? 'rgba(255, 255, 255, 0.08)'
                      : 'rgba(0, 0, 0, 0.06)',
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
