/**
 * Reticulum hub-to-hub mesh coordinator (separate from TLS P2P).
 *
 * Transport uses managed rnsd config (mesh listen: Backbone on Linux, TCPServer on Windows/macOS; bootstrap TCPClient hubs).
 * Community mesh links use RNS interface discovery + autoconnect (see reticulum-daemon).
 */

import fs from 'fs';
import { ipcMain } from 'electron';
import { log as loggerLog } from './logger';
import {
  buildCurrentManagedReticulumConfig,
  ensureMeshNetworkIdentityIfNeeded,
  getReticulumDaemonStatus,
  getReticulumInstanceIndex,
  type EnsureMeshNetworkIdentityResult,
  restartBundledReticulumDaemonAndWaitReady,
  writeManagedReticulumConfigIfManaged,
} from './reticulum-daemon';
import { rebindReticulumBridgeConsumers } from './reticulum-bridge-rebind';
import { startReticulumBridge, stopReticulumBridge } from './reticulum-bridge';
import type { NatApiClient } from './upnp-nat';
import {
  createNatApiClient,
  destroyNatClient,
  mapTcpPort,
  unmapTcpPort,
} from './upnp-nat';
import {
  getMeshNetworkIdentityPath,
  isPlausibleReachableOnHost,
  loadReticulumMeshState,
  resolveMeshReachableOnHost,
  saveReticulumMeshState,
} from './reticulum-mesh-store';
import { readAppSettings } from './setup';

let meshUpnpClient: unknown = null;
let meshUpnpStopped = false;

async function refreshDiscoveryReachableHostFromUpnp(
  client: NatApiClient
): Promise<void> {
  try {
    const ext =
      typeof (client as { externalIp?: () => Promise<string> }).externalIp ===
      'function'
        ? await (client as { externalIp: () => Promise<string> }).externalIp()
        : '';
    const ip = typeof ext === 'string' ? ext.trim() : '';
    if (!ip || !isPlausibleReachableOnHost(ip)) {
      return;
    }
    const prev = loadReticulumMeshState();
    if (prev.meshReachableOnHost?.trim()) {
      return;
    }
    if (prev.discoveryReachableHost === ip) {
      return;
    }
    saveReticulumMeshState({ ...prev, discoveryReachableHost: ip });
    await applyManagedMeshConfigAfterReachableUpdate();
  } catch (err) {
    loggerLog('[ReticulumMesh] UPnP externalIp failed:', err);
  }
}

/**
 * After mesh identity / `reachable_on` / enable_transport change, rewrite managed config and restart rnsd + bridge if running.
 */
export async function applyManagedMeshConfigAfterReachableUpdate(): Promise<void> {
  if (getReticulumInstanceIndex() > 0) {
    return;
  }
  ensureMeshNetworkIdentityIfNeeded();
  const next = buildCurrentManagedReticulumConfig();
  if (!writeManagedReticulumConfigIfManaged(next)) {
    return;
  }
  loggerLog(
    '[ReticulumMesh] Managed config updated (mesh reachable_on); restarting Reticulum stack'
  );
  if (!getReticulumDaemonStatus().running) {
    loggerLog('[ReticulumMesh] rnsd not running; config saved for next start');
    return;
  }
  stopReticulumBridge();
  try {
    await restartBundledReticulumDaemonAndWaitReady();
  } catch (err) {
    loggerLog('[ReticulumMesh] rnsd restart after mesh config failed:', err);
    return;
  }
  try {
    await startReticulumBridge();
    rebindReticulumBridgeConsumers();
  } catch (err) {
    loggerLog('[ReticulumMesh] Bridge restart after mesh config failed:', err);
  }
}

async function setupMeshUpnp(listenPort: number): Promise<void> {
  if (meshUpnpClient) {
    return;
  }
  meshUpnpStopped = false;
  const settings = await readAppSettings();
  if (settings.reticulumMeshUpnpEnabled === false) {
    loggerLog('[ReticulumMesh] UPnP disabled in app settings');
    return;
  }
  const st = loadReticulumMeshState();
  if (st.meshUpnpEnabled === false) {
    return;
  }
  try {
    const client = await createNatApiClient({ description: 'Qortal Hub Reticulum Mesh' });
    if (meshUpnpStopped) {
      await destroyNatClient(client);
      return;
    }
    const ok = await mapTcpPort(client, {
      publicPort: listenPort,
      privatePort: listenPort,
      description: 'Qortal Hub Reticulum Mesh',
    });
    if (meshUpnpStopped) {
      await unmapTcpPort(client, listenPort, listenPort);
      await destroyNatClient(client);
      return;
    }
    if (!ok) {
      loggerLog(`[ReticulumMesh] UPnP: TCP ${listenPort} map failed`);
      await destroyNatClient(client);
      return;
    }
    meshUpnpClient = client;
    loggerLog(`[ReticulumMesh] UPnP: TCP ${listenPort} mapped`);
    void refreshDiscoveryReachableHostFromUpnp(client);
  } catch (err) {
    loggerLog('[ReticulumMesh] UPnP error:', err);
  }
}

