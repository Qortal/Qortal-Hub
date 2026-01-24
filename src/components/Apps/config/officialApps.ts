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
  // Apps featured in the carousel (top 5)
  featured: ['q-tube', 'q-mail', 'q-blog', 'q-trade', 'q-shop'],

  // All official apps with metadata
  all: [
    { name: 'q-tube', icon: 'video', featured: true },
    { name: 'q-blog', icon: 'article', featured: true },
    { name: 'q-mail', icon: 'mail', featured: true },
    { name: 'q-trade', icon: 'swap', featured: true },
    { name: 'q-shop', icon: 'shopping', featured: true },
    { name: 'q-share', icon: 'share' },
    { name: 'q-support', icon: 'support' },
    { name: 'q-fund', icon: 'fund' },
    { name: 'q-manager', icon: 'settings' },
    { name: 'q-mintership', icon: 'mint' },
    { name: 'q-wallets', icon: 'wallet' },
    { name: 'q-search', icon: 'search' },
    { name: 'q-node', icon: 'node' },
    { name: 'names', icon: 'badge' },
    { name: 'q-follow', icon: 'follow' },
    { name: 'q-assets', icon: 'assets' },
    { name: 'quitter', icon: 'social' },
  ] as OfficialAppConfig[],
};

// Helper to get list of all official app names
export const officialAppList = officialAppsConfig.all.map((app) => app.name);

// Helper to check if an app is official
export const isOfficialApp = (appName: string): boolean => {
  return officialAppList.includes(appName?.toLowerCase());
};

// Helper to check if an app is featured
export const isFeaturedApp = (appName: string): boolean => {
  return officialAppsConfig.featured.includes(appName?.toLowerCase());
};
