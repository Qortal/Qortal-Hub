import { createContext, useState, type ReactNode } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node.test',
  QORTAL_APP_CONTEXT: createContext({ show: vi.fn() }),
}));
vi.mock('../../background/background.ts', () => ({ getFee: vi.fn() }));

import '../../i18n/i18n';
import { QORTAL_APP_CONTEXT } from '../../App';
import { memberGroupsAtom, txListAtom, userInfoAtom } from '../../atoms/global';
import { getFee } from '../../background/background.ts';
import { useModal } from '../../hooks/useModal';
import { NULL_ACCOUNT } from '../../lib/explorer/reads';
import { darkTheme } from '../../styles/theme-dark';
import { lightTheme } from '../../styles/theme-light';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { JoinGroup } from '../GlobalActions/JoinGroup';
import { ExplorerWindow } from './ExplorerWindow';
import { isolate } from './parts';

// These tests drive the whole Explorer window against a made-up node: up to
// about 3-5 s each on a fast machine, past Vitest's 5 s default on a busy CI
// runner. Keep the extra time local to this file, as Hub's other page tests do.
vi.setConfig({ testTimeout: 20_000 });

// The Overview's group cards: each group's avatar, and Join on the groups
// the signed-in Hub account isn't in, which opens Hub's own join window (the
// real one, with a stand-in for App's fee confirmation) over the Explorer
// window, reading a made-up node.

const READER = `Q${'R'.repeat(33)}`;
const PUBLISHER = `Q${'P'.repeat(33)}`;
const SECOND = `Q${'S'.repeat(33)}`;
const THIRD = `Q${'T'.repeat(33)}`;
const PUBLIC_KEY = 'k'.repeat(44);

type Row = Record<string, unknown>;
type Answer = { status?: number; body: unknown; delay?: Promise<void> };
type Route = (path: string) => Answer | undefined;

let routes: Route[] = [];
let calls: Array<{ method: string; path: string }> = [];

const MINTER_ROW: Row = {
  groupId: 694,
  groupName: 'MINTER',
  owner: NULL_ACCOUNT,
  isOpen: false,
  memberCount: 600,
  isAdmin: false,
};
const DEV_ROW: Row = {
  groupId: 1,
  groupName: 'dev-group',
  owner: NULL_ACCOUNT,
  isOpen: false,
  memberCount: 20,
  isAdmin: false,
};
/** Open, owned by Second, whose name the node sends with it. */
const ALPHA: Row = {
  groupId: 7,
  groupName: 'alpha',
  owner: SECOND,
  ownerPrimaryName: 'Second',
  isOpen: true,
  memberCount: 3,
  isAdmin: false,
};
/** Closed, owned by Third, who has no name: the node sends none with it. */
const BETA: Row = {
  groupId: 9,
  groupName: 'beta',
  owner: THIRD,
  isOpen: false,
  memberCount: 30,
  isAdmin: false,
};
/** Open, owned by Publisher; Reader is in it too. */
const GAMMA: Row = {
  groupId: 11,
  groupName: 'gamma',
  owner: PUBLISHER,
  ownerPrimaryName: 'Publisher',
  isOpen: true,
  memberCount: 12,
  isAdmin: false,
};

/** The cards' buttons, as screen readers name them (names set apart). */
const JOIN_ALPHA = `Join ${isolate('alpha')}`;
const ASK_BETA = `Ask to join ${isolate('beta')}`;
const JOINING_ALPHA = `Joining ${isolate('alpha')}: waiting for a block`;
const ASKED_BETA = `Request sent to join ${isolate('beta')}: its admins decide`;

function account(address: string) {
  return {
    address,
    reference: 'ref',
    publicKey: PUBLIC_KEY,
    level: 3,
    blocksMinted: 250_000,
    blocksMintedAdjustment: 0,
    blocksMintedPenalty: 0,
  };
}

/** The node's answers that every account page reads, for `address`. */
function quietAccount(address: string, name: string | null): Route {
  return (path) => {
    if (path === `/addresses/${address}`) return { body: account(address) };
    if (path === `/names/primary/${address}`)
      return { body: name ? { name, owner: address } : { owner: address } };
    if (path.startsWith(`/names/address/${address}`))
      return { body: name ? [{ name, owner: address }] : [] };
    if (path === `/groups/member/${address}`) return { body: [] };
    if (path === `/addresses/balance/${address}`) return { body: 12.5 };
    if (path.startsWith(`/blocks/signer/${address}`)) return { body: [] };
    if (path.startsWith('/transactions/search?') && path.includes(address))
      return { body: [] };
    return undefined;
  };
}

const commonRoutes: Route = (path) => {
  if (path === '/addresses/online') return { body: [] };
  if (path.startsWith('/groups/members/1?')) return { body: { members: [] } };
  if (path.startsWith('/names/search?')) return { body: [] };
  if (path.startsWith('/transactions/creator/')) return { body: [] };
  if (path === '/admin/status') return { body: { height: 2_000_500 } };
  if (path === '/admin/info')
    return { body: { currentTimestamp: 2_000_000_000_000 } };
  if (path.startsWith('/blocks/byheight/'))
    return {
      body: { height: 1_999_060, timestamp: 2_000_000_000_000 - 86_400_000 },
    };
  // What Hub's join window reads about a group.
  for (const group of [ALPHA, BETA])
    if (path === `/groups/${group.groupId}`) return { body: group };
  return undefined;
};

