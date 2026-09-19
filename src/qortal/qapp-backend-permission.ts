import { qappReticulumSessionPermissionKey } from './qapp-identity.ts';

type AppInfo = { tabId: string | number; name: string };
type HasPermission = (
  tabId: string | number,
  appName: string,
  permission: string
) => boolean;

// Backend approval covers both regular messages and private data transport.
// Destination checks and native connection ownership still apply independently.
export const createBackendPermissions = (
  requestApproval: (app: AppInfo, isFromExtension: boolean) => Promise<boolean>,
  grantSessionPermissions: (
    tabId: string | number,
    name: string,
    permissions: string[]
  ) => unknown
) => {
  const approved = new Set<string>();
  const pending = new Map<string, Promise<void>>();
  const keyFor = (app: AppInfo, destination: string) =>
    qappReticulumSessionPermissionKey(app.tabId, app.name, destination);

  return {
    has(app: AppInfo, destination: string) {
      return approved.has(keyFor(app, destination));
    },
    async authorize(
      app: AppInfo,
      destination: string,
      isFromExtension: boolean
    ) {
      const key = keyFor(app, destination);
      if (!approved.has(key)) {
        let approval = pending.get(key);
        if (!approval) {
          approval = Promise.resolve().then(async () => {
            if (
              !(await requestApproval(app, isFromExtension)) ||
              pending.get(key) !== approval
            ) {
              throw new Error('RNS_PERMISSION_DENIED');
            }
            approved.add(key);
          });
          pending.set(key, approval);
        }
        try {
          await approval;
        } finally {
          if (pending.get(key) === approval) pending.delete(key);
        }
      }
      grantSessionPermissions(app.tabId, app.name, ['PRIVATE_DATA_CHANNEL']);
    },
    clearByTabId(tabId: string | number) {
      const prefix = `${tabId}\u0000`;
      for (const key of approved) {
        if (key.startsWith(prefix)) approved.delete(key);
      }
      // A response arriving after the tab closes must not restore its grant.
      for (const key of pending.keys()) {
        if (key.startsWith(prefix)) pending.delete(key);
      }
    },
  };
};

export const unapprovedSessionPermissions = (
  app: AppInfo,
  permissions: string[],
  hasPermission: HasPermission
) =>
  [...new Set(permissions)].filter(
    (permission) => !hasPermission(app.tabId, app.name, permission)
  );
