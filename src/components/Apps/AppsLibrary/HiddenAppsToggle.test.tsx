import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import i18n from 'i18next';
import { I18nextProvider } from 'react-i18next';
import {
  availableQappsAtom,
  HIDE_HIDDEN_APPS_STORAGE_KEY,
  hiddenAppsAtom,
  hideHiddenAppsAtom,
} from '../../../atoms/appsAtoms';
import { appKey } from '../AppPage/appHidden';
import { HiddenAppsToggle } from './HiddenAppsToggle';

i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { core: {} } } });

const LIBRARY = [
  { service: 'APP', name: 'Q-Blog' },
  { service: 'APP', name: 'Mine' },
  { service: 'APP', name: 'Q-Tube' },
];

const listed = (store: ReturnType<typeof createStore>) =>
  store.get(availableQappsAtom).map((app) => app.name);

const newStore = () => {
  const store = createStore();
  store.set(availableQappsAtom, LIBRARY);
  store.set(hiddenAppsAtom, {
    hidden: new Set([appKey('APP', 'Q-Blog'), appKey('APP', 'Mine')]),
    ownNames: ['Mine'],
  });
  return store;
};

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('the library’s choice about apps their publishers hid', () => {
  it('leaves them out unless the user turns it off', () => {
    const store = newStore();
    expect(store.get(hideHiddenAppsAtom)).toBe(true);
    // The user's own hidden app stays listed for them.
    expect(listed(store)).toEqual(['Mine', 'Q-Tube']);

    store.set(hideHiddenAppsAtom, false);
    expect(listed(store)).toEqual(['Q-Blog', 'Mine', 'Q-Tube']);
  });

  it('is kept on this device', () => {
    newStore().set(hideHiddenAppsAtom, false);
    expect(localStorage.getItem(HIDE_HIDDEN_APPS_STORAGE_KEY)).toBe('show');
    // A new start reads it back.
    expect(listed(newStore())).toEqual(['Q-Blog', 'Mine', 'Q-Tube']);

    newStore().set(hideHiddenAppsAtom, true);
    expect(listed(newStore())).toEqual(['Mine', 'Q-Tube']);
  });
});

describe('the eye button', () => {
  it('turns it off and on, and says which it is', () => {
    const store = newStore();
    render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <HiddenAppsToggle />
        </I18nextProvider>
      </Provider>
    );
    const button = screen.getByRole('button', {
      name: 'app_page.hide.library_toggle',
    });
    expect(button).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(listed(store)).toEqual(['Q-Blog', 'Mine', 'Q-Tube']);

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(listed(store)).toEqual(['Mine', 'Q-Tube']);
  });
});
