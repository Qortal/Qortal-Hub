import { describe, expect, it } from 'vitest';
import {
  APP_PAGE_LIMITS,
  appPageFitsQdn,
  EMPTY_APP_PAGE,
  isAppPageEmpty,
  isVersionCurrent,
  normalizeAppLink,
  parseAppPage,
  parseShotsManifest,
  sameAppPage,
  serializeAppPage,
  serializeShotsManifest,
  suggestNextVersion,
} from './appPageData';

const SIGNATURE =
  '5HaYMw82wjG8k2Ddq6ccr7hDcjz58hK2GjhFzVbSKMFDE8hRqkG3QXQrNNLmmKZN';

describe('normalizeAppLink', () => {
  it('keeps web and qortal links', () => {
    expect(normalizeAppLink(' https://qortal.dev/docs ')).toBe(
      'https://qortal.dev/docs'
    );
    expect(normalizeAppLink('QORTAL://APP/Q-Tube')).toBe('qortal://APP/Q-Tube');
  });

  it('refuses other schemes, spaces and empty values', () => {
    expect(normalizeAppLink('javascript:alert(1)')).toBeNull();
    expect(normalizeAppLink('data:text/html,hi')).toBeNull();
    expect(normalizeAppLink('file:///etc/passwd')).toBeNull();
    expect(normalizeAppLink('https://a b.com')).toBeNull();
    expect(normalizeAppLink('')).toBeNull();
    expect(normalizeAppLink(42)).toBeNull();
    expect(normalizeAppLink(`https://x.com/${'a'.repeat(400)}`)).toBeNull();
  });
});

describe('the page record', () => {
  const page = {
    about: 'A longer story',
    whatsNew: 'Fixed the feed',
    version: '1.4.2',
    links: { website: 'https://example.com/', support: 'qortal://APP/Q-Mail' },
    appSignature: SIGNATURE,
    updated: 1700000000000,
  };

  it('survives a round trip', () => {
    const json = serializeAppPage(page, { service: 'app', name: 'Q-Blog' });
    expect(JSON.parse(json)).toMatchObject({
      v: 1,
      app: { service: 'APP', name: 'Q-Blog' },
    });
    expect(parseAppPage(json)).toEqual(page);
  });

  it('drops unsafe links and cuts long text when reading', () => {
    const parsed = parseAppPage({
      v: 1,
      about: 'x'.repeat(APP_PAGE_LIMITS.about + 50),
      links: { website: 'javascript:evil()', source: 'https://git.example' },
      appSignature: 'not a signature',
    });
    expect(parsed.about).toHaveLength(APP_PAGE_LIMITS.about);
    expect(parsed.links).toEqual({ source: 'https://git.example/' });
    expect(parsed.appSignature).toBe('');
  });

  it('refuses other versions and non-objects', () => {
    expect(parseAppPage({ v: 2, about: 'x' })).toBeNull();
    expect(parseAppPage('not json')).toBeNull();
    expect(parseAppPage([1, 2])).toBeNull();
  });

  it('knows when a page fits in a JSON resource', () => {
    expect(
      appPageFitsQdn(serializeAppPage(page, { service: 'APP', name: 'A' }))
    ).toBe(true);
    expect(appPageFitsQdn('ж'.repeat(13000))).toBe(false);
  });

  it('compares pages by what is shown', () => {
    expect(sameAppPage(page, { ...page, about: ' A longer story ' })).toBe(
      true
    );
    expect(sameAppPage(page, { ...page, version: '1.4.3' })).toBe(false);
    expect(sameAppPage(null, EMPTY_APP_PAGE)).toBe(true);
    expect(isAppPageEmpty(EMPTY_APP_PAGE)).toBe(true);
    expect(isAppPageEmpty(page)).toBe(false);
  });

  it('marks the version older once the app was published again', () => {
    expect(isVersionCurrent(page, SIGNATURE)).toBe(true);
    expect(isVersionCurrent(page, `${SIGNATURE}x`)).toBe(false);
    expect(isVersionCurrent({ ...page, appSignature: '' }, 'anything')).toBe(
      true
    );
    expect(isVersionCurrent(page, undefined)).toBe(true);
  });
});

describe('suggestNextVersion', () => {
  it('raises the last number', () => {
    expect(suggestNextVersion('1.4.2')).toBe('1.4.3');
    expect(suggestNextVersion('v9')).toBe('v10');
    expect(suggestNextVersion('2.0.09')).toBe('2.0.10');
    expect(suggestNextVersion('3.1-beta2')).toBe('3.1-beta3');
    expect(suggestNextVersion('1.0 final')).toBe('1.1 final');
  });

  it('leaves versions without numbers alone', () => {
    expect(suggestNextVersion('beta')).toBe('beta');
    expect(suggestNextVersion('')).toBe('');
  });
});

describe('the screenshot list', () => {
  it('keeps valid entries only, at most five', () => {
    const manifest = parseShotsManifest({
      v: 1,
      updated: 5,
      shots: [
        { file: '1.webp', caption: 'Home', width: 1280, height: 800 },
        { file: '../../etc/passwd' },
        { file: '1.webp' },
        { file: '2.png', caption: 7 },
        { file: '3.webp' },
        { file: '4.webp' },
        { file: '5.webp' },
        { file: '6.webp' },
      ],
    });
    expect(manifest.shots.map((shot) => shot.file)).toEqual([
      '1.webp',
      '2.png',
      '3.webp',
      '4.webp',
      '5.webp',
    ]);
    expect(manifest.shots[0]).toEqual({
      file: '1.webp',
      caption: 'Home',
      width: 1280,
      height: 800,
    });
    expect(manifest.shots[1].caption).toBe('');
  });

  it('writes what it reads', () => {
    const json = serializeShotsManifest(
      [{ file: '1.webp', caption: ' Feed ', width: 10, height: 5 }],
      { service: 'WEBSITE', name: 'Site' },
      42
    );
    expect(parseShotsManifest(json)).toEqual({
      shots: [{ file: '1.webp', caption: 'Feed', width: 10, height: 5 }],
      updated: 42,
    });
    expect(parseShotsManifest('{"v":1}')).toBeNull();
  });
});
