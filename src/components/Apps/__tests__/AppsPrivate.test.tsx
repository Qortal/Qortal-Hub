import React, { createContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { Provider, createStore } from 'jotai';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

const { getGroupAdminsAddress, openApp } = vi.hoisted(() => ({
  getGroupAdminsAddress: vi.fn(),
  openApp: vi.fn(async () => true),
}));

// The key, with the values it was given, so a test can see both.
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const values = Object.entries(options ?? {})
        .filter(([name]) => name !== 'postProcess')
        .map(([name, value]) => `${name}=${value}`);
      return [key, ...values].join(' ');
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://node',
  QORTAL_APP_CONTEXT: createContext({ show: vi.fn() }),
}));

vi.mock('../../../hooks/useHandlePrivateApps', () => ({
  useHandlePrivateApps: () => ({ openApp }),
}));

vi.mock('../../Group/groupApi', () => ({ getGroupAdminsAddress }));

vi.mock('../../../background/background.ts', () => ({
  getFee: vi.fn().mockResolvedValue({ fee: '0.01' }),
}));

vi.mock('react-dropzone', () => ({
  useDropzone: () => ({
    getRootProps: () => ({}),
    getInputProps: () => ({}),
  }),
}));

import { AppsPrivate } from '../AppsPrivate';
import {
  memberGroupsAtom,
  myGroupsWhereIAmAdminAtom,
} from '../../../atoms/global';
import { installPublishBridges } from '../../../test/mocks/publishBridges';

const MY_ADDRESS = 'Qme';
const FOLDER = '/home/dev/q-notes/dist';
const LAST_READ = Date.UTC(2026, 10, 2, 12);
const SIGNATURE = '7'.repeat(88);
const LOGO_BYTES = [137, 80, 78, 71, 13, 10, 26, 10];
const LOGO = btoa(String.fromCharCode(...LOGO_BYTES));

const target = {
  name: 'alice',
  service: 'DOCUMENT',
  identifier: 'q-notes',
  groupId: 42,
  timestamp: null,
};
const profileKey = {
  address: MY_ADDRESS,
  service: 'DOCUMENT',
  name: 'alice',
  identifier: 'q-notes',
};

const decryptedCurrent = btoa(
  JSON.stringify({ app: 'UEsDBA==', logo: LOGO, name: 'Q-Notes' })
);

