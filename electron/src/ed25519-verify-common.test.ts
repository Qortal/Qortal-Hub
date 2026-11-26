import { describe, expect, it } from 'vitest';
import nacl from 'tweetnacl';
import {
  generateNativeEd25519KeyPair,
  signEd25519Detached,
  verifyEd25519Detached,
} from './ed25519-verify-common';

describe('native Ed25519 verification', () => {
  it('verifies TweetNaCl signatures and rejects invalid inputs', () => {
    const keyPair = nacl.sign.keyPair();
    const message = Uint8Array.from(
      Buffer.from('native-ed25519-compatibility', 'utf8')
    );
    const signature = nacl.sign.detached(message, keyPair.secretKey);

    expect(verifyEd25519Detached(message, signature, keyPair.publicKey)).toBe(
      true
    );
    expect(
      verifyEd25519Detached(
        Uint8Array.from(
          Buffer.from('tampered-native-ed25519-compatibility', 'utf8')
        ),
        signature,
        keyPair.publicKey
      )
    ).toBe(false);
    expect(
      verifyEd25519Detached(
        message,
        signature.subarray(0, signature.length - 1),
        keyPair.publicKey
      )
    ).toBe(false);
    expect(
      verifyEd25519Detached(
        message,
        signature,
        keyPair.publicKey.subarray(0, keyPair.publicKey.length - 1)
      )
    ).toBe(false);
  });

  it('produces standard detached signatures from native session keys', () => {
    const keyPair = generateNativeEd25519KeyPair();
    const message = Uint8Array.from(
      Buffer.from('native-ed25519-signing', 'utf8')
    );
    const signature = signEd25519Detached(message, keyPair.privateKey);

    expect(keyPair.publicKey).toHaveLength(nacl.sign.publicKeyLength);
    expect(signature).toHaveLength(nacl.sign.signatureLength);
    expect(
      nacl.sign.detached.verify(message, signature, keyPair.publicKey)
    ).toBe(true);
    expect(verifyEd25519Detached(message, signature, keyPair.publicKey)).toBe(
      true
    );
  });
});
