import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppsNavBarLeft,
  AppsNavBarParent,
  AppsNavBarRight,
} from './Apps-styles';
import { NavBack } from '../../assets/Icons/NavBack.tsx';
import { NavAdd } from '../../assets/Icons/NavAdd.tsx';
import { ButtonBase, Tab, Tabs, useTheme } from '@mui/material';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import RefreshIcon from '@mui/icons-material/Refresh';
import { navigationControllerAtom } from '../../atoms/global';
import { AppsDevModeTabComponent } from './AppsDevModeTabComponent';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

export const AppsDevModeNavBar = ({
  isDev,
  disableBack,
}: {
  disableBack?: boolean;
  isDev?: boolean;
}) => {
  const [tabs, setTabs] = useState([]);
  const [selectedTab, setSelectedTab] = useState(null);
  const [navigationController, setNavigationController] = useAtom(
    navigationControllerAtom
  );
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const theme = useTheme();

  const [isNewTabWindow, setIsNewTabWindow] = useState(false);
  const tabsRef = useRef(null);

  useEffect(() => {
    // Scroll to the last tab whenever the tabs array changes (e.g., when a new tab is added)
    if (tabsRef.current) {
      const tabElements = tabsRef.current.querySelectorAll('.MuiTab-root');
      if (tabElements.length > 0) {
        const lastTab = tabElements[tabElements.length - 1];
        lastTab.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'end',
        });
      }
    }
  }, [tabs.length]); // Dependency on the number of tabs

  const isDisableBackButton = useMemo(() => {
    if (disableBack) return true;
    if (!selectedTab) return true;
    if (selectedTab && navigationController[selectedTab?.tabId]?.hasBack)
      return false;
    if (selectedTab && !navigationController[selectedTab?.tabId]?.hasBack)
      return true;
    return false;
  }, [navigationController, selectedTab, disableBack]);

  console.log('isDisableBackButton', isDisableBackButton);
  console.log('selectedTab', selectedTab);

  const setTabsToNav = (e) => {
    const { tabs, selectedTab, isNewTabWindow } = e.detail?.data;

    setTabs([...tabs]);
    setSelectedTab(!selectedTab ? null : { ...selectedTab });
    setIsNewTabWindow(isNewTabWindow);
  };

  useEffect(() => {
    subscribeToEvent('appsDevModeSetTabsToNav', setTabsToNav);

    return () => {
      unsubscribeFromEvent('appsDevModeSetTabsToNav', setTabsToNav);
    };
  }, []);

  const hasTabs = (tabs || []).length > 0;

  return (
    <AppsNavBarParent
      sx={{
        borderRadius: '0px 30px 30px 0px',
        flexDirection: 'column',
        height: 'unset',
        maxHeight: '70vh',
        padding: '10px',
        position: 'relative',
        width: '59px',
      }}
    >
      <AppsNavBarLeft
        sx={{
          flexDirection: 'column',
        }}
      >
        {hasTabs && (
          <>
            <ButtonBase
              onClick={() => {
                executeEvent('devModeNavigateBack', selectedTab?.tabId);
              }}
              disabled={isDisableBackButton}
              sx={{
                opacity: !isDisableBackButton ? 1 : 0.1,
                cursor: !isDisableBackButton ? 'pointer' : 'default',
              }}
            >
              <NavBack />
            </ButtonBase>

            <Tabs
              orientation="vertical"
              ref={tabsRef}
              variant="scrollable" // Make tabs scrollable
              scrollButtons={true}
              sx={{
                '&.MuiTabs-indicator': {
                  backgroundColor: theme.palette.text.primary,
                },
                maxHeight: `275px`, // Ensure the tabs container fits within the available space
                overflow: 'hidden', // Prevents overflow on small screens
              }}
            >
              {tabs?.map((tab) => (
                <Tab
                  key={tab.tabId}
                  label={
                    <AppsDevModeTabComponent
                      isSelected={
                        !!isDev &&
                        tab?.tabId === selectedTab?.tabId &&
                        !isNewTabWindow
                      }
                      app={tab}
                    />
                  } // Pass custom component
                  sx={{
                    '&.Mui-selected': {
                      color: theme.palette.text.primary,
                    },
                    padding: '0px',
                    margin: '0px',
                    minWidth: '0px',
                    width: '50px',
                  }}
                />
              ))}
            </Tabs>
          </>
        )}
      </AppsNavBarLeft>

      {selectedTab && (
        <AppsNavBarRight
          sx={{
            gap: '10px',
            flexDirection: 'column',
          }}
        >
          <ButtonBase
            onClick={() => {
              setSelectedTab(null);
              executeEvent('devModeNewTabWindow', {});
            }}
          >
            <NavAdd
              style={{
                height: '40px',
                width: '40px',
              }}
            />
          </ButtonBase>

          <ButtonBase
            onClick={(e) => {
              if (selectedTab?.refreshFunc) {
                selectedTab.refreshFunc(selectedTab?.tabId);
              } else {
                executeEvent('refreshApp', {
                  tabId: selectedTab?.tabId,
                });
              }
            }}
          >
            <RefreshIcon
              sx={{
                color: theme.palette.text.primary,
                width: '40px',
                height: 'auto',
              }}
            />
          </ButtonBase>
        </AppsNavBarRight>
      )}
    </AppsNavBarParent>
  );
};
