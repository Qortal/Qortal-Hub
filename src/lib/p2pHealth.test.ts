import { describe, expect, it } from 'vitest';
import { computeP2pHealth } from './p2pHealth';

describe('computeP2pHealth', () => {
  it('bad when no remote hubs or no active overlay peers', () => {
    expect(
      computeP2pHealth({
        onlineRemoteHubInterfaces: 0,
        p2pActiveOverlayPeers: 2,
      })
    ).toBe('bad');
    expect(
      computeP2pHealth({
        onlineRemoteHubInterfaces: 2,
        p2pActiveOverlayPeers: 0,
      })
    ).toBe('bad');
  });

  it('low when not bad but below good thresholds', () => {
    expect(
      computeP2pHealth({
        onlineRemoteHubInterfaces: 1,
        p2pActiveOverlayPeers: 3,
      })
    ).toBe('low');
    expect(
      computeP2pHealth({
        onlineRemoteHubInterfaces: 2,
        p2pActiveOverlayPeers: 2,
      })
    ).toBe('low');
  });

  it('good when at least 2 hubs and 3 active overlay peers', () => {
    expect(
      computeP2pHealth({
        onlineRemoteHubInterfaces: 2,
        p2pActiveOverlayPeers: 3,
      })
    ).toBe('good');
    expect(
      computeP2pHealth({
        onlineRemoteHubInterfaces: 3,
        p2pActiveOverlayPeers: 5,
      })
    ).toBe('good');
  });
});
