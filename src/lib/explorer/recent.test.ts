import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addRecent,
  clearRecent,
  readRecent,
  readRemember,
  RECENT_MAX,
  recentKey,
  writeRemember,
} from './recent';

const HUB_A = `Q${'A'.repeat(33)}`;
const HUB_B = `Q${'B'.repeat(33)}`;
const address = (letter: string) => `Q${letter.repeat(33)}`;

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('recent explorations', () => {
  it('keeps each Hub account its own list, newest first, without repeats', () => {
    addRecent(HUB_A, address('C'));
    addRecent(HUB_A, address('D'));
    addRecent(HUB_A, address('C'));
    expect(readRecent(HUB_A)).toEqual([address('C'), address('D')]);
    expect(readRecent(HUB_B)).toEqual([]);
  });

  it(`keeps at most ${RECENT_MAX}`, () => {
    for (const letter of 'CDEFGHJKLM') addRecent(HUB_A, address(letter));
    expect(readRecent(HUB_A)).toHaveLength(RECENT_MAX);
    expect(readRecent(HUB_A)[0]).toBe(address('M'));
  });

  it('remembers nothing while turned off, and forgets the list when turned off', () => {
    addRecent(HUB_A, address('C'));
    writeRemember(HUB_A, false);
    expect(readRecent(HUB_A)).toEqual([]);
    expect(readRemember(HUB_A)).toBe(false);
    addRecent(HUB_A, address('D'));
    expect(readRecent(HUB_A)).toEqual([]);
    writeRemember(HUB_A, true);
    addRecent(HUB_A, address('D'));
    expect(readRecent(HUB_A)).toEqual([address('D')]);
  });

  it('reads only addresses back', () => {
    window.localStorage.setItem(
      recentKey(HUB_A),
      JSON.stringify([address('C'), '<b>', 42, null])
    );
    expect(readRecent(HUB_A)).toEqual([address('C')]);
  });

  it('works without storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readRecent(HUB_A)).toEqual([]);
    expect(readRemember(HUB_A)).toBe(false);
    expect(() => clearRecent(HUB_A)).not.toThrow();
  });
});
