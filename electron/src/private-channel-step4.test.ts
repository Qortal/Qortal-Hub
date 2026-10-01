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
import { PrivateChannelManager } from './private-channel-manager';
import {
  ReticulumPrivateChannelBootstrapProvider,
  type PrivateBootstrapDescriptor,
} from './private-channel-bootstrap';
import { PrivateTransportSidecar } from './private-transport-sidecar';
import { QuicMasqueTransport } from './quic-masque-transport';
import {
  QAppReticulumManager,
  type QAppReticulumNativeEvent,
  type QAppReticulumTransport,
} from './qapp-reticulum-manager';

const desktopRoot = process.cwd();
const backendRoot =
  process.env.QORTAL_QAPP_BACKEND_REPO ??
  '/home/qortal/Documents/qapp-backend-call';
const goBinary = process.env.QORTAL_GO_BINARY || 'go';
const uvBinary = process.env.QORTAL_UV_BINARY || 'uv';
const available =
  spawnSync(goBinary, ['version']).status === 0 &&
  spawnSync(uvBinary, ['--version']).status === 0 &&
  fs.existsSync(path.join(backendRoot, 'scripts/private_transport_fixture.py'));
const integration = available ? describe.sequential : describe.skip;

type BackendStartup = {
  backendAddress: string;
  backendDestination: string;
  backendCertSha256: string;
};
type RelayStartup = {
  relayAddress: string;
  relayServerName: string;
  relayCertSha256: string;
};

class JsonProcess {
  private buffer = '';
  private readonly lines: string[] = [];
  private readonly waiters: Array<{
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = [];
  private failure?: Error;

  constructor(readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding('utf8');
    child.stderr.resume();
    const failed = (error: Error) => {
      this.failure = error;
      for (const waiter of this.waiters.splice(0)) waiter.reject(error);
    };
    child.once('error', failed);
    child.once('exit', (code, signal) =>
      failed(new Error(`Integration fixture exited (${code ?? signal})`))
    );
    child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      for (;;) {
        const newline = this.buffer.indexOf('\n');
        if (newline < 0) return;
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        const value = JSON.parse(line);
        const waiter = this.waiters.shift();
        if (waiter) waiter.resolve(value);
        else this.lines.push(line);
      }
    });
  }

  next<T>(): Promise<T> {
    const line = this.lines.shift();
    if (line !== undefined) return Promise.resolve(JSON.parse(line) as T);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) =>
      this.waiters.push({ resolve: (value) => resolve(value as T), reject })
    );
  }

  command<T>(
    operation: string,
    values: Record<string, unknown> = {}
  ): Promise<T> {
    this.child.stdin.write(`${JSON.stringify({ operation, ...values })}\n`);
    return this.next<T>();
  }

  async close(): Promise<void> {
    if (this.child.exitCode !== null) return;
    await this.command('shutdown').catch(() => undefined);
    this.child.kill();
  }
}

class RealBackendRnsHarness implements QAppReticulumTransport {
  readonly listeners = new Set<(event: QAppReticulumNativeEvent) => void>();
  authenticatedLogicalSessionId = '';
  constructor(readonly backend: JsonProcess) {}

