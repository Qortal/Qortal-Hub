import { useEffect, useState } from 'react';
import { isNodeSelectionExplicit } from './utils/nodeSelection';

export const OnLaunchWrapper = ({ children }) => {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const fetchApiKey = async () => {
      try {
        const hasExplicitNodeSelection = isNodeSelectionExplicit();
        if (window.walletStorage && hasExplicitNodeSelection) {
          const res = await window.walletStorage.get('apiKey');
          if (res) {
            await window.sendMessage('setApiKey', res);
            setTimeout(() => setIsLoaded(true), 250);
          } else {
            setIsLoaded(true);
          }
        } else {
          setIsLoaded(true);
        }
      } catch (error) {
        console.error(
          'Error occurred when fetching apiKey info from file system',
          error
        );
        setIsLoaded(true);
      }
    };

    fetchApiKey();
  }, []);
  return !isLoaded ? null : children;
};
