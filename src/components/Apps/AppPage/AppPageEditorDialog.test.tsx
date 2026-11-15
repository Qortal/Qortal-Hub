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

i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { core: {} } } });

const show = vi.fn();
const getFee = vi.fn();
vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://node',
  QORTAL_APP_CONTEXT: createContext({
    show: (...args: unknown[]) => show(...args),
  }),
}));
vi.mock('../../../background/background', () => ({
  getFee: (...args: unknown[]) => getFee(...args),
  createEndpoint: vi.fn(async (path: string) => `http://node${path}`),
}));
vi.mock('../AppViewerContainer', () => ({ default: () => null }));
// The real screenshots editor, noting the capture source it is given.
const captureSources: unknown[] = [];
vi.mock('./ScreenshotsEditor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ScreenshotsEditor')>();
  return {
    ...actual,
    ScreenshotsEditor: (
      props: React.ComponentProps<typeof actual.ScreenshotsEditor>
    ) => {
      captureSources.push(props.captureSource);
      return React.createElement(actual.ScreenshotsEditor, props);
    },
  };
});

import { AppPageEditorDialog } from './AppPageEditorDialog';

const OLD_SIG =
  '5HaYMw82wjG8k2Ddq6ccr7hDcjz58hK2GjhFzVbSKMFDE8hRqkG3QXQrNNLmmKZN';
const NEW_SIG =
  '4m4Stt148xFBfqCQ15zCVJghn1HVKhfrMUTy1uDZxVPXHTGNxtpz4G1L6pGtezNj';

const app = {
  name: 'MyApp',
  service: 'APP',
  latestSignature: OLD_SIG,
  size: 2048,
  metadata: {
    title: 'My App',
    description: 'Short',
    category: 'SOCIAL',
    tags: ['a'],
  },
};
const page = {
  about: 'Story',
  whatsNew: 'Notes',
  version: '1.0',
  links: {},
  appSignature: OLD_SIG,
  updated: 1,
};

type EditorProps = Partial<Parameters<typeof AppPageEditorDialog>[0]>;

const editor = (props: EditorProps) => (
  <ThemeProvider theme={createTheme()}>
    <I18nextProvider i18n={i18n}>
      <AppPageEditorDialog
        app={app}
        initialTab="page"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        open
        page={page}
        shots={null}
        {...props}
      />
    </I18nextProvider>
  </ThemeProvider>
);

const renderEditor = (
  onSaved = vi.fn(),
  onClose = vi.fn(),
  props: EditorProps = {}
) => {
  const view = render(editor({ onSaved, onClose, ...props }));
  return { onSaved, onClose, view };
};

