import { useEffect, useMemo, useState, forwardRef, ComponentType } from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAtom } from 'jotai';
import { VirtuosoGrid, GridComponents } from 'react-virtuoso';
import { AppsWidthLimiter } from '../Apps-styles';
import { AppCardEnhanced } from '../AppCard';
import { FilterBar, SortOption, StatusFilterOption } from '../Filters';
import { officialAppList } from '../config/officialApps';
import { appSortAtom } from '../../../atoms/appsAtoms';

const CARD_MIN_WIDTH = 320;
const GRID_GAP = 16;

interface CommunityAppsTabProps {
  availableQapps: any[];
  myName: string;
  categories?: Array<{ id: string; name: string }>;
}

// Sorting functions
const sortApps = (apps: any[], sortOption: SortOption): any[] => {
  const sorted = [...apps];

  switch (sortOption) {
    case 'newest':
      return sorted.sort((a, b) => (b.created || 0) - (a.created || 0));
    case 'oldest':
      return sorted.sort((a, b) => (a.created || 0) - (b.created || 0));
    case 'alphabetical':
      return sorted.sort((a, b) => {
        const titleA = (a.metadata?.title || a.name || '').toLowerCase();
        const titleB = (b.metadata?.title || b.name || '').toLowerCase();
        return titleA.localeCompare(titleB);
      });
    default:
      return sorted;
  }
};

// Virtuoso grid components
const gridComponents: GridComponents = {
  List: forwardRef(({ style, children, ...props }, ref) => (
    <Box
      ref={ref}
      {...props}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_MIN_WIDTH}px, 1fr))`,
        gap: `${GRID_GAP}px`,
        width: '100%',
        paddingBottom: '20px',
        ...style,
      }}
    >
      {children}
    </Box>
  )) as ComponentType,
  Item: ({ children, ...props }) => (
    <Box
      {...props}
      style={{
        width: '100%',
      }}
    >
      {children}
    </Box>
  ),
};

export const CommunityAppsTab = ({
  availableQapps,
  myName,
  categories = [],
}: CommunityAppsTabProps) => {
  const [searchValue, setSearchValue] = useState('');
  const [debouncedValue, setDebouncedValue] = useState('');
  const [sortOption, setSortOption] = useAtom(appSortAtom);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilterOption>('all');
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  // Filter out official apps to show only community apps
  const communityApps = useMemo(() => {
    return availableQapps.filter(
      (app) => !officialAppList.includes(app?.name?.toLowerCase())
    );
  }, [availableQapps]);

  // Debounce search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(searchValue);
    }, 350);
    return () => {
      clearTimeout(handler);
    };
  }, [searchValue]);

  // Apply all filters and sorting
  const filteredAndSortedApps = useMemo(() => {
    let result = [...communityApps];

    // Apply search filter
    if (debouncedValue) {
      const searchLower = debouncedValue.toLowerCase();
      result = result.filter(
        (app) =>
          app.name.toLowerCase().includes(searchLower) ||
          (app?.metadata?.title &&
            app.metadata.title.toLowerCase().includes(searchLower)) ||
          (app?.metadata?.description &&
            app.metadata.description.toLowerCase().includes(searchLower))
      );
    }

    // Apply category filter
    if (categoryFilter !== 'all') {
      result = result.filter(
        (app) => app?.metadata?.category === categoryFilter
      );
    }

    // Apply status filter
    if (statusFilter === 'installed') {
      result = result.filter((app) => app?.status?.status === 'READY');
    } else if (statusFilter === 'not_installed') {
      result = result.filter((app) => app?.status?.status !== 'READY');
    }

    // Apply sorting
    result = sortApps(result, sortOption);

    return result;
  }, [communityApps, debouncedValue, categoryFilter, statusFilter, sortOption]);

  return (
    <AppsWidthLimiter sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Filter Bar */}
      <FilterBar
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        sortValue={sortOption}
        onSortChange={setSortOption}
        categoryValue={categoryFilter}
        onCategoryChange={setCategoryFilter}
        categories={categories}
        statusValue={statusFilter}
        onStatusChange={setStatusFilter}
      />

      {/* Apps Grid with Virtualization */}
      {filteredAndSortedApps.length > 0 ? (
        <VirtuosoGrid
          style={{
            flex: 1,
            minHeight: 0,
            width: '100%',
            msOverflowStyle: 'none',
            overflow: 'auto',
            scrollbarWidth: 'none',
          }}
          totalCount={filteredAndSortedApps.length}
          components={gridComponents}
          itemContent={(index) => {
            const app = filteredAndSortedApps[index];
            return (
              <AppCardEnhanced
                key={`${app?.service}-${app?.name}`}
                app={app}
                myName={myName}
              />
            );
          }}
          overscan={200}
        />
      ) : (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            padding: '40px',
          }}
        >
          <Typography sx={{ color: theme.palette.text.secondary }}>
            {t('core:message.generic.no_results', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </Box>
      )}
    </AppsWidthLimiter>
  );
};
