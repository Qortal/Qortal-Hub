export type P2pHealthLevel = 'bad' | 'low' | 'good';

/** Remote hubs online + overlay peer counts — used for core popover P2P health and group-call gate. */
export function computeP2pHealth(metrics: {
  onlineRemoteHubInterfaces: number;
  p2pActiveOverlayPeers?: number;
  p2pOutboundOverlayPeers?: number;
  p2pInboundOverlayPeers?: number;
}): P2pHealthLevel {
  const {
    onlineRemoteHubInterfaces,
    p2pActiveOverlayPeers = 0,
    p2pOutboundOverlayPeers,
    p2pInboundOverlayPeers,
  } = metrics;
  const outboundPeers = p2pOutboundOverlayPeers ?? p2pActiveOverlayPeers;
  const inboundPeers = p2pInboundOverlayPeers ?? p2pActiveOverlayPeers;
  const sendablePeers =
    p2pOutboundOverlayPeers !== undefined || p2pInboundOverlayPeers !== undefined
      ? outboundPeers + inboundPeers
      : p2pActiveOverlayPeers;
  if (
    onlineRemoteHubInterfaces === 0 ||
    sendablePeers === 0 ||
    inboundPeers === 0
  ) {
    return 'bad';
  }
  if (onlineRemoteHubInterfaces >= 2 && sendablePeers >= 2 && inboundPeers >= 2) {
    return 'good';
  }
  return 'low';
}
