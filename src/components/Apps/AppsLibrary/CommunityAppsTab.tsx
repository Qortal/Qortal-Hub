import { useMemo, forwardRef } from 'react';
import { useAtomValue } from 'jotai';
import { Box, Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { VirtuosoGrid, GridComponents } from 'react-virtuoso';
import { AppsWidthLimiter } from '../Apps-styles';
import { AppCardEnhanced } from '../AppCard';
import { SortOption, StatusFilterOption } from '../Filters';
import { officialAppList } from '../config/officialApps';
import { filterAndSortApps } from '../../../atoms/appsAtoms';
import { ratingsStoreAtom } from '../../../hooks/useAppRatings';

const CARD_MIN_WIDTH = 320;
const GRID_GAP = 16;

interface CommunityAppsTabProps {
  availableQapps: any[];
  myName: string;
  searchValue: string;
  sortValue: SortOption;
  categoryValue: string;
  statusValue: StatusFilterOption;
}

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  )) as any,
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
  searchValue,
  sortValue,
  categoryValue,
  statusValue,
}: CommunityAppsTabProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const ratingsStore = useAtomValue(ratingsStoreAtom);

  // Filter out official apps to show only community apps
  const communityApps = useMemo(() => {
    return availableQapps.filter(
      (app) => !officialAppList.includes(app?.name?.toLowerCase())
    );
  }, [availableQapps]);

  // Apply all filters and sorting (ratings-aware)
  const filteredAndSortedApps = useMemo(() => {
    return filterAndSortApps(communityApps, {
      sort: sortValue,
      category: categoryValue,
      status: statusValue,
      search: searchValue,
      ratingsMap: ratingsStore,
    });
  }, [communityApps, searchValue, categoryValue, statusValue, sortValue, ratingsStore]);

  return (
    <AppsWidthLimiter sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {filteredAndSortedApps.length > 0 ? (
        <VirtuosoGrid
          style={{
            flex: 1,
            minHeight: 0,
            width: '100%',
            msOverflowStyle: 'none',
            overflow: 'auto',
            scrollbarWidth: 'auto',
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
          overscan={20}
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
