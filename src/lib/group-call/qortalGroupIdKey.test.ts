import { describe, expect, it } from 'vitest';
import {
  meshCallActiveForMemberGroup,
  qortalMemberGroupIdKey,
} from './qortalGroupIdKey';

describe('qortalMemberGroupIdKey', () => {
  it('normalizes leading zeros', () => {
    expect(qortalMemberGroupIdKey('00123')).toBe('123');
  });
  it('rejects zero / general', () => {
    expect(qortalMemberGroupIdKey('0')).toBe(null);
    expect(qortalMemberGroupIdKey(0)).toBe(null);
  });
});

describe('meshCallActiveForMemberGroup', () => {
  it('matches canonical key when map uses unpadded id', () => {
    expect(
      meshCallActiveForMemberGroup({ '123': true }, '00123')
    ).toBe(true);
  });
  it('falls back to raw string key', () => {
    expect(meshCallActiveForMemberGroup({ foo: true }, 'foo')).toBe(true);
  });
});
