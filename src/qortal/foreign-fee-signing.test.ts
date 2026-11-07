import { describe, expect, it, vi } from 'vitest';
import { base58 as Base58 } from '@scure/base';
import nacl from 'tweetnacl';
import {
  MAX_FOREIGN_FEE_BATCH,
  signValidatedForeignFees,
  validateForeignFeeBatch,
  type ForeignFeeSigningContext,
} from './foreign-fee-signing';

// Independently encoded using Python int.to_bytes + double-SHA256 checksum;
// matches Core's Longs.toByteArray / Base58.decode / Ints.toByteArray layout.
const vector = {
  timestamp: 1700000000123,
  atAddress: 'AFsBXShNPGXJCSpxmFnTWEm3UHqyohhEgP',
  fee: 250,
  data: '119wyg1KH1Pbyvqbx5Xe862QJ4bw2Bn66q4A5CV9T4skC4utM',
};
const vectorHex =
  '0000018bcfe5687b170101010101010101010101010101010101010101cd87d340000000fa';
const user = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(17));
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
function fixture() {
  const context: ForeignFeeSigningContext = {
    address: 'synthetic-account',
    publicKey: Base58.encode(user.publicKey),
    unsignedUrl: 'https://core.invalid/unsignedfees/account',
    signedUrl: 'https://core.invalid/signedfees',
    revision: 0,
  };
  const key = new Uint8Array(user.secretKey);
  const getContext = vi.fn(async () => ({ ...context }));
  const getPrivateKey = vi.fn(async () => key);
  const approve = vi.fn(async (_fees) => true);
  const fetchMock = vi.fn(async (_url, options?) =>
    options?.method === 'POST' ? json(true) : json([vector])
  );
  const assertRevision = vi.fn((revision) => {
    if (revision !== context.revision) throw new Error('changed');
  });
  return {
    context,
    key,
    getContext,
    getPrivateKey,
    approve,
    fetch: fetchMock,
    assertRevision,
  };
}

describe('foreign fee byte validation', () => {
  it('matches the Core-compatible golden vector', () => {
    const [fee] = validateForeignFeeBatch([vector]);
    expect(Buffer.from(fee.bytes).toString('hex')).toBe(vectorHex);
    expect(fee.bytes.length).toBe(37);
  });
  it.each([
    { timestamp: '1700000000123' },
    { timestamp: -1 },
    { timestamp: 0 },
    { timestamp: Number.MAX_SAFE_INTEGER + 1 },
    { timestamp: 1.5 },
    { fee: '250' },
    { fee: -1 },
    { fee: 0x80000000 },
    { fee: 1.5 },
    { fee: 251 },
    { atAddress: 'AFsBXShNPGXJCSpxmFnTWEm3UHqyohhEgQ' },
    { atAddress: '1'.repeat(25) },
    { data: '' },
    { data: '0OIl' },
    { data: '1'.repeat(52) },
    { data: Base58.encode(new Uint8Array([...Base58.decode(vector.data), 0])) },
  ])('rejects malformed or mismatched fee data: %j', (change) => {
    expect(() => validateForeignFeeBatch([{ ...vector, ...change }])).toThrow(
      'invalid'
    );
  });
  it('accepts valid protocol boundary values without truncating them', () => {
    for (const fee of [0, 0x7fffffff]) {
      const bytes = Base58.decode(vector.data);
      new DataView(bytes.buffer).setInt32(33, fee, false);
      expect(
        validateForeignFeeBatch([
          { ...vector, fee, data: Base58.encode(bytes) },
        ])[0].fee
      ).toBe(fee);
    }
  });
  it('rejects duplicates, invalid batch shapes and excess entries', () => {
    for (const value of [
      null,
      {},
      [null],
      [vector, vector],
      Array(MAX_FOREIGN_FEE_BATCH + 1).fill(vector),
    ]) {
      expect(() => validateForeignFeeBatch(value)).toThrow('invalid');
    }
    expect(validateForeignFeeBatch([])).toEqual([]);
  });
});

