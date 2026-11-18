# XMR account testing in the Linux desktop app

Use the Linux AppImage built from `xmr-support`. `npm run dev` starts only the
browser renderer: it cannot start Reticulum, and this branch's Q-App viewer
requires Electron's isolated guest API. A failed developer app in that browser
does not establish a failure of the Python HTTP server or XMR account code.

## Source included

The account implementation at `cd894052` already descends from current upstream
`Qortal/Qortal-Hub` `master` at `f3b75daa717928c8a35491fd528a14dc3d4ee14d`.
It also retains the owner's desktop changes and the BTC/LTC/DOGE/DGB/RVN local
signer (`d26a2de6a`), signing approval hardening (`28c70cc06`), and XMR account
and ordinary Qortal backup recovery (`a3731b9c4`). The owner's `origin/master`
is an older ancestor, not a newer desktop source. Preserve the existing
`xmr-support` history; no reset, rebase or duplicate merge is needed.

Recheck the source before a later build:

```sh
git fetch upstream master
git merge-base --is-ancestor upstream/master xmr-support
git merge-base --is-ancestor d26a2de6a xmr-support
git merge-base --is-ancestor a3731b9c4 xmr-support
```

## Build and launch

Build a clean, committed checkout with the required Docker pipeline:

```sh
./build-appimage.sh
```

The pipeline builds the standard renderer, syncs Capacitor, compiles Electron
and the Go transport, freezes Reticulum and its presence bridge, and packages
the AppImage. Require `electron/dist/desktop-build.json` with the exact source
commit, `dirty: false`, Reticulum provenance and a matching AppImage checksum.
An old AppImage or a partial directory without this receipt is insufficient.
Retain previous artifacts before building or copying the new test package.

Close the previous Hub before opening the test AppImage. Keep the ordinary
Qortal backup and the previous AppImage for recovery. Make the new AppImage
executable and launch it normally. The package needs no separate Vite server,
system Python installation or manually started Reticulum daemon. If FUSE is
unavailable, use the AppImage's `--appimage-extract-and-run` option.

For isolation, use a fresh test account/profile. Never copy private keys into
developer tools or the test Q-App. Reverting the app consists of closing the
test app and opening the retained previous AppImage; preserve backup files and
the XMR derivation specification.

## Public account and backup acceptance

Use the combined ARRR/XMR Core JAR and select that **local Core** in the desktop
Hub. The JAR does not update Hub itself. Create a new unfunded Qortal account,
or log out and unlock again to reconstruct the XMR record in an older session.

The Core source checkout contains the public-only test Q-App. Start it in a
second terminal and leave the process running:

```sh
cd /home/crowetic/git-repos/crowetic/qortal
python3 -m http.server 8173 --bind 127.0.0.1 --directory tools/xmr-account-test
```

First open `http://127.0.0.1:8173/` in a browser to check the server responds.
The request button will report that the Hub bridge is unavailable there; that
is expected. Then, **inside the AppImage**, open Apps → Development Mode,
choose the developer-server option, and enter domain `127.0.0.1` and port
`8173` separately. Do not include `http://` in the domain field. Core and the
HTTP server must run on the same machine for this loopback address to work.
Core's development proxy injects the Q-App request bridge.

1. Click **Request public XMR account** and approve Hub's wallet permission.
   Expect exactly address, network, derivationVersion, publicSpendKey and
   publicViewKey. No private key, seed or mnemonic is returned.
2. Record the public XMR and Qortal addresses. Export the ordinary Qortal
   backup, restore only that backup in a fresh profile, select the same
   Core/network and request again. The helper's comparison must report a match.
3. A normal Core (`isTestNet: false`) selects mainnet. A separately configured
   testnet Core (`isTestNet: true`) selects stagenet. Those addresses differ,
   but each remains stable after backup recovery on the same network.
4. A different Qortal account must yield a different XMR address. Denying the
   wallet permission must yield no wallet result.

If developer loading fails in the AppImage, check the HTTP server terminal
first, then Core's response to `/developer/proxy/start` and the URL/port it
returns. A stopped server, wrong path/port, a remote Core or an unsuccessful
proxy response is a separate failure from wallet permission. Keep the actual
error and desktop logs for diagnosis. Stop the test server with Ctrl-C when
finished.

The earlier account-only AppImage did not implement scanning, balance/history or payments. Use the matching later [native stagenet wallet build and Q-Wallets-TESTING](monero-stagenet-wallet.md) for those operations; trades remain unimplemented.
Keep account acceptance unfunded. See [the permanent recovery contract and
automated checks](monero-accounts.md).

## Reticulum and local signing acceptance

Reticulum must be tested in the AppImage. Check its connection/status controls,
then test chat/reconnect with an existing peer. Frozen daemon/bridge and guest
IPC smoke tests establish package readiness; they do not prove an external
peer, firewall, audio device or bootstrap hub is reachable from the tester's
machine. Do not start a second manual daemon as a workaround.

The [local signing guide](local-wallet-signing.md) describes supported coins
and approval behavior. This build retains that signer; XMR spend support is a
separate unfinished feature. No funded payment is required to verify the
packaged signer and its offline regression tests.
