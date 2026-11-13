import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../../i18n/i18n';
import { userInfoAtom } from '../../../atoms/global';
import { lightTheme } from '../../../styles/theme-light';
import {
  HOME_EDIT_LAYOUT_EVENT,
  HOME_GROUP_ACTIVITY_VISIBLE_STORAGE_KEY,
} from './homeDesktopConstants';
import { HomeLayoutSettings } from './HomeLayoutSettings';
import { homeLayoutStorageKey } from './homeLayout';

const ALICE = 'QaliceAddress00000000000000000000';

const stored = () =>
  JSON.parse(localStorage.getItem(homeLayoutStorageKey(ALICE)) ?? 'null');

const renderSettings = (
  address: string | null = ALICE,
  onCloseSettings = vi.fn()
) => {
  const store = createStore();
  store.set(userInfoAtom, address ? { address, name: 'alice' } : null);
  render(
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <HomeLayoutSettings
          border="#ccc"
          divider="#ddd"
          onCloseSettings={onCloseSettings}
          surface="#fff"
          switchSx={{}}
        />
      </ThemeProvider>
    </Provider>
  );
  return onCloseSettings;
};

const panelSwitch = (name: string) => screen.getByRole('checkbox', { name });

afterEach(() => {
  localStorage.clear();
});

describe('HomeLayoutSettings', () => {
  it('has a switch for every window but the account card', () => {
    renderSettings();
    const names = [
      'Qortino',
      'Quick Tools',
      'Featured Q-Apps',
      'Node Status',
      'Wallet Activity',
      'Widgets',
      'Group Activity',
      'Torq Feed',
    ];
    names.forEach((name) => expect(panelSwitch(name)).toBeChecked());
    expect(screen.getAllByRole('checkbox')).toHaveLength(names.length);
  });

  it('starts from the switches kept for the whole PC', () => {
    localStorage.setItem(HOME_GROUP_ACTIVITY_VISIBLE_STORAGE_KEY, 'false');
    renderSettings();
    expect(panelSwitch('Group Activity')).not.toBeChecked();
  });

  it('switches a window off for this account', () => {
    renderSettings();
    fireEvent.click(panelSwitch('Featured Q-Apps'));

    expect(panelSwitch('Featured Q-Apps')).not.toBeChecked();
    expect(stored()).toEqual({
      hidden: ['featured'],
      stack: ['widgets', 'groupActivity', 'feed'],
    });
  });

  it('closes the settings and starts Edit Home', () => {
    const started = vi.fn();
    document.addEventListener(HOME_EDIT_LAYOUT_EVENT, started);
    const onCloseSettings = renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));
    expect(onCloseSettings).toHaveBeenCalledTimes(1);
    expect(started).toHaveBeenCalledTimes(1);
    document.removeEventListener(HOME_EDIT_LAYOUT_EVENT, started);
  });

  it('resets the switches and the arrangement', () => {
    localStorage.setItem(
      homeLayoutStorageKey(ALICE),
      JSON.stringify({
        grid: [{ key: 'feed', x: 0, y: 0, w: 24, h: 40 }],
        hidden: [],
        stack: ['widgets', 'groupActivity', 'feed'],
      })
    );
    renderSettings();
    const reset = screen.getByRole('button', { name: 'Reset to default' });
    expect(reset).toBeEnabled();

    fireEvent.click(panelSwitch('Qortino'));
    fireEvent.click(reset);
    expect(panelSwitch('Qortino')).toBeChecked();
    expect(stored()).toEqual({
      hidden: [],
      stack: ['widgets', 'groupActivity', 'feed'],
    });
    expect(reset).toBeDisabled();
  });

  it('changes nothing without an account', () => {
    renderSettings(null);
    expect(panelSwitch('Qortino')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit Home' })).toBeDisabled();
  });
});
