import { useRef, useState } from 'react';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Box, IconButton, Tooltip } from '@mui/material';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { appSortAtom } from '../../../atoms/appsAtoms';
import {
  AppsTabs,
  type AppsLibraryTabValue,
  CategoriesTab,
  CommunityAppsTab,
  MyAppsTab,
  OfficialAppsTab,
  PrivateTab,
} from '../AppsLibrary';
import {
  CategoryFilter,
  SortDropdown,
  StatusFilter,
  type StatusFilterOption,
} from '../Filters';

const LIBRARY_TABS: AppsLibraryTabValue[] = [
  'official',
  'community',
  'categories',
  'my-apps',
  'private',
];

interface LauncherLibraryProps {
  availableQapps: any[];
  categories: any[];
  currentTab: AppsLibraryTabValue;
  onTabChange: (tab: AppsLibraryTabValue) => void;
  /** Reloads the list of apps and websites from the node. */
  getQapps?: () => void | Promise<void>;
  myName: string;
  myAddress: string;
  setMode: (mode: string) => void;
  scrollElement: HTMLElement | null;
  /** How far from the top of the scroller the tab bar stays in view. */
  stickyTop: number;
  /** False while the library is hidden (searching, or another page shows). */
  isActive: boolean;
}

/**
 * The library below the pinned apps. A tab is created the first time it is
 * opened and then stays mounted, so going back to it finds it as it was left.
 */
export const LauncherLibrary = ({
  availableQapps,
  categories,
  currentTab,
  onTabChange,
  getQapps,
  myName,
  myAddress,
  setMode,
  scrollElement,
  stickyTop,
  isActive,
}: LauncherLibraryProps) => {
  const { t } = useTranslation(['core']);
  const [sortOption, setSortOption] = useAtom(appSortAtom);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilterOption>('all');
  const openedTabsRef = useRef(new Set<AppsLibraryTabValue>());
  openedTabsRef.current.add(currentTab);

  const refreshLabel = t('core:action.refetch_apps_websites_list', {
    postProcess: 'capitalizeFirstChar',
  });

  const renderTab = (tab: AppsLibraryTabValue) => {
    switch (tab) {
      case 'community':
        return (
          <CommunityAppsTab
            availableQapps={availableQapps}
            categoryValue={categoryFilter}
            isActive={isActive && currentTab === 'community'}
            myName={myName}
            scrollParent={scrollElement}
            searchValue=""
            sortValue={sortOption}
            statusValue={statusFilter}
          />
        );
      case 'categories':
        return (
          <CategoriesTab
            availableQapps={availableQapps}
            categories={categories}
            myName={myName}
          />
        );
      case 'my-apps':
        return (
          <MyAppsTab
            availableQapps={availableQapps}
            myName={myName}
            setMode={setMode}
          />
        );
      case 'private':
        return <PrivateTab myAddress={myAddress} myName={myName} />;
      default:
        return (
          <OfficialAppsTab availableQapps={availableQapps} myName={myName} />
        );
    }
  };

  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
      }}
    >
      <Box
        sx={(theme) => ({
          alignItems: 'center',
          backgroundColor: theme.palette.background.default,
          display: 'flex',
          flexDirection: 'column',
          position: 'sticky',
          top: stickyTop,
          width: '100%',
          zIndex: 2,
        })}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'center',
            position: 'relative',
            width: '100%',
          }}
        >
          <AppsTabs currentTab={currentTab} onTabChange={onTabChange} />
          {getQapps ? (
            <Tooltip title={refreshLabel}>
              <IconButton
                aria-label={refreshLabel}
                onClick={() => getQapps()}
                sx={(theme) => ({
                  color: theme.palette.text.secondary,
                  position: 'absolute',
                  right: 0,
                  top: '50%',
                  transform: 'translateY(-50%)',
                })}
              >
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          ) : null}
        </Box>

        {currentTab === 'community' ? (
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '12px',
              justifyContent: 'center',
              paddingBottom: '16px',
            }}
          >
            <SortDropdown onChange={setSortOption} value={sortOption} />
            <CategoryFilter
              categories={categories}
              onChange={setCategoryFilter}
              value={categoryFilter}
            />
            <StatusFilter onChange={setStatusFilter} value={statusFilter} />
          </Box>
        ) : null}
      </Box>

      {LIBRARY_TABS.map((tab) =>
        openedTabsRef.current.has(tab) ? (
          <Box
            aria-hidden={tab !== currentTab}
            key={tab}
            role="tabpanel"
            sx={{
              alignItems: 'center',
              display: tab === currentTab ? 'flex' : 'none',
              flexDirection: 'column',
              paddingBottom: '32px',
              width: '100%',
            }}
          >
            {renderTab(tab)}
          </Box>
        ) : null
      )}
    </Box>
  );
};
