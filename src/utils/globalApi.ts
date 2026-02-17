import {
  cleanUrl,
  getProtocol,
  groupApi,
  groupApiSocket,
} from '../background/background.ts';
import { ApiKey } from '../types/auth.ts';

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
