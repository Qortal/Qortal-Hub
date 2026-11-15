import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks (hoisted before any import) ────────────────────────────────
// Factories live in ./common.ts; async dynamic import is used because vi.mock()
// is hoisted before regular imports.

vi.mock('../qortal-requests', async () =>
  (await import('./common')).qortalRequestsFactory()
);
vi.mock('../../background/background', async () =>
  (await import('./common')).backgroundFactory()
);
vi.mock('../../encryption/encryption', async () =>
  (await import('./common')).encryptionFactory()
);
vi.mock('../../components/Chat/AdminSpaceInner', async () =>
  (await import('./common')).adminSpaceFactory()
);
vi.mock('../../components/Chat/MessageDisplay', async () =>
  (await import('./common')).messageDisplayFactory()
);
vi.mock('../../components/Group/Group', async () =>
  (await import('./common')).groupFactory()
);
vi.mock('../../qdn/encryption/group-encryption', async () =>
  (await import('./common')).groupEncryptionFactory()
);
vi.mock('../../qdn/publish/publish', async () =>
  (await import('./common')).publishFactory()
);
vi.mock('../../transactions/TradeBotCreateRequest', async () =>
  (await import('./common')).tradeBotCreateFactory()
);
vi.mock('../../transactions/TradeBotDeleteRequest', async () =>
  (await import('./common')).tradeBotDeleteFactory()
);
vi.mock('../../transactions/signTradeBotTransaction', async () =>
  (await import('./common')).signTradeBotFactory()
);
vi.mock('../../transactions/transactions', async () =>
  (await import('./common')).transactionsFactory()
);
vi.mock('../../utils/events', async () =>
  (await import('./common')).eventsFactory()
);
vi.mock('../../utils/fileReading/index', async () =>
  (await import('./common')).fileReadingFactory()
);
vi.mock('../../utils/memeTypes', async () =>
  (await import('./common')).mimeTypesFactory()
);
vi.mock('../../utils/queue/queue', async () =>
  (await import('./common')).queueFactory()
);
vi.mock('../../utils/utils', async () =>
  (await import('./common')).utilsFactory()
);
vi.mock('short-unique-id', async () =>
  (await import('./common')).shortUidFactory()
);
vi.mock('../../utils/decode', async () =>
  (await import('./common')).decodeFactory()
);
vi.mock('i18next', async () => (await import('./common')).i18nFactory());
vi.mock('../../i18n/i18n', async () =>
  (await import('./common')).i18nFactory()
);
vi.mock('aes-js', async () => (await import('./common')).aesFactory());
vi.mock('../../encryption/Base58', async () =>
  (await import('./common')).base58Factory()
);
vi.mock('../../encryption/ed2curve', async () =>
  (await import('./common')).ed2curveFactory()
);
vi.mock('../../encryption/nacl-fast', async () =>
  (await import('./common')).naclFactory()
);
vi.mock('asmcrypto.js', async () =>
  (await import('./common')).asmcryptoFactory()
);
vi.mock('../../hooks/useQortalMessageListener', async () =>
  (await import('./common')).messageListenerFactory()
);
vi.mock('../qapp-save-file', async () =>
  (await import('./common')).messageListenerFactory()
);

import { sessionPermissions } from '../get';
import {
  MIN_PERMISSION_TIME_TO_SHOW_MS,
  PERMISSION_REQUEST_TIMEOUT_MS,
  permissionSecondsLeft,
  QORTAL_REQUEST_COUNTDOWN_SECONDS,
} from '../permissionPromptQueue';
import {
  hasSessionPermission,
  VALID_SESSION_PERMISSIONS,
} from '../qortal-requests';
import i18n from 'i18next';

type Prompt = {
  requestId: string;
  payload: { text1?: string; expiresAt?: number };
};
let prompts: Prompt[];

const answer = (prompt: Prompt, accepted: boolean) =>
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: window.location.origin,
      source: window,
      data: {
        action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
        requestId: prompt.requestId,
        result: { accepted },
      },
    })
  );

// Each call asks for the approval dialog once, as a Q-App in its own tab.
const ask = (tabId: number) =>
  sessionPermissions({ permissions: ['SEND_COIN'] }, false, {
    tabId,
    name: `App ${tabId}`,
  });

