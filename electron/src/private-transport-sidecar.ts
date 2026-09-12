import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { randomUUID } from 'crypto';
import { app } from 'electron';
import { EventEmitter } from 'events';
import path from 'path';

export const PRIVATE_TRANSPORT_PROTOCOL_VERSION = 2;
export const PRIVATE_TRANSPORT_SIDECAR_VERSION = '0.11.0';
export const MAX_MOQ_OBJECT_BYTES = 1024;
export const MAX_MOQ_RELIABLE_OBJECT_BYTES = 1024 * 1024;
export type PreparedRelay = {
  handle: string;
  ready: boolean;
  challenge?: Record<string, unknown>;
  expiresAt?: number;
};
const MOQ_NAME = /^[A-Za-z0-9._-]{1,128}$/;

function validMoqNamespace(namespace: readonly string[]): boolean {
  return (
    namespace.length >= 1 &&
    namespace.length <= 8 &&
    namespace.every((component) => MOQ_NAME.test(component)) &&
    namespace.reduce((total, component) => total + component.length, 0) <= 512
  );
}
const MAX_RESPONSE_LINE_BYTES = 64 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 7_000;

export class PrivateTransportSidecarError extends Error {
  constructor(
    public readonly code: string,
    message = code
  ) {
    super(message);
  }
}

export type MasqueTestConfig = Readonly<{
  relayAddress: string;
  relayServerName: string;
  relayCertSha256: string;
  targetAddress: string;
  timeoutMs?: number;
}>;

export type PrivateSessionConfig = Readonly<{
  preparedRelay?: string;
  relayAddress: string;
  relayServerName: string;
  relayCertSha256: string;
  backendAddress: string;
  backendServerName: string;
  backendCertSha256: string;
  logicalSessionId: string;
  attachToken: string;
  nonce: string;
  purpose: string;
  ownerBindingHash: string;
  timeoutMs?: number;
}>;

export type MoqSessionConfig = Readonly<{
  preparedRelay?: string;
  relayAddress: string;
  relayServerName: string;
  relayCertSha256: string;
  backendAddress: string;
  backendServerName: string;
  backendCertSha256: string;
  logicalSessionId: string;
  attachToken: string;
  publicationNamespace: readonly string[];
  publicationTrack: string | readonly string[];
  timeoutMs?: number;
}>;

export type MoqSessionInfo = Readonly<{
  moqSessionId: string;
  logicalSessionId: string;
  publicationNamespace: string[];
  publicationTrack: string | readonly string[];
  applicationProtocol: 'moqt-18';
}>;

export type PrivateTransportSidecarEvent = {
  event: 'reliableMessage' | 'datagram' | 'object' | 'error';
  sessionId: string;
  messageId?: string;
  subscriptionId?: string;
  namespace?: string[];
  trackName?: string;
  groupId?: number;
  objectId?: number;
  code?: string;
  data: Buffer;
};

type SidecarOperation =
  | 'prepareRelay'
  | 'authorizeRelay'
  | 'closeRelay'
  | 'clearRelays'
  | 'prepareRelayTickets'
  | 'finalizeRelayTickets'
  | 'health'
  | 'openMasqueTunnel'
  | 'sendDatagram'
  | 'receiveDatagram'
  | 'closeTunnel'
  | 'openPrivateSession'
  | 'sendPrivateReliable'
  | 'sendPrivateDatagram'
  | 'sessionMetrics'
  | 'closePrivateSession'
  | 'openMoqSession'
  | 'subscribeMoqTrack'
  | 'publishMoqObject'
  | 'moqSessionMetrics'
  | 'closeMoqSession'
  | 'shutdown';

type SidecarResponse = {
  version: number;
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: { code?: unknown; message?: unknown };
  type?: unknown;
  event?: unknown;
  sessionId?: unknown;
  messageId?: unknown;
  subscriptionId?: unknown;
  namespace?: unknown;
  trackName?: unknown;
  groupId?: unknown;
  objectId?: unknown;
  code?: unknown;
  binaryLength?: unknown;
};

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export type PrivateTransportSidecarTestOptions = {
  /** Test-only trusted launch override. Never populated from renderer input. */
  command?: string;
  args?: string[];
  requestTimeoutMs?: number;
};

function platformDirectory(): string {
  const platform =
    process.platform === 'win32'
      ? 'windows'
      : process.platform === 'darwin'
        ? 'darwin'
        : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `${platform}-${arch}`;
}

