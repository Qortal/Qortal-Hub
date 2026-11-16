import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Box, Button, Typography } from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import SearchOffRoundedIcon from '@mui/icons-material/SearchOffRounded';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { appSortAtom, filterAndSortApps } from '../../atoms/appsAtoms';
import { executeEvent } from '../../utils/events';
import { AppsLibraryContainer } from './Apps-styles';
import { AppCollection } from './AppsLibrary/AppCollection';
import {
  CountBadge,
  LibraryEmptyState,
  LibraryPanel,
  LibraryResultsStatus,
} from './AppsLibrary/LibrarySection';
import {
  accentTileSx,
  cap,
  formatLibraryNumber,
  libraryFocusRing,
  libraryMuted,
} from './AppsLibrary/libraryStyles';
import { LibraryViewToggle } from './AppsLibrary/LibraryViewToggle';
import { TopRatedAppsBanner } from './AppsLibrary/TopRatedAppsBanner';
import { useRatingsForSort } from './AppsLibrary/useRatingsForSort';
import { CategoryIcon } from './config/categoryIconComponents';
import { LibraryFilterField } from './Filters/LibraryFilterField';
import { SortDropdown } from './Filters/SortDropdown';
import { StatusFilter, type StatusFilterOption } from './Filters/StatusFilter';

const SEARCH_DEBOUNCE_MS = 350;

/** The Featured row lines up with the list below it. */
const FEATURED_SX = { mb: 2, width: '90%' };

interface AppsCategoryDesktopProps {
  availableQapps: any[];
  myName: string;
  category: { id: string; name: string } | null | undefined;
  isShow: boolean;
  contentHeight?: string;
}

