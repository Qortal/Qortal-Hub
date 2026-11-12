import {
  memo,
  type ReactNode,
  type UIEvent,
  useCallback,
  useDeferredValue,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Box, Typography } from '@mui/material';
import { atom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { sortablePinnedAppsAtom } from '../../../atoms/global';
import { getCacheKey, ratingsStoreAtom } from '../../../hooks/useAppRatings';
import { useHandlePrivateApps } from '../../../hooks/useHandlePrivateApps';
import type { AppRatingData } from '../../../types/ratings';
import { executeEvent } from '../../../utils/events';
import { openQortalUseGroupLink } from '../../../utils/openQortalUseGroupLink';
import {
  getPinnedAppKey,
  type PinnedApp,
  removeBrokenPinnedApps,
} from '../../../utils/pinnedAppsSettings';
import { AppsLibraryContainer, AppsWidthLimiter } from '../Apps-styles';
import type { AppsLibraryTabValue } from '../AppsLibrary';
import {
  LauncherBookmarkTile,
  openLauncherBookmark,
} from './LauncherBookmarkTile';
import { isAppStartBookmark } from './launcherItems';
import { LauncherLibrary } from './LauncherLibrary';
import { launcherPinLabel } from './launcherPins';
import { LauncherPinTile } from './LauncherPinTile';
import { LauncherSaved } from './LauncherSaved';
import {
  type LauncherApp,
  launcherLabelMatches,
  type LauncherLink,
  parseLauncherLink,
  searchLauncherApps,
} from './launcherSearch';
import { LauncherSearchField } from './LauncherSearchField';
import { LauncherSearchResults } from './LauncherSearchResults';
import { useLauncherBookmarks } from './useLauncherBookmarks';

const HEADER_PADDING_TOP_PX = 20;
const HEADER_PADDING_BOTTOM_PX = 14;
const SEARCH_FIELD_HEIGHT_PX = 48;
/** The search header stays at the top of the page; the tab bar sits under it. */
const HEADER_HEIGHT_PX =
  HEADER_PADDING_TOP_PX + SEARCH_FIELD_HEIGHT_PX + HEADER_PADDING_BOTTOM_PX;

const EMPTY_RATINGS = new Map<string, AppRatingData>();
const noRatingsAtom = atom(EMPTY_RATINGS);

const MemoLibrary = memo(LauncherLibrary);
const MemoSaved = memo(LauncherSaved);

/** A pin or bookmark that matches the search and is not a library app. */
type SavedResult = {
  key: string;
  label: string;
  tile: ReactNode;
  open: () => void;
};

const sectionTitleSx = {
  color: 'text.primary',
  fontSize: '15px',
  fontWeight: 600,
  lineHeight: 1.3,
  margin: 0,
} as const;

/** Asks the launcher to start over: scrolled to the top, with this search. */
export type AppsLauncherRequest = {
  /** Changes with every request. */
  nonce: number;
  query: string;
};

interface AppsLauncherProps {
  availableQapps: LauncherApp[];
  categories: any[];
  contentHeight?: string;
  /** Reloads the list of apps and websites from the node. */
  getQapps?: () => void | Promise<void>;
  isShow: boolean;
  myAddress: string;
  myApp?: PinnedApp | null;
  myName: string;
  myWebsite?: PinnedApp | null;
  request?: AppsLauncherRequest;
  setMode: (mode: string) => void;
}

/**
 * The page every new tab starts from: one search box, the pinned apps and
 * bookmarks, and the library underneath. Nothing is built before it is first
 * shown. After
 * that it stays mounted while another page shows, so the library tab, its
 * filters and the scroll position are still there on return.
 */
export const AppsLauncher = (props: AppsLauncherProps) => {
  const hasBeenShownRef = useRef(props.isShow);
  if (props.isShow) hasBeenShownRef.current = true;
  return hasBeenShownRef.current ? <AppsLauncherPage {...props} /> : null;
};

const AppsLauncherPage = ({
  availableQapps,
  categories,
  contentHeight,
  getQapps,
  isShow,
  myAddress,
  myApp,
  myName,
  myWebsite,
  request,
  setMode,
}: AppsLauncherProps) => {
  const { t } = useTranslation(['core']);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const libraryStartRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [currentTab, setCurrentTab] = useState<AppsLibraryTabValue>('official');
  const { openApp: openPrivateApp } = useHandlePrivateApps();
  const {
    data: bookmarks,
    isReady: areBookmarksReady,
    save: saveBookmarks,
  } = useLauncherBookmarks(myAddress, isShow);
  const clearQuery = useCallback(() => setQuery(''), []);

  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length > 0;
  const deferredQuery = useDeferredValue(trimmedQuery);

  // Ratings only order search results, so the page listens to them only then.
  const ratings = useAtomValue(isSearching ? ratingsStoreAtom : noRatingsAtom);
  const pinnedApps = useAtomValue(sortablePinnedAppsAtom);

  const getRating = useCallback(
    (app: LauncherApp) =>
      app?.name && app?.service
        ? ratings.get(getCacheKey(app.name, app.service))
        : null,
    [ratings]
  );

  const pinnedKeys = useMemo(
    () =>
      new Set(
        removeBrokenPinnedApps(pinnedApps as PinnedApp[]).map(getPinnedAppKey)
      ),
    [pinnedApps]
  );
  const searchOptions = useMemo(
    () => ({
      getRating,
      isPinned: (app: LauncherApp) => pinnedKeys.has(getPinnedAppKey(app)),
    }),
    [getRating, pinnedKeys]
  );

  const link = useMemo(() => parseLauncherLink(deferredQuery), [deferredQuery]);
  const appResults = useMemo(
    () =>
      link
        ? []
        : searchLauncherApps(availableQapps, deferredQuery, searchOptions),
    [availableQapps, deferredQuery, link, searchOptions]
  );

  // Private apps and bookmarks are saved but not in the library, so the
  // search finds them here. A bookmark of an app's start page is left out
  // when the app itself is among the results.
  const findSaved = useCallback(
    (text: string, foundApps: LauncherApp[]): SavedResult[] => {
      const foundKeys = new Set(
        foundApps.map((app) => getPinnedAppKey(app).toLowerCase())
      );
      const privateLabel = t('core:app_private', {
        postProcess: 'capitalizeFirstChar',
      });
      const results: SavedResult[] = [];
      for (const app of removeBrokenPinnedApps(pinnedApps as PinnedApp[])) {
        if (!app.isPrivate) continue;
        const label = launcherPinLabel(app, privateLabel);
        if (!launcherLabelMatches(label, text)) continue;
        results.push({
          key: getPinnedAppKey(app),
          label,
          tile: (
            <LauncherPinTile
              app={app}
              key={getPinnedAppKey(app)}
              onOpened={clearQuery}
            />
          ),
          // A private app is downloaded and decrypted before it opens.
          open: () => {
            openPrivateApp(app.privateAppProperties, false, undefined)
              .then((opened) => {
                if (opened) clearQuery();
              })
              .catch((error) => console.error(error));
          },
        });
      }
      for (const bookmark of bookmarks?.bookmarks ?? []) {
        const label = bookmark.name || bookmark.appName;
        if (
          !launcherLabelMatches(label, text) &&
          !launcherLabelMatches(bookmark.appName, text)
        ) {
          continue;
        }
        const appKey = `${bookmark.service}-${bookmark.appName}`.toLowerCase();
        if (isAppStartBookmark(bookmark) && foundKeys.has(appKey)) continue;
        results.push({
          key: `bookmark-${bookmark.id}`,
          label,
          tile: (
            <LauncherBookmarkTile
              bookmark={bookmark}
              key={`bookmark-${bookmark.id}`}
              onOpened={clearQuery}
            />
          ),
          open: () => {
            openLauncherBookmark(bookmark);
            clearQuery();
          },
        });
      }
      return results;
    },
    [bookmarks, clearQuery, openPrivateApp, pinnedApps, t]
  );
  const savedResults = useMemo(
    () => (link || !deferredQuery ? [] : findSaved(deferredQuery, appResults)),
    [appResults, deferredQuery, findSaved, link]
  );

  // --- Scroll positions -----------------------------------------------------

  const isShowRef = useRef(isShow);
  isShowRef.current = isShow;
  const isSearchingRef = useRef(isSearching);
  isSearchingRef.current = isSearching;
  const currentTabRef = useRef(currentTab);
  currentTabRef.current = currentTab;
  /** Where each of the two views was left: the page itself, and the results. */
  const scrollTopRef = useRef({ browse: 0, results: 0 });
  const tabScrollTopRef = useRef<Partial<Record<AppsLibraryTabValue, number>>>(
    {}
  );
  const pendingTabScrollTopRef = useRef<number | null>(null);
  // No request is handled yet, so the one the page is first shown with counts.
  const handledNonceRef = useRef<number | null>(null);

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (!isShowRef.current) return;
    const view = isSearchingRef.current ? 'results' : 'browse';
    scrollTopRef.current[view] = event.currentTarget.scrollTop;
  }, []);

  // A request starts the launcher over. Without one, showing it again (back
  // from an app's page, say) returns to where it was.
  useLayoutEffect(() => {
    if (!isShow) return;
    const nonce = request?.nonce ?? 0;
    if (handledNonceRef.current !== nonce) {
      handledNonceRef.current = nonce;
      scrollTopRef.current = { browse: 0, results: 0 };
      setQuery(request?.query ?? '');
      if (scroller) scroller.scrollTop = 0;
      inputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (scroller) {
      scroller.scrollTop =
        scrollTopRef.current[isSearchingRef.current ? 'results' : 'browse'];
    }
    // The request's query belongs to its nonce.
  }, [isShow, request?.nonce, scroller]);

  // Leaving the search returns to the page as it was.
  useLayoutEffect(() => {
    if (!scroller || !isShowRef.current || isSearching) return;
    scroller.scrollTop = scrollTopRef.current.browse;
  }, [isSearching, scroller]);

  // New results start at the top.
  useLayoutEffect(() => {
    if (!scroller || !isShowRef.current || !isSearchingRef.current) return;
    scroller.scrollTop = 0;
    scrollTopRef.current.results = 0;
  }, [deferredQuery, scroller]);

  const handleTabChange = useCallback(
    (tab: AppsLibraryTabValue) => {
      const previous = currentTabRef.current;
      const start = libraryStartRef.current;
      if (previous !== tab && scroller && start) {
        // The scroll offset at which the tab bar reaches the search header.
        const libraryTop = Math.max(
          0,
          Math.round(
            start.getBoundingClientRect().top -
              scroller.getBoundingClientRect().top +
              scroller.scrollTop -
              HEADER_HEIGHT_PX
          )
        );
        tabScrollTopRef.current[previous] = scroller.scrollTop;
        // Above the library nothing moves. Once the tab bar has reached the
        // top, a tab opens where it was left, or at its start.
        pendingTabScrollTopRef.current =
          scroller.scrollTop >= libraryTop - 1
            ? Math.max(libraryTop, tabScrollTopRef.current[tab] ?? 0)
            : null;
      }
      setCurrentTab(tab);
    },
    [scroller]
  );

  useLayoutEffect(() => {
    if (pendingTabScrollTopRef.current === null || !scroller) return;
    scroller.scrollTop = pendingTabScrollTopRef.current;
    scrollTopRef.current.browse = pendingTabScrollTopRef.current;
    pendingTabScrollTopRef.current = null;
  }, [currentTab, scroller]);

  // --- Opening things -------------------------------------------------------

  const openLink = useCallback((target: LauncherLink) => {
    if (target.kind === 'group') {
      void openQortalUseGroupLink(target.link);
    } else {
      executeEvent('addTab', {
        data: {
          service: target.service,
          name: target.name,
          identifier: target.identifier,
          path: target.path,
        },
      });
      executeEvent('open-apps-mode', {});
    }
    setQuery('');
  }, []);

  // Enter opens the address that was typed, or the best match.
  const handleSubmit = useCallback(() => {
    const text = query.trim();
    if (!text) return;
    const typedLink = parseLauncherLink(text);
    if (typedLink) {
      openLink(typedLink);
      return;
    }
    const [bestApp] = searchLauncherApps(availableQapps, text, searchOptions);
    if (bestApp) {
      executeEvent('addTab', { data: bestApp });
      executeEvent('open-apps-mode', {});
      setQuery('');
      return;
    }
    findSaved(text, [])[0]?.open();
  }, [availableQapps, findSaved, openLink, query, searchOptions]);

  const enterOpens = useMemo(() => {
    if (link) return null;
    const bestApp = appResults[0];
    if (bestApp) return bestApp.metadata?.title || bestApp.name || null;
    return savedResults[0]?.label ?? null;
  }, [appResults, link, savedResults]);

  const savedTiles = useMemo(
    () => savedResults.map((result) => result.tile),
    [savedResults]
  );

  return (
    <AppsLibraryContainer
      sx={{
        display: isShow ? 'flex' : 'none',
        height: contentHeight || '100%',
        overflow: 'hidden',
      }}
    >
      <Box
        onScroll={handleScroll}
        ref={setScroller}
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
            minHeight: '100%',
            width: '100%',
          }}
        >
          <Box
            sx={(theme) => ({
              backgroundColor: theme.palette.background.default,
              display: 'flex',
              justifyContent: 'center',
              padding: `${HEADER_PADDING_TOP_PX}px 24px ${HEADER_PADDING_BOTTOM_PX}px`,
              position: 'sticky',
              top: 0,
              width: '100%',
              zIndex: 3,
            })}
          >
            <LauncherSearchField
              inputRef={inputRef}
              onChange={setQuery}
              onSubmit={handleSubmit}
              value={query}
            />
          </Box>

          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              maxWidth: '1500px',
              width: '90%',
            }}
          >
            {isSearching ? (
              <Box sx={{ paddingTop: '10px', width: '100%' }}>
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    width: '100%',
                  }}
                >
                  <LauncherSearchResults
                    apps={appResults}
                    enterOpens={enterOpens}
                    isActive={isShow}
                    link={link}
                    myName={myName}
                    onOpenLink={() => link && openLink(link)}
                    query={deferredQuery}
                    savedTiles={savedTiles}
                    scrollElement={scroller}
                  />
                </Box>
              </Box>
            ) : null}

            <Box
              sx={{
                alignItems: 'center',
                display: isSearching ? 'none' : 'flex',
                flexDirection: 'column',
                width: '100%',
              }}
            >
              <AppsWidthLimiter sx={{ gap: '6px', paddingTop: '10px' }}>
                <Box
                  sx={{
                    alignItems: 'baseline',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '4px 16px',
                    justifyContent: 'space-between',
                    width: '100%',
                  }}
                >
                  <Typography component="h2" sx={sectionTitleSx}>
                    {t('core:launcher.pinned_and_bookmarks', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                  <Typography
                    sx={(theme) => ({
                      color: theme.palette.text.secondary,
                      fontSize: '12.5px',
                    })}
                  >
                    {t('core:launcher.pinned_hint', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                </Box>
                {/* Once the bookmarks are read: they say what is in a folder. */}
                {areBookmarksReady ? (
                  <MemoSaved
                    availableQapps={availableQapps}
                    bookmarks={bookmarks}
                    myAddress={myAddress}
                    myApp={myApp}
                    myWebsite={myWebsite}
                    onBookmarksChange={saveBookmarks}
                  />
                ) : null}
              </AppsWidthLimiter>

              <Box
                ref={libraryStartRef}
                sx={{ height: '8px', width: '100%' }}
              />

              <MemoLibrary
                availableQapps={availableQapps}
                categories={categories}
                currentTab={currentTab}
                getQapps={getQapps}
                isActive={isShow && !isSearching}
                myAddress={myAddress}
                myName={myName}
                onTabChange={handleTabChange}
                scrollElement={scroller}
                setMode={setMode}
                stickyTop={HEADER_HEIGHT_PX}
              />
            </Box>
          </Box>
        </Box>
      </Box>
    </AppsLibraryContainer>
  );
};
