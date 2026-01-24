import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppsDesktopLibraryBody,
  AppsDesktopLibraryHeader,
  AppsLibraryContainer,
  AppsSearchContainer,
  AppsSearchLeft,
  AppsSearchRight,
  AppsWidthLimiter,
} from './Apps-styles';
import {
  Box,
  ButtonBase,
  InputBase,
  Typography,
  styled,
  useTheme,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import IconClearInput from '../../assets/svgs/ClearInput.svg';
import { QappLibraryText } from '../../assets/Icons/QappLibraryText.tsx';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Spacer } from '../../common/Spacer';
import { AppInfoSnippet } from './AppInfoSnippet';
import { Virtuoso } from 'react-virtuoso';
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
} from './AppsLibrary';

const StyledVirtuosoContainer = styled('div')({
  position: 'relative',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',

  // Hide scrollbar for WebKit browsers (Chrome, Safari)
  '::-webkit-scrollbar': {
    width: '0px',
    height: '0px',
  },

  // Hide scrollbar for Firefox
  scrollbarWidth: 'none',

  // Hide scrollbar for IE and older Edge
  msOverflowStyle: 'none',
});

export const AppsLibraryDesktop = ({
  availableQapps,
  setMode,
  myName,
  hasPublishApp,
  isShow,
  categories,
  getQapps,
}) => {
  const [searchValue, setSearchValue] = useState('');
  const [currentTab, setCurrentTab] = useState<AppsLibraryTabValue>('official');
  const virtuosoRef = useRef(null);
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const [debouncedValue, setDebouncedValue] = useState(''); // Debounced value

  // Debounce logic
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(searchValue);
    }, 350);
    setTimeout(() => {
      if (virtuosoRef.current) {
        virtuosoRef.current.scrollToIndex({ index: 0 });
      }
    }, 500);
    // Cleanup timeout if searchValue changes before the timeout completes
    return () => {
      clearTimeout(handler);
    };
  }, [searchValue]); // Runs effect when searchValue changes

  const searchedList = useMemo(() => {
    if (!debouncedValue) return [];
    return availableQapps.filter(
      (app) =>
        app.name.toLowerCase().includes(debouncedValue.toLowerCase()) ||
        (app?.metadata?.title &&
          app?.metadata?.title
            ?.toLowerCase()
            .includes(debouncedValue.toLowerCase()))
    );
  }, [debouncedValue, availableQapps]);

  const rowRenderer = (index) => {
    let app = searchedList[index];
    return (
      <AppInfoSnippet
        key={`${app?.service}-${app?.name}`}
        app={app}
        myName={myName}
        parentStyles={{
          padding: '0px 10px',
        }}
      />
    );
  };

  const handleTabChange = (tab: AppsLibraryTabValue) => {
    setCurrentTab(tab);
    // Clear search when changing tabs
    setSearchValue('');
  };

  const renderTabContent = () => {
    switch (currentTab) {
      case 'official':
        return <OfficialAppsTab availableQapps={availableQapps} />;
      case 'community':
        return (
          <CommunityAppsTab availableQapps={availableQapps} myName={myName} />
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
            hasPublishApp={hasPublishApp}
            setMode={setMode}
          />
        );
      default:
        return <OfficialAppsTab availableQapps={availableQapps} />;
    }
  };

  return (
    <AppsLibraryContainer
      sx={{
        display: !isShow && 'none',
        padding: '0px',
        height: '100vh',
        overflow: 'hidden',
        paddingTop: '30px',
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
              justifyContent: 'space-between',
              width: '100%',
            }}
          >
            <QappLibraryText />
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                gap: '20px',
              }}
            >
              <AppsSearchContainer
                sx={{
                  width: '412px',
                }}
              >
                <AppsSearchLeft>
                  <SearchIcon />

                  <InputBase
                    value={searchValue}
                    onChange={(e) => setSearchValue(e.target.value)}
                    sx={{
                      background: theme.palette.background.paper,
                      borderRadius: '6px',
                      flex: 1,
                      ml: 1,
                      paddingLeft: '12px',
                    }}
                    placeholder={t('core:action.search_apps', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    inputProps={{
                      'aria-label': t('core:action.search_apps', {
                        postProcess: 'capitalizeFirstChar',
                      }),
                      fontSize: '16px',
                      fontWeight: 400,
                    }}
                  />
                </AppsSearchLeft>

                <AppsSearchRight>
                  {searchValue && (
                    <ButtonBase
                      onClick={() => {
                        setSearchValue('');
                      }}
                    >
                      <img src={IconClearInput} />
                    </ButtonBase>
                  )}
                </AppsSearchRight>
              </AppsSearchContainer>

              <ButtonBase
                onClick={(e) => {
                  getQapps();
                }}
              >
                <RefreshIcon
                  sx={{
                    width: '40px',
                    height: 'auto',
                  }}
                />
              </ButtonBase>
            </Box>
          </Box>
        </AppsWidthLimiter>
      </AppsDesktopLibraryHeader>

      <AppsDesktopLibraryBody
        sx={{
          alignItems: 'center',
          height: `calc(100vh - 36px)`,
          overflow: 'auto',
          padding: '0px',
        }}
      >
        <AppsDesktopLibraryBody
          sx={{
            height: `calc(100vh - 36px)`,
            flexGrow: 'unset',
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

          {/* Tab Navigation */}
          <AppsTabs currentTab={currentTab} onTabChange={handleTabChange} />

          <Spacer height="30px" />

          {/* Search Results or Tab Content */}
          {searchedList?.length > 0 ? (
            <AppsWidthLimiter>
              <StyledVirtuosoContainer
                sx={{
                  height: `calc(100vh - 36px - 200px)`,
                }}
              >
                <Virtuoso
                  ref={virtuosoRef}
                  data={searchedList}
                  itemContent={rowRenderer}
                  atBottomThreshold={50}
                  followOutput="smooth"
                />
              </StyledVirtuosoContainer>
            </AppsWidthLimiter>
          ) : searchedList?.length === 0 && debouncedValue ? (
            <AppsWidthLimiter>
              <Typography>
                {t('core:message.generic.no_results', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </AppsWidthLimiter>
          ) : (
            renderTabContent()
          )}
        </AppsDesktopLibraryBody>
      </AppsDesktopLibraryBody>
    </AppsLibraryContainer>
  );
};
