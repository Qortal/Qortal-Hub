# ARRR preparation before a cross-chain trade

The `xmr-support` Hub branch adds a separate owned Sapling preparation approval
inside the existing `CREATE_TRADE_BUY_ORDER` path. It requires matching Core
`/crosschain/arrr/tradepreparation` and JNI 0.3.11. Older libraries fail closed;
the existing AppImage does not acquire renderer changes until it is rebuilt.

A ready Sapling or mixed wallet proceeds normally. An Ironwood-only wallet
quotes all currently spendable Ironwood funds minus the additional 0.0001 ARRR
fee to an owned Sapling address. The separate approval explains that this
self-payment remains in the wallet even if the intended trade does not proceed.
No requesting Q-App receives the entropy or signs this self-payment.

The account, signing revision and selected Core are checked across the approval,
preparation and final trade submission. Decline, timeout, insufficient funds,
changed context and unsupported/malformed replies stop trade submission. Hub
polls for confirmed and witnessed readiness for up to eight minutes; polling
never approves another payment. A later retry asks to resume the native wallet's
saved signed transaction. Unknown submission outcomes must not be cleared or
replaced to make another payment.

All 13 new messages are translated in the 12 supported locales. Focused helper
and buy-order tests cover consent, fee/input amount handling, pending recovery,
context changes and prevention of premature trade submission. Native proof and
reservation tests live in the matching Stashi wallet fork; Core acceptance and
rollout instructions are in its `docs/arrr-sapling-preparation-testing.md`.

Build the regular Linux AppImage using `./build-appimage.sh` and verify its
`electron/dist/desktop-build.json` receipt. A Vite build and successful Capacitor
sync do not replace the existing AppImage. Keep the previous AppImage for
rollback, preserving Core's current wallet database, preparation sidecars and
trade recovery records. No database migration is introduced by this flow.
# November 23 first-use and timeout follow-up

The matching `qdn-performance` Core adds authenticated
`/crosschain/arrr/walletinitialization`. Hub checks it before an ARRR wallet is
first opened on each node. The default recovers historical transactions from
Core's configured birthday. Check the new-wallet checkbox only when this ARRR
wallet has never received funds; that explicitly selects the current block.
Denial creates no native wallet. Existing local wallets are left in place.
The prompt uses the configured recovery birthday; an advanced custom birthday
can be selected through Core's authenticated API before initialization.

ARRR buy requests now retain their bridge callback for 30 minutes, covering the
separate preparation approval, proofs and confirmation scan. Recognized busy/sync
errors are retried only for quote/status reads within the bounded preparation
wait. The approved payment call is never automatically repeated. Account/node
changes invalidate the approval. Other trade coins retain their existing budgets.

Pair both updated binaries; an earlier Core lacks the initialization endpoint.
The pinned JNI 0.3.11 publication remains sufficient. The ordinary Qortal backup
format and deterministic ARRR address do not change. An existing native wallet
already created with an incorrectly late birthday needs a reviewed earlier rescan;
the first-use prompt does not rewrite its database or delete pending journals.

Validate denial, both first-use choices, concurrent wallet requests and account/node
changes using unfunded accounts. A separately authorized funded preparation should
remain attached past 30 seconds and reach the trade bot only after spend readiness.
Preserve current wallet/repository/journal data when returning to earlier binaries;
never restore old wallet data after broadcast.
