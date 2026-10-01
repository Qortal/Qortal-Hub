import { createHash } from 'crypto';
import type { ReticulumBridge } from './reticulum-bridge';
import {
  PrivateTransportSidecar,
  PrivateTransportSidecarError,
} from './private-transport-sidecar';
import type { TrustedRelayConfig } from './quic-masque-transport';
import { validateCommunityMasqueRelay } from './masque-relay-discovery';

export function relayPolicy(relay: TrustedRelayConfig) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        Mode: relay.accessMode,
        Groups: relay.allowedGroupIds?.length
          ? [...relay.allowedGroupIds].sort((a, b) => a - b)
          : null,
      })
    )
    .digest('hex');
}
type Signature = {
  authorAddress: string;
  authorPublicKey: string;
  signature: string;
};
type Batch = { tickets: string[]; expiresAt: number };
/** In-memory, account-scoped bearer credentials. Never exposed to a QApp. */
export class RelayTicketWallet {
  private batches = new Map<string, Batch>();
  private pending = new Map<string, Promise<void>>();
  private generation = 0;
  constructor(private sidecar: PrivateTransportSidecar) {}
  clear() {
    this.generation++;
    this.batches.clear();
    this.pending.clear();
  }
  private key(r: TrustedRelayConfig) {
    return `${r.relayIdentity}:${r.relayCertSha256}:${relayPolicy(r)}`;
  }
  async ensure(
    bridge: ReticulumBridge,
    relay: TrustedRelayConfig,
    account: string,
    sign: (p: Record<string, unknown>) => Promise<Signature | null>,
    valid: () => boolean
  ) {
    const key = this.key(relay),
      existing = this.batches.get(key);
    if (
      existing?.tickets.length &&
      existing.expiresAt > Date.now() + 10 * 60_000
    )
      return;
    if (this.pending.has(key)) return this.pending.get(key)!;
    if (
      relay.protocolVersion !== 3 ||
      !relay.ticketIdentity ||
      !relay.ticketKeyId
    )
      throw new PrivateTransportSidecarError('RELAY_PROTOCOL_UNSUPPORTED');
    if (this.pending.size >= 4)
      throw new PrivateTransportSidecarError('RELAY_BUSY');
    const epoch = this.generation;
    const check = () => {
      if (epoch !== this.generation || !valid())
        throw new Error('RELAY_ACCOUNT_CHANGED');
    };
    const operation = (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const startedWindow = Math.floor(Date.now() / 3_600_000);
        try {
          const request = async (
            path: string,
            data: Record<string, unknown>
          ) => {
            check();
            try {
              const result = await bridge.relayTicketRequest(
                relay.ticketIdentity!,
                path,
                data
              );
              check();
              return result;
            } catch (error) {
              check();
              throw new PrivateTransportSidecarError(
                error instanceof Error && /^RELAY_[A-Z_]+$/.test(error.message)
                  ? error.message
                  : 'RELAY_AUTH_UNAVAILABLE'
              );
            }
          };
          const descriptor = await request('/catalog', {});
          let committedKey = relay.ticketKeyId;
          if (descriptor.keyId !== committedKey) {
            await bridge.getCommunityMasqueRelays(true);
            for (let attempt = 0; attempt < 10; attempt++) {
              check();
              const ads = await bridge.getCommunityMasqueRelays(false);
              const current = ads
                .map((v) =>
                  validateCommunityMasqueRelay(v, { allowLoopback: true })
                )
                .find(
                  (v) =>
                    v?.protocolVersion === 3 &&
                    v.relayIdentity === relay.relayIdentity &&
                    v.certSha256 === relay.relayCertSha256 &&
                    JSON.stringify(v.allowedGroupIds) ===
                      JSON.stringify(relay.allowedGroupIds) &&
                    v.ticketKeyId === descriptor.keyId
                );
              if (current) {
                committedKey = current.ticketKeyId;
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 300));
            }
          }
          if (
            Object.keys(descriptor).sort().join(',') !==
              'epoch,expiresAt,keyId,policy,publicKey,relayPin' ||
            descriptor.keyId !== committedKey ||
            descriptor.relayPin !== relay.relayCertSha256 ||
            descriptor.policy !== relayPolicy(relay)
          )
            throw new PrivateTransportSidecarError('RELAY_PROOF_INVALID');
          const state = await this.sidecar.prepareRelayTickets(descriptor);
          check();
          if (
            !/^[a-f0-9]{48}$/.test(state.handle) ||
            !Array.isArray(state.blinded) ||
            state.blinded.length !== 3
          )
            throw new Error('RELAY_PROOF_INVALID');
          const data = { descriptor, blinded: state.blinded };
          const c = await request('/challenge', data);
          const binding = createHash('sha256')
            .update(
              JSON.stringify({ key: descriptor.keyId, blinded: state.blinded })
            )
            .digest('hex');
          if (
            Object.keys(c).sort().join(',') !==
              'binding,expiresAt,nonce,policy,relayPin,type' ||
            c.type !== 'masque-ticket-issue-v1' ||
            c.binding !== binding ||
            c.policy !== relayPolicy(relay) ||
            c.relayPin !== relay.relayCertSha256 ||
            !/^[a-f0-9]{64}$/.test(c.nonce) ||
            !Number.isSafeInteger(c.expiresAt) ||
            c.expiresAt <= Date.now() ||
            c.expiresAt > Date.now() + 65_000
          )
            throw new Error('RELAY_PROOF_INVALID');
          const signature = await sign(c);
          check();
          if (!signature || signature.authorAddress !== account)
            throw new Error('RELAY_ACCOUNT_CHANGED');
          const response = await request('/issue', {
            ...data,
            proof: { ...c, ...signature },
          });
          const finalized = await this.sidecar.finalizeRelayTickets(
            state.handle,
            response.signatures
          );
          check();
          if (
            finalized.expiresAt !== descriptor.expiresAt ||
            !Array.isArray(finalized.tickets) ||
            finalized.tickets.length !== 3
          )
            throw new Error('RELAY_PROOF_INVALID');
          if (this.batches.size >= 32 && !this.batches.has(key))
            this.batches.delete(this.batches.keys().next().value!);
          this.batches.set(key, finalized);
          return;
        } catch (error) {
          check();
          // A request crossing an hourly key rotation may safely start again
          // with new blind randomness; never replay the previous proof/token.
          if (
            attempt === 0 &&
            Math.floor(Date.now() / 3_600_000) !== startedWindow
          )
            continue;
          throw error;
        }
      }
    })().finally(() => {
      if (this.pending.get(key) === operation) this.pending.delete(key);
    });
    this.pending.set(key, operation);
    return operation;
  }
  take(relay: TrustedRelayConfig): string {
    const batch = this.batches.get(this.key(relay));
    if (!batch || batch.expiresAt <= Date.now() || !batch.tickets.length)
      throw new PrivateTransportSidecarError('RELAY_AUTH_UNAVAILABLE');
    // Consume before sending. A lost response must never cause token replay.
    return batch.tickets.shift()!;
  }
}
