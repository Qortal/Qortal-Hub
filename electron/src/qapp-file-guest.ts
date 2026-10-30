import type { IpcMainInvokeEvent, Session, WebContents } from 'electron';
import { qappGuestUrlAllowed, type QAppGuestOwner } from './qapp-guest-policy';

type Prepared = { owner: QAppGuestOwner; url: string; isDevMode: boolean };
/** Check current identities, never just guest-supplied owner labels or tokens. */
export function isQAppFileGuest(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  attached:
    | { contents: WebContents; prepared: Prepared | null; documentId?: string }
    | undefined,
  registered: Prepared | undefined,
  expectedSession: Session | undefined,
  documentId: unknown
) {
  return Boolean(
    attached?.prepared &&
    attached.prepared === registered &&
    event.sender === attached.contents &&
    event.sender.getType() === 'webview' &&
    event.senderFrame === event.sender.mainFrame &&
    typeof documentId === 'string' &&
    /^[a-f0-9]{32}$/.test(documentId) &&
    attached.documentId === documentId &&
    event.sender.session === expectedSession &&
    qappGuestUrlAllowed(
      attached.prepared.url,
      event.sender.getURL(),
      attached.prepared.owner,
      attached.prepared.isDevMode
    )
  );
}
