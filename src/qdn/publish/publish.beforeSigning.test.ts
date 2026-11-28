import { beforeEach, describe, expect, it, vi } from 'vitest';

// publishData against a fake node: it uploads, has Core turn the transaction
// into the bytes to sign, reads the key pair, and only then signs and sends.
// `beforeSigning` is the caller's last word on the key that signs.

const NODE = 'http://127.0.0.1:12391';
const keys = vi.hoisted(() => ({
  pair: null as null | { privateKey: string; publicKey: string },
}));

vi.mock('../../background/background', () => ({
  createEndpoint: vi.fn(async (path: string) => `${NODE}${path}`),
  getBaseApi: vi.fn(async () => NODE),
}));
vi.mock('../../utils/chromeStorage', () => ({
  getData: vi.fn(async (key: string) => (key === 'keyPair' ? keys.pair : null)),
}));
vi.mock('../../utils/events', () => ({ executeEvent: vi.fn() }));

import Base58Untyped from '../../encryption/Base58';
import naclUntyped from '../../encryption/nacl-fast';
import { publishData } from './publish';

const Base58 = Base58Untyped as any;
const nacl = naclUntyped as any;

const pair = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(1));
const OWN = {
  privateKey: Base58.encode(pair.secretKey) as string,
  publicKey: Base58.encode(pair.publicKey) as string,
};
const UNSIGNED = Base58.encode(new Uint8Array([1, 2, 3, 4])) as string;
const FOR_SIGNING = Base58.encode(new Uint8Array([5, 6, 7, 8])) as string;

/** The node, answering by path; `steps` records what it was asked to do. */
function stubNode(steps: string[]) {
  const fetchMock = vi.fn(async (url: string) => {
    const path = String(url).slice(NODE.length);
    if (path.startsWith('/names/')) {
      return new Response(JSON.stringify({ name: 'Publisher' }));
    }
    if (path.startsWith('/arbitrary/')) {
      steps.push('upload');
      return new Response(UNSIGNED);
    }
    if (path === '/transactions/convert') {
      steps.push('convert');
      return new Response(FOR_SIGNING);
    }
    if (path.startsWith('/transactions/process')) {
      steps.push('send');
      return new Response(JSON.stringify({ signature: 'PUBLISH_SIG' }));
    }
    throw new Error(`unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const publish = (beforeSigning?: (publicKey: string) => void) =>
  publishData({
    registeredName: 'Publisher',
    data: 'QQ==',
    service: 'BLOG_POST',
    identifier: 'post-1',
    uploadType: 'base64',
    withFee: true,
    feeAmount: 1000000,
    beforeSigning,
  });

beforeEach(() => {
  keys.pair = OWN;
  vi.unstubAllGlobals();
});

describe('publishData and the key that signs', () => {
  it('gives the caller the public key it signs with, after the upload and before it signs', async () => {
    const steps: string[] = [];
    stubNode(steps);
    const beforeSigning = vi.fn((publicKey: string) =>
      steps.push(`check ${publicKey}`)
    );
    await expect(publish(beforeSigning)).resolves.toEqual({
      signature: 'PUBLISH_SIG',
    });
    expect(steps).toEqual([
      'upload',
      'convert',
      `check ${OWN.publicKey}`,
      'send',
    ]);
  });

  it('signs and sends nothing when the caller refuses the key', async () => {
    const steps: string[] = [];
    stubNode(steps);
    await expect(
      publish(() => {
        throw new Error('not the account that asked');
      })
    ).rejects.toThrow('not the account that asked');
    expect(steps).toEqual(['upload', 'convert']);
  });

  it('publishes as before for a caller with nothing to check', async () => {
    const steps: string[] = [];
    stubNode(steps);
    await expect(publish()).resolves.toEqual({ signature: 'PUBLISH_SIG' });
    expect(steps).toEqual(['upload', 'convert', 'send']);
  });
});
