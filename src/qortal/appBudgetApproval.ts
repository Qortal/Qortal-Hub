/**
 * Where app budgets meet the approval window: the request handlers in get.ts
 * call `askUnlessBudgeted` instead of asking the user directly.
 *
 * A request runs without the window only when all of these hold:
 * - it comes from a Q-App's or website's tab, not from Hub itself, a private
 *   app or Dev Mode (`budgetAppOfRequest`);
 * - Hub isn't locked;
 * - nothing in it always asks (the handler says so, e.g. an app fee);
 * - the node's fee for it could be read;
 * - for a publish, the node says every resource is new;
 * - the app's budget for this account has not ended, can pay the fees and is
 *   within its limits.
 *
 * Otherwise the window opens as before. When the budget is used up or has
 * ended, the window offers to refill it; when a limit stops it, the window
 * says so. When a publish would replace something already published, or the
 * app is publishing the same resource right now, the window says that too.
 *
 * A request the budget pays for is signed in the signing session it came in,
 * by the account whose budget took it, or not at all: right before it signs,
 * `checkBudgetSigner` stops it when the wallet, its keys or the node changed
 * since (a logout, another account signing in), or the key it would sign with
 * is another account's. The request's `release` then gives the budget back
 * what it held.
 */

import i18n from 'i18next';
import { isHubLocked } from '../atoms/presence';
import { publicKeyBelongsToAddress } from '../encryption/addressKeyCheck';
import { getSigningContextRevision } from '../utils/chromeStorage';
import { parseDecimalAmount } from '../transactions/paymentSafety';
import { nodePathSegment } from '../utils/nodeEndpointPath';
import {
  AppBudgetActionKind,
  AppBudgetAskReason,
  AppBudgetDecision,
  AppBudgetLimits,
  AppBudgetTicket,
  BudgetApp,
  budgetAppOfRequest,
  budgetChoiceFrom,
  budgetResourceKey,
  findAppBudget,
  isAlwaysAskedPoll,
  isAlwaysAskedResource,
  publishedIdentifier,
  qortText,
  refillAppBudget,
  takeFromAppBudget,
  trackApprovedPublish,
} from './appBudgets';

/** A resource a publish request would write. */
export type BudgetResource = {
  service: unknown;
  name: unknown;
  identifier?: unknown;
};

/** What the approval window shows about the app's budget. */
export type ApprovalBudgetInfo = {
  state: 'used_up' | 'ended' | 'limit';
  /** QORT used and given so far, as text ("0.99", "1"). */
  used: string;
  total: string;
  /** When it ended, for an ended budget. */
  endedAt: number | null;
  limits: AppBudgetLimits;
  /** The limit this request would go over. */
  limit?: { per: 'minute' | 'day'; max: number };
  /** The fee of one action and how many this request takes, in QORT. */
  fee: string;
  count: number;
};

/**
 * Why the app's budget doesn't pay for a publish it would otherwise pay for:
 * it would replace something already published, or the app is publishing the
 * same resource right now.
 */
export type ApprovalBudgetNote = {
  state: 'replaces' | 'publishing';
};

/** The window's answer when the user chose "Top up and approve". */
export type ApprovalBudgetTopUp = {
  amount: string;
  end: unknown;
  limits: AppBudgetLimits;
};

export type BudgetedAskResult = {
  accepted: boolean;
  /** The window's answer, or the queue's when it wasn't shown. */
  answer: any;
  /** Set when the budget pays for the request. */
  ticket: AppBudgetTicket | null;
};

export type BudgetedAsk = {
  appInfo: unknown;
  kind: AppBudgetActionKind;
  /** Actions in the request: the resources of a publish, else 1. */
  count?: number;
  /** The node's fee for one action as Core gives it; null for a chat message. */
  fee: string | null;
  /** For a publish: what it would write. */
  resources?: BudgetResource[];
  /** For a vote: the poll's name. */
  poll?: unknown;
  /** False when something in the request always asks. */
  allowed?: boolean;
  /** The approval window's payload, shown when the budget doesn't pay. */
  payload: Record<string, unknown>;
  /** Opens the window (getUserPermission for this request). */
  ask: (
    payload: Record<string, unknown>,
    isAlreadyAllowed: () => Promise<boolean>
  ) => Promise<any>;
  /** What else may allow a request that waited its turn (stored switches). */
  alsoAllowed?: () => boolean | Promise<boolean>;
  /** What the node says about the resources (`resourcesOnNode`). */
  resourcesOnNode?: (resources: BudgetResource[]) => Promise<ResourcesOnNode>;
};

/**
 * A request the budget took that can no longer be signed as it was taken:
 * the account logged out, another one signed in, or the node changed, before
 * it was signed.
 */