describe('AppsPrivate – Update', () => {
  let bridges: ReturnType<typeof installPublishBridges>;
  let sendMessage: ReturnType<typeof vi.fn>;
  const onClose = vi.fn();
  const onPublished = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    bridges = installPublishBridges();
    getGroupAdminsAddress.mockResolvedValue([MY_ADDRESS]);
    sendMessage = vi.fn(async (action: string) => {
      if (action === 'DECRYPT_QORTAL_GROUP_DATA') return decryptedCurrent;
      if (action === 'ENCRYPT_QORTAL_GROUP_DATA') return 'ENCRYPTED_NEW';
      if (action === 'publishOnQDN') return { signature: SIGNATURE };
      return undefined;
    });
    window.sendMessage = sendMessage as unknown as typeof window.sendMessage;
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/names/address/')) {
        return { ok: true, json: async () => [{ name: 'alice' }] };
      }
      if (
        url === 'http://node/arbitrary/DOCUMENT/alice/q-notes?encoding=base64'
      ) {
        return { ok: true, text: async () => 'ENCRYPTED_CURRENT' };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    bridges.uninstall();
    delete window.sendMessage;
  });

  const renderDialog = ({
    adminGroups = [{ groupId: 42, groupName: 'Builders' }],
  } = {}) => {
    const store = createStore();
    store.set(myGroupsWhereIAmAdminAtom, adminGroups);
    store.set(memberGroupsAtom, [{ groupId: 42, groupName: 'Builders' }]);
    const ui = (isShown: boolean) => (
      <Provider store={store}>
        <ThemeProvider theme={createTheme()}>
          <AppsPrivate
            action="update"
            isShown={isShown}
            myAddress={MY_ADDRESS}
            myName="alice"
            onClose={onClose}
            onPublished={onPublished}
            updateTarget={target}
          />
        </ThemeProvider>
      </Provider>
    );
    const view = render(ui(true));
    return {
      ...view,
      setShown: (isShown: boolean) => view.rerender(ui(isShown)),
    };
  };

  const field = (name: string) => screen.getByRole('textbox', { name });
  const publishButton = () =>
    screen.getByRole('button', { name: 'core:action.publish' });

  it('opens with the app name and logo of the published version, the identifier locked and the group fixed', async () => {
    renderDialog();

    await waitFor(() => expect(field('core:app_name')).toHaveValue('Q-Notes'));
    expect(sendMessage).toHaveBeenCalledWith('DECRYPT_QORTAL_GROUP_DATA', {
      base64: 'ENCRYPTED_CURRENT',
      groupId: 42,
    });
    expect(
      screen.getByText('core:publish_update.title name=q-notes')
    ).toBeInTheDocument();
    expect(field('core:identifier')).toHaveValue('q-notes');
    expect(field('core:identifier')).toBeDisabled();
    expect(field('core:name')).toHaveValue('alice');
    expect(field('core:name')).toBeDisabled();
    expect(field('group:group.group')).toHaveValue('Builders');
    expect(field('group:group.group')).toBeDisabled();
    expect(
      screen.getByText('core:publish_update.logo_kept')
    ).toBeInTheDocument();
    expect(
      await screen.findByText('core:publish_update.is_admin group=Builders')
    ).toBeInTheDocument();
    expect(getGroupAdminsAddress).toHaveBeenCalledWith(42);
  });

  it('says clearly when the account is no longer an admin, and keeps Publish off', async () => {
    const user = userEvent.setup();
    getGroupAdminsAddress.mockResolvedValue(['Qsomeone-else']);
    bridges.seed(profileKey, {
      source: { path: FOLDER, kind: 'folder', takenAt: LAST_READ },
    });
    bridges.electron.selectAndZipDirectory.mockResolvedValue({
      buffer: new Uint8Array([80, 75, 3, 4]),
      directoryPath: FOLDER,
      changedFiles: 0,
    });
    renderDialog();

    expect(
      await screen.findByText('core:publish_update.not_admin group=Builders')
    ).toBeInTheDocument();
    await user.click(
      await screen.findByText('core:publish_source.same_folder')
    );
    await screen.findByText('core:publish_source.selected_folder name=dist');
    await waitFor(() => expect(field('core:app_name')).toHaveValue('Q-Notes'));
    expect(publishButton()).toBeDisabled();
    expect(sendMessage).not.toHaveBeenCalledWith(
      'ENCRYPT_QORTAL_GROUP_DATA',
      expect.anything()
    );
  });

  it("uses the admin groups from sign-in when the node can't answer", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    getGroupAdminsAddress.mockRejectedValue(new Error('offline'));
    renderDialog();
    expect(
      await screen.findByText('core:publish_update.is_admin group=Builders')
    ).toBeInTheDocument();
  });

  it("says it couldn't check when neither the node nor sign-in can tell", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    getGroupAdminsAddress.mockRejectedValue(new Error('offline'));
    renderDialog({ adminGroups: [] });
    expect(
      await screen.findByText(
        'core:publish_update.admin_unknown group=Builders'
      )
    ).toBeInTheDocument();
    expect(publishButton()).toBeDisabled();
  });

  it("falls back to this PC's profile for the app name when the version can't be decrypted", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sendMessage.mockImplementation(async (action: string) =>
      action === 'DECRYPT_QORTAL_GROUP_DATA' ? { error: 'no key' } : undefined
    );
    bridges.seed(profileKey, {
      privateApp: { groupId: 42, appName: 'Saved name' },
    });
    renderDialog();

    expect(
      await screen.findByText('core:publish_update.current_unavailable')
    ).toBeInTheDocument();
    expect(field('core:app_name')).toHaveValue('Saved name');
    expect(
      screen.queryByText('core:publish_update.logo_kept')
    ).not.toBeInTheDocument();
  });

  it('publishes the update to the same resource and saves only the profile fields', async () => {
    const user = userEvent.setup();
    bridges.seed(profileKey, {
      source: { path: FOLDER, kind: 'folder', takenAt: LAST_READ },
      publishedAt: LAST_READ + 1000,
      privateApp: { groupId: 42, appName: 'Q-Notes' },
    });
    bridges.electron.selectAndZipDirectory.mockResolvedValue({
      buffer: new Uint8Array([80, 75, 3, 4]),
      directoryPath: FOLDER,
      changedFiles: 2,
    });
    renderDialog();
    await waitFor(() => expect(field('core:app_name')).toHaveValue('Q-Notes'));
    await screen.findByText('core:publish_update.is_admin group=Builders');

    await user.click(screen.getByText('core:publish_source.same_folder'));
    expect(bridges.electron.selectAndZipDirectory).toHaveBeenCalledWith(
      undefined,
      { defaultPath: FOLDER, changedSince: LAST_READ }
    );
    expect(
      await screen.findByText(
        /^core:publish_source\.changed_files date=.* number=2$/
      )
    ).toBeInTheDocument();
    await user.click(publishButton());

    await waitFor(() => expect(onPublished).toHaveBeenCalledTimes(1));
    const encrypt = sendMessage.mock.calls.find(
      ([action]) => action === 'ENCRYPT_QORTAL_GROUP_DATA'
    );
    expect(encrypt[1].groupId).toBe(42);
    const payload = JSON.parse(atob(encrypt[1].base64));
    expect(payload).toEqual({
      app: btoa(String.fromCharCode(80, 75, 3, 4)),
      logo: LOGO,
      name: 'Q-Notes',
    });
    expect(sendMessage).toHaveBeenCalledWith('publishOnQDN', {
      data: 'ENCRYPTED_NEW',
      identifier: 'q-notes',
      service: 'DOCUMENT',
      uploadType: 'base64',
      name: 'alice',
      description: 'qortal-hub-private-app;groupId=42',
    });

    expect(bridges.publishProfiles.merge).toHaveBeenCalledTimes(1);
    const [key, patch] = bridges.publishProfiles.merge.mock.calls[0];
    expect(key).toEqual(profileKey);
    expect(patch).toEqual({
      publishedAt: expect.any(Number),
      source: { path: FOLDER, kind: 'folder', takenAt: expect.any(Number) },
      privateApp: {
        groupId: 42,
        appName: 'Q-Notes',
        logoHash: bytesToHex(sha256(new Uint8Array(LOGO_BYTES))),
      },
      signature: SIGNATURE,
    });
    const saved = JSON.stringify(patch);
    expect(saved).not.toContain(LOGO);
    expect(saved).not.toContain('ENCRYPTED');
    expect(saved).not.toContain(btoa(String.fromCharCode(80, 75, 3, 4)));
    expect(openApp).toHaveBeenCalledWith(
      {
        identifier: 'q-notes',
        service: 'DOCUMENT',
        name: 'alice',
        groupId: 42,
      },
      true
    );
  });

  it('steps aside while its launcher tab is hidden, keeping what was entered', async () => {
    const user = userEvent.setup();
    const { setShown } = renderDialog();
    await waitFor(() => expect(field('core:app_name')).toHaveValue('Q-Notes'));
    await user.type(field('core:app_name'), ' 2');

    setShown(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    setShown(true);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(field('core:app_name')).toHaveValue('Q-Notes 2');
    expect(onClose).not.toHaveBeenCalled();
  });
});
