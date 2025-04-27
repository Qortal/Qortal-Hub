import React, { useEffect, useRef, useState } from 'react';
import { AppsDevModeHome } from './AppsDevModeHome';
import { Spacer } from '../../common/Spacer';

import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { AppsParent } from './Apps-styles';
import AppViewerContainer from './AppViewerContainer';
import ShortUniqueId from 'short-unique-id';

import { Box, ButtonBase, useTheme } from '@mui/material';
import { HomeIcon } from '../../assets/Icons/HomeIcon';
import { Save } from '../Save/Save';
import { AppsDevModeNavBar } from './AppsDevModeNavBar';
import { AppsIcon } from '../../assets/Icons/AppsIcon';
import { IconWrapper } from '../Desktop/DesktopFooter';
import { CoreSyncStatus } from '../CoreSyncStatus';
import { MessagingIconFilled } from '../../assets/Icons/MessagingIconFilled';

const uid = new ShortUniqueId({ length: 8 });

export const AppsDevMode = ({
  mode,
  setMode,
  show,
  myName,
  goToHome,
  setDesktopSideView,
  hasUnreadDirects,
  isDirects,
  isGroups,
  hasUnreadGroups,
  toggleSideViewGroups,
  toggleSideViewDirects,
  setDesktopViewMode,
  desktopViewMode,
  isApps,
}) => {
  const [availableQapps, setAvailableQapps] = useState([]);
  const [selectedAppInfo, setSelectedAppInfo] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [tabs, setTabs] = useState([]);
  const [selectedTab, setSelectedTab] = useState(null);
  const [isNewTabWindow, setIsNewTabWindow] = useState(false);
  const [categories, setCategories] = useState([]);
  const iframeRefs = useRef({});
  const theme = useTheme();

  useEffect(() => {
    setTimeout(() => {
      executeEvent('appsDevModeSetTabsToNav', {
        data: {
          tabs: tabs,
          selectedTab: selectedTab,
          isNewTabWindow: isNewTabWindow,
        },
      });
    }, 100);
  }, [show, tabs, selectedTab, isNewTabWindow]);

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
    subscribeToEvent('devModeNavigateBack', navigateBackFunc);

    return () => {
      unsubscribeFromEvent('devModeNavigateBack', navigateBackFunc);
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
    subscribeToEvent('appsDevModeAddTab', addTabFunc);

    return () => {
      unsubscribeFromEvent('appsDevModeAddTab', addTabFunc);
    };
  }, [tabs]);

  const updateTabFunc = (e) => {
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
    setMode('viewer');

    setIsNewTabWindow(false);
  };

  useEffect(() => {
    subscribeToEvent('appsDevModeUpdateTab', updateTabFunc);

    return () => {
      unsubscribeFromEvent('appsDevModeUpdateTab', updateTabFunc);
    };
  }, [tabs]);

  const setSelectedTabFunc = (e) => {
    const data = e.detail?.data;
    if (!e.detail?.isDevMode) return;
    setSelectedTab(data);
    setTimeout(() => {
      executeEvent('appsDevModeSetTabsToNav', {
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
    subscribeToEvent('setSelectedTabDevMode', setSelectedTabFunc);

    return () => {
      unsubscribeFromEvent('setSelectedTabDevMode', setSelectedTabFunc);
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
      executeEvent('appsDevModeSetTabsToNav', {
        data: {
          tabs: copyTabs,
          selectedTab: copyTabs[0],
        },
      });
    }, 400);
  };

  useEffect(() => {
    subscribeToEvent('removeTabDevMode', removeTabFunc);

    return () => {
      unsubscribeFromEvent('removeTabDevMode', removeTabFunc);
    };
  }, [tabs]);

  const setNewTabWindowFunc = (e) => {
    setIsNewTabWindow(true);
    setSelectedTab(null);
  };

  useEffect(() => {
    subscribeToEvent('devModeNewTabWindow', setNewTabWindowFunc);

    return () => {
      unsubscribeFromEvent('devModeNewTabWindow', setNewTabWindowFunc);
    };
  }, [tabs]);

  return (
    <AppsParent
      sx={{
        flexDirection: 'row',
        position: !show && 'fixed',
        left: !show && '-200vw',
      }}
    >
      <Box
        sx={{
          width: '60px',
          flexDirection: 'column',
          height: '100vh',
          alignItems: 'center',
          display: 'flex',
          gap: '25px',
        }}
      >
        <ButtonBase
          sx={{
            width: '70px',
            height: '70px',
            paddingTop: '23px',
          }}
        >
          <CoreSyncStatus />
        </ButtonBase>

        <ButtonBase
          sx={{
            width: '60px',
            height: '60px',
          }}
          onClick={() => {
            goToHome();
          }}
        >
          <HomeIcon
            height={34}
            color={
              desktopViewMode === 'home'
                ? theme.palette.text.primary
                : theme.palette.text.secondary
            }
          />
        </ButtonBase>
        <ButtonBase
          onClick={() => {
            setDesktopViewMode('apps');
          }}
        >
          <IconWrapper
            color={
              isApps ? theme.palette.text.primary : theme.palette.text.secondary
            }
            label="Apps"
            disableWidth
          >
            <AppsIcon
              height={30}
              color={
                isApps
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary
              }
            />
          </IconWrapper>
        </ButtonBase>
        <ButtonBase
          onClick={() => {
            setDesktopViewMode('chat');
          }}
        >
          <IconWrapper
            color={
              hasUnreadDirects || hasUnreadGroups
                ? 'var(--unread)'
                : desktopViewMode === 'chat'
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary
            }
            label="Chat"
            disableWidth
          >
            <MessagingIconFilled
              height={30}
              color={
                hasUnreadDirects || hasUnreadGroups
                  ? 'var(--unread)'
                  : desktopViewMode === 'chat'
                    ? theme.palette.text.primary
                    : theme.palette.text.secondary
              }
            />
          </IconWrapper>
        </ButtonBase>
        <Save isDesktop disableWidth myName={myName} />
        <ButtonBase
          onClick={() => {
            setDesktopViewMode('dev');
          }}
        >
          <IconWrapper
            color={
              desktopViewMode === 'dev'
                ? theme.palette.text.primary
                : theme.palette.text.secondary
            }
            label="Dev"
            disableWidth
          >
            <AppsIcon
              color={
                desktopViewMode === 'dev'
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary
              }
              height={30}
            />
          </IconWrapper>
        </ButtonBase>
        {mode !== 'home' && <AppsDevModeNavBar />}
      </Box>

      {mode === 'home' && (
        <Box
          sx={{
            display: 'flex',
            width: '100%',
            flexDirection: 'column',
            height: '100vh',
            overflow: 'auto',
          }}
        >
          <Spacer height="30px" />
          <AppsDevModeHome
            myName={myName}
            availableQapps={availableQapps}
            setMode={setMode}
            myApp={null}
            myWebsite={null}
          />
        </Box>
      )}

      {tabs.map((tab) => {
        if (!iframeRefs.current[tab.tabId]) {
          iframeRefs.current[tab.tabId] = React.createRef();
        }
        return (
          <AppViewerContainer
            key={tab?.tabId}
            hide={isNewTabWindow}
            isSelected={tab?.tabId === selectedTab?.tabId}
            app={tab}
            ref={iframeRefs.current[tab.tabId]}
            isDevMode={tab?.service ? false : true}
          />
        );
      })}

      {isNewTabWindow && mode === 'viewer' && (
        <>
          <Box
            sx={{
              display: 'flex',
              width: '100%',
              flexDirection: 'column',
              height: '100vh',
              overflow: 'auto',
            }}
          >
            <Spacer height="30px" />
            <AppsDevModeHome
              myName={myName}
              availableQapps={availableQapps}
              setMode={setMode}
              myApp={null}
              myWebsite={null}
            />
          </Box>
        </>
      )}
    </AppsParent>
  );
};
