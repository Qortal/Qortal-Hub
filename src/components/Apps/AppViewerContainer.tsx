import { forwardRef } from 'react';
import { AppViewer } from './AppViewer';
import Frame from 'react-frame-component';
import { appChromeOffsetPx } from '../Desktop/CustomTitleBar';

type AppViewerContainerProps = {
  app: any;
  isSelected: boolean;
  hide: boolean;
  isDevMode: boolean;
  customHeight?: string;
  skipAuth?: boolean;
};

const AppViewerContainer = forwardRef<
  HTMLIFrameElement,
  AppViewerContainerProps
>(({ app, isSelected, hide, isDevMode, customHeight, skipAuth }, ref) => {
  const isHidden = !isSelected || hide;

  return (
    <Frame
      id={`browser-iframe-${app?.tabId}`}
      head={
        <>
          <style>
            {`
              html,
              body {
                height: 100%;
                margin: 0;
                padding: 0;
                overflow: hidden;
              }
              .frame-root,
              .frame-content {
                display: flex;
                flex-direction: column;
                height: 100%;
                min-height: 0;
                overflow: hidden;
                width: 100%;
              }
              * {
                msOverflowStyle: 'none', /* IE and Edge */
                scrollbar-width: none;  /* Firefox */
              }
              *::-webkit-scrollbar {
                display: none;  /* Chrome, Safari, Opera */
              }
            `}
          </style>
        </>
      }
      style={{
        border: 'none',
        display: 'block',
        height: customHeight || `calc(100vh - ${appChromeOffsetPx})`,
        left: isHidden ? '-200vw' : '0',
        minHeight: 0,
        overflow: 'hidden',
        position: isHidden ? 'absolute' : 'relative',
        top: 0,
        width: '100%',
      }}
    >
      <AppViewer
        app={app}
        customHeight={customHeight}
        hide={!isSelected || hide}
        isDevMode={isDevMode}
        ref={ref}
        skipAuth={skipAuth}
      />
    </Frame>
  );
});

export default AppViewerContainer;
