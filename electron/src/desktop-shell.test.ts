import { describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { openLocalPath, openExternalHttp } from './desktop-shell';
import { pathToFileURL } from 'url';

describe('local file and folder desktop dispatch', () => {
  it.each(['résumé #1% ?.pdf', 'config folder #1%'])(
    'dispatches the escaped Linux path %s without waiting for openPath',
    async (name) => {
      const shell = {
        openPath: vi.fn(() => new Promise<string>(() => {})),
        openExternal: vi.fn().mockResolvedValue(undefined),
      };
      const filePath = path.resolve('/tmp', name);
      await expect(openLocalPath(filePath, shell, 'linux')).resolves.toBe('');
      expect(shell.openPath).not.toHaveBeenCalled();
      expect(shell.openExternal).toHaveBeenCalledExactlyOnceWith(
        pathToFileURL(filePath).href
      );
    }
  );

  it('propagates a failed desktop dispatch rather than reporting success', async () => {
    const shell = {
      openPath: vi.fn(),
      openExternal: vi.fn().mockRejectedValue(new Error('test open failure')),
    };
    await expect(openLocalPath('/tmp/file', shell, 'linux')).rejects.toThrow(
      'test open failure'
    );
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  it.each(['win32', 'darwin'] as const)(
    'preserves openPath results on %s',
    async (platform) => {
      const shell = {
        openPath: vi.fn().mockResolvedValue('test OS error'),
        openExternal: vi.fn(),
      };
      await expect(openLocalPath('/test/file', shell, platform)).resolves.toBe(
        'test OS error'
      );
      expect(shell.openPath).toHaveBeenCalledExactlyOnceWith('/test/file');
      expect(shell.openExternal).not.toHaveBeenCalled();
    }
  );
});

describe('external HTTP links', () => {
  it.each([
    undefined,
    null,
    {},
    42,
    '',
    'invalid',
    '/relative',
    'file:///tmp/attachment',
    'javascript:alert(1)',
    'qortal://APP/Q-Mail',
    'mailto:user@example.com',
    'ftp://example.com/file',
  ])('ignores invalid or disallowed input %j', async (url) => {
    const shell = { openExternal: vi.fn() };
    const onError = vi.fn();
    await openExternalHttp(url, shell, onError);
    expect(shell.openExternal).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it.each(['http', 'https'])(
    'dispatches normalized %s links',
    async (protocol) => {
      const shell = { openExternal: vi.fn().mockResolvedValue(undefined) };
      const onError = vi.fn();
      await openExternalHttp(
        `  ${protocol}://EXAMPLE.com/a b#section  `,
        shell,
        onError
      );
      expect(shell.openExternal).toHaveBeenCalledExactlyOnceWith(
        `${protocol}://example.com/a%20b#section`
      );
      expect(onError).not.toHaveBeenCalled();
    }
  );

  it.each(['throw', 'reject'])(
    'handles launch failure (%s) without rejecting',
    async (mode) => {
      const error = new Error('test desktop launch failure');
      const shell = {
        openExternal: vi.fn(() => {
          if (mode === 'throw') throw error;
          return Promise.reject(error);
        }),
      };
      const onError = vi.fn();
      await expect(
        openExternalHttp('https://example.com', shell, onError)
      ).resolves.toBeUndefined();
      expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    }
  );
});
