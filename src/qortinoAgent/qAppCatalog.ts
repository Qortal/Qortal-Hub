/**
 * Curated Q-App / WEBSITE directory for Qortino.
 * Sources: Qortal GitHub/Gitea repos, QDN publish metadata, crowetic Gitea apps.
 * Qortino answers Q-App questions from this catalog and opens the app in a tab.
 */
import { executeEvent } from '../utils/events';
import { parkQortinoAgentSheet } from './qortinoSheetNav';
import {
  isGenericConceptNeedle,
  isQortalNetworkDefinitionQuery,
} from './queryIntent';

type QAppService = 'APP' | 'WEBSITE';

type QAppCatalogEntry = {
  id: string;
  /** Canonical QDN name */
  name: string;
  service: QAppService;
  /** Alternate QDN names / spellings */
  aliases?: string[];
  title: string;
  summary: string;
  /** Short tags for matching */
  tags?: string[];
  repo?: string;
};

/** Live publisher identity for a QDN APP/WEBSITE name. */
type QAppPublisherInfo = {
  /** Name the APP/WEBSITE is published under */
  publishName: string;
  ownerAddress: string;
  /** Account primary name (may match publishName) */
  primaryName: string;
  avatarUrl: string;
  level: number;
};

export type MatchedQApp = {
  entry: QAppCatalogEntry;
  score: number;
  publisher?: QAppPublisherInfo | null;
};

