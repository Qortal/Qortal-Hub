/**
 * Read-watermark selection for Q-Chat channel reads.
 *
 * A read watermark is compared against `event.timestamp`, which is stamped by
 * the *sender's* clock. Using the local wall clock (`Date.now()`) as the
 * watermark is therefore unsafe: if any sender's clock runs ahead of ours, its
 * messages carry a timestamp greater than our watermark. Those messages then
 * satisfy `event.timestamp > watermark` permanently, so they count as unread
 * forever and the watermark can never advance past them. The visible symptom is
 * a channel whose unread badge never appears while its OS notifications fire
 * normally — the notification path and the count path disagree.
 *
 * The invariant this module enforces: a watermark may never sit ahead of the
 * newest event it is meant to cover. It is always anchored to real message
 * data, never to the local clock.
 */

/** The subset of a channel summary this module needs. */
export interface ChannelWatermarkSource {
  /** Newest known event in the channel, if any. */
  lastEvent?: { timestamp?: number | null } | null;
  /** Server-reported read watermark, if the channel has been read before. */
  readThroughTimestamp?: number | null;
  /** Newest activity seen for the channel, used only as a floor. */
  updatedAt?: number | null;
}

/**
 * Newest *message* timestamp known for a channel.
 *
 * Returns the greatest plausible candidate among the newest event, the existing
 * read watermark, and the summary's `updatedAt`. `updatedAt` is included because
 * a channel that has been read through and then had no new events can still
 * legitimately advance; excluding it would make repeat reads a no-op.
 *
 * Returns 0 when nothing is known, which callers must treat as "cannot advance"
 * rather than "advance to epoch".
 */
export function resolveChannelReadWatermark(
  source: ChannelWatermarkSource | null | undefined
): number {
  if (!source) return 0;
  const candidates = [
    Number(source.lastEvent?.timestamp),
    Number(source.readThroughTimestamp),
    Number(source.updatedAt),
  ].filter((value) => Number.isFinite(value) && value > 0);
  if (candidates.length === 0) return 0;
  return Math.max(...candidates);
}

/**
 * The watermark to send for a read of `(groupId, channelId)`.
 *
 * Returns `null` when no event data is available for the channel, meaning the
 * caller should skip the watermark advance entirely. Advancing to `Date.now()`
 * in that case is exactly the bug this module exists to prevent.
 */
export function resolveChannelReadWatermarkFromSummaries(
  summaries: Record<string, unknown> | null | undefined,
  groupId: number | string,
  channelId: string
): number | null {
  if (!summaries || typeof summaries !== 'object') return null;
  const entry = summaries[String(groupId)] as
    | { channels?: ChannelWatermarkSource[] }
    | undefined;
  const channels = Array.isArray(entry?.channels) ? entry.channels : [];
  const normalizedChannelId = String(channelId || '').trim();
  if (!normalizedChannelId) return null;
  const channel = channels.find(
    (candidate) =>
      String((candidate as { channelId?: string })?.channelId || '') ===
      normalizedChannelId
  );
  const watermark = resolveChannelReadWatermark(channel);
  return watermark > 0 ? watermark : null;
}

/**
 * Clamps a watermark request so it can never exceed the newest known event.
 *
 * Applied in the Electron main process as a backstop, so any future caller that
 * passes a wall-clock value is corrected rather than silently able to poison
 * the watermark. Returns `null` when the request should be rejected outright:
 * either the requested value is not a positive finite number, or the channel has
 * no known events to anchor it to.
 */
export function clampReadWatermark(
  requested: number,
  newestKnownEventTimestamp: number
): number | null {
  const requestedValue = Number(requested);
  if (!Number.isFinite(requestedValue) || requestedValue <= 0) return null;
  const anchor = Number(newestKnownEventTimestamp);
  // With no anchor there is nothing legitimate to clamp to. Refuse rather than
  // accept a watermark that could sit ahead of every message.
  if (!Number.isFinite(anchor) || anchor <= 0) return null;
  return Math.min(requestedValue, anchor);
}
