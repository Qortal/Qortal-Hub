import { createContext, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { atom, createStore, Provider, useAtomValue } from 'jotai';
import i18n from 'i18next';
import { I18nextProvider } from 'react-i18next';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node',
  QORTAL_APP_CONTEXT: createContext({ show: vi.fn() }),
}));
vi.mock('../../background/background.ts', () => ({ getFee: vi.fn() }));

import { QORTAL_APP_CONTEXT } from '../../App';
import {
  memberGroupsAtom,
  rawWalletAtom,
  txListAtom,
  userInfoAtom,
} from '../../atoms/global';
import { getFee } from '../../background/background.ts';
import { useModal } from '../../hooks/useModal';
import { PaymentPublishDialog } from '../App/PaymentPublishDialog';
import { lightTheme } from '../../styles/theme-light';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { openQortalLink } from '../../utils/qortalLink/openQortalLink';
import { JoinGroup } from './JoinGroup';

i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { core: {} } } });

/** Hub's fee confirmation, as App provides it through its context. */
const FeeDialog = ({ children }: { children: ReactNode }) => {
  const { show, onOk, onCancel, isShow } = useModal();
  return (
    <QORTAL_APP_CONTEXT.Provider value={{ show } as never}>
      {children}
      {isShow && (
        <>
          <button onClick={() => onOk(undefined)}>accept fee</button>
          <button onClick={onCancel}>decline fee</button>
        </>
      )}
    </QORTAL_APP_CONTEXT.Provider>
  );
};

/**
 * App's own fee confirmation, with another action in Hub that asks for a fee
 * of its own, as a payment does.
 */
let askAnotherFee: () => Promise<unknown>;
const AppFeeDialog = ({ children }: { children: ReactNode }) => {
  const { show, onOk, onCancel, isShow, message } = useModal();
  askAnotherFee = () => show({ message: 'PAYMENT', paymentFee: '1 QORT' });
  return (
    <QORTAL_APP_CONTEXT.Provider value={{ show } as never}>
      {children}
      <PaymentPublishDialog
        open={isShow}
        message={message}
        onAccept={() => onOk(undefined)}
        onCancel={() => onCancel()}
      />
    </QORTAL_APP_CONTEXT.Provider>
  );
};

/**
 * A join started elsewhere in Hub (a promoted group, an invite), asking for
 * the fee in App's own dialog.
 */
const JoinElsewhere = () => {
  const { show, onOk, onCancel, isShow, message } = useModal();
  return (
    <>
      <button
        onClick={() =>
          show({ message: 'JOIN_GROUP', publishFee: '0.01 QORT' }).catch(
            () => undefined
          )
        }
      >
        join from the list
      </button>
      <PaymentPublishDialog
        open={isShow}
        message={message}
        onAccept={() => onOk(undefined)}
        onCancel={() => onCancel()}
      />
    </>
  );
};

const renderJoinGroup = (
  memberGroups: { groupId: number }[],
  {
    withFeeDialog = false,
    withAppFeeDialog = false,
    beside = null as ReactNode,
  } = {}
) => {
  const store = createStore();
  store.set(memberGroupsAtom, memberGroups as never);
  render(
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <I18nextProvider i18n={i18n}>
          {withAppFeeDialog ? (
            <AppFeeDialog>
              <JoinGroup />
            </AppFeeDialog>
          ) : withFeeDialog ? (
            <FeeDialog>
              <JoinGroup />
            </FeeDialog>
          ) : (
            <JoinGroup />
          )}
          {beside}
        </I18nextProvider>
      </ThemeProvider>
    </Provider>
  );
};

