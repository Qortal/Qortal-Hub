import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

import Base58Module from '../../encryption/Base58';
import { CoreHttpError, queryString } from './core';
import {
  decodePrivsRecipient,
  groupNameRead,
  privsRecipientRead,
  txRead,
  waitingRead,
} from './reads';

// The reads PR 2 adds: one transaction, a minting level's recipient from
// the raw bytes, a group's name, and what an account sent that waits for a
// block. "None" only from the node's own answer; anything else fails.

const SECOND = `Q${'S'.repeat(33)}`;
const SIG = '5'.repeat(88);
const KEY = 'k'.repeat(44);

const Base58 = Base58Module as unknown as {
  decode(text: string): Uint8Array;
  encode(bytes: Uint8Array): string;
};

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

/** A TRANSFER_PRIVS's raw bytes, in base58, moving the level to `recipient`. */
function privsBytes(recipient: string, type = 40): string {
  const bytes = new Uint8Array(137 + 64);
  new DataView(bytes.buffer).setInt32(0, type);
  bytes.set(Base58.decode(recipient), 112);
  return Base58.encode(bytes);
}

describe('queryString', () => {
  it('repeats the key of a list', () => {
    expect(queryString({ txType: ['A', 'B'], limit: 1, skip: undefined })).toBe(
      'txType=A&txType=B&limit=1'
    );
  });
});

describe('txRead', () => {
  it('reads a transaction by its encoded signature', async () => {
    answer = () => ({
      body: { type: 'PAYMENT', signature: SIG, timestamp: 1 },
    });
    expect(await txRead(SIG).load()).toMatchObject({ signature: SIG });
    expect(paths).toEqual([`/transactions/signature/${SIG}`]);
  });

  it('takes only "transaction unknown" for a signature the node doesn’t know', async () => {
    answer = () => ({
      status: 404,
      body: { error: 311, message: 'transaction unknown' },
    });
    expect(await txRead(SIG).load()).toBeNull();
    answer = () => ({ status: 500, body: { error: 1, message: 'busy' } });
    await expect(txRead(SIG).load()).rejects.toBeInstanceOf(CoreHttpError);
    answer = () => ({ body: { not: 'a transaction' } });
    await expect(txRead(SIG).load()).rejects.toBeInstanceOf(CoreHttpError);
  });

  it('is forgotten by Refresh on its signature', () => {
    expect(txRead(SIG).key.endsWith(`:${SIG}`)).toBe(true);
  });
});

describe('the minting level’s recipient', () => {
  it('is read from the raw bytes, as text', async () => {
    answer = () => ({ body: privsBytes(SECOND) });
    expect(await privsRecipientRead(SIG).load()).toBe(SECOND);
    expect(paths).toEqual([`/transactions/signature/${SIG}/raw`]);
  });

  it('is none for bytes of another type, too short, or not base58', () => {
    expect(decodePrivsRecipient(privsBytes(SECOND, 2))).toBeNull();
    expect(decodePrivsRecipient(Base58.encode(new Uint8Array(40)))).toBeNull();
    expect(decodePrivsRecipient('0OIl')).toBeNull();
  });

  it('fails on a failed read', async () => {
    answer = () => ({ status: 500, body: 'busy' });
    await expect(privsRecipientRead(SIG).load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
  });
});

describe('groupNameRead', () => {
  it('reads the name, and none only for "group unknown"', async () => {
    answer = () => ({ body: { groupId: 31, groupName: 'Garden club' } });
    expect(await groupNameRead(31).load()).toBe('Garden club');
    expect(paths).toEqual(['/groups/31']);
    answer = () => ({
      status: 404,
      body: { error: 1101, message: 'group unknown' },
    });
    expect(await groupNameRead(31).load()).toBeNull();
    answer = () => ({ status: 503, body: { error: 1, message: 'busy' } });
    await expect(groupNameRead(31).load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
  });
});

describe('waitingRead', () => {
  it('asks the node’s waiting list by the account’s public key, newest first', async () => {
    answer = () => ({
      body: [
        { type: 'PAYMENT', signature: 'a', timestamp: 1 },
        { type: 'PAYMENT', signature: 'b', timestamp: 3 },
      ],
    });
    const rows = await waitingRead(SECOND, KEY).load();
    expect(rows.map((row) => row.signature)).toEqual(['b', 'a']);
    const query = new URLSearchParams(paths[0].split('?')[1]);
    expect(paths[0].startsWith('/transactions/unconfirmed?')).toBe(true);
    expect(query.get('creator')).toBe(KEY);
    expect(query.get('limit')).toBe('100');
    expect(waitingRead(SECOND, KEY).key.endsWith(`:${SECOND}`)).toBe(true);
  });

  it('fails on a failed read, never an empty list', async () => {
    answer = () => ({ status: 500, body: { error: 1, message: 'busy' } });
    await expect(waitingRead(SECOND, KEY).load()).rejects.toBeInstanceOf(
      CoreHttpError
    );
  });
});
