import { describe, expect, it } from 'vitest';
import { upsertPrivatePinnedApp } from './privatePinnedApps';

const privateApp = (identifier: string, appName = identifier) => ({
  isPrivate: true,
  isPreview: true,
  privateAppProperties: {
    name: 'alice',
    service: 'DOCUMENT',
    identifier,
    groupId: 7,
    appName,
  },
});

describe('upsertPrivatePinnedApp', () => {
  it('appends an app that is not pinned yet', () => {
    const existing = [privateApp('notes')];

    expect(upsertPrivatePinnedApp(existing, privateApp('pinnic'))).toEqual([
      privateApp('notes'),
      privateApp('pinnic'),
    ]);
  });

  it('refreshes an already pinned app in place instead of duplicating it', () => {
    const existing = [privateApp('pinnic', 'old name'), privateApp('notes')];

    expect(
      upsertPrivatePinnedApp(existing, privateApp('pinnic', 'new name'))
    ).toEqual([privateApp('pinnic', 'new name'), privateApp('notes')]);
  });

  it('does not match a public app with the same name and identifier', () => {
    const publicApp = {
      isPrivate: false,
      privateAppProperties: {
        name: 'alice',
        service: 'DOCUMENT',
        identifier: 'pinnic',
      },
    };

    expect(
      upsertPrivatePinnedApp([publicApp], privateApp('pinnic'))
    ).toHaveLength(2);
  });

  it('handles a missing pinned list', () => {
    expect(upsertPrivatePinnedApp(null, privateApp('pinnic'))).toEqual([
      privateApp('pinnic'),
    ]);
  });
});
