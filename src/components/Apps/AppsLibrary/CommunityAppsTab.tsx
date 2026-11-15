import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { Button } from '@mui/material';
import FilterAltOffRoundedIcon from '@mui/icons-material/FilterAltOffRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import { useTranslation } from 'react-i18next';
import { AppsWidthLimiter } from '../Apps-styles';
import { SortOption, StatusFilterOption } from '../Filters';
import { filterAndSortApps } from '../../../atoms/appsAtoms';
import { AppCollection } from './AppCollection';
import { communityAppsOf } from './libraryApps';
import { APP_SKELETON } from './libraryLayout';
import {
  LibraryEmptyState,
  LibraryResultsStatus,
  LibrarySection,
  LibraryWaiting,
} from './LibrarySection';
import {
  cap,
  formatLibraryNumber,
  libraryAccent,
  libraryFocusRing,
} from './libraryStyles';
import { libraryViewAtom } from './libraryView';
import type { LibraryStatus } from './useLibraryStatus';
import { useRatingsForSort } from './useRatingsForSort';

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
  /** Sets the category and status back to all. */
  onClearFilters?: () => void;
  libraryStatus?: LibraryStatus;
}

export const CommunityAppsTab = ({
  availableQapps,
  myName,
  searchValue,
  sortValue,
  categoryValue,
  statusValue,
  scrollParent,
  isActive = true,
  onClearFilters,
  libraryStatus = 'loading',
}: CommunityAppsTabProps) => {
  const { t, i18n } = useTranslation(['core']);
  const view = useAtomValue(libraryViewAtom);
  const ratingsStore = useRatingsForSort(sortValue);

  // Everything that is not an official Q-App.
  const communityApps = useMemo(
    () => communityAppsOf(availableQapps),
    [availableQapps]
  );

  // Apply all filters and sorting (ratings-aware)
  const filteredAndSortedApps = useMemo(() => {
    return filterAndSortApps(communityApps, {
      sort: sortValue,
      category: categoryValue,
      status: statusValue,
      search: searchValue,
      ratingsMap: ratingsStore,
    });
  }, [
    communityApps,
    searchValue,
    categoryValue,
    statusValue,
    sortValue,
    ratingsStore,
  ]);

  const title = t('core:tabs.community_apps', cap);
  const total = communityApps.length;
  const shown = filteredAndSortedApps.length;
  const isFiltered =
    (categoryValue && categoryValue !== 'all') || statusValue !== 'all';
  const locale = i18n?.language;
  // Waiting is for the node's list. Once it has come, a list without any
  // community app is a result too, not a load that never ends.
  const isWaiting = (availableQapps?.length ?? 0) === 0;
  const resultsMessage = !isFiltered
    ? ''
    : shown === 0
      ? t('core:launcher.library.no_filter_matches', cap)
      : t('core:launcher.library.status_apps_shown', {
          postProcess: 'capitalizeFirstChar',
          shown: formatLibraryNumber(shown, locale),
          total: formatLibraryNumber(total, locale),
        });

  return (
    <AppsWidthLimiter sx={{ alignItems: 'stretch', flex: 1, gap: '16px' }}>
      <LibrarySection
        count={
          total === 0
            ? undefined
            : isFiltered
              ? t('core:launcher.library.count_filtered', {
                  shown: formatLibraryNumber(shown, locale),
                  total: formatLibraryNumber(total, locale),
                })
              : total
        }
        hint={t('core:launcher.library.community_hint', cap)}
        icon={<PublicRoundedIcon />}
        title={title}
      >
        {isWaiting ? (
          <LibraryWaiting
            {...APP_SKELETON}
            count={8}
            status={libraryStatus}
            view={view}
          />
        ) : shown === 0 ? (
          <LibraryEmptyState
            action={
              onClearFilters && isFiltered ? (
                <Button
                  disableRipple
                  onClick={onClearFilters}
                  startIcon={<FilterAltOffRoundedIcon />}
                  sx={(theme) => ({
                    borderRadius: '12px',
                    color: libraryAccent(theme),
                    fontWeight: 600,
                    textTransform: 'none',
                    '&.Mui-focusVisible': libraryFocusRing(theme, 2),
                  })}
                  variant="text"
                >
                  {t('core:launcher.library.clear_filters', cap)}
                </Button>
              ) : null
            }
            icon={<FilterAltOffRoundedIcon />}
            title={
              isFiltered
                ? t('core:launcher.library.no_filter_matches', cap)
                : t('core:message.generic.no_results', cap)
            }
          />
        ) : (
          <AppCollection
            active={isActive}
            apps={filteredAndSortedApps}
            label={title}
            myName={myName}
            scrollElement={scrollParent ?? null}
          />
        )}
        {isWaiting ? null : <LibraryResultsStatus message={resultsMessage} />}
      </LibrarySection>
    </AppsWidthLimiter>
  );
};
