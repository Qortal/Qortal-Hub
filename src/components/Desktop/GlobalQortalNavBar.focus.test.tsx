import { ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import i18n from '../../i18n/i18n';
import { userInfoAtom } from '../../atoms/global';
import { lightTheme } from '../../styles/theme-light';
import { executeEvent } from '../../utils/events';
import { GlobalQortalNavBar } from './GlobalQortalNavBar';

// The bar's other widgets are not under test here.
vi.mock('../QMailStatus', () => ({ QMailStatus: () => null }));
vi.mock('../GeneralNotifications', () => ({
  GeneralNotifications: () => null,
}));
vi.mock('../TaskManager/TaskManager', () => ({ TaskManager: () => null }));
vi.mock('../GlobalActions/GlobalActions', () => ({
  GlobalActions: () => null,
}));
vi.mock('./SubscriptionsStatus', () => ({ SubscriptionsStatus: () => null }));
vi.mock('../Apps/AppBookmarks', () => ({ AppBookmarksButton: () => null }));
vi.mock('../../utils/globalApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/globalApi')>()),
  getBaseApiReact: () => 'http://node.test',
  getBaseApiReactForAvatar: () => 'http://node.test',
}));

const renderBar = () => {
  const store = createStore();
  store.set(userInfoAtom, { address: 'QViewer', name: 'Viewer' });
  const view = render(
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <GlobalQortalNavBar desktopViewMode="apps" />
      </ThemeProvider>
    </Provider>
  );
  const input = screen.getByPlaceholderText(
    i18n.t('core:navbar.search_placeholder')
  ) as HTMLInputElement;
  return { input, unmount: view.unmount };
};

describe('GlobalQortalNavBar on Ctrl+L', () => {
  it('focuses the search field and selects its text', () => {
    const { input } = renderBar();
    fireEvent.change(input, { target: { value: 'q-mail' } });
    expect(document.activeElement).not.toBe(input);

    act(() => executeEvent('focusNavInput', {}));

    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 6]);

    // Pressed again while the field has focus, it selects the text again.
    input.setSelectionRange(6, 6);
    act(() => executeEvent('focusNavInput', {}));
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 6]);
  });

  it('stops listening when the bar goes away', () => {
    const removeListener = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderBar();

    unmount();

    expect(removeListener).toHaveBeenCalledWith(
      'focusNavInput',
      expect.any(Function)
    );
    removeListener.mockRestore();
  });
});
