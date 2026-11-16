import React, { createContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import enCore from '../../../i18n/locales/en/core.json';
import { capitalizeFirstChar } from '../../../i18n/processors';

// The strings this feature adds are real; the rest render as their keys.
i18n.use(capitalizeFirstChar as never).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: {
      core: {
        publish_source: enCore.publish_source,
        publish_update: enCore.publish_update,
        // The tag fields' names, once they come from this key (#386).
        tag_number: 'tag {{number}}',
      },
    },
  },
});

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
  QORTAL_APP_CONTEXT: createContext({ show: vi.fn() }),
}));

vi.mock('../../../utils/events', () => ({
  executeEvent: vi.fn(),
}));

vi.mock('react-dropzone', () => ({
  useDropzone: () => ({
    getRootProps: () => ({}),
    getInputProps: () => ({}),
  }),
}));

vi.mock('../../../background/background.ts', () => ({
  getFee: vi.fn().mockResolvedValue({ fee: '0.01' }),
}));

import { AppPublish } from '../AppPublish';
import { executeEvent } from '../../../utils/events';
import { installPublishBridges } from '../../../test/mocks/publishBridges';

const ADDRESS = 'Qowner';
const FOLDER = '/home/dev/test-app/dist';
const LAST_READ = Date.UTC(2026, 10, 2, 12);
const PUBLISHED = Date.UTC(2026, 10, 2, 13);
const SIGNATURE = '5'.repeat(88);

const appKey = { address: ADDRESS, service: 'APP', name: 'TestApp' };

const savedProfile = {
  source: { path: FOLDER, kind: 'folder', takenAt: LAST_READ },
  publishedAt: PUBLISHED,
  metadata: {
    title: 'Saved title',
    description: 'Saved description',
    category: 'tools',
    tags: ['saved'],
  },
};

type Metadata = Record<string, unknown> | null;

/** The node answers the names list, the app search and its metadata file. */
function mockNode({
  search = [
    {
      name: 'TestApp',
      service: 'APP',
      metadata: {
        title: 'Node title',
        description: 'Node description',
        category: 'games',
        tags: ['node'],
      },
    },
  ],
  metadata = null,
}: { search?: unknown; metadata?: Metadata } = {}) {
  global.fetch = vi.fn((url: string) => {
    const body = url.includes('/names/address/')
      ? [{ name: 'TestApp' }]
      : url.includes('/arbitrary/metadata/')
        ? metadata
        : search;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  }) as unknown as typeof fetch;
}

const renderForm = (props = {}) =>
  render(
    <ThemeProvider theme={createTheme()}>
      <I18nextProvider i18n={i18n}>
        <AppPublish
          categories={[
            { id: 'games', name: 'Games' },
            { id: 'tools', name: 'Tools' },
          ]}
          myAddress={ADDRESS}
          myName="TestApp"
          initialName="TestApp"
          initialAppType="APP"
          isAppTypeLocked
          isUpdate
          {...props}
        />
      </I18nextProvider>
    </ThemeProvider>
  );

const title = () => screen.getByRole('textbox', { name: 'Title' });

