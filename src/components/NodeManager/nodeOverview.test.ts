import { describe, expect, it } from 'vitest';
import Base58Untyped from '../../encryption/Base58';
import { P2P_HEALTH_MIN_RECEIVING_PEERS } from '../../lib/p2pHealth';
import {
  addHeightSample,
  averageBlockSeconds,
  compareCoreVersions,
  defaultListenPort,
  formatAgo,
  formatBytes,
  formatDuration,
  helpTheNetworkChecks,
  mintingSummary,
  parseCoreVersion,
  REACHABLE_AFTER_MS,
  DAY_MS,
  settingBoolean,
  settingNumber,
  signatureAsBase64,
  summarizePeers,
  syncEstimate,
} from './nodeOverview';

// Base58.ts has no types of its own.
const Base58 = Base58Untyped as unknown as {
  encode: (bytes: Uint8Array) => string;
};

const peer = (overrides: Record<string, unknown> = {}) => ({
  direction: 'OUTBOUND',
  handshakeStatus: 'COMPLETED',
  lastBlockSignature: 'sig-100',
  lastHeight: 100,
  lastPing: 100,
  version: 'qortal-6.1.9-abc1234',
  ...overrides,
});

describe('parseCoreVersion', () => {
  it("reads Core's build versions", () => {
    expect(parseCoreVersion('qortal-6.1.9-9d93738')).toEqual([6, 1, 9]);
    expect(parseCoreVersion('v6.1.10')).toEqual([6, 1, 10]);
    expect(parseCoreVersion(' 7.0.0 ')).toEqual([7, 0, 0]);
  });

  it('gives null for anything else', () => {
    expect(parseCoreVersion('qortal-six')).toBeNull();
    expect(parseCoreVersion('6.1')).toBeNull();
    expect(parseCoreVersion(undefined)).toBeNull();
    expect(parseCoreVersion(619)).toBeNull();
  });

  it('compares by number, not by text', () => {
    expect(compareCoreVersions([6, 1, 10], [6, 1, 9])).toBeGreaterThan(0);
    expect(compareCoreVersions([6, 2, 0], [6, 10, 0])).toBeLessThan(0);
    expect(compareCoreVersions([6, 1, 9], [6, 1, 9])).toBe(0);
  });
});

describe('summarizePeers', () => {
  it('counts directions, and peers still shaking hands apart', () => {
    const summary = summarizePeers([
      peer(),
      peer({ direction: 'INBOUND' }),
      peer({ handshakeStatus: 'STARTED', lastHeight: 999, version: '9.0.0' }),
      peer({ direction: 'INBOUND', handshakeStatus: 'STARTED' }),
    ]);
    expect(summary.total).toBe(4);
    // Like Core's own count: connected once done shaking hands.
    expect(summary.inbound).toBe(1);
    expect(summary.outbound).toBe(1);
    expect(summary.connecting).toBe(2);
    // A peer still connecting says nothing about heights or versions.
    expect(summary.highestHeight).toBe(100);
    expect(summary.versions).toEqual([{ count: 2, version: '6.1.9' }]);
  });

  it('lists versions by how many run them, then the newest', () => {
    const summary = summarizePeers([
      peer({ version: 'qortal-6.1.8-a' }),
      peer({ version: 'qortal-6.2.0-b' }),
      peer({ version: 'qortal-6.1.8-c' }),
      peer({ version: 'qortal-6.1.9-d' }),
    ]);
    expect(summary.versions).toEqual([
      { count: 2, version: '6.1.8' },
      { count: 1, version: '6.2.0' },
      { count: 1, version: '6.1.9' },
    ]);
  });

  it('says which newer Core peers run, compared with ours', () => {
    const peers = [
      peer({ version: 'qortal-6.1.9-a' }),
      peer({ version: 'qortal-6.2.0-b' }),
      peer({ version: 'qortal-6.1.10-c' }),
    ];
    expect(summarizePeers(peers, { version: 'qortal-6.1.9-x' }).newer).toEqual({
      count: 2,
      highest: '6.2.0',
    });
    expect(summarizePeers(peers, { version: 'qortal-6.2.0-x' }).newer).toEqual({
      count: 0,
      highest: '6.2.0',
    });
    // Without our own version, it can't be told.
    expect(summarizePeers(peers).newer).toBeNull();
  });

  it('places peers ahead, level and behind, and compares the last block', () => {
    const summary = summarizePeers(
      [
        peer({ lastHeight: 101 }),
        peer(),
        peer({ lastBlockSignature: 'other' }),
        peer({ lastHeight: 99 }),
      ],
      { height: 100, lastBlockSignature: 'sig-100' }
    );
    expect(summary.ahead).toBe(1);
    expect(summary.same).toBe(2);
    expect(summary.behind).toBe(1);
    expect(summary.highestHeight).toBe(101);
    expect(summary.sameHeight).toEqual({ agreeing: 1, total: 2 });
  });

  it('gives no agreement without our last block', () => {
    expect(summarizePeers([peer()], { height: 100 }).sameHeight).toBeNull();
  });

  it('takes the middle ping and counts far-off chains', () => {
    const summary = summarizePeers([
      peer({ lastPing: 10 }),
      peer({ isTooDivergent: true, lastPing: 300 }),
      peer({ lastPing: 50 }),
      peer({ lastPing: 'slow' }),
    ]);
    expect(summary.medianPingMs).toBe(50);
    expect(summary.tooDivergent).toBe(1);
  });

  it('copes with an answer that is not a list', () => {
    const summary = summarizePeers({ error: 1 });
    expect(summary.total).toBe(0);
    expect(summary.versions).toEqual([]);
    expect(summary.medianPingMs).toBeNull();
    expect(summary.highestHeight).toBeNull();
  });
});

