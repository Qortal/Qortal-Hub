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
  interpolation: { escapeValue: false },
  resources: {
    en: {
      core: {
        publish_source: enCore.publish_source,
        publish_update: { title: enCore.publish_update.title },
        publish_widget: enCore.publish_widget,
        widget_guide: enCore.widget_guide,
        tag_number: 'tag {{number}}',
      },
    },
  },
});

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

vi.mock('../AppPage/PublishPageExtras', () => ({
  PublishPageExtras: React.forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({
      prepare: () => null,
      hasDrafts: () => ({ page: false, shots: false }),
    }));
    return null;
  }),
  extrasPartCount: () => 0,
  publishPageExtras: vi.fn(),
}));

vi.mock('../../HomeWidgets/fetchHomeWidgets', () => ({
  rememberPublishedWidget: vi.fn(),
}));

import { getDefaultStore } from 'jotai';
import { AppPublish } from '../AppPublish';
import {
  ownWidgetsFrom,
  publishedOwnWidgetsAtom,
  withPublishedOwnWidgets,
} from '../AppsLibrary/ownWidgets';
import { installPublishBridges } from '../../../test/mocks/publishBridges';
import { executeEvent } from '../../../utils/events';

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
/** A widget under a go-widget identifier, as the node lists it. */
const nowWidget = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});
/** A widget its publisher retired: its go-widget tag is gone. */
const RETIRED_WIDGET = {
  name: 'TestApp',
  service: 'APP',
  identifier: 'go-widget-old',
  metadata: {
    title: 'Old',
    description: 'Moved',
    category: 'tools',
    tags: ['weather'],
  },
  updated: 5,
};
/** A widget by its tag alone: its identifier has no go-widget in it. */
const CLOCK_WIDGET = {
  name: 'TestApp',
  service: 'APP',
  identifier: 'clock',
  metadata: {
    title: 'Clock',
    description: 'The time',
    category: 'tools',
    tags: ['go-widget', 'time'],
  },
  updated: 7,
};

/**
 * The node: the account's name, its app, and its widgets as `widgets()`
 * lists them at that moment (a publish from here is not in it until then).
 */
function mockNode(widgets: () => Array<{ identifier: string }>) {
  global.fetch = vi.fn((url: string) => {
    const params = new URL(url).searchParams;
    const identifier = params.get('identifier');
    const body = url.includes('/names/address/')
      ? [{ name: 'TestApp' }]
      : url.includes('/arbitrary/metadata/')
        ? null
        : identifier
          ? widgets().filter((widget) => widget.identifier.includes(identifier))
          : [MAIN_APP];
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  }) as unknown as typeof fetch;
}

const publishForm = (props: Record<string, unknown>) => (
  <AppPublish
    categories={[
      { id: 'games', name: 'Games' },
      { id: 'tools', name: 'Tools' },
    ]}
    initialAppType="APP"
    initialName="TestApp"
    isAppTypeLocked
    myAddress={ADDRESS}
    myName="TestApp"
    {...props}
  />
);

/** The form as Update on one of My apps' widgets opens it. */
const updateForm = (identifier: string) =>
  publishForm({ isUpdate: true, widgetToUpdate: identifier });

const withProviders = (children: React.ReactNode) => (
  <ThemeProvider theme={createTheme()}>
    <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
  </ThemeProvider>
);

const renderForm = (props: Record<string, unknown>) =>
  render(withProviders(publishForm(props)));

const renderUpdate = (identifier: string) =>
  render(withProviders(updateForm(identifier)));

type Scope = ReturnType<typeof within>;
const titleIn = (scope: Scope) => scope.getByRole('textbox', { name: 'Title' });
const title = () => titleIn(screen);
const publishButton = () =>
  screen.getByRole('button', { name: /action\.publish/i });

