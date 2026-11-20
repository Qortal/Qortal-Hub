/**
 * App budgets: a QORT fee allowance for one Q-App or website, per account, on
 * this PC only.
 *
 * While a budget lasts, the app's everyday actions (new publishes, poll votes,
 * chat messages) run without the approval window. Hub only keeps count: no
 * QORT moves until each action's own fee is paid. Every other request still
 * asks.
 *
 * Budgets are kept in localStorage under `app-budgets-v1:<address>`. The fee
 * of an action and its place under the limits are set aside in memory in the
 * same synchronous step that checks them, so two requests can't both take
 * what is left; an action that fails gives them back. Whether a budget has
 * ended is checked when an action happens, never with a timer.
 */

import { requestingAppFromAppInfo, isHubRequest } from './requestingApp';
import {
  formatAtomicAmount,
  parseDecimalAmount,
} from '../transactions/paymentSafety';

export type AppBudgetService = 'APP' | 'WEBSITE';
export type AppBudgetLimits = 'standard' | 'higher' | 'none';
export type AppBudgetActionKind = 'publish' | 'vote' | 'chat';

/** The app a budget belongs to: its service and registered name. */
export type BudgetApp = { service: AppBudgetService; name: string };

/** One action a budget allowed. */
export type AppBudgetAction = {
  at: number;
  kind: AppBudgetActionKind;
  /** The fee it cost, in 1e-8 QORT units. */
  fee: string;
  /** For a publish: what was published. */
  service?: string;
  identifier?: string;
  /** For a vote: the poll. */
  poll?: string;
  /** For a chat message to a group; none for a direct message. */
  groupId?: number;
};

export type AppBudget = {
  /** This budget, apart from one removed before it: actions under way stay
   *  with the budget that allowed them. */
  id: string;
  service: AppBudgetService;
  name: string;
  /** All QORT given to this budget, in 1e-8 units. */
  total: string;
  /** The fees of the actions it allowed, in 1e-8 units. */
  used: string;
  actions: number;
  startedAt: number;
  /** When it ends (ms since the epoch); null for no end date. */
  expiresAt: number | null;
  limits: AppBudgetLimits;
  /** When its actions of the last day happened, for the limits. */
  times: number[];
  /** Its last actions, oldest first. */
  recent: AppBudgetAction[];
};

export type AppBudgetState = 'active' | 'used_up' | 'ended';

export const APP_BUDGET_LIMIT_RATES: Record<
  Exclude<AppBudgetLimits, 'none'>,
  { perMinute: number; perDay: number }
> = {
  standard: { perMinute: 20, perDay: 300 },
  higher: { perMinute: 100, perDay: 1000 },
};

export const APP_BUDGET_LIMITS: AppBudgetLimits[] = [
  'standard',
  'higher',
  'none',
];

/** The amounts offered first, in QORT. */
export const APP_BUDGET_AMOUNTS = ['1', '5', '10'];

/** The smallest and largest amount one top-up may add (0.01 and 1,000 QORT). */
export const APP_BUDGET_MIN_ATOMIC = BigInt(1000000);
export const APP_BUDGET_MAX_ATOMIC = BigInt(100000000000);

/** Core's fee for a publish or a vote today: 0.01 QORT. */
export const USUAL_ACTION_FEE_ATOMIC = BigInt(1000000);

export const APP_BUDGET_RECENT_MAX = 50;

const SERVICES: AppBudgetService[] = ['APP', 'WEBSITE'];
const KINDS: AppBudgetActionKind[] = ['publish', 'vote', 'chat'];
const STORAGE_PREFIX = 'app-budgets-v1:';
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
// The most actions any limit lets through in a day.
const TIMES_MAX = APP_BUDGET_LIMIT_RATES.higher.perDay;
// Qortal names are at most 40 characters; anything longer isn't one.
const MAX_NAME_CHARACTERS = 40;
const MAX_DETAIL_CHARACTERS = 80;
const ATOMIC_TEXT = /^\d{1,19}$/;
const BUDGET_ID = /^[0-9a-f]{16}$/;
const ZERO = BigInt(0);

