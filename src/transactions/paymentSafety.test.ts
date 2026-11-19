import { describe, expect, it, vi } from 'vitest';

// src/test/setup.ts stubs asmcrypto out; address checks need the real SHA-256.
vi.mock('asmcrypto.js/asmcrypto.all.js', async (importOriginal) =>
  importOriginal()
);
// Errors carry the i18n key, so a test can tell which refusal it got.
vi.mock('i18next', () => ({
  default: {
    t: (key: string, options?: Record<string, unknown>) => {
      const params = { ...(options || {}) };
      delete params.postProcess;
      return Object.keys(params).length
        ? `${key} ${JSON.stringify(params)}`
        : key;
    },
  },
}));

import { Sha256 } from 'asmcrypto.js';
import Base58Untyped from '../encryption/Base58';
import PaymentTransactionUntyped from './PaymentTransaction';
import TransferAssetTransactionUntyped from './TransferAssetTransaction';
import publicKeyToAddressUntyped from '../utils/generateWallet/publicKeyToAddress';
import {
  checkValueTransferFee,
  FeeNotApprovedError,
  formatAtomicAmount,
  InvalidAmountError,
  InvalidAssetIdError,
  InvalidRecipientError,
  isLookupSafeName,
  isValidPaymentAddress,
  MAX_VALUE_TRANSFER_FEE_QORT,
  parseAssetId,
  parseDecimalAmount,
  recipientDisplayLabel,
  recipientFromNameRecord,
} from './paymentSafety';

const Base58 = Base58Untyped as any;
const publicKeyToAddress = publicKeyToAddressUntyped as any;
const PaymentTransaction = PaymentTransactionUntyped as any;
const TransferAssetTransaction = TransferAssetTransactionUntyped as any;

// Account-A: a made-up key and the address it derives.
const accountAAddress = String(publicKeyToAddress(new Uint8Array(32).fill(7)));

/** 25 address bytes with `version` and a correct checksum, in Base58. */
function addressWithVersion(version: number, fill = 5): string {
  const body = new Uint8Array(21).fill(fill);
  body[0] = version;
  const first = new Sha256().process(body).finish().result;
  const checksum = new Sha256().process(first).finish().result.slice(0, 4);
  const bytes = new Uint8Array(25);
  bytes.set(body);
  bytes.set(checksum, 21);
  return Base58.encode(bytes) as string;
}

describe('isValidPaymentAddress', () => {
  it('accepts account ("Q") and AT ("A") addresses, as Core does', () => {
    const at = addressWithVersion(23);
    expect(at.startsWith('A')).toBe(true);
    expect(isValidPaymentAddress(at)).toBe(true);
    expect(isValidPaymentAddress(accountAAddress)).toBe(true);
    expect(isValidPaymentAddress(addressWithVersion(58))).toBe(true);
  });

  it('refuses other version bytes, broken checksums and non-addresses', () => {
    expect(isValidPaymentAddress(addressWithVersion(0))).toBe(false);
    expect(isValidPaymentAddress(addressWithVersion(57))).toBe(false);
    const bytes = Base58.decode(addressWithVersion(23)) as Uint8Array;
    const broken = new Uint8Array(bytes);
    broken[24] ^= 0x01;
    expect(isValidPaymentAddress(Base58.encode(broken))).toBe(false);
    expect(isValidPaymentAddress('Recipient-B')).toBe(false);
    expect(isValidPaymentAddress('')).toBe(false);
    expect(isValidPaymentAddress(undefined)).toBe(false);
  });
});

