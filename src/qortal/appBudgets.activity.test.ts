import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appBudgetsOf,
  findAppBudget,
  markAppBudgetNoticeSeen,
  refillAppBudget,
  resetAppBudgetsForTests,
  takeFromAppBudget,
  unseenAppBudgetNotices,
  type AppBudgetActionDetails,
  type AppBudgetActionKind,
  type BudgetApp,
} from './appBudgets';

// What a budget keeps of its actions, and the notice once a day has many.

const ACCOUNT = 'QaccountOne';
const APP: BudgetApp = { service: 'APP', name: 'Opened-App' };
const SITE: BudgetApp = { service: 'WEBSITE', name: 'Opened-App' };
const FEE = BigInt(1000000); // 0.01 QORT
const QORT = BigInt(100000000);
const NOW = new Date(2026, 10, 19, 12, 0, 0).getTime();
const SECOND = 1000;
const DAY = 24 * 60 * 60 * SECOND;

const give = (app = APP) =>
  expect(
    refillAppBudget(
      ACCOUNT,
      app,
      { amount: QORT * BigInt(5), expiresAt: null, limits: 'none' },
      NOW
    )
  ).toBe(true);

/** One action of the app, done at `at`. */
const act = (
  at: number,
  {
    app = APP,
    kind = 'vote' as AppBudgetActionKind,
    details = {} as AppBudgetActionDetails,
  } = {}
) => {
  vi.setSystemTime(at);
  const decision = takeFromAppBudget({
    address: ACCOUNT,
    app,
    kind,
    count: 1,
    fee: kind === 'chat' ? BigInt(0) : FEE,
    now: at,
  });
  if (decision.kind !== 'take') {
    throw new Error(`expected the budget to pay, got ${decision.kind}`);
  }
  decision.ticket.done(details);
  decision.ticket.release();
};

const noticeOf = (app = APP) => findAppBudget(ACCOUNT, app).notice;

beforeEach(() => {
  window.localStorage.clear();
  resetAppBudgetsForTests();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('what a budget keeps of its actions', () => {
  it('keeps who a direct message went to, and the group of a group message', () => {
    give();
    act(NOW, { kind: 'chat', details: { recipient: 'QrecipientOne' } });
    act(NOW, {
      kind: 'chat',
      details: { groupId: 7, recipient: 'QrecipientTwo' },
    });
    act(NOW, { details: { poll: 'Lunch', recipient: 'QrecipientThree' } });
    expect(findAppBudget(ACCOUNT, APP).recent).toEqual([
      { at: NOW, kind: 'chat', fee: '0', recipient: 'QrecipientOne' },
      { at: NOW, kind: 'chat', fee: '0', groupId: 7 },
      { at: NOW, kind: 'vote', fee: '1000000', poll: 'Lunch' },
    ]);
  });

  it('reads a saved recipient and notice back, and drops what is malformed', () => {
    const budget = {
      id: '0123456789abcdef',
      service: 'APP',
      name: 'Opened-App',
      total: '100000000',
      used: '0',
      actions: 1,
      startedAt: NOW,
      expiresAt: null,
      limits: 'standard',
      times: [NOW],
      recent: [
        {
          at: NOW,
          kind: 'chat',
          fee: '0',
          recipient: `Q${'x'.repeat(100)}`,
        },
      ],
      notice: { at: NOW, count: 52, seen: true },
    };
    const save = (value: object) =>
      window.localStorage.setItem(
        `app-budgets-v1:${ACCOUNT}`,
        JSON.stringify({ v: 1, budgets: [value] })
      );

    save(budget);
    expect(appBudgetsOf(ACCOUNT)[0].recent[0].recipient).toBe(
      `Q${'x'.repeat(79)}`
    );
    expect(appBudgetsOf(ACCOUNT)[0].notice).toEqual({
      at: NOW,
      count: 52,
      seen: true,
    });

    resetAppBudgetsForTests();
    save({ ...budget, notice: { at: 'yesterday', count: 52 } });
    expect(appBudgetsOf(ACCOUNT)[0].notice).toBeNull();
  });
});

describe('the notice when a day has many actions', () => {
  it('comes with the 50th action of a day, and only once', () => {
    give();
    for (let i = 0; i < 49; i += 1) act(NOW + i * SECOND);
    expect(noticeOf()).toBeNull();

    act(NOW + 49 * SECOND);
    expect(noticeOf()).toEqual({
      at: NOW + 49 * SECOND,
      count: 50,
      seen: false,
    });

    for (let i = 50; i < 120; i += 1) act(NOW + i * SECOND);
    expect(noticeOf()).toEqual({
      at: NOW + 49 * SECOND,
      count: 50,
      seen: false,
    });
  });

  it('comes again a day after the last one, once another day reaches 50', () => {
    give();
    for (let i = 0; i < 50; i += 1) act(NOW + i * SECOND);
    const first = noticeOf();
    expect(
      markAppBudgetNoticeSeen(ACCOUNT, findAppBudget(ACCOUNT, APP).id)
    ).toBe(true);

    // The next day starts quietly: the old actions have left the last 24 h.
    const nextDay = first.at + DAY + SECOND;
    for (let i = 0; i < 49; i += 1) act(nextDay + i * SECOND);
    expect(noticeOf()).toEqual({ ...first, seen: true });

    act(nextDay + 49 * SECOND);
    expect(noticeOf()).toEqual({
      at: nextDay + 49 * SECOND,
      count: 50,
      seen: false,
    });
  });

  it("doesn't come again within a day of the last one, seen or not", () => {
    give();
    for (let i = 0; i < 50; i += 1) act(NOW + i * 60 * SECOND);
    const first = noticeOf();
    // 23 hours later the last day still holds 50 and more.
    for (let i = 0; i < 60; i += 1) {
      act(first.at + 23 * 60 * 60 * SECOND + i * SECOND);
    }
    expect(noticeOf()).toEqual(first);
  });

  it('lists the notices not seen, the oldest first, and keeps a seen one seen', () => {
    give(SITE);
    give(APP);
    for (let i = 0; i < 50; i += 1) act(NOW + i * SECOND, { app: SITE });
    for (let i = 0; i < 50; i += 1) act(NOW + (60 + i) * SECOND);

    const unseen = () =>
      unseenAppBudgetNotices(appBudgetsOf(ACCOUNT)).map((b) => b.service);
    expect(unseen()).toEqual(['WEBSITE', 'APP']);

    const site = findAppBudget(ACCOUNT, SITE);
    expect(markAppBudgetNoticeSeen(ACCOUNT, site.id)).toBe(true);
    expect(unseen()).toEqual(['APP']);
    expect(markAppBudgetNoticeSeen(ACCOUNT, site.id)).toBe(false);
    expect(markAppBudgetNoticeSeen(ACCOUNT, 'ffffffffffffffff')).toBe(false);
    expect(markAppBudgetNoticeSeen('QaccountTwo', site.id)).toBe(false);
  });
});
