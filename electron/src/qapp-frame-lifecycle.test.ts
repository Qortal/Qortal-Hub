import { describe, expect, it, vi } from 'vitest';
import { QAppFrameLifecycle } from './qapp-frame-lifecycle';

const owner = { tabId: 'one', name: 'app', service: 'APP' };

describe('QAppFrameLifecycle', () => {
  it('cleans only the navigating tab and ignores same-document navigation', () => {
    const cleanup = vi.fn(async () => {});
    const lifecycle = new QAppFrameLifecycle(cleanup);
    lifecycle.register('first', owner);
    lifecycle.register('second', { ...owner, tabId: 'two' });
    lifecycle.navigate('first', true);
    lifecycle.navigate('unknown', false);
    expect(cleanup).not.toHaveBeenCalled();
    lifecycle.navigate('first', false);
    expect(cleanup).toHaveBeenCalledExactlyOnceWith(owner);
  });

  it('snapshots old resources before the next page can create new ones', async () => {
    const resources = new Set(['old']);
    let finish!: () => void;
    const lifecycle = new QAppFrameLifecycle(async () => {
      const old = [...resources];
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      old.forEach((id) => resources.delete(id));
    });
    lifecycle.register('frame', owner);
    lifecycle.navigate('frame', false);
    resources.add('new');
    finish();
    await Promise.resolve();
    expect([...resources]).toEqual(['new']);
  });

  it('retains registration across reloads and unregisters once on tab close', () => {
    const cleanup = vi.fn(async () => {});
    const lifecycle = new QAppFrameLifecycle(cleanup);
    lifecycle.register('frame', owner);
    lifecycle.navigate('frame', false);
    lifecycle.navigate('frame', false);
    lifecycle.unregister('frame');
    lifecycle.unregister('frame');
    expect(cleanup).toHaveBeenCalledTimes(3);
  });

  it('cleans all registrations on shell navigation/crash and tolerates shutdown failure', async () => {
    const cleanup = vi.fn(async () => {
      throw new Error('closed');
    });
    const lifecycle = new QAppFrameLifecycle(cleanup);
    lifecycle.register('first', owner);
    lifecycle.register('second', { ...owner, tabId: 'two' });
    lifecycle.clear();
    lifecycle.clear();
    expect(cleanup).toHaveBeenCalledTimes(2);
    await Promise.resolve();
  });
});
