import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

class FixtureProcess {
  readonly child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private lines: string[] = [];
  private waiters: Array<(line: string) => void> = [];

  constructor() {
    this.child = spawn(fixtureBinary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.resume();
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      for (;;) {
        const newline = this.buffer.indexOf('\n');
        if (newline < 0) return;
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        const waiter = this.waiters.shift();
        if (waiter) waiter(line);
        else this.lines.push(line);
      }
    });
  }

  async startup(): Promise<FixtureStartup> {
    return JSON.parse(await this.nextLine()) as FixtureStartup;
  }

  async command<T>(operation: string): Promise<T> {
    this.child.stdin.write(`${JSON.stringify({ operation })}\n`);
    return JSON.parse(await this.nextLine()) as T;
  }

  async close(): Promise<void> {
    if (this.child.exitCode !== null) return;
    await this.command('shutdown').catch(() => undefined);
    this.child.kill();
  }

  private nextLine(): Promise<string> {
    const line = this.lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

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
      sidecarVersion: '0.11.0',
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
    const config = await fixture.startup();
    await fixture.command('stopRelay');
    const sidecar = new PrivateTransportSidecar({ command: sidecarBinary });
    await sidecar.start();
    await expect(
      sidecar.openMasqueTunnel({ ...config, timeoutMs: 500 })
    ).rejects.toMatchObject({ code: 'MASQUE_OPEN_FAILED' });
    expect((await fixture.command<FixtureStats>('stats')).echoCount).toBe(0);
    await sidecar.shutdown();
    await fixture.close();
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
        if (count++ === 0) process.stdout.write(JSON.stringify({version:2,type:'response',requestId:request.requestId,ok:true,result:{service:'qortal-private-transport',sidecarVersion:'0.11.0',protocolVersion:2,innerAlpn:'qortal-private/1',moqAlpn:'moqt-18'}}) + '\\n');
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
