import { describe, expect, it } from 'vitest';
import {
  normalizeQappIdentityContext,
  qappReticulumSessionPermissionKey,
} from './qapp-identity';

describe('Q-App identity context', () => {
  it('canonicalizes only host-provided QDN identity fields', () => {
    expect(
      normalizeQappIdentityContext({
        name: ' Official-App ',
        service: 'app',
      })
    ).toEqual({
      name: 'official-app',
      service: 'APP',
    });
  });

  it('rejects missing or malformed identity fields', () => {
    expect(() => normalizeQappIdentityContext({ name: 'example' })).toThrow();
    expect(() =>
      normalizeQappIdentityContext({ name: 'example', service: 'APP/' })
    ).toThrow();
  });

  it('scopes Reticulum permission to the tab, app, and backend', () => {
    expect(qappReticulumSessionPermissionKey(7, 'Example', 'ab'.repeat(16))).toBe(
      `7\u0000Example\u0000${'ab'.repeat(16)}`
    );
  });
});
