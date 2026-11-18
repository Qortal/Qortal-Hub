import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import {
  STAGENET_DAEMON,
  type MoneroOpenRequest,
  type MoneroWalletStatus,
} from './monero-wallet-protocol';

function failure(code: string): Error {
  return Object.assign(new Error(code), { code });
}
export class MoneroWalletService {
  private worker?: Worker;
  private owner?: number;
  private identity?: string;
  private current?: MoneroWalletStatus;
  private sequence = 0;
  private epoch = 0;
  private opening?: Promise<MoneroWalletStatus>;
  private clearing: Promise<void> = Promise.resolve();
  private releaseLock?: () => void;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    private root: string,
    private daemonUrl = STAGENET_DAEMON
  ) {}

  async probe(): Promise<{
    network: 'stagenet';
    daemonUrl: string;
    daemonHeight: number;
  }> {
    try {
      const response = await fetch(this.daemonUrl + '/get_info', {
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
      const info: any = await response.json();
      if (
        !response.ok ||
        info.status !== 'OK' ||
        info.nettype !== 'stagenet' ||
        !Number.isSafeInteger(info.height) ||
        info.height < 1
      )
        throw failure('network');
      return {
        network: 'stagenet',
        daemonUrl: this.daemonUrl,
        daemonHeight: info.height,
      };
    } catch (error) {
      throw failure((error as any).code === 'network' ? 'network' : 'daemon');
    }
  }
  status(owner: number, address: string): MoneroWalletStatus | null {
    if (!this.current) return null;
    if (owner !== this.owner || address !== this.current.address)
      throw failure('changed');
    return structuredClone(this.current);
  }
  private lock(directory: string) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const lockPath = path.join(directory, 'session-lock');
    const token = randomBytes(24).toString('hex');
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });
    } catch {
      // Serialize stale-lock recovery. Otherwise two recoverers can both see
      // a dead PID and the second can remove the first one's new live lock.
      const recovery = path.join(directory, 'recovery-lock');
      try {
        fs.mkdirSync(recovery, { mode: 0o700 });
      } catch {
        throw failure('busy');
      }
      try {
        // A live process may still own an uncertain payment. Never steal its lock.
        let old: any;
        try {
          old = JSON.parse(
            fs.readFileSync(path.join(lockPath, 'owner'), 'utf8')
          );
        } catch {
          throw failure('busy');
        }
        if (!Number.isInteger(old.pid) || old.pid < 1) throw failure('busy');
        try {
          process.kill(old.pid, 0);
          throw failure('busy');
        } catch (error) {
          if ((error as any).code !== 'ESRCH') throw failure('busy');
        }
        fs.rmSync(lockPath, { recursive: true });
        fs.mkdirSync(lockPath, { mode: 0o700 });
      } finally {
        fs.rmdirSync(recovery);
      }
    }
    fs.writeFileSync(
      path.join(lockPath, 'owner'),
      JSON.stringify({ pid: process.pid, token }),
      { mode: 0o600 }
    );
    this.releaseLock = () => {
      try {
        const owner = JSON.parse(
          fs.readFileSync(path.join(lockPath, 'owner'), 'utf8')
        );
        if (owner.token === token) fs.rmSync(lockPath, { recursive: true });
      } catch {
        /* A retained lock fails closed on the next open. */
      }
    };
  }
  async open(
    owner: number,
    input: MoneroOpenRequest
  ): Promise<MoneroWalletStatus> {
    await this.clearing;
    if (
      input?.network !== 'stagenet' ||
      !/^Q[1-9A-HJ-NP-Za-km-z]{33}$/.test(input.qortalAddress) ||
      !/^[0-9a-f]{64}$/.test(input.privateSpendKey) ||
      !/^[1-9A-HJ-NP-Za-km-z]{95}$/.test(input.address) ||
      !Number.isSafeInteger(input.restoreHeight) ||
      input.restoreHeight < 0
    )
      throw failure('invalid');
    const identity = createHash('sha256')
      .update(input.qortalAddress + ':' + input.network + ':' + input.address)
      .digest('hex');
    if (this.worker) {
      if (this.owner !== owner || this.identity !== identity)
        throw failure('changed');
      if (this.opening) return this.opening;
      return this.status(owner, input.address);
    }
    const directory = path.join(this.root, identity);
    this.lock(directory);
    this.owner = owner;
    this.identity = identity;
    const epoch = ++this.epoch;
    try {
      const adjacent = path.join(__dirname, 'monero-wallet.worker.js');
      const unpacked = adjacent.replace(
        /app\.asar([/\\])/,
        'app.asar.unpacked$1'
      );
      const worker = new Worker(fs.existsSync(unpacked) ? unpacked : adjacent, {
        workerData: {
          input,
          directory,
          daemonUrl: this.daemonUrl,
          sdkPath: require.resolve('monero-ts'),
        },
        stdout: true,
        stderr: true,
      });
      this.worker = worker;
      // Native SDK diagnostics must not leak key/file/transaction metadata.
      worker.stdout.resume();
      worker.stderr.resume();
      worker.on('message', (message) => {
        if (epoch !== this.epoch) return;
        if (message.type === 'status') {
          this.current = message.status;
          return;
        }
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(failure(message.error));
        else request.resolve(message.result);
      });
      const died = () => {
        if (epoch === this.epoch) void this.clear();
      };
      worker.once('error', died);
      worker.once('exit', died);
      this.opening = this.request('open', {});
      const result = await this.opening;
      if (epoch !== this.epoch) throw failure('changed');
      return result;
    } catch (error) {
      await this.clear();
      throw error;
    } finally {
      this.opening = undefined;
    }
  }
  async run(owner: number, address: string, kind: string, data: any) {
    this.status(owner, address);
    if (
      !this.worker ||
      !this.current?.initialized ||
      !['prepare', 'relay', 'cancel', 'retry'].includes(kind)
    )
      throw failure('changed');
    return this.request(kind, data);
  }
  private request(kind: string, data: any): Promise<any> {
    if (!this.worker) return Promise.reject(failure('changed'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(failure(kind === 'relay' ? 'pending' : 'engine'));
        void this.clear();
      }, 90000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.worker.postMessage({ id, kind, data });
      } catch {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(failure('engine'));
      }
    });
  }
  clear(owner?: number): Promise<void> {
    if (owner !== undefined && owner !== this.owner) return Promise.resolve();
    ++this.epoch;
    const worker = this.worker;
    const release = this.releaseLock;
    this.worker = undefined;
    this.current = undefined;
    this.identity = undefined;
    this.owner = undefined;
    this.releaseLock = undefined;
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(failure('changed'));
    }
    this.pending.clear();
    this.clearing = this.clearing.then(async () => {
      if (worker) await worker.terminate();
      release?.();
    });
    return this.clearing;
  }
}
