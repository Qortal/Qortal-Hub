import { describe, expect, it } from 'vitest';
import { isLauncherSubPage } from './launcherRouting';

describe('isLauncherSubPage', () => {
  it('knows the pages Back leaves for the launcher', () => {
    expect(isLauncherSubPage('appInfo')).toBe(true);
    expect(isLauncherSubPage('appInfo-from-category')).toBe(true);
    expect(isLauncherSubPage('publish-website')).toBe(true);
  });

  it('does not count the launcher itself or the open tabs', () => {
    expect(isLauncherSubPage('launcher')).toBe(false);
    expect(isLauncherSubPage('home')).toBe(false);
    expect(isLauncherSubPage('library')).toBe(false);
    expect(isLauncherSubPage('viewer')).toBe(false);
  });
});
