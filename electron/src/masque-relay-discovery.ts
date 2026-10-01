import net from 'net';
import type { ReticulumBridge } from './reticulum-bridge';
import type { TrustedRelayConfig } from './quic-masque-transport';

export const MASQUE_RELAY_DISCOVERY_TIMEOUT_MS = 15_000;
const MASQUE_RELAY_QUERY_INTERVAL_MS = 3_000;
const MAX_LEASE_AHEAD_MS = 60 * 60_000;
const MIN_REMAINING_LEASE_MS = 5_000;

export type CommunityMasqueRelay = {
  protocolVersion?: number;
  relayIdentity?: string;
  ticketIdentity?: string;
  ticketKeyId?: string;
  accessMode?: 'public' | 'groups';
  allowedGroupIds?: number[];
  host: string;
  port: number;
  serverName: string;
  certSha256: string;
  expiresAt: number;
};

export type MasqueRelayDiscoveryOptions = {
  timeoutMs?: number;
  allowLoopback?: boolean;
  /** Relay endpoints already known to have failed for this logical session. */
  excludeRelayAddresses?: ReadonlySet<string>;
  now?: () => number;
  random?: () => number;
};

export function validateCommunityMasqueRelay(
  value: unknown,
  options: MasqueRelayDiscoveryOptions = {}
): CommunityMasqueRelay | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<CommunityMasqueRelay>;
  const host = String(candidate.host ?? '').trim();
  const port = Number(candidate.port);
  const serverName = String(candidate.serverName ?? '').trim();
  const certSha256 = String(candidate.certSha256 ?? '')
    .trim()
    .toLowerCase();
  const expiresAt = Number(candidate.expiresAt);
  const now = (options.now ?? Date.now)();
  const ipFamily = net.isIP(host);
  const loopback = host === '127.0.0.1' || host === '::1';
  if (
    ipFamily === 0 ||
    (!isPublicRelayHost(host) &&
      !(loopback && options.allowLoopback === true)) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !/^[a-zA-Z0-9.-]{1,128}$/.test(serverName) ||
    !/^[a-f0-9]{64}$/.test(certSha256) ||
    !Number.isFinite(expiresAt) ||
    expiresAt < now + MIN_REMAINING_LEASE_MS ||
    expiresAt > now + MAX_LEASE_AHEAD_MS
  ) {
    return null;
  }
  if (candidate.protocolVersion === 2 || candidate.protocolVersion === 3) {
    if (
      candidate.protocolVersion === 3 &&
      (!/^[a-f0-9]{128}$/.test(candidate.ticketIdentity ?? '') ||
        !/^[a-f0-9]{64}$/.test(candidate.ticketKeyId ?? '') ||
        candidate.ticketIdentity?.slice(64) !== candidate.relayIdentity)
    )
      return null;
    if (
      !/^[a-f0-9]{64}$/.test(candidate.relayIdentity ?? '') ||
      !['public', 'groups'].includes(candidate.accessMode ?? '') ||
      !Array.isArray(candidate.allowedGroupIds) ||
      candidate.allowedGroupIds.length > 16 ||
      candidate.allowedGroupIds.some(
        (id) => !Number.isInteger(id) || id <= 0 || id > 2147483647
      ) ||
      new Set(candidate.allowedGroupIds).size !==
        candidate.allowedGroupIds.length ||
      (candidate.accessMode === 'groups') !==
        candidate.allowedGroupIds.length > 0
    )
      return null;
    return {
      host,
      port,
      serverName,
      certSha256,
      expiresAt,
      protocolVersion: candidate.protocolVersion,
      ticketIdentity: candidate.ticketIdentity,
      ticketKeyId: candidate.ticketKeyId,
      relayIdentity: candidate.relayIdentity,
      accessMode: candidate.accessMode,
      allowedGroupIds: candidate.allowedGroupIds,
    };
  }
  if (
    candidate.protocolVersion !== undefined &&
    candidate.protocolVersion !== 1
  )
    return null;
  return { host, port, serverName, certSha256, expiresAt };
}

function isPublicRelayHost(host: string): boolean {
  if (net.isIP(host) === 4) {
    const [a, b, c] = host.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (net.isIP(host) !== 6) return false;
  const normalized = host.toLowerCase();
  return !(
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('ff') ||
    normalized === '2001:db8::' ||
    normalized.startsWith('2001:db8:') ||
    normalized.startsWith('::ffff:')
  );
}

export async function discoverCommunityMasqueRelay(
  bridge: ReticulumBridge,
  options: MasqueRelayDiscoveryOptions = {}
): Promise<TrustedRelayConfig> {
  const candidates = new Map<string, CommunityMasqueRelay>();
  let wake: (() => void) | null = null;
  const accept = (value: unknown) => {
    const relay = validateCommunityMasqueRelay(value, options);
    if (!relay) return;
    const host = net.isIP(relay.host) === 6 ? `[${relay.host}]` : relay.host;
    if (options.excludeRelayAddresses?.has(`${host}:${relay.port}`)) return;
    candidates.set(`${relay.host}:${relay.port}:${relay.certSha256}`, relay);
    wake?.();
  };
  const onRelay = (value: unknown) => accept(value);
  bridge.on('community-masque-relay', onRelay);
  try {
    const timeoutMs = Math.max(
      100,
      options.timeoutMs ?? MASQUE_RELAY_DISCOVERY_TIMEOUT_MS
    );
    const deadline = Date.now() + timeoutMs;
    let queryAnnounced = false;
    while (candidates.size === 0) {
      const cached = await bridge.getCommunityMasqueRelays(false);
      for (const relay of cached) accept(relay);
      if (candidates.size > 0) break;
      if (!queryAnnounced) {
        queryAnnounced = true;
        const discovered = await bridge.getCommunityMasqueRelays(true);
        for (const relay of discovered) accept(relay);
        if (candidates.size > 0) break;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(
          () => {
            wake = null;
            resolve();
          },
          Math.min(MASQUE_RELAY_QUERY_INTERVAL_MS, remainingMs)
        );
        timer.unref?.();
        wake = () => {
          clearTimeout(timer);
          wake = null;
          resolve();
        };
      });
    }
  } finally {
    bridge.off('community-masque-relay', onRelay);
  }
  const relays = [...candidates.values()];
  if (relays.length === 0) throw new Error('MASQUE_RELAY_UNAVAILABLE');
  const random = options.random ?? Math.random;
  const selected =
    relays[Math.min(relays.length - 1, Math.floor(random() * relays.length))];
  const host =
    net.isIP(selected.host) === 6 ? `[${selected.host}]` : selected.host;
  return {
    protocolVersion: selected.protocolVersion,
    ticketIdentity: selected.ticketIdentity,
    ticketKeyId: selected.ticketKeyId,
    relayIdentity: selected.relayIdentity,
    accessMode: selected.accessMode,
    allowedGroupIds: selected.allowedGroupIds,
    relayAddress: `${host}:${selected.port}`,
    relayServerName: selected.serverName,
    relayCertSha256: selected.certSha256,
    localFallbackAddress: `127.0.0.1:${selected.port}`,
  };
}
