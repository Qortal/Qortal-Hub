import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../i18n/i18n';
import { QortinoModelsSection } from './QortinoModelsSection';
import {
  getQortinoModels,
  resetQortinoModelsForTests,
} from '../../../qortinoAgent/models';

/** The model process, as far as adding a model by link can tell. */
function fakeBridge() {
  return {
    getDeviceTier: vi.fn(async () => ({
      totalRamBytes: 16 * 1024 ** 3,
      availRamBytes: 8 * 1024 ** 3,
      availStorageBytes: 100 * 1024 ** 3,
      totalStorageBytes: 500 * 1024 ** 3,
      lowMemory: false,
    })),
    getStoragePaths: vi.fn(async () => ({
      rootDir: '/data/Qortino AI',
      modelsDir: '/data/Qortino AI/models',
      knowledgeDir: '/data/Qortino AI/knowledge',
    })),
    otherModelPath: vi.fn(async ({ url }: { url: string }) => {
      const name = url.split('?')[0].split('/').pop() as string;
      return { relativePath: `other-models/abc/${name}`, filename: name };
    }),
    // Never finishes: the test only needs to see it start.
    downloadUrl: vi.fn(() => new Promise(() => undefined)),
    cancelDownload: vi.fn(async () => undefined),
    pickModelFile: vi.fn(async () => null),
    on: vi.fn(() => () => undefined),
  };
}

describe('Adding a model by link', () => {
  let bridge: ReturnType<typeof fakeBridge>;

  beforeEach(() => {
    localStorage.clear();
    resetQortinoModelsForTests();
    bridge = fakeBridge();
    window.qortinoLlm = bridge as unknown as typeof window.qortinoLlm;
  });

  afterEach(() => {
    delete window.qortinoLlm;
    resetQortinoModelsForTests();
    localStorage.clear();
  });

  const addByLink = async (url: string) => {
    render(
      <ThemeProvider theme={createTheme()}>
        <QortinoModelsSection
          install={{ installed: false }}
          onUseQortino={vi.fn()}
        />
      </ThemeProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add a model' }));
    fireEvent.change(await screen.findByLabelText('Link to a .gguf file'), {
      target: { value: url },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  };

  it('refuses a link to one part of a split model, before downloading', async () => {
    await addByLink(
      'https://huggingface.co/org/repo/resolve/main/model-Q4_K_M-00001-of-00003.gguf?download=true'
    );

    expect(bridge.downloadUrl).not.toHaveBeenCalled();
    expect(getQortinoModels().others).toEqual([]);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This link is to one part of a model split into several files. Download all of its parts into one folder, then pick the first one with “Choose a file…”.'
    );
    // The dialog stays open, so the user can choose a file instead.
    expect(
      screen.getByRole('button', { name: 'Choose a file…' })
    ).toBeInTheDocument();
  });

  it('refuses a later part of a split model too', async () => {
    await addByLink('https://example.com/models/big-model-00002-of-00002.gguf');

    expect(bridge.downloadUrl).not.toHaveBeenCalled();
    expect(getQortinoModels().others).toEqual([]);
    expect(screen.getByRole('alert')).toHaveTextContent(
      /one part of a model split into several files/
    );
  });

  it('downloads a model whose one file is named part 1 of 1', async () => {
    const url =
      'https://huggingface.co/org/repo/resolve/main/model-Q4_K_M-00001-of-00001.gguf';
    await addByLink(url);

    await waitFor(() =>
      expect(bridge.downloadUrl).toHaveBeenCalledWith(
        expect.objectContaining({ url })
      )
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('still downloads a model that is a single GGUF file', async () => {
    const url =
      'https://huggingface.co/org/repo/resolve/main/model-Q4_K_M.gguf?download=true';
    await addByLink(url);

    await waitFor(() =>
      expect(bridge.downloadUrl).toHaveBeenCalledWith(
        expect.objectContaining({ url })
      )
    );
    expect(getQortinoModels().others).toEqual([
      expect.objectContaining({ url, status: 'downloading' }),
    ]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