function teardownMeshUpnp(listenPort: number): void {
  meshUpnpStopped = true;
  const client = meshUpnpClient as {
    unmap?: (x: Record<string, unknown>) => Promise<void>;
    destroy?: () => Promise<void>;
  } | null;
  meshUpnpClient = null;
  if (!client) return;
  void unmapTcpPort(client, listenPort, listenPort).finally(() => {
    void destroyNatClient(client);
  });
}

export type ReticulumMeshStatus = {
  enabled: boolean;
  listenPort: number;
  meshListenEnabled: boolean;
  upnpMapped: boolean;
  reachableSelf: boolean;
  /** RNS interface discovery + autoconnect; LXMF is bundled with the Reticulum runtime. */
  meshDiscoveryClient: boolean;
  /** Private gateway fields on the mesh listener (requires mesh-network.identity). */
  meshPrivateGateway: boolean;
  networkIdentityPath: string;
  /** UPnP-derived WAN host last stored for `reachable_on` (manual override does not clear this). */
  discoveryReachableHost?: string;
  /** Optional manual `reachable_on` from mesh state (wins over discovery). */
  meshReachableOnHost?: string;
  /** Effective host emitted to Reticulum when private gateway is on (null if unknown). */
  meshReachableOnEffective: string | null;
};

function getMeshStatus(): ReticulumMeshStatus {
  const st = loadReticulumMeshState();
  const identityPath = getMeshNetworkIdentityPath();
  const meshPrivateGateway =
    st.meshListenEnabled === true && fs.existsSync(identityPath);
  return {
    enabled: getReticulumInstanceIndex() === 0,
    listenPort: st.listenPort,
    meshListenEnabled: st.meshListenEnabled,
    upnpMapped: meshUpnpClient != null,
    reachableSelf: st.reachableSelf === true,
    meshDiscoveryClient: true,
    meshPrivateGateway,
    networkIdentityPath: identityPath,
    discoveryReachableHost: st.discoveryReachableHost,
    meshReachableOnHost: st.meshReachableOnHost,
    meshReachableOnEffective: meshPrivateGateway
      ? resolveMeshReachableOnHost(st)
      : null,
  };
}

export function registerReticulumMeshIpcHandlers(): void {
  ipcMain.handle('reticulum:getMeshStatus', async (): Promise<ReticulumMeshStatus> => {
    return getMeshStatus();
  });
  ipcMain.handle(
    'reticulum:ensureMeshNetworkIdentity',
    async (): Promise<EnsureMeshNetworkIdentityResult> => {
      if (getReticulumInstanceIndex() > 0) {
        return { ok: false, error: 'Not available on secondary app instances' };
      }
      const r = ensureMeshNetworkIdentityIfNeeded();
      if (!r.ok) {
        return r;
      }
      await applyManagedMeshConfigAfterReachableUpdate();
      return r;
    }
  );
}

let meshCoordinatorStarted = false;

export function startReticulumMeshCoordinator(
  _bridge: ReturnType<
    typeof import('./reticulum-bridge').getReticulumBridge
  >
): void {
  void _bridge;
  if (getReticulumInstanceIndex() > 0) {
    return;
  }
  if (meshCoordinatorStarted) return;
  meshCoordinatorStarted = true;
  loggerLog('[ReticulumMesh] Coordinator starting');
  const st = loadReticulumMeshState();
  void setupMeshUpnp(st.listenPort);
}

export function stopReticulumMeshCoordinator(
  options: { teardownUpnp?: boolean } = {}
): void {
  if (!meshCoordinatorStarted) return;
  meshCoordinatorStarted = false;
  const tu = options.teardownUpnp !== false;
  if (tu) {
    teardownMeshUpnp(loadReticulumMeshState().listenPort);
  }
  loggerLog('[ReticulumMesh] Coordinator stopped');
}
