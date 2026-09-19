import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import dgram from 'node:dgram';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PrivateChannelManager,
  type PrivateTransportContext,
} from './private-channel-manager';
import {
  privateBootstrapOwnerBindingHash,
  validatePrivateBootstrapDescriptor,
  type PrivateBootstrapDescriptor,
  type PrivateChannelBootstrapProvider,
} from './private-channel-bootstrap';
import {
  PrivateTransportSidecar,
  type PrivateSessionConfig,
  type PrivateTransportSidecarEvent,
} from './private-transport-sidecar';
import { QuicMasqueTransport } from './quic-masque-transport';

type Startup = PrivateSessionConfig & {
  expiresAt: number;
  backendRnsDestination: string;
  transport: 'quic-masque-inner-v1';
};
type Stats = {
  receiveBuffers: Record<string, number>;
  backendSource: string;
  relayEgress: string;
  reliableCount: number;
  datagramCount: number;
  tokenUsed: boolean;
};

const goBinary = process.env.QORTAL_GO_BINARY || 'go';
const goAvailable =
  spawnSync(goBinary, ['version'], { windowsHide: true }).status === 0;
const integration = goAvailable ? describe.sequential : describe.skip;
let tempDir = '';
let sidecarBinary = '';
let fixtureBinary = '';

class Fixture {
  readonly child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private lines: string[] = [];
  private waiters: Array<(line: string) => void> = [];
  constructor(wrongAlpn = false, bulk = false, ackOnly = false) {
    this.child = spawn(fixtureBinary, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        QORTAL_STEP3_TEST_WRONG_ALPN: wrongAlpn ? '1' : '0',
        QORTAL_STEP3_TEST_BULK: bulk ? '1' : '0',
        QORTAL_STEP3_TEST_ACK_ONLY: ackOnly ? '1' : '0',
      },
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.resume();
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      for (;;) {
        const nl = this.buffer.indexOf('\n');
        if (nl < 0) return;
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        const waiter = this.waiters.shift();
        if (waiter) waiter(line);
        else this.lines.push(line);
      }
    });
  }
  next<T>(): Promise<T> {
    const line = this.lines.shift();
    if (line !== undefined) return Promise.resolve(JSON.parse(line));
    return new Promise((resolve) =>
      this.waiters.push((value) => resolve(JSON.parse(value)))
    );
  }
  async command<T>(operation: string): Promise<T> {
    this.child.stdin.write(`${JSON.stringify({ operation })}\n`);
    return this.next<T>();
  }
  async close() {
    if (this.child.exitCode !== null) return;
    await this.command('shutdown').catch(() => undefined);
    this.child.kill();
  }
}

