import { describe, expect, it } from 'vitest';
import {
  appNameOf,
  appOffHubZoom,
  appTabOnScreen,
  formatZoomPercent,
  isInHubWindow,
  isNormalZoom,
  type HubZoomState,
} from './hubZoom';

const state = (hub: number, app: number | null): HubZoomState => ({
  hub: { level: hub, canIn: true, canOut: true },
  app: app === null ? null : { level: app, canIn: true, canOut: true },
});

describe('appTabOnScreen', () => {
  const tab = { tabId: 't1', name: 'Opened-App', service: 'APP' };

  it('is the tab of a Q-App or website shown in apps or dev mode', () => {
    expect(appTabOnScreen('apps', tab)).toBe('t1');
    expect(appTabOnScreen('dev', tab)).toBe('t1');
  });

  it('is nothing on Home, Q-Chat, a launcher tab or Hub’s own tabs', () => {
    expect(appTabOnScreen('home', tab)).toBeNull();
    expect(appTabOnScreen('chat', tab)).toBeNull();
    expect(
      appTabOnScreen('apps', { tabId: 't2', internal: 'launcher' })
    ).toBeNull();
    expect(
      appTabOnScreen('apps', { tabId: 't3', name: 'chat', service: 'INTERNAL' })
    ).toBeNull();
    expect(appTabOnScreen('apps', null)).toBeNull();
    expect(appTabOnScreen('apps', { name: 'Opened-App' })).toBeNull();
  });
});

describe('appNameOf', () => {
  it('names a private app by its own name', () => {
    expect(
      appNameOf({
        name: 'Publisher',
        privateAppProperties: { appName: 'Tools' },
      })
    ).toBe('Tools');
    expect(appNameOf({ name: 'Opened-App' })).toBe('Opened-App');
    expect(appNameOf(null)).toBe('');
  });
});

describe('isInHubWindow', () => {
  it('is true inside one of Hub’s windows, dialogs or menus', () => {
    const modal = document.createElement('div');
    modal.className = 'MuiModal-root MuiDialog-root';
    const field = document.createElement('input');
    modal.appendChild(field);
    document.body.appendChild(modal);
    const outside = document.createElement('input');
    document.body.appendChild(outside);

    expect(isInHubWindow(field)).toBe(true);
    expect(isInHubWindow(outside)).toBe(false);
    expect(isInHubWindow(null)).toBe(false);
    modal.remove();
    outside.remove();
  });
});

describe('formatZoomPercent', () => {
  it('writes the zoom as a percent, in the language’s own way', () => {
    expect(formatZoomPercent(0, 'en')).toBe('100%');
    expect(formatZoomPercent(0.5, 'en')).toBe('110%');
    expect(formatZoomPercent(-0.5, 'en')).toBe('91%');
    expect(formatZoomPercent(1, 'de')).toBe('120 %');
    // Arabic as this ICU writes it, with its direction marks.
    expect(formatZoomPercent(0, 'ar')).toMatch(/(100|\u0661\u0660\u0660)/);
    expect(formatZoomPercent(0, 'ar')).not.toBe('100%');
    expect(formatZoomPercent(1, 'not a language!')).toBe('120%');
  });
});

describe('appOffHubZoom', () => {
  it('is true for an app on screen off Hub’s zoom', () => {
    expect(appOffHubZoom('t1', state(0, 0.5))).toBe(true);
    expect(appOffHubZoom('t1', state(1, -0.5))).toBe(true);
    // At Hub's zoom, whatever Hub's is.
    expect(appOffHubZoom('t1', state(1, 0))).toBe(false);
    // Its app not known yet.
    expect(appOffHubZoom('t1', state(1, null))).toBe(false);
  });

  it('is false for Hub’s own zoom, with no app on screen', () => {
    expect(appOffHubZoom(null, state(1, null))).toBe(false);
    expect(appOffHubZoom(null, state(0, null))).toBe(false);
    expect(appOffHubZoom(null, null)).toBe(false);
  });

  it('takes a level that small as normal', () => {
    expect(isNormalZoom(0.0004)).toBe(true);
    expect(isNormalZoom(0.5)).toBe(false);
  });
});
