#!/usr/bin/env python3
"""
Long-lived Linux desktop-notification helper for Qortal Hub.

Why this exists
---------------
Cinnamon's notification daemon destroys an app's notifications when that app
gains focus (`_onFocusAppChanged` -> `destroyNonResidentNotifications`). The
daemon attributes a notification to an app by resolving the *PID of the D-Bus
sender* through `WindowTracker.get_app_from_pid()`. Electron sends `Notify`
from its main process, which owns the Hub window, so the daemon matches it and
withdraws the notification on focus.

This helper is a process with no window. `get_app_from_pid()` returns null for
it, so `Source.app` stays null, the focus loop matches nothing and the
notification survives. Verified on Cinnamon 6.x: a notification sent this way
remains in the tray after the Hub window is focused.

Protocol (newline-delimited JSON, stdin commands / stdout events)
----------------------------------------------------------------
stdin:
  {"cmd":"notify","id":"<renderer id>","summary":"...","body":"...",
   "icon":"<path or icon name>","timeoutMs":0}
  {"cmd":"close","dbusId":<int>}
  {"cmd":"quit"}

stdout:
  {"event":"ready"}
  {"event":"notified","id":"<renderer id>","dbusId":<int>}
  {"event":"closed","dbusId":<int>,"reason":<int>,"unknown":<bool>}
  {"event":"action","dbusId":<int>,"action":"default"}
  {"event":"error","id":"<renderer id or null>","message":"..."}

`unknown` on a closed event is true when the daemon reported a close for an id
this helper no longer tracks (e.g. our own close already removed it).

NotificationClosed reasons (from Cinnamon's notificationDaemon.js):
  1 EXPIRED, 2 DISMISSED, 3 APP_CLOSED, 4 UNDEFINED
"""

import base64
import json
import os
import sys
import tempfile

EXIT_NO_GI = 3


def _fail_no_gi():
    sys.stdout.write(
        json.dumps(
            {
                'event': 'error',
                'id': None,
                'message': 'python3 gi (PyGObject) is not available',
            }
        )
        + '\n'
    )
    sys.stdout.flush()
    sys.exit(EXIT_NO_GI)


try:
    import gi

    gi.require_version('Gio', '2.0')
    gi.require_version('GLib', '2.0')
    from gi.repository import Gio, GLib
except Exception:  # noqa: BLE001 - any import/version failure is fatal here
    _fail_no_gi()


APP_NAME = 'Qortal Hub'

# Renderer id -> D-Bus id, and the reverse, so close and click events can be
# mapped back onto the main-process registry.
_renderer_to_dbus = {}
_dbus_to_renderer = {}

# Notification ids that we asked the daemon to close ourselves. When the
# matching NotificationClosed arrives it is an echo, not a DE-initiated close.
_self_closed = set()

_temp_icon_paths = []

_bus = None
_loop = None


def _emit(payload):
    sys.stdout.write(json.dumps(payload) + '\n')
    sys.stdout.flush()


def _icon_path(icon):
    """Resolve a renderer icon value to something libnotify accepts.

    Accepts an absolute path, a file:// URL, a data: URL (written to a temp
    file) or a plain icon name. Remote http(s) URLs are skipped: the daemon
    cannot fetch them and blocking on a download here would stall the queue.
    """
    if not icon or not isinstance(icon, str):
        return ''
    if icon.startswith('data:'):
        try:
            header, _, data = icon.partition(',')
            if ';base64' not in header:
                return ''
            raw = base64.b64decode(data)
            fd, path = tempfile.mkstemp(prefix='qortal-notif-', suffix='.png')
            with os.fdopen(fd, 'wb') as handle:
                handle.write(raw)
            _temp_icon_paths.append(path)
            return path
        except Exception:  # noqa: BLE001 - icon is best-effort
            return ''
    if icon.startswith('file://'):
        return icon[7:]
    if icon.startswith('/'):
        return icon
    if icon.startswith('http://') or icon.startswith('https://'):
        return ''
    return icon


def _cleanup_temp_icons():
    for path in _temp_icon_paths:
        try:
            os.unlink(path)
        except OSError:
            pass
    del _temp_icon_paths[:]


def _notify(request):
    renderer_id = str(request.get('id') or '')
    summary = str(request.get('summary') or '')
    body = str(request.get('body') or '')
    timeout_ms = int(request.get('timeoutMs') or 0)
    icon = _icon_path(request.get('icon'))

    # timeoutMs 0 means "never expire" in the freedesktop spec, so the entry
    # stays in the tray. The popup still auto-hides after the shell's own
    # notification-duration, which is the preview-then-persist behaviour we
    # want. `default` action is what makes the body click emit ActionInvoked.
    variant = GLib.Variant(
        '(susssasa{sv}i)',
        (
            APP_NAME,
            0,
            icon,
            summary,
            body,
            ['default', 'Open'],
            {},
            timeout_ms,
        ),
    )
    reply = _bus.call_sync(
        'org.freedesktop.Notifications',
        '/org/freedesktop/Notifications',
        'org.freedesktop.Notifications',
        'Notify',
        variant,
        None,
        Gio.DBusCallFlags.NONE,
        -1,
        None,
    )
    dbus_id = int(reply.unpack()[0])

    if renderer_id:
        _renderer_to_dbus[renderer_id] = dbus_id
        _dbus_to_renderer[dbus_id] = renderer_id
    _emit({'event': 'notified', 'id': renderer_id, 'dbusId': dbus_id})
    return dbus_id


