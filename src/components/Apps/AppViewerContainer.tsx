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
};

const AppViewerContainer = forwardRef<
  HTMLIFrameElement,
  AppViewerContainerProps
>(({ app, isSelected, hide, isDevMode, customHeight }, ref) => {
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
                overscroll-behavior: none;
                overflow-anchor: none;
                position: fixed;
                inset: 0;
                width: 100%;
              }
              .frame-root,
              .frame-content {
                display: flex;
                flex-direction: column;
                height: 100%;
                min-height: 0;
                overflow: hidden;
                overscroll-behavior: none;
                overflow-anchor: none;
                width: 100%;
              }
              * {
                box-sizing: border-box;
                -ms-overflow-style: none; /* IE and Edge */
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
      }}
      tabIndex={-1}
    >
      <AppViewer
        app={app}
        hide={!isSelected || hide}
        isDevMode={isDevMode}
        ref={ref}
      />
    </Frame>
  );
});

export default AppViewerContainer;
