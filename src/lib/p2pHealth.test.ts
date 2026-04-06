import { describe, expect, it } from 'vitest';
import { computeP2pHealth } from './p2pHealth';

describe('computeP2pHealth', () => {
  it('bad when no remote hubs or no overlay links', () => {
    expect(
      computeP2pHealth({
        onlineRemoteHubInterfaces: 0,
        p2pOutboundPeers: 2,
        p2pInboundPeers: 2,
      })
    ).toBe('bad');
    expect(
      computeP2pHealth({
        onlineRemoteHubInterfaces: 2,
        p2pOutboundPeers: 0,
        p2pInboundPeers: 0,
      })
    ).toBe('bad');
  });

  it('low when not bad but below good thresholds', () => {
    expect(
      computeP2pHealth({
        onlineRemoteHubInterfaces: 1,
        p2pOutboundPeers: 3,
        p2pInboundPeers: 3,
      })
    ).toBe('low');
    expect(
      computeP2pHealth({
        onlineRemoteHubInterfaces: 2,
        p2pOutboundPeers: 2,
        p2pInboundPeers: 3,
      })
    ).toBe('low');
    expect(
      computeP2pHealth({
        onlineRemoteHubInterfaces: 2,
        p2pOutboundPeers: 3,
        p2pInboundPeers: 2,
      })
    ).toBe('low');
  });

  it('good when at least 2 hubs, 3 outbound overlay peers, 3 inbound overlay peers', () => {
    expect(
      computeP2pHealth({
        onlineRemoteHubInterfaces: 2,
        p2pOutboundPeers: 3,
        p2pInboundPeers: 3,
      })
    ).toBe('good');
    expect(
      computeP2pHealth({
        onlineRemoteHubInterfaces: 3,
        p2pOutboundPeers: 5,
        p2pInboundPeers: 4,
      })
    ).toBe('good');
  });
});
