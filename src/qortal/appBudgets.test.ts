import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_BUDGET_LIMIT_RATES,
  appBudgetsOf,
  budgetAmountFrom,
  budgetAppFrom,
  budgetAppOfRequest,
  budgetChoiceFrom,
  budgetEndTime,
  budgetResourceKey,
  budgetState,
  changeAppBudget,
  findAppBudget,
  isAlwaysAskedPoll,
  isAlwaysAskedResource,
  refillAppBudget,
  removeAppBudget,
  resetAppBudgetsForTests,
  subscribeAppBudgets,
  takeFromAppBudget,
  topUpAppBudget,
  trackApprovedPublish,
  type AppBudgetRequest,
  type BudgetApp,
} from './appBudgets';
import { HUB_REQUEST } from './requestingApp';

const ACCOUNT = 'QaccountOne';
const OTHER_ACCOUNT = 'QaccountTwo';
const APP: BudgetApp = { service: 'APP', name: 'Opened-App' };
const SITE: BudgetApp = { service: 'WEBSITE', name: 'Opened-App' };
const FEE = BigInt(1000000); // 0.01 QORT
const QORT = BigInt(100000000);
const NOW = new Date(2026, 10, 19, 12, 0, 0).getTime();
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const give = (
  amount: bigint,
  {
    address = ACCOUNT,
    app = APP,
    expiresAt = NOW + 30 * DAY,
    limits = 'standard' as const,
    now = NOW,
  }: {
    address?: string;
    app?: BudgetApp;
    expiresAt?: number | null;
    limits?: 'standard' | 'higher' | 'none';
    now?: number;
  } = {}
) =>
  expect(
    refillAppBudget(address, app, { amount, expiresAt, limits }, now)
  ).toBe(true);

const request = (
  overrides: Partial<AppBudgetRequest> = {}
): AppBudgetRequest => ({
  address: ACCOUNT,
  app: APP,
  kind: 'vote',
  count: 1,
  fee: FEE,
  now: NOW,
  ...overrides,
});

const POST = { service: 'BLOG_POST', name: 'Publisher', identifier: 'post-1' };
const POST_KEY = budgetResourceKey(POST.service, POST.name, POST.identifier);
const key = (identifier: string) =>
  budgetResourceKey('BLOG_POST', 'Publisher', identifier);

const takeOne = (overrides: Partial<AppBudgetRequest> = {}) => {
  const decision = takeFromAppBudget(request(overrides));
  if (decision.kind !== 'take') {
    throw new Error(`expected the budget to pay, got ${decision.kind}`);
  }
  return decision.ticket;
};

