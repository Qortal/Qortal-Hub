import i18n from 'i18next';

export type QAppIdentityContext = {
  name: string;
  service: string;
};

export const normalizeQappIdentityContext = (
  appInfo: unknown
): QAppIdentityContext => {
  const candidate = appInfo as Record<string, unknown> | null | undefined;
  const name =
    typeof candidate?.name === 'string'
      ? candidate.name.trim().toLowerCase()
      : '';
  const service =
    typeof candidate?.service === 'string'
      ? candidate.service.trim().toUpperCase()
      : '';
  if (
    !name ||
    name.length > 128 ||
    !/^[A-Z0-9_]{1,32}$/.test(service)
  ) {
    throw new Error(i18n.t('auth:message.error.invalid_qapp_identity_context'));
  }
  return { name, service };
};

export const qappReticulumSessionPermissionKey = (
  tabId: string | number,
  appName: string,
  destination: string
) => `${tabId}\u0000${appName}\u0000${destination}`;
