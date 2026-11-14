/**
 * Shared intent gates so network FAQs, Q-Apps, and person/QDN lookups
 * do not steal each other's routes.
 */

/** "What is Qortal?" / how the network works — never an app or person lookup. */
export function isQortalNetworkDefinitionQuery(query: string): boolean {
  const t = query.trim().toLowerCase().replace(/[’']/g, "'");
  if (!t) return false;
  return (
    /\bwhat\s+is\s+(the\s+)?qortal(\s+network|\s+blockchain)?\b/.test(t) ||
    /\bwhat'?s\s+qortal\b/.test(t) ||
    /\bwhats\s+qortal\b/.test(t) ||
    /\bexplain\s+qortal\b/.test(t) ||
    /\b(define|describe)\s+qortal\b/.test(t) ||
    /\btell\s+me\s+about\s+qortal\b/.test(t) ||
    /\bhow\s+does\s+qortal\s+work\b/.test(t) ||
    /\bqortal\s+explained\b/.test(t) ||
    /\bis\s+qortal\s+a\s+(video\s+)?game\b/.test(t)
  );
}

/**
 * Concepts that share vocabulary with apps but are FAQ/how-to topics
 * unless the user names the app explicitly.
 */
const GENERIC_CONCEPT_NEEDLES = new Set([
  'minting',
  'mint',
  'minter',
  'minters',
  'names',
  'name',
  'trade',
  'trading',
  'search',
  'support',
  'website',
  'websites',
  'onboarding',
  'welcome',
  'node',
  'nodes',
  'chat',
  'group',
  'groups',
  'media',
  'video',
  'videos',
  'music',
  'blog',
  'assets',
  'asset',
  // Everyday words that are also Q-App names or aliases ("what is weather").
  'weather',
  'singularity',
  'gif',
  'gifs',
  'meme',
  'memes',
  'map',
  'maps',
  'movie',
  'movies',
  'shop',
  'shops',
  'drive',
  'notes',
]);

export function isGenericConceptNeedle(name: string): boolean {
  const n = name
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9\s+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return !n || GENERIC_CONCEPT_NEEDLES.has(n);
}

/**
 * Market-price asks for QORT — must never invent USD/BTC figures.
 * Point users to QDN Chat for live peer values.
 */
export function isQortPriceQuery(query: string): boolean {
  const t = query.trim().toLowerCase().replace(/[’']/g, "'");
  if (!t) return false;
  // Philosophy "priceless" / values talk is not a market quote ask.
  if (/\bpriceless\b|\bworthless\b|\brevolution\s+of\s+values\b/.test(t)) {
    return false;
  }
  if (!/\bqort\b/.test(t)) return false;
  return (
    /\b(price|worth|value|cost|rate|exchange\s*rate)\b/.test(t) ||
    /\bhow\s+much\s+(is|does|for)\b/.test(t) ||
    /\b(qort\s+to\s+(usd|btc|ltc|dollar|eur|euro)|usd\s+per\s+qort|ltc\s+per\s+qort)\b/.test(
      t
    ) ||
    /\bwhat\s+is\s+qort\s+(going\s+for|trading\s+at)\b/.test(t) ||
    (/\b(ltc|litecoin)\b/.test(t) &&
      /\b(per|price|rate|worth|to|against)\b/.test(t))
  );
}
