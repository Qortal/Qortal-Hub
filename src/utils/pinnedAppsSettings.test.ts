import { describe, expect, it } from 'vitest';
import {
  getPinnedAppKey,
  isBrokenPinnedApp,
  mergePinnedApps,
  removeBrokenPinnedApps,
  serializePinnedAppsForQdn,
} from './pinnedAppsSettings';

const publicApp = { name: 'Q-Tube', service: 'APP', metadata: { title: 'x' } };

const privateApp = (identifier: string) => ({
  isPrivate: true,
  isPreview: true,
  privateAppProperties: {
    name: 'alice',
    service: 'DOCUMENT',
    identifier,
    groupId: 7,
    appName: 'Pinnic',
    logo: 'data:image/png;base64,AAAA',
  },
});

describe('pinnedAppsSettings', () => {
  it('keeps everything a private app needs to reopen, without the logo', () => {
    expect(
      serializePinnedAppsForQdn([publicApp, privateApp('pinnic')])
    ).toEqual([
      { name: 'Q-Tube', service: 'APP' },
      {
        isPrivate: true,
        isPreview: true,
        privateAppProperties: {
          name: 'alice',
          service: 'DOCUMENT',
          identifier: 'pinnic',
          groupId: 7,
          appName: 'Pinnic',
        },
      },
    ]);
  });

  it('survives a JSON round trip as a usable private pin', () => {
    const [restored] = JSON.parse(
      JSON.stringify(serializePinnedAppsForQdn([privateApp('pinnic')]))
    );

    expect(isBrokenPinnedApp(restored)).toBe(false);
    expect(restored.privateAppProperties.groupId).toBe(7);
  });

  it('treats the empty entries older versions saved as broken', () => {
    expect(isBrokenPinnedApp({})).toBe(true);
    expect(isBrokenPinnedApp(null)).toBe(true);
    expect(
      isBrokenPinnedApp({ isPrivate: true, privateAppProperties: {} })
    ).toBe(true);
    expect(isBrokenPinnedApp(publicApp)).toBe(false);
    expect(isBrokenPinnedApp(privateApp('pinnic'))).toBe(false);
  });

  it('drops broken entries when restoring and saving', () => {
    const pinned = [{}, publicApp, {}, privateApp('pinnic')];

    expect(removeBrokenPinnedApps(pinned)).toEqual([
      publicApp,
      privateApp('pinnic'),
    ]);
    expect(serializePinnedAppsForQdn(pinned)).toHaveLength(2);
  });

  it('gives each private app its own key', () => {
    const keys = [privateApp('pinnic'), privateApp('notes'), publicApp].map(
      getPinnedAppKey
    );

    expect(new Set(keys).size).toBe(3);
    expect(getPinnedAppKey(publicApp)).toBe('APP-Q-Tube');
  });
});

describe('keeping the pins of another device', () => {
  const pin = (name: string) => ({ name, service: 'APP' });

  it('adds the saved ones this device does not have, at the end', () => {
    expect(
      mergePinnedApps([pin('Q-Tube'), pin('Q-Blog')], [pin('Q-Mail')])
    ).toEqual([pin('Q-Tube'), pin('Q-Blog'), pin('Q-Mail')]);
  });

  it("keeps this device's own order, and each app once", () => {
    expect(
      mergePinnedApps(
        [pin('Q-Blog'), pin('Q-Tube')],
        [pin('Q-Tube'), pin('Q-Blog')]
      )
    ).toEqual([pin('Q-Blog'), pin('Q-Tube')]);
  });

  it('tells a private app of another by what it opens', () => {
    const mine = privateApp('mine');
    const theirs = privateApp('theirs');

    expect(mergePinnedApps([mine], [privateApp('mine'), theirs])).toEqual([
      mine,
      theirs,
    ]);
  });

  it('leaves out broken entries, and takes nothing for no list', () => {
    expect(mergePinnedApps([pin('Q-Tube'), {}], [{}, pin('Q-Mail')])).toEqual([
      pin('Q-Tube'),
      pin('Q-Mail'),
    ]);
    expect(mergePinnedApps([pin('Q-Tube')], null)).toEqual([pin('Q-Tube')]);
    expect(mergePinnedApps(null, undefined)).toEqual([]);
  });
});
