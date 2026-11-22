import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../i18n/i18n';
import { isRunningPublicNodeAtom } from '../../../atoms/global';
import type { DownloadProgress } from '../../../qortinoAgent/download';
import { QWEN3_30B_MODEL } from '../../../qortinoAgent/manifest';
import {
  getQortinoModels,
  resetQortinoModelsForTests,
  resolveActiveQortinoModel,
} from '../../../qortinoAgent/models';
import type { QdnModelRetry } from '../../../qortinoAgent/qdnModelDownload';
import { QortinoModelsSection } from './QortinoModelsSection';

type Run = {
  onProgress: (progress: DownloadProgress) => void;
  onRetry: (retry: QdnModelRetry | null) => void;
  wake: () => void;
  fail: (error: unknown) => void;
};

/** The download from QDN, as far as the panel can tell. */
const qdn = vi.hoisted(() => ({
  runs: [] as Run[],
  downloadQdnModelWithRetries: vi.fn(
    (
      _model: unknown,
      options: {
        signal: AbortSignal;
        onProgress: Run['onProgress'];
        onRetry: Run['onRetry'];
        onWait?: (wake: () => void) => void;
      }
    ) =>
      new Promise<{ path: string }>((_resolve, reject) => {
        const run: Run = {
          onProgress: options.onProgress,
          onRetry: options.onRetry,
          wake: vi.fn(),
          fail: reject,
        };
        options.onWait?.(run.wake);
        qdn.runs.push(run);
        options.signal.addEventListener('abort', () =>
          reject(new Error('cancelled'))
        );
      })
  ),
}));
vi.mock('../../../qortinoAgent/qdnModelDownload', () => ({
  downloadQdnModelWithRetries: qdn.downloadQdnModelWithRetries,
}));

const GB = 1024 ** 3;

function fakeBridge(totalRamBytes = 64 * GB) {
  return {
    getDeviceTier: vi.fn(async () => ({
      totalRamBytes,
      availRamBytes: totalRamBytes / 2,
      availStorageBytes: 500 * GB,
      totalStorageBytes: 1_000 * GB,
      lowMemory: false,
    })),
    getStoragePaths: vi.fn(async () => ({
      rootDir: '/data/Qortino AI',
      modelsDir: '/data/Qortino AI/models',
      knowledgeDir: '/data/Qortino AI/knowledge',
    })),
    removeOtherModel: vi.fn(async (_options: { relativePath: string }) => ({
      freedBytes: 1,
    })),
    cancel: vi.fn(async () => undefined),
    pickModelFile: vi.fn(
      async (): Promise<{ path: string; name: string; size: number } | null> =>
        null
    ),
    on: vi.fn(() => () => undefined),
  };
}

