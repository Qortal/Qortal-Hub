import { useState, useEffect } from 'react';
import {
  AppsDesktopLibraryBody,
  AppsDesktopLibraryHeader,
  AppsLibraryContainer,
  AppsWidthLimiter,
} from './Apps-styles';
import {
  Box,
  ButtonBase,
  IconButton,
  InputBase,
  Tooltip,
  styled,
  useTheme,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { QappLibraryText } from '../../assets/Icons/QappLibraryText.tsx';
import { Spacer } from '../../common/Spacer';
import { executeEvent } from '../../utils/events';
import { ComposeP, ShowMessageReturnButton } from '../Group/Forum/Mail-styles';
import { ReturnIcon } from '../../assets/Icons/ReturnIcon.tsx';
import { useTranslation } from 'react-i18next';
import SearchIcon from '@mui/icons-material/Search';
import IconClearInput from '../../assets/svgs/ClearInput.svg';
import { useAtom } from 'jotai';
import { appSortAtom } from '../../atoms/appsAtoms';
import { filterAndSortApps } from '../../atoms/appsAtoms';
import {
  SortDropdown,
  CategoryFilter,
  StatusFilter,
  StatusFilterOption,
} from './Filters';
import {
  AppsTabs,
  AppsLibraryTabValue,
  OfficialAppsTab,
  CommunityAppsTab,
  CategoriesTab,
  MyAppsTab,
  PrivateTab,
} from './AppsLibrary';
import { AppCardEnhanced } from './AppCard';

const SearchContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  backgroundColor: theme.palette.background.paper,
  borderRadius: '8px',
  padding: '0 12px',
  height: '36px',
  width: '300px',
  minWidth: '200px',
}));

export const AppsLibraryDesktop = ({
  availableQapps,
  setMode,
  myName,
  myAddress,
  isShow,
  categories,
  getQapps,
  externalSearchRequest,
  contentHeight,
}) => {
  const [currentTab, setCurrentTab] = useState<AppsLibraryTabValue>('official');
  const [searchValue, setSearchValue] = useState('');
  const [debouncedSearchValue, setDebouncedSearchValue] = useState('');
  const [sortOption, setSortOption] = useAtom(appSortAtom);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilterOption>('all');
  const theme = useTheme();
  const isSearchActive = searchValue.trim().length > 0;
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchValue(searchValue);
    }, 350);
    return () => clearTimeout(handler);
  }, [searchValue]);

  useEffect(() => {
    setSearchValue(externalSearchRequest?.query || '');
    setDebouncedSearchValue(externalSearchRequest?.query || '');
  }, [externalSearchRequest?.nonce]);

  const handleTabChange = (tab: AppsLibraryTabValue) => {
    setCurrentTab(tab);
  };

  const renderTabContent = () => {
    if (debouncedSearchValue.trim()) {
      const combinedResults = filterAndSortApps(availableQapps, {
        sort: sortOption,
        category: 'all',
        status: 'all',
        search: debouncedSearchValue,
      });
      console.log('combinedResults', combinedResults);
      return (
        <AppsWidthLimiter>
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              justifyContent: 'space-between',
              width: '100%',
            }}
          >
            <Box
              sx={{
                color: theme.palette.text.primary,
                fontSize: '20px',
                fontWeight: 600,
              }}
            >
              {t('core:action.search_apps', {
                postProcess: 'capitalizeFirstChar',
              })}{' '}
              ({combinedResults.length})
            </Box>
          </Box>

          <Box
            sx={{
              display: 'grid',
              gap: '16px',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              width: '100%',
            }}
          >
            {combinedResults.map((app) => (
              <AppCardEnhanced
                key={`${app?.service}-${app?.name}`}
                app={app}
                myName={myName}
              />
            ))}
          </Box>
        </AppsWidthLimiter>
      );
    }

    switch (currentTab) {
      case 'official':
        return (
          <OfficialAppsTab
            availableQapps={availableQapps}
            myName={myName}
            searchValue={debouncedSearchValue}
          />
        );
      case 'community':
        return (
          <CommunityAppsTab
            availableQapps={availableQapps}
            myName={myName}
            searchValue={debouncedSearchValue}
            sortValue={sortOption}
            categoryValue={categoryFilter}
            statusValue={statusFilter}
          />
        );
      case 'categories':
        return (
          <CategoriesTab
            categories={categories}
            availableQapps={availableQapps}
            myName={myName}
            searchValue={debouncedSearchValue}
          />
        );
      case 'my-apps':
        return (
          <MyAppsTab
            myName={myName}
            availableQapps={availableQapps}
            setMode={setMode}
            searchValue={debouncedSearchValue}
          />
        );
      case 'private':
        return <PrivateTab myName={myName} myAddress={myAddress} />;
      default:
        return (
          <OfficialAppsTab
            availableQapps={availableQapps}
            myName={myName}
            searchValue={debouncedSearchValue}
          />
        );
    }
  };

  return (
    <AppsLibraryContainer
      sx={{
        display: !isShow && 'none',
        padding: '0px',
        height: contentHeight || '100%',
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
            sx={{ padding: '2px' }}
            onClick={() => {
              executeEvent('navigateBack', {});
            }}
          >
            <ReturnIcon />
            <ComposeP sx={{ fontSize: '18px' }}>
              {t('core:action.return_apps_dashboard', {
                postProcess: 'capitalizeFirstChar',
              })}
            </ComposeP>
          </ShowMessageReturnButton>

          <Spacer height="20px" />

          {/* Tabs + Search/Filter — single column, shared center axis */}
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              width: '100%',
            }}
          >
            <AppsTabs
              currentTab={currentTab}
              isSearchActive={isSearchActive}
              onTabChange={handleTabChange}
            />

            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '12px',
                justifyContent: 'center',
              }}
            >
              {currentTab !== 'private' && (
                <>
                  <SearchContainer>
                    <SearchIcon sx={{ color: theme.palette.text.secondary }} />
                    <InputBase
                      value={searchValue}
                      onChange={(e) => setSearchValue(e.target.value)}
                      sx={{ flex: 1, ml: 1, fontSize: '14px' }}
                      placeholder={t('core:action.search_apps', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    />
                    {searchValue && (
                      <ButtonBase onClick={() => setSearchValue('')}>
                        <img src={IconClearInput} alt="clear" />
                      </ButtonBase>
                    )}
                  </SearchContainer>

                  {getQapps && (
                    <Tooltip
                      title={t('core:action.refetch_apps_websites_list', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    >
                      <IconButton
                        onClick={() => getQapps()}
                        aria-label={t(
                          'core:action.refetch_apps_websites_list',
                          {
                            postProcess: 'capitalizeFirstChar',
                          }
                        )}
                        sx={{ color: theme.palette.text.secondary }}
                      >
                        <RefreshIcon />
                      </IconButton>
                    </Tooltip>
                  )}
                </>
              )}

              {currentTab === 'community' && (
                <>
                  <SortDropdown value={sortOption} onChange={setSortOption} />
                  <CategoryFilter
                    value={categoryFilter}
                    onChange={setCategoryFilter}
                    categories={categories}
                  />
                  <StatusFilter
                    value={statusFilter}
                    onChange={setStatusFilter}
                  />
                </>
              )}
            </Box>
          </Box>

          <Spacer height="20px" />
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
            alignItems: 'center',
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
          {renderTabContent()}
        </AppsDesktopLibraryBody>
      </AppsDesktopLibraryBody>
    </AppsLibraryContainer>
  );
};
