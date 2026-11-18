# Local Monero stagenet wallet testing

This desktop testing build keeps XMR keys, scanning and signing in Qortal Hub.
Q-Wallets-TESTING is a public front-end and never receives private keys, signed
transaction metadata or wallet files. Core only supplies the selected network.
This release does not support XMR mainnet spending, mobile/browser wallet engines
or QORT/XMR trades. Existing BTC-family local signing and Reticulum are retained.

## Matching Core and Q-App

Use the matching `xmr-support` Core JAR (including the prior ARRR changes). In the
owner-operated test Core's existing settings, add `"moneroNetwork":"STAGENET"`.
Keep `isTestNet` false/absent for Qortal mainnet. Back up the prior JAR/settings
and use the normal owner lifecycle to restart Core; verify `/admin/info` reports
`isTestNet:false` and `moneroNetwork:"stagenet"`. This source task does not change
or restart a live Core.

Open the matching Hub desktop build, unlock the ordinary Qortal account and open
`qortal://APP/Q-Wallets-TESTING/monero` once the owner publishes the testing ZIP.
The earlier address-only XMR AppImage cannot scan or send. A Vite browser tab
cannot supply the native wallet worker or native Reticulum runtime.

1. Choose **Connect XMR wallet** and approve address/wallet-info reads in Hub.
   Remembering the read permission avoids prompts during ten-second polling.
2. Choose restore height **0** for any previously used/restored account. A full
   recovery scan can take a long time and download substantial chain data. For a
   new, never-used stagenet wallet, explicitly choose **Use current height** and
   then **Open wallet and start scanning**. Hub asks separately before opening,
   even if the read permission was remembered. Starting later skips older funds.
3. Compare the address on reopen and in a fresh profile restored only from the
   ordinary Qortal backup, using the same selected network. XMR derivation v1 and
   the account backup format are unchanged.
4. Manually request worthless stagenet coins from the
   [Nodely faucet](https://faucet-stagenet.xmr.nodely.dev/). Its
   [operator guide](https://nodely.io/docs/monero/faucet/) documents claim limits,
   proof of work and payout timing. Wait for scanning and for funds to unlock.
5. Send a small amount to another private stagenet wallet. Amounts are decimal
   strings with up to 12 places. Hub shows the recipient, amount and maximum fee
   before local signing. The worker checks the checksum/network, balance, actual
   fee and selected account; fees above the approved cap are not broadcast.
   Standard addresses and subaddresses are supported; integrated addresses,
   payment IDs, memo and send-max are not supported in this first release.
6. Check history/balances on both sides, close/reopen, then verify backup recovery.
   Denial, changing Core/account during approval and insufficient unlocked funds
   must produce no new payment. Do not use public synthetic test-vector addresses.

The public daemon is `https://xmr.nodely.dev:38089`. HTTPS certificates are checked,
network identity is checked, and wallet2 treats it as **untrusted**. Keys and view
keys remain local, but an operator can observe IP/timing/transaction broadcasts;
this release is not an anonymity guarantee. A daemon outage is shown in the UI
and scans retry. Multiple independent daemon selection/failover is future work.

## Cache and interrupted payments

Each account/network/address has its own directory under
`<appData>/qortal-hub/monero/<sha256 identity>/`. Wallet2 keys/cache are encrypted
with a deterministic, domain-separated password derived locally from the spend
key. The directory is private to the OS user. No private material is written to
Core, QDN or logs. Account/network changes, logout and shell destruction terminate
the worker and drop its in-memory session. The cache can be recreated from the
ordinary account backup and an appropriate restore height.

Before broadcast, the worker atomically writes and fsyncs an AES-GCM encrypted
pending-payment journal. Uncertain results block new payments. **Rebroadcast
pending payment** asks for approval and uses only the same signed transaction and
hash; it does not construct a replacement payment. The journal is cleared after a
subsequent scan observes the transaction, the daemon reports it in-pool/on-chain,
and local spent state has been saved. Never manually delete a pending journal to
retry a payment. A process lock prevents two local Hub instances from opening the
same cache. A live, corrupt or competing recovery lock fails closed.

Keep the previous AppImage/JAR/settings for rollback. Switching binaries does
not remove the encrypted cache/journal. Preserve those files if a payment is
pending; do not use an older wallet build to attempt a replacement. Removing the
Core `moneroNetwork` override later restores normal mainnet/mainnet and
Qortal-testnet/stagenet selection, but this first engine still permits stagenet
operations only. The two network wallets have separate addresses/caches.

## Repeatable native verification

Use supported Node 22 and install root and Electron dependencies from lockfiles.
Compile Electron with `cd electron && npx tsc -p tsconfig.json` before native
worker checks. Run the focused XMR, foreign-wallet and Q-App lifetime tests from
the root with `npx vitest run ...`.

`scripts/verify-xmr-wallet-worker.mjs` requires `XMR_MONEROD_PATH` pointing to a
separately verified official Monero binary. It starts its own temporary, offline,
loopback-only regression daemon and generates disposable local coins. A test-only
SDK adapter selects regtest/mainnet address format; the production worker and
wallet2 signing path run unchanged. The test scans funds, sends a 12-decimal
amount, simulates a lost response after actual relay, restarts the worker, checks
its encrypted journal, rebroadcasts only the same hash, reconciles spent state
and checks the recipient balance. It stops only its own daemon and removes its
own temporary files. No public faucet or real-value transaction is involved.

Linux AppImages must use `./build-appimage.sh` through the required Docker build.
Check its fresh `electron/dist/desktop-build.json` receipt, source commit and
packaged worker/SDK before distributing. If Docker is unavailable, retain the
previous artifact and report the blocker; do not relabel it as the new wallet.
