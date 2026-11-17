import { useEffect, useMemo, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import SearchOffRoundedIcon from '@mui/icons-material/SearchOffRounded';
import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded';
import { AppsWidthLimiter } from '../Apps-styles';
import { FeaturedAppBanner } from '../AppCard';
import { isFeaturedApp } from '../config/officialApps';
import {
  featuredRatingsMapAtomFamily,
  getCacheKey,
  useAppRatings,
} from '../../../hooks/useAppRatings';
import { AppCollection } from './AppCollection';
import { officialAppsOf } from './libraryApps';
import { APP_SKELETON } from './libraryLayout';
import {
  LibraryEmptyState,
  LibrarySection,
  LibraryWaiting,
} from './LibrarySection';
import { cap } from './libraryStyles';
import { libraryViewAtom } from './libraryView';
import type { LibraryStatus } from './useLibraryStatus';
import {
  useStableBestRatedOrder,
  useStableFeaturedOrder,
} from './useStableFeaturedOrder';

interface OfficialAppsTabProps {
  availableQapps: any[];
  myName?: string;
  /** No longer used: the launcher's own search covers the library. */
  searchValue?: string;
  libraryStatus?: LibraryStatus;
}

export const OfficialAppsTab = ({
  availableQapps,
  myName = '',
  libraryStatus = 'loading',
}: OfficialAppsTabProps) => {
  const { t, i18n } = useTranslation(['core']);
  const view = useAtomValue(libraryViewAtom);
  const { fetchRating } = useAppRatings();
  const fetchedAppsRef = useRef<Set<string>>(new Set());

  // The official Q-Apps, by title: the order of apps rated alike.
  const officialAppsByTitle = useMemo(() => {
    const locale = i18n?.language;
    const titleOf = (app: any) => app?.metadata?.title || app?.name || '';
    return officialAppsOf(availableQapps).sort((a, b) => {
      try {
        return titleOf(a).localeCompare(titleOf(b), locale);
      } catch {
        return titleOf(a).localeCompare(titleOf(b));
      }
    });
  }, [availableQapps, i18n?.language]);

  // Featured app list (stable so we can subscribe only to their ratings)
  const featuredAppsBase = useMemo(
    () => officialAppsByTitle.filter((app) => isFeaturedApp(app.name)),
    [officialAppsByTitle]
  );

  // Stable key string for the official apps' cache keys (order-independent)
  const officialKeysStable = useMemo(() => {
    const keys = officialAppsByTitle.map((a) => getCacheKey(a.name, a.service));
    return [...new Set(keys)].sort().join(',');
  }, [officialAppsByTitle]);

  // Subscribe only to the official apps' ratings – re-render only when one of these changes
  const ratingsForOfficialMap = useAtomValue(
    featuredRatingsMapAtomFamily(officialKeysStable)
  );

  // Fetch ratings for official apps (limited set ~17 apps) - only once per app
  useEffect(() => {
    officialAppsByTitle.forEach((app) => {
      const key = getCacheKey(app.name, app.service);
      if (!fetchedAppsRef.current.has(key)) {
        fetchedAppsRef.current.add(key);
        fetchRating(app.name, app.service);
      }
    });
  }, [officialAppsByTitle, fetchRating]);

  // The configured lead first, then by rating; held still while ratings
  // reload after a refresh.
  const featuredApps = useStableFeaturedOrder(
    featuredAppsBase,
    ratingsForOfficialMap
  );
  // All of them, best rated first, held still the same way.
  const officialApps = useStableBestRatedOrder(
    officialAppsByTitle,
    ratingsForOfficialMap
  );

  const allAppsTitle = t('core:official_apps.all_apps', cap);

  return (
    <AppsWidthLimiter sx={{ alignItems: 'stretch', gap: '16px' }}>
      {featuredApps.length > 0 && (
        <FeaturedAppBanner featuredApps={featuredApps} />
      )}

      <LibrarySection
        count={officialApps.length || undefined}
        hint={t('core:launcher.library.official_hint', cap)}
        icon={<VerifiedRoundedIcon />}
        title={allAppsTitle}
      >
        {availableQapps.length === 0 ? (
          <LibraryWaiting
            {...APP_SKELETON}
            count={8}
            status={libraryStatus}
            view={view}
          />
        ) : officialApps.length === 0 ? (
          <LibraryEmptyState
            compact
            icon={<SearchOffRoundedIcon />}
            title={t('core:message.generic.no_results', cap)}
          />
        ) : (
          <AppCollection
            apps={officialApps}
            label={allAppsTitle}
            myName={myName}
            virtualize={false}
          />
        )}
      </LibrarySection>
    </AppsWidthLimiter>
  );
};
