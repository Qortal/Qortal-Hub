import { describe, expect, it, vi } from 'vitest';
import {
  createRefcountedFanout,
  type GcallFanoutWebContents,
} from './gcall-renderer-subscription-fanout';

function createMockWebContents(): GcallFanoutWebContents & {
  sent: { channel: string; payload: unknown }[];
  markDestroyed(): void;
} {
  const sent: { channel: string; payload: unknown }[] = [];
  let destroyed = false;
  return {
    sent,
    markDestroyed() {
      destroyed = true;
    },
    isDestroyed: () => destroyed,
    send(channel: string, payload: unknown) {
      sent.push({ channel, payload });
    },
  };
}

describe('createRefcountedFanout', () => {
  it('keeps the window in the fanout until refcount reaches zero (group + DM scenario)', () => {
    const fanout = createRefcountedFanout();
    const wc = createMockWebContents();

    fanout.addSubscriber(wc);
    fanout.addSubscriber(wc);
    expect(fanout.getRefCount(wc)).toBe(2);
    expect(fanout.isSubscribed(wc)).toBe(true);

    fanout.removeSubscriber(wc);
    expect(fanout.getRefCount(wc)).toBe(1);
    expect(fanout.isSubscribed(wc)).toBe(true);

    fanout.broadcast('gcall:key', { roomId: 'r1' });
    expect(wc.sent).toHaveLength(1);
    expect(wc.sent[0]).toEqual({ channel: 'gcall:key', payload: { roomId: 'r1' } });

    fanout.removeSubscriber(wc);
    expect(fanout.getRefCount(wc)).toBe(0);
    expect(fanout.isSubscribed(wc)).toBe(false);

    fanout.broadcast('gcall:audio', new Uint8Array([1]));
    expect(wc.sent).toHaveLength(1);
  });

  it('invokes onFirstSubscribe only on 0 → 1 (replay retained keys once per subscription cycle)', () => {
    const onFirstSubscribe = vi.fn();
    const fanout = createRefcountedFanout({ onFirstSubscribe });
    const wc = createMockWebContents();

    fanout.addSubscriber(wc);
    fanout.addSubscriber(wc);
    expect(onFirstSubscribe).toHaveBeenCalledTimes(1);
    expect(onFirstSubscribe).toHaveBeenCalledWith(wc);

    fanout.removeSubscriber(wc);
    expect(onFirstSubscribe).toHaveBeenCalledTimes(1);

    fanout.removeSubscriber(wc);
    fanout.addSubscriber(wc);
    expect(onFirstSubscribe).toHaveBeenCalledTimes(2);
    expect(onFirstSubscribe).toHaveBeenNthCalledWith(2, wc);
  });

  it('treats extra removeSubscriber as a no-op when refcount is already zero', () => {
    const fanout = createRefcountedFanout();
    const wc = createMockWebContents();

    fanout.addSubscriber(wc);
    fanout.removeSubscriber(wc);
    fanout.removeSubscriber(wc);
    fanout.removeSubscriber(wc);

    expect(fanout.getRefCount(wc)).toBe(0);
    fanout.broadcast('gcall:key', {});
    expect(wc.sent).toHaveLength(0);
  });

  it('drops destroyed WebContents on broadcast and clears refcount', () => {
    const fanout = createRefcountedFanout();
    const wc = createMockWebContents();

    fanout.addSubscriber(wc);
    wc.markDestroyed();

    fanout.broadcast('gcall:topology', { epoch: 1 });
    expect(wc.sent).toHaveLength(0);
    expect(fanout.getRefCount(wc)).toBe(0);
    expect(fanout.isSubscribed(wc)).toBe(false);

    const wc2 = createMockWebContents();
    fanout.addSubscriber(wc2);
    fanout.broadcast('gcall:topology', { epoch: 2 });
    expect(wc2.sent).toHaveLength(1);
    expect(wc2.sent[0]?.payload).toEqual({ epoch: 2 });
  });

  it('broadcasts to multiple independent WebContents', () => {
    const fanout = createRefcountedFanout();
    const a = createMockWebContents();
    const b = createMockWebContents();

    fanout.addSubscriber(a);
    fanout.addSubscriber(b);

    fanout.broadcast('gcall:session-updated', { id: 'x' });
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
    expect(a.sent[0]?.channel).toBe('gcall:session-updated');
    expect(b.sent[0]?.payload).toEqual({ id: 'x' });
  });

  it('models activity channel fanout independently from main gcall stream', () => {
    const mainFanout = createRefcountedFanout();
    const activityFanout = createRefcountedFanout();
    const wc = createMockWebContents();

    mainFanout.addSubscriber(wc);
    activityFanout.addSubscriber(wc);

    mainFanout.removeSubscriber(wc);
    activityFanout.broadcast('gcall:qortal-group-call-activity', {
      activeByGroupId: { 1: true },
    });

    expect(wc.sent).toHaveLength(1);
    expect(wc.sent[0]?.channel).toBe('gcall:qortal-group-call-activity');

    activityFanout.removeSubscriber(wc);
    activityFanout.broadcast('gcall:qortal-group-call-activity', {});
    expect(wc.sent).toHaveLength(1);
  });
});
