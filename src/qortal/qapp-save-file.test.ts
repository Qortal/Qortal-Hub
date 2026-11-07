import { afterEach, describe, expect, it, vi } from 'vitest';
import FileSaver from 'file-saver';
import { showSaveFilePicker } from './qapp-save-file';
import { QAppFileReference } from './qapp-file-reference';

vi.mock('file-saver', () => ({ default: { saveAs: vi.fn() } }));
vi.mock('../i18n/i18n', () => ({ default: { t: (key: string) => key } }));
afterEach(() => vi.restoreAllMocks());

function snacks() {
  return { setOpenSnackGlobal: vi.fn(), setInfoSnackCustom: vi.fn() };
}

describe('legacy SAVE_FILE download initiation', () => {
  it('saves a native reference without constructing a local Blob or invoking FileSaver', async () => {
    vi.mocked(FileSaver.saveAs).mockClear();
    const call = vi.fn().mockResolvedValue(null);
    const blob = new QAppFileReference(
      { reference: {}, size: 8, type: 'text/plain' },
      0,
      call
    );
    await showSaveFilePicker({ filename: 'hello.txt', blob }, snacks());
    expect(call).toHaveBeenCalledExactlyOnceWith({
      kind: 'save',
      file: 0,
      filename: 'hello.txt',
    });
    expect(FileSaver.saveAs).not.toHaveBeenCalled();
  });
  it('passes the original Blob to FileSaver and reports initiation, not completed saving', async () => {
    const blob = new Blob(['hello'], { type: 'text/plain' });
    const ui = snacks();
    await showSaveFilePicker({ filename: 'hello.txt', blob }, ui);
    expect(FileSaver.saveAs).toHaveBeenCalledWith(blob, 'hello.txt');
    expect(ui.setInfoSnackCustom).toHaveBeenCalledWith({
      type: 'info',
      message: 'question:legacy_save.started',
    });
  });

  it('rejects damaged blobs instead of reporting success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ui = snacks();
    await expect(
      showSaveFilePicker({ filename: 'hello.txt', blob: {} as Blob }, ui)
    ).rejects.toThrow('question:stream_save.failed');
    expect(ui.setInfoSnackCustom).toHaveBeenCalledWith({
      type: 'error',
      message: 'question:stream_save.failed',
    });
  });

  it('propagates FileSaver failures to the request handler with a localized error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(FileSaver.saveAs).mockImplementationOnce(() => {
      throw new Error('save failed');
    });
    const ui = snacks();
    await expect(
      showSaveFilePicker(
        { filename: 'hello.txt', blob: new Blob(['hello']) },
        ui
      )
    ).rejects.toThrow('question:stream_save.failed');
    expect(ui.setInfoSnackCustom).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' })
    );
  });
});
