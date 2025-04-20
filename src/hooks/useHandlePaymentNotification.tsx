import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getBaseApiReact } from '../App';
import { getData, storeData } from '../utils/chromeStorage';
import { checkDifference, getNameInfoForOthers } from '../background';
import { useRecoilState } from 'recoil';
import { lastPaymentSeenTimestampAtom } from '../atoms/global';
import { subscribeToEvent, unsubscribeFromEvent } from '../utils/events';

export const useHandlePaymentNotification = (address) => {
  const [latestTx, setLatestTx] = useState(null);

  const nameAddressOfSender = useRef({});
  const isFetchingName = useRef({});

  const [lastEnteredTimestampPayment, setLastEnteredTimestampPayment] =
    useRecoilState(lastPaymentSeenTimestampAtom);

  useEffect(() => {
    if (lastEnteredTimestampPayment && address) {
      storeData(`last-seen-payment-${address}`, Date.now()).catch((error) => {
        console.error(error);
      });
    }
  }, [lastEnteredTimestampPayment, address]);

  const getNameOrAddressOfSender = useCallback(async (senderAddress) => {
    if (isFetchingName.current[senderAddress]) return senderAddress;
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
    async (senderAddress) => {
      getNameOrAddressOfSender(senderAddress);
      return senderAddress;
    },
    [getNameOrAddressOfSender]
  );

  const hasNewPayment = useMemo(() => {
    if (!latestTx) return false;
    if (!checkDifference(latestTx?.timestamp)) return false;
    if (
      !lastEnteredTimestampPayment ||
      lastEnteredTimestampPayment < latestTx?.timestamp
    )
      return true;

    return false;
  }, [lastEnteredTimestampPayment, latestTx]);

  const getLastSeenData = useCallback(async () => {
    try {
      if (!address) return;
      const key = `last-seen-payment-${address}`;

      const res = await getData<any>(key).catch(() => null);
      if (res) {
        setLastEnteredTimestampPayment(res);
      }

      const response = await fetch(
        `${getBaseApiReact()}/transactions/search?txType=PAYMENT&address=${address}&confirmationStatus=CONFIRMED&limit=5&reverse=true`
      );

      const responseData = await response.json();

      const latestTx = responseData.filter(
        (tx) => tx?.creatorAddress !== address && tx?.recipient === address
      )[0];
      if (!latestTx) {
        return; // continue to the next group
      }

      setLatestTx(latestTx);
    } catch (error) {
      console.error(error);
    }
  }, [address, setLastEnteredTimestampPayment]);

  useEffect(() => {
    getLastSeenData();
    // Handler function for incoming messages
    const messageHandler = (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      const message = event.data;
      if (message?.action === 'SET_PAYMENT_ANNOUNCEMENT' && message?.payload) {
        setLatestTx(message.payload);
      }
    };

    // Attach the event listener
    window.addEventListener('message', messageHandler);

    // Clean up the event listener on component unmount
    return () => {
      window.removeEventListener('message', messageHandler);
    };
  }, [getLastSeenData]);

  const setLastEnteredTimestampPaymentEventFunc = useCallback(
    (e) => {
      setLastEnteredTimestampPayment(Date.now);
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
    latestTx,
    getNameOrAddressOfSenderMiddle,
    hasNewPayment,
    setLastEnteredTimestampPayment,
    nameAddressOfSender,
  };
};
