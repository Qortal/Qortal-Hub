/**
 * Log which STUN/TURN `url` produced each local srflx/relay candidate.
 * Chromium/Electron exposes this on `local-candidate` stats entries; timing may lag
 * slightly after `iceGatheringState === 'complete'`, so callers typically defer ~100ms.
 */

export interface IceServerSourceStat {
  candidateType: 'srflx' | 'relay';
  url: string | null;
  address: string;
  port: number | string;
}

export async function getIceServerSourceStatsForPeer(
  pc: RTCPeerConnection
): Promise<IceServerSourceStat[]> {
  const report = await pc.getStats();
  const out: IceServerSourceStat[] = [];
  report.forEach((stat) => {
    if (stat.type !== 'local-candidate') return;
    const r = stat as unknown as {
      candidateType?: string;
      url?: string;
      ip?: string;
      address?: string;
      port?: number;
    };
    const ct = r.candidateType;
    if (ct !== 'srflx' && ct !== 'relay') return;
    out.push({
      candidateType: ct,
      url: r.url ?? null,
      address: r.ip ?? r.address ?? '?',
      port: r.port ?? '?',
    });
  });
  return out;
}

export async function getIceServerSourceUrlsForPeer(
  pc: RTCPeerConnection
): Promise<string[]> {
  const stats = await getIceServerSourceStatsForPeer(pc);
  return [...new Set(stats.map((entry) => entry.url).filter((url): url is string => !!url))];
}

export async function logIceServerSourcesForPeer(
  pc: RTCPeerConnection,
  label: string
): Promise<void> {
  try {
    const stats = await getIceServerSourceStatsForPeer(pc);
    const lines = stats.map((entry) => {
      const src = entry.url ?? '(url missing in stats)';
      return `${entry.candidateType} ${entry.address}:${entry.port} ← ${src}`;
    });
    if (lines.length === 0) return;
    const uniq = [...new Set(lines)];
    console.log(label, 'STUN/TURN source (getStats):', uniq);
  } catch {
    /* ignore */
  }
}

/** Fire-and-forget after gathering completes; delay helps Chromium populate `url`. */
export function scheduleLogIceServerSourcesForPeer(
  pc: RTCPeerConnection,
  label: string,
  delayMs = 100
): void {
  window.setTimeout(() => {
    void logIceServerSourcesForPeer(pc, label);
  }, delayMs);
}
