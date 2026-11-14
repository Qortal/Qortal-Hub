import { describe, expect, it } from 'vitest';
import {
  APPS_BAR_NAME_MAX_LENGTH,
  EMPTY_APPS_BAR_SETTINGS,
  appsBarSettingsOf,
  parseAppsBarSettings,
  withAppsBarSettings,
  withItemName,
} from './appsBarSettings';

describe('what the apps bar remembers', () => {
  it('starts off, with names showing', () => {
    expect(parseAppsBarSettings(undefined)).toEqual({
      enabled: false,
      showNames: true,
      names: {},
    });
  });

  it('keeps only what has the right shape', () => {
    expect(parseAppsBarSettings('on')).toEqual(EMPTY_APPS_BAR_SETTINGS);
    expect(parseAppsBarSettings([1, 2])).toEqual(EMPTY_APPS_BAR_SETTINGS);
    expect(
      parseAppsBarSettings({ enabled: 'yes', showNames: false, names: 'none' })
    ).toEqual({ enabled: false, showNames: false, names: {} });
  });

  it('shows names unless they were turned off', () => {
    expect(parseAppsBarSettings({ showNames: 0 }).showNames).toBe(true);
    expect(parseAppsBarSettings({}).showNames).toBe(true);
  });

  it('keeps only the names that are text', () => {
    expect(
      parseAppsBarSettings({
        names: { 'pin:APP-Q-Tube': 'Tube', 'pin:APP-Q-Mail': 7 },
      }).names
    ).toEqual({ 'pin:APP-Q-Tube': 'Tube' });
  });

  it('cuts a stored name that is too long', () => {
    const long = 'x'.repeat(APPS_BAR_NAME_MAX_LENGTH + 10);

    expect(parseAppsBarSettings({ names: { a: long } }).names.a).toHaveLength(
      APPS_BAR_NAME_MAX_LENGTH
    );
  });

  it('gives an account with nothing stored the empty settings', () => {
    expect(appsBarSettingsOf({}, 'Qalice')).toEqual(EMPTY_APPS_BAR_SETTINGS);
    expect(appsBarSettingsOf(null, 'Qalice')).toEqual(EMPTY_APPS_BAR_SETTINGS);
    expect(
      appsBarSettingsOf(
        { Qalice: { ...EMPTY_APPS_BAR_SETTINGS, enabled: true } },
        null
      )
    ).toEqual(EMPTY_APPS_BAR_SETTINGS);
  });

  it('changes one account and leaves the others alone', () => {
    const stored = withAppsBarSettings(
      { Qbob: { enabled: true, showNames: false, names: {} } },
      'Qalice',
      { enabled: true }
    );

    expect(stored.Qalice).toEqual({
      enabled: true,
      showNames: true,
      names: {},
    });
    expect(stored.Qbob.showNames).toBe(false);
  });

  it('keeps the names while another setting changes', () => {
    const first = withItemName(EMPTY_APPS_BAR_SETTINGS, 'pin:APP-Q-Tube', 'TV');
    const stored = withAppsBarSettings({ Qalice: first }, 'Qalice', {
      showNames: false,
    });

    expect(stored.Qalice).toEqual({
      enabled: false,
      showNames: false,
      names: { 'pin:APP-Q-Tube': 'TV' },
    });
  });

  it('has nowhere to store an account that is not signed in', () => {
    expect(
      withAppsBarSettings({ Qbob: EMPTY_APPS_BAR_SETTINGS }, '', {})
    ).toEqual({ Qbob: EMPTY_APPS_BAR_SETTINGS });
  });
});

describe('the name the user gives an item', () => {
  it('is trimmed and kept', () => {
    expect(
      withItemName(EMPTY_APPS_BAR_SETTINGS, 'pin:APP-Q-Tube', '  Tube  ').names
    ).toEqual({ 'pin:APP-Q-Tube': 'Tube' });
  });

  it('is cut to what fits', () => {
    const name = 'x'.repeat(APPS_BAR_NAME_MAX_LENGTH + 5);

    expect(
      withItemName(EMPTY_APPS_BAR_SETTINGS, 'a', name).names.a
    ).toHaveLength(APPS_BAR_NAME_MAX_LENGTH);
  });

  it('can be empty, which shows the picture alone', () => {
    const settings = withItemName(EMPTY_APPS_BAR_SETTINGS, 'a', '   ');

    expect(settings.names).toEqual({ a: '' });
  });

  it('is given back by a null name', () => {
    const named = withItemName(EMPTY_APPS_BAR_SETTINGS, 'a', 'Tube');

    expect(withItemName(named, 'a', null).names).toEqual({});
  });

  it('changes nothing when an item that has none is given its own back', () => {
    const settings = withItemName(EMPTY_APPS_BAR_SETTINGS, 'a', 'Tube');

    expect(withItemName(settings, 'b', null)).toBe(settings);
  });

  it('needs an item to belong to', () => {
    expect(withItemName(EMPTY_APPS_BAR_SETTINGS, '', 'Tube')).toBe(
      EMPTY_APPS_BAR_SETTINGS
    );
  });
});
