export type RendererPresenceStatus = 'online' | 'busy' | 'idle' | null;

export type RendererPresenceUpdate = {
  address: string;
  online: boolean;
  status: RendererPresenceStatus;
};

const VALID_STATUSES = new Set<RendererPresenceStatus>([
  'online',
  'busy',
  'idle',
  null,
]);

function asRendererPresenceUpdate(
  payload: unknown
): RendererPresenceUpdate | null {
  if (!payload || typeof payload !== 'object') return null;

  const candidate = payload as Partial<RendererPresenceUpdate>;
  if (
    typeof candidate.address !== 'string' ||
    typeof candidate.online !== 'boolean' ||
    !VALID_STATUSES.has(candidate.status as RendererPresenceStatus)
  ) {
    return null;
  }

  return candidate as RendererPresenceUpdate;
}

/**
 * Suppresses presence heartbeats that cannot change renderer-visible state.
 *
 * The presence manager still processes every heartbeat and owns liveness,
 * expiry, session, and route state. This class compares only the three fields
 * exposed through the renderer IPC contract.
 */
export class PresenceRendererUpdateDeduplicator {
  private readonly lastStateByAddress = new Map<
    string,
    Pick<RendererPresenceUpdate, 'online' | 'status'>
  >();

  shouldForward(payload: unknown): boolean {
    const update = asRendererPresenceUpdate(payload);
    if (!update) return true;

    const previous = this.lastStateByAddress.get(update.address);
    if (
      previous?.online === update.online &&
      previous.status === update.status
    ) {
      return false;
    }

    this.lastStateByAddress.set(update.address, {
      online: update.online,
      status: update.status,
    });
    return true;
  }

  reset(): void {
    this.lastStateByAddress.clear();
  }
}
