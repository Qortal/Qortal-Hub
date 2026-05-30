export type P2pHealthLevel = 'bad' | 'low' | 'good';

/** Remote hubs online + overlay peer counts — used for core popover P2P health and group-call gate. */
export function computeP2pHealth(metrics: {
  onlineRemoteHubInterfaces: number;
  p2pActiveOverlayPeers: number;
}): P2pHealthLevel {
  const { onlineRemoteHubInterfaces, p2pActiveOverlayPeers } = metrics;
  if (onlineRemoteHubInterfaces === 0 || p2pActiveOverlayPeers === 0) {
    return 'bad';
  }
  if (onlineRemoteHubInterfaces >= 2 && p2pActiveOverlayPeers >= 3) {
    return 'good';
  }
  return 'low';
}
