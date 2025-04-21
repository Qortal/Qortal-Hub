import React, { useContext } from 'react';
import { AppViewer } from './AppViewer';
import Frame from 'react-frame-component';
import { MyContext } from '../../App';

const AppViewerContainer = React.forwardRef(
  ({ app, isSelected, hide, isDevMode, customHeight, skipAuth }, ref) => {
    const { rootHeight } = useContext(MyContext);

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
                height: '100vh';
              }
            `}
            </style>
          </>
        }
        style={{
          border: 'none',
          height: '100vh',
          left: (!isSelected || hide) && '-200vw',
          overflow: 'hidden',
          position: (!isSelected || hide) && 'fixed',
          width: '100%',
        }}
      >
        <AppViewer
          skipAuth={skipAuth}
          app={app}
          ref={ref}
          hide={!isSelected || hide}
          isDevMode={isDevMode}
        />
      </Frame>
    );
  }
);

export default AppViewerContainer;
