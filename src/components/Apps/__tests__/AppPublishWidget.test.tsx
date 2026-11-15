import React, { createContext, useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import enCore from '../../../i18n/locales/en/core.json';
import { capitalizeFirstChar } from '../../../i18n/processors';

// The strings this feature uses are real; the rest render as their keys.
i18n.use(capitalizeFirstChar as never).init({
  lng: 'en',
  fallbackLng: 'en',
  // As the app sets it: names and paths are shown as they are.
  interpolation: { escapeValue: false },
  resources: {
    en: {
      core: {
        message: {
          error: { missing_fields: enCore.message.error.missing_fields },
        },
        publish_source: enCore.publish_source,
        publish_widget: enCore.publish_widget,
        widget_guide: enCore.widget_guide,
        tag_number: 'tag {{number}}',
      },
    },
  },
});

// The confirm dialog: what it was asked to say.
const show = vi.fn();
vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
  QORTAL_APP_CONTEXT: createContext({ show: (...args) => show(...args) }),
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

// The library page section: a widget never uses it.
const prepareExtras = vi.fn(() => null);
vi.mock('../AppPage/PublishPageExtras', () => ({
  PublishPageExtras: React.forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({ prepare: prepareExtras }));
    return null;
  }),
  extrasPartCount: () => 0,
  publishPageExtras: vi.fn(),
}));

const rememberPublishedWidget = vi.fn();
vi.mock('../../HomeWidgets/fetchHomeWidgets', () => ({
  rememberPublishedWidget: (widget) => rememberPublishedWidget(widget),
}));

import { AppPublish } from '../AppPublish';
import { executeEvent } from '../../../utils/events';
import { installPublishBridges } from '../../../test/mocks/publishBridges';

const ADDRESS = 'Qowner';
const FOLDER = '/home/dev/clock/dist';

const MAIN_APP = {
  name: 'TestApp',
  service: 'APP',
  metadata: {
    title: 'Node title',
    description: 'Node description',
    category: 'games',
    tags: ['node'],
  },
};
const NOW_WIDGET = {
  name: 'TestApp',
  service: 'APP',
  identifier: 'go-widget-now',
  metadata: {
    title: 'Now',
    description: 'The weather now',
    category: 'tools',
    tags: ['go-widget', 'weather'],
  },
  updated: 5,
};

