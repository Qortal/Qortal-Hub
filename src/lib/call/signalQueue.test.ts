import { describe, expect, it } from 'vitest';
import {
  enqueueBufferedCallSignal,
  takeDrainableBufferedCallSignals,
  type BufferedCallSignal,
} from './signalQueue';

describe('signalQueue', () => {
  it('appends buffered signals in arrival order', () => {
    const initial: BufferedCallSignal[] = [];
    const withOffer = enqueueBufferedCallSignal(initial, {
      callId: 'call-1',
      type: 'offer',
      data: 'offer-sdp',
    });
    const withIce = enqueueBufferedCallSignal(withOffer, {
      callId: 'call-1',
      type: 'ice',
      data: { candidate: 'ice-1' },
    });

    expect(withIce.map((signal) => signal.type)).toEqual(['offer', 'ice']);
  });

  it('holds ice until a remote description exists', () => {
    const queue: BufferedCallSignal[] = [
      { callId: 'call-1', type: 'ice', data: { candidate: 'ice-early' } },
      { callId: 'call-1', type: 'offer', data: 'offer-sdp' },
      { callId: 'call-1', type: 'ice', data: { candidate: 'ice-late' } },
    ];

    const firstPass = takeDrainableBufferedCallSignals(queue, false);
    expect(firstPass.ready.map((signal) => signal.type)).toEqual(['offer', 'ice']);
    expect(firstPass.remaining.map((signal) => signal.type)).toEqual(['ice']);

    const secondPass = takeDrainableBufferedCallSignals(firstPass.remaining, true);
    expect(secondPass.ready.map((signal) => signal.type)).toEqual(['ice']);
    expect(secondPass.remaining).toEqual([]);
  });

  it('drains answers immediately once a peer connection exists', () => {
    const queue: BufferedCallSignal[] = [
      { callId: 'call-1', type: 'answer', data: 'answer-sdp' },
    ];

    const result = takeDrainableBufferedCallSignals(queue, false);
    expect(result.ready.map((signal) => signal.type)).toEqual(['answer']);
    expect(result.remaining).toEqual([]);
  });
});
