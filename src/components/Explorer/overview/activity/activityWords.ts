/**
 * The Activity's words: a milestone's sentence, a period read out with its
 * counts ("3 – 9 Mar 2024: 12 transactions: payments 8, QDN data 4"; a
 * period only partly read says so), all through i18n.
 */
import type { TFunction } from 'i18next';
import {
  ACTIVITY_FAMILIES,
  type ActivityBucket,
  type ActivityMark,
} from '../../../../lib/explorer/activity';
import {
  formatCount,
  formatList,
  formatPeriod,
} from '../../../../lib/explorer/format';
import { visibleName } from '../../../../lib/explorer/rules';
import { cap, isolate } from '../../parts';

const named = (name: string | undefined) =>
  isolate(visibleName(String(name ?? '')));

/** What a milestone says. */
export function markText(
  mark: ActivityMark,
  t: TFunction,
  language: string
): string {
  const count = mark.count ?? 1;
  if (mark.say === 'registered_many')
    return String(
      t(
        count > (mark.names?.length ?? 0)
          ? 'explorer:activity.mark.registered_many_more'
          : 'explorer:activity.mark.registered_many',
        {
          count,
          shown: formatCount(count, language),
          names: formatList((mark.names ?? []).map(named), language),
          ...cap,
        }
      )
    );
  return String(
    t(`explorer:activity.mark.${mark.say}`, {
      name: named(mark.name),
      newName: named(mark.newName),
      count,
      shown: formatCount(count, language),
      ...cap,
    })
  );
}

/** A period in dates. */
export const periodText = (
  bucket: Pick<ActivityBucket, 'start' | 'end'>,
  language: string
): string => formatPeriod(bucket.start, bucket.end, language);

/** How many transactions a period has, and of which kinds ("12 transactions: payments 8, QDN data 4"). */
export function countsText(
  bucket: ActivityBucket,
  t: TFunction,
  language: string
): string {
  const kinds = ACTIVITY_FAMILIES.filter(
    (family) => bucket.byFamily[family]
  ).map((family) =>
    String(
      t('explorer:activity.family_count', {
        family: t(`explorer:tx_family.${family}`),
        n: formatCount(bucket.byFamily[family] ?? 0, language),
      })
    )
  );
  return String(
    t(
      kinds.length
        ? 'explorer:activity.counts_kinds'
        : 'explorer:activity.counts',
      {
        count: bucket.total,
        shown: formatCount(bucket.total, language),
        kinds: formatList(kinds, language),
      }
    )
  );
}

/** A period's counts, and that it is partly read when what is before its oldest read isn't. */
export function bucketCountsText(
  bucket: ActivityBucket,
  t: TFunction,
  language: string
): string {
  const counts = countsText(bucket, t, language);
  return bucket.partial
    ? String(t('explorer:activity.counts_partial', { counts }))
    : counts;
}

/** A period read out: its dates and its counts, or that it isn't read yet. */
export function bucketText(
  bucket: ActivityBucket,
  t: TFunction,
  language: string
): string {
  const period = periodText(bucket, language);
  if (bucket.unread)
    return String(t('explorer:activity.bucket_unread', { period }));
  return String(
    t('explorer:activity.bucket', {
      period,
      counts: bucketCountsText(bucket, t, language),
    })
  );
}
