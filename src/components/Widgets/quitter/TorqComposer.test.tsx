import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ThemeProvider } from '@mui/material/styles';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import i18n from '../../../i18n/i18n';
import { userInfoAtom } from '../../../atoms/global';
import { lightTheme } from '../../../styles/theme-light';
import { executeEvent } from '../../../utils/events';
import { TorqComposer, type PublishedTorqPost } from './TorqComposer';

type CompressorOptions = { success: (result: Blob) => void };

// Compressor.js needs a canvas: it hands back its input, or never finishes.
const compressor = vi.hoisted(() => ({ hang: false }));
vi.mock('compressorjs', () => ({
  default: class {
    constructor(file: Blob, opts: CompressorOptions) {
      if (!compressor.hang) opts.success(file);
    }
  },
}));

// tiptap needs a real browser; a textarea stands in for the Torq editor.
vi.mock('./TorqTextEditor', async () => {
  const { plainTextToTorqDoc, torqDocToPostBody } =
    await import('./torqRichText');
  return {
    TorqTextEditor: ({
      initialDoc,
      disabled,
      onChange,
    }: {
      initialDoc: Parameters<typeof torqDocToPostBody>[0];
      disabled?: boolean;
      onChange: (doc: ReturnType<typeof plainTextToTorqDoc>) => void;
    }) => (
      <textarea
        aria-label="Post text"
        defaultValue={torqDocToPostBody(initialDoc).text}
        disabled={disabled}
        onChange={(event) => onChange(plainTextToTorqDoc(event.target.value))}
      />
    ),
  };
});

vi.mock('../../../utils/events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/events')>()),
  executeEvent: vi.fn(),
}));

const POST_ID = /^MhNiRYdzkaP9dz-kX47dT-XrFXaYetyErMdF-[0-9A-Za-z]{15}-v1$/;

const sendMessage = vi.fn();

const Harness = ({
  onPublished,
}: {
  onPublished: (post: PublishedTorqPost) => void;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <TorqComposer
      open={open}
      onOpenChange={setOpen}
      onPublished={onPublished}
    />
  );
};

const renderComposer = (name = 'Alice') => {
  const onPublished = vi.fn();
  const store = createStore();
  store.set(userInfoAtom, { address: 'QAlice', name });
  render(
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <Harness onPublished={onPublished} />
      </ThemeProvider>
    </Provider>
  );
  return { onPublished };
};

const openComposer = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Post to Torq' }));

const editor = () => screen.getByRole('textbox', { name: 'Post text' });

const type = (value: string) =>
  fireEvent.change(editor(), { target: { value } });

const postButton = () => screen.getByRole('button', { name: 'Publish' });

const addImages = (files: File[]) =>
  fireEvent.change(screen.getByTestId('torq-composer-image-input'), {
    target: { files },
  });

const cleanJpeg = new Uint8Array(
  readFileSync(
    resolve(__dirname, '../../../utils/__fixtures__/media-metadata/clean.jpg')
  )
);

const jpeg = (name = 'photo.jpg') =>
  new File([cleanJpeg], name, { type: 'image/jpeg' });

const decode = (base64: string) =>
  JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    )
  );

const publishedResources = () =>
  (sendMessage.mock.calls[0][1] as { resources: Record<string, unknown>[] })
    .resources;

let previews = 0;

