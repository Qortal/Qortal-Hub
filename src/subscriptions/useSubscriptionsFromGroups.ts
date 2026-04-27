import { Sha256 } from 'asmcrypto.js';
import { useEffect, useRef, useState } from 'react';
import { getBaseApiReact } from '../App';

export const publicSaltSubscriptionApp =
  'gnRp+Pao85XZlExcqynLS0+GaKCL3ia9E1sEm9XPaOA=';

type BillingInterval = 'monthly';
type GroupAccessType = 'private';

export type SubscriptionGroupItem = {
  groupId: number;
  owner: string;
  groupName: string;
  description?: string;
  created?: number;
  isOpen?: boolean;
  memberCount?: number;
  ownerPrimaryName?: string;
  isAdmin?: boolean;
  [key: string]: unknown;
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

export type MySubscription = {
  id: string;
  title: string;
  ownerName: string;
  groupInfo: SubscriptionGroupItem;
  priceQort: number;
  billingInterval: BillingInterval;
  status: 'active' | 'payment-needed' | 'disabled';
  nextPaymentDue: number | null;
  link: string;
};

const AMOUNT_TOLERANCE = 0.00001;

function bytesToBase64(bytes: Uint8Array | number[]) {
  let binary = '';
  const byteArray = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let index = 0; index < byteArray.length; index += 1) {
    binary += String.fromCharCode(byteArray[index]);
  }
  return btoa(binary);
}

