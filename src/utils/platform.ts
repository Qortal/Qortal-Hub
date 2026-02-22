/** True when running inside the Electron desktop app (has coreSetup). */
export const isElectron = (): boolean =>
  typeof window !== 'undefined' && !!window?.coreSetup;
