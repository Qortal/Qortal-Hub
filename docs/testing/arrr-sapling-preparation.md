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
