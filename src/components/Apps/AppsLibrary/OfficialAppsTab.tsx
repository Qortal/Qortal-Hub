import { useEffect, useMemo, useState } from 'react';
import { Box, Typography, styled, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { AppLibrarySubTitle, AppsWidthLimiter } from '../Apps-styles';
import { Spacer } from '../../../common/Spacer';
import { AppCardEnhanced, FeaturedAppBanner } from '../AppCard';
import { officialAppList } from '../config/officialApps';
import { getBaseApiReact } from '../../../App';

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
}

interface AppRating {
  name: string;
  averageRating: number;
  ratingCount: number;
}

// Fetch rating for a single app
const fetchAppRating = async (
  appName: string,
  service: string
): Promise<AppRating> => {
  try {
    const pollName = `app-library-${service}-rating-${appName}`;
    const url = `${getBaseApiReact()}/polls/${pollName}`;

    const response = await fetch(url);
    if (!response.ok) {
      return { name: appName, averageRating: 0, ratingCount: 0 };
    }

    const pollData = await response.json();
    const voteCountsUrl = `${getBaseApiReact()}/polls/votes/${pollName}`;
    const votesResponse = await fetch(voteCountsUrl);

    if (!votesResponse.ok) {
      return { name: appName, averageRating: 0, ratingCount: 0 };
    }

    const votesData = await votesResponse.json();
    const voteCount = votesData.voteCounts || [];

    // Filter out initial value votes
    const ratingVotes = voteCount.filter(
      (vote: any) => !vote.optionName.startsWith('initialValue-')
    );

    // Check for initial value
    const initialValueVote = voteCount.find((vote: any) =>
      vote.optionName.startsWith('initialValue-')
    );

    if (initialValueVote) {
      const initialRating = parseInt(
        initialValueVote.optionName.replace('initialValue-', ''),
        10
      );
      if (!isNaN(initialRating)) {
        ratingVotes.push({
          optionName: initialRating.toString(),
          voteCount: 1,
        });
      }
    }

    // Calculate average rating
    let totalScore = 0;
    let totalVotes = 0;

    ratingVotes.forEach((vote: any) => {
      const rating = parseInt(vote.optionName, 10);
      if (!isNaN(rating)) {
        totalScore += rating * vote.voteCount;
        totalVotes += vote.voteCount;
      }
    });

    const averageRating = totalVotes > 0 ? totalScore / totalVotes : 0;

    return {
      name: appName,
      averageRating,
      ratingCount: totalVotes,
    };
  } catch (error) {
    return { name: appName, averageRating: 0, ratingCount: 0 };
  }
};

export const OfficialAppsTab = ({
  availableQapps,
  myName = '',
}: OfficialAppsTabProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [appRatings, setAppRatings] = useState<Map<string, AppRating>>(
    new Map()
  );
  const [ratingsLoaded, setRatingsLoaded] = useState(false);

  // Filter to get only official apps
  const officialApps = useMemo(() => {
    return availableQapps.filter(
      (app) =>
        app.service === 'APP' &&
        officialAppList.includes(app?.name?.toLowerCase())
    );
  }, [availableQapps]);

  // Fetch ratings for all official apps
  useEffect(() => {
    const fetchAllRatings = async () => {
      const ratingsMap = new Map<string, AppRating>();

      // Fetch ratings in parallel with a limit
      const promises = officialApps.map((app) =>
        fetchAppRating(app.name, app.service)
      );

      const results = await Promise.all(promises);

      results.forEach((rating) => {
        ratingsMap.set(rating.name.toLowerCase(), rating);
      });

      setAppRatings(ratingsMap);
      setRatingsLoaded(true);
    };

    if (officialApps.length > 0) {
      fetchAllRatings();
    }
  }, [officialApps]);

  // Get top 4 apps by rating for the featured section
  const featuredApps = useMemo(() => {
    if (!ratingsLoaded || appRatings.size === 0) {
      // Return first 4 apps while loading
      return officialApps.slice(0, 4);
    }

    // Sort by average rating (highest first), then by rating count
    const sortedApps = [...officialApps].sort((a, b) => {
      const ratingA = appRatings.get(a.name.toLowerCase());
      const ratingB = appRatings.get(b.name.toLowerCase());

      const avgA = ratingA?.averageRating || 0;
      const avgB = ratingB?.averageRating || 0;

      // Primary sort by average rating
      if (avgB !== avgA) {
        return avgB - avgA;
      }

      // Secondary sort by rating count
      const countA = ratingA?.ratingCount || 0;
      const countB = ratingB?.ratingCount || 0;
      return countB - countA;
    });

    return sortedApps.slice(0, 4);
  }, [officialApps, appRatings, ratingsLoaded]);

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
