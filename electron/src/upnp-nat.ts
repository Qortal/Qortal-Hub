/**
 * Shared UPnP NAT mapping helpers (ESM @silentbot1/nat-api loaded via dynamic import).
 * Used by P2P mesh and Reticulum hub mesh — keep port mappings independent per feature.
 */

/** eslint-disable @typescript-eslint/no-explicit-any -- nat-api has no bundled types */
export type NatApiClient = any;

type NatMapping = {
  publicPort: number;
  privatePort: number;
  protocol: 'TCP' | 'UDP';
  ttl: number;
  description: string;
};

type ManagedNatClient = {
  destroyed: boolean;
  timers: Map<string, ReturnType<typeof setTimeout>>;
};

const managedNatClients = new WeakMap<NatApiClient, ManagedNatClient>();
const DEFAULT_TTL_SECONDS = 7200;
const MIN_TTL_SECONDS = 1200;
const RENEW_BEFORE_EXPIRY_SECONDS = 600;
const FAILED_RENEW_RETRY_MS = 5 * 60 * 1000;

/**
 * Dynamic import bridges the ESM-only package into our CommonJS build.
 * Wrapping in new Function() prevents the TypeScript CommonJS compiler
 * from rewriting import() to require() — require() fails on ESM packages.
 */
export async function loadNatApi(): Promise<{ default: new (opts: Record<string, unknown>) => NatApiClient }> {
  const load = new Function('return import("@silentbot1/nat-api")');
  return (await load()) as { default: new (opts: Record<string, unknown>) => NatApiClient };
}

export async function createNatApiClient(options: {
  description: string;
  ttl?: number;
}): Promise<NatApiClient> {
  const { default: NatAPI } = await loadNatApi();
  const client = new NatAPI({
    enableUPNP: true,
    enablePMP: false,
    // @silentbot1/nat-api autoUpdate schedules async interval callbacks
    // without a rejection handler. Manage renewal here so destroy races and
    // router errors cannot surface as unhandled promise rejections.
    autoUpdate: false,
    ttl: options.ttl ?? 7200,
    description: options.description,
  });
  managedNatClients.set(client, { destroyed: false, timers: new Map() });
  return client;
}

function normalizedTtl(ttl?: number): number {
  return Math.max(ttl ?? DEFAULT_TTL_SECONDS, MIN_TTL_SECONDS);
}

function mappingKey(mapping: NatMapping): string {
  return `${mapping.publicPort}:${mapping.privatePort}-${mapping.protocol}`;
}

function mappingKeyFromParts(
  publicPort: number,
  privatePort: number,
  protocol: 'TCP' | 'UDP'
): string {
  return `${publicPort}:${privatePort}-${protocol}`;
}

function clearManagedMappingTimer(client: NatApiClient, key: string): void {
  const managed = managedNatClients.get(client);
  const timer = managed?.timers.get(key);
  if (!managed || !timer) return;
  clearTimeout(timer);
  managed.timers.delete(key);
}

function clearAllManagedMappingTimers(client: NatApiClient): void {
  const managed = managedNatClients.get(client);
  if (!managed) return;
  for (const timer of managed.timers.values()) {
    clearTimeout(timer);
  }
  managed.timers.clear();
}

function scheduleManagedRenewal(
  client: NatApiClient,
  mapping: NatMapping,
  delayMs?: number
): void {
  const managed = managedNatClients.get(client);
  if (!managed || managed.destroyed) return;

  const key = mappingKey(mapping);
  clearManagedMappingTimer(client, key);

  const renewDelayMs =
    delayMs ??
    Math.max(60, mapping.ttl - RENEW_BEFORE_EXPIRY_SECONDS) * 1000;

  const timer = setTimeout(() => {
    void renewManagedMapping(client, mapping);
  }, renewDelayMs);
  timer.unref?.();
  managed.timers.set(key, timer);
}

async function renewManagedMapping(
  client: NatApiClient,
  mapping: NatMapping
): Promise<void> {
  const managed = managedNatClients.get(client);
  if (!managed || managed.destroyed) return;

  try {
    const opts = {
      publicPort: mapping.publicPort,
      privatePort: mapping.privatePort,
      protocol: mapping.protocol,
      ttl: mapping.ttl,
      description: mapping.description,
    };

    const result =
      typeof client._map === 'function'
        ? await client._map(opts)
        : await client.map(opts);
    const ok = Array.isArray(result) ? result[0] !== false : result !== false;

    if (!managed.destroyed) {
      scheduleManagedRenewal(
        client,
        mapping,
        ok ? undefined : FAILED_RENEW_RETRY_MS
      );
    }
  } catch {
    if (!managed.destroyed) {
      scheduleManagedRenewal(client, mapping, FAILED_RENEW_RETRY_MS);
    }
  }
}

export async function mapTcpPort(
  client: NatApiClient,
  params: {
    publicPort: number;
    privatePort: number;
    description: string;
    ttl?: number;
  }
): Promise<boolean> {
  const ttl = normalizedTtl(params.ttl);
  const result = await client.map({
    publicPort: params.publicPort,
    privatePort: params.privatePort,
    protocol: 'TCP',
    ttl,
    description: params.description,
  });
  const ok = result !== false;
  if (ok) {
    scheduleManagedRenewal(client, {
      publicPort: params.publicPort,
      privatePort: params.privatePort,
      protocol: 'TCP',
      ttl,
      description: params.description,
    });
  }
  return ok;
}

export async function unmapTcpPort(
  client: NatApiClient,
  publicPort: number,
  privatePort: number
): Promise<void> {
  clearManagedMappingTimer(
    client,
    mappingKeyFromParts(publicPort, privatePort, 'TCP')
  );
  await client
    .unmap({
      publicPort,
      privatePort,
      protocol: 'TCP',
    })
    .catch(() => {});
}

export async function mapUdpPort(
  client: NatApiClient,
  params: {
    publicPort: number;
    privatePort: number;
    description: string;
    ttl?: number;
  }
): Promise<boolean> {
  const ttl = normalizedTtl(params.ttl);
  const result = await client.map({
    publicPort: params.publicPort,
    privatePort: params.privatePort,
    protocol: 'UDP',
    ttl,
    description: params.description,
  });
  const ok = result !== false;
  if (ok) {
    scheduleManagedRenewal(client, {
      publicPort: params.publicPort,
      privatePort: params.privatePort,
      protocol: 'UDP',
      ttl,
      description: params.description,
    });
  }
  return ok;
}

export async function unmapUdpPort(
  client: NatApiClient,
  publicPort: number,
  privatePort: number
): Promise<void> {
  clearManagedMappingTimer(
    client,
    mappingKeyFromParts(publicPort, privatePort, 'UDP')
  );
  await client
    .unmap({
      publicPort,
      privatePort,
      protocol: 'UDP',
    })
    .catch(() => {});
}

export async function destroyNatClient(client: NatApiClient | null): Promise<void> {
  if (!client) return;
  const managed = managedNatClients.get(client);
  if (managed) {
    managed.destroyed = true;
  }
  clearAllManagedMappingTimers(client);
  try {
    await client.destroy();
  } catch {
    /* best-effort */
  }
  managedNatClients.delete(client);
}
