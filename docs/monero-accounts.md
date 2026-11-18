# Hub XMR accounts and Qortal backup recovery

Status: deterministic account foundation on `xmr-support`, retaining owner `main` (`b6c87277`) and upstream master history. The later [native stagenet wallet](monero-stagenet-wallet.md) adds desktop scanning, balances/history and approved payments using `monero-ts` 0.11.22. Direct swaps and mainnet spending remain disabled. No production rollout is performed.

## Account ownership

`PhraseWallet.genAddress()` now builds an `xmrWallet` alongside the existing BTC/LTC/DOGE/DGB/RVN/ARRR wallets. It contains separate deterministic mainnet and stagenet key pairs. Account creation, phrase restoration and encrypted-backup restoration all use that same path. Existing coin derivation is unchanged.

`background.decryptWallet()` places XMR keys in Hub's existing encrypted `keyPair` record, not in plaintext `walletInfo`. XMR is not passed to the Bitcoin-family native signer. Qortal Hub owns the keys; Q-Apps and Core do not receive private spend/view keys or wallet seed material. This is the current trusted Hub renderer/storage boundary, not a claim of OS hardware-backed secret isolation or guaranteed JavaScript memory erasure.

An already-unlocked session from an older Hub build has no XMR record. Lock/log out and unlock the ordinary account backup once to reconstruct it. Do not create a separate random XMR wallet to fill that missing record.

## Recovery contract: derivation version 1

This is a Hub-specific deterministic derivation. It does not reinterpret an existing Qortal EdDSA key or Bitcoin HD key as a Monero spend key. Keep these bytes permanent for existing wallets.

Inputs are:

- The existing **32-byte Qortal per-address seed** produced by `PhraseWallet`.
- The Qortal wallet version (`1` or `2`), encoded as an unsigned 32-bit big-endian integer.
- The Qortal address nonce, in `0..2147483647`, encoded as unsigned 32-bit big-endian. This explicitly separates legacy version 1 nonces even though that version reused its address seed.
- The ASCII network name, exactly `mainnet` or `stagenet`.

For counter `0`, then successive unsigned 32-bit values only if a zero scalar is encountered:

```text
context = UTF8("QortalHub/XMR/spend/v1\0")
          || ASCII(network) || 0x00
          || uint32BE(qortalWalletVersion)
          || uint32BE(addressNonce)
          || uint32BE(counter)
material = HMAC-SHA512(key = addressSeed, message = context)
l = 2^252 + 27742317777372353535851937790883648493
spend = littleEndianInteger(material) mod l
spendBytes = littleEndian32(spend)
view = littleEndianInteger(Keccak256(spendBytes)) mod l
```

Retry only if either scalar is zero; exhausting the counter fails closed. Public keys are direct Edwards base-point multiplication by those scalars, serialized as compressed 32-byte points. Do not call EdDSA's seed-expanding `getPublicKey()`. Standard address payloads are prefix `18` (mainnet) or `24` (stagenet), public spend key, then public view key. Append the first four Keccak-256 checksum bytes and use Monero block-Base58. Account derivation uses the existing pinned Noble/scure dependencies; the separate Electron wallet engine bundles `monero-ts` 0.11.22.

