//TODO
import { useRef, useState, useCallback, useMemo } from 'react';

interface State {
  isShow: boolean;
}

export interface ShowOptions {
  /**
   * Answer this confirmation as cancelled when a newer one takes its place
   * before it is answered: its promise rejects with `{ isCanceled: true }`,
   * as on Decline, so catch it. Without it, a replaced confirmation is never
   * answered.
   */
  cancelIfReplaced?: boolean;
}

export const useModal = () => {
  const [state, setState] = useState<State>({ isShow: false });
  const [message, setMessage] = useState({ publishFee: '', message: '' });
  const promiseConfig = useRef<any>(null);

  const show = useCallback((data, options?: ShowOptions) => {
    // One confirmation at a time: this one takes the place of any still open.
    // (Rejecting one that was answered already does nothing.)
    const replaced = promiseConfig.current;
    if (replaced?.cancelIfReplaced) replaced.reject({ isCanceled: true });
    setMessage(data);
    return new Promise((resolve, reject) => {
      promiseConfig.current = {
        resolve,
        reject,
        cancelIfReplaced: !!options?.cancelIfReplaced,
      };
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
    reject?.({ isCanceled: true });
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
