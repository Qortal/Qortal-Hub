import { describe, expect, it } from 'vitest';
import {
  categoryMatches,
  countCategories,
  normalizeForSearch,
  sortCategoriesByName,
} from './categoryCounts';

const apps = [
  { metadata: { category: 'GAMING' }, status: { status: 'READY' } },
  { metadata: { category: 'GAMING' }, status: { status: 'PUBLISHED' } },
  { metadata: { category: 'TOOLS' }, status: { status: 'READY' } },
  { metadata: {}, status: { status: 'READY' } },
  { status: { status: 'DOWNLOADED' } },
];

describe('countCategories', () => {
  it('counts each category, and every app in the total', () => {
    const counts = countCategories(apps);
    expect(counts.total).toBe(5);
    expect(counts.byId.get('GAMING')).toBe(2);
    expect(counts.byId.get('TOOLS')).toBe(1);
    expect(counts.byId.size).toBe(2);
  });

  it('follows the status filter', () => {
    const installed = countCategories(apps, 'installed');
    expect(installed.total).toBe(3);
    expect(installed.byId.get('GAMING')).toBe(1);

    const notInstalled = countCategories(apps, 'not_installed');
    expect(notInstalled.total).toBe(2);
    expect(notInstalled.byId.get('GAMING')).toBe(1);
    expect(notInstalled.byId.has('TOOLS')).toBe(false);
  });
});

describe('categoryMatches', () => {
  const crypto = {
    id: 'CRYPTOCURRENCY',
    name: 'Cryptocurrency and Blockchain',
  };
  const selfSufficiency = {
    id: 'SELF_SUFFICIENCY',
    name: 'Self-Sufficiency and Homesteading',
  };

  it('matches part of the name, in any case', () => {
    expect(categoryMatches(crypto, 'BLOCK')).toBe(true);
    expect(categoryMatches(crypto, 'music')).toBe(false);
  });

  it('matches the id with underscores read as spaces', () => {
    expect(categoryMatches(selfSufficiency, 'self suff')).toBe(true);
  });

  it('ignores accents', () => {
    expect(categoryMatches({ id: 'FOOD', name: 'Café' }, 'cafe')).toBe(true);
    expect(normalizeForSearch('Ëlégant')).toBe('elegant');
  });

  it('matches everything when nothing is typed', () => {
    expect(categoryMatches(crypto, '  ')).toBe(true);
  });
});

describe('sortCategoriesByName', () => {
  it('sorts by name in the given language without changing the list', () => {
    const list = [
      { id: 'B', name: 'beta' },
      { id: 'A', name: 'Alpha' },
      { id: 'C', name: 'Ångström' },
    ];
    expect(sortCategoriesByName(list, 'en').map((item) => item.id)).toEqual([
      'A',
      'C',
      'B',
    ]);
    expect(sortCategoriesByName(list, 'sv').map((item) => item.id)).toEqual([
      'A',
      'B',
      'C',
    ]);
    expect(list[0].id).toBe('B');
  });
});
