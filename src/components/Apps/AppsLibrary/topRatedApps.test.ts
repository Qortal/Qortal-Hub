import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { createStore, Provider } from 'jotai';

vi.mock('../../../App', () => ({ getBaseApiReact: () => 'http://node' }));

import { userInfoAtom } from '../../../atoms/global';
import {
  allRatingsLoadedAtom,
  getCacheKey,
  ratingsStoreAtom,
} from '../../../hooks/useAppRatings';
import { pendingVotesAtom } from '../AppPage/appPageStore';
import {
  isRatedWell,
  TOP_RATED_LIMIT,
  topRatedApps,
  useTopRatedApps,
} from './topRatedApps';

const app = (name: string, service = 'APP') => ({ name, service });

const rating = (averageRating: number, totalVotes: number) => ({
  averageRating,
  totalVotes,
  voteCounts: [],
  hasPublishedRating: true,
  pollInfo: null,
  lastFetched: 0,
});

const names = (list: { name: string }[]) => list.map((item) => item.name);

describe('topRatedApps', () => {
  it('weighs the number of votes, as the Highest rated sort does', () => {
    const ratings = {
      Lone: rating(5, 1),
      Loved: rating(4.6, 50),
      Liked: rating(4.2, 12),
    };
    expect(
      names(
        topRatedApps(
          [app('Lone'), app('Loved'), app('Liked')],
          (item) => ratings[item.name]
        )
      )
    ).toEqual(['Loved', 'Liked', 'Lone']);
  });

  it('leaves out apps without votes and apps rated three stars or less', () => {
    const ratings = {
      Good: rating(4, 5),
      Middle: rating(3, 40),
      Poor: rating(1.5, 8),
      Unvoted: rating(0, 0),
    };
    expect(
      names(
        topRatedApps(
          ['Good', 'Middle', 'Poor', 'Unvoted', 'Unknown'].map((name) =>
            app(name)
          ),
          (item) => ratings[item.name]
        )
      )
    ).toEqual(['Good']);
    expect(isRatedWell(rating(3.01, 1))).toBe(true);
    expect(isRatedWell(null)).toBe(false);
  });

  it('keeps ten at most', () => {
    const many = Array.from({ length: 14 }, (_, index) => app(`App ${index}`));
    const top = topRatedApps(many, (item) =>
      rating(4 + Number(item.name.split(' ')[1]) / 100, 5)
    );
    expect(top).toHaveLength(TOP_RATED_LIMIT);
    expect(top[0].name).toBe('App 13');
    expect(top[9].name).toBe('App 4');
  });

  it('keeps the order that apps rated alike came in', () => {
    expect(
      names(
        topRatedApps([app('Zeta'), app('Alpha'), app('Mid')], () =>
          rating(4, 4)
        )
      )
    ).toEqual(['Zeta', 'Alpha', 'Mid']);
  });

  it('counts an app once, and a website of the same name apart', () => {
    expect(
      topRatedApps(
        [app('Chess'), app('Chess'), app('Chess', 'WEBSITE'), app('')],
        () => rating(4, 4)
      ).map((item) => `${item.service} ${item.name}`)
    ).toEqual(['APP Chess', 'WEBSITE Chess']);
  });

  it('tells items apart, and ranks them, by the key it is given', () => {
    // Widgets: one name, several identifiers, each with its own poll.
    type Widget = { name: string; service: string; identifier: string };
    const widget = (identifier: string): Widget => ({
      ...app('Q-Weather'),
      identifier,
    });
    const ratings = new Map([
      ['now', rating(4.2, 6)],
      ['bars', rating(4.9, 20)],
      ['chart', rating(4.5, 12)],
    ]);
    const byIdentifier = (item: Widget) => item.identifier;
    expect(
      topRatedApps<Widget>(
        [widget('now'), widget('bars'), widget('chart'), widget('now')],
        (item) => ratings.get(item.identifier),
        TOP_RATED_LIMIT,
        byIdentifier
      ).map((item) => item.identifier)
    ).toEqual(['bars', 'chart', 'now']);
  });
});

describe('useTopRatedApps', () => {
  const list = [app('A'), app('B'), app('C'), app('D')];

  const storeWith = (ratings: Record<string, ReturnType<typeof rating>>) =>
    new Map(
      Object.entries(ratings).map(([name, value]) => [
        getCacheKey(name, 'APP'),
        value,
      ])
    );

  const setup = (ratings: Record<string, ReturnType<typeof rating>>) => {
    const store = createStore();
    store.set(ratingsStoreAtom, storeWith(ratings));
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(Provider, { store }, children);
    const hook = renderHook(
      ({ apps }: { apps: { name: string; service: string }[] }) =>
        useTopRatedApps(apps),
      { initialProps: { apps: list }, wrapper }
    );
    return { store, ...hook };
  };

  it('has no row while fewer than three apps are rated well', () => {
    const { result } = setup({
      A: rating(5, 9),
      B: rating(4, 9),
      C: rating(2, 9),
    });
    expect(result.current).toEqual([]);
  });

  it('gives the best rated once three are rated well', () => {
    const { result } = setup({
      A: rating(4, 9),
      B: rating(5, 9),
      C: rating(4.5, 9),
      D: rating(1, 9),
    });
    expect(names(result.current)).toEqual(['B', 'C', 'A']);
  });

  it('keeps the row on screen while a refresh reloads the ratings', () => {
    const { result, store } = setup({
      A: rating(4, 9),
      B: rating(5, 9),
      C: rating(4.5, 9),
    });
    const shown = result.current;

    act(() => store.set(ratingsStoreAtom, new Map()));
    expect(result.current).toBe(shown);

    act(() =>
      store.set(
        ratingsStoreAtom,
        storeWith({
          A: rating(5, 9),
          B: rating(4, 9),
          C: rating(4.5, 9),
          D: rating(4.8, 9),
        })
      )
    );
    expect(names(result.current)).toEqual(['A', 'D', 'C', 'B']);
  });

  it('follows another set of apps at once, also while ratings reload', () => {
    const { result, store, rerender } = setup({
      A: rating(4, 9),
      B: rating(5, 9),
      C: rating(4.5, 9),
    });
    act(() => store.set(ratingsStoreAtom, new Map()));
    rerender({ apps: [app('A'), app('B')] });
    expect(result.current).toEqual([]);
  });

  it('has no row when the node could not give every rating', () => {
    const { result, store } = setup({
      A: rating(4, 9),
      B: rating(5, 9),
      C: rating(4.5, 9),
    });
    expect(result.current).toHaveLength(3);

    act(() => store.set(allRatingsLoadedAtom, false));
    expect(result.current).toEqual([]);

    act(() => store.set(allRatingsLoadedAtom, true));
    expect(names(result.current)).toEqual(['B', 'C', 'A']);
  });

  it("counts the account's own vote at once, and takes the fewest it is given", () => {
    const store = createStore();
    store.set(userInfoAtom, { address: 'QMe' });
    store.set(ratingsStoreAtom, storeWith({ A: rating(4, 9) }));
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(Provider, { store }, children);
    const { result } = renderHook(() => useTopRatedApps(list, undefined, 1), {
      wrapper,
    });
    expect(names(result.current)).toEqual(['A']);

    // D gets its first rating, a 5, from this account: before its block.
    act(() =>
      store.set(pendingVotesAtom, {
        d: {
          voter: 'QMe',
          rating: 5,
          createdPoll: true,
          sentAt: 1,
          name: 'D',
          service: 'APP',
        },
      })
    );
    expect(names(result.current)).toEqual(['A', 'D']);
  });
});
