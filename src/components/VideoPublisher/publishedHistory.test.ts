import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublishedRecord } from '../../lib/videoPublisher';
import {
  canDismissPublished,
  normalizeHistory,
  PUBLISHED_HISTORY_LIMIT,
  type PublishedEntry,
  publishedHistoryKey,
  readPublishedHistory,
  upsertEntry,
  writePublishedHistory,
} from './publishedHistory';

const record = (title = 'Trip'): PublishedRecord => ({
  app: 'qtube',
  name: 'Tester',
  title,
  link: `qortal://APP/Q-Tube/video/Tester/qtube_vid_${title}_metadata`,
  open: {
    service: 'APP',
    name: 'Q-Tube',
    path: `/video/Tester/qtube_vid_${title}_metadata`,
  },
  resources: [
    {
      service: 'VIDEO',
      name: 'Tester',
      identifier: `qtube_vid_${title}`,
      kind: 'video',
    },
    {
      service: 'DOCUMENT',
      name: 'Tester',
      identifier: `qtube_vid_${title}_metadata`,
      kind: 'metadata',
    },
  ],
});

const entry = (
  id: string,
  publishedAt: number,
  extra: Partial<PublishedEntry> = {}
): PublishedEntry => ({
  id,
  kind: 'qtube',
  record: record(id.replace(/\W/g, '')),
  publishedAt,
  ...extra,
});

describe('publishedHistory', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('keeps each account its own list, without the session’s item ids', () => {
    writePublishedHistory('Qone', [entry('item:a', 1, { itemId: 'a' })]);
    writePublishedHistory('Qtwo', [entry('item:b', 2)]);
    expect(readPublishedHistory('Qone').map((current) => current.id)).toEqual([
      'item:a',
    ]);
    expect(readPublishedHistory('Qtwo').map((current) => current.id)).toEqual([
      'item:b',
    ]);
    expect(readPublishedHistory('Qone')[0].itemId).toBeUndefined();
    expect(
      window.localStorage.getItem(publishedHistoryKey('Qone'))
    ).not.toContain('itemId');
    // No account: nothing kept, nothing read.
    writePublishedHistory(null, [entry('item:c', 3)]);
    expect(readPublishedHistory(null)).toEqual([]);
    expect(window.localStorage.length).toBe(2);
  });

  it('keeps the newest, one per id, at most the limit', () => {
    const many = Array.from({ length: PUBLISHED_HISTORY_LIMIT + 20 }, (_, i) =>
      entry(`item:${i}`, i)
    );
    const kept = normalizeHistory(many);
    expect(kept).toHaveLength(PUBLISHED_HISTORY_LIMIT);
    expect(kept[0].id).toBe(`item:${PUBLISHED_HISTORY_LIMIT + 19}`);
    const updated = upsertEntry(
      kept,
      entry('item:215', 999, { partial: true })
    );
    expect(updated.filter((current) => current.id === 'item:215')).toEqual([
      expect.objectContaining({ partial: true, publishedAt: 999 }),
    ]);
  });

  it('drops what it cannot trust and finishes an interrupted removal as failed', () => {
    window.localStorage.setItem(
      publishedHistoryKey('Qone'),
      JSON.stringify([
        { ...entry('item:ok', 5), removal: 'removing', removedKeys: ['k'] },
        {
          ...entry('item:link', 4),
          record: { ...record(), link: 'https://x' },
        },
        { ...entry('item:kind', 3), kind: 'game' },
        { ...entry('item:none', 2), record: { ...record(), resources: [] } },
        'junk',
        null,
      ])
    );
    const [only, ...rest] = readPublishedHistory('Qone');
    expect(rest).toEqual([]);
    expect(only).toMatchObject({
      id: 'item:ok',
      removal: 'failed',
      removalError: 'removal-interrupted',
      removedKeys: ['k'],
    });
  });

  it('reads nothing from broken JSON and survives blocked storage', () => {
    window.localStorage.setItem(publishedHistoryKey('Qone'), '{not json');
    expect(readPublishedHistory('Qone')).toEqual([]);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(readPublishedHistory('Qone')).toEqual([]);
    expect(() =>
      writePublishedHistory('Qone', [entry('item:a', 1)])
    ).not.toThrow();
  });

  it("keeps a Subscreen title's cast & crew for Remove, never a person", () => {
    const film: PublishedRecord = {
      ...record('Film'),
      app: 'subscreen',
      resources: [
        ...record('Film').resources,
        {
          service: 'DOCUMENT',
          name: 'Tester',
          identifier: 'subscreen_person_someone_abcde',
          kind: 'person',
        },
        {
          service: 'DOCUMENT',
          name: 'Tester',
          identifier: 'subscreen_credits_0123456789abcdef',
          kind: 'credits',
          filename: 'credits.json',
        },
      ],
    };
    writePublishedHistory('Qone', [
      { ...entry('item:film', 1), kind: 'film', record: film },
    ]);
    expect(
      readPublishedHistory('Qone')[0].record.resources.map(
        (resource) => resource.kind
      )
    ).toEqual(['video', 'metadata', 'credits']);
  });
});

describe('canDismissPublished', () => {
  it('lets a whole published video or a removed one off the list, nothing half done', () => {
    expect(canDismissPublished(entry('item:a', 1))).toBe(true);
    expect(
      canDismissPublished(entry('item:a', 1, { removal: 'removed' }))
    ).toBe(true);
    expect(
      canDismissPublished(
        entry('item:a', 1, { partial: true, removal: 'removed' })
      )
    ).toBe(true);
    // Remove is how these get cleaned up.
    expect(canDismissPublished(entry('item:a', 1, { partial: true }))).toBe(
      false
    );
    expect(
      canDismissPublished(entry('item:a', 1, { removal: 'removing' }))
    ).toBe(false);
    expect(canDismissPublished(entry('item:a', 1, { removal: 'failed' }))).toBe(
      false
    );
  });
});
