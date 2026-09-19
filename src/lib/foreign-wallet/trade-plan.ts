import { atomicAmount } from './send';
import { type ForeignWalletCoin, foreignCrypto } from './foreign-wallets';
import { validateForeignWalletRecipient } from './foreign-wallet-transaction';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { sha256 } from '@noble/hashes/sha256';
import Base58 from '../../encryption/Base58';
// Pure validation before any signing: bind outputs to the selected ATs and HTLC terms.
export function validateLocalTradePlan(
  plans: any,
  offers: any[],
  coin: ForeignWalletCoin,
  receivingAddress: string
) {
  if (
    !Array.isArray(plans) ||
    plans.length !== offers.length ||
    plans.length === 0 ||
    plans.length > 20
  )
    throw new Error('Invalid trade plan');
  return plans.map((plan, index) => {
    const offer = offers[index];
    if (
      plan.atAddress !== offer.qortalAtAddress ||
      plan.receivingAddress !== receivingAddress ||
      !Number.isSafeInteger(plan.lockTime) ||
      plan.lockTime < Date.now() / 1000 + 300 ||
      plan.lockTime >
        Date.now() / 1000 + Number(offer.tradeTimeout) * 60 + 60 ||
      !/^[a-f0-9]{40}$/.test(plan.refundPublicKeyHash) ||
      !/^[a-f0-9]{40}$/.test(plan.hashOfSecret)
    )
      throw new Error('Invalid trade terms');
    // Qortal's API adapter serializes byte[] values as Base58 strings.
    const seller =
      typeof offer.creatorForeignPKH === 'string'
        ? bytesToHex(Base58.decode(offer.creatorForeignPKH))
        : bytesToHex(Uint8Array.from(offer.creatorForeignPKH || []));
    if (!/^[a-f0-9]{40}$/.test(seller)) throw new Error('Invalid seller');
    const lock = new Uint8Array(4);
    new DataView(lock.buffer).setUint32(0, plan.lockTime, true);
    const script = `7dada97614${plan.refundPublicKeyHash}87637504${bytesToHex(lock)}b16714${seller}88a914${plan.hashOfSecret}8768`;
    if (script !== plan.redeemScript) throw new Error('Invalid HTLC');
    const recipient = validateForeignWalletRecipient({
      address: plan.address,
      coin,
      crypto: foreignCrypto,
    });
    const expectedScript = `a914${bytesToHex(ripemd160(sha256(hexToBytes(script))))}87`;
    if (bytesToHex(recipient.scriptPubKey) !== expectedScript)
      throw new Error('Invalid funding address');
    if (
      !/^[0-9]{1,18}$/.test(plan.amount) ||
      !/^[0-9]{1,18}$/.test(plan.fundingReserve)
    )
      throw new Error('Invalid funding amount');
    const reserve = BigInt(plan.fundingReserve);
    const amount = BigInt(plan.amount);
    const value = atomicAmount(offer.expectedForeignAmount);
    // Reserve is explicitly shown as part of the total paid; bound it relative to the purchase.
    if (reserve <= 0n || reserve > value || amount !== value + reserve)
      throw new Error('Invalid funding reserve');
    return { address: recipient.address, value: amount };
  });
}
