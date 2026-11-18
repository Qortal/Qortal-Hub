/* Local-only native payment regression check. No faucet, external coins or
 * production accounts. Requires a separately verified official monerod binary.
 * The SDK adapter changes only network selection to regtest/mainnet format;
 * the production worker, wallet2 crypto, journals and transaction path run intact.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(
  new URL('../electron/package.json', import.meta.url)
);
const sdkPath = require.resolve('monero-ts');
const monero = require(sdkPath);
const binary = process.env.XMR_MONEROD_PATH;
assert(
  binary && path.isAbsolute(binary),
  'Set XMR_MONEROD_PATH to a verified official monerod binary'
);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-xmr-regtest-'));
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, 'src/lib/monero/fixtures/account-v1.json'))
).cases;
const sender = fixture[0].wallet.mainnet;
const receiver = fixture[1].wallet.mainnet;
const faultPath = path.join(temp, 'simulate-lost-broadcast-response');
const adapter = path.join(temp, 'sdk.cjs');
fs.writeFileSync(
  adapter,
  `const fs=require('node:fs'); const sdk=require(${JSON.stringify(sdkPath)});
const fault=()=>fs.existsSync(${JSON.stringify(faultPath)});
const wrap=async wallet=>{const relay=wallet.relayTx.bind(wallet);wallet.relayTx=async value=>{const result=await relay(value);if(fault())throw Error('Simulated lost response');return result};return wallet};
module.exports={...sdk,MoneroNetworkType:{...sdk.MoneroNetworkType,STAGENET:sdk.MoneroNetworkType.MAINNET},
createWalletFull:config=>sdk.createWalletFull({...config,regtest:true}).then(wrap),
openWalletFull:config=>sdk.openWalletFull({...config,regtest:true}).then(wrap),
connectToDaemonRpc:async config=>{const daemon=await sdk.connectToDaemonRpc(config);const get=daemon.getTx.bind(daemon);daemon.getTx=async hash=>{if(fault())throw Error('Simulated unavailable lookup');return get(hash)};return daemon}};`
);
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
const rpcPort = await freePort();
const p2pPort = await freePort();
const url = `http://127.0.0.1:${rpcPort}`;
const daemon = spawn(
  binary,
  [
    '--regtest',
    '--offline',
    '--fixed-difficulty=1',
    '--keep-fakechain',
    '--non-interactive',
    '--rpc-bind-ip=127.0.0.1',
    `--rpc-bind-port=${rpcPort}`,
    '--p2p-bind-ip=127.0.0.1',
    `--p2p-bind-port=${p2pPort}`,
    '--no-zmq',
    '--no-igd',
    '--hide-my-port',
    '--disable-dns-checkpoints',
    `--data-dir=${temp}/chain`,
    `--log-file=${temp}/daemon.log`,
  ],
  {
    stdio: [
      'ignore',
      fs.openSync(temp + '/daemon-stdout.log', 'w'),
      fs.openSync(temp + '/daemon-stderr.log', 'w'),
    ],
  }
);
let worker;
let receiverWallet;
let latest;
let sequence = 0;
const calls = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rpc = async (method, params = {}) => {
  const res = await fetch(url + '/json_rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json();
  assert(!data.error, JSON.stringify(data.error));
  return data.result;
};
const waitFor = async (check, timeout = 120000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(200);
  }
  throw Error('Timed out waiting for regression state');
};
const command = (kind, data = {}) =>
  new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      calls.delete(id);
      reject(Error('Timed out ' + kind));
    }, 90000);
    calls.set(id, { resolve, reject, timer, kind });
    worker.postMessage({ id, kind, data });
  });
const startWorker = async () => {
  latest = null;
  worker = new Worker(
    path.join(root, 'electron/build/src/monero-wallet.worker.js'),
    {
      workerData: {
        input: {
          network: 'stagenet',
          qortalAddress: 'Q' + 'a'.repeat(33),
          address: sender.address,
          privateSpendKey: sender.privateSpendKey,
          restoreHeight: 0,
        },
        directory: temp + '/wallet',
        daemonUrl: url,
        sdkPath: adapter,
      },
      stdout: true,
      stderr: true,
    }
  );
  worker.stdout.resume();
  worker.stderr.resume();
  worker.on('error', (error) => {
    for (const call of calls.values()) {
      clearTimeout(call.timer);
      call.reject(error);
    }
    calls.clear();
  });
  worker.on('message', (message) => {
    if (message.type === 'status') latest = message.status;
    else {
      const call = calls.get(message.id);
      if (!call) return;
      calls.delete(message.id);
      clearTimeout(call.timer);
      message.error
        ? call.reject(Error(call.kind + ':' + message.error))
        : call.resolve(message.result);
    }
  });
  return command('open');
};
try {
  fs.mkdirSync(temp + '/wallet', { mode: 0o700 });
  await waitFor(async () => {
    try {
      return !!(await rpc('get_info')).nettype;
    } catch {
      return false;
    }
  }, 30000);
  console.log('Local regtest daemon ready');
  await rpc('generateblocks', {
    amount_of_blocks: 160,
    wallet_address: sender.address,
  });
  await startWorker();
  await waitFor(() => latest?.synced && !latest.syncing);
  assert(BigInt(latest.unlockedBalanceAtomic) > 1000000000000n);
  console.log('Native worker scanned locally generated spendable funds');
  const draft = await command('prepare', {
    recipient: receiver.address,
    amountAtomic: '100000000001',
    maxFeeAtomic: '10000000000',
  });
  assert.equal(draft.amountAtomic, '100000000001');
  assert(!('metadata' in draft));
  assert(!('privateSpendKey' in draft));
  console.log('Prepared payment');
  fs.writeFileSync(faultPath, 'synthetic test only');
  await assert.rejects(command('relay', { id: draft.id }), /pending/);
  assert(fs.existsSync(temp + '/wallet/pending-payment'));
  const journal = fs.readFileSync(temp + '/wallet/pending-payment');
  assert(!journal.includes(Buffer.from(draft.txId)));
  assert(!journal.includes(Buffer.from(sender.privateSpendKey)));
  await assert.rejects(
    command('prepare', {
      recipient: receiver.address,
      amountAtomic: '1',
      maxFeeAtomic: '10000000000',
    }),
    /pending/
  );
  console.log('Lost response retained encrypted pending intent');
  await worker.terminate();
  worker = undefined;
  console.log('Reopening worker');
  const reopened = await startWorker();
  assert.equal(reopened.pending.txId, draft.txId);
  const retry = await command('retry');
  assert.equal(retry.txId, draft.txId);
  assert.equal(retry.id, draft.id);
  console.log('Recovered same pending transaction');
  await waitFor(() => latest?.synced && !latest.syncing && latest.pending);
  fs.unlinkSync(faultPath);
  assert.equal(await command('relay', { id: retry.id }), draft.txId);
  console.log('Rebroadcast same transaction');
  await rpc('generateblocks', {
    amount_of_blocks: 12,
    wallet_address: sender.address,
  });
  await waitFor(() => latest?.synced && !latest.syncing && !latest.pending);
  const outgoing = latest.transactions.find((tx) => tx.txId === draft.txId);
  assert(outgoing);
  assert.equal(outgoing.amountAtomic, '100000000001');
  assert.equal(outgoing.incoming, false);
  receiverWallet = await monero.createWalletFull({
    networkType: monero.MoneroNetworkType.MAINNET,
    regtest: true,
    privateSpendKey: receiver.privateSpendKey,
    restoreHeight: 0,
    proxyToWorker: false,
  });
  await receiverWallet.setDaemonConnection(url, false);
  await receiverWallet.sync();
  assert.equal((await receiverWallet.getBalance()).toString(), '100000000001');
  console.log(
    JSON.stringify(
      {
        status: 'passed',
        scope:
          'production worker + real wallet2 and offline monerod; regtest network adapter only',
        checks: [
          'scan locally mined funds',
          'sign 12-decimal payment',
          'enforce pending intent',
          'simulate lost relay response',
          'encrypted journal survives worker restart',
          'rebroadcast same hash only',
          'observe spent state and clear intent',
          'recipient receives exact amount',
        ],
        txId: draft.txId,
        feeAtomic: draft.feeAtomic,
      },
      null,
      2
    )
  );
} finally {
  if (worker) await worker.terminate();
  if (receiverWallet) await receiverWallet.close();
  for (const call of calls.values()) {
    clearTimeout(call.timer);
    call.reject(Error('Closed'));
  }
  calls.clear();
  daemon.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => daemon.once('exit', resolve)),
    sleep(10000).then(() => daemon.kill('SIGKILL')),
  ]);
  for (const name of ['daemon.log', 'daemon-stdout.log', 'daemon-stderr.log']) {
    if (fs.existsSync(temp + '/' + name) && process.env.XMR_REGTEST_REPORT_DIR)
      fs.copyFileSync(
        temp + '/' + name,
        path.join(process.env.XMR_REGTEST_REPORT_DIR, name)
      );
  }
  fs.rmSync(temp, { recursive: true, force: true });
}