beforeEach(() => {
  window.localStorage.clear();
  resetAppBudgetsForTests();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('which app a budget is for', () => {
  it('takes Q-Apps and websites and nothing else', () => {
    expect(budgetAppFrom('APP', 'Opened-App')).toEqual(APP);
    expect(budgetAppFrom('website', 'Opened-App')).toEqual(SITE);
    expect(budgetAppFrom('DOCUMENT', 'Opened-App')).toBeNull();
    expect(budgetAppFrom('APP', '')).toBeNull();
    expect(budgetAppFrom('APP', ' Opened-App')).toBeNull();
    expect(budgetAppFrom('APP', 'x'.repeat(41))).toBeNull();
  });

  it('refuses a name with characters that draw nothing', () => {
    expect(budgetAppFrom('APP', 'Opened\u200B-App')).toBeNull();
    expect(budgetAppFrom('APP', 'Opened-App\u202E')).toBeNull();
  });

  it('takes the app from the tab a request came from, not from Hub, a private app or Dev Mode', () => {
    const tab = { name: 'Opened-App', service: 'APP', tabId: 'tab-1' };
    expect(budgetAppOfRequest(tab)).toEqual(APP);
    expect(budgetAppOfRequest(HUB_REQUEST)).toBeNull();
    expect(budgetAppOfRequest({ ...tab, isPrivate: true })).toBeNull();
    expect(budgetAppOfRequest({ ...tab, isDevMode: true })).toBeNull();
    expect(budgetAppOfRequest({ ...tab, tabId: undefined })).toBeNull();
    expect(budgetAppOfRequest(null)).toBeNull();
  });
});

describe('saved budgets', () => {
  it('keeps each account apart', () => {
    give(QORT);
    expect(findAppBudget(ACCOUNT, APP)?.total).toBe('100000000');
    expect(findAppBudget(OTHER_ACCOUNT, APP)).toBeNull();
    expect(takeFromAppBudget(request({ address: OTHER_ACCOUNT })).kind).toBe(
      'ask'
    );
  });

  it('keeps a website and a Q-App of the same name apart', () => {
    give(QORT, { app: SITE });
    expect(findAppBudget(ACCOUNT, APP)).toBeNull();
    expect(takeFromAppBudget(request()).kind).toBe('ask');
    expect(takeFromAppBudget(request({ app: SITE })).kind).toBe('take');
  });

  it('matches a name in any case', () => {
    give(QORT);
    expect(
      takeFromAppBudget(
        request({ app: { service: 'APP', name: 'opened-app' } })
      ).kind
    ).toBe('take');
  });

  it('reads unreadable saved data as no budget, so the app asks', () => {
    window.localStorage.setItem(`app-budgets-v1:${ACCOUNT}`, '{not json');
    expect(appBudgetsOf(ACCOUNT)).toEqual([]);
    expect(takeFromAppBudget(request()).kind).toBe('ask');

    window.localStorage.setItem(
      `app-budgets-v1:${ACCOUNT}`,
      JSON.stringify({
        v: 1,
        budgets: [{ service: 'APP', name: 'Opened-App', total: '-5' }],
      })
    );
    resetAppBudgetsForTests();
    expect(appBudgetsOf(ACCOUNT)).toEqual([]);
  });

  it('tells listeners when a budget changes, and keeps the same list until then', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAppBudgets(listener);
    const before = appBudgetsOf(ACCOUNT);
    expect(appBudgetsOf(ACCOUNT)).toBe(before);
    give(QORT);
    expect(listener).toHaveBeenCalled();
    expect(appBudgetsOf(ACCOUNT)).not.toBe(before);
    unsubscribe();
  });
});

describe('taking from a budget', () => {
  it('asks when the app has no budget', () => {
    expect(takeFromAppBudget(request()).kind).toBe('ask');
  });

  it('counts a done action as used, with its time and what it was', () => {
    give(QORT);
    const ticket = takeOne({ kind: 'publish', resources: [POST_KEY] });
    ticket.done(POST);
    ticket.release();
    const budget = findAppBudget(ACCOUNT, APP);
    expect(budget.used).toBe('1000000');
    expect(budget.actions).toBe(1);
    expect(budget.times).toEqual([NOW]);
    expect(budget.recent).toEqual([
      {
        at: NOW,
        kind: 'publish',
        fee: '1000000',
        service: 'BLOG_POST',
        identifier: 'post-1',
      },
    ]);
  });

  it('gives the fee back when the action fails', () => {
    give(FEE);
    const ticket = takeOne();
    expect(takeFromAppBudget(request()).kind).toBe('used_up');
    ticket.release();
    expect(findAppBudget(ACCOUNT, APP).used).toBe('0');
    expect(takeFromAppBudget(request()).kind).toBe('take');
  });

  it('lets only one of two requests take the last 0.01', () => {
    give(FEE * BigInt(2));
    takeOne().done();
    const first = takeFromAppBudget(request());
    const second = takeFromAppBudget(request());
    expect(first.kind).toBe('take');
    expect(second.kind).toBe('used_up');
  });

  it('shares one budget between two tabs of the app', () => {
    give(FEE * BigInt(2));
    // The tab doesn't matter: both requests are the same app's.
    takeOne().done();
    takeOne().done();
    expect(takeFromAppBudget(request()).kind).toBe('used_up');
    expect(findAppBudget(ACCOUNT, APP).actions).toBe(2);
  });

  it('ends at its end date, checked when the action happens', () => {
    give(QORT, { expiresAt: NOW + DAY });
    expect(takeFromAppBudget(request({ now: NOW + DAY - 1 })).kind).toBe(
      'take'
    );
    const decision = takeFromAppBudget(request({ now: NOW + DAY }));
    expect(decision.kind).toBe('ended');
  });

  it('stops a free chat message once nothing is left', () => {
    give(FEE);
    takeOne().done();
    expect(
      takeFromAppBudget(request({ kind: 'chat', fee: BigInt(0) })).kind
    ).toBe('used_up');
  });

  it('counts chat messages toward the limits only', () => {
    give(FEE);
    const ticket = takeOne({ kind: 'chat', fee: BigInt(0) });
    ticket.done({ groupId: 7 });
    const budget = findAppBudget(ACCOUNT, APP);
    expect(budget.used).toBe('0');
    expect(budget.actions).toBe(1);
    expect(budget.recent[0]).toMatchObject({ kind: 'chat', groupId: 7 });
  });

  it('stops at 20 a minute and 300 a day on the standard limits', () => {
    give(QORT * BigInt(10));
    const perMinute = APP_BUDGET_LIMIT_RATES.standard.perMinute;
    for (let i = 0; i < perMinute; i += 1) takeOne().done();
    expect(takeFromAppBudget(request())).toMatchObject({
      kind: 'limit',
      per: 'minute',
      max: 20,
    });
    // A minute later the next one fits again.
    vi.setSystemTime(NOW + MINUTE + 1);
    expect(takeFromAppBudget(request({ now: NOW + MINUTE + 1 })).kind).toBe(
      'take'
    );
  });

  it('counts actions under way toward the limits', () => {
    give(QORT * BigInt(10));
    for (let i = 0; i < 20; i += 1) takeOne();
    expect(takeFromAppBudget(request()).kind).toBe('limit');
  });

  it('stops at 300 a day', () => {
    give(QORT * BigInt(10));
    const times = Array.from({ length: 300 }, (_, i) => NOW - DAY + 1 + i);
    const saved = JSON.parse(
      window.localStorage.getItem(`app-budgets-v1:${ACCOUNT}`)
    );
    saved.budgets[0].times = times;
    window.localStorage.setItem(
      `app-budgets-v1:${ACCOUNT}`,
      JSON.stringify(saved)
    );
    expect(takeFromAppBudget(request())).toMatchObject({
      kind: 'limit',
      per: 'day',
      max: 300,
    });
  });

  it('has no limit but the budget with No limit', () => {
    give(QORT * BigInt(2), { limits: 'none' });
    for (let i = 0; i < 150; i += 1) takeOne().done();
    expect(takeFromAppBudget(request()).kind).toBe('take');
  });

  it('lets a request the user approved past the limits', () => {
    give(QORT * BigInt(10));
    for (let i = 0; i < 20; i += 1) takeOne().done();
    expect(takeFromAppBudget(request({ approved: true })).kind).toBe('take');
  });

  it('takes all of a multi-publish or none of it', () => {
    give(FEE * BigInt(2));
    const decision = takeFromAppBudget(
      request({
        kind: 'publish',
        count: 3,
        resources: [key('a'), key('b'), key('c')],
      })
    );
    expect(decision.kind).toBe('used_up');
    expect(
      takeFromAppBudget(
        request({ kind: 'publish', count: 2, resources: [key('a'), key('b')] })
      ).kind
    ).toBe('take');
  });

  it("asks when a publish writes the same resource twice, or one that's under way or published", () => {
    give(QORT);
    expect(
      takeFromAppBudget(
        request({ kind: 'publish', count: 2, resources: [key('a'), key('a')] })
      )
    ).toEqual({ kind: 'ask' });
    const first = takeOne({ kind: 'publish', resources: [POST_KEY] });
    expect(
      takeFromAppBudget(request({ kind: 'publish', resources: [POST_KEY] }))
    ).toEqual({ kind: 'ask', reason: 'publishing' });
    first.done(POST);
    first.release();
    // Published by a budget this session: the node may not list it yet.
    expect(
      takeFromAppBudget(request({ kind: 'publish', resources: [POST_KEY] }))
    ).toEqual({ kind: 'ask', reason: 'published' });
  });

  it('frees a resource that failed to publish', () => {
    give(QORT);
    takeOne({ kind: 'publish', resources: [POST_KEY] }).release();
    expect(
      takeFromAppBudget(request({ kind: 'publish', resources: [POST_KEY] }))
        .kind
    ).toBe('take');
  });

  it('keeps a done fee held when it could not be saved', () => {
    give(FEE * BigInt(2));
    const ticket = takeOne();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('full');
      });
    ticket.done();
    ticket.release();
    setItem.mockRestore();
    // Not saved as used, but still held: the second 0.01 is all that's left.
    expect(findAppBudget(ACCOUNT, APP).used).toBe('0');
    takeOne();
    expect(takeFromAppBudget(request()).kind).toBe('used_up');
  });

  it('lets an action finish when its budget was removed meanwhile', () => {
    give(QORT);
    const ticket = takeOne();
    expect(removeAppBudget(ACCOUNT, APP)).toBe(true);
    ticket.done();
    ticket.release();
    expect(findAppBudget(ACCOUNT, APP)).toBeNull();
    give(FEE);
    expect(takeFromAppBudget(request()).kind).toBe('take');
  });
});

