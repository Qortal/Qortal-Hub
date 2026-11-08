/**
 * Private apps are group-encrypted blobs on QDN, so nothing in the payload
 * identifies them as apps. Publishes carry this marker in their description,
 * together with the group ID needed to decrypt them, so they can be listed.
 * The app name stays inside the encrypted payload and is not exposed.
 */
export const PRIVATE_APP_DESCRIPTION_MARKER = 'qortal-hub-private-app';

const GROUP_ID_PATTERN = /;groupId=(\d+)/;

export type PrivateAppSearchResult = {
  name?: string;
  identifier?: string;
  service?: string;
  created?: number;
  updated?: number | null;
  metadata?: {
    description?: string;
  } | null;
};

export type PublishedPrivateApp = {
  name: string;
  identifier: string;
  service: string;
  groupId: number;
  timestamp: number | null;
};

export const buildPrivateAppDescription = (groupId: number | string) =>
  `${PRIVATE_APP_DESCRIPTION_MARKER};groupId=${groupId}`;

export const parsePrivateAppGroupId = (
  description: string | null | undefined
): number | null => {
  if (!description?.startsWith(PRIVATE_APP_DESCRIPTION_MARKER)) return null;
  const match = description.match(GROUP_ID_PATTERN);
  if (!match) return null;
  const groupId = Number(match[1]);
  return Number.isSafeInteger(groupId) && groupId > 0 ? groupId : null;
};

export const buildMyPrivateAppsSearchUrl = (
  baseUrl: string,
  names: string[]
): string => {
  const params = new URLSearchParams({
    service: 'DOCUMENT',
    description: PRIVATE_APP_DESCRIPTION_MARKER,
    prefix: 'true',
    exactmatchnames: 'true',
    includemetadata: 'true',
    mode: 'ALL',
    limit: '0',
    reverse: 'true',
  });
  names.forEach((name) => params.append('name', name));
  return `${baseUrl}/arbitrary/resources/search?${params.toString()}`;
};

export const toPublishedPrivateApps = (
  results: PrivateAppSearchResult[] | null | undefined
): PublishedPrivateApp[] => {
  if (!Array.isArray(results)) return [];
  return results.flatMap((result) => {
    const groupId = parsePrivateAppGroupId(result?.metadata?.description);
    if (!groupId || !result?.name || !result?.identifier || !result?.service)
      return [];
    return [
      {
        name: result.name,
        identifier: result.identifier,
        service: result.service,
        groupId,
        timestamp: result.updated || result.created || null,
      },
    ];
  });
};