export function getPrivateTransportSidecarPath(): string {
  const executable =
    process.platform === 'win32'
      ? 'qortal-private-transport.exe'
      : 'qortal-private-transport';
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      'private-transport',
      platformDirectory(),
      executable
    );
  }
  return path.join(
    app.getAppPath(),
    'resources',
    'private-transport',
    platformDirectory(),
    executable
  );
}

export class PrivateTransportSidecar extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private stdoutBuffer = Buffer.alloc(0);
  private pendingBinaryEvent:
    | (Omit<PrivateTransportSidecarEvent, 'data'> & {
        binaryLength: number;
      })
    | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private stopping = false;

  constructor(
    private readonly testOptions: PrivateTransportSidecarTestOptions = {}
  ) {
    super();
  }

  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.child) return;
    this.startPromise = this.spawnAndHandshake().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async health(): Promise<{
    service: string;
    sidecarVersion: string;
    protocolVersion: number;
    innerAlpn?: string;
    moqAlpn?: string;
  }> {
    const result = await this.request('health', {});
    return result as {
      service: string;
      sidecarVersion: string;
      protocolVersion: number;
      innerAlpn?: string;
      moqAlpn?: string;
    };
  }

  async prepareRelayTickets(descriptor: Record<string, unknown>) {
    await this.start();
    return (await this.request('prepareRelayTickets', { descriptor })) as {
      handle: string;
      blinded: string[];
    };
  }
  async finalizeRelayTickets(handle: string, signatures: string[]) {
    return (await this.request('finalizeRelayTickets', {
      handle,
      signatures,
    })) as { tickets: string[]; expiresAt: number };
  }
  async prepareRelay(config: {
    relayAddress: string;
    relayServerName: string;
    relayCertSha256: string;
    legacyRelay?: boolean;
  }) {
    await this.start();
    return this.validatePreparedRelay(
      await this.request(
        'prepareRelay',
        {
          relayAddress: config.relayAddress,
          relayServerName: config.relayServerName,
          relayCertSha256: config.relayCertSha256,
          legacyRelay: config.legacyRelay === true,
        },
        6_000
      )
    );
  }
  async authorizeRelay(handle: string, proof = '', renew = false) {
    return this.validatePreparedRelay(
      await this.request(
        'authorizeRelay',
        { handle, proof, renew: renew || !!proof },
        9_000
      )
    );
  }
  private validatePreparedRelay(value: unknown): PreparedRelay {
    const r = value as PreparedRelay;
    if (
      !r ||
      typeof r.handle !== 'string' ||
      !/^[a-f0-9]{48}$/.test(r.handle) ||
      typeof r.ready !== 'boolean' ||
      (r.expiresAt !== undefined &&
        (!Number.isSafeInteger(r.expiresAt) || r.expiresAt <= Date.now())) ||
      (r.challenge !== undefined &&
        (!r.challenge ||
          typeof r.challenge !== 'object' ||
          Array.isArray(r.challenge) ||
          JSON.stringify(r.challenge).length > 1024)) ||
      (!r.ready && !r.challenge) ||
      (r.ready && r.challenge)
    )
      throw new PrivateTransportSidecarError('MALFORMED_RESPONSE');
    return r;
  }
  async closeRelay(handle: string) {
    if (this.child) await this.request('closeRelay', { handle });
  }
  async clearRelays() {
    if (this.child) await this.request('clearRelays', {});
  }

  async openMasqueTunnel(config: MasqueTestConfig): Promise<string> {
    await this.start();
    const result = (await this.request('openMasqueTunnel', config)) as {
      tunnelId?: unknown;
    };
    if (typeof result?.tunnelId !== 'string' || !result.tunnelId) {
      throw new PrivateTransportSidecarError('MALFORMED_RESPONSE');
    }
    return result.tunnelId;
  }

  async sendDatagram(tunnelId: string, data: Buffer): Promise<void> {
    await this.request('sendDatagram', {
      tunnelId,
      dataBase64: data.toString('base64'),
    });
  }

  async receiveDatagram(tunnelId: string, timeoutMs = 5_000): Promise<Buffer> {
    const result = (await this.request(
      'receiveDatagram',
      { tunnelId, timeoutMs },
      timeoutMs + 1_000
    )) as { dataBase64?: unknown };
    if (typeof result?.dataBase64 !== 'string') {
      throw new PrivateTransportSidecarError('MALFORMED_RESPONSE');
    }
    return Buffer.from(result.dataBase64, 'base64');
  }

  async closeTunnel(tunnelId: string): Promise<void> {
    if (!this.child) return;
    await this.request('closeTunnel', { tunnelId });
  }

  async openPrivateSession(config: PrivateSessionConfig): Promise<{
    sessionId: string;
    innerQuicConnectionId: string;
    logicalSessionId: string;
    transportGeneration: number;
  }> {
    await this.start();
    const result = (await this.request('openPrivateSession', config)) as Record<
      string,
      unknown
    >;
    if (
      typeof result?.sessionId !== 'string' ||
      typeof result?.innerQuicConnectionId !== 'string' ||
      typeof result?.logicalSessionId !== 'string' ||
      result?.transportGeneration !== 1
    )
      throw new PrivateTransportSidecarError('MALFORMED_RESPONSE');
    return result as {
      sessionId: string;
      innerQuicConnectionId: string;
      logicalSessionId: string;
      transportGeneration: number;
    };
  }

  async sendPrivateReliable(
    sessionId: string,
    messageId: string,
    data: Buffer,
    streamKey?: string,
    endStream?: boolean
  ): Promise<void> {
    await this.request(
      'sendPrivateReliable',
      { sessionId, messageId, streamKey, endStream },
      undefined,
      data
    );
  }

  async sendPrivateDatagram(
    sessionId: string,
    messageId: string,
    data: Buffer
  ): Promise<void> {
    await this.request(
      'sendPrivateDatagram',
      { sessionId, messageId },
      undefined,
      data
    );
  }

  async sessionMetrics(sessionId: string): Promise<Record<string, number>> {
    return (await this.request('sessionMetrics', { sessionId })) as Record<
      string,
      number
    >;
  }

  async closePrivateSession(sessionId: string): Promise<void> {
    if (this.child) await this.request('closePrivateSession', { sessionId });
  }

  async openMoqSession(config: MoqSessionConfig): Promise<MoqSessionInfo> {
    if (
      !validMoqNamespace(config.publicationNamespace) ||
      !(
        typeof config.publicationTrack === 'string'
          ? [config.publicationTrack]
          : config.publicationTrack
      ).every((track) => MOQ_NAME.test(track))
    ) {
      throw new PrivateTransportSidecarError('INVALID_MOQ_CONFIG');
    }
    await this.start();
    const result = (await this.request('openMoqSession', config)) as Record<
      string,
      unknown
    >;
    if (
      typeof result?.moqSessionId !== 'string' ||
      !result.moqSessionId.startsWith('moq-') ||
      typeof result?.logicalSessionId !== 'string' ||
      !Array.isArray(result?.publicationNamespace) ||
      result.publicationNamespace.length !==
        config.publicationNamespace.length ||
      !result.publicationNamespace.every(
        (component, index) => component === config.publicationNamespace[index]
      ) ||
      JSON.stringify(result?.publicationTrack) !==
        JSON.stringify(config.publicationTrack) ||
      result?.applicationProtocol !== 'moqt-18'
    ) {
      throw new PrivateTransportSidecarError('MALFORMED_RESPONSE');
    }
    return result as MoqSessionInfo;
  }

  async subscribeMoqTrack(
    moqSessionId: string,
    subscriptionId: string,
    namespace: readonly string[],
    trackName: string
  ): Promise<void> {
    if (
      !MOQ_NAME.test(subscriptionId) ||
      !validMoqNamespace(namespace) ||
      !MOQ_NAME.test(trackName)
    ) {
      throw new PrivateTransportSidecarError('INVALID_MOQ_SUBSCRIPTION');
    }
    await this.request('subscribeMoqTrack', {
      moqSessionId,
      subscriptionId,
      namespace,
      trackName,
    });
  }

  async publishMoqObject(
    moqSessionId: string,
    payload: Uint8Array,
    trackName?: string,
    batch?: readonly Uint8Array[],
    delivery?: {
      priority: number;
      maxQueueAgeMillis: number;
      groupId?: number;
      objectId?: number;
    }
  ): Promise<void> {
    const reliable =
      delivery?.groupId !== undefined || delivery?.objectId !== undefined;
    const limit = reliable
      ? MAX_MOQ_RELIABLE_OBJECT_BYTES
      : MAX_MOQ_OBJECT_BYTES;
    if (
      reliable &&
      (!Number.isSafeInteger(delivery?.groupId) ||
        delivery!.groupId! < 0 ||
        !Number.isSafeInteger(delivery?.objectId) ||
        delivery!.objectId! < 0 ||
        !trackName ||
        !MOQ_NAME.test(trackName) ||
        batch?.length !== 1)
    ) {
      throw new PrivateTransportSidecarError('INVALID_MOQ_CONFIG');
    }
    if (payload.byteLength < 1 || payload.byteLength > limit) {
      throw new PrivateTransportSidecarError('MOQ_OBJECT_TOO_LARGE');
    }
    let binary = payload;
    if (batch && !reliable) {
      if (
        !batch.length ||
        batch.length > 8 ||
        !trackName ||
        !MOQ_NAME.test(trackName) ||
        batch.some((item) => !item.length || item.length > MAX_MOQ_OBJECT_BYTES)
      )
        throw new PrivateTransportSidecarError('MOQ_OBJECT_TOO_LARGE');
      binary = Buffer.concat(
        batch.map((item) => {
          const size = Buffer.alloc(2);
          size.writeUInt16BE(item.length);
          return Buffer.concat([size, Buffer.from(item)]);
        })
      );
    }
    await this.request(
      'publishMoqObject',
      {
        moqSessionId,
        ...(trackName ? { trackName } : {}),
        ...(batch && !reliable ? { batched: true } : {}),
        ...(delivery
          ? {
              delivery: {
                priority: delivery.priority,
                maxQueueAgeMillis: delivery.maxQueueAgeMillis,
              },
            }
          : {}),
        ...(reliable
          ? { groupId: delivery!.groupId, objectId: delivery!.objectId }
          : {}),
      },
      undefined,
      binary
    );
  }

  async moqSessionMetrics(
    moqSessionId: string
  ): Promise<Record<string, number>> {
    return (await this.request('moqSessionMetrics', {
      moqSessionId,
    })) as Record<string, number>;
  }

  async closeMoqSession(moqSessionId: string): Promise<void> {
    if (this.child) await this.request('closeMoqSession', { moqSessionId });
  }

  async shutdown(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    try {
      await this.request('shutdown', {}, 1_000);
    } catch {
      // Exit/kill below remains authoritative.
    }
    if (this.child === child && child.exitCode === null) {
      await Promise.race([
        new Promise<void>((resolve) => child.once('exit', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 500)),
      ]);
    }
    if (this.child === child && child.exitCode === null) child.kill();
    this.child = null;
    this.rejectPending('SIDECAR_STOPPED');
    this.stopping = false;
  }

  /** Exposed for lifecycle tests; production callers use the typed methods. */
  isRunning(): boolean {
    return this.child !== null;
  }

  /** Test-only fault injection; not reachable from preload or renderer IPC. */
  terminateForTest(): void {
    this.child?.kill();
  }

  private async spawnAndHandshake(): Promise<void> {
    const command =
      this.testOptions.command ?? getPrivateTransportSidecarPath();
    const args = this.testOptions.args ?? [];
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    this.child = child;
    this.stopping = false;
    child.stderr.resume();
    child.stdout.on('data', (chunk: Buffer) => this.handleStdout(child, chunk));
    child.on('error', () => this.handleDeath(child, 'SIDECAR_SPAWN_FAILED'));
    child.on('exit', () => this.handleDeath(child, 'SIDECAR_EXITED'));

    try {
      const health = await this.health();
      if (
        health.service !== 'qortal-private-transport' ||
        health.sidecarVersion !== PRIVATE_TRANSPORT_SIDECAR_VERSION ||
        health.protocolVersion !== PRIVATE_TRANSPORT_PROTOCOL_VERSION ||
        health.innerAlpn !== 'qortal-private/1' ||
        health.moqAlpn !== 'moqt-18'
      ) {
        throw new PrivateTransportSidecarError('SIDECAR_VERSION_MISMATCH');
      }
    } catch (error) {
      if (this.child === child) child.kill();
      this.child = null;
      throw error;
    }
  }

  private request(
    operation: SidecarOperation,
    params: unknown,
    timeoutMs = this.testOptions.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    binary: Uint8Array = Buffer.alloc(0)
  ): Promise<unknown> {
    const child = this.child;
    if (!child || !child.stdin.writable) {
      return Promise.reject(
        new PrivateTransportSidecarError('SIDECAR_NOT_RUNNING')
      );
    }
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new PrivateTransportSidecarError('SIDECAR_REQUEST_TIMEOUT'));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      const frame = JSON.stringify({
        version: PRIVATE_TRANSPORT_PROTOCOL_VERSION,
        requestId,
        operation,
        params,
        binaryLength: binary.length || undefined,
      });
      child.stdin.write(
        Buffer.concat([Buffer.from(`${frame}\n`), binary]),
        (error) => {
          if (!error) return;
          const pending = this.pending.get(requestId);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(requestId);
          pending.reject(
            new PrivateTransportSidecarError('SIDECAR_WRITE_FAILED')
          );
        }
      );
    });
  }

  private handleStdout(
    child: ChildProcessWithoutNullStreams,
    chunk: Buffer
  ): void {
    if (this.child !== child) return;
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
    for (;;) {
      if (this.pendingBinaryEvent) {
        if (this.stdoutBuffer.length < this.pendingBinaryEvent.binaryLength)
          return;
        const pending = this.pendingBinaryEvent;
        const data = this.stdoutBuffer.subarray(0, pending.binaryLength);
        this.stdoutBuffer = this.stdoutBuffer.subarray(pending.binaryLength);
        this.pendingBinaryEvent = null;
        this.emit('event', { ...pending, binaryLength: undefined, data });
        continue;
      }
      const newline = this.stdoutBuffer.indexOf(0x0a);
      if (newline === -1) {
        if (this.stdoutBuffer.length > MAX_RESPONSE_LINE_BYTES) {
          this.failMalformed(child);
        }
        return;
      }
      const line = this.stdoutBuffer
        .subarray(0, newline)
        .toString('utf8')
        .trim();
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1);
      if (!line) continue;
      if (Buffer.byteLength(line, 'utf8') > MAX_RESPONSE_LINE_BYTES) {
        this.failMalformed(child);
        return;
      }
      let response: SidecarResponse;
      try {
        response = JSON.parse(line) as SidecarResponse;
      } catch {
        this.failMalformed(child);
        return;
      }
      if (response.type === 'event') {
        if (
          response.version !== PRIVATE_TRANSPORT_PROTOCOL_VERSION ||
          typeof response.event !== 'string' ||
          !['reliableMessage', 'datagram', 'object', 'error'].includes(
            response.event
          ) ||
          typeof response.sessionId !== 'string' ||
          (response.namespace !== undefined &&
            (!Array.isArray(response.namespace) ||
              !response.namespace.every(
                (component) => typeof component === 'string'
              ))) ||
          (response.binaryLength !== undefined &&
            (!Number.isInteger(response.binaryLength) ||
              (response.binaryLength as number) < 0 ||
              (response.binaryLength as number) > 1024 * 1024))
        ) {
          this.failMalformed(child);
          return;
        }
        const event = {
          event: response.event as PrivateTransportSidecarEvent['event'],
          sessionId: response.sessionId,
          messageId:
            typeof response.messageId === 'string'
              ? response.messageId
              : undefined,
          subscriptionId:
            typeof response.subscriptionId === 'string'
              ? response.subscriptionId
              : undefined,
          namespace: Array.isArray(response.namespace)
            ? (response.namespace as string[])
            : undefined,
          trackName:
            typeof response.trackName === 'string'
              ? response.trackName
              : undefined,
          groupId:
            typeof response.groupId === 'number' &&
            Number.isSafeInteger(response.groupId) &&
            response.groupId >= 0
              ? response.groupId
              : undefined,
          objectId:
            typeof response.objectId === 'number' &&
            Number.isSafeInteger(response.objectId) &&
            response.objectId >= 0
              ? response.objectId
              : undefined,
          code: typeof response.code === 'string' ? response.code : undefined,
          binaryLength: Number(response.binaryLength ?? 0),
        };
        if (event.binaryLength === 0)
          this.emit('event', { ...event, data: Buffer.alloc(0) });
        else this.pendingBinaryEvent = event;
        continue;
      }
      if (
        response.version !== PRIVATE_TRANSPORT_PROTOCOL_VERSION ||
        typeof response.requestId !== 'string' ||
        typeof response.ok !== 'boolean'
      ) {
        this.failMalformed(child);
        return;
      }
      const pending = this.pending.get(response.requestId);
      if (!pending) {
        this.failMalformed(child);
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(response.requestId);
      if (response.ok) pending.resolve(response.result);
      else {
        const code =
          typeof response.error?.code === 'string'
            ? response.error.code
            : 'SIDECAR_OPERATION_FAILED';
        pending.reject(new PrivateTransportSidecarError(code));
      }
    }
  }

  private failMalformed(child: ChildProcessWithoutNullStreams): void {
    this.handleDeath(child, 'MALFORMED_RESPONSE');
    child.kill();
  }

  private handleDeath(
    child: ChildProcessWithoutNullStreams,
    code: string
  ): void {
    if (this.child !== child) return;
    this.child = null;
    this.stdoutBuffer = Buffer.alloc(0);
    this.pendingBinaryEvent = null;
    this.emit('death', code);
    this.rejectPending(this.stopping ? 'SIDECAR_STOPPED' : code);
  }

  private rejectPending(code: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new PrivateTransportSidecarError(code));
    }
    this.pending.clear();
  }
}