describe('signatureAsBase64', () => {
  it("writes a block's base58 signature the way /peers writes peers'", () => {
    const bytes = Uint8Array.from({ length: 128 }, (_, i) => (i * 7) % 256);
    const base64 = btoa(String.fromCharCode(...bytes));
    expect(signatureAsBase64(Base58.encode(bytes))).toBe(base64);
  });

  it('gives null for what is not base58', () => {
    expect(signatureAsBase64('not base58: 0OIl')).toBeNull();
    expect(signatureAsBase64('')).toBeNull();
    expect(signatureAsBase64(undefined)).toBeNull();
  });
});

describe('sync speed', () => {
  it('keeps one sample per height, and starts over after a lower one', () => {
    let samples = addHeightSample([], { at: 0, height: 10 });
    samples = addHeightSample(samples, { at: 1_000, height: 10 });
    expect(samples).toHaveLength(1);
    samples = addHeightSample(samples, { at: 2_000, height: 20 });
    expect(samples).toHaveLength(2);
    samples = addHeightSample(samples, { at: 3_000, height: 5 });
    expect(samples).toEqual([{ at: 3_000, height: 5 }]);
  });

  it('drops samples older than the window', () => {
    let samples = addHeightSample([], { at: 0, height: 1 }, 60_000);
    samples = addHeightSample(samples, { at: 50_000, height: 2 }, 60_000);
    samples = addHeightSample(samples, { at: 70_000, height: 3 }, 60_000);
    expect(samples.map((sample) => sample.height)).toEqual([2, 3]);
  });

  it('tells blocks a minute and the time left, once there is enough', () => {
    const samples = [
      { at: 0, height: 1000 },
      { at: 120_000, height: 1600 },
    ];
    expect(syncEstimate(samples, 4600)).toEqual({
      blocksPerMinute: 300,
      minutesLeft: 10,
    });
    // Caught up: no time left to tell.
    expect(syncEstimate(samples, 1600)?.minutesLeft).toBeNull();
  });

  it('says nothing from one sample or a few seconds', () => {
    expect(syncEstimate([{ at: 0, height: 1 }], 10)).toBeNull();
    expect(
      syncEstimate(
        [
          { at: 0, height: 1 },
          { at: 5_000, height: 50 },
        ],
        100
      )
    ).toBeNull();
  });
});

describe('averageBlockSeconds', () => {
  it('divides the time by the blocks between', () => {
    expect(
      averageBlockSeconds(
        { height: 2440, timestamp: 1_000_000 + 1440 * 61_000 },
        { height: 1000, timestamp: 1_000_000 }
      )
    ).toBeCloseTo(61);
  });

  it('gives null when the blocks can not be compared', () => {
    expect(averageBlockSeconds(null, { height: 1, timestamp: 1 })).toBeNull();
    expect(
      averageBlockSeconds(
        { height: 5, timestamp: 9 },
        { height: 5, timestamp: 1 }
      )
    ).toBeNull();
  });
});

