// Straight from its file: tests mock the AppCard folder's index.
import { FeaturedAppBanner } from '../AppCard/FeaturedAppBanner';
import { useTopRatedApps } from './topRatedApps';

interface TopRatedAppsBannerProps {
  /** The apps to choose from: what the list below shows, before its sort. */
  apps: any[];
  /** On a category's page: an app's page goes back to the category. */
  isFromCategory?: boolean;
  sx?: Record<string, any>;
}

/**
 * The Featured row, chosen by the community's votes: the best rated of
 * `apps`, at most ten. Nothing while too few of them are rated well.
 */
export const TopRatedAppsBanner = ({
  apps,
  isFromCategory = false,
  sx,
}: TopRatedAppsBannerProps) => {
  const topRated = useTopRatedApps(apps);
  if (topRated.length === 0) return null;
  return (
    <FeaturedAppBanner
      featuredApps={topRated}
      isFromCategory={isFromCategory}
      sx={sx}
      variant="top-rated"
    />
  );
};