describe('AppPublish – Update and saved publish profiles', () => {
  let bridges: ReturnType<typeof installPublishBridges>;
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    bridges = installPublishBridges();
    sendMessage = vi.fn(async () => ({ signature: SIGNATURE }));
    window.sendMessage = sendMessage as unknown as typeof window.sendMessage;
  });

  afterEach(() => {
    bridges.uninstall();
    delete window.sendMessage;
  });

  it('opens filled in from the network, with the name locked', async () => {
    mockNode();
    renderForm();

    expect(screen.getByText('Update TestApp')).toBeInTheDocument();
    await waitFor(() => expect(title()).toHaveValue('Node title'));
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue(
      'Node description'
    );
    // MUI's Select: the name can't be changed in an update.
    const nameSelect = screen
      .getAllByRole('combobox')
      .find((element) => element.textContent === 'TestApp');
    expect(nameSelect).toHaveAttribute('aria-disabled', 'true');
    expect(bridges.publishProfiles.get).toHaveBeenCalledWith({
      ...appKey,
      identifier: 'default',
    });
  });

  it('keeps the name open in the normal publish form', async () => {
    mockNode();
    renderForm({ isUpdate: false });
    await waitFor(() => expect(title()).toHaveValue('Node title'));
    const nameSelect = screen
      .getAllByRole('combobox')
      .find((element) => element.textContent === 'TestApp');
    expect(nameSelect).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByText('Update TestApp')).not.toBeInTheDocument();
  });

  it("fills in this PC's last publish when the network has no details", async () => {
    bridges.seed(appKey, savedProfile);
    mockNode({ search: [{ name: 'TestApp', service: 'APP', metadata: null }] });
    renderForm();

    await waitFor(() => expect(title()).toHaveValue('Saved title'));
    expect(screen.getByRole('textbox', { name: 'Tag 1' })).toHaveValue('saved');
    expect(executeEvent).toHaveBeenCalledWith(
      'openGlobalSnackBar',
      expect.objectContaining({
        type: 'warning',
        message: expect.stringMatching(/filled in from this PC's last publish/),
      })
    );
    expect(
      screen.getByText(/^Last published from this PC: .*2026$/)
    ).toBeInTheDocument();
  });

  it('prefers the network over the profile when both have details', async () => {
    bridges.seed(appKey, savedProfile);
    mockNode();
    renderForm();
    await waitFor(() => expect(title()).toHaveValue('Node title'));
  });

  it('reopens the folder picker at the saved folder and counts the changed files', async () => {
    const user = userEvent.setup();
    bridges.seed(appKey, savedProfile);
    bridges.electron.selectAndZipDirectory.mockResolvedValue({
      buffer: new Uint8Array([80, 75, 3, 4]),
      directoryPath: FOLDER,
      changedFiles: 3,
    });
    mockNode();
    renderForm();

    await user.click(
      await screen.findByRole('button', { name: 'Same folder as last time' })
    );

    expect(bridges.electron.selectAndZipDirectory).toHaveBeenCalledWith(
      undefined,
      { defaultPath: FOLDER, changedSince: LAST_READ }
    );
    expect(
      await screen.findByText(/^Files changed since .*2026: 3$/)
    ).toBeInTheDocument();
    expect(screen.getByText('Selected folder: dist')).toBeInTheDocument();
  });

  it('saves the profile after a publish: source, time, metadata and signature', async () => {
    const user = userEvent.setup();
    bridges.seed(appKey, savedProfile);
    bridges.electron.selectAndZipDirectory.mockResolvedValue({
      buffer: new Uint8Array([80, 75, 3, 4]),
      directoryPath: FOLDER,
      changedFiles: 1,
    });
    mockNode();
    renderForm();
    await waitFor(() => expect(title()).toHaveValue('Node title'));

    await user.click(
      screen.getByRole('button', { name: 'Same folder as last time' })
    );
    await screen.findByText('Selected folder: dist');
    await user.click(screen.getByRole('button', { name: /action\.publish/i }));

    await waitFor(() =>
      expect(bridges.publishProfiles.merge).toHaveBeenCalledTimes(1)
    );
    expect(sendMessage).toHaveBeenCalledWith(
      'publishOnQDN',
      expect.objectContaining({
        data: expect.any(File),
        name: 'TestApp',
        service: 'APP',
        title: 'Node title',
        uploadType: 'zip',
      })
    );
    const [key, patch] = bridges.publishProfiles.merge.mock.calls[0] as [
      unknown,
      { publishedAt: number; source: { takenAt: number } },
    ];
    expect(key).toEqual({ ...appKey, identifier: 'default' });
    expect(patch).toEqual({
      publishedAt: expect.any(Number),
      metadata: {
        title: 'Node title',
        description: 'Node description',
        category: 'games',
        tags: ['node'],
      },
      source: { path: FOLDER, kind: 'folder', takenAt: expect.any(Number) },
      signature: SIGNATURE,
    });
    expect(patch.source.takenAt).toBeLessThanOrEqual(patch.publishedAt);
  });

  it('saves nothing when the publish fails', async () => {
    const user = userEvent.setup();
    sendMessage.mockResolvedValue({ error: 'Refused by the node' });
    bridges.electron.selectAndZipDirectory.mockResolvedValue({
      buffer: new Uint8Array([1]),
      directoryPath: FOLDER,
    });
    mockNode();
    renderForm();
    await waitFor(() => expect(title()).toHaveValue('Node title'));

    await user.click(screen.getByRole('button', { name: 'Choose folder' }));
    await screen.findByText('Selected folder: dist');
    await user.click(screen.getByRole('button', { name: /action\.publish/i }));

    await waitFor(() =>
      expect(executeEvent).toHaveBeenCalledWith(
        'openGlobalSnackBar',
        expect.objectContaining({ type: 'error' })
      )
    );
    expect(bridges.publishProfiles.merge).not.toHaveBeenCalled();
  });

  it('publishes as before when the profile store is broken', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    bridges.publishProfiles.get.mockRejectedValue(new Error('corrupt'));
    bridges.publishProfiles.merge.mockRejectedValue(new Error('disk full'));
    bridges.electron.selectAndZipDirectory.mockResolvedValue({
      buffer: new Uint8Array([1]),
      directoryPath: FOLDER,
    });
    mockNode();
    renderForm();
    await waitFor(() => expect(title()).toHaveValue('Node title'));

    await user.click(screen.getByRole('button', { name: 'Choose folder' }));
    await screen.findByText('Selected folder: dist');
    await user.click(screen.getByRole('button', { name: /action\.publish/i }));

    await waitFor(() =>
      expect(executeEvent).toHaveBeenCalledWith(
        'addTab',
        expect.objectContaining({
          data: expect.objectContaining({ name: 'TestApp', service: 'APP' }),
        })
      )
    );
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
