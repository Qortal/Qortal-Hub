import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppsDevModeHome } from "./AppsDevModeHome";
import { Spacer } from "../../common/Spacer";
import { MyContext, getBaseApiReact } from "../../App";
import { AppInfo } from "./AppInfo";
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from "../../utils/events";
import { AppsParent } from "./Apps-styles";
import AppViewerContainer from "./AppViewerContainer";
import ShortUniqueId from "short-unique-id";
import { AppPublish } from "./AppPublish";
import { AppsLibraryDesktop } from "./AppsLibraryDesktop";
import { AppsCategoryDesktop } from "./AppsCategoryDesktop";
import { AppsNavBarDesktop } from "./AppsNavBarDesktop";
import { Box, ButtonBase } from "@mui/material";
import { HomeIcon } from "../../assets/Icons/HomeIcon";
import { MessagingIcon } from "../../assets/Icons/MessagingIcon";
import { Save } from "../Save/Save";
import { HubsIcon } from "../../assets/Icons/HubsIcon";
import { AppsDevModeNavBar } from "./AppsDevModeNavBar";
import { CoreSyncStatus } from "../CoreSyncStatus";

const uid = new ShortUniqueId({ length: 8 });

export const AppsDevMode = ({ mode, setMode, show , myName, goToHome, setDesktopSideView, hasUnreadDirects, isDirects, isGroups, hasUnreadGroups, toggleSideViewGroups, toggleSideViewDirects}) => {
  const [availableQapps, setAvailableQapps] = useState([]);
  const [selectedAppInfo, setSelectedAppInfo] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [tabs, setTabs] = useState([]);
  const [selectedTab, setSelectedTab] = useState(null);
  const [isNewTabWindow, setIsNewTabWindow] = useState(false);
  const [categories, setCategories] = useState([])
  const iframeRefs = useRef({});
 
  useEffect(() => {
    setTimeout(() => {
      executeEvent("appsDevModeSetTabsToNav", {
        data: {
          tabs: tabs,
          selectedTab: selectedTab,
          isNewTabWindow: isNewTabWindow,
        },
      });
    }, 100);
  }, [show, tabs, selectedTab, isNewTabWindow]);









  
  const navigateBackFunc = (e) => {
    if (['category', 'appInfo-from-category', 'appInfo', 'library', 'publish'].includes(mode)) {
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
    } else if(selectedTab?.tabId) {
      executeEvent(`navigateBackApp-${selectedTab?.tabId}`, {})
    }
  };
  

  useEffect(() => {
    subscribeToEvent("devModeNavigateBack", navigateBackFunc);

    return () => {
      unsubscribeFromEvent("devModeNavigateBack", navigateBackFunc);
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
    setMode("viewer");

    setIsNewTabWindow(false);
  };



  useEffect(() => {
    subscribeToEvent("appsDevModeAddTab", addTabFunc);

    return () => {
      unsubscribeFromEvent("appsDevModeAddTab", addTabFunc);
    };
  }, [tabs]);
  const setSelectedTabFunc = (e) => {
    const data = e.detail?.data;

    setSelectedTab(data);
    setTimeout(() => {
      executeEvent("appsDevModeSetTabsToNav", {
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
    subscribeToEvent("setSelectedTab", setSelectedTabFunc);

    return () => {
      unsubscribeFromEvent("setSelectedTab", setSelectedTabFunc);
    };
  }, [tabs, isNewTabWindow]);

  const removeTabFunc = (e) => {
    const data = e.detail?.data;
    const copyTabs = [...tabs].filter((tab) => tab?.tabId !== data?.tabId);
    if (copyTabs?.length === 0) {
      setMode("home");
    } else {
      setSelectedTab(copyTabs[0]);
    }
    setTabs(copyTabs);
    setSelectedTab(copyTabs[0]);
    setTimeout(() => {
      executeEvent("setTabsToNav", {
        data: {
          tabs: copyTabs,
          selectedTab: copyTabs[0],
        },
      });
    }, 400);
  };

  useEffect(() => {
    subscribeToEvent("removeTab", removeTabFunc);

    return () => {
      unsubscribeFromEvent("removeTab", removeTabFunc);
    };
  }, [tabs]);

  const setNewTabWindowFunc = (e) => {
    setIsNewTabWindow(true);
    setSelectedTab(null)
  };

  useEffect(() => {
    subscribeToEvent("devModeNewTabWindow", setNewTabWindowFunc);

    return () => {
      unsubscribeFromEvent("devModeNewTabWindow", setNewTabWindowFunc);
    };
  }, [tabs]);


  return (
    <AppsParent
      sx={{
        display: !show && "none",
        flexDirection:  'row' 
      }}
    >
     
       <Box sx={{
        width: '60px',
        flexDirection: 'column',
        height: '100vh',
        alignItems: 'center',
        display: 'flex',
        gap: '25px'
       }}>
        <ButtonBase
          sx={{
            width: '60px',
            height: '60px',
            paddingTop: '23px'
          }}
          onClick={() => {
            goToHome();

          }}
        >
            
            <HomeIcon
              height={34}
              color="rgba(250, 250, 250, 0.5)"
            />
        
        </ButtonBase>
        <ButtonBase
          onClick={() => {
            setDesktopSideView("directs");
            toggleSideViewDirects()
          }}
        >
        
            <MessagingIcon
              height={30}
              color={
                hasUnreadDirects
                  ? "var(--unread)"
                  : isDirects
                  ? "white"
                  : "rgba(250, 250, 250, 0.5)"
              }
            />

        </ButtonBase>
        <ButtonBase
          onClick={() => {
            setDesktopSideView("groups");
            toggleSideViewGroups()
          }}
        >
            <HubsIcon
              height={30}
              color={
                hasUnreadGroups
                  ? "var(--unread)"
                  : isGroups
                  ? "white"
                  : "rgba(250, 250, 250, 0.5)"
              }
            />
     
        </ButtonBase>
        <Save isDesktop disableWidth />
        <CoreSyncStatus imageSize="30px" position="left" />
        {mode !== 'home' && (
                 <AppsDevModeNavBar  />

        )}

       </Box>
    
  
      {mode === "home" && (
         <Box sx={{
          display: 'flex',
          width: '100%',
          flexDirection: 'column',
          height: '100vh',
          overflow: 'auto'
        }}>

         <Spacer height="30px" />
        <AppsDevModeHome availableQapps={availableQapps}  setMode={setMode} myApp={null} myWebsite={null} />
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
            isDevMode={true}
          />
        );
      })}

      {isNewTabWindow && mode === "viewer" && (
        <>
        <Box sx={{
          display: 'flex',
          width: '100%',
          flexDirection: 'column',
          height: '100vh',
          overflow: 'auto'
        }}>

         <Spacer height="30px" />
          <AppsDevModeHome availableQapps={availableQapps} setMode={setMode} myApp={null} myWebsite={null}  />
          </Box>
        </>
      )}
    </AppsParent>
  );
};
