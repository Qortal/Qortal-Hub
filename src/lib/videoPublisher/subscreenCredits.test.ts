import { describe, expect, it, vi } from 'vitest';
import real from './__fixtures__/subscreen-credits.json';
import { stepJson } from './__fixtures__/testData';
import { utf8Bytes } from './encoding';
import { VideoPublishError } from './errors';
import {
  buildSubscreenCreditsDocument,
  buildSubscreenCreditsStep,
  buildSubscreenPerson,
  cleanCreditName,
  normalizePersonName,
  planSubscreenCredits,
  type SubscreenCredit,
  subscreenCreditList,
  subscreenCreditsDescription,
  subscreenCreditsIdentifier,
  subscreenCreditsTitle,
  subscreenHash,
  subscreenPersonSlug,
  type SubscreenPersonRef,
  type SubscreenTitleRef,
} from './subscreenCredits';

/**
 * Subscreen 1.1.3's own functions, copied verbatim from its deployed bundle
 * (UserAvatar-zni-0QrG.js): the hash behind a title's credits identifier.
 */
const ORIGINAL_PN =
  'function pn(e){let t=2166136261,n=2166136261;for(let r=0;r<e.length;r+=1){let i=e.charCodeAt(r);t^=i,t=Math.imul(t,16777619),n^=i+r*13,n=Math.imul(n,16777619)}return(t>>>0).toString(16).padStart(8,`0`)+(n>>>0).toString(16).padStart(8,`0`)}';
const ORIGINAL_MN = 'function mn(e,t,n){return pn(`${e}:${t}:${n}`)}';
const ORIGINAL_QI =
  'function qi(e){return`${le}${mn(e.service,e.name,e.identifier)}`}';
/** The person slug, and (from its new-person `zg`) the "profile" rule. */
const ORIGINAL_HN =
  'function hn(e){return e.toLowerCase().replace(/[^a-z0-9\\s-]/g,``).replace(/\\s+/g,`-`).replace(/-+/g,`-`).slice(0,20).replace(/-$/,``)}';
const ORIGINAL_ZG_SLUG =
  'function zgSlug(n){let r=hn(n)||`person`;r.startsWith(`profile`)&&(r=`p-${r}`.slice(0,20));return r}';
const original = new Function(
  `var le=\`subscreen_credits_\`;${ORIGINAL_PN}${ORIGINAL_MN}${ORIGINAL_QI}${ORIGINAL_HN}${ORIGINAL_ZG_SLUG}return { pn, mn, qi, personSlug: zgSlug };`
)() as {
  pn: (text: string) => string;
  mn: (service: string, name: string, identifier: string) => string;
  qi: (ref: { service: string; name: string; identifier: string }) => string;
  personSlug: (name: string) => string;
};

const FILM: SubscreenTitleRef = {
  name: 'Tester',
  identifier: 'qtube_vid_the-film_abc123_metadata',
  service: 'DOCUMENT',
};
const SERIES: SubscreenTitleRef = {
  name: 'Tester',
  identifier: 'qtube_playlist_the-show_AbC123',
  service: 'PLAYLIST',
};
const known = (identifier: string, name = 'Someone'): SubscreenPersonRef => ({
  name,
  identifier,
  service: 'DOCUMENT',
});

