# Linux desktop notifications

How Q-Chat OS notifications reach the Linux desktop, why they are not sent by
`new Notification()` there, and how to test the mechanism.

## The problem

On Cinnamon (and other Mutter-derived shells) a notification from an application
is destroyed the moment that application gains focus. From
`/usr/share/cinnamon/js/ui/notificationDaemon.js`:

```js
_onFocusAppChanged: function() {
    let tracker = Cinnamon.WindowTracker.get_default();
    if (!tracker.focus_app) return;
    for (let i = 0; i < this._sources.length; i++) {
        let source = this._sources[i];
        if (source.app == tracker.focus_app) {
            source.destroyNonResidentNotifications();
            return;
        }
    }
}
```

`destroyNonResidentNotifications` removes every notification whose `resident`
flag is false.

`source.app` is resolved in `Source._getApp()` from the **PID of the D-Bus
sender**:

```js
app = Cinnamon.WindowTracker.get_default().get_app_from_pid(this.pid);
```

Electron sends `Notify` from the process that owns the Hub window, so
`get_app_from_pid()` returns Hub, the focus loop matches, and the notification
is withdrawn the instant the window is focused. Measured on a real Cinnamon 6
session the close arrived **3 ms** after the focus event, with the registry
entry still present — nothing in Hub closed it.

There are three distinct ways a Q-Chat notification can disappear, which is why
this looked like one bug for a long time:

| Symptom                         | Cause                                                              |
| ------------------------------- | ------------------------------------------------------------------ |
| Gone ~5 s after appearing       | The renderer's ephemeral path (`NOTIFICATION_DISPLAY_DURATION_MS`) |
| Gone ~19–30 min after appearing | The daemon's `expire_timeout` for `urgency: normal`                |
| Gone when Hub is focused        | `_onFocusAppChanged` — this document                               |

## Why an Electron option cannot fix it

The `resident` D-Bus hint is the exemption the daemon honours:

```js
notification.setResident(hints.maybeGet('resident') == true);
```

Electron's `NotificationConstructorOptions` has no field for it — verified by
searching `electron.d.ts` for both Electron 32.3.1 and 44.1.1.

`timeoutType: 'never'` is a near-miss and does **not** help. It maps to
`expire_timeout`, which only feeds the `expires` calculation. It has no effect
on `destroyNonResidentNotifications`, which iterates on `resident` alone. It
would fix the 19-minute expiry and leave focus destruction untouched.

## The fix: an untracked sender

The remaining lever is process identity. A sender with no window is not
resolvable to an app, so `source.app` stays `null`, the focus loop matches
nothing, and the notification survives. All three `_getApp()` resolution steps
fail for such a process:

1. `get_app_from_pid(helperPid)` → `null`, because there is no window.
2. the `desktop-entry` hint → only consulted for flatpak apps.
3. `_findUniqueAppByName(initialTitle)` → needs exactly one running app with
   that name.

`electron/resources/linux_notify.py` is that sender. It is started by
[`electron/src/linux-notifications.ts`](../electron/src/linux-notifications.ts)
and owned by [`setup.ts`](../electron/src/setup.ts).

### Why the helper is long-lived

A short-lived sender is safe — `_onNameVanished` explicitly refuses to destroy a
source whose `this.app` is unset, which is the same protection `notify-send`
relies on. But a short-lived sender exits before `ActionInvoked` and
`NotificationClosed` arrive, and Hub needs both: the first for clicks, the
second to know the desktop closed something. So one process is kept for the
lifetime of the app and spoken to over newline-delimited JSON on stdin/stdout.

### Behaviour

- `timeoutMs: 0` means "never expire", so the entry stays in the tray. The
  _popup_ still auto-hides after the shell's own `notification-duration`
  (4 s by default), which is the "preview ends, tray entry remains" behaviour
  the product wants.
- `actions: ['default', 'Open']` is sent so a body click emits `ActionInvoked`,
  which maps to the same `reticulumChat:notificationClicked` IPC the Electron
  path uses.
- A close the helper requested is reported with `selfClosed: true` and ignored
  by the registry, so an app-initiated dismiss does not look like a
  desktop-initiated one.

## Fallback

If the helper cannot start — no `python3`, no PyGObject, missing script — the
manager reports itself unavailable and [`setup.ts`](../electron/src/setup.ts)
falls back to `new Notification()` unchanged. Linux notification support is
never worse than before. The reason is logged as
`[linux-notify] falling back to Electron notifications:`.

Windows and macOS always use the Electron path; the helper is Linux-only.

## Testing the mechanism

The quickest check does not involve Hub at all. With Hub unfocused:

```bash
python3 - <<'PY'
import gi
gi.require_version('Gio', '2.0'); gi.require_version('GLib', '2.0')
from gi.repository import Gio, GLib

bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
bus.call_sync(
    'org.freedesktop.Notifications', '/org/freedesktop/Notifications',
    'org.freedesktop.Notifications', 'Notify',
    GLib.Variant('(susssasa{sv}i)',
                 ('probe', 0, '', 'helper probe', 'focus Hub now', [], {}, 0)),
    None, Gio.DBusCallFlags.NONE, -1, None)
PY
```

Then focus Hub. The probe notification stays in the tray; a Hub-sent one does
not. `dbus-monitor "interface='org.freedesktop.Notifications'"` shows the
difference directly: a Hub notification is followed by `NotificationClosed`
with no `CloseNotification` from Hub, whereas the probe gets neither.

Two traps when reproducing:

- `dbus-send` cannot do this. It has no syntax for an empty `a{sv}` hint dict;
  `dict:string:variant:` fails with `Unknown type "variant"`. Use the Python.
- Focus the _Hub window_, not a terminal. `_onFocusAppChanged` fires on
  `tracker.focus_app`; focusing a terminal changes focus to the terminal and
  destroys nothing, so the test proves nothing.

## Packaging

`linux_notify.py` must stay listed in `extraResources` in
[`electron/electron-builder.config.json`](../electron/electron-builder.config.json),
mapped to `linux_notify.py` at the resources root. `setup.ts` resolves it from
`process.resourcesPath` when packaged, and from `electron/resources` in
development. If the entry is removed, packaged builds silently fall back to the
Electron path and the focus bug returns for end users while development still
appears fixed.

## Related

- [`notification-registry.ts`](../electron/src/notification-registry.ts) — the
  logical registry. Entries close through a `close()` callback so both the
  Electron handle and a D-Bus id can serve as the transport.
- [`fix-qchat-notification-auto-dismiss-linux`](../openspec/changes/fix-qchat-notification-auto-dismiss-linux/design.md)
  — the earlier investigation into the ~30-minute expiry. That document reasons
  about GNOME and `expire_timeout`; it does not cover `resident` or focus
  destruction, which are the dominant mechanisms on Cinnamon.