/** Every app and website of one category (or of all of them). */
export const AppsCategoryDesktop = ({
  availableQapps,
  myName,
  category,
  isShow,
  contentHeight,
}: AppsCategoryDesktopProps) => {
  const [searchValue, setSearchValue] = useState('');
  const [debouncedValue, setDebouncedValue] = useState('');
  const [status, setStatus] = useState<StatusFilterOption>('all');
  const [sortOption, setSortOption] = useAtom(appSortAtom);
  const { t, i18n } = useTranslation(['core']);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const ratingsMap = useRatingsForSort(sortOption);

  useEffect(() => {
    if (!isShow) setSearchValue('');
  }, [isShow]);

  // Another category starts at the top, without the last search.
  useEffect(() => {
    setSearchValue('');
    setDebouncedValue('');
    if (scroller) scroller.scrollTop = 0;
    // The scroller is not a reason to start over.
  }, [category?.id]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(searchValue);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(handler);
    };
  }, [searchValue]);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const measure = () => setHeaderHeight(header.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const categoryList = useMemo(() => {
    if (category?.id === 'all') return availableQapps ?? [];
    return (availableQapps ?? []).filter(
      (app) => app?.metadata?.category === category?.id
    );
  }, [availableQapps, category]);

  const shown = useMemo(
    () =>
      filterAndSortApps(categoryList, {
        sort: sortOption,
        category: 'all',
        status,
        search: debouncedValue.trim(),
        ratingsMap,
      }),
    [categoryList, debouncedValue, ratingsMap, sortOption, status]
  );

  // The Featured row picks from the category's apps, official ones too, with
  // the status filter (A to Z, so apps rated alike keep that order).
  const appsForFeatured = useMemo(
    () =>
      filterAndSortApps(categoryList, {
        sort: 'alphabetical',
        category: 'all',
        status,
        search: '',
      }),
    [categoryList, status]
  );

  const title =
    category?.id === 'all'
      ? t('core:launcher.library.all_categories', cap)
      : (category?.name ?? '');
  const isSearching = !!debouncedValue.trim();
  const isFiltered = isSearching || status !== 'all';
  const locale = i18n?.language;
  // Spoken after the search's own pause, so not at every key.
  const resultsMessage = !isFiltered
    ? ''
    : shown.length === 0
      ? t('core:message.generic.no_results', cap)
      : t('core:launcher.library.status_apps_shown', {
          postProcess: 'capitalizeFirstChar',
          shown: formatLibraryNumber(shown.length, locale),
          total: formatLibraryNumber(categoryList.length, locale),
        });

  return (
    <AppsLibraryContainer
      sx={{
        display: isShow ? 'flex' : 'none',
        height: contentHeight || '100%',
        overflow: 'hidden',
        padding: '0px',
      }}
    >
      <Box
        ref={setScroller}
        style={
          {
            '--library-sticky-offset': `${headerHeight}px`,
          } as CSSProperties
        }
        sx={(theme) => ({
          flex: 1,
          minHeight: 0,
          overflowX: 'hidden',
          overflowY: 'auto',
          scrollbarColor: `${theme.palette.divider} transparent`,
          scrollbarWidth: 'thin',
          width: '100%',
        })}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            mx: 'auto',
            maxWidth: '1500px',
            width: '90%',
          }}
        >
          <Box
            ref={headerRef}
            sx={(theme) => ({
              backgroundColor: theme.palette.background.default,
              containerName: 'library-bar',
              containerType: 'inline-size',
              display: 'flex',
              justifyContent: 'center',
              position: 'sticky',
              top: 0,
              width: '100%',
              zIndex: 2,
            })}
          >
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
                minWidth: 0,
                py: 2,
                width: '90%',
              }}
            >
              <Box>
                <Button
                  disableRipple
                  onClick={() => executeEvent('navigateBack', {})}
                  startIcon={<ArrowBackRoundedIcon />}
                  sx={(theme) => ({
                    borderRadius: '12px',
                    color: libraryMuted(theme),
                    fontSize: '13.5px',
                    fontWeight: 600,
                    height: 34,
                    ml: -1,
                    px: 1.25,
                    textTransform: 'none',
                    '& .MuiButton-startIcon .MuiSvgIcon-root': {
                      fontSize: 18,
                    },
                    '&:hover': { color: theme.palette.text.primary },
                    '&.Mui-focusVisible': libraryFocusRing(theme, 2),
                  })}
                >
                  {t('core:action.back', cap)}
                </Button>
              </Box>
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 1.5,
                  minWidth: 0,
                }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    flex: '1 1 260px',
                    gap: 1.25,
                    minWidth: 0,
                  }}
                >
                  <Box aria-hidden sx={(theme) => accentTileSx(theme, 40, 12)}>
                    <CategoryIcon id={category?.id} size={22} />
                  </Box>
                  <Typography
                    component="h1"
                    sx={(theme) => ({
                      color: theme.palette.text.primary,
                      fontSize: '20px',
                      fontWeight: 650,
                      lineHeight: '28px',
                      m: 0,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    })}
                  >
                    {title}
                  </Typography>
                  <CountBadge>
                    {isFiltered
                      ? t('core:launcher.library.count_filtered', {
                          shown: formatLibraryNumber(shown.length, locale),
                          total: formatLibraryNumber(
                            categoryList.length,
                            locale
                          ),
                        })
                      : categoryList.length}
                  </CountBadge>
                </Box>
                <LibraryFilterField
                  label={t('core:launcher.library.search_in_category', {
                    category: title,
                    postProcess: 'capitalizeFirstChar',
                  })}
                  onChange={setSearchValue}
                  sx={{ flex: '1 1 200px', maxWidth: 320 }}
                  value={searchValue}
                />
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 1,
                  }}
                >
                  <SortDropdown onChange={setSortOption} value={sortOption} />
                  <StatusFilter onChange={setStatus} value={status} />
                  <LibraryViewToggle />
                </Box>
              </Box>
            </Box>
          </Box>

          {isSearching ? null : (
            // Another category or filter starts the row from its first card.
            <TopRatedAppsBanner
              apps={appsForFeatured}
              isFromCategory
              key={`${category?.id}|${status}`}
              sx={FEATURED_SX}
            />
          )}
          <LibraryPanel sx={{ mb: 4, width: '90%' }}>
            {shown.length > 0 ? (
              <AppCollection
                active={isShow}
                apps={shown}
                isFromCategory
                label={title}
                myName={myName}
                scrollElement={scroller}
              />
            ) : (
              <LibraryEmptyState
                icon={<SearchOffRoundedIcon />}
                title={t('core:message.generic.no_results', cap)}
              />
            )}
            <LibraryResultsStatus message={resultsMessage} />
          </LibraryPanel>
        </Box>
      </Box>
    </AppsLibraryContainer>
  );
};
