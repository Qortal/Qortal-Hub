import { forwardRef } from 'react';
import { AppViewer } from './AppViewer';
import Frame from 'react-frame-component';

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
  return (
    <Frame
      id={`browser-iframe-${app?.tabId}`}
      head={
        <>
          <style>
            {`
              body {
                margin: 0;
                padding: 0;
              }
              * {
                msOverflowStyle: 'none', /* IE and Edge */
                scrollbar-width: none;  /* Firefox */
              }
              *::-webkit-scrollbar {
                display: none;  /* Chrome, Safari, Opera */
              }
              .frame-content {
                overflow: hidden;
                height: 100vh;
              }
            `}
          </style>
        </>
      }
      style={{
        border: 'none',
        height: customHeight || '100vh',
        left: (!isSelected || hide) && '-200vw',
        overflow: 'hidden',
        position: (!isSelected || hide) && 'fixed',
        width: '100%',
      }}
    >
      <AppViewer
        app={app}
        hide={!isSelected || hide}
        isDevMode={isDevMode}
        ref={ref}
        skipAuth={skipAuth}
      />
    </Frame>
  );
});

export default AppViewerContainer;
