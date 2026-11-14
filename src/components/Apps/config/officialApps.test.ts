import { describe, expect, it } from 'vitest';
import {
  defaultPinnedApps,
  isFeaturedApp,
  isOfficialApp,
  officialAppList,
  officialAppsConfig,
  sortFeaturedApps,
} from './officialApps';

describe('officialApps', () => {
  it('lists Torq instead of Quitter, and SubWire and Subscreen', () => {
    expect(isOfficialApp('Torq')).toBe(true);
    expect(isOfficialApp('Quitter')).toBe(false);
    expect(isOfficialApp('SubWire')).toBe(true);
    expect(isOfficialApp('Subscreen')).toBe(true);
    // Names are compared without case, as QDN names are.
    expect(isOfficialApp('subwire')).toBe(true);
    expect(isOfficialApp('SUBSCREEN')).toBe(true);
  });

  it('features Torq where it featured Quitter, and Q-Share, Q-Shop, SubWire and Q-Assets', () => {
    expect(isFeaturedApp('Torq')).toBe(true);
    expect(isFeaturedApp('Quitter')).toBe(false);
    ['Q-Share', 'Q-Shop', 'SubWire', 'Q-Assets'].forEach((name) =>
      expect(isFeaturedApp(name)).toBe(true)
    );
    // Official, but not featured.
    expect(isFeaturedApp('Subscreen')).toBe(false);
    expect(isFeaturedApp('Q-Blog')).toBe(false);
  });

  it('leads the Featured carousel with Torq, Q-Tube, SubWire, Q-Share and Q-Assets, then the rest by rating', () => {
    const apps = officialAppsConfig.featured.map((name) => ({ name }));
    // The rest's ratings; Q-Trade and Q-Wallets tie, so votes decide.
    const ratings: Record<
      string,
      { averageRating: number; totalVotes: number }
    > = {
      'Q-Assets': { averageRating: 5, totalVotes: 9 },
      'Q-Mail': { averageRating: 3, totalVotes: 2 },
      'Q-Search': { averageRating: 4.5, totalVotes: 1 },
      'Q-Trade': { averageRating: 4, totalVotes: 1 },
      'Q-Wallets': { averageRating: 4, totalVotes: 7 },
    };

    const sorted = sortFeaturedApps(apps, (app) => ratings[app.name]);

    expect(sorted.map((app) => app.name)).toEqual([
      'Torq',
      'Q-Tube',
      'SubWire',
      'Q-Share',
      'Q-Assets',
      'Q-Search',
      'Q-Wallets',
      'Q-Trade',
      'Q-Mail',
      'Q-Shop',
    ]);
  });

  it('leads only with featured apps, and compares names without case', () => {
    officialAppsConfig.featuredLead.forEach((name) =>
      expect(isFeaturedApp(name)).toBe(true)
    );
    expect(
      sortFeaturedApps([{ name: 'q-tube' }, { name: 'TORQ' }], () => undefined)
    ).toEqual([{ name: 'TORQ' }, { name: 'q-tube' }]);
  });

  it('pins every official app for a new account, once each', () => {
    const names = defaultPinnedApps.map((app) => app.name);
    expect(names).toContain('Torq');
    expect(names).toContain('SubWire');
    expect(names).toContain('Subscreen');
    expect(names).not.toContain('Quitter');
    expect(new Set(officialAppList).size).toBe(officialAppList.length);
    expect(defaultPinnedApps.every((app) => app.service === 'APP')).toBe(true);
  });
});
