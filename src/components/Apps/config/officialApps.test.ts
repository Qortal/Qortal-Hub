import { describe, expect, it } from 'vitest';
import {
  defaultPinnedApps,
  isFeaturedApp,
  isOfficialApp,
  officialAppList,
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

  it('features Torq where it featured Quitter', () => {
    expect(isFeaturedApp('Torq')).toBe(true);
    expect(isFeaturedApp('Quitter')).toBe(false);
    expect(isFeaturedApp('SubWire')).toBe(false);
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
