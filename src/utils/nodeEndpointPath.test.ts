import { describe, expect, it } from 'vitest';
import {
  UnsafeNodeEndpointError,
  assertSafeNodeEndpoint,
  endpointPathPart,
  hasControlCharacter,
  hasDotSegment,
  joinNodeEndpoint,
  nodePathSegment,
} from './nodeEndpointPath';

const NODE = 'http://127.0.0.1:12391';

describe('hasControlCharacter', () => {
  it('finds tab, line breaks, NUL and DEL', () => {
    for (const value of ['a\tb', 'a\nb', 'a\rb', 'a\0b', 'a\x7fb']) {
      expect(hasControlCharacter(value)).toBe(true);
    }
  });

  it('accepts ordinary text, including spaces and non-Latin letters', () => {
    expect(hasControlCharacter('GO Clock')).toBe(false);
    expect(hasControlCharacter('Qortal 日本語 ü')).toBe(false);
  });
});

describe('hasDotSegment', () => {
  it.each([
    '/crosschain/btc/../../other/path',
    '/lists/..',
    '/a/./b',
    '..',
    '/crosschain/%2e%2e/other',
    '/crosschain/%2E%2e/other',
    '/crosschain/%252e%252e/other',
    '/crosschain/.%2e/other',
    '/crosschain\\..\\other',
    '/crosschain/..;x/other',
    '/crosschain/..%00/other',
    '/crosschain/%u002e%u002e/other',
  ])('finds the dot segment in %s', (path) => {
    expect(hasDotSegment(path)).toBe(true);
  });

  it.each([
    '/crosschain/btc/feekb',
    '/arbitrary/APP/GO Clock/go-widget',
    '/names/a..b',
    '/arbitrary/WEBSITE/name/file.html',
    '/lists/100%25',
    '/lists/followedNames_q-tube',
    '/arbitrary/resources/search',
  ])('accepts %s', (path) => {
    expect(hasDotSegment(path)).toBe(false);
  });

  it('refuses a path still decoding after several rounds', () => {
    expect(hasDotSegment('/a/%25252525252e')).toBe(true);
  });
});

describe('endpointPathPart', () => {
  it('cuts at the query or the fragment', () => {
    expect(endpointPathPart('/a/b?c=d')).toBe('/a/b');
    expect(endpointPathPart('/a/b#c')).toBe('/a/b');
    expect(endpointPathPart('/a/b')).toBe('/a/b');
  });
});

describe('assertSafeNodeEndpoint', () => {
  it.each([
    '/other/status',
    '/crosschain/ltc/feerequired',
    '/arbitrary/hosted/resources/?limit=20&offset=0&query=a#b',
    '/arbitrary/APP/GO Clock?attachment=true',
    '/transactions/process?apiVersion=2',
  ])('returns %s unchanged', (endpoint) => {
    expect(assertSafeNodeEndpoint(endpoint)).toBe(endpoint);
  });

  it.each([
    ['no leading slash', 'admin/status'],
    ['not a string', 42],
    ['a dot segment', '/crosschain/btc/../../other/path'],
    ['an encoded dot segment', '/crosschain/%2e%2e/%2e%2e/other/path'],
    ['a tab inside dots', '/crosschain/.\t./other'],
    ['a "#" before the query', '/crosschain/btc#/feekb'],
    ['an encoded NUL', '/lists/a%00'],
    ['a %u escape', '/lists/%u0041'],
  ])('refuses %s', (_label, endpoint) => {
    expect(() => assertSafeNodeEndpoint(endpoint)).toThrow(
      UnsafeNodeEndpointError
    );
  });

  it('allows dots in the query, which cannot change the path', () => {
    expect(
      assertSafeNodeEndpoint('/crosschain/txactivity?foreignBlockchain=../x')
    ).toBe('/crosschain/txactivity?foreignBlockchain=../x');
  });
});

describe('joinNodeEndpoint', () => {
  it('joins exactly as plain concatenation did', () => {
    expect(joinNodeEndpoint(NODE, '/other/status')).toBe(
      `${NODE}/other/status`
    );
    expect(joinNodeEndpoint(`${NODE}/`, '/other/status')).toBe(
      `${NODE}//other/status`
    );
    expect(joinNodeEndpoint('https://node.example/qortal', '/names/x')).toBe(
      'https://node.example/qortal/names/x'
    );
  });

  it('keeps a base without a usable URL working as before', () => {
    expect(joinNodeEndpoint('', '/other/status')).toBe('/other/status');
  });

  it('refuses a path that leaves the node', () => {
    expect(() => joinNodeEndpoint(NODE, '@evil.example/x')).toThrow(
      UnsafeNodeEndpointError
    );
    expect(() =>
      joinNodeEndpoint('https://node.example/qortal', '/../other/path')
    ).toThrow(UnsafeNodeEndpointError);
  });
});

describe('nodePathSegment', () => {
  it('percent-encodes the value', () => {
    expect(nodePathSegment('AXYZ')).toBe('AXYZ');
    expect(nodePathSegment('a/b?c#d')).toBe('a%2Fb%3Fc%23d');
    expect(nodePathSegment(42)).toBe('42');
  });

  it.each(['', '.', '..', '%2e%2e', 'a\nb', null, undefined, {}])(
    'refuses %s',
    (value) => {
      expect(() => nodePathSegment(value)).toThrow(UnsafeNodeEndpointError);
    }
  );
});