beforeEach(() => {
  compressor.hang = false;
  previews = 0;
  sendMessage.mockReset();
  sendMessage.mockResolvedValue([{ signature: 'sig' }]);
  window.sendMessage = sendMessage;
  vi.mocked(executeEvent).mockClear();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => {
        previews += 1;
        return `blob:preview-${previews}`;
      });
      static revokeObjectURL = vi.fn();
    }
  );
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TorqComposer', () => {
  it('opens in place and folds away on Cancel, keeping the draft', () => {
    renderComposer();
    expect(screen.queryByRole('textbox', { name: 'Post text' })).toBeNull();

    openComposer();
    expect(
      screen.getByRole('region', { name: 'Post to Torq' })
    ).toBeInTheDocument();
    type('draft text');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('textbox', { name: 'Post text' })).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();

    openComposer();
    expect(editor()).toHaveValue('draft text');
  });

  it('keeps Post disabled until there is something to post', () => {
    renderComposer();
    openComposer();
    expect(postButton()).toBeDisabled();

    type('   ');
    expect(postButton()).toBeDisabled();
    type('hello');
    expect(postButton()).toBeEnabled();
    type('');
    expect(postButton()).toBeDisabled();

    // A poll counts once it has two different choices.
    fireEvent.click(screen.getByRole('button', { name: 'Add poll' }));
    expect(postButton()).toBeDisabled();
    expect(
      screen.getByText('A poll needs at least 2 different choices.')
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Choice 1' }), {
      target: { value: 'Yes' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Choice 2' }), {
      target: { value: 'yes' },
    });
    expect(postButton()).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Choice 2' }), {
      target: { value: 'No' },
    });
    expect(postButton()).toBeEnabled();

    // So does a photo.
    fireEvent.click(screen.getByRole('button', { name: 'Remove poll' }));
    expect(postButton()).toBeDisabled();
    addImages([jpeg()]);
    expect(postButton()).toBeEnabled();
  });

  it('publishes a Torq post through Hub, then folds away', async () => {
    const { onPublished } = renderComposer();
    openComposer();
    type('Hello #Qortal');
    fireEvent.click(postButton());

    await waitFor(() => expect(onPublished).toHaveBeenCalledTimes(1));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [action, , timeout, isExtension, appInfo] = sendMessage.mock.calls[0];
    expect(action).toBe('PUBLISH_MULTIPLE_QDN_RESOURCES');
    expect(timeout).toBe(240000);
    expect(isExtension).toBe(true);
    expect(appInfo).toBeUndefined();
    const resources = publishedResources();
    expect(resources).toHaveLength(1);
    const [resource] = resources;
    expect(resource).toMatchObject({
      description: '~#qortal~',
      name: 'Alice',
      service: 'DOCUMENT',
    });
    expect(resource.identifier).toMatch(POST_ID);
    expect(decode(String(resource.base64))).toMatchObject({
      name: 'Alice',
      text: 'Hello #Qortal',
    });
    expect(onPublished).toHaveBeenCalledWith({
      author: 'Alice',
      postIdentifier: resource.identifier,
    });

    // Folded, saying so, with a way to the new post.
    expect(screen.queryByRole('textbox', { name: 'Post text' })).toBeNull();
    expect(screen.getByText('Published to Torq')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open latest post' }));
    expect(executeEvent).toHaveBeenCalledWith('addTab', {
      data: {
        identifier: '',
        name: 'Torq',
        path: `post/Alice/${resource.identifier}`,
        service: 'APP',
      },
    });

    // The next post starts empty.
    fireEvent.click(screen.getByRole('button', { name: 'Published to Torq' }));
    expect(editor()).toHaveValue('');
  });

  it('publishes photos and a poll with the post', async () => {
    const { onPublished } = renderComposer();
    openComposer();
    addImages([jpeg('a.jpg'), jpeg('b.jpg')]);
    fireEvent.click(screen.getByRole('button', { name: 'Add poll' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Choice 1' }), {
      target: { value: 'Cats' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Choice 2' }), {
      target: { value: 'Dogs' },
    });
    fireEvent.click(postButton());

    await waitFor(() => expect(onPublished).toHaveBeenCalledTimes(1));
    const [resource] = publishedResources();
    const post = decode(String(resource.base64));
    expect(post.images).toHaveLength(2);
    expect(post.poll).toEqual({
      options: [
        { id: 'opt_1', text: 'Cats' },
        { id: 'opt_2', text: 'Dogs' },
      ],
    });
    expect(post.text).toBe(
      `qortal://APP/Torq/post/Alice/${resource.identifier}`
    );
  });

  it('shows progress and keeps Post disabled while publishing', async () => {
    let answer: (value: unknown) => void = () => undefined;
    sendMessage.mockImplementation(
      () => new Promise((resolve) => (answer = resolve))
    );
    renderComposer();
    openComposer();
    type('hi');
    fireEvent.click(postButton());

    const publishing = await screen.findByRole('button', {
      name: 'Publishing…',
    });
    expect(publishing).toBeDisabled();
    expect(await screen.findByText('Publishing post…')).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar').length).toBeGreaterThan(0);
    // The approval dialog has it now: it can't be called back from here.
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(editor()).toBeDisabled();

    await act(async () => answer([{ signature: 'sig' }]));
    expect(await screen.findByText('Published to Torq')).toBeInTheDocument();
  });

  it('treats a declined approval as a cancel, keeping the draft', async () => {
    sendMessage.mockResolvedValue({
      error: 'User declined request',
      message: 'User declined request',
    });
    const { onPublished } = renderComposer();
    openComposer();
    type('keep me');
    fireEvent.click(postButton());

    await waitFor(() => expect(postButton()).toBeEnabled());
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(editor()).toHaveValue('keep me');
    expect(onPublished).not.toHaveBeenCalled();
  });

  it('shows why a publish failed, in the user’s language', async () => {
    const balance = i18n.t('question:message.error.insufficient_balance_qort', {
      postProcess: 'capitalizeFirstChar',
    });
    sendMessage.mockResolvedValueOnce({ error: balance, message: balance });
    sendMessage.mockRejectedValueOnce({ error: 'timeout', message: 'late' });
    const { onPublished } = renderComposer();
    openComposer();
    type('hi');

    fireEvent.click(postButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(balance);

    fireEvent.click(postButton());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to publish')
    );
    expect(editor()).toHaveValue('hi');
    expect(onPublished).not.toHaveBeenCalled();
  });

  it('stops a publish on Cancel before it reaches the approval dialog', async () => {
    compressor.hang = true;
    renderComposer();
    openComposer();
    type('a photo');
    addImages([jpeg()]);
    fireEvent.click(postButton());

    expect(
      await screen.findByText('Compressing images… (1/1)')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(postButton()).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(editor()).toHaveValue('a photo');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('takes up to ten photos, and no GIFs', () => {
    renderComposer();
    openComposer();
    addImages(Array.from({ length: 11 }, (_, i) => jpeg(`p${i}.jpg`)));

    expect(
      screen.getAllByRole('button', { name: 'Remove image' })
    ).toHaveLength(10);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Maximum 10 images per post'
    );
    expect(screen.getByRole('button', { name: 'Add image' })).toBeDisabled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove image' })[0]);
    expect(
      screen.getAllByRole('button', { name: 'Remove image' })
    ).toHaveLength(9);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');

    addImages([new File(['GIF89a'], 'cat.gif', { type: 'image/gif' })]);
    expect(screen.getByRole('alert')).toHaveTextContent(
      "GIF images can't be attached as photos"
    );
    expect(
      screen.getAllByRole('button', { name: 'Remove image' })
    ).toHaveLength(9);
  });

  it('says posting needs a Qortal name, and does not open without one', () => {
    renderComposer('');
    expect(
      screen.getByText('Register a Qortal name to publish on Torq.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post to Torq' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Post text' })).toBeNull();
  });
});
