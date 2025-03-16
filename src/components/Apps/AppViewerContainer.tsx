import React, { useContext, } from 'react';
import { AppViewer } from './AppViewer';
import Frame from 'react-frame-component';
import { MyContext, isMobile } from '../../App';

const AppViewerContainer = React.forwardRef(({ app, isSelected, hide, isDevMode, customHeight, skipAuth }, ref) => {
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
                -msOverflowStyle: none;  /* IE and Edge */
                scrollbar-width: none;  /* Firefox */
              }
              *::-webkit-scrollbar {
                display: none;  /* Chrome, Safari, Opera */
              }
              .frame-content {
                overflow: hidden;
                height: ${!isMobile ? '100vh' : `calc(${rootHeight} - 60px - 45px)`};
              }
            `}
          </style>
        </>
      }
      style={{
        position: (!isSelected || hide) && 'absolute',
        left: (!isSelected || hide) && '10000000px',
        height: customHeight ? customHeight : !isMobile ? '100vh' : `calc(${rootHeight} - 60px - 45px)`,
        border: 'none',
        width: '100%',
        overflow: 'hidden',
      }}
    >
      <AppViewer skipAuth={skipAuth} app={app}  ref={ref} hide={!isSelected || hide} isDevMode={isDevMode} />
    </Frame>
  );
});

export default AppViewerContainer;