describe('parseDecimalAmount', () => {
  it.each([
    ['1.5', '1.5', BigInt(150000000)],
    ['1.50', '1.5', BigInt(150000000)],
    [' 2 ', '2', BigInt(200000000)],
    ['00012.50', '12.5', BigInt(1250000000)],
    ['.5', '0.5', BigInt(50000000)],
    ['3.', '3', BigInt(300000000)],
    ['0.00000001', '0.00000001', BigInt(1)],
    ['12345678.12345678', '12345678.12345678', BigInt('1234567812345678')],
  ])('parses the string %j as %s', (input, text, atomic) => {
    const parsed = parseDecimalAmount(input);
    expect(parsed.text).toBe(text);
    expect(parsed.atomic).toBe(atomic);
    expect(Math.round(parsed.value * 1e8)).toBe(Number(atomic));
  });

  it('rounds numbers to 8 places, as the transaction builders do', () => {
    expect(parseDecimalAmount(1.5).text).toBe('1.5');
    expect(parseDecimalAmount(0.1 + 0.2).text).toBe('0.3');
    expect(parseDecimalAmount(0.1 + 0.2).value).toBe(0.3);
    expect(parseDecimalAmount(0.00000001).text).toBe('0.00000001');
    expect(parseDecimalAmount(1000).text).toBe('1000');
    // (100000000.1).toFixed(8) is "100000000.09999999"; the builders sign
    // Math.round(value * 1e8), which is 100000000.1.
    expect(parseDecimalAmount(100000000.1).text).toBe('100000000.1');
  });

  it.each(['100000000.1', '99999999.99', '200000000.3', '67108864.00195312'])(
    'parses the value it returns for %j back to the same amount',
    (input) => {
      const parsed = parseDecimalAmount(input);
      expect(parsed.text).toBe(input);
      expect(parseDecimalAmount(parsed.value).atomic).toBe(parsed.atomic);
    }
  );

  it('refuses a number too large to scale to 1e-8 units', () => {
    expect(() => parseDecimalAmount(Number.MAX_VALUE)).toThrow(
      InvalidAmountError
    );
  });

  it.each([
    // Number('0.123456785').toFixed(8) is 0.12345678.
    ['0.123456785', '0.12345679', BigInt(12345679)],
    ['0.123456784999', '0.12345678', BigInt(12345678)],
    // Math.round(Number(input) * 1e8) is one unit higher for these two.
    ['0.1234567849999999999999', '0.12345678', BigInt(12345678)],
    ['12345.678901234999999999', '12345.67890123', BigInt('1234567890123')],
    ['1.123456789', '1.12345679', BigInt(112345679)],
    ['0.000000005', '0.00000001', BigInt(1)],
    ['0.999999995', '1', BigInt(100000000)],
    [String(0.1 + 0.2), '0.3', BigInt(30000000)],
  ])(
    'rounds the string %j half-up to 8 places, digit by digit',
    (input, text, atomic) => {
      const parsed = parseDecimalAmount(input);
      expect(parsed.text).toBe(text);
      expect(parsed.atomic).toBe(atomic);
      expect(Math.round(parsed.value * 1e8)).toBe(Number(atomic));
    }
  );

  it('parses amounts above 2^53 atomic units that the builders sign exactly', () => {
    const parsed = parseDecimalAmount('100000000');
    expect(parsed.atomic).toBe(BigInt('10000000000000000'));
    expect(parsed.value).toBe(100000000);
    expect(BigInt(Math.round(parsed.value * 1e8))).toBe(parsed.atomic);
    expect(parseDecimalAmount('21000000000').atomic).toBe(
      BigInt('2100000000000000000')
    );
  });

  it.each(['90071992.54740993', '10000000000.00000001'])(
    'refuses %j, which the builders cannot sign exactly',
    (input) => {
      expect(() => parseDecimalAmount(input)).toThrow(InvalidAmountError);
    }
  );

  // A transaction holds the amount as a signed 64-bit integer.
  it.each(['92233720368.54775808', '200000000000'])(
    'refuses %j, which is too large for a transaction',
    (input) => {
      expect(() => parseDecimalAmount(input)).toThrow(InvalidAmountError);
    }
  );

  it('refuses a string of digits too long to be a number', () => {
    expect(() => parseDecimalAmount('9'.repeat(400))).toThrow(
      InvalidAmountError
    );
  });

  it.each([
    '1e3',
    '0x10',
    '0b11',
    'Infinity',
    'NaN',
    '-1',
    '+1',
    '1,5',
    '1.2.3',
    '',
    '   ',
    '.',
    '١٢', // Arabic-Indic digits
    '9999999999999999999',
  ])('refuses the string %j', (input) => {
    expect(() => parseDecimalAmount(input)).toThrow(InvalidAmountError);
  });

  it.each([
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [-1],
    [1e21],
    [null],
    [undefined],
    [{}],
    [[1]],
    [true],
  ])('refuses %j', (input) => {
    expect(() => parseDecimalAmount(input)).toThrow(InvalidAmountError);
  });

  it('refuses zero unless allowed', () => {
    expect(() => parseDecimalAmount('0')).toThrow(InvalidAmountError);
    expect(() => parseDecimalAmount(0)).toThrow(InvalidAmountError);
    expect(() => parseDecimalAmount(0.000000001)).toThrow(InvalidAmountError);
    expect(parseDecimalAmount('0', { allowZero: true }).atomic).toBe(BigInt(0));
  });

  it('refuses a string that rounds to zero', () => {
    expect(() => parseDecimalAmount('0.000000001')).toThrow(InvalidAmountError);
    expect(() => parseDecimalAmount('0.0000000049')).toThrow(
      InvalidAmountError
    );
    // As a float, this one rounds to 0.00000001.
    expect(() => parseDecimalAmount('0.00000000499999999999999999')).toThrow(
      InvalidAmountError
    );
    expect(parseDecimalAmount('0.000000001', { allowZero: true }).atomic).toBe(
      BigInt(0)
    );
  });

  it('says the amount is invalid', () => {
    expect(() => parseDecimalAmount('1e3')).toThrow(
      'core:message.error.invalid_amount'
    );
  });

  it('formats atomic amounts without trailing zeros', () => {
    expect(formatAtomicAmount(BigInt(0))).toBe('0');
    expect(formatAtomicAmount(BigInt(100000000))).toBe('1');
    expect(formatAtomicAmount(BigInt(1000001))).toBe('0.01000001');
  });
});

