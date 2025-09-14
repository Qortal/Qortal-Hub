import '@testing-library/jest-dom';
import { vi } from 'vitest';

vi.mock('@evva/capacitor-secure-storage-plugin', () => ({
  SecureStoragePlugin: {
    get: vi.fn(async () => ({ value: null })),
    set: vi.fn(async () => ({ value: true })),
    remove: vi.fn(async () => ({ value: true })),
    clear: vi.fn(async () => ({ value: true })),
    keys: vi.fn(async () => ({ value: [] })),
    getPlatform: vi.fn(async () => ({ value: 'web' })),
  },
}));

vi.mock('asmcrypto.js/asmcrypto.all.js', () => ({}));

vi.mock('../background/background', () => {
  return {
    // whatever your module exports; make them fast + deterministic
    performPowTask: vi.fn(async (_bytes: Uint8Array, _difficulty: number) => {
      // return a minimal fake result your component expects
      return { success: true, nonce: 0, hash: '00...00' };
    }),
    // if it exports a default or other helpers, add them too
  };
});
