import type { IpcMainInvokeEvent, WebContents } from 'electron';

// Custom schemes have opaque URL.origin values. Compare the parsed protocol
// and authority, never a substring (or two equal "null" origins).
export function isMainWindowUrl(value: string, shellUrl: string): boolean {
  try {
    const url = new URL(value);
    const expected = new URL(shellUrl);
    return (
      url.protocol === expected.protocol &&
      url.host === expected.host &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function externalWebUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.hostname &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function requireMainWindowSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  mainContents: WebContents | undefined,
  shellUrl: string
): void {
  if (
    !mainContents ||
    mainContents.isDestroyed() ||
    event.sender !== mainContents ||
    !event.senderFrame ||
    event.senderFrame !== mainContents.mainFrame ||
    !isMainWindowUrl(event.senderFrame.url, shellUrl)
  ) {
    throw new Error('IPC is restricted to the Hub main document');
  }
}

export function installMainWindowNavigationPolicy(
  contents: WebContents,
  shellUrl: string,
  openExternal: (url: string) => Promise<unknown>,
  onError: (error: unknown) => void
): void {
  const openWebLink = (value: string) => {
    const url = externalWebUrl(value);
    if (url) void openExternal(url).catch(onError);
  };
  contents.on('will-navigate', (event, url) => {
    if (isMainWindowUrl(url, shellUrl)) return;
    event.preventDefault();
    openWebLink(url);
  });
  contents.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
    if (isMainFrame && !isMainWindowUrl(url, shellUrl)) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    // Keep internal links in the existing, authenticated window. Never create
    // a second shell with inherited preferences and no registered identity.
    if (isMainWindowUrl(url, shellUrl)) {
      void contents.loadURL(url).catch(onError);
    } else {
      openWebLink(url);
    }
    return { action: 'deny' };
  });
}
