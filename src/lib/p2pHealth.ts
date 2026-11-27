export type P2pHealthLevel = 'bad' | 'low' | 'good';

export const P2P_HEALTH_MIN_RECEIVING_PEERS = 1;
export const P2P_HEALTH_RECEIVING_STABLE_MS = 30_000;

/** Receiving overlay peers - used for core popover P2P health and call gates. */
export function computeP2pHealth(metrics: {
  onlineRemoteHubInterfaces: number;
  p2pReceivingOverlayPeers?: number;
  p2pReceivingOverlayPeersStableMs?: number;
  p2pActiveOverlayPeers?: number;
  p2pOutboundOverlayPeers?: number;
  p2pInboundOverlayPeers?: number;
}): P2pHealthLevel {
  const { p2pReceivingOverlayPeers = 0, p2pReceivingOverlayPeersStableMs = 0 } =
    metrics;
  if (p2pReceivingOverlayPeers === 0) {
    return 'bad';
  }
  if (
    p2pReceivingOverlayPeers >= P2P_HEALTH_MIN_RECEIVING_PEERS &&
    p2pReceivingOverlayPeersStableMs >= P2P_HEALTH_RECEIVING_STABLE_MS
  ) {
    return 'good';
  }
  return 'low';
}
