import * as nodeCrypto from 'crypto';
import moment from 'moment-timezone';
import { verifyEd25519Detached } from './ed25519-verify-common';
import {
  base58Decode,
  canonicalizeForSigning,
  deriveAddressFromPublicKey,
} from './presence';

export type ReticulumCalendarFrequency =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly';

export type ReticulumCalendarRecurrence = {
  frequency: ReticulumCalendarFrequency;
  untilLocalDate?: string;
};

export type ReticulumCalendarCoverImage = {
  namespace: 'reticulum-group-resource';
  ownerId?: string;
  fileName: string;
  mimeType: 'image/webp';
  sizeBytes: number;
  fileHash: string;
  encrypted: false;
  createdAt: number;
  metadata: {
    feature: 'reticulum-calendar-cover';
    groupId: number;
    width: number;
    height: number;
  };
};

export type ReticulumCalendarEventState = {
  eventId: string;
  groupId: number;
  title: string;
  description: string;
  location: string;
  link: string;
  coverImage?: ReticulumCalendarCoverImage;
  allDay: boolean;
  timezone: string;
  startLocal: string;
  endLocal: string;
  recurrence: ReticulumCalendarRecurrence | null;
};

export type ReticulumCalendarMutation = {
  version: 1;
  mutationId: string;
  operation: 'upsert' | 'delete';
  eventId: string;
  groupId: number;
  timestamp: number;
  state: ReticulumCalendarEventState | null;
  authorAddress: string;
  authorPublicKey: string;
  signature: string;
};

export type ReticulumCalendarOccurrence = ReticulumCalendarEventState & {
  creatorAddress: string;
  createdAt?: number;
  occurrenceId: string;
  occurrenceStart: number;
  occurrenceEnd: number;
  sourceMutationId: string;
  updatedAt: number;
};

export type ReticulumCalendarReminder = {
  ownerAddress: string;
  groupId: number;
  eventId: string;
  offsetMs: number | null;
  lastFiredOccurrenceId: string;
  updatedAt: number;
};

export const RETICULUM_CALENDAR_MAX_RESOURCE_BYTES = 64 * 1024;
export const RETICULUM_CALENDAR_VISIBLE_PAST_MS = 365 * 24 * 60 * 60 * 1000;
export const RETICULUM_CALENDAR_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const RETICULUM_CALENDAR_REMINDER_OFFSETS = new Set([
  0,
  10 * 60 * 1000,
  30 * 60 * 1000,
  60 * 60 * 1000,
  24 * 60 * 60 * 1000,
]);

const ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
const FREQUENCIES = new Set<ReticulumCalendarFrequency>([
  'daily',
  'weekly',
  'monthly',
  'yearly',
]);

function cleanText(value: unknown, maxCodePoints: number): string {
  const cleaned = Array.from(String(value ?? '').normalize('NFC'))
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && (codePoint < 127 || codePoint > 159);
    })
    .join('')
    .trim();
  return Array.from(cleaned).slice(0, maxCodePoints).join('');
}

function exceedsCodePointLimit(value: unknown, limit: number): boolean {
  return Array.from(String(value ?? '').normalize('NFC')).length > limit;
}

function normalizeLocal(value: unknown, allDay: boolean): string {
  const text = String(value ?? '').trim();
  const format = allDay ? 'YYYY-MM-DD' : 'YYYY-MM-DDTHH:mm:ss';
  const accepted = allDay
    ? LOCAL_DATE_PATTERN.test(text)
    : LOCAL_DATE_TIME_PATTERN.test(text);
  if (!accepted) return '';
  const parsed = moment(text, allDay ? 'YYYY-MM-DD' : moment.ISO_8601, true);
  return parsed.isValid() ? parsed.format(format) : '';
}

