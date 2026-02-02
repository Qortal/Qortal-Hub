import { useEffect, useMemo, useState } from 'react';
import { Box, Typography, styled, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { VirtuosoGrid } from 'react-virtuoso';
import { useAtom } from 'jotai';
import { AppsWidthLimiter } from '../Apps-styles';
import { AppCardEnhanced } from '../AppCard';
import { FilterBar, SortOption, StatusFilterOption } from '../Filters';
import { officialAppList } from '../config/officialApps';
import { appSortAtom } from '../../../atoms/appsAtoms';

const GridContainer = styled('div')({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
  gap: '16px',
  width: '100%',
  paddingBottom: '20px',
});

const GridItemWrapper = styled('div')({
  display: 'flex',
});

const StyledVirtuosoContainer = styled('div')({
  position: 'relative',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  '::-webkit-scrollbar': {
    width: '0px',
    height: '0px',
  },
  scrollbarWidth: 'none',
  msOverflowStyle: 'none',
});

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
    <AppsWidthLimiter>
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

      {/* Results Count */}
      <Box sx={{ marginBottom: '16px' }}>
        <Typography
          sx={{
            fontSize: '14px',
            color: theme.palette.text.secondary,
          }}
        >
          {t('core:filter.showing_apps', {
            count: filteredAndSortedApps.length,
            postProcess: 'capitalizeFirstChar',
            defaultValue: 'Showing {{count}} apps',
          })}
        </Typography>
      </Box>

      {/* Apps Grid */}
      {filteredAndSortedApps.length > 0 ? (
        <StyledVirtuosoContainer
          sx={{
            height: 'calc(100vh - 380px)',
          }}
        >
          <VirtuosoGrid
            totalCount={filteredAndSortedApps.length}
            components={{
              List: GridContainer as any,
              Item: GridItemWrapper,
            }}
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
          />
        </StyledVirtuosoContainer>
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
