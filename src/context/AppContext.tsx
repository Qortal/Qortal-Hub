import { createContext } from 'react';
import type { DownloadResourceFunction } from '../hooks/useFetchResources';

export interface AppContextInterface {
  onCancel: (value?: any) => void;
  onOk: (payload?: any) => void;
  show: (data?: any) => Promise<any>;
  showInfo: (data?: any) => void;
  downloadResource: DownloadResourceFunction;
  getIndividualUserInfo: (address: string) => Promise<any>;
}

const defaultValues: AppContextInterface = {
  onCancel: () => {},
  onOk: () => {},
  show: () => Promise.resolve(undefined),
  showInfo: () => {},
  downloadResource: Object.assign(async () => {}, {
    cancelAllResourceDownloads: () => {},
    cancelResourceDownload: () => {},
  }) as DownloadResourceFunction,
  getIndividualUserInfo: async () => null,
};

export const QORTAL_APP_CONTEXT =
  createContext<AppContextInterface>(defaultValues);
