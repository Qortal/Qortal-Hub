import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, it } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../../i18n/i18n';
import { userInfoAtom } from '../../../atoms/global';
import { lightTheme } from '../../../styles/theme-light';
import { HOME_GROUP_ACTIVITY_VISIBLE_STORAGE_KEY } from './homeDesktopConstants';
import { HomeLayoutSettings } from './HomeLayoutSettings';
import { homeLayoutStorageKey } from './homeLayout';

const ALICE = 'QaliceAddress00000000000000000000';

const stored = () =>
  JSON.parse(localStorage.getItem(homeLayoutStorageKey(ALICE)) ?? 'null');

const renderSettings = (address: string | null = ALICE) => {
  const store = createStore();
  store.set(userInfoAtom, address ? { address, name: 'alice' } : null);
  render(
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <HomeLayoutSettings
          border="#ccc"
          divider="#ddd"
          surface="#fff"
          switchSx={{}}
        />
      </ThemeProvider>
    </Provider>
  );
};

const panelSwitch = (name: string) => screen.getByRole('checkbox', { name });

/** The panel titles of the "Below, in this order" card, top to bottom. */
const stackTitles = () =>
  within(
    screen.getByText('Below, in this order').nextElementSibling as HTMLElement
  )
    .getAllByRole('checkbox')
    .map((element) => element.getAttribute('aria-label'));

afterEach(() => {
  localStorage.clear();
});

describe('HomeLayoutSettings', () => {
  it('has a switch for every panel but the account card', () => {
    renderSettings();
    [
      'Qortino',
      'Quick Tools',
      'Featured Q-Apps',
      'Node Status',
      'Wallet Activity',
      'Widgets',
      'Group Activity',
      'Torq Feed',
    ].forEach((name) => expect(panelSwitch(name)).toBeChecked());
    expect(stackTitles()).toEqual(['Widgets', 'Group Activity', 'Torq Feed']);
  });

  it('starts from the switches kept for the whole PC', () => {
    localStorage.setItem(HOME_GROUP_ACTIVITY_VISIBLE_STORAGE_KEY, 'false');
    renderSettings();
    expect(panelSwitch('Group Activity')).not.toBeChecked();
  });

  it('switches a panel off for this account', () => {
    renderSettings();
    fireEvent.click(panelSwitch('Featured Q-Apps'));

    expect(panelSwitch('Featured Q-Apps')).not.toBeChecked();
    expect(stored()).toEqual({
      hidden: ['featured'],
      stack: ['widgets', 'groupActivity', 'feed'],
    });
  });

  it('moves the panels under the top part', () => {
    renderSettings();
    expect(
      screen.getByRole('button', { name: 'Move Widgets up' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Move Torq Feed down' })
    ).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Move Widgets down' }));
    expect(stackTitles()).toEqual(['Group Activity', 'Widgets', 'Torq Feed']);

    fireEvent.click(screen.getByRole('button', { name: 'Move Torq Feed up' }));
    expect(stackTitles()).toEqual(['Group Activity', 'Torq Feed', 'Widgets']);
    expect(stored().stack).toEqual(['groupActivity', 'feed', 'widgets']);
  });

  it('resets to the default layout', () => {
    renderSettings();
    const reset = screen.getByRole('button', { name: 'Reset to default' });
    expect(reset).toBeDisabled();

    fireEvent.click(panelSwitch('Qortino'));
    fireEvent.click(screen.getByRole('button', { name: 'Move Widgets down' }));
    expect(reset).toBeEnabled();

    fireEvent.click(reset);
    expect(panelSwitch('Qortino')).toBeChecked();
    expect(stackTitles()).toEqual(['Widgets', 'Group Activity', 'Torq Feed']);
    expect(reset).toBeDisabled();
  });

  it('changes nothing without an account', () => {
    renderSettings(null);
    expect(panelSwitch('Qortino')).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Move Widgets down' })
    ).toBeDisabled();
  });
});
