/**
 * What Qortino says on Home now and then: short lines that pop out of his
 * mouth. Most invite the user to try Qortino AI (click his head to download
 * it, or type next to him once it is on this computer); jokes and tips in
 * between keep it from feeling like an ad. The words live in
 * core:qortino_workspace.quips.<category>.<slug>.
 */

export type QortinoQuipCategory =
  | 'promo'
  | 'ready'
  | 'fun'
  | 'tip'
  | 'night'
  | 'morning'
  /** His answer when a long press (a tickle) lets go. */
  | 'tickle'
  /** The same after a very long one: he gives up laughing. */
  | 'tickle_long'
  /** Giggles while the tickling goes on. */
  | 'giggle';

export type QortinoQuip = {
  /** i18n key, without the namespace. */
  key: string;
  category: QortinoQuipCategory;
  /** Jokes end in a wink. */
  wink: boolean;
};

export const QORTINO_QUIPS: Record<QortinoQuipCategory, readonly string[]> = {
  // Qortino AI is not on this computer yet: click the head to get it.
  promo: [
    'intro',
    'tap_head',
    'offline',
    'download_brain',
    'private',
    'ask_qortal',
    'skills',
    'brain_on_qdn',
    'power_out',
    'pretty_face',
    'own_ai',
    'helper',
    'love_to_chat',
    'private_node',
  ],
  // It is: type a question next to him.
  ready: [
    'ready_intro',
    'ask_anything',
    'all_ears',
    'no_internet',
    'skills',
    'on_computer',
    'two_heads',
    'ready_when_you_are',
    'minting',
    'stays_here',
  ],
  fun: [
    'beep',
    'mint_joke',
    'antenna',
    'syncing',
    'keys',
    'sheep',
    'high_five',
    'hydrated',
    'counting',
    'looking_good',
    'round_blue',
    'exercise',
    'tickle',
    'coffee',
    'cross_chain',
    'knock_knock',
  ],
  tip: [
    'coin',
    'own_node',
    'minters',
    'qdn_apps',
    'sidebar',
    'hotkeys',
    'backup',
    'name',
    'say_hi',
  ],
  night: ['late', 'yawn', 'night_owl', 'rest'],
  morning: ['good_morning', 'synced'],
  tickle: [
    'like_it',
    'hehe',
    'dont_stop',
    'antenna',
    'found_spot',
    'sneeze',
    'cold_fingers',
    'favorite_button',
    'tickle_minting',
    'giggling_circuits',
  ],
  tickle_long: ['give_up', 'mercy', 'reboot', 'stamina'],
  giggle: [
    'hahaha',
    'hihihi',
    'hehe_stop',
    'not_antenna',
    'eeek',
    'my_circuits',
    'stop_stop',
    'hohoho',
    'so_ticklish',
    'no_fair',
  ],
};

/** The lines that come by themselves (the tickle answers only on a tickle). */
export const SCHEDULED_QUIP_CATEGORIES: readonly QortinoQuipCategory[] = [
  'promo',
  'ready',
  'fun',
  'tip',
  'night',
  'morning',
];

/** Held this long, a tickle gets one of the give-up lines. */
export const LONG_TICKLE_MS = 2_500;

/** The first line Qortino ever says on this computer introduces him. */
const FIRST_LINE: Record<'promo' | 'ready', string> = {
  promo: 'intro',
  ready: 'ready_intro',
};

/** Lines not repeated until this many others were said. */
export const QORTINO_QUIP_MEMORY = 24;

export type QortinoQuipContext = {
  /** Qortino AI is on this computer. */
  aiReady: boolean;
  /** Local hour, 0-23. */
  hour: number;
  /** Keys said lately, oldest first. */
  recent: readonly string[];
  random?: () => number;
};

export const quipKey = (category: QortinoQuipCategory, slug: string) =>
  `quips.${category}.${slug}`;

export const isNightHour = (hour: number) => hour >= 23 || hour < 5;
export const isMorningHour = (hour: number) => hour >= 5 && hour < 10;

function makeQuip(category: QortinoQuipCategory, slug: string): QortinoQuip {
  return { key: quipKey(category, slug), category, wink: category === 'fun' };
}

/**
 * The next line. Half the time an invite to Qortino AI (which one depends
 * on whether it is on this computer), else a joke or a tip, and at night or in
 * the morning sometimes a word about the time of day.
 */
export function pickQortinoQuip(context: QortinoQuipContext): QortinoQuip {
  const random = context.random ?? Math.random;
  const invite = context.aiReady ? 'ready' : 'promo';
  if (!context.recent.some((key) => key.startsWith(`quips.${invite}.`))) {
    return makeQuip(invite, FIRST_LINE[invite]);
  }

  const weights: [QortinoQuipCategory, number][] = [
    [invite, 0.5],
    ['fun', 0.3],
    ['tip', 0.2],
  ];
  if (isNightHour(context.hour)) weights.push(['night', 0.25]);
  else if (isMorningHour(context.hour)) weights.push(['morning', 0.12]);

  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  let category = weights[0][0];
  for (const [candidate, weight] of weights) {
    roll -= weight;
    if (roll < 0) {
      category = candidate;
      break;
    }
  }

  const recent = new Set(context.recent);
  const lines = QORTINO_QUIPS[category];
  const fresh = lines.filter((slug) => !recent.has(quipKey(category, slug)));
  // All said lately: the one said longest ago comes back first.
  const pool = fresh.length
    ? fresh
    : [...lines].sort(
        (a, b) =>
          context.recent.indexOf(quipKey(category, a)) -
          context.recent.indexOf(quipKey(category, b))
      );
  const slug = fresh.length
    ? pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
    : pool[0];
  return makeQuip(category, slug);
}

/** What Qortino says when a tickle lets go: not what he said lately. */
export function pickTickleQuip(context: {
  heldMs: number;
  recent: readonly string[];
  random?: () => number;
}): QortinoQuip {
  const random = context.random ?? Math.random;
  const category: QortinoQuipCategory =
    context.heldMs >= LONG_TICKLE_MS ? 'tickle_long' : 'tickle';
  const lines = QORTINO_QUIPS[category];
  const recent = new Set(context.recent);
  const fresh = lines.filter((slug) => !recent.has(quipKey(category, slug)));
  const pool = fresh.length ? fresh : lines;
  const slug =
    pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  return makeQuip(category, slug);
}

/** A giggle while he is being tickled: never the same one twice running. */
export function pickGiggleQuip(context: {
  last: string | null;
  random?: () => number;
}): QortinoQuip {
  const random = context.random ?? Math.random;
  const lines = QORTINO_QUIPS.giggle.filter(
    (slug) => quipKey('giggle', slug) !== context.last
  );
  const slug =
    lines[Math.min(lines.length - 1, Math.floor(random() * lines.length))];
  return makeQuip('giggle', slug);
}

/** How long a line stays up once typed out: long enough to read it. */
export function quipHoldMs(text: string): number {
  return Math.min(8_000, Math.max(3_400, 2_400 + text.length * 45));
}

/** Time to type a line out, so the mouth moves as long as the words come. */
export const QUIP_TYPE_MS_PER_CHAR = 26;

export function quipTypingMs(text: string): number {
  return Math.min(2_600, text.length * QUIP_TYPE_MS_PER_CHAR);
}
