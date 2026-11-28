import { describe, expect, it } from 'vitest';
import {
  formatAmountExact,
  formatList,
  formatPercent,
  formatSize,
} from './format';
import { jsonLines, jsonText } from './jsonLines';
import {
  isKnownService,
  isPrivateService,
  QDN_SERVICES,
  serviceName,
  serviceWordKey,
} from './qdnServices';
import { rawForDisplay } from './rawTx';
import type { TxRow } from './reads';
import {
  ALL_TRANSACTIONS,
  ALL_TX_TYPES,
  cleanFilter,
  familyOf,
  filterMatches,
  isFiltered,
  isTxFamilyKey,
  TX_FAMILIES,
  typesFor,
  typesToAsk,
} from './txFamilies';

describe('transaction families', () => {
  it("lists Core's 41 types once each", () => {
    expect(ALL_TX_TYPES).toHaveLength(41);
    expect(new Set(ALL_TX_TYPES).size).toBe(41);
    expect(ALL_TX_TYPES[0]).toBe('GENESIS');
    expect(ALL_TX_TYPES[37]).toBe('REWARD_SHARE'); // type 38
    expect(ALL_TX_TYPES[40]).toBe('PRESENCE'); // type 41
  });

  it('puts every type in exactly one family, and nothing else in any', () => {
    const seen = TX_FAMILIES.flatMap((family) => family.types);
    expect([...seen].sort()).toEqual([...ALL_TX_TYPES].sort());
    for (const type of ALL_TX_TYPES)
      expect(
        TX_FAMILIES.filter((family) => family.types.includes(type))
      ).toHaveLength(1);
    expect(TX_FAMILIES.map((family) => family.key)).toEqual([
      'all',
      'payments',
      'names',
      'minting',
      'groups',
      'qdn',
      'trading',
      'messages',
      'other',
    ]);
  });

  it('finds the family of a type; a type Hub doesn’t know is Other', () => {
    expect(familyOf('PAYMENT')).toBe('payments');
    expect(familyOf('MULTI_PAYMENT')).toBe('payments');
    expect(familyOf('BUY_NAME')).toBe('names');
    expect(familyOf('TRANSFER_PRIVS')).toBe('minting');
    expect(familyOf('GROUP_APPROVAL')).toBe('groups');
    expect(familyOf('ARBITRARY')).toBe('qdn');
    expect(familyOf('AT')).toBe('trading');
    expect(familyOf('CHAT')).toBe('messages');
    expect(familyOf('PRESENCE')).toBe('other');
    expect(familyOf('SOMETHING_NEW')).toBe('other');
  });

  it('gives the types to ask Core for: none for All', () => {
    expect(typesFor('all')).toEqual([]);
    expect(typesFor('nope')).toEqual([]);
    expect(typesFor('payments')).toEqual([
      'PAYMENT',
      'TRANSFER_ASSET',
      'MULTI_PAYMENT',
    ]);
    expect(typesFor('groups')).toHaveLength(13);
    expect(isTxFamilyKey('qdn')).toBe(true);
    expect(isTxFamilyKey('QDN')).toBe(false);
  });

  it('keeps a filter safe: an unknown kind is All, a type outside its kind none', () => {
    expect(cleanFilter(undefined)).toEqual(ALL_TRANSACTIONS);
    expect(cleanFilter({ kind: 'nope', type: 'PAYMENT' })).toEqual(
      ALL_TRANSACTIONS
    );
    expect(cleanFilter({ kind: 'names', type: 'PAYMENT' })).toEqual({
      kind: 'names',
      type: null,
    });
    expect(cleanFilter({ kind: 'all', type: 'PAYMENT' })).toEqual(
      ALL_TRANSACTIONS
    );
    expect(cleanFilter({ kind: 'payments', type: 'PAYMENT' })).toEqual({
      kind: 'payments',
      type: 'PAYMENT',
    });
  });

  it('asks for the type picked, or every type of the kind', () => {
    expect(typesToAsk(ALL_TRANSACTIONS)).toEqual([]);
    expect(typesToAsk({ kind: 'messages', type: null })).toEqual([
      'MESSAGE',
      'CHAT',
    ]);
    expect(typesToAsk({ kind: 'messages', type: 'CHAT' })).toEqual(['CHAT']);
    expect(filterMatches(ALL_TRANSACTIONS, 'ANYTHING')).toBe(true);
    expect(filterMatches({ kind: 'names', type: null }, 'PAYMENT')).toBe(false);
    expect(filterMatches({ kind: 'payments', type: null }, 'PAYMENT')).toBe(
      true
    );
    expect(isFiltered(ALL_TRANSACTIONS)).toBe(false);
    expect(isFiltered({ kind: 'payments', type: null })).toBe(true);
  });
});

