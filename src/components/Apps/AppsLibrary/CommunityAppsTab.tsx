import { useCallback, useMemo } from 'react';
import { atom, useAtomValue } from 'jotai';
import { Box, Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { AppsWidthLimiter } from '../Apps-styles';
import { AppCardEnhanced } from '../AppCard';
import { SortOption, StatusFilterOption } from '../Filters';
import { officialAppList } from '../config/officialApps';
import { filterAndSortApps } from '../../../atoms/appsAtoms';
import { ratingsStoreAtom } from '../../../hooks/useAppRatings';
import type { AppRatingData } from '../../../types/ratings';
import { VirtualAppGrid } from './VirtualAppGrid';

const CARD_MIN_WIDTH = 320;
const GRID_GAP = 16;
const CARD_HEIGHT = 220;
const EMPTY_RATINGS_MAP = new Map<string, AppRatingData>();

interface CommunityAppsTabProps {
  availableQapps: any[];
  myName: string;
  searchValue: string;
  sortValue: SortOption;
  categoryValue: string;
  statusValue: StatusFilterOption;
  scrollParent?: HTMLElement | null;
  /** False while the tab is hidden but kept mounted. */
  isActive?: boolean;
}

const getAppKey = (app: any) => `${app?.service}-${app?.name}`;

export const CommunityAppsTab = ({
  availableQapps,
  myName,
  searchValue,
  sortValue,
  categoryValue,
  statusValue,
  scrollParent,
  isActive = true,
}: CommunityAppsTabProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const isRatingSort =
    sortValue === 'highest_rated' || sortValue === 'most_rated';
  const ratingsForSortAtom = useMemo(
    () =>
      atom((get) =>
        isRatingSort ? get(ratingsStoreAtom) : EMPTY_RATINGS_MAP
      ),
    [isRatingSort]
  );
  const ratingsStore = useAtomValue(ratingsForSortAtom);

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

  const renderApp = useCallback(
    (app: any) => <AppCardEnhanced app={app} myName={myName} />,
    [myName]
  );

  return (
    <AppsWidthLimiter sx={{ flex: 1, minHeight: 0 }}>
      {filteredAndSortedApps.length > 0 ? (
        <Box sx={{ width: '100%', paddingBottom: '20px' }}>
          <VirtualAppGrid
            active={isActive}
            gap={GRID_GAP}
            getKey={getAppKey}
            items={filteredAndSortedApps}
            minColumnWidth={CARD_MIN_WIDTH}
            renderItem={renderApp}
            rowHeight={CARD_HEIGHT}
            scrollElement={scrollParent ?? null}
          />
        </Box>
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
