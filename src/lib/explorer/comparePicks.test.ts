import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanPicks,
  clearPicks,
  COMPARE_MAX,
  picksKey,
  readPicks,
  togglePick,
  writePicks,
} from './comparePicks';

const HUB_A = `Q${'A'.repeat(33)}`;
const HUB_B = `Q${'B'.repeat(33)}`;
const address = (letter: string) => `Q${letter.repeat(33)}`;

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('compare picks', () => {
  it(`hold up to ${COMPARE_MAX} accounts, each once; a 5th is refused`, () => {
    let picks: string[] = [];
    for (const letter of 'CDEF') {
      const step = togglePick(picks, address(letter));
      expect(step.result).toBe('added');
      picks = step.picks;
    }
    const fifth = togglePick(picks, address('G'));
    expect(fifth).toEqual({ picks, result: 'full' });
    // Picked already: taken out, even when full.
    expect(togglePick(picks, address('D'))).toEqual({
      picks: [address('C'), address('E'), address('F')],
      result: 'removed',
    });
  });

  it('take only Qortal addresses: a name, an AT and anything else are refused', () => {
    for (const value of ['Publisher', `A${'X'.repeat(33)}`, '', 'Q123'])
      expect(togglePick([], value)).toEqual({ picks: [], result: 'invalid' });
  });

  it('read back only addresses, each once, at most 4, in their order', () => {
    expect(
      cleanPicks([
        address('C'),
        address('C'),
        '<b>',
        42,
        null,
        `A${'X'.repeat(33)}`,
        address('D'),
        address('E'),
        address('F'),
        address('G'),
      ])
    ).toEqual([address('C'), address('D'), address('E'), address('F')]);
    expect(cleanPicks('not a list')).toEqual([]);
  });

  it('are kept for each Hub account apart; none left forgets the entry', () => {
    writePicks(HUB_A, [address('C'), address('D')]);
    expect(readPicks(HUB_A)).toEqual([address('C'), address('D')]);
    expect(readPicks(HUB_B)).toEqual([]);
    expect(readPicks(null)).toEqual([]);
    writePicks(HUB_A, []);
    expect(window.sessionStorage.getItem(picksKey(HUB_A))).toBeNull();
    writePicks(HUB_B, [address('E')]);
    clearPicks(HUB_B);
    expect(readPicks(HUB_B)).toEqual([]);
  });

  it('only for this session: kept in sessionStorage, never localStorage', () => {
    writePicks(HUB_A, [address('C')]);
    expect(window.localStorage.getItem(picksKey(HUB_A))).toBeNull();
    expect(window.sessionStorage.getItem(picksKey(HUB_A))).not.toBeNull();
  });

  it('work without storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readPicks(HUB_A)).toEqual([]);
    expect(() => writePicks(HUB_A, [address('C')])).not.toThrow();
    expect(() => clearPicks(HUB_A)).not.toThrow();
    expect(() => writePicks(HUB_A, [])).not.toThrow();
  });

  it('a stored list that isn’t JSON reads as none', () => {
    window.sessionStorage.setItem(picksKey(HUB_A), '{not json');
    expect(readPicks(HUB_A)).toEqual([]);
  });
});
