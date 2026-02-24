/**
 * Shared mock factories and helpers for tests that import from get.ts.
 *
 * vi.mock() calls are hoisted before imports, so factories cannot be imported
 * the usual way. Use async dynamic imports inside each factory instead:
 *
 *   vi.mock('../../background/background', async () =>
 *     (await import('./common')).backgroundFactory()
 *   );
 *
 * The factory is evaluated lazily (when the mocked module is first resolved),
 * so the dynamic import is always available by then.
 */

import { vi } from 'vitest';

// ── Module mock factories ────────────────────────────────────────────────────

export const qortalRequestsFactory = () => ({
  isRunningGateway: vi.fn(),
  getPermission: vi.fn(),
  setPermission: vi.fn(),
  setSessionPermissions: vi.fn(),
  hasSessionPermission: vi.fn(),
  VALID_SESSION_PERMISSIONS: [],
  AUTO_GRANTED_PERMISSIONS_ON_AUTH: [],
});

export const backgroundFactory = () => ({
  createEndpoint: vi.fn(),
  gateways: [],
  getApiKeyFromStorage: vi.fn(),
  getNameInfoForOthers: vi.fn(),
  getBalanceInfo: vi.fn(),
  getFee: vi.fn(),
  getKeyPair: vi.fn(),
  getLastRef: vi.fn(),
  getSaveWallet: vi.fn(),
  processTransactionVersion2: vi.fn(),
  signChatFunc: vi.fn(),
  joinGroup: vi.fn(),
  sendQortFee: vi.fn(),
  sendCoin: vi.fn(),
  createBuyOrderTx: vi.fn(),
  performPowTask: vi.fn(),
  parseErrorResponse: vi.fn(),
  groupSecretkeys: vi.fn(),
  registerName: vi.fn(),
  updateName: vi.fn(),
  leaveGroup: vi.fn(),
  inviteToGroup: vi.fn(),
  kickFromGroup: vi.fn(),
  banFromGroup: vi.fn(),
  cancelBan: vi.fn(),
  makeAdmin: vi.fn(),
  removeAdmin: vi.fn(),
  cancelInvitationToGroup: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  sellName: vi.fn(),
  cancelSellName: vi.fn(),
  buyName: vi.fn(),
  getBaseApi: vi.fn(),
  getAssetBalanceInfo: vi.fn(),
  getNameOrAddress: vi.fn(),
  getAssetInfo: vi.fn(),
  getPublicKey: vi.fn(),
  transferAsset: vi.fn(),
  sendChatNotification: vi.fn(),
  sendChatGroup: vi.fn(),
});

export const encryptionFactory = () => ({
  encryptAndPublishSymmetricKeyGroupChat: vi.fn(),
  getAllUserNames: vi.fn(),
  getNameInfo: vi.fn(),
  uint8ArrayToObject: vi.fn(),
});

export const adminSpaceFactory = () => ({
  getPublishesFromAdminsAdminSpace: vi.fn(),
});

export const messageDisplayFactory = () => ({
  extractComponents: vi.fn(),
});

export const groupFactory = () => ({
  decryptResource: vi.fn(),
  getGroupAdmins: vi.fn(),
  getPublishesFromAdmins: vi.fn(),
  validateSecretKey: vi.fn(),
});

export const groupEncryptionFactory = () => ({
  base64ToUint8Array: vi.fn(),
  createSymmetricKeyAndNonce: vi.fn(),
  decryptDeprecatedSingle: vi.fn(),
  decryptGroupDataQortalRequest: vi.fn(),
  decryptGroupEncryptionWithSharingKey: vi.fn(),
  decryptSingle: vi.fn(),
  encryptDataGroup: vi.fn(),
  encryptSingle: vi.fn(),
  hasPrivateString: vi.fn(),
  objectToBase64: vi.fn(),
  uint8ArrayStartsWith: vi.fn(),
  uint8ArrayToBase64: vi.fn(),
});

export const publishFactory = () => ({ publishData: vi.fn() });

export const tradeBotCreateFactory = () => ({ default: vi.fn() });
export const tradeBotDeleteFactory = () => ({ default: vi.fn() });
export const signTradeBotFactory = () => ({ default: vi.fn() });
export const transactionsFactory = () => ({ createTransaction: vi.fn() });
export const eventsFactory = () => ({ executeEvent: vi.fn() });
export const fileReadingFactory = () => ({ fileToBase64: vi.fn() });
export const mimeTypesFactory = () => ({ mimeToExtensionMap: {} });

/**
 * Queue factory.
 * enqueue(fn) calls fn() so that callbacks inside the tested function
 * (e.g. the AT-address fetch in createBuyOrder) actually execute.
 * Functions that never call enqueue are unaffected by this behaviour.
 */
export const queueFactory = () => ({
  RequestQueueWithPromise: vi.fn().mockImplementation(() => ({
    enqueue: vi.fn((fn: () => Promise<unknown>) => fn()),
  })),
});

export const utilsFactory = () => ({ default: { some: vi.fn() } });
export const shortUidFactory = () => ({
  default: vi.fn().mockImplementation(() => ({ rnd: vi.fn(() => 'abc123') })),
});
export const decodeFactory = () => ({
  isValidBase64WithDecode: vi.fn(),
  validateAesCtrIvAndKey: vi.fn(),
});
export const i18nFactory = () => ({
  default: { t: vi.fn((key: string) => key) },
});
export const aesFactory = () => ({ default: {} });
export const base58Factory = () => ({ default: {} });
export const ed2curveFactory = () => ({ default: {} });
export const naclFactory = () => ({ default: {} });
export const asmcryptoFactory = () => ({ Sha256: {} });
export const messageListenerFactory = () => ({
  showSaveFilePicker: vi.fn(),
  listOfAllQortalRequests: [],
  UIQortalRequests: [],
});

// ── Shared test helpers ──────────────────────────────────────────────────────

/**
 * Intercepts the outgoing QORTAL_REQUEST_PERMISSION postMessage from
 * getUserPermission() and immediately replies so the Promise resolves without
 * a real UI dialog.  get.ts attaches its own handleMessage listener at module
 * load time, so posting QORTAL_REQUEST_PERMISSION_RESPONSE back to window is
 * enough to resolve the getUserPermission() promise.
 */
export function simulatePermission(accepted: boolean): void {
  window.addEventListener(
    'message',
    (event: MessageEvent) => {
      if (event.data?.action === 'QORTAL_REQUEST_PERMISSION') {
        window.postMessage(
          {
            action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
            requestId: event.data.requestId,
            result: { accepted },
          },
          window.location.origin
        );
      }
    },
    { once: true }
  );
}
