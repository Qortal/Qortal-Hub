import { describe, expect, it } from 'vitest';
import i18n from '../../../i18n/i18n';
import { fundingFrom } from '../../../lib/explorer/connections';
import type { TxRow } from '../../../lib/explorer/reads';
import { inCommonEntries, type InCommonData } from './InCommon';

// In common's link to the payer's Funded page: only for a first QORT
// payment (a PAYMENT), which is what that page lists.

const ACCOUNT = `Q${'A'.repeat(33)}`;
const PAYER = `Q${'F'.repeat(33)}`;

const row = (type: string, extra: Partial<TxRow>): TxRow =>
  ({
    type,
    timestamp: 1_700_000_000_000,
    signature: `sig-${type}`,
    blockHeight: 1_000_000,
    creatorAddress: PAYER,
    ...extra,
  }) as TxRow;

const common = { siblings: null, sponsorList: {} } as unknown as InCommonData;
const linkOf = (tx: TxRow) =>
  inCommonEntries(fundingFrom(tx, ACCOUNT), null, common, i18n.t, 'en').find(
    (entry) => entry.key === 'funding'
  )?.link;

describe('In common: the link to who else got their first QORT payment from it', () => {
  it('a payment links to the payer’s Funded page; a multi-payment doesn’t (that page lists payments)', () => {
    expect(linkOf(row('PAYMENT', { recipient: ACCOUNT, amount: '5' }))).toBe(
      'funded'
    );
    expect(
      linkOf(
        row('MULTI_PAYMENT', {
          payments: [{ recipient: ACCOUNT, amount: '5', assetId: 0 }],
        } as Partial<TxRow>)
      )
    ).toBeUndefined();
  });
});
