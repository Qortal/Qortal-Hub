import React, { createContext, createRef } from 'react';
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

i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { core: {} } } });

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://node',
  QORTAL_APP_CONTEXT: createContext({ show: vi.fn() }),
}));
vi.mock('../../../background/background', () => ({
  createEndpoint: vi.fn(async (path: string) => `http://node${path}`),
}));
vi.mock('../AppViewerContainer', () => ({ default: () => null }));
vi.mock('./screenshotImage', () => ({
  MAX_IMAGE_FILE_BYTES: 15 * 1024 * 1024,
  encodeScreenshot: vi.fn(async () => ({
    blob: new Blob([new Uint8Array([7])], { type: 'image/webp' }),
    width: 1600,
    height: 1000,
  })),
}));

import {
  extrasPartCount,
  PublishExtrasHandle,
  PublishPageExtras,
  publishPageExtras,
  screenshotsToPublish,
} from './PublishPageExtras';
import type { ShotDraft } from './ScreenshotsEditor';

const SIG = '5HaYMw82wjG8k2Ddq6ccr7hDcjz58hK2GjhFzVbSKMFDE8hRqkG3QXQrNNLmmKZN';

const TWO_SHOTS = {
  v: 1,
  shots: [
    { file: '1.webp', caption: 'Home' },
    { file: '2.webp', caption: '' },
  ],
  updated: 1,
};

const nodeWith = (page: unknown, shots: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const json = (value: unknown) => new Response(JSON.stringify(value));
    if (url.includes('identifier=qhub_app_'))
      return json([
        ...(page
          ? [
              {
                name: 'MyApp',
                service: 'JSON',
                identifier: 'qhub_app_page_v1_APP',
                latestSignature: 'P',
              },
            ]
          : []),
        ...(shots
          ? [
              {
                name: 'MyApp',
                service: 'IMAGE',
                identifier: 'qhub_app_shots_v1_APP',
                latestSignature: 'S',
              },
            ]
          : []),
      ]);
    if (url.includes('/resource/status/')) return json({ status: 'READY' });
    if (url.includes('/arbitrary/JSON/')) return json(page);
    if (url.includes('filepath=shots.json')) return json(shots);
    return new Response('', { status: 404 });
  });

const renderExtras = (file: Blob | null = null, name = 'MyApp') => {
  const ref = createRef<PublishExtrasHandle>();
  render(
    <ThemeProvider theme={createTheme()}>
      <I18nextProvider i18n={i18n}>
        <PublishPageExtras file={file} name={name} ref={ref} service="APP" />
      </I18nextProvider>
    </ThemeProvider>
  );
  return ref;
};

const PAGE = {
  v: 1,
  about: 'Story',
  whatsNew: 'Old notes',
  version: '1.4.2',
  links: { website: 'https://my.app/' },
  appSignature: SIG,
  updated: 1,
};

/** The page's JSON is listed, but its status never comes back READY. */
const slowPage = (status: () => Promise<Response>) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('identifier=qhub_app_'))
      return new Response(
        JSON.stringify([
          {
            name: 'MyApp',
            service: 'JSON',
            identifier: 'qhub_app_page_v1_APP',
            latestSignature: 'P',
          },
        ])
      );
    if (url.includes('/resource/status/')) return status();
    if (url.includes('/arbitrary/JSON/'))
      return new Response(JSON.stringify(PAGE));
    return new Response('', { status: 404 });
  });

const desktop = () => {
  const qappGuestShot = vi.fn();
  window.electronAPI = { qappGuestShot, qappGuestPrepare: vi.fn() } as any;
  return qappGuestShot;
};

const choosePicture = async () => {
  const input = document.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  const picture = new File([new Uint8Array([1, 2, 3])], 'home.png', {
    type: 'image/png',
  });
  await act(async () => {
    fireEvent.change(input, { target: { files: [picture] } });
  });
};