// ── Which app ────────────────────────────────────────────────────────────────

/**
 * The app a budget is for, from a tab's service and name: a Q-App or a
 * website with a name that hides nothing. Null for anything else.
 */
export function budgetAppFrom(
  service: unknown,
  name: unknown
): BudgetApp | null {
  if (typeof service !== 'string' || typeof name !== 'string') return null;
  const upper = service.trim().toUpperCase() as AppBudgetService;
  if (!SERVICES.includes(upper)) return null;
  if (!name || name !== name.trim()) return null;
  if (Array.from(name).length > MAX_NAME_CHARACTERS) return null;
  // A name with characters that draw nothing could pass for another one.
  if (requestingAppFromAppInfo({ name })?.name !== name) return null;
  return { service: upper, name };
}

/**
 * The app a Q-App request may use a budget for, from the `appInfo` Hub builds
 * from the request's tab (never from the request). Null for Hub's own
 * requests, a private app, a preview of an unpublished app (the screenshot
 * capture), an app in Dev Mode, or a request without a tab.
 */
export function budgetAppOfRequest(appInfo: unknown): BudgetApp | null {
  if (!appInfo || typeof appInfo !== 'object' || isHubRequest(appInfo)) {
    return null;
  }
  const info = appInfo as {
    name?: unknown;
    service?: unknown;
    tabId?: unknown;
    isPrivate?: unknown;
    isPreview?: unknown;
    isDevMode?: unknown;
  };
  if (
    info.isPrivate === true ||
    info.isPreview === true ||
    info.isDevMode === true
  ) {
    return null;
  }
  if (info.tabId == null || info.tabId === '') return null;
  return budgetAppFrom(info.service, info.name);
}

/** Names are one name whatever their case; APP and WEBSITE stay apart. */
export function isSameBudgetApp(
  a: { service: string; name: string },
  b: { service: string; name: string }
): boolean {
  return (
    a.service === b.service && a.name.toLowerCase() === b.name.toLowerCase()
  );
}

/**
 * The identifier Core publishes to: no identifier, '' and 'default' are the
 * default resource. (Core takes the text 'null' as an identifier of its own.)
 */
export const publishedIdentifier = (identifier: unknown): string =>
  identifier == null || identifier === '' ? 'default' : String(identifier);

/** One key per QDN resource: service, name (any case) and identifier. */
export function budgetResourceKey(
  service: unknown,
  name: unknown,
  identifier: unknown
): string {
  const id = publishedIdentifier(identifier);
  return JSON.stringify([
    String(service ?? '').toUpperCase(),
    String(name ?? '').toLowerCase(),
    id,
  ]);
}

// ── What a budget never pays for ─────────────────────────────────────────────

// A Q-App or website under the user's name (widgets too), the avatar, and
// the records Hub reads back as its own or as the account's: its settings,
// its library's pages, reviews and replies, and group keys. A new one still
// asks.
const SERVICES_ALWAYS_ASKED = ['APP', 'WEBSITE'];
const IDENTIFIERS_ALWAYS_ASKED = ['qortal_avatar'];
const IDENTIFIER_PREFIXES_ALWAYS_ASKED = [
  'ext_saved_settings',
  'qhub_',
  'symmetric-qchat-group-',
  'admins-symmetric-qchat-group-',
];
// Hub's library ratings: one app rating others in the user's name.
const POLL_PREFIXES_ALWAYS_ASKED = ['app-library-'];

