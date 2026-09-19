import { describe, expect, it } from 'vitest';
import { qappGuestPartition, qappGuestUrlAllowed } from './qapp-guest-policy';

const owner = { tabId: 'tab-1', service: 'APP', name: 'a-test-2' };
const initial = 'https://127.0.0.1:12391/render/APP/a-test-2/?theme=dark';

describe('Q-App guest isolation policy', () => {
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
