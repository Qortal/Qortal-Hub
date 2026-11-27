import { describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import {
  isRendererFrameUnavailableError,
  isRendererMainFrameReady,
  sendToRenderer,
} from './renderer-delivery';

function webContentsStub(overrides: Partial<WebContents> = {}): WebContents {
  return {
    isDestroyed: vi.fn(() => false),
    isLoadingMainFrame: vi.fn(() => false),
    send: vi.fn(),
    ...overrides,
  } as unknown as WebContents;
}

describe('renderer delivery', () => {
  it('sends when the current main frame is ready', () => {
    const webContents = webContentsStub();

    expect(sendToRenderer(webContents, 'test:event', { ok: true })).toBe(
      'sent'
    );
    expect(webContents.send).toHaveBeenCalledWith('test:event', { ok: true });
  });

  it('preserves no-payload renderer notifications', () => {
    const webContents = webContentsStub();

    expect(sendToRenderer(webContents, 'test:event')).toBe('sent');
    expect(webContents.send).toHaveBeenCalledWith('test:event');
  });

  it('waits while the main frame is being replaced', () => {
    const webContents = webContentsStub({
      isLoadingMainFrame: vi.fn(() => true),
    });

    expect(isRendererMainFrameReady(webContents)).toBe(false);
    expect(sendToRenderer(webContents, 'test:event')).toBe(
      'temporarily-unavailable'
    );
    expect(webContents.send).not.toHaveBeenCalled();
  });

  it('contains a frame-disposal race without treating the WebContents as dead', () => {
    const webContents = webContentsStub({
      send: vi.fn(() => {
        throw new Error(
          'Render frame was disposed before WebFrameMain could be accessed'
        );
      }),
    });

    expect(sendToRenderer(webContents, 'test:event')).toBe(
      'temporarily-unavailable'
    );
    expect(
      isRendererFrameUnavailableError(
        new Error(
          'Render frame was disposed before WebFrameMain could be accessed'
        )
      )
    ).toBe(true);
  });

  it('reports destroyed WebContents for subscriber cleanup', () => {
    const webContents = webContentsStub({
      isDestroyed: vi.fn(() => true),
    });

    expect(isRendererMainFrameReady(webContents)).toBe(false);
    expect(sendToRenderer(webContents, 'test:event')).toBe('destroyed');
    expect(webContents.send).not.toHaveBeenCalled();
  });
});
