import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { userInfoAtom } from '../../atoms/global';
import {
  isHomePanelShown,
  readHomeLayout,
  saveHomeLayout,
  withHomePanelShown,
} from '../Group/HomeDesktop/homeLayout';
import {
  HOME_WIDGET_LIMIT,
  homeWidgetKey,
  savedHomeWidgetsAtom,
} from './homeWidgets';
import { useWidgetOnHome } from './useWidgetOnHome';

const NOW = { name: 'Q-Weather', identifier: 'go-widget-now', title: 'Now' };

const renderOnHome = (widget: typeof NOW | null = NOW, address = 'QMe') => {
  const store = createStore();
  store.set(userInfoAtom, { address });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return { store, ...renderHook(() => useWidgetOnHome(widget), { wrapper }) };
};

describe('useWidgetOnHome', () => {
  beforeEach(() => localStorage.clear());

  it('puts the widget in Home’s list once, and takes it off', () => {
    const { result, store } = renderOnHome();
    expect(result.current.onHome).toBe(false);

    let change: string | undefined;
    act(() => {
      change = result.current.add();
    });
    expect(change).toBe('added');
    expect(result.current.onHome).toBe(true);
    const saved = store.get(savedHomeWidgetsAtom);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      name: 'Q-Weather',
      identifier: 'go-widget-now',
      title: 'Now',
      sizedBy: 'default',
    });

    act(() => {
      change = result.current.add();
    });
    expect(change).toBe('unchanged');
    expect(store.get(savedHomeWidgetsAtom)).toHaveLength(1);

    act(() => {
      change = result.current.remove();
    });
    expect(change).toBe('removed');
    expect(result.current.onHome).toBe(false);
    expect(store.get(savedHomeWidgetsAtom)).toEqual([]);
  });

  it('shows Home’s Widgets window when the account had hidden it', () => {
    saveHomeLayout(
      'QMe',
      withHomePanelShown(readHomeLayout('QMe'), 'widgets', false)
    );
    expect(isHomePanelShown(readHomeLayout('QMe'), 'widgets')).toBe(false);
    const { result } = renderOnHome();
    act(() => {
      result.current.add();
    });
    expect(isHomePanelShown(readHomeLayout('QMe'), 'widgets')).toBe(true);
  });

  it('keeps to Home’s limit', () => {
    const { result, store } = renderOnHome();
    act(() =>
      store.set(
        savedHomeWidgetsAtom,
        Array.from({ length: HOME_WIDGET_LIMIT }, (_, index) => ({
          name: `W${index}`,
          identifier: null,
          x: 0,
          y: index * 5,
          w: 4,
          h: 5,
          sizedBy: 'default' as const,
        }))
      )
    );
    expect(result.current.full).toBe(true);
    let change: string | undefined;
    act(() => {
      change = result.current.add();
    });
    expect(change).toBe('full');
    expect(
      store
        .get(savedHomeWidgetsAtom)
        .some((saved) => homeWidgetKey(saved) === homeWidgetKey(NOW))
    ).toBe(false);
  });

  it('does nothing without a widget', () => {
    const { result } = renderOnHome(null);
    let change: string | undefined;
    act(() => {
      change = result.current.add();
    });
    expect(change).toBe('unchanged');
    expect(result.current.onHome).toBe(false);
  });
});