describe('mintingSummary', () => {
  const base = {
    isMintingPossible: false,
    isPublic: false,
    isSynchronizing: false,
    keyCount: 0,
    syncPercent: 100,
  };

  it('puts the public node first', () => {
    expect(
      mintingSummary({ ...base, isMintingPossible: true, isPublic: true })
    ).toBe('public');
  });

  it('says minting, or why not', () => {
    expect(mintingSummary({ ...base, isMintingPossible: true })).toBe(
      'minting'
    );
    expect(
      mintingSummary({ ...base, isSynchronizing: true, syncPercent: 80 })
    ).toBe('syncing');
    expect(mintingSummary(base)).toBe('no_key');
    expect(mintingSummary({ ...base, keyCount: 1 })).toBe('key_not_minting');
  });

  it("doesn't take an unread key list for no key", () => {
    expect(mintingSummary({ ...base, keyCount: null })).toBe('unknown');
  });
});

describe('helpTheNetworkChecks', () => {
  const states = (input: Parameters<typeof helpTheNetworkChecks>[0]) =>
    Object.fromEntries(
      helpTheNetworkChecks(input).map(({ id, state }) => [id, state])
    );

  it('marks each check done, to do, or not known', () => {
    expect(
      states({
        dataPeers: 4,
        inbound: 3,
        isMintingPossible: true,
        newerPeers: 0,
        relayMode: true,
        uptimeMs: DAY_MS,
      })
    ).toEqual({
      data_peers: 'ok',
      minting: 'ok',
      reachable: 'ok',
      relay: 'ok',
      up_to_date: 'ok',
      uptime: 'ok',
    });
    expect(
      states({
        dataPeers: 0,
        inbound: 0,
        isMintingPossible: false,
        newerPeers: 3,
        relayMode: false,
        uptimeMs: DAY_MS - 1,
      })
    ).toEqual({
      data_peers: 'todo',
      minting: 'todo',
      reachable: 'todo',
      relay: 'todo',
      up_to_date: 'todo',
      uptime: 'todo',
    });
    expect(
      states({
        dataPeers: null,
        inbound: null,
        isMintingPossible: null,
        newerPeers: null,
        relayMode: null,
        uptimeMs: null,
      })
    ).toEqual({
      data_peers: 'unknown',
      minting: 'unknown',
      reachable: 'unknown',
      relay: 'unknown',
      up_to_date: 'unknown',
      uptime: 'unknown',
    });
  });

  it('waits an hour before no inbound peer counts against the node', () => {
    const reachable = (uptimeMs: number) =>
      states({
        dataPeers: 1,
        inbound: 0,
        isMintingPossible: true,
        newerPeers: 0,
        relayMode: true,
        uptimeMs,
      }).reachable;
    expect(reachable(REACHABLE_AFTER_MS - 1)).toBe('unknown');
    expect(reachable(REACHABLE_AFTER_MS)).toBe('todo');
  });
});

describe('settings answers', () => {
  it('reads true and false, else null', () => {
    expect(settingBoolean('true')).toBe(true);
    expect(settingBoolean(' false\n')).toBe(false);
    expect(settingBoolean('null')).toBeNull();
    expect(settingBoolean(undefined)).toBeNull();
  });

  it('reads whole numbers, else null', () => {
    expect(settingNumber('64')).toBe(64);
    expect(settingNumber('null')).toBeNull();
    expect(settingNumber('1.5')).toBeNull();
    expect(settingNumber('')).toBeNull();
  });

  it("knows Core's own P2P ports", () => {
    expect(defaultListenPort(false)).toBe(12392);
    expect(defaultListenPort(undefined)).toBe(12392);
    expect(defaultListenPort(true)).toBe(62392);
  });
});

describe('formatting', () => {
  it('gives the two largest units of a duration', () => {
    expect(formatDuration(((3 * 24 + 4) * 3600 + 120) * 1000, 'en')).toBe(
      '3d 4h'
    );
    expect(formatDuration(12 * 60_000 + 5_000, 'en')).toBe('12m');
    expect(formatDuration(40_000, 'en')).toBe('40s');
  });

  it("says how long ago, never in the future when the node's clock is ahead", () => {
    const now = 1_000_000;
    expect(formatAgo(now - 34_000, 'en', now)).toBe('34 seconds ago');
    expect(formatAgo(now - 5 * 60_000, 'en', now)).toBe('5 minutes ago');
    expect(formatAgo(now + 4_000, 'en', now)).toBe('now');
  });

  it('gives sizes in their units', () => {
    expect(formatBytes(3_500_000_000, 'en')).toBe('3.5 GB');
    expect(formatBytes(28_756_148_224, 'en')).toBe('29 GB');
    expect(formatBytes(900, 'en')).toBe('900 byte');
  });

  it("matches the P2P health rule's words: one peer is enough", () => {
    // health_rule says "at least one peer": keep the text true.
    expect(P2P_HEALTH_MIN_RECEIVING_PEERS).toBe(1);
  });
});
