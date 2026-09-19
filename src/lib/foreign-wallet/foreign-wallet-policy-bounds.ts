import type { ForeignWalletCoin } from './foreign-wallets';
// Local ceilings remain independent of Core's estimates. These are safety limits,
// not recommended fees; the user approves the actual total before signing.
const limits = {
  BTC: [10000n, 1000000n, 2000n],
  LTC: [2000000n, 20000000n, 20000n],
  DOGE: [2000000000n, 20000000000n, 200000n],
  DGB: [10000n, 100000000n, 200000n],
  RVN: [50000n, 100000000n, 200000n],
} as const;
export function getForeignWalletPolicyBounds(coin: ForeignWalletCoin) {
  if (!Object.prototype.hasOwnProperty.call(limits, coin))
    throw new Error('Unsupported wallet coin');
  const [maximumDustThreshold, maximumFee, maximumFeePerByte] = limits[coin];
  return { maximumDustThreshold, maximumFee, maximumFeePerByte };
}
export function assertForeignWalletContextWithinPolicy(context: {
  coin: ForeignWalletCoin;
  minimumNonDustOutput: bigint;
  recommendedFeePerByte: bigint;
}) {
  const bounds = getForeignWalletPolicyBounds(context.coin);
  if (
    context.minimumNonDustOutput <= 0n ||
    context.minimumNonDustOutput > bounds.maximumDustThreshold ||
    context.recommendedFeePerByte <= 0n ||
    context.recommendedFeePerByte > bounds.maximumFeePerByte
  )
    throw new Error('Wallet fee policy exceeded');
}
export function assertForeignWalletPlanWithinPolicy(plan: {
  coin: ForeignWalletCoin;
  fee: bigint;
  feePerByte: bigint;
  amount: bigint;
  estimatedMaximumSize: number;
  sendMax: boolean;
}) {
  const bounds = getForeignWalletPolicyBounds(plan.coin);
  if (
    plan.fee < 0n ||
    plan.fee > bounds.maximumFee ||
    plan.fee > BigInt(plan.estimatedMaximumSize) * bounds.maximumFeePerByte ||
    (!plan.sendMax && plan.fee > plan.amount)
  )
    throw new Error('Wallet fee policy exceeded');
}
