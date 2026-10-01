import { expect, it, vi } from 'vitest';
import { readBoundedWalletResponse } from './wallet-response';

it('decodes UTF-8 across chunk boundaries', async () => {
  const bytes = new TextEncoder().encode('€');
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, 1));
      controller.enqueue(bytes.slice(1));
      controller.close();
    },
  });
  expect(await readBoundedWalletResponse(new Response(body), 3)).toBe('€');
});

it('cancels an oversized stream without relying on Content-Length', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(5));
    },
    cancel,
  });
  await expect(
    readBoundedWalletResponse(new Response(body), 4)
  ).rejects.toThrow();
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
});
