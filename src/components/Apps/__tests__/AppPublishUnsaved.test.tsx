import React, { createContext } from 'react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import enCore from '../../../i18n/locales/en/core.json';
import { capitalizeFirstChar } from '../../../i18n/processors';

// The strings the form's controls are found by are real; the rest render as
// their keys.
i18n.use(capitalizeFirstChar as never).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: {
      core: {
        publish_source: enCore.publish_source,
        publish_update: enCore.publish_update,
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
import { LauncherTabContext } from '../launcherTabs';
import { executeEvent } from '../../../utils/events';
import { installPublishBridges } from '../../../test/mocks/publishBridges';

const FOLDER = '/home/dev/test-app/dist';

/** The node answers the names list and the app's details. */
function mockNode() {
  global.fetch = vi.fn((url: string) => {
    const body = url.includes('/names/address/')
      ? [{ name: 'TestApp' }]
      : url.includes('/arbitrary/metadata/')
        ? null
        : [
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
          ];
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  }) as unknown as typeof fetch;
}

const renderForm = (
  props: Partial<React.ComponentProps<typeof AppPublish>> = {},
  launcherTabId: string | null = null
) =>
  render(
    <ThemeProvider theme={createTheme()}>
      <I18nextProvider i18n={i18n}>
        <LauncherTabContext.Provider value={launcherTabId}>
          <AppPublish
            categories={[
              { id: 'games', name: 'Games' },
              { id: 'tools', name: 'Tools' },
            ]}
            myAddress="Qowner"
            myName="TestApp"
            initialName="TestApp"
            initialAppType="APP"
            isAppTypeLocked
            isUpdate
            {...props}
          />
        </LauncherTabContext.Provider>
      </I18nextProvider>
    </ThemeProvider>
  );

const title = () => screen.getByRole('textbox', { name: 'Title' });

describe('AppPublish – input not published yet', () => {
  let bridges: ReturnType<typeof installPublishBridges>;
  let onUnsavedChange: Mock<(hasUnsavedInput: boolean) => void>;
  const lastReport = () => {
    const { calls } = onUnsavedChange.mock;
    return calls[calls.length - 1]?.[0];
  };

  beforeEach(() => {
    vi.clearAllMocks();
    bridges = installPublishBridges();
    onUnsavedChange = vi.fn<(hasUnsavedInput: boolean) => void>();
    window.sendMessage = vi.fn(async () => ({
      signature: '5'.repeat(88),
    })) as unknown as typeof window.sendMessage;
    mockNode();
  });

  afterEach(() => {
    bridges.uninstall();
    delete window.sendMessage;
  });

  it('counts what the user types, not what the network filled in', async () => {
    const user = userEvent.setup();
    renderForm({ onUnsavedChange });

    await waitFor(() => expect(title()).toHaveValue('Node title'));
    expect(onUnsavedChange).toHaveBeenCalled();
    expect(onUnsavedChange).not.toHaveBeenCalledWith(true);

    await user.type(title(), '!');

    expect(lastReport()).toBe(true);
  });

  it('counts a folder chosen to publish', async () => {
    const user = userEvent.setup();
    bridges.electron.selectAndZipDirectory.mockResolvedValue({
      buffer: new Uint8Array([1]),
      directoryPath: FOLDER,
    });
    renderForm({ onUnsavedChange });
    await waitFor(() => expect(title()).toHaveValue('Node title'));

    await user.click(screen.getByRole('button', { name: 'Choose folder' }));
    await screen.findByText('Selected folder: dist');

    expect(lastReport()).toBe(true);
  });

  it('has nothing unsaved once it closes', async () => {
    const user = userEvent.setup();
    const view = renderForm({ onUnsavedChange });
    await waitFor(() => expect(title()).toHaveValue('Node title'));
    await user.type(title(), '!');

    view.unmount();

    expect(lastReport()).toBe(false);
  });

  it('has nothing unsaved once published, and opens the app in its launcher tab', async () => {
    const user = userEvent.setup();
    bridges.electron.selectAndZipDirectory.mockResolvedValue({
      buffer: new Uint8Array([1]),
      directoryPath: FOLDER,
    });
    renderForm({ onUnsavedChange }, 'launcher-tab-3');
    await waitFor(() => expect(title()).toHaveValue('Node title'));
    await user.click(screen.getByRole('button', { name: 'Choose folder' }));
    await screen.findByText('Selected folder: dist');
    expect(lastReport()).toBe(true);

    await user.click(screen.getByRole('button', { name: /action\.publish/i }));

    await waitFor(() =>
      expect(executeEvent).toHaveBeenCalledWith('addTab', {
        data: expect.objectContaining({
          name: 'TestApp',
          service: 'APP',
          fromLauncherTabId: 'launcher-tab-3',
        }),
      })
    );
    expect(lastReport()).toBe(false);
  });
});
