import { describe, expect, it } from 'vitest';
import { qappGuestPartition, qappGuestUrlAllowed } from './qapp-guest-policy';

const owner = { tabId: 'tab-1', service: 'APP', name: 'a-test-2' };
const initial = 'https://127.0.0.1:12391/render/APP/a-test-2/?theme=dark';

describe('Q-App guest isolation policy', () => {
  it.each([
    'Q-Mail+',
    'Q-Shop+',
    'Q-App@Home',
    'Q-App&Test',
    'Qortal World',
    'Café',
  ])(
    'accepts equivalent URL spellings for %s without changing its storage partition',
    (name) => {
      const app = { ...owner, name };
      const origin = 'https://127.0.0.1:12391';
      const literal = `${origin}/render/APP/${name}/`;
      const encoded = `${origin}/render/APP/${encodeURIComponent(name)}/`;
      for (const start of [literal, encoded]) {
        for (const next of [literal, encoded]) {
          expect(
            qappGuestUrlAllowed(
              start,
              `${next}inbox?theme=dark#mail`,
              app,
              false
            )
          ).toBe(true);
        }
      }
      expect(qappGuestPartition(new URL(literal).origin, app)).toBe(
        qappGuestPartition(new URL(encoded).origin, app)
      );
    }
  );

  it('keeps decoded app identity and segment boundaries exact', () => {
    const app = { ...owner, name: 'Q-Mail+' };
    const origin = 'https://127.0.0.1:12391';
    const start = `${origin}/render/APP/Q-Mail+/`;
    for (const next of [
      '/render/APP/Q-Mail%2b/inbox',
      '/render/%41PP/Q-Mail+/inbox',
    ]) {
      expect(qappGuestUrlAllowed(start, origin + next, app, false)).toBe(true);
    }
    for (const next of [
      '/render/APP/Q-Mail+evil/',
      '/render/APP/Q-Mail%2Bevil/',
      '/render/APP/Q-Mail%252B/',
      '/render/APP/Q-Mail%20/',
      '/render/APP/Q-Mail+%2Fother/',
      '/render/APP/Q-Mail+%5Cother/',
      '/render/APP/Q-Mail%/',
      '/render/APP/Q-Mail%FF/',
      '/render/APP/Q-Mail+/../other/',
      '/render/APP/Q-Mail+/%2e%2e/other/',
      '/render/APP/Q-Mail+/..\\other/',
      '/render/WEBSITE/Q-Mail+/',
      '/render/APP/other/',
      '/render/APP',
      '/render/APP/',
      '/apps/q-apps.js',
    ]) {
      expect(qappGuestUrlAllowed(start, origin + next, app, false)).toBe(false);
    }
    expect(
      qappGuestUrlAllowed(
        start,
        'https://attacker.example/render/APP/Q-Mail+/',
        app,
        false
      )
    ).toBe(false);
  });

  it('decodes literal percent sequences only once', () => {
    const app = { ...owner, name: 'literal%2B' };
    const start = 'https://core.example/render/APP/literal%252B/';
    expect(qappGuestUrlAllowed(start, `${start}route`, app, false)).toBe(true);
    expect(
      qappGuestUrlAllowed(
        start,
        'https://core.example/render/APP/literal%2B/',
        app,
        false
      )
    ).toBe(false);
    expect(
      qappGuestUrlAllowed(
        start,
        'https://core.example/render/APP/literal+/',
        app,
        false
      )
    ).toBe(false);
  });

  it('retains preview hash and developer-origin restrictions', () => {
    const preview = 'https://core.example/render/hash/abc123/';
    expect(qappGuestUrlAllowed(preview, `${preview}route`, owner, false)).toBe(
      true
    );
    expect(
      qappGuestUrlAllowed(
        preview,
        'https://core.example/render/hash/other/',
        owner,
        false
      )
    ).toBe(false);
    expect(
      qappGuestUrlAllowed(
        preview,
        'https://core.example/render/APP/a-test-2/',
        owner,
        false
      )
    ).toBe(false);
    const dev = 'http://localhost:5173/';
    expect(qappGuestUrlAllowed(dev, `${dev}route`, owner, true)).toBe(true);
    expect(
      qappGuestUrlAllowed(dev, 'http://localhost:5174/route', owner, true)
    ).toBe(false);
    expect(qappGuestUrlAllowed(dev, 'file:///tmp/secret', owner, true)).toBe(
      false
    );
  });

  it('keeps browser storage separate for different apps on one Core origin', () => {
    const origin = 'https://127.0.0.1:12391';
    expect(qappGuestPartition(origin, owner)).toBe(
      qappGuestPartition(origin, { ...owner, tabId: 'tab-2' })
    );
    expect(qappGuestPartition(origin, owner)).not.toBe(
      qappGuestPartition(origin, { ...owner, name: 'other-app' })
    );
    expect(qappGuestPartition(origin, owner)).not.toBe(
      qappGuestPartition('https://127.0.0.1:12392', owner)
    );
  });

  it('allows routes within the app and blocks navigation into another app', () => {
    expect(
      qappGuestUrlAllowed(initial, `${initial}#call=1`, owner, false)
    ).toBe(true);
    expect(
      qappGuestUrlAllowed(
        initial,
        'https://127.0.0.1:12391/render/APP/a-test-2/call/123',
        owner,
        false
      )
    ).toBe(true);
    expect(
      qappGuestUrlAllowed(
        initial,
        'https://127.0.0.1:12391/render/APP/other-app/',
        owner,
        false
      )
    ).toBe(false);
    expect(
      qappGuestUrlAllowed(
        initial,
        'https://127.0.0.1:12391/render/APP/a-test-2-evil/',
        owner,
        false
      )
    ).toBe(false);
    expect(
      qappGuestUrlAllowed(
        initial,
        'https://attacker.example/render/APP/a-test-2/',
        owner,
        false
      )
    ).toBe(false);
    expect(
      qappGuestUrlAllowed(initial, 'file:///tmp/secret', owner, false)
    ).toBe(false);
    expect(
      qappGuestUrlAllowed(
        'https://127.0.0.1:12391/render/hash/abc123/',
        'https://127.0.0.1:12391/render/APP/other-app/',
        owner,
        false
      )
    ).toBe(false);
  });
});
