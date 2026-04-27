import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  blockedAddressesAtom,
  blockedNamesAtom,
  rawWalletAtom,
} from '../atoms/global';

const BLOCK_LIST_SCOPE_STORAGE_KEY =
  'hub_block_list_carry_over_across_accounts';
const BLOCK_LIST_MIGRATED_WALLET_STORAGE_KEY =
  'hub_block_list_migrated_wallet_address';
const BLOCK_LIST_STORAGE_PREFIX = 'hub_block_list_v1';

type PersistedBlockedUsers = {
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

const recordToBlockedItems = (record: Record<string, boolean>): string[] =>
  Object.keys(record || {})
    .filter((item) => record[item])
    .map((item) => item.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

const normalizePersistedBlockedUsers = (
  value: unknown
): PersistedBlockedUsers => {
  if (!value || typeof value !== 'object') {
    return { addresses: [], names: [] };
  }

  const blockedUsers = value as PersistedBlockedUsers;

  return {
    addresses: normalizeListItems(blockedUsers.addresses),
    names: normalizeListItems(blockedUsers.names),
  };
};

const readStoredBoolean = (key: string, fallback: boolean) => {
  if (typeof window === 'undefined') return fallback;

  try {
    const storedValue = window.localStorage.getItem(key);

    if (storedValue === null) return fallback;

    return JSON.parse(storedValue);
  } catch (error) {
    console.warn(`Unable to read stored value for ${key}.`, error);
    return fallback;
  }
};

const readCarryOverBlockedUsersEnabled = () =>
  readStoredBoolean(BLOCK_LIST_SCOPE_STORAGE_KEY, false);

const resolveBlockedStorageKey = (
  walletAddress: string,
  carryAcrossAccounts = readCarryOverBlockedUsersEnabled()
) =>
  carryAcrossAccounts
    ? `${BLOCK_LIST_STORAGE_PREFIX}:shared`
    : `${BLOCK_LIST_STORAGE_PREFIX}:wallet:${walletAddress}`;

const readStoredBlockedUsers = (
  walletAddress: string,
  carryAcrossAccounts = readCarryOverBlockedUsersEnabled()
): PersistedBlockedUsers | null => {
  if (typeof window === 'undefined' || !walletAddress) return null;

  try {
    const storedValue = window.localStorage.getItem(
      resolveBlockedStorageKey(walletAddress, carryAcrossAccounts)
    );

    if (!storedValue) return null;

    return normalizePersistedBlockedUsers(JSON.parse(storedValue));
  } catch (error) {
    console.warn('Unable to read stored blocked users.', error);
    return null;
  }
};

const writeStoredBlockedUsers = (
  walletAddress: string,
  blockedUsers: PersistedBlockedUsers,
  carryAcrossAccounts = readCarryOverBlockedUsersEnabled()
) => {
  if (typeof window === 'undefined' || !walletAddress) return;

  window.localStorage.setItem(
    resolveBlockedStorageKey(walletAddress, carryAcrossAccounts),
    JSON.stringify(normalizePersistedBlockedUsers(blockedUsers))
  );
};

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

const fetchCoreBlockedUsers = async (): Promise<PersistedBlockedUsers> => {
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

const syncCoreList = async (
  listName: string,
  currentItems: string[],
  desiredItems: string[]
) => {
  const currentSet = new Set(normalizeListItems(currentItems));
  const desiredSet = new Set(normalizeListItems(desiredItems));

  const itemsToRemove = [...currentSet].filter((item) => !desiredSet.has(item));
  const itemsToAdd = [...desiredSet].filter((item) => !currentSet.has(item));

  await runCoreListAction(listName, 'remove', itemsToRemove);
  await runCoreListAction(listName, 'add', itemsToAdd);
};

const syncCoreBlockedUsers = async (blockedUsers: PersistedBlockedUsers) => {
  const currentBlockedUsers = await fetchCoreBlockedUsers();

  await Promise.all([
    syncCoreList(
      'blockedAddresses',
      currentBlockedUsers.addresses,
      blockedUsers.addresses
    ),
    syncCoreList('blockedNames', currentBlockedUsers.names, blockedUsers.names),
  ]);
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

  let blockedUsers = readStoredBlockedUsers(walletAddress);

  if (!blockedUsers) {
    const carryAcrossAccounts = readCarryOverBlockedUsersEnabled();
    const migratedWalletAddress =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(BLOCK_LIST_MIGRATED_WALLET_STORAGE_KEY)
        : null;

    if (carryAcrossAccounts) {
      blockedUsers = await fetchCoreBlockedUsers();
    } else if (!migratedWalletAddress) {
      blockedUsers = await fetchCoreBlockedUsers();
      window.localStorage.setItem(
        BLOCK_LIST_MIGRATED_WALLET_STORAGE_KEY,
        walletAddress
      );
    } else if (migratedWalletAddress === walletAddress) {
      blockedUsers = await fetchCoreBlockedUsers();
    } else {
      blockedUsers = { addresses: [], names: [] };
    }

    writeStoredBlockedUsers(walletAddress, blockedUsers);
  } else {
    await syncCoreBlockedUsers(blockedUsers);
  }

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
  const [carryOverBlockedUsersEnabled, setCarryOverBlockedUsersEnabledState] =
    useState(() => readCarryOverBlockedUsersEnabled());
  const activeWalletAddress = rawWallet?.address0 || '';

  const persistBlockedUsers = useCallback(
    (
      nextBlockedAddresses: Record<string, boolean>,
      nextBlockedNames: Record<string, boolean>,
      carryAcrossAccounts = carryOverBlockedUsersEnabled
    ) => {
      if (!activeWalletAddress) return;

      writeStoredBlockedUsers(
        activeWalletAddress,
        {
          addresses: recordToBlockedItems(nextBlockedAddresses),
          names: recordToBlockedItems(nextBlockedNames),
        },
        carryAcrossAccounts
      );
    },
    [activeWalletAddress, carryOverBlockedUsersEnabled]
  );

  useEffect(() => {
    setCarryOverBlockedUsersEnabledState(readCarryOverBlockedUsersEnabled());
  }, [activeWalletAddress]);

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

      persistBlockedUsers(nextBlockedAddresses, nextBlockedNames);
    },
    [blockedAddresses, blockedNames, persistBlockedUsers, setBlockedAddresses, setBlockedNames]
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

      persistBlockedUsers(nextBlockedAddresses, nextBlockedNames);
    },
    [blockedAddresses, blockedNames, persistBlockedUsers, setBlockedAddresses, setBlockedNames]
  );

  const setCarryOverBlockedUsersEnabled = useCallback(
    async (enabled: boolean) => {
      setCarryOverBlockedUsersEnabledState(enabled);
      window.localStorage.setItem(
        BLOCK_LIST_SCOPE_STORAGE_KEY,
        JSON.stringify(enabled)
      );

      persistBlockedUsers(blockedAddresses, blockedNames, enabled);

      if (!activeWalletAddress) return;

      await syncCoreBlockedUsers({
        addresses: recordToBlockedItems(blockedAddresses),
        names: recordToBlockedItems(blockedNames),
      });
    },
    [
      activeWalletAddress,
      blockedAddresses,
      blockedNames,
      persistBlockedUsers,
    ]
  );

  return useMemo(
    () => ({
      carryOverBlockedUsersEnabled,
      isUserBlocked,
      addToBlockList,
      removeBlockFromList,
      getAllBlockedUsers,
      refreshBlockedUsers,
      setCarryOverBlockedUsersEnabled,
    }),
    [
      carryOverBlockedUsersEnabled,
      isUserBlocked,
      addToBlockList,
      removeBlockFromList,
      getAllBlockedUsers,
      refreshBlockedUsers,
      setCarryOverBlockedUsersEnabled,
    ]
  );
};
