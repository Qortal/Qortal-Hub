import { describe, expect, it } from 'vitest';
import { computeP2pHealth } from './p2pHealth';

describe('computeP2pHealth', () => {
  it('bad when no remote hubs or no active overlay peers', () => {
    expect(
      computeP2pHealth({
        onlineRemoteHubInterfaces: 0,
        p2pOutboundOverlayPeers: 2,
        p2pInboundOverlayPeers: 2,
      })
    ).toBe('bad');
    expect(
      computeP2pHealth({
        onlineRemoteHubInterfaces: 2,
        p2pOutboundOverlayPeers: 0,
        p2pInboundOverlayPeers: 2,
      })
    ).toBe('bad');
    expect(
      computeP2pHealth({
        onlineRemoteHubInterfaces: 2,
        p2pOutboundOverlayPeers: 2,
        p2pInboundOverlayPeers: 0,
      })
    ).toBe('bad');
  });

  it('low when not bad but below good thresholds', () => {
    expect(
      computeP2pHealth({
        onlineRemoteHubInterfaces: 1,
        p2pOutboundOverlayPeers: 2,
        p2pInboundOverlayPeers: 2,
      })
    ).toBe('low');
    expect(
      computeP2pHealth({
        onlineRemoteHubInterfaces: 2,
        p2pOutboundOverlayPeers: 1,
        p2pInboundOverlayPeers: 2,
      })
    ).toBe('low');
    expect(
      computeP2pHealth({
        onlineRemoteHubInterfaces: 2,
        p2pOutboundOverlayPeers: 2,
        p2pInboundOverlayPeers: 1,
      })
    ).toBe('low');
  });

  it('good when at least 2 hubs, 2 outbound peers, and 2 inbound peers', () => {
    expect(
      computeP2pHealth({
        onlineRemoteHubInterfaces: 2,
        p2pOutboundOverlayPeers: 2,
        p2pInboundOverlayPeers: 2,
      })
    ).toBe('good');
    expect(
      computeP2pHealth({
        onlineRemoteHubInterfaces: 3,
        p2pOutboundOverlayPeers: 5,
        p2pInboundOverlayPeers: 4,
      })
    ).toBe('good');
  });

  it('falls back to active overlay peers when directional counts are absent', () => {
    expect(
      computeP2pHealth({
        onlineRemoteHubInterfaces: 2,
        p2pActiveOverlayPeers: 2,
      })
    ).toBe('good');
  });
});