/** True for a resource a budget never publishes, new or not. */
export function isAlwaysAskedResource(
  service: unknown,
  identifier: unknown
): boolean {
  const upper = String(service ?? '')
    .trim()
    .toUpperCase();
  if (SERVICES_ALWAYS_ASKED.includes(upper)) return true;
  const id = publishedIdentifier(identifier).toLowerCase();
  return (
    IDENTIFIERS_ALWAYS_ASKED.includes(id) ||
    IDENTIFIER_PREFIXES_ALWAYS_ASKED.some((prefix) => id.startsWith(prefix))
  );
}

/** True for a poll a budget never votes in. */
export const isAlwaysAskedPoll = (pollName: unknown): boolean =>
  typeof pollName !== 'string' ||
  POLL_PREFIXES_ALWAYS_ASKED.some((prefix) =>
    pollName.trim().toLowerCase().startsWith(prefix)
  );

function newBudgetId(): string {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    bytes.forEach((_, index) => {
      bytes[index] = Math.floor(Math.random() * 256);
    });
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );
}

// ── Reading and saving ───────────────────────────────────────────────────────

const storageKey = (address: string) => `${STORAGE_PREFIX}${address}`;

const isAtomicText = (value: unknown): value is string =>
  typeof value === 'string' && ATOMIC_TEXT.test(value);

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const shortText = (value: unknown): string | undefined =>
  typeof value === 'string' && value
    ? Array.from(value).slice(0, MAX_DETAIL_CHARACTERS).join('')
    : undefined;

function readAction(value: unknown): AppBudgetAction | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!isTime(raw.at) || !KINDS.includes(raw.kind as AppBudgetActionKind)) {
    return null;
  }
  if (!isAtomicText(raw.fee)) return null;
  const action: AppBudgetAction = {
    at: raw.at,
    kind: raw.kind as AppBudgetActionKind,
    fee: raw.fee,
  };
  const service = shortText(raw.service);
  const identifier = shortText(raw.identifier);
  const poll = shortText(raw.poll);
  if (service) action.service = service;
  if (identifier) action.identifier = identifier;
  if (poll) action.poll = poll;
  if (Number.isSafeInteger(raw.groupId)) action.groupId = raw.groupId as number;
  return action;
}

function readBudget(value: unknown): AppBudget | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const app = budgetAppFrom(raw.service, raw.name);
  if (!app || raw.service !== app.service) return null;
  if (typeof raw.id !== 'string' || !BUDGET_ID.test(raw.id)) return null;
  if (!isAtomicText(raw.total) || !isAtomicText(raw.used)) return null;
  if (!isTime(raw.startedAt)) return null;
  if (raw.expiresAt !== null && !isTime(raw.expiresAt)) return null;
  const limits = APP_BUDGET_LIMITS.includes(raw.limits as AppBudgetLimits)
    ? (raw.limits as AppBudgetLimits)
    : 'standard';
  const actions = Number.isSafeInteger(raw.actions)
    ? Math.max(0, raw.actions as number)
    : 0;
  return {
    id: raw.id,
    service: app.service,
    name: app.name,
    total: raw.total,
    used: raw.used,
    actions,
    startedAt: raw.startedAt,
    expiresAt: raw.expiresAt as number | null,
    limits,
    times: Array.isArray(raw.times)
      ? raw.times.filter(isTime).slice(-TIMES_MAX)
      : [],
    recent: Array.isArray(raw.recent)
      ? raw.recent.map(readAction).filter(Boolean).slice(-APP_BUDGET_RECENT_MAX)
      : [],
  };
}

/**
 * The account's budgets as saved. Anything unreadable counts as no budget, so
 * the app asks again.
 */
function readSaved(address: string): AppBudget[] {
  try {
    const text = window.localStorage.getItem(storageKey(address));
    if (!text) return [];
    const parsed = JSON.parse(text);
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.budgets)) {
      return [];
    }
    const budgets: AppBudget[] = [];
    for (const item of parsed.budgets) {
      const budget = readBudget(item);
      if (budget && !budgets.some((b) => isSameBudgetApp(b, budget))) {
        budgets.push(budget);
      }
    }
    return budgets;
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();
let version = 0;
const shownBudgets = new Map<
  string,
  { version: number; budgets: AppBudget[] }