describe('checkValueTransferFee', () => {
  it('returns the node fee unchanged when it matches or is below the approved fee', () => {
    expect(checkValueTransferFee('0.01000000', '0.01000000')).toBe(
      '0.01000000'
    );
    expect(checkValueTransferFee('0.00500000', '0.01')).toBe('0.00500000');
    expect(checkValueTransferFee(0.01, 0.01)).toBe(0.01);
    expect(checkValueTransferFee('0.01000000', 0.01)).toBe('0.01000000');
  });

  it('refuses a fee above the approved one', () => {
    expect(() => checkValueTransferFee('0.02000000', '0.01000000')).toThrow(
      FeeNotApprovedError
    );
    expect(() => checkValueTransferFee('0.02000000', '0.01000000')).toThrow(
      /fee_above_approved.*"fee":"0.02".*"approved":"0.01"/
    );
  });

  it('refuses a fee above the ceiling, with or without an approved fee', () => {
    expect(() => checkValueTransferFee('950.00000000')).toThrow(
      /fee_above_limit.*"fee":"950".*"limit":"1"/
    );
    expect(() => checkValueTransferFee('950', '1000')).toThrow(
      /fee_above_limit/
    );
    expect(() => checkValueTransferFee('1.00000001')).toThrow(
      FeeNotApprovedError
    );
    expect(checkValueTransferFee(MAX_VALUE_TRANSFER_FEE_QORT)).toBe(
      MAX_VALUE_TRANSFER_FEE_QORT
    );
  });

  it('applies only the ceiling when no fee was approved', () => {
    for (const approved of [undefined, null, '']) {
      expect(checkValueTransferFee('0.01000000', approved)).toBe('0.01000000');
    }
  });

  it.each([['NaN'], ['-0.01'], ['1e-2'], [undefined], [{}]])(
    'refuses an unreadable node fee %j',
    (nodeFee) => {
      expect(() => checkValueTransferFee(nodeFee, '0.01')).toThrow(
        /fee_invalid/
      );
    }
  );

  it('refuses an unreadable approved fee', () => {
    expect(() => checkValueTransferFee('0.01', 'abc')).toThrow(/fee_invalid/);
    expect(() => checkValueTransferFee('0.01', Number.NaN)).toThrow(
      /fee_invalid/
    );
  });
});

describe('parseAssetId', () => {
  it.each([
    [0, 0],
    [5, 5],
    ['0', 0],
    ['17', 17],
  ])('reads %j as asset %j', (input, id) => {
    expect(parseAssetId(input)).toBe(id);
  });

  it.each([
    ['abc'],
    [''],
    [' 5'],
    ['5abc'],
    ['1e3'],
    ['-1'],
    [-1],
    [1.5],
    [Number.NaN],
    [Number.MAX_SAFE_INTEGER + 1],
    ['9007199254740993'],
    [null],
    [undefined],
    [{}],
  ])('refuses %j', (input) => {
    expect(() => parseAssetId(input)).toThrow(InvalidAssetIdError);
    expect(() => parseAssetId(input)).toThrow(
      'question:message.error.invalid_asset_id'
    );
  });
});

describe('isLookupSafeName', () => {
  it.each([
    'Recipient-B',
    'Recipient B',
    'Who?#1',
    'a#b',
    '%reset -f',
    'Q-App 2',
    'ü'.repeat(20), // 40 UTF-8 bytes
    '...',
    '... Recipient B ...',
  ])('accepts %j', (name) => {
    expect(isLookupSafeName(name)).toBe(true);
  });

  it.each([
    '',
    ' Recipient-B',
    'Recipient-B ',
    'a  b',
    'a\tb',
    'a\nb',
    'a/b',
    '../names',
    'a\\b',
    '.',
    '..',
    'a​b',
    'a‮b',
    'a\u0000b',
    'a b',
    'x'.repeat(41),
    'ü'.repeat(21),
  ])('refuses %j', (name) => {
    expect(isLookupSafeName(name)).toBe(false);
  });

  it('refuses non-strings', () => {
    expect(isLookupSafeName(undefined)).toBe(false);
    expect(isLookupSafeName(5)).toBe(false);
  });
});

