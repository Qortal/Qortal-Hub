import { useCallback, useEffect, useState } from 'react';
import { getBaseApiReact } from '../App';

interface NameListItem {
  name: string;
  address: string;
}

export const useNameSearch = (value: string, limit = 20) => {
  const [nameList, setNameList] = useState<NameListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const checkIfNameExisits = useCallback(
    async (name: string, listLimit: number) => {
      try {
        if (!name) {
          setNameList([]);
          setIsLoading(false);
          return;
        }

        const res = await fetch(
          `${getBaseApiReact()}/names/search?query=${name}&prefix=true&limit=${listLimit}`
        );
        const data = await res.json();
        setNameList(
          data?.map((item: any) => {
            return {
              name: item.name,
              address: item.owner,
            };
          })
        );
      } catch (error) {
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );
  // Debounce logic
  useEffect(() => {
    if (!value) {
      setNameList([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const handler = setTimeout(() => {
      checkIfNameExisits(value, limit);
    }, 300);

    // Cleanup timeout if searchValue changes before the timeout completes
    return () => {
      clearTimeout(handler);
    };
  }, [value, limit, checkIfNameExisits]);

  return {
    isLoading,
    results: nameList,
  };
};
