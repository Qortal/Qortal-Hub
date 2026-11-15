import { describe, expect, it } from 'vitest';
import { officialAppsConfig } from '../Apps/config/officialApps';
import {
  countGridTracks,
  featuredMoreApps,
  featuredMoreAppsFit,
  largestPx,
} from './featuredMoreApps';

const GRID = ['Q-Tube', 'Torq', 'Q-Mail', 'SubWire', 'Q-Trade', 'Q-Chat'];

describe('featuredMoreApps', () => {
  it('lists the featured apps first, then the other official apps', () => {
    expect(
      featuredMoreApps(
        GRID,
        ['Q-Tube', 'Quitter', 'Q-Mail', 'Q-Search', 'Q-Trade', 'Q-Wallets'],
        [
          { name: 'Q-Blog' },
          { name: 'Q-Mail' },
          { name: 'Q-Wallets' },
          { name: 'Quitter' },
          { name: 'Names' },
          { name: 'Q-Search' },
          { name: 'Q-Support' },
        ]
      )
    ).toEqual(['Q-Search', 'Q-Wallets', 'Q-Blog', 'Names', 'Q-Support']);
  });

  it('works with Torq, SubWire and Subscreen in the official lists', () => {
    expect(
      featuredMoreApps(
        GRID,
        [
          'Q-Tube',
          'Torq',
          'Q-Mail',
          'Q-Search',
          'Q-Trade',
          'Q-Wallets',
          'Q-Share',
          'Q-Shop',
          'SubWire',
          'Q-Assets',
        ],
        [
          { name: 'Q-Blog' },
          { name: 'Torq' },
          { name: 'Q-Assets' },
          { name: 'Q-Follow' },
          { name: 'Subscreen' },
          { name: 'SubWire' },
        ]
      )
    ).toEqual([
      'Q-Search',
      'Q-Wallets',
      'Q-Share',
      'Q-Shop',
      'Q-Assets',
      'Q-Blog',
      'Q-Follow',
      'Subscreen',
    ]);
  });

  it('compares names without case, and leaves out repeats and blanks', () => {
    expect(
      featuredMoreApps(
        ['q-tube'],
        ['Q-TUBE', 'q-search', 'Q-Search', ' Q-Fund ', ''],
        [{ name: 'QUITTER' }, { name: 'q-fund' }, { name: 'Names' }]
      )
    ).toEqual(['q-search', 'Q-Fund', 'Names']);
  });

  it('uses the official apps by default', () => {
    const apps = featuredMoreApps(GRID);
    const keys = apps.map((name) => name.toLowerCase());
    const shown = [...GRID, 'Quitter'].map((name) => name.toLowerCase());
    const official = [
      ...officialAppsConfig.featured,
      ...officialAppsConfig.all.map((app) => app.name),
    ].map((name) => name.toLowerCase());
    const featured = officialAppsConfig.featured.filter(
      (name) => !shown.includes(name.toLowerCase())
    );

    expect(apps.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
    // Every official app Home doesn't show yet, the featured ones first.
    expect(new Set(keys)).toEqual(
      new Set(official.filter((key) => !shown.includes(key)))
    );
    expect(apps.slice(0, featured.length)).toEqual(featured);
  });
});

describe('featuredMoreAppsFit', () => {
  const fit = (
    availableHeight: number,
    columns: number,
    rowHeight = 124,
    moreApps = 20
  ) =>
    featuredMoreAppsFit({
      availableHeight,
      baseCells: 8,
      columns,
      gap: 12,
      moreApps,
      rowHeight,
    });

  it('adds nothing at the default size', () => {
    // Two rows of 124 px and a 12 px gap: 260 px, in about 262 px.
    expect(fit(260, 4)).toBe(0);
    expect(fit(262.4, 4)).toBe(0);
  });

  it('adds whole rows of four in four columns', () => {
    expect(fit(395, 4)).toBe(0);
    expect(fit(396, 4)).toBe(4);
    expect(fit(531.9, 4)).toBe(4);
    expect(fit(532, 4)).toBe(8);
    expect(fit(1000, 4)).toBe(20);
  });

  it('adds whole rows of two in two columns', () => {
    // The apps take four rows: 4 * 124 + 3 * 12 = 532 px.
    expect(fit(532, 2)).toBe(0);
    expect(fit(667, 2)).toBe(0);
    expect(fit(668, 2)).toBe(2);
    expect(fit(804, 2)).toBe(4);
  });

  it('adds whole rows of eight in one row of eight', () => {
    expect(fit(108, 8, 108)).toBe(0);
    expect(fit(227, 8, 108)).toBe(0);
    expect(fit(228, 8, 108)).toBe(8);
    expect(fit(348, 8, 108)).toBe(16);
  });

  it('stops when the apps run out', () => {
    expect(fit(532, 4, 124, 6)).toBe(6);
    expect(fit(1000, 8, 108, 13)).toBe(13);
  });

  it('adds nothing when the apps already need to scroll', () => {
    expect(fit(150, 4)).toBe(0);
    expect(fit(0, 4)).toBe(0);
    expect(fit(-40, 4)).toBe(0);
  });

  it('adds nothing when it cannot tell', () => {
    expect(fit(Number.NaN, 4)).toBe(0);
    expect(fit(600, 0)).toBe(0);
    expect(fit(600, Number.NaN)).toBe(0);
    expect(fit(600, 4, 0)).toBe(0);
    expect(fit(600, 4, 124, 0)).toBe(0);
    expect(
      featuredMoreAppsFit({
        availableHeight: 600,
        baseCells: 8,
        columns: 4,
        gap: -1,
        moreApps: 20,
        rowHeight: 124,
      })
    ).toBe(0);
  });

  it('fills a grid with none of its own tiles from the first row', () => {
    expect(
      featuredMoreAppsFit({
        availableHeight: 124,
        baseCells: 0,
        columns: 4,
        gap: 12,
        moreApps: 20,
        rowHeight: 124,
      })
    ).toBe(4);
  });
});

describe('countGridTracks', () => {
  it('counts the sizes a browser resolves the columns to', () => {
    expect(countGridTracks('113.5px 113.5px 113.5px 113.5px')).toBe(4);
    expect(countGridTracks('120px 120px')).toBe(2);
  });

  it('counts declared columns, repeat() included', () => {
    expect(countGridTracks('repeat(4, minmax(0, 1fr))')).toBe(4);
    expect(countGridTracks('repeat(8, minmax(0px, 1fr))')).toBe(8);
    expect(countGridTracks('minmax(0, 1fr) 100px')).toBe(2);
    expect(countGridTracks('[a] 10px [b] repeat(2, 1fr 2fr) [c]')).toBe(5);
  });

  it('gives 0 when it cannot tell', () => {
    expect(countGridTracks('')).toBe(0);
    expect(countGridTracks('none')).toBe(0);
    expect(countGridTracks('repeat(auto-fill, minmax(100px, 1fr))')).toBe(0);
    expect(countGridTracks(undefined as unknown as string)).toBe(0);
  });
});

describe('largestPx', () => {
  it('finds the largest px length', () => {
    expect(largestPx('minmax(108px, 124px)')).toBe(124);
    expect(largestPx('minmax(84px, 108px)')).toBe(108);
    expect(largestPx('124px')).toBe(124);
    expect(largestPx('12.5px 3px')).toBe(12.5);
  });

  it('gives 0 without one', () => {
    expect(largestPx('auto')).toBe(0);
    expect(largestPx('')).toBe(0);
    expect(largestPx(undefined as unknown as string)).toBe(0);
  });
});
