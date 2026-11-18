// Straight from their files: tests mock the AppCard folder's index.
import { FeaturedAppBanner } from '../AppCard/FeaturedAppBanner';
import { FeaturedWidgetCard } from '../AppCard/LibraryWidgetItem';
import { useTopRatedApps } from './topRatedApps';
import {
  type LibraryWidget,
  libraryWidgetKey,
  widgetRatingKey,
} from './widgetLibrary';

const renderFeaturedWidget = (widget: LibraryWidget) => (
  <FeaturedWidgetCard widget={widget} />
);

/**
 * Widgets are few: the row shows from the first one rated well (above three
 * stars). Community's needs three.
 */
export const TOP_RATED_WIDGETS_MIN = 1;

/**
 * The Widgets tab's Featured row: the community's best rated widgets, at
 * most ten, each by its own poll (not its app's), as Community's row picks
 * apps. The account's own vote counts at once, before its block.
 */
export const TopRatedWidgetsBanner = ({
  widgets,
}: {
  widgets: readonly LibraryWidget[];
}) => {
  const topRated = useTopRatedApps(
    widgets,
    widgetRatingKey,
    TOP_RATED_WIDGETS_MIN
  );
  if (topRated.length === 0) return null;
  return (
    <FeaturedAppBanner
      featuredApps={topRated}
      getKey={libraryWidgetKey}
      renderItem={renderFeaturedWidget}
      variant="top-rated"
    />
  );
};
