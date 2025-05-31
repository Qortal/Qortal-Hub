import { useMemo } from 'react';

export function useSortedMyNames(names, myName) {
  return useMemo(() => {
    return [...names].sort((a, b) => {
      if (a === myName) return -1;
      if (b === myName) return 1;
      return 0;
    });
  }, [names, myName]);
}
