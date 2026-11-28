import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import i18n from '../../../i18n/i18n';
import { shortAddress as s } from '../../../lib/explorer/addresses';
import { formatAmountExact } from '../../../lib/explorer/format';
import { NULL_ACCOUNT, type TxRow } from '../../../lib/explorer/reads';
import { ALL_TX_TYPES } from '../../../lib/explorer/txFamilies';
import { describeTx, type TxField } from '../../../lib/explorer/txWords';
import { sentenceText, slotText } from './sentenceText';

// Each transaction type in words, told from each side, as an English
// reader sees it (Q-Mintership+'s cases), and every sentence complete in
// every language.

const A = `Q${'P'.repeat(33)}`;
const B = `Q${'S'.repeat(33)}`;
const C = `Q${'T'.repeat(33)}`;
const D = `Q${'F'.repeat(33)}`;
const AT_ADDR = `A${'T'.repeat(33)}`;
const SIG = '5'.repeat(88);
const PENDING_SIG = '6'.repeat(88);
const ORDER = '7'.repeat(88);

const original = i18n.language;
beforeAll(() => i18n.changeLanguage('en'));
afterAll(() => i18n.changeLanguage(original));

function row(type: string, extra: Record<string, unknown> = {}): TxRow {
  return {
    type,
    timestamp: 1_700_000_000_000,
    reference: '8'.repeat(88),
    fee: '0.01000000',
    signature: SIG,
    txGroupId: 0,
    blockHeight: 2_000_000,
    approvalStatus: 'NOT_REQUIRED',
    creatorAddress: A,
    ...extra,
  } as TxRow;
}

const t = (key: string, options?: Record<string, unknown>) =>
  String(i18n.t(key, options));

/** The sentence from `viewpoint` (none when left out), with its approval note. */
function say(tx: TxRow, viewpoint?: string, privsRecipient?: string | null) {
  const words = describeTx(tx, { viewpoint, privsRecipient });
  const text = sentenceText(words.sentence, i18n.t, 'en');
  return words.outcome
    ? `${text} ${t(`explorer:tx.outcome.${words.outcome}`)}`
    : text;
}
const dir = (tx: TxRow, viewpoint?: string, privsRecipient?: string | null) =>
  describeTx(tx, { viewpoint, privsRecipient }).direction;

function valueText(value: TxField['value']): string {
  switch (value.kind) {
    case 'sentence':
      return sentenceText(value.sentence, i18n.t, 'en');
    case 'word':
      return t(`explorer:tx.value.${value.key}`);
    case 'approval':
      return t(`explorer:tx.approval.${value.key.toLowerCase()}`);
    case 'raw':
      return value.text;
    case 'decimal':
      return formatAmountExact(value.text, 'en');
    case 'size':
      return `${value.bytes} bytes`;
    case 'option':
      return t('explorer:tx.value.option', { n: value.number });
    case 'texts':
      return value.texts.join(', ');
    case 'price':
      return `${value.amount} ${value.pair ?? ''}`.trim();
    case 'flags':
      return t('explorer:tx.value.flags', value);
    default:
      return slotText(value, i18n.t, 'en');
  }
}

/** The fields as label → value, in English. */
function fields(tx: TxRow, viewpoint?: string) {
  return Object.fromEntries(
    describeTx(tx, { viewpoint }).fields.map((f) => [
      t(`explorer:tx.field.${f.label}`),
      valueText(f.value),
    ])
  );
}

