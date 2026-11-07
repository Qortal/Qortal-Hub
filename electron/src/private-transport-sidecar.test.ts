import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  PrivateTransportSidecar,
  PrivateTransportSidecarError,
  type MasqueTestConfig,
} from './private-transport-sidecar';
import { readMasqueTestConfig } from './private-transport-runtime';

type FixtureStartup = MasqueTestConfig;
type FixtureStats = {
  echoCount: number;
  echoSource: string;
  relayEgress: string;
};

let temporaryDirectory = '';
let sidecarBinary = '';
let fixtureBinary = '';
const goBinary = process.env.QORTAL_GO_BINARY || 'go';
const goAvailable =
  spawnSync(goBinary, ['version'], { windowsHide: true }).status === 0;

const fixtures = new Set<FixtureProcess>();

class FixtureProcess {
  readonly child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private stderr = '';
  private lines: string[] = [];
  private waiters: Array<{
    resolve: (line: string) => void;
    reject: (error: Error) => void;
  }> = [];
  private failure: Error | null = null;
  private exited = false;
  private closed: Promise<void>;

  constructor(
    command = fixtureBinary,
    args: string[] = [],
    private replyTimeoutMs = 5_000
  ) {
    this.child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    fixtures.add(this);
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-8_192);
    });
    this.child.on('error', (error) => this.fail(error));
    this.child.stdin.on('error', (error) => this.fail(error));
    this.closed = new Promise((resolve) => {
      this.child.once('close', (code, signal) => {
        this.exited = true;
        fixtures.delete(this);
        this.fail(
          new Error(
            `Fixture exited (code=${code}, signal=${signal}): ${this.stderr.trim()}`
          )
        );
        resolve();
      });
    });
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      for (;;) {
        const newline = this.buffer.indexOf('\n');
        if (newline < 0) return;
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        const waiter = this.waiters.shift();
        if (waiter) waiter.resolve(line);
        else this.lines.push(line);
      }
    });
  }

  async startup(): Promise<FixtureStartup> {
    return JSON.parse(await this.nextLine('startup')) as FixtureStartup;
  }

  async command<T>(operation: string): Promise<T> {
    const response = this.nextLine(operation);
    if (!this.failure)
      this.child.stdin.write(`${JSON.stringify({ operation })}\n`);
    return JSON.parse(await response) as T;
  }

  async close(): Promise<void> {
    if (this.exited) return;
    // A stalled fixture must not stall test cleanup as well.
    const forceKill = setTimeout(() => this.child.kill('SIGKILL'), 1_000);
    try {
      if (!this.failure) await this.command('shutdown').catch(() => undefined);
      if (!this.exited) this.child.kill();
      await this.closed;
    } finally {
      clearTimeout(forceKill);
    }
  }

  private fail(error: Error): void {
    this.failure ??= error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(this.failure);
  }

  private nextLine(operation: string): Promise<string> {
    if (this.failure) return Promise.reject(this.failure);
    const line = this.lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(
          new Error(
            `Fixture timed out waiting for ${operation}: ${this.stderr.trim()}`
          )
        );
      }, this.replyTimeoutMs);
      this.waiters.push({
        resolve: (line) => {
          clearTimeout(timer);
          resolve(line);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }
}

afterEach(async () => {
  await Promise.all([...fixtures].map((fixture) => fixture.close()));
});

describe('private transport fixture lifecycle', () => {
  it('reports a fixture crash and its stderr instead of hanging', async () => {
    const fixture = new FixtureProcess(process.execPath, [
      '-e',
      "process.stderr.write('fixture crash detail'); process.exit(1)",
    ]);
    await expect(fixture.startup()).rejects.toThrow(
      /Fixture exited.*fixture crash detail/
    );
    await expect(fixture.command('stats')).rejects.toThrow('Fixture exited');
  });

  it('reports a failed spawn instead of hanging', async () => {
    const fixture = new FixtureProcess(
      path.join(os.tmpdir(), 'nonexistent-qortal-fixture', 'binary')
    );
    await expect(fixture.startup()).rejects.toThrow('ENOENT');
  });

  it('bounds a stalled reply and can still close the child', async () => {
    const fixture = new FixtureProcess(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      100
    );
    await expect(fixture.startup()).rejects.toThrow(
      'Fixture timed out waiting for startup'
    );
    await fixture.close();
    expect(
      fixture.child.exitCode !== null || fixture.child.signalCode !== null
    ).toBe(true);
  });
});

const describeIntegration = goAvailable ? describe.sequential : describe.skip;

describeIntegration('private transport sidecar integration', () => {
  beforeAll(() => {
    temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'hub-private-transport-test-')
    );
    sidecarBinary = path.join(temporaryDirectory, 'qortal-private-transport');
    fixtureBinary = path.join(
      temporaryDirectory,
      'qortal-private-transport-test-fixture'
    );
    const moduleRoot = path.join(
      process.cwd(),
      'electron',
      'native',
      'private-transport'
    );
    for (const [output, pkg] of [
      [sidecarBinary, './cmd/qortal-private-transport'],
      [fixtureBinary, './cmd/qortal-private-transport-test-fixture'],
    ]) {
      const result = spawnSync(
        goBinary,
        ['build', '-trimpath', '-o', output, pkg],
        {
          cwd: moduleRoot,
          encoding: 'utf8',
          windowsHide: true,
        }
      );
      if (result.status !== 0) {
        throw new Error(
          `Go fixture build failed: ${result.error?.message ?? result.stderr}`
        );
      }
    }
  }, 60_000);

  afterAll(() => {
    if (temporaryDirectory)
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('handshakes, tunnels a datagram, and shuts down cleanly', async () => {
    const fixture = new FixtureProcess();
    const config = await fixture.startup();
    const sidecar = new PrivateTransportSidecar({ command: sidecarBinary });
    await sidecar.start();
    expect(await sidecar.health()).toEqual({
      service: 'qortal-private-transport',
      sidecarVersion: '0.11.1',
      protocolVersion: 2,
      innerAlpn: 'qortal-private/1',
      moqAlpn: 'moqt-18',
    });

    const tunnelId = await sidecar.openMasqueTunnel(config);
    expect(tunnelId).toMatch(/^tunnel-/);
    const payload = Buffer.from('known-connect-udp-datagram');
    await sidecar.sendDatagram(tunnelId, payload);
    expect(await sidecar.receiveDatagram(tunnelId)).toEqual(payload);
    const stats = await fixture.command<FixtureStats>('stats');
    expect(stats.echoCount).toBe(1);
    expect(stats.echoSource).toBe(stats.relayEgress);

    await sidecar.closeTunnel(tunnelId);
    await sidecar.shutdown();
    expect(sidecar.isRunning()).toBe(false);
    await fixture.close();
  }, 20_000);

  it('prepares and reuses a relay without forwarding any backend traffic', async () => {
    const fixture = new FixtureProcess();
    const config = await fixture.startup();
    const sidecar = new PrivateTransportSidecar({ command: sidecarBinary });
    try {
      const result = await sidecar.prepareRelay(config);
      expect(result.ready).toBe(true);
      expect(await sidecar.authorizeRelay(result.handle)).toEqual(result);
      expect((await fixture.command<FixtureStats>('stats')).echoCount).toBe(0);
      await sidecar.closeRelay(result.handle);
      await expect(sidecar.authorizeRelay(result.handle)).rejects.toMatchObject(
        { code: 'RELAY_CONNECTION_CLOSED' }
      );
    } finally {
      await sidecar.shutdown();
      await fixture.close();
    }
  }, 20_000);

  it('fails closed on a certificate pin mismatch', async () => {
    const fixture = new FixtureProcess();
    const config = await fixture.startup();
    const sidecar = new PrivateTransportSidecar({ command: sidecarBinary });
    await sidecar.start();
    await expect(
      sidecar.openMasqueTunnel({
        ...config,
        relayCertSha256: '00'.repeat(32),
        timeoutMs: 1_000,
      })
    ).rejects.toMatchObject({ code: 'MASQUE_OPEN_FAILED' });
    expect((await fixture.command<FixtureStats>('stats')).echoCount).toBe(0);
    await sidecar.shutdown();
    await fixture.close();
  }, 20_000);

  it('never falls back directly when the literal-IP relay is unavailable', async () => {
    const fixture = new FixtureProcess();
    const sidecar = new PrivateTransportSidecar({ command: sidecarBinary });
    try {
      const config = await fixture.startup();
      await fixture.command('stopRelay');
      await sidecar.start();
      await expect(
        sidecar.openMasqueTunnel({ ...config, timeoutMs: 500 })
      ).rejects.toMatchObject({ code: 'MASQUE_OPEN_FAILED' });
      expect((await fixture.command<FixtureStats>('stats')).echoCount).toBe(0);
    } finally {
      await sidecar.shutdown();
      await fixture.close();
    }
  }, 20_000);

  it('rejects pending work when the sidecar exits mid-request', async () => {
    const fixture = new FixtureProcess();
    const config = await fixture.startup();
    const sidecar = new PrivateTransportSidecar({ command: sidecarBinary });
    await sidecar.start();
    const tunnelId = await sidecar.openMasqueTunnel(config);
    const pending = sidecar.receiveDatagram(tunnelId, 10_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    sidecar.terminateForTest();
    await expect(pending).rejects.toMatchObject({ code: 'SIDECAR_EXITED' });
    expect(sidecar.isRunning()).toBe(false);
    await fixture.close();
  }, 20_000);

  it('kills a sidecar that emits malformed IPC without crashing Electron', async () => {
    const script = `
      const readline = require('readline');
      let count = 0;
      readline.createInterface({ input: process.stdin }).on('line', (line) => {
        const request = JSON.parse(line);
        if (count++ === 0) process.stdout.write(JSON.stringify({version:2,type:'response',requestId:request.requestId,ok:true,result:{service:'qortal-private-transport',sidecarVersion:'0.11.1',protocolVersion:2,innerAlpn:'qortal-private/1',moqAlpn:'moqt-18'}}) + '\\n');
        else process.stdout.write('{not-json\\n');
      });
    `;
    const sidecar = new PrivateTransportSidecar({
      command: process.execPath,
      args: ['-e', script],
    });
    await sidecar.start();
    await expect(
      sidecar.openMasqueTunnel({
        relayAddress: '127.0.0.1:1',
        relayServerName: 'test',
        relayCertSha256: '00'.repeat(32),
        targetAddress: '127.0.0.1:2',
      })
    ).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
    expect(sidecar.isRunning()).toBe(false);
  });
});

describe('MASQUE prototype configuration boundary', () => {
  it('accepts only trusted literal endpoints', () => {
    expect(() =>
      readMasqueTestConfig({
        QORTAL_MASQUE_TEST_RELAY_ADDRESS: 'relay.example:443',
        QORTAL_MASQUE_TEST_TARGET_ADDRESS: '127.0.0.1:9000',
        QORTAL_MASQUE_TEST_RELAY_SERVER_NAME: 'relay.example',
        QORTAL_MASQUE_TEST_RELAY_CERT_SHA256: 'ab'.repeat(32),
      })
    ).toThrow('Invalid literal relay endpoint');
  });

  it('uses stable coded sidecar errors', () => {
    expect(new PrivateTransportSidecarError('TEST').code).toBe('TEST');
  });

  it('rejects invalid MOQT names and oversized objects before IPC', async () => {
    const sidecar = new PrivateTransportSidecar();
    await expect(
      sidecar.openMoqSession({
        relayAddress: '127.0.0.1:1',
        relayServerName: 'relay',
        relayCertSha256: '00'.repeat(32),
        backendAddress: '127.0.0.1:2',
        backendServerName: 'backend',
        backendCertSha256: '11'.repeat(32),
        logicalSessionId: 'logical',
        attachToken: 'x'.repeat(32),
        publicationNamespace: ['invalid component'],
        publicationTrack: 'events',
      })
    ).rejects.toMatchObject({ code: 'INVALID_MOQ_CONFIG' });
    await expect(
      sidecar.publishMoqObject('moq-session', new Uint8Array(1025))
    ).rejects.toMatchObject({ code: 'MOQ_OBJECT_TOO_LARGE' });
  });
});