describe("a group's join link", () => {
  let groupsOpened: unknown[] = [];
  const onOpenGroup = (event: Event) =>
    groupsOpened.push((event as CustomEvent).detail);

  beforeEach(() => {
    groupsOpened = [];
    subscribeToEvent('openGroupMessage', onOpenGroup);
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ groupId: 7, groupName: 'Seven', isOpen: true })
        )
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    unsubscribeFromEvent('openGroupMessage', onOpenGroup);
  });

  it('takes a member to the group, with no join window', () => {
    renderJoinGroup([{ groupId: 5 }]);

    act(() => {
      executeEvent('globalActionJoinGroup', { groupId: '5' });
    });

    expect(groupsOpened).toEqual([{ from: '5' }]);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("keeps the group of a window the user opened, when a Q-App's link comes before it draws", async () => {
    renderJoinGroup([{ groupId: 5 }]);
    let appOpened: boolean | undefined;

    await act(async () => {
      await openQortalLink('qortal://use-group/action-join/groupid-7');
      appOpened = await openQortalLink(
        'qortal://use-group/action-join/groupid-9',
        { fromApp: true }
      );
    });

    expect(appOpened).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('http://node/groups/7');
    expect(await screen.findByText(/Seven/)).toBeInTheDocument();
  });

  describe('when an earlier answer comes late', () => {
    let answers: Record<string, (group: object) => void>;
    const answer = async (groupId: number, groupName: string) => {
      await act(async () => {
        answers[`http://node/groups/${groupId}`]({
          groupId,
          groupName,
          isOpen: true,
        });
      });
    };

    beforeEach(() => {
      answers = {};
      global.fetch = vi.fn(
        (url: string) =>
          new Promise<Response>((resolve) => {
            answers[url] = (group) =>
              resolve(new Response(JSON.stringify(group)));
          })
      ) as unknown as typeof fetch;
      vi.mocked(getFee).mockResolvedValue({ fee: '0.01' } as never);
      window.sendMessage = vi.fn(async () => ({})) as never;
    });

    afterEach(() => {
      delete window.sendMessage;
    });

    it("shows and joins the user's group after a closed Q-App window's answer", async () => {
      renderJoinGroup([{ groupId: 5 }]);

      await act(async () => {
        await openQortalLink('qortal://use-group/action-join/groupid-9', {
          fromApp: true,
        });
      });
      fireEvent.click(screen.getByText('action.close'));
      await act(async () => {
        await openQortalLink('qortal://use-group/action-join/groupid-7');
      });
      await answer(7, 'Seven');
      expect(await screen.findByText(/Seven/)).toBeInTheDocument();
      await answer(9, 'Nine');

      expect(screen.getByText(/Seven/)).toBeInTheDocument();
      expect(screen.queryByText(/Nine/)).not.toBeInTheDocument();
      await act(async () => {
        fireEvent.click(screen.getByText('action.join'));
      });
      expect(window.sendMessage).toHaveBeenCalledWith('joinGroup', {
        groupId: 7,
      });
    });

    it('shows the group of the last link the user clicked', async () => {
      renderJoinGroup([{ groupId: 5 }]);

      await act(async () => {
        await openQortalLink('qortal://use-group/action-join/groupid-9');
        await openQortalLink('qortal://use-group/action-join/groupid-7');
      });
      await answer(7, 'Seven');
      await answer(9, 'Nine');

      expect(screen.getByText(/Seven/)).toBeInTheDocument();
      expect(screen.queryByText(/Nine/)).not.toBeInTheDocument();
    });
  });

  describe("while the user's own join waits for its confirmation", () => {
    const names: Record<string, string> = { '7': 'Seven', '9': 'Nine' };

    const appOpens = async (groupId: number) => {
      let opened: boolean | undefined;
      await act(async () => {
        opened = await openQortalLink(
          `qortal://use-group/action-join/groupid-${groupId}`,
          { fromApp: true }
        );
      });
      return opened;
    };

    const userJoinsSeven = async () => {
      await act(async () => {
        await openQortalLink('qortal://use-group/action-join/groupid-7');
      });
      expect(await screen.findByText(/Seven/)).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(screen.getByText('action.join'));
      });
    };

    beforeEach(() => {
      global.fetch = vi.fn(async (url: string) => {
        const groupId = String(url).split('/').pop();
        return new Response(
          JSON.stringify({
            groupId: Number(groupId),
            groupName: names[groupId],
            isOpen: true,
          })
        );
      }) as unknown as typeof fetch;
      vi.mocked(getFee).mockResolvedValue({ fee: '0.01' } as never);
      window.sendMessage = vi.fn(async () => ({})) as never;
    });

    afterEach(() => {
      delete window.sendMessage;
    });

    it("opens no Q-App's join window over the fee confirmation, and joins the user's group", async () => {
      renderJoinGroup([{ groupId: 5 }], { withFeeDialog: true });
      await userJoinsSeven();
      expect(screen.getByText('accept fee')).toBeInTheDocument();

      expect(await appOpens(9)).toBe(false);
      expect(global.fetch).not.toHaveBeenCalledWith('http://node/groups/9');
      expect(screen.queryByText(/Nine/)).not.toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByText('accept fee'));
      });
      expect(window.sendMessage).toHaveBeenCalledTimes(1);
      expect(window.sendMessage).toHaveBeenCalledWith('joinGroup', {
        groupId: 7,
      });

      expect(await appOpens(9)).toBe(true);
      expect(await screen.findByText(/Nine/)).toBeInTheDocument();
    });

    it('opens none while the fee is looked up, and opens one again once the user declines', async () => {
      let feeAnswer: (fee: object) => void;
      vi.mocked(getFee).mockImplementation(
        () =>
          new Promise((resolve) => {
            feeAnswer = resolve;
          }) as never
      );
      renderJoinGroup([{ groupId: 5 }], { withFeeDialog: true });
      await userJoinsSeven();

      expect(await appOpens(9)).toBe(false);
      await act(async () => {
        feeAnswer({ fee: '0.01' });
      });
      await act(async () => {
        fireEvent.click(screen.getByText('decline fee'));
      });
      expect(window.sendMessage).not.toHaveBeenCalled();

      expect(await appOpens(9)).toBe(true);
      expect(await screen.findByText(/Nine/)).toBeInTheDocument();
    });

    it("opens one again when the fee can't be looked up", async () => {
      vi.mocked(getFee).mockRejectedValue(new Error('no node'));
      renderJoinGroup([{ groupId: 5 }], { withFeeDialog: true });
      await userJoinsSeven();

      expect(screen.queryByText('accept fee')).not.toBeInTheDocument();
      expect(await appOpens(9)).toBe(true);
      expect(await screen.findByText(/Nine/)).toBeInTheDocument();
    });

    it("opens no Q-App's join window over a join's fee confirmation from elsewhere in Hub", async () => {
      renderJoinGroup([{ groupId: 5 }], { beside: <JoinElsewhere /> });
      fireEvent.click(screen.getByText('join from the list'));
      expect(await screen.findByText('action.accept')).toBeInTheDocument();

      expect(await appOpens(9)).toBe(false);
      expect(global.fetch).not.toHaveBeenCalledWith('http://node/groups/9');
      expect(screen.queryByText(/Nine/)).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('action.accept'));
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      );
      expect(await appOpens(9)).toBe(true);
      expect(await screen.findByText(/Nine/)).toBeInTheDocument();
    });

    describe('when another fee confirmation takes its place', () => {
      /**
       * The user's join of Seven asks its fee, then another action's fee
       * confirmation takes its place. `otherAnswer` is how that one is
       * answered.
       */
      const joinReplacedByAnotherFee = async () => {
        renderJoinGroup([{ groupId: 5 }], { withAppFeeDialog: true });
        await userJoinsSeven();
        expect(
          await screen.findByText('message.question.perform_transaction')
        ).toBeInTheDocument();
        expect(await appOpens(9)).toBe(false);

        let otherAnswer: Promise<unknown>;
        await act(async () => {
          otherAnswer = askAnotherFee().then(
            () => 'accepted',
            (reason) => reason
          );
        });
        expect(await screen.findByText('PAYMENT')).toBeInTheDocument();
        expect(
          screen.queryByText('message.question.perform_transaction')
        ).not.toBeInTheDocument();
        // That one is on screen now: still no join window over it.
        expect(await appOpens(9)).toBe(false);
        expect(global.fetch).not.toHaveBeenCalledWith('http://node/groups/9');
        return { otherAnswer };
      };

      it("opens a Q-App's join window again once that one is declined, and joins nothing", async () => {
        const { otherAnswer } = await joinReplacedByAnotherFee();

        fireEvent.click(screen.getByText('action.decline'));
        expect(await otherAnswer).toEqual({ isCanceled: true });
        await waitFor(() =>
          expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        );

        expect(await appOpens(9)).toBe(true);
        expect(await screen.findByText(/Nine/)).toBeInTheDocument();
        expect(window.sendMessage).not.toHaveBeenCalled();
      });

      it("opens a Q-App's join window again once that one is accepted, and joins nothing", async () => {
        const { otherAnswer } = await joinReplacedByAnotherFee();

        fireEvent.click(screen.getByText('action.accept'));
        expect(await otherAnswer).toBe('accepted');
        await waitFor(() =>
          expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        );

        expect(await appOpens(9)).toBe(true);
        expect(await screen.findByText(/Nine/)).toBeInTheDocument();
        expect(window.sendMessage).not.toHaveBeenCalled();
      });
    });
  });

  it('asks anyone else first, in the join window', async () => {
    renderJoinGroup([{ groupId: 5 }]);

    await act(async () => {
      executeEvent('globalActionJoinGroup', { groupId: '7' });
    });

    expect(groupsOpened).toEqual([]);
    expect(global.fetch).toHaveBeenCalledWith('http://node/groups/7');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

describe('the join window, until the node has answered with the group', () => {
  const joinButton = () => screen.getByText('action.join').closest('button');
  // Shown: neither it nor a box around it is hidden.
  const isShown = (element: HTMLElement | null) => {
    for (let node = element; node; node = node.parentElement) {
      if (getComputedStyle(node).display === 'none') return false;
    }
    return true;
  };

  const open = async (fromApp = false) => {
    renderJoinGroup([{ groupId: 5 }]);
    await act(async () => {
      await openQortalLink('qortal://use-group/action-join/groupid-7', {
        fromApp,
      });
    });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  };

  const pressJoin = async () => {
    await act(async () => {
      fireEvent.click(screen.getByText('action.join'));
    });
  };

  beforeEach(() => {
    vi.mocked(getFee).mockReset();
    vi.mocked(getFee).mockResolvedValue({ fee: '0.01' } as never);
    window.sendMessage = vi.fn(async () => ({})) as never;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete window.sendMessage;
    vi.restoreAllMocks();
  });

  it('keeps Join off while the group loads', async () => {
    let answer: (response: Response) => void;
    global.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        })
    ) as unknown as typeof fetch;
    await open(true);

    expect(joinButton()).toBeDisabled();
    await pressJoin();
    expect(getFee).not.toHaveBeenCalled();
    expect(window.sendMessage).not.toHaveBeenCalled();

    await act(async () => {
      answer(
        new Response(
          JSON.stringify({ groupId: 7, groupName: 'Seven', isOpen: true })
        )
      );
    });
    expect(await screen.findByText(/Seven/)).toBeInTheDocument();
    expect(joinButton()).not.toBeDisabled();
  });

  it("says the group can't be read, keeps Join off, and reads it again on Retry", async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ groupId: 7, groupName: 'Seven', isOpen: true })
        )
      ) as unknown as typeof fetch;
    await open(true);

    expect(
      await screen.findByText('message.error.group_info')
    ).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(joinButton()).toBeDisabled();
    await pressJoin();
    expect(getFee).not.toHaveBeenCalled();
    expect(window.sendMessage).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByText('retry'));
    });

    expect(await screen.findByText(/Seven/)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenLastCalledWith('http://node/groups/7');
    expect(
      screen.queryByText('message.error.group_info')
    ).not.toBeInTheDocument();
    expect(joinButton()).not.toBeDisabled();
  });

  it("says when the node doesn't know the group, and keeps Join off", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: 1101, message: 'group unknown' }),
          { status: 404 }
        )
    ) as unknown as typeof fetch;
    await open();

    expect(
      await screen.findByText('message.error.no_group_found')
    ).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryAllByText(/undefined/).filter(isShown)).toEqual([]);
    expect(joinButton()).toBeDisabled();
    await pressJoin();
    expect(getFee).not.toHaveBeenCalled();
    expect(window.sendMessage).not.toHaveBeenCalled();
  });
});

