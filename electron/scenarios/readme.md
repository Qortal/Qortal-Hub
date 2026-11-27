# Q-Chat scenarios

A scenario is a Node script that runs real Q-Chat code against the real SQLite
schema with two or more synthetic identities, and exits non-zero when an
assertion fails. It replaces a "walk through this by hand with a second account"
checklist item.

No Electron, no display server, no wallet, no Qortal Core, no Reticulum daemon.

```bash
node electron/scenarios/runner.mjs --list
node electron/scenarios/runner.mjs group-message-roundtrip
```

The runner exits `0` when every assertion passes, `1` on assertion failure, and
`2` if the runner itself broke. `npm test` does not run these — they need
`electron/build/` to be compiled first:

```bash
cd electron && npm run build
```

## Shape

`scenarios/<name>.mjs` default-exports:

```js
export default {
  name: 'group-message-roundtrip',
  delivery: 'resource', // or 'direct' where transport is intentionally skipped
  timeoutMs: 30_000, // optional, default 30s
  async run(ctx) {
    await ctx.check('does the thing', () => {
      if (!something) throw new Error('what was observed instead');
    });
  },
};
```

`ctx.check` awaits its callback, so an async assertion that rejects is a
failure rather than a truthy Promise. Each call prints one line.

`delivery` is required in spirit:

- `'direct'` — the event is handed to the reader's accept path, skipping the
  transport (`ctx.deliverEventDirect`). Correct for anything asserting on what
  the reader does with an already-received event: notification precedence, read
  state, dismissal.
- `'resource'` — the event travels through the fake bridge. Use only once the
  resource-transfer fake exists; see design D7.

A scenario claiming delivery coverage must not use `'direct'`.

## Context

| Member                                                 | Purpose                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `ctx.makeIdentity({label})`                            | Ed25519 keypair + derived Qortal address + hex presence hash + `signLocalFields` |
| `ctx.signEvent(identity, ctx.chat, overrides)`         | A correctly signed, hash-consistent `ReticulumChatEvent`                         |
| `ctx.createRouter()`                                   | In-process bridge router: `register`, `bridgeFor`, `deliverTo`, `resources`      |
| `ctx.checkBridgeContract(bridge)`                      | Fails if the fake lacks a method the manager calls                               |
| `ctx.makeManager({identity, bridge, dbPath, canSign})` | A real `ReticulumChatManager`                                                    |
| `ctx.joinGroup(manager, groupId)`                      | Membership + subscribe                                                           |
| `ctx.exchangeSubscriptions(a, b)`                      | Teach two managers about each other's subscriptions                              |
| `ctx.waitForEvent(manager, predicate, ms)`             | Resolve on the next matching `event`, or `null`                                  |
| `ctx.historyIds(manager, groupId, channel?)`           | Event ids in local history                                                       |
| `ctx.deliverEventDirect(manager, event, sender)`       | Accept + emit, skipping transport                                                |
| `ctx.settle(ms)`                                       | Let queued work land                                                             |
| `ctx.workDir`                                          | Temp directory, removed at teardown                                              |
| `ctx.onCleanup(fn)`                                    | Teardown, run in reverse order even on failure                                   |

`ctx.chat` is the compiled `reticulum-chat` module, for helpers like
`hashReticulumChatPayload` and `buildReticulumChatSignedFields`.

## Things the first spike proved, so you do not rediscover them

- **`signLocalFields` must return `authorAddress` and `authorPublicKey`.** The
  short shape (`publicKey` + `signature`) makes `isValidatedGroupMember` throw on
  `undefined.trim()` in the metadata-snapshot request path, which crashes the
  process instead of logging a rejection.
- **Presence hashes must be hex, 16–64 chars.** `localPeerHash()` returns
  `undefined` otherwise, every route lookup finds no next hop, and the failure is
  silent. Use `hexPresence()`.
- **`payloadHash` must be `hashReticulumChatPayload(encryptedPayload)`.** A
  placeholder is rejected as `Invalid event`.
- **`eventId` must be at least 8 characters.**
- **Subscriptions must be exchanged** before a publish can route. Without
  `exchangeSubscriptions`, `publishEvent` reports `ok: true` and delivers nothing.
- **Publishing sends only a notice.** The event body is a separate resource
  transfer. That is why `delivery` exists and why `deliverEventDirect` accepts the
  event directly instead of faking a wire.

## Notes for scenario authors

- Prefer one scenario per manual checklist item, and name it after the item, so a
  reviewer can diff the old checkbox against the new file.
- Assert the negative too. "Exactly one notification" catches duplication;
  "at least one" does not.
- Do not add `setTimeout`-based sleeps beyond `ctx.settle`; if a scenario needs a
  longer wait, the thing being waited for should emit an event.
- The fake bridge is not the real bridge. When the manager grows a call the fake
  lacks, `checkBridgeContract` fails — update `router.mjs`, do not delete the
  check.