describe('what a budget never pays for', () => {
  it('never publishes an app, a website, the avatar or a record Hub keeps for itself', () => {
    expect(isAlwaysAskedResource('APP', undefined)).toBe(true);
    expect(isAlwaysAskedResource('website', 'any')).toBe(true);
    expect(isAlwaysAskedResource('THUMBNAIL', 'qortal_avatar')).toBe(true);
    expect(
      isAlwaysAskedResource('DOCUMENT_PRIVATE', 'ext_saved_settings')
    ).toBe(true);
    expect(isAlwaysAskedResource('DOCUMENT', 'ext_saved_settings_2')).toBe(
      true
    );
    expect(isAlwaysAskedResource('COMMENT', 'qhub_review_v1_APP_x')).toBe(true);
    expect(
      isAlwaysAskedResource('DOCUMENT_PRIVATE', 'symmetric-qchat-group-7')
    ).toBe(true);
    expect(
      isAlwaysAskedResource(
        'DOCUMENT_PRIVATE',
        'admins-symmetric-qchat-group-7'
      )
    ).toBe(true);
    // An app's own posts and pictures are fine.
    expect(isAlwaysAskedResource('BLOG_POST', 'post-1')).toBe(false);
    expect(isAlwaysAskedResource('THUMBNAIL', 'post-1-cover')).toBe(false);
    expect(isAlwaysAskedResource('MAIL_PRIVATE', undefined)).toBe(false);
  });

  it("never votes on Hub's library ratings", () => {
    expect(isAlwaysAskedPoll('app-library-APP-rating-Other-App')).toBe(true);
    expect(isAlwaysAskedPoll('App-Library-WEBSITE-rating-x')).toBe(true);
    expect(isAlwaysAskedPoll(undefined)).toBe(true);
    expect(isAlwaysAskedPoll('Poll-1')).toBe(false);
  });

  it('asks for more at once than the limits allow at all', () => {
    give(QORT);
    const resources = Array.from({ length: 21 }, (_, i) => key(`p-${i}`));
    expect(
      takeFromAppBudget(request({ kind: 'publish', count: 21, resources }))
    ).toEqual({ kind: 'ask' });
  });
});