describe('payments', () => {
  const pay = row('PAYMENT', { recipient: B, amount: '15.00000000' });

  it('PAYMENT from each side', () => {
    expect(say(pay, A)).toBe(`Sent 15 QORT to ${s(B)}`);
    expect(dir(pay, A)).toBe('out');
    expect(say(pay, B)).toBe(`Received 15 QORT from ${s(A)}`);
    expect(dir(pay, B)).toBe('in');
    expect(say(pay)).toBe(`${s(A)} sent 15 QORT to ${s(B)}`);
    expect(dir(pay)).toBe('none');
    expect(say(pay, C)).toBe(`${s(A)} sent 15 QORT to ${s(B)}`);
    expect(dir(pay, C)).toBe('none');
    expect(describeTx(pay, { viewpoint: A }).participants).toEqual([A, B]);
    expect(fields(pay)).toEqual({ amount: '15 QORT', recipient: s(B) });
  });

  it('PAYMENT to itself', () => {
    const self = row('PAYMENT', { recipient: A, amount: '1.5' });
    expect(say(self, A)).toBe('Sent 1.5 QORT to itself');
    expect(dir(self, A)).toBe('self');
    expect(say(self)).toBe(`${s(A)} sent 1.5 QORT to itself`);
    expect(describeTx(self).participants).toEqual([A]);
  });

  it('keeps every decimal of an amount, in the reader’s language', () => {
    const big = row('PAYMENT', { recipient: B, amount: '637557960.49687541' });
    expect(say(big, A)).toBe(`Sent 637,557,960.49687541 QORT to ${s(B)}`);
    const words = describeTx(big, { viewpoint: A });
    expect(sentenceText(words.sentence, i18n.getFixedT('de'), 'de')).toContain(
      '637.557.960,49687541 QORT'
    );
  });

  it('TRANSFER_ASSET in QORT and in another asset', () => {
    const qort = row('TRANSFER_ASSET', {
      recipient: B,
      amount: '2.50000000',
      assetId: 0,
    });
    expect(say(qort, A)).toBe(`Sent 2.5 QORT to ${s(B)}`);
    expect(say(qort, B)).toBe(`Received 2.5 QORT from ${s(A)}`);
    const named = row('TRANSFER_ASSET', {
      recipient: B,
      amount: '3.00000000',
      assetId: 90,
      assetName: 'Sample',
    });
    expect(say(named, A)).toBe(`Sent 3 Sample to ${s(B)}`);
    expect(fields(named)).toEqual({
      amount: '3 Sample',
      asset: '#90',
      recipient: s(B),
    });
    const unnamed = row('TRANSFER_ASSET', {
      recipient: B,
      amount: '1',
      assetId: 7,
    });
    expect(say(unnamed, B)).toBe(`Received 1 asset #7 from ${s(A)}`);
  });

  it('MULTI_PAYMENT from the payer, a recipient and nobody', () => {
    const multi = row('MULTI_PAYMENT', {
      payments: [
        { recipient: B, assetId: 0, amount: '2.00000000' },
        { recipient: C, assetId: 0, amount: '4.00000000' },
        { recipient: D, assetId: 0, amount: '6.00000000' },
      ],
    });
    expect(say(multi, A)).toBe('Paid 3 accounts 12 QORT in one payment');
    expect(dir(multi, A)).toBe('out');
    expect(say(multi, B)).toBe(
      `Received 2 QORT from ${s(A)} in a payment to 3 accounts`
    );
    expect(dir(multi, B)).toBe('in');
    expect(say(multi)).toBe(`${s(A)} paid 3 accounts 12 QORT in one payment`);
    expect(describeTx(multi).participants).toEqual([A, B, C, D]);
    expect(Object.values(fields(multi))).toEqual([`6 QORT to ${s(D)}`]);
    expect(describeTx(multi).fields.map((f) => valueText(f.value))).toEqual([
      `2 QORT to ${s(B)}`,
      `4 QORT to ${s(C)}`,
      `6 QORT to ${s(D)}`,
    ]);
  });

  it('MULTI_PAYMENT to one account reads as a payment, its assets as a list', () => {
    const multi = row('MULTI_PAYMENT', {
      payments: [
        { recipient: B, assetId: 0, amount: '0.1' },
        { recipient: B, assetId: 0, amount: '0.2' },
        { recipient: B, assetId: 5, amount: '1' },
      ],
    });
    expect(say(multi, A)).toBe(`Sent 0.3 QORT and 1 asset #5 to ${s(B)}`);
    expect(say(multi, B)).toBe(`Received 0.3 QORT and 1 asset #5 from ${s(A)}`);
  });
});

describe('names', () => {
  it('REGISTER_NAME', () => {
    const tx = row('REGISTER_NAME', { name: 'Example', data: 'Hello' });
    expect(say(tx, A)).toBe('Registered the name “Example”');
    expect(dir(tx, A)).toBe('self');
    expect(say(tx)).toBe(`${s(A)} registered the name “Example”`);
    expect(dir(tx, B)).toBe('none');
    expect(fields(tx)).toEqual({ name: 'Example', data: 'Hello' });
  });

  it('UPDATE_NAME: a rename, or new details', () => {
    const rename = row('UPDATE_NAME', { name: 'foo', newName: 'bar' });
    expect(say(rename, A)).toBe('Renamed “foo” to “bar”');
    expect(say(rename)).toBe(`${s(A)} renamed “foo” to “bar”`);
    expect(fields(rename)).toEqual({ name: 'foo', 'new name': 'bar' });
    const details = row('UPDATE_NAME', {
      name: 'foo',
      newName: '',
      newData: '{"a":1}',
    });
    expect(say(details, A)).toBe('Updated the details of the name “foo”');
    expect(fields(details)).toEqual({ name: 'foo', 'new data': '{"a":1}' });
    expect(say(row('UPDATE_NAME', { name: 'foo', newName: 'foo' }), A)).toBe(
      'Updated the details of the name “foo”'
    );
  });

  it('SELL_NAME and CANCEL_SELL_NAME', () => {
    const sell = row('SELL_NAME', { name: 'foo', amount: '5.00000000' });
    expect(say(sell, A)).toBe('Listed the name “foo” for sale at 5 QORT');
    expect(say(sell)).toBe(`${s(A)} listed the name “foo” for sale at 5 QORT`);
    expect(dir(sell, A)).toBe('self');
    expect(fields(sell)).toEqual({ name: 'foo', price: '5 QORT' });
    const cancel = row('CANCEL_SELL_NAME', { name: 'foo' });
    expect(say(cancel, A)).toBe('Took the name “foo” off sale');
  });

  it('BUY_NAME from the buyer, the seller and nobody', () => {
    const buy = row('BUY_NAME', {
      name: 'foo',
      amount: '1.00000000',
      seller: B,
    });
    expect(say(buy, A)).toBe(`Bought the name “foo” from ${s(B)} for 1 QORT`);
    expect(dir(buy, A)).toBe('out');
    expect(say(buy, B)).toBe(`Sold the name “foo” to ${s(A)} for 1 QORT`);
    expect(dir(buy, B)).toBe('in');
    expect(say(buy)).toBe(
      `${s(A)} bought the name “foo” from ${s(B)} for 1 QORT`
    );
    expect(fields(buy)).toEqual({
      name: 'foo',
      price: '1 QORT',
      seller: s(B),
    });
  });

  it('shows characters a reader can’t see', () => {
    const tx = row('REGISTER_NAME', { name: 'a\u200Bb' });
    expect(say(tx, A)).toBe('Registered the name “a·b”');
  });
});