function getPaidIntervalsFromAmount(paidAmount: number, unitPrice: number) {
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

function isMultipleOfUnitPrice(paidAmount: number, unitPrice: number) {
  const intervals = getPaidIntervalsFromAmount(paidAmount, unitPrice);
  if (intervals < 1) return false;
  return Math.abs(paidAmount - unitPrice * intervals) <= AMOUNT_TOLERANCE;
}

export function getSubscriptionIdForGroup(groupId: number) {
  return `subscription-${groupId}`;
}

const safeBase64 = (base64: string) =>
  base64
    .replace(/\+/g, '.')
    .replace(/\//g, '~')
    .replace(/_/g, '!')
    .replace(/=+$/, '');

export async function hashWord(
  word: string,
  collisionStrength: number,
  publicSalt: string
) {
  const saltedWord = publicSalt + word;

  try {
    if (!crypto?.subtle?.digest) throw new Error('Web Crypto unavailable');
    const encoded = new TextEncoder().encode(saltedWord);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    return safeBase64(bytesToBase64(new Uint8Array(hashBuffer))).slice(
      0,
      collisionStrength
    );
  } catch {
    const hash = new Sha256()
      .process(new TextEncoder().encode(saltedWord))
      .finish().result;
    return safeBase64(bytesToBase64(hash as number[])).slice(
      0,
      collisionStrength
    );
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
    indexIdentifier: `${typeIndex}${idHash}-v1`,
    idHash,
  };
}

function intervalDaysToBillingInterval(_intervalDays: number): BillingInterval {
  return 'monthly';
}

function parseOnChainIndexData(data: string) {
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
  const priceQort = parseFloat(parts[2]);
  if (Number.isNaN(priceQort)) return null;
  return { priceQort, intervalDays: 30 };
}

async function fetchSubscriptionIndexPrice(
  ownerName: string,
  indexIdentifier: string
) {
  const response = await fetch(
    `${getBaseApiReact()}/arbitrary/DOCUMENT/${encodeURIComponent(ownerName)}/${encodeURIComponent(indexIdentifier)}`
  );
  if (!response.ok) return null;
  let dataStr = await response.text();
  try {
    const parsed = JSON.parse(dataStr);
    const raw = parsed?.resource?.data ?? parsed?.data;
    if (raw != null) dataStr = typeof raw === 'string' ? raw : String(raw);
  } catch {
    // Plain text response.
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
      // Ignore malformed product data.
    }
  }
  return null;
}

export function useSubscriptionsFromGroups(
  address: string | undefined,
  name: string | undefined,
  groups: SubscriptionGroupItem[]
) {
  const [mySubscriptions, setMySubscriptions] = useState<MySubscription[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnce = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!address || !name || !Array.isArray(groups) || groups.length === 0) {
        setMySubscriptions([]);
        setLoading(false);
        return;
      }

      if (!hasLoadedOnce.current) setLoading(true);
      setError(null);

      try {
        const results = await Promise.all(
          groups
            .filter((group) => group.owner !== address && !group.isOpen)
            .map(async (group) => {
              const ownerPrimaryName = group.ownerPrimaryName;
              if (!ownerPrimaryName) return null;

              const subscriptionId = getSubscriptionIdForGroup(group.groupId);
              const { detailsIdentifier, indexIdentifier } =
                await buildSubscriptionIdentifiers(subscriptionId);

              const matches = await fetch(
                `${getBaseApiReact()}/arbitrary/resources/searchsimple?mode=ALL&service=DOCUMENT&identifier=${indexIdentifier}&name=${ownerPrimaryName}&limit=1&exactmatchnames=true&prefix=true`
              );
              if (!matches.ok) return null;
              const matchesData = await matches.json();
              if (!matchesData?.length) return null;

              const detailsResponse = await fetch(
                `${getBaseApiReact()}/arbitrary/DOCUMENT/${encodeURIComponent(ownerPrimaryName)}/${encodeURIComponent(detailsIdentifier)}`
              );
              if (!detailsResponse.ok) return null;

              const details = (await detailsResponse.json()) as
                | SubscriptionFullDetails
                | undefined;
              if ((details as any)?.status === 'disabled') return null;

              const title =
                details && typeof (details as any)?.title === 'string'
                  ? (details as any).title
                  : null;
              let priceQort =
                details && (details as any)?.amountQort != null
                  ? Number((details as any).amountQort)
                  : null;
              if (!title || !priceQort) return null;

              let resolvedIntervalDays = 30;
              let nextPaymentDue: number | null = null;

              try {
                const paymentRecords = await fetch(
                  `${getBaseApiReact()}/arbitrary/resources/searchsimple?mode=ALL&service=PRODUCT&identifier=${detailsIdentifier}&name=${name}&limit=1&exactmatchnames=true&reverse=true`
                );
                if (paymentRecords.ok) {
                  const paymentRecordsData = await paymentRecords.json();
                  const record = paymentRecordsData?.[0];
                  let recordData: any = null;

                  if (record?.data) {
                    recordData = record.data;
                  } else if (record?.identifier) {
                    const dataResponse = await fetch(
                      `${getBaseApiReact()}/arbitrary/PRODUCT/${name}/${record.identifier}`
                    );
                    if (dataResponse.ok) recordData = await dataResponse.json();
                  }

                  const parsed = parseProductRecordData(recordData);
                  if (parsed?.si && parsed?.tx) {
                    const indexData = await fetchSubscriptionIndexPrice(
                      ownerPrimaryName,
                      parsed.si
                    );
                    if (indexData) {
                      priceQort = indexData.priceQort;
                      resolvedIntervalDays = indexData.intervalDays;
                    }

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
                        nextPaymentDue =
                          paymentTs +
                          paidIntervals *
                            resolvedIntervalDays *
                            24 *
                            60 *
                            60 *
                            1000;
                      }
                    }
                  }
                }
              } catch {
                // Missing payment metadata just means the subscription needs payment.
              }

              return {
                id: subscriptionId,
                title,
                ownerName: ownerPrimaryName,
                groupInfo: group,
                priceQort,
                billingInterval: intervalDaysToBillingInterval(resolvedIntervalDays),
                nextPaymentDue,
                link: '',
                status:
                  nextPaymentDue == null || Date.now() > nextPaymentDue
                    ? 'payment-needed'
                    : 'active',
              } satisfies MySubscription;
            })
        );

        if (!cancelled) {
          setMySubscriptions(results.filter(Boolean) as MySubscription[]);
          hasLoadedOnce.current = true;
        }
      } catch (event: any) {
        if (!cancelled) {
          setError(event?.message ?? 'Failed to load subscriptions');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [address, name, groups]);

  return { mySubscriptions, loading, error };
}
