import React, { createContext, useState } from 'react';
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

const show = vi.fn();
vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://node',
  QORTAL_APP_CONTEXT: createContext({
    show: (...args: unknown[]) => show(...args),
  }),
}));
vi.mock('../../../background/background', () => ({
  getFee: vi.fn(async () => ({ fee: '0.01' })),
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
  encodeSquareIcon: vi.fn(
    async () => new Blob([new Uint8Array([5])], { type: 'image/webp' })
  ),
}));

import { AppPageEditorDialog, EditorSaved } from './AppPageEditorDialog';
import type { ShotsManifest } from './appPageData';
import type { ShotDraft } from './ScreenshotsEditor';
import { blobBytes } from './blobBytes';
import { getFee } from '../../../background/background';

const app = {
  name: 'Publisher',
  service: 'APP',
  latestSignature: 'APPSIG',
  metadata: { title: 'My App', description: 'Short', category: 'SOCIAL' },
};
const page = {
  about: 'Story',
  whatsNew: 'Notes',
  version: '1.0',
  links: {},
  appSignature: 'APPSIG',
  updated: 1,
};

interface NodeShots {
  signature: string;
  manifest: ShotsManifest;
  files: Record<string, number[]>;
}

const twoShots = (): NodeShots => ({
  signature: 'S1',
  manifest: {
    v: 1,
    shots: [
      { file: '1.webp', caption: 'Home' },
      { file: '2.webp', caption: 'Feed' },
    ],
    updated: 1,
  } as ShotsManifest,
  files: { '1.webp': [1, 1, 1], '2.webp': [2, 2, 2] },
});

/** Published from another device since: a new signature, other pictures. */
const sunsetShots = (): NodeShots => ({
  signature: 'S2',
  manifest: {
    v: 1,
    shots: [
      { file: '1.webp', caption: 'Sunset' },
      { file: '2.webp', caption: 'Beach' },
    ],
    updated: 2,
  } as ShotsManifest,
  files: { '1.webp': [9, 9, 9], '2.webp': [8, 8, 8] },
});

/** What the node holds; a test replaces it as it goes. */
let node: NodeShots;
/** The node's search answers with an error. */
let searchFails = false;
/** Hold the node's search, or its build status, until released. */
let searchGate: Promise<void> | null = null;
let statusGate: Promise<void> | null = null;

const json = (value: unknown) => new Response(JSON.stringify(value));

/** A promise and the function that resolves it. */
const gate = () => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
};

const includesBytes = (haystack: Uint8Array, needle: number[]) =>
  haystack.some((_, i) => needle.every((byte, j) => haystack[i + j] === byte));

type EditorProps = Partial<Parameters<typeof AppPageEditorDialog>[0]>;

const editor = (props: EditorProps) => (
  <ThemeProvider theme={createTheme()}>
    <I18nextProvider i18n={i18n}>
      <AppPageEditorDialog
        app={app}
        initialTab="screenshots"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        open
        page={page}
        shots={twoShots().manifest}
        shotsVersion="S1"
        {...props}
      />
    </I18nextProvider>
  </ThemeProvider>
);

/** Holds what the editor saved, as the app's page does. */
const Page = ({
  onSaved,
  ...props
}: EditorProps & { onSaved?: (saved: EditorSaved) => void }) => {
  const [savedShots, setSavedShots] = useState<ShotDraft[] | null>(null);
  return editor({
    ...props,
    savedShots,
    onSaved: (saved) => {
      if (saved.shots) setSavedShots(saved.shots);
      onSaved?.(saved);
    },
  });
};

const captions = () =>
  screen.getAllByRole('textbox', { name: 'app_page.screenshots.caption' });

const publishButton = () =>
  screen.getByRole('button', { name: 'app_page.edit.publish' });

const pressPublish = async () => {
  await act(async () => {
    fireEvent.click(publishButton());
  });
};

const sent = () => vi.mocked(window.sendMessage).mock.calls as any[];
const imagesSent = () =>
  sent().filter(([, payload]) => payload.service === 'IMAGE');