describe('budgets and what they hold', () => {
  it('keeps what an action holds with the budget that allowed it', () => {
    give(QORT);
    const ticket = takeOne();
    expect(removeAppBudget(ACCOUNT, APP)).toBe(true);
    // A new budget of 0.01 isn't held by the old one's action.
    give(FEE);
    expect(takeFromAppBudget(request()).kind).toBe('take');
    ticket.done();
    ticket.release();
    // Nor charged for it.
    expect(findAppBudget(ACCOUNT, APP).used).toBe('0');
  });

  it('gives each budget an id of its own, also after removing one', () => {
    give(QORT);
    const first = findAppBudget(ACCOUNT, APP).id;
    removeAppBudget(ACCOUNT, APP);
    give(QORT);
    expect(findAppBudget(ACCOUNT, APP).id).toMatch(/^[0-9a-f]{16}$/);
    expect(findAppBudget(ACCOUNT, APP).id).not.toBe(first);
  });

  it('asks for a chat message once less than one fee is left', () => {
    give(FEE + FEE / BigInt(2));
    takeOne().done();
    expect(
      takeFromAppBudget(request({ kind: 'chat', fee: BigInt(0) })).kind
    ).toBe('used_up');
  });

  it('says whose budget a ticket holds and the signing session it was taken in', () => {
    give(QORT);
    const ticket = takeOne({ session: 7 });
    expect(ticket).toMatchObject({ paid: true, address: ACCOUNT, session: 7 });
    expect(takeOne().session).toBeNull();
    expect(trackApprovedPublish(ACCOUNT, [POST_KEY])).toMatchObject({
      paid: false,
      address: ACCOUNT,
      session: null,
    });
  });

  it('keeps a publish approved in the window from being published again by a budget', () => {
    give(QORT);
    const approved = trackApprovedPublish(ACCOUNT, [POST_KEY]);
    expect(approved.paid).toBe(false);
    expect(
      takeFromAppBudget(request({ kind: 'publish', resources: [POST_KEY] }))
        .kind
    ).toBe('ask');
    approved.done(POST);
    approved.release();
    // Published this session: still not again.
    expect(
      takeFromAppBudget(request({ kind: 'publish', resources: [POST_KEY] }))
        .kind
    ).toBe('ask');
    // Nothing was charged for it.
    expect(findAppBudget(ACCOUNT, APP).used).toBe('0');
  });
});

