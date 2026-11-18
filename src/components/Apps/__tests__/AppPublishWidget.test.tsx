import React, { createContext, useImperativeHandle } from 'react';
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

// The library page section: a widget never uses it. A test types into it
// through the input callback the form hands it.
const prepareExtras = vi.fn(() => null);
let pageSection: { onInput?: (part: 'page' | 'shots') => void } = {};
let pageDrafts = { page: false, shots: false };
vi.mock('../AppPage/PublishPageExtras', () => ({
  PublishPageExtras: React.forwardRef((props: any, ref) => {
    pageSection = props;
    useImperativeHandle(ref, () => ({
      prepare: prepareExtras,
      hasDrafts: () => pageDrafts,
    }));
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

type Answer = { ok: boolean; json: () => Promise<unknown> };
const answer = (body: unknown, ok = true): Answer => ({
  ok,
  json: () => Promise.resolve(body),
});

/**
 * The node: the account's names, each name's app, TestApp's widgets and one
 * widget's details. `widgetSearch`, when given, answers the search for a
 * name's widgets instead (slowly, or with a failure).
 */
function mockNode({
  names = ['TestApp'],
  widgets = [] as unknown[],
  widgetSearch,
}: {
  names?: string[];
  widgets?: unknown[];
  widgetSearch?: (name: string) => Promise<Answer>;
} = {}) {
  global.fetch = vi.fn((url: string) => {
    if (url.includes('/names/address/')) {
      return Promise.resolve(answer(names.map((name) => ({ name }))));
    }
    if (url.includes('/arbitrary/metadata/')) {
      return Promise.resolve(answer(null));
    }
    const params = new URL(url).searchParams;
    const name = params.get('name') ?? '';
    if (params.get('prefix') === 'true') {
      return widgetSearch
        ? widgetSearch(name)
        : Promise.resolve(answer(name === 'TestApp' ? widgets : []));
    }
    if (params.get('identifier') === 'go-widget-now') {
      return Promise.resolve(answer([NOW_WIDGET]));
    }
    return Promise.resolve(
      answer(name === 'TestApp' ? [MAIN_APP] : [{ name, service: 'APP' }])
    );
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
const description = () => screen.getByRole('textbox', { name: 'Description' });
const publishButton = () =>
  screen.getByRole('button', { name: /action\.publish/i });
const widgetId = () => screen.getByRole('textbox', { name: 'Widget ID' });
const SIGNATURE = '5'.repeat(88);
const NEW_NOW = 'Publish the new widget APP / TestApp / go-widget-now?';
const TAKEN = /Your widget “Now” has this ID: publishing replaces it\./;

/** Lets what a click started run its course. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

const pickName = async (
  user: ReturnType<typeof userEvent.setup>,
  from: string,
  to: string
) => {
  const nameSelect = screen
    .getAllByRole('combobox')
    .find((element) => element.textContent === from)!;
  fireEvent.mouseDown(nameSelect);
  await user.click(await screen.findByRole('option', { name: to }));
};

const pickWidgetType = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Widget' }));
  await user.keyboard('{Escape}');
};

const chooseFolder = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Choose folder' }));
  await screen.findByText('Selected folder: dist');
};

const pickFromWidgetList = async (
  user: ReturnType<typeof userEvent.setup>,
  option: RegExp
) => {
  fireEvent.mouseDown(
    await screen.findByRole('combobox', { name: 'Widget to publish' })
  );
  await user.click(await screen.findByRole('option', { name: option }));
};

/** A publish that ends when the test says. */
const holdPublish = (sendMessage: ReturnType<typeof vi.fn>) => {
  let finish: (value: unknown) => void = () => undefined;
  sendMessage.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  return () => act(async () => finish({ signature: SIGNATURE }));
};

// Whole publishes through MUI, a dozen clicks each: more than vitest's
// default 5 s on a busy machine.
describe('AppPublish – publishing a widget', { timeout: 20_000 }, () => {
  let bridges: ReturnType<typeof installPublishBridges>;
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    pageDrafts = { page: false, shots: false };
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
    // No page text or screenshots for a widget.
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

    const second = renderForm({ isAppTypeLocked: true, isUpdate: true });
    await waitFor(() => expect(title()).toHaveValue('Node title'));
    expect(screen.getByRole('button', { name: 'Widget' })).toBeDisabled();
    second.unmount();

    renderForm({ initialAppType: 'WEBSITE', isAppTypeLocked: true });
    await settle();
    expect(screen.getByRole('button', { name: 'Website' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Widget' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'app_page.hero.type_app' })
    ).toBeDisabled();
  });

  it("says a widget is listed under Add widget and in the library's Widgets tab", async () => {
    const user = userEvent.setup();
    mockNode();
    renderForm();
    await waitFor(() => expect(title()).toHaveValue('Node title'));
    await pickWidgetType(user);

    expect(
      screen.getByText(
        /listed under Add widget in Qortal Hub and Qortal GO, and in the library's Widgets tab\./
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/not in the app library/)
    ).not.toBeInTheDocument();
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

  describe('what one kind leaves for the other', { timeout: 30_000 }, () => {
    const publishWidget = async (user: ReturnType<typeof userEvent.setup>) => {
      await pickWidgetType(user);
      await user.type(widgetId(), 'clock');
      await chooseFolder(user);
      await waitFor(() => expect(publishButton()).toBeEnabled());
      await user.click(publishButton());
      await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
      await settle();
    };

    it("keeps the Q-App's page drafts unsaved when a widget is published", async () => {
      const user = userEvent.setup();
      mockNode();
      const onUnsavedChange = vi.fn();
      renderForm({ onUnsavedChange });
      await waitFor(() => expect(title()).toHaveValue('Node title'));
      // Release notes typed for the Q-App's page.
      pageDrafts = { page: true, shots: false };
      act(() => pageSection.onInput?.('page'));

      await publishWidget(user);

      // A widget doesn't publish them: closing the tab still asks.
      expect(sendMessage.mock.calls[0][1]).toMatchObject({
        identifier: 'go-widget-clock',
      });
      expect(onUnsavedChange).toHaveBeenLastCalledWith(true);
    });

    it('marks the form saved after a widget publish when nothing else is left', async () => {
      const user = userEvent.setup();
      mockNode();
      const onUnsavedChange = vi.fn();
      renderForm({ onUnsavedChange });
      await waitFor(() => expect(title()).toHaveValue('Node title'));

      await publishWidget(user);

      expect(onUnsavedChange).toHaveBeenLastCalledWith(false);
    });

    it('keeps a typed widget ID unsaved when the Q-App is published instead', async () => {
      const user = userEvent.setup();
      mockNode();
      const onUnsavedChange = vi.fn();
      renderForm({ onUnsavedChange });
      await waitFor(() => expect(title()).toHaveValue('Node title'));
      await pickWidgetType(user);
      await user.type(widgetId(), 'clock');
      await user.click(
        screen.getByRole('button', { name: 'app_page.hero.type_app' })
      );
      await chooseFolder(user);
      await waitFor(() => expect(publishButton()).toBeEnabled());
      await user.click(publishButton());
      await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
      await settle();

      // The Q-App went out without the widget: the form stays with its ID
      // instead of opening the app in its place.
      expect(sendMessage.mock.calls[0][1]).not.toHaveProperty('identifier');
      expect(executeEvent).not.toHaveBeenCalledWith(
        'addTab',
        expect.anything()
      );
      expect(onUnsavedChange).toHaveBeenLastCalledWith(true);
    });

    it('opens the published Q-App when a widget ID was typed and then cleared', async () => {
      const user = userEvent.setup();
      mockNode();
      const onUnsavedChange = vi.fn();
      renderForm({ onUnsavedChange });
      await waitFor(() => expect(title()).toHaveValue('Node title'));
      // Widget picked, an ID typed and taken back out: no widget ID is left.
      await pickWidgetType(user);
      await user.type(widgetId(), 'clock');
      await user.clear(widgetId());
      expect(widgetId()).toHaveValue('');
      await user.click(
        screen.getByRole('button', { name: 'app_page.hero.type_app' })
      );
      await chooseFolder(user);
      await waitFor(() => expect(publishButton()).toBeEnabled());
      await user.click(publishButton());
      await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
      await settle();

      // Everything the form holds went out: the app takes the form's place.
      expect(sendMessage.mock.calls[0][1]).not.toHaveProperty('identifier');
      expect(onUnsavedChange).toHaveBeenLastCalledWith(false);
      expect(executeEvent).toHaveBeenCalledWith('addTab', expect.anything());
    });

    it("opens the published Q-App when a typed widget ID was swapped for one of the name's widgets", async () => {
      const user = userEvent.setup();
      mockNode({ widgets: [NOW_WIDGET] });
      const onUnsavedChange = vi.fn();
      renderForm({ onUnsavedChange });
      await waitFor(() => expect(title()).toHaveValue('Node title'));
      await pickWidgetType(user);
      await screen.findByRole('combobox', { name: 'Widget to publish' });
      // The typed ID is taken: "Update instead" swaps it for that widget.
      await user.type(widgetId(), 'now');
      await user.click(
        screen.getByRole('button', { name: 'Update it instead' })
      );
      await waitFor(() => expect(title()).toHaveValue('Now'));
      // Then the Q-App is published instead, the widget left as it is.
      await user.click(
        screen.getByRole('button', { name: 'app_page.hero.type_app' })
      );
      await waitFor(() => expect(title()).toHaveValue('Node title'));
      await chooseFolder(user);
      await waitFor(() => expect(publishButton()).toBeEnabled());
      await user.click(publishButton());
      await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
      await settle();

      expect(sendMessage.mock.calls[0][1]).not.toHaveProperty('identifier');
      expect(onUnsavedChange).toHaveBeenLastCalledWith(false);
      expect(executeEvent).toHaveBeenCalledWith('addTab', expect.anything());
    });
  });

  describe("before the name's widgets are known", { timeout: 30_000 }, () => {
    it("doesn't publish a typed ID as a new widget when the name's widgets couldn't be loaded", async () => {
      const user = userEvent.setup();
      let nodeUp = false;
      mockNode({
        widgetSearch: () =>
          Promise.resolve(nodeUp ? answer([NOW_WIDGET]) : answer(null, false)),
      });
      renderForm();
      await waitFor(() => expect(title()).toHaveValue('Node title'));
      await pickWidgetType(user);

      // The ID of a widget the name has, which the node couldn't list.
      await user.type(widgetId(), 'now');
      await chooseFolder(user);
      fireEvent.click(publishButton());
      await settle();

      // Not as a new widget: that would replace the one it never loaded.
      expect(show).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
      expect(publishButton()).toBeDisabled();

      // The failure is said, with a way out.
      nodeUp = true;
      await user.click(screen.getByRole('button', { name: /^retry$/i }));
      expect(await screen.findByText(TAKEN)).toBeInTheDocument();
      await waitFor(() => expect(publishButton()).toBeEnabled());
      await user.click(publishButton());
      await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Update the widget APP / TestApp / go-widget-now?',
        })
      );
      expect(show).not.toHaveBeenCalledWith(
        expect.objectContaining({ message: NEW_NOW })
      );
    });

    it("holds Publish for a new widget until the name's widgets are known", async () => {
      const user = userEvent.setup();
      let answerSearch: (value: Answer) => void = () => undefined;
      mockNode({
        widgetSearch: () =>
          new Promise<Answer>((resolve) => {
            answerSearch = resolve;
          }),
      });
      renderForm();
      await waitFor(() => expect(title()).toHaveValue('Node title'));
      await pickWidgetType(user);

      await user.type(widgetId(), 'now');
      await chooseFolder(user);
      fireEvent.click(publishButton());
      await settle();
      expect(show).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();

      // The node's answer: the ID is one of the name's widgets.
      await act(async () => answerSearch(answer([NOW_WIDGET])));
      expect(await screen.findByText(TAKEN)).toBeInTheDocument();
      await waitFor(() => expect(publishButton()).toBeEnabled());
    });
  });

  describe('after another name is picked', { timeout: 30_000 }, () => {
    it("drops a late list of another name's widgets", async () => {
      const user = userEvent.setup();
      const answers: Record<string, (value: Answer) => void> = {};
      mockNode({
        names: ['TestApp', 'Other'],
        widgetSearch: (name) =>
          new Promise<Answer>((resolve) => {
            answers[name] = resolve;
          }),
      });
      renderForm();
      await waitFor(() => expect(title()).toHaveValue('Node title'));
      await pickWidgetType(user);
      await waitFor(() => expect(answers.TestApp).toBeDefined());

      // Another name is picked while TestApp's widgets are on their way.
      await pickName(user, 'TestApp', 'Other');
      await waitFor(() => expect(answers.Other).toBeDefined());
      await act(async () => answers.Other(answer([])));
      await act(async () => answers.TestApp(answer([NOW_WIDGET])));
      await settle();

      // Other has no widgets: TestApp's aren't offered under it.
      expect(
        screen.queryByRole('combobox', { name: 'Widget to publish' })
      ).not.toBeInTheDocument();
      await waitFor(() => expect(publishButton()).toBeEnabled());
    });

    it("doesn't start a new widget from the previous name's details when Widget is picked before the new name's app has loaded", async () => {
      const user = userEvent.setup();
      mockNode({ names: ['TestApp', 'Other'] });
      // Other's app is slow to load.
      const nodeFetch = global.fetch as unknown as (
        url: string
      ) => Promise<Answer>;
      global.fetch = vi.fn((url: string) => {
        const params = new URL(url).searchParams;
        if (
          params.get('name') === 'Other' &&
          params.get('default') === 'true'
        ) {
          return new Promise<Answer>(() => undefined);
        }
        return nodeFetch(url);
      }) as unknown as typeof fetch;
      renderForm();
      await waitFor(() => expect(title()).toHaveValue('Node title'));

      // Another name, and Widget before its app's details are in.
      await pickName(user, 'TestApp', 'Other');
      await pickWidgetType(user);
      await screen.findByText(/APP \/ Other \//);
      await settle();

      // Other's new widget doesn't get TestApp's listing.
      expect(title()).not.toHaveValue('Node title');
      expect(description()).not.toHaveValue('Node description');
    });
  });

  describe(
    'when the form changes while a widget is publishing',
    { timeout: 30_000 },
    () => {
      it("leaves the form on the name picked meanwhile when a widget's publish ends", async () => {
        const user = userEvent.setup();
        mockNode({ names: ['TestApp', 'Other'] });
        const finishPublish = holdPublish(sendMessage);
        renderForm();
        await waitFor(() => expect(title()).toHaveValue('Node title'));
        await pickWidgetType(user);
        await user.type(widgetId(), 'clock');
        await chooseFolder(user);
        await waitFor(() => expect(publishButton()).toBeEnabled());
        await user.click(publishButton());
        await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

        // While it uploads, another of the account's names is picked.
        await pickName(user, 'TestApp', 'Other');
        await screen.findByText(/APP \/ Other \//);

        await finishPublish();
        await settle();

        // Other has no such widget: the form doesn't say it does.
        expect(
          screen.queryByRole('combobox', { name: 'Widget to publish' })
        ).not.toBeInTheDocument();
        // The ID typed for it is still there, for a new widget of Other's.
        expect(widgetId()).toHaveValue('clock');
      });

      it("doesn't put the form on the published widget when the type was changed and changed back meanwhile", async () => {
        const user = userEvent.setup();
        mockNode();
        const finishPublish = holdPublish(sendMessage);
        renderForm();
        await waitFor(() => expect(title()).toHaveValue('Node title'));
        await pickWidgetType(user);
        await user.type(widgetId(), 'clock');
        await user.clear(title());
        await user.type(title(), 'Clock');
        await chooseFolder(user);
        await waitFor(() => expect(publishButton()).toBeEnabled());
        await user.click(publishButton());
        await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

        // While it uploads: to Q-App, which fills in the app's details, and
        // back to Widget.
        await user.click(
          screen.getByRole('button', { name: 'app_page.hero.type_app' })
        );
        await waitFor(() => expect(title()).toHaveValue('Node title'));
        await user.click(screen.getByRole('button', { name: 'Widget' }));
        await waitFor(() => expect(widgetId()).toHaveValue('clock'));

        await finishPublish();
        await settle();

        // The form holds the app's details: it isn't said to be on the widget.
        expect(title()).toHaveValue('Node title');
        expect(widgetId()).toHaveValue('clock');
        // The widget is one of the name's now, so its ID is known as taken.
        expect(
          await screen.findByText(
            /Your widget “Clock” has this ID: publishing replaces it\./
          )
        ).toBeInTheDocument();
      });

      it('keeps the ID typed for the next widget while one was publishing', async () => {
        const user = userEvent.setup();
        mockNode();
        const finishPublish = holdPublish(sendMessage);
        renderForm();
        await waitFor(() => expect(title()).toHaveValue('Node title'));
        await pickWidgetType(user);
        await user.type(widgetId(), 'clock');
        await chooseFolder(user);
        await waitFor(() => expect(publishButton()).toBeEnabled());
        await user.click(publishButton());
        await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

        // While it uploads, the next widget's ID is typed.
        await user.clear(widgetId());
        await user.type(widgetId(), 'meteogram');

        await finishPublish();
        await settle();

        // The form is still on the new one, not turned to the published one.
        expect(widgetId()).toHaveValue('meteogram');
        expect(
          screen.getByText('APP / TestApp / go-widget-meteogram')
        ).toBeInTheDocument();
        // The published one is among the name's widgets to pick.
        expect(
          await screen.findByRole('combobox', { name: 'Widget to publish' })
        ).toHaveTextContent('A new widget');
        // Its profile is saved under its own ID, not the one typed since.
        await waitFor(() =>
          expect(bridges.publishProfiles.merge).toHaveBeenCalledTimes(1)
        );
        expect(bridges.publishProfiles.merge.mock.calls[0][0]).toEqual({
          address: ADDRESS,
          service: 'APP',
          name: 'TestApp',
          identifier: 'go-widget-clock',
        });
      });

      it('keeps the form marked unsaved when it was edited while the widget was publishing', async () => {
        const user = userEvent.setup();
        mockNode();
        const finishPublish = holdPublish(sendMessage);
        const onUnsavedChange = vi.fn();
        renderForm({ onUnsavedChange });
        await waitFor(() => expect(title()).toHaveValue('Node title'));
        await pickWidgetType(user);
        await user.type(widgetId(), 'clock');
        await chooseFolder(user);
        await waitFor(() => expect(publishButton()).toBeEnabled());
        await user.click(publishButton());
        await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

        // While it uploads, the description is changed.
        await user.type(description(), ' and more');

        await finishPublish();
        await settle();

        // The form now shows a description that isn't published.
        expect(description()).toHaveValue('Node description and more');
        expect(sendMessage.mock.calls[0][1].description).toBe(
          'Node description'
        );
        // So its launcher tab still asks before it closes.
        expect(onUnsavedChange.mock.lastCall).toEqual([true]);
      });

      it('keeps a title changed while a widget was publishing as unsaved input', async () => {
        const user = userEvent.setup();
        const onUnsavedChange = vi.fn();
        mockNode();
        const finishPublish = holdPublish(sendMessage);
        renderForm({ onUnsavedChange });
        await waitFor(() => expect(title()).toHaveValue('Node title'));
        await pickWidgetType(user);
        await user.type(widgetId(), 'clock');
        await chooseFolder(user);
        await waitFor(() => expect(publishButton()).toBeEnabled());
        await user.click(publishButton());
        await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

        // While it uploads, the title is changed.
        await user.clear(title());
        await user.type(title(), 'Clock 2');

        await finishPublish();
        await settle();

        // The publish went out with the title from before…
        expect(sendMessage.mock.calls[0][1]).toMatchObject({
          title: 'Node title',
        });
        // …and the form, still open on the widget, holds the new one.
        expect(title()).toHaveValue('Clock 2');
        // That isn't published: closing the tab still asks.
        expect(onUnsavedChange).toHaveBeenLastCalledWith(true);
      });
    }
  );

  describe('a widget just updated from this form', { timeout: 30_000 }, () => {
    // The node still lists the version from before the publish.
    const updateNowToNow2 = async (
      user: ReturnType<typeof userEvent.setup>
    ) => {
      mockNode({ widgets: [NOW_WIDGET] });
      renderForm();
      await waitFor(() => expect(title()).toHaveValue('Node title'));
      await pickWidgetType(user);
      await pickFromWidgetList(user, /^Now/);
      await waitFor(() => expect(title()).toHaveValue('Now'));

      await user.clear(title());
      await user.type(title(), 'Now 2');
      await chooseFolder(user);
      await waitFor(() => expect(publishButton()).toBeEnabled());
      await user.click(publishButton());
      await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
      await settle();
    };

    it('fills in what it just published when the same widget is picked again', async () => {
      const user = userEvent.setup();
      await updateNowToNow2(user);

      // Another widget, then this one again, in the same form.
      await pickFromWidgetList(user, /A new widget/);
      await pickFromWidgetList(user, /^Now 2/);
      await settle();

      // The list says "Now 2"; the fields say the same.
      expect(
        screen.getByRole('combobox', { name: 'Widget to publish' })
      ).toHaveTextContent('Now 2');
      expect(title()).toHaveValue('Now 2');
    });

    it('fills in what it just published after Q-App and back to Widget', async () => {
      const user = userEvent.setup();
      await updateNowToNow2(user);

      await user.click(
        screen.getByRole('button', { name: 'app_page.hero.type_app' })
      );
      await waitFor(() => expect(title()).toHaveValue('Node title'));
      await user.click(screen.getByRole('button', { name: 'Widget' }));
      await settle();

      expect(title()).toHaveValue('Now 2');
      // The list, reloaded from the node, agrees with the fields.
      expect(
        screen.getByRole('combobox', { name: 'Widget to publish' })
      ).toHaveTextContent('Now 2');
    });

    it("fills in the node's version once the node lists a newer one", async () => {
      const user = userEvent.setup();
      await updateNowToNow2(user);

      // The node lists a version newer than the one replaced (from here, or
      // from another device): that is what the form fills in.
      const newer = {
        ...NOW_WIDGET,
        metadata: { ...NOW_WIDGET.metadata, title: 'Now 3' },
        updated: Date.now() + 60_000,
      };
      mockNode({ widgets: [newer] });
      const nodeFetch = global.fetch as unknown as (
        url: string
      ) => Promise<Answer>;
      global.fetch = vi.fn((url: string) =>
        new URL(url).searchParams.get('identifier') === 'go-widget-now'
          ? Promise.resolve(answer([newer]))
          : nodeFetch(url)
      ) as unknown as typeof fetch;

      await pickFromWidgetList(user, /A new widget/);
      await pickFromWidgetList(user, /^Now 2/);
      await waitFor(() => expect(title()).toHaveValue('Now 3'));
    });
  });

  describe(
    'a new widget just published from this form',
    { timeout: 30_000 },
    () => {
      const CLOCK_TAKEN =
        /Your widget “Clock” has this ID: publishing replaces it\./;

      // The node doesn't list it yet.
      const publishClock = async (user: ReturnType<typeof userEvent.setup>) => {
        mockNode({ names: ['TestApp', 'Other'] });
        renderForm();
        await waitFor(() => expect(title()).toHaveValue('Node title'));
        await pickWidgetType(user);
        await user.type(widgetId(), 'clock');
        await user.clear(title());
        await user.type(title(), 'Clock');
        await chooseFolder(user);
        await waitFor(() => expect(publishButton()).toBeEnabled());
        await user.click(publishButton());
        await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
        await settle();
        expect(
          await screen.findByRole('combobox', { name: 'Widget to publish' })
        ).toHaveTextContent('Clock');
      };

      it('is still listed after another name and back, and retyping its ID warns', async () => {
        const user = userEvent.setup();
        await publishClock(user);

        await pickName(user, 'TestApp', 'Other');
        await screen.findByText(/APP \/ Other \//);
        await pickName(user, 'Other', 'TestApp');
        await screen.findByText(/APP \/ TestApp \//);
        await settle();

        expect(
          screen.getByRole('combobox', { name: 'Widget to publish' })
        ).toBeInTheDocument();
        await user.type(widgetId(), 'clock');
        expect(await screen.findByText(CLOCK_TAKEN)).toBeInTheDocument();
      });

      it('is still listed after Q-App and back, and retyping its ID warns', async () => {
        const user = userEvent.setup();
        await publishClock(user);

        await user.click(
          screen.getByRole('button', { name: 'app_page.hero.type_app' })
        );
        await waitFor(() => expect(title()).toHaveValue('Node title'));
        await user.click(screen.getByRole('button', { name: 'Widget' }));
        await settle();

        // The list, reloaded from the node, still has it under its title.
        expect(
          screen.getByRole('combobox', { name: 'Widget to publish' })
        ).toHaveTextContent('Clock');
        await pickFromWidgetList(user, /A new widget/);
        await user.type(widgetId(), 'clock');
        expect(await screen.findByText(CLOCK_TAKEN)).toBeInTheDocument();
      });
    }
  );
});
