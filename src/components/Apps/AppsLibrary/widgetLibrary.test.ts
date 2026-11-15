import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://node',
}));

import { getCacheKey } from '../../../hooks/useAppRatings';
import type { AppRatingData } from '../../../types/ratings';
import { ratingPollName } from '../AppPage/appVotes';
import {
  isLibraryWidget,
  libraryWidgetKey,
  sortWidgets,
  toLibraryWidget,
  widgetRatingKey,
  widgetRatingName,
  type LibraryWidget,
} from './widgetLibrary';

const widget = (
  name: string,
  identifier: string | null,
  extra: Partial<LibraryWidget> = {}
): LibraryWidget =>
  toLibraryWidget({
    name,
    identifier,
    title: extra.title ?? name,
    description: '',
    updated: 0,
    ...extra,
  });

const rating = (averageRating: number, totalVotes: number): AppRatingData => ({
  averageRating,
  totalVotes,
  voteCounts: [],
  hasPublishedRating: totalVotes > 0,
  pollInfo: null,
  lastFetched: 0,
});

/**
 * What Core's /polls/apps/ratings makes of a poll name: Java's
 * `pollName.split("-", 5)`, the service third and the rest the app's name.
 */
const bulkEntryOf = (pollName: string) => {
  const parts = pollName.split('-');
  return { service: parts[2], appName: parts.slice(4).join('-') };
};

describe('widgets in the library', () => {
  it('are told from apps, one key per name and identifier', () => {
    const now = widget('Q-Weather', 'go-widget-now');
    expect(isLibraryWidget(now)).toBe(true);
    expect(now.service).toBe('APP');
    expect(isLibraryWidget({ name: 'Q-Weather', service: 'APP' })).toBe(false);
    expect(isLibraryWidget(null)).toBe(false);
    expect(libraryWidgetKey(now)).not.toBe(
      libraryWidgetKey(widget('Q-Weather', 'go-widget-weather'))
    );
  });

  it("keep their rating where Core's bulk ratings put it", () => {
    const now = widget('Q-Weather', 'go-widget-now');
    const entry = bulkEntryOf(ratingPollName('APP', now.name, now.identifier));
    expect(entry).toEqual({
      service: 'APP',
      appName: 'Q-Weather-id-go-widget-now',
    });
    // The library caches a bulk entry under getCacheKey(appName, service).
    expect(widgetRatingKey(now)).toBe(
      getCacheKey(entry.appName, entry.service)
    );
    expect(widgetRatingName(now)).toBe('Q-Weather-id-go-widget-now');
    // A widget that is its name's default APP has the app's rating.
    const clock = widget('GO Clock', null);
    expect(widgetRatingKey(clock)).toBe(getCacheKey('GO Clock', 'APP'));
  });
});

describe('sortWidgets', () => {
  const now = widget('Q-Weather', 'go-widget-now', {
    title: 'Weather Now',
    created: 30,
    updated: 300,
  });
  const bars = widget('Q-Weather', 'go-widget-weather', {
    title: 'Weather Bars',
    created: 20,
    updated: 200,
  });
  const clock = widget('GO Clock', null, {
    title: 'GO Clock',
    created: 10,
    updated: 400,
  });
  const list = [now, bars, clock];
  const titles = (sorted: LibraryWidget[]) => sorted.map((item) => item.title);

  it("ranks by each widget's own rating, not its app's", () => {
    const ratings = new Map([
      // The app Q-Weather is rated best, but its widgets are not it.
      [getCacheKey('Q-Weather', 'APP'), rating(5, 50)],
      [widgetRatingKey(bars), rating(4.8, 12)],
      [widgetRatingKey(now), rating(3, 2)],
    ]);
    expect(titles(sortWidgets(list, 'highest_rated', ratings))).toEqual([
      'Weather Bars',
      'Weather Now',
      'GO Clock',
    ]);
    expect(titles(sortWidgets(list, 'most_rated', ratings))).toEqual([
      'Weather Bars',
      'Weather Now',
      'GO Clock',
    ]);
  });

  it('sorts by date and by name, and leaves the list as it was', () => {
    expect(titles(sortWidgets(list, 'newest'))).toEqual([
      'Weather Now',
      'Weather Bars',
      'GO Clock',
    ]);
    expect(titles(sortWidgets(list, 'oldest'))).toEqual([
      'GO Clock',
      'Weather Bars',
      'Weather Now',
    ]);
    expect(titles(sortWidgets(list, 'recently_updated'))).toEqual([
      'GO Clock',
      'Weather Now',
      'Weather Bars',
    ]);
    expect(titles(sortWidgets(list, 'alphabetical'))).toEqual([
      'GO Clock',
      'Weather Bars',
      'Weather Now',
    ]);
    expect(titles(list)).toEqual(['Weather Now', 'Weather Bars', 'GO Clock']);
  });

  it('puts widgets nobody rated last, newest first', () => {
    expect(titles(sortWidgets(list, 'highest_rated', new Map()))).toEqual([
      'GO Clock',
      'Weather Now',
      'Weather Bars',
    ]);
  });
});