>();
const NO_BUDGETS: AppBudget[] = [];

function changed() {
  version += 1;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.error('[app budgets] listener failed', error);
    }
  }
}

/** True when saved. */
function save(address: string, budgets: AppBudget[]): boolean {
  let saved = false;
  try {
    if (budgets.length) {
      window.localStorage.setItem(
        storageKey(address),
        JSON.stringify({ v: 1, budgets })
      );
    } else {
      window.localStorage.removeItem(storageKey(address));
    }
    saved = true;
  } catch (error) {
    console.error('[app budgets] not saved', error);
  }
  changed();
  return saved;
}

/** Calls `listener` whenever a budget changes. Returns the unsubscribe. */
export function subscribeAppBudgets(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The account's budgets for showing them: the same array until one changes.
 */
export function appBudgetsOf(address: string | null | undefined): AppBudget[] {
  if (!address) return NO_BUDGETS;
  const shown = shownBudgets.get(address);
  if (shown && shown.version === version) return shown.budgets;
  const budgets = readSaved(address);
  shownBudgets.set(address, { version, budgets });
  return budgets;
}

export function findAppBudget(
  address: string | null | undefined,
  app: BudgetApp | null
): AppBudget | null {
  if (!address || !app) return null;
  return appBudgetsOf(address).find((b) => isSameBudgetApp(b, app)) ?? null;
}

// ── State ────────────────────────────────────────────────────────────────────

export const budgetLeft = (budget: AppBudget): bigint =>
  BigInt(budget.total) - BigInt(budget.used);

export const hasBudgetEnded = (budget: AppBudget, now: number): boolean =>
  budget.expiresAt !== null && now >= budget.expiresAt;

/**
 * Ended once its end date has passed; used up once what is left can't pay
 * `nextFee` (the fee of the next action, 0.01 QORT unless known).
 */
export function budgetState(
  budget: AppBudget,
  now: number,
  nextFee: bigint = USUAL_ACTION_FEE_ATOMIC
): AppBudgetState {
  if (hasBudgetEnded(budget, now)) return 'ended';
  const left = budgetLeft(budget);
  return left <= ZERO || left < nextFee ? 'used_up' : 'active';
}

const countSince = (times: number[], since: number) =>
  times.reduce((count, time) => (time > since ? count + 1 : count), 0);

/**
 * The limit `count` more actions would go over, with `held` actions already
 * under way. Null when they fit.
 */
export function budgetLimitReached(
  budget: AppBudget,
  now: number,
  count: number,
  held = 0
): { per: 'minute' | 'day'; max: number } | null {
  if (budget.limits === 'none') return null;
  const rate = APP_BUDGET_LIMIT_RATES[budget.limits];
  if (
    countSince(budget.times, now - MINUTE_MS) + held + count >
    rate.perMinute
  ) {
    return { per: 'minute', max: rate.perMinute };
  }
  if (countSince(budget.times, now - DAY_MS) + held + count > rate.perDay) {
    return { per: 'day', max: rate.perDay };
  }
  return null;
}

// ── Choices ──────────────────────────────────────────────────────────────────

/** How a budget ends: in a month, in a year, at the end of a date, or never. */
export type AppBudgetEnd =
  | { kind: 'month' }
  | { kind: 'year' }
  | { kind: 'date'; date: string }
  | { kind: 'never' };

export type AppBudgetChoice = {
  amount: bigint;
  expiresAt: number | null;
  limits: AppBudgetLimits;
};

function addMonths(now: number, months: number): number {
  const start = new Date(now);
  const day = start.getDate();
  const end = new Date(start);
  end.setDate(1);
  end.setMonth(end.getMonth() + months);
  // 31 January + 1 month is the last day of February, not 3 March.
  const lastDay = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
  end.setDate(Math.min(day, lastDay));
  return end.getTime();
}

const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * When a budget with this end stops, from `now`: null for never, undefined
 * when the end isn't valid (a date that doesn't exist or has passed). A date
 * ends at the end of that day, this PC's time.
 */
