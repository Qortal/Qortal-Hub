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

import { publishMultipleQDNResources } from '../get';
import { isRunningGateway } from '../qortal-requests';
import { createEndpoint } from '../../background/background';

beforeEach(() => {
  vi.mocked(isRunningGateway).mockResolvedValue(false);
  vi.mocked(createEndpoint).mockImplementation(async (path) => path);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('multi-resource publish input validation', () => {
  it('rejects files damaged by IPC before making a storage request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      publishMultipleQDNResources(
        { resources: [{ service: 'VIDEO', file: {} }] },
        null,
        true,
        {}
      )
    ).rejects.toThrow('question:publish_validation.invalid_file');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks the combined Blob and File size without mislabelling a failed request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      publishMultipleQDNResources(
        {
          resources: [
            { service: 'VIDEO', file: new File(['123'], 'video.mp4') },
            { service: 'IMAGE', file: new Blob(['12345']) },
          ],
        },
        null,
        true,
        {}
      )
    ).rejects.toThrow('question:publish_validation.storage_check_failed');
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      '/arbitrary/check/tmp?totalSize=8'
    );
  });
});
