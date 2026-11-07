import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileToBase64 } from './index';
import { QAppFileReference } from '../../qortal/qapp-file-reference';

vi.mock('../../i18n/i18n', () => ({ default: { t: (key: string) => key } }));
afterEach(() => vi.restoreAllMocks());
describe('legacy whole-file conversion', () => {
  it('reads native references directly and serializes them with local FileReader work', async () => {
    const original = FileReader.prototype.readAsDataURL;
    const readers: FileReader[] = [];
    let peak = 0;
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(
      function (blob) {
        readers.push(this);
        original.call(this, blob);
        peak = Math.max(
          peak,
          readers.filter((reader) => reader.readyState === FileReader.LOADING)
            .length
        );
      }
    );
    const call = vi.fn().mockResolvedValue(new Blob(['abc']));
    const native = new QAppFileReference(
      { reference: {}, size: 3, type: '' },
      0,
      call
    );
    expect(
      await Promise.all([
        fileToBase64(native),
        fileToBase64(new Blob(['abc'])),
        fileToBase64(native),
      ])
    ).toEqual(['YWJj', 'YWJj', 'YWJj']);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenCalledWith({ kind: 'reference', file: 0 });
    expect(peak).toBe(1);
  });
  it('releases the semaphore even when a read cannot be started', async () => {
    await expect(fileToBase64({})).rejects.toThrow();
    expect(await fileToBase64(new Blob(['abc']))).toBe('YWJj');
  });
  it('preserves empty inputs', async () => {
    expect(await fileToBase64(new Blob([]))).toBe('');
  });
});