export function budgetEndTime(
  end: unknown,
  now: number
): number | null | undefined {
  if (!end || typeof end !== 'object') return undefined;
  const kind = (end as { kind?: unknown }).kind;
  if (kind === 'never') return null;
  if (kind === 'month') return addMonths(now, 1);
  if (kind === 'year') return addMonths(now, 12);
  if (kind !== 'date') return undefined;
  const text = (end as { date?: unknown }).date;
  const match = typeof text === 'string' ? DATE_TEXT.exec(text) : null;
  if (!match) return undefined;
  const [year, month, day] = match.slice(1).map(Number);
  const last = new Date(year, month - 1, day, 23, 59, 59, 999);
  if (
    last.getFullYear() !== year ||
    last.getMonth() !== month - 1 ||
    last.getDate() !== day
  ) {
    return undefined;
  }
  const time = last.getTime();
  return time > now ? time : undefined;
}

/**
 * An amount typed or picked for a budget, in 1e-8 units: a plain decimal from
 * 0.01 to 1,000 QORT. Null otherwise.
 */
export function budgetAmountFrom(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  try {
    const { atomic } = parseDecimalAmount(value);
    if (atomic < APP_BUDGET_MIN_ATOMIC || atomic > APP_BUDGET_MAX_ATOMIC) {
      return null;
    }
    return atomic;
  } catch {
    return null;
  }
}

/**
 * Amount, end and limits as the budget form or the approval window sends
 * them, checked again here. Null when any of them isn't valid.
 */
export function budgetChoiceFrom(
  value: unknown,
  now: number
): AppBudgetChoice | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { amount?: unknown; end?: unknown; limits?: unknown };
  const amount = budgetAmountFrom(raw.amount);
  const expiresAt = budgetEndTime(raw.end, now);
  if (amount === null || expiresAt === undefined) return null;
  if (!APP_BUDGET_LIMITS.includes(raw.limits as AppBudgetLimits)) return null;
  return { amount, expiresAt, limits: raw.limits as AppBudgetLimits };
}

/** How many actions an amount pays for at `fee` each. */
export function actionsFor(amount: bigint, fee: bigint): bigint {
  return fee > ZERO ? amount / fee : ZERO;
}

export const qortText = (atomic: bigint | string): string =>
  formatAtomicAmount(typeof atomic === 'string' ? BigInt(atomic) : atomic);

// ── Changing budgets ─────────────────────────────────────────────────────────

function updateBudgets(
  address: string,
  update: (budgets: AppBudget[]) => AppBudget[] | null
): boolean {
  if (!address) return false;
  const next = update(readSaved(address));
  return next ? save(address, next) : false;
}

/**
 * Adds a budget, or puts money into the app's budget: on an active or used up
 * one the amount is added to what is left, on an ended one it is all that is
 * left. The end and limits are set to the choice.
 */
export function refillAppBudget(
  address: string,
  app: BudgetApp,
  choice: AppBudgetChoice,
  now = Date.now()
): boolean {
  if (choice.amount < APP_BUDGET_MIN_ATOMIC) return false;
  if (choice.amount > APP_BUDGET_MAX_ATOMIC) return false;
  if (choice.expiresAt !== null && choice.expiresAt <= now) return false;
  return updateBudgets(address, (budgets) => {
    const index = budgets.findIndex((b) => isSameBudgetApp(b, app));
    if (index < 0) {
      return [
        ...budgets,
        {
          id: newBudgetId(),
          service: app.service,
          name: app.name,
          total: choice.amount.toString(),
          used: '0',
          actions: 0,
          startedAt: now,
          expiresAt: choice.expiresAt,
          limits: choice.limits,
          times: [],
          recent: [],
        },
      ];
    }
    const budget = budgets[index];
    const total = hasBudgetEnded(budget, now)
      ? BigInt(budget.used) + choice.amount
      : BigInt(budget.total) + choice.amount;
    const next = [...budgets];
    next[index] = {
      ...budget,
      total: total.toString(),
      expiresAt: choice.expiresAt,
      limits: choice.limits,
    };
    return next;
  });
}

