/**
 * Phase D: multi-source jitter drain fairness — pure helpers (unit-tested).
 * See multi-source jitter fairness plan (per-source cap f(N), global ceiling, ordering).
 */

/** Hard ceiling on total Opus decodes per ~20ms drain tick (tunable in field). */
export const MAX_GLOBAL_DECODES_PER_TICK = 16;

export function computePerSourceCap(scaledBurstCap: number, n: number): number {
  const N = Math.max(1, n);
  return Math.min(
    scaledBurstCap,
    Math.max(2, Math.ceil(scaledBurstCap / N))
  );
}

export function computeGlobalDecodeBudget(
  n: number,
  perSourceCap: number,
  maxGlobal = MAX_GLOBAL_DECODES_PER_TICK
): number {
  const N = Math.max(1, n);
  return Math.min(N * perSourceCap, maxGlobal);
}

export interface JitterDrainJbProbe {
  getBufferedFrames(): number;
  hasReadyFrame(): boolean;
}

/**
 * D2 ordering when N >= 2: empty buffer first, then unprimed (frames but !ready),
 * then ready sources by underrun EMA desc, then thinnest buffer.
 * Rotation within each bucket so no fixed last peer.
 */
export function computeOrderedDrainAddresses(
  activeAddrs: readonly string[],
  getJb: (addr: string) => JitterDrainJbProbe | undefined,
  underrunEma: ReadonlyMap<string, number>,
  rotationTick: number
): string[] {
  const bucket0: string[] = [];
  const bucket1: string[] = [];
  const bucket2: string[] = [];

  for (const addr of activeAddrs) {
    const jb = getJb(addr);
    if (!jb) continue;
    const frames = jb.getBufferedFrames();
    if (frames === 0) {
      bucket0.push(addr);
    } else if (!jb.hasReadyFrame()) {
      bucket1.push(addr);
    } else {
      bucket2.push(addr);
    }
  }

  const rotate = <T>(arr: T[], tick: number): T[] => {
    if (arr.length === 0) return arr;
    const start = tick % arr.length;
    return [...arr.slice(start), ...arr.slice(0, start)];
  };

  bucket2.sort((a, b) => {
    const emaA = underrunEma.get(a) ?? 0;
    const emaB = underrunEma.get(b) ?? 0;
    if (emaB !== emaA) return emaB - emaA;
    const fa = getJb(a)!.getBufferedFrames();
    const fb = getJb(b)!.getBufferedFrames();
    return fa - fb;
  });

  return [
    ...rotate(bucket0, rotationTick),
    ...rotate(bucket1, rotationTick + 1),
    ...rotate(bucket2, rotationTick + 2),
  ];
}
