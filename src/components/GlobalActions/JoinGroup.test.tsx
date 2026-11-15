import { createContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';
import i18n from 'i18next';
import { I18nextProvider } from 'react-i18next';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node',
  QORTAL_APP_CONTEXT: createContext({ show: vi.fn() }),
}));
vi.mock('../../background/background.ts', () => ({ getFee: vi.fn() }));

import { memberGroupsAtom } from '../../atoms/global';
import { lightTheme } from '../../styles/theme-light';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { JoinGroup } from './JoinGroup';

i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { core: {} } } });

const renderJoinGroup = (memberGroups: { groupId: number }[]) => {
  const store = createStore();
  store.set(memberGroupsAtom, memberGroups as never);
  render(
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <I18nextProvider i18n={i18n}>
          <JoinGroup />
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
