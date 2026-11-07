import { createCipheriv, randomBytes, webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decryptAesCtrChunk } from './aes-ctr-stream';

afterEach(() => vi.unstubAllGlobals());

describe('streamed-v1 download decryption', () => {
  it.each([true, false])(
    'decrypts arbitrary network read boundaries (WebCrypto: %s)',
    async (native) => {
      vi.stubGlobal('crypto', native ? webcrypto : {});
      const key = randomBytes(32);
      const iv = randomBytes(16);
      const plain = randomBytes(1024);
      const cipher = createCipheriv('aes-256-ctr', key, iv);
      const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
      const parts: Uint8Array[] = [];
      const lengths = [1, 15, 17, 127, 251];
      let offset = 0;
      for (let index = 0; offset < encrypted.length; index++) {
        const end = Math.min(
          encrypted.length,
          offset + lengths[index % lengths.length]
        );
        parts.push(
          await decryptAesCtrChunk(
            key,
            iv,
            offset,
            encrypted.subarray(offset, end)
          )
        );
        offset = end;
      }
      expect(Buffer.concat(parts)).toEqual(plain);
    }
  );

  it.each([true, false])(
    'retains offsets beyond 2 GiB (WebCrypto: %s)',
    async (native) => {
      vi.stubGlobal('crypto', native ? webcrypto : {});
      const key = randomBytes(32);
      const iv = randomBytes(16);
      const offset = 2 ** 32 + 7;
      const counterValue =
        (BigInt('0x' + iv.toString('hex')) + BigInt(Math.floor(offset / 16))) %
        (1n << 128n);
      const counter = Buffer.from(
        counterValue.toString(16).padStart(32, '0'),
        'hex'
      );
      const plain = randomBytes(103);
      const cipher = createCipheriv('aes-256-ctr', key, counter);
      const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
      expect(
        Buffer.from(
          await decryptAesCtrChunk(key, iv, offset, encrypted.subarray(7))
        )
      ).toEqual(plain.subarray(7));
    }
  );
});
