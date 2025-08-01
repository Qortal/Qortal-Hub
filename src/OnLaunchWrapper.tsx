import React, { useEffect, useState } from 'react';

export const OnLaunchWrapper = ({ children }) => {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const fetchApiKey = async () => {
      try {
        if (window.walletStorage) {
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
