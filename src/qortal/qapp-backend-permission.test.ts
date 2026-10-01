import { describe, expect, it, vi } from 'vitest';
import {
  createBackendPermissions,
  unapprovedSessionPermissions,
} from './qapp-backend-permission';

const app = { tabId: 42, name: 'ExampleApp' };
const destination = 'a'.repeat(32);

const setup = () => {
  const granted = new Map<string, Set<string>>();
  const request = vi.fn().mockResolvedValue(true);
  const grant = vi.fn((tabId, name, permissions: string[]) => {
    granted.set(`${tabId}:${name}`, new Set(permissions));
  });
  const has = (tabId, name, permission) =>
    granted.get(`${tabId}:${name}`)?.has(permission) ?? false;
  const backend = createBackendPermissions(request, grant);
  return { backend, request, grant, has };
};

describe('combined backend connection approval', () => {
  it('one approval covers the backend and subsequent private transport permission', async () => {
    const { backend, request, grant, has } = setup();
    expect(
      unapprovedSessionPermissions(app, ['PRIVATE_DATA_CHANNEL'], has)
    ).toEqual(['PRIVATE_DATA_CHANNEL']);
    await backend.authorize(app, destination, false);
    expect(request).toHaveBeenCalledExactlyOnceWith(app, false);
    expect(backend.has(app, destination)).toBe(true);
    expect(grant).toHaveBeenCalledWith(42, 'ExampleApp', [
      'PRIVATE_DATA_CHANNEL',
    ]);
    expect(
      unapprovedSessionPermissions(app, ['PRIVATE_DATA_CHANNEL'], has)
    ).toEqual([]);
    await backend.authorize(app, destination, false);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not approve unrelated permissions in a mixed request', async () => {
    const { backend, has } = setup();
    await backend.authorize(app, destination, false);
    expect(
      unapprovedSessionPermissions(
        app,
        ['PRIVATE_DATA_CHANNEL', 'SEND_COIN', 'SEND_COIN'],
        has
      )
    ).toEqual(['SEND_COIN']);
    expect(
      unapprovedSessionPermissions(
        { ...app, tabId: 43 },
        ['PRIVATE_DATA_CHANNEL'],
        has
      )
    ).toEqual(['PRIVATE_DATA_CHANNEL']);
  });

  it('requires another approval for another backend, app, or tab', async () => {
    const { backend, request } = setup();
    await backend.authorize(app, destination, false);
    for (const [owner, target] of [
      [app, 'b'.repeat(32)],
      [{ ...app, tabId: 43 }, destination],
      [{ ...app, name: 'OtherApp' }, destination],
    ] as const) {
      expect(backend.has(owner, target)).toBe(false);
      await backend.authorize(owner, target, false);
    }
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('declining grants neither permission and allows a later retry', async () => {
    const { backend, request, grant } = setup();
    request.mockResolvedValueOnce(false);
    await expect(backend.authorize(app, destination, true)).rejects.toThrow(
      'RNS_PERMISSION_DENIED'
    );
    expect(backend.has(app, destination)).toBe(false);
    expect(grant).not.toHaveBeenCalled();
    await backend.authorize(app, destination, true);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('coalesces simultaneous requests for the same backend', async () => {
    const { backend, request } = setup();
    await Promise.all([
      backend.authorize(app, destination, false),
      backend.authorize(app, destination, false),
    ]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('clears only the closed tab and asks again when reopened', async () => {
    const { backend, request } = setup();
    const other = { ...app, tabId: 420 };
    await backend.authorize(app, destination, false);
    await backend.authorize(other, destination, false);
    backend.clearByTabId(42);
    expect(backend.has(app, destination)).toBe(false);
    expect(backend.has(other, destination)).toBe(true);
    await backend.authorize(app, destination, false);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('ignores approval responses arriving after the tab was closed', async () => {
    const { backend, request, grant } = setup();
    let accept!: (value: boolean) => void;
    request.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        })
    );
    const pending = backend.authorize(app, destination, false);
    await Promise.resolve();
    backend.clearByTabId(42);
    accept(true);
    await expect(pending).rejects.toThrow('RNS_PERMISSION_DENIED');
    expect(backend.has(app, destination)).toBe(false);
    expect(grant).not.toHaveBeenCalled();
  });
});
