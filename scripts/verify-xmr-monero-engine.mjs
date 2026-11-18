/* Offline interoperability check using public synthetic fixtures only.
 * Install monero-ts@0.11.22 in an isolated directory and set XMR_MONERO_TS_PATH
 * to that package directory; it is not a production Hub dependency yet.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';

const blockNetwork = () => {
  throw new Error('Network access forbidden in XMR account verification');
};
http.request = blockNetwork;
https.request = blockNetwork;
globalThis.fetch = blockNetwork;
const loadPackage = createRequire(import.meta.url);
const monero = loadPackage(process.env.XMR_MONERO_TS_PATH || 'monero-ts');
const fixtures = JSON.parse(
  fs.readFileSync(
    new URL('../src/lib/monero/fixtures/account-v1.json', import.meta.url)
  )
);

(async () => {
  assert.equal(monero.MoneroUtils.getVersion(), '0.11.22');
  await monero.LibraryUtils.setLogLevel(0);
  let checked = 0;
  for (const fixture of fixtures.cases) {
    for (const network of ['mainnet', 'stagenet']) {
      const expected = fixture.wallet[network];
      const wallet = await monero.createWalletFull({
        networkType:
          network === 'mainnet'
            ? monero.MoneroNetworkType.MAINNET
            : monero.MoneroNetworkType.STAGENET,
        privateSpendKey: expected.privateSpendKey,
        password: 'public-unfunded-interoperability-fixture',
        restoreHeight: 0,
        proxyToWorker: false,
      });
      try {
        assert.equal(await wallet.getPrimaryAddress(), expected.address);
        assert.equal(await wallet.getPrivateViewKey(), expected.privateViewKey);
        assert.equal(
          await wallet.getPrivateSpendKey(),
          expected.privateSpendKey
        );
        assert.equal(await wallet.getPublicSpendKey(), expected.publicSpendKey);
        assert.equal(await wallet.getPublicViewKey(), expected.publicViewKey);
        assert.equal(await wallet.getBalance(), 0n);
        checked++;
      } finally {
        await wallet.close();
      }
    }
  }
  console.log(
    JSON.stringify(
      {
        status: 'passed',
        library: 'monero-ts@0.11.22',
        accountNetworkVectors: checked,
        networkAccess: 'blocked',
        scope: 'Public synthetic keys; no scan, payment or funds',
      },
      null,
      2
    )
  );
})().catch(() => {
  // Assert failures may contain fixture key values. Report a public failure
  // without making this script a pattern for printing real wallet secrets.
  console.error('XMR account interoperability verification failed');
  process.exitCode = 1;
});
