import net from 'net';
import type { PrivateTransportFactory } from './private-channel-manager';
import {
  PrivateTransportSidecar,
  type MasqueTestConfig,
} from './private-transport-sidecar';
import { QuicMasqueTransport } from './quic-masque-transport';
import { ReticulumPrivateChannelBootstrapProvider } from './private-channel-bootstrap';
import type { QAppReticulumManager } from './qapp-reticulum-manager';
import type { ReticulumBridge } from './reticulum-bridge';
import { RelayAccessCoordinator } from './relay-access-coordinator';
import {
  MoqMasqueTransport,
  type MoqTransportEvent,
} from './moq-masque-transport';

let prototypeSidecar: PrivateTransportSidecar | null = null;
let relayCoordinator: RelayAccessCoordinator | null = null;
let sidecarShutdownPromise: Promise<void> | null = null;

/**
 * Main-process-only transport selection. Renderer/Q-App payloads are never
 * consulted. Reticulum relay discovery is the normal production path.
 */
export function getPrivateTransportFactory(
  reticulumManager: QAppReticulumManager,
  reticulumBridgeProvider: () => ReticulumBridge | null = () => null,
  environment: NodeJS.ProcessEnv = process.env
): PrivateTransportFactory | undefined {
  const mode = environment.QORTAL_PRIVATE_TRANSPORT;
  const explicitRelay =
    mode === 'masque-test' ? readTrustedRelayConfig(environment) : null;
  const bootstrapProvider = new ReticulumPrivateChannelBootstrapProvider(
    reticulumManager
  );
  prototypeSidecar ??= new PrivateTransportSidecar();
  relayCoordinator ??= new RelayAccessCoordinator(prototypeSidecar);
  return (emit) =>
    new QuicMasqueTransport(
      emit,
      prototypeSidecar!,
      explicitRelay ??
        (async (excludedRelayAddresses) => {
          const reticulumBridge = reticulumBridgeProvider();
          if (!reticulumBridge) throw new Error('MASQUE_RELAY_UNAVAILABLE');
          return relayCoordinator!.select(
            reticulumBridge,
            excludedRelayAddresses,
            environment.QORTAL_PRIVATE_TRANSPORT_ALLOW_LOCAL_RELAY === '1'
          );
        }),
      bootstrapProvider
    );
}

/**
 * Trusted main-process generic MOQT transport. The capability-scoped Q-App
 * manager owns instances and keeps relay/bootstrap details out of renderers.
 */
export function createMoqTransport(
  emit: (event: MoqTransportEvent) => void,
  reticulumManager: QAppReticulumManager,
  reticulumBridgeProvider: () => ReticulumBridge | null = () => null,
  environment: NodeJS.ProcessEnv = process.env
): MoqMasqueTransport {
  const explicitRelay =
    environment.QORTAL_PRIVATE_TRANSPORT === 'masque-test'
      ? readTrustedRelayConfig(environment)
      : null;
  prototypeSidecar ??= new PrivateTransportSidecar();
  relayCoordinator ??= new RelayAccessCoordinator(prototypeSidecar);
  return new MoqMasqueTransport(
    emit,
    prototypeSidecar,
    explicitRelay ??
      (async (excludedRelayAddresses) => {
        const reticulumBridge = reticulumBridgeProvider();
        if (!reticulumBridge) throw new Error('MASQUE_RELAY_UNAVAILABLE');
        return relayCoordinator!.select(
          reticulumBridge,
          excludedRelayAddresses,
          environment.QORTAL_PRIVATE_TRANSPORT_ALLOW_LOCAL_RELAY === '1'
        );
      }),
    new ReticulumPrivateChannelBootstrapProvider(reticulumManager)
  );
}

export function readTrustedRelayConfig(environment: NodeJS.ProcessEnv) {
  const relayAddress = required(environment.QORTAL_MASQUE_TEST_RELAY_ADDRESS);
  assertLiteralEndpoint(relayAddress, 'relay');
  const relayServerName = required(
    environment.QORTAL_MASQUE_TEST_RELAY_SERVER_NAME
  );
  const relayCertSha256 = required(
    environment.QORTAL_MASQUE_TEST_RELAY_CERT_SHA256
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(relayCertSha256)) {
    throw new Error('Invalid MASQUE test certificate pin');
  }
  return { relayAddress, relayServerName, relayCertSha256 };
}

export async function shutdownPrivateTransportSidecar(): Promise<void> {
  if (sidecarShutdownPromise) return sidecarShutdownPromise;
  const sidecar = prototypeSidecar;
  relayCoordinator?.dispose();
  relayCoordinator = null;
  prototypeSidecar = null;
  if (!sidecar) return;
  sidecarShutdownPromise = sidecar.shutdown().finally(() => {
    sidecarShutdownPromise = null;
  });
  return sidecarShutdownPromise;
}

export function readMasqueTestConfig(
  environment: NodeJS.ProcessEnv
): MasqueTestConfig {
  const relayAddress = required(environment.QORTAL_MASQUE_TEST_RELAY_ADDRESS);
  const targetAddress = required(environment.QORTAL_MASQUE_TEST_TARGET_ADDRESS);
  assertLiteralEndpoint(relayAddress, 'relay');
  assertLiteralEndpoint(targetAddress, 'target');
  const relayServerName = required(
    environment.QORTAL_MASQUE_TEST_RELAY_SERVER_NAME
  );
  const relayCertSha256 = required(
    environment.QORTAL_MASQUE_TEST_RELAY_CERT_SHA256
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(relayCertSha256)) {
    throw new Error('Invalid MASQUE test certificate pin');
  }
  return {
    relayAddress,
    relayServerName,
    relayCertSha256,
    targetAddress,
  };
}

function required(value: string | undefined): string {
  const result = String(value ?? '').trim();
  if (!result) throw new Error('Incomplete MASQUE prototype configuration');
  return result;
}

function assertLiteralEndpoint(value: string, label: string): void {
  let host = '';
  let portText = '';
  if (value.startsWith('[')) {
    const end = value.indexOf(']:');
    if (end > 0) {
      host = value.slice(1, end);
      portText = value.slice(end + 2);
    }
  } else {
    const separator = value.lastIndexOf(':');
    if (separator > 0) {
      host = value.slice(0, separator);
      portText = value.slice(separator + 1);
    }
  }
  const port = Number(portText);
  if (
    net.isIP(host) === 0 ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error(`Invalid literal ${label} endpoint`);
  }
}
