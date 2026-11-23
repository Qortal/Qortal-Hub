import { describe, expect, it } from 'vitest';
import {
  fullDescription,
  htmlDescription,
  playlistQdnDescription,
  qtubeQdnDescription,
} from './html';
import records from './__fixtures__/real-records.json';

describe('htmlDescription', () => {
  it('matches what Subscreen stores', () => {
    const film = records.subscreenFilmMetadata;
    expect(htmlDescription(film.fullDescription)).toBe(film.htmlDescription);
  });

  it('makes paragraphs and line breaks, escaped', () => {
    expect(htmlDescription('One\nline two\n\n\n<b>"Two"</b> & more')).toBe(
      '<p>One<br />line two</p><p>&lt;b&gt;&quot;Two&quot;&lt;/b&gt; &amp; more</p>'
    );
    expect(htmlDescription('a\r\nb')).toBe('<p>a<br />b</p>');
    expect(htmlDescription('')).toBe('<p></p>');
  });
});

describe('fullDescription', () => {
  it('collapses whitespace and cuts at 150', () => {
    expect(fullDescription('a\n\nb  c')).toBe('a b c');
    expect(fullDescription('x'.repeat(200))).toHaveLength(150);
    expect(fullDescription('x'.repeat(200), null)).toHaveLength(200);
  });
});

describe('QDN descriptions', () => {
  it("match Subscreen's film document", () => {
    const film = records.subscreenFilmMetadata;
    expect(
      qtubeQdnDescription(
        film.category,
        film.subcategory,
        film.code,
        film.fullDescription
      )
    ).toBe(records.subscreenFilmDocument.metadata.description);
  });

  it('write an empty subcategory as nothing', () => {
    expect(qtubeQdnDescription(21, '', 'flLgc', 'Text')).toBe(
      '**category:21;subcategory:;code:flLgc**Text'
    );
  });

  it('list at most ten playlist codes and 120 characters', () => {
    const codes = Array.from({ length: 12 }, (_, i) => `c${i}`);
    const text = playlistQdnDescription(2, 201, codes, 'y'.repeat(200));
    expect(text).toBe(
      `**category:2;subcategory:201;${codes
        .slice(0, 10)
        .map((c) => `c:${c};`)
        .join('')}**${'y'.repeat(120)}`
    );
  });
});