beforeEach(() => {
  // No desktop app here unless a test says so.
  window.electronAPI = undefined as any;
  URL.createObjectURL = vi.fn(() => 'blob:picture');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The node has answered what the page holds now. */
const settled = () =>
  waitFor(() =>
    expect(screen.queryByText('app_page.publish.page_loading')).toBeNull()
  );

describe('the page part of the publish form', () => {
  it('publishes nothing extra by default for a new app', async () => {
    nodeWith(null, null);
    const ref = renderExtras();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await settled();
    const extras = ref.current!.prepare();
    expect(extras).toEqual({ shots: null, page: null, pageWasRead: false });
    expect(extrasPartCount(extras)).toBe(0);
  });

  it('says screenshots are optional, with no mode to pick for a new app', async () => {
    nodeWith(null, null);
    renderExtras();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await settled();
    expect(
      screen.getByText('app_page.publish.shots_optional')
    ).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'app_page.screenshots.choose' })
    ).toBeEnabled();
  });

  it('publishes the pictures the publisher chose', async () => {
    nodeWith(null, null);
    const ref = renderExtras();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await settled();
    await choosePicture();
    const extras = ref.current!.prepare();
    expect(extras.shots).toHaveLength(1);
    expect(extras.shots![0]).toMatchObject({ caption: '', width: 1600 });
    expect(extrasPartCount(extras)).toBe(1);
  });

  it('never takes screenshots by itself when publishing', async () => {
    const qappGuestShot = desktop();
    nodeWith(null, null);
    const ref = renderExtras(new Blob(['zip']));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await settled();
    expect(
      screen.getByRole('button', { name: 'app_page.screenshots.take' })
    ).toBeEnabled();
    expect(ref.current!.prepare()).toEqual({
      shots: null,
      page: null,
      pageWasRead: false,
    });
    await act(async () => undefined);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(qappGuestShot).not.toHaveBeenCalled();
  });

  it('takes screenshots by hand only in the desktop app', async () => {
    nodeWith(null, null);
    renderExtras(new Blob(['zip']));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await settled();
    expect(
      screen.getByRole('button', { name: 'app_page.screenshots.take' })
    ).toBeDisabled();
    expect(
      screen.getByLabelText('app_page.capture.needs_desktop')
    ).toBeInTheDocument();
  });

  it('takes screenshots by hand once the zip is chosen', async () => {
    desktop();
    nodeWith(null, null);
    renderExtras(null);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await settled();
    expect(
      screen.getByRole('button', { name: 'app_page.screenshots.take' })
    ).toBeDisabled();
    expect(
      screen.getByLabelText('app_page.publish.choose_file_first')
    ).toBeInTheDocument();
  });

  it('keeps the current screenshots of an update unless told otherwise', async () => {
    nodeWith(null, TWO_SHOTS);
    const ref = renderExtras();
    const keep = await screen.findByRole('radio', {
      name: /app_page.publish.shots_keep/,
    });
    expect(keep).toBeChecked();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(ref.current!.prepare().shots).toBeNull();
  });

  it('takes the screenshots off the page when the publisher opts out', async () => {
    nodeWith(null, TWO_SHOTS);
    const ref = renderExtras();
    fireEvent.click(
      await screen.findByRole('radio', { name: /app_page.publish.shots_none/ })
    );
    expect(ref.current!.prepare()).toEqual({
      shots: [],
      page: null,
      pageWasRead: false,
    });
  });

  it('changes the current screenshots, starting from them', async () => {
    nodeWith(null, TWO_SHOTS);
    const ref = renderExtras();
    fireEvent.click(
      await screen.findByRole('radio', {
        name: /app_page.publish.shots_change/,
      })
    );
    // Unchanged, nothing is published again.
    expect(screen.getAllByAltText(/Home|screenshot/)).toHaveLength(2);
    expect(ref.current!.prepare().shots).toBeNull();

    fireEvent.click(
      screen.getAllByRole('button', { name: 'action.remove' })[0]
    );
    const shots = ref.current!.prepare().shots!;
    expect(shots.map((shot) => shot.id)).toEqual(['existing-2.webp']);

    fireEvent.click(screen.getByRole('button', { name: 'action.remove' }));
    expect(ref.current!.prepare().shots).toEqual([]);
    expect(
      screen.getByText('app_page.edit.screenshots_removed')
    ).toBeInTheDocument();
  });

  it('adds the version and what changed, keeping the rest of the page', async () => {
    nodeWith(
      {
        v: 1,
        about: 'Story',
        whatsNew: 'Old notes',
        version: '1.4.2',
        links: {},
        appSignature: SIG,
        updated: 1,
      },
      null
    );
    const ref = renderExtras();
    fireEvent.click(
      await screen.findByRole('button', { name: 'app_page.edit.next_version' })
    );
    fireEvent.change(screen.getByLabelText('app_page.whats_new.title'), {
      target: { value: 'Faster feed' },
    });
    const extras = ref.current!.prepare();
    expect(extras.page).toMatchObject({
      about: 'Story',
      version: '1.4.3',
      whatsNew: 'Faster feed',
    });
    expect(extrasPartCount(extras)).toBe(1);
  });

  it('publishes the page with the new app signature, then the screenshots', async () => {
    // The node is asked for the current page first: it has none.
    nodeWith(null, null);
    const send = vi.fn().mockResolvedValue({});
    window.sendMessage = send;
    const left = await publishPageExtras(
      { service: 'APP', name: 'MyApp' },
      {
        page: {
          about: '',
          whatsNew: 'New',
          version: '2.0',
          links: {},
          appSignature: '',
          updated: 0,
        },
        shots: [
          {
            id: 'a',
            url: 'blob:a',
            caption: 'One',
            blob: new Blob([new Uint8Array([1, 2])]),
          },
        ],
      },
      SIG
    );
    expect(send.mock.calls.map((call) => call[1].service)).toEqual([
      'JSON',
      'IMAGE',
    ]);
    expect(JSON.parse(atob(send.mock.calls[0][1].data)).appSignature).toBe(SIG);
    // Nothing is left to publish again.
    expect(left).toBeNull();
  });
});

