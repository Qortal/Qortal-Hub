import { describe, expect, it } from 'vitest';
import {
  appKey,
  hiddenRecordService,
  parseHiddenApps,
  parseHiddenState,
  serializeHiddenState,
  withoutHiddenApps,
} from './appHidden';

const record = (name: string, identifier: string, title?: string) => ({
  name,
  service: 'JSON',
  identifier,
  ...(title ? { metadata: { title } } : {}),
});

describe('which apps are hidden', () => {
  it('reads the state from each record’s title', () => {
    const hidden = parseHiddenApps([
      record('Q-Blog', 'qhub_app_hidden_v1_APP', 'hidden'),
      record('My Site', 'qhub_app_hidden_v1_WEBSITE', 'hidden'),
      // Shown again, or not titled (yet): listed.
      record('Back', 'qhub_app_hidden_v1_APP', 'shown'),
      record('Untitled', 'qhub_app_hidden_v1_APP'),
    ]);
    expect([...hidden].sort()).toEqual(['APP/q-blog', 'WEBSITE/my site']);
  });

  it('takes no other resource for a record', () => {
    expect(
      parseHiddenApps([
        record('A', 'qhub_app_page_v1_APP', 'hidden'),
        record('B', 'qhub_app_hidden_v1_DOCUMENT', 'hidden'),
        {
          ...record('C', 'qhub_app_hidden_v1_APP', 'hidden'),
          service: 'IMAGE',
        },
        { identifier: 'qhub_app_hidden_v1_APP', metadata: { title: 'hidden' } },
        null,
      ]).size
    ).toBe(0);
    expect(parseHiddenApps({ error: 'x' }).size).toBe(0);
    expect(hiddenRecordService('qhub_app_hidden_v1_WEBSITE')).toBe('WEBSITE');
    expect(hiddenRecordService('qhub_app_hidden_v1_app')).toBeNull();
  });
});

describe('the library without hidden apps', () => {
  const apps = [
    { service: 'APP', name: 'Q-Blog' },
    { service: 'WEBSITE', name: 'Q-Blog' },
    { service: 'APP', name: 'Mine' },
    { service: 'APP', name: 'Q-Tube' },
  ];

  it('leaves out each hidden app, by service and name in any case', () => {
    const hidden = new Set([appKey('APP', 'q-blog'), appKey('APP', 'MINE')]);
    expect(withoutHiddenApps(apps, hidden)).toEqual([
      { service: 'WEBSITE', name: 'Q-Blog' },
      { service: 'APP', name: 'Q-Tube' },
    ]);
  });

  it('keeps the user’s own hidden apps, so they can still find them', () => {
    const hidden = new Set([appKey('APP', 'Q-Blog'), appKey('APP', 'Mine')]);
    expect(withoutHiddenApps(apps, hidden, ['mine'])).toEqual([
      { service: 'WEBSITE', name: 'Q-Blog' },
      { service: 'APP', name: 'Mine' },
      { service: 'APP', name: 'Q-Tube' },
    ]);
  });

  it('gives the same list back when nothing is hidden', () => {
    expect(withoutHiddenApps(apps, new Set())).toBe(apps);
  });
});

describe('the record', () => {
  it('reads back what was written', () => {
    const json = serializeHiddenState(
      { service: 'website', name: 'Site' },
      { hidden: true, replaced: true, updated: 5 }
    );
    expect(JSON.parse(json)).toEqual({
      v: 1,
      app: { service: 'WEBSITE', name: 'Site' },
      hidden: true,
      replaced: true,
      updated: 5,
    });
    expect(parseHiddenState(json)).toEqual({
      hidden: true,
      replaced: true,
      updated: 5,
    });
  });

  it('takes nothing that is not a record', () => {
    expect(parseHiddenState('not json')).toBeNull();
    expect(parseHiddenState({ v: 2, hidden: true })).toBeNull();
    expect(parseHiddenState({ v: 1, hidden: 'yes' })).toBeNull();
    expect(parseHiddenState({ v: 1, hidden: false, updated: -3 })).toEqual({
      hidden: false,
      replaced: false,
      updated: 0,
    });
  });
});
