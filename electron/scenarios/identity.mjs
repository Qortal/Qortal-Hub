/**
 * Synthetic Q-Chat identities for scenarios.
 *
 * An identity is an Ed25519 keypair, the Qortal address derived from its public
 * key, a hex presence hash standing in for a Reticulum destination, and a
 * `signLocalFields` implementation compatible with `ReticulumChatManager`.
 *
 * No wallet, no Qortal Core, no Reticulum daemon. The address derivation is the
 * same `deriveAddressFromPublicKey` the shipping code uses, so events produced
 * here verify against the real validation path.
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';

const ELECTRON_DIR = new URL('..', import.meta.url).pathname;
const req = createRequire(join(ELECTRON_DIR, 'package.json'));

const nacl = req('tweetnacl');
const presence = req('./build/src/presence.js');

const { deriveAddressFromPublicKey, canonicalizeForSigning, base58Encode } =
  presence;

/**
 * Presence hashes must normalise as hex, 16–64 chars. `localPeerHash()` returns
 * `undefined` for anything else, and every route lookup then finds no next hop —
 * a failure mode that produces no error, just silence.
 */
export function hexPresence() {
  return Buffer.from(nacl.randomBytes(16)).toString('hex');
}

/**
 * @param {{ presence?: string, label?: string }} [options]
 */
export function makeIdentity(options = {}) {
  const keyPair = nacl.sign.keyPair();
  const publicKey = base58Encode(keyPair.publicKey);
  const address = deriveAddressFromPublicKey(publicKey);
  const presenceHash = options.presence ?? hexPresence();
  const label = options.label ?? address.slice(0, 6);

  return {
    label,
    keyPair,
    publicKey,
    address,
    presence: presenceHash,

    /**
     * Sign as the *verifier* will canonicalise, not as the caller wrote it.
     *
     * Several request builders omit `authorAddress` and `authorPublicKey` from
     * the fields they pass in — the manager adds them to the wire afterwards —
     * but the matching `verify*` function includes both in the signed set. Signing
     * only what arrives therefore produces a signature that every peer rejects,
     * and the caller sees a bare `null` with no reason. Injecting the identity
     * fields here mirrors what the real renderer signer does.
     *
     * The full return shape is also mandatory: returning only `publicKey` and
     * `signature` made `isValidatedGroupMember` throw on `undefined.trim()`,
     * crashing the process instead of logging a rejection.
     */
    signLocalFields: async (fields) => {
      const signedFields = {
        authorAddress: fields.authorAddress ?? address,
        authorPublicKey: fields.authorPublicKey ?? publicKey,
        ...fields,
      };
      return {
        authorAddress: address,
        authorPublicKey: publicKey,
        // Some receipt paths still read `publicKey`.
        publicKey,
        signature: base58Encode(
          nacl.sign.detached(
            new Uint8Array(canonicalizeForSigning(signedFields)),
            keyPair.secretKey
          )
        ),
      };
    },
  };
}

/**
 * Build a signed group-chat event as `identity`.
 *
 * `payloadHash` is derived from `encryptedPayload` because the manager
 * recomputes it during shape validation; a placeholder hash is rejected as
 * `Invalid event`.
 *
 * Every override is carried through, not just a whitelist. Renderer-side flags
 * such as `directMentionAuthorized` and `privilegedMentionAuthorized` are read by
 * the notification path and are not part of the signed field set, so silently
 * dropping them made scenarios resolve to "generic message" with no error.
 */
export function signEvent(identity, chat, overrides = {}) {
  const eventId = overrides.eventId ?? `evt-${hexPresence()}`;
  const encryptedPayload = overrides.encryptedPayload ?? `payload-${eventId}`;
  const timestamp = overrides.timestamp ?? Date.now();

  // Split rather than spreading `overrides` wholesale and re-asserting the
  // authoritative fields afterwards: duplicate object keys are a lint error, and
  // a future signed field added to `overrides` still needs to be covered by the
  // signature, which it is because signing happens below.
  const authoritative = new Set([
    'eventId',
    'encryptedPayload',
    'payloadHash',
    'authorAddress',
    'authorPublicKey',
    'signature',
  ]);
  const passthrough = Object.fromEntries(
    Object.entries(overrides).filter(([key]) => !authoritative.has(key))
  );

  const event = {
    ...passthrough,
    eventId,
    groupId: overrides.groupId ?? 716,
    channelId: overrides.channelId ?? 'general',
    authorAddress: identity.address,
    authorPublicKey: identity.publicKey,
    authorStreamId: overrides.authorStreamId ?? 'c'.repeat(32),
    authorSeq: overrides.authorSeq ?? timestamp,
    timestamp,
    eventType: overrides.eventType ?? 'message',
    encryptedPayload,
    payloadHash: chat.hashReticulumChatPayload(encryptedPayload),
    mentionAddressHashes: overrides.mentionAddressHashes ?? [],
    signature: '',
  };

  event.signature = base58Encode(
    nacl.sign.detached(
      new Uint8Array(
        canonicalizeForSigning(chat.buildReticulumChatSignedFields(event))
      ),
      identity.keyPair.secretKey
    )
  );

  return event;
}

export { nacl };
