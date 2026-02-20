import { useState } from 'react';
import {
  AppsDesktopLibraryBody,
  AppsDesktopLibraryHeader,
  AppsLibraryContainer,
  AppsWidthLimiter,
} from './Apps-styles';
import { Box } from '@mui/material';
import { QappLibraryText } from '../../assets/Icons/QappLibraryText.tsx';
import { Spacer } from '../../common/Spacer';
import { executeEvent } from '../../utils/events';
import { ComposeP, ShowMessageReturnButton } from '../Group/Forum/Mail-styles';
import { ReturnIcon } from '../../assets/Icons/ReturnIcon.tsx';
import { useTranslation } from 'react-i18next';
import {
  AppsTabs,
  AppsLibraryTabValue,
  OfficialAppsTab,
  CommunityAppsTab,
  CategoriesTab,
  MyAppsTab,
  PrivateTab,
} from './AppsLibrary';
import { appHeighOffsetPx } from '../Desktop/CustomTitleBar';
import { APPS_BOTTOM_NAV_HEIGHT_PX } from './Apps-styles';

export const AppsLibraryDesktop = ({
  availableQapps,
  setMode,
  myName,
  myAddress,
  isShow,
  categories,
}) => {
  const [currentTab, setCurrentTab] = useState<AppsLibraryTabValue>('official');
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const handleTabChange = (tab: AppsLibraryTabValue) => {
    setCurrentTab(tab);
  };

  const renderTabContent = () => {
    switch (currentTab) {
      case 'official':
        return (
          <OfficialAppsTab availableQapps={availableQapps} myName={myName} />
        );
      case 'community':
        return (
          <CommunityAppsTab
            availableQapps={availableQapps}
            myName={myName}
            categories={categories}
          />
        );
      case 'categories':
        return (
          <CategoriesTab
            categories={categories}
            availableQapps={availableQapps}
          />
        );
      case 'my-apps':
        return (
          <MyAppsTab
            myName={myName}
            availableQapps={availableQapps}
            setMode={setMode}
          />
        );
      case 'private':
        return <PrivateTab myName={myName} myAddress={myAddress} />;
      default:
        return (
          <OfficialAppsTab availableQapps={availableQapps} myName={myName} />
        );
    }
  };

  return (
    <AppsLibraryContainer
      sx={{
        display: !isShow && 'none',
        padding: '0px',
        height: `calc(100vh - ${appHeighOffsetPx} )`,
        overflow: 'hidden',
        paddingTop: '30px',
      }}
    >
      {/* Fixed Header Section */}
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 1,
          backgroundColor: 'background.default',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <AppsDesktopLibraryHeader
          sx={{
            maxWidth: '1500px',
            width: '90%',
          }}
        >
          <AppsWidthLimiter>
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                justifyContent: 'flex-start',
                width: '100%',
              }}
            >
              <QappLibraryText />
            </Box>
          </AppsWidthLimiter>
        </AppsDesktopLibraryHeader>

        <Box
          sx={{
            maxWidth: '1500px',
            width: '90%',
          }}
        >
          <Spacer height="20px" />

          <ShowMessageReturnButton
            sx={{
              padding: '2px',
            }}
            onClick={() => {
              executeEvent('navigateBack', {});
            }}
          >
            <ReturnIcon />
            <ComposeP
              sx={{
                fontSize: '18px',
              }}
            >
              {t('core:action.return_apps_dashboard', {
                postProcess: 'capitalizeFirstChar',
              })}
            </ComposeP>
          </ShowMessageReturnButton>

          <Spacer height="20px" />

          {/* Tab Navigation - Fixed */}
          <AppsWidthLimiter>
            <AppsTabs currentTab={currentTab} onTabChange={handleTabChange} />
          </AppsWidthLimiter>

          <Spacer height="30px" />
        </Box>
      </Box>

      {/* Scrollable Content Section */}
      <AppsDesktopLibraryBody
        sx={{
          alignItems: 'center',
          flex: 1,
          overflow: 'hidden',
          padding: '0px',
        }}
      >
        <AppsDesktopLibraryBody
          sx={{
            flex: 1,
            maxWidth: '1500px',
            minHeight: 0,
            msOverflowStyle: 'none',
            overflow: 'auto',
            scrollbarWidth: 'none',
            width: '90%',
            '&::-webkit-scrollbar': {
              display: 'none',
            },
          }}
        >
          {/* Tab Content */}
          {renderTabContent()}
        </AppsDesktopLibraryBody>
      </AppsDesktopLibraryBody>
    </AppsLibraryContainer>
  );
};
