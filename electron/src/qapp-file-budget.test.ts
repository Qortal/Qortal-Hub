import { describe, expect, it } from 'vitest';
import { QAppFileBudget } from './qapp-file-budget';

describe('Q-App file reservations', () => {
  it('counts files retained while waiting for permission, across tabs', () => {
    const budget = new QAppFileBudget();
    budget.reserve('a', 'session-a', 'doc-a', 8 * 1024 ** 3, 1);
    expect(() => budget.reserve('b', 'session-a', 'doc-b', 1, 1)).toThrow();
    budget.reserve('b', 'session-b', 'doc-b', 8 * 1024 ** 3, 1);
    expect(() => budget.reserve('c', 'session-c', 'doc-c', 1, 1)).toThrow();
    budget.release('a');
    budget.reserve('c', 'session-c', 'doc-c', 1, 1);
    expect(budget.size).toBe(2);
  });
  it('bounds zero-byte files, requests per document, and worker sessions', () => {
    const budget = new QAppFileBudget();
    for (let n = 0; n < 4; n++) budget.reserve(String(n), 'a', 'a', 0, 1);
    expect(() => budget.reserve('five', 'a', 'a', 0, 1)).toThrow();
    for (const session of ['b', 'c', 'd'])
      budget.reserve(session, session, session, 0, 1);
    expect(() => budget.reserve('e', 'e', 'e', 0, 1)).toThrow();
    budget.release('b');
    expect(() => budget.reserve('many', 'a', 'other', 0, 4096)).toThrow();
  });
  it.each([NaN, Infinity, -1, 0.1, Number.MAX_SAFE_INTEGER])(
    'rejects invalid byte counts: %s',
    (bytes) => {
      expect(() =>
        new QAppFileBudget().reserve('a', 's', 'd', bytes, 1)
      ).toThrow();
    }
  );
});