export class BudgetAccountChangedError extends Error {
  constructor() {
    super(
      i18n.t('question:message.error.account_changed', {
        postProcess: 'capitalizeFirstChar',
      })
    );
    this.name = 'BudgetAccountChangedError';
  }
}

/**
 * True while the signing session (`getSigningContextRevision`) is still
 * `session`: the wallet, its keys and the node are as they were, and aren't
 * being changed.
 */
const inSession = (session: number | null): boolean =>
  session !== null && getSigningContextRevision() === session;

/**
 * Call right before a request signs, with the public key it signs with.
 * When the app's budget pays for it, this throws, so that it isn't signed,
 * unless the signing session is still the one the request came in and the
 * key is the account's whose budget took it. A request the user approved in
 * the window isn't the budget's: nothing is checked.
 */
export function checkBudgetSigner(
  ticket: AppBudgetTicket | null | undefined,
  publicKey: unknown
): void {
  if (!ticket?.paid) return;
  if (
    inSession(ticket.session) &&
    publicKeyBelongsToAddress(publicKey, ticket.address)
  ) {
    return;
  }
  throw new BudgetAccountChangedError();
}

const currentAddress = (): string | null => {
  const w = window as Window & { __qortalCurrentAddress?: string | null };
  const address = w.__qortalCurrentAddress;
  return typeof address === 'string' && address ? address : null;
};

/** The fee Core gave, in 1e-8 units; null when it isn't a readable amount. */
function readFee(fee: string | null): bigint | null {
  if (fee === null) return BigInt(0);
  try {
    return parseDecimalAmount(fee, { allowZero: true }).atomic;
  } catch {
    return null;
  }
}

const STATUS_PATH = '/arbitrary/resource/status';

/**
 * What the node says about a publish's resources: `new` when it answers
 * NOT_PUBLISHED for every one, `exists` when it answers with another status
 * for one of them, `unknown` when it couldn't say (a name or identifier that
 * can't be a path segment, a failed request, an answer without a status).
 */
export type ResourcesOnNode = 'new' | 'exists' | 'unknown';

/**
 * Asks the node about each resource. Only `new` lets a budget pay: `exists`
 * and `unknown` both ask, and only `exists` is said in the window.
 */
export async function resourcesOnNode(
  resources: BudgetResource[],
  endpoint: (path: string) => Promise<string>,
  fetchFn: typeof fetch = fetch
): Promise<ResourcesOnNode> {
  if (!resources.length) return 'unknown';
  const answers = await Promise.all(
    resources.map(async ({ service, name, identifier }) => {
      try {
        if (typeof service !== 'string' || !/^[A-Z0-9_]+$/.test(service)) {
          return 'unknown';
        }
        const path =
          `${STATUS_PATH}/${nodePathSegment(service)}` +
          `/${nodePathSegment(name)}` +
          `/${nodePathSegment(publishedIdentifier(identifier))}`;
        const response = await fetchFn(await endpoint(path));
        if (!response.ok) return 'unknown';
        const status = (await response.json())?.status;
        if (typeof status !== 'string' || !status) return 'unknown';
        return status === 'NOT_PUBLISHED' ? 'new' : 'exists';
      } catch {
        return 'unknown';
      }
    })
  );
  if (answers.includes('exists')) return 'exists';
  return answers.every((answer) => answer === 'new') ? 'new' : 'unknown';
}

/** The window's note for a publish that asks because of what it writes. */
const noteFor = (
  reason: AppBudgetAskReason | 'exists' | null | undefined
): ApprovalBudgetNote | null => {
  if (reason === 'publishing') return { state: 'publishing' };
  if (reason === 'published' || reason === 'exists') {
    return { state: 'replaces' };
  }
  return null;
};

function windowInfo(
  decision: AppBudgetDecision,
  fee: bigint,
  count: number
): ApprovalBudgetInfo | null {
  if (
    decision.kind !== 'ended' &&
    decision.kind !== 'used_up' &&
    decision.kind !== 'limit'
  ) {
    return null;
  }
  const { budget } = decision;
  return {
    state: decision.kind,
    used: qortText(budget.used),
    total: qortText(budget.total),
    endedAt: decision.kind === 'ended' ? budget.expiresAt : null,
    limits: budget.limits,
    ...(decision.kind === 'limit'
      ? { limit: { per: decision.per, max: decision.max } }
      : {}),
    fee: qortText(fee),
    count,
  };
}

/**
 * Lets the app's budget pay for the request, or asks. Resolves with whether
 * the request may go ahead and, when the budget pays, the ticket: call its
 * `done` for each action done and `release` once the request is over.
 */
