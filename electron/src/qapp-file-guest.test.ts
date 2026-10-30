import { describe, expect, it } from 'vitest';
import { isQAppFileGuest } from './qapp-file-guest';

function fixture() {
  const frame = {};
  const session = {};
  const prepared = {
    owner: { tabId: '1', service: 'APP', name: 'Q-Mail' },
    url: 'https://node.invalid/render/APP/Q-Mail/',
    isDevMode: false,
  };
  const documentId = 'a'.repeat(32);
  const contents = {
    mainFrame: frame,
    session,
    getType: () => 'webview',
    getURL: () => prepared.url,
  };
  const event = { sender: contents, senderFrame: frame } as any;
  const attached = { contents, prepared, documentId } as any;
  return { event, attached, prepared, session: session as any, documentId };
}
describe('file worker guest authentication', () => {
  it('accepts the registered guest top frame and its current document', () => {
    const f = fixture();
    expect(
      isQAppFileGuest(f.event, f.attached, f.prepared, f.session, f.documentId)
    ).toBe(true);
  });
  it.each([
    'subframe',
    'other-contents',
    'replaced-registration',
    'other-session',
    'stale-document',
    'foreign-url',
    'other-app',
    'not-webview',
    'missing-registration',
  ])('rejects %s', (caseName) => {
    const f = fixture();
    if (caseName === 'subframe') f.event.senderFrame = {};
    if (caseName === 'other-contents') f.event.sender = { ...f.event.sender };
    if (caseName === 'replaced-registration') f.prepared = { ...f.prepared };
    if (caseName === 'other-session') f.session = {};
    if (caseName === 'stale-document') f.documentId = 'b'.repeat(32);
    if (caseName === 'foreign-url')
      f.event.sender.getURL = () => 'https://evil.invalid/render/APP/Q-Mail/';
    if (caseName === 'other-app')
      f.event.sender.getURL = () => 'https://node.invalid/render/APP/Q-Other/';
    if (caseName === 'not-webview') f.event.sender.getType = () => 'window';
    if (caseName === 'missing-registration') f.prepared = undefined;
    expect(
      isQAppFileGuest(f.event, f.attached, f.prepared, f.session, f.documentId)
    ).toBe(false);
  });
});
