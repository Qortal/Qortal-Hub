import { officialAppList } from '../config/officialApps';

/** A Q-App on Qortal Hub's official list. Websites are never official. */
export const isOfficialLibraryApp = (app: any): boolean =>
  app?.service === 'APP' &&
  officialAppList.includes(app?.name?.toLowerCase?.() ?? '');

/** The official Q-Apps of the library. */
export const officialAppsOf = (apps: readonly any[]): any[] =>
  (apps ?? []).filter(isOfficialLibraryApp);

/**
 * Everything else: community Q-Apps and every website, also one published
 * under an official app's name (the WEBSITE "Q-Mintership" used to show in no
 * tab at all).
 */
export const communityAppsOf = (apps: readonly any[]): any[] =>
  (apps ?? []).filter((app) => !isOfficialLibraryApp(app));