describe('what the page section holds of its own', () => {
  it('has a page draft while a version or What changed is typed', async () => {
    nodeWith(null, null);
    const ref = renderExtras();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await settled();
    expect(ref.current!.hasDrafts()).toEqual({ page: false, shots: false });

    const whatsNew = screen.getByLabelText('app_page.whats_new.title');
    fireEvent.change(whatsNew, { target: { value: 'Faster' } });
    expect(ref.current!.hasDrafts().page).toBe(true);
    fireEvent.change(whatsNew, { target: { value: '  ' } });
    expect(ref.current!.hasDrafts().page).toBe(false);
  });

  it('has a screenshots draft once pictures are chosen, not for the ones kept', async () => {
    nodeWith(null, TWO_SHOTS);
    const ref = renderExtras();
    await screen.findByRole('radio', { name: /app_page.publish.shots_keep/ });
    expect(ref.current!.hasDrafts().shots).toBe(false);
    fireEvent.click(
      screen.getByRole('radio', { name: /app_page.publish.shots_none/ })
    );
    expect(ref.current!.hasDrafts().shots).toBe(true);
  });
});

describe('the current page, while it loads or when it cannot be read', () => {
  it('publishes no page part until the current page has loaded', async () => {
    slowPage(() => new Promise(() => {}));
    const ref = renderExtras();
    expect(
      await screen.findByText('app_page.publish.page_loading')
    ).toBeInTheDocument();
    const version = screen.getByLabelText('app_page.details.version');
    expect(version).toBeDisabled();
    // Even with a version typed in some other way, nothing goes out yet.
    fireEvent.change(version, { target: { value: '2.0' } });
    expect(ref.current!.prepare()).toEqual({
      shots: null,
      page: null,
      pageWasRead: false,
    });
  });

  it("won't publish over a page the node lists but couldn't read", async () => {
    slowPage(
      async () => new Response(JSON.stringify({ status: 'BUILD_FAILED' }))
    );
    const ref = renderExtras();
    expect(
      await screen.findByText('app_page.publish.page_unreadable')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('app_page.details.version')).toBeDisabled();
    expect(ref.current!.prepare()).toEqual({
      shots: null,
      page: null,
      pageWasRead: false,
    });
  });

  it('keeps About and links once the page has loaded', async () => {
    let ready: (response: Response) => void = () => {};
    slowPage(() => new Promise((resolve) => (ready = resolve)));
    const ref = renderExtras();
    await screen.findByText('app_page.publish.page_loading');
    await act(async () => {
      ready(new Response(JSON.stringify({ status: 'READY' })));
    });
    const version = await screen.findByLabelText('app_page.details.version');
    await waitFor(() => expect(version).toBeEnabled());
    fireEvent.change(version, { target: { value: '2.0' } });
    expect(ref.current!.prepare().page).toMatchObject({
      about: 'Story',
      links: { website: 'https://my.app/' },
      version: '2.0',
    });
    // So the page is published only over one the node still has.
    expect(ref.current!.prepare().pageWasRead).toBe(true);
  });

  it('holds new screenshots back until the current ones have loaded', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('identifier=qhub_app_'))
        return new Response(
          JSON.stringify([
            {
              name: 'MyApp',
              service: 'IMAGE',
              identifier: 'qhub_app_shots_v1_APP',
              latestSignature: 'S',
            },
          ])
        );
      if (url.includes('/resource/status/')) return new Promise(() => {});
      return new Response('', { status: 404 });
    });
    const ref = renderExtras();
    await screen.findByText('app_page.publish.page_loading');
    // No editor to add screenshots over the ones not loaded yet.
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(ref.current!.prepare().shots).toBeNull();
  });
});

