import { describe, expect, it } from 'vitest';
import { buildAppRenderRoot } from './appRenderUrl';
import { qappGuestUrlAllowed } from '../../../electron/src/qapp-guest-policy';

const base = 'https://core.example';

describe('QApp render URL compatibility with guest isolation', () => {
  it('encodes the Q-Shop+ name that previously failed guest preparation', () => {
    const owner = { tabId: 'tab', service: 'APP', name: 'Q-Shop+' };
    const raw = `${base}/render/APP/Q-Shop+?theme=dark`;
    expect(qappGuestUrlAllowed(raw, raw, owner, false)).toBe(false);
    const root = buildAppRenderRoot(base, owner.service, owner.name);
    expect(root).toBe(`${base}/render/APP/Q-Shop%2B`);
    expect(qappGuestUrlAllowed(root, root, owner, false)).toBe(true);
  });

  it.each([
    'Q-Shop+',
    'Qortal Together',
    'Café',
    'literal%2B',
    'name#fragment',
    'name?query',
  ])(
    'keeps %s as one name through load, refresh and route navigation',
    (name) => {
      const owner = { tabId: 'tab', service: 'APP', name };
      const root = buildAppRenderRoot(base, owner.service, name);
      const paths = [
        '?theme=dark&lang=en&identifier=',
        '/?theme=dark&time=123',
        '/products/item%2B1?time=456&isManualNavigation=false',
        '/checkout#summary',
      ];
      for (const path of paths) {
        const next = `${root}${path}`;
        expect(qappGuestUrlAllowed(root, next, owner, false)).toBe(true);
        expect(decodeURIComponent(new URL(next).pathname.split('/')[3])).toBe(
          name
        );
      }
    }
  );

  it('preserves existing plain-name URLs and service encoding', () => {
    expect(buildAppRenderRoot(base, 'APP', 'Q-Trade')).toBe(
      `${base}/render/APP/Q-Trade`
    );
    expect(buildAppRenderRoot(base, 'APP/OTHER', 'Q-Shop+')).toBe(
      `${base}/render/APP%2FOTHER/Q-Shop%2B`
    );
  });

  it('still rejects other apps, services, origins, name prefixes and traversal', () => {
    const owner = { tabId: 'tab', service: 'APP', name: 'Q-Shop+' };
    const root = buildAppRenderRoot(base, owner.service, owner.name);
    for (const next of [
      buildAppRenderRoot(base, 'APP', 'other-app'),
      buildAppRenderRoot(base, 'APP', 'Q-Shop+evil'),
      buildAppRenderRoot(base, 'WEBSITE', 'Q-Shop+'),
      buildAppRenderRoot('https://attacker.example', 'APP', 'Q-Shop+'),
      `${root}/../other-app`,
      `${root}/%2e%2e/other-app`,
      `${base}/render/APP/Q-Shop%252B`,
    ]) {
      expect(qappGuestUrlAllowed(root, next, owner, false)).toBe(false);
    }
  });
});
