import type { WebContents } from 'electron';

export type RendererDeliveryResult =
  | 'sent'
  | 'temporarily-unavailable'
  | 'destroyed';

export function isRendererFrameUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    message.includes('Render frame was disposed') ||
    message.includes('WebFrameMain could be accessed') ||
    message.includes('Object has been destroyed')
  );
}

export function isRendererMainFrameReady(webContents: WebContents): boolean {
  try {
    return !webContents.isDestroyed() && !webContents.isLoadingMainFrame();
  } catch {
    return false;
  }
}

export function sendToRenderer(
  webContents: WebContents,
  channel: string,
  payload?: unknown
): RendererDeliveryResult {
  try {
    if (webContents.isDestroyed()) return 'destroyed';
    if (webContents.isLoadingMainFrame()) return 'temporarily-unavailable';
    if (arguments.length >= 3) webContents.send(channel, payload);
    else webContents.send(channel);
    return 'sent';
  } catch {
    try {
      return webContents.isDestroyed()
        ? 'destroyed'
        : 'temporarily-unavailable';
    } catch {
      return 'destroyed';
    }
  }
}
