// Trusted desktop worker. No private key, wallet file or transaction metadata
// is ever returned to the renderer/Q-App. All amounts crossing IPC are strings.
// This entry is ASAR-unpacked: named built-ins avoid a relative tslib import.
import { parentPort, workerData } from 'node:worker_threads';
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  createHmac,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import type {
  MoneroOpenRequest,
  MoneroPreparedPayment,
  MoneroWalletStatus,
} from './monero-wallet-protocol';

const monero = createRequire(__filename)(workerData.sdkPath);
const input: MoneroOpenRequest = workerData.input;
const directory: string = workerData.directory;
const daemonUrl: string = workerData.daemonUrl;
const walletPath = join(directory, 'wallet');
const journalPath = join(directory, 'pending-payment');
const password = createHmac('sha256', Buffer.from(input.privateSpendKey, 'hex'))
  .update('QortalHub/XMR/cache/v1')
  .digest('hex');
const journalKey = createHmac(
  'sha256',
  Buffer.from(input.privateSpendKey, 'hex')
)
  .update('QortalHub/XMR/journal/v1')
  .digest();
let wallet: any;
let daemon: any;
let busy = false;
let prepared: (MoneroPreparedPayment & { metadata: string }) | undefined;
let pending: (MoneroPreparedPayment & { metadata: string }) | undefined;
let timer: ReturnType<typeof setTimeout>;
const status: MoneroWalletStatus = {
  network: 'stagenet',
  address: input.address,
  daemonUrl,
  initialized: false,
  syncing: false,
  synced: false,
  walletHeight: 0,
  daemonHeight: 0,
  progress: 0,
  balanceAtomic: '0',
  unlockedBalanceAtomic: '0',
  transactions: [],
  pending: null,
  error: null,
};
function fail(code: string): never {
  throw Object.assign(new Error(code), { code });
}
let lastPublish = 0;
function publish(force = true) {
  if (!force && Date.now() - lastPublish < 250) return;
  lastPublish = Date.now();
  parentPort.postMessage({ type: 'status', status });
}
function atomic(value: unknown): bigint {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value))
    fail('invalid');
  const amount = BigInt(value);
  if (amount > 18446744073709551615n) fail('invalid');
  return amount;
}
function publicPayment(payment: MoneroPreparedPayment) {
  return {
    txId: payment.txId,
    recipient: payment.recipient,
    amountAtomic: payment.amountAtomic,
    feeAtomic: payment.feeAtomic,
  };
}
function persistPending(payment: typeof pending) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', journalKey, iv);
  cipher.setAAD(Buffer.from(input.network + ':' + input.address));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payment)),
    cipher.final(),
  ]);
  const bytes = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  const temporary = journalPath + '.new';
  const fd = openSync(temporary, 'w', 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, journalPath);
  const dir = openSync(directory, 'r');
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}
async function loadPending() {
  if (!existsSync(journalPath)) return;
  try {
    const bytes = readFileSync(journalPath);
    if (bytes.length > 4 * 1024 * 1024 || bytes.length < 29) fail('pending');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      journalKey,
      bytes.subarray(0, 12)
    );
    decipher.setAAD(Buffer.from(input.network + ':' + input.address));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const data = JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString()
    );
    if (
      !/^[a-f0-9]{64}$/.test(data.txId) ||
      typeof data.metadata !== 'string' ||
      !/^[a-f0-9]+$/.test(data.metadata)
    )
      fail('pending');
    atomic(data.amountAtomic);
    atomic(data.feeAtomic);
    if (
      !(await monero.MoneroUtils.isValidAddress(
        data.recipient,
        monero.MoneroNetworkType.STAGENET
      ))
    )
      fail('pending');
    pending = data;
    status.pending = publicPayment(data);
  } catch {
    fail('pending');
  }
}
async function snapshot() {
  status.walletHeight = await wallet.getHeight();
  status.balanceAtomic = (await wallet.getBalance()).toString();
  status.unlockedBalanceAtomic = (await wallet.getUnlockedBalance()).toString();
  const txs = await wallet.getTxs({ includeOutputs: false });
  status.transactions = txs
    .filter((tx: any) => tx.getIsIncoming() || tx.getIsRelayed())
    .slice(-100)
    .reverse()
    .map((tx: any) => ({
      txId: tx.getHash(),
      incoming: tx.getIsIncoming() === true,
      amountAtomic:
        (tx.getIsIncoming()
          ? tx.getIncomingAmount()
          : tx.getOutgoingAmount()
        )?.toString() || '0',
      feeAtomic: tx.getIsIncoming() ? '0' : tx.getFee()?.toString() || '0',
      confirmations: tx.getNumConfirmations() || 0,
      timestamp: tx.getBlock()?.getTimestamp() || null,
    }));
}
async function knownPayment(txId: string): Promise<boolean> {
  try {
    const tx = await daemon.getTx(txId);
    return !!tx && (tx.getIsConfirmed() === true || tx.getInTxPool() === true);
  } catch {
    return false;
  }
}
async function scan() {
  if (busy) {
    timer = setTimeout(scan, 15000);
    return;
  }
  busy = true;
  status.syncing = true;
  status.error = null;
  publish();
  try {
    status.daemonHeight = await wallet.getDaemonHeight();
    await wallet.sync(
      Object.assign(new monero.MoneroWalletListener(), {
        onSyncProgress: (
          height: number,
          _start: number,
          end: number,
          percent: number
        ) => {
          status.walletHeight = height;
          status.daemonHeight = end;
          status.progress = Math.max(0, Math.min(1, percent));
          publish(false);
        },
      })
    );
    await snapshot();
    await wallet.save();
    // Clear an uncertain intent only after the same tx is observed on-chain/in-pool
    // and the local wallet's spent-output state has been saved.
    if (
      pending &&
      status.transactions.some((tx) => tx.txId === pending.txId) &&
      (await knownPayment(pending.txId))
    ) {
      unlinkSync(journalPath);
      pending = undefined;
      status.pending = null;
    }
    status.synced = await wallet.isSynced();
    status.progress = status.synced ? 1 : status.progress;
  } catch {
    status.error = 'daemon';
    status.synced = false;
  } finally {
    busy = false;
    status.syncing = false;
    publish();
    timer = setTimeout(scan, 15000);
  }
}
async function initialize() {
  await monero.LibraryUtils.setLogLevel(0);
  daemon = await monero.connectToDaemonRpc({
    server: daemonUrl,
    proxyToWorker: false,
  });
  const info = await daemon.getInfo();
  if (info.getNetworkType() !== monero.MoneroNetworkType.STAGENET)
    fail('network');
  const config = {
    path: walletPath,
    password,
    networkType: monero.MoneroNetworkType.STAGENET,
    proxyToWorker: false,
  };
  if (await monero.MoneroWalletFull.walletExists(walletPath))
    wallet = await monero.openWalletFull(config);
  else
    wallet = await monero.createWalletFull({
      ...config,
      privateSpendKey: input.privateSpendKey,
      restoreHeight: input.restoreHeight,
    });
  if ((await wallet.getPrimaryAddress()) !== input.address) fail('changed');
  await wallet.setDaemonConnection(daemonUrl, false);
  await snapshot();
  await wallet.save();
  await loadPending();
  status.initialized = true;
  status.daemonHeight = info.getHeight();
  publish();
  timer = setTimeout(scan, 0);
  return status;
}
async function command(kind: string, data: any) {
  if (kind === 'open') return initialize();
  if (!wallet || !status.initialized) fail('changed');
  if (kind === 'prepare') {
    if (pending) fail('pending');
    if (busy || !status.synced) fail('syncing');
    if (
      !(await monero.MoneroUtils.isValidAddress(
        data.recipient,
        monero.MoneroNetworkType.STAGENET
      ))
    )
      fail('invalid');
    const amount = atomic(data.amountAtomic);
    if (amount >= BigInt(status.unlockedBalanceAtomic)) fail('insufficient');
    busy = true;
    try {
      const tx = await wallet.createTx({
        accountIndex: 0,
        address: data.recipient,
        amount,
        relay: false,
        canSplit: false,
      });
      const fee = tx.getFee();
      if (
        !fee ||
        fee > atomic(data.maxFeeAtomic) ||
        atomic(data.maxFeeAtomic) > 1000000000000n ||
        amount + fee > BigInt(status.unlockedBalanceAtomic) ||
        !/^[a-f0-9]{64}$/.test(tx.getHash())
      )
        fail('insufficient');
      prepared = {
        id: randomBytes(24).toString('hex'),
        expiresAt: Date.now() + 300000,
        txId: tx.getHash(),
        recipient: data.recipient,
        amountAtomic: amount.toString(),
        feeAtomic: fee.toString(),
        metadata: tx.getMetadata(),
      };
      if (typeof prepared.metadata !== 'string' || !prepared.metadata.length)
        fail('engine');
      const { metadata, ...result } = prepared;
      return result;
    } finally {
      busy = false;
    }
  }
  if (kind === 'cancel') {
    prepared = undefined;
    return true;
  }
  if (kind === 'relay') {
    if (busy) fail('busy');
    const payment = pending || prepared;
    if (!payment || payment.id !== data.id) fail('changed');
    if (!pending && payment.expiresAt < Date.now()) {
      prepared = undefined;
      fail('expired');
    }
    busy = true;
    try {
      if (!pending) {
        persistPending(payment);
        pending = payment;
        prepared = undefined;
        status.pending = publicPayment(payment);
        publish();
      }
      let txId = payment.txId;
      try {
        txId = await wallet.relayTx(payment.metadata);
      } catch {
        if (!(await knownPayment(payment.txId))) fail('pending');
      }
      if (txId !== payment.txId) fail('pending');
      await wallet.save();
      // Intent remains durable until the subsequent scan observes its spent outputs.
      status.synced = false;
      publish();
      return txId;
    } finally {
      busy = false;
    }
  }
  if (kind === 'retry') {
    if (!pending) fail('invalid');
    const { metadata, ...result } = pending;
    return result;
  }
  fail('invalid');
}
let queue = Promise.resolve();
parentPort.on('message', ({ id, kind, data }) => {
  queue = queue.then(async () => {
    try {
      parentPort.postMessage({
        type: 'reply',
        id,
        result: await command(kind, data),
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      parentPort.postMessage({
        type: 'reply',
        id,
        error: [
          'invalid',
          'changed',
          'busy',
          'syncing',
          'insufficient',
          'pending',
          'expired',
          'network',
        ].includes(code)
          ? code
          : 'engine',
      });
    }
  });
});
