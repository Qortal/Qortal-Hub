/**
 * Shared UPnP NAT mapping helpers (ESM @silentbot1/nat-api loaded via dynamic import).
 * Used by P2P mesh and Reticulum hub mesh — keep port mappings independent per feature.
 */

/** eslint-disable @typescript-eslint/no-explicit-any -- nat-api has no bundled types */
export type NatApiClient = any;

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
  return new NatAPI({
    enableUPNP: true,
    enablePMP: false,
    autoUpdate: true,
    ttl: options.ttl ?? 7200,
    description: options.description,
  });
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
  const result = await client.map({
    publicPort: params.publicPort,
    privatePort: params.privatePort,
    protocol: 'TCP',
    ttl: params.ttl ?? 7200,
    description: params.description,
  });
  return result !== false;
}

export async function unmapTcpPort(
  client: NatApiClient,
  publicPort: number,
  privatePort: number
): Promise<void> {
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
  const result = await client.map({
    publicPort: params.publicPort,
    privatePort: params.privatePort,
    protocol: 'UDP',
    ttl: params.ttl ?? 7200,
    description: params.description,
  });
  return result !== false;
}

export async function unmapUdpPort(
  client: NatApiClient,
  publicPort: number,
  privatePort: number
): Promise<void> {
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
  try {
    await client.destroy();
  } catch {
    /* best-effort */
  }
}
