import { describe, expect, it } from 'vitest';
import {
  buildAppSearchOptions,
  exactAppNameMatch,
  MAX_APP_SUGGESTIONS,
  rankAppSearchMatches,
  scoreAppSearchMatch,
  type SearchableApp,
  splitFirstMatch,
  titleAcronym,
} from './appSearchSuggestions';

const app = (
  name: string,
  service = 'APP',
  metadata: SearchableApp['metadata'] = {}
): SearchableApp => ({ metadata, name, service });

const names = (apps: SearchableApp[]) =>
  apps.map((item) => `${item.service}:${item.name}`);

describe('scoreAppSearchMatch', () => {
  const builder = app('QWB', 'APP', {
    description: 'Make websites without code',
    tags: ['builder', 'Web'],
    title: 'Qortal Web Builder',
  });

  it('ranks the exact name above every looser match', () => {
    expect(scoreAppSearchMatch(builder, 'qwb')).toBe(1000);
    expect(scoreAppSearchMatch(builder, 'qortal web builder')).toBe(900);
    expect(scoreAppSearchMatch(builder, 'web')).toBe(850);
    expect(scoreAppSearchMatch(builder, 'qw')).toBe(700);
    expect(scoreAppSearchMatch(builder, 'qortal')).toBe(650);
    expect(scoreAppSearchMatch(builder, 'build')).toBe(450);
    expect(scoreAppSearchMatch(builder, 'without')).toBe(200);
    expect(scoreAppSearchMatch(builder, 'chess')).toBe(0);
    expect(scoreAppSearchMatch(builder, '  ')).toBe(0);
  });

  it('reads the initials of the title', () => {
    expect(titleAcronym('Qortal Web Builder')).toBe('qwb');
    expect(
      scoreAppSearchMatch(
        app('Builder', 'APP', { title: 'Qortal Web Builder' }),
        'qwb'
      )
    ).toBe(800);
  });
});

describe('rankAppSearchMatches', () => {
  it('suggests only Q-Apps and websites, each once', () => {
    const apps = [
      app('Q-Tube'),
      app('Q-Tube', 'WEBSITE'),
      app('Q-Tube', 'VIDEO'),
      app('Q-Tube'),
      app(''),
      null as unknown as SearchableApp,
    ];
    expect(names(rankAppSearchMatches('tube', apps))).toEqual([
      'APP:Q-Tube',
      'WEBSITE:Q-Tube',
    ]);
  });

  it('puts the most opened first among equal matches', () => {
    const apps = [app('Q-Mail'), app('Q-Mintership'), app('Q-Blog')];
    expect(names(rankAppSearchMatches('q-', apps))).toEqual([
      'APP:Q-Blog',
      'APP:Q-Mail',
      'APP:Q-Mintership',
    ]);
    expect(
      names(
        rankAppSearchMatches('q-', apps, {
          'APP:q-mintership': 4,
          'APP:q-mail': 1,
        })
      )
    ).toEqual(['APP:Q-Mintership', 'APP:Q-Mail', 'APP:Q-Blog']);
  });

  it('keeps a better match ahead of a more opened one', () => {
    const apps = [app('Torq'), app('Torque Notes')];
    expect(
      names(rankAppSearchMatches('torq', apps, { 'APP:torque notes': 50 }))
    ).toEqual(['APP:Torq', 'APP:Torque Notes']);
  });

  it('puts a Q-App before a website of the same name', () => {
    expect(
      names(rankAppSearchMatches('wiki', [app('Wiki', 'WEBSITE'), app('Wiki')]))
    ).toEqual(['APP:Wiki', 'WEBSITE:Wiki']);
  });
});

describe('buildAppSearchOptions', () => {
  it('lists the matches, then a row that searches the library', () => {
    const options = buildAppSearchOptions(' tube ', [
      app('Q-Tube'),
      app('Tube Music', 'WEBSITE'),
      app('Q-Mail'),
    ]);
    expect(options).toEqual([
      { app: app('Tube Music', 'WEBSITE'), kind: 'app' },
      { app: app('Q-Tube'), kind: 'app' },
      { kind: 'library', query: 'tube' },
    ]);
  });

  it(`shows at most ${MAX_APP_SUGGESTIONS} apps`, () => {
    const apps = Array.from({ length: 12 }, (_, index) => app(`App ${index}`));
    const options = buildAppSearchOptions('app', apps);
    expect(options.filter((option) => option.kind === 'app')).toHaveLength(
      MAX_APP_SUGGESTIONS
    );
    expect(options[options.length - 1]).toEqual({
      kind: 'library',
      query: 'app',
    });
  });

  it('suggests nothing for an empty input or a qortal:// link', () => {
    const apps = [app('Q-Tube')];
    expect(buildAppSearchOptions('   ', apps)).toEqual([]);
    expect(buildAppSearchOptions('qortal://APP/Q-Tube', apps)).toEqual([]);
    expect(buildAppSearchOptions('QORTAL://app/q-tube', apps)).toEqual([]);
  });

  it('still offers the library search when nothing matches', () => {
    expect(buildAppSearchOptions('zzz', [app('Q-Tube')])).toEqual([
      { kind: 'library', query: 'zzz' },
    ]);
  });
});

describe('exactAppNameMatch', () => {
  const apps = [app('Torq'), app('Torq', 'WEBSITE'), app('Torque')];

  it('finds the Q-App or website named exactly that, in any case', () => {
    expect(exactAppNameMatch(' TORQ ', apps)).toEqual(app('Torq'));
    expect(exactAppNameMatch('torq', apps, { 'WEBSITE:torq': 3 })).toEqual(
      app('Torq', 'WEBSITE')
    );
  });

  it('finds nothing for part of a name, a title or a link', () => {
    expect(exactAppNameMatch('tor', apps)).toBeNull();
    expect(
      exactAppNameMatch('web builder', [
        app('QWB', 'APP', { title: 'Web Builder' }),
      ])
    ).toBeNull();
    expect(exactAppNameMatch('qortal://APP/Torq', apps)).toBeNull();
    expect(exactAppNameMatch('', apps)).toBeNull();
  });
});

describe('splitFirstMatch', () => {
  it('splits around the first match, in any case', () => {
    expect(splitFirstMatch('Qortal Web Builder', 'WEB')).toEqual({
      after: ' Builder',
      before: 'Qortal ',
      match: 'Web',
    });
    expect(splitFirstMatch('Q-Tube', 'mail')).toEqual({
      after: '',
      before: 'Q-Tube',
      match: '',
    });
  });
});
