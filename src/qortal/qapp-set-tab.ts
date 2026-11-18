import i18n from '../i18n/i18n';
import { isAppRenderSegment } from '../components/Apps/appRenderUrl';

/** The tab a Q-App or Home widget asks Hub to open with SET_TAB. */
export type SetTabData = {
  service: string;
  name: string;
  identifier?: string | null;
  path?: string | null;
  navigateIfAlreadyOpen?: true;
};

const isOptionalString = (value: unknown) =>
  value == null || typeof value === 'string';

/**
 * Builds the tab from the request's service, name, identifier and path only,
 * as OPEN_NEW_TAB does for a qortal:// link: the tab opens that resource from
 * the node, and nothing else about it comes from the request. Null when the
 * service or name is missing or is not one path segment, or a field is not
 * text.
 */
export function tabFromSetTabRequest(payload: unknown): SetTabData | null {
  if (!payload || typeof payload !== 'object') return null;
  const { service, name, identifier, path, navigateIfAlreadyOpen } =
    payload as Record<string, unknown>;
  if (!isAppRenderSegment(service)) return null;
  if (!isAppRenderSegment(name)) return null;
  if (!isOptionalString(identifier) || !isOptionalString(path)) return null;
  return {
    service,
    name,
    identifier: identifier as string | null | undefined,
    path: path as string | null | undefined,
    ...(navigateIfAlreadyOpen && { navigateIfAlreadyOpen: true }),
  };
}

/** The error a SET_TAB request without a usable tab is answered with. */
export const invalidSetTabError = () =>
  new Error(
    i18n.t('auth:message.error.invalid_qortal_link', {
      postProcess: 'capitalizeFirstChar',
    })
  );
