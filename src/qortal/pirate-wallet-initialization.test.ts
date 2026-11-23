import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  createEndpoint: vi.fn(),
  getForeignKey: vi.fn(),
  getSaveWallet: vi.fn(),
  revision: vi.fn(),
}));
vi.mock('../background/background', () => mocks);
vi.mock('../utils/chromeStorage', () => ({
  getSigningContextRevision: mocks.revision,
}));
vi.mock('../i18n/i18n', () => ({ default: { t: (key: string) => key } }));
let initialize: typeof import('./pirate-wallet-initialization').ensurePirateWalletInitialization;
let requests: any[];
const fresh = { needsSelection: true, defaultBirthday: 2000000 };
const existing = { needsSelection: false, defaultBirthday: 2000000 };
function states(...values: any[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      requests.push(JSON.parse(init.body));
      const state = values.shift();
      return state instanceof Response
        ? state
        : new Response(JSON.stringify(state));
    })
  );
}
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  requests = [];
  mocks.createEndpoint.mockImplementation(async (path) => `http://core${path}`);
  mocks.getForeignKey.mockResolvedValue('fixture-entropy');
  mocks.getSaveWallet.mockResolvedValue({ address0: 'Q-fixture' });
  mocks.revision.mockReturnValue(1);
  initialize = (await import('./pirate-wallet-initialization'))
    .ensurePirateWalletInitialization;
});
afterEach(() => vi.unstubAllGlobals());

it('inspects existing wallets without prompting or selecting another birthday', async () => {
  states(existing);
  const approve = vi.fn();
  await initialize('fixture-entropy', approve);
  await initialize('fixture-entropy', approve);
  expect(requests).toEqual([{ entropy58: 'fixture-entropy' }]);
  expect(approve).not.toHaveBeenCalled();
});
it('defaults to historical recovery and never sends entropy to the approval UI', async () => {
  states(fresh, existing);
  const approve = vi.fn(async () => ({ accepted: true }));
  await initialize('fixture-entropy', approve);
  expect(requests[1]).toEqual({
    entropy58: 'fixture-entropy',
    birthday: 2000000,
  });
  expect(approve.mock.calls[0][0]).toMatchObject({
    checkbox1: { value: false },
  });
  expect(JSON.stringify(approve.mock.calls)).not.toContain('fixture-entropy');
});
it('uses current height only after the explicit never-funded choice', async () => {
  states(fresh, existing);
  await initialize('fixture-entropy', async () => ({
    accepted: true,
    checkbox1: true,
  }));
  expect(requests[1]).toEqual({
    entropy58: 'fixture-entropy',
    useCurrentHeight: true,
  });
});
it('does not initialize after denial', async () => {
  states(fresh);
  await expect(
    initialize('fixture-entropy', async () => ({ accepted: false }))
  ).rejects.toThrow('declined');
  expect(requests).toHaveLength(1);
});
it('does not apply an approval after account or node change', async () => {
  for (const change of [
    () => mocks.revision.mockReturnValue(2),
    () =>
      mocks.createEndpoint.mockImplementation(
        async (path) => `http://other${path}`
      ),
  ]) {
    mocks.revision.mockReturnValue(1);
    mocks.createEndpoint.mockImplementation(
      async (path) => `http://core${path}`
    );
    states(fresh);
    await expect(
      initialize('fixture-entropy', async () => {
        change();
        return { accepted: true, checkbox1: true };
      })
    ).rejects.toThrow('changed');
  }
  expect(requests.filter((r) => r.useCurrentHeight)).toHaveLength(0);
});
it('coalesces parallel first-use requests into one prompt and selection', async () => {
  states(fresh, existing);
  const approve = vi.fn(async () => ({ accepted: true }));
  await Promise.all([
    initialize('fixture-entropy', approve),
    initialize('fixture-entropy', approve),
  ]);
  expect(approve).toHaveBeenCalledTimes(1);
  expect(requests).toHaveLength(2);
});
it('requires the matching Core and rejects malformed status without selecting', async () => {
  for (const state of [
    new Response('', { status: 404 }),
    new Response('', { status: 500 }),
    { ...fresh, defaultBirthday: -1 },
  ]) {
    requests = [];
    states(state);
    const approve = vi.fn();
    await expect(initialize('fixture-entropy', approve)).rejects.toThrow();
    expect(requests).toHaveLength(1);
    expect(approve).not.toHaveBeenCalled();
  }
});
