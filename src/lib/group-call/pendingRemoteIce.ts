/** Max buffered trickle ICE candidates per remote session; overflow drops newest. */
export const PENDING_REMOTE_ICE_MAX_PER_KEY = 96;

const KEY_SEP = '\n';

export function pendingRemoteIceKey(fromAddress: string, connId: string): string {
  return `${fromAddress}${KEY_SEP}${connId}`;
}

export function pushPendingRemoteIceCandidate(
  map: Map<string, RTCIceCandidateInit[]>,
  fromAddress: string,
  connId: string,
  candidate: RTCIceCandidateInit
): void {
  const key = pendingRemoteIceKey(fromAddress, connId);
  let arr = map.get(key);
  if (!arr) {
    arr = [];
    map.set(key, arr);
  }
  if (arr.length >= PENDING_REMOTE_ICE_MAX_PER_KEY) {
    return;
  }
  arr.push(candidate);
}

export function clearPendingRemoteIceSession(
  map: Map<string, RTCIceCandidateInit[]>,
  peerAddress: string,
  connId: string
): void {
  map.delete(pendingRemoteIceKey(peerAddress, connId));
}

export async function drainPendingRemoteIceSession(
  pc: RTCPeerConnection,
  map: Map<string, RTCIceCandidateInit[]>,
  fromAddress: string,
  connId: string
): Promise<void> {
  const key = pendingRemoteIceKey(fromAddress, connId);
  const queued = map.get(key);
  map.delete(key);
  if (!queued?.length) return;
  for (const c of queued) {
    try {
      await pc.addIceCandidate(c);
    } catch {
      /* ignore */
    }
  }
}
