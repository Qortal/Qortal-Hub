import { createContext, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';
import i18n from 'i18next';
import { I18nextProvider } from 'react-i18next';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node',
  QORTAL_APP_CONTEXT: createContext({ show: vi.fn() }),
}));
vi.mock('../../background/background.ts', () => ({ getFee: vi.fn() }));

import { QORTAL_APP_CONTEXT } from '../../App';
import { memberGroupsAtom } from '../../atoms/global';
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
  { withFeeDialog = false, beside = null as ReactNode } = {}
) => {
  const store = createStore();
  store.set(memberGroupsAtom, memberGroups as never);
  render(
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <I18nextProvider i18n={i18n}>
          {withFeeDialog ? (
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
