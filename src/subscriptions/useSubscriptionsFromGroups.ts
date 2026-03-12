import { useEffect, useMemo, useRef, useState } from 'react';
import { Sha256 } from 'asmcrypto.js';
import { getBaseApiReact } from '../App';
import { Buffer } from 'buffer';

export const publicSaltSubscriptionApp =
  'gnRp+Pao85XZlExcqynLS0+GaKCL3ia9E1sEm9XPaOA=';

// ─── inline types ────────────────────────────────────────────────────────────

type BillingInterval = 'hourly' | 'daily' | 'monthly' | 'yearly';

type GroupAccessType = 'private';

type GroupApiItem = {
  groupId: number;
  owner: string;
  groupName: string;
  description: string;
  created: number;
  isOpen: boolean;
  approvalThreshold: string;
  minimumBlockDelay: number;
  maximumBlockDelay: number;
  memberCount: number;
  ownerPrimaryName: string;
  type?: number;
};

type SubscriptionFullDetails = {
  schema: string;
  subscriptionId: string;
  ownerName: string;
  ownerAddress?: string;
  groupId: number;
  groupAccess: GroupAccessType;
  title: string;
  description: string;
  perks: string[];
  tags?: string[];
  createdAt: string;
  amountQort?: string;
  intervalDays?: number;
  graceDays?: number;
  states?: unknown[];
  status?: 'active' | 'disabled';
  disabledAt?: number;
  disabledReason?: string;
};

type MySubscription = {
  id: string;
  title: string;
  ownerName: string;
  groupInfo: unknown;
  priceQort: number;
  billingInterval: BillingInterval;
  status: 'active' | 'payment-needed' | 'disabled';
  nextPaymentDue: number | null;
  link: string;
};

// ─── inline helpers ──────────────────────────────────────────────────────────

const AMOUNT_TOLERANCE = 0.00001;

function getPaidIntervalsFromAmount(
  paidAmount: number,
  unitPrice: number
): number {
  if (
    !Number.isFinite(paidAmount) ||
    !Number.isFinite(unitPrice) ||
    unitPrice <= 0
  ) {
    return 0;
  }
  const raw = paidAmount / unitPrice;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw + AMOUNT_TOLERANCE);
}

function isMultipleOfUnitPrice(paidAmount: number, unitPrice: number): boolean {
  const intervals = getPaidIntervalsFromAmount(paidAmount, unitPrice);
  if (intervals < 1) return false;
  return Math.abs(paidAmount - unitPrice * intervals) <= AMOUNT_TOLERANCE;
}

export function getSubscriptionIdForGroup(groupId: number): string {
  return `subscription-${groupId}`;
}

