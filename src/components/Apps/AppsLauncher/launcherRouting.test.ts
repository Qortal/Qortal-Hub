import { describe, expect, it } from 'vitest';
import { isLauncherShown, isLauncherSubPage } from './launcherRouting';

const state = (overrides: Partial<Parameters<typeof isLauncherShown>[0]>) => ({
  desktopViewMode: 'apps',
  mode: 'home',
  hasSelectedTab: false,
  isNewTabWindow: false,
  ...overrides,
});

describe('isLauncherShown', () => {
  it('is the start page of the Apps view', () => {
    expect(isLauncherShown(state({ mode: 'home' }))).toBe(true);
  });

  it('stands where the library was, unless a tab is selected', () => {
    expect(isLauncherShown(state({ mode: 'library' }))).toBe(true);
    expect(
      isLauncherShown(state({ mode: 'library', hasSelectedTab: true }))
    ).toBe(false);
  });

  it('covers the open tabs only while a new tab is being chosen', () => {
    expect(
      isLauncherShown(state({ mode: 'viewer', isNewTabWindow: true }))
    ).toBe(true);
    expect(isLauncherShown(state({ mode: 'viewer' }))).toBe(false);
  });

  it('gives way to the pages opened from it', () => {
    for (const mode of ['appInfo', 'category', 'publish', 'publish-app']) {
      expect(isLauncherShown(state({ mode, isNewTabWindow: true }))).toBe(
        false
      );
    }
  });

  it('never shows outside the Apps view', () => {
    for (const desktopViewMode of ['home', 'dev', 'chat']) {
      expect(isLauncherShown(state({ desktopViewMode }))).toBe(false);
    }
  });
});

describe('isLauncherSubPage', () => {
  it('knows the pages Back leaves for the launcher', () => {
    expect(isLauncherSubPage('appInfo')).toBe(true);
    expect(isLauncherSubPage('appInfo-from-category')).toBe(true);
    expect(isLauncherSubPage('publish-website')).toBe(true);
  });

  it('does not count the launcher itself or the open tabs', () => {
    expect(isLauncherSubPage('home')).toBe(false);
    expect(isLauncherSubPage('library')).toBe(false);
    expect(isLauncherSubPage('viewer')).toBe(false);
  });
});
