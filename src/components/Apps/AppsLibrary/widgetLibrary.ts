import { getCacheKey } from '../../../hooks/useAppRatings';
import type { AppRatingData } from '../../../types/ratings';
import { compareByWeightedRating } from '../../../utils/appRatingScore';
import {
  homeWidgetKey,
  type HomeWidgetListing,
} from '../../HomeWidgets/homeWidgets';
import { ratingName } from '../AppPage/appVotes';
import type { SortOption } from '../Filters/SortDropdown';

/**
 * A widget as the library's Widgets tab and its page show it: the APP of
 * `name` under `identifier` (null: the name's default APP, which is then the
 * app itself and shares its page, rating and reviews). See
 * docs/home-widgets.md for what makes an APP a widget.
 */
export interface LibraryWidget extends HomeWidgetListing {
  kind: 'widget';
  service: 'APP';
}

export const toLibraryWidget = (listing: HomeWidgetListing): LibraryWidget => ({
  ...listing,
  kind: 'widget',
  service: 'APP',
});

export const isLibraryWidget = (value: unknown): value is LibraryWidget =>
  !!value &&
  typeof value === 'object' &&
  (value as LibraryWidget).kind === 'widget' &&
  typeof (value as LibraryWidget).name === 'string';

/** One key per widget: a name may publish several. */
export const libraryWidgetKey = (widget: {
  name: string;
  identifier: string | null;
}) => homeWidgetKey(widget);

/**
 * What the widget's rating poll is named after (`<name>-id-<identifier>`, or
 * the app's name), and so what the library's ratings keep it under.
 */
export const widgetRatingName = (widget: {
  name: string;
  identifier: string | null;
}) => ratingName(widget.name, widget.identifier);

export const widgetRatingKey = (widget: {
  name: string;
  identifier: string | null;
}) => getCacheKey(widgetRatingName(widget), 'APP');

const titleOf = (widget: LibraryWidget) => widget.title || widget.name;

/**
 * The widgets in the library's order. The sorts are the Community tab's, so
 * the sort chosen there carries over; ties keep the newest first.
 */
export const sortWidgets = (
  widgets: readonly LibraryWidget[],
  sort: SortOption,
  ratings?: Map<string, AppRatingData>
): LibraryWidget[] => {
  const list = [...widgets];
  const ratingOf = (widget: LibraryWidget) =>
    ratings?.get(widgetRatingKey(widget)) ?? null;
  const votesOf = (widget: LibraryWidget) => ratingOf(widget)?.totalVotes ?? 0;
  const created = (widget: LibraryWidget) =>
    widget.created || widget.updated || 0;
  const newestFirst = (a: LibraryWidget, b: LibraryWidget) =>
    b.updated - a.updated || titleOf(a).localeCompare(titleOf(b));
  switch (sort) {
    case 'highest_rated':
      return list.sort(
        (a, b) =>
          compareByWeightedRating(ratingOf(a), ratingOf(b)) || newestFirst(a, b)
      );
    case 'most_rated':
      return list.sort((a, b) => votesOf(b) - votesOf(a) || newestFirst(a, b));
    case 'newest':
      return list.sort((a, b) => created(b) - created(a) || newestFirst(a, b));
    case 'oldest':
      return list.sort((a, b) => created(a) - created(b) || newestFirst(a, b));
    case 'alphabetical':
      return list.sort(
        (a, b) =>
          titleOf(a).localeCompare(titleOf(b)) || a.name.localeCompare(b.name)
      );
    case 'recently_updated':
    default:
      return list.sort(newestFirst);
  }
};
