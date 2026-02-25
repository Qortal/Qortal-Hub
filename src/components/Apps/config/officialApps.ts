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
  featured: ['Q-Tube', 'Quitter', 'Q-Mail', 'Q-Search', 'Q-Trade', 'Q-Wallets'],

  // All official apps with metadata
  all: [
    { name: 'Q-Blog', icon: 'article', featured: true },
    { name: 'Q-Mail', icon: 'mail', featured: true },
    { name: 'Q-Trade', icon: 'swap', featured: true },
    { name: 'Q-Tube', icon: 'video', featured: true },
    { name: 'Q-Wallets', icon: 'wallet', featured: true },
    { name: 'Quitter', icon: 'social', featured: true },
    { name: 'Names', icon: 'badge' },
    { name: 'Q-Assets', icon: 'assets' },
    { name: 'Q-Follow', icon: 'follow' },
    { name: 'Q-Fund', icon: 'fund' },
    { name: 'Q-Manager', icon: 'settings' },
    { name: 'Q-Mintership', icon: 'mint' },
    { name: 'Q-Node', icon: 'node' },
    { name: 'Q-Search', icon: 'search' },
    { name: 'Q-Share', icon: 'share' },
    { name: 'Q-Shop', icon: 'shopping' },
    { name: 'Q-Support', icon: 'support' },
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

// Default pinned apps derived from the official apps list
export const defaultPinnedApps = officialAppsConfig.all.map((app) => ({
  name: app.name,
  service: 'APP',
}));
