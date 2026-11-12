import { describe, expect, it } from 'vitest';
import {
  launcherLabelMatches,
  launcherMatchRank,
  parseLauncherLink,
  searchLauncherApps,
} from './launcherSearch';

const app = (
  name: string,
  metadata: Record<string, unknown> = {},
  service = 'APP'
) => ({ name, service, metadata });

describe('parseLauncherLink', () => {
  it('reads a qortal:// address with a path and an identifier', () => {
    expect(
      parseLauncherLink('  qortal://APP/Q-Tube/video/abc?identifier=clip1  ')
    ).toEqual({
      kind: 'app',
      link: 'qortal://APP/Q-Tube/video/abc?identifier=clip1',
      service: 'APP',
      name: 'Q-Tube',
      identifier: 'clip1',
      path: 'video/abc',
    });
  });

  it('accepts the protocol in any letter case', () => {
    expect(parseLauncherLink('QORTAL://website/Simon')).toMatchObject({
      kind: 'app',
      service: 'WEBSITE',
      name: 'Simon',
    });
  });

  it('reads a bare name after the protocol as a website', () => {
    expect(parseLauncherLink('qortal://Simon')).toMatchObject({
      kind: 'app',
      service: 'WEBSITE',
      name: 'Simon',
      path: '',
    });
  });

  it('reads the short form with a service', () => {
    expect(parseLauncherLink('app/Q-Mail')).toMatchObject({
      kind: 'app',
      link: 'qortal://app/Q-Mail',
      service: 'APP',
      name: 'Q-Mail',
    });
    expect(parseLauncherLink('WEBSITE/Simon/blog')).toMatchObject({
      service: 'WEBSITE',
      name: 'Simon',
      path: 'blog',
    });
  });

  it('never takes search words for an address', () => {
    expect(parseLauncherLink('tube')).toBeNull();
    expect(parseLauncherLink('q-tube videos')).toBeNull();
    expect(parseLauncherLink('TCP/IP')).toBeNull();
    expect(parseLauncherLink('app/')).toBeNull();
    expect(parseLauncherLink('')).toBeNull();
    expect(parseLauncherLink('qortal://')).toBeNull();
  });

  it('recognises a group link', () => {
    expect(
      parseLauncherLink('qortal://use-group/action-join/groupid-694')
    ).toEqual({
      kind: 'group',
      link: 'qortal://use-group/action-join/groupid-694',
    });
  });

  it('rejects other qortal://use- links', () => {
    expect(parseLauncherLink('qortal://use-embed/POLL?name=x')).toBeNull();
  });
});

describe('launcherMatchRank', () => {
  const qTube = app('Q-Tube', {
    title: 'Q-Tube',
    description: 'A decentralized video platform',
    tags: ['video', 'streaming'],
    categoryName: 'Entertainment',
  });

  it('ranks the exact name, then a whole word, a prefix and a substring', () => {
    expect(launcherMatchRank(qTube, 'q-tube')).toBe(0);
    expect(launcherMatchRank(qTube, 'tube')).toBe(1);
    expect(launcherMatchRank(qTube, 'Q-Tu')).toBe(2);
    expect(launcherMatchRank(qTube, 'tu')).toBe(3);
    expect(launcherMatchRank(qTube, 'ub')).toBe(4);
  });

  it('finds a name typed without its hyphen or with a space', () => {
    expect(launcherMatchRank(qTube, 'qtube')).toBe(4);
    expect(launcherMatchRank(qTube, 'q tube')).toBe(1);
  });

  it('falls back to the description, the tags and the category', () => {
    expect(launcherMatchRank(qTube, 'decentralized')).toBe(5);
    expect(launcherMatchRank(qTube, 'streaming')).toBe(5);
    expect(launcherMatchRank(qTube, 'entertainment')).toBe(5);
    expect(launcherMatchRank(qTube, 'video tube')).toBe(5);
  });

  it('needs every word to match', () => {
    expect(launcherMatchRank(qTube, 'video wallet')).toBeNull();
    expect(launcherMatchRank(qTube, 'mail')).toBeNull();
  });

  it('matches the title as well as the name', () => {
    const blog = app('Simon', { title: 'My travel blog' }, 'WEBSITE');
    expect(launcherMatchRank(blog, 'travel')).toBe(1);
    expect(launcherMatchRank(blog, 'trav')).toBe(3);
    expect(launcherMatchRank(blog, 'simon')).toBe(0);
  });

  it('accepts tags given as one string', () => {
    expect(launcherMatchRank(app('X', { tags: 'games, chess' }), 'chess')).toBe(
      5
    );
  });

  it('has no match for an empty query or an app without a name', () => {
    expect(launcherMatchRank(qTube, '   ')).toBeNull();
    expect(launcherMatchRank({}, 'tube')).toBeNull();
  });
});

describe('searchLauncherApps', () => {
  const apps = [
    app('Mailbox Tools', { description: 'Helpers for Q-Mail' }),
    app('Q-Mail', { title: 'Q-Mail' }),
    app('mail', {}, 'WEBSITE'),
    app('Snail Mail', {}),
    app('Q-Tube', { title: 'Q-Tube' }),
  ];
  const names = (results: { name?: string }[]) => results.map((a) => a.name);

  it('puts the official app before a look-alike name, then the best match', () => {
    expect(names(searchLauncherApps(apps, 'mail'))).toEqual([
      'Q-Mail',
      'mail',
      'Snail Mail',
      'Mailbox Tools',
    ]);
  });

  it('puts a pinned app before the official one', () => {
    expect(
      names(
        searchLauncherApps(apps, 'mail', {
          isPinned: (a) => a.name === 'Snail Mail',
        })
      )
    ).toEqual(['Snail Mail', 'Q-Mail', 'mail', 'Mailbox Tools']);
  });

  it('orders equal matches of official apps by title', () => {
    expect(
      names(
        searchLauncherApps(
          [app('Q-Share Fan Page'), app('Q-Shop'), app('Q-Share')],
          'q-sh'
        )
      )
    ).toEqual(['Q-Share', 'Q-Shop', 'Q-Share Fan Page']);
  });

  it('leaves an official app behind when only its description matches', () => {
    expect(
      names(
        searchLauncherApps(
          [app('Q-Fund', { description: 'Fund a chess club' }), app('Chess')],
          'chess',
          { isPinned: (a) => a.name === 'Q-Fund' }
        )
      )
    ).toEqual(['Chess', 'Q-Fund']);
  });

  it('uses the rating to order equal matches', () => {
    const ratings: Record<
      string,
      { averageRating: number; totalVotes: number }
    > = {
      'Chess Club': { averageRating: 4.8, totalVotes: 40 },
      'Chess Board': { averageRating: 5, totalVotes: 1 },
    };
    const results = searchLauncherApps(
      [app('Chess Board'), app('Chess Arena'), app('Chess Club')],
      'chess',
      { getRating: (a) => ratings[a.name] }
    );
    expect(names(results)).toEqual([
      'Chess Club',
      'Chess Board',
      'Chess Arena',
    ]);
  });

  it('returns nothing for an empty query', () => {
    expect(searchLauncherApps(apps, '  ')).toEqual([]);
  });
});

describe('launcherLabelMatches', () => {
  it('matches a saved item by its label', () => {
    expect(launcherLabelMatches('Weather · Lisbon', 'lisbon')).toBe(true);
    expect(launcherLabelMatches('Minter Helper', 'minter h')).toBe(true);
    expect(launcherLabelMatches('Minter Helper', 'wallet')).toBe(false);
  });
});
