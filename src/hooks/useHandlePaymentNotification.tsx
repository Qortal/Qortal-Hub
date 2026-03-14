import { useCallback, useEffect, useRef } from 'react';
import { getNameInfoForOthers } from '../background/background.ts';
import { lastPaymentSeenTimestampAtom } from '../atoms/global';
import { subscribeToEvent, unsubscribeFromEvent } from '../utils/events';
import { useAtom } from 'jotai';

export const useHandlePaymentNotification = (address) => {
  const nameAddressOfSender = useRef({});
  const isFetchingName = useRef({});
  const [lastEnteredTimestampPayment, setLastEnteredTimestampPayment] = useAtom(
    lastPaymentSeenTimestampAtom
  );

  const getNameOrAddressOfSender = useCallback(async (senderAddress) => {
    if (isFetchingName.current[senderAddress]) return;
    try {
      isFetchingName.current[senderAddress] = true;
      const res = await getNameInfoForOthers(senderAddress);
      nameAddressOfSender.current[senderAddress] = res || senderAddress;
    } catch (error) {
      console.error(error);
    } finally {
      isFetchingName.current[senderAddress] = false;
    }
  }, []);

  const getNameOrAddressOfSenderMiddle = useCallback(
    (senderAddress) => {
      getNameOrAddressOfSender(senderAddress);
      return senderAddress;
    },
    [getNameOrAddressOfSender]
  );

  const setLastEnteredTimestampPaymentEventFunc = useCallback(
    () => {
      setLastEnteredTimestampPayment(Date.now());
    },
    [setLastEnteredTimestampPayment]
  );

  useEffect(() => {
    subscribeToEvent(
      'setLastEnteredTimestampPaymentEvent',
      setLastEnteredTimestampPaymentEventFunc
    );

    return () => {
      unsubscribeFromEvent(
        'setLastEnteredTimestampPaymentEvent',
        setLastEnteredTimestampPaymentEventFunc
      );
    };
  }, [setLastEnteredTimestampPaymentEventFunc]);

  return {
    getNameOrAddressOfSenderMiddle,
    lastEnteredTimestampPayment,
    setLastEnteredTimestampPayment,
    nameAddressOfSender,
  };
};
