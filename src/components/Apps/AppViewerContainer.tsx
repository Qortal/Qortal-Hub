import { forwardRef } from 'react';
import { AppViewer } from './AppViewer';
import { Box } from '@mui/material';
import { appChromeOffsetPx } from '../Desktop/CustomTitleBar';

type AppViewerContainerProps = {
  app: any;
  isSelected: boolean;
  hide: boolean;
  isDevMode: boolean;
  customHeight?: string;
};

const AppViewerContainer = forwardRef<
  HTMLIFrameElement,
  AppViewerContainerProps
>(({ app, isSelected, hide, isDevMode, customHeight }, ref) => {
  const isHidden = !isSelected || hide;
  const style = {
    border: 'none',
    contain: 'layout paint style',
    display: 'block',
    height: customHeight || `calc(100vh - ${appChromeOffsetPx})`,
    isolation: 'isolate',
    left: isHidden ? '-200vw' : '0',
    minHeight: 0,
    overflow: 'hidden',
    overflowAnchor: 'none',
    overscrollBehavior: 'none',
    position: isHidden ? 'absolute' : 'relative',
    top: 0,
    width: '100%',
  } as const;

  return (
    <Box sx={style}>
      <AppViewer
        app={app}
        isDevMode={isDevMode}
        ref={ref}
      />
    </Box>
  );
});

export default AppViewerContainer;