  onEvent(listener: (event: QAppReticulumNativeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async invoke(action: string, payload: Record<string, unknown>) {
    if (action === 'qapp_rns_connect') {
      const authenticated = await this.backend.command<{
        authentication: string;
        logicalSessionId: string;
        ok: boolean;
      }>('bindAuthenticatedSession', {
        logicalConnectionId: payload.connectionId,
      });
      expect(authenticated).toMatchObject({
        authentication: 'signed-qapp-auth',
        ok: true,
      });
      this.authenticatedLogicalSessionId = authenticated.logicalSessionId;
      return { ok: true, payload: { state: 'CONNECTED' } };
    }
    if (action === 'qapp_rns_request') {
      expect(payload.path).toBe('/qortal/private-transport/bootstrap/v1');
      expect(payload.logicalConnectionId).toEqual(expect.any(String));
      const request = JSON.parse(
        Buffer.from(String(payload.payloadBase64), 'base64').toString('utf8')
      );
      const response = await this.backend.command('bootstrap', {
        payload: request,
      });
      return {
        ok: true,
        payload: {
          payloadBase64: Buffer.from(JSON.stringify(response)).toString(
            'base64'
          ),
          encoding: 'json',
        },
      };
    }
    if (action === 'qapp_rns_close') {
      await this.backend.command('disconnectReticulum');
      return { ok: true, payload: { state: 'CLOSED' } };
    }
    if (action === 'qapp_rns_send') {
      return { ok: true, payload: { messageId: 'reticulum-still-usable' } };
    }
    return { ok: false, code: 'RNS_PROTOCOL_ERROR' };
  }
}

integration('Step 4 real backend bootstrap and attachment', () => {
  let temporaryDirectory = '';
  let sidecarBinary = '';
  let relayBinary = '';

  beforeAll(() => {
    temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'hub-step4-test-')
    );
    sidecarBinary = path.join(temporaryDirectory, 'private-transport-sidecar');
    relayBinary = path.join(temporaryDirectory, 'private-transport-relay');
    const nativeRoot = path.join(
      desktopRoot,
      'electron',
      'native',
      'private-transport'
    );
    for (const [output, source] of [
      [sidecarBinary, './cmd/qortal-private-transport'],
      [relayBinary, './cmd/qortal-private-transport-step4-relay'],
    ]) {
      const result = spawnSync(
        goBinary,
        ['build', '-trimpath', '-o', output, source],
        { cwd: nativeRoot, encoding: 'utf8' }
      );
      if (result.status !== 0)
        throw new Error(result.stderr || result.error?.message);
    }
  }, 60_000);

  afterAll(() => {
    if (temporaryDirectory)
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it
    .runIf(
      process.env.QORTAL_PYTHON_BENCH === '1' ||
        process.env.QORTAL_NATIVE_FILE_BENCH === '1'
    )
    .each(
      process.env.QORTAL_NATIVE_FILE_BENCH === '1' ? [0] : [0, 1048576, 4194304]
    )(
    process.env.QORTAL_NATIVE_FILE_BENCH === '1'
      ? 'benchmarks native durable file transport'
      : 'benchmarks real Python QUIC receive buffer %i',
    async (receiveBytes) => {
      const backend = new JsonProcess(
        spawn(
          uvBinary,
          [
            'run',
            ...(process.env.QORTAL_STEP4_UVLOOP === '1'
              ? ['--with', 'uvloop']
              : []),
            'python',
            'scripts/private_transport_fixture.py',
          ],
          {
            cwd: backendRoot,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
              ...process.env,
              QORTAL_STEP4_BULK_BENCH:
                process.env.QORTAL_NATIVE_FILE_BENCH === '1' ? '0' : '1',
              QORTAL_STEP4_RECEIVE_BYTES: String(receiveBytes),
            },
          }
        )
      );
      const startup = await backend.next<BackendStartup>();
      const relay = new JsonProcess(
        spawn(relayBinary, [], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            QORTAL_STEP4_BULK_BENCH: '1',
            QORTAL_STEP4_BACKEND_ADDRESS: startup.backendAddress,
          },
        })
      );
      const relayInfo = await relay.next<RelayStartup>();
      const proxy = dgram.createSocket('udp4');
      await new Promise<void>((r) => proxy.bind(0, '127.0.0.1', r));
      proxy.setRecvBufferSize(4 * 1024 * 1024);
      const target = Number(relayInfo.relayAddress.split(':').at(-1));
      const timers = new Set<ReturnType<typeof setTimeout>>();
      let client = 0,
        proxyDrops = 0;
      proxy.on('message', (data, peer) => {
        const fromRelay = peer.port === target;
        if (!fromRelay) client = peer.port;
        if (timers.size >= 8192) {
          proxyDrops++;
          return;
        }
        const timer = setTimeout(() => {
          timers.delete(timer);
          proxy.send(data, fromRelay ? client : target, '127.0.0.1');
        }, 60);
        timers.add(timer);
      });
      const sidecar = new PrivateTransportSidecar({ command: sidecarBinary });
      try {
        const owner = { tabId: 'bench', name: 'qapp-ui-call', service: 'APP' };
        const rns = new QAppReticulumManager(
          new RealBackendRnsHarness(backend)
        );
        const connected = await rns.connect(owner, startup.backendDestination);
        const descriptor = await new ReticulumPrivateChannelBootstrapProvider(
          rns
        ).getBootstrap({
          channelId: 'bench',
          rnsConnectionId: connected.connectionId,
          purpose: 'game',
          generation: 1,
          owner,
        });
        await sidecar.start();
        const opened = await sidecar.openPrivateSession(
          privateSessionConfig(descriptor, {
            ...relayInfo,
            relayAddress: `127.0.0.1:${(proxy.address() as import('node:net').AddressInfo).port}`,
          })
        );
        if (process.env.QORTAL_NATIVE_FILE_BENCH === '1') {
          const pending = new Map<
            string,
            {
              resolve: (v: any) => void;
              reject: (e: Error) => void;
              timer: ReturnType<typeof setTimeout>;
            }
          >();
          sidecar.on('event', (e) => {
            const p = pending.get(e.messageId!);
            if (!p) return;
            pending.delete(e.messageId!);
            clearTimeout(p.timer);
            try {
              const value = JSON.parse(e.data.subarray(1).toString());
              if (value.ok === false) throw new Error(value.error);
              p.resolve(value);
            } catch (error) {
              p.reject(error as Error);
            }
          });
          let seq = 0;
          const gates: Promise<void>[] = [Promise.resolve(), Promise.resolve()];
          const request = async (payload: Buffer, key = 'file-control') => {
            const n = seq++,
              messageId = `file-bench-${n}`;
            const reply = new Promise<any>((resolve, reject) => {
              pending.set(messageId, {
                resolve,
                reject,
                timer: setTimeout(() => {
                  pending.delete(messageId);
                  reject(new Error('file benchmark timeout'));
                }, 15000),
              });
            });
            const send = gates[n % 2].then(() =>
              sidecar.sendPrivateReliable(
                opened.sessionId,
                messageId,
                payload,
                key
              )
            );
            gates[n % 2] = send.catch(() => {});
            await send;
            return reply;
          };
          const json = (value: object) =>
            request(
              Buffer.concat([
                Buffer.from([0]),
                Buffer.from(JSON.stringify({ type: 'file_request', ...value })),
              ])
            );
          const id = 'ab'.repeat(16),
            batches = process.env.QORTAL_BULK_BENCH_LARGE === '1' ? 256 : 64;
          await json({
            op: 'create',
            id,
            size: batches * 16 * 32768,
            ttl: 3600,
            envelope: Buffer.from('opaque-envelope').toString('base64'),
            manifest: Buffer.from('opaque-manifest').toString('base64'),
          });
          const realtime = new Map<string, number>(),
            rtts: number[] = [];
          let sent = 0;
          sidecar.on('event', (e) => {
            const at = realtime.get(e.messageId!);
            if (at !== undefined) {
              rtts.push(performance.now() - at);
              realtime.delete(e.messageId!);
            }
          });
          const ticker = setInterval(() => {
            const mid = `live-${sent++}`;
            realtime.set(mid, performance.now());
            void sidecar
              .sendPrivateDatagram(
                opened.sessionId,
                mid,
                Buffer.concat([
                  Buffer.from([0]),
                  Buffer.from(
                    JSON.stringify({
                      type: 'private_transport_echo',
                      value: 'live',
                    })
                  ),
                ])
              )
              .catch(() => {});
          }, 50);
          const start = performance.now();
          let next = 0;
          try {
            await Promise.all(
              Array.from({ length: 8 }, async () => {
                while (next < batches) {
                  const batch = next++,
                    payload = Buffer.alloc(1 + 22 + 16 * (8 + 32796), 42);
                  payload[0] = 1;
                  payload.write('QFB1', 1);
                  Buffer.from(id, 'hex').copy(payload, 5);
                  payload.writeUInt16BE(16, 21);
                  let offset = 23;
                  for (let j = 0; j < 16; j++) {
                    payload.writeUInt32BE(batch * 16 + j, offset);
                    payload.writeUInt32BE(32796, offset + 4);
                    offset += 8 + 32796;
                  }
                  expect(
                    (await request(payload, 'file-bulk')).result.received
                  ).toHaveLength(16);
                }
              })
            );
          } finally {
            clearInterval(ticker);
          }
          const seconds = (performance.now() - start) / 1000;
          await json({ op: 'finish', id });
          for (const index of [0, batches * 16 - 1]) {
            expect(
              Buffer.from(
                (await json({ op: 'get', id, index })).result.chunk,
                'base64'
              )
            ).toEqual(Buffer.alloc(32796, 42));
          }
          await new Promise((r) => setTimeout(r, 400));
          rtts.sort((a, b) => a - b);
          console.info(
            '[NativeFileBenchmark]',
            JSON.stringify({
              seconds,
              bytes: batches * 16 * 32768,
              MBps: (batches * 16 * 32768) / seconds / 1e6,
              proxyDrops,
              realtimeSent: sent,
              realtimeReceived: rtts.length,
              realtimeP95: rtts[Math.floor(rtts.length * 0.95)],
              metrics: await sidecar.sessionMetrics(opened.sessionId),
            })
          );
          expect(rtts.length).toBeGreaterThanOrEqual(sent * 0.9);
          expect(rtts[Math.floor(rtts.length * 0.95)]).toBeLessThan(500);
          return;
        }
        const payload = Buffer.alloc(524886, 42);
        payload[0] = 1;
        const count = 64;
        let next = 0,
          acks = 0;
        let resolveAll!: () => void;
        const all = new Promise<void>((r) => (resolveAll = r));
        sidecar.on('event', (e) => {
          if (e.event === 'reliableMessage' && ++acks === count) resolveAll();
        });
        const start = performance.now();
        await Promise.all(
          Array.from({ length: 2 }, async () => {
            while (next < count) {
              const n = next++;
              await sidecar.sendPrivateReliable(
                opened.sessionId,
                `bench-${n}`,
                payload,
                'bulk'
              );
            }
          })
        );
        await all;
        console.info(
          '[PythonBulkBenchmark]',
          JSON.stringify({
            receiveBytes,
            seconds: (performance.now() - start) / 1000,
            bytes: count * payload.length,
            proxyDrops,
            backend: (await backend.command<{ diagnostic: unknown }>('stats'))
              .diagnostic,
            metrics: await sidecar.sessionMetrics(opened.sessionId),
          })
        );
        expect(acks).toBe(count);
      } finally {
        await sidecar.shutdown();
        timers.forEach(clearTimeout);
        proxy.close();
        await relay.close();
        await backend.close();
      }
    },
    120000
  );

