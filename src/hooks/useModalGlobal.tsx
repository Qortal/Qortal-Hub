//TODO
import { useRef, useCallback, useMemo } from 'react';

export const useModalGlobal = ({ setGlobalOpen }) => {
  const promiseConfig = useRef<any>(null);

  const hide = useCallback(() => {
    setGlobalOpen(false);
  }, [setGlobalOpen]);

  const onOk = useCallback(
    (payload: any) => {
      const { resolve } = promiseConfig.current || {};
      hide();
      resolve?.(payload);
    },
    [hide]
  );

  const onCancel = useCallback(
    (payload) => {
      const { resolve } = promiseConfig.current || {};
      hide();
      resolve?.(payload);
    },
    [hide]
  );

  const show = useCallback(() => {
    return new Promise((resolve, reject) => {
      promiseConfig.current = { resolve, reject };
      setGlobalOpen({ isShow: true, onCancel, onOk });
    });
  }, [setGlobalOpen, onCancel, onOk]);

  return useMemo(
    () => ({
      show,
      onOk,
      onCancel,
    }),
    [show, onOk, onCancel]
  );
};
