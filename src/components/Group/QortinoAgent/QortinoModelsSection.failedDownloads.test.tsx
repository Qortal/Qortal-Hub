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

/** The model process, as far as a model added by link can tell. */
function fakeBridge(downloadError: string) {
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
    // The main process ends the download with this error.
    downloadUrl: vi.fn(async () => {
      throw new Error(downloadError);
    }),
    cancelDownload: vi.fn(async () => undefined),
    pickModelFile: vi.fn(async () => null),
    on: vi.fn(() => () => undefined),
  };
}

describe('A model download by link that failed', () => {
  afterEach(() => {
    delete window.qortinoLlm;
    resetQortinoModelsForTests();
    localStorage.clear();
  });

  beforeEach(() => {
    localStorage.clear();
    resetQortinoModelsForTests();
  });

  const addByLink = async (downloadError: string) => {
    const bridge = fakeBridge(downloadError);
    window.qortinoLlm = bridge as unknown as typeof window.qortinoLlm;
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
      target: { value: 'https://example.com/models/model-Q4_K_M.gguf' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() =>
      expect(getQortinoModels().others).toEqual([
        expect.objectContaining({ status: 'failed', error: downloadError }),
      ])
    );
    // The add dialog closes once the download has started.
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    return bridge;
  };

  it('says the link brought a web page, without offering to try again', async () => {
    await addByLink('not_gguf');

    expect(
      screen.getByText(
        "That link brought a web page, not the model file. Remove it and add the file's own download link."
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Try the download again' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove this model' })
    ).toBeInTheDocument();
  });

  it('says the disk has no room for the model, and offers to try again', async () => {
    const bridge = await addByLink('not_enough_space');

    expect(
      screen.getByText(
        'Not enough free space on this computer for this model. Free up some space, then try again.'
      )
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Try the download again' })
    );
    await waitFor(() => expect(bridge.downloadUrl).toHaveBeenCalledTimes(2));
  });

  it('offers to try again when the saved file could not be read', async () => {
    const reason = 'EBUSY: resource busy or locked';
    const bridge = await addByLink(reason);

    expect(
      screen.getByText(
        `The download stopped: ${reason}. Try again to carry on from where it stopped.`
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/That link brought a web page/)
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Try the download again' })
    );
    await waitFor(() => expect(bridge.downloadUrl).toHaveBeenCalledTimes(2));
  });
});