describe('minting', () => {
  it('REWARD_SHARE: a self-share started and removed', () => {
    const start = row('REWARD_SHARE', { recipient: A, sharePercent: '0.00' });
    expect(say(start, A)).toBe('Started minting (a self-share)');
    expect(dir(start, A)).toBe('self');
    expect(say(start)).toBe(`${s(A)} started minting (a self-share)`);
    expect(describeTx(start).participants).toEqual([A]);
    const stop = row('REWARD_SHARE', { recipient: A, sharePercent: '-1.00' });
    expect(say(stop, A)).toBe('Stopped minting (removed its self-share)');
    expect(fields(stop)).toEqual({ share: 'removed' });
  });

  it('REWARD_SHARE with another account, from each side', () => {
    const share = row('REWARD_SHARE', { recipient: B, sharePercent: '5.50' });
    expect(say(share, A)).toBe(`Started a reward share with ${s(B)} at 5.5%`);
    expect(dir(share, A)).toBe('out');
    expect(say(share, B)).toBe(
      `${s(A)} started a reward share with this account at 5.5%`
    );
    expect(dir(share, B)).toBe('in');
    expect(say(share)).toBe(
      `${s(A)} started a reward share with ${s(B)} at 5.5%`
    );
    expect(fields(share)).toEqual({ recipient: s(B), share: '5.5%' });
    const removed = row('REWARD_SHARE', {
      recipient: B,
      sharePercent: '-1000000.00',
    });
    expect(say(removed, A)).toBe(`Removed the reward share with ${s(B)}`);
    expect(say(removed, B)).toBe(
      `${s(A)} removed its reward share with this account`
    );
  });

  it('TRANSFER_PRIVS with the recipient read from the raw bytes', () => {
    const move = row('TRANSFER_PRIVS');
    expect(say(move, A, C)).toBe(`Moved its minting level to ${s(C)}`);
    expect(dir(move, A, C)).toBe('out');
    expect(say(move, C, C)).toBe(`Got its minting level from ${s(A)}`);
    expect(dir(move, C, C)).toBe('in');
    expect(say(move, undefined, C)).toBe(
      `${s(A)} moved its minting level to ${s(C)}`
    );
    expect(describeTx(move, { privsRecipient: C }).participants).toEqual([
      A,
      C,
    ]);
  });

  it('TRANSFER_PRIVS before the recipient is known', () => {
    const move = row('TRANSFER_PRIVS');
    expect(say(move, A)).toBe('Moved its minting level to another account');
    expect(dir(move, A)).toBe('out');
    expect(say(move)).toBe(
      `${s(A)} moved its minting level to another account`
    );
    expect(describeTx(move).fields).toEqual([]);
  });

  it('ACCOUNT_FLAGS and ACCOUNT_LEVEL in the genesis block', () => {
    const flags = row('ACCOUNT_FLAGS', {
      creatorAddress: NULL_ACCOUNT,
      blockHeight: 1,
      target: B,
      andMask: -1,
      orMask: 1,
      xorMask: 0,
    });
    expect(say(flags, B)).toBe(
      'Its account flags were set in the genesis block'
    );
    expect(dir(flags, B)).toBe('in');
    expect(say(flags)).toBe(
      `The account flags of ${s(B)} were set in the genesis block`
    );
    expect(describeTx(flags).participants).toEqual([B]);
    expect(fields(flags)).toEqual({
      account: s(B),
      change: 'AND -1, OR 1, XOR 0',
    });
    const level = row('ACCOUNT_LEVEL', {
      creatorAddress: NULL_ACCOUNT,
      blockHeight: 1,
      target: B,
      level: 5,
    });
    expect(say(level, B)).toBe('Its level was set to 5 in the genesis block');
    expect(say(level)).toBe(
      `The level of ${s(B)} was set to 5 in the genesis block`
    );
  });

  it('says nothing of the genesis block for one made later', () => {
    const level = row('ACCOUNT_LEVEL', { target: B, level: 3 });
    expect(say(level, A)).toBe('Made a transaction: account level');
    expect(say(level)).toBe(`${s(A)} made a transaction: account level`);
    const orphan = row('ACCOUNT_FLAGS', {
      creatorAddress: NULL_ACCOUNT,
      blockHeight: 5,
      target: B,
    });
    expect(say(orphan)).toBe('A transaction: account flags');
    const noLevel = row('ACCOUNT_LEVEL', {
      creatorAddress: NULL_ACCOUNT,
      blockHeight: 1,
      target: B,
    });
    expect(say(noLevel, B)).toBe('A transaction: account level');
  });

  it('ENABLE_FORGING', () => {
    const tx = row('ENABLE_FORGING', { target: B });
    expect(say(tx, A)).toBe(`Enabled forging for ${s(B)}`);
    expect(say(tx, B)).toBe(`${s(A)} enabled forging for this account`);
    expect(say(row('ENABLE_FORGING'))).toBe(`${s(A)} enabled forging`);
  });
});

