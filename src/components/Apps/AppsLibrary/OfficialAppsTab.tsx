import { useEffect, useMemo, useRef } from 'react';
import { Box, Typography, styled, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { AppLibrarySubTitle, AppsWidthLimiter } from '../Apps-styles';
import { Spacer } from '../../../common/Spacer';
import { AppCardEnhanced, FeaturedAppBanner } from '../AppCard';
import { isFeaturedApp, officialAppList } from '../config/officialApps';
import { useAppRatings } from '../../../hooks/useAppRatings';

const AppsGrid = styled(Box)({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
  gap: '16px',
  width: '100%',
});

const SectionHeader = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  marginBottom: '20px',
});

interface OfficialAppsTabProps {
  availableQapps: any[];
  myName?: string;
  searchValue?: string;
}

export const OfficialAppsTab = ({
  availableQapps,
  myName = '',
  searchValue = '',
}: OfficialAppsTabProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const { getRating, fetchRating, ratingsStore } = useAppRatings();
  const fetchedAppsRef = useRef<Set<string>>(new Set());

  // Filter to get only official apps, then apply search
  const officialApps = useMemo(() => {
    let result = availableQapps.filter(
      (app) =>
        app.service === 'APP' &&
        officialAppList.includes(app?.name?.toLowerCase())
    );

    if (searchValue) {
      const searchLower = searchValue.toLowerCase();
      result = result.filter(
        (app) =>
          app.name.toLowerCase().includes(searchLower) ||
          (app?.metadata?.title &&
            app.metadata.title.toLowerCase().includes(searchLower)) ||
          (app?.metadata?.description &&
            app.metadata.description.toLowerCase().includes(searchLower))
      );
    }

    return result;
  }, [availableQapps, searchValue]);

  // Fetch ratings for official apps (limited set ~17 apps) - only once per app
  useEffect(() => {
    officialApps.forEach((app) => {
      const key = `${app.service}-${app.name}`;
      if (!fetchedAppsRef.current.has(key)) {
        fetchedAppsRef.current.add(key);
        fetchRating(app.name, app.service);
      }
    });
  }, [officialApps, fetchRating]);

  // Get featured apps sorted by rating
  const featuredApps = useMemo(() => {
    return officialApps
      .filter((app) => isFeaturedApp(app.name))
      .sort((a, b) => {
        const ratingA = getRating(a.name, a.service);
        const ratingB = getRating(b.name, b.service);

        const avgA = ratingA?.averageRating || 0;
        const avgB = ratingB?.averageRating || 0;

        if (avgB !== avgA) {
          return avgB - avgA;
        }

        const countA = ratingA?.totalVotes || 0;
        const countB = ratingB?.totalVotes || 0;
        return countB - countA;
      });
  }, [officialApps, getRating, ratingsStore]);

  return (
    <AppsWidthLimiter>
      {/* Featured Apps Carousel - Top 4 by rating */}
      {featuredApps.length > 0 && (
        <>
          <AppLibrarySubTitle
            sx={{
              fontSize: '20px',
              marginBottom: '24px',
            }}
          >
            {t('core:official_apps.featured', {
              postProcess: 'capitalizeFirstChar',
              defaultValue: 'Featured',
            })}
          </AppLibrarySubTitle>

          <FeaturedAppBanner featuredApps={featuredApps} />

          <Spacer height="40px" />
        </>
      )}

      {/* All Official Apps Grid */}
      <SectionHeader>
        <AppLibrarySubTitle
          sx={{
            fontSize: '20px',
          }}
        >
          {t('core:apps_official', {
            postProcess: 'capitalizeFirstChar',
          })}{' '}
          <Typography
            component="span"
            sx={{
              fontSize: '16px',
              color: theme.palette.text.secondary,
              fontWeight: 400,
            }}
          >
            ({officialApps.length})
          </Typography>
        </AppLibrarySubTitle>
      </SectionHeader>

      <AppsGrid>
        {officialApps.map((app) => (
          <AppCardEnhanced
            key={`${app?.service}-${app?.name}`}
            app={app}
            myName={myName}
          />
        ))}
      </AppsGrid>
    </AppsWidthLimiter>
  );
};