/** Publisher's page, its groups `groups`. */
function publisher(groups: Row[] = [MINTER_ROW, ALPHA, BETA, GAMMA]): Route[] {
  return [
    (path) =>
      path === `/groups/member/${PUBLISHER}` ? { body: groups } : undefined,
    quietAccount(PUBLISHER, 'Publisher'),
  ];
}

/** The signed-in account, Reader: in gamma, or what `answer` says of its groups. */
function reader(answer: () => Answer = () => ({ body: [GAMMA] })): Route[] {
  return [
    (path) => (path === `/groups/member/${READER}` ? answer() : undefined),
    quietAccount(READER, 'Reader'),
  ];
}

function stubNode() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).slice('http://node.test'.length);
      calls.push({ method: init?.method ?? 'GET', path });
      for (const route of [...routes, commonRoutes]) {
        const answer = route(path);
        if (!answer) continue;
        if (answer.delay) await answer.delay;
        const status = answer.status ?? 200;
        return {
          ok: status >= 200 && status < 300,
          status,
          text: async () => JSON.stringify(answer.body),
          json: async () => answer.body,
        } as Response;
      }
      return {
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ error: 999, message: 'no route' }),
        json: async () => ({}),
      } as Response;
    })
  );
}

/** App's fee confirmation, as App provides it to Hub's join window. */
function FeeConfirmation({ children }: { children: ReactNode }) {
  const { show, onOk, onCancel, isShow } = useModal();
  return (
    <QORTAL_APP_CONTEXT.Provider value={{ show } as never}>
      {children}
      {isShow ? (
        <>
          <button type="button" onClick={() => onOk(undefined)}>
            accept fee
          </button>
          <button type="button" onClick={onCancel}>
            decline fee
          </button>
        </>
      ) : null}
    </QORTAL_APP_CONTEXT.Provider>
  );
}

function Harness({ joinWindow }: { joinWindow: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ExplorerWindow
        isOpenDrawerLookup={open}
        setIsOpenDrawerLookup={setOpen}
      />
      {/* Hub's own join window, as the top bar mounts it. */}
      {joinWindow ? (
        <FeeConfirmation>
          <JoinGroup />
        </FeeConfirmation>
      ) : null}
    </>
  );
}

function renderWindow(
  store: ReturnType<typeof createStore>,
  { joinWindow = true, theme = darkTheme } = {}
) {
  render(
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <Harness joinWindow={joinWindow} />
      </ThemeProvider>
    </Provider>
  );
  return store;
}

function signedIn(address = READER) {
  const store = createStore();
  store.set(userInfoAtom, { address, name: 'Reader' } as never);
  return store;
}

const lookUp = (who: string) =>
  act(() => {
    executeEvent('openUserLookupDrawer', { addressOrName: who });
  });

const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 60)));

/** The Explorer window (hidden from screen readers while a window is over it). */
const explorer = () =>
  screen.getByRole('dialog', { hidden: true, name: 'Explorer' });
/** Hub's join window, when it is open. */
const joinWindow = () =>
  screen
    .queryAllByRole('dialog', { hidden: true })
    .find((dialog) => dialog !== explorer()) ?? null;
const groupsRegion = () =>
  within(explorer()).getByRole('region', { hidden: true, name: /^groups/i });
/** The card of the group named `name`. */
const card = (name: string) =>
  within(groupsRegion())
    .getAllByRole('listitem', { hidden: true })
    .find((item) => within(item).queryByText(name) !== null) as HTMLElement;
const button = (name: string) =>
  within(groupsRegion()).queryByRole('button', { hidden: true, name });
const findButton = (name: string) =>
  within(groupsRegion()).findByRole('button', { hidden: true, name });
const joinButtons = () =>
  within(groupsRegion()).queryAllByRole('button', {
    hidden: true,
    name: /join|request/i,
  });
const readsOf = (path: string) =>
  calls.filter((call) => call.path === path).length;

/** Publisher's page, its groups listed. */
async function openPublisher() {
  await lookUp(PUBLISHER);
  await within(explorer()).findByRole('heading', {
    hidden: true,
    level: 2,
    name: 'Publisher',
  });
  await within(groupsRegion()).findByText('alpha');
}

/** Reader's own page, its groups listed. */
async function openReader(groupName: string) {
  await lookUp(READER);
  await within(explorer()).findByRole('heading', {
    hidden: true,
    level: 2,
    name: 'Reader',
  });
  await within(groupsRegion()).findByText(groupName);
}

/** Join in Hub's join window, opened from a card's button, then the fee accepted. */
async function joinThroughHub(cardButton: HTMLElement, groupName: string) {
  fireEvent.click(cardButton);
  await waitFor(() => expect(joinWindow()).not.toBeNull());
  const shown = joinWindow() as HTMLElement;
  await within(shown).findByText(new RegExp(groupName));
  fireEvent.click(within(shown).getByRole('button', { name: 'Join' }));
  fireEvent.click(await screen.findByText('accept fee'));
}