describe('QDN', () => {
  it('ARBITRARY: a public resource says what and where', () => {
    const tx = row('ARBITRARY', {
      service: 1000,
      name: 'Publisher',
      identifier: 'default',
      size: 240,
      data: 'HASHDATA',
      secret: 'SECRETKEY',
      payments: [],
    });
    expect(say(tx, A)).toBe('Published an app as “Publisher”');
    expect(dir(tx, A)).toBe('self');
    expect(say(tx)).toBe(`${s(A)} published an app as “Publisher”`);
    expect(fields(tx)).toEqual({
      service: 'APP',
      name: 'Publisher',
      identifier: 'default',
      size: '240 bytes',
    });
    const json = JSON.stringify(describeTx(tx));
    expect(json).not.toContain('HASHDATA');
    expect(json).not.toContain('SECRETKEY');
    expect(say(row('ARBITRARY', { service: 500, name: 'v' }), A)).toBe(
      'Published a video as “v”'
    );
  });

  it('ARBITRARY: an encrypted resource keeps its identifier to itself', () => {
    const tx = row('ARBITRARY', {
      service: 1901,
      name: 'Publisher',
      identifier: 'qortal_qmail_thread',
      size: 4000,
      data: 'HASHDATA',
    });
    expect(say(tx, A)).toBe('Published an encrypted resource as “Publisher”');
    expect(fields(tx)).toEqual({ service: 'MAIL_PRIVATE' });
    const json = JSON.stringify(describeTx(tx, { viewpoint: A }));
    expect(json).not.toContain('qortal_qmail');
    expect(json).not.toContain('HASHDATA');
    const mail = row('ARBITRARY', {
      service: 1900,
      name: 'n',
      identifier: 'mail_x',
    });
    expect(say(mail, A)).toBe('Published an encrypted resource as “n”');
    expect(JSON.stringify(describeTx(mail))).not.toContain('mail_x');
  });

  it('ARBITRARY with a payment, from the recipient', () => {
    const tx = row('ARBITRARY', {
      service: 1110,
      name: 'shop',
      identifier: 'order-1',
      payments: [{ recipient: B, assetId: 0, amount: '1.00000000' }],
    });
    expect(say(tx, B)).toBe(`Received 1 QORT from ${s(A)} with a QDN publish`);
    expect(dir(tx, B)).toBe('in');
    expect(say(tx, A)).toBe('Published JSON data as “shop”');
    expect(dir(tx, A)).toBe('out');
  });

  it('ARBITRARY without a name or a known service', () => {
    const tx = row('ARBITRARY', { service: 4242 });
    expect(say(tx, A)).toBe('Published a QDN resource');
    expect(fields(tx)).toEqual({ service: 'SERVICE_4242' });
  });
});

describe('messages', () => {
  const secret = 'meet me at the usual place';

  it('MESSAGE: who to whom, never what it said', () => {
    const tx = row('MESSAGE', {
      recipient: B,
      amount: '0.00000000',
      data: secret,
      isText: true,
      isEncrypted: false,
    });
    expect(say(tx, A)).toBe(`Sent a message to ${s(B)}`);
    expect(dir(tx, A)).toBe('out');
    expect(say(tx, B)).toBe(`Received a message from ${s(A)}`);
    expect(say(tx)).toBe(`${s(A)} sent a message to ${s(B)}`);
    expect(fields(tx)).toEqual({ encrypted: 'no' });
    for (const viewpoint of [A, B, undefined])
      expect(JSON.stringify(describeTx(tx, { viewpoint }))).not.toContain(
        secret
      );
  });

  it('MESSAGE with QORT attached', () => {
    const paid = row('MESSAGE', {
      recipient: B,
      amount: '5.00000000',
      assetId: 0,
      isEncrypted: true,
    });
    expect(say(paid, A)).toBe(`Sent a message with 5 QORT to ${s(B)}`);
    expect(say(paid, B)).toBe(`Received a message with 5 QORT from ${s(A)}`);
    expect(fields(paid)).toEqual({ encrypted: 'yes' });
  });

  it('CHAT: to an account or to a group, never what it said or which group', () => {
    const direct = row('CHAT', {
      recipient: B,
      data: secret,
      isEncrypted: true,
    });
    expect(say(direct, A)).toBe(`Sent a chat message to ${s(B)}`);
    expect(say(direct, B)).toBe(`Received a chat message from ${s(A)}`);
    expect(say(direct)).toBe(`${s(A)} sent a chat message to ${s(B)}`);
    const toGroup = row('CHAT', { txGroupId: 4242, data: secret });
    expect(say(toGroup, A)).toBe('Sent a chat message to a group');
    expect(dir(toGroup, A)).toBe('self');
    const json = JSON.stringify(describeTx(toGroup));
    expect(json).not.toContain(secret);
    expect(json).not.toContain('4242');
  });
});

