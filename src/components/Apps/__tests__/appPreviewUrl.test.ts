import { describe, expect, it } from 'vitest';
import { buildPreviewUrl } from '../appPreviewUrl';

describe('buildPreviewUrl', () => {
  it('preserves a private preview secret when adding viewer settings', () => {
    const result = buildPreviewUrl(
      'http://localhost:12391/render/hash/example?secret=private-token',
      {
        language: 'en',
        theme: 'dark',
      }
    );

    expect(result).toBe(
      'http://localhost:12391/render/hash/example?secret=private-token&theme=dark&lang=en'
    );
  });

  it('adds a cache buster without replacing the preview route', () => {
    const result = buildPreviewUrl(
      'http://localhost:12391/render/hash/example?secret=private-token',
      {
        cacheBuster: 123456,
        language: 'de',
        theme: 'light',
      }
    );

    expect(result).toBe(
      'http://localhost:12391/render/hash/example?secret=private-token&theme=light&lang=de&time=123456'
    );
    expect(result).not.toContain('/render/DOCUMENT/');
  });

  it('starts a query string when the preview URL has no parameters', () => {
    expect(
      buildPreviewUrl('http://localhost:12391/render/hash/example', {
        language: 'en',
        theme: 'dark',
      })
    ).toBe('http://localhost:12391/render/hash/example?theme=dark&lang=en');
  });
});