let joinsOpened: unknown[] = [];
const onJoinOpened = (event: Event) =>
  joinsOpened.push((event as CustomEvent).detail);

beforeEach(() => {
  routes = [];
  calls = [];
  joinsOpened = [];
  window.localStorage.clear();
  stubNode();
  vi.mocked(getFee).mockResolvedValue({ fee: '0.01' } as never);
  window.sendMessage = vi.fn(async () => ({
    signature: 'joinsignature',
    creatorAddress: READER,
  })) as never;
  subscribeToEvent('globalActionJoinGroup', onJoinOpened);
});

afterEach(() => {
  unsubscribeFromEvent('globalActionJoinGroup', onJoinOpened);
  delete window.sendMessage;
  vi.unstubAllGlobals();
});

describe("a group card's Join", () => {
  it("is on the groups the signed-in account isn't in, by their kind, never on its own groups or Qortal's own (MINTER, the dev group), from the one read of its groups", async () => {
    routes.push(
      ...reader(),
      ...publisher([MINTER_ROW, DEV_ROW, ALPHA, BETA, GAMMA])
    );
    renderWindow(signedIn());
    await openPublisher();
    expect(await findButton(JOIN_ALPHA)).toHaveTextContent(/^Join$/);
    expect(button(ASK_BETA)).toHaveTextContent(/^Ask to join$/);
    expect(within(card('gamma')).queryByRole('button')).toBeNull();
    expect(within(card('MINTER')).queryByRole('button')).toBeNull();
    expect(within(card('dev-group')).queryByRole('button')).toBeNull();
    await settle();
    // The level 5+ rule's read of its groups, shared: nothing more.
    expect(readsOf(`/groups/member/${READER}`)).toBe(1);
  });

  it("opens Hub's own join window over the Explorer, which stays on its step, and says Joining from the moment the fee is accepted", async () => {
    routes.push(...reader(), ...publisher());
    // The node takes a moment to answer the join.
    let answer!: (value: unknown) => void;
    window.sendMessage = vi.fn(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    ) as never;
    renderWindow(signedIn());
    await openPublisher();

    fireEvent.click(await findButton(JOIN_ALPHA));
    expect(joinsOpened).toEqual([{ groupId: '7' }]);
    await waitFor(() => expect(joinWindow()).not.toBeNull());
    const join = joinWindow() as HTMLElement;
    expect(await within(join).findByText(/alpha/)).toBeInTheDocument();
    // Over the Explorer, which is still open on Publisher's page.
    expect(explorer().closest('[aria-hidden="true"]')).not.toBeNull();
    expect(
      within(explorer()).getByRole('heading', {
        hidden: true,
        level: 2,
        name: 'Publisher',
      })
    ).toBeInTheDocument();

    fireEvent.click(within(join).getByRole('button', { name: 'Join' }));
    fireEvent.click(await screen.findByText('accept fee'));
    await waitFor(() =>
      expect(window.sendMessage).toHaveBeenCalledWith('joinGroup', {
        groupId: 7,
      })
    );
    // Before the node has answered.
    const joining = await findButton(JOINING_ALPHA);
    expect(joining).toHaveAttribute('aria-disabled', 'true');
    expect(joining).toHaveTextContent('Joining…');
    expect(button(JOIN_ALPHA)).toBeNull();
    await act(async () =>
      answer({ signature: 'joinsignature', creatorAddress: READER })
    );
    await settle();
    // Sent: Hub's record of it waits for the block.
    expect(button(JOINING_ALPHA)).toBe(joining);

    // Still on Publisher's page; nothing was read again, and nothing polls.
    await waitFor(() => expect(joinWindow()).toBeNull());
    expect(
      within(explorer()).getByRole('heading', { level: 2, name: 'Publisher' })
    ).toBeInTheDocument();
    await settle();
    expect(readsOf(`/groups/member/${READER}`)).toBe(1);
    expect(window.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('says a closed group’s join request was sent', async () => {
    routes.push(...reader(), ...publisher());
    renderWindow(signedIn());
    await openPublisher();
    await joinThroughHub(await findButton(ASK_BETA), 'beta');
    expect(joinsOpened).toEqual([{ groupId: '9' }]);
    expect(await findButton(ASKED_BETA)).toHaveTextContent('Request sent');
    expect(button(ASK_BETA)).toBeNull();
  });

  it('sends no second join while Hub is still sending the first', async () => {
    routes.push(...reader(), ...publisher());
    // Hub's background signs the join and the node checks it: that takes a
    // moment, and Hub has the join's record only once the node has answered.
    const answers: Array<(value: unknown) => void> = [];
    window.sendMessage = vi.fn(
      () => new Promise((resolve) => answers.push(resolve))
    ) as never;
    renderWindow(signedIn());
    await openPublisher();
    await joinThroughHub(await findButton(JOIN_ALPHA), 'alpha');
    await waitFor(() => expect(window.sendMessage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(joinWindow()).toBeNull());

    // Whatever is still offered for alpha, taken up once more.
    const again = button(JOIN_ALPHA);
    if (again) {
      fireEvent.click(again);
      await settle();
      const shown = joinWindow();
      if (shown) {
        await within(shown).findByText(/alpha/);
        const join = within(shown).queryByRole('button', { name: 'Join' });
        if (join) fireEvent.click(join);
        await settle();
      }
      const accept = screen.queryByText('accept fee');
      if (accept) fireEvent.click(accept);
      await settle();
    }
    answers.forEach((answer, index) =>
      answer({ signature: `joinsignature${index}`, creatorAddress: READER })
    );
    await settle();
    expect(window.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('stays, with the keyboard back on it, when the join window closes without a join', async () => {
    const user = userEvent.setup();
    routes.push(...reader(), ...publisher());
    renderWindow(signedIn());
    await openPublisher();
    const join = await findButton(JOIN_ALPHA);
    await user.click(join);
    await waitFor(() => expect(joinWindow()).not.toBeNull());
    const shown = joinWindow() as HTMLElement;
    await within(shown).findByText(/alpha/);
    fireEvent.click(within(shown).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(joinWindow()).toBeNull());
    expect(button(JOIN_ALPHA)).toBe(join);
    await waitFor(() => expect(join).toHaveFocus());
    expect(window.sendMessage).not.toHaveBeenCalled();
    await settle();
    expect(readsOf(`/groups/member/${READER}`)).toBe(1);
  });

  it('opens the join window from the keyboard, which closes with Escape back onto the Explorer and its Join', async () => {
    const user = userEvent.setup();
    routes.push(...reader(), ...publisher());
    renderWindow(signedIn());
    await openPublisher();
    const join = await findButton(JOIN_ALPHA);
    act(() => join.focus());
    await user.keyboard('{Enter}');
    await waitFor(() => expect(joinWindow()).not.toBeNull());
    await within(joinWindow() as HTMLElement).findByText(/alpha/);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(joinWindow()).toBeNull());
    // The Explorer stays open, on Publisher's page, and its Join has the focus.
    expect(
      within(explorer()).getByRole('heading', { level: 2, name: 'Publisher' })
    ).toBeInTheDocument();
    await waitFor(() => expect(join).toHaveFocus());
    expect(window.sendMessage).not.toHaveBeenCalled();
  });

  it('opens a join window whose Close the keyboard reaches', async () => {
    const user = userEvent.setup();
    routes.push(...reader(), ...publisher());
    renderWindow(signedIn());
    await openPublisher();
    const join = await findButton(JOIN_ALPHA);
    act(() => join.focus());
    await user.keyboard('{Enter}');
    await waitFor(() => expect(joinWindow()).not.toBeNull());
    await within(joinWindow() as HTMLElement).findByText(/alpha/);
    // Tab round the window: every control in it gets the focus in turn.
    const reached = new Set<string>();
    for (let step = 0; step < 4; step++) {
      await user.tab();
      reached.add((document.activeElement?.textContent ?? '').trim());
    }
    expect([...reached]).toContain('Close');
  });

  it('is there at once when the window opens again within a minute, from what the level 5+ rule kept, reading nothing again', async () => {
    routes.push(...reader(), ...publisher());
    renderWindow(signedIn());
    await openPublisher();
    await findButton(JOIN_ALPHA);
    await settle();
    const reads = readsOf(`/groups/member/${READER}`);
    fireEvent.click(
      within(explorer()).getByRole('button', { name: /^close$/i })
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { hidden: true })).toBeNull()
    );
    await openPublisher();
    expect(await findButton(JOIN_ALPHA)).toBeInTheDocument();
    await settle();
    expect(readsOf(`/groups/member/${READER}`)).toBe(reads);
  });

  it('carries the newest groups the window read into the next one: after its own page read a new group, the next window offers no Join on it', async () => {
    let readerGroups: Row[] = [GAMMA];
    routes.push(...reader(() => ({ body: readerGroups })), ...publisher());
    renderWindow(signedIn());
    // The window opens on Reader's own page: the rule reads its groups.
    await openReader('gamma');
    await settle();
    // Reader joined alpha meanwhile (another device, or a Q-App's own
    // JOIN_GROUP: nothing in Hub's task list). Refresh on its own page
    // reads its groups again, and the page lists alpha.
    readerGroups = [GAMMA, ALPHA];
    fireEvent.click(
      within(explorer()).getByRole('button', { name: /^refresh$/i })
    );
    await within(groupsRegion()).findByText('alpha');
    // Closed, and gone (faded out: the next window starts with a new cache),
    // then opened again well within the minute.
    fireEvent.click(
      within(explorer()).getByRole('button', { name: /^close$/i })
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { hidden: true })).toBeNull()
    );
    await openPublisher();
    await findButton(ASK_BETA);
    expect(button(JOIN_ALPHA)).toBeNull();
  });

  it('never puts back the groups the level 5+ rule kept over newer ones the window read', async () => {
    let readerGroups: Row[] = [GAMMA];
    routes.push(...reader(() => ({ body: readerGroups })), ...publisher());
    renderWindow(signedIn());
    await openReader('gamma');
    // It joined alpha meanwhile: Refresh on its own page reads its groups again.
    readerGroups = [GAMMA, ALPHA];
    fireEvent.click(
      within(explorer()).getByRole('button', { name: /^refresh$/i })
    );
    await within(groupsRegion()).findByText('alpha');
    // Closed and opened again before it has faded out: the same window.
    fireEvent.click(
      within(explorer()).getByRole('button', { name: /^close$/i })
    );
    await openPublisher();
    expect(await findButton(ASK_BETA)).toBeInTheDocument();
    expect(button(JOIN_ALPHA)).toBeNull();
  });

  it('never cancels a read of its groups on its way: Refresh on its own page, then the window closed and opened again before it faded out', async () => {
    let readerGroups: Row[] = [GAMMA];
    let slow = false;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    routes.push(
      ...reader(() => ({
        body: readerGroups,
        delay: slow ? held : undefined,
      })),
      ...publisher()
    );
    renderWindow(signedIn());
    await openReader('gamma');
    await settle();
    // Reader joined alpha elsewhere; its own page's Refresh reads its groups
    // again, slowly.
    slow = true;
    readerGroups = [GAMMA, ALPHA];
    fireEvent.click(
      within(explorer()).getByRole('button', { name: /^refresh$/i })
    );
    await settle();
    // Closed and opened again on Publisher's page at once (the same window).
    fireEvent.click(
      within(explorer()).getByRole('button', { name: /^close$/i })
    );
    await openPublisher();
    // The node's answer, with Reader in alpha, comes in now.
    await act(async () => release());
    await settle();
    await findButton(ASK_BETA);
    expect(button(JOIN_ALPHA)).toBeNull();
  });

  it("offers no Join while the signed-in account's groups are being read", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    routes.push(
      ...reader(() => ({ body: [GAMMA], delay: held })),
      ...publisher()
    );
    renderWindow(signedIn());
    await openPublisher();
    await settle();
    expect(joinButtons()).toEqual([]);
    await act(async () => release());
    expect(await findButton(JOIN_ALPHA)).toBeInTheDocument();
  });

  it("offers no Join when the signed-in account's groups couldn't be read, and says so, with Retry", async () => {
    let fail = true;
    routes.push(
      ...reader(() =>
        fail
          ? { status: 500, body: { error: 5, message: 'repository issue' } }
          : { body: [GAMMA] }
      ),
      ...publisher()
    );
    renderWindow(signedIn());
    await openPublisher();
    const note = await within(groupsRegion()).findByText(
      "Couldn't check which of these groups you're in."
    );
    expect(joinButtons()).toEqual([]);
    fail = false;
    fireEvent.click(
      within(note.closest('[role="alert"]') as HTMLElement).getByRole(
        'button',
        { name: /retry/i }
      )
    );
    expect(await findButton(JOIN_ALPHA)).toBeInTheDocument();
    expect(
      within(groupsRegion()).queryByText(
        "Couldn't check which of these groups you're in."
      )
    ).toBeNull();
  });

  it('is on no card when no one is signed in, and no one else’s groups are read', async () => {
    routes.push(...publisher());
    renderWindow(createStore());
    await openPublisher();
    await settle();
    expect(joinButtons()).toEqual([]);
    expect(
      within(groupsRegion()).queryByText(
        "Couldn't check which of these groups you're in."
      )
    ).toBeNull();
    expect(
      [...new Set(calls.map((call) => call.path))].filter((path) =>
        path.startsWith('/groups/member/')
      )
    ).toEqual([`/groups/member/${PUBLISHER}`]);
  });

  it('is on no card of the signed-in account’s own page, from the same one read', async () => {
    routes.push(...publisher());
    renderWindow(signedIn(PUBLISHER));
    await openPublisher();
    await settle();
    expect(joinButtons()).toEqual([]);
    expect(readsOf(`/groups/member/${PUBLISHER}`)).toBe(1);
  });

  it("is on no card of a group Hub has the account in, though the node's answer doesn't list it yet", async () => {
    routes.push(...reader(), ...publisher());
    const store = signedIn();
    store.set(memberGroupsAtom, [{ groupId: 7 }] as never);
    renderWindow(store);
    await openPublisher();
    expect(await findButton(ASK_BETA)).toBeInTheDocument();
    expect(button(JOIN_ALPHA)).toBeNull();
  });

  it('is offered again on a group the account joined and then left in this session', async () => {
    routes.push(...reader(), ...publisher());
    const store = signedIn();
    // Hub has it in gamma only; its task list, newest first, holds the leave
    // (ManageMembers / the group's menu) after the join (Hub's join window,
    // marked done by TaskManager once it was in alpha).
    store.set(memberGroupsAtom, [{ groupId: 11 }] as never);
    store.set(txListAtom, [
      {
        type: 'leave-group',
        groupId: 7,
        done: true,
        signature: 'leavesignature',
        creatorAddress: READER,
      },
      {
        type: 'joined-group',
        groupId: 7,
        done: true,
        signature: 'joinsignature',
        creatorAddress: READER,
      },
    ] as never);
    renderWindow(store);
    await openPublisher();
    expect(await findButton(ASK_BETA)).toBeInTheDocument();
    expect(button(JOIN_ALPHA)).not.toBeNull();
  });

  it("is offered again on a group the account was removed from after joining it, though the node's older answer lists it", async () => {
    // The node's answer, read before the account was removed from alpha.
    routes.push(...reader(() => ({ body: [GAMMA, ALPHA] })), ...publisher());
    const store = signedIn();
    // Hub's own list no longer has it in alpha; its join went through.
    store.set(memberGroupsAtom, [{ groupId: 11 }] as never);
    store.set(txListAtom, [
      {
        type: 'joined-group',
        groupId: 7,
        done: true,
        signature: 'joinsignature',
        creatorAddress: READER,
      },
    ] as never);
    renderWindow(store);
    await openPublisher();
    expect(await findButton(JOIN_ALPHA)).toBeInTheDocument();
  });

  it('works from the keyboard, and keeps its place once Hub has sent the join', async () => {
    const user = userEvent.setup();
    routes.push(...reader(), ...publisher());
    const store = signedIn();
    renderWindow(store, { joinWindow: false });
    await openPublisher();
    const join = await findButton(JOIN_ALPHA);
    act(() => join.focus());
    await user.keyboard('{Enter}');
    expect(joinsOpened).toEqual([{ groupId: '7' }]);
    // Hub's join flow records the join it sent, as its join window does.
    act(() => {
      store.set(txListAtom, [
        {
          type: 'joined-group',
          groupId: 7,
          done: false,
          creatorAddress: READER,
        },
      ] as never);
    });
    expect(join).toHaveAccessibleName(JOINING_ALPHA);
    expect(join).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(joinsOpened).toHaveLength(1);
  });

  it("goes under the group's name when the two don't fit on one line", async () => {
    routes.push(...reader(), ...publisher());
    renderWindow(signedIn());
    await openPublisher();
    const join = await findButton(JOIN_ALPHA);
    expect(join.parentElement).toHaveStyle({ flexWrap: 'wrap' });
    expect(join.parentElement).toContainElement(
      within(card('alpha')).getByText('alpha')
    );
  });
});

describe("MINTER's card", () => {
  it('has an (i) saying what MINTER is, which the keyboard reaches and screen readers read', async () => {
    routes.push(...reader(), ...publisher());
    renderWindow(signedIn());
    await openPublisher();
    const info = within(card('MINTER')).getByRole('img', {
      name: /^MINTER is Qortal's minting group/,
    });
    expect(info).toHaveAccessibleName(
      "MINTER is Qortal's minting group: since October 2024, being a member is what lets an account mint. New members come in through nominations in Q-Mintership and the Minter Admins' decisions."
    );
    expect(info).toHaveAttribute('tabindex', '0');
    // Only MINTER's.
    expect(
      within(card('alpha')).queryByRole('img', { name: /minting group/ })
    ).toBeNull();
  });
});

describe("a group card's avatar", () => {
  it("is the picture its owner published for the group, under the name the node sends with it, encoded, with the group's initial until it loads and when it fails", async () => {
    routes.push(
      ...reader(),
      ...publisher([
        MINTER_ROW,
        { ...ALPHA, ownerPrimaryName: 'Second Room/?#%' },
        BETA,
        { ...GAMMA, ownerPrimaryName: 'Publisher' },
        {
          groupId: 13,
          groupName: '',
          owner: NULL_ACCOUNT,
          isOpen: true,
          memberCount: 2,
        },
      ])
    );
    renderWindow(signedIn(), { theme: lightTheme });
    await openPublisher();
    const avatar = (name: string) =>
      card(name).querySelector('[data-avatar]') as HTMLElement;
    const picture = (name: string) =>
      avatar(name).querySelector('img') as HTMLImageElement | null;

    // alpha: its owner's name came with the group.
    await waitFor(() =>
      expect(picture('alpha')).toHaveAttribute(
        'src',
        'http://node.test/arbitrary/THUMBNAIL/Second%20Room%2F%3F%23%25/qortal_group_avatar_7?async=true'
      )
    );
    expect(avatar('alpha')).toHaveAttribute('data-avatar', 'initial');
    expect(avatar('alpha')).toHaveTextContent(/^A$/);
    fireEvent.load(picture('alpha') as HTMLImageElement);
    expect(avatar('alpha')).toHaveAttribute('data-avatar', 'picture');
    expect(avatar('alpha')).toHaveTextContent(/^$/);

    // gamma: its picture fails.
    await waitFor(() =>
      expect(picture('gamma')).toHaveAttribute(
        'src',
        'http://node.test/arbitrary/THUMBNAIL/Publisher/qortal_group_avatar_11?async=true'
      )
    );
    fireEvent.error(picture('gamma') as HTMLImageElement);
    expect(picture('gamma')).toBeNull();
    expect(avatar('gamma')).toHaveAttribute('data-avatar', 'initial');
    expect(avatar('gamma')).toHaveTextContent(/^G$/);

    // beta: its owner has no name, so there is no picture, and nothing more is read.
    expect(picture('beta')).toBeNull();
    expect(avatar('beta')).toHaveTextContent(/^B$/);
    // MINTER: Core's null account has no name either.
    expect(picture('MINTER')).toBeNull();
    expect(avatar('MINTER')).toHaveTextContent(/^M$/);
    // A group without a name: a groups icon in place of an initial.
    expect(picture('Group #13')).toBeNull();
    expect(
      within(avatar('Group #13')).getByTestId('GroupsRoundedIcon')
    ).toBeInTheDocument();
    await settle();
    expect(
      calls.filter(
        ({ path }) =>
          path.startsWith('/names/primary/') &&
          path !== `/names/primary/${PUBLISHER}` &&
          path !== `/names/primary/${READER}`
      )
    ).toEqual([]);
  });

  it("tries the picture under the owner's new name when Refresh brings one", async () => {
    let ownerName = 'Second';
    routes.push(
      ...reader(),
      (path) =>
        path === `/groups/member/${PUBLISHER}`
          ? { body: [{ ...ALPHA, ownerPrimaryName: ownerName }] }
          : undefined,
      ...publisher()
    );
    renderWindow(signedIn());
    await openPublisher();
    const picture = () => card('alpha').querySelector('img');
    await waitFor(() =>
      expect(picture()).toHaveAttribute(
        'src',
        'http://node.test/arbitrary/THUMBNAIL/Second/qortal_group_avatar_7?async=true'
      )
    );
    fireEvent.error(picture() as HTMLImageElement);
    expect(picture()).toBeNull();
    ownerName = 'Second Room';
    fireEvent.click(
      within(explorer()).getByRole('button', { name: /^refresh$/i })
    );
    await waitFor(() =>
      expect(picture()).toHaveAttribute(
        'src',
        'http://node.test/arbitrary/THUMBNAIL/Second%20Room/qortal_group_avatar_7?async=true'
      )
    );
  });

  it('loads nothing for a card that never nears the screen', async () => {
    const observers: Array<{
      callback: IntersectionObserverCallback;
      targets: Element[];
    }> = [];
    class FakeObserver {
      callback: IntersectionObserverCallback;
      targets: Element[] = [];
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        observers.push(this);
      }
      observe(target: Element) {
        this.targets.push(target);
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const near = (node: Element) =>
      act(() => {
        for (const observer of observers)
          if (observer.targets.includes(node))
            observer.callback(
              [
                {
                  isIntersecting: true,
                  target: node,
                } as IntersectionObserverEntry,
              ],
              observer as unknown as IntersectionObserver
            );
      });
    routes.push(...reader(), ...publisher());
    renderWindow(signedIn());
    await openPublisher();
    await settle();
    expect(groupsRegion().querySelectorAll('img')).toHaveLength(0);

    near(card('alpha'));
    await waitFor(() =>
      expect(card('alpha').querySelector('img')).toHaveAttribute(
        'src',
        'http://node.test/arbitrary/THUMBNAIL/Second/qortal_group_avatar_7?async=true'
      )
    );
    // The cards that never neared still load nothing.
    expect(card('gamma').querySelector('img')).toBeNull();
  });
});

describe('an account in many groups', () => {
  /** `count` groups, g01 to gNN, the n-th with n members, owned by Second. */
  const many = (count: number): Row[] =>
    Array.from({ length: count }, (_, index) => {
      const n = index + 1;
      return {
        groupId: 100 + n,
        groupName: `g${String(n).padStart(2, '0')}`,
        owner: SECOND,
        ownerPrimaryName: 'Second',
        isOpen: true,
        memberCount: n,
        isAdmin: false,
      };
    });
  const cards = () =>
    within(groupsRegion()).queryAllByRole('listitem', { hidden: true });
  const toggle = () =>
    within(groupsRegion()).queryByRole('button', {
      hidden: true,
      name: /^show (all|fewer)/i,
    });
  /** Publisher's page, its groups `groups`, the first of them listed. */
  const openMany = async (groups: Row[]) => {
    routes.push(...reader(), ...publisher(groups));
    renderWindow(signedIn());
    await lookUp(PUBLISHER);
    await within(explorer()).findByRole('heading', {
      hidden: true,
      level: 2,
      name: 'Publisher',
    });
    await within(groupsRegion()).findByText('g01');
  };

  it('shows all of 25, with no button', async () => {
    await openMany(many(25));
    expect(cards()).toHaveLength(25);
    expect(toggle()).toBeNull();
  });

  it('shows the first 25 of 26, then all of them, then 25 again, keeping the focus on the button, in view', async () => {
    const scrollIntoView = Element.prototype.scrollIntoView;
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    try {
      await openMany(many(26));
      expect(
        within(explorer()).getByRole('region', { name: /^groups \(26\)$/i })
      ).toBeInTheDocument();
      expect(cards()).toHaveLength(25);
      expect(within(groupsRegion()).queryByText('g26')).toBeNull();
      const button = toggle() as HTMLElement;
      expect(button).toHaveAccessibleName('Show all 26');
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(button).toHaveAttribute(
        'aria-controls',
        within(groupsRegion()).getByRole('list').id
      );

      fireEvent.click(button);
      expect(cards()).toHaveLength(26);
      expect(within(groupsRegion()).getByText('g26')).toBeInTheDocument();
      expect(button).toHaveAccessibleName('Show fewer');
      expect(button).toHaveAttribute('aria-expanded', 'true');

      // Pressed from far down the long list, with the focus elsewhere.
      act(() => within(card('g26')).getByRole('button').focus());
      fireEvent.click(button);
      expect(cards()).toHaveLength(25);
      expect(button).toHaveAccessibleName('Show all 26');
      expect(button).toHaveFocus();
      expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' });
      expect(scrolled.mock.contexts).toContain(button);
    } finally {
      Element.prototype.scrollIntoView = scrollIntoView;
    }
  });

  it('shows the first 25 of the new order when the order changes while folded', async () => {
    await openMany(many(26));
    fireEvent.mouseDown(within(groupsRegion()).getByRole('combobox'));
    fireEvent.click(
      await screen.findByRole('option', { name: /most members/i })
    );
    await waitFor(() =>
      expect(within(groupsRegion()).queryByText('g26')).not.toBeNull()
    );
    expect(cards()).toHaveLength(25);
    expect(within(groupsRegion()).queryByText('g01')).toBeNull();
    expect(cards()[0]).toHaveTextContent('g26');
  });

  it('stays open with its step, through Back and Forward', async () => {
    routes.push(quietAccount(SECOND, 'Second'));
    await openMany(many(26));
    fireEvent.click(toggle() as HTMLElement);
    expect(cards()).toHaveLength(26);
    // Another account, opened as one more step.
    await lookUp(SECOND);
    await within(explorer()).findByRole('heading', {
      level: 2,
      name: 'Second',
    });
    const back = () =>
      fireEvent.click(
        within(explorer()).getByRole('button', { name: /^back$/i })
      );
    back();
    await within(explorer()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    await within(groupsRegion()).findByText('g26');
    expect(cards()).toHaveLength(26);
    expect(toggle()).toHaveAccessibleName('Show fewer');
    fireEvent.click(
      within(explorer()).getByRole('button', { name: /^forward$/i })
    );
    await within(explorer()).findByRole('heading', {
      level: 2,
      name: 'Second',
    });
    back();
    await within(groupsRegion()).findByText('g26');
    expect(cards()).toHaveLength(26);
  });

  it('takes neither the focus nor the scroll when Back shows a folded list again', async () => {
    const scrollIntoView = Element.prototype.scrollIntoView;
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    try {
      routes.push(quietAccount(SECOND, 'Second'));
      await openMany(many(26));
      await lookUp(SECOND);
      await within(explorer()).findByRole('heading', {
        level: 2,
        name: 'Second',
      });
      fireEvent.click(
        within(explorer()).getByRole('button', { name: /^back$/i })
      );
      await within(groupsRegion()).findByText('g25');
      const button = toggle() as HTMLElement;
      expect(button).toHaveAccessibleName('Show all 26');
      expect(button).not.toHaveFocus();
      expect(scrolled.mock.contexts).not.toContain(button);
    } finally {
      Element.prototype.scrollIntoView = scrollIntoView;
    }
  });

  it('keeps the order with the step too: Back shows the page as it was left, and another account starts at MINTER first, folded', async () => {
    // Third's groups, MINTER last in the node's answer.
    routes.push(
      (path) =>
        path === `/groups/member/${THIRD}`
          ? { body: [...many(27), MINTER_ROW] }
          : undefined,
      quietAccount(THIRD, 'Third')
    );
    const order = () => within(groupsRegion()).getByRole('combobox');
    await openMany(many(26));
    fireEvent.mouseDown(order());
    fireEvent.click(
      await screen.findByRole('option', { name: /most members/i })
    );
    await waitFor(() => expect(cards()[0]).toHaveTextContent('g26'));
    fireEvent.click(toggle() as HTMLElement);
    expect(cards()).toHaveLength(26);

    // Another account, opened anew: MINTER first, folded.
    await lookUp(THIRD);
    await within(explorer()).findByRole('heading', {
      level: 2,
      name: 'Third',
    });
    await within(groupsRegion()).findByText('MINTER');
    expect(order()).toHaveTextContent(/^MINTER first$/);
    expect(cards()).toHaveLength(25);
    expect(cards()[0]).toHaveTextContent('MINTER');
    expect(cards()[1]).toHaveTextContent('g01');
    expect(toggle()).toHaveAccessibleName('Show all 28');
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');

    // Back: the order, the fold and the first card as they were left.
    fireEvent.click(
      within(explorer()).getByRole('button', { name: /^back$/i })
    );
    await within(explorer()).findByRole('heading', {
      level: 2,
      name: 'Publisher',
    });
    await within(groupsRegion()).findByText('g01');
    expect(order()).toHaveTextContent(/^Most members$/);
    expect(cards()).toHaveLength(26);
    expect(cards()[0]).toHaveTextContent('g26');
    expect(toggle()).toHaveAccessibleName('Show fewer');
  });

  it("loads nothing for the cards past the 25th until they're shown", async () => {
    await openMany(many(26));
    const picture = (groupId: number) =>
      document.querySelector(`img[src*="qortal_group_avatar_${groupId}?"]`);
    await waitFor(() => expect(picture(101)).not.toBeNull());
    expect(picture(126)).toBeNull();
    fireEvent.click(toggle() as HTMLElement);
    await waitFor(() => expect(picture(126)).not.toBeNull());
  });
});