describe('trading and contracts', () => {
  it('AT: an automated contract pays out', () => {
    const tx = row('AT', {
      creatorAddress: NULL_ACCOUNT,
      atAddress: AT_ADDR,
      recipient: B,
      amount: '1.00000000',
      assetId: 0,
    });
    expect(say(tx)).toBe(`${s(AT_ADDR)} sent 1 QORT to ${s(B)}`);
    expect(say(tx, B)).toBe(`Received 1 QORT from ${s(AT_ADDR)}`);
    expect(dir(tx, B)).toBe('in');
    expect(say(tx, AT_ADDR)).toBe(`Sent 1 QORT to ${s(B)}`);
    expect(dir(tx, AT_ADDR)).toBe('out');
    expect(describeTx(tx).participants).toEqual([AT_ADDR, B]);
    expect(fields(tx)).toEqual({ 'AT (automated contract)': s(AT_ADDR) });
  });

  it('AT with no payment', () => {
    const tx = row('AT', {
      creatorAddress: NULL_ACCOUNT,
      atAddress: AT_ADDR,
      recipient: B,
    });
    expect(say(tx)).toBe(`${s(AT_ADDR)} sent a message to ${s(B)}`);
    expect(say(tx, B)).toBe(`Received a message from ${s(AT_ADDR)}`);
  });

  it('DEPLOY_AT', () => {
    const tx = row('DEPLOY_AT', {
      name: 'QORT/ARRR ACCT',
      description: 'QORT/ARRR cross-chain trade',
      aTType: 'ACCT',
      tags: 'ACCT QORT ARRR',
      amount: '300.01000000',
      assetId: 0,
      aTAddress: AT_ADDR,
      creationBytes: 'BYTES',
    });
    expect(say(tx, A)).toBe('Created an AT (automated contract)');
    expect(dir(tx, A)).toBe('out');
    expect(say(tx)).toBe(`${s(A)} created an AT (automated contract)`);
    expect(say(tx, AT_ADDR)).toBe(
      `${s(A)} created this AT (automated contract)`
    );
    expect(fields(tx)).toEqual({
      'AT name': 'QORT/ARRR ACCT',
      description: 'QORT/ARRR cross-chain trade',
      kind: 'ACCT',
      tags: 'ACCT QORT ARRR',
      'AT address': s(AT_ADDR),
      'funded with': '300.01 QORT',
    });
    expect(JSON.stringify(describeTx(tx))).not.toContain('BYTES');
  });

  it('reads the genesis ISSUE_ASSET of QORT as a sentence, not “an unknown account …”', () => {
    // Block 1 issues QORT, Legacy-QORA and QORT-from-QORA, made by Core's null account.
    const genesisIssue = row('ISSUE_ASSET', {
      timestamp: 1_593_450_000_000,
      fee: '0.00000000',
      blockHeight: 1,
      creatorAddress: NULL_ACCOUNT,
      assetId: 0,
      assetName: 'QORT',
      description: 'QORT native coin',
      quantity: '0.00000000',
      isDivisible: true,
      isUnspendable: false,
    });
    const text = sentenceText(describeTx(genesisIssue).sentence, i18n.t, 'en');
    expect(text[0]).toBe(text[0].toUpperCase());
    expect(text).not.toMatch(/unknown account/);
    expect(text).toBe('The asset “QORT” was issued');
    expect(say(genesisIssue, A)).toBe('The asset “QORT” was issued');
    expect(describeTx(genesisIssue).participants).toEqual([]);
  });

  it('reads one whose maker it can’t name as a transaction, never “an unknown account …”', () => {
    for (const creatorAddress of [NULL_ACCOUNT, undefined]) {
      const tx = row('REGISTER_NAME', { creatorAddress, name: 'Example' });
      const text = say(tx, A);
      expect(text).toMatch(/^A transaction: /);
      expect(text).not.toMatch(/unknown account/);
      expect(describeTx(tx, { viewpoint: A }).participants).toEqual([]);
    }
  });

  it('ISSUE_ASSET, UPDATE_ASSET and asset orders', () => {
    const issue = row('ISSUE_ASSET', {
      assetId: 92,
      assetName: 'Metal',
      description: 'MTL',
      quantity: '9999999.00000000',
      isDivisible: true,
    });
    expect(say(issue, A)).toBe('Issued the asset “Metal”');
    expect(fields(issue)).toEqual({
      asset: '#92',
      quantity: '9,999,999',
      divisible: 'yes',
      description: 'MTL',
    });
    // Every decimal of the quantity, as Core wrote it.
    const exact = row('ISSUE_ASSET', {
      assetId: 93,
      assetName: 'Metal',
      quantity: '9007199254740993.12345678',
      isDivisible: true,
    });
    expect(fields(exact).quantity).toBe('9,007,199,254,740,993.12345678');
    const order = row('CREATE_ASSET_ORDER', {
      haveAssetId: 28,
      haveAssetName: 'TKN',
      wantAssetId: 0,
      amount: '100.00000000',
      price: '55.00000000',
      amountAssetId: 28,
      amountAssetName: 'TKN',
      pricePair: 'QORT/TKN',
    });
    expect(say(order, A)).toBe('Placed an order to trade TKN for QORT');
    expect(fields(order)).toEqual({
      amount: '100 TKN',
      price: '55.00000000 QORT/TKN',
    });
    const cancel = row('CANCEL_ASSET_ORDER', { orderId: ORDER });
    expect(say(cancel, A)).toBe('Cancelled an asset order');
    expect(describeTx(cancel).fields).toEqual([
      { label: 'order', value: { kind: 'tx', signature: ORDER } },
    ]);
    const update = row('UPDATE_ASSET', {
      assetId: 28,
      newOwner: A,
      newDescription: 'Metal',
    });
    expect(say(update, A)).toBe('Updated the asset #28');
    const handover = row('UPDATE_ASSET', { assetId: 28, newOwner: B });
    expect(say(handover, A)).toBe(`Gave the asset #28 to ${s(B)}`);
    expect(say(handover, B)).toBe(`${s(A)} gave the asset #28 to this account`);
    expect(dir(handover, B)).toBe('in');
  });
});

