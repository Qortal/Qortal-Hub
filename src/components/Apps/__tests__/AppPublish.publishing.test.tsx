import React, { createContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { createStore, Provider } from 'jotai';
import { capitalizeFirstChar } from '../../../i18n/processors';
import enCore from '../../../i18n/locales/en/core.json';

// The page part's own words are real; the rest render as their keys.
i18n.use(capitalizeFirstChar as never).init({
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  resources: {
    en: {
      core: {
        app_page: {
          edit: enCore.app_page.edit,
          publish: enCore.app_page.publish,
        },
        message: { error: { missing_fields: 'missing: {{fields}}' } },
      },
    },
  },
});

const mocks = vi.hoisted(() => ({
  show: vi.fn(),
  onDrop: null as null | ((files: File[]) => void),
}));

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
  QORTAL_APP_CONTEXT: createContext({
    show: (...args: unknown[]) => mocks.show(...args),
  }),
}));
vi.mock('../../../utils/events', () => ({ executeEvent: vi.fn() }));
vi.mock('react-dropzone', () => ({
  useDropzone: (options: { onDrop: (files: File[]) => void }) => {
    mocks.onDrop = options.onDrop;
    return { getRootProps: () => ({}), getInputProps: () => ({}) };
  },
}));
vi.mock('../../../background/background.ts', () => ({
  getFee: vi.fn().mockResolvedValue({ fee: '0.01' }),
  createEndpoint: vi.fn(async (path: string) => `http://localhost${path}`),
}));
vi.mock('../AppViewerContainer', () => ({ default: () => null }));
vi.mock('../AppPage/screenshotImage', () => ({
  MAX_IMAGE_FILE_BYTES: 15 * 1024 * 1024,
  encodeScreenshot: vi.fn(async () => ({
    blob: new Blob([new Uint8Array([7])], { type: 'image/webp' }),
    width: 1600,
    height: 1000,
  })),
}));

import { AppPublish } from '../AppPublish';
import { executeEvent } from '../../../utils/events';
import {
  infoSnackGlobalAtom,
  openSnackGlobalAtom,
} from '../../../atoms/global';

const SIGNATURE =
  '5HaYMw82wjG8k2Ddq6ccr7hDcjz58hK2GjhFzVbSKMFDE8hRqkG3QXQrNNLmmKZN';

const pageWith = (about: string) => ({
  v: 1,
  about,
  whatsNew: 'Old notes',
  version: '1.4.2',
  links: { website: 'https://my.app/' },
  updated: 1,
});

interface NodeShots {
  signature: string;
  manifest: unknown;
  files: Record<string, number[]>;
}

/** What the node holds; a test changes it as it goes. */
const node = {
  page: null as unknown,
  pageStatus: 'READY',
  shots: null as NodeShots | null,
  shotsStatus: 'READY',
  /** The search for the page's parts fails. */
  partsSearchDown: false,
};
/** Holds the next search for the page's parts until it is released. */
let holdNextPartsSearch = false;
let releasePartsSearch: (() => void) | null = null;
/** Holds the app's own upload until it is released. */
let holdAppUpload = false;
let releaseAppUpload: (() => void) | null = null;

const mockNode = () => {
  const json = (value: unknown) => new Response(JSON.stringify(value));
  global.fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/names/address/')) return json([{ name: 'TestApp' }]);
    if (url.includes('identifier=qhub_app_')) {
      if (node.partsSearchDown) return new Response('', { status: 500 });
      if (holdNextPartsSearch) {
        holdNextPartsSearch = false;
        await new Promise<void>((resolve) => {
          releasePartsSearch = resolve;
        });
      }
      return json([
        ...(node.page
          ? [
              {
                name: 'TestApp',
                service: 'JSON',
                identifier: 'qhub_app_page_v1_APP',
                latestSignature: 'P',
              },
            ]
          : []),
        ...(node.shots
          ? [
              {
                name: 'TestApp',
                service: 'IMAGE',
                identifier: 'qhub_app_shots_v1_APP',
                latestSignature: node.shots.signature,
              },
            ]
          : []),
      ]);
    }
    if (url.includes('/resource/status/JSON/'))
      return json({ status: node.pageStatus });
    if (url.includes('/resource/status/IMAGE/'))
      return json({ status: node.shotsStatus });
    if (url.includes('/resource/status/')) return json({ status: 'READY' });
    if (url.includes('/arbitrary/JSON/')) return json(node.page);
    if (url.includes('/arbitrary/IMAGE/')) {
      const file = new URL(url).searchParams.get('filepath');
      if (!node.shots) return new Response('', { status: 404 });
      if (file === 'shots.json') return json(node.shots.manifest);
      const bytes = file ? node.shots.files[file] : null;
      return bytes
        ? new Response(new Uint8Array(bytes))
        : new Response('', { status: 404 });
    }
    if (url.includes('/arbitrary/resources/search'))
      return json([
        {
          name: 'TestApp',
          service: 'APP',
          metadata: {
            title: 'My App',
            description: 'A great app',
            category: 'games',
          },
        },
      ]);
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;
};

