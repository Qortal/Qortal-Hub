import { useCallback, useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { mailsAtom, qMailLastEnteredTimestampAtom } from '../atoms/global';
import { getBaseApiReact } from '../App';

const QMAIL_POLL_INTERVAL_MS = 300000; // 5 minutes

/**
 * Fetches Q-mail list and last-entered timestamp, stores in global atoms,
 * and polls on an interval. Call from a parent that has user identity (e.g. Group).
 */
export function useQMailFetch(userName: string | undefined, userAddress: string | undefined) {
  const setMails = useSetAtom(mailsAtom);
  const setLastEnteredTimestamp = useSetAtom(qMailLastEnteredTimestampAtom);

  const getMails = useCallback(async () => {
    if (!userName || !userAddress) return;
    try {
      const query = `qortal_qmail_${userName.slice(0, 20)}_${userAddress.slice(-6)}_mail_`;
      const response = await fetch(
        `${getBaseApiReact()}/arbitrary/resources/search?service=MAIL_PRIVATE&query=${query}&limit=10&includemetadata=false&offset=0&reverse=true&excludeblocked=true&mode=ALL`
      );
      const mailData = await response.json();
      setMails(mailData ?? []);
    } catch (error) {
      console.error(error);
    }
  }, [userName, userAddress, setMails]);

  const getTimestamp = useCallback(async () => {
    try {
      const response = await window.sendMessage('getEnteredQmailTimestamp');
      if (!response?.error && response?.timestamp) {
        setLastEnteredTimestamp(response.timestamp);
      }
    } catch (error) {
      console.error(error);
    }
  }, [setLastEnteredTimestamp]);

  useEffect(() => {
    getTimestamp();
    if (!userName || !userAddress) return;
    getMails();
    const interval = setInterval(() => {
      getTimestamp();
      getMails();
    }, QMAIL_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [getMails, getTimestamp, userName, userAddress]);
}
