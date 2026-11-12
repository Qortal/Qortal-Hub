import { describe, expect, it } from 'vitest';
import { privateAppPreviewUrl } from './privateAppPreview';

const NODE = 'http://127.0.0.1:12391';
const PATH = '/render/hash/8Hn3kQf2vEoX?secret=5KmpQ7dwRUZf';

describe('privateAppPreviewUrl', () => {
  it('puts the preview path on the node, without an API key', () => {
    const url = privateAppPreviewUrl(NODE, PATH);
    expect(url).toBe(`${NODE}${PATH}`);
    expect(url).not.toContain('apiKey');
  });

  it('ignores whitespace around the answer', () => {
    expect(privateAppPreviewUrl(NODE, `\n${PATH}\n`)).toBe(`${NODE}${PATH}`);
  });

  it.each([
    'Unable to generate preview URL',
    '',
    '/render/hash/8Hn3kQf2vEoX',
    '/render/hash/8Hn3kQf2vEoX?secret=5Kmp&apiKey=abc',
    '/render/hash/../../other?secret=5Kmp',
    '/render/hash/0OIl?secret=5Kmp',
    'https://elsewhere.example/render/hash/8Hn3?secret=5Kmp',
    '//elsewhere.example/render/hash/8Hn3?secret=5Kmp',
    null,
    undefined,
    42,
  ])('refuses %s', (answer) => {
    expect(privateAppPreviewUrl(NODE, answer)).toBeNull();
  });
});
