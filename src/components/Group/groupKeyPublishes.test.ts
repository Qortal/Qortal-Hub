import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../App', () => ({
  getBaseApiReact: () => 'https://core.test',
  getArbitrarySearchSimpleEndpointReact: () =>
    '/arbitrary/resources/searchsimple',
}));
import { getAllPublishesFromAdmins, getPublishesFromAdmins } from './groupApi';

afterEach(() => vi.unstubAllGlobals());
describe('group key publisher identity', () => {
  it.each([getPublishesFromAdmins, getAllPublishesFromAdmins])(
    'keeps special characters in admin names when searching for existing keys',
    async (lookup) => {
      const fetch = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => [] });
      vi.stubGlobal('fetch', fetch);
      await lookup(['Alice+', 'Bob & Carol'], '42');
      const url = new URL(fetch.mock.calls[0][0]);
      expect(url.searchParams.getAll('name')).toEqual([
        'Alice+',
        'Bob & Carol',
      ]);
      expect(url.searchParams.get('exactmatchnames')).toBe('true');
      expect(url.searchParams.get('identifier')).toBe(
        'symmetric-qchat-group-42'
      );
    }
  );
  it.each([getPublishesFromAdmins, getAllPublishesFromAdmins])(
    'rejects a failed search instead of reporting that no key exists',
    async (lookup) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
      await expect(lookup(['Alice'], '42')).rejects.toThrow();
    }
  );
});
