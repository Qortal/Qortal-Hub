import { describe, expect, it } from 'vitest';
import {
  isSameResourceIdentifier,
  resourceIdentifierKey,
} from './resourceIdentifier';

describe('resourceIdentifierKey', () => {
  it.each([undefined, null, '', '  ', 'null', 'default', 3, {}])(
    'reads %j as the default resource',
    (identifier) => {
      expect(resourceIdentifierKey(identifier)).toBe('');
    }
  );

  it('keeps any other identifier exactly as it is', () => {
    expect(resourceIdentifierKey('beta')).toBe('beta');
    expect(resourceIdentifierKey('Minter Helper')).toBe('Minter Helper');
    expect(resourceIdentifierKey(' beta')).toBe(' beta');
    expect(resourceIdentifierKey('Default')).toBe('Default');
  });
});

describe('isSameResourceIdentifier', () => {
  it('matches a missing identifier only with the default resource', () => {
    expect(isSameResourceIdentifier(undefined, undefined)).toBe(true);
    expect(isSameResourceIdentifier(undefined, 'null')).toBe(true);
    expect(isSameResourceIdentifier('', 'default')).toBe(true);
    expect(isSameResourceIdentifier(undefined, 'beta')).toBe(false);
    expect(isSameResourceIdentifier('beta', null)).toBe(false);
  });

  it('matches the same identifier, and no other', () => {
    expect(isSameResourceIdentifier('beta', 'beta')).toBe(true);
    expect(isSameResourceIdentifier('beta', 'Beta')).toBe(false);
    expect(isSameResourceIdentifier('beta', 'gamma')).toBe(false);
  });
});