beforeEach(() => {
  show.mockReset().mockResolvedValue(undefined);
  getFee.mockReset().mockResolvedValue({ fee: '0.01' });
  window.sendMessage = vi.fn().mockResolvedValue({ signature: NEW_SIG });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const json = (value: unknown) => new Response(JSON.stringify(value));
    if (url.includes('/arbitrary/categories'))
      return json([{ id: 'SOCIAL', name: 'Social' }]);
    if (url.includes('/resource/status/')) return json({ status: 'READY' });
    if (url.includes('/arbitrary/metadata/'))
      return json({ files: ['index.html'] });
    if (url.includes('filepath=index.html'))
      return new Response('<html></html>');
    return new Response('', { status: 404 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the page editor', () => {
  it('has nothing to publish until something changes', () => {
    renderEditor();
    expect(
      screen.getByRole('button', { name: 'app_page.edit.publish' })
    ).toBeDisabled();
  });

  it('publishes only the page text, for one fee', async () => {
    const { onSaved, onClose } = renderEditor();
    fireEvent.change(screen.getByLabelText('app_page.edit.about'), {
      target: { value: 'A new story' },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'app_page.edit.publish' })
      );
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ publishFee: '0.01 QORT' })
    );
    const calls = vi.mocked(window.sendMessage).mock.calls as any[];
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({
      service: 'JSON',
      identifier: 'qhub_app_page_v1_APP',
    });
    // The version still describes the same upload.
    expect(JSON.parse(atob(calls[0][1].data)).appSignature).toBe(OLD_SIG);
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        page: expect.objectContaining({ about: 'A new story' }),
      })
    );
  });

  it('refuses links that are not web or qortal links', () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText('app_page.links.website'), {
      target: { value: 'javascript:alert(1)' },
    });
    expect(screen.getByText('app_page.edit.link_invalid')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'app_page.edit.publish' })
    ).toBeDisabled();
  });

  it('publishes the app again for new listing details, then points the version at it', async () => {
    const { onClose } = renderEditor();
    fireEvent.click(
      screen.getByRole('tab', { name: 'app_page.edit.tab_listing' })
    );
    fireEvent.change(screen.getByLabelText('app_page.edit.listing_title'), {
      target: { value: 'My Better App' },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'app_page.edit.publish' })
      );
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ publishFee: '0.02 QORT' })
    );
    const calls = vi.mocked(window.sendMessage).mock.calls as any[];
    expect(calls.map((call) => call[1].service)).toEqual(['APP', 'JSON']);
    expect(calls[0][1]).toMatchObject({
      title: 'My Better App',
      uploadType: 'zip',
    });
    expect(JSON.parse(atob(calls[1][1].data)).appSignature).toBe(NEW_SIG);
  });

  it('stops and says why when a part fails', async () => {
    window.sendMessage = vi
      .fn()
      .mockResolvedValue({ error: 'Insufficient balance' });
    const { onClose } = renderEditor();
    fireEvent.change(screen.getByLabelText('app_page.edit.about'), {
      target: { value: 'Changed' },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'app_page.edit.publish' })
      );
    });
    expect(await screen.findByText('Insufficient balance')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('the page editor, before and after the page loads', () => {
  it('fills in the page when it arrives after opening', () => {
    const { view } = renderEditor(vi.fn(), vi.fn(), { page: null });
    expect(screen.getByLabelText('app_page.edit.about')).toHaveValue('');
    view.rerender(editor({ page }));
    expect(screen.getByLabelText('app_page.edit.about')).toHaveValue('Story');
    // Nothing changed, so there's nothing to publish over the page.
    expect(
      screen.getByRole('button', { name: 'app_page.edit.publish' })
    ).toBeDisabled();
  });

  it('keeps what was typed when the page arrives later', () => {
    const { view } = renderEditor(vi.fn(), vi.fn(), { page: null });
    fireEvent.change(screen.getByLabelText('app_page.edit.about'), {
      target: { value: 'Typed first' },
    });
    view.rerender(editor({ page }));
    expect(screen.getByLabelText('app_page.edit.about')).toHaveValue(
      'Typed first'
    );
  });

  it("won't publish a page or screenshots the node couldn't read", () => {
    renderEditor(vi.fn(), vi.fn(), {
      page: null,
      pageUnreadable: true,
      shotsUnreadable: true,
    });
    expect(
      screen.getByText('app_page.edit.page_unreadable')
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('app_page.edit.about')).toBeNull();
    fireEvent.click(
      screen.getByRole('tab', { name: 'app_page.edit.tab_screenshots' })
    );
    expect(
      screen.getByText('app_page.edit.shots_unreadable')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'app_page.edit.publish' })
    ).toBeDisabled();
  });

  it('starts the screenshots from the ones just saved', () => {
    const saved = [
      { id: 'new-1', url: 'blob:new', caption: 'Fresh', blob: new Blob(['x']) },
    ];
    renderEditor(vi.fn(), vi.fn(), {
      initialTab: 'screenshots',
      savedShots: saved,
    });
    expect(screen.getByAltText('Fresh')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'app_page.edit.publish' })
    ).toBeDisabled();
  });

  it('keeps one capture source across renders, so a capture under way goes on', () => {
    captureSources.length = 0;
    const { view } = renderEditor(vi.fn(), vi.fn(), {
      initialTab: 'screenshots',
    });
    view.rerender(editor({ initialTab: 'screenshots' }));
    expect(captureSources.length).toBeGreaterThan(1);
    expect(new Set(captureSources).size).toBe(1);
  });

  it('says so when the fee cannot be looked up', async () => {
    getFee.mockRejectedValue(new Error('Node unreachable'));
    const { onClose } = renderEditor();
    fireEvent.change(screen.getByLabelText('app_page.edit.about'), {
      target: { value: 'Changed' },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'app_page.edit.publish' })
      );
    });
    expect(await screen.findByText('Node unreachable')).toBeInTheDocument();
    expect(show).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says something when a publish fails without a message', async () => {
    window.sendMessage = vi.fn().mockRejectedValue(undefined);
    renderEditor();
    fireEvent.change(screen.getByLabelText('app_page.edit.about'), {
      target: { value: 'Changed' },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'app_page.edit.publish' })
      );
    });
    expect(
      await screen.findByText('message.error.generic')
    ).toBeInTheDocument();
  });
});

describe('the page editor, for screen readers', () => {
  it('is named by its title alone', () => {
    renderEditor();
    expect(
      screen.getByRole('dialog', { name: 'app_page.edit.title' })
    ).toHaveAccessibleDescription('app_page.edit.hint');
  });

  it('numbers the tag fields with the shared tag label', () => {
    renderEditor(vi.fn(), vi.fn(), { initialTab: 'listing' });
    expect(screen.getAllByLabelText('tag_number')).toHaveLength(5);
  });

  it("shows Qortal's logo when the name has no picture yet", () => {
    renderEditor(vi.fn(), vi.fn(), { initialTab: 'icon' });
    const icon = screen.getByAltText('app_page.hero.icon_alt');
    fireEvent.error(icon);
    expect(screen.queryByAltText('app_page.hero.icon_alt')).toBeNull();
  });
});