const iconsSent = () =>
  sent().filter(([, payload]) => payload.service === 'THUMBNAIL');

const choosePicture = async () => {
  const input = document.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  const picture = new File([new Uint8Array([1, 2, 3])], 'new.png', {
    type: 'image/png',
  });
  await act(async () => {
    fireEvent.change(input, { target: { files: [picture] } });
  });
};

const chooseIcon = async () => {
  fireEvent.click(screen.getByRole('tab', { name: 'app_page.edit.tab_icon' }));
  const input = document.querySelector(
    'input[accept="image/png,image/jpeg,image/webp"]'
  ) as HTMLInputElement;
  const picture = new File([new Uint8Array([4, 5, 6])], 'icon.png', {
    type: 'image/png',
  });
  await act(async () => {
    fireEvent.change(input, { target: { files: [picture] } });
  });
};

/** Lets the node's late answers arrive. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

beforeEach(() => {
  node = twoShots();
  searchFails = false;
  searchGate = null;
  statusGate = null;
  show.mockReset().mockResolvedValue(undefined);
  window.sendMessage = vi.fn().mockResolvedValue({ signature: 'NEWSIG' });
  URL.createObjectURL = vi.fn(() => 'blob:picture');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/arbitrary/categories')) return json([]);
    if (url.includes('identifier=qhub_app_')) {
      if (searchGate) await searchGate;
      if (searchFails) return new Response('', { status: 500 });
      return json([
        {
          name: 'Publisher',
          service: 'IMAGE',
          identifier: 'qhub_app_shots_v1_APP',
          latestSignature: node.signature,
        },
      ]);
    }
    if (url.includes('/resource/status/')) {
      if (statusGate) await statusGate;
      return json({ status: 'READY' });
    }
    const file = url.includes('/arbitrary/IMAGE/')
      ? new URL(url).searchParams.get('filepath')
      : null;
    if (file === 'shots.json') return json(node.manifest);
    if (file && node.files[file])
      return new Response(new Uint8Array(node.files[file]));
    return new Response('', { status: 404 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the page editor, when the screenshots were replaced elsewhere', () => {
  it('stops before the fee, and loads the current ones on Refresh', async () => {
    render(editor({}));
    fireEvent.change(captions()[0], { target: { value: 'Start' } });
    node = sunsetShots();

    await pressPublish();
    expect(
      await screen.findByText('app_page.edit.error_shots_changed')
    ).toBeInTheDocument();
    expect(show).not.toHaveBeenCalled();
    expect(sent()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'action.refresh' }));
    await waitFor(() => expect(captions()[0]).toHaveValue('Sunset'));
    expect(screen.queryByText('app_page.edit.error_shots_changed')).toBeNull();
    // As read now: nothing to publish until something changes.
    expect(publishButton()).toBeDisabled();

    fireEvent.change(captions()[0], { target: { value: 'Evening' } });
    await pressPublish();
    await waitFor(() => expect(imagesSent()).toHaveLength(1));
    const zip = await blobBytes(imagesSent()[0][1].data);
    expect(includesBytes(zip, [9, 9, 9])).toBe(true);
    expect(includesBytes(zip, [1, 1, 1])).toBe(false);
  });

  it('keeps the pictures added here when it loads the current ones', async () => {
    render(editor({}));
    await choosePicture();
    node = sunsetShots();
    await pressPublish();
    await screen.findByText('app_page.edit.error_shots_changed');

    fireEvent.click(screen.getByRole('button', { name: 'action.refresh' }));
    await waitFor(() =>
      expect(
        captions().map((input) => (input as HTMLInputElement).value)
      ).toEqual(['Sunset', 'Beach', ''])
    );
    // The added picture is still to publish, with the current ones.
    expect(publishButton()).toBeEnabled();
    await pressPublish();
    await waitFor(() => expect(imagesSent()).toHaveLength(1));
    const zip = await blobBytes(imagesSent()[0][1].data);
    expect(includesBytes(zip, [9, 9, 9])).toBe(true);
    expect(includesBytes(zip, [1, 1, 1])).toBe(false);
  });

  it("refuses them when they're replaced after the confirmation", async () => {
    const onClose = vi.fn();
    render(editor({ onClose }));
    fireEvent.change(captions()[0], { target: { value: 'Start' } });
    show.mockImplementation(async () => {
      node = sunsetShots();
    });

    await pressPublish();
    expect(
      await screen.findByText('app_page.edit.error_shots_changed')
    ).toBeInTheDocument();
    expect(imagesSent()).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'action.refresh' })
    ).toBeInTheDocument();
  });

  it("stops before the fee when the node can't say what it has now", async () => {
    render(editor({}));
    fireEvent.change(captions()[0], { target: { value: 'Start' } });
    // Replaced on another device, while the node's search fails.
    node = sunsetShots();
    searchFails = true;

    await pressPublish();
    expect(
      await screen.findByText('app_page.edit.error_shots_unverified')
    ).toBeInTheDocument();
    expect(show).not.toHaveBeenCalled();
    expect(sent()).toHaveLength(0);
    // Nothing to load again: the caption typed here stays, and Publish asks
    // the node again.
    expect(screen.queryByRole('button', { name: 'action.refresh' })).toBeNull();
    expect(captions()[0]).toHaveValue('Start');
    searchFails = false;
    await pressPublish();
    expect(
      await screen.findByText('app_page.edit.error_shots_changed')
    ).toBeInTheDocument();
    expect(sent()).toHaveLength(0);
  });

  it('publishes none of them when the search fails after the confirmation', async () => {
    const onClose = vi.fn();
    render(editor({ onClose }));
    fireEvent.change(captions()[0], { target: { value: 'Start' } });
    show.mockImplementation(async () => {
      node = sunsetShots();
      searchFails = true;
    });

    await pressPublish();
    expect(
      await screen.findByText('app_page.edit.error_shots_unverified')
    ).toBeInTheDocument();
    expect(imagesSent()).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks for the fee once when Publish is pressed twice during the check', async () => {
    render(editor({}));
    fireEvent.change(captions()[0], { target: { value: 'Start' } });
    const search = gate();
    searchGate = search.held;
    await act(async () => {
      fireEvent.click(publishButton());
      fireEvent.click(publishButton());
    });
    expect(publishButton()).toBeDisabled();

    searchGate = null;
    await act(async () => {
      search.release();
    });
    await waitFor(() => expect(imagesSent()).toHaveLength(1));
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('leaves the editor alone when a Refresh ends after it was closed and opened again', async () => {
    const { rerender } = render(editor({}));
    await choosePicture();
    expect(
      captions().map((input) => (input as HTMLInputElement).value)
    ).toEqual(['Home', 'Feed', '']);
    node = sunsetShots();
    await pressPublish();
    await screen.findByText('app_page.edit.error_shots_changed');

    // The node takes its time over the other device's set.
    const status = gate();
    statusGate = status.held;
    fireEvent.click(screen.getByRole('button', { name: 'action.refresh' }));
    rerender(editor({ open: false }));
    rerender(editor({ open: true }));
    fireEvent.change(captions()[0], { target: { value: 'Mine' } });

    await act(async () => {
      status.release();
    });
    await settle();
    // This opening's change, without the earlier picture, and not loading.
    expect(
      captions().map((input) => (input as HTMLInputElement).value)
    ).toEqual(['Mine', 'Feed']);
    expect(screen.queryByText('message.generic.loading')).toBeNull();
    expect(publishButton()).toBeEnabled();
  });

  it('asks for no fee when the fee comes back after the editor was closed and opened again', async () => {
    const { rerender } = render(editor({}));
    fireEvent.change(captions()[0], { target: { value: 'Start' } });
    const fee = gate();
    vi.mocked(getFee).mockImplementationOnce(async () => {
      await fee.held;
      return { fee: '0.01', timestamp: 0 };
    });
    await pressPublish();
    rerender(editor({ open: false }));
    rerender(editor({ open: true }));

    await act(async () => {
      fee.release();
    });
    await settle();
    expect(show).not.toHaveBeenCalled();
    expect(sent()).toHaveLength(0);
  });

  it('shows nothing from a check that ends after the editor was closed and opened again', async () => {
    const { rerender } = render(editor({}));
    fireEvent.change(captions()[0], { target: { value: 'Start' } });
    node = sunsetShots();
    const search = gate();
    searchGate = search.held;
    await pressPublish();
    rerender(editor({ open: false }));
    rerender(editor({ open: true }));

    searchGate = null;
    await act(async () => {
      search.release();
    });
    await settle();
    // The earlier opening's "replaced" isn't this one's.
    expect(screen.queryByText('app_page.edit.error_shots_changed')).toBeNull();
    expect(screen.queryByRole('button', { name: 'action.refresh' })).toBeNull();
    expect(show).not.toHaveBeenCalled();
  });

  it('asks for no fee when the check ends after the editor was closed and opened again', async () => {
    const { rerender } = render(editor({}));
    fireEvent.change(captions()[0], { target: { value: 'Start' } });
    const search = gate();
    searchGate = search.held;
    await pressPublish();
    rerender(editor({ open: false }));
    rerender(editor({ open: true }));

    searchGate = null;
    await act(async () => {
      search.release();
    });
    await settle();
    expect(show).not.toHaveBeenCalled();
    expect(sent()).toHaveLength(0);
    expect(captions()[0]).toHaveValue('Home');
    expect(publishButton()).toBeDisabled();
  });
});

describe('the page editor, after publishing screenshots', () => {
  it('publishes only the icon again when the icon failed after them', async () => {
    let iconDown = true;
    window.sendMessage = vi.fn(async (_action: string, payload: any) =>
      payload?.service === 'THUMBNAIL' && iconDown
        ? { error: 'Insufficient balance' }
        : { signature: 'NEWSIG' }
    ) as unknown as typeof window.sendMessage;
    render(<Page />);
    // The first one is taken off: the node numbers the rest anew.
    fireEvent.click(
      screen.getAllByRole('button', { name: 'action.remove' })[0]
    );
    await chooseIcon();
    await pressPublish();
    expect(await screen.findByText('Insufficient balance')).toBeInTheDocument();
    expect(imagesSent()).toHaveLength(1);
    expect(iconsSent()).toHaveLength(1);

    // Publish again: the screenshots went out, so only the icon is left.
    iconDown = false;
    show.mockClear();
    await pressPublish();
    await waitFor(() => expect(iconsSent()).toHaveLength(2));
    expect(imagesSent()).toHaveLength(1);
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ publishFee: '0.01 QORT' })
    );
    expect(screen.queryByText('app_page.edit.error_shots_changed')).toBeNull();
  });

  it('publishes a second change with the pictures it just published', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<Page onClose={onClose} onSaved={onSaved} />);
    // The first one is taken off: the node numbers the rest anew.
    fireEvent.click(
      screen.getAllByRole('button', { name: 'action.remove' })[0]
    );
    await pressPublish();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const saved: ShotDraft[] = onSaved.mock.calls[0][0].shots;
    expect(saved.map((shot) => [shot.id, shot.caption])).toEqual([
      ['existing-1.webp', 'Feed'],
    ]);

    // The node lists that publish now: "Feed" is its 1.webp.
    node = {
      signature: 'S3',
      manifest: {
        v: 1,
        shots: [{ file: '1.webp', caption: 'Feed' }],
        updated: 3,
      } as ShotsManifest,
      files: { '1.webp': [2, 2, 2] },
    };
    vi.mocked(window.sendMessage).mockClear();
    fireEvent.change(captions()[0], { target: { value: 'News' } });
    await pressPublish();

    await waitFor(() => expect(imagesSent()).toHaveLength(1));
    const zip = await blobBytes(imagesSent()[0][1].data);
    expect(includesBytes(zip, [2, 2, 2])).toBe(true);
    expect(includesBytes(zip, [1, 1, 1])).toBe(false);
    expect(screen.queryByText('app_page.edit.error_shots_changed')).toBeNull();
  });
});