function normalizeCoverImage(
  value: unknown,
  groupId: number
): ReticulumCalendarCoverImage | null {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const metadata =
    input.metadata && typeof input.metadata === 'object'
      ? (input.metadata as Record<string, unknown>)
      : null;
  const fileHash = String(input.fileHash || '')
    .trim()
    .toLowerCase();
  const sizeBytes = Number(input.sizeBytes);
  const createdAt = Number(input.createdAt);
  const width = Number(metadata?.width);
  const height = Number(metadata?.height);
  if (
    input.namespace !== 'reticulum-group-resource' ||
    input.mimeType !== 'image/webp' ||
    input.encrypted !== false ||
    !/^[0-9a-f]{64}$/.test(fileHash) ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > 600 * 1024 ||
    !Number.isFinite(createdAt) ||
    createdAt <= 0 ||
    metadata?.feature !== 'reticulum-calendar-cover' ||
    Number(metadata?.groupId) !== groupId ||
    width !== 1200 ||
    ![675, 900].includes(height)
  ) {
    return null;
  }
  const fileName = cleanText(input.fileName, 180);
  if (!fileName) return null;
  const ownerId = cleanText(input.ownerId, 180);
  return {
    namespace: 'reticulum-group-resource',
    ...(ownerId ? { ownerId } : {}),
    fileName,
    mimeType: 'image/webp',
    sizeBytes,
    fileHash,
    encrypted: false,
    createdAt: Math.floor(createdAt),
    metadata: {
      feature: 'reticulum-calendar-cover',
      groupId,
      width,
      height,
    },
  };
}

export function normalizeReticulumCalendarInput(
  groupId: unknown,
  eventId: unknown,
  value: unknown
): ReticulumCalendarEventState | null {
  if (!Number.isInteger(Number(groupId)) || Number(groupId) <= 0) return null;
  const normalizedEventId = String(eventId ?? '')
    .trim()
    .toLowerCase();
  if (!ID_PATTERN.test(normalizedEventId)) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    exceedsCodePointLimit(input.title, 120) ||
    exceedsCodePointLimit(input.description, 4_000) ||
    exceedsCodePointLimit(input.location, 240) ||
    exceedsCodePointLimit(input.link, 2_048) ||
    exceedsCodePointLimit(input.timezone, 80)
  )
    return null;
  const title = cleanText(input.title, 120);
  if (!title) return null;
  const allDay = input.allDay === true;
  const timezone = cleanText(input.timezone, 80);
  if (!timezone || !moment.tz.zone(timezone)) return null;
  const startLocal = normalizeLocal(input.startLocal, allDay);
  const endLocal = normalizeLocal(input.endLocal, allDay);
  if (!startLocal || !endLocal) return null;
  const start = moment.tz(startLocal, timezone);
  const end = moment.tz(endLocal, timezone);
  if (
    !start.isValid() ||
    !end.isValid() ||
    !end.isAfter(start) ||
    start.year() < 1970 ||
    start.year() > 2200 ||
    end.year() > 2201 ||
    end.diff(start) > 366 * 24 * 60 * 60 * 1000
  )
    return null;

  let recurrence: ReticulumCalendarRecurrence | null = null;
  if (input.recurrence != null) {
    if (typeof input.recurrence !== 'object' || Array.isArray(input.recurrence))
      return null;
    const raw = input.recurrence as Record<string, unknown>;
    const frequency = String(raw.frequency || '') as ReticulumCalendarFrequency;
    if (!FREQUENCIES.has(frequency)) return null;
    const untilLocalDate = raw.untilLocalDate
      ? String(raw.untilLocalDate).trim()
      : '';
    if (untilLocalDate && !LOCAL_DATE_PATTERN.test(untilLocalDate)) return null;
    if (untilLocalDate && !moment(untilLocalDate, 'YYYY-MM-DD', true).isValid())
      return null;
    if (untilLocalDate && untilLocalDate < startLocal.slice(0, 10)) return null;
    recurrence = {
      frequency,
      ...(untilLocalDate ? { untilLocalDate } : {}),
    };
  }

  const link = cleanText(input.link, 2_048);
  if (link) {
    try {
      const parsed = new URL(link);
      if (!['https:', 'http:', 'qortal:'].includes(parsed.protocol))
        return null;
    } catch {
      return null;
    }
  }
  const coverImage = normalizeCoverImage(input.coverImage, Number(groupId));
  const state: ReticulumCalendarEventState = {
    eventId: normalizedEventId,
    groupId: Number(groupId),
    title,
    description: cleanText(input.description, 4_000),
    location: cleanText(input.location, 240),
    link,
    ...(coverImage ? { coverImage } : {}),
    allDay,
    timezone,
    startLocal,
    endLocal,
    recurrence,
  };
  if (
    Buffer.byteLength(JSON.stringify(state), 'utf8') >
    RETICULUM_CALENDAR_MAX_RESOURCE_BYTES / 2
  )
    return null;
  return state;
}

