import React, { createContext, useImperativeHandle, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

// The strings under test are real; the rest render as their keys.
i18n.use(capitalizeFirstChar as never).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: {
      core: {
        app_page: {
          edit: {
            error_shot_unavailable: 'a screenshot could not be read',
            error_shots_changed: 'the screenshots were replaced',
          },
          publish: {
            confirm_retry: 'publish the rest of the page?',
            left_page: 'page text not published: {{error}}',
            left_shots: 'screenshots not published: {{error}}',
          },
        },
        message: {
          error: { generic: 'an error occurred' },
          success: { published: 'published' },
        },
      },
    },
  },
});

const mocks = vi.hoisted(() => ({
  show: vi.fn(),
  prepare: vi.fn(),
  checkExtras: vi.fn(),
  publishExtras: vi.fn(),
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
}));
vi.mock('../../Snackbar/Snackbar', () => ({
  CustomizedSnackbars: ({ open, info }: any) =>
    open && info ? <div data-testid="snack">{info.message}</div> : null,
}));
// The page part itself has its own tests: here it hands over one page part.
vi.mock('../AppPage/PublishPageExtras', () => ({
  PublishPageExtras: React.forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({
      prepare: mocks.prepare,
      hasDrafts: () => ({ page: false, shots: false }),
    }));
    return null;
  }),
  extrasPartCount: (extras: any) =>
    (extras?.shots ? 1 : 0) + (extras?.page ? 1 : 0),
  checkPageExtras: (...args: unknown[]) => mocks.checkExtras(...args),
  publishPageExtras: (...args: unknown[]) => mocks.publishExtras(...args),
}));

import { AppPublish } from '../AppPublish';
import { executeEvent } from '../../../utils/events';
import { AppPageError } from '../AppPage/appPageQdn';
import {
  infoSnackGlobalAtom,
  openSnackGlobalAtom,
} from '../../../atoms/global';

const SHOT = {
  id: 'a',
  url: 'blob:a',
  caption: 'One',
  blob: new Blob([new Uint8Array([1, 2])]),
};

const PAGE_PART = {
  page: {
    about: 'Story',
    whatsNew: 'Faster',
    version: '2.0',
    links: {},
    appSignature: '',
    updated: 0,
  },
  shots: null,
};

let store: ReturnType<typeof createStore>;
/** What Hub's own snackbar was told to show, if it was opened. */
const globalSnack = () =>
  store.get(openSnackGlobalAtom) ? store.get(infoSnackGlobalAtom) : null;

/** The library shows the form until a tab opens, as AppsDesktop does. */
let closeForm: (() => void) | null = null;
const Library = (props: Partial<React.ComponentProps<typeof AppPublish>>) => {
  const [publishing, setPublishing] = useState(true);
  closeForm = () => setPublishing(false);
  return publishing ? (
    <AppPublish
      categories={[{ id: 'games', name: 'Games' }]}
      initialAppType="APP"
      initialName="TestApp"
      myAddress="QOwner"
      myName="TestApp"
      {...props}
    />
  ) : null;
};

const renderForm = (
  props: Partial<React.ComponentProps<typeof AppPublish>> = {}
) => {
  global.fetch = vi.fn((url: string) =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve(
          url.includes('/names/address/')
            ? [{ name: 'TestApp' }]
            : [
                {
                  name: 'TestApp',
                  service: 'APP',
                  metadata: {
                    title: 'My App',
                    description: 'A great app',
                    category: 'games',
                  },
                },
              ]
        ),
    })
  ) as unknown as typeof fetch;
  store = createStore();
  render(
    <Provider store={store}>
      <ThemeProvider theme={createTheme()}>
        <I18nextProvider i18n={i18n}>
          <Library {...props} />
        </I18nextProvider>
      </ThemeProvider>
    </Provider>
  );
};

const publish = async () => {
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('My App')
  );
  act(() => {
    mocks.onDrop?.([
      new File([new Uint8Array([80, 75, 3, 4])], 'app.zip', {
        type: 'application/zip',
      }),
    ]);
  });
  const buttons = screen.getAllByRole('button', { name: /action\.publish/i });
  const button = buttons[buttons.length - 1];
  await waitFor(() => expect(button).toBeEnabled());
  await act(async () => {
    fireEvent.click(button);
  });
};

