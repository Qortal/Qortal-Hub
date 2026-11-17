/**
 * DUPLICATE of src/lib/webrtc/stunBootstrap.ts — keep constants, parsing, and URL
 * shape identical. Change both files together; see Vitest golden fixture.
 *
 * @deprecated STUN_UDP_PORT_OFFSET — legacy wire v1 (`tls + 1000`). New peers use
 * STUN_FIXED_UDP_PORT for discovery and handshake.
 */
export const STUN_UDP_PORT_OFFSET = 1000;

/** Well-known decentralized STUN UDP port (singleton per machine; wire v2). */
export const STUN_FIXED_UDP_PORT = 47321;

/** Handshake field `stunWireVersion` — bump when STUN wire or formula changes. */
export const STUN_WIRE_VERSION = 2;

export interface StunIceServerShape {
  urls: string;
}

/**
 * Build `stun:host:STUN_FIXED_UDP_PORT` entries from P2P seed addresses `host:tlsPort`.
 * TLS port is only used to validate the address shape; STUN always uses the fixed port.
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
