//TODO
import { useRef, useState, useCallback, useMemo } from 'react';

interface State {
  isShow: boolean;
}

export const useModal = () => {
  const [state, setState] = useState<State>({ isShow: false });
  const [message, setMessage] = useState({ publishFee: '', message: '' });
  const promiseConfig = useRef<any>(null);

  const show = useCallback((data) => {
    setMessage(data);
    return new Promise((resolve, reject) => {
      promiseConfig.current = { resolve, reject };
      setState({ isShow: true });
    });
  }, []);

  const hide = useCallback(() => {
    setState({ isShow: false });
    setMessage({ publishFee: '', message: '' });
  }, []);

  const onOk = useCallback(
    (payload: any) => {
      const { resolve } = promiseConfig.current || {};
      hide();
      resolve?.(payload);
    },
    [hide]
  );

  const onCancel = useCallback(() => {
    const { reject } = promiseConfig.current || {};
    hide();
    reject?.('Declined');
  }, [hide]);

  return useMemo(
    () => ({
      show,
      onOk,
      onCancel,
      isShow: state.isShow,
      message,
    }),
    [show, onOk, onCancel, state.isShow, message]
  );
};