/** Adds to what is left of a budget that hasn't ended. */
export function topUpAppBudget(
  address: string,
  app: BudgetApp,
  amount: bigint,
  now = Date.now()
): boolean {
  if (amount < APP_BUDGET_MIN_ATOMIC || amount > APP_BUDGET_MAX_ATOMIC) {
    return false;
  }
  return updateBudgets(address, (budgets) => {
    const index = budgets.findIndex((b) => isSameBudgetApp(b, app));
    if (index < 0 || hasBudgetEnded(budgets[index], now)) return null;
    const next = [...budgets];
    next[index] = {
      ...budgets[index],
      total: (BigInt(budgets[index].total) + amount).toString(),
    };
    return next;
  });
}

/** Changes when a budget that hasn't ended ends, and its limits. */
export function changeAppBudget(
  address: string,
  app: BudgetApp,
  change: { expiresAt: number | null; limits: AppBudgetLimits },
  now = Date.now()
): boolean {
  if (change.expiresAt !== null && change.expiresAt <= now) return false;
  if (!APP_BUDGET_LIMITS.includes(change.limits)) return false;
  return updateBudgets(address, (budgets) => {
    const index = budgets.findIndex((b) => isSameBudgetApp(b, app));
    if (index < 0 || hasBudgetEnded(budgets[index], now)) return null;
    const next = [...budgets];
    next[index] = {
      ...budgets[index],
      expiresAt: change.expiresAt,
      limits: change.limits,
    };
    return next;
  });
}

export function removeAppBudget(address: string, app: BudgetApp): boolean {
  return updateBudgets(address, (budgets) => {
    const next = budgets.filter((b) => !isSameBudgetApp(b, app));
    return next.length === budgets.length ? null : next;
  });
}

// ── Taking from a budget ─────────────────────────────────────────────────────

/** What actions under way hold of one budget. */
type Hold = { fee: bigint; actions: number };

// Per account and budget: a budget removed and added again starts with
// nothing held, whatever the old one's actions still do.
const holds = new Map<string, Hold>();
// Resources being published right now, per account, paid by a budget or
// approved in the window: how many publishes of each are under way.
const resourcesUnderWay = new Map<string, Map<string, number>>();
// Resources published this session, per account: the node may not list them
// yet, and publishing them again would replace them.
const resourcesPublished = new Map<string, Set<string>>();
const PUBLISHED_KEPT = 2000;

function holdOf(address: string, budgetId: string): Hold {
  const key = `${address}|${budgetId}`;
  let hold = holds.get(key);
  if (!hold) {
    hold = { fee: ZERO, actions: 0 };
    holds.set(key, hold);
  }
  return hold;
}

function underWayOf(address: string): Map<string, number> {
  let counts = resourcesUnderWay.get(address);
  if (!counts) {
    counts = new Map();
    resourcesUnderWay.set(address, counts);
  }
  return counts;
}

function publishedOf(address: string): Set<string> {
  let published = resourcesPublished.get(address);
  if (!published) {
    published = new Set();
    resourcesPublished.set(address, published);
  }
  return published;
}

