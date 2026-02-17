import { createContext } from 'react';

export interface AppContextInterface {
  isShow: boolean;
  onCancel: () => void;
  onOk: () => void;
  show: () => void;
  message: any;
}

const defaultValues: AppContextInterface = {
  isShow: false,
  onCancel: () => {},
  onOk: () => {},
  show: () => {},
  message: {
    publishFee: '',
    message: '',
  },
};

export const QORTAL_APP_CONTEXT =
  createContext<AppContextInterface>(defaultValues);