The [Monero key implementation](https://github.com/monero-project/monero/blob/v0.18.5.4/src/crypto/crypto.cpp), [account view-key derivation](https://github.com/monero-project/monero/blob/v0.18.5.4/src/cryptonote_basic/account.cpp) and [block-Base58 implementation](https://github.com/monero-project/monero/blob/v0.18.5.4/src/common/base58.cpp) are interoperability references. The HMAC domain and account-input scheme above are specific to Hub.

Backups retain their existing fields: `address0`, `encryptedSeed`, `salt`, `iv`, `version`, `mac`, and `kdfThreads`. The encrypted root seed reconstructs the address seed and hence both XMR wallets. There is no extra plaintext private key, independent random seed, or second backup file. `XMR_DERIVATION_VERSION = 1` is the fixed default for these existing backups; a future scheme must preserve this recovery path, not silently replace that constant or domain.

Scan caches and restore heights are separate from spending authority. Losing them requires a safe rescan/recovery policy. The public account API returns the primary address at nonce zero; the desktop engine keeps its encrypted scan cache separately. Use restore height 0 for recovery.

## Public Q-App interface

The existing permissioned request now accepts:

```js
await qortalRequest({ action: 'GET_USER_WALLET', coin: 'XMR' });
```

The response contains exactly `address`, `network`, `derivationVersion`, `publicSpendKey`, and `publicViewKey`. It is an explicit projection, so adding future secret fields to the account record cannot expose them automatically. Private spend/view keys, mnemonic, seed, account object and encrypted key/cache files are excluded.

Hub chooses the network from its selected Qortal Core's `/admin/info` response:

| Qortal mode                 | XMR network   |
| --------------------------- | ------------- |
| `isTestNet: false`          | mainnet       |
| `isTestNet: true`           | stagenet      |
| Missing or non-boolean flag | request fails |

A valid Core `moneroNetwork` hint (`mainnet` or `stagenet`) explicitly overrides the table for wallet selection. This permits Qortal mainnet with Monero stagenet during testing without changing Qortal consensus. An invalid hint fails closed. An app-supplied network is not used. The separate Monero testnet is not selected. The existing wallet permission must be granted before reading XMR keys or node mode. The request binds the account/Core revision before approval and rechecks it after asynchronous reads; switching accounts or Core invalidates the result. The stored Qortal public key must also resolve to the active backup's `address0`.

`GET_USER_WALLET` remains a public-only projection. The separate native desktop engine handles XMR balance, wallet-info, history and send calls before legacy eight-decimal/Core RPC paths; see [stagenet wallet testing](monero-stagenet-wallet.md). Read permission does not authorize wallet initialization or a payment. Those require explicit Hub approvals. Unsupported platforms/mainnet functional operations fail closed. The `MONERO` alias remains unsupported; use coin `XMR`.

## Verification

All fixtures are public synthetic accounts. Never fund them.

- Sixteen account/network vectors were generated independently using Python HMAC/SHA-512, PyCryptodome 3.23.0 Keccak and PyNaCl 1.5.0/libsodium point multiplication. Production Noble/scure outputs must match every scalar, public key and address.
- All sixteen vectors also match the actual `monero-ts` 0.11.22 full-wallet WASM engine with network access blocked, including private view keys and public addresses/keys.
- Eight pre-XMR snapshots cover all existing coin-wallet objects and Qortal keys for wallet versions 1/2, nonces 0/1 and 32/64-byte root seeds where supported. Their hashes remain unchanged after excluding the new XMR record.
- Backup tests use real bcrypt, the existing KDF, AES and HMAC; only the jsdom-to-Worker boundary is adapted. They restore a frozen pre-XMR encrypted backup, round-trip new backups for both wallet versions, reject incorrect passwords/modified authentication data and reproduce the phrase-created XMR wallet in a fresh instance.
- Public projection, encrypted Hub storage, Q-App permission, missing mode, stale approval/account/Core revision and account mismatch tests cover secret boundaries.

Use the repository's supported Node toolchain (CI uses Node 22; these targeted checks also run on installed Node 20.19.2). Reproduce:

```sh
npx vitest run src/lib/monero src/utils/generateWallet/monero-backup.test.ts \
  src/qortal/monero-wallet.test.ts src/qortal/__tests__/moneroWallet.test.ts \
  src/utils/chromeStorage.foreign-wallet.test.ts src/lib/foreign-wallet
```

Independent vector regeneration/checking requires only test tools:

```sh
python3 -m venv /tmp/hub-xmr-vectors
/tmp/hub-xmr-vectors/bin/pip install PyNaCl==1.5.0 pycryptodome==3.23.0
/tmp/hub-xmr-vectors/bin/python scripts/generate-xmr-account-vectors.py
```

For the full Monero engine comparison, install the pinned SDK outside Hub:

```sh
npm install --prefix /tmp/hub-xmr-sdk --ignore-scripts --no-audit --no-fund monero-ts@0.11.22
XMR_MONERO_TS_PATH=/tmp/hub-xmr-sdk/node_modules/monero-ts \
  node scripts/verify-xmr-monero-engine.mjs
```

The SDK source tag is [v0.11.22](https://github.com/woodser/monero-ts/releases/tag/v0.11.22). This verification does not establish mainnet scanning performance, actual Electron/mobile runtime acceptance, hardware-backed custody, a cryptographic audit, a funded payment or atomic-swap safety.

## Build, rollout and recovery

For Linux acceptance use the [desktop AppImage testing guide](xmr-desktop-testing.md).
The browser-only Vite server cannot run Reticulum or this branch's isolated
desktop Q-App viewer. Test public XMR account requests inside the AppImage.

This is a source branch increment, not a deployed release. Build the renderer and sync it before any desktop development test:

```sh
npm run build
npx cap sync @capacitor-community/electron
```

For a separately authorized regular Linux x64 test artifact, use the repository's Docker wrapper `./build-appimage.sh`, verify its completion receipt, and preserve the previous artifact. Do not substitute a local AppImage build or publish/update feeds from this task branch. Windows/macOS packages use the existing documented test-release tooling.

Before an authorized wallet rollout, restore a development backup in a clean Hub profile and confirm public XMR addresses on both modes, denied permissions, account switching and re-unlock. Scan/send acceptance now uses the matching native desktop engine and testing guide linked above. No service restart or server rollout is needed for this source-only delivery.

Recovery: retain the original Qortal backup and this derivation version. Reverting the focused commit removes XMR account/API availability while leaving the backup format and previous coin derivations unchanged. It does not destroy XMR recovery authority in that backup. If a test wallet is ever funded in later acceptance, retain a compatible recovery build and its derivation specification before downgrading; do not replace it with a newly generated XMR key.