let store: ReturnType<typeof createStore>;
/** What Hub's own snackbar was told to show, if it was opened. */
const globalSnack = () =>
  store.get(openSnackGlobalAtom) ? store.get(infoSnackGlobalAtom) : null;

/** What the form last told its launcher tab about unsaved input. */
let unsaved = false;

const renderForm = (
  props: Partial<React.ComponentProps<typeof AppPublish>> = {}
) => {
  store = createStore();
  return render(
    <Provider store={store}>
      <ThemeProvider theme={createTheme()}>
        <I18nextProvider i18n={i18n}>
          <AppPublish
            categories={[{ id: 'games', name: 'Games' }]}
            initialAppType="APP"
            initialName="TestApp"
            isAppTypeLocked
            isUpdate
            myAddress="QOwner"
            myName="TestApp"
            onUnsavedChange={(value) => {
              unsaved = value;
            }}
            {...props}
          />
        </I18nextProvider>
      </ThemeProvider>
    </Provider>
  );
};

const title = () => screen.getByRole('textbox', { name: 'Title' });
const version = () => screen.getByLabelText(/app_page\.details\.version/i);
const whatsNew = () => screen.getByLabelText(/app_page\.whats_new\.title/i);

/** The form is filled in from the node and the app's page has been read. */
const formReady = async () => {
  await waitFor(() => expect(title()).toHaveValue('My App'));
  await waitFor(() => expect(version()).toBeEnabled());
  await waitFor(() =>
    expect(screen.queryByText(/loading the app's current page/i)).toBeNull()
  );
};

const chooseZip = () =>
  act(() => {
    mocks.onDrop?.([
      new File([new Uint8Array([80, 75, 3, 4])], 'app.zip', {
        type: 'application/zip',
      }),
    ]);
  });

const pressPublish = async () => {
  const button = screen.getByRole('button', { name: /action\.publish/i });
  await waitFor(() => expect(button).toBeEnabled());
  await act(async () => {
    fireEvent.click(button);
  });
};

const errorsShown = () =>
  vi
    .mocked(executeEvent)
    .mock.calls.filter(
      ([name, payload]) =>
        name === 'openGlobalSnackBar' && (payload as any)?.type === 'error'
    );

const addTabCalls = () =>
  vi.mocked(executeEvent).mock.calls.filter(([name]) => name === 'addTab');

const twoShots = (): NodeShots => ({
  signature: 'S1',
  manifest: {
    v: 1,
    shots: [
      { file: '1.webp', caption: 'Home' },
      { file: '2.webp', caption: 'Editor' },
    ],
    updated: 1,
  },
  files: { '1.webp': [1, 1], '2.webp': [2, 2] },
});

describe('the publish form, against the node', () => {
  let sendMessage: ReturnType<typeof vi.fn>;
  const published = (service: string) =>
    sendMessage.mock.calls
      .filter(
        ([action, payload]) =>
          action === 'publishOnQDN' && payload?.service === service
      )
      .map(([, payload]) => payload);
  const publishedVersions = () =>
    published('JSON').map((payload) => JSON.parse(atob(payload.data)).version);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.show.mockResolvedValue(undefined);
    node.page = null;
    node.pageStatus = 'READY';
    node.shots = null;
    node.shotsStatus = 'READY';
    node.partsSearchDown = false;
    holdNextPartsSearch = false;
    releasePartsSearch = null;
    holdAppUpload = false;
    releaseAppUpload = null;
    unsaved = false;
    window.electronAPI = undefined as any;
    URL.createObjectURL = vi.fn(() => 'blob:picture');
    URL.revokeObjectURL = vi.fn();
    mockNode();
    sendMessage = vi.fn(async (_action: string, payload: any) => {
      if (holdAppUpload && payload?.service === 'APP') {
        await new Promise<void>((resolve) => {
          releaseAppUpload = resolve;
        });
      }
      return { signature: SIGNATURE };
    });
    window.sendMessage = sendMessage as unknown as typeof window.sendMessage;
  });

  afterEach(() => {
    delete window.sendMessage;
  });

  describe('what Publish counts as filled in', () => {
    it('does not publish a title of spaces, which its checklist shows as missing', async () => {
      renderForm();
      await formReady();
      chooseZip();
      fireEvent.change(title(), { target: { value: '   ' } });

      await pressPublish();
      await waitFor(() =>
        expect(mocks.show.mock.calls.length + errorsShown().length).toBe(1)
      );
      // Nothing to confirm and nothing sent: the title is still to fill in.
      expect(mocks.show).not.toHaveBeenCalled();
      expect(published('APP')).toHaveLength(0);
      expect(errorsShown()[0][1]).toMatchObject({
        message: 'Missing: Publish_form.check_title',
      });
    });

    it('does not publish a description of spaces either', async () => {
      renderForm();
      await formReady();
      chooseZip();
      fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), {
        target: { value: '  ' },
      });

      await pressPublish();
      await waitFor(() =>
        expect(mocks.show.mock.calls.length + errorsShown().length).toBe(1)
      );
      expect(mocks.show).not.toHaveBeenCalled();
      expect(published('APP')).toHaveLength(0);
    });
  });

  describe('the page text, read again when it is published', () => {
    it('keeps an About saved elsewhere since the form read the page', async () => {
      node.page = pageWith('Story');
      renderForm();
      await formReady();
      chooseZip();

      // The page is edited meanwhile: on the app's page in another tab, or on
      // another device.
      node.page = pageWith('A longer story');
      fireEvent.change(version(), { target: { value: '2.0' } });

      await pressPublish();
      await waitFor(() => expect(published('JSON')).toHaveLength(1));
      const page = JSON.parse(atob(published('JSON')[0].data));
      expect(page).toMatchObject({
        about: 'A longer story',
        version: '2.0',
        appSignature: SIGNATURE,
      });
      // The app went first.
      expect(published('APP')).toHaveLength(1);
    });

    it("publishes the app alone, and says why, when the page can't be read by then", async () => {
      node.page = pageWith('Story');
      renderForm();
      await formReady();
      chooseZip();

      // A newer page is listed meanwhile, which the node can't build.
      node.page = pageWith('A longer story');
      node.pageStatus = 'BUILD_FAILED';
      fireEvent.change(version(), { target: { value: '2.0' } });

      await pressPublish();
      await waitFor(() =>
        expect(globalSnack()).toEqual({
          type: 'warning',
          message:
            "The app was published, but its page text wasn't: " +
            enCore.app_page.edit.error_page_unverified,
        })
      );
      expect(published('APP')).toHaveLength(1);
      expect(published('JSON')).toHaveLength(0);
    });

    it("publishes no page text when the node can't say what the page has by then", async () => {
      node.page = pageWith('Story');
      renderForm();
      await formReady();
      chooseZip();
      fireEvent.change(version(), { target: { value: '2.0' } });

      // The page could have been edited meanwhile, and the node's search for
      // it fails now.
      node.partsSearchDown = true;
      await pressPublish();
      await waitFor(() => expect(globalSnack()?.type).toBe('warning'));

      // The form's copy of About and links isn't published over it.
      expect(published('APP')).toHaveLength(1);
      expect(published('JSON')).toHaveLength(0);
      expect(globalSnack()!.message).toBe(
        "The app was published, but its page text wasn't: " +
          enCore.app_page.edit.error_page_unverified
      );
      // The form says so where its Publish is, and keeps the version typed.
      expect(screen.getByRole('alert')).toHaveTextContent(
        enCore.app_page.edit.error_page_unverified
      );
      expect(version()).toHaveValue('2.0');
      expect(unsaved).toBe(true);
      expect(addTabCalls()).toHaveLength(0);
    });
  });

  describe('its launcher tab, while the page parts go out', () => {
    it('keeps the tab asking before it closes until the page parts are published', async () => {
      renderForm();
      await formReady();
      chooseZip();
      fireEvent.change(version(), { target: { value: '1.0' } });

      // The node is slow to say what the page has when the page part starts.
      holdNextPartsSearch = true;
      await pressPublish();
      await waitFor(() => expect(published('APP')).toHaveLength(1));
      await waitFor(() => expect(releasePartsSearch).not.toBeNull());

      // The app is out and its page part is not: closing the tab still asks.
      expect(unsaved).toBe(true);
      expect(addTabCalls()).toHaveLength(0);

      await act(async () => {
        releasePartsSearch!();
      });
      await waitFor(() => expect(addTabCalls()).toHaveLength(1));
      expect(publishedVersions()).toEqual(['1.0']);
      expect(unsaved).toBe(false);
    });
  });

  describe('while the app uploads', () => {
    beforeEach(() => {
      holdAppUpload = true;
    });

    it('keeps input typed meanwhile, instead of opening the app without it', async () => {
      node.page = pageWith('Story');
      renderForm();
      await formReady();
      chooseZip();
      fireEvent.change(version(), { target: { value: '2.0' } });
      await pressPublish();
      await waitFor(() => expect(releaseAppUpload).not.toBeNull());

      fireEvent.change(whatsNew(), { target: { value: 'Faster start' } });
      await act(async () => {
        releaseAppUpload!();
      });
      await waitFor(() => expect(globalSnack()?.type).toBe('success'));

      // The page went out as it was when Publish was pressed: the line typed
      // meanwhile stays with the form, unsaved.
      expect(JSON.parse(atob(published('JSON')[0].data)).whatsNew).toBe('');
      expect(whatsNew()).toHaveValue('Faster start');
      expect(unsaved).toBe(true);
      expect(addTabCalls()).toHaveLength(0);
    });

    it('keeps the name and type of the app being published', async () => {
      renderForm({ isAppTypeLocked: false, isUpdate: false });
      await formReady();
      const name = screen.getByRole('combobox', { name: /name_app/i });
      const type = screen.getByRole('button', { name: /website/i });
      const widget = screen.getByRole('button', { name: /type_widget/i });
      chooseZip();
      await pressPublish();
      await waitFor(() => expect(releaseAppUpload).not.toBeNull());

      // Another name or type would put another app's page in the form while
      // this one's page parts are still to go out.
      expect(name).toHaveAttribute('aria-disabled', 'true');
      expect(type).toBeDisabled();
      expect(widget).toBeDisabled();

      await act(async () => {
        releaseAppUpload!();
      });
      await waitFor(() => expect(addTabCalls()).toHaveLength(1));
      expect(name).not.toHaveAttribute('aria-disabled');
      expect(type).toBeEnabled();
      expect(widget).toBeEnabled();
    });
  });

  describe('what it says when a page part fails', () => {
    /** An update with a new version and a changed screenshot caption. */
    const publishVersionAndCaption = async () => {
      node.page = pageWith('Story');
      node.shots = twoShots();
      renderForm();
      await formReady();
      await screen.findByRole('radio', {
        name: /keep the current 2 screenshots/i,
      });
      fireEvent.change(version(), { target: { value: '2.0' } });
      fireEvent.click(
        screen.getByRole('radio', { name: /change the screenshots/i })
      );
      fireEvent.change(
        screen.getAllByRole('textbox', {
          name: /app_page\.screenshots\.caption/i,
        })[0],
        { target: { value: 'Start' } }
      );
      chooseZip();
      await pressPublish();
      await waitFor(() => expect(globalSnack()).not.toBeNull());
    };

    /** The node turns down publishes of one service until told otherwise. */
    const failing = (service: string) => {
      let down = true;
      sendMessage.mockImplementation(async (_action, payload) =>
        down && payload?.service === service
          ? { error: 'Insufficient balance' }
          : { signature: SIGNATURE }
      );
      return () => {
        down = false;
      };
    };
    const captions = () =>
      screen
        .getAllByRole('textbox', { name: /app_page\.screenshots\.caption/i })
        .map((field) => (field as HTMLInputElement).value);
    const pressRetry = async () => {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      });
    };

    it('says only the screenshots failed when the page text went out', async () => {
      // The third publish of the confirmed three fails at the node.
      failing('IMAGE');
      await publishVersionAndCaption();

      expect(publishedVersions()).toEqual(['2.0']);
      expect(published('IMAGE')).toHaveLength(1);
      expect(globalSnack()).toEqual({
        type: 'warning',
        message:
          "The app was published, but its screenshots weren't: " +
          'Insufficient balance',
      });
    });

    it('still publishes the screenshots when the page text failed', async () => {
      failing('JSON');
      await publishVersionAndCaption();

      expect(published('IMAGE')).toHaveLength(1);
      expect(globalSnack()).toEqual({
        type: 'warning',
        message:
          "The app was published, but its page text wasn't: " +
          'Insufficient balance',
      });
    });

    it('keeps what failed in the form, unsaved, instead of opening the app', async () => {
      failing('IMAGE');
      await publishVersionAndCaption();

      // The caption that didn't go out is still there to publish.
      expect(captions()).toEqual(['Start', 'Editor']);
      expect(unsaved).toBe(true);
      expect(addTabCalls()).toHaveLength(0);
      expect(screen.getByRole('alert')).toHaveTextContent(
        enCore.app_page.publish.left_hint
      );
    });

    it('publishes only what failed on Retry, then opens the app', async () => {
      const recover = failing('IMAGE');
      await publishVersionAndCaption();
      recover();
      mocks.show.mockClear();

      await pressRetry();
      await waitFor(() => expect(published('IMAGE')).toHaveLength(2));

      // One more publish to confirm: the screenshots, not the app again.
      expect(mocks.show).toHaveBeenCalledTimes(1);
      expect(mocks.show).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Publish what's left of the app's page, without the app?",
          publishFee: '0.01 QORT',
        })
      );
      expect(published('APP')).toHaveLength(1);
      expect(published('JSON')).toHaveLength(1);
      await waitFor(() => expect(addTabCalls()).toHaveLength(1));
      expect(unsaved).toBe(false);
      expect(globalSnack()?.type).toBe('success');
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it("publishes a fix made to the part that failed, with the first app's signature", async () => {
      const recover = failing('JSON');
      await publishVersionAndCaption();
      recover();
      sendMessage.mockImplementation(async () => ({ signature: 'OTHER' }));

      fireEvent.change(version(), { target: { value: '2.1' } });
      await pressRetry();
      await waitFor(() => expect(published('JSON')).toHaveLength(2));

      const page = JSON.parse(atob(published('JSON')[1].data));
      // Its version describes the upload already published.
      expect(page).toMatchObject({ version: '2.1', appSignature: SIGNATURE });
      expect(published('APP')).toHaveLength(1);
      expect(published('IMAGE')).toHaveLength(1);
      // The fix went out with it: nothing is left unsaved.
      await waitFor(() => expect(addTabCalls()).toHaveLength(1));
      expect(unsaved).toBe(false);
    });

    it('stays open with input that Retry did not publish', async () => {
      const recover = failing('IMAGE');
      await publishVersionAndCaption();
      recover();

      fireEvent.change(title(), { target: { value: 'My App 2' } });
      await pressRetry();
      await waitFor(() => expect(published('IMAGE')).toHaveLength(2));

      // The new title isn't published: the form keeps it, and still asks
      // before its tab closes.
      expect(title()).toHaveValue('My App 2');
      expect(unsaved).toBe(true);
      expect(addTabCalls()).toHaveLength(0);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('takes a declined Retry as no error, and keeps what is left', async () => {
      const recover = failing('IMAGE');
      await publishVersionAndCaption();
      recover();
      mocks.show.mockRejectedValueOnce({ isCanceled: true });

      await pressRetry();

      expect(published('IMAGE')).toHaveLength(1);
      // The app is published: no "unable to publish the app".
      expect(errorsShown()).toHaveLength(0);
      expect(screen.getByRole('alert')).toHaveTextContent(
        enCore.app_page.publish.left_hint
      );
      expect(unsaved).toBe(true);
    });

    it('keeps the name and type that the parts left belong to', async () => {
      failing('IMAGE');
      node.page = pageWith('Story');
      node.shots = twoShots();
      renderForm({ isAppTypeLocked: false, isUpdate: false });
      await formReady();
      const name = screen.getByRole('combobox', { name: /name_app/i });
      const type = screen.getByRole('button', { name: /website/i });
      expect(name).not.toHaveAttribute('aria-disabled');
      expect(type).toBeEnabled();
      await screen.findByRole('radio', {
        name: /keep the current 2 screenshots/i,
      });
      fireEvent.click(
        screen.getByRole('radio', { name: /change the screenshots/i })
      );
      fireEvent.change(
        screen.getAllByRole('textbox', {
          name: /app_page\.screenshots\.caption/i,
        })[0],
        { target: { value: 'Start' } }
      );
      chooseZip();
      await pressPublish();
      await waitFor(() => expect(globalSnack()?.type).toBe('warning'));

      // Another name or type would read another page over the parts kept.
      expect(name).toHaveAttribute('aria-disabled', 'true');
      expect(type).toBeDisabled();
    });
  });
});
