import { useCallback, useEffect, useMemo } from 'react';
import { useAtom } from 'jotai';
import {
  blockedAddressesAtom,
  blockedNamesAtom,
} from '../atoms/global';

export const useBlockedAddresses = (isAuthenticated?: boolean) => {
  const [blockedAddresses, setBlockedAddresses] = useAtom(blockedAddressesAtom);
  const [blockedNames, setBlockedNames] = useAtom(blockedNamesAtom);

  const getAllBlockedUsers = useCallback(
    () => ({
      names: blockedNames,
      addresses: blockedAddresses,
    }),
    [blockedAddresses, blockedNames]
  );

  const isUserBlocked = useCallback(
    (address) => {
      try {
        if (!address) return false;
        return !!blockedAddresses[address];
      } catch (error) {
        console.log(error);
        return false;
      }
    },
    [blockedAddresses]
  );

  useEffect(() => {
    if (!isAuthenticated) return;
    setBlockedAddresses({});
    setBlockedNames({});
    const fetchBlockedList = async () => {
      try {
        const response = await new Promise((res, rej) => {
          window
            .sendMessage('listActions', {
              type: 'get',
              listName: `blockedAddresses`,
            })
            .then((response) => {
              if (response.error) {
                rej(response?.message);
                return;
              } else {
                res(response);
              }
            })
            .catch((error) => {
              console.error('Failed qortalRequest', error);
            });
        });

        const blockedUsers: Record<string, boolean> = {};
        response?.forEach((item) => {
          blockedUsers[item] = true;
        });
        setBlockedAddresses(blockedUsers);

        const response2 = await new Promise((res, rej) => {
          window
            .sendMessage('listActions', {
              type: 'get',
              listName: `blockedNames`,
            })
            .then((response) => {
              if (response.error) {
                rej(response?.message);
                return;
              } else {
                res(response);
              }
            })
            .catch((error) => {
              console.error('Failed qortalRequest', error);
            });
        });

        const blockedUsers2: Record<string, boolean> = {};
        response2?.forEach((item) => {
          blockedUsers2[item] = true;
        });
        setBlockedNames(blockedUsers2);
      } catch (error) {
        console.error(error);
      }
    };
    fetchBlockedList();
  }, [isAuthenticated, setBlockedAddresses, setBlockedNames]);

  const removeBlockFromList = useCallback(
    async (address, name) => {
      if (name) {
        await new Promise((res, rej) => {
          window
            .sendMessage('listActions', {
              type: 'remove',
              items: [name],
              listName: 'blockedNames',
            })
            .then((response) => {
              if (response.error) {
                rej(response?.message);
                return;
              } else {
                setBlockedNames((prev) => {
                  const copy = { ...prev };
                  delete copy[name];
                  return copy;
                });
                res(response);
              }
            })
            .catch((error) => {
              console.error('Failed qortalRequest', error);
            });
        });
      }

      if (address) {
        await new Promise((res, rej) => {
          window
            .sendMessage('listActions', {
              type: 'remove',
              items: [address],
              listName: 'blockedAddresses',
            })
            .then((response) => {
              if (response.error) {
                rej(response?.message);
                return;
              } else {
                setBlockedAddresses((prev) => {
                  const copy = { ...prev };
                  delete copy[address];
                  return copy;
                });
                res(response);
              }
            })
            .catch((error) => {
              console.error('Failed qortalRequest', error);
            });
        });
      }
    },
    [setBlockedAddresses, setBlockedNames]
  );

  const addToBlockList = useCallback(
    async (address, name) => {
      if (name) {
        await new Promise((res, rej) => {
          window
            .sendMessage('listActions', {
              type: 'add',
              items: [name],
              listName: 'blockedNames',
            })
            .then((response) => {
              if (response.error) {
                rej(response?.message);
                return;
              } else {
                setBlockedNames((prev) => ({ ...prev, [name]: true }));
                res(response);
              }
            })
            .catch((error) => {
              console.error('Failed qortalRequest', error);
            });
        });
      }

      if (address) {
        await new Promise((res, rej) => {
          window
            .sendMessage('listActions', {
              type: 'add',
              items: [address],
              listName: 'blockedAddresses',
            })
            .then((response) => {
              if (response.error) {
                rej(response?.message);
                return;
              } else {
                setBlockedAddresses((prev) => ({ ...prev, [address]: true }));
                res(response);
              }
            })
            .catch((error) => {
              console.error('Failed qortalRequest', error);
            });
        });
      }
    },
    [setBlockedAddresses, setBlockedNames]
  );

  return useMemo(
    () => ({
      isUserBlocked,
      addToBlockList,
      removeBlockFromList,
      getAllBlockedUsers,
    }),
    [isUserBlocked, addToBlockList, removeBlockFromList, getAllBlockedUsers]
  );
};