export function buildReticulumCalendarMutationSignedFields(
  mutation: Omit<ReticulumCalendarMutation, 'signature'>
): Record<string, unknown> {
  return {
    type: 'RETICULUM_CALENDAR_MUTATION_V1',
    version: 1,
    mutationId: mutation.mutationId,
    operation: mutation.operation,
    eventId: mutation.eventId,
    groupId: mutation.groupId,
    timestamp: mutation.timestamp,
    state: mutation.state,
    authorAddress: mutation.authorAddress,
    authorPublicKey: mutation.authorPublicKey,
  };
}

export function verifyReticulumCalendarMutation(
  value: unknown,
  now = Date.now()
): ReticulumCalendarMutation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<ReticulumCalendarMutation>;
  if (
    candidate.version !== 1 ||
    !ID_PATTERN.test(String(candidate.mutationId || '')) ||
    !ID_PATTERN.test(String(candidate.eventId || '')) ||
    !Number.isInteger(candidate.groupId) ||
    Number(candidate.groupId) <= 0 ||
    !Number.isFinite(candidate.timestamp) ||
    Number(candidate.timestamp) <= 0 ||
    Number(candidate.timestamp) > now + RETICULUM_CALENDAR_MAX_FUTURE_SKEW_MS ||
    (candidate.operation !== 'upsert' && candidate.operation !== 'delete') ||
    typeof candidate.authorAddress !== 'string' ||
    typeof candidate.authorPublicKey !== 'string' ||
    typeof candidate.signature !== 'string'
  )
    return null;

  const eventId = String(candidate.eventId).toLowerCase();
  const state =
    candidate.operation === 'upsert'
      ? normalizeReticulumCalendarInput(
          candidate.groupId,
          eventId,
          candidate.state
        )
      : null;
  if (candidate.operation === 'upsert' && !state) return null;
  if (candidate.operation === 'delete' && candidate.state != null) return null;
  const normalized: ReticulumCalendarMutation = {
    version: 1,
    mutationId: String(candidate.mutationId).toLowerCase(),
    operation: candidate.operation,
    eventId,
    groupId: Number(candidate.groupId),
    timestamp: Math.floor(Number(candidate.timestamp)),
    state,
    authorAddress: candidate.authorAddress.trim(),
    authorPublicKey: candidate.authorPublicKey.trim(),
    signature: candidate.signature.trim(),
  };
  try {
    if (
      deriveAddressFromPublicKey(normalized.authorPublicKey) !==
      normalized.authorAddress
    )
      return null;
    const { signature: _signature, ...unsigned } = normalized;
    return verifyEd25519Detached(
      new Uint8Array(
        canonicalizeForSigning(
          buildReticulumCalendarMutationSignedFields(unsigned)
        )
      ),
      new Uint8Array(base58Decode(normalized.signature)),
      new Uint8Array(base58Decode(normalized.authorPublicKey))
    )
      ? normalized
      : null;
  } catch {
    return null;
  }
}