const json = (value: unknown) => new Response(JSON.stringify(value));
const LISTED_PAGE = [
  {
    name: 'MyApp',
    service: 'JSON',
    identifier: 'qhub_app_page_v1_APP',
    latestSignature: 'P',
  },
];
const LISTED_SHOTS = {
  name: 'MyApp',
  service: 'IMAGE',
  identifier: 'qhub_app_shots_v1_APP',
  latestSignature: 'S',
};
const ONE_SHOT = {
  v: 1,
  shots: [{ file: '1.webp', caption: 'Home' }],
  updated: 1,
};

describe('Retry after a failed read of the current page', () => {
  const version = () => screen.getByLabelText('app_page.details.version');

  it('reads the page again on Retry, once the node answers', async () => {
    let nodeDown = true;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('identifier=qhub_app_'))
        return nodeDown ? new Response('', { status: 500 }) : json(LISTED_PAGE);
      if (url.includes('/resource/status/')) return json({ status: 'READY' });
      if (url.includes('/arbitrary/JSON/')) return json(PAGE);
      return new Response('', { status: 404 });
    });
    const ref = renderExtras();
    expect(
      await screen.findByText('app_page.publish.page_unreadable')
    ).toBeInTheDocument();
    expect(version()).toBeDisabled();

    nodeDown = false;
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));

    await waitFor(() => expect(version()).toBeEnabled());
    expect(screen.queryByText('app_page.publish.page_unreadable')).toBeNull();
    fireEvent.change(version(), { target: { value: '2.0' } });
    expect(ref.current!.prepare().page).toMatchObject({
      about: 'Story',
      links: { website: 'https://my.app/' },
      version: '2.0',
    });
  });

  it('keeps the screenshots chosen so far when Retry reads the page text', async () => {
    let pageStatus = 'BUILD_FAILED';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('identifier=qhub_app_')) return json(LISTED_PAGE);
      if (url.includes('/resource/status/'))
        return json({ status: pageStatus });
      if (url.includes('/arbitrary/JSON/')) return json(PAGE);
      return new Response('', { status: 404 });
    });
    const ref = renderExtras();
    await screen.findByText('app_page.publish.page_unreadable');
    // The screenshots were read (there are none): one is chosen.
    await choosePicture();
    expect(ref.current!.prepare().shots).toHaveLength(1);

    pageStatus = 'READY';
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(version()).toBeEnabled());
    expect(ref.current!.prepare().shots).toHaveLength(1);
  });

  it('keeps a version typed so far when Retry reads the screenshots', async () => {
    let shotsStatus = 'BUILD_FAILED';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('identifier=qhub_app_'))
        return json([...LISTED_PAGE, LISTED_SHOTS]);
      if (url.includes('/resource/status/IMAGE/'))
        return json({ status: shotsStatus });
      if (url.includes('/resource/status/')) return json({ status: 'READY' });
      if (url.includes('/arbitrary/JSON/')) return json(PAGE);
      if (url.includes('filepath=shots.json')) return json(ONE_SHOT);
      return new Response('', { status: 404 });
    });
    const ref = renderExtras();
    await screen.findByText('app_page.publish.page_unreadable');
    // The page text was read: a version is typed.
    await waitFor(() => expect(version()).toBeEnabled());
    fireEvent.change(version(), { target: { value: '2.0' } });

    shotsStatus = 'READY';
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(
      await screen.findByRole('radio', { name: /app_page.publish.shots_keep/ })
    ).toBeChecked();
    expect(version()).toHaveValue('2.0');
    expect(ref.current!.prepare().page).toMatchObject({
      about: 'Story',
      version: '2.0',
    });
  });

  it('reads again a part that was still loading when Retry was pressed', async () => {
    let ready = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      const answer = (value: unknown) => Promise.resolve(json(value));
      if (url.includes('identifier=qhub_app_'))
        return answer([...LISTED_PAGE, LISTED_SHOTS]);
      if (url.includes('/resource/status/JSON/'))
        return answer({ status: ready ? 'READY' : 'BUILD_FAILED' });
      if (url.includes('/resource/status/IMAGE/')) {
        if (ready) return answer({ status: 'READY' });
        // Not built yet: no answer, until the read is given up.
        return new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          )
        );
      }
      if (url.includes('/arbitrary/JSON/')) return answer(PAGE);
      if (url.includes('filepath=shots.json')) return answer(ONE_SHOT);
      return Promise.resolve(new Response('', { status: 404 }));
    });
    renderExtras();
    await screen.findByText('app_page.publish.page_unreadable');
    // The page text failed; the screenshots are still being read.
    expect(
      screen.getByText('app_page.publish.page_loading')
    ).toBeInTheDocument();

    ready = true;
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));

    await waitFor(() => expect(version()).toBeEnabled());
    expect(
      await screen.findByRole('radio', { name: /app_page.publish.shots_keep/ })
    ).toBeChecked();
    expect(screen.queryByText('app_page.publish.page_loading')).toBeNull();
  });
});

