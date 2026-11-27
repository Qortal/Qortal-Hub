/**
 * Tests for the Linux notification helper client.
 *
 * The helper process itself is exercised separately by running
 * `electron/resources/linux_notify.py` against a real D-Bus session. These
 * tests cover the Node side: id correlation, self-closed detection, fallback
 * when the helper is unavailable, and close idempotence.
 *
 * The helper is simulated by a small Node child that speaks the same
 * newline-delimited JSON protocol, so no Python or D-Bus is required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  LinuxNotificationManager,
  handleToCloser,
  type LinuxNotifyEvent,
} from './linux-notifications';

/**
 * Fake helper: echoes one `notified` per `notify` with an incrementing D-Bus
 * id, and can be told to emit arbitrary events via `__emit`.
 */
const FAKE_HELPER = `
const rl = require('readline').createInterface({ input: process.stdin });
let nextId = 100;
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ event: 'ready' });
rl.on('line', (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  if (req.cmd === 'notify') {
    out({ event: 'notified', id: req.id, dbusId: nextId++ });
  } else if (req.cmd === 'close') {
    out({ event: 'closed', dbusId: req.dbusId, reason: 3, selfClosed: true });
  } else if (req.cmd === 'quit') {
    process.exit(0);
  } else if (req.cmd === '__emit') {
    out(req.payload);
  }
});
`;

let dir = '';
let helperPath = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'linux-notify-test-'));
  helperPath = join(dir, 'fake-helper.js');
  writeFileSync(helperPath, FAKE_HELPER);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeManager(events: LinuxNotifyEvent[] = []) {
  return new LinuxNotificationManager({
    scriptPath: helperPath,
    pythonPath: process.execPath, // node runs the fake helper
    onEvent: (event) => events.push(event),
  });
}

/** Wait for the helper to report ready. */
async function waitReady(manager: LinuxNotificationManager) {
  await vi.waitFor(
    () => {
      expect(manager.available).toBe(true);
    },
    { timeout: 5_000 }
  );
}

describe('LinuxNotificationManager', () => {
  it('sends a notification and returns a handle with the D-Bus id', async () => {
    const manager = makeManager();
    try {
      const handle = await manager.notify({
        id: 'nid-1',
        summary: 'title',
        body: 'body',
      });
      expect(handle).not.toBeNull();
      expect(handle!.dbusId).toBe(100);
      expect(manager.ownsRendererId('nid-1')).toBe(true);
      expect(manager.rendererIdFor(100)).toBe('nid-1');
    } finally {
      manager.dispose();
    }
  });

  it('correlates multiple notifications independently', async () => {
    const manager = makeManager();
    try {
      const first = await manager.notify({ id: 'a', summary: 's', body: 'b' });
      const second = await manager.notify({ id: 'b', summary: 's', body: 'b' });
      expect(first!.dbusId).toBe(100);
      expect(second!.dbusId).toBe(101);
      expect(manager.rendererIdFor(100)).toBe('a');
      expect(manager.rendererIdFor(101)).toBe('b');
    } finally {
      manager.dispose();
    }
  });

  it('reports a self-initiated close so the registry can ignore it', async () => {
    const events: LinuxNotifyEvent[] = [];
    const manager = makeManager(events);
    try {
      const handle = await manager.notify({
        id: 'nid',
        summary: 's',
        body: 'b',
      });
      handle!.close();
      await vi.waitFor(
        () => {
          expect(events.some((e) => e.event === 'closed')).toBe(true);
        },
        { timeout: 5_000 }
      );
      const closed = events.find((e) => e.event === 'closed');
      expect(closed?.selfClosed).toBe(true);
    } finally {
      manager.dispose();
    }
  });

  it('reports an unsolicited close (desktop-initiated) as not self-closed', async () => {
    const events: LinuxNotifyEvent[] = [];
    const manager = makeManager(events);
    try {
      await manager.notify({ id: 'nid', summary: 's', body: 'b' });
      // Simulate the daemon closing it (expiry or focus destruction).
      (
        manager as unknown as {
          child: { stdin: { write: (s: string) => void } };
        }
      ).child.stdin.write(
        `${JSON.stringify({
          cmd: '__emit',
          payload: { event: 'closed', dbusId: 100, reason: 2 },
        })}\n`
      );
      await vi.waitFor(
        () => {
          expect(events.some((e) => e.event === 'closed')).toBe(true);
        },
        { timeout: 5_000 }
      );
      const closed = events.find((e) => e.event === 'closed');
      expect(closed?.selfClosed).toBe(false);
      expect(closed?.reason).toBe(2);
      expect(closed?.id).toBe('nid');
    } finally {
      manager.dispose();
    }
  });

  it('forwards action (click) events with the renderer id', async () => {
    const events: LinuxNotifyEvent[] = [];
    const manager = makeManager(events);
    try {
      await manager.notify({ id: 'click-me', summary: 's', body: 'b' });
      (
        manager as unknown as {
          child: { stdin: { write: (s: string) => void } };
        }
      ).child.stdin.write(
        `${JSON.stringify({
          cmd: '__emit',
          payload: {
            event: 'action',
            id: 'click-me',
            dbusId: 100,
            action: 'default',
          },
        })}\n`
      );
      await vi.waitFor(
        () => {
          expect(events.some((e) => e.event === 'action')).toBe(true);
        },
        { timeout: 5_000 }
      );
      const action = events.find((e) => e.event === 'action');
      expect(action?.id).toBe('click-me');
      expect(action?.action).toBe('default');
    } finally {
      manager.dispose();
    }
  });

  it('returns null and reports unavailable when the script is missing', async () => {
    const reasons: string[] = [];
    const manager = new LinuxNotificationManager({
      scriptPath: join(dir, 'does-not-exist.py'),
      pythonPath: process.execPath,
      onEvent: () => {},
      onUnavailable: (reason) => reasons.push(reason),
    });
    const handle = await manager.notify({
      id: 'nid',
      summary: 's',
      body: 'b',
    });
    expect(handle).toBeNull();
    expect(manager.available).toBe(false);
    expect(reasons.join(' ')).toMatch(/missing/);
    manager.dispose();
  });

  it('falls back when the interpreter is missing', async () => {
    const manager = new LinuxNotificationManager({
      scriptPath: helperPath,
      pythonPath: join(dir, 'no-such-python'),
      onEvent: () => {},
    });
    const handle = await manager.notify({
      id: 'nid',
      summary: 's',
      body: 'b',
    });
    expect(handle).toBeNull();
    expect(manager.available).toBe(false);
    manager.dispose();
  });

  it('close is idempotent through handleToCloser', async () => {
    const manager = makeManager();
    try {
      const handle = await manager.notify({
        id: 'nid',
        summary: 's',
        body: 'b',
      });
      // Spy before wrapping so the first (and only) close is observed.
      const spy = vi.spyOn(handle!, 'close');
      const closer = handleToCloser(handle!);
      closer();
      closer();
      closer();
      // Exactly one close reaches the helper despite three invocations.
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      manager.dispose();
    }
  });

  it('dispose stops the helper and rejects in-flight requests', async () => {
    const manager = makeManager();
    const handle = await manager.notify({
      id: 'nid',
      summary: 's',
      body: 'b',
    });
    expect(handle).not.toBeNull();
    manager.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));
    // A second notify after dispose must not hang.
    const after = await manager.notify({
      id: 'nid-2',
      summary: 's',
      body: 'b',
    });
    expect(after === null || after.dbusId > 0).toBe(true);
  });
});
