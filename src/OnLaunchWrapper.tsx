import React, { useEffect, useState } from 'react';

export const OnLaunchWrapper = ({ children }) => {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    try {
      if (window.walletStorage) {
        const res = window.walletStorage.get('apiKey');
        if (res) {
          window.sendMessage('setApiKey', res).finally(() => {
            setTimeout(() => {
              setIsLoaded(true);
            }, 250);
          });
        } else {
          setIsLoaded(true);
        }
      } else {
        setIsLoaded(true);
      }
    } catch (error) {
      setIsLoaded(true);
      console.error(
        'Error has occured when fetching apiKey info from file system'
      );
    }
  }, []);
  return !isLoaded ? null : children;
};
