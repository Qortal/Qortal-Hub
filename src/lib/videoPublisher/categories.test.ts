import { describe, expect, it } from 'vitest';
import {
  ALL_CATEGORY_OPTIONS,
  FILM_GENRES,
  isFilmGenre,
  isQshareVideoSubcategory,
  isQtubeSubcategoryOf,
  QSHARE_VIDEO_SUBCATEGORIES,
  QTUBE_CATEGORIES,
  qtubeSubcategories,
  SERIES_GENRES,
} from './categories';

describe('categories', () => {
  it("lists Q-Tube's 30 categories with its ids", () => {
    expect(QTUBE_CATEGORIES).toHaveLength(30);
    expect(QTUBE_CATEGORIES.map((c) => c.id)).toEqual([
      ...Array.from({ length: 29 }, (_, i) => i + 1),
      99,
    ]);
  });

  it('gives film and series genres Q-Tube and Subscreen both read', () => {
    expect(FILM_GENRES.map((g) => g.id)).toEqual([
      ...Array.from({ length: 15 }, (_, i) => 101 + i),
      199,
    ]);
    expect(SERIES_GENRES.map((g) => g.id)).toEqual([
      ...Array.from({ length: 15 }, (_, i) => 201 + i),
      299,
    ]);
    expect(isFilmGenre(116)).toBe(false);
    expect(isFilmGenre(199)).toBe(true);
  });

  it('knows which subcategories belong to which category', () => {
    expect(qtubeSubcategories(4).map((s) => s.id)).toEqual([
      400, 401, 402, 499,
    ]);
    expect(qtubeSubcategories(3)).toEqual([]);
    expect(isQtubeSubcategoryOf(24, 2408)).toBe(true);
    expect(isQtubeSubcategoryOf(1, 201)).toBe(false);
  });

  it("has Q-Share's video subcategories", () => {
    expect(QSHARE_VIDEO_SUBCATEGORIES).toHaveLength(20);
    expect(isQshareVideoSubcategory(421)).toBe(true);
    expect(isQshareVideoSubcategory(422)).toBe(false);
  });

  it('gives every option a unique i18n key under video_publisher.category', () => {
    const keys = ALL_CATEGORY_OPTIONS.map((option) => option.i18nKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const option of ALL_CATEGORY_OPTIONS) {
      expect(option.i18nKey).toMatch(
        /^core:video_publisher\.category\.[a-z0-9_]+$/
      );
      expect(option.defaultLabel).not.toBe('');
    }
  });
});