export function hashReticulumCalendarResource(value: string): string {
  return nodeCrypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function reticulumCalendarStateBounds(
  state: ReticulumCalendarEventState
): { startAt: number; endAt: number; recurrenceUntilAt: number | null } {
  return {
    startAt: moment.tz(state.startLocal, state.timezone).valueOf(),
    endAt: moment.tz(state.endLocal, state.timezone).valueOf(),
    recurrenceUntilAt: state.recurrence?.untilLocalDate
      ? moment
          .tz(`${state.recurrence.untilLocalDate}T23:59:59`, state.timezone)
          .valueOf()
      : null,
  };
}

function reticulumCalendarOccurrenceFromStart(
  mutation: ReticulumCalendarMutation,
  occurrenceStart: moment.Moment
): ReticulumCalendarOccurrence | null {
  if (mutation.operation !== 'upsert' || !mutation.state) return null;
  const state = mutation.state;
  const seriesStart = moment.tz(state.startLocal, state.timezone);
  const seriesEnd = moment.tz(state.endLocal, state.timezone);
  const localDaySpan = moment(seriesEnd.format('YYYY-MM-DD')).diff(
    moment(seriesStart.format('YYYY-MM-DD')),
    'days'
  );
  const occurrenceEnd = occurrenceStart
    .clone()
    .add(localDaySpan, 'days')
    .hour(seriesEnd.hour())
    .minute(seriesEnd.minute())
    .second(seriesEnd.second())
    .millisecond(seriesEnd.millisecond());
  return {
    ...state,
    creatorAddress: mutation.authorAddress,
    occurrenceId: `${state.eventId}:${occurrenceStart.valueOf()}`,
    occurrenceStart: occurrenceStart.valueOf(),
    occurrenceEnd: occurrenceEnd.valueOf(),
    sourceMutationId: mutation.mutationId,
    updatedAt: mutation.timestamp,
  };
}

export function findNextReticulumCalendarOccurrence(
  mutation: ReticulumCalendarMutation,
  occurrenceStartAtOrAfter: number
): ReticulumCalendarOccurrence | null {
  if (mutation.operation !== 'upsert' || !mutation.state) return null;
  const state = mutation.state;
  const start = moment.tz(state.startLocal, state.timezone);
  if (!state.recurrence) {
    return start.valueOf() >= occurrenceStartAtOrAfter
      ? reticulumCalendarOccurrenceFromStart(mutation, start)
      : null;
  }

  const threshold = moment(occurrenceStartAtOrAfter).tz(state.timezone);
  const until = state.recurrence.untilLocalDate
    ? moment.tz(`${state.recurrence.untilLocalDate}T23:59:59`, state.timezone)
    : null;
  let occurrenceIndex = 0;
  if (threshold.isAfter(start)) {
    if (state.recurrence.frequency === 'daily') {
      occurrenceIndex = threshold
        .clone()
        .startOf('day')
        .diff(start.clone().startOf('day'), 'days');
    } else if (state.recurrence.frequency === 'weekly') {
      occurrenceIndex = Math.floor(
        threshold
          .clone()
          .startOf('day')
          .diff(start.clone().startOf('day'), 'days') / 7
      );
    } else if (state.recurrence.frequency === 'monthly') {
      occurrenceIndex =
        (threshold.year() - start.year()) * 12 +
        threshold.month() -
        start.month();
    } else {
      occurrenceIndex = threshold.year() - start.year();
    }
  }
  occurrenceIndex = Math.max(0, occurrenceIndex);

  const unit: moment.unitOfTime.DurationConstructor =
    state.recurrence.frequency === 'daily'
      ? 'day'
      : state.recurrence.frequency === 'weekly'
        ? 'week'
        : state.recurrence.frequency === 'monthly'
          ? 'month'
          : 'year';
  const originalDay = start.date();
  const originalMonth = start.month();
  // Month-end and leap-day series need at most a few skipped candidates. The
  // generous guard remains constant-time even for dates decades in the future.
  for (let guard = 0; guard < 8; guard += 1, occurrenceIndex += 1) {
    const current = start.clone().add(occurrenceIndex, unit);
    if (until && current.isAfter(until)) return null;
    const validMonthly =
      state.recurrence.frequency !== 'monthly' ||
      current.date() === originalDay;
    const validYearly =
      state.recurrence.frequency !== 'yearly' ||
      (current.month() === originalMonth && current.date() === originalDay);
    if (
      validMonthly &&
      validYearly &&
      current.valueOf() >= occurrenceStartAtOrAfter
    ) {
      return reticulumCalendarOccurrenceFromStart(mutation, current);
    }
  }
  return null;
}

export function expandReticulumCalendarMutation(
  mutation: ReticulumCalendarMutation,
  rangeStart: number,
  rangeEnd: number,
  maxOccurrences = 1_000
): ReticulumCalendarOccurrence[] {
  if (mutation.operation !== 'upsert' || !mutation.state) return [];
  const state = mutation.state;
  const start = moment.tz(state.startLocal, state.timezone);
  const end = moment.tz(state.endLocal, state.timezone);
  const durationMs = end.valueOf() - start.valueOf();
  const localDaySpan = moment(end.format('YYYY-MM-DD')).diff(
    moment(start.format('YYYY-MM-DD')),
    'days'
  );
  const occurrenceEndFor = (occurrenceStart: moment.Moment): moment.Moment =>
    occurrenceStart
      .clone()
      .add(localDaySpan, 'days')
      .hour(end.hour())
      .minute(end.minute())
      .second(end.second())
      .millisecond(end.millisecond());
  if (!state.recurrence) {
    if (end.valueOf() <= rangeStart || start.valueOf() >= rangeEnd) return [];
    return [
      {
        ...state,
        creatorAddress: mutation.authorAddress,
        occurrenceId: `${state.eventId}:${start.valueOf()}`,
        occurrenceStart: start.valueOf(),
        occurrenceEnd: end.valueOf(),
        sourceMutationId: mutation.mutationId,
        updatedAt: mutation.timestamp,
      },
    ];
  }

  const results: ReticulumCalendarOccurrence[] = [];
  const originalDay = start.date();
  const originalMonth = start.month();
  const until = state.recurrence.untilLocalDate
    ? moment.tz(`${state.recurrence.untilLocalDate}T23:59:59`, state.timezone)
    : null;
  const unit: moment.unitOfTime.DurationConstructor =
    state.recurrence.frequency === 'daily'
      ? 'day'
      : state.recurrence.frequency === 'weekly'
        ? 'week'
        : state.recurrence.frequency === 'monthly'
          ? 'month'
          : 'year';
  const firstRelevantLocalTime = moment(rangeStart - durationMs).tz(
    state.timezone
  );
  let occurrenceIndex = 0;
  if (firstRelevantLocalTime.isAfter(start)) {
    if (state.recurrence.frequency === 'daily') {
      occurrenceIndex = firstRelevantLocalTime
        .clone()
        .startOf('day')
        .diff(start.clone().startOf('day'), 'days');
    } else if (state.recurrence.frequency === 'weekly') {
      occurrenceIndex = Math.floor(
        firstRelevantLocalTime
          .clone()
          .startOf('day')
          .diff(start.clone().startOf('day'), 'days') / 7
      );
    } else if (state.recurrence.frequency === 'monthly') {
      occurrenceIndex =
        (firstRelevantLocalTime.year() - start.year()) * 12 +
        firstRelevantLocalTime.month() -
        start.month();
    } else {
      occurrenceIndex = firstRelevantLocalTime.year() - start.year();
    }
  }
  // Include the immediately preceding candidate because a multi-day event can
  // overlap the requested range even when its start is outside the range.
  occurrenceIndex = Math.max(0, occurrenceIndex - 1);
  let guard = 0;
  let current = start.clone().add(occurrenceIndex, unit);
  while (current.valueOf() < rangeEnd && results.length < maxOccurrences) {
    if (until && current.isAfter(until)) break;
    const validMonthly =
      state.recurrence.frequency !== 'monthly' ||
      current.date() === originalDay;
    const validYearly =
      state.recurrence.frequency !== 'yearly' ||
      (current.month() === originalMonth && current.date() === originalDay);
    const occurrenceEnd = occurrenceEndFor(current).valueOf();
    if (
      validMonthly &&
      validYearly &&
      occurrenceEnd > rangeStart &&
      current.valueOf() < rangeEnd
    ) {
      results.push({
        ...state,
        creatorAddress: mutation.authorAddress,
        occurrenceId: `${state.eventId}:${current.valueOf()}`,
        occurrenceStart: current.valueOf(),
        occurrenceEnd,
        sourceMutationId: mutation.mutationId,
        updatedAt: mutation.timestamp,
      });
    }
    occurrenceIndex += 1;
    current = start.clone().add(occurrenceIndex, unit);
    guard += 1;
    if (guard > 20_000) break;
  }
  return results;
}
