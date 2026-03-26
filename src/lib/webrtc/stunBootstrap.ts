/**
 * DUPLICATE of electron/src/stun-bootstrap.ts — keep constants, parsing, and URL
 * shape identical. Change both files together; see Vitest + PR checklist.
 *
 * @deprecated STUN_UDP_PORT_OFFSET — legacy wire v1. New behavior uses STUN_FIXED_UDP_PORT.
 */
export const STUN_UDP_PORT_OFFSET = 1000;

/** Well-known decentralized STUN UDP port (singleton per machine; wire v2). */
export const STUN_FIXED_UDP_PORT = 47321;

export const STUN_WIRE_VERSION = 2;

export interface StunIceServerShape {
  urls: string;
}

/** Small public fallback used only when the legacy toggle is enabled. */
export const LEGACY_PUBLIC_STUN_FALLBACK: { urls: string }[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/** Sync ICE list from preload bootstrap (Electron); empty if hub missing and legacy off. */
export function getInitialIceServersFromHub(): { urls: string }[] {
  const w = window as Window & {
    hub?: { getBootstrapIceServers?: () => { urls: string }[] };
  };
  const list = w.hub?.getBootstrapIceServers?.();
  if (Array.isArray(list) && list.length > 0) return list;
  return LEGACY_PUBLIC_STUN_FALLBACK;
}

/**
 * Build `stun:host:STUN_FIXED_UDP_PORT` from seed addresses `host:tlsPort`.
 * TLS port validates shape only.
 */
export function buildBootstrapIceServers(
  seedAddrs: string[]
): StunIceServerShape[] {
  const out: StunIceServerShape[] = [];
  const seen = new Set<string>();
  for (const addr of seedAddrs) {
    if (typeof addr !== 'string') continue;
    const idx = addr.lastIndexOf(':');
    if (idx <= 0) continue;
    const host = addr.slice(0, idx).trim();
    const tlsPort = parseInt(addr.slice(idx + 1), 10);
    if (!host || Number.isNaN(tlsPort) || tlsPort < 1 || tlsPort > 65535) continue;
    const url = `stun:${host}:${STUN_FIXED_UDP_PORT}`;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ urls: url });
  }
  return out;
}
