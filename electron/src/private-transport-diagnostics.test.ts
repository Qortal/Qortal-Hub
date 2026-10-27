import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./logger', () => ({ warn: vi.fn() }));
import { warn } from './logger';
import { diagnosePrivateTransport } from './private-transport-diagnostics';

beforeEach(() => vi.clearAllMocks());

it('records the setup stage and underlying code while preserving the error', async () => {
  const error = Object.assign(
    new Error('sensitive endpoint and attach token'),
    {
      code: 'RELAY_ACCOUNT_CHANGED',
    }
  );
  await expect(
    diagnosePrivateTransport('relay-selection', async () => {
      throw error;
    })
  ).rejects.toBe(error);
  expect(warn).toHaveBeenCalledOnce();
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('stage=relay-selection code=RELAY_ACCOUNT_CHANGED')
  );
  expect(JSON.stringify(vi.mocked(warn).mock.calls)).not.toContain('sensitive');
});

it('does not log arbitrary exception messages or successful credentials', async () => {
  await expect(
    diagnosePrivateTransport('session-open', () => {
      throw new TypeError('secret-ticket https://backend');
    })
  ).rejects.toThrow(TypeError);
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('code=UNCLASSIFIED_ERROR kind=TypeError')
  );
  expect(JSON.stringify(vi.mocked(warn).mock.calls)).not.toContain(
    'secret-ticket'
  );
  const result = { attachToken: 'secret-token' };
  await expect(
    diagnosePrivateTransport('bootstrap-validation', () => result)
  ).resolves.toBe(result);
  expect(warn).toHaveBeenCalledOnce();
});
