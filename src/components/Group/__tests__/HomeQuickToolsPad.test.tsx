import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import enCore from '../../../i18n/locales/en/core.json';

const mockExecuteEvent = vi.fn();
vi.mock('../../../utils/events', () => ({
  executeEvent: (...args: any[]) => mockExecuteEvent(...args),
  subscribeToEvent: vi.fn(),
  unsubscribeFromEvent: vi.fn(),
}));

i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'core',
  ns: ['core'],
  resources: { en: { core: enCore } },
  interpolation: { escapeValue: false },
});

import {
  HomeQuickToolsPad,
  QUICK_TOOL_DETAIL_UNDER_MIN_PX,
  QUICK_TOOL_NAME_UNDER_MIN_PX,
  quickToolKeySize,
} from '../HomeQuickToolsPad';
import {
  homeDefaultGrid,
  homeGridColumnPx,
  homeGridRectPx,
} from '../HomeDesktop/homeGrid';

/** Accessible name (the tooltip), the name shown, the detail shown. */
const TOOLS = [
  ['Explorer', 'Explorer', 'Find a name or address'],
  ['Wallets', 'Wallets', 'QORT and other coins'],
  ['Apps', 'Apps', 'Browse and open Q-Apps'],
  ['Q-Chat', 'Q-Chat', 'Messages and groups'],
  ['Backup Wallet', 'Backup Wallet', 'Save your account file'],
  ['Minting', 'Minting', 'Minting status and keys'],
  ['Mute Notifications', 'Notifications', 'Desktop alerts on'],
  ['QortalLand', 'QortalLand', 'Meet and play in groups'],
] as const;

let storedMuted = false;

const renderPad = () =>
  render(
    <ThemeProvider theme={createTheme()}>
      <I18nextProvider i18n={i18n}>
        <HomeQuickToolsPad fillHeight />
      </I18nextProvider>
    </ThemeProvider>
  );

describe('HomeQuickToolsPad', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storedMuted = false;
    window.sendMessage = vi.fn(async (action: string) =>
      action === 'getUserSettings' ? storedMuted : {}
    ) as typeof window.sendMessage;
  });

  it('keeps each tool’s label as its accessible name', async () => {
    renderPad();
    for (const [label] of TOOLS) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('button')).toHaveLength(TOOLS.length);
    // Let the stored setting arrive inside the test.
    await screen.findByRole('button', { name: 'Mute Notifications' });
  });

  it('puts each tool’s name and a detail on its button', async () => {
    renderPad();
    await screen.findByRole('button', { name: 'Mute Notifications' });

    for (const [label, name, detail] of TOOLS) {
      const button = screen.getByRole('button', { name: label });
      expect(button.querySelector('.quick-tool-name')).toHaveTextContent(
        new RegExp(`^${name}$`)
      );
      expect(button.querySelector('.quick-tool-detail')).toHaveTextContent(
        new RegExp(`^${detail}$`)
      );
    }
  });

  it('shows only the icon until the button has room (container queries)', async () => {
    renderPad();
    await screen.findByRole('button', { name: 'Mute Notifications' });

    // jsdom doesn't evaluate the "quick-tool" container queries, so this is
    // the button at its smallest.
    for (const [label] of TOOLS) {
      const button = screen.getByRole('button', { name: label });
      const text = button.querySelector('.quick-tool-text') as HTMLElement;
      const detail = button.querySelector('.quick-tool-detail') as HTMLElement;
      expect(window.getComputedStyle(text).display).toBe('none');
      expect(window.getComputedStyle(detail).display).toBe('none');
    }
  });

  it('shows the names at Home’s default size, and the details once the window is bigger', () => {
    const tools = homeDefaultGrid().find((item) => item.key === 'tools');
    const name = QUICK_TOOL_NAME_UNDER_MIN_PX;
    const detail = QUICK_TOOL_DETAIL_UNDER_MIN_PX;
    const keyAt = (w: number, h: number, homeWidth: number) => {
      const px = homeGridRectPx(
        { ...tools, h, w },
        homeGridColumnPx(homeWidth)
      );
      return quickToolKeySize(px.width, px.height);
    };
    // Home 1,290–1,480 px wide: the Hub about 1,340 px wide or more.
    for (const homeWidth of [1290, 1480]) {
      const key = keyAt(tools.w, tools.h, homeWidth);
      expect(key.width).toBeGreaterThanOrEqual(name.width);
      expect(key.height).toBeGreaterThanOrEqual(name.height);
      // The details wait for a bigger window.
      expect(key.width).toBeLessThan(detail.width);
      expect(key.height).toBeLessThan(detail.height);
    }
    // Twice as wide and 6 rows taller: the details show.
    const bigger = keyAt(tools.w * 2, tools.h + 6, 1480);
    expect(bigger.width).toBeGreaterThanOrEqual(detail.width);
    expect(bigger.height).toBeGreaterThanOrEqual(detail.height);
  });

  it('names notifications by what they are, and their state', async () => {
    renderPad();
    const button = await screen.findByRole('button', {
      name: 'Mute Notifications',
    });
    expect(within(button).getByText('Notifications')).toBeInTheDocument();
    expect(within(button).getByText('Desktop alerts on')).toBeInTheDocument();

    fireEvent.click(button);

    const muted = await screen.findByRole('button', {
      name: 'Enable Notifications',
    });
    expect(window.sendMessage).toHaveBeenCalledWith('addUserSettings', {
      keyValue: { key: 'disable-push-notifications', value: true },
    });
    expect(within(muted).getByText('Notifications')).toBeInTheDocument();
    expect(within(muted).getByText('Desktop alerts muted')).toBeInTheDocument();
    expect(
      within(muted).queryByText('Desktop alerts on')
    ).not.toBeInTheDocument();
  });

  it('starts muted when the setting says so', async () => {
    storedMuted = true;
    renderPad();

    const button = await screen.findByRole('button', {
      name: 'Enable Notifications',
    });
    expect(
      within(button).getByText('Desktop alerts muted')
    ).toBeInTheDocument();
  });
});
