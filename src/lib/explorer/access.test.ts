import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

import {
  fullExplorerAccess,
  fullExplorerByRole,
  readFullExplorer,
} from './access';
import { createExplorerCache } from './cache';

// The level 5+ rule (Minter Admins, MINTER members at level 5 or above,
// Dev Admins), and what it reads to settle it.

const VIEWER = `Q${'V'.repeat(33)}`;
const OTHER = `Q${'O'.repeat(33)}`;

type Answer = { status?: number; body: unknown };
let answers: Record<string, Answer | (() => Answer)> = {};
let paths: string[] = [];

beforeEach(() => {
  answers = {};
  paths = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url).slice('http://node.test'.length);
      paths.push(path);
      const key = Object.keys(answers).find((prefix) =>
        path.startsWith(prefix)
      );
      const found = key ? answers[key] : undefined;
      const answer =
        typeof found === 'function'
          ? found()
          : (found ?? { status: 404, body: { error: 999 } });
      const status = answer.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(answer.body),
      } as Response;
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

const level = (n: number) => ({
  [`/addresses/${VIEWER}`]: {
    body: { address: VIEWER, level: n, blocksMinted: 0 },
  },
});
const groups = (minter: 'admin' | 'member' | null) => ({
  [`/groups/member/${VIEWER}`]: {
    body: minter
      ? [{ groupId: 694, groupName: 'MINTER', isAdmin: minter === 'admin' }]
      : [{ groupId: 12, groupName: 'Other', isAdmin: true }],
  },
});
const devAdmins = (members: string[]) => ({
  '/groups/members/1?': {
    body: { members: members.map((member) => ({ member, isAdmin: true })) },
  },
});
const failing = (prefix: string) => ({
  [prefix]: { status: 500, body: { error: 5, message: 'repository issue' } },
});
const devAdminReads = () =>
  paths.filter((path) => path.startsWith('/groups/members/1?'));

describe('the rule', () => {
  it('Minter Admins, MINTER members at level 5 or above, and Dev Admins', () => {
    expect(
      fullExplorerByRole({ isAdmin: true, isMember: true, level: 1 })
    ).toBe(true);
    expect(
      fullExplorerByRole({ isAdmin: false, isMember: true, level: 5 })
    ).toBe(true);
    expect(
      fullExplorerByRole({ isAdmin: false, isMember: true, level: 4 })
    ).toBe(false);
    // Level 5 outside MINTER (a former member keeps its level) isn't enough.
    expect(
      fullExplorerByRole({ isAdmin: false, isMember: false, level: 7 })
    ).toBe(false);
    expect(
      fullExplorerAccess({ isAdmin: false, isMember: false, level: 0 }, true)
    ).toBe(true);
    expect(
      fullExplorerAccess({ isAdmin: false, isMember: false, level: 0 }, false)
    ).toBe(false);
  });
});

describe('readFullExplorer', () => {
  it('a Minter Admin at level 1: yes, without asking for the Dev Admins', async () => {
    answers = { ...level(1), ...groups('admin') };
    await expect(readFullExplorer(VIEWER, createExplorerCache())).resolves.toBe(
      true
    );
    expect(devAdminReads()).toEqual([]);
  });

  it('a MINTER member at level 5: yes, without the Dev Admins', async () => {
    answers = { ...level(5), ...groups('member') };
    await expect(readFullExplorer(VIEWER, createExplorerCache())).resolves.toBe(
      true
    );
    expect(devAdminReads()).toEqual([]);
  });

  it('a MINTER member at level 4: the Dev Admins decide, and it isn’t one', async () => {
    answers = { ...level(4), ...groups('member'), ...devAdmins([OTHER]) };
    await expect(readFullExplorer(VIEWER, createExplorerCache())).resolves.toBe(
      false
    );
    expect(devAdminReads()).toHaveLength(1);
  });

  it('a Dev Admin outside MINTER: yes', async () => {
    answers = { ...level(0), ...groups(null), ...devAdmins([VIEWER]) };
    await expect(readFullExplorer(VIEWER, createExplorerCache())).resolves.toBe(
      true
    );
  });

  it('a level 7 account outside MINTER, not a Dev Admin: no', async () => {
    answers = { ...level(7), ...groups(null), ...devAdmins([OTHER]) };
    await expect(readFullExplorer(VIEWER, createExplorerCache())).resolves.toBe(
      false
    );
  });

  it('an address the node never saw: level 0, no groups, so no', async () => {
    answers = {
      [`/addresses/${VIEWER}`]: {
        status: 404,
        body: { error: 124, message: 'account address unknown' },
      },
      [`/groups/member/${VIEWER}`]: { body: [] },
      ...devAdmins([]),
    };
    await expect(readFullExplorer(VIEWER, createExplorerCache())).resolves.toBe(
      false
    );
  });

  it('its groups couldn’t be read: unknown (it rejects), unless it is a Dev Admin', async () => {
    answers = { ...level(9), ...failing(`/groups/member/`), ...devAdmins([]) };
    await expect(
      readFullExplorer(VIEWER, createExplorerCache())
    ).rejects.toBeTruthy();
    answers = {
      ...level(9),
      ...failing(`/groups/member/`),
      ...devAdmins([VIEWER]),
    };
    await expect(readFullExplorer(VIEWER, createExplorerCache())).resolves.toBe(
      true
    );
  });

  it('a member whose level couldn’t be read: unknown, unless it is a Dev Admin', async () => {
    answers = {
      ...failing(`/addresses/${VIEWER}`),
      ...groups('member'),
      ...devAdmins([]),
    };
    await expect(
      readFullExplorer(VIEWER, createExplorerCache())
    ).rejects.toBeTruthy();
    // An admin's level doesn't matter.
    answers = { ...failing(`/addresses/${VIEWER}`), ...groups('admin') };
    await expect(readFullExplorer(VIEWER, createExplorerCache())).resolves.toBe(
      true
    );
  });

  it('the Dev Admins couldn’t be read when they decide: unknown, never a no', async () => {
    answers = {
      ...level(2),
      ...groups(null),
      ...failing('/groups/members/1?'),
    };
    await expect(
      readFullExplorer(VIEWER, createExplorerCache())
    ).rejects.toBeTruthy();
  });

  it('reads through the window’s cache: what an account page already read isn’t read again', async () => {
    answers = { ...level(5), ...groups('member') };
    const cache = createExplorerCache();
    await readFullExplorer(VIEWER, cache);
    await readFullExplorer(VIEWER, cache);
    expect(
      paths.filter((path) => path === `/addresses/${VIEWER}`)
    ).toHaveLength(1);
    expect(cache.peek(`groups:${VIEWER}`)).toBeDefined();
  });
});