describe('subscreenHash', () => {
  const inputs = [
    '',
    'a',
    'DOCUMENT:Tester:qtube_vid_the-film_abc123_metadata',
    'PLAYLIST:Some Publisher:qtube_playlist_show_AbC123',
    'José Müller',
    'Ünïcödé café',
    'Фёдор Тестов',
    '山田太郎',
    'スタジオ 山田',
    '🎬 Café 🍿',
    'A'.repeat(500),
    'DOCUMENT:名前:qtube_vid_é_x',
  ];

  it.each(inputs)('matches Subscreen’s own function for %j', (text) => {
    expect(subscreenHash(text)).toBe(original.pn(text));
  });

  it('matches it on random text, astral planes included', () => {
    const random = (length: number) =>
      String.fromCodePoint(
        ...Array.from({ length }, (_, index) =>
          index % 7 === 6
            ? 0x1f300 + ((index * 7919) % 0x2ff)
            : 0x20 + ((index * 104729 + length) % 0xd7c0)
        )
      );
    for (let length = 1; length < 200; length += 13) {
      const text = random(length);
      expect(subscreenHash(text)).toBe(original.pn(text));
    }
  });

  it('is 16 hex digits', () => {
    expect(subscreenHash('anything')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('the credits identifier and title', () => {
  it('is Subscreen’s for a film and a series', () => {
    for (const ref of [FILM, SERIES]) {
      expect(subscreenCreditsIdentifier(ref)).toBe(original.qi(ref));
      expect(subscreenCreditsIdentifier(ref)).toBe(
        `subscreen_credits_${original.mn(ref.service, ref.name, ref.identifier)}`
      );
    }
  });

  it('matches real records on QDN', () => {
    const film = real.filmCredits;
    expect(
      subscreenCreditsIdentifier(film.data.titleRef as SubscreenTitleRef)
    ).toBe(film.resource.identifier);
    expect(subscreenCreditsTitle(film.data.titleRef)).toBe(
      film.resource.metadata.title
    );
    const series = real.seriesCredits;
    expect(
      subscreenCreditsIdentifier(series.titleRef as SubscreenTitleRef)
    ).toBe(series.identifier);
    expect(subscreenCreditsTitle(series.titleRef)).toBe(series.title);
  });

  it('cuts the title at 50, as Subscreen does', () => {
    const title = subscreenCreditsTitle({
      identifier: 'qtube_vid_a-long-night-before-the-winter_p4Zx2w_metadata',
    });
    expect(title).toBe('Credits qtube_vid_a-long-night-before-the-winter_p');
    expect(title).toHaveLength(50);
  });
});

describe('names', () => {
  it('compares them as Subscreen does', () => {
    expect(normalizePersonName('  Rob   FENN ')).toBe('rob fenn');
    expect(normalizePersonName(undefined)).toBe('');
  });

  it('keeps them as its form does: single spaces, 80 at most', () => {
    expect(cleanCreditName('  Rob \n  Fenn ')).toBe('Rob Fenn');
    expect(cleanCreditName('x'.repeat(100))).toHaveLength(80);
    // Never half an emoji (a lone surrogate can't be published).
    expect(cleanCreditName(`${'x'.repeat(79)}🎬`)).toBe('x'.repeat(79));
  });

  it.each([
    ['Hugo B. Lane', 'hugo-b-lane'],
    ['Paul DeMarco', 'paul-demarco'],
    ['Nora Vale', 'nora-vale'],
    ['José Ferrer', 'jos-ferrer'],
    ['山田太郎', 'person'],
    ['Фёдор', 'person'],
    ['Maximilian Schellenberg', 'maximilian-schellenb'],
    ['Jean-Pierre Van Dalen', 'jean-pierre-van-dale'],
    ['Christopher Lambert Jr', 'christopher-lambert'],
    ['A  --  B', 'a-b'],
    ['-Bob-', '-bob'],
    ['Profile', 'p-profile'],
    ['Profile Person', 'p-profile-person'],
    ['Profiler Extraordinaire', 'p-profiler-extraordi'],
  ])('slugs %j as %j, as Subscreen does', (name, slug) => {
    expect(subscreenPersonSlug(name)).toBe(slug);
    expect(subscreenPersonSlug(name)).toBe(original.personSlug(name));
  });
});

describe('buildSubscreenPerson', () => {
  it('publishes a new person as Subscreen does', () => {
    const { ref, document, step } = buildSubscreenPerson({
      key: 'film:person-0',
      name: ' Tester ',
      displayName: '  Nora   Vale ',
      dependsOn: ['film:metadata'],
      id: 'bBg3e',
    });
    expect(ref).toEqual({
      name: 'Tester',
      identifier: 'subscreen_person_nora-vale_bBg3e',
      service: 'DOCUMENT',
    });
    expect(document).toEqual(real.person.data);
    expect(step).toMatchObject({
      key: 'film:person-0',
      kind: 'person',
      service: 'DOCUMENT',
      identifier: 'subscreen_person_nora-vale_bBg3e',
      title: real.person.resource.metadata.title,
      description: real.person.resource.metadata.description,
      filename: 'person.json',
      dependsOn: ['film:metadata'],
    });
    expect(step.tag1).toBeUndefined();
    expect(stepJson(step)).toEqual({ displayName: 'Nora Vale' });
    expect(step.bytes).toBe(utf8Bytes('{"displayName":"Nora Vale"}').length);
  });

  it('gives a random five-letter id, and keeps long titles whole', () => {
    const name = `${'Very Long Name '.repeat(5)}End`;
    const { step } = buildSubscreenPerson({
      key: 'k',
      name: 'Tester',
      displayName: name,
    });
    expect(step.identifier).toMatch(
      /^subscreen_person_very-long-name-very_[A-Za-z0-9]{5}$/
    );
    expect(step.title).toBe(cleanCreditName(name).slice(0, 50));
    expect(step.description).toBe(cleanCreditName(name));
  });
});

describe('the credits document', () => {
  const person = (identifier: string) => known(identifier, 'Tester');

  it('reads like a real record', () => {
    const film = real.filmCredits;
    const document = buildSubscreenCreditsDocument(
      film.data.titleRef as SubscreenTitleRef,
      film.data.people.map((entry) => ({
        ...(entry as SubscreenCredit),
        personRef: entry.personRef as SubscreenPersonRef,
      })),
      film.data.people[0].at
    );
    // Same keys, in the same order, as Subscreen wrote them.
    expect(JSON.stringify(document)).toBe(JSON.stringify(film.data));
    const step = buildSubscreenCreditsStep({ key: 'k', document });
    expect(step).toMatchObject({
      kind: 'credits',
      service: 'DOCUMENT',
      identifier: film.resource.identifier,
      title: film.resource.metadata.title,
      description: film.resource.metadata.description,
      filename: 'credits.json',
    });
    expect(step.tag1).toBeUndefined();
    expect(stepJson(step)).toEqual(film.data);
  });

  it('keeps a character for actors only, each person once per role', () => {
    const document = buildSubscreenCreditsDocument(
      FILM,
      [
        {
          role: 'director',
          displayName: 'Sam Brandt',
          character: 'Not kept',
          personRef: person('p1'),
        },
        {
          role: 'actor',
          displayName: 'Ted Brandt',
          character: ' Stand-in ',
          personRef: person('p2'),
        },
        // The same director again (another spelling): the later one stays.
        {
          role: 'director',
          displayName: 'sam  BRANDT',
          personRef: person('p1'),
        },
        // Another role is another credit.
        { role: 'writer', displayName: 'Sam Brandt', personRef: person('p1') },
      ],
      1234
    );
    expect(document).toEqual({
      titleRef: FILM,
      people: [
        {
          personRef: { name: 'Tester', identifier: 'p2', service: 'DOCUMENT' },
          role: 'actor',
          displayName: 'Ted Brandt',
          character: 'Stand-in',
          at: 1234,
        },
        {
          personRef: { name: 'Tester', identifier: 'p1', service: 'DOCUMENT' },
          role: 'director',
          displayName: 'sam BRANDT',
          at: 1234,
        },
        {
          personRef: { name: 'Tester', identifier: 'p1', service: 'DOCUMENT' },
          role: 'writer',
          displayName: 'Sam Brandt',
          at: 1234,
        },
      ],
      version: 2,
    });
  });

  it('keeps the last 200', () => {
    const entries = Array.from({ length: 205 }, (_, index) => ({
      role: 'actor' as const,
      displayName: `Actor ${index}`,
      personRef: person(`p${index}`),
    }));
    const { people } = buildSubscreenCreditsDocument(FILM, entries, 1);
    expect(people).toHaveLength(200);
    expect(people[0].displayName).toBe('Actor 5');
  });

  it('describes it with the names, newest first, within 240 bytes', () => {
    expect(
      subscreenCreditsDescription([
        { displayName: 'Older One', at: 1 },
        { displayName: 'Newer  One', at: 2 },
        { displayName: 'older one', at: 1 },
      ])
    ).toBe('newer one older one');
    // A name that would go over is left out; the shorter ones after it fit.
    const long = 'é'.repeat(80);
    const description = subscreenCreditsDescription([
      { displayName: 'a'.repeat(150), at: 3 },
      { displayName: long, at: 2 },
      { displayName: 'Short Name', at: 1 },
    ]);
    expect(description).toBe(`${'a'.repeat(150)} short name`);
    expect(utf8Bytes(description).length).toBeLessThanOrEqual(240);
  });
});

describe('subscreenCreditList', () => {
  it('drops empty names and unknown roles, and keeps a person once per role', () => {
    expect(
      subscreenCreditList([
        { role: 'director', displayName: '   ' },
        { role: 'gaffer' as never, displayName: 'Someone' },
        { role: 'actor', displayName: ' Rob  Fenn ', character: 'Frank' },
        { role: 'composer', displayName: 'Alan Silvestri', character: 'x' },
        { role: 'actor', displayName: 'rob fenn', character: 'Frank Hale' },
      ])
    ).toEqual([
      { role: 'composer', displayName: 'Alan Silvestri' },
      { role: 'actor', displayName: 'rob fenn', character: 'Frank Hale' },
    ]);
  });
});

describe('planSubscreenCredits', () => {
  const credits: SubscreenCredit[] = [
    { role: 'director', displayName: 'Carl Weston' },
    { role: 'actor', displayName: 'Carl  Weston', character: 'Will Mott' },
    { role: 'actor', displayName: 'Dean Harlow', character: 'Little Ben' },
    { role: 'composer', displayName: 'Lars Nyholm' },
  ];

  it('publishes nothing without a name: no empty credits', async () => {
    const findPerson = vi.fn();
    for (const none of [undefined, [], [{ role: 'actor', displayName: ' ' }]]) {
      expect(
        await planSubscreenCredits({
          name: 'Tester',
          titleRef: FILM,
          credits: none as SubscreenCredit[],
          findPerson,
        })
      ).toBeNull();
    }
    expect(findPerson).not.toHaveBeenCalled();
  });

  it('points at people Subscreen knows and publishes the others first', async () => {
    const findPerson = vi.fn(async (name: string) =>
      name === 'Dean Harlow'
        ? known('subscreen_person_dean-harlow_AbCdE', 'Other')
        : null
    );
    const plan = await planSubscreenCredits({
      key: 'film',
      name: 'Tester',
      titleRef: FILM,
      credits,
      dependsOn: ['film:metadata'],
      findPerson,
      now: 99,
    });
    // Each person looked up once, two roles or not.
    expect(findPerson.mock.calls.map(([name]) => name)).toEqual([
      'Carl Weston',
      'Dean Harlow',
      'Lars Nyholm',
    ]);
    expect(plan.people.map((person) => person.document.displayName)).toEqual([
      'Carl Weston',
      'Lars Nyholm',
    ]);
    expect(plan.steps.map((step) => [step.key, step.kind])).toEqual([
      ['film:person-0', 'person'],
      ['film:person-1', 'person'],
      ['film:credits', 'credits'],
    ]);
    for (const person of plan.people) {
      expect(person.step.dependsOn).toEqual(['film:metadata']);
    }
    const creditsStep = plan.steps[2];
    expect(creditsStep.dependsOn).toEqual([
      'film:metadata',
      'film:person-0',
      'film:person-1',
    ]);
    expect(creditsStep.identifier).toBe(subscreenCreditsIdentifier(FILM));
    expect(plan.identifier).toBe(creditsStep.identifier);
    const clint = plan.people[0].ref;
    const lennie = plan.people[1].ref;
    expect(stepJson(creditsStep)).toEqual({
      titleRef: FILM,
      people: [
        {
          personRef: clint,
          role: 'director',
          displayName: 'Carl Weston',
          at: 99,
        },
        {
          personRef: clint,
          role: 'actor',
          displayName: 'Carl Weston',
          character: 'Will Mott',
          at: 99,
        },
        {
          personRef: {
            name: 'Other',
            identifier: 'subscreen_person_dean-harlow_AbCdE',
            service: 'DOCUMENT',
          },
          role: 'actor',
          displayName: 'Dean Harlow',
          character: 'Little Ben',
          at: 99,
        },
        {
          personRef: lennie,
          role: 'composer',
          displayName: 'Lars Nyholm',
          at: 99,
        },
      ],
      version: 2,
    });
    expect(creditsStep.description).toBe('carl weston dean harlow lars nyholm');
    // Remove takes the credits, never a person.
    expect(plan.resource).toEqual({
      service: 'DOCUMENT',
      name: 'Tester',
      identifier: creditsStep.identifier,
      kind: 'credits',
      filename: 'credits.json',
    });
  });

  it('belongs to a series’ playlist, never an episode', async () => {
    const plan = await planSubscreenCredits({
      key: 'series',
      name: 'Tester',
      titleRef: SERIES,
      credits: [{ role: 'writer', displayName: 'Hal Bremer' }],
      dependsOn: ['series:playlist'],
      findPerson: async () => known('subscreen_person_hal-bremer_x1y2z'),
    });
    expect(plan.steps).toHaveLength(1);
    const document = stepJson(plan.steps[0]);
    expect(document.titleRef).toEqual({
      name: 'Tester',
      identifier: 'qtube_playlist_the-show_AbC123',
      service: 'PLAYLIST',
    });
    expect(plan.identifier).toBe(original.qi(SERIES));
    expect(plan.steps[0].title).toBe('Credits qtube_playlist_the-show_AbC123');
  });

  it('publishes a new person when the lookup fails, as Subscreen does', async () => {
    const plan = await planSubscreenCredits({
      name: 'Tester',
      titleRef: FILM,
      credits: [{ role: 'editor', displayName: 'Joel Cox' }],
      findPerson: async () => {
        throw new Error('node down');
      },
    });
    expect(plan.people).toHaveLength(1);
    expect(plan.people[0].step.identifier).toMatch(
      /^subscreen_person_joel-cox_[A-Za-z0-9]{5}$/
    );
  });

  it('stops on a cancel', async () => {
    const abort = new AbortController();
    const result = planSubscreenCredits({
      name: 'Tester',
      titleRef: FILM,
      credits,
      signal: abort.signal,
      findPerson: async () => {
        abort.abort();
        return null;
      },
    });
    await expect(result).rejects.toBeInstanceOf(VideoPublishError);
    await expect(result).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('needs a name to publish under', async () => {
    await expect(
      planSubscreenCredits({
        name: ' ',
        titleRef: FILM,
        credits,
        findPerson: async () => null,
      })
    ).rejects.toMatchObject({ code: 'name-required' });
  });
});
