/**
 * Curated golden Q&As for Qortino: common questions, each with several
 * phrasings and a reviewed answer (tools/qortino-knowledge/golden/).
 *
 * Entries are ranked with BM25 over their phrasings (weighted 3×) and their
 * answer, so rare words count for more than common ones ("qortal" is in
 * thousands of entries) and an answer's words find entries whose phrasings
 * miss. On held-out phrasings of ~3,500 entries that put the right entry
 * first 45% of the time, against 25% for word overlap with phrasings alone.
 *
 * An entry is shown as-is only when Qortino can be sure of it, because a
 * wrong instant answer reads as authoritative: the question's words are
 * exactly those of one of its phrasings, or BM25 covers most of the question
 * with a clear lead over the next entry. Otherwise the closest entries go to
 * the model as hints. `tools/qortino-knowledge/eval-faq.mjs` measures both.
 */
import goldenAnswers from './goldenAnswers.json';
import { isQortPriceQuery } from './queryIntent';

export type GoldenEntry = {
  id: string;
  category: string;
  q: string;
  aliases?: string[];
  a: string;
  priority?: number;
};

export type GoldenMatch = {
  entry: GoldenEntry;
  /** Share of the question's word weight the entry covers, 0–1 (1 = a phrasing). */
  score: number;
};

export type GoldenLookup = {
  /** One entry clearly answers the question: show it as-is. */
  instant: GoldenMatch | null;
  /** Otherwise the closest entries, best first (at most two), for the model. */
  hints: GoldenMatch[];
};

const ENTRIES = (goldenAnswers as { entries: GoldenEntry[] }).entries || [];

/** BM25 term saturation and length normalization. */
const K1 = 1.2;
const B = 0.6;
/** A word in a phrasing counts three times a word in the answer. */
const PHRASING_WEIGHT = 3;
/** Instant answer: the entry covers this share of the question's weight… */
const INSTANT_COVERAGE = 0.45;
/** …and its score leads the next entry's by this share. */
const INSTANT_LEAD = 0.2;
/**
 * …and at least this share sits in its phrasings, not only in its answer:
 * "what is the weather like today" is not about the space-weather entry
 * whose answer happens to say "today".
 */
const INSTANT_PHRASING_COVERAGE = 0.5;
/** Less covered than this, an entry is not worth handing the model. */
const HINT_COVERAGE = 0.3;

