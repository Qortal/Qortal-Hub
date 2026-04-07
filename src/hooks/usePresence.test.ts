import { describe, expect, it } from 'vitest';
import { buildPresenceSnapshot } from './usePresence';

describe('buildPresenceSnapshot', () => {
  it('uses the newest session status when an address has multiple live sessions', () => {
    const snapshot = buildPresenceSnapshot([
      {
        address: 'Q123',
        publicKey: 'pub-1',
        sessionId: 'session-busy',
        lastSeen: 1_000,
        firstSeen: 900,
        originNodeId: 'node-a',
        viaPeerId: 'node-a',
        status: 'busy',
        signatureValid: true,
      },
      {
        address: 'Q123',
        publicKey: 'pub-2',
        sessionId: 'session-online',
        lastSeen: 2_000,
        firstSeen: 1_900,
        originNodeId: 'node-b',
        viaPeerId: 'node-b',
        status: 'online',
        signatureValid: true,
      },
      {
        address: 'Q456',
        publicKey: 'pub-3',
        sessionId: 'session-away',
        lastSeen: 1_500,
        firstSeen: 1_400,
        originNodeId: 'node-c',
        viaPeerId: 'node-c',
        status: 'away',
        signatureValid: true,
      },
    ]);

    expect(snapshot.onlineAddresses).toEqual(new Set(['Q123', 'Q456']));
    expect(snapshot.statusMap).toEqual(
      new Map([
        ['Q123', 'online'],
        ['Q456', 'away'],
      ])
    );
  });
});
