import { useCallback, useEffect, useMemo } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  blockedAddressesAtom,
  blockedNamesAtom,
  rawWalletAtom,
} from '../atoms/global';

type CoreBlockedLists = {
  addresses: string[];
  names: string[];
};

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

const fetchCoreBlockedUsers = async (): Promise<CoreBlockedLists> => {
  const [blockedAddresses, blockedNames] = await Promise.all([
    fetchCoreList('blockedAddresses'),
    fetchCoreList('blockedNames'),
  ]);

  return {
    addresses: blockedAddresses,
    names: blockedNames,
  };
};

const runCoreListAction = async (
  listName: string,
  type: 'add' | 'remove',
  items: string[]
) => {
  const normalizedItems = normalizeListItems(items);
  if (!normalizedItems.length) return;

  await new Promise<void>((res, rej) => {
    window
      .sendMessage('listActions', {
        type,
        items: normalizedItems,
        listName,
      })
      .then((response) => {
        if (response?.error) {
          rej(response?.message);
          return;
        }

        res();
      })
      .catch((error) => {
        console.error('Failed qortalRequest', error);
        rej(error);
      });
  });
};

const loadBlockedLists = async (
  walletAddress: string,
  setBlockedAddresses: (blockedAddresses: Record<string, boolean>) => void,
  setBlockedNames: (blockedNames: Record<string, boolean>) => void
) => {
  if (!walletAddress) {
    setBlockedAddresses({});
    setBlockedNames({});
    return;
  }

  const blockedUsers = await fetchCoreBlockedUsers();
  setBlockedAddresses(toBlockedRecord(blockedUsers.addresses));
  setBlockedNames(toBlockedRecord(blockedUsers.names));
};

/**
 * Loads blocked list into atoms when authenticated. Uses only setters so the
 * component that calls this does NOT subscribe to the atoms and will not
 * re-render when the blocked list changes. Use this in App/root; use
 * useBlockedAddresses() in components that need to read the list.
 */
export const useBlockedAddressesLoader = (isAuthenticated?: boolean) => {
  const rawWallet = useAtomValue(rawWalletAtom);
  const setBlockedAddresses = useSetAtom(blockedAddressesAtom);
  const setBlockedNames = useSetAtom(blockedNamesAtom);
  const activeWalletAddress = rawWallet?.address0 || '';

  useEffect(() => {
    if (!isAuthenticated || !activeWalletAddress) return;
    setBlockedAddresses({});
    setBlockedNames({});
    loadBlockedLists(
      activeWalletAddress,
      setBlockedAddresses,
      setBlockedNames
    ).catch((error) => {
      console.error(error);
    });
  }, [
    activeWalletAddress,
    isAuthenticated,
    setBlockedAddresses,
    setBlockedNames,
  ]);
};

export const useBlockedAddresses = (isAuthenticated?: boolean) => {
  const rawWallet = useAtomValue(rawWalletAtom);
  const [blockedAddresses, setBlockedAddresses] = useAtom(blockedAddressesAtom);
  const [blockedNames, setBlockedNames] = useAtom(blockedNamesAtom);
  const activeWalletAddress = rawWallet?.address0 || '';

  const getAllBlockedUsers = useCallback(
    () => ({
      names: blockedNames,
      addresses: blockedAddresses,
    }),
    [blockedAddresses, blockedNames]
  );

  const refreshBlockedUsers = useCallback(async () => {
    if (!isAuthenticated || !activeWalletAddress) return;

    await loadBlockedLists(
      activeWalletAddress,
      setBlockedAddresses,
      setBlockedNames
    );
  }, [activeWalletAddress, isAuthenticated, setBlockedAddresses, setBlockedNames]);

  const isUserBlocked = useCallback(
    (address?: string | null) => {
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
      let nextBlockedNames = blockedNames;
      let nextBlockedAddresses = blockedAddresses;

      if (name) {
        await runCoreListAction('blockedNames', 'remove', [name]);
        nextBlockedNames = { ...blockedNames };
        delete nextBlockedNames[name];
        setBlockedNames(nextBlockedNames);
      }

      if (address) {
        await runCoreListAction('blockedAddresses', 'remove', [address]);
        nextBlockedAddresses = { ...blockedAddresses };
        delete nextBlockedAddresses[address];
        setBlockedAddresses(nextBlockedAddresses);
      }
    },
    [blockedAddresses, blockedNames, setBlockedAddresses, setBlockedNames]
  );

  const addToBlockList = useCallback(
    async (address, name) => {
      let nextBlockedNames = blockedNames;
      let nextBlockedAddresses = blockedAddresses;

      if (name) {
        await runCoreListAction('blockedNames', 'add', [name]);
        nextBlockedNames = { ...blockedNames, [name]: true };
        setBlockedNames(nextBlockedNames);
      }

      if (address) {
        await runCoreListAction('blockedAddresses', 'add', [address]);
        nextBlockedAddresses = { ...blockedAddresses, [address]: true };
        setBlockedAddresses(nextBlockedAddresses);
      }
    },
    [blockedAddresses, blockedNames, setBlockedAddresses, setBlockedNames]
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
