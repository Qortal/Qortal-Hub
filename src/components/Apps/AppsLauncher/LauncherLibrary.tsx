import {
  type CSSProperties,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import FilterAltOffRoundedIcon from '@mui/icons-material/FilterAltOffRounded';
import { Box, Button } from '@mui/material';
import { alpha } from '@mui/material/styles';
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
  WidgetsTab,
} from '../AppsLibrary';
import { communityAppsOf } from '../AppsLibrary/libraryApps';
import { LibraryRefreshButton } from '../AppsLibrary/LibraryRefreshButton';
import {
  cap,
  isDark,
  libraryAccent,
  libraryFadeInSx,
  libraryFocusRing,
  libraryHairline,
  REDUCED_MOTION,
} from '../AppsLibrary/libraryStyles';
import { LibraryViewToggle } from '../AppsLibrary/LibraryViewToggle';
import { useLibraryStatus } from '../AppsLibrary/useLibraryStatus';
import { countCategories } from '../Filters/categoryCounts';
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
  'widgets',
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
  const tabIdPrefix = useId();
  // Bumped by the refresh button: My apps and Private load their own lists.
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);
  const [settledRefreshes, setSettledRefreshes] = useState(0);
  const barRef = useRef<HTMLDivElement | null>(null);
  const categoryPillRef = useRef<HTMLButtonElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [barHeight, setBarHeight] = useState(0);
  const [isStuck, setIsStuck] = useState(false);

  const refreshLabel = t('core:action.refetch_apps_websites_list', {
    postProcess: 'capitalizeFirstChar',
  });

  const handleRefresh = useCallback(async () => {
    setLibraryRefreshKey((key) => key + 1);
    await Promise.resolve(getQapps?.());
    setSettledRefreshes((count) => count + 1);
  }, [getQapps]);

  const libraryStatus = useLibraryStatus(
    availableQapps?.length ?? 0,
    settledRefreshes
  );
  const communityApps = useMemo(
    () => communityAppsOf(availableQapps),
    [availableQapps]
  );
  const communityCounts = useMemo(
    () =>
      currentTab === 'community'
        ? countCategories(communityApps, statusFilter)
        : null,
    [communityApps, currentTab, statusFilter]
  );
  // The sort stays: it is a preference, not a filter. Both Clear filters
  // buttons go away once nothing is filtered, so focus moves to the Category
  // pill instead of falling back to the top of the page.
  const clearFilters = useCallback(() => {
    setCategoryFilter('all');
    setStatusFilter('all');
    categoryPillRef.current?.focus();
  }, []);
  const isFiltered = categoryFilter !== 'all' || statusFilter !== 'all';

  // The panels' rows scroll into view below the bar, not under it.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const measure = () => setBarHeight(bar.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  // A soft shadow under the bar once content scrolls beneath it.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !scrollElement) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) =>
        setIsStuck(
          !entry.isIntersecting &&
            (!entry.rootBounds ||
              entry.boundingClientRect.top < entry.rootBounds.top)
        ),
      { root: scrollElement, rootMargin: `-${stickyTop + 1}px 0px 0px 0px` }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [scrollElement, stickyTop]);

  const renderTab = (tab: AppsLibraryTabValue) => {
    switch (tab) {
      case 'community':
        return (
          <CommunityAppsTab
            availableQapps={availableQapps}
            categoryValue={categoryFilter}
            isActive={isActive && currentTab === 'community'}
            libraryStatus={libraryStatus}
            myName={myName}
            onClearFilters={clearFilters}
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
            libraryStatus={libraryStatus}
            myName={myName}
          />
        );
      case 'widgets':
        return (
          <WidgetsTab
            isActive={isActive && currentTab === 'widgets'}
            libraryRefreshKey={libraryRefreshKey}
            scrollParent={scrollElement}
            sortValue={sortOption}
          />
        );
      case 'my-apps':
        return (
          <MyAppsTab
            availableQapps={availableQapps}
            libraryRefreshKey={libraryRefreshKey}
            myName={myName}
            setMode={setMode}
          />
        );
      case 'private':
        return (
          <PrivateTab
            libraryRefreshKey={libraryRefreshKey}
            myAddress={myAddress}
            myName={myName}
          />
        );
      default:
        return (
          <OfficialAppsTab
            availableQapps={availableQapps}
            libraryStatus={libraryStatus}
            myName={myName}
          />
        );
    }
  };

  return (
    <Box
      style={
        {
          '--library-sticky-offset': `${stickyTop + barHeight}px`,
        } as CSSProperties
      }
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
      }}
    >
      <Box
        aria-hidden
        ref={sentinelRef}
        sx={{ height: '1px', mb: '-1px', width: '100%' }}
      />
      <Box
        ref={barRef}
        sx={(theme) => ({
          alignItems: 'center',
          backgroundColor: theme.palette.background.default,
          borderBottom: `1px solid ${
            isStuck ? libraryHairline(theme, 0.08) : 'transparent'
          }`,
          boxShadow: isStuck
            ? `0 12px 18px -16px ${alpha(theme.palette.common.black, isDark(theme) ? 0.7 : 0.25)}`
            : 'none',
          containerName: 'library-bar',
          containerType: 'inline-size',
          display: 'flex',
          flexDirection: 'column',
          position: 'sticky',
          top: stickyTop,
          transition: 'box-shadow 160ms, border-color 160ms',
          width: '100%',
          zIndex: 2,
          [REDUCED_MOTION]: { transition: 'none' },
        })}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: '12px',
            minWidth: 0,
            py: 1.25,
            width: '90%',
          }}
        >
          <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
            <AppsTabs
              currentTab={currentTab}
              idPrefix={tabIdPrefix}
              onTabChange={onTabChange}
            />
          </Box>
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexShrink: 0,
              gap: 1,
            }}
          >
            <LibraryViewToggle />
            {getQapps ? (
              <>
                <Box
                  aria-hidden
                  sx={(theme) => ({
                    backgroundColor: libraryHairline(theme, 0.12),
                    height: 20,
                    width: '1px',
                  })}
                />
                <LibraryRefreshButton
                  label={refreshLabel}
                  onRefresh={handleRefresh}
                />
              </>
            ) : null}
          </Box>
        </Box>

        {currentTab === 'community' || currentTab === 'widgets' ? (
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1,
              minWidth: 0,
              pb: 1.25,
              width: '90%',
            }}
          >
            <SortDropdown onChange={setSortOption} value={sortOption} />
            {/* Widgets are few: they sort, but have no filters yet. */}
            {currentTab === 'community' ? (
              <>
                <CategoryFilter
                  buttonRef={categoryPillRef}
                  categories={categories}
                  counts={communityCounts}
                  onChange={setCategoryFilter}
                  value={categoryFilter}
                />
                <StatusFilter onChange={setStatusFilter} value={statusFilter} />
                {isFiltered ? (
                  <Button
                    disableRipple
                    onClick={clearFilters}
                    startIcon={<FilterAltOffRoundedIcon />}
                    sx={(theme) => ({
                      borderRadius: '12px',
                      color: libraryAccent(theme),
                      fontSize: '13.5px',
                      fontWeight: 600,
                      height: 34,
                      px: 1.25,
                      textTransform: 'none',
                      '& .MuiButton-startIcon .MuiSvgIcon-root': {
                        fontSize: 16,
                      },
                      '&:hover': {
                        backgroundColor: alpha(
                          theme.palette.primary.main,
                          0.08
                        ),
                      },
                      '&.Mui-focusVisible': libraryFocusRing(theme, 2),
                    })}
                  >
                    {t('core:launcher.library.clear_filters', cap)}
                  </Button>
                ) : null}
              </>
            ) : null}
          </Box>
        ) : null}
      </Box>

      {LIBRARY_TABS.map((tab) =>
        openedTabsRef.current.has(tab) ? (
          <Box
            aria-hidden={tab !== currentTab}
            aria-labelledby={`${tabIdPrefix}-tab-${tab}`}
            id={`${tabIdPrefix}-panel-${tab}`}
            key={tab}
            role="tabpanel"
            sx={{
              alignItems: 'center',
              display: tab === currentTab ? 'flex' : 'none',
              flexDirection: 'column',
              paddingBottom: '32px',
              width: '100%',
              ...(tab === currentTab ? libraryFadeInSx() : {}),
            }}
          >
            {renderTab(tab)}
          </Box>
        ) : null
      )}
    </Box>
  );
};