describe('foreign fee signing lifecycle', () => {
  it('requires approval and signs only the validated snapshot with a Core-verifiable signature', async () => {
    const f = fixture();
    f.approve.mockImplementation(async (fees) => {
      expect(fees).toEqual([
        { timestamp: vector.timestamp, atAddress: vector.atAddress, fee: 250 },
      ]);
      fees[0].fee = 999; // The dialog cannot mutate the approved signing snapshot.
      return true;
    });
    expect(await signValidatedForeignFees(f)).toBe(true);
    expect(f.approve).toHaveBeenCalledOnce();
    const posted = JSON.parse(f.fetch.mock.calls[1][1].body as string);
    expect(posted[0]).toMatchObject({
      timestamp: vector.timestamp,
      atAddress: vector.atAddress,
      fee: 250,
    });
    expect(
      nacl.sign.detached.verify(
        Base58.decode(vector.data),
        Base58.decode(posted[0].data),
        user.publicKey
      )
    ).toBe(true);
    expect(f.key.every((byte) => byte === 0)).toBe(true);
  });
  it('rejects the entire batch before approval or key access when any entry is invalid', async () => {
    const f = fixture();
    f.fetch.mockResolvedValue(
      json([vector, { ...vector, data: Base58.encode(new Uint8Array(148)) }])
    );
    await expect(signValidatedForeignFees(f)).rejects.toThrow('invalid');
    expect(f.approve).not.toHaveBeenCalled();
    expect(f.getPrivateKey).not.toHaveBeenCalled();
    expect(f.fetch).toHaveBeenCalledOnce();
  });
  it('does not sign or submit when approval is declined', async () => {
    const f = fixture();
    f.approve.mockResolvedValue(false);
    await expect(signValidatedForeignFees(f)).rejects.toThrow('declined');
    expect(f.getPrivateKey).not.toHaveBeenCalled();
    expect(f.fetch).toHaveBeenCalledOnce();
  });
  it('treats an empty valid batch as a no-op without prompting or accessing keys', async () => {
    const f = fixture();
    f.fetch.mockResolvedValue(json([]));
    expect(await signValidatedForeignFees(f)).toBe(true);
    expect(f.approve).not.toHaveBeenCalled();
    expect(f.getPrivateKey).not.toHaveBeenCalled();
  });
  it.each([
    'address',
    'publicKey',
    'unsignedUrl',
    'signedUrl',
    'revision',
  ] as const)('cancels a changed %s after approval', async (field) => {
    const f = fixture();
    f.approve.mockImplementation(async () => {
      (f.context as any)[field] = field === 'revision' ? 1 : 'changed';
      return true;
    });
    await expect(signValidatedForeignFees(f)).rejects.toThrow('changed');
    expect(f.getPrivateKey).not.toHaveBeenCalled();
    expect(f.fetch).toHaveBeenCalledOnce();
  });
  it('rechecks after asynchronous private-key retrieval', async () => {
    const f = fixture();
    f.getPrivateKey.mockImplementation(async () => {
      f.context.revision++;
      return f.key;
    });
    await expect(signValidatedForeignFees(f)).rejects.toThrow('changed');
    expect(f.fetch).toHaveBeenCalledOnce();
    expect(f.key.every((byte) => byte === 0)).toBe(true);
  });
  it('refuses a private key belonging to another account', async () => {
    const f = fixture();
    f.getPrivateKey.mockResolvedValue(
      new Uint8Array(
        nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(29)).secretKey
      )
    );
    await expect(signValidatedForeignFees(f)).rejects.toThrow('changed');
    expect(f.fetch).toHaveBeenCalledOnce();
  });
  it('bounds response size before parsing or approval', async () => {
    const f = fixture();
    f.fetch.mockResolvedValue(new Response(' '.repeat(512 * 1024 + 1)));
    await expect(signValidatedForeignFees(f)).rejects.toThrow('invalid');
    expect(f.approve).not.toHaveBeenCalled();
  });
  it('does not prompt after an HTTP failure', async () => {
    const f = fixture();
    f.fetch.mockResolvedValue(json({}, 500));
    await expect(signValidatedForeignFees(f)).rejects.toThrow('failed');
    expect(f.approve).not.toHaveBeenCalled();
  });
  it.each([false, {}, null])(
    'does not report Core rejection as success: %j',
    async (result) => {
      const f = fixture();
      f.fetch.mockImplementation(async (_url, options) =>
        options?.method === 'POST' ? json(result) : json([vector])
      );
      await expect(signValidatedForeignFees(f)).rejects.toThrow('failed');
    }
  );
});
