export type P2pHealthLevel = 'bad' | 'low' | 'good';

/** Remote hubs online + overlay peer counts — used for core popover P2P health and group-call gate. */
export function computeP2pHealth(metrics: {
  onlineRemoteHubInterfaces: number;
  p2pOutboundPeers: number;
  p2pInboundPeers: number;
}): P2pHealthLevel {
  const { onlineRemoteHubInterfaces, p2pOutboundPeers, p2pInboundPeers } = metrics;
  const overlayTotal = p2pOutboundPeers + p2pInboundPeers;
  if (onlineRemoteHubInterfaces === 0 || overlayTotal === 0) {
    return 'bad';
  }
  if (
    onlineRemoteHubInterfaces >= 2 &&
    p2pOutboundPeers >= 3 &&
    p2pInboundPeers >= 3
  ) {
    return 'good';
  }
  return 'low';
}
