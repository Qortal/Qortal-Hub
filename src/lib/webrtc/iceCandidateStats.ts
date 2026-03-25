/**
 * Log which STUN/TURN `url` produced each local srflx/relay candidate.
 * Chromium/Electron exposes this on `local-candidate` stats entries; timing may lag
 * slightly after `iceGatheringState === 'complete'`, so callers typically defer ~100ms.
 */

export async function logIceServerSourcesForPeer(
  pc: RTCPeerConnection,
  label: string
): Promise<void> {
  try {
    const report = await pc.getStats();
    const lines: string[] = [];
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
      const ip = r.ip ?? r.address ?? '?';
      const port = r.port ?? '?';
      const src = r.url ?? '(url missing in stats)';
      lines.push(`${ct} ${ip}:${port} ← ${src}`);
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
