import { useState, useEffect } from 'react';
import {
  AppsDesktopLibraryBody,
  AppsDesktopLibraryHeader,
  AppsLibraryContainer,
  AppsWidthLimiter,
} from './Apps-styles';
import { Box, ButtonBase, InputBase, styled, useTheme } from '@mui/material';
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
} from './AppsLibrary';

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
  isShow,
  categories,
}) => {
  const [currentTab, setCurrentTab] = useState<AppsLibraryTabValue>('official');
  const [searchValue, setSearchValue] = useState('');
  const [debouncedSearchValue, setDebouncedSearchValue] = useState('');
  const [sortOption, setSortOption] = useAtom(appSortAtom);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilterOption>('all');
  const theme = useTheme();
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

  const handleTabChange = (tab: AppsLibraryTabValue) => {
    setCurrentTab(tab);
  };

  const renderTabContent = () => {
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
        height: '100vh',
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
            <AppsTabs currentTab={currentTab} onTabChange={handleTabChange} />

            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '12px',
                justifyContent: 'center',
              }}
            >
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

              {currentTab === 'community' && (
                <>
                  <SortDropdown value={sortOption} onChange={setSortOption} />
                  <CategoryFilter
                    value={categoryFilter}
                    onChange={setCategoryFilter}
                    categories={categories}
                  />
                  <StatusFilter value={statusFilter} onChange={setStatusFilter} />
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
