import { describe, expect, it } from 'vitest';
import {
  foreignCoinPathSegment,
  foreignCoinTicker,
  foreignFeeType,
  listNamePathSegment,
} from './qappNodePaths';

describe('foreignCoinPathSegment', () => {
  it.each([
    ['BTC', 'btc'],
    ['btc', 'btc'],
    ['LTC', 'ltc'],
    ['LITECOIN', 'ltc'],
    ['Litecoin', 'ltc'],
    ['DOGE', 'doge'],
    ['DOGECOIN', 'doge'],
    ['DGB', 'dgb'],
    ['DIGIBYTE', 'dgb'],
    ['RVN', 'rvn'],
    ['RAVENCOIN', 'rvn'],
    ['ARRR', 'arrr'],
    ['PIRATECHAIN', 'arrr'],
    [' ltc ', 'ltc'],
  ])('maps %s to %s', (coin, segment) => {
    expect(foreignCoinPathSegment(coin)).toBe(segment);
  });

  it.each([
    'QORT',
    'btc/../../other',
    '../../other/path?',
    'btc?',
    'btc#',
    '',
    null,
    42,
  ])('refuses %s', (coin) => {
    expect(() => foreignCoinPathSegment(coin)).toThrow();
  });

  it('gives no ticker for anything else', () => {
    expect(foreignCoinTicker('SOL')).toBeNull();
    expect(foreignCoinTicker(undefined)).toBeNull();
  });
});

describe('foreignFeeType', () => {
  it('accepts the two fee types in any case', () => {
    expect(foreignFeeType('feekb')).toBe('feekb');
    expect(foreignFeeType('FEEREQUIRED')).toBe('feerequired');
  });

  it.each(['../../other/path', 'feekb/../x', 'fee', '', null])(
    'refuses %s',
    (type) => {
      expect(() => foreignFeeType(type)).toThrow();
    }
  );
});

describe('listNamePathSegment', () => {
  it('keeps the names Q-Apps use', () => {
    expect(listNamePathSegment('blockedNames')).toBe('blockedNames');
    expect(listNamePathSegment('followedNames_q-tube')).toBe(
      'followedNames_q-tube'
    );
  });

  it('percent-encodes the rest', () => {
    expect(listNamePathSegment('my list')).toBe('my%20list');
    expect(listNamePathSegment('a?b#c')).toBe('a%3Fb%23c');
  });

  it.each([
    '',
    '.',
    '..',
    '%2e%2e',
    '../other',
    'a/b',
    'a\\b',
    'a\tb',
    null,
    ['a'],
  ])('refuses %s', (name) => {
    expect(() => listNamePathSegment(name)).toThrow();
  });
});
