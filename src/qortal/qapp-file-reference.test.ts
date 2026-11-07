import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachQAppFileClient,
  hasQAppFileReferences,
  isQAppFileReference,
} from './qapp-file-reference';

vi.mock('../i18n/i18n', () => ({ default: { t: (key: string) => key } }));
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
  vi.useRealTimers();
});
function fixture() {
  const receive = vi.fn();
  const failed = vi.fn();
  const port = {
    postMessage: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(),
    onmessage: undefined,
    onmessageerror: undefined,
  } as any;
  const dispose = attachQAppFileClient(port, receive, failed);
  cleanup.push(dispose);
  const reference = {};
  const deliver = (data: unknown) => port.onmessage({ data });
  const prepare = () => {
    deliver({
      kind: 'request',
      data: { file: reference, alias: reference },
      files: [{ reference, size: 3, type: 'text/plain', name: 'file.txt' }],
    });
    return receive.mock.calls[0][0].file;
  };
  return { port, receive, failed, dispose, deliver, prepare };
}

describe('trusted native file capabilities', () => {
  it('recognizes only authenticated instances and preserves aliases', () => {
    const f = fixture();
    const file = f.prepare();
    expect(f.port.postMessage).toHaveBeenCalledExactlyOnceWith({
      kind: 'accept',
    });
    expect(isQAppFileReference(file)).toBe(true);
    expect(isQAppFileReference({ ...file })).toBe(false);
    expect(f.receive.mock.calls[0][0].alias).toBe(file);
    const graph: any = { nested: new Map([[1, new Set([file])]]) };
    graph.self = graph;
    expect(hasQAppFileReferences(graph)).toBe(true);
    expect(
      hasQAppFileReferences({
        file: { size: 3, type: 'text/plain' },
        bytes: new Uint8Array(1024),
      })
    ).toBe(false);
  });
  it('serializes concurrent operations and keeps file ownership fixed', async () => {
    const f = fixture();
    const file = f.prepare();
    const first = file.readableBlob();
    const second = file.upload({
      endpoint: 'https://node.invalid/arbitrary/FILE/name/chunk',
      start: 0,
      end: 3,
      index: 0,
      kind: 'save',
      file: 999,
    });
    await Promise.resolve();
    expect(f.port.postMessage).toHaveBeenLastCalledWith({
      id: 1,
      operation: { kind: 'reference', file: 0 },
    });
    f.deliver({ id: 1, result: new Blob(['abc']) });
    await first;
    await vi.waitFor(() =>
      expect(f.port.postMessage).toHaveBeenLastCalledWith({
        id: 2,
        operation: {
          kind: 'upload',
          file: 0,
          endpoint: 'https://node.invalid/arbitrary/FILE/name/chunk',
          start: 0,
          end: 3,
          index: 0,
        },
      })
    );
    f.deliver({ id: 2, result: null });
    await second;
    f.dispose(true);
    expect(f.port.postMessage).toHaveBeenLastCalledWith({
      kind: 'release',
      completed: true,
    });
  });
  it('rejects pending and future operations after disposal', async () => {
    const f = fixture();
    const file = f.prepare();
    const pending = file.readableBlob();
    const rejected = expect(pending).rejects.toThrow(
      'question:message.error.perform_request'
    );
    await Promise.resolve();
    f.dispose();
    await rejected;
    await expect(file.readableBlob()).rejects.toThrow();
    expect(f.port.close).toHaveBeenCalledOnce();
  });
  it('does not start a whole-file read after the owning request is cancelled', async () => {
    const f = fixture();
    const file = f.prepare();
    const read = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    const pending = file.base64();
    const rejected = expect(pending).rejects.toThrow();
    await Promise.resolve();
    f.deliver({ id: 1, result: new Blob(['abc']) });
    f.dispose();
    await rejected;
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
  });
  it('fails closed on malformed metadata instead of leaking a live task', () => {
    const f = fixture();
    expect(() =>
      f.deliver({
        kind: 'request',
        files: [{ reference: {}, size: Infinity, type: 'text/plain' }],
      })
    ).not.toThrow();
    expect(f.failed).toHaveBeenCalledOnce();
    expect(f.receive).not.toHaveBeenCalled();
    expect(f.port.close).toHaveBeenCalledOnce();
  });
  it('bounds the wait for a worker that never sends its request', () => {
    vi.useFakeTimers();
    const f = fixture();
    vi.advanceTimersByTime(30_000);
    expect(f.failed).toHaveBeenCalledOnce();
    expect(f.port.close).toHaveBeenCalledOnce();
  });
});