async function renderSection(bridge = fakeBridge()) {
  window.qortinoLlm = bridge as unknown as typeof window.qortinoLlm;
  render(
    <ThemeProvider theme={createTheme()}>
      <QortinoModelsSection
        install={{ installed: true, llmPath: '/data/Qortino AI/models/q.gguf' }}
        onUseQortino={vi.fn()}
      />
    </ThemeProvider>
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return bridge;
}

/** The 30B's row with the notes and buttons under it. */
const bigRow = () =>
  screen
    .getByRole('radio', { name: QWEN3_30B_MODEL.label })
    .closest('.MuiBox-root')!.parentElement!.parentElement! as HTMLElement;

async function startDownload() {
  fireEvent.click(within(bigRow()).getByRole('button', { name: 'Download' }));
  await waitFor(() => expect(qdn.runs).toHaveLength(1));
}

describe('Models from QDN in the Model settings', () => {
  beforeEach(() => {
    localStorage.clear();
    resetQortinoModelsForTests();
    qdn.runs.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.qortinoLlm;
    getDefaultStore().set(isRunningPublicNodeAtom, false);
    resetQortinoModelsForTests();
    localStorage.clear();
  });

  it('offers the bigger model from QDN, and no web link anywhere', async () => {
    await renderSection();

    const row = bigRow();
    expect(row).toHaveTextContent('17.3 GB');
    expect(row).toHaveTextContent('best with 32.0 GB of memory');
    expect(row).toHaveTextContent('download from QDN');
    expect(within(row).getByRole('button', { name: 'Download' })).toBeEnabled();
    // Not usable before it is downloaded.
    expect(
      screen.getByRole('radio', { name: QWEN3_30B_MODEL.label })
    ).toBeDisabled();
    // Adding a model is a file from this computer, nothing else.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add a model file…' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/hugging ?face|https?:\/\//i);
  });

  it('downloads it from QDN part by part, and stops when asked', async () => {
    await renderSection();
    await startDownload();
    expect(qdn.downloadQdnModelWithRetries).toHaveBeenCalledWith(
      QWEN3_30B_MODEL,
      expect.anything()
    );

    act(() =>
      qdn.runs[0].onProgress({
        phase: 'save',
        partIndex: 2,
        partCount: 11,
        bytesDone: 512 * 1024 ** 2,
        bytesTotal: 1024 ** 3,
      })
    );
    expect(bigRow()).toHaveTextContent(
      'Part 2 of 11 · saving to this computer… 512.0 MB / 1.0 GB'
    );

    fireEvent.click(
      within(bigRow()).getByRole('button', { name: 'Stop the download' })
    );
    await waitFor(() =>
      expect(bigRow()).toHaveTextContent(
        'The download stopped. Try again to carry on from where it stopped.'
      )
    );
    const row = bigRow();
    expect(
      within(row).getByRole('button', { name: 'Try the download again' })
    ).toBeInTheDocument();
    expect(
      within(row).getByRole('button', { name: 'Remove this model' })
    ).toBeInTheDocument();
  });

  it('says why it waits, and tries again at once when asked', async () => {
    await renderSection();
    await startDownload();

    act(() =>
      qdn.runs[0].onRetry({
        error: { code: 'stalled', detail: 'part 4' },
        retryAt: Date.now() + 120_000,
      })
    );
    expect(bigRow()).toHaveTextContent(
      'No peer is sending the rest right now. Trying again in 2 min.'
    );

    fireEvent.click(within(bigRow()).getByRole('button', { name: 'Try now' }));
    expect(qdn.runs[0].wake).toHaveBeenCalled();
  });

  it('says why it gave up, about this model and not Qortino', async () => {
    await renderSection();
    await startDownload();

    act(() =>
      qdn.runs[0].fail(
        Object.assign(new Error('not_published'), {
          failure: { code: 'not_published', detail: 'part 1' },
        })
      )
    );

    await waitFor(() =>
      expect(bigRow()).toHaveTextContent(
        'This model is not on QDN yet, or your node cannot see it yet.'
      )
    );
    expect(bigRow()).not.toHaveTextContent("Qortino's model");
  });

  it('warns before downloading when it is too big for this computer', async () => {
    await renderSection(fakeBridge(16 * GB));

    expect(bigRow()).toHaveTextContent(
      "This model may be too big for this computer's 16.0 GB of memory."
    );
  });

  it("offers it through the user's own node only", async () => {
    getDefaultStore().set(isRunningPublicNodeAtom, true);
    await renderSection();

    expect(bigRow()).toHaveTextContent(
      "Only through your own node: this model's files are too big for the public node."
    );
    expect(
      within(bigRow()).getByRole('button', { name: 'Download' })
    ).toBeDisabled();
  });

  it('says why a download stopped when Hub went to the public node, and offers no retry there', async () => {
    await renderSection();
    await startDownload();
    act(() => getDefaultStore().set(isRunningPublicNodeAtom, true));

    act(() =>
      qdn.runs[0].fail(
        Object.assign(new Error('public_node'), {
          failure: { code: 'public_node' },
        })
      )
    );

    await waitFor(() =>
      expect(bigRow()).toHaveTextContent('Only through your own node')
    );
    expect(
      within(bigRow()).getByRole('button', { name: 'Try the download again' })
    ).toBeDisabled();
  });

  it('removes it with every part, after asking', async () => {
    const bridge = await renderSection();
    await startDownload();
    fireEvent.click(
      within(bigRow()).getByRole('button', { name: 'Stop the download' })
    );
    fireEvent.click(
      await within(bigRow()).findByRole('button', { name: 'Remove this model' })
    );
    expect(
      screen.getByText(
        'Remove this model and delete its files from this computer?'
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(bridge.removeOtherModel).toHaveBeenCalledTimes(
        QWEN3_30B_MODEL.parts.length
      )
    );
    await waitFor(() =>
      expect(
        within(bigRow()).getByRole('button', { name: 'Download' })
      ).toBeInTheDocument()
    );
    expect(getQortinoModels().others).toEqual([]);
  });

  it('adds a model file from this computer, but not a later part of a split one', async () => {
    const bridge = fakeBridge();
    bridge.pickModelFile
      .mockResolvedValueOnce({
        path: '/data/models/big-model-00002-of-00003.gguf',
        name: 'big-model-00002-of-00003.gguf',
        size: 10,
      })
      .mockResolvedValueOnce({
        path: '/data/models/small-model.gguf',
        name: 'small-model.gguf',
        size: 10,
      });
    await renderSection(bridge);

    fireEvent.click(screen.getByRole('button', { name: 'Add a model file…' }));
    expect(
      await screen.findByText(
        'This is a later part of a split model. Choose the part whose name ends in 00001-of-….'
      )
    ).toBeInTheDocument();
    expect(getQortinoModels().others).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Add a model file…' }));
    expect(
      await screen.findByRole('radio', { name: 'small-model' })
    ).toBeChecked();
  });

  it('lets a download from a web link by an earlier build only be removed', async () => {
    localStorage.setItem(
      'qortino:models:v1',
      JSON.stringify({
        activeId: 'qortino',
        others: [
          {
            id: 'model_half',
            label: 'Half',
            source: 'link',
            path: '/data/Qortino AI/other-models/def/half.gguf',
            sizeBytes: 0,
            addedAt: 2,
            relativePath: 'other-models/def/half.gguf',
            status: 'failed',
          },
        ],
      })
    );
    const bridge = await renderSection();

    const row = screen
      .getByRole('radio', { name: 'Half' })
      .closest('.MuiBox-root')!.parentElement!.parentElement! as HTMLElement;
    expect(row).toHaveTextContent(
      "Hub no longer downloads this model, so this download can't go on."
    );
    expect(
      within(row).queryByRole('button', { name: 'Try the download again' })
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(row).getByRole('button', { name: 'Remove this model' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(bridge.removeOtherModel).toHaveBeenCalledWith({
        relativePath: 'other-models/def/half.gguf',
      })
    );
  });

  it('says it cannot find the model yet, not that peers stopped sending', async () => {
    await renderSection();
    await startDownload();

    act(() =>
      qdn.runs[0].onRetry({
        error: {
          code: 'not_published',
          detail: QWEN3_30B_MODEL.parts[0].filename,
        },
        retryAt: Date.now() + 15_000,
      })
    );

    expect(bigRow()).toHaveTextContent(
      "Hub can't find this model on QDN yet. Trying again in 15 s."
    );
    expect(bigRow()).not.toHaveTextContent('No peer is sending');
  });

  it('says a failure Hub did not expect is a failed download', async () => {
    await renderSection();
    await startDownload();

    act(() => qdn.runs[0].fail(new Error('something unexpected')));

    await waitFor(() =>
      expect(bigRow()).toHaveTextContent(
        'Saving the model to this computer failed.'
      )
    );
    expect(bigRow()).not.toHaveTextContent('Assembling failed.');
  });

  it('lists a model from QDN that this build no longer offers, to use or remove', async () => {
    localStorage.setItem(
      'qortino:models:v1',
      JSON.stringify({
        activeId: 'qdn:older-model',
        others: [
          {
            id: 'qdn:older-model',
            label: 'Older Model 20B',
            source: 'qdn',
            qdnModelId: 'older-model',
            path: '/data/Qortino AI/other-models/older-model/older-00001-of-00002.gguf',
            relativePath: 'other-models/older-model/older-00001-of-00002.gguf',
            partPaths: [
              'other-models/older-model/older-00001-of-00002.gguf',
              'other-models/older-model/older-00002-of-00002.gguf',
            ],
            sizeBytes: 12 * GB,
            addedAt: 1,
            status: 'ready',
          },
        ],
      })
    );
    const bridge = await renderSection();
    // The chat answers with it, so the list shows it as the one in use.
    expect(resolveActiveQortinoModel(null)).toMatchObject({
      id: 'qdn:older-model',
      isQortino: false,
    });
    const radio = screen.getByRole('radio', { name: 'Older Model 20B' });
    expect(radio).toBeChecked();
    const row = radio.closest('.MuiBox-root')!.parentElement!
      .parentElement! as HTMLElement;

    fireEvent.click(
      within(row).getByRole('button', { name: 'Remove this model' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(getQortinoModels().others).toEqual([]));
    expect(bridge.removeOtherModel.mock.calls.map(([args]) => args)).toEqual([
      { relativePath: 'other-models/older-model/older-00001-of-00002.gguf' },
      { relativePath: 'other-models/older-model/older-00002-of-00002.gguf' },
    ]);
  });
});