describe('a transaction still waiting for a block', () => {
  // Core gives a new asset its number, and a new group its number, only when
  // a block takes the transaction: the JSON has no `assetId` / `groupId` yet
  // (its name is there: `assetName`, `groupName`).
  const waiting = (type: string, extra: Record<string, unknown>) => {
    const tx = row(type, extra);
    delete tx.blockHeight;
    return tx;
  };

  it('names the asset an ISSUE_ASSET issues, not QORT', () => {
    const issue = waiting('ISSUE_ASSET', {
      issuerPublicKey: 'k'.repeat(44),
      assetName: 'Example Coin',
      description: 'An example',
      quantity: '1000.00000000',
      isDivisible: true,
      data: '',
      isUnspendable: false,
    });
    expect(say(issue, A)).toBe('Issued the asset “Example Coin”');
    expect(say(issue)).toBe(`${s(A)} issued the asset “Example Coin”`);
    // No number yet: no asset field (never "#0").
    expect(fields(issue).asset).toBeUndefined();
    expect(fields(issue).quantity).toBe('1,000');
  });

  it('names the group a CREATE_GROUP creates', () => {
    const create = waiting('CREATE_GROUP', {
      creatorPublicKey: 'k'.repeat(44),
      groupName: 'Example Group',
      description: 'An example',
      isOpen: true,
      approvalThreshold: 'ONE',
      minimumBlockDelay: 5,
      maximumBlockDelay: 60,
    });
    expect(say(create, A)).toContain('Example Group');
    expect(say(create, A)).toBe('Created the group Example Group');
    expect(say(create)).not.toMatch(/\?|#/);
  });
});

describe('groups', () => {
  const minter = (type: string, extra: Record<string, unknown>) =>
    row(type, {
      groupId: 694,
      txGroupId: 694,
      approvalStatus: 'APPROVED',
      ...extra,
    });

  it('GROUP_INVITE: who, whom and which group', () => {
    const tx = minter('GROUP_INVITE', { invitee: B, timeToLive: 864_000 });
    expect(say(tx, A)).toBe(`Invited ${s(B)} to the group MINTER`);
    expect(dir(tx, A)).toBe('out');
    expect(say(tx, B)).toBe(`${s(A)} invited this account to the group MINTER`);
    expect(dir(tx, B)).toBe('in');
    expect(say(tx)).toBe(`${s(A)} invited ${s(B)} to the group MINTER`);
    expect(fields(tx)).toEqual({
      group: 'MINTER',
      invitee: s(B),
      'group approval': 'approved',
    });
    expect(JSON.stringify(describeTx(tx, { viewpoint: B }))).not.toMatch(
      /864|time ?to ?live|txGroupId/i
    );
  });

  it('a group change still waiting, rejected or not approved in time is a proposal', () => {
    const waiting = minter('GROUP_INVITE', {
      invitee: B,
      approvalStatus: 'PENDING',
    });
    expect(say(waiting, A)).toBe(
      `Proposed to invite ${s(B)} to the group MINTER (waiting for group approval)`
    );
    expect(say(waiting, B)).toBe(
      `${s(A)} proposed to invite this account to the group MINTER (waiting for group approval)`
    );
    expect(fields(waiting)['group approval']).toBe('waiting for approvals');
    const rejected = minter('GROUP_KICK', {
      member: B,
      approvalStatus: 'REJECTED',
    });
    expect(say(rejected)).toBe(
      `${s(A)} proposed to remove ${s(B)} from the group MINTER (rejected in group approval)`
    );
    const expired = minter('GROUP_BAN', {
      offender: B,
      approvalStatus: 'EXPIRED',
    });
    expect(say(expired, A)).toBe(
      `Proposed to ban ${s(B)} from the group MINTER (not approved in time)`
    );
  });

  it('a waiting transaction of another type says so, as it is', () => {
    const tx = row('REGISTER_NAME', {
      name: 'example',
      txGroupId: 694,
      approvalStatus: 'PENDING',
    });
    expect(say(tx, A)).toBe(
      'Registered the name “example” (waiting for group approval)'
    );
  });

  it('CANCEL_GROUP_INVITE, which Core’s JSON doesn’t name a group for', () => {
    const bare = row('CANCEL_GROUP_INVITE', {
      txGroupId: 694,
      approvalStatus: 'APPROVED',
    });
    expect(say(bare, A)).toBe('Cancelled a group invite');
    expect(say(bare)).toBe(`${s(A)} cancelled a group invite`);
    expect(say({ ...bare, approvalStatus: 'PENDING' }, A)).toBe(
      'Proposed to cancel a group invite (waiting for group approval)'
    );
  });

  it('GROUP_KICK with its reason; CANCEL_GROUP_BAN', () => {
    const kick = minter('GROUP_KICK', { member: B, reason: 'Not minting' });
    expect(say(kick, A)).toBe(`Removed ${s(B)} from the group MINTER`);
    expect(say(kick, B)).toBe(
      `${s(A)} removed this account from the group MINTER`
    );
    expect(fields(kick)).toEqual({
      group: 'MINTER',
      member: s(B),
      reason: 'Not minting',
      'group approval': 'approved',
    });
    const lift = minter('CANCEL_GROUP_BAN', { member: B });
    expect(say(lift, A)).toBe(`Lifted the ban on ${s(B)} in the group MINTER`);
    expect(say(lift, B)).toBe(
      `${s(A)} lifted this account's ban in the group MINTER`
    );
  });

  it('ADD_GROUP_ADMIN and REMOVE_GROUP_ADMIN, for others and for itself', () => {
    const add = minter('ADD_GROUP_ADMIN', { member: B });
    expect(say(add, A)).toBe(`Made ${s(B)} an admin of the group MINTER`);
    expect(say(add, B)).toBe(
      `${s(A)} made this account an admin of the group MINTER`
    );
    const own = minter('ADD_GROUP_ADMIN', { member: A });
    expect(say(own, A)).toBe('Became an admin of the group MINTER');
    expect(dir(own, A)).toBe('self');
    const ownWaiting = minter('ADD_GROUP_ADMIN', {
      member: A,
      approvalStatus: 'PENDING',
    });
    expect(say(ownWaiting)).toBe(
      `${s(A)} proposed to become an admin of the group MINTER (waiting for group approval)`
    );
    const remove = minter('REMOVE_GROUP_ADMIN', { admin: B });
    expect(say(remove, A)).toBe(
      `Removed ${s(B)} as an admin of the group MINTER`
    );
    const stepDown = minter('REMOVE_GROUP_ADMIN', { admin: A });
    expect(say(stepDown, A)).toBe(
      'Stepped down as an admin of the group MINTER'
    );
  });

  it('JOIN_GROUP, LEAVE_GROUP and a group without a name read yet', () => {
    const join = row('JOIN_GROUP', { groupId: 694 });
    expect(say(join, A)).toBe('Joined or asked to join the group MINTER');
    expect(dir(join, A)).toBe('self');
    expect(fields(join)).toEqual({ group: 'MINTER' });
    expect(say(row('LEAVE_GROUP', { groupId: 31 }), A)).toBe(
      'Left the group #31'
    );
  });

  it('CREATE_GROUP, UPDATE_GROUP and SET_GROUP', () => {
    const create = row('CREATE_GROUP', {
      groupId: 1195,
      groupName: 'Garden club',
      description: 'Welcome',
      isOpen: true,
    });
    // Its own name: the group's, which no later transaction changes.
    expect(say(create, A)).toBe('Created the group Garden club');
    expect(fields(create)).toEqual({
      group: '#1195',
      name: 'Garden club',
      description: 'Welcome',
      'open to anyone': 'yes',
    });
    const update = row('UPDATE_GROUP', {
      groupId: 1012,
      newOwner: A,
      newDescription: 'New',
    });
    expect(say(update, A)).toBe('Updated the settings of the group #1012');
    const handover = row('UPDATE_GROUP', { groupId: 1012, newOwner: B });
    expect(say(handover, A)).toBe(`Made ${s(B)} the owner of the group #1012`);
    expect(say(handover, B)).toBe(
      `${s(A)} made this account the owner of the group #1012`
    );
    expect(say(row('SET_GROUP', { defaultGroupId: 694 }), A)).toBe(
      'Set its default group to MINTER'
    );
    expect(say(row('SET_GROUP', { defaultGroupId: 0 }))).toBe(
      `${s(A)} cleared its default group`
    );
  });

  it('GROUP_APPROVAL points at the transaction it answers', () => {
    const yes = row('GROUP_APPROVAL', {
      pendingSignature: PENDING_SIG,
      approval: true,
    });
    expect(say(yes, A)).toBe(
      `Approved the transaction ${PENDING_SIG.slice(0, 8)}…`
    );
    expect(dir(yes, A)).toBe('self');
    expect(describeTx(yes).sentence.slots.tx).toEqual({
      kind: 'tx',
      signature: PENDING_SIG,
    });
    const no = row('GROUP_APPROVAL', {
      pendingSignature: PENDING_SIG,
      approval: false,
    });
    expect(say(no, A)).toBe(
      `Rejected the transaction ${PENDING_SIG.slice(0, 8)}…`
    );
    expect(fields(no).answer).toBe('reject');
  });
});

describe('other types', () => {
  it('GENESIS', () => {
    const tx = row('GENESIS', {
      creatorAddress: NULL_ACCOUNT,
      blockHeight: 1,
      recipient: B,
      amount: '1000.00000000',
      assetId: 0,
    });
    expect(say(tx, B)).toBe('Received 1,000 QORT in the genesis block');
    expect(dir(tx, B)).toBe('in');
    expect(say(tx)).toBe(`${s(B)} received 1,000 QORT in the genesis block`);
    expect(describeTx(tx).participants).toEqual([B]);
  });

  it('CREATE_POLL and VOTE_ON_POLL', () => {
    const poll = row('CREATE_POLL', {
      owner: A,
      pollName: 'board-poll',
      description: 'A poll',
      pollOptions: [{ optionName: 'Yes' }, { optionName: 'No' }],
    });
    expect(say(poll, A)).toBe('Created the poll “board-poll”');
    expect(fields(poll)).toEqual({
      poll: 'board-poll',
      description: 'A poll',
      options: 'Yes, No',
    });
    const forOther = row('CREATE_POLL', { owner: B, pollName: 'p' });
    expect(say(forOther, B)).toBe(
      `${s(A)} created the poll “p” owned by this account`
    );
    expect(say(forOther, A)).toBe(`Created the poll “p” owned by ${s(B)}`);
    const vote = row('VOTE_ON_POLL', { pollName: 'p', optionIndex: 0 });
    expect(say(vote, A)).toBe('Voted on the poll “p”');
    expect(fields(vote)).toEqual({ poll: 'p', option: 'option 1' });
  });

  it('PUBLICIZE, AIRDROP and PRESENCE', () => {
    expect(say(row('PUBLICIZE'), A)).toBe('Published its public key');
    expect(say(row('AIRDROP'), A)).toBe('Made an airdrop');
    expect(say(row('PRESENCE', { presenceType: 'TRADE_BOT' }), A)).toBe(
      'Showed it is online (trade bot)'
    );
    expect(say(row('PRESENCE', { presenceType: 'REWARD_SHARE' }))).toBe(
      `${s(A)} showed it is online (minting)`
    );
  });

  it('a type Hub doesn’t know is named by Core’s own name', () => {
    const tx = row('NEW_THING');
    expect(say(tx, A)).toBe('Made a transaction: NEW_THING');
    expect(say(tx)).toBe(`${s(A)} made a transaction: NEW_THING`);
  });
});

describe('every type', () => {
  /** A row with every field any type reads, so each type has something to say. */
  const everything = (type: string): TxRow =>
    row(type, {
      creatorAddress: [
        'AT',
        'GENESIS',
        'ACCOUNT_FLAGS',
        'ACCOUNT_LEVEL',
      ].includes(type)
        ? NULL_ACCOUNT
        : A,
      blockHeight: ['GENESIS', 'ACCOUNT_FLAGS', 'ACCOUNT_LEVEL'].includes(type)
        ? 1
        : 2_000_000,
      txGroupId: 4242,
      approvalStatus: 'APPROVED',
      groupId: 31,
      recipient: B,
      amount: '1.00000000',
      assetId: 0,
      payments: [
        { recipient: B, assetId: 0, amount: '1.00000000' },
        { recipient: D, assetId: 0, amount: '2.00000000' },
      ],
      name: 'foo',
      newName: 'bar',
      seller: B,
      sharePercent: '0.00',
      invitee: B,
      member: B,
      offender: B,
      admin: B,
      newOwner: B,
      target: B,
      owner: A,
      atAddress: AT_ADDR,
      aTAddress: AT_ADDR,
      service: 1000,
      identifier: 'id',
      timeToLive: 864_000,
      reason: 'because',
      pendingSignature: PENDING_SIG,
      approval: true,
      pollName: 'p',
      optionIndex: 1,
      level: 2,
      defaultGroupId: 31,
      orderId: ORDER,
      data: 'PRIVATE CONTENT',
      isEncrypted: false,
    });

  const LANGUAGES = Object.keys(i18n.options.resources ?? {});

  it.each(ALL_TX_TYPES)('%s reads well from every side', (type) => {
    const tx = everything(type);
    for (const viewpoint of [A, B, AT_ADDR, C, undefined]) {
      const words = describeTx(tx, { viewpoint, privsRecipient: B });
      const text = sentenceText(words.sentence, i18n.t, 'en');
      expect(text.length, `${type} ${viewpoint}`).toBeGreaterThan(5);
      expect(text[0]).toBe(text[0].toUpperCase());
      expect(text).not.toMatch(/undefined|null|NaN|\[object|\{\{|\s{2}|^tx\./);
      expect(words.participants).not.toContain(NULL_ACCOUNT);
      expect(new Set(words.participants).size).toBe(words.participants.length);
      const json = JSON.stringify(words);
      expect(json).not.toContain('4242'); // txGroupId: raw JSON only
      expect(json).not.toContain('864'); // timeToLive: raw JSON only
      if (type === 'MESSAGE' || type === 'CHAT')
        expect(json).not.toContain('PRIVATE CONTENT');
      if (viewpoint === undefined || viewpoint === C)
        expect(words.direction).toBe('none');
      // Its fields' labels and its words exist in English.
      for (const f of words.fields)
        expect(i18n.exists(`explorer:tx.field.${f.label}`), f.label).toBe(true);
    }
  });

  it.each(LANGUAGES)(
    '%s: every sentence is whole, with each of its slots once',
    async (language) => {
      const fixed = i18n.getFixedT(language);
      for (const type of ALL_TX_TYPES)
        for (const viewpoint of [A, B, AT_ADDR, C, undefined])
          for (const approvalStatus of ['APPROVED', 'PENDING']) {
            const words = describeTx(
              { ...everything(type), approvalStatus },
              { viewpoint, privsRecipient: B }
            );
            const key = `explorer:tx.say.${words.sentence.key}`;
            const text = sentenceText(words.sentence, fixed, language);
            expect(text, `${language} ${key}`).not.toMatch(
              /\{\{|\}\}|undefined|explorer:|tx\.say/
            );
            for (const [name, slot] of Object.entries(words.sentence.slots)) {
              const slotWords = slotText(slot, fixed, language);
              expect(text, `${language} ${key} ${name}`).toContain(slotWords);
            }
          }
    }
  );
});
