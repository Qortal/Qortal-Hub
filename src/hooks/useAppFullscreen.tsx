import { useCallback, useEffect } from 'react';

export const useAppFullScreen = (setFullScreen) => {
  const enterFullScreen = useCallback(() => {
    const element = document.documentElement; // Target the entire HTML document
    if (element.requestFullscreen) {
      element.requestFullscreen();
    } else if (element.mozRequestFullScreen) {
      // Firefox
      element.mozRequestFullScreen();
    } else if (element.webkitRequestFullscreen) {
      // Chrome, Safari and Opera
      element.webkitRequestFullscreen();
    } else if (element.msRequestFullscreen) {
      // IE/Edge
      element.msRequestFullscreen();
    }
  }, []);

  const exitFullScreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (document.mozFullScreenElement) {
      document.mozCancelFullScreen();
    } else if (document.webkitFullscreenElement) {
      document.webkitExitFullscreen();
    } else if (document.msFullscreenElement) {
      document.msExitFullscreen();
    }
  }, []);

  const toggleFullScreen = useCallback(() => {
    if (
      document.fullscreenElement ||
      document.mozFullScreenElement ||
      document.webkitFullscreenElement ||
      document.msFullscreenElement
    ) {
      exitFullScreen();
      setFullScreen(false);
    } else {
      enterFullScreen();
      setFullScreen(true);
    }
  }, [enterFullScreen, exitFullScreen]);

  // Listen for changes to fullscreen state
  useEffect(() => {
    const handleFullScreenChange = () => {
      if (
        document.fullscreenElement ||
        document.mozFullScreenElement ||
        document.webkitFullscreenElement ||
        document.msFullscreenElement
      ) {
        // TODO check empty block
      } else {
        setFullScreen(false);
      }
    };

    document.addEventListener('fullscreenchange', handleFullScreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullScreenChange); // Safari
    document.addEventListener('mozfullscreenchange', handleFullScreenChange); // Firefox
    document.addEventListener('MSFullscreenChange', handleFullScreenChange); // IE/Edge

    return () => {
      document.removeEventListener('fullscreenchange', handleFullScreenChange);
      document.removeEventListener(
        'webkitfullscreenchange',
        handleFullScreenChange
      );
      document.removeEventListener(
        'mozfullscreenchange',
        handleFullScreenChange
      );
      document.removeEventListener(
        'MSFullscreenChange',
        handleFullScreenChange
      );
    };
  }, []);

  return { enterFullScreen, exitFullScreen, toggleFullScreen };
};