describe('changing budgets', () => {
  it('adds a top-up to what is left', () => {
    give(QORT);
    takeOne().done();
    expect(topUpAppBudget(ACCOUNT, APP, QORT, NOW)).toBe(true);
    const budget = findAppBudget(ACCOUNT, APP);
    expect(budget.total).toBe('200000000');
    expect(budget.used).toBe('1000000');
  });

  it('refills an ended budget with the new amount only', () => {
    give(QORT, { expiresAt: NOW + DAY });
    takeOne().done();
    const later = NOW + 2 * DAY;
    expect(budgetState(findAppBudget(ACCOUNT, APP), later)).toBe('ended');
    expect(
      refillAppBudget(
        ACCOUNT,
        APP,
        { amount: QORT, expiresAt: null, limits: 'higher' },
        later
      )
    ).toBe(true);
    const budget = findAppBudget(ACCOUNT, APP);
    // 0.99 were left when it ended; now 1 is.
    expect(BigInt(budget.total) - BigInt(budget.used)).toBe(QORT);
    expect(budget.expiresAt).toBeNull();
    expect(budget.limits).toBe('higher');
    expect(budgetState(budget, later)).toBe('active');
  });

  it("doesn't top up or change an ended budget", () => {
    give(QORT, { expiresAt: NOW + DAY });
    const later = NOW + 2 * DAY;
    expect(topUpAppBudget(ACCOUNT, APP, QORT, later)).toBe(false);
    expect(
      changeAppBudget(
        ACCOUNT,
        APP,
        { expiresAt: later + DAY, limits: 'none' },
        later
      )
    ).toBe(false);
  });

  it('changes the end date and limits', () => {
    give(QORT);
    expect(
      changeAppBudget(ACCOUNT, APP, { expiresAt: null, limits: 'none' }, NOW)
    ).toBe(true);
    expect(findAppBudget(ACCOUNT, APP)).toMatchObject({
      expiresAt: null,
      limits: 'none',
    });
    expect(
      changeAppBudget(ACCOUNT, APP, { expiresAt: NOW - 1, limits: 'none' }, NOW)
    ).toBe(false);
  });

  it('refuses amounts outside 0.01 to 1,000 QORT', () => {
    expect(
      refillAppBudget(
        ACCOUNT,
        APP,
        { amount: BigInt(999999), expiresAt: null, limits: 'standard' },
        NOW
      )
    ).toBe(false);
    expect(
      refillAppBudget(
        ACCOUNT,
        APP,
        {
          amount: QORT * BigInt(1000) + BigInt(1),
          expiresAt: null,
          limits: 'standard',
        },
        NOW
      )
    ).toBe(false);
  });

  it('removes a budget', () => {
    give(QORT);
    expect(removeAppBudget(ACCOUNT, APP)).toBe(true);
    expect(findAppBudget(ACCOUNT, APP)).toBeNull();
    expect(removeAppBudget(ACCOUNT, APP)).toBe(false);
  });

  it('says used up once what is left cannot pay the next fee', () => {
    give(FEE + FEE / BigInt(2));
    takeOne().done();
    expect(budgetState(findAppBudget(ACCOUNT, APP), NOW)).toBe('used_up');
  });
});

