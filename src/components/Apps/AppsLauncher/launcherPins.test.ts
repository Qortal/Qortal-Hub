import { describe, expect, it } from 'vitest';
import {
  buildLauncherPins,
  launcherPinLabel,
  toStoredPin,
} from './launcherPins';

const library = [
  {
    name: 'Q-Mail',
    service: 'APP',
    metadata: { title: 'Q-Mail' },
    status: { status: 'READY' },
  },
  { name: 'Q-Tube', service: 'APP', metadata: { title: 'Q-Tube video' } },
  { name: 'Simon', service: 'APP', metadata: { title: 'Simon app' } },
  { name: 'Simon', service: 'WEBSITE', metadata: { title: 'Simon site' } },
];

const privatePin = {
  isPrivate: true,
  isPreview: true,
  privateAppProperties: {
    name: 'Q-Minter',
    service: 'DOCUMENT',
    identifier: 'Minter Helper',
    groupId: 12,
    appName: 'Minter Helper',
    logo: 'data:image/png;base64,AAAA',
  },
};

describe('buildLauncherPins', () => {
  it('keeps the saved order and adds what the library knows', () => {
    const pins = buildLauncherPins(
      [
        { name: 'Q-Tube', service: 'APP' },
        { name: 'Q-Mail', service: 'APP' },
      ],
      library
    );
    expect(pins.map((pin) => pin.key)).toEqual(['APP-Q-Tube', 'APP-Q-Mail']);
    expect(pins[0].app.metadata).toEqual({ title: 'Q-Tube video' });
    expect(pins[1].app.status).toEqual({ status: 'READY' });
    expect(pins.every((pin) => !pin.isMine)).toBe(true);
  });

  it('shows a pin the library does not list yet', () => {
    const pins = buildLauncherPins([{ name: 'New-App', service: 'APP' }], []);
    expect(pins).toEqual([
      {
        key: 'APP-New-App',
        app: { name: 'New-App', service: 'APP' },
        isMine: false,
      },
    ]);
  });

  it('puts the account’s own app and website first', () => {
    const pins = buildLauncherPins(
      [{ name: 'Q-Mail', service: 'APP' }],
      library,
      library[2],
      library[3]
    );
    expect(pins.map((pin) => [pin.key, pin.isMine])).toEqual([
      ['APP-Simon', true],
      ['WEBSITE-Simon', true],
      ['APP-Q-Mail', false],
    ]);
  });

  it('leaves the account’s own app where it was pinned', () => {
    const pins = buildLauncherPins(
      [
        { name: 'Q-Mail', service: 'APP' },
        { name: 'Simon', service: 'APP' },
      ],
      library,
      library[2]
    );
    expect(pins.map((pin) => [pin.key, pin.isMine])).toEqual([
      ['APP-Q-Mail', false],
      ['APP-Simon', true],
    ]);
  });

  it('keeps private apps and drops entries that cannot open', () => {
    const pins = buildLauncherPins(
      [
        privatePin,
        {},
        { isPrivate: true, privateAppProperties: { name: 'x' } },
        null as never,
        { name: 'Q-Mail', service: 'APP' },
      ],
      library
    );
    expect(pins.map((pin) => pin.key)).toEqual([
      'private-DOCUMENT-Q-Minter-Minter Helper',
      'APP-Q-Mail',
    ]);
    expect(pins[0].app).toBe(privatePin);
  });

  it('shows an app pinned twice only once', () => {
    const pins = buildLauncherPins(
      [
        { name: 'Q-Mail', service: 'APP' },
        { name: 'Q-Mail', service: 'APP' },
      ],
      library
    );
    expect(pins).toHaveLength(1);
  });

  it('accepts a missing list', () => {
    expect(buildLauncherPins(null, null)).toEqual([]);
  });
});

describe('toStoredPin', () => {
  it('keeps only the service and name of a public app', () => {
    expect(
      toStoredPin({ ...library[0], isMine: true } as Record<string, unknown>)
    ).toEqual({ name: 'Q-Mail', service: 'APP' });
  });

  it('keeps what a private app needs, logo included', () => {
    expect(toStoredPin({ ...privatePin, extra: 1 })).toEqual(privatePin);
  });
});

describe('launcherPinLabel', () => {
  it('prefers the title, then the name', () => {
    expect(launcherPinLabel(library[1], 'Private')).toBe('Q-Tube video');
    expect(
      launcherPinLabel({ name: 'Q-Fund', service: 'APP' }, 'Private')
    ).toBe('Q-Fund');
  });

  it('names a private app, or falls back', () => {
    expect(launcherPinLabel(privatePin, 'Private')).toBe('Minter Helper');
    expect(
      launcherPinLabel(
        { isPrivate: true, privateAppProperties: { name: 'n' } },
        'Private'
      )
    ).toBe('Private');
  });
});