function startPublishing(address: string, key: string) {
  const counts = underWayOf(address);
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function stopPublishing(address: string, key: string) {
  const counts = underWayOf(address);
  const left = (counts.get(key) ?? 0) - 1;
  if (left > 0) counts.set(key, left);
  else counts.delete(key);
}

function notePublished(address: string, key: string) {
  const published = publishedOf(address);
  published.delete(key);
  published.add(key);
  if (published.size > PUBLISHED_KEPT) {
    published.delete(published.values().next().value);
  }
}

/** What one done action was, for the budget's list. */
export type AppBudgetActionDetails = {
  /** A publish: the resource, as the request named it. */
  service?: unknown;
  name?: unknown;
  identifier?: unknown;
  /** A vote: the poll. */
  poll?: unknown;
  /** A chat message to a group. */
  groupId?: unknown;
};

/**
 * A request's hold on a budget, or, for a publish the user approved in the
 * window, only the resources it is publishing.
 */
export type AppBudgetTicket = {
  /** True when the budget pays: the publish is built with `fee`. */
  paid: boolean;
  /** The fee held for each action, in 1e-8 units. */
  fee: bigint;
  /** One of the request's actions was done: a paid fee counts as used. */
  done: (details?: AppBudgetActionDetails) => void;
  /** Gives back what the request still holds. Safe to call more than once. */
  release: () => void;
};

/**
 * Why a publish asks although the app's budget could pay for it: one of its
 * resources is being published from this Hub right now, or was published from
 * this Hub this session (publishing it again would replace it).
 */
export type AppBudgetAskReason = 'publishing' | 'published';

export type AppBudgetDecision =
  | { kind: 'ask'; reason?: AppBudgetAskReason }
  | { kind: 'take'; ticket: AppBudgetTicket }
  | { kind: 'ended'; budget: AppBudget }
  | { kind: 'used_up'; budget: AppBudget }
  | {
      kind: 'limit';
      budget: AppBudget;
      per: 'minute' | 'day';
      max: number;
    };

export type AppBudgetRequest = {
  address: string;
  app: BudgetApp;
  kind: AppBudgetActionKind;
  /** Actions in the request: the resources of a publish, else 1. */
  count: number;
  /** The node's fee for one action, in 1e-8 units (0 for a chat message). */
  fee: bigint;
  /** For a publish: `budgetResourceKey` of each resource, all new. */
  resources?: string[];
  now?: number;
  /** The user approved this request in the window: the limits don't apply. */
  approved?: boolean;
};

const ASK: AppBudgetDecision = { kind: 'ask' };

/**
 * Takes a request's fees from the app's budget, or says why not. Synchronous,
 * so nothing else takes from the budget between the check and the hold.
 *
 * - `ask`: no budget; a resource of the request is being published or was
 *   published this session (publishing it again would replace it; `reason`
 *   says which); or the request alone is more than its limits allow.
 * - `ended` / `used_up`: the window offers to refill it.
 * - `limit`: too many actions in the last minute or day.
 * - `take`: the fees are held; call the ticket's `done` for each action done
 *   and `release` when the request is over.
 */
export function takeFromAppBudget(
  request: AppBudgetRequest
): AppBudgetDecision {
  const { address, app, kind, fee } = request;
  const count = request.count;
  const now = request.now ?? Date.now();
  if (!address || !app || !Number.isSafeInteger(count) || count < 1) {
    return ASK;
  }
  if (typeof fee !== 'bigint' || fee < ZERO) return ASK;
  const budget = readSaved(address).find((b) => isSameBudgetApp(b, app));
  if (!budget) return ASK;

  const resources = request.resources ?? [];
  if (kind === 'publish' && resources.length !== count) return ASK;
  if (new Set(resources).size !== resources.length) return ASK;
  if (resources.some((key) => underWayOf(address).has(key))) {
    return { kind: 'ask', reason: 'publishing' };
  }
  if (resources.some((key) => publishedOf(address).has(key))) {
    return { kind: 'ask', reason: 'published' };
  }

  if (hasBudgetEnded(budget, now)) return { kind: 'ended', budget };
  const hold = holdOf(address, budget.id);
  const needed = fee * BigInt(count);
  const left = budgetLeft(budget) - hold.fee;
  // Used up as the panel shows it: what is left can't pay the next action.
  // A chat message has no fee, and counts at the usual one here.
  const minimum = needed > ZERO ? needed : USUAL_ACTION_FEE_ATOMIC;
  if (left < minimum) return { kind: 'used_up', budget };
  if (!request.approved) {
    // More at once than the limits allow at all: it asks, without saying the
    // app went over them.
    if (
      budget.limits !== 'none' &&
      count > APP_BUDGET_LIMIT_RATES[budget.limits].perMinute
    ) {
      return ASK;
    }
    const reached = budgetLimitReached(budget, now, count, hold.actions);
    if (reached) return { kind: 'limit', budget, ...reached };
  }

  hold.fee += needed;
  hold.actions += count;
  resources.forEach((key) => startPublishing(address, key));
  return {
    kind: 'take',
    ticket: newTicket(address, budget, kind, fee, count, resources),
  };
}

/**
 * Keeps track of a publish the user approved in the window: while it runs and
 * after it, a budget doesn't publish the same resources.
 */
export function trackApprovedPublish(
  address: string,
  resources: string[]
): AppBudgetTicket {
  resources.forEach((key) => startPublishing(address, key));
  return newTicket(address, null, 'publish', ZERO, resources.length, resources);
}

function newTicket(
  address: string,
  budget: AppBudget | null,
  kind: AppBudgetActionKind,
  fee: bigint,
  count: number,
  resources: string[]
): AppBudgetTicket {
  const budgetId = budget?.id ?? null;
  const hold = budgetId ? holdOf(address, budgetId) : null;
  const pending = new Set(resources);
  let held = count;

  const forget = (key: string) => {
    if (pending.delete(key)) stopPublishing(address, key);
  };

  const charge = (details: AppBudgetActionDetails) => {
    const at = Date.now();
    const action: AppBudgetAction = { at, kind, fee: fee.toString() };
    const service = shortText(details.service);
    const identifier =
      kind === 'publish'
        ? shortText(publishedIdentifier(details.identifier))
        : undefined;
    const poll = shortText(details.poll);
    if (service) action.service = service;
    if (identifier) action.identifier = identifier;
    if (poll) action.poll = poll;
    const groupId = Number(details.groupId);
    if (details.groupId != null && Number.isSafeInteger(groupId)) {
      action.groupId = groupId;
    }
    let found = false;
    const saved = updateBudgets(address, (budgets) => {
      const index = budgets.findIndex((b) => b.id === budgetId);
      // Removed while the action ran: it isn't another budget's to count.
      if (index < 0) return null;
      found = true;
      const current = budgets[index];
      const next = [...budgets];
      next[index] = {
        ...current,
        used: (BigInt(current.used) + fee).toString(),
        actions: current.actions + 1,
        times: [...current.times.filter((t) => t > at - DAY_MS), at].slice(
          -TIMES_MAX
        ),
        recent: [...current.recent, action].slice(-APP_BUDGET_RECENT_MAX),
      };
      return next;
    });
    // Not saved (storage full): it stays held for this session, so the
    // budget still can't be spent twice.
    if (saved || !found) {
      hold.fee -= fee;
      hold.actions -= 1;
    }
  };

  return {
    paid: !!budgetId,
    fee,
    done(details = {}) {
      if (held <= 0) return;
      held -= 1;
      if (budgetId) charge(details);
      if (kind !== 'publish') return;
      const key = budgetResourceKey(
        details.service,
        details.name,
        details.identifier
      );
      if (pending.has(key)) {
        forget(key);
        notePublished(address, key);
      }
    },
    release() {
      if (held > 0 && hold) {
        hold.fee -= fee * BigInt(held);
        hold.actions -= held;
      }
      held = 0;
      [...pending].forEach(forget);
    },
  };
}

/** For tests: forgets what is held, under way and published. */
export function resetAppBudgetsForTests() {
  holds.clear();
  resourcesUnderWay.clear();
  resourcesPublished.clear();
  shownBudgets.clear();
  changed();
}