export const Q_APP_CATALOG: QAppCatalogEntry[] = [
  {
    id: 'q-assets',
    name: 'Q-Assets',
    service: 'APP',
    aliases: ['qassets', 'assets app', 'asset manager'],
    title: 'Q-Assets',
    summary:
      'Issue, manage, trade, and document native Qortal assets (not EVM tokens). QORT itself is asset ID 0 and is created by minting/consensus; other assets are issued with a full max supply by an issuer and are best thought of as ownership/stock-like instruments on-chain. Browse portfolios, community details, and asset info inside the app.',
    tags: ['assets', 'trade', 'portfolio'],
    repo: 'https://github.com/Qortal/Q-Assets',
  },
  {
    id: 'q-tube',
    name: 'Q-Tube',
    service: 'APP',
    aliases: ['qtube', 'video app'],
    title: 'Q-Tube',
    summary:
      'Decentralized video publishing and playback on QDN — upload, browse, and watch community videos without a corporate host.',
    tags: ['video', 'media', 'watch'],
    repo: 'https://github.com/Qortal/Q-Tube',
  },
  {
    id: 'ear-bump',
    name: 'Ear-Bump',
    service: 'APP',
    aliases: ['earbump', 'ear bump', 'music app'],
    title: 'Ear-Bump',
    summary: 'Decentralized audio / music publishing and listening on Qortal.',
    tags: ['music', 'audio', 'listen'],
    repo: 'https://github.com/Qortal/Ear-Bump',
  },
  {
    id: 'q-mail',
    name: 'Q-Mail',
    service: 'APP',
    aliases: ['qmail', 'mail'],
    title: 'Q-Mail',
    summary: 'Encrypted mail-style messaging between Qortal names.',
    tags: ['mail', 'message'],
    repo: 'https://github.com/Qortal/Q-Mail',
  },
  {
    id: 'q-blog',
    name: 'Q-Blog',
    service: 'APP',
    aliases: ['qblog', 'blog app'],
    title: 'Q-Blog',
    summary: 'Long-form blogging / articles published on QDN.',
    tags: ['blog', 'articles', 'website'],
    repo: 'https://github.com/Qortal/Q-Blog',
  },
  {
    id: 'q-share',
    name: 'Q-Share',
    service: 'APP',
    aliases: ['qshare', 'file share'],
    title: 'Q-Share',
    summary: 'Share files and folders over QDN.',
    tags: ['files', 'share'],
    repo: 'https://github.com/Qortal/Q-Share',
  },
  {
    id: 'q-search',
    name: 'Q-Search',
    service: 'APP',
    aliases: ['qsearch', 'search app'],
    title: 'Q-Search',
    summary: 'Search published QDN resources from inside Qortal.',
    tags: ['search'],
    repo: 'https://github.com/Qortal/Q-Search',
  },
  {
    id: 'q-support',
    name: 'Q-Support',
    service: 'APP',
    aliases: ['qsupport', 'support app'],
    title: 'Q-Support',
    summary: 'Community support / helpdesk-style Q-App.',
    tags: ['support', 'help'],
  },
  {
    id: 'q-node',
    name: 'Q-Node',
    service: 'APP',
    aliases: ['qnode', 'node app', 'qortal node app'],
    title: 'Q-Node',
    summary:
      'Node status and minting-account helpers for people running a Qortal core.',
    tags: ['node', 'minting', 'status'],
  },
  {
    id: 'names',
    name: 'Names',
    service: 'APP',
    aliases: ['names app', 'name manager', 'q-names'],
    title: 'Names',
    summary: 'Browse and manage registered Qortal names.',
    tags: ['names', 'identity'],
  },
  {
    id: 'q-trade',
    name: 'Q-Trade',
    service: 'APP',
    aliases: ['qtrade', 'trade portal app'],
    title: 'Q-Trade',
    summary: 'Trade-related Q-App surface around QORT cross-chain trading.',
    tags: ['trade', 'exchange'],
  },
  {
    id: 'q-mintership',
    name: 'Q-Mintership',
    service: 'APP',
    aliases: ['qmintership', 'mintership app', 'nomination board'],
    title: 'Q-Mintership',
    summary:
      'Live nomination board for minting rights — cards, admin votes, and MINTER group invites.',
    tags: ['minting', 'nomination', 'admin'],
    repo: 'https://gitea.qortal.org/crowetic/Q-Mintership-Alpha',
  },
  {
    id: 'q-minter-guide',
    name: 'Q-Minter',
    service: 'WEBSITE',
    aliases: ['q-minter guide', 'minter guide', 'qminter'],
    title: 'Q-Minter Guide',
    summary:
      'Detailed on-QDN website guide to minting on Qortal — concepts, levels, and practical setup. Pair with Q-Mintership for the live nomination board.',
    tags: ['minting', 'guide', 'docs'],
  },
  {
    id: 'welcome',
    name: 'Welcome to Qortal',
    service: 'APP',
    aliases: ['welcome app', 'welcome to qortal app'],
    title: 'Welcome to Qortal',
    summary:
      'Newcomer orientation Q-App — first steps, core ideas, and where to go next on the network.',
    tags: ['onboarding', 'beginner', 'start'],
  },
  {
    id: 'torq',
    name: 'Torq',
    service: 'APP',
    aliases: ['torq app', 'torq social'],
    title: 'Torq',
    summary:
      'The social Q-App for posts, replies, polls, GIFs and Revs (photo and video stories). It uses the same QDN data as Quitter, so Quitter posts and follows carry over.',
    tags: ['social', 'posts', 'feed', 'stories'],
  },
  {
    id: 'quitter',
    name: 'Quitter',
    service: 'APP',
    aliases: ['q-twitter', 'microblog'],
    title: 'Quitter',
    summary:
      'The original short-post social Q-App. Torq is its newer version on the same QDN data, with Revs, polls and GIFs.',
    tags: ['social', 'posts'],
    repo: 'https://github.com/Qortal/Quitter',
  },
  {
    id: 'subwire',
    name: 'SubWire',
    service: 'APP',
    aliases: ['sub wire', 'subwire'],
    title: 'SubWire',
    summary:
      'Decentralized publishing for articles, episodes, audio/video, author profiles, and private subscriber content.',
    tags: ['publish', 'articles', 'subscribe'],
    repo: 'https://github.com/Qortal/Subwire',
  },
  {
    id: 'subscriptions',
    name: 'Subscriptions',
    service: 'APP',
    aliases: ['q-subscriptions'],
    title: 'Subscriptions',
    summary:
      'Create and manage QORT-based subscriptions for private Qortal groups — billing, join requests, and subscriber status.',
    tags: ['subscribe', 'groups', 'billing'],
  },
  {
    id: 'qwb',
    name: 'QWB',
    service: 'APP',
    aliases: ['qortal web builder', 'web builder', 'q-web-builder'],
    title: 'Qortal Web Builder',
    summary:
      'Interactive website builder for Qortal — create personal pages, sites, or community fronts published on QDN.',
    tags: ['website', 'builder', 'no-code'],
  },
  {
    id: 'q-charts',
    name: 'Q-Charts',
    service: 'APP',
    aliases: ['qcharts', 'trade charts'],
    title: 'Q-Charts',
    summary: 'Charts Q-App for reviewing QORT trade chart data on Qortal.',
    tags: ['charts', 'trade', 'price'],
    repo: 'https://gitea.qortal.org/crowetic/Q-Charts',
  },
  {
    id: 'q-drive',
    name: 'Q-Drive',
    service: 'APP',
    aliases: ['qdrive', 'q drive', 'q-drive notes'],
    title: 'Q-Drive',
    summary:
      'A private drive for your files, encrypted on your device before anything goes to QDN, with folders, previews and sharing with one person, by Q-Mail or as a public Q-Share copy. It also has a Notes tab for encrypted notes and to-do lists.',
    tags: ['drive', 'files', 'storage', 'encrypted', 'notes', 'share'],
  },
  {
    id: 'subscreen',
    name: 'Subscreen',
    service: 'APP',
    aliases: ['sub screen', 'subscreen movies', 'movies app', 'tv series app'],
    title: 'Subscreen',
    summary:
      "Movies and TV series from the Qortal community: watch, rate out of 10, bookmark, add cast and crew, tip publishers and publish your own. It uses Q-Tube's format, so titles show in both apps.",
    tags: ['movies', 'series', 'video', 'watch', 'q-tube'],
  },
  {
    id: 'pos-plus',
    name: 'POS+',
    service: 'APP',
    aliases: ['pos plus', 'pos', 'point of sale', 'cash register', 'till app'],
    title: 'POS+',
    summary:
      'A point-of-sale app for shops and market stalls: card and cash sales, receipts, refunds, staff shifts, several locations and VAT reports. Store data is kept on QDN under your name, mostly encrypted.',
    tags: ['business', 'sales', 'shop', 'receipts', 'vat'],
  },
  {
    id: 'world-map',
    name: 'World Map',
    service: 'APP',
    aliases: ['worldmap', 'world map app', 'map app', 'poi map'],
    title: 'World Map',
    summary:
      "A map app for saving and sharing places and lists of places, browsing everyone's public places and posting to a World Feed, on map tiles stored on QDN.",
    tags: ['map', 'places', 'poi', 'travel'],
  },
  {
    id: 'thankq',
    name: 'ThankQ',
    service: 'APP',
    aliases: ['thank q', 'thankq hospitality', 'meetups app'],
    title: 'ThankQ',
    summary:
      'A hospitality app where people on Qortal offer stays, meetups, event trips and tools to lend, send requests and leave reviews. Listings, profiles and requests are public on QDN.',
    tags: ['travel', 'hosting', 'meetup', 'borrow'],
  },
  {
    id: 'q-weather',
    name: 'Q-Weather',
    service: 'APP',
    aliases: ['qweather', 'q weather', 'weather app', 'weather forecast'],
    title: 'Q-Weather',
    summary:
      'Weather forecasts for your places, with a meteogram chart, a list of days and a map with weather layers, delivered over QDN from ECMWF and regional models. It has three GO widgets: Weather Bars, Weather Chart and Weather Now.',
    tags: ['weather', 'forecast', 'meteogram', 'map', 'widget'],
  },
  {
    id: 'qortal-web',
    name: 'Qortal Web',
    service: 'APP',
    aliases: [
      'qortal web engine',
      'qwb search',
      'qortal web search',
      'qwb websites directory',
    ],
    title: 'Qortal Web',
    summary:
      'A search engine and directory for everything published with Qortal Web Builder: websites, forums, polls, articles, media, folders and shops.',
    tags: ['search', 'websites', 'directory', 'qwb'],
  },
  {
    id: 'q-shops',
    name: 'Q-Shops',
    service: 'APP',
    aliases: ['qshops', 'q shops', 'qwb marketplace', 'shops directory'],
    title: 'Q-Shops',
    summary:
      'A marketplace that gathers the Q-Shop stores built with Qortal Web Builder into one directory, with a cart across shops, checkout through Hub and order history.',
    tags: ['shop', 'marketplace', 'shopping', 'qwb'],
  },
  {
    id: 'gifs',
    name: 'GIFs',
    service: 'APP',
    aliases: ['gif library', 'gifs app', 'qortal gifs'],
    title: 'GIFs',
    summary:
      'A community GIF library: add GIFs or short MP4s with search words, then copy them into chats. The same library feeds the GIF pickers in Q-Chat and Torq.',
    tags: ['gif', 'chat', 'stickers'],
  },
  {
    id: 'q-meme',
    name: 'Q-MEME',
    service: 'APP',
    aliases: ['qmeme', 'q meme', 'meme maker', 'memes app'],
    title: 'Q-MEME',
    summary:
      'A community meme app: put words on templates or your own pictures, share finished memes and publish templates, then save them or copy them into chats.',
    tags: ['meme', 'gif', 'fun', 'create'],
  },
  {
    id: 'singularity',
    name: 'Singularity',
    service: 'APP',
    aliases: ['singularity game'],
    title: 'Singularity',
    summary:
      'A small game: fly your Qortal avatar, mint blocks and dodge black holes, with a public leaderboard of verified scores.',
    tags: ['game', 'play', 'leaderboard'],
  },
  {
    id: 'q-fund',
    name: 'Q-Fund',
    service: 'APP',
    aliases: ['qfund', 'q fund', 'crowdfund app', 'q-fund crowdfunding'],
    title: 'Q-Fund',
    summary:
      'Crowdfunding in QORT: start a campaign with a goal and an end date, or donate to one. Donations go to the creator if the goal is met by the deadline; otherwise the funds are returned.',
    tags: ['crowdfunding', 'donate', 'campaign'],
  },
  {
    id: 'q-shop',
    name: 'Q-Shop',
    service: 'APP',
    aliases: ['qshop', 'q shop', 'shop app', 'qortal store app'],
    title: 'Q-Shop',
    summary:
      'Decentralised shops: sellers list products and buyers pay the seller directly in QORT or ARRR, with no platform fee. Orders are encrypted for the buyer and the seller.',
    tags: ['shop', 'buy', 'sell'],
  },
  {
    id: 'q-wallets',
    name: 'Q-Wallets',
    service: 'APP',
    aliases: ['qwallets', 'q wallets', 'q-wallet'],
    title: 'Q-Wallets',
    summary:
      "Qortal's official wallet app: balances, history, sending and receiving with QR codes for QORT, BTC, LTC, DOGE, DGB, RVN and ARRR. Hub or GO keep the keys and ask you to approve each send.",
    tags: ['wallet', 'coins', 'send', 'receive'],
  },
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9\s+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Network nouns — never treat these as a specific Q-App name. */
const GENERIC_NETWORK_NEEDLES = new Set([
  'qortal',
  'qdn',
  'qort',
  'blockchain',
  'network',
  'crypto',
  'coin',
  'app',
  'apps',
  'q app',
  'q apps',
  'q-app',
  'q-apps',
]);

function isGenericNetworkNeedle(s: string): boolean {
  const n = normalize(s);
  return !n || GENERIC_NETWORK_NEEDLES.has(n);
}

function isInterrogativeQuery(t: string): boolean {
  return /^(what|who|how|why|where|when|is|are|can|do|does|did|should|could|would|tell|explain|define|describe|list|show|find|look)\b/.test(
    t
  );
}

/** True when a catalog string looks like a real product id/title, not a tag. */
function isStrongAppLabel(c: string): boolean {
  const n = normalize(c);
  if (!n || n.length < 2) return false;
  if (n.startsWith('q-') || n.startsWith('q ')) return true;
  if (n.includes('-')) return true;
  if (n.split(/\s+/).length >= 2) return true; // Welcome to Qortal, Ear Bump…
  // Single-token product names that are distinctive (not generic concepts).
  if (/^(quitter|subwire|subscriptions|qwb)$/.test(n)) return true;
  return false;
}

/** Extract a likely app name from questions like "what is q-assets". */
function extractQAppQueryName(query: string): string | null {
  const t = normalize(query);
  const patterns = [
    /^(?:what is|what's|whats|explain|tell me about|open|launch)\s+(.+?)(?:\s+q-?app)?\??$/,
    /^(?:how (?:do i|to) (?:use|open))\s+(.+?)(?:\s+q-?app)?\??$/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) {
      const name = m[1]
        .replace(/\bq-?app\b/g, '')
        .replace(/^\s*the\s+/i, '')
        .trim();
      if (isGenericNetworkNeedle(name)) return null;
      // Generic concepts ("minting", "names", "trade") only when user said "… app".
      if (
        isGenericConceptNeedle(name) &&
        !/\bapp\b/.test(t) &&
        !/^(open|launch)\b/.test(t) &&
        !isStrongAppLabel(name)
      ) {
        return null;
      }
      return name;
    }
  }
  // Bare product name only — never whole interrogative sentences.
  if (isInterrogativeQuery(t)) return null;
  if (/^[a-z0-9][a-z0-9 +.-]{1,40}$/.test(t) && !/\s{2,}/.test(t)) {
    if (isGenericNetworkNeedle(t)) return null;
    if (isGenericConceptNeedle(t) && !isStrongAppLabel(t)) return null;
    return t;
  }
  return null;
}

export function matchQAppCatalog(query: string): MatchedQApp | null {
  const t = normalize(query);
  if (!t || t.length < 2) return null;
  if (isQortalNetworkDefinitionQuery(query)) return null;

  // Group / roster phrasing — never an app card.
  if (
    /\b(owner|admins?|members?|digest|this week|last week)\b/.test(t) &&
    /\b(group|welcome to qortal)\b/.test(t)
  ) {
    return null;
  }

  const extracted = extractQAppQueryName(query);
  // Without a clear product needle, do not fuzzy the whole sentence against
  // tags — that caused "what is minting" → Q-Node.
  if (!extracted) return null;

  const needle = normalize(extracted);
  if (!needle) return null;
  if (isGenericNetworkNeedle(needle)) return null;
  if (
    isGenericConceptNeedle(needle) &&
    !/\bapp\b/.test(t) &&
    !/^(open|launch)\b/.test(t) &&
    !isStrongAppLabel(needle) &&
    !needle.startsWith('q-')
  ) {
    return null;
  }

  let best: MatchedQApp | null = null;
  for (const entry of Q_APP_CATALOG) {
    // Strong labels only for high-confidence short-circuit (≥0.8).
    const strong = [
      entry.name,
      entry.title,
      entry.id,
      ...(entry.aliases || []),
    ].map(normalize);
    // Tags are soft-only (never ≥0.8 by themselves).
    const tagLabels = (entry.tags || []).map((tag) => normalize(`${tag} app`));

    let local = 0;
    for (const c of strong) {
      if (!c) continue;
      // "Q-Mail+" (a pre-release + version) is not the Q-Mail card, nor the
      // other way round: the FAQ explains the + version and names the
      // stable app to use.
      if (needle.endsWith('+') !== c.endsWith('+')) continue;
      if (needle === c || t === c) {
        local = Math.max(local, 1);
        continue;
      }
      const compactN = needle.replace(/[\s_-]+/g, '');
      const compactC = c.replace(/[\s_-]+/g, '');
      if (compactN && compactN === compactC) {
        local = Math.max(local, 1);
        continue;
      }

      // Query contains full strong label ("open Welcome to Qortal")
      if (t.includes(c) && isStrongAppLabel(c)) {
        local = Math.max(local, 0.9);
        continue;
      }

      // Needle is a clear product chunk inside a longer title, or vice versa
      if (
        isStrongAppLabel(c) &&
        !isGenericConceptNeedle(needle) &&
        needle.length >= 4 &&
        (needle.includes(c) ||
          (c.includes(needle) &&
            (c.split(/\s+/).includes(needle) ||
              needle.length / c.length >= 0.5)))
      ) {
        local = Math.max(local, 0.85);
        continue;
      }

      if (
        compactN.length >= 5 &&
        isStrongAppLabel(c) &&
        !isGenericConceptNeedle(needle) &&
        (compactN === compactC ||
          (compactC.includes(compactN) &&
            compactN.length / Math.max(compactC.length, 1) >= 0.5) ||
          (compactN.includes(compactC) && compactC.length >= 5))
      ) {
        local = Math.max(local, 0.85);
      }
    }

    // Soft tag hint only when user said "app"
    if (/\bapp\b/.test(t)) {
      for (const c of tagLabels) {
        if (c && (needle === c || t.includes(c))) {
          local = Math.max(local, 0.55);
        }
      }
      if (
        entry.tags?.some(
          (tag) => t.includes(normalize(tag)) && t.includes('app')
        )
      ) {
        local = Math.max(local, 0.55);
      }
    }

    if (local >= 0.75 && (!best || local > best.score)) {
      best = { entry, score: local };
    }
  }
  return best;
}

export function formatQAppAnswer(
  entry: QAppCatalogEntry,
  publisher?: QAppPublisherInfo | null
): string {
  const where =
    entry.service === 'WEBSITE'
      ? `Open it as WEBSITE “${entry.name}” (qortal://${entry.service}/${entry.name}).`
      : `Open it as APP “${entry.name}” (qortal://${entry.service}/${entry.name}).`;
  let pub = '';
  if (publisher) {
    const same =
      publisher.primaryName.toLowerCase() ===
      publisher.publishName.toLowerCase();
    pub = same
      ? ` Published by ${publisher.primaryName} (Level ${publisher.level}).`
      : ` Published under “${publisher.publishName}” by ${publisher.primaryName} (Level ${publisher.level}).`;
  }
  return `${entry.title}: ${entry.summary} ${where}${pub}`;
}

export function openQAppInNewTab(opts: {
  service: QAppService;
  name: string;
}): void {
  parkQortinoAgentSheet();
  executeEvent('addTab', {
    data: {
      service: opts.service,
      name: opts.name,
      path: '',
      navigateIfAlreadyOpen: true,
    },
  });
  executeEvent('open-apps-mode', {});
}
