import { pathToFileURL } from 'url';
import type { shell } from 'electron';

export async function openLocalPath(
  filePath: string,
  desktopShell: Pick<typeof shell, 'openPath' | 'openExternal'>,
  platform: NodeJS.Platform = process.platform
): Promise<string> {
  if (platform === 'linux') {
    // Electron 44.1.1's Linux openPath drops its completion callback, so an
    // awaiting IPC handler can fail with "reply was never sent" after GC.
    // openExternal resolves after dispatching the same desktop opener. Convert
    // the trusted local path to a URL so spaces, #, %, etc. stay literal.
    await desktopShell.openExternal(pathToFileURL(filePath).href);
    return '';
  }
  return desktopShell.openPath(filePath);
}

// Keep renderer-provided links separate from trusted local file/folder paths.
// Catch launch failures here because the renderer API is intentionally void.
export async function openExternalHttp(
  url: unknown,
  desktopShell: Pick<typeof shell, 'openExternal'>,
  onError: (error: unknown) => void
): Promise<void> {
  if (typeof url !== 'string') return;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return;
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    !parsed.hostname
  ) {
    return;
  }
  try {
    await desktopShell.openExternal(parsed.toString());
  } catch (error) {
    onError(error);
  }
}