describe('one join of a group at a time', () => {
  const seven = { groupId: 7, groupName: 'Seven', isOpen: true };

  /** The join window, with Hub's own task list holding `txList`. */
  const renderWithTasks = (txList: object[] = []) => {
    const store = createStore();
    store.set(memberGroupsAtom, [] as never);
    store.set(txListAtom, txList as never);
    render(
      <Provider store={store}>
        <ThemeProvider theme={lightTheme}>
          <I18nextProvider i18n={i18n}>
            <FeeDialog>
              <JoinGroup />
            </FeeDialog>
          </I18nextProvider>
        </ThemeProvider>
      </Provider>
    );
    return store;
  };

  const openSeven = async () => {
    await act(async () => {
      await openQortalLink('qortal://use-group/action-join/groupid-7');
    });
    expect(await screen.findByText(/Seven/)).toBeInTheDocument();
  };

  /** The window's Join, whatever it says. */
  const joinButton = () =>
    within(screen.getByRole('dialog')).getAllByRole('button')[0];

  /** Join pressed, and the fee accepted if it is asked for. */
  const joinAndAcceptFee = async () => {
    await act(async () => {
      fireEvent.click(joinButton());
    });
    const fee = await screen
      .findByText('accept fee', {}, { timeout: 300 })
      .catch(() => null);
    if (fee)
      await act(async () => {
        fireEvent.click(fee);
      });
  };

  beforeEach(() => {
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify(seven))
    ) as unknown as typeof fetch;
    vi.mocked(getFee).mockReset();
    vi.mocked(getFee).mockResolvedValue({ fee: '0.01' } as never);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete window.sendMessage;
    vi.restoreAllMocks();
  });

  it("sends one join when the same link's Join is pressed again while the first join's fee is looked up", async () => {
    // A slow node: each fee lookup answers when the test says so.
    const feeAnswers: ((fee: object) => void)[] = [];
    vi.mocked(getFee).mockImplementation(
      () =>
        new Promise((resolve) => {
          feeAnswers.push(resolve);
        }) as never
    );
    window.sendMessage = vi.fn(() => new Promise(() => {})) as never;
    const store = renderWithTasks();
    await openSeven();
    await act(async () => {
      fireEvent.click(joinButton());
    });
    // Nothing is on Hub's task list yet, so the window offers Join again.
    await openSeven();
    await act(async () => {
      fireEvent.click(joinButton());
    });
    expect(feeAnswers).toHaveLength(2);

    // The first fee comes and is accepted; then the second.
    await act(async () => {
      feeAnswers[0]({ fee: '0.01' });
    });
    await act(async () => {
      fireEvent.click(await screen.findByText('accept fee'));
    });
    await act(async () => {
      feeAnswers[1]({ fee: '0.01' });
    });
    const second = screen.queryByText('accept fee');
    if (second)
      await act(async () => {
        fireEvent.click(second);
      });

    expect(window.sendMessage).toHaveBeenCalledTimes(1);
    expect(
      store
        .get(txListAtom)
        .filter((record: { type?: string }) => record?.type === 'joining-group')
    ).toHaveLength(1);
  });

  it("sends no second join once the first was answered while the second's fee was looked up", async () => {
    const feeAnswers: ((fee: object) => void)[] = [];
    vi.mocked(getFee).mockImplementation(
      () =>
        new Promise((resolve) => {
          feeAnswers.push(resolve);
        }) as never
    );
    window.sendMessage = vi.fn(async () => ({ signature: 'first' })) as never;
    renderWithTasks();
    await openSeven();
    await act(async () => {
      fireEvent.click(joinButton());
    });
    await openSeven();
    await act(async () => {
      fireEvent.click(joinButton());
    });
    await act(async () => {
      feeAnswers[0]({ fee: '0.01' });
    });
    await act(async () => {
      fireEvent.click(await screen.findByText('accept fee'));
    });
    expect(window.sendMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      feeAnswers[1]({ fee: '0.01' });
    });
    const second = screen.queryByText('accept fee');
    if (second)
      await act(async () => {
        fireEvent.click(second);
      });
    expect(window.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the account is in the group by the time its confirmation is accepted', async () => {
    window.sendMessage = vi.fn(async () => ({ signature: 'joined' })) as never;
    const store = renderWithTasks();
    await openSeven();
    await act(async () => {
      fireEvent.click(joinButton());
    });
    const accept = await screen.findByText('accept fee');
    // Joined meanwhile some other way (Find groups, an invite).
    act(() => {
      store.set(memberGroupsAtom, [{ groupId: 7 }] as never);
    });
    await act(async () => {
      fireEvent.click(accept);
    });

    expect(window.sendMessage).not.toHaveBeenCalled();
    expect(store.get(txListAtom)).toEqual([]);
  });

  it("calls a join being sent 'awaiting confirmation' on Hub's task list, not a success", async () => {
    window.sendMessage = vi.fn(() => new Promise(() => {})) as never;
    const store = renderWithTasks();
    await openSeven();
    await joinAndAcceptFee();

    expect(store.get(txListAtom)).toEqual([
      expect.objectContaining({
        type: 'joining-group',
        label: 'message.success.group_join_name',
      }),
    ]);
  });

  it("replaces a closed group's record with the request that was sent", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ groupId: 7, groupName: 'Seven', isOpen: false })
        )
    ) as unknown as typeof fetch;
    let answer!: (response: unknown) => void;
    window.sendMessage = vi.fn(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    ) as never;
    const store = renderWithTasks();
    await openSeven();
    await joinAndAcceptFee();
    expect(store.get(txListAtom)).toEqual([
      expect.objectContaining({ type: 'joining-group', groupId: 7 }),
    ]);

    await act(async () => {
      answer({ signature: 'seven' });
    });
    expect(store.get(txListAtom)).toEqual([
      expect.objectContaining({
        type: 'joined-group-request',
        groupId: 7,
        signature: 'seven',
      }),
    ]);
  });

  it('sends no second join while the first is still being sent, and says it is on its way', async () => {
    // The node hasn't answered the first join yet.
    window.sendMessage = vi.fn(() => new Promise(() => {})) as never;
    renderWithTasks();
    await openSeven();
    await joinAndAcceptFee();
    expect(window.sendMessage).toHaveBeenCalledTimes(1);

    // The same link, clicked again.
    await openSeven();
    expect(joinButton()).toBeDisabled();
    expect(joinButton()).toHaveTextContent('find_groups.action_pending');
    await joinAndAcceptFee();
    expect(window.sendMessage).toHaveBeenCalledTimes(1);
  });

  it.each(['joined-group', 'joined-group-request'])(
    "sends no second join while Hub's %s record of the first isn't done",
    async (type) => {
      window.sendMessage = vi.fn(async () => ({
        signature: 'second',
      })) as never;
      renderWithTasks([{ type, groupId: 7, done: false, signature: 'first' }]);
      await openSeven();
      expect(joinButton()).toBeDisabled();
      expect(joinButton()).toHaveTextContent('find_groups.action_pending');
      await joinAndAcceptFee();
      expect(window.sendMessage).not.toHaveBeenCalled();
    }
  );

  it('joins again once that record is done', async () => {
    window.sendMessage = vi.fn(async () => ({ signature: 'second' })) as never;
    renderWithTasks([
      { type: 'joined-group', groupId: 7, done: true, signature: 'first' },
    ]);
    await openSeven();
    expect(joinButton()).not.toBeDisabled();
    expect(joinButton()).toHaveTextContent('action.join');
    await joinAndAcceptFee();
    expect(window.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("has the join on Hub's task list from the moment the fee is accepted; the join sent takes its place", async () => {
    let answer!: (response: unknown) => void;
    window.sendMessage = vi.fn(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    ) as never;
    const store = renderWithTasks();
    await openSeven();
    await joinAndAcceptFee();
    expect(store.get(txListAtom)).toEqual([
      expect.objectContaining({
        type: 'joining-group',
        groupId: 7,
        done: false,
      }),
    ]);
    await act(async () => {
      answer({ signature: 'joinsignature' });
    });
    expect(store.get(txListAtom)).toEqual([
      expect.objectContaining({
        type: 'joined-group',
        groupId: 7,
        done: false,
        signature: 'joinsignature',
      }),
    ]);
  });

  it("takes a join that wasn't sent off Hub's task list, so it can be tried again", async () => {
    window.sendMessage = vi.fn(async () => ({ error: 'refused' })) as never;
    const store = renderWithTasks();
    await openSeven();
    await joinAndAcceptFee();
    await waitFor(() => expect(store.get(txListAtom)).toEqual([]));
    await openSeven();
    expect(joinButton()).not.toBeDisabled();
  });
});

describe('the join window, from the keyboard and for screen readers', () => {
  const opener = () => (
    <button
      type="button"
      onClick={() => executeEvent('globalActionJoinGroup', { groupId: '7' })}
    >
      open seven
    </button>
  );

  const renderWithOpener = () => {
    const store = createStore();
    store.set(memberGroupsAtom, [] as never);
    render(
      <Provider store={store}>
        <ThemeProvider theme={lightTheme}>
          <I18nextProvider i18n={i18n}>
            <FeeDialog>
              {opener()}
              <JoinGroup />
            </FeeDialog>
          </I18nextProvider>
        </ThemeProvider>
      </Provider>
    );
  };

  let group: object | null;

  beforeEach(() => {
    group = {
      groupId: 7,
      groupName: 'Seven',
      isOpen: true,
      memberCount: 3,
      description: 'A group of seven',
    };
    global.fetch = vi.fn(async () =>
      group
        ? new Response(JSON.stringify(group))
        : new Response(JSON.stringify({ error: 1101 }), { status: 404 })
    ) as unknown as typeof fetch;
  });

  it('closes with Escape, back onto what opened it', async () => {
    const user = userEvent.setup();
    renderWithOpener();
    await user.click(screen.getByText('open seven'));
    await screen.findByText(/Seven/);
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    expect(screen.getByText('open seven')).toHaveFocus();
  });

  it('has a Close button that Tab reaches', async () => {
    const user = userEvent.setup();
    renderWithOpener();
    await user.click(screen.getByText('open seven'));
    await screen.findByText(/Seven/);
    const reached = new Set<string>();
    for (let step = 0; step < 4; step++) {
      await user.tab();
      reached.add((document.activeElement?.textContent ?? '').trim());
    }
    expect(
      screen.getByRole('button', { name: 'action.close' })
    ).toBeInTheDocument();
    expect([...reached]).toContain('action.close');
  });

  it("closes with Close or Escape when the node doesn't know the group", async () => {
    const user = userEvent.setup();
    group = null;
    renderWithOpener();
    await user.click(screen.getByText('open seven'));
    await screen.findByText('message.error.no_group_found');
    fireEvent.click(screen.getByRole('button', { name: 'action.close' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    await user.click(screen.getByText('open seven'));
    await screen.findByText('message.error.no_group_found');
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
  });

  it('is named after its group, and described by its description', async () => {
    const user = userEvent.setup();
    renderWithOpener();
    await user.click(screen.getByText('open seven'));
    await screen.findByText(/Seven/);
    const dialog = screen.getByRole('dialog', { name: /Seven/ });
    expect(dialog).toHaveAccessibleDescription('A group of seven');
  });

  it('is named "loading" while its group is read, then after its group', async () => {
    const user = userEvent.setup();
    let answer!: (response: Response) => void;
    global.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        })
    ) as unknown as typeof fetch;
    renderWithOpener();
    await user.click(screen.getByText('open seven'));
    expect(
      await screen.findByRole('dialog', { name: 'loading.generic' })
    ).toBeInTheDocument();

    await act(async () => {
      answer(new Response(JSON.stringify(group)));
    });
    expect(
      await screen.findByRole('dialog', { name: /Seven/ })
    ).toBeInTheDocument();
  });

  it("is named after what went wrong when the node doesn't know the group", async () => {
    const user = userEvent.setup();
    group = null;
    renderWithOpener();
    await user.click(screen.getByText('open seven'));
    await screen.findByText('message.error.no_group_found');
    expect(
      screen.getByRole('dialog', { name: 'message.error.no_group_found' })
    ).toBeInTheDocument();
  });
});

describe('a join belongs to the account that pressed Join', () => {
  const seven = { groupId: 7, groupName: 'Seven', isOpen: true };
  const FIRST = `Q${'F'.repeat(33)}`;
  const NEXT = `Q${'N'.repeat(33)}`;
  type Store = ReturnType<typeof createStore>;

  // Stands in for App's signed-in state: the join window is mounted from
  // unlock on, before the account info may have come from the node.
  const signedInAtom = atom(true);
  const Mounted = () => (useAtomValue(signedInAtom) ? <JoinGroup /> : null);

  /**
   * Unlocked as FIRST (App sets the wallet at unlock); its account info is
   * in, or not yet (`info` false). Hub's fee confirmation is always there.
   */
  const renderHub = (info = true) => {
    const store = createStore();
    store.set(memberGroupsAtom, [] as never);
    store.set(rawWalletAtom, { address0: FIRST } as never);
    store.set(userInfoAtom, (info ? { address: FIRST } : null) as never);
    store.set(signedInAtom, true);
    render(
      <Provider store={store}>
        <ThemeProvider theme={lightTheme}>
          <I18nextProvider i18n={i18n}>
            <FeeDialog>
              <Mounted />
            </FeeDialog>
          </I18nextProvider>
        </ThemeProvider>
      </Provider>
    );
    return store;
  };

  /** Sign-out as App does it: the window goes, the lists are emptied. */
  const signOut = (store: Store) =>
    act(() => {
      store.set(signedInAtom, false);
      store.set(rawWalletAtom, null as never);
      store.set(userInfoAtom, null as never);
      store.set(txListAtom, [] as never);
      store.set(memberGroupsAtom, [] as never);
    });

  /** Unlocked as `wallet`, with its account info. */
  const signIn = (store: Store, wallet: string) =>
    act(() => {
      store.set(rawWalletAtom, { address0: wallet } as never);
      store.set(userInfoAtom, { address: wallet } as never);
      store.set(signedInAtom, true);
    });

  const openSevenAndJoin = async () => {
    await act(async () => {
      await openQortalLink('qortal://use-group/action-join/groupid-7');
    });
    expect(await screen.findByText(/Seven/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog')).getAllByRole('button')[0]
      );
    });
  };

  const types = (store: Store) =>
    (store.get(txListAtom) as { type: string }[]).map((record) => record.type);

  let feeAnswer: (fee: object) => void;
  const answerFee = () =>
    act(async () => {
      feeAnswer({ fee: '0.01' });
    });
  const accept = async () => {
    const button = await screen.findByText('accept fee');
    await act(async () => {
      fireEvent.click(button);
    });
  };

  /** The node's answers to the joins sent, one by one. */
  let sendAnswers: ((response: unknown) => void)[];

  beforeEach(() => {
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify(seven))
    ) as unknown as typeof fetch;
    vi.mocked(getFee).mockReset();
    vi.mocked(getFee).mockImplementation(
      () =>
        new Promise((resolve) => {
          feeAnswer = resolve;
        }) as never
    );
    sendAnswers = [];
    window.sendMessage = vi.fn(
      () =>
        new Promise((resolve) => {
          sendAnswers.push(resolve);
        })
    ) as never;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete window.sendMessage;
    vi.restoreAllMocks();
  });

  it('joins for the account that pressed Join while it stays signed in', async () => {
    const store = renderHub();
    await openSevenAndJoin();
    await answerFee();
    await accept();
    expect(window.sendMessage).toHaveBeenCalledWith('joinGroup', {
      groupId: 7,
    });
    await act(async () => {
      sendAnswers[0]({ signature: 'joinsignature' });
    });

    expect(types(store)).toEqual(['joined-group']);
  });

  it('asks nothing when another account is signed in by the time the fee is known', async () => {
    const store = renderHub();
    await openSevenAndJoin();
    act(() => {
      store.set(rawWalletAtom, { address0: NEXT } as never);
      store.set(userInfoAtom, { address: NEXT } as never);
    });
    await answerFee();

    expect(screen.queryByText('accept fee')).not.toBeInTheDocument();
    expect(window.sendMessage).not.toHaveBeenCalled();
  });

  it('asks nothing once its window has gone, even for the same account signed in again', async () => {
    const store = renderHub();
    await openSevenAndJoin();
    signOut(store);
    signIn(store, FIRST);
    await answerFee();

    expect(screen.queryByText('accept fee')).not.toBeInTheDocument();
    expect(window.sendMessage).not.toHaveBeenCalled();
  });

  it('sends nothing when its confirmation is accepted after sign-out and another account signed in', async () => {
    const store = renderHub();
    await openSevenAndJoin();
    await answerFee();
    const button = await screen.findByText('accept fee');
    signOut(store);
    signIn(store, NEXT);
    await act(async () => {
      fireEvent.click(button);
    });

    expect(window.sendMessage).not.toHaveBeenCalled();
    expect(types(store)).toEqual([]);
  });

  it("keeps the join off the next account's task list when the node answers after sign-out", async () => {
    const store = renderHub();
    await openSevenAndJoin();
    await answerFee();
    await accept();
    expect(window.sendMessage).toHaveBeenCalledTimes(1);
    signOut(store);
    signIn(store, NEXT);
    await act(async () => {
      sendAnswers[0]({ signature: 'joinsignature' });
    });

    expect(types(store)).toEqual([]);
  });

  it("joins when the account's info arrives while its confirmation is up", async () => {
    // Unlocked, but the node hasn't answered the account info yet.
    const store = renderHub(false);
    await openSevenAndJoin();
    await answerFee();
    const button = await screen.findByText('accept fee');
    act(() => {
      store.set(userInfoAtom, { address: FIRST } as never);
    });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(window.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("replaces its record when the account's info arrives while the join is sent", async () => {
    const store = renderHub(false);
    await openSevenAndJoin();
    await answerFee();
    await accept();
    act(() => {
      store.set(userInfoAtom, { address: FIRST } as never);
    });
    await act(async () => {
      sendAnswers[0]({ signature: 'joinsignature' });
    });

    expect(types(store)).toEqual(['joined-group']);
  });

  it("takes its record off when the account changes without Hub's lists being emptied", async () => {
    // Hub empties its lists at sign-out only when the background answers
    // the logout; here it didn't.
    const store = renderHub();
    await openSevenAndJoin();
    await answerFee();
    await accept();
    act(() => {
      store.set(signedInAtom, false);
      store.set(rawWalletAtom, { address0: NEXT } as never);
      store.set(userInfoAtom, { address: NEXT } as never);
      store.set(signedInAtom, true);
    });
    await act(async () => {
      sendAnswers[0]({ signature: 'joinsignature' });
    });

    expect(types(store)).toEqual([]);
  });
});
