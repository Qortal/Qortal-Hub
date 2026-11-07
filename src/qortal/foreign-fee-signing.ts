import { sha256 } from '@noble/hashes/sha256';
import legacyBase58 from '../encryption/Base58';
import legacyNacl from '../encryption/nacl-fast';

// These bundled legacy modules do not declare their exported API types.
// Keep Hub's existing codecs and signer, with a typed boundary for this path.
const Base58 = legacyBase58 as {
  encode(bytes: Uint8Array): string;
  decode(value: string): Uint8Array;
};
const nacl = legacyNacl as typeof import('tweetnacl');

export class ForeignFeeSigningError extends Error {
  constructor(
    public code: 'invalid' | 'changed' | 'declined' | 'failed' | 'busy'
  ) {
    super(code);
  }
}
function fail(code: ForeignFeeSigningError['code']): never {
  throw new ForeignFeeSigningError(code);
}
export const MAX_FOREIGN_FEE_BATCH = 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
export type ForeignFee = { timestamp: number; atAddress: string; fee: number };
type ValidatedFee = ForeignFee & { bytes: Uint8Array };
export type ForeignFeeSigningContext = {
  address: string;
  publicKey: string;
  unsignedUrl: string;
  signedUrl: string;
  revision: number;
};

function decode(value: unknown, maxLength: number): Uint8Array {
  if (typeof value !== 'string' || !value.length || value.length > maxLength)
    fail('invalid');
  try {
    const result = Base58.decode(value);
    if (Base58.encode(result) !== value) fail('invalid');
    return result;
  } catch {
    return fail('invalid');
  }
}
const equal = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/** Core's ForeignFeesMessageUtils: big-endian int64 + AT address + int32.
 * Sign ONLY these locally constructed 37 bytes, never a Core-supplied buffer.
 */
export function validateForeignFeeBatch(value: unknown): ValidatedFee[] {
  if (!Array.isArray(value) || value.length > MAX_FOREIGN_FEE_BATCH)
    fail('invalid');
  const seen = new Set<string>();
  return (value as unknown[]).map((item: any) => {
    if (
      !item ||
      !Number.isSafeInteger(item.timestamp) ||
      item.timestamp <= 0 ||
      !Number.isInteger(item.fee) ||
      item.fee < 0 ||
      item.fee > 0x7fffffff
    )
      fail('invalid');
    const address = decode(item.atAddress, 35);
    if (
      address.length !== 25 ||
      address[0] !== 23 ||
      !equal(
        address.subarray(21),
        sha256(sha256(address.subarray(0, 21))).subarray(0, 4)
      ) ||
      seen.has(item.atAddress)
    )
      fail('invalid');
    seen.add(item.atAddress);
    const bytes = new Uint8Array(37);
    const view = new DataView(bytes.buffer);
    view.setBigInt64(0, BigInt(item.timestamp), false);
    bytes.set(address, 8);
    view.setInt32(33, item.fee, false);
    if (!equal(bytes, decode(item.data, 51))) fail('invalid');
    return {
      timestamp: item.timestamp,
      atAddress: item.atAddress,
      fee: item.fee,
      bytes,
    };
  });
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) fail('failed');
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) fail('invalid');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return fail('invalid');
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function signValidatedForeignFees(ports: {
  getContext: () => Promise<ForeignFeeSigningContext>;
  assertRevision: (revision: number) => void;
  getPrivateKey: () => Promise<Uint8Array>;
  approve: (fees: ForeignFee[]) => Promise<boolean>;
  fetch: typeof fetch;
}): Promise<true> {
  const initial = { ...(await ports.getContext()) };
  const check = async () => {
    const current = await ports.getContext();
    if (Object.keys(initial).some((key) => initial[key] !== current[key]))
      fail('changed');
    ports.assertRevision(initial.revision);
  };
  const response = await ports.fetch(initial.unsignedUrl, {
    signal: AbortSignal.timeout(30_000),
  });
  const fees = validateForeignFeeBatch(await readBoundedJson(response));
  await check();
  if (!fees.length) return true;
  // A separate copy goes to the dialog: neither UI mutation nor a delayed Core
  // response may change the bytes or metadata that were validated for signing.
  if (
    !(await ports.approve(
      fees.map(({ timestamp, atAddress, fee }) => ({
        timestamp,
        atAddress,
        fee,
      }))
    ))
  )
    fail('declined');
  await check();
  const key = await ports.getPrivateKey();
  try {
    await check();
    const publicKey = decode(initial.publicKey, 44);
    if (
      key.length !== 64 ||
      publicKey.length !== 32 ||
      !equal(key.subarray(32), publicKey) ||
      !equal(
        nacl.sign.keyPair.fromSeed(key.subarray(0, 32)).publicKey,
        publicKey
      )
    )
      fail('changed');
    const signed = fees.map(({ bytes, ...fee }) => ({
      ...fee,
      data: Base58.encode(nacl.sign.detached(bytes, key)),
    }));
    // No asynchronous work between the last revision check, signing and send.
    ports.assertRevision(initial.revision);
    const result = await ports.fetch(initial.signedUrl, {
      method: 'POST',
      headers: { Accept: '*/*', 'Content-Type': 'application/json' },
      body: JSON.stringify(signed),
      signal: AbortSignal.timeout(30_000),
    });
    // A malformed acknowledgement is a submission failure, not an invalid
    // unsigned batch: signatures have already been sent at this point.
    try {
      if ((await readBoundedJson(result)) !== true) fail('failed');
    } catch {
      fail('failed');
    }
    return true;
  } finally {
    key.fill(0);
  }
}
