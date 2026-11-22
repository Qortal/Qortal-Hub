import { describe, expect, it } from 'vitest';
import { isolated } from './BudgetActivity';

describe('a part an app named, as the budget panel shows it', () => {
  it('sits in an isolate of its own that nothing in it can end early', () => {
    // A closing mark, then a right-to-left override for the words after it.
    expect(isolated('Lunch\u2069\u202E')).toBe('\u2068Lunch\u2069');
    expect(isolated('a\u200Eb\u200Fc\u061Cd\u2066e\u202Af')).toBe(
      '\u2068abcdef\u2069'
    );
    expect(isolated(undefined)).toBe('\u2068\u2069');
  });
});
