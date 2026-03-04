import { createContext } from 'react';

export interface AppContextInterface {
  onCancel: (value?: any) => void;
  onOk: (payload?: any) => void;
  show: (data?: any) => Promise<any>;
  showInfo: (data?: any) => void;
  downloadResource: (params: any) => Promise<void>;
  getIndividualUserInfo: (address: string) => Promise<any>;
}

const defaultValues: AppContextInterface = {
  onCancel: () => {},
  onOk: () => {},
  show: () => Promise.resolve(undefined),
  showInfo: () => {},
  downloadResource: async () => {},
  getIndividualUserInfo: async () => null,
};

export const QORTAL_APP_CONTEXT =
  createContext<AppContextInterface>(defaultValues);
