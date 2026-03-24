export type BufferedCallSignalType = 'offer' | 'answer' | 'ice';

export interface BufferedCallSignal {
  callId: string;
  type: BufferedCallSignalType;
  data: unknown;
}

export function enqueueBufferedCallSignal(
  queue: BufferedCallSignal[],
  signal: BufferedCallSignal
): BufferedCallSignal[] {
  return [...queue, signal];
}

export function takeDrainableBufferedCallSignals(
  queue: BufferedCallSignal[],
  hasRemoteDescription: boolean
): {
  ready: BufferedCallSignal[];
  remaining: BufferedCallSignal[];
} {
  const ready: BufferedCallSignal[] = [];
  const remaining: BufferedCallSignal[] = [];
  let remoteDescriptionReady = hasRemoteDescription;

  for (const signal of queue) {
    if (signal.type === 'ice' && !remoteDescriptionReady) {
      remaining.push(signal);
      continue;
    }

    ready.push(signal);
    if (signal.type === 'offer' || signal.type === 'answer') {
      remoteDescriptionReady = true;
    }
  }

  return { ready, remaining };
}
