import { describe, expect, it, vi } from 'vitest';

vi.mock('../../Group/groupApi', () => ({
  getGroupAdminsAddress: vi.fn(),
}));

import {
  buildPrivateAppDataUrl,
  checkGroupAdmin,
  loadPrivateAppCurrentVersion,
} from '../privateAppUpdate';

const app = {
  name: 'Minter Helper',
  service: 'DOCUMENT',
  identifier: 'q-notes',
  groupId: 42,
};

const encode = (value: unknown) => btoa(JSON.stringify(value));

describe('loading the published version of a private app', () => {
  it('asks for the resource with every part encoded', () => {
    expect(buildPrivateAppDataUrl('http://node', app)).toBe(
      'http://node/arbitrary/DOCUMENT/Minter%20Helper/q-notes?encoding=base64'
    );
  });

  it('decrypts it with the group key and keeps only the app name and logo', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      text: async () => 'ENCRYPTED',
    }));
    const decrypt = vi.fn(async () =>
      encode({ app: 'UEsDBA==', logo: 'iVBORw0K', name: 'Q-Notes' })
    );

    const current = await loadPrivateAppCurrentVersion('http://node', app, {
      fetchFn,
      decrypt,
    });

    expect(decrypt).toHaveBeenCalledWith('ENCRYPTED', 42);
    expect(current).toEqual({ appName: 'Q-Notes', logo: 'iVBORw0K' });
  });

  it('has nothing when the node has no data or it cannot be decrypted', async () => {
    const decrypt = vi.fn();
    expect(
      await loadPrivateAppCurrentVersion('http://node', app, {
        fetchFn: async () => ({ ok: false, status: 404, text: async () => '' }),
        decrypt,
      })
    ).toBeNull();
    expect(decrypt).not.toHaveBeenCalled();
    expect(
      await loadPrivateAppCurrentVersion('http://node', app, {
        fetchFn: async () => ({ ok: true, text: async () => 'ENCRYPTED' }),
        decrypt: async () => ({ error: 'no key' }),
      })
    ).toBeNull();
  });
});

describe('checking that the account is still an admin of the group', () => {
  it("answers from the node's list of admins", async () => {
    const getAdmins = vi.fn(async () => ['Qme', 'Qother']);
    expect(await checkGroupAdmin(42, 'Qme', { getAdmins })).toBe('admin');
    expect(getAdmins).toHaveBeenCalledWith(42);
    expect(
      await checkGroupAdmin(42, 'Qformer', {
        getAdmins,
        knownAdminGroupIds: [42],
      })
    ).toBe('not_admin');
  });

  it('falls back to the admin groups from sign-in when the node cannot say', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    const empty = vi.fn(async () => []);
    expect(
      await checkGroupAdmin(42, 'Qme', {
        getAdmins: failing,
        knownAdminGroupIds: ['42'],
      })
    ).toBe('admin');
    expect(
      await checkGroupAdmin(42, 'Qme', {
        getAdmins: empty,
        knownAdminGroupIds: [7],
      })
    ).toBe('unknown');
  });
});
