import { base64ToUint8Array } from '../../qdn/encryption/group-encryption';
import { getGroupAdminsAddress } from '../Group/groupApi';

/** The private app an Update opens: its resource and its group. */
export type PrivateAppTarget = {
  name: string;
  service: string;
  identifier: string;
  groupId: number;
};

export type PrivateAppCurrentVersion = {
  appName: string;
  /** Base64 image, as the app's payload stores it. */
  logo: string | null;
};

export type GroupAdminStatus = 'checking' | 'admin' | 'not_admin' | 'unknown';

export const buildPrivateAppDataUrl = (
  baseUrl: string,
  app: PrivateAppTarget
): string =>
  `${baseUrl}/arbitrary/${[app.service, app.name, app.identifier]
    .map(encodeURIComponent)
    .join('/')}?encoding=base64`;

type FetchLike = (
  input: string
) => Promise<{ ok: boolean; status?: number; text: () => Promise<string> }>;

type Decrypt = (base64: string, groupId: number) => Promise<unknown>;

const decryptWithGroupKey: Decrypt = (base64, groupId) =>
  window.sendMessage('DECRYPT_QORTAL_GROUP_DATA', { base64, groupId });

/**
 * The app name and logo of the published version, decrypted as Open does it,
 * or null when the node hasn't got it or it can't be decrypted. The app's
 * files are dropped at once: only the name and logo are returned.
 */
export const loadPrivateAppCurrentVersion = async (
  baseUrl: string,
  app: PrivateAppTarget,
  {
    fetchFn = fetch as unknown as FetchLike,
    decrypt = decryptWithGroupKey,
  }: { fetchFn?: FetchLike; decrypt?: Decrypt } = {}
): Promise<PrivateAppCurrentVersion | null> => {
  const response = await fetchFn(buildPrivateAppDataUrl(baseUrl, app));
  if (!response.ok) return null;
  const decrypted = await decrypt(await response.text(), app.groupId);
  if (typeof decrypted !== 'string' || !decrypted) return null;
  // { app, logo, name }, as the private publish form encrypts it.
  const payload = JSON.parse(
    new TextDecoder().decode(base64ToUint8Array(decrypted))
  );
  return {
    appName: typeof payload?.name === 'string' ? payload.name : '',
    logo:
      typeof payload?.logo === 'string' && payload.logo ? payload.logo : null,
  };
};

/**
 * Whether `address` is still an admin of the group, asked of the node with
 * the lookup the group pages use. Every group has an admin, so an empty or
 * failed answer proves nothing: the admin groups loaded at sign-in decide
 * then, and the answer is 'unknown' if they don't list the group.
 */
export const checkGroupAdmin = async (
  groupId: number,
  address: string,
  {
    getAdmins = getGroupAdminsAddress,
    knownAdminGroupIds = [],
  }: {
    getAdmins?: (groupId: number) => Promise<string[]>;
    knownAdminGroupIds?: unknown[];
  } = {}
): Promise<Exclude<GroupAdminStatus, 'checking'>> => {
  try {
    const admins = await getAdmins(groupId);
    if (Array.isArray(admins) && admins.length > 0) {
      return admins.includes(address) ? 'admin' : 'not_admin';
    }
  } catch (error) {
    console.warn('Group admins could not be loaded', error);
  }
  return knownAdminGroupIds.some((id) => Number(id) === Number(groupId))
    ? 'admin'
    : 'unknown';
};
