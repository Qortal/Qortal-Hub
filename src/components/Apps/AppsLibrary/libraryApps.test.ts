import { describe, expect, it } from 'vitest';
import { officialAppList } from '../config/officialApps';
import {
  communityAppsOf,
  isOfficialLibraryApp,
  officialAppsOf,
} from './libraryApps';

const apps = [
  { name: 'Q-Tube', service: 'APP' },
  { name: 'q-mail', service: 'APP' },
  { name: 'Q-Mintership', service: 'WEBSITE' },
  { name: 'Chess', service: 'APP' },
  { name: 'Torq', service: 'WEBSITE' },
];

describe('libraryApps', () => {
  it('counts only Q-Apps on the official list as official', () => {
    expect(officialAppsOf(apps).map((app) => app.name)).toEqual([
      'Q-Tube',
      'q-mail',
    ]);
  });

  it('puts a website under an official name in Community', () => {
    expect(communityAppsOf(apps).map((app) => app.name)).toEqual([
      'Q-Mintership',
      'Chess',
      'Torq',
    ]);
    expect(
      isOfficialLibraryApp({ name: 'Q-Mintership', service: 'WEBSITE' })
    ).toBe(false);
  });

  it('splits the library without losing or repeating an app', () => {
    const all = officialAppsOf(apps).length + communityAppsOf(apps).length;
    expect(all).toBe(apps.length);
  });

  it('knows every app of the official list', () => {
    const official = officialAppList.map((name) => ({ name, service: 'APP' }));
    expect(officialAppsOf(official)).toHaveLength(officialAppList.length);
    expect(communityAppsOf(official)).toHaveLength(0);
  });

  it('copes with a missing list or name', () => {
    expect(officialAppsOf(undefined as never)).toEqual([]);
    expect(isOfficialLibraryApp({ service: 'APP' })).toBe(false);
  });
});