  it('uses the real RNS handler to attach MASQUE QUIC to the same session', async () => {
    const backend = new JsonProcess(
      spawn(
        uvBinary,
        ['run', 'python', 'scripts/private_transport_fixture.py'],
        { cwd: backendRoot, stdio: ['pipe', 'pipe', 'pipe'] }
      )
    );
    const backendStartup = await backend.next<BackendStartup>();
    const relay = new JsonProcess(
      spawn(relayBinary, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          QORTAL_STEP4_BACKEND_ADDRESS: backendStartup.backendAddress,
        },
      })
    );
    const relayStartup = await relay.next<RelayStartup>();
    const sidecar = new PrivateTransportSidecar({ command: sidecarBinary });
    const owner = { tabId: 'step4-tab', name: 'qapp-ui-call', service: 'APP' };
    const nativeTransport = new RealBackendRnsHarness(backend);
    const rnsManager = new QAppReticulumManager(nativeTransport);
    const rns = await rnsManager.connect(
      owner,
      backendStartup.backendDestination
    );
    const bootstrapProvider = new ReticulumPrivateChannelBootstrapProvider(
      rnsManager
    );
    const channels = new PrivateChannelManager(
      (candidateOwner, connectionId) =>
        rnsManager.connectionOwnership(candidateOwner, connectionId),
      (emit) =>
        new QuicMasqueTransport(emit, sidecar, relayStartup, bootstrapProvider)
    );
    try {
      const directDescriptor = await bootstrapProvider.getBootstrap({
        channelId: 'identity-and-token-probe',
        rnsConnectionId: rns.connectionId,
        purpose: 'game',
        generation: 1,
        owner,
      });
      await expect(
        sidecar.openPrivateSession({
          ...privateSessionConfig(directDescriptor, relayStartup),
          backendCertSha256: '00'.repeat(32),
        })
      ).rejects.toMatchObject({ code: 'BACKEND_IDENTITY_MISMATCH' });
      await expect(
        sidecar.openPrivateSession({
          ...privateSessionConfig(directDescriptor, relayStartup),
          attachToken: 'missing-attach-token',
        })
      ).rejects.toMatchObject({ code: 'ATTACH_TOKEN_REJECTED' });
      const directSession = await sidecar.openPrivateSession(
        privateSessionConfig(directDescriptor, relayStartup)
      );
      await sidecar.closePrivateSession(directSession.sessionId);
      await expect(
        sidecar.openPrivateSession(
          privateSessionConfig(directDescriptor, relayStartup)
        )
      ).rejects.toMatchObject({ code: 'ATTACH_TOKEN_REJECTED' });
      for (let index = 0; index < 100; index += 1) {
        const detached = await backend.command<{ privateAttached: boolean }>(
          'stats'
        );
        if (!detached.privateAttached) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(await backend.command('stats')).toMatchObject({
        privateAttached: false,
        outstandingTokens: 0,
      });

      const opened = await channels.open(owner, rns.connectionId, 'game');
      expect(opened.state).toBe('OPEN');
      const stats = await backend.command<{
        logicalSessionId: string;
        privateAttached: boolean;
        backendPeer: string;
        outstandingTokens: number;
      }>('stats');
      expect(stats.logicalSessionId).toBe(
        nativeTransport.authenticatedLogicalSessionId
      );
      expect(stats.privateAttached).toBe(true);
      expect(stats.outstandingTokens).toBe(0);
      const relayStats = await relay.command<{ relayEgress: string }>('stats');
      expect(stats.backendPeer).toBe(relayStats.relayEgress);

      const messages: Array<Record<string, unknown>> = [];
      channels.on('event', (event) => {
        if (event.action === 'PRIVATE_CHANNEL_MESSAGE') messages.push(event);
      });
      await Promise.all([
        channels.send(owner, opened.channelId, 'reliable', 'real-r', {
          type: 'private_transport_echo',
          value: 'reliable-real-session',
        }),
        channels.send(owner, opened.channelId, 'datagram', 'real-d', {
          type: 'private_transport_echo',
          value: 'datagram-real-session',
        }),
      ]);
      for (let index = 0; index < 100 && messages.length < 2; index += 1)
        await new Promise((resolve) => setTimeout(resolve, 20));
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            channelId: opened.channelId,
            lane: 'reliable',
            messageId: 'real-r',
          }),
          expect.objectContaining({
            channelId: opened.channelId,
            lane: 'datagram',
            messageId: 'real-d',
          }),
        ])
      );
      expect(await backend.command('reticulumStatus')).toMatchObject({
        usable: true,
        logicalSessionId: stats.logicalSessionId,
      });

      await channels.close(owner, opened.channelId);
      for (let index = 0; index < 100; index += 1) {
        const detached = await backend.command<{ privateAttached: boolean }>(
          'stats'
        );
        if (!detached.privateAttached) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(await backend.command('stats')).toMatchObject({
        logicalSessionId: stats.logicalSessionId,
        privateAttached: false,
      });
      expect(await backend.command('reticulumStatus')).toMatchObject({
        usable: true,
        logicalSessionId: stats.logicalSessionId,
      });

      await bootstrapProvider.getBootstrap({
        channelId: 'unused-token',
        rnsConnectionId: rns.connectionId,
        purpose: 'game',
        generation: 1,
        owner,
      });
      expect(await backend.command('stats')).toMatchObject({
        outstandingTokens: 1,
      });
      await rnsManager.close(owner, rns.connectionId);
      expect(await backend.command('stats')).toMatchObject({
        outstandingTokens: 0,
      });
      expect(backendStartup.backendCertSha256).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      channels.destroy();
      rnsManager.destroy();
      await sidecar.shutdown();
      await relay.close();
      await backend.close();
    }
  }, 30_000);
});

function privateSessionConfig(
  descriptor: PrivateBootstrapDescriptor,
  relay: RelayStartup
) {
  return {
    relayAddress: relay.relayAddress,
    relayServerName: relay.relayServerName,
    relayCertSha256: relay.relayCertSha256,
    backendAddress: descriptor.backendTransportEndpoint,
    backendServerName: descriptor.backendTransportServerName,
    backendCertSha256: descriptor.backendTransportCertSha256,
    logicalSessionId: descriptor.logicalSessionId,
    attachToken: descriptor.attachToken,
    nonce: descriptor.nonce,
    purpose: 'game',
    ownerBindingHash: descriptor.ownerBindingHash,
  };
}
