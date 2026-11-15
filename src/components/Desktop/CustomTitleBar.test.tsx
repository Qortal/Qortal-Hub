import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { darkTheme } from '../../styles/theme-dark';
import {
  APPS_BAR_TITLE_BAR_HEIGHT,
  CustomTitleBar,
  TITLE_BAR_EXTRA_VAR,
  appChromeOffset,
  appChromeOffsetNow,
  appHeighOffset,
  appHeighOffsetNow,
  setTitleBarExtraHeight,
} from './CustomTitleBar';

/** The apps bar stands in for itself: it has its own tests. */
const appsBar = <div data-testid="apps-bar">pinned apps and bookmarks</div>;

const show = (bar: React.ReactNode) =>
  render(
    <ThemeProvider theme={darkTheme}>
      <CustomTitleBar appsBar={bar} />
    </ThemeProvider>
  );

const extraHeight = () =>
  document.documentElement.style.getPropertyValue(TITLE_BAR_EXTRA_VAR);

beforeEach(() => {
  setTitleBarExtraHeight(0);
});

describe('the title bar', () => {
  it('is itself, with no apps bar to hold', () => {
    show(null);

    expect(screen.queryByTestId('apps-bar')).toBeNull();
    expect(screen.getByText('Qortal Hub')).toBeVisible();
  });

  it('holds the apps bar it is given, and keeps the title', () => {
    show(appsBar);

    expect(screen.getByTestId('apps-bar')).toBeVisible();
    expect(screen.getByText('Qortal Hub')).toBeVisible();
  });

  it('leaves the rest of the window less room while it is taller', () => {
    show(appsBar);

    const grownBy = APPS_BAR_TITLE_BAR_HEIGHT - appHeighOffset;
    expect(extraHeight()).toBe(`${grownBy}px`);
    expect(appHeighOffsetNow()).toBe(appHeighOffset + grownBy);
    expect(appChromeOffsetNow()).toBe(appChromeOffset + grownBy);
  });

  it('takes the room back when the bar is gone', () => {
    const { rerender } = show(appsBar);
    expect(extraHeight()).not.toBe('0px');

    rerender(
      <ThemeProvider theme={darkTheme}>
        <CustomTitleBar appsBar={null} />
      </ThemeProvider>
    );

    expect(extraHeight()).toBe('0px');
    expect(appHeighOffsetNow()).toBe(appHeighOffset);
    expect(appChromeOffsetNow()).toBe(appChromeOffset);
  });

  it('asks for nothing of the window without a bar', () => {
    show(null);

    expect(extraHeight()).toBe('0px');
  });
});