describe(
  'AppPublish – Update on a widget of My apps',
  { timeout: 30_000 },
  () => {
    let bridges: ReturnType<typeof installPublishBridges>;
    let sendMessage: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.clearAllMocks();
      getDefaultStore().set(publishedOwnWidgetsAtom, []);
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

    const chooseFiles = async (user: ReturnType<typeof userEvent.setup>) => {
      // Published from this PC before, the form offers its folder again.
      await user.click(
        screen.queryByRole('button', { name: 'Same folder as last time' }) ??
          screen.getByRole('button', { name: 'Choose folder' })
      );
      await screen.findByText('Selected folder: dist');
    };

    /** Changes the title, picks the files and publishes. */
    const publishWithTitle = async (
      user: ReturnType<typeof userEvent.setup>,
      newTitle: string | null,
      publishes: number
    ) => {
      if (newTitle) {
        await user.clear(title());
        await user.type(title(), newTitle);
      }
      await chooseFiles(user);
      await user.click(publishButton());
      await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(publishes));
      await waitFor(() =>
        expect(getDefaultStore().get(publishedOwnWidgetsAtom)).toHaveLength(1)
      );
    };

    /** Changes the title, picks the files and publishes, in one form. */
    const publishIn = async (
      user: ReturnType<typeof userEvent.setup>,
      scope: Scope,
      newTitle: string,
      publishes: number
    ) => {
      await user.clear(titleIn(scope));
      await user.type(titleIn(scope), newTitle);
      await user.click(
        scope.queryByRole('button', { name: 'Same folder as last time' }) ??
          scope.getByRole('button', { name: 'Choose folder' })
      );
      await scope.findByText('Selected folder: dist');
      await user.click(scope.getByRole('button', { name: /action\.publish/i }));
      await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(publishes));
      await waitFor(() =>
        expect(getDefaultStore().get(publishedOwnWidgetsAtom)).toEqual([
          expect.objectContaining({ title: newTitle }),
        ])
      );
    };

    it('fills in what was just published from here, as My apps shows it, not the version the node still lists', async () => {
      const user = userEvent.setup();
      // The node lists the update only once it is confirmed: not in this test.
      mockNode(() => [nowWidget()]);
      const first = renderUpdate('go-widget-now');
      await waitFor(() => expect(title()).toHaveValue('Now'));
      await publishWithTitle(user, 'Now 2', 1);
      first.unmount();

      // My apps shows "Now 2" for it. Update, pressed there again:
      const fromNode = ownWidgetsFrom([nowWidget()], ['TestApp']);
      const shown = withPublishedOwnWidgets(
        fromNode,
        getDefaultStore().get(publishedOwnWidgetsAtom),
        ['TestApp']
      );
      expect(shown.map((widget) => widget.title)).toEqual(['Now 2']);
      renderUpdate('go-widget-now');
      await waitFor(() => expect(title()).toHaveValue('Now 2'));
      expect(screen.getByRole('textbox', { name: 'Tag 2' })).toHaveValue(
        'weather'
      );

      // Published again with other files, it keeps the new title.
      await publishWithTitle(user, null, 2);
      expect(sendMessage.mock.calls[1][1]).toMatchObject({
        identifier: 'go-widget-now',
        title: 'Now 2',
        description: 'The weather now',
        category: 'tools',
        tag1: 'go-widget',
        tag2: 'weather',
      });
    });

    it('fills in the version of the node once it lists a newer one than the publish from here replaced', async () => {
      const user = userEvent.setup();
      let listed = nowWidget();
      mockNode(() => [listed]);
      const first = renderUpdate('go-widget-now');
      await waitFor(() => expect(title()).toHaveValue('Now'));
      await publishWithTitle(user, 'Now 2', 1);
      first.unmount();

      // Published since from another device, and confirmed.
      listed = nowWidget({
        metadata: {
          title: 'Now elsewhere',
          description: 'From the other PC',
          category: 'games',
          tags: ['go-widget'],
        },
        updated: Date.now() + 60_000,
      });
      renderUpdate('go-widget-now');
      await waitFor(() => expect(title()).toHaveValue('Now elsewhere'));
    });

    it("shows an update in My apps in place of the node's version for a widget under any identifier", async () => {
      const user = userEvent.setup();
      mockNode(() => [CLOCK_WIDGET]);
      renderUpdate('clock');
      await waitFor(() => expect(title()).toHaveValue('Clock'));
      await publishWithTitle(user, 'Clock 2', 1);
      expect(sendMessage.mock.calls[0][1]).toMatchObject({
        identifier: 'clock',
        title: 'Clock 2',
      });

      // My apps: the node's answer still has the version it replaced.
      const shown = withPublishedOwnWidgets(
        ownWidgetsFrom([CLOCK_WIDGET], ['TestApp']),
        getDefaultStore().get(publishedOwnWidgetsAtom),
        ['TestApp']
      );
      expect(shown.map((widget) => widget.title)).toEqual(['Clock 2']);
    });

    it("shows an update in My apps in place of the node's version when the node couldn't give the widget's details", async () => {
      const user = userEvent.setup();
      // This PC published it before; now the node fails the search for it.
      bridges.seed(
        {
          address: ADDRESS,
          service: 'APP',
          name: 'TestApp',
          identifier: 'clock',
        },
        {
          publishedAt: 1,
          metadata: {
            title: 'Clock',
            description: 'The time',
            category: 'tools',
            tags: ['go-widget', 'time'],
          },
        }
      );
      mockNode(() => [CLOCK_WIDGET]);
      const answer = global.fetch;
      global.fetch = vi.fn((url: string) =>
        new URL(url).searchParams.get('identifier') === 'clock'
          ? Promise.resolve({ ok: false, json: () => Promise.resolve(null) })
          : answer(url)
      ) as unknown as typeof fetch;
      renderUpdate('clock');
      // Filled in from this PC's last publish.
      await waitFor(() => expect(title()).toHaveValue('Clock'));
      await publishWithTitle(user, 'Clock 2', 1);

      // My apps: the node's answer still has the version it replaced.
      const published = getDefaultStore().get(publishedOwnWidgetsAtom);
      const shown = withPublishedOwnWidgets(
        ownWidgetsFrom([CLOCK_WIDGET], ['TestApp']),
        published,
        ['TestApp']
      );
      expect(shown.map((widget) => widget.title)).toEqual(['Clock 2']);
      // A version the node lists later stands.
      const later = {
        ...CLOCK_WIDGET,
        metadata: { ...CLOCK_WIDGET.metadata, title: 'Clock 3' },
        updated: Date.now() + 60_000,
      };
      expect(
        withPublishedOwnWidgets(
          ownWidgetsFrom([later], ['TestApp']),
          published,
          ['TestApp']
        ).map((widget) => widget.title)
      ).toEqual(['Clock 3']);
    });

    it('keeps a second update in place of the first when another widget is picked while it publishes', async () => {
      const user = userEvent.setup();
      mockNode(() => [nowWidget()]);
      const first = renderUpdate('go-widget-now');
      await waitFor(() => expect(title()).toHaveValue('Now'));
      await publishWithTitle(user, 'Now 2', 1);
      first.unmount();
      const [firstUpdate] = getDefaultStore().get(publishedOwnWidgetsAtom);

      // Publish widget, and that widget picked there: as just published.
      renderForm({ startAsWidget: true });
      await screen.findByRole('dialog', { name: 'Building it as a widget' });
      await user.keyboard('{Escape}');
      const choice = () =>
        screen.getByRole('combobox', { name: 'Widget to publish' });
      await waitFor(() => expect(choice()).toBeInTheDocument());
      fireEvent.mouseDown(choice());
      await user.click(
        await screen.findByRole('option', { name: /go-widget-now/ })
      );
      await waitFor(() => expect(title()).toHaveValue('Now 2'));

      let finishPublish: (value: unknown) => void = () => undefined;
      sendMessage.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishPublish = resolve;
          })
      );
      await user.clear(title());
      await user.type(title(), 'Now 3');
      await chooseFiles(user);
      await user.click(publishButton());
      await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));

      // While it uploads, a new widget is picked instead.
      fireEvent.mouseDown(choice());
      await user.click(
        await screen.findByRole('option', { name: 'A new widget' })
      );
      await screen.findByRole('textbox', { name: 'Widget ID' });
      await act(async () => finishPublish({ signature: '5'.repeat(88) }));
      await waitFor(() =>
        expect(getDefaultStore().get(publishedOwnWidgetsAtom)).toEqual([
          expect.objectContaining({ title: 'Now 3' }),
        ])
      );

      // My apps, once the node lists the first update: the second one shows.
      const listed = nowWidget({
        metadata: { ...nowWidget().metadata, title: 'Now 2' },
        updated: firstUpdate.publishedAt - 1,
      });
      const shown = withPublishedOwnWidgets(
        ownWidgetsFrom([listed], ['TestApp']),
        getDefaultStore().get(publishedOwnWidgetsAtom),
        ['TestApp']
      );
      expect(shown.map((widget) => widget.title)).toEqual(['Now 3']);
    });

    describe('a widget just updated from here', () => {
      it('keeps the update published last in place of an earlier one from another launcher tab once the node lists that one', async () => {
        const user = userEvent.setup();
        let listed = nowWidget();
        mockNode(() => [listed]);
        // Two launcher tabs, each on Update for the same widget.
        render(
          withProviders(
            <>
              <div data-testid="tab-1">{updateForm('go-widget-now')}</div>
              <div data-testid="tab-2">{updateForm('go-widget-now')}</div>
            </>
          )
        );
        const tab1 = within(screen.getByTestId('tab-1'));
        const tab2 = within(screen.getByTestId('tab-2'));
        await waitFor(() => expect(titleIn(tab1)).toHaveValue('Now'));
        await waitFor(() => expect(titleIn(tab2)).toHaveValue('Now'));

        await publishIn(user, tab1, 'Now 2', 1);
        const [first] = getDefaultStore().get(publishedOwnWidgetsAtom);
        await publishIn(user, tab2, 'Now 3', 2);

        // The node lists the first update (its transaction was made before
        // that publish ended); the second is not confirmed yet.
        listed = nowWidget({
          metadata: { ...nowWidget().metadata, title: 'Now 2' },
          updated: first.publishedAt - 1,
        });

        // Update, pressed again in a third launcher tab: the latest publish.
        render(
          withProviders(
            <div data-testid="tab-3">{updateForm('go-widget-now')}</div>
          )
        );
        const tab3 = within(screen.getByTestId('tab-3'));
        await waitFor(() => expect(titleIn(tab3)).not.toHaveValue(''));
        await waitFor(() => expect(titleIn(tab3)).toHaveValue('Now 3'));

        // And My apps' card.
        const shown = withPublishedOwnWidgets(
          ownWidgetsFrom([listed], ['TestApp']),
          getDefaultStore().get(publishedOwnWidgetsAtom),
          ['TestApp']
        );
        expect(shown.map((widget) => widget.title)).toEqual(['Now 3']);
      });

      it('names and marks a retired widget just updated from here as My apps shows it', async () => {
        const user = userEvent.setup();
        // The node lists the update only once it is confirmed: not in this test.
        mockNode(() => [RETIRED_WIDGET]);
        const first = renderUpdate('go-widget-old');
        await waitFor(() => expect(title()).toHaveValue('Old'));
        expect(
          await screen.findByText('Not listed now: publishing lists it again.')
        ).toBeInTheDocument();
        await publishIn(user, screen, 'Old 2', 1);
        first.unmount();

        // My apps: "Old 2", listed again (publishing added the tag).
        const shown = withPublishedOwnWidgets(
          ownWidgetsFrom([RETIRED_WIDGET], ['TestApp']),
          getDefaultStore().get(publishedOwnWidgetsAtom),
          ['TestApp']
        );
        expect(shown).toEqual([
          expect.objectContaining({ title: 'Old 2', listed: true }),
        ]);

        // Update, pressed there again.
        renderUpdate('go-widget-old');
        await waitFor(() => expect(title()).toHaveValue('Old 2'));
        const choice = screen.getByRole('combobox', {
          name: 'Widget to publish',
        });
        // The name's widgets are in.
        await waitFor(() => expect(choice).toHaveTextContent(/Old/));
        expect(screen.getByText('Update Old 2')).toBeInTheDocument();
        expect(choice).toHaveTextContent('Old 2');
        expect(
          screen.queryByText('Not listed now: publishing lists it again.')
        ).not.toBeInTheDocument();
      });

      it("says the details come from this PC when the node can't give the widget's details after an update from here", async () => {
        const user = userEvent.setup();
        mockNode(() => [nowWidget()]);
        const first = renderUpdate('go-widget-now');
        await waitFor(() => expect(title()).toHaveValue('Now'));
        await publishIn(user, screen, 'Now 2', 1);
        first.unmount();
        vi.mocked(executeEvent).mockClear();

        // Update again; now the node fails the search for the widget.
        const answer = global.fetch;
        global.fetch = vi.fn((url: string) =>
          new URL(url).searchParams.get('identifier') === 'go-widget-now'
            ? Promise.resolve({ ok: false, json: () => Promise.resolve(null) })
            : answer(url)
        ) as unknown as typeof fetch;
        renderUpdate('go-widget-now');
        await waitFor(() => expect(title()).toHaveValue('Now 2'));

        // As for any update the node couldn't load: filled in from this PC.
        await waitFor(() =>
          expect(executeEvent).toHaveBeenCalledWith(
            'openGlobalSnackBar',
            expect.objectContaining({
              type: 'warning',
              message: expect.stringMatching(
                /filled_from_profile|app_details_unavailable/
              ),
            })
          )
        );
      });
    });
  }
);
