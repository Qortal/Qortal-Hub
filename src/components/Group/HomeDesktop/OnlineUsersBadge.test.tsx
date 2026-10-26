import { act, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { Provider, createStore } from 'jotai';
import { Profiler } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { onlineAddressesAtom } from '../../../atoms/presence';
import { OnlineUsersBadge } from './OnlineUsersBadge';

const i18n = createInstance();
i18n.init({
  fallbackLng: 'en',
  initImmediate: false,
  interpolation: { escapeValue: false },
  lng: 'en',
  resources: {
    en: {
      group: {
        dashboard: {
          online_users_count: 'Online users',
          online_users_count_value: '{{count}} online',
        },
      },
    },
  },
});

describe('OnlineUsersBadge', () => {
  it('isolates online-count updates from its parent', () => {
    const store = createStore();
    const onRender = vi.fn();
    const parentRender = vi.fn();

    const Parent = () => {
      parentRender();
      return (
        <Profiler id="online-users-badge" onRender={onRender}>
          <OnlineUsersBadge />
        </Profiler>
      );
    };

    render(
      <I18nextProvider i18n={i18n}>
        <Provider store={store}>
          <Parent />
        </Provider>
      </I18nextProvider>
    );

    expect(screen.getByText('0 online')).toBeInTheDocument();
    expect(parentRender).toHaveBeenCalledTimes(1);
    const initialBadgeRenderCount = onRender.mock.calls.length;

    act(() => {
      store.set(onlineAddressesAtom, new Set(['Q-one']));
    });

    expect(screen.getByText('1 online')).toBeInTheDocument();
    expect(parentRender).toHaveBeenCalledTimes(1);
    expect(onRender).toHaveBeenCalledTimes(initialBadgeRenderCount + 1);

    act(() => {
      store.set(onlineAddressesAtom, new Set(['Q-two']));
    });

    expect(screen.getByText('1 online')).toBeInTheDocument();
    expect(parentRender).toHaveBeenCalledTimes(1);
    expect(onRender).toHaveBeenCalledTimes(initialBadgeRenderCount + 1);
  });
});