describe('publishing the page text over the page the node has now', () => {
  /** What the form read when the name was chosen, with the new version. */
  const fromForm = {
    about: 'Story',
    whatsNew: 'Faster',
    version: '2.0',
    links: { website: 'https://my.app/' },
    appSignature: '',
    updated: 1,
  };
  const publishedPage = (send: ReturnType<typeof vi.fn>) =>
    JSON.parse(atob(send.mock.calls[0][1].data));

  it('keeps About and links saved since the form read the page', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('identifier=qhub_app_')) return json(LISTED_PAGE);
      if (url.includes('/resource/status/')) return json({ status: 'READY' });
      if (url.includes('/arbitrary/JSON/'))
        return json({
          ...PAGE,
          about: 'A longer story',
          links: { source: 'https://code.my.app/' },
        });
      return new Response('', { status: 404 });
    });
    const send = vi.fn().mockResolvedValue({});
    window.sendMessage = send;
    await publishPageExtras(
      { service: 'APP', name: 'MyApp' },
      { page: fromForm, shots: null },
      SIG
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(publishedPage(send)).toMatchObject({
      about: 'A longer story',
      links: { source: 'https://code.my.app/' },
      version: '2.0',
      whatsNew: 'Faster',
      appSignature: SIG,
    });
  });

  const shot = {
    id: 'a',
    url: 'blob:a',
    caption: 'One',
    blob: new Blob([new Uint8Array([1, 2])]),
  };
  const services = (send: ReturnType<typeof vi.fn>) =>
    send.mock.calls.map((call) => call[1].service);

  it("publishes no page text when the node can't say what the page has now", async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const send = vi.fn().mockResolvedValue({});
    window.sendMessage = send;
    const left = await publishPageExtras(
      { service: 'APP', name: 'MyApp' },
      { page: fromForm, shots: null, pageWasRead: true },
      SIG
    );
    // The form's copy would replace About and links saved since it read them.
    expect(send).not.toHaveBeenCalled();
    expect(left).toMatchObject({
      extras: { page: fromForm, shots: null },
      error: { code: 'PAGE_UNVERIFIED' },
    });
  });

  it('publishes no page text when the node lists none, though the form read one', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json([]));
    const send = vi.fn().mockResolvedValue({});
    window.sendMessage = send;
    const left = await publishPageExtras(
      { service: 'APP', name: 'MyApp' },
      { page: fromForm, shots: null, pageWasRead: true },
      SIG
    );
    expect(send).not.toHaveBeenCalled();
    expect(left?.error).toMatchObject({ code: 'PAGE_UNVERIFIED' });
  });

  it('publishes the first page of an app that still has none', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json([]));
    const send = vi.fn().mockResolvedValue({});
    window.sendMessage = send;
    const left = await publishPageExtras(
      { service: 'APP', name: 'MyApp' },
      { page: { ...fromForm, about: '', links: {} }, shots: null },
      SIG
    );
    expect(left).toBeNull();
    expect(publishedPage(send)).toMatchObject({
      version: '2.0',
      whatsNew: 'Faster',
      appSignature: SIG,
    });
  });

  it("still publishes the screenshots over a page it can't read now", async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('identifier=qhub_app_')) return json(LISTED_PAGE);
      if (url.includes('/resource/status/'))
        return json({ status: 'BUILD_FAILED' });
      return new Response('', { status: 404 });
    });
    const send = vi.fn().mockResolvedValue({});
    window.sendMessage = send;
    const left = await publishPageExtras(
      { service: 'APP', name: 'MyApp' },
      { page: fromForm, shots: [shot], pageWasRead: true },
      SIG
    );
    // The page the node lists is left as it is; the screenshots don't need it.
    expect(services(send)).toEqual(['IMAGE']);
    expect(left).toMatchObject({
      extras: { page: fromForm, shots: null },
      error: { code: 'PAGE_UNVERIFIED' },
    });
  });

  it('gives back only the screenshots when they fail after the page text', async () => {
    nodeWith(null, null);
    const send = vi.fn(async (_action: string, payload: any) =>
      payload.service === 'IMAGE' ? { error: 'Insufficient balance' } : {}
    );
    window.sendMessage = send as unknown as typeof window.sendMessage;
    const left = await publishPageExtras(
      { service: 'APP', name: 'MyApp' },
      { page: fromForm, shots: [shot] },
      SIG
    );
    expect(services(send)).toEqual(['JSON', 'IMAGE']);
    expect(left?.extras).toMatchObject({ page: null, shots: [shot] });
    expect(left?.error).toMatchObject({ message: 'Insufficient balance' });
  });
});