describe('recipientFromNameRecord', () => {
  it('uses the owner address and the name as Core spells it', () => {
    expect(
      recipientFromNameRecord('recipient-b', {
        name: 'Recipient-B',
        owner: accountAAddress,
      })
    ).toEqual({ address: accountAAddress, name: 'Recipient-B' });
    expect(
      recipientFromNameRecord('Recipient-B', { owner: accountAAddress })
    ).toEqual({
      address: accountAAddress,
      name: 'Recipient-B',
    });
  });

  it.each([
    [{}],
    [null],
    ['not json'],
    [{ owner: '' }],
    [{ owner: 'Qnotanaddress' }],
    [{ owner: '../names' }],
    [{ owner: 12 }],
  ])('refuses a record without a valid owner: %j', (record) => {
    expect(() => recipientFromNameRecord('Recipient-B', record)).toThrow(
      InvalidRecipientError
    );
  });

  it('refuses an AT address as a name owner (only accounts own names)', () => {
    expect(() =>
      recipientFromNameRecord('Recipient-B', { owner: addressWithVersion(23) })
    ).toThrow(InvalidRecipientError);
  });

  it('refuses an owner with a broken checksum', () => {
    const bytes = Base58.decode(accountAAddress) as Uint8Array;
    const broken = new Uint8Array(bytes);
    broken[24] ^= 0xff;
    expect(() =>
      recipientFromNameRecord('Recipient-B', { owner: Base58.encode(broken) })
    ).toThrow(InvalidRecipientError);
  });
});

describe('recipientDisplayLabel', () => {
  it('shows the name and the full address for a name, the address otherwise', () => {
    const t = (_key: string, options?: Record<string, unknown>) =>
      `${options?.name} (${options?.address})`;
    expect(
      recipientDisplayLabel(
        { address: accountAAddress, name: 'Recipient-B' },
        t
      )
    ).toBe(`Recipient-B (${accountAAddress})`);
    expect(
      recipientDisplayLabel({ address: accountAAddress, name: '' }, t)
    ).toBe(accountAAddress);
  });

  it('uses the recipient_name_address string by default', () => {
    expect(
      recipientDisplayLabel({ address: accountAAddress, name: 'Recipient-B' })
    ).toBe(
      `question:recipient_name_address ${JSON.stringify({
        name: 'Recipient-B',
        address: accountAAddress,
      })}`
    );
  });
});

describe('parseDecimalAmount and the transaction builders', () => {
  /** mulberry32: a small seeded generator, so a failure can be replayed. */
  function seeded(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Plain decimals with 0-12 whole digits and 0-11 places, as text and number. */
  function* amountInputs(count: number, seed: number) {
    const random = seeded(seed);
    const digits = (n: number) =>
      Array.from({ length: n }, () => Math.floor(random() * 10)).join('');
    for (let i = 0; i < count; i++) {
      const whole = digits(Math.floor(random() * 13)) || '0';
      const places = Math.floor(random() * 12);
      const text = places ? `${whole}.${digits(places)}` : whole;
      yield text;
      yield Number(text);
    }
  }

  function tryParse(value: unknown) {
    try {
      return parseDecimalAmount(value);
    } catch {
      return null;
    }
  }

  /** The amount a builder writes for `value`, read back from its 8 bytes. */
  function writtenAmount(Builder: any, value: number): bigint {
    const tx = new Builder();
    tx.amount = value;
    return (tx._amountBytes as number[]).reduce(
      (sum, byte) => sum * BigInt(256) + BigInt(byte),
      BigInt(0)
    );
  }

  it('whenever it accepts, both builders write exactly the parsed amount', () => {
    let accepted = 0;
    for (const input of amountInputs(10000, 1)) {
      const parsed = tryParse(input);
      if (!parsed) continue;
      accepted += 1;
      expect(writtenAmount(PaymentTransaction, parsed.value)).toBe(
        parsed.atomic
      );
      expect(writtenAmount(TransferAssetTransaction, parsed.value)).toBe(
        parsed.atomic
      );
      expect(parsed.text).toBe(formatAtomicAmount(parsed.atomic));
    }
    expect(accepted).toBeGreaterThan(10000);
  });

  it('parses every value it returns back to the same amount', () => {
    const changed: string[] = [];
    for (const input of amountInputs(10000, 7)) {
      const parsed = tryParse(input);
      if (!parsed) continue;
      const again = tryParse(parsed.value);
      if (again?.atomic !== parsed.atomic) changed.push(parsed.text);
    }
    expect(changed.slice(0, 5)).toEqual([]);
  });
});