def _close(request):
    dbus_id = int(request.get('dbusId') or 0)
    if dbus_id <= 0:
        return
    _self_closed.add(dbus_id)
    try:
        _bus.call_sync(
            'org.freedesktop.Notifications',
            '/org/freedesktop/Notifications',
            'org.freedesktop.Notifications',
            'CloseNotification',
            GLib.Variant('(u)', (dbus_id,)),
            None,
            Gio.DBusCallFlags.NONE,
            -1,
            None,
        )
    except Exception as error:  # noqa: BLE001 - close is best-effort
        _emit({'event': 'error', 'id': None, 'message': str(error)})


def _on_signal(_conn, _sender, _path, _iface, signal, params):
    if signal == 'NotificationClosed':
        dbus_id, reason = params.unpack()
    elif signal == 'ActionInvoked':
        dbus_id, action = params.unpack()
        renderer_id = _dbus_to_renderer.get(int(dbus_id))
        if renderer_id is not None:
            _emit(
                {
                    'event': 'action',
                    'id': renderer_id,
                    'dbusId': int(dbus_id),
                    'action': str(action),
                }
            )
        return
    else:
        return

    dbus_id = int(dbus_id)
    renderer_id = _dbus_to_renderer.pop(dbus_id, None)
    if renderer_id is not None:
        _renderer_to_dbus.pop(renderer_id, None)
    self_closed = dbus_id in _self_closed
    _self_closed.discard(dbus_id)
    known = renderer_id is not None or self_closed
    _emit(
        {
            'event': 'closed',
            'id': renderer_id,
            'dbusId': dbus_id,
            'reason': int(reason),
            'unknown': not known,
            'selfClosed': self_closed,
        }
    )


def _handle_line(line):
    line = line.strip()
    if not line:
        return
    try:
        request = json.loads(line)
    except ValueError as error:
        _emit({'event': 'error', 'id': None, 'message': f'bad json: {error}'})
        return

    command = request.get('cmd')
    if command == 'notify':
        try:
            _notify(request)
        except Exception as error:  # noqa: BLE001 - never die on one failure
            _emit(
                {
                    'event': 'error',
                    'id': request.get('id'),
                    'message': str(error),
                }
            )
    elif command == 'close':
        try:
            _close(request)
        except Exception as error:  # noqa: BLE001
            _emit({'event': 'error', 'id': None, 'message': str(error)})
    elif command == 'quit':
        _loop.quit()
    else:
        _emit(
            {
                'event': 'error',
                'id': request.get('id'),
                'message': f'unknown cmd: {command}',
            }
        )


def main():
    global _bus, _loop

    _bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    _bus.signal_subscribe(
        'org.freedesktop.Notifications',
        'org.freedesktop.Notifications',
        'NotificationClosed',
        '/org/freedesktop/Notifications',
        None,
        Gio.DBusSignalFlags.NONE,
        _on_signal,
    )
    _bus.signal_subscribe(
        'org.freedesktop.Notifications',
        'org.freedesktop.Notifications',
        'ActionInvoked',
        '/org/freedesktop/Notifications',
        None,
        Gio.DBusSignalFlags.NONE,
        _on_signal,
    )

    _loop = GLib.MainLoop()

    # stdin is read on the GLib main loop so notifications are handed to D-Bus
    # on the same thread as the signal callbacks, which keeps the two id maps
    # consistent. PyGObject does not expose GLib.IOChannelFlags, so this uses a
    # plain fd watch plus a buffered reader rather than an IOChannel.
    stdin_fd = sys.stdin.fileno()
    os.set_blocking(stdin_fd, False)
    reader = sys.stdin
    pending = ''

    def on_readable(_fd, _condition):
        nonlocal pending
        try:
            chunk = reader.read()
        except (BlockingIOError, InterruptedError):
            return True
        except Exception:  # noqa: BLE001
            _loop.quit()
            return False

        if chunk:
            pending += chunk
            while '\n' in pending:
                line, _, pending = pending.partition('\n')
                _handle_line(line)
            return True

        # read() returns '' at EOF: the parent went away, so stop.
        _loop.quit()
        return False

    GLib.io_add_watch(
        stdin_fd,
        GLib.PRIORITY_DEFAULT,
        GLib.IO_IN | GLib.IO_HUP,
        on_readable,
    )

    _emit({'event': 'ready'})
    try:
        _loop.run()
    finally:
        _cleanup_temp_icons()


if __name__ == '__main__':
    main()
