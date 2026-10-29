import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  prepareQAppRequest,
  QAppBinaryReceiver,
  QAppBinarySender,
  QAPP_BINARY_CHUNK_SIZE,
  QAPP_BINARY_MAX_BYTES,
} from './qapp-request-transport';

// jsdom lacks Blob.arrayBuffer(); use the native implementations for byte checks.
vi.stubGlobal('Blob', NodeBlob);
vi.stubGlobal('File', NodeFile);
afterAll(() => vi.unstubAllGlobals());

const documentId = 'a'.repeat(32);
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
  vi.useRealTimers();
});

function bridge() {
  const received: any[] = [];
  const messages: any[] = [];
  const receiver = new QAppBinaryReceiver(
    documentId,
    (ack) => sender.acknowledge(structuredClone(ack)),
    (request) => received.push(request)
  );
  const sender = new QAppBinarySender((message) => {
    messages.push(message);
    receiver.receive(structuredClone(message));
  });
  cleanup.push(() => {
    sender.dispose();
    receiver.dispose();
  });
  const send = (data: any, requestId = 1) =>
    sender.sendRequest(
      { documentId, requestId, data },
      prepareQAppRequest(data)
    );
  return { send, received, messages, receiver, sender };
}

describe('Q-App binary request transport', () => {
  it('restores nested files, empty blobs, metadata, shared references and cycles', async () => {
    const file = new File(['hello'], 'photo.txt', {
      type: 'text/plain',
      lastModified: 12345,
    });
    const empty = new Blob([], { type: 'application/octet-stream' });
    const data: any = {
      action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
      resources: [{ file }, { file: empty }, { file }],
      map: new Map([[file, new Set([empty])]]),
      bytes: new Uint8Array([1, 2, 3]),
      date: new Date(42),
      // Lookalike user objects must never be interpreted as binary descriptors.
      ordinary: { reference: {}, size: 12, type: 'text/plain' },
    };
    data.self = data;
    Object.defineProperty(data, '__proto__', {
      value: { safe: true },
      enumerable: true,
    });
    const b = bridge();
    await b.send(data);
    const restored = b.received[0].data;
    const actual = restored.resources[0].file;
    expect(actual).toBeInstanceOf(File);
    expect(await actual.text()).toBe('hello');
    expect([actual.name, actual.type, actual.lastModified]).toEqual([
      'photo.txt',
      'text/plain',
      12345,
    ]);
    expect(restored.resources[1].file).toBeInstanceOf(Blob);
    expect(restored.resources[1].file).not.toBeInstanceOf(File);
    expect(restored.resources[1].file.size).toBe(0);
    expect(restored.resources[2].file).toBe(actual);
    expect(restored.map.get(actual).has(restored.resources[1].file)).toBe(true);
    expect(restored.self).toBe(restored);
    expect(Array.from(restored.bytes)).toEqual(Array.from(data.bytes));
    expect(restored.date.getTime()).toBe(data.date.getTime());
    expect(restored.ordinary).toEqual(data.ordinary);
    expect(Object.getPrototypeOf(restored)).toBe(Object.prototype);
    expect(Object.hasOwn(restored, '__proto__')).toBe(true);
    expect(restored.__proto__).toEqual({ safe: true });
  });

  it('chunks large binary data exactly and serializes concurrent transfers', async () => {
    const bytes = Uint8Array.from(
      { length: QAPP_BINARY_CHUNK_SIZE * 3 + 17 },
      (_, i) => i % 251
    );
    const b = bridge();
    await Promise.all([
      b.send({ action: 'SAVE_FILE', blob: new Blob([bytes]) }, 1),
      b.send(
        { action: 'ENCRYPT_DATA', file: new File(['second'], 'second') },
        2
      ),
    ]);
    expect(
      Buffer.from(await b.received[0].data.blob.arrayBuffer()).equals(
        Buffer.from(bytes)
      )
    ).toBe(true);
    expect(await b.received[1].data.file.text()).toBe('second');
    const chunks = b.messages.filter((m) => m.kind === 'chunk');
    expect(chunks.slice(0, 4).map((m) => m.bytes.byteLength)).toEqual([
      QAPP_BINARY_CHUNK_SIZE,
      QAPP_BINARY_CHUNK_SIZE,
      QAPP_BINARY_CHUNK_SIZE,
      17,
    ]);
    expect(b.messages.findIndex((m) => m.requestId === 2)).toBeGreaterThan(
      b.messages.findIndex((m) => m.requestId === 1 && m.kind === 'finish')
    );
  });

  it('does not change non-Blob requests or existing typed-array chunks', () => {
    const data = { action: 'FILE_SAVE_WRITE', data: new Uint8Array([1, 2]) };
    expect(prepareQAppRequest(data)).toEqual({ data, files: [], blobs: [] });
    expect(prepareQAppRequest(data).data).toBe(data);
  });

  it('waits for each acknowledgement and ignores unrelated acknowledgements', async () => {
    const messages: any[] = [];
    const sender = new QAppBinarySender((message) => messages.push(message));
    cleanup.push(() => sender.dispose());
    const data = { blob: new Blob(['hello']) };
    const task = sender.sendRequest(
      { documentId, requestId: 1, data },
      prepareQAppRequest(data)
    );
    await vi.waitFor(() => expect(messages).toHaveLength(1));
    sender.acknowledge({ documentId: 'wrong', requestId: 1, step: 0 });
    sender.acknowledge({ documentId, requestId: 2, step: 0 });
    sender.acknowledge({ documentId, requestId: 1, step: 2 });
    await Promise.resolve();
    expect(messages).toHaveLength(1);
    sender.acknowledge(messages[0]);
    await vi.waitFor(() => expect(messages).toHaveLength(2));
    sender.acknowledge(messages[1]);
    await vi.waitFor(() => expect(messages).toHaveLength(3));
    sender.acknowledge(messages[2]);
    await task;
  });

  it.each([
    'missing',
    'offset',
    'oversized',
    'wrong-step',
    'duplicate-start',
    'invalid-metadata',
  ])(
    'rejects %s transfers without dispatching partial data',
    async (failure) => {
      const acks: any[] = [];
      const dispatch = vi.fn();
      const receiver = new QAppBinaryReceiver(
        documentId,
        (ack) => acks.push(ack),
        dispatch
      );
      cleanup.push(() => receiver.dispose());
      const prepared = prepareQAppRequest({ blob: new Blob(['hello']) });
      const base = { documentId, requestId: 1 };
      const start = {
        ...base,
        kind: 'start' as const,
        step: 0,
        data: prepared.data,
        files: prepared.files,
      };
      if (failure === 'invalid-metadata')
        start.files[0].size = QAPP_BINARY_MAX_BYTES + 1;
      receiver.receive(start);
      if (failure === 'missing')
        receiver.receive({ ...base, kind: 'finish', step: 1 });
      if (failure === 'duplicate-start') receiver.receive(start);
      if (['offset', 'oversized', 'wrong-step'].includes(failure))
        receiver.receive({
          ...base,
          kind: 'chunk',
          step: failure === 'wrong-step' ? 5 : 1,
          fileIndex: 0,
          offset: failure === 'offset' ? 1 : 0,
          bytes: new ArrayBuffer(
            failure === 'oversized' ? QAPP_BINARY_CHUNK_SIZE + 1 : 5
          ),
        });
      expect(acks.at(-1).error).toBe('QAPP_BRIDGE_ERROR');
      expect(dispatch).not.toHaveBeenCalled();
      receiver.receive({ ...base, kind: 'finish', step: 2 });
      expect(dispatch).not.toHaveBeenCalled();
    }
  );

  it('expires partial transfers, ignores other documents, and drops aborted data', async () => {
    vi.useFakeTimers();
    const acks: any[] = [];
    const dispatch = vi.fn();
    const receiver = new QAppBinaryReceiver(
      documentId,
      (ack) => acks.push(ack),
      dispatch,
      20
    );
    cleanup.push(() => receiver.dispose());
    const p = prepareQAppRequest({ blob: new Blob(['hello']) });
    const start = {
      documentId,
      requestId: 1,
      kind: 'start' as const,
      step: 0,
      data: p.data,
      files: p.files,
    };
    receiver.receive({ ...start, documentId: 'old' });
    expect(acks).toHaveLength(0);
    receiver.receive(start);
    await vi.advanceTimersByTimeAsync(21);
    expect(acks.at(-1).error).toBe('QAPP_BRIDGE_ERROR');
    receiver.receive(start);
    expect(acks.at(-1).error).toBeUndefined();
    receiver.receive({ documentId, requestId: 1, kind: 'abort', step: 1 });
    receiver.receive({ documentId, requestId: 1, kind: 'finish', step: 1 });
    expect(acks.at(-1).error).toBe('QAPP_BRIDGE_ERROR');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('times out lost acknowledgements and recovers for the next request', async () => {
    vi.useFakeTimers();
    const messages: any[] = [];
    const sender = new QAppBinarySender(
      (message) => messages.push(message),
      20
    );
    cleanup.push(() => sender.dispose());
    const data = { blob: new Blob([]) };
    const failed = sender.sendRequest(
      { documentId, requestId: 1, data },
      prepareQAppRequest(data)
    );
    const check = expect(failed).rejects.toThrow('QAPP_BRIDGE_ERROR');
    await vi.advanceTimersByTimeAsync(21);
    await check;
    expect(messages.at(-1).kind).toBe('abort');
    const second = sender.sendRequest(
      { documentId, requestId: 2, data },
      prepareQAppRequest(data)
    );
    await Promise.resolve();
    sender.acknowledge(messages.at(-1));
    await Promise.resolve();
    sender.acknowledge(messages.at(-1));
    await second;
  });
  it.each(['timeout', 'dispose'])(
    'unblocks a stalled Blob read on %s',
    async (reason) => {
      vi.useFakeTimers();
      const messages: any[] = [];
      const sender = new QAppBinarySender((message) => {
        messages.push(message);
        if (message.kind !== 'abort') sender.acknowledge(message);
      }, 20);
      cleanup.push(() => sender.dispose());
      const data = { blob: new Blob(['x']) };
      const prepared = prepareQAppRequest(data);
      let completeRead: (value: ArrayBuffer) => void;
      const read = new Promise<ArrayBuffer>((resolve) => {
        completeRead = resolve;
      });
      const slice = vi
        .spyOn(prepared.blobs[0], 'slice')
        .mockReturnValue({ arrayBuffer: () => read } as Blob);
      let result = 'pending';
      const first = sender
        .sendRequest({ documentId, requestId: 1, data }, prepared)
        .then(
          () => {
            result = 'success';
          },
          () => {
            result = 'failed';
          }
        );
      const second = sender
        .sendRequest(
          { documentId, requestId: 2, data: {} },
          prepareQAppRequest({ blob: new Blob([]) })
        )
        .then(
          () => 'success',
          () => 'failed'
        );
      await vi.advanceTimersByTimeAsync(0);
      expect(slice).toHaveBeenCalledOnce();
      if (reason === 'dispose') sender.dispose();
      await vi.advanceTimersByTimeAsync(21);
      // Check settlement before awaiting: the old implementation leaves this hung.
      expect(result).toBe('failed');
      await first;
      expect(await second).toBe(reason === 'dispose' ? 'failed' : 'success');
      completeRead(new ArrayBuffer(1));
      await vi.advanceTimersByTimeAsync(0);
      expect(messages.some((message) => message.kind === 'chunk')).toBe(false);
    }
  );
  it('ignores a late read completion while the next request awaits its acknowledgement', async () => {
    vi.useFakeTimers();
    const messages: any[] = [];
    const sender = new QAppBinarySender((message) => {
      messages.push(message);
      if (
        message.kind !== 'abort' &&
        !(message.requestId === 2 && message.kind === 'start')
      )
        sender.acknowledge(message);
    }, 20);
    cleanup.push(() => sender.dispose());
    let completeRead: (value: ArrayBuffer) => void;
    const read = new Promise<ArrayBuffer>((resolve) => {
      completeRead = resolve;
    });
    const data = { blob: new Blob(['x']) };
    const prepared = prepareQAppRequest(data);
    vi.spyOn(prepared.blobs[0], 'slice').mockReturnValue({
      arrayBuffer: () => read,
    } as Blob);
    const first = sender
      .sendRequest({ documentId, requestId: 1, data }, prepared)
      .catch(() => undefined);
    let result = 'pending';
    const second = sender
      .sendRequest(
        { documentId, requestId: 2, data: {} },
        prepareQAppRequest({ blob: new Blob([]) })
      )
      .then(
        () => {
          result = 'success';
        },
        () => {
          result = 'failed';
        }
      );
    await vi.advanceTimersByTimeAsync(21);
    await first;
    const nextStart = messages.at(-1);
    expect([nextStart.requestId, nextStart.kind]).toEqual([2, 'start']);
    completeRead(new ArrayBuffer(1));
    await vi.advanceTimersByTimeAsync(0);
    sender.acknowledge(nextStart);
    await vi.advanceTimersByTimeAsync(21);
    expect(result).toBe('success');
    await second;
  });
});
