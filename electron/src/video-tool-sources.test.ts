import { describe, expect, it } from 'vitest';
import { VideoSourceRegistry, sourceKind } from './video-tool-sources';

describe('sourceKind', () => {
  it('sorts by extension, ignoring case', () => {
    for (const name of [
      'a.MKV',
      'b.mp4',
      'c.m2ts',
      'd.VOB',
      'e.webm',
      'f.xvid',
    ])
      expect(sourceKind(name)).toBe('video');
    for (const name of ['a.srt', 'b.ASS', 'c.vtt', 'd.sup', 'e.sub', 'f.ssa'])
      expect(sourceKind(name)).toBe('subtitle');
    for (const name of ['cover.jpg', 'notes.nfo', 'README', '.hidden', 'x.'])
      expect(sourceKind(name)).toBe('other');
  });
});

describe('VideoSourceRegistry', () => {
  const ids = () => {
    let next = 0;
    return () => `id-${++next}`;
  };

  it("keeps each page's files apart and never returns paths", () => {
    const registry = new VideoSourceRegistry(ids());
    const added = registry.add(1, [
      {
        path: '/media/Show/Season 1/E01.mkv',
        name: 'E01.mkv',
        size: 10,
        relativePath: 'Show/Season 1/E01.mkv',
      },
      { path: '/media/Show/E01.en.srt', name: 'E01.en.srt', size: 2 },
    ]);
    expect(added).toEqual([
      {
        id: 'id-1',
        name: 'E01.mkv',
        size: 10,
        kind: 'video',
        relativePath: 'Show/Season 1/E01.mkv',
      },
      { id: 'id-2', name: 'E01.en.srt', size: 2, kind: 'subtitle' },
    ]);
    expect(registry.get(1, 'id-1')?.path).toBe('/media/Show/Season 1/E01.mkv');
    expect(registry.get(2, 'id-1')).toBeUndefined();
    expect(registry.get(1, 42)).toBeUndefined();
  });

  it('forgets one source or a whole page', () => {
    const registry = new VideoSourceRegistry(ids());
    registry.add(1, [
      { path: '/a.mp4', name: 'a.mp4', size: 1 },
      { path: '/b.mp4', name: 'b.mp4', size: 1 },
    ]);
    registry.forget(1, 'id-1');
    expect(registry.get(1, 'id-1')).toBeUndefined();
    expect(registry.get(1, 'id-2')).toBeDefined();
    registry.clearOwner(1);
    expect(registry.get(1, 'id-2')).toBeUndefined();
  });
});
