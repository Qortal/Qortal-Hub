import { describe, expect, it } from 'vitest';
import en from '../../../../i18n/locales/en/core.json';
import {
  LONG_TICKLE_MS,
  pickGiggleQuip,
  pickQortinoQuip,
  pickTickleQuip,
  QORTINO_QUIPS,
  quipHoldMs,
  quipKey,
  quipTypingMs,
  SCHEDULED_QUIP_CATEGORIES,
  type QortinoQuipCategory,
} from '../qortinoQuips';

const lookup = (key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      (en as Record<string, unknown>).qortino_workspace
    );

/** Rolls that land on each category in turn, then on the first line. */
const rolls = (...values: number[]) => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
};

describe("Qortino's lines on Home", () => {
  it('has 30-70 lines of its own, and every line has English words', () => {
    const keysOf = (categories: readonly QortinoQuipCategory[]) =>
      categories.flatMap((category) =>
        QORTINO_QUIPS[category].map((slug) => quipKey(category, slug))
      );
    const scheduled = keysOf(SCHEDULED_QUIP_CATEGORIES);
    expect(scheduled.length).toBeGreaterThanOrEqual(30);
    expect(scheduled.length).toBeLessThanOrEqual(70);
    const all = keysOf(Object.keys(QORTINO_QUIPS) as QortinoQuipCategory[]);
    for (const key of all) {
      expect(typeof lookup(key), key).toBe('string');
    }
  });

  it('answers a tickle, and gives up laughing after a long one', () => {
    const short = pickTickleQuip({ heldMs: 900, recent: [], random: () => 0 });
    expect(short.category).toBe('tickle');
    const long = pickTickleQuip({
      heldMs: LONG_TICKLE_MS,
      recent: [],
      random: () => 0,
    });
    expect(long.category).toBe('tickle_long');
    // Not the answer he gave last time.
    const next = pickTickleQuip({
      heldMs: 900,
      recent: [short.key],
      random: () => 0,
    });
    expect(next.key).not.toBe(short.key);
  });

  it('never giggles the same giggle twice running', () => {
    let last: string | null = null;
    for (let i = 0; i < 50; i += 1) {
      const giggle = pickGiggleQuip({ last, random: () => 0 });
      expect(giggle.key).not.toBe(last);
      expect(giggle.category).toBe('giggle');
      last = giggle.key;
    }
  });

  it('never says a tickle answer by himself', () => {
    for (let i = 0; i < 200; i += 1) {
      const quip = pickQortinoQuip({
        aiReady: i % 2 === 0,
        hour: i % 24,
        recent: ['quips.promo.intro', 'quips.ready.ready_intro'],
        random: () => (i * 0.137) % 1,
      });
      expect(['tickle', 'tickle_long', 'giggle']).not.toContain(quip.category);
    }
  });

  it('introduces himself first, as an invite to download or to ask', () => {
    expect(pickQortinoQuip({ aiReady: false, hour: 14, recent: [] }).key).toBe(
      'quips.promo.intro'
    );
    expect(pickQortinoQuip({ aiReady: true, hour: 14, recent: [] }).key).toBe(
      'quips.ready.ready_intro'
    );
  });

  it('invites to the AI that fits: download when missing, ask when ready', () => {
    const recentPromo = ['quips.promo.intro'];
    const promo = pickQortinoQuip({
      aiReady: false,
      hour: 14,
      recent: recentPromo,
      random: rolls(0, 0),
    });
    expect(promo.category).toBe('promo');
    const ready = pickQortinoQuip({
      aiReady: true,
      hour: 14,
      recent: ['quips.ready.ready_intro'],
      random: rolls(0, 0),
    });
    expect(ready.category).toBe('ready');
  });

  it('does not repeat a line said lately', () => {
    const recent = [
      'quips.promo.intro',
      ...QORTINO_QUIPS.fun.slice(0, -1).map((slug) => quipKey('fun', slug)),
    ];
    const quip = pickQortinoQuip({
      aiReady: false,
      hour: 14,
      recent,
      // 0.6 of the weights lands on the jokes.
      random: rolls(0.6, 0),
    });
    expect(quip.key).toBe(
      quipKey('fun', QORTINO_QUIPS.fun[QORTINO_QUIPS.fun.length - 1])
    );
    expect(quip.wink).toBe(true);
  });

  it('says good night only at night', () => {
    // The last roll band is the time-of-day line.
    const atNight = pickQortinoQuip({
      aiReady: false,
      hour: 1,
      recent: ['quips.promo.intro'],
      random: rolls(0.99, 0),
    });
    expect(atNight.category).toBe('night');
    const atNoon = pickQortinoQuip({
      aiReady: false,
      hour: 12,
      recent: ['quips.promo.intro'],
      random: rolls(0.99, 0),
    });
    expect(atNoon.category).not.toBe('night');
  });

  it('keeps a line up long enough to read, but not for ages', () => {
    expect(quipHoldMs('Hi')).toBe(3_400);
    expect(quipHoldMs('x'.repeat(400))).toBe(8_000);
    expect(quipTypingMs('x'.repeat(400))).toBe(2_600);
  });
});
