import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

import { CoreHttpError, getJson, seg } from './core';
import {
  accountRead,
  devAdminsRead,
  firstSeenRead,
  groupsOfRead,
  lastSignedRead,
  nameDataRead,
  namesOfRead,
  NULL_ACCOUNT,
  primaryNameRead,
  recentPaymentsRead,
} from './reads';

const ADDRESS = `Q${'P'.repeat(33)}`;

type Answer = { status?: number; body: unknown };
let answer: (path: string) => Answer;
let paths: string[] = [];

beforeEach(() => {
  paths = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url).slice('http://node.test'.length);
      paths.push(path);
      const { status = 200, body } = answer(path);
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () =>
          typeof body === 'string' ? body : JSON.stringify(body),
      } as Response;
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('getJson', () => {
  it("takes Core's error object for a failure, even with a 200", async () => {
    answer = () => ({ body: { error: 102, message: 'invalid address' } });
    await expect(getJson('/x')).rejects.toBeInstanceOf(CoreHttpError);
  });

  it('takes a body that is not JSON for a failure', async () => {
    answer = () => ({ body: '<html>Bad gateway</html>' });
    await expect(getJson('/x')).rejects.toBeInstanceOf(CoreHttpError);
  });
});

describe('accountRead', () => {
  it('tells an address never used, one the node rejects, and a failure apart', async () => {
    answer = () => ({
      status: 404,
      body: { error: 124, message: 'account address unknown' },
    });
    await expect(accountRead(ADDRESS).load()).resolves.toEqual({
      kind: 'unused',
      address: ADDRESS,
    });
    answer = () => ({
      status: 400,
      body: { error: 102, message: 'invalid address' },
    });
    await expect(accountRead(ADDRESS).load()).resolves.toEqual({
      kind: 'invalid',
      address: ADDRESS,
    });
    answer = () => ({ status: 503, body: { error: 1, message: 'busy' } });
    await expect(accountRead(ADDRESS).load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
  });

  it('reads the account', async () => {
    answer = () => ({
      body: {
        address: ADDRESS,
        reference: 'ref',
        publicKey: 'key',
        level: 7,
        blocksMinted: 1_798_699,
        blocksMintedAdjustment: 12,
        blocksMintedPenalty: 0,
      },
    });
    const read = await accountRead(ADDRESS).load();
    expect(read).toEqual({
      kind: 'account',
      account: {
        address: ADDRESS,
        reference: 'ref',
        publicKey: 'key',
        level: 7,
        blocksMinted: 1_798_699,
        blocksMintedAdjustment: 12,
        blocksMintedPenalty: 0,
      },
    });
  });
});

describe('names', () => {
  it('keeps a name with / ? # in one path segment', async () => {
    answer = () => ({
      status: 404,
      body: { error: 401, message: 'name unknown' },
    });
    await nameDataRead('a/b?c#d').load();
    expect(paths).toEqual(['/names/a%2Fb%3Fc%23d']);
  });

  it('never asks the node about "." or ".." as a name', async () => {
    answer = () => ({ body: { name: 'x', owner: ADDRESS } });
    await expect(nameDataRead('..').load()).resolves.toBeNull();
    await expect(nameDataRead('.').load()).resolves.toBeNull();
    expect(paths).toEqual([]);
    expect(() => seg('..')).toThrow(RangeError);
    expect(seg('a.b')).toBe('a.b');
  });

  it('says no one has a name only when the node says so', async () => {
    answer = () => ({
      status: 404,
      body: { error: 401, message: 'name unknown' },
    });
    await expect(nameDataRead('Nobody').load()).resolves.toBeNull();
    answer = () => ({ status: 500, body: { error: 1, message: 'busy' } });
    await expect(nameDataRead('Nobody').load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
  });

  it('takes only the node\'s own "name unknown" for no one having it', async () => {
    answer = () => ({ status: 404, body: '<html>Not found</html>' });
    await expect(nameDataRead('Publisher').load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
    answer = () => ({
      status: 404,
      body: { error: 401, message: 'name unknown' },
    });
    await expect(nameDataRead('Publisher').load()).resolves.toBeNull();
  });

  it('takes a failed read of a primary name for a failure, not for no name', async () => {
    answer = () => ({ status: 404, body: '<html>Not found</html>' });
    await expect(primaryNameRead(ADDRESS).load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
  });

  it('returns the name as registered: the node matches it ignoring case', async () => {
    answer = () => ({ body: { name: 'Publisher', owner: ADDRESS } });
    await expect(nameDataRead('publisher').load()).resolves.toEqual({
      name: 'Publisher',
      owner: ADDRESS,
    });
  });

  it('reads no primary name from an answer without one', async () => {
    answer = () => ({ body: { owner: ADDRESS } });
    await expect(primaryNameRead(ADDRESS).load()).resolves.toBeNull();
  });

  /** An account owning `owned` names, answered as the node pages them. */
  const owning = (owned: number) => (path: string) => {
    const query = new URL(`http://x${path}`).searchParams;
    const offset = Number(query.get('offset'));
    const limit = Number(query.get('limit'));
    const count = Math.max(0, Math.min(limit, owned - offset));
    return {
      body: Array.from({ length: count }, (_, i) => ({
        name: `n${offset + i}`,
      })),
    };
  };

  it('reads names 100 at a time and says when it stopped early', async () => {
    answer = owning(501);
    const read = await namesOfRead(ADDRESS).load();
    expect(read.names).toHaveLength(500);
    expect(read.truncated).toBe(true);
    expect(paths).toHaveLength(6);
  });

  it("doesn't say it stopped early for an account with exactly 500 names", async () => {
    answer = owning(500);
    const read = await namesOfRead(ADDRESS).load();
    expect(read.names).toHaveLength(500);
    expect(read.truncated).toBe(false);
  });
});

describe('first seen', () => {
  it('is the oldest transaction involving the account, whatever its type', async () => {
    answer = () => ({
      body: [
        {
          type: 'ACCOUNT_LEVEL',
          timestamp: 1_500,
          signature: 's',
          blockHeight: 1,
        },
      ],
    });
    await expect(firstSeenRead(ADDRESS).load()).resolves.toEqual({
      height: 1,
      timestamp: 1_500,
      signature: 's',
    });
    expect(paths).toEqual([
      `/transactions/search?address=${ADDRESS}&confirmationStatus=CONFIRMED&limit=1&reverse=false`,
    ]);
  });

  it('is none only when the node has no transaction, and fails when the read fails', async () => {
    answer = () => ({ body: [] });
    await expect(firstSeenRead(ADDRESS).load()).resolves.toBeNull();
    answer = () => ({ status: 503, body: { error: 1, message: 'busy' } });
    await expect(firstSeenRead(ADDRESS).load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
  });
});

describe('names that are also routes of the node', () => {
  it('finds "search" through the node\'s name search', async () => {
    answer = (path) =>
      path.startsWith('/names/search?')
        ? {
            body: [
              { name: 'search', owner: ADDRESS },
              { name: 'searchlight', owner: 'x' },
            ],
          }
        : { body: { error: 999 } };
    await expect(nameDataRead('search').load()).resolves.toEqual({
      name: 'search',
      owner: ADDRESS,
    });
    expect(paths).toEqual(['/names/search?query=search&prefix=true&limit=100']);
  });
});

describe('the rest', () => {
  it("keeps a group's owner's primary name when the node sends it, and none when it doesn't", async () => {
    answer = () => ({
      body: [
        {
          groupId: 7,
          groupName: 'alpha',
          owner: ADDRESS,
          ownerPrimaryName: 'Second Room',
          isOpen: true,
        },
        { groupId: 694, groupName: 'MINTER', owner: NULL_ACCOUNT },
        { groupId: 9, groupName: 'beta', owner: ADDRESS, ownerPrimaryName: '' },
      ],
    });
    const groups = await groupsOfRead(ADDRESS).load();
    expect(groups.map((group) => group.ownerName)).toEqual([
      'Second Room',
      undefined,
      undefined,
    ]);
  });

  it("leaves Core's null account out of the Dev Admins", async () => {
    answer = () => ({
      body: {
        members: [{ member: NULL_ACCOUNT }, { member: ADDRESS, isAdmin: true }],
      },
    });
    await expect(devAdminsRead().load()).resolves.toEqual([ADDRESS]);
  });

  it('reads no last block for an account with no key, and the block time otherwise', async () => {
    answer = () => ({
      status: 404,
      body: { error: 304, message: 'public key not found' },
    });
    await expect(lastSignedRead(ADDRESS).load()).resolves.toBeNull();
    answer = (path) =>
      path.startsWith('/blocks/byheight/')
        ? { body: { height: 20, timestamp: 1_700_000_000_000 } }
        : { body: [{ height: 10 }, { height: 20 }] };
    await expect(lastSignedRead(ADDRESS).load()).resolves.toEqual({
      height: 20,
      timestamp: 1_700_000_000_000,
    });
  });

  it('says when the payments read came back full', async () => {
    const row = (i: number) => ({
      type: 'PAYMENT',
      timestamp: i,
      signature: `s${i}`,
    });
    answer = () => ({ body: Array.from({ length: 500 }, (_, i) => row(i)) });
    await expect(recentPaymentsRead(ADDRESS).load()).resolves.toMatchObject({
      full: true,
    });
    answer = () => ({ body: [row(1)] });
    await expect(recentPaymentsRead(ADDRESS).load()).resolves.toMatchObject({
      full: false,
    });
  });
});