export async function askUnlessBudgeted(
  request: BudgetedAsk
): Promise<BudgetedAskResult> {
  const count = request.count ?? 1;
  const fee = readFee(request.fee);
  const app: BudgetApp | null = budgetAppOfRequest(request.appInfo);
  const address = currentAddress();
  // The signing session the request came in: a budget pays only while it
  // lasts (null while the wallet or node is changing).
  const session = getSigningContextRevision();
  const resourceKeys = (request.resources ?? []).map((resource) =>
    budgetResourceKey(resource.service, resource.name, resource.identifier)
  );

  const resources = request.resources ?? [];
  // Asked of the node only when the app has a budget: an app without one
  // asks exactly as before.
  const budgetMayPayIfNew =
    request.allowed !== false &&
    !!app &&
    !!address &&
    fee !== null &&
    !isHubLocked() &&
    !(
      request.kind === 'publish' &&
      resources.some(({ service, identifier }) =>
        isAlwaysAskedResource(service, identifier)
      )
    ) &&
    !(request.kind === 'vote' && isAlwaysAskedPoll(request.poll)) &&
    !!findAppBudget(address, app);
  // What the node says now: a publish is only paid for while it is new.
  const onNode = async (): Promise<ResourcesOnNode> =>
    resourceKeys.length === count && request.resourcesOnNode
      ? await request.resourcesOnNode(resources)
      : 'unknown';
  let budgetMayPay = budgetMayPayIfNew;
  // What the window says when the node finds a resource already there.
  let nodeNote: ApprovalBudgetNote | null = null;
  if (budgetMayPayIfNew && request.kind === 'publish') {
    const found = await onNode();
    budgetMayPay = found === 'new';
    if (found === 'exists') nodeNote = noteFor('exists');
  }

  const take = (approved = false): AppBudgetDecision =>
    budgetMayPay &&
    !isHubLocked() &&
    currentAddress() === address &&
    inSession(session)
      ? takeFromAppBudget({
          address,
          app,
          kind: request.kind,
          count,
          fee,
          resources: request.kind === 'publish' ? resourceKeys : undefined,
          approved,
          session,
        })
      : { kind: 'ask' };

  const decision = take();
  if (decision.kind === 'take') {
    return {
      accepted: true,
      answer: { accepted: true },
      ticket: decision.ticket,
    };
  }

  // What the window says about the budget. getUserPermission reads the
  // payload when the window opens, so a request that waited its turn shows
  // the budget as it is then.
  let info: ApprovalBudgetInfo | null = null;
  const windowPayload: Record<string, unknown> = { ...request.payload };
  const showBudget = (
    next: AppBudgetDecision,
    note: ApprovalBudgetNote | null = nodeNote
  ) => {
    info = windowInfo(next, fee ?? BigInt(0), count);
    const shown =
      info ?? note ?? (next.kind === 'ask' ? noteFor(next.reason) : null);
    if (shown) windowPayload.budget = shown;
    else delete windowPayload.budget;
  };
  showBudget(decision);
  // A request that waited behind another may find the budget refilled.
  let queuedTicket: AppBudgetTicket | null = null;
  const isAlreadyAllowed = async () => {
    if (request.alsoAllowed && (await request.alsoAllowed())) return true;
    // It may have waited a minute: something published meanwhile isn't new.
    if (budgetMayPay && request.kind === 'publish') {
      const found = await onNode();
      if (found !== 'new') {
        showBudget({ kind: 'ask' }, noteFor(found === 'exists' ? found : null));
        return false;
      }
    }
    const later = take();
    if (later.kind !== 'take') {
      showBudget(later);
      return false;
    }
    queuedTicket = later.ticket;
    return true;
  };

  const answer = await request.ask(windowPayload, isAlreadyAllowed);
  if (queuedTicket) {
    return { accepted: true, answer, ticket: queuedTicket };
  }
  const accepted = answer?.accepted === true;

  // "Top up and approve": refill with the choices, checked again here, and
  // let the new budget pay for this request. This runs before the next
  // request in the queue is looked at, so that one can use it too.
  let ticket: AppBudgetTicket | null = null;
  if (
    accepted &&
    (info?.state === 'used_up' || info?.state === 'ended') &&
    answer?.budgetTopUp &&
    currentAddress() === address
  ) {
    const choice = budgetChoiceFrom(answer.budgetTopUp, Date.now());
    if (choice && refillAppBudget(address, app, choice)) {
      const paid = take(true);
      if (paid.kind === 'take') ticket = paid.ticket;
    }
  }
  // Approved in the window: no budget publishes the same resources while
  // this one runs, or after it.
  if (accepted && !ticket && request.kind === 'publish' && address) {
    ticket = trackApprovedPublish(address, resourceKeys);
  }
  return { accepted, answer, ticket };
}