describe('publishing the app with its page', () => {
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.show.mockResolvedValue(undefined);
    mocks.prepare.mockReturnValue(PAGE_PART);
    mocks.checkExtras.mockResolvedValue(undefined);
    mocks.publishExtras.mockResolvedValue(null);
    vi.mocked(executeEvent).mockImplementation((name: string) => {
      if (name === 'addTab') closeForm?.();
    });
    sendMessage = vi.fn(async () => ({ signature: 'APP-SIG' }));
    window.sendMessage = sendMessage as unknown as typeof window.sendMessage;
  });

  it('asks for both fees, then publishes the page with the new signature', async () => {
    renderForm();
    await publish();

    await waitFor(() => expect(mocks.publishExtras).toHaveBeenCalledTimes(1));
    expect(mocks.show).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/confirm_with_page/),
        publishFee: '0.02 QORT',
      })
    );
    expect(sendMessage).toHaveBeenCalledWith(
      'publishOnQDN',
      expect.objectContaining({ name: 'TestApp', service: 'APP' })
    );
    expect(mocks.publishExtras).toHaveBeenCalledWith(
      { service: 'APP', name: 'TestApp' },
      PAGE_PART,
      'APP-SIG',
      expect.any(Function)
    );
    // The page goes after the app.
    expect(sendMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.publishExtras.mock.invocationCallOrder[0]
    );
  });

  it('warns in words when a page part fails, and keeps the form open', async () => {
    mocks.publishExtras.mockResolvedValue({
      extras: { page: null, shots: [SHOT] },
      error: new AppPageError('SHOT_UNAVAILABLE'),
    });
    renderForm();
    await publish();

    await waitFor(() =>
      expect(globalSnack()).toEqual({
        type: 'warning',
        message: 'Screenshots not published: a screenshot could not be read',
      })
    );
    // The app is out; what didn't go out stays in the form to publish again.
    expect(executeEvent).not.toHaveBeenCalledWith('addTab', expect.anything());
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it("publishes only the parts left on Retry, with the app's signature", async () => {
    mocks.prepare.mockReturnValue({
      ...PAGE_PART,
      shots: [SHOT],
      pageWasRead: true,
    });
    mocks.publishExtras.mockResolvedValueOnce({
      extras: { page: PAGE_PART.page, shots: null, pageWasRead: true },
      error: new Error('Insufficient balance'),
    });
    renderForm();
    await publish();
    await waitFor(() =>
      expect(globalSnack()?.message).toBe(
        'Page text not published: Insufficient balance'
      )
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });
    await waitFor(() => expect(mocks.publishExtras).toHaveBeenCalledTimes(2));
    expect(mocks.show).toHaveBeenLastCalledWith({
      message: 'Publish the rest of the page?',
      publishFee: '0.01 QORT',
    });
    expect(mocks.publishExtras).toHaveBeenLastCalledWith(
      { service: 'APP', name: 'TestApp' },
      { page: PAGE_PART.page, shots: null, pageWasRead: true },
      'APP-SIG',
      expect.any(Function)
    );
    // The app itself went out once.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(executeEvent).toHaveBeenCalledWith('addTab', expect.anything())
    );
  });

  it("stops before the fee when the page part's screenshots can't go, and says why", async () => {
    mocks.prepare.mockReturnValue({ ...PAGE_PART, shots: [SHOT] });
    mocks.checkExtras.mockRejectedValue(new AppPageError('SHOTS_CHANGED'));
    renderForm();
    await publish();

    await waitFor(() =>
      expect(screen.getByTestId('snack')).toHaveTextContent(
        'The screenshots were replaced'
      )
    );
    expect(mocks.checkExtras).toHaveBeenCalledWith(
      { service: 'APP', name: 'TestApp' },
      { ...PAGE_PART, shots: [SHOT] },
      expect.any(Function)
    );
    // Nothing to confirm, and nothing sent.
    expect(mocks.show).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(mocks.publishExtras).not.toHaveBeenCalled();
  });

  it('checks the screenshots again before the fee of a Retry', async () => {
    mocks.prepare.mockReturnValue({ ...PAGE_PART, shots: [SHOT] });
    mocks.publishExtras.mockResolvedValueOnce({
      extras: { page: null, shots: [SHOT] },
      error: new AppPageError('SHOTS_CHANGED'),
    });
    renderForm();
    await publish();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    );
    mocks.show.mockClear();
    mocks.checkExtras.mockRejectedValue(new AppPageError('SHOTS_CHANGED'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });
    await waitFor(() =>
      expect(screen.getByTestId('snack')).toHaveTextContent(
        'The screenshots were replaced'
      )
    );
    expect(mocks.checkExtras).toHaveBeenLastCalledWith(
      { service: 'APP', name: 'TestApp' },
      { page: null, shots: [SHOT], pageWasRead: undefined },
      expect.any(Function)
    );
    expect(mocks.show).not.toHaveBeenCalled();
    expect(mocks.publishExtras).toHaveBeenCalledTimes(1);
    // What's left stays to try again.
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it('says the app was published once the form has closed', async () => {
    renderForm();
    await publish();

    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull()
    );
    expect(globalSnack()).toEqual({ type: 'success', message: 'Published' });
  });

  it('says something even when the failure has no message', async () => {
    mocks.publishExtras.mockResolvedValue({
      extras: PAGE_PART,
      error: new Error(''),
    });
    renderForm();
    await publish();

    await waitFor(() =>
      expect(globalSnack()?.message).toBe(
        'Page text not published: an error occurred'
      )
    );
  });

  describe('when the form closes while the page parts go out', () => {
    it('does not open the app, and still says it was published', async () => {
      let pageDone: () => void = () => {};
      mocks.publishExtras.mockReturnValue(
        new Promise<null>((resolve) => (pageDone = () => resolve(null)))
      );
      const onUnsavedChange = vi.fn();
      renderForm({ onUnsavedChange });
      await publish();

      // The app is out and its page is still being published: the tab asks
      // before it closes, and the user closes it anyway.
      await waitFor(() => expect(mocks.publishExtras).toHaveBeenCalledTimes(1));
      expect(onUnsavedChange).toHaveBeenLastCalledWith(true);
      act(() => closeForm?.());
      await act(async () => {
        pageDone();
      });

      // Nothing opens in a new tab and takes the selection.
      expect(executeEvent).not.toHaveBeenCalledWith(
        'addTab',
        expect.anything()
      );
      expect(globalSnack()).toEqual({ type: 'success', message: 'Published' });
    });
  });
});