const safeBase64 = (base64: string): string =>
  base64
    .replace(/\+/g, '.') // Replace '+' with '.' (URL-safe)
    .replace(/\//g, '~') // Replace '/' with '~' (URL-safe)
    .replace(/_/g, '!') // Replace '_' with '!' if needed (optional)
    .replace(/=+$/, ''); // Remove padding

export async function hashWord(
  word: string,
  collisionStrength: number,
  publicSalt: string
): Promise<string> {
  const saltedWord = publicSalt + word;

  try {
    if (!crypto?.subtle?.digest) throw new Error('Web Crypto not available');

    const encoded = new TextEncoder().encode(saltedWord);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    const base64 = Buffer.from(hashBuffer).toString('base64');

    return safeBase64(base64).slice(0, collisionStrength);
  } catch {
    const hash = new Sha256()
      .process(new TextEncoder().encode(saltedWord))
      .finish().result!;
    const base64 = Buffer.from(hash).toString('base64');

    return safeBase64(base64).slice(0, collisionStrength);
  }
}

export async function buildSubscriptionIdentifiers(subscriptionId: string) {
  const typeDetails = await hashWord(
    'subscription_details',
    14,
    publicSaltSubscriptionApp
  );

  const typeIndex = await hashWord(
    'subscription_index',
    14,
    publicSaltSubscriptionApp
  );

  const idHash = await hashWord(subscriptionId, 14, publicSaltSubscriptionApp);

  if (!typeDetails || !typeIndex || !idHash) {
    throw new Error('Failed to create subscription identifiers');
  }

  return {
    detailsIdentifier: typeDetails + idHash,
    indexIdentifier: typeIndex + idHash + '-v1',
    idHash,
  };
}

function intervalDaysToBillingInterval(intervalDays: number): BillingInterval {
  if (intervalDays < 0.1) return 'hourly';
  if (intervalDays === 1) return 'daily';
  if (intervalDays >= 365) return 'yearly';
  return 'monthly';
}

function parseOnChainIndexData(
  data: string
): { priceQort: number; intervalDays: number } | null {
  if (!data || typeof data !== 'string') return null;
  const decoded =
    data.length > 0 && !data.includes('|')
      ? (() => {
          try {
            return atob(data);
          } catch {
            return data;
          }
        })()
      : data;
  const parts = decoded.trim().split('|');
  if (parts.length < 5 || parts[0] !== 'qsub1') return null;
  const amt = parseFloat(parts[2]);
  let intervalDays = parseFloat(parts[3]);
  if (Number.isNaN(amt) || Number.isNaN(intervalDays) || intervalDays < 0)
    return null;
  if (intervalDays === 0) intervalDays = 1 / 24;
  return { priceQort: amt, intervalDays };
}

async function fetchSubscriptionIndexPrice(
  ownerName: string,
  indexIdentifier: string
): Promise<{ priceQort: number; intervalDays: number } | null> {
  const res = await fetch(
    `${getBaseApiReact()}/arbitrary/DOCUMENT/${encodeURIComponent(ownerName)}/${encodeURIComponent(indexIdentifier)}`
  );
  if (!res.ok) return null;
  let dataStr = await res.text();
  try {
    const parsed = JSON.parse(dataStr);
    if (parsed && typeof parsed === 'object') {
      const raw = parsed.resource?.data ?? parsed.data;
      if (raw != null) dataStr = typeof raw === 'string' ? raw : String(raw);
    }
  } catch {
    // not JSON
  }
  if (!dataStr.includes('|')) {
    try {
      dataStr = atob(dataStr);
    } catch {
      return null;
    }
  }
  return parseOnChainIndexData(dataStr);
}

/** Parse the subscriber's latest PRODUCT record to get { si, tx }. */
function parseProductRecordData(raw: any): { si?: string; tx: string } | null {
  if (!raw) return null;
  if (typeof raw.tx === 'string') {
    return { si: typeof raw.si === 'string' ? raw.si : undefined, tx: raw.tx };
  }
  const b64 = raw.data ?? raw.resource?.data;
  if (typeof b64 === 'string') {
    try {
      const decoded = JSON.parse(atob(b64)) as { si?: string; tx?: string };
      if (decoded && typeof decoded.tx === 'string') {
        return {
          si: typeof decoded.si === 'string' ? decoded.si : undefined,
          tx: decoded.tx,
        };
      }
    } catch {
      // ignore
    }
  }
  return null;
}

// ─── hook ────────────────────────────────────────────────────────────────────

export function useSubscriptionsFromGroups(
  address: string,
  name: string,
  groups: GroupApiItem[]
) {
  const [mySubscriptions, setMySubscriptions] = useState<MySubscription[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disableLoading = useRef(false);
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!address) return;
      if (!name) return;
      if (!groups || groups.length === 0) return;
      if (!disableLoading.current) {
        setLoading(true);
      }

      setError(null);

      try {
        disableLoading.current = true;
        const results = await Promise.all(
          groups
            .filter((g) => g.owner !== address && !g.isOpen)
            .map(async (g) => {
              const ownerPrimaryName = g.ownerPrimaryName;
              console.log('ownerPrimaryName', ownerPrimaryName);
              if (!ownerPrimaryName) return null;

              const subscriptionId = getSubscriptionIdForGroup(g.groupId);
              try {
                await buildSubscriptionIdentifiers(subscriptionId);
              } catch (error) {
                console.log('error', error);
                return null;
              }
              console.log('subscriptionId', subscriptionId);
              const { indexIdentifier, detailsIdentifier } =
                await buildSubscriptionIdentifiers(subscriptionId);
              console.log('indexIdentifier', indexIdentifier);
              console.log('detailsIdentifier', detailsIdentifier);
              const matches = await fetch(
                `${getBaseApiReact()}/arbitrary/resources/searchsimple?mode=ALL&service=DOCUMENT&identifier=${indexIdentifier}&name=${ownerPrimaryName}&limit=1&exactmatchnames=true&prefix=true`
              );
              if (!matches.ok) return null;
              const matchesData = await matches.json();
              if (!matchesData || matchesData.length === 0) return null;
              console.log('matchesData', matchesData);
              const detailsRes = await fetch(
                `${getBaseApiReact()}/arbitrary/DOCUMENT/${encodeURIComponent(ownerPrimaryName)}/${encodeURIComponent(detailsIdentifier)}`
              );
              if (!detailsRes.ok) return null;
              const dataStr = await detailsRes.json();

              const details = dataStr as SubscriptionFullDetails | undefined;

              const anyDetails = details as any;
              if (anyDetails?.status === 'disabled') return null;
              const title =
                details && typeof anyDetails?.title === 'string'
                  ? anyDetails.title
                  : null;
              const detailsAmountQort =
                details && anyDetails?.amountQort != null
                  ? Number(anyDetails.amountQort)
                  : null;
              const detailsIntervalDays =
                details && typeof anyDetails?.intervalDays === 'number'
                  ? anyDetails.intervalDays
                  : 30;
              if (!title || !detailsAmountQort || !detailsIntervalDays)
                return null;
              // Resolve locked-in price/interval/expiry from subscriber's PRODUCT record.
              let priceQort = Number.isFinite(detailsAmountQort)
                ? detailsAmountQort
                : null;
              if (!priceQort) return null;
              let resolvedIntervalDays = detailsIntervalDays;
              let nextPaymentDue: number | null = null;

              const userName = name;
              if (!userName) return null;

              try {
                const paymentRecords = await fetch(
                  `${getBaseApiReact()}/arbitrary/resources/searchsimple?mode=ALL&service=PRODUCT&identifier=${detailsIdentifier}&name=${userName}&limit=1&exactmatchnames=true&reverse=true`
                );
                if (!paymentRecords.ok) return null;
                const paymentRecordsData = await paymentRecords.json();

                if (paymentRecordsData && paymentRecordsData.length > 0) {
                  const record = paymentRecordsData[0];
                  let recordData: any = null;
                  try {
                    if ((record as any).data) {
                      recordData = (record as any).data;
                    } else if ((record as any).identifier) {
                      const dataResponse = await fetch(
                        `${getBaseApiReact()}/arbitrary/PRODUCT/${userName}/${(record as any).identifier}`
                      );
                      if (dataResponse.ok)
                        recordData = await dataResponse.json();
                    }
                  } catch {
                    // ignore fetch error
                  }

                  const parsed = parseProductRecordData(recordData);
                  if (parsed) recordData = parsed;

                  if (parsed?.si && parsed?.tx) {
                    const indexData = await fetchSubscriptionIndexPrice(
                      ownerPrimaryName,
                      parsed.si
                    );
                    if (indexData) {
                      priceQort = indexData.priceQort;
                      resolvedIntervalDays = indexData.intervalDays;
                    }

                    try {
                      const txResponse = await fetch(
                        `${getBaseApiReact()}/transactions/signature/${parsed.tx}`
                      );
                      if (txResponse.ok) {
                        const txData = await txResponse.json();
                        const paymentTs = txData?.timestamp;
                        const amountPaid = parseFloat(txData?.amount || '0');
                        if (
                          paymentTs != null &&
                          amountPaid > 0 &&
                          isMultipleOfUnitPrice(amountPaid, priceQort)
                        ) {
                          const paidIntervals = getPaidIntervalsFromAmount(
                            amountPaid,
                            priceQort
                          );
                          const expiresAt =
                            paymentTs +
                            paidIntervals *
                              resolvedIntervalDays *
                              24 *
                              60 *
                              60 *
                              1000;
                          nextPaymentDue = expiresAt;
                        }
                      }
                    } catch {
                      // ignore tx fetch error — keep details-based fallback
                    }
                  }
                }
              } catch {
                // ignore PRODUCT fetch error — keep details-based fallback
              }

              const sub: MySubscription = {
                id: subscriptionId,
                title,
                ownerName: ownerPrimaryName,
                groupInfo: g,
                priceQort,
                billingInterval:
                  intervalDaysToBillingInterval(resolvedIntervalDays),
                nextPaymentDue,
                link: ``,
                status:
                  nextPaymentDue == null || Date.now() > nextPaymentDue
                    ? 'payment-needed'
                    : 'active',
              };

              return sub;
            })
        );

        const mySubs = results.filter(Boolean) as MySubscription[];
        if (!cancelled) setMySubscriptions(mySubs);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load subscriptions');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [address, name, groups]);

  return { mySubscriptions, loading, error };
}