integration('Step 3 inner QUIC through MASQUE', () => {
  it.runIf(process.env.QORTAL_BULK_BENCH === '1').each([0, 60])(
    'diagnoses binary upload over MASQUE with %i ms one-way simulated delay',
    async (delay) => {
      const fixture = new Fixture(false, true, true);
      const config = await fixture.next<Startup>();
      const targetPort = Number(config.relayAddress.split(':').at(-1));
      const proxy = dgram.createSocket('udp4');
      await new Promise<void>((r) => proxy.bind(0, '127.0.0.1', r));
      proxy.setRecvBufferSize(8 * 1024 * 1024);
      let clientPort = 0,
        dropped = 0,
        next = 0,
        acknowledgements = 0;
      const timers = new Set<ReturnType<typeof setTimeout>>();
      proxy.on('message', (data, peer) => {
        const fromRelay = peer.port === targetPort;
        if (!fromRelay) clientPort = peer.port;
        const port = fromRelay ? clientPort : targetPort;
        if (!port || timers.size >= 8192) {
          dropped++;
          return;
        }
        const timer = setTimeout(() => {
          timers.delete(timer);
          proxy.send(data, port, '127.0.0.1');
        }, delay);
        timers.add(timer);
      });
      const sidecar = new PrivateTransportSidecar({ command: sidecarBinary });
      let realtimeTimer: ReturnType<typeof setInterval> | undefined;
      try {
        await sidecar.start();
        const opened = await sidecar.openPrivateSession({
          ...sessionConfig(config),
          relayAddress: `127.0.0.1:${(proxy.address() as import('node:net').AddressInfo).port}`,
        });
        const count = process.env.QORTAL_BULK_BENCH_LARGE === '1' ? 256 : 64,
          payload = Buffer.alloc(524886, 42);
        let resolveAll!: () => void;
        const all = new Promise<void>((r) => {
          resolveAll = r;
        });
        const realtimePending = new Map<string, number>();
        const realtimeRtts: number[] = [];
        let realtimeSent = 0;
        sidecar.on('event', (e: PrivateTransportSidecarEvent) => {
          const sent = realtimePending.get(e.messageId);
          if (sent !== undefined) {
            realtimeRtts.push(performance.now() - sent);
            realtimePending.delete(e.messageId);
          }
          if (
            e.sessionId === opened.sessionId &&
            e.event === 'reliableMessage' &&
            ++acknowledgements === count
          )
            resolveAll();
        });
        const start = performance.now();
        realtimeTimer = setInterval(() => {
          for (const [id, at] of realtimePending)
            if (performance.now() - at > 2000) realtimePending.delete(id);
          if (realtimePending.size >= 64) return;
          const id = `live-${realtimeSent++}`;
          realtimePending.set(id, performance.now());
          void sidecar
            .sendPrivateDatagram(opened.sessionId, id, Buffer.alloc(160))
            .catch(() => realtimePending.delete(id));
        }, 20);
        await Promise.all(
          Array.from({ length: 2 }, async () => {
            while (next < count) {
              const i = next++;
              await sidecar.sendPrivateReliable(
                opened.sessionId,
                `bench-${i}`,
                payload,
                'bulk'
              );
            }
          })
        );
        await all;
        clearInterval(realtimeTimer);
        const seconds = (performance.now() - start) / 1000;
        await new Promise((r) => setTimeout(r, 400));
        realtimeRtts.sort((a, b) => a - b);
        const p95 = realtimeRtts[Math.floor(realtimeRtts.length * 0.95)];
        console.info('[BulkPathBenchmark]', {
          delay,
          bytes: count * payload.length,
          seconds,
          proxyDrops: dropped,
          receiveBuffers: (await fixture.command<Stats>('stats'))
            .receiveBuffers,
          realtimeSent,
          realtimeReceived: realtimeRtts.length,
          realtimeP95Millis: p95,
          metrics: await sidecar.sessionMetrics(opened.sessionId),
        });
        expect(dropped).toBe(0);
        expect(acknowledgements).toBe(count);
        expect(realtimeRtts.length).toBeGreaterThan(0);
        expect(realtimeRtts.length / realtimeSent).toBeGreaterThanOrEqual(0.95);
        expect(p95).toBeLessThan(500);
      } finally {
        clearInterval(realtimeTimer);
        await sidecar.shutdown();
        timers.forEach(clearTimeout);
        proxy.close();
        await fixture.close();
      }
    },
    120000
  );
  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-step3-test-'));
    sidecarBinary = path.join(tempDir, 'sidecar');
    fixtureBinary = path.join(tempDir, 'fixture');
    const root = path.join(
      process.cwd(),
      'electron',
      'native',
      'private-transport'
    );
    for (const [output, pkg] of [
      [sidecarBinary, './cmd/qortal-private-transport'],
      [fixtureBinary, './cmd/qortal-private-transport-step3-fixture'],
    ]) {
      const result = spawnSync(
        goBinary,
        ['build', '-trimpath', '-o', output, pkg],
        { cwd: root, encoding: 'utf8' }
      );
      if (result.status !== 0)
        throw new Error(result.stderr || result.error?.message);
    }
  }, 60_000);
  afterAll(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('establishes, attaches, and carries ordered streams plus QUIC datagrams', async () => {
    const fixture = new Fixture();
    const config = await fixture.next<Startup>();
    const sidecar = new PrivateTransportSidecar({ command: sidecarBinary });
    await sidecar.start();
    const started = Date.now();
    const opened = await sidecar.openPrivateSession(sessionConfig(config));
    const handshakeMs = Date.now() - started;
    const events: PrivateTransportSidecarEvent[] = [];
    const received = new Promise<void>((resolve) =>
      sidecar.on('event', (event: PrivateTransportSidecarEvent) => {
        if (event.sessionId === opened.sessionId) {
          events.push(event);
          if (events.length === 3) resolve();
        }
      })
    );
    const rttStart = Date.now();
    await Promise.all([
      sidecar.sendPrivateReliable(
        opened.sessionId,
        'r1',
        Buffer.from('reliable-one')
      ),
      sidecar.sendPrivateReliable(
        opened.sessionId,
        'r2',
        Buffer.from('reliable-two')
      ),
      sidecar.sendPrivateDatagram(
        opened.sessionId,
        'd1',
        Buffer.from('datagram-one')
      ),
    ]);
    await received;
    const applicationRttMs = Date.now() - rttStart;
    expect(
      events
        .filter((e) => e.event === 'reliableMessage')
        .map((e) => e.messageId)
    ).toEqual(['r1', 'r2']);
    expect(events.find((e) => e.messageId === 'r1')?.data.toString()).toBe(
      'reliable-one'
    );
    expect(events.find((e) => e.messageId === 'd1')?.event).toBe('datagram');
    const stats = await fixture.command<Stats>('stats');
    expect(stats.backendSource).toBe(stats.relayEgress);
    expect(stats.tokenUsed).toBe(true);
    const metrics = await sidecar.sessionMetrics(opened.sessionId);
    expect(metrics.bytesSent).toBeGreaterThan(0);
    expect(metrics.bytesReceived).toBeGreaterThan(0);
    expect({
      handshakeMs,
      applicationRttMs,
      innerRttMs: metrics.innerRttMillis,
    }).toEqual(
      expect.objectContaining({
        handshakeMs: expect.any(Number),
        applicationRttMs: expect.any(Number),
        innerRttMs: expect.any(Number),
      })
    );
    await sidecar.closePrivateSession(opened.sessionId);
    await sidecar.shutdown();
    await fixture.close();
  }, 20_000);

  it('carries a large opaque binary message through IPC and MASQUE on a keyed stream', async () => {
    const fixture = new Fixture(false, true);
    const config = await fixture.next<Startup>();
    const sidecar = new PrivateTransportSidecar({ command: sidecarBinary });
    try {
      await sidecar.start();
      const opened = await sidecar.openPrivateSession(sessionConfig(config));
      const payload = Buffer.alloc(525000);
      for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
      const received = new Promise<PrivateTransportSidecarEvent>((resolve) => {
        sidecar.on('event', (event: PrivateTransportSidecarEvent) => {
          if (
            event.sessionId === opened.sessionId &&
            event.messageId === 'bulk'
          )
            resolve(event);
        });
      });
      await sidecar.sendPrivateReliable(
        opened.sessionId,
        'bulk',
        payload,
        'opaque-bulk',
        true
      );
      expect((await received).data.equals(payload)).toBe(true);
      const stats = await fixture.command<Stats>('stats');
      expect(stats.backendSource).toBe(stats.relayEgress);
      expect(stats.reliableCount).toBe(1);
      const metrics = await sidecar.sessionMetrics(opened.sessionId);
      expect(metrics.innerPacketsSent).toBeGreaterThan(0);
      expect(metrics.outerPacketsSent).toBeGreaterThan(0);
      expect(metrics.innerWireBytesSent).toBeGreaterThan(payload.length);
      expect(metrics.outerWireBytesSent).toBeGreaterThan(payload.length);
      expect(metrics.tunnelWrites).toBeGreaterThan(0);
      expect(metrics.tunnelWriteMicros).toBeGreaterThan(0);
      expect(metrics.tunnelWriteErrors).toBe(0);
      expect(metrics.innerPacketsLost).toBeGreaterThanOrEqual(0);
      expect(metrics.outerPacketsLost).toBeGreaterThanOrEqual(0);
    } finally {
      await sidecar.shutdown();
      await fixture.close();
    }
  }, 20_000);

  it('fails closed on backend identity mismatch before attach', async () => {
    const fixture = new Fixture();
    const config = await fixture.next<Startup>();
    const sidecar = new PrivateTransportSidecar({ command: sidecarBinary });
    await sidecar.start();
    await expect(
      sidecar.openPrivateSession({
        ...sessionConfig(config),
        backendCertSha256: '00'.repeat(32),
      })
    ).rejects.toMatchObject({ code: 'BACKEND_IDENTITY_MISMATCH' });
    expect((await fixture.command<Stats>('stats')).tokenUsed).toBe(false);
    await sidecar.shutdown();
    await fixture.close();
  }, 20_000);
  it('rejects a wrong attach token and a reused valid token', async () => {
    const fixture = new Fixture();
    const config = await fixture.next<Startup>();
    const sidecar = new PrivateTransportSidecar({ command: sidecarBinary });
    await sidecar.start();
    await expect(
      sidecar.openPrivateSession({
        ...sessionConfig(config),
        attachToken: 'wrong-token',
      })
    ).rejects.toMatchObject({ code: 'ATTACH_TOKEN_REJECTED' });
    const opened = await sidecar.openPrivateSession(sessionConfig(config));
    await sidecar.closePrivateSession(opened.sessionId);
    await expect(
      sidecar.openPrivateSession(sessionConfig(config))
    ).rejects.toMatchObject({ code: 'ATTACH_TOKEN_REJECTED' });
    await sidecar.shutdown();
    await fixture.close();
  }, 20_000);
  it('rejects unsupported ALPN', async () => {
    const fixture = new Fixture(true);
    const config = await fixture.next<Startup>();
    const sidecar = new PrivateTransportSidecar({ command: sidecarBinary });
    await sidecar.start();
    await expect(
      sidecar.openPrivateSession(sessionConfig(config))
    ).rejects.toMatchObject({ code: 'INNER_QUIC_FAILED' });
    await sidecar.shutdown();
    await fixture.close();
  }, 20_000);
  it('keeps reliable delivery working when an application datagram is dropped', async () => {
    const fixture = new Fixture();
    const config = await fixture.next<Startup>();
    const sidecar = new PrivateTransportSidecar({ command: sidecarBinary });
    await sidecar.start();
    const opened = await sidecar.openPrivateSession(sessionConfig(config));
    await fixture.command('dropNextDatagram');
    const reliable = new Promise<PrivateTransportSidecarEvent>((resolve) =>
      sidecar.on('event', (e: PrivateTransportSidecarEvent) => {
        if (e.messageId === 'survives') resolve(e);
      })
    );
    await sidecar.sendPrivateDatagram(
      opened.sessionId,
      'lost',
      Buffer.from('drop-me')
    );
    await sidecar.sendPrivateReliable(
      opened.sessionId,
      'survives',
      Buffer.from('still-reliable')
    );
    expect((await reliable).data.toString()).toBe('still-reliable');
    await expect(
      sidecar.sendPrivateDatagram(
        opened.sessionId,
        'oversized',
        Buffer.alloc(1025)
      )
    ).rejects.toMatchObject({ code: 'FRAME_TOO_LARGE' });
    await sidecar.shutdown();
    await fixture.close();
  }, 20_000);

  it('maps the transport through opaque PrivateChannelManager handles', async () => {
    const fixture = new Fixture();
    const config = await fixture.next<Startup>();
    const sidecar = new PrivateTransportSidecar({ command: sidecarBinary });
    const descriptor = descriptorFrom(config);
    const provider: PrivateChannelBootstrapProvider = {
      getBootstrap: async () => descriptor,
    };
    const manager = new PrivateChannelManager(
      () => 'owned',
      (emit) => new QuicMasqueTransport(emit, sidecar, config, provider)
    );
    const owner = { tabId: 'tab-step3', name: 'test-app', service: 'APP' };
    const opened = await manager.open(owner, 'rns-owned', 'realtime');
    expect(opened.channelId).toMatch(/^private-/);
    const messages: unknown[] = [];
    manager.on('event', (event) => {
      if (event.action === 'PRIVATE_CHANNEL_MESSAGE') messages.push(event);
    });
    await Promise.all([
      manager.send(owner, opened.channelId, 'reliable', 'm1', {
        lane: 'reliable',
      }),
      manager.send(owner, opened.channelId, 'datagram', 'm2', {
        lane: 'datagram',
      }),
    ]);
    for (let i = 0; i < 50 && messages.length < 2; i++)
      await new Promise((r) => setTimeout(r, 20));
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageId: 'm1', lane: 'reliable' }),
        expect.objectContaining({ messageId: 'm2', lane: 'datagram' }),
      ])
    );
    await manager.close(owner, opened.channelId);
    await sidecar.shutdown();
    await fixture.close();
  }, 20_000);

  it('closes the affected logical channel when the sidecar dies', async () => {
    const fixture = new Fixture();
    const config = await fixture.next<Startup>();
    const sidecar = new PrivateTransportSidecar({ command: sidecarBinary });
    const provider: PrivateChannelBootstrapProvider = {
      getBootstrap: async () => descriptorFrom(config),
    };
    const manager = new PrivateChannelManager(
      () => 'owned',
      (emit) => new QuicMasqueTransport(emit, sidecar, config, provider)
    );
    const owner = { tabId: 'tab-death', name: 'test-app', service: 'APP' };
    const opened = await manager.open(owner, 'rns-owned', 'realtime');
    const closed = new Promise<void>((resolve) =>
      manager.on('event', (event) => {
        if (
          event.channelId === opened.channelId &&
          event.action === 'PRIVATE_CHANNEL_STATE' &&
          event.state === 'CLOSED'
        )
          resolve();
      })
    );
    sidecar.terminateForTest();
    await closed;
    expect(manager.status(owner, opened.channelId).state).toBe('CLOSED');
    await fixture.close();
  }, 20_000);

  it('fails the active connection when the relay dies without a direct fallback', async () => {
    const fixture = new Fixture();
    const config = await fixture.next<Startup>();
    const sidecar = new PrivateTransportSidecar({ command: sidecarBinary });
    await sidecar.start();
    const opened = await sidecar.openPrivateSession(sessionConfig(config));
    const failed = new Promise<PrivateTransportSidecarEvent>((resolve) =>
      sidecar.on('event', (event: PrivateTransportSidecarEvent) => {
        if (event.sessionId === opened.sessionId && event.event === 'error')
          resolve(event);
      })
    );
    await fixture.command('stopRelay');
    expect(
      (
        (await Promise.race([
          failed,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('relay death timeout')), 3000)
          ),
        ])) as PrivateTransportSidecarEvent
      ).code
    ).toBeTruthy();
    await sidecar.shutdown();
    await fixture.close();
  }, 20_000);

  it('propagates backend death as a clean transport error', async () => {
    const fixture = new Fixture();
    const config = await fixture.next<Startup>();
    const sidecar = new PrivateTransportSidecar({ command: sidecarBinary });
    await sidecar.start();
    const opened = await sidecar.openPrivateSession(sessionConfig(config));
    const failed = new Promise<PrivateTransportSidecarEvent>((resolve) =>
      sidecar.on('event', (event: PrivateTransportSidecarEvent) => {
        if (event.sessionId === opened.sessionId && event.event === 'error')
          resolve(event);
      })
    );
    await fixture.command('stopBackend');
    expect(
      (
        (await Promise.race([
          failed,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('backend death timeout')), 3000)
          ),
        ])) as PrivateTransportSidecarEvent
      ).code
    ).toBeTruthy();
    await sidecar.shutdown();
    await fixture.close();
  }, 20_000);

  it('runs a bounded local small-message sanity diagnostic', async () => {
    const fixture = new Fixture();
    const config = await fixture.next<Startup>();
    const sidecar = new PrivateTransportSidecar({ command: sidecarBinary });
    await sidecar.start();
    const start = Date.now();
    const opened = await sidecar.openPrivateSession(sessionConfig(config));
    const handshakeMs = Date.now() - start;
    const waitForEcho = (
      messageId: string,
      lane: PrivateTransportSidecarEvent['event']
    ) =>
      new Promise<void>((resolve) => {
        const handler = (event: PrivateTransportSidecarEvent) => {
          if (
            event.sessionId === opened.sessionId &&
            event.messageId === messageId &&
            event.event === lane
          ) {
            sidecar.off('event', handler);
            resolve();
          }
        };
        sidecar.on('event', handler);
      });
    const reliableEcho = waitForEcho('diagnostic-reliable', 'reliableMessage');
    const reliableStart = performance.now();
    await sidecar.sendPrivateReliable(
      opened.sessionId,
      'diagnostic-reliable',
      Buffer.from('ping')
    );
    await reliableEcho;
    const reliableRttMs = performance.now() - reliableStart;
    const datagramEcho = waitForEcho('diagnostic-datagram', 'datagram');
    const datagramStart = performance.now();
    await sidecar.sendPrivateDatagram(
      opened.sessionId,
      'diagnostic-datagram',
      Buffer.from('ping')
    );
    await datagramEcho;
    const datagramRttMs = performance.now() - datagramStart;
    let received = 0;
    const done = new Promise<void>((resolve) =>
      sidecar.on('event', (event: PrivateTransportSidecarEvent) => {
        if (
          event.sessionId === opened.sessionId &&
          event.event === 'reliableMessage' &&
          ++received === 100
        )
          resolve();
      })
    );
    const cpuStart = process.cpuUsage();
    const heapStart = process.memoryUsage().heapUsed;
    const sendStart = Date.now();
    // This is a bounded throughput sanity check, not a queue-overflow test.
    // Sending 100 simultaneous IPC requests races the native admission cap.
    for (let start = 0; start < 100; start += 8) {
      await Promise.all(
        Array.from({ length: Math.min(8, 100 - start) }, (_, i) =>
          sidecar.sendPrivateReliable(
            opened.sessionId,
            `bench-${start + i}`,
            Buffer.from('small-message')
          )
        )
      );
    }
    await done;
    const elapsedMs = Date.now() - sendStart;
    const cpu = process.cpuUsage(cpuStart);
    const heapDelta = process.memoryUsage().heapUsed - heapStart;
    console.info('[Step3Sanity]', {
      handshakeMs,
      reliableRttMs: Number(reliableRttMs.toFixed(2)),
      datagramRttMs: Number(datagramRttMs.toFixed(2)),
      messages: 100,
      elapsedMs,
      messagesPerSecond: Math.round(100000 / Math.max(1, elapsedMs)),
      parentCpuMs: Math.round((cpu.user + cpu.system) / 1000),
      parentHeapDeltaBytes: heapDelta,
    });
    expect(received).toBe(100);
    expect(elapsedMs).toBeLessThan(10_000);
    await sidecar.shutdown();
    await fixture.close();
  }, 20_000);
});

