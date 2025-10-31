import {
  createRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppsHomeDesktop } from './AppsHomeDesktop';
import { Spacer } from '../../common/Spacer';
import { QORTAL_APP_CONTEXT, getBaseApiReact } from '../../App';
import { AppInfo } from './AppInfo';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { AppsParent } from './Apps-styles';
import AppViewerContainer from './AppViewerContainer';
import ShortUniqueId from 'short-unique-id';
import { AppPublish } from './AppPublish';
import { AppsLibraryDesktop } from './AppsLibraryDesktop';
import { AppsCategoryDesktop } from './AppsCategoryDesktop';
import { AppsNavBarDesktop } from './AppsNavBarDesktop';
import { Box, ButtonBase, useTheme } from '@mui/material';
import { HomeIcon } from '../../assets/Icons/HomeIcon';
import { Save } from '../Save/Save';
import { IconWrapper } from '../Desktop/DesktopFooter';
import { enabledDevModeAtom } from '../../atoms/global';
import { AppsIcon } from '../../assets/Icons/AppsIcon';
import { CoreSyncStatus } from '../CoreSyncStatus';
import { MessagingIconFilled } from '../../assets/Icons/MessagingIconFilled';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import LanguageSelector from '../Language/LanguageSelector';
import ThemeSelector from '../Theme/ThemeSelector';
import { TIME_MINUTES_20_IN_MILLISECONDS } from '../../constants/constants';

const uid = new ShortUniqueId({ length: 8 });

export const AppsDesktop = ({
  mode,
  setMode,
  show,
  myName,
  goToHome,
  hasUnreadDirects,
  hasUnreadGroups,
  setDesktopViewMode,
  desktopViewMode,
  myAddress,
}) => {
  const [availableQapps, setAvailableQapps] = useState([]);
  const [selectedAppInfo, setSelectedAppInfo] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [tabs, setTabs] = useState([]);
  const [selectedTab, setSelectedTab] = useState(null);
  const [isNewTabWindow, setIsNewTabWindow] = useState(false);
  const [categories, setCategories] = useState([]);
  const iframeRefs = useRef({});
  const [isEnabledDevMode, setIsEnabledDevMode] = useAtom(enabledDevModeAtom);
  const { showTutorial } = useContext(QORTAL_APP_CONTEXT);
  const theme = useTheme();
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
    if (show) {
      showTutorial('qapps');
    }
  }, [show]);

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
      } else if (mode === 'publish') {
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

  const removeTabFunc = (e) => {
    const data = e.detail?.data;
    const copyTabs = [...tabs].filter((tab) => tab?.tabId !== data?.tabId);
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

  return (
    <AppsParent
      sx={{
        flexDirection: 'row',
        left: !show && '-200vw',
        position: !show && 'fixed',
      }}
    >
      {mode === 'home' && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            height: '100vh',
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
        getQapps={getQapps}
        hasPublishApp={!!(myApp || myWebsite)}
        isShow={mode === 'library' && !selectedTab}
        myName={myName}
        setMode={setMode}
      />

      {mode === 'appInfo' && !selectedTab && (
        <AppInfo app={selectedAppInfo} myName={myName} />
      )}

      {mode === 'appInfo-from-category' && !selectedTab && (
        <AppInfo app={selectedAppInfo} myName={myName} />
      )}

      <AppsCategoryDesktop
        availableQapps={availableQapps}
        isShow={mode === 'category' && !selectedTab}
        category={selectedCategory}
        myName={myName}
      />

      {mode === 'publish' && !selectedTab && (
        <AppPublish
          categories={categories}
          myAddress={myAddress}
          myName={myName}
        />
      )}

      {tabs.map((tab) => {
        if (!iframeRefs.current[tab.tabId]) {
          iframeRefs.current[tab.tabId] = createRef();
        }
        return (
          <AppViewerContainer
            app={tab}
            hide={isNewTabWindow}
            isDevMode={tab?.service ? false : true}
            isSelected={tab?.tabId === selectedTab?.tabId}
            key={tab?.tabId}
            ref={iframeRefs.current[tab.tabId]}
          />
        );
      })}

      {isNewTabWindow && mode === 'viewer' && (
        <>
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              height: '100vh',
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
        </>
      )}
    </AppsParent>
  );
};