describe('QDN services', () => {
  it("knows Core's 54 services by number", () => {
    expect(Object.keys(QDN_SERVICES)).toHaveLength(54);
    expect(new Set(Object.values(QDN_SERVICES)).size).toBe(54);
    expect(serviceName(800)).toBe('DOCUMENT');
    expect(serviceName('1000')).toBe('APP');
    expect(serviceName(1901)).toBe('MAIL_PRIVATE');
  });

  it('keeps a name that is already one, and reads a new number plainly', () => {
    expect(serviceName('VIDEO')).toBe('VIDEO');
    expect(serviceName(4242)).toBe('SERVICE_4242');
    expect(serviceName(undefined)).toBeNull();
    expect(serviceName('not a service')).toBeNull();
    expect(serviceName(-1)).toBeNull();
    expect(isKnownService('APP')).toBe(true);
    expect(isKnownService('SERVICE_4242')).toBe(false);
  });

  it('treats every *_PRIVATE service and MAIL as encrypted', () => {
    expect(Object.values(QDN_SERVICES).filter(isPrivateService).sort()).toEqual(
      [
        'ATTACHMENT_PRIVATE',
        'AUDIO_PRIVATE',
        'DOCUMENT_PRIVATE',
        'FILE_PRIVATE',
        'IMAGE_PRIVATE',
        'MAIL',
        'MAIL_PRIVATE',
        'MESSAGE_PRIVATE',
        'QCHAT_ATTACHMENT_PRIVATE',
        'VIDEO_PRIVATE',
        'VOICE_PRIVATE',
      ]
    );
    expect(isPrivateService('SOMETHING_PRIVATE')).toBe(true);
    expect(isPrivateService(null)).toBe(false);
  });

  it('names what was published: one word for every encrypted service', () => {
    expect(serviceWordKey('APP')).toBe('app');
    expect(serviceWordKey('MAIL')).toBe('encrypted');
    expect(serviceWordKey('VIDEO_PRIVATE')).toBe('encrypted');
    expect(serviceWordKey('SERVICE_4242')).toBe('unknown');
    expect(serviceWordKey(null)).toBe('unknown');
  });
});

describe('the raw answer shown', () => {
  const base = { timestamp: 1, signature: 'sig', txGroupId: 0 };

  it('leaves out what a message says', () => {
    const tx: TxRow = { ...base, type: 'MESSAGE', data: 'hello', isText: true };
    expect(rawForDisplay(tx, '(not shown)')).toMatchObject({
      data: '(not shown)',
      isText: true,
    });
    expect(
      JSON.stringify(rawForDisplay({ ...tx, type: 'CHAT' }, '-'))
    ).not.toContain('hello');
  });

  it('leaves out an AT’s message, keeping the rest', () => {
    const at: TxRow = {
      ...base,
      type: 'AT',
      atAddress: `A${'T'.repeat(33)}`,
      recipient: `Q${'S'.repeat(33)}`,
      amount: '0',
      message: 'tradebotmessage',
    };
    const shown = rawForDisplay(at, '(not shown)');
    expect(shown).toMatchObject({
      message: '(not shown)',
      atAddress: at.atAddress,
      recipient: at.recipient,
    });
    expect(JSON.stringify(shown)).not.toContain('tradebotmessage');
    // One without a message gets none added.
    const payout: TxRow = { ...base, type: 'AT', amount: '5.00000000' };
    expect(rawForDisplay(payout, '-')).toEqual(payout);
  });

  it('leaves out what identifies an encrypted resource, keeping the rest', () => {
    const tx: TxRow = {
      ...base,
      type: 'ARBITRARY',
      service: 1901,
      name: 'Publisher',
      identifier: 'qortal_qmail_x',
      data: 'hash',
      secret: 'key',
    };
    expect(rawForDisplay(tx, '-')).toMatchObject({
      identifier: '-',
      data: '-',
      secret: '-',
      name: 'Publisher',
      service: 1901,
    });
    expect(rawForDisplay({ ...tx, service: 1000 }, '-')).toMatchObject({
      identifier: 'qortal_qmail_x',
    });
  });

  it('keeps everything else as Core sent it', () => {
    const tx: TxRow = { ...base, type: 'PAYMENT', amount: '1.5' };
    expect(rawForDisplay(tx, '-')).toEqual(tx);
  });

  it('lays JSON out in lines of coloured parts, and copies it back exactly', () => {
    const value = { a: 'x', b: [1, true, null], c: {} };
    const lines = jsonLines(value);
    expect(jsonText(lines)).toBe(JSON.stringify(value, null, 2));
    expect(lines[1]).toEqual({
      depth: 1,
      parts: [
        { kind: 'key', text: '"a"' },
        { kind: 'punct', text: ': ' },
        { kind: 'string', text: '"x"' },
        { kind: 'punct', text: ',' },
      ],
    });
    expect(
      lines.map((line) => line.parts.map((part) => part.kind))
    ).toContainEqual(['boolean', 'punct']);
  });
});

describe('formats', () => {
  it('shows an amount exactly, in the reader’s language', () => {
    expect(formatAmountExact('4.30000000', 'en')).toBe('4.3');
    expect(formatAmountExact('100.00000000', 'en')).toBe('100');
    expect(formatAmountExact('0.00098935', 'en')).toBe('0.00098935');
    expect(formatAmountExact('637557960.49687541', 'en')).toBe(
      '637,557,960.49687541'
    );
    expect(formatAmountExact('637557960.49687541', 'de')).toBe(
      '637.557.960,49687541'
    );
    expect(formatAmountExact('0.00000000', 'en')).toBe('0');
    expect(formatAmountExact('-2.5', 'en')).toBe('−2.5');
    expect(formatAmountExact('not a number', 'en')).toBe('not a number');
  });

  it('shows percents, sizes and lists as the language writes them', () => {
    expect(formatPercent('5.50', 'en')).toBe('5.5%');
    expect(formatPercent('0.00', 'en')).toBe('0%');
    expect(formatSize(240, 'en')).toBe('240 byte');
    expect(formatSize(3_500_000, 'en')).toBe('3.5 MB');
    expect(formatList(['a', 'b', 'c'], 'en')).toBe('a, b, and c');
    expect(formatList(['a', 'b'], 'de')).toBe('a und b');
  });
});
