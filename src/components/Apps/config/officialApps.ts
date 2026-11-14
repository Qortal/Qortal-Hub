// Official Apps Configuration
// Featured apps appear in the carousel at the top
// All apps appear in the grid below

export interface OfficialAppConfig {
  name: string;
  icon?: string;
  featured?: boolean;
  description?: string;
}

export const officialAppsConfig = {
  // Apps featured in the carousel
  featured: [
    'Q-Tube',
    'Torq',
    'Q-Mail',
    'Q-Search',
    'Q-Trade',
    'Q-Wallets',
    'Q-Share',
    'Q-Shop',
    'SubWire',
    'Q-Assets',
  ],

  // These lead the Featured carousel, in this order; the other featured
  // apps follow, by rating
  featuredLead: ['Torq', 'Q-Tube', 'SubWire', 'Q-Share', 'Q-Assets'],

  // All official apps with metadata
  all: [
    { name: 'Q-Blog', icon: 'article', featured: true },
    { name: 'Q-Mail', icon: 'mail', featured: true },
    { name: 'Q-Trade', icon: 'swap', featured: true },
    { name: 'Q-Tube', icon: 'video', featured: true },
    { name: 'Q-Wallets', icon: 'wallet', featured: true },
    { name: 'Torq', icon: 'social', featured: true },
    { name: 'Names', icon: 'badge' },
    { name: 'Q-Assets', icon: 'assets', featured: true },
    { name: 'Q-Follow', icon: 'follow' },
    { name: 'Q-Fund', icon: 'fund' },
    { name: 'Q-Manager', icon: 'settings' },
    { name: 'Q-Mintership', icon: 'mint' },
    { name: 'Q-Node', icon: 'node' },
    { name: 'Q-Search', icon: 'search' },
    { name: 'Q-Share', icon: 'share', featured: true },
    { name: 'Q-Shop', icon: 'shopping', featured: true },
    { name: 'Q-Support', icon: 'support' },
    { name: 'Subscreen', icon: 'video' },
    { name: 'SubWire', icon: 'article', featured: true },
  ] as OfficialAppConfig[],
};

// Helper to get list of all official app names (lowercase for comparison)
export const officialAppList = officialAppsConfig.all.map((app) =>
  app.name.toLowerCase()
);

// Helper to check if an app is official
export const isOfficialApp = (appName: string): boolean => {
  return officialAppList.includes(appName?.toLowerCase());
};

// Helper to check if an app is featured
export const isFeaturedApp = (appName: string): boolean => {
  return officialAppsConfig.featured
    .map((n) => n.toLowerCase())
    .includes(appName?.toLowerCase());
};

type FeaturedAppRating = { averageRating?: number; totalVotes?: number };

// The Featured carousel's order: the apps `featuredLead` names first, in its
// order, then the others by rating, then by votes
export const sortFeaturedApps = <T extends { name: string }>(
  apps: readonly T[],
  ratingOf: (app: T) => FeaturedAppRating | undefined
): T[] => {
  const lead = officialAppsConfig.featuredLead.map((name) =>
    name.toLowerCase()
  );
  const leadIndex = (app: T) => {
    const index = lead.indexOf(app?.name?.toLowerCase());
    return index === -1 ? lead.length : index;
  };
  return [...apps].sort((a, b) => {
    const byLead = leadIndex(a) - leadIndex(b);
    if (byLead !== 0) return byLead;

    const ratingA = ratingOf(a);
    const ratingB = ratingOf(b);
    const avgA = ratingA?.averageRating || 0;
    const avgB = ratingB?.averageRating || 0;
    if (avgB !== avgA) return avgB - avgA;

    return (ratingB?.totalVotes || 0) - (ratingA?.totalVotes || 0);
  });
};

// Default pinned apps derived from the official apps list
export const defaultPinnedApps = officialAppsConfig.all.map((app) => ({
  name: app.name,
  service: 'APP',
}));
