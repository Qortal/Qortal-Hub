import { useMemo, useState } from 'react';
import { Box } from '@mui/material';
import { useAtomValue } from 'jotai';
import CategoryRoundedIcon from '@mui/icons-material/CategoryRounded';
import SearchOffRoundedIcon from '@mui/icons-material/SearchOffRounded';
import { useTranslation } from 'react-i18next';
import { AppsWidthLimiter } from '../Apps-styles';
import { executeEvent } from '../../../utils/events';
import { CategoryCard } from '../Categories/CategoryCard';
import {
  categoryMatches,
  countCategories,
  sortCategoriesByName,
} from '../Filters/categoryCounts';
import { LibraryFilterField } from '../Filters/LibraryFilterField';
import {
  CATEGORY_GAP,
  CATEGORY_LIST_GAP,
  CATEGORY_ROW_MIN_WIDTH,
  CATEGORY_SKELETON,
  CATEGORY_TILE_MIN_WIDTH,
  fittedColumnsTemplate,
  LIST_MAX_COLUMNS,
} from './libraryLayout';
import {
  LibraryEmptyState,
  LibraryResultsStatus,
  LibrarySection,
  LibraryWaiting,
} from './LibrarySection';
import { cap, formatLibraryNumber, libraryFadeInSx } from './libraryStyles';
import { libraryViewAtom } from './libraryView';
import type { LibraryStatus } from './useLibraryStatus';

interface Category {
  id: string;
  name: string;
}

interface CategoriesTabProps {
  categories: Category[];
  availableQapps: any[];
  myName?: string;
  /** No longer used: the launcher's own search covers the library. */
  searchValue?: string;
  libraryStatus?: LibraryStatus;
}

/** What the "All categories" tile sends; it is data, never shown. */
const ALL_CATEGORY: Category = { id: 'all', name: 'All' };

/** The filter speaks its result once the typing stops. */
const STATUS_DELAY_MS = 400;

export const CategoriesTab = ({
  categories,
  availableQapps,
  libraryStatus = 'loading',
}: CategoriesTabProps) => {
  const { t, i18n } = useTranslation(['core']);
  const view = useAtomValue(libraryViewAtom);
  const [query, setQuery] = useState('');
  const allLabel = t('core:launcher.library.all_categories', cap);

  // Over all apps: a category's page lists official apps too.
  const counts = useMemo(
    () => countCategories(availableQapps),
    [availableQapps]
  );

  // Empty categories are left out; the rest go A to Z.
  const shownCategories = useMemo(
    () =>
      sortCategoriesByName(
        (categories ?? []).filter(
          (category) => (counts.byId.get(category.id) ?? 0) > 0
        ),
        i18n?.language
      ),
    [categories, counts, i18n?.language]
  );

  const matchingCategories = useMemo(
    () =>
      shownCategories.filter((category) => categoryMatches(category, query)),
    [query, shownCategories]
  );
  const showsAll = categoryMatches({ id: 'all', name: allLabel }, query);

  const handleCategoryClick = (category: Category) => {
    executeEvent('selectedCategory', {
      data: category,
    });
  };

  // Only the apps are waited for. Without the node's categories (its one
  // request at start failed), "All categories" still leads to every app.
  const isWaiting = availableQapps.length === 0;
  const hasCategories = shownCategories.length > 0;
  const isList = view === 'list';
  const title = t('core:tabs.categories', cap);
  const hasMatches = showsAll || matchingCategories.length > 0;
  const locale = i18n?.language;
  const trimmedQuery = query.trim();
  const resultsMessage = !trimmedQuery
    ? ''
    : hasMatches
      ? t('core:launcher.library.status_categories_shown', {
          postProcess: 'capitalizeFirstChar',
          shown: formatLibraryNumber(matchingCategories.length, locale),
          total: formatLibraryNumber(shownCategories.length, locale),
        })
      : t('core:launcher.library.no_category_matches', {
          postProcess: 'capitalizeFirstChar',
          query: trimmedQuery,
        });

  return (
    <AppsWidthLimiter sx={{ alignItems: 'stretch', gap: '16px' }}>
      <LibrarySection
        action={
          isWaiting || !hasCategories ? null : (
            <LibraryFilterField
              label={t('core:launcher.library.filter_categories', cap)}
              onChange={setQuery}
              sx={{ width: { xs: '100%', sm: 240 } }}
              value={query}
            />
          )
        }
        count={isWaiting || !hasCategories ? undefined : shownCategories.length}
        hint={t('core:launcher.library.categories_hint', cap)}
        icon={<CategoryRoundedIcon />}
        title={title}
      >
        {isWaiting ? (
          <LibraryWaiting
            {...CATEGORY_SKELETON}
            count={12}
            status={libraryStatus}
            view={view}
          />
        ) : hasMatches ? (
          <Box
            aria-label={title}
            key={view}
            role="list"
            sx={{
              containerName: 'library',
              containerType: 'inline-size',
              display: 'grid',
              gap: `${isList ? CATEGORY_LIST_GAP : CATEGORY_GAP}px`,
              gridTemplateColumns: isList
                ? fittedColumnsTemplate(
                    CATEGORY_ROW_MIN_WIDTH,
                    CATEGORY_LIST_GAP,
                    LIST_MAX_COLUMNS
                  )
                : fittedColumnsTemplate(CATEGORY_TILE_MIN_WIDTH, CATEGORY_GAP),
              width: '100%',
              ...libraryFadeInSx(),
            }}
          >
            {showsAll ? (
              <Box role="listitem" sx={{ minWidth: 0 }}>
                <CategoryCard
                  appCount={counts.total}
                  category={ALL_CATEGORY}
                  onClick={handleCategoryClick}
                  view={view}
                />
              </Box>
            ) : null}
            {matchingCategories.map((category) => (
              <Box key={category.id} role="listitem" sx={{ minWidth: 0 }}>
                <CategoryCard
                  appCount={counts.byId.get(category.id) ?? 0}
                  category={category}
                  onClick={handleCategoryClick}
                  view={view}
                />
              </Box>
            ))}
          </Box>
        ) : (
          <LibraryEmptyState
            compact
            icon={<SearchOffRoundedIcon />}
            title={t('core:launcher.library.no_category_matches', {
              postProcess: 'capitalizeFirstChar',
              query: trimmedQuery,
            })}
          />
        )}
        {isWaiting ? null : (
          <LibraryResultsStatus
            delay={STATUS_DELAY_MS}
            message={resultsMessage}
          />
        )}
      </LibrarySection>
    </AppsWidthLimiter>
  );
};