/** The node: names, the app, the name's widgets and one widget's details. */
function mockNode({ widgets = [] as unknown[] } = {}) {
  global.fetch = vi.fn((url: string) => {
    const params = new URL(url).searchParams;
    const body = url.includes('/names/address/')
      ? [{ name: 'TestApp' }]
      : url.includes('/arbitrary/metadata/')
        ? null
        : params.get('prefix') === 'true'
          ? widgets
          : params.get('identifier') === 'go-widget-now'
            ? [NOW_WIDGET]
            : [MAIN_APP];
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
          initialAppType="APP"
          initialName="TestApp"
          myAddress={ADDRESS}
          myName="TestApp"
          {...props}
        />
      </I18nextProvider>
    </ThemeProvider>
  );

const title = () => screen.getByRole('textbox', { name: 'Title' });

// Whole publishes through MUI, a dozen clicks each: more than vitest's
// default 5 s on a busy machine.
describe('AppPublish – publishing a widget', { timeout: 20_000 }, () => {
  let bridges: ReturnType<typeof installPublishBridges>;
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    bridges = installPublishBridges();
    bridges.electron.selectAndZipDirectory.mockResolvedValue({
      buffer: new Uint8Array([80, 75, 3, 4]),
      directoryPath: FOLDER,
    });
    sendMessage = vi.fn(async () => ({ signature: '5'.repeat(88) }));
    window.sendMessage = sendMessage as unknown as typeof window.sendMessage;
  });

  afterEach(() => {
    bridges.uninstall();
    delete window.sendMessage;
  });

  it('shows the short guide when Widget is picked, and the whole guide on Learn more', async () => {
    const user = userEvent.setup();
    mockNode();
    renderForm();
    await waitFor(() => expect(title()).toHaveValue('Node title'));

    await user.click(screen.getByRole('button', { name: 'Widget' }));
    const tip = await screen.findByRole('dialog', {
      name: 'Building it as a widget',
    });
    expect(within(tip).getByText('goWidget=1')).toBeInTheDocument();

    await user.click(within(tip).getByRole('button', { name: 'Learn more' }));
    const guide = await screen.findByRole('dialog', {
      name: 'Building a widget',
    });
    expect(
      within(guide).getByRole('heading', { name: /What a widget looks like/ })
    ).toBeInTheDocument();
    expect(
      within(guide).getByRole('button', { name: 'Copy as Markdown' })
    ).toBeInTheDocument();
    await user.click(
      within(guide).getByRole('button', { name: /action\.close/i })
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Building a widget' })
      ).not.toBeInTheDocument()
    );

    // Picked again, it waits for the (i).
    await user.click(
      screen.getByRole('button', { name: 'app_page.hero.type_app' })
    );
    await user.click(screen.getByRole('button', { name: 'Widget' }));
    expect(
      screen.queryByRole('dialog', { name: 'Building it as a widget' })
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'How to build a widget' })
    );
    expect(
      await screen.findByRole('dialog', { name: 'Building it as a widget' })
    ).toBeInTheDocument();
  });

  it('publishes a new widget under its go-widget ID, tagged go-widget, without opening a tab', async () => {
    const user = userEvent.setup();
    mockNode();
    renderForm();
    await waitFor(() => expect(title()).toHaveValue('Node title'));

    await user.click(screen.getByRole('button', { name: 'Widget' }));
    await user.keyboard('{Escape}');
    // No page in the library for a widget.
    expect(screen.getByText(/app_page\.publish\.title/i)).not.toBeVisible();
    // The tag that lists it comes first and can't be changed.
    expect(
      screen.getByRole('textbox', {
        name: 'Tag 1: go-widget, added for widgets',
      })
    ).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Tag 2' })).toHaveValue('node');

    await user.type(
      screen.getByRole('textbox', { name: 'Widget ID' }),
      'My Clock'
    );
    expect(screen.getByRole('textbox', { name: 'Widget ID' })).toHaveValue(
      'my-clock'
    );
    expect(
      screen.getByText('APP / TestApp / go-widget-my-clock')
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Choose folder' }));
    await screen.findByText('Selected folder: dist');
    await user.click(screen.getByRole('button', { name: /action\.publish/i }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage).toHaveBeenCalledWith(
      'publishOnQDN',
      expect.objectContaining({
        service: 'APP',
        name: 'TestApp',
        identifier: 'go-widget-my-clock',
        title: 'Node title',
        tag1: 'go-widget',
        tag2: 'node',
        tag3: '',
        uploadType: 'zip',
      })
    );
    await waitFor(() =>
      expect(bridges.publishProfiles.merge).toHaveBeenCalledTimes(1)
    );
    expect(bridges.publishProfiles.merge.mock.calls[0][0]).toEqual({
      address: ADDRESS,
      service: 'APP',
      name: 'TestApp',
      identifier: 'go-widget-my-clock',
    });
    expect(prepareExtras).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Publish the new widget APP / TestApp / go-widget-my-clock?',
      })
    );
    expect(rememberPublishedWidget).toHaveBeenCalledWith({
      name: 'TestApp',
      identifier: 'go-widget-my-clock',
    });
    expect(executeEvent).not.toHaveBeenCalledWith('addTab', expect.anything());

    // The form is now on that widget: publishing again updates it, with the
    // same details and files.
    const choice = await screen.findByRole('combobox', {
      name: 'Widget to publish',
    });
    expect(choice).toHaveTextContent('Node title');
    expect(
      screen.queryByRole('textbox', { name: 'Widget ID' })
    ).not.toBeInTheDocument();
    expect(title()).toHaveValue('Node title');
    expect(screen.getByText('Selected folder: dist')).toBeInTheDocument();
  });

  it('asks for a widget ID before publishing', async () => {
    const user = userEvent.setup();
    mockNode();
    renderForm();
    await waitFor(() => expect(title()).toHaveValue('Node title'));
    await user.click(screen.getByRole('button', { name: 'Widget' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Choose folder' }));
    await screen.findByText('Selected folder: dist');

    await user.click(screen.getByRole('button', { name: /action\.publish/i }));
    // Hub's snackbar says what's missing, in the checklist's words.
    await waitFor(() =>
      expect(executeEvent).toHaveBeenCalledWith(
        'openGlobalSnackBar',
        expect.objectContaining({
          type: 'error',
          message: 'Missing: Choose a widget ID',
        })
      )
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("offers the name's widgets, and fills one in to update it", async () => {
    const user = userEvent.setup();
    mockNode({ widgets: [NOW_WIDGET] });
    renderForm();
    await waitFor(() => expect(title()).toHaveValue('Node title'));
    await user.click(screen.getByRole('button', { name: 'Widget' }));
    await user.keyboard('{Escape}');

    fireEvent.mouseDown(
      await screen.findByRole('combobox', { name: 'Widget to publish' })
    );
    await user.click(await screen.findByRole('option', { name: /^Now/ }));

    await waitFor(() => expect(title()).toHaveValue('Now'));
    expect(screen.getByRole('textbox', { name: 'Tag 2' })).toHaveValue(
      'weather'
    );
    expect(
      screen.queryByRole('textbox', { name: 'Widget ID' })
    ).not.toBeInTheDocument();
    expect(bridges.publishProfiles.get).toHaveBeenCalledWith({
      address: ADDRESS,
      service: 'APP',
      name: 'TestApp',
      identifier: 'go-widget-now',
    });

    await user.click(screen.getByRole('button', { name: 'Choose folder' }));
    await screen.findByText('Selected folder: dist');
    await user.click(screen.getByRole('button', { name: /action\.publish/i }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage).toHaveBeenCalledWith(
      'publishOnQDN',
      expect.objectContaining({
        identifier: 'go-widget-now',
        title: 'Now',
        category: 'tools',
        tag1: 'go-widget',
        tag2: 'weather',
      })
    );
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Update the widget APP / TestApp / go-widget-now?',
      })
    );
  });

  it('can be picked from Publish app, but not from Update or Publish website', async () => {
    mockNode();
    const first = renderForm({ isAppTypeLocked: true });
    await waitFor(() => expect(title()).toHaveValue('Node title'));
    expect(screen.getByRole('button', { name: 'Widget' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Website' })).toBeDisabled();
    first.unmount();

    renderForm({ isAppTypeLocked: true, isUpdate: true });
    await waitFor(() => expect(title()).toHaveValue('Node title'));
    expect(screen.getByRole('button', { name: 'Widget' })).toBeDisabled();
  });

  it("warns when a typed ID is one of the name's widgets, and offers to update it", async () => {
    const user = userEvent.setup();
    mockNode({ widgets: [NOW_WIDGET] });
    renderForm();
    await waitFor(() => expect(title()).toHaveValue('Node title'));
    await user.click(screen.getByRole('button', { name: 'Widget' }));
    await user.keyboard('{Escape}');
    await screen.findByRole('combobox', { name: 'Widget to publish' });

    await user.type(screen.getByRole('textbox', { name: 'Widget ID' }), 'now');
    expect(
      screen.getByText(
        /Your widget “Now” has this ID: publishing replaces it\./
      )
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Update it instead' }));
    await waitFor(() => expect(title()).toHaveValue('Now'));
  });

  it("doesn't carry the chosen files from the app to a widget", async () => {
    const user = userEvent.setup();
    mockNode();
    renderForm();
    await waitFor(() => expect(title()).toHaveValue('Node title'));
    await user.click(screen.getByRole('button', { name: 'Choose folder' }));
    await screen.findByText('Selected folder: dist');

    await user.click(screen.getByRole('button', { name: 'Widget' }));
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(
        screen.queryByText('Selected folder: dist')
      ).not.toBeInTheDocument()
    );
  });

  it('publishes a Q-App as before: no identifier, its own tags', async () => {
    const user = userEvent.setup();
    mockNode();
    renderForm();
    await waitFor(() => expect(title()).toHaveValue('Node title'));
    await user.click(screen.getByRole('button', { name: 'Choose folder' }));
    await screen.findByText('Selected folder: dist');
    await user.click(screen.getByRole('button', { name: /action\.publish/i }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    const payload = sendMessage.mock.calls[0][1];
    expect(payload).not.toHaveProperty('identifier');
    expect(payload).toMatchObject({ tag1: 'node', tag2: '' });
    expect(prepareExtras).toHaveBeenCalled();
  });
});
