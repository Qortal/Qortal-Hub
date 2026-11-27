import { describe, expect, it, vi } from 'vitest';
import { MAX_ACTIVE_NOTIFICATIONS } from './notification-registry';
import { QChatNotificationSink } from './qchat-notification-sink';

const VIEWING = { groupId: 716, channelId: 'general', visible: true };

function makeSink(options: { max?: number } = {}) {
  let clock = 1_000;
  const sink = new QChatNotificationSink({
    now: () => {
      clock += 1;
      return clock;
    },
    ...options,
  });
  return sink;
}

describe('QChatNotificationSink', () => {
  it('registers a notification that is not suppressed', async () => {
    const sink = makeSink();
    const result = await sink.submit({
      title: 'New message',
      body: 'hello',
      groupContext: { groupId: 716, channelId: 'random' },
      eventId: 'evt-1',
    });

    expect(result.success).toBe(true);
    if (result.success && 'notificationId' in result) {
      expect(typeof result.notificationId).toBe('string');
    }
    expect(sink.size).toBe(1);
    const snapshot = sink.snapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].groupContext).toEqual({
      groupId: 716,
      channelId: 'random',
    });
    expect(snapshot[0].eventId).toBe('evt-1');
  });

  it('suppresses a notification for the channel the reader is viewing', async () => {
    const sink = makeSink();
    sink.setViewContext(VIEWING);

    const result = await sink.submit({
      title: 'New message',
      body: 'hello',
      groupContext: { groupId: 716, channelId: 'general' },
      eventId: 'evt-2',
    });

    expect(result).toEqual({ success: true, suppressed: true });
    expect(sink.size).toBe(0);
    expect(sink.snapshot()).toHaveLength(0);
  });

  it('does not suppress a notification for a different channel of the same group', async () => {
    const sink = makeSink();
    sink.setViewContext(VIEWING);

    const result = await sink.submit({
      title: 'New message',
      body: 'hello',
      groupContext: { groupId: 716, channelId: 'random' },
    });

    expect(result.success).toBe(true);
    expect(sink.size).toBe(1);
  });

  it('does not suppress when the view context is not visible', async () => {
    const sink = makeSink();
    sink.setViewContext({ ...VIEWING, visible: false });

    const result = await sink.submit({
      title: 'New message',
      body: 'hello',
      groupContext: { groupId: 716, channelId: 'general' },
    });

    expect(result.success).toBe(true);
    expect(sink.size).toBe(1);
  });

  it('a suppressed notification does not consume a cap slot', async () => {
    const sink = makeSink({ max: 2 });
    sink.setViewContext({
      groupId: 999,
      channelId: 'elsewhere',
      visible: true,
    });

    await sink.submit({
      title: 'first',
      body: 'a',
      groupContext: { groupId: 1, channelId: 'a' },
    });
    await sink.submit({
      title: 'second',
      body: 'b',
      groupContext: { groupId: 2, channelId: 'b' },
    });
    expect(sink.size).toBe(2);

    // Now claim to be viewing group 3's channel and try to notify for it.
    sink.setViewContext({ groupId: 3, channelId: 'c', visible: true });
    const suppressed = await sink.submit({
      title: 'third',
      body: 'c',
      groupContext: { groupId: 3, channelId: 'c' },
    });

    expect(suppressed).toEqual({ success: true, suppressed: true });
    expect(sink.size).toBe(2);
    expect(sink.snapshot().map((entry) => entry.groupContext?.groupId)).toEqual(
      [1, 2]
    );
  });

  it('evicts the oldest entry at the cap', async () => {
    const sink = makeSink({ max: 2 });

    await sink.submit({
      title: 'first',
      body: 'a',
      groupContext: { groupId: 1, channelId: 'a' },
    });
    await sink.submit({
      title: 'second',
      body: 'b',
      groupContext: { groupId: 2, channelId: 'b' },
    });
    await sink.submit({
      title: 'third',
      body: 'c',
      groupContext: { groupId: 3, channelId: 'c' },
    });

    expect(sink.size).toBe(2);
    expect(sink.snapshot().map((entry) => entry.groupContext?.groupId)).toEqual(
      [2, 3]
    );
  });

  it('uses the registry cap by default', () => {
    const sink = makeSink();
    expect(sink.size).toBe(0);
    expect(MAX_ACTIVE_NOTIFICATIONS).toBe(50);
  });

  it('dedupes by notification id without evicting', async () => {
    const sink = makeSink({ max: 2 });

    await sink.submit({
      title: 'first',
      body: 'a',
      notificationId: 'same',
      groupContext: { groupId: 1, channelId: 'a' },
    });
    await sink.submit({
      title: 'second',
      body: 'b',
      groupContext: { groupId: 2, channelId: 'b' },
    });
    // Re-registering the first id must replace it, not evict group 2.
    await sink.submit({
      title: 'first again',
      body: 'a2',
      notificationId: 'same',
      groupContext: { groupId: 1, channelId: 'a' },
    });

    expect(sink.size).toBe(2);
    const ids = sink.snapshot().map((entry) => entry.notificationId);
    expect(ids).toEqual(['same', expect.any(String)]);
  });

  it('returns a snapshot that cannot mutate the registry', async () => {
    const sink = makeSink();
    await sink.submit({
      title: 'msg',
      body: 'x',
      groupContext: { groupId: 716, channelId: 'general' },
    });

    const snapshot = sink.snapshot();
    snapshot[0].groupContext!.channelId = 'tampered';
    snapshot.pop();

    expect(sink.size).toBe(1);
    expect(sink.snapshot()[0].groupContext?.channelId).toBe('general');
  });

  it('dismisses by context and by event id', async () => {
    const sink = makeSink();
    await sink.submit({
      title: 'a',
      body: 'a',
      groupContext: { groupId: 716, channelId: 'general' },
      eventId: 'evt-a',
    });
    await sink.submit({
      title: 'b',
      body: 'b',
      groupContext: { groupId: 716, channelId: 'random' },
      eventId: 'evt-b',
    });
    expect(sink.size).toBe(2);

    sink.dismissByContext(716, 'general');
    expect(sink.size).toBe(1);
    expect(sink.snapshot()[0].eventId).toBe('evt-b');

    sink.dismissByEventId('evt-b');
    expect(sink.size).toBe(0);
  });

  it('marks an OS-closed entry as retained rather than removed', async () => {
    const sink = makeSink();
    const result = await sink.submit({
      title: 'msg',
      body: 'x',
      groupContext: { groupId: 716, channelId: 'general' },
    });
    expect(result.success).toBe(true);
    const id = sink.snapshot()[0].notificationId;

    sink.markOsClosed(id);

    // Retained logically, flagged as closed by the desktop.
    expect(sink.size).toBe(1);
    expect(sink.snapshot()[0].osClosedBySystem).toBe(true);
  });

  it('passes the assigned id to the presenter and stores its handle', async () => {
    const sink = makeSink();
    const close = vi.fn();
    const handle = { close: vi.fn() };
    const presenter = vi.fn(async () => ({ notification: handle, close }));
    sink.setPresenter(presenter);

    const result = await sink.submit({
      title: 'msg',
      body: 'x',
      groupContext: { groupId: 716, channelId: 'general' },
    });

    expect(presenter).toHaveBeenCalledTimes(1);
    const [submission, id] = presenter.mock.calls[0];
    expect(submission.title).toBe('msg');
    expect(
      result.success && 'notificationId' in result && result.notificationId
    ).toBe(id);

    // An app-initiated dismissal must call the injected closer.
    sink.dismissByContext(716, 'general');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('registers even when no presenter is installed', async () => {
    const sink = makeSink();
    const result = await sink.submit({ title: 'msg', body: 'x' });
    expect(result.success).toBe(true);
    expect(sink.size).toBe(1);
  });

  it('reports a presenter failure as an unsuccessful submission', async () => {
    const sink = makeSink();
    sink.setPresenter(() => {
      throw new Error('no notification daemon');
    });

    const result = await sink.submit({ title: 'msg', body: 'x' });
    expect(result).toEqual({
      success: false,
      error: 'Error: no notification daemon',
    });
  });

  it('does not resurrect an entry dismissed while the presenter awaited', async () => {
    const sink = makeSink();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    sink.setPresenter(async (_submission, notificationId) => {
      await gate;
      return { notification: { close: vi.fn() } };
    });

    const pending = sink.submit({
      title: 'msg',
      body: 'x',
      groupContext: { groupId: 716, channelId: 'general' },
    });
    // Dismiss before the presenter resolves.
    sink.dismissByContext(716, 'general');
    release();
    await pending;

    expect(sink.size).toBe(0);
  });

  it('closes the late presentation when the entry was dismissed mid-await', async () => {
    const sink = makeSink();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const close = vi.fn();
    const handleClose = vi.fn();
    sink.setPresenter(async () => {
      await gate;
      return { notification: { close: handleClose }, close };
    });

    const pending = sink.submit({
      title: 'msg',
      body: 'x',
      groupContext: { groupId: 716, channelId: 'general' },
    });
    sink.dismissByContext(716, 'general');
    release();
    await pending;

    // The registry entry is correctly gone, but the OS notification it already
    // created must be closed too: nothing else holds a reference to it, so on
    // Linux it would otherwise sit in the tray until the user cleared it.
    expect(sink.size).toBe(0);
    expect(close).toHaveBeenCalledTimes(1);
    expect(handleClose).not.toHaveBeenCalled();
  });

  it('closes the late presentation when the entry was evicted mid-await', async () => {
    const sink = makeSink({ max: 1 });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const close = vi.fn();
    sink.setPresenter(async (submission) => {
      if (submission.title === 'slow') {
        await gate;
      }
      return { close: submission.title === 'slow' ? close : vi.fn() };
    });

    const pending = sink.submit({
      title: 'slow',
      body: 'x',
      notificationId: 'slow-id',
      groupContext: { groupId: 716, channelId: 'general' },
    });
    // A second submission at max 1 evicts the first while it is still awaiting.
    await sink.submit({
      title: 'fast',
      body: 'y',
      notificationId: 'fast-id',
      groupContext: { groupId: 716, channelId: 'random' },
    });
    release();
    await pending;

    expect(sink.snapshot().map((entry) => entry.notificationId)).toEqual([
      'fast-id',
    ]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does not hand the presentation to a replacement that reused the id', async () => {
    const sink = makeSink();
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    let call = 0;
    sink.setPresenter(async () => {
      call += 1;
      if (call === 1) {
        await firstGate;
        return { close: firstClose };
      }
      return { close: secondClose };
    });

    const first = sink.submit({
      title: 'first',
      body: 'x',
      notificationId: 'reused',
      groupContext: { groupId: 716, channelId: 'general' },
    });
    // A second submission with the same id replaces the entry outright.
    await sink.submit({
      title: 'second',
      body: 'y',
      notificationId: 'reused',
      groupContext: { groupId: 716, channelId: 'general' },
    });
    releaseFirst();
    await first;

    // The stale presentation belongs to the replaced entry, so it is closed
    // rather than attached to the live entry - otherwise dismissing the live
    // notification would close nothing and leave the stale one on screen.
    expect(firstClose).toHaveBeenCalledTimes(1);
    expect(secondClose).not.toHaveBeenCalled();

    sink.dismissByContext(716, 'general');
    expect(secondClose).toHaveBeenCalledTimes(1);
    expect(firstClose).toHaveBeenCalledTimes(1);
  });

  it('drops the placeholder when the presenter throws', async () => {
    const sink = makeSink();
    sink.setPresenter(() => {
      throw new Error('no notification daemon');
    });

    const result = await sink.submit({
      title: 'msg',
      body: 'x',
      notificationId: 'throwing',
      groupContext: { groupId: 716, channelId: 'general' },
    });

    expect(result.success).toBe(false);
    // Nothing was shown, so nothing may linger as an entry that can never be
    // closed through the app.
    expect(sink.size).toBe(0);
  });

  it('generates distinct ids when the clock does not advance', async () => {
    const sink = new QChatNotificationSink({ now: () => 1_000 });
    await sink.submit({ title: 'a', body: 'a' });
    await sink.submit({ title: 'b', body: 'b' });

    const ids = sink.snapshot().map((entry) => entry.notificationId);
    expect(new Set(ids).size).toBe(2);
  });
});
