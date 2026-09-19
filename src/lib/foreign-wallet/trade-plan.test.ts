import { describe, it, expect, vi } from 'vitest';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
import { foreignCoins } from './foreign-wallets';
import { validateLocalTradePlan } from './trade-plan';
import Base58 from '../../encryption/Base58';

describe('trade funding validation', () => {
  for (const coin of foreignCoins)
    it(`${coin}: verifies the HTLC, amount, seller and refund deadline`, () => {
      const offer = {
        qortalAtAddress: 'AT',
        receivingAddress: 'QORT',
        expectedForeignAmount: '1',
        tradeTimeout: 60,
        creatorForeignPKH: Base58.encode(new Uint8Array(20).fill(3)),
      };
      const lockTime = Math.floor(Date.now() / 1000) + 3600;
      const time = new Uint8Array(4);
      new DataView(time.buffer).setUint32(0, lockTime, true);
      const redeemScript = `7dada97614${'01'.repeat(20)}87637504${bytesToHex(time)}b16714${'03'.repeat(20)}88a914${'02'.repeat(20)}8768`;
      const prefix = { BTC: 5, LTC: 50, DOGE: 22, DGB: 63, RVN: 122 }[coin];
      const address = base58check(sha256).encode(
        Uint8Array.from([
          prefix,
          ...ripemd160(sha256(hexToBytes(redeemScript))),
        ])
      );
      const plan = {
        atAddress: 'AT',
        receivingAddress: 'QORT',
        amount: '100001000',
        fundingReserve: '1000',
        refundPublicKeyHash: '01'.repeat(20),
        hashOfSecret: '02'.repeat(20),
        redeemScript,
        lockTime,
        address,
      };
      expect(validateLocalTradePlan([plan], [offer], coin, 'QORT')).toEqual([
        { address, value: 100001000n },
      ]);
      for (const changed of [
        { ...plan, amount: '100002000' },
        { ...plan, lockTime: 0 },
        { ...plan, atAddress: 'OTHER' },
        { ...plan, redeemScript: redeemScript.replace('03', '04') },
        { ...plan, receivingAddress: 'OTHER' },
      ]) {
        expect(() =>
          validateLocalTradePlan([changed], [offer], coin, 'QORT')
        ).toThrow();
      }
      expect(() =>
        validateLocalTradePlan(
          [plan],
          [{ ...offer, creatorForeignPKH: 'not-valid-base58-0' }],
          coin,
          'QORT'
        )
      ).toThrow();
    });

  it('accepts the Base58 seller key hash returned by the live Core API', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1788958554000);
    const offer = {
      qortalAtAddress: 'AQyL6gfcJ6vbmN7thDii3h3di5Mq7u1uZ4',
      expectedForeignAmount: '0.04350000',
      tradeTimeout: 120,
      creatorForeignPKH: '3TuTyu7byeYxS4Ly4pJGepauRZet',
    };
    const plan = {
      atAddress: offer.qortalAtAddress,
      receivingAddress: 'QORT',
      address: '31kxF481xPMfR5H6bdMib5XUu8mYC9e6JH',
      amount: '4352730',
      fundingReserve: '2730',
      lockTime: 1788965754,
      refundPublicKeyHash: 'c04caa54b7a5251dcb0597da62e586101048d6b9',
      hashOfSecret: 'a1d75bb7ed909f700bb25be919e4b6cba31f07e1',
      redeemScript:
        '7dada97614c04caa54b7a5251dcb0597da62e586101048d6b9876375047a73a16ab16714b0da988370168d62ea7968d7f0a38ff8a10098f588a914a1d75bb7ed909f700bb25be919e4b6cba31f07e18768',
    };

    try {
      expect(validateLocalTradePlan([plan], [offer], 'LTC', 'QORT')).toEqual([
        { address: plan.address, value: 4352730n },
      ]);
    } finally {
      now.mockRestore();
    }
  });
});