describe('choices', () => {
  it('ends a month or a year from now, on the last day of a shorter month', () => {
    const jan31 = new Date(2027, 0, 31, 10, 0, 0).getTime();
    expect(new Date(budgetEndTime({ kind: 'month' }, jan31))).toEqual(
      new Date(2027, 1, 28, 10, 0, 0)
    );
    expect(new Date(budgetEndTime({ kind: 'year' }, jan31))).toEqual(
      new Date(2028, 0, 31, 10, 0, 0)
    );
    expect(budgetEndTime({ kind: 'never' }, jan31)).toBeNull();
  });

  it('ends a chosen date at the end of that day, and refuses a past or impossible one', () => {
    expect(budgetEndTime({ kind: 'date', date: '2026-12-01' }, NOW)).toBe(
      new Date(2026, 11, 1, 23, 59, 59, 999).getTime()
    );
    expect(
      budgetEndTime({ kind: 'date', date: '2026-11-18' }, NOW)
    ).toBeUndefined();
    expect(
      budgetEndTime({ kind: 'date', date: '2027-02-30' }, NOW)
    ).toBeUndefined();
    expect(budgetEndTime({ kind: 'date', date: 'soon' }, NOW)).toBeUndefined();
    expect(budgetEndTime({ kind: 'forever' }, NOW)).toBeUndefined();
  });

  it('reads amounts as plain decimals from 0.01 to 1,000', () => {
    expect(budgetAmountFrom('1')).toBe(QORT);
    expect(budgetAmountFrom('0.01')).toBe(FEE);
    expect(budgetAmountFrom('1000')).toBe(QORT * BigInt(1000));
    expect(budgetAmountFrom('0.009')).toBeNull();
    expect(budgetAmountFrom('1000.01')).toBeNull();
    expect(budgetAmountFrom('1e3')).toBeNull();
    expect(budgetAmountFrom(5)).toBeNull();
  });

  it('checks a choice the window sends back', () => {
    expect(
      budgetChoiceFrom(
        { amount: '5', end: { kind: 'never' }, limits: 'higher' },
        NOW
      )
    ).toEqual({ amount: QORT * BigInt(5), expiresAt: null, limits: 'higher' });
    expect(
      budgetChoiceFrom(
        { amount: '5', end: { kind: 'never' }, limits: 'unlimited' },
        NOW
      )
    ).toBeNull();
    expect(
      budgetChoiceFrom({ amount: '5', end: null, limits: 'higher' }, NOW)
    ).toBeNull();
  });

  it('keys a resource by service, name in any case, and identifier', () => {
    expect(budgetResourceKey('blog_post', 'Publisher', undefined)).toBe(
      budgetResourceKey('BLOG_POST', 'publisher', 'default')
    );
    expect(budgetResourceKey('BLOG_POST', 'Publisher', '')).toBe(
      budgetResourceKey('BLOG_POST', 'Publisher', null)
    );
    // Core publishes the text "null" as an identifier of its own.
    expect(budgetResourceKey('BLOG_POST', 'Publisher', 'null')).not.toBe(
      budgetResourceKey('BLOG_POST', 'Publisher', null)
    );
    expect(budgetResourceKey('BLOG_POST', 'Publisher', 'a')).not.toBe(
      budgetResourceKey('BLOG_POST', 'Publisher', 'A')
    );
  });
});