const settle = () => vi.advanceTimersByTimeAsync(0);

describe('approval requests reach the dialog one at a time', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    prompts = [];
    vi.mocked(hasSessionPermission).mockReturnValue(false);
    VALID_SESSION_PERMISSIONS.splice(
      0,
      VALID_SESSION_PERMISSIONS.length,
      'SEND_COIN'
    );
    vi.mocked(i18n.t).mockImplementation((key: string) => key);
    vi.spyOn(window, 'postMessage').mockImplementation((message) => {
      if (message?.action !== 'QORTAL_REQUEST_PERMISSION') return;
      prompts.push({ requestId: message.requestId, payload: message.payload });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('shows a request that comes while another is on screen only after that one is answered', async () => {
    const first = ask(1);
    const second = ask(2);
    await settle();
    expect(prompts).toHaveLength(1);

    answer(prompts[0], false);
    await expect(first).rejects.toThrow('user_declined_request');
    await settle();
    expect(prompts).toHaveLength(2);

    answer(prompts[1], true);
    await expect(second).resolves.toBe(true);
  });

  it('gives a request that waited only what is left of its minute', async () => {
    const askedAt = Date.now();
    const first = ask(1);
    const second = ask(2);
    first.catch(() => undefined);
    second.catch(() => undefined);
    await settle();
    expect(prompts[0].payload.expiresAt).toBe(
      askedAt + PERMISSION_REQUEST_TIMEOUT_MS
    );

    await vi.advanceTimersByTimeAsync(20_000);
    answer(prompts[0], false);
    await expect(first).rejects.toThrow('user_declined_request');
    await settle();
    expect(prompts).toHaveLength(2);
    // The second request's time counts from when the app asked.
    expect(prompts[1].payload.expiresAt).toBe(
      askedAt + PERMISSION_REQUEST_TIMEOUT_MS
    );

    await vi.advanceTimersByTimeAsync(PERMISSION_REQUEST_TIMEOUT_MS - 20_001);
    let settled = false;
    second.finally(() => (settled = true)).catch(() => undefined);
    await settle();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(second).rejects.toThrow('user_declined_request');
  });

  it('declines without showing a request whose time ran out while it waited', async () => {
    const first = ask(1);
    const second = ask(2);
    first.catch(() => undefined);
    second.catch(() => undefined);
    await settle();

    await vi.advanceTimersByTimeAsync(
      PERMISSION_REQUEST_TIMEOUT_MS - MIN_PERMISSION_TIME_TO_SHOW_MS + 1
    );
    answer(prompts[0], false);
    await expect(first).rejects.toThrow('user_declined_request');
    await expect(second).rejects.toThrow('user_declined_request');
    await settle();
    expect(prompts).toHaveLength(1);
  });

  it('ends the dialog countdown before the requester stops waiting', () => {
    const now = 1_000_000;
    const expiresAt = now + PERMISSION_REQUEST_TIMEOUT_MS;
    expect(permissionSecondsLeft(expiresAt, now)).toBe(
      QORTAL_REQUEST_COUNTDOWN_SECONDS
    );
    expect(now + permissionSecondsLeft(expiresAt, now) * 1000).toBeLessThan(
      expiresAt
    );
    expect(permissionSecondsLeft(expiresAt, expiresAt - 31_000)).toBe(30);
    expect(permissionSecondsLeft(expiresAt, expiresAt)).toBe(0);
    expect(permissionSecondsLeft(undefined, now)).toBe(
      QORTAL_REQUEST_COUNTDOWN_SECONDS
    );
  });

  it('declines at once a request that would wait behind ten others', async () => {
    const requests = Array.from({ length: 12 }, (_, index) => ask(index + 1));
    requests.forEach((request) => request.catch(() => undefined));
    await settle();

    expect(prompts).toHaveLength(1);
    await expect(requests[11]).rejects.toThrow('user_declined_request');

    for (let shown = 1; shown <= 11; shown += 1) {
      expect(prompts).toHaveLength(shown);
      answer(prompts[shown - 1], true);
      await expect(requests[shown - 1]).resolves.toBe(true);
      await settle();
    }
    expect(prompts).toHaveLength(11);
  });
});
