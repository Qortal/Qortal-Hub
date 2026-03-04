import {
  cleanUrl,
  getProtocol,
  groupApi,
  groupApiSocket,
} from '../background/background.ts';
import { ApiKey } from '../types/auth.ts';
import { isLocalPrivateHttpsUrl } from './helpers.ts';

export let globalApiKey: ApiKey | null = null;

export const handleSetGlobalApikey = (data: ApiKey | null) => {
  globalApiKey = data;
};

export const getBaseApiReact = (customApi?: string): string => {
  if (customApi) {
    return customApi;
  }
  if (globalApiKey?.url) {
    return globalApiKey.url;
  }
  return groupApi;
};

/** Base API URL for avatar/image requests. Uses HTTP when on local/private HTTPS (same logic as useAuth). */
export const getBaseApiReactForAvatar = (customApi?: string): string => {
  let baseUrl = getBaseApiReact(customApi);
  if (isLocalPrivateHttpsUrl(baseUrl)) {
    baseUrl = baseUrl.replace(/^https:\/\//i, 'http://');
  }
  return baseUrl;
};

/** Base API URL for primary name fetch when used for avatar (wallets/auth). Uses HTTP when on local/private HTTPS. */
export const getBaseApiReactForPrimaryName = (customApi?: string): string => {
  let baseUrl = getBaseApiReact(customApi);
  if (isLocalPrivateHttpsUrl(baseUrl)) {
    baseUrl = baseUrl.replace(/^https:\/\//i, 'http://');
  }
  return baseUrl;
};

export const getArbitraryEndpointReact = (): string => {
  return `/arbitrary/resources/searchsimple`;
};

export const getBaseApiReactSocket = (customApi?: string): string => {
  if (customApi) {
    return customApi;
  }
  if (globalApiKey?.url) {
    const protocol = getProtocol(globalApiKey.url) === 'http' ? 'ws://' : 'wss://';
    return `${protocol}${cleanUrl(globalApiKey.url)}`;
  }
  return groupApiSocket;
};