describe('the screenshots part', () => {
  it('names the choice for screen readers', async () => {
    nodeWith(null, TWO_SHOTS);
    renderExtras();
    expect(
      await screen.findByRole('radiogroup', {
        name: 'app_page.screenshots.title',
      })
    ).toBeInTheDocument();
  });

  it('forgets a failed pick once another picture is chosen', async () => {
    nodeWith(null, null);
    renderExtras();
    await waitFor(() =>
      expect(document.querySelector('input[type="file"]')).not.toBeNull()
    );
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: {
          files: [new File(['x'], 'photo.gif', { type: 'image/gif' })],
        },
      });
    });
    expect(
      screen.getByText('app_page.screenshots.not_an_image')
    ).toBeInTheDocument();
    await choosePicture();
    expect(screen.queryByText('app_page.screenshots.not_an_image')).toBeNull();
  });

  it('asks for a name first when no name is chosen', async () => {
    desktop();
    vi.spyOn(globalThis, 'fetch');
    renderExtras(new Blob(['zip']), '');
    expect(
      screen.getByLabelText('app_page.publish.choose_name_first')
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('screenshotsToPublish', () => {
  const draft = (id: string, caption = ''): ShotDraft => ({
    id,
    url: `blob:${id}`,
    caption,
  });
  const published = {
    shots: [{ file: '1.webp', caption: 'Home' }],
    updated: 1,
  };

  it('publishes a new list only when there is one', () => {
    expect(screenshotsToPublish([], null, 'keep')).toBeNull();
    expect(screenshotsToPublish([draft('a')], null, 'keep')).toHaveLength(1);
    expect(
      screenshotsToPublish([], { shots: [], updated: 1 }, 'none')
    ).toBeNull();
  });

  it('keeps, changes or removes what is published', () => {
    const same = [draft('existing-1.webp', 'Home')];
    expect(screenshotsToPublish(same, published, 'keep')).toBeNull();
    expect(screenshotsToPublish(same, published, 'change')).toBeNull();
    expect(
      screenshotsToPublish(
        [draft('existing-1.webp', 'Start')],
        published,
        'change'
      )
    ).toHaveLength(1);
    expect(screenshotsToPublish(same, published, 'none')).toEqual([]);
    expect(screenshotsToPublish([], published, 'change')).toEqual([]);
  });
});
