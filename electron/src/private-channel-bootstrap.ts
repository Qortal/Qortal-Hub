import { createHash, randomBytes } from 'crypto';
import net from 'net';
import {
  PrivateChannelError,
  type PrivateTransportContext,
} from './private-channel-manager';
import {
  QAppReticulumManager,
  type QAppReticulumOwner,
} from './qapp-reticulum-manager';

export const PRIVATE_BOOTSTRAP_VERSION = 1;
export const PRIVATE_BOOTSTRAP_TRANSPORT = 'quic-masque-inner-v1';
export const PRIVATE_BOOTSTRAP_PATH = '/qortal/private-transport/bootstrap/v1';

export type PrivateBootstrapDescriptor = Readonly<{
  version: 1;
  transport: 'quic-masque-inner-v1';
  logicalSessionId: string;
  backendRnsDestination: string;
  backendTransportEndpoint: string;
  backendTransportServerName: string;
  backendTransportCertSha256: string;
  attachToken: string;
  expiresAt: number;
  nonce: string;
  ownerBindingHash: string;
  applicationProtocol?: string;
  supportedFeatures: {
    reliable: true;
    datagrams: true;
    moqt?: boolean;
    moqtReliableGroups?: boolean;
  };
}>;

export interface PrivateChannelBootstrapProvider {
  getBootstrap(
    context: PrivateTransportContext
  ): Promise<PrivateBootstrapDescriptor>;
}

export class ReticulumPrivateChannelBootstrapProvider implements PrivateChannelBootstrapProvider {
  private readonly consumedNonces = new Set<string>();

  constructor(private readonly manager: QAppReticulumManager) {}

  async getBootstrap(
    context: PrivateTransportContext
  ): Promise<PrivateBootstrapDescriptor> {
    const destination = this.manager.connectionDestination(
      context.owner,
      context.rnsConnectionId
    );
    const nonce = randomBytes(24).toString('base64url');
    let value: unknown;
    try {
      value = await this.manager.request(context.owner, {
        destination,
        path: PRIVATE_BOOTSTRAP_PATH,
        payload: {
          version: PRIVATE_BOOTSTRAP_VERSION,
          transport: PRIVATE_BOOTSTRAP_TRANSPORT,
          nonce,
          purpose: context.purpose,
        },
        timeoutMs: 15_000,
        maxResponseBytes: 16 * 1024,
        connectionId: context.rnsConnectionId,
      });
    } catch {
      throw new PrivateChannelError('BOOTSTRAP_FAILED');
    }
    return validatePrivateBootstrapDescriptor(value, {
      context,
      authenticatedRnsDestination: destination,
      requestNonce: nonce,
      consumedNonces: this.consumedNonces,
    });
  }
}

export function validatePrivateBootstrapDescriptor(
  value: unknown,
  expected: {
    context: PrivateTransportContext;
    authenticatedRnsDestination: string;
    requestNonce: string;
    consumedNonces: Set<string>;
    now?: number;
  }
): PrivateBootstrapDescriptor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PrivateChannelError('BOOTSTRAP_FAILED');
  }
  const d = value as Record<string, unknown>;
  if (d.error && typeof d.error === 'object') {
    if ((d.error as { code?: unknown }).code === 'transport_already_attached')
      throw new PrivateChannelError('TRANSPORT_ALREADY_ATTACHED');
    throw new PrivateChannelError('BOOTSTRAP_FAILED');
  }
  if (d.version !== PRIVATE_BOOTSTRAP_VERSION) {
    throw new PrivateChannelError('PROTOCOL_MISMATCH');
  }
  if (d.transport !== PRIVATE_BOOTSTRAP_TRANSPORT) {
    throw new PrivateChannelError('UNSUPPORTED_TRANSPORT');
  }
  const now = expected.now ?? Date.now();
  if (
    typeof d.expiresAt !== 'number' ||
    !Number.isSafeInteger(d.expiresAt) ||
    d.expiresAt <= now ||
    d.expiresAt > now + 5 * 60_000
  )
    throw new PrivateChannelError('BOOTSTRAP_EXPIRED');
  if (
    d.backendRnsDestination !== expected.authenticatedRnsDestination ||
    d.nonce !== expected.requestNonce
  )
    throw new PrivateChannelError('BOOTSTRAP_BINDING_MISMATCH');
  if (expected.consumedNonces.has(expected.requestNonce)) {
    throw new PrivateChannelError('BOOTSTRAP_REUSED');
  }
  for (const key of [
    'logicalSessionId',
    'backendTransportServerName',
    'attachToken',
  ] as const) {
    if (
      typeof d[key] !== 'string' ||
      !(d[key] as string).trim() ||
      (d[key] as string).length > 512
    ) {
      throw new PrivateChannelError('BOOTSTRAP_FAILED');
    }
  }
  const expectedOwnerBinding = privateBootstrapOwnerBindingHash(
    expected.context.owner,
    expected.context.rnsConnectionId,
    expected.authenticatedRnsDestination,
    d.logicalSessionId as string,
    expected.requestNonce,
    expected.context.purpose
  );
  if (d.ownerBindingHash !== expectedOwnerBinding) {
    throw new PrivateChannelError('BOOTSTRAP_BINDING_MISMATCH');
  }
  if (
    typeof d.backendTransportEndpoint !== 'string' ||
    !isLiteralEndpoint(d.backendTransportEndpoint) ||
    typeof d.backendTransportCertSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(d.backendTransportCertSha256) ||
    !d.supportedFeatures ||
    typeof d.supportedFeatures !== 'object' ||
    (d.supportedFeatures as Record<string, unknown>).reliable !== true ||
    (d.supportedFeatures as Record<string, unknown>).datagrams !== true
  )
    throw new PrivateChannelError('BOOTSTRAP_FAILED');
  expected.consumedNonces.add(expected.requestNonce);
  while (expected.consumedNonces.size > 4096) {
    const oldest = expected.consumedNonces.values().next().value;
    if (typeof oldest !== 'string') break;
    expected.consumedNonces.delete(oldest);
  }
  return d as unknown as PrivateBootstrapDescriptor;
}

export function privateBootstrapOwnerBindingHash(
  owner: QAppReticulumOwner,
  rnsConnectionId: string,
  destination: string,
  logicalSessionId: string,
  nonce: string,
  purpose: string
): string {
  return createHash('sha256')
    .update(
      `qortal-private-owner-v2\0${owner.name}\0${owner.service}\0${rnsConnectionId}\0${destination}\0${logicalSessionId}\0${nonce}\0${purpose}`
    )
    .digest('hex');
}

function isLiteralEndpoint(value: string): boolean {
  const match = value.startsWith('[')
    ? /^\[([^\]]+)\]:(\d+)$/.exec(value)
    : /^([^:]+):(\d+)$/.exec(value);
  if (!match) return false;
  const port = Number(match[2]);
  return net.isIP(match[1]) !== 0 && port >= 1 && port <= 65535;
}
