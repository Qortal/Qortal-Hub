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
          edit: { error_shot_unavailable: 'a screenshot could not be read' },
          publish: { extras_failed: 'page not updated: {{error}}' },
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
    useImperativeHandle(ref, () => ({ prepare: mocks.prepare }));
    return null;
  }),
  extrasPartCount: (extras: any) =>
    (extras?.shots ? 1 : 0) + (extras?.page ? 1 : 0),
  publishPageExtras: (...args: unknown[]) => mocks.publishExtras(...args),
}));

import { AppPublish } from '../AppPublish';
import { executeEvent } from '../../../utils/events';
import { AppPageError } from '../AppPage/appPageQdn';
import {
  infoSnackGlobalAtom,
  openSnackGlobalAtom,
} from '../../../atoms/global';

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
    mocks.publishExtras.mockResolvedValue(undefined);
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
      'APP-SIG'
    );
    // The page goes after the app.
    expect(sendMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.publishExtras.mock.invocationCallOrder[0]
    );
  });

  it("warns in words when the page fails, and still counts the app's publish", async () => {
    mocks.publishExtras.mockRejectedValue(new AppPageError('SHOT_UNAVAILABLE'));
    renderForm();
    await publish();

    await waitFor(() =>
      expect(globalSnack()).toEqual({
        type: 'warning',
        message: 'Page not updated: a screenshot could not be read',
      })
    );
    expect(executeEvent).toHaveBeenCalledWith(
      'addTab',
      expect.objectContaining({
        data: expect.objectContaining({ name: 'TestApp', service: 'APP' }),
      })
    );
    // The form closed as the app opened: Hub's own snackbar shows it.
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
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
    mocks.publishExtras.mockRejectedValue(new Error(''));
    renderForm();
    await publish();

    await waitFor(() =>
      expect(globalSnack()?.message).toBe('Page not updated: an error occurred')
    );
  });

  describe('when the form closes while the page parts go out', () => {
    it('does not open the app, and still says it was published', async () => {
      let pageDone: () => void = () => {};
      mocks.publishExtras.mockReturnValue(
        new Promise<void>((resolve) => (pageDone = resolve))
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
