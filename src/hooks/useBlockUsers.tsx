import { useCallback, useEffect, useMemo } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import {
  blockedAddressesAtom,
  blockedNamesAtom,
} from '../atoms/global';

const normalizeListItems = (items: unknown): string[] => {
  if (!Array.isArray(items)) return [];

  return items
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
};

const toBlockedRecord = (items: string[]): Record<string, boolean> =>
  items.reduce<Record<string, boolean>>((record, item) => {
    record[item] = true;
    return record;
  }, {});

const fetchCoreList = async (listName: string): Promise<string[]> => {
  const response = await new Promise<unknown>((res, rej) => {
    window
      .sendMessage('listActions', {
        type: 'get',
        listName,
      })
      .then((response) => {
        if (response.error) {
          rej(response?.message);
          return;
        }

        res(response);
      })
      .catch((error) => {
        console.error('Failed qortalRequest', error);
        rej(error);
      });
  });

  return normalizeListItems(response);
};

const loadBlockedLists = async (
  setBlockedAddresses: (blockedAddresses: Record<string, boolean>) => void,
  setBlockedNames: (blockedNames: Record<string, boolean>) => void
) => {
  const [blockedAddresses, blockedNames] = await Promise.all([
    fetchCoreList('blockedAddresses'),
    fetchCoreList('blockedNames'),
  ]);

  setBlockedAddresses(toBlockedRecord(blockedAddresses));
  setBlockedNames(toBlockedRecord(blockedNames));
};

/**
 * Loads blocked list into atoms when authenticated. Uses only setters so the
 * component that calls this does NOT subscribe to the atoms and will not
 * re-render when the blocked list changes. Use this in App/root; use
 * useBlockedAddresses() in components that need to read the list.
 */
export const useBlockedAddressesLoader = (isAuthenticated?: boolean) => {
  const setBlockedAddresses = useSetAtom(blockedAddressesAtom);
  const setBlockedNames = useSetAtom(blockedNamesAtom);

  useEffect(() => {
    if (!isAuthenticated) return;
    setBlockedAddresses({});
    setBlockedNames({});
    loadBlockedLists(setBlockedAddresses, setBlockedNames).catch((error) => {
      console.error(error);
    });
  }, [isAuthenticated, setBlockedAddresses, setBlockedNames]);
};

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

  const refreshBlockedUsers = useCallback(async () => {
    if (!isAuthenticated) return;

    await loadBlockedLists(setBlockedAddresses, setBlockedNames);
  }, [isAuthenticated, setBlockedAddresses, setBlockedNames]);

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
      refreshBlockedUsers,
    }),
    [
      isUserBlocked,
      addToBlockList,
      removeBlockFromList,
      getAllBlockedUsers,
      refreshBlockedUsers,
    ]
  );
};
