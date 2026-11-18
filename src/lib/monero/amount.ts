const UNIT = 1000000000000n;
export function moneroAtomicAmount(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9][0-9]{0,7})(\.[0-9]{1,12})?$/.test(value)
  )
    throw new Error('invalid');
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * UNIT + BigInt(fraction.padEnd(12, '0'));
  if (amount <= 0n || amount > 18446744073709551615n)
    throw new Error('invalid');
  return amount.toString();
}
export function moneroDecimalAmount(atomic: string): string {
  if (
    typeof atomic !== 'string' ||
    !/^(0|[1-9][0-9]{0,19})$/.test(atomic) ||
    BigInt(atomic) > 18446744073709551615n
  )
    throw new Error('invalid');
  const amount = BigInt(atomic);
  const fraction = (amount % UNIT)
    .toString()
    .padStart(12, '0')
    .replace(/0+$/, '');
  return (amount / UNIT).toString() + (fraction ? '.' + fraction : '');
}