function descriptorFrom(config: Startup): PrivateBootstrapDescriptor {
  return {
    version: 1,
    transport: 'quic-masque-inner-v1',
    logicalSessionId: config.logicalSessionId,
    backendRnsDestination: config.backendRnsDestination,
    backendTransportEndpoint: config.backendAddress,
    backendTransportServerName: config.backendServerName,
    backendTransportCertSha256: config.backendCertSha256,
    attachToken: config.attachToken,
    expiresAt: config.expiresAt,
    nonce: config.nonce,
    ownerBindingHash: config.ownerBindingHash,
    supportedFeatures: { reliable: true, datagrams: true },
  };
}
function sessionConfig(config: Startup): PrivateSessionConfig {
  return {
    relayAddress: config.relayAddress,
    relayServerName: config.relayServerName,
    relayCertSha256: config.relayCertSha256,
    backendAddress: config.backendAddress,
    backendServerName: config.backendServerName,
    backendCertSha256: config.backendCertSha256,
    logicalSessionId: config.logicalSessionId,
    attachToken: config.attachToken,
    nonce: config.nonce,
    purpose: config.purpose,
    ownerBindingHash: config.ownerBindingHash,
  };
}

describe('private bootstrap validation', () => {
  const owner = { tabId: 'tab', name: 'app', service: 'APP' };
  const context = {
    channelId: 'private-test',
    rnsConnectionId: 'rns-test',
    purpose: 'realtime',
    generation: 1,
    owner,
  } satisfies PrivateTransportContext;
  const destination = '0123456789abcdef0123456789abcdef';
  const nonce = 'nonce';
  const binding = privateBootstrapOwnerBindingHash(
    owner,
    'rns-test',
    destination,
    'logical',
    nonce,
    'realtime'
  );
  const base = {
    version: 1,
    transport: 'quic-masque-inner-v1',
    logicalSessionId: 'logical',
    backendRnsDestination: destination,
    backendTransportEndpoint: '127.0.0.1:9000',
    backendTransportServerName: 'backend',
    backendTransportCertSha256: 'ab'.repeat(32),
    attachToken: 'token',
    expiresAt: 2000,
    nonce,
    ownerBindingHash: binding,
    supportedFeatures: { reliable: true, datagrams: true },
  };
  const validate = (value: unknown, used = new Set<string>()) =>
    validatePrivateBootstrapDescriptor(value, {
      context,
      authenticatedRnsDestination: destination,
      requestNonce: nonce,
      consumedNonces: used,
      now: 1000,
    });
  it('accepts a bound descriptor and rejects expiry', () => {
    expect(validate(base).logicalSessionId).toBe('logical');
    expect(() => validate({ ...base, expiresAt: 999 })).toThrowError(
      expect.objectContaining({ code: 'BOOTSTRAP_EXPIRED' })
    );
  });
  it('reports a duplicate attachment explicitly but sanitizes unknown backend errors', () => {
    expect(() =>
      validate({ error: { code: 'transport_already_attached' } })
    ).toThrowError(
      expect.objectContaining({ code: 'TRANSPORT_ALREADY_ATTACHED' })
    );
    expect(() =>
      validate({ error: { code: 'untrusted backend text' } })
    ).toThrowError(expect.objectContaining({ code: 'BOOTSTRAP_FAILED' }));
  });
  it('rejects wrong RNS/owner binding and reuse', () => {
    expect(() =>
      validate({ ...base, backendRnsDestination: 'f'.repeat(32) })
    ).toThrowError(
      expect.objectContaining({ code: 'BOOTSTRAP_BINDING_MISMATCH' })
    );
    expect(() =>
      validate({ ...base, ownerBindingHash: '0'.repeat(64) })
    ).toThrowError(
      expect.objectContaining({ code: 'BOOTSTRAP_BINDING_MISMATCH' })
    );
    const used = new Set<string>();
    validate(base, used);
    expect(() => validate(base, used)).toThrowError(
      expect.objectContaining({ code: 'BOOTSTRAP_REUSED' })
    );
  });
  it('rejects unsupported bootstrap versions and transports', () => {
    expect(() => validate({ ...base, version: 2 })).toThrowError(
      expect.objectContaining({ code: 'PROTOCOL_MISMATCH' })
    );
    expect(() => validate({ ...base, transport: 'direct-quic' })).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_TRANSPORT' })
    );
  });
});