function normalize(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[’']/g, "'")
      // "Q-Mail+" is not the same app as "Q-Mail".
      .replace(/\+/g, ' plus ')
      // "what's" asks what something is; "GO's composer" is about GO.
      .replace(
        /\b(what|who|where|how|when|why|it|that|there|here)'s\b/g,
        '$1 is'
      )
      .replace(/'s\b/g, '')
      // "dont" and "don't" are one word.
      .replace(/'/g, '')
      // Drop punctuation so "nomination?" matches "nomination".
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

const STOP = new Set(
  [
    'a an the is are was were be to of in on for and or',
    'how do does did can could would should',
    'i me my you your we our please tell about with from',
    'what which when where who why',
    // Conversational filler: "I want to mint" must score like "mint".
    // ("like" stays: Torq and Q-Tube questions are about likes.)
    'want wants wanted wanna need needs needed know just really',
    'hey hello hi im it its this that there these those if then than',
    'so as at by not no yes get got use using used',
  ]
    .join(' ')
    .split(' ')
);

function tokens(text: string): string[] {
  return (
    normalize(text)
      .split(' ')
      // Single digits stay: "level 3" is not "level 6".
      .filter((t) => (t.length > 1 || /\d/.test(t)) && !STOP.has(t))
  );
}

/**
 * Light suffix stemming so "mint" / "minting" / "minter" (and
 * publish/publishing, trade/trading…) count as the same concept.
 */
function stem(token: string): string {
  let s = token;
  if (s.length >= 6 && /ings?$/.test(s)) s = s.replace(/ings?$/, '');
  else if (s.length >= 6 && /ers?$/.test(s)) s = s.replace(/ers?$/, '');
  else if (s.length >= 5 && /ies$/.test(s)) s = s.replace(/ies$/, 'y');
  else if (s.length >= 5 && /(es|ed)$/.test(s)) s = s.replace(/(es|ed)$/, '');
  else if (s.length >= 4 && /s$/.test(s) && !/ss$/.test(s))
    s = s.replace(/s$/, '');
  return s.length >= 3 ? s : token;
}

/** A text's distinct word stems, sorted. */
function stemSet(text: string): string[] {
  return [...new Set(tokens(text).map(stem))].sort();
}

const EXACT_FILLER = new Set(['a', 'an', 'the', 'please']);

/** Words ending in "s" that are not plurals. */
const NOT_PLURAL = new Set([
  'does',
  'goes',
  'yes',
  'this',
  'his',
  'its',
  'plus',
]);

/** "revs" → "rev"; app names stay: "Q-Shops" is not "Q-Shop". */
function singular(word: string, previous?: string): string {
  if (previous === 'q' || NOT_PLURAL.has(word)) return word;
  if (word.length >= 5 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length >= 4 && word.endsWith('s') && !/(ss|us|is)$/.test(word)) {
    return word.slice(0, -1);
  }
  return word;
}

/** Openings that ask the same thing ("how do I", "how can I", "how to"). */
const SAME_OPENING: [RegExp, string][] = [
  [
    /^(how do i|how can i|how should i|how would i|how do you|how can you|how does one|how to)\b/,
    'how to',
  ],
  [/^(where do i|where can i|where to)\b/, 'where to'],
  [/^(what are|what is)\b/, 'what is'],
  [/^(can i|could i|may i)\b/, 'can i'],
];

/**
 * A phrasing as worded (plurals folded), minus articles, with the same
 * opening for the same kind of question: "What is a node?" and "what are nodes" stay apart from
 * "how do I run a node", but "how do I start minting" is "how to start
 * minting".
 */
function exactKey(text: string): string {
  let key = normalize(text)
    .split(' ')
    .filter((t) => t && !EXACT_FILLER.has(t))
    .join(' ')
    .replace(/^(hey |hi |ok )?qortino /, '');
  for (const [opening, same] of SAME_OPENING) {
    if (opening.test(key)) {
      key = key.replace(opening, same);
      break;
    }
  }
  // "what are revs" asks "what is a rev" (plurals only: "minting" and
  // "minter" are different questions).
  return key
    .split(' ')
    .map((word, i, words) => singular(word, words[i - 1]))
    .join(' ');
}

/** "grow mint" / herb tea — must not steal Qortal minting FAQs. */
function looksLikeHerbMint(query: string): boolean {
  const t = normalize(query);
  if (!/\bmint\b/.test(t)) return false;
  return /\b(grow|plant|harvest|dry|tea|leaves?|herb|mojito|spearmint|peppermint|garden|cook|kitchen|compost|soil|pot)\b/.test(
    t
  );
}

function isQortalMintingFaq(entry: GoldenEntry): boolean {
  if (entry.category !== 'qortal') return false;
  const blob = `${entry.q} ${(entry.aliases || []).join(' ')}`.toLowerCase();
  return /\bmint(ing|er|ership)?\b/.test(blob);
}

type Index = {
  /** Stem → the entries holding it, with its weighted count there. */
  postings: Map<string, { doc: number; tf: number }[]>;
  idf: Map<string, number>;
  /** Weight of a question word no entry has. */
  unknownIdf: number;
  docLength: Float64Array;
  avgLength: number;
  /** exactKey(phrasing) → entries with that phrasing. */
  phrasings: Map<string, number[]>;
  mintingFaq: boolean[];
  /** Stems of each entry's phrasings (its answer's words left out). */
  phrasingStems: Set<string>[];
  /** Philosophy metaphors ("QORT is priceless") that price asks must skip. */
  pricelessMetaphor: boolean[];
};

let index: Index | null = null;

/** Built on first use: thousands of entries, several phrasings each. */
function getIndex(): Index {
  if (index) return index;
  const postings = new Map<string, { doc: number; tf: number }[]>();
  const phrasings = new Map<string, number[]>();
  const docLength = new Float64Array(ENTRIES.length);
  const phrasingStems: Set<string>[] = [];
  ENTRIES.forEach((entry, doc) => {
    const tf = new Map<string, number>();
    phrasingStems[doc] = new Set();
    for (const phrasing of [entry.q, ...(entry.aliases || [])]) {
      const stems = stemSet(phrasing);
      const key = exactKey(phrasing);
      if (key) {
        const docs = phrasings.get(key) ?? [];
        if (!docs.includes(doc)) docs.push(doc);
        phrasings.set(key, docs);
      }
      for (const t of stems) {
        tf.set(t, (tf.get(t) ?? 0) + PHRASING_WEIGHT);
        phrasingStems[doc].add(t);
      }
    }
    for (const t of tokens(entry.a)) {
      const s = stem(t);
      tf.set(s, (tf.get(s) ?? 0) + 1);
    }
    for (const [t, n] of tf) {
      docLength[doc] += n;
      const list = postings.get(t) ?? [];
      list.push({ doc, tf: n });
      postings.set(t, list);
    }
  });
  const n = ENTRIES.length;
  const idf = new Map<string, number>();
  for (const [t, list] of postings) {
    idf.set(t, Math.log(1 + (n - list.length + 0.5) / (list.length + 0.5)));
  }
  let total = 0;
  for (const len of docLength) total += len;
  index = {
    postings,
    idf,
    unknownIdf: Math.log(1 + (n + 0.5) / 0.5),
    docLength,
    avgLength: n ? total / n : 1,
    phrasings,
    mintingFaq: ENTRIES.map(isQortalMintingFaq),
    phrasingStems,
    pricelessMetaphor: ENTRIES.map(
      (entry) =>
        entry.category === 'philosophy' &&
        /\bpriceless\b|\bworthless\b/i.test(`${entry.q} ${entry.a}`)
    ),
  };
  return index;
}

type PreparedQuery = {
  exact: string;
  stems: string[];
  allow?: (entry: GoldenEntry) => boolean;
  herbMint: boolean;
  priceAsk: boolean;
};

function prepareQuery(
  query: string,
  allow?: (entry: GoldenEntry) => boolean
): PreparedQuery | null {
  // If a retrieval helper folded a prior turn in, score the latest ask first.
  const followUp = query.match(/\nFollow-up:\s*(.+)\s*$/i);
  const primary = (followUp?.[1] || query).trim();
  if (normalize(primary).length < 4) return null;
  const stems = stemSet(primary);
  if (!stems.length) return null;
  return {
    exact: exactKey(primary),
    stems,
    allow,
    herbMint: looksLikeHerbMint(primary),
    priceAsk: isQortPriceQuery(primary),
  };
}

function excluded(idx: Index, doc: number, q: PreparedQuery): boolean {
  return (
    (q.herbMint && idx.mintingFaq[doc]) ||
    (q.priceAsk && idx.pricelessMetaphor[doc]) ||
    (q.allow !== undefined && !q.allow(ENTRIES[doc]))
  );
}

type Ranked = { doc: number; raw: number; coverage: number };

function rank(q: PreparedQuery, limit: number): Ranked[] {
  const idx = getIndex();
  const scores = new Map<number, number>();
  let full = 0;
  for (const t of q.stems) {
    const list = idx.postings.get(t);
    const w = idx.idf.get(t) ?? idx.unknownIdf;
    full += w;
    if (!list) continue;
    for (const { doc, tf } of list) {
      const norm = K1 * (1 - B + (B * idx.docLength[doc]) / idx.avgLength);
      scores.set(doc, (scores.get(doc) ?? 0) + (w * tf) / (tf + norm));
    }
  }
  const ranked: Ranked[] = [];
  for (const [doc, raw] of scores) {
    if (!excluded(idx, doc, q)) ranked.push({ doc, raw, coverage: raw / full });
  }
  return ranked.sort((a, b) => b.raw - a.raw).slice(0, limit);
}

/** Share of the question's weight found in the entry's phrasings alone. */
function phrasingCoverage(idx: Index, doc: number, q: PreparedQuery): number {
  let full = 0;
  let found = 0;
  for (const t of q.stems) {
    const w = idx.idf.get(t) ?? idx.unknownIdf;
    full += w;
    if (idx.phrasingStems[doc].has(t)) found += w;
  }
  return full ? found / full : 0;
}

const toMatch = (r: Ranked): GoldenMatch => ({
  entry: ENTRIES[r.doc],
  score: r.coverage,
});

/**
 * Instant answer if one entry clearly fits, else up to two hints for the
 * model. `allow` leaves entries out before ranking (e.g. book philosophy
 * unless the question is about the book).
 */
export function lookupGoldenAnswer(
  query: string,
  options?: { allow?: (entry: GoldenEntry) => boolean }
): GoldenLookup {
  const q = prepareQuery(query, options?.allow);
  if (!q) return { instant: null, hints: [] };
  const ranked = rank(q, 3);
  const idx = getIndex();

  // The question is worded like one of the phrasings: that entry, or the
  // best ranked of several sharing it.
  const exact = (idx.phrasings.get(q.exact) ?? []).filter(
    (doc) => !excluded(idx, doc, q)
  );
  if (exact.length) {
    const best = ranked.find((r) => exact.includes(r.doc))?.doc ?? exact[0];
    return { instant: { entry: ENTRIES[best], score: 1 }, hints: [] };
  }

  const [first, second] = ranked;
  if (!first || first.coverage < HINT_COVERAGE) {
    return { instant: null, hints: [] };
  }
  const lead = second ? (first.raw - second.raw) / first.raw : 1;
  // One word is too little to be sure of, unless it is a phrasing (above).
  if (
    q.stems.length >= 2 &&
    first.coverage >= INSTANT_COVERAGE &&
    lead >= INSTANT_LEAD &&
    phrasingCoverage(idx, first.doc, q) >= INSTANT_PHRASING_COVERAGE
  ) {
    return { instant: toMatch(first), hints: [] };
  }
  const hints = [toMatch(first)];
  if (second && lead < INSTANT_LEAD && second.coverage >= HINT_COVERAGE) {
    hints.push(toMatch(second));
  }
  return { instant: null, hints };
}

/**
 * The instant answer; with `minScore`, failing that, the best entry covering
 * at least that share of the question.
 */
export function matchGoldenAnswer(
  query: string,
  options?: { minScore?: number }
): GoldenMatch | null {
  const { instant } = lookupGoldenAnswer(query);
  if (instant || options?.minScore === undefined) return instant;
  const [best] = rankGoldenAnswers(query, 1);
  return best && best.score >= options.minScore ? best : null;
}

/** The closest entries, best first, for the knowledge tools (duplicates, evaluation). */
export function rankGoldenAnswers(query: string, limit = 5): GoldenMatch[] {
  const q = prepareQuery(query);
  return q ? rank(q, limit).map(toMatch) : [];
}

/**
 * Build the index ahead of the first question: about 300 ms on a desktop and
 * a second or more on a phone, for ~5,000 entries and ~26,000 phrasings.
 */
export function warmGoldenIndex(): void {
  getIndex();
}

export function goldenEntryCount(): number {
  return ENTRIES.length;
}
