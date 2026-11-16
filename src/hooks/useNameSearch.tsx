import { useCallback, useEffect, useState } from 'react';
import { getBaseApiReact } from '../App';

interface NameListItem {
  name: string;
  address: string;
}

type NameSearchOptions = {
  /** How long typing must stop before Core is asked. */
  delayMs?: number;
  /** A shorter value is not looked up. */
  minLength?: number;
};

export const useNameSearch = (
  value: string,
  limit = 20,
  { delayMs = 300, minLength = 1 }: NameSearchOptions = {}
) => {
  const [nameList, setNameList] = useState<NameListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const checkIfNameExisits = useCallback(
    async (name: string, listLimit: number, signal: AbortSignal) => {
      try {
        if (!name) {
          setNameList([]);
          setIsLoading(false);
          return;
        }

        const res = await fetch(
          `${getBaseApiReact()}/names/search?query=${encodeURIComponent(name)}&prefix=true&limit=${listLimit}`,
          { signal }
        );
        const data = await res.json();
        // The answer for an older value: the newer one is on its way.
        if (signal.aborted) return;
        setNameList(
          Array.isArray(data)
            ? data.map((item: any) => {
                return {
                  name: item.name,
                  address: item.owner,
                };
              })
            : []
        );
      } catch (error) {
        if (signal.aborted) return;
        console.error(error);
      }
      setIsLoading(false);
    },
    []
  );
  // Debounce logic
  useEffect(() => {
    if (!value || value.length < minLength) {
      setNameList([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const controller = new AbortController();
    const handler = setTimeout(() => {
      checkIfNameExisits(value, limit, controller.signal);
    }, delayMs);

    // Cleanup timeout if searchValue changes before the timeout completes,
    // and cancel the request if it is already on its way
    return () => {
      clearTimeout(handler);
      controller.abort();
    };
  }, [value, limit, delayMs, minLength, checkIfNameExisits]);

  return {
    isLoading,
    results: nameList,
  };
};
