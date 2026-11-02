import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dialog } from '@mui/material';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  latest: vi.fn(),
  all: vi.fn(),
  decrypt: vi.fn(),
  decode: vi.fn(),
  fee: vi.fn(),
  show: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  send: vi.fn(),
  fetch: vi.fn(),
  t: (key: string) => key,
}));
vi.mock('../../App', async () => ({
  QORTAL_APP_CONTEXT: (await import('react')).createContext(null),
  getBaseApiReact: () => 'https://core.test',
  getArbitrarySearchSimpleEndpointReact: () =>
    '/arbitrary/resources/searchsimple',
  pauseAllQueues: mocks.pause,
  resumeAllQueues: mocks.resume,
}));
vi.mock('../Group/groupApi', () => ({
  getPublishesFromAdmins: mocks.latest,
  getAllPublishesFromAdmins: mocks.all,
}));
vi.mock('../Group/groupDataPublishes', () => ({
  decryptResource: mocks.decrypt,
}));
vi.mock('../../background/background', () => ({ getFee: mocks.fee }));
vi.mock('../../encryption/encryption', () => ({
  uint8ArrayToObject: mocks.decode,
}));
vi.mock('../../qdn/encryption/group-encryption', () => ({
  base64ToUint8Array: () => new Uint8Array(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));

import { QORTAL_APP_CONTEXT } from '../../App';
import { infoSnackGlobalAtom, txListAtom } from '../../atoms/global';
import { AdminSpaceInner } from './AdminSpaceInner';
import { useAdminPopoverDismiss } from './useAdminPopoverDismiss';
import { useModal } from '../../hooks/useModal';

const admins = [{ name: 'Alice+', address: 'admin-address' }];
const history = { '1': { messageKey: 'test-message-key' } };
const publish = {
  name: 'Alice+',
  identifier: 'symmetric-qchat-group-42',
  created: 1,
};

function SecurityPopover({ children }) {
  const [open, setOpen] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const modal = useModal();
  useEffect(() => {
    mocks.show.mockImplementation(modal.show);
  }, [modal.show]);
  useAdminPopoverDismiss({
    open,
    anchor: null,
    panelRef,
    onClose: close,
  });
  return (
    <>
      {open && <div ref={panelRef}>{children}</div>}
      <Dialog open={modal.isShow} onClose={modal.onCancel}>
        <Button onClick={() => modal.onOk(undefined)}>Accept fee</Button>
        <Button onClick={modal.onCancel}>Decline fee</Button>
      </Dialog>
    </>
  );
}

function setup({
  owner = false,
  group = 42,
  adminList = admins,
  popover = false,
} = {}) {
  const store = createStore();
  const view = (groupId: number, nextAdmins = adminList, nextOwner = owner) => (
    <Provider store={store}>
      <QORTAL_APP_CONTEXT.Provider value={{ show: mocks.show } as any}>
        {popover ? (
          <SecurityPopover>
            <AdminSpaceInner
              selectedGroup={groupId}
              adminsWithNames={nextAdmins}
              isOwner={nextOwner}
              compact
            />
          </SecurityPopover>
        ) : (
          <AdminSpaceInner
            key={groupId}
            selectedGroup={groupId}
            adminsWithNames={nextAdmins}
            isOwner={nextOwner}
            compact
          />
        )}
      </QORTAL_APP_CONTEXT.Provider>
    </Provider>
  );
  const result = render(view(group));
  return {
    ...result,
    store,
    switchGroup: (next: number) => result.rerender(view(next)),
    switchAdmins: (next: typeof admins) => result.rerender(view(group, next)),
    switchOwner: (next: boolean) =>
      result.rerender(view(group, adminList, next)),
  };
}
async function createGroupKey() {
  const button = await screen.findByRole('button', {
    name: 'group:admin_space.create_gsk',
  });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  expect(
    screen.queryByText('auth:message.generic.select_publish_to_update_from')
  ).not.toBeInTheDocument();
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'core:action.confirm',
    })
  );
}
async function selectExisting() {
  const button = await screen.findByRole('button', {
    name: 'group:admin_space.publish_gsk',
  });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  fireEvent.click(
    await screen.findByText('auth:message.generic.last_encryption_date', {
      selector: '.MuiListItemText-primary',
    })
  );
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'core:action.publish',
    })
  );
}
async function confirmExisting() {
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'core:action.confirm',
    })
  );
  await waitFor(() => expect(mocks.resume).toHaveBeenCalledOnce());
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.latest.mockReset().mockResolvedValue(false);
  mocks.all.mockReset().mockResolvedValue([]);
  mocks.decrypt.mockReset().mockResolvedValue({ data: 'encrypted-history' });
  mocks.decode.mockReset().mockReturnValue(history);
  mocks.fee.mockReset().mockResolvedValue({ fee: 0.01 });
  mocks.show.mockReset().mockResolvedValue(undefined);
  mocks.send.mockReset().mockResolvedValue({ signature: 'key-publication' });
  mocks.fetch.mockReset().mockImplementation(async () => ({
    ok: true,
    json: async () => [],
    text: async () => 'encrypted-key',
  }));
  vi.stubGlobal('fetch', mocks.fetch);
  vi.stubGlobal('sendMessage', mocks.send);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Security panel key publishing', () => {
  it.each(['group', 'admin', 'republish'])(
    'keeps the security panel mounted through %s key confirmation and fee approval',
    async (keyType) => {
      const user = userEvent.setup();
      if (keyType === 'republish') {
        mocks.latest.mockResolvedValue(publish);
        mocks.all.mockResolvedValue([publish]);
      }
      const { store } = setup({ popover: true });
      const create = await screen.findByRole('button', {
        name:
          keyType === 'republish'
            ? 'group:admin_space.publish_gsk'
            : `group:admin_space.create_${keyType === 'group' ? 'gsk' : 'ask'}`,
      });
      await waitFor(() => expect(create).toBeEnabled());
      await user.click(create);
      if (keyType === 'republish') {
        await user.click(
          await screen.findByText('auth:message.generic.last_encryption_date', {
            selector: '.MuiListItemText-primary',
          })
        );
        await user.click(
          screen.getByRole('button', { name: 'core:action.publish' })
        );
      }
      if (keyType !== 'admin') {
        await user.click(
          screen.getByRole('button', { name: 'core:action.confirm' })
        );
      }
      await user.click(
        await screen.findByRole('button', { name: 'Accept fee' })
      );
      await waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
      expect(store.get(txListAtom)).toEqual([
        expect.objectContaining({
          keyType: keyType === 'admin' ? 'admin' : 'group',
          groupId: 42,
        }),
      ]);
      expect(store.get(infoSnackGlobalAtom)?.type).toBe('success');
      expect(mocks.resume).toHaveBeenCalledOnce();
      expect(create).toBeInTheDocument();
      await user.click(document.body);
      expect(create).not.toBeInTheDocument();
    }
  );

  it('dismissing the fee dialog keeps the security panel mounted without publishing', async () => {
    const user = userEvent.setup();
    const { store } = setup({ popover: true });
    const create = await screen.findByRole('button', {
      name: 'group:admin_space.create_ask',
    });
    await waitFor(() => expect(create).toBeEnabled());
    await user.click(create);
    const decline = await screen.findByRole('button', { name: 'Decline fee' });
    await user.click(
      decline.closest('.MuiDialog-root').querySelector('.MuiBackdrop-root')
    );
    await waitFor(() => expect(create).toBeEnabled());
    expect(create).toBeInTheDocument();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.pause).not.toHaveBeenCalled();
    expect(store.get(infoSnackGlobalAtom)).toBeNull();
  });

  it('does not publish to an outdated admin list after confirmation', async () => {
    let approve: () => void;
    mocks.show.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          approve = resolve;
        })
    );
    const { switchAdmins } = setup();
    await createGroupKey();
    await waitFor(() => expect(mocks.show).toHaveBeenCalledOnce());
    switchAdmins([{ name: 'Bob', address: 'new-admin-address' }]);
    await act(async () => approve());
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'group:admin_space.create_gsk' })
      ).toBeEnabled()
    );
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.pause).not.toHaveBeenCalled();
  });

  it('does not add a key if ownership changes during confirmation', async () => {
    let approve: () => void;
    mocks.show.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          approve = resolve;
        })
    );
    mocks.latest.mockResolvedValue(publish);
    mocks.all.mockResolvedValue([publish]);
    const { switchOwner } = setup({ owner: true });
    await selectExisting();
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'group:message.generic.add_new_key_option',
      })
    );
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'core:action.confirm',
      })
    );
    await waitFor(() => expect(mocks.show).toHaveBeenCalledOnce());
    switchOwner(false);
    await act(async () => approve());
    await waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith(
        'encryptAndPublishSymmetricKeyGroupChat',
        expect.objectContaining({
          previousData: history,
          isOwner: false,
          addKey: false,
        })
      )
    );
  });
  it('does not search all publishers or allow creation while admin identity is unavailable', async () => {
    setup({ adminList: [] });
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: 'core:retry' })
      ).toHaveLength(2)
    );
    expect(mocks.latest).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'group:admin_space.publish_gsk' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'group:admin_space.create_ask' })
    ).toBeDisabled();
  });

  it('preserves the existing admin key history when updating its publication', async () => {
    const adminPublish = {
      ...publish,
      identifier: 'admins-symmetric-qchat-group-42',
    };
    mocks.fetch.mockImplementation(async () => ({
      ok: true,
      json: async () => [adminPublish],
      text: async () => 'encrypted-key',
    }));
    setup();
    const button = await screen.findByRole('button', {
      name: 'group:admin_space.publish_ask',
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith(
        'encryptAndPublishSymmetricKeyGroupChatForAdmins',
        { groupId: 42, previousData: history, admins }
      )
    );
    expect(mocks.resume).toHaveBeenCalledOnce();
  });

  it('blocks admin-key creation if an existing admin key cannot be decrypted', async () => {
    const adminPublish = {
      ...publish,
      identifier: 'admins-symmetric-qchat-group-42',
    };
    mocks.fetch.mockImplementation(async () => ({
      ok: true,
      json: async () => [adminPublish],
      text: async () => 'encrypted-key',
    }));
    mocks.decrypt.mockRejectedValue(new Error('decryption failed'));
    setup();
    await screen.findByRole('button', { name: 'core:retry' });
    expect(
      screen.getByRole('button', { name: 'group:admin_space.create_ask' })
    ).toBeDisabled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('creates the first group key after confirmation, without an empty publication selector', async () => {
    const { store } = setup();
    await createGroupKey();
    await waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith(
        'encryptAndPublishSymmetricKeyGroupChat',
        {
          groupId: 42,
          previousData: null,
          isOwner: false,
          addKey: false,
        }
      )
    );
    expect(mocks.latest).toHaveBeenCalledTimes(2);
    expect(mocks.show).toHaveBeenCalledWith(
      expect.objectContaining({ publishFee: '0.01 QORT' })
    );
    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(mocks.resume).toHaveBeenCalledOnce();
    expect(store.get(txListAtom)[0]).toMatchObject({
      groupId: 42,
      signature: 'key-publication',
      keyType: 'group',
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'group:admin_space.create_gsk' })
      ).toBeDisabled()
    );
  });

  it('preserves history if another admin publishes while the creation dialog is open', async () => {
    mocks.latest.mockResolvedValueOnce(false).mockResolvedValue(publish);
    setup();
    await createGroupKey();
    await waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith(
        'encryptAndPublishSymmetricKeyGroupChat',
        expect.objectContaining({ previousData: history, addKey: false })
      )
    );
    expect(mocks.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/Alice%2B/symmetric-qchat-group-42?')
    );
  });

  it.each([false, true])(
    'republishes existing history without adding a key by default (owner=%s)',
    async (owner) => {
      mocks.latest.mockResolvedValue(publish);
      mocks.all.mockResolvedValue([publish]);
      setup({ owner });
      await selectExisting();
      if (!owner)
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      await confirmExisting();
      expect(mocks.send).toHaveBeenCalledWith(
        'encryptAndPublishSymmetricKeyGroupChat',
        { groupId: 42, previousData: history, isOwner: owner, addKey: false }
      );
    }
  );

  it('lets the owner explicitly add a new key while preserving existing history', async () => {
    mocks.latest.mockResolvedValue(publish);
    mocks.all.mockResolvedValue([publish]);
    setup({ owner: true });
    await selectExisting();
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'group:message.generic.add_new_key_option',
      })
    );
    await confirmExisting();
    expect(mocks.send).toHaveBeenCalledWith(
      'encryptAndPublishSymmetricKeyGroupChat',
      { groupId: 42, previousData: history, isOwner: true, addKey: true }
    );
  });

  it('offers creation if the previously existing publication list becomes empty', async () => {
    mocks.latest.mockResolvedValueOnce(publish).mockResolvedValue(false);
    setup();
    const button = await screen.findByRole('button', {
      name: 'group:admin_space.publish_gsk',
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await screen.findByText('group:admin_space.create_gsk_confirm');
    await waitFor(() =>
      expect(
        screen.queryByText('auth:message.generic.select_publish_to_update_from')
      ).not.toBeInTheDocument()
    );
  });

  it('blocks creation when the key lookup fails, and allows retrying it', async () => {
    mocks.latest
      .mockRejectedValueOnce(new Error('lookup failed'))
      .mockResolvedValue(false);
    const { store } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'core:retry' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'group:admin_space.create_gsk' })
      ).toBeEnabled()
    );
    expect(mocks.send).not.toHaveBeenCalled();
    expect(store.get(infoSnackGlobalAtom)).toMatchObject({
      type: 'error',
      message: 'lookup failed',
    });
  });

  it('does not treat a failed publication-list request as permission to create a new key', async () => {
    mocks.latest.mockResolvedValue(publish);
    mocks.all.mockRejectedValue(new Error('list failed'));
    setup();
    const button = await screen.findByRole('button', {
      name: 'group:admin_space.publish_gsk',
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await screen.findByText('core:message.error.network_generic');
    expect(
      screen.queryByText('group:admin_space.create_gsk_confirm')
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'core:action.publish',
      })
    ).toBeDisabled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each(['decrypt', 'empty-history', 'publish'])(
    'reports %s failure, restores queues and never records a successful key',
    async (failure) => {
      mocks.latest.mockResolvedValue(publish);
      mocks.all.mockResolvedValue([publish]);
      if (failure === 'decrypt')
        mocks.decrypt.mockRejectedValue(new Error('decryption failed'));
      if (failure === 'empty-history') mocks.decode.mockReturnValue({});
      if (failure === 'publish')
        mocks.send.mockResolvedValue({ error: 'publish failed' });
      const { store } = setup();
      await selectExisting();
      await confirmExisting();
      expect(store.get(txListAtom)).toHaveLength(0);
      expect(store.get(infoSnackGlobalAtom)).toMatchObject({ type: 'error' });
      if (failure !== 'publish') expect(mocks.send).not.toHaveBeenCalled();
    }
  );

  it('prevents duplicate confirmation while the fee dialog is pending', async () => {
    let approve: () => void;
    mocks.show.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          approve = resolve;
        })
    );
    setup();
    await createGroupKey();
    await waitFor(() => expect(mocks.show).toHaveBeenCalledOnce());
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'core:action.confirm',
      })
    );
    await act(async () => approve());
    await waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    expect(mocks.fee).toHaveBeenCalledOnce();
  });

  it('cancelling fee confirmation neither publishes nor pauses queues', async () => {
    mocks.show.mockRejectedValue(new Error('cancelled'));
    const { store } = setup();
    await createGroupKey();
    await waitFor(() => expect(mocks.show).toHaveBeenCalledOnce());
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.pause).not.toHaveBeenCalled();
    expect(mocks.resume).not.toHaveBeenCalled();
    expect(store.get(txListAtom)).toHaveLength(0);
  });

  it('does not publish into the previously selected group after switching groups during confirmation', async () => {
    let approve: () => void;
    mocks.show.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          approve = resolve;
        })
    );
    const { switchGroup } = setup();
    await createGroupKey();
    await waitFor(() => expect(mocks.show).toHaveBeenCalledOnce());
    switchGroup(43);
    await act(async () => approve());
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'group:admin_space.create_gsk' })
      ).toBeEnabled()
    );
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('creates the first admin key with the existing encrypted publishing API', async () => {
    const { store } = setup();
    const button = await screen.findByRole('button', {
      name: 'group:admin_space.create_ask',
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith(
        'encryptAndPublishSymmetricKeyGroupChatForAdmins',
        { groupId: 42, previousData: null, admins }
      )
    );
    expect(mocks.fetch).toHaveBeenCalledWith(
      expect.stringContaining('name=Alice%2B')
    );
    expect(store.get(txListAtom)[0]).toMatchObject({
      keyType: 'admin',
      groupId: 42,
    });
    expect(mocks.resume).toHaveBeenCalledOnce();
  });
});
