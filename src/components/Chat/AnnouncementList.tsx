import React, { useCallback, useState, useEffect, useRef } from 'react';
import {
  List,
  AutoSizer,
  CellMeasurerCache,
  CellMeasurer,
} from 'react-virtualized';
import { AnnouncementItem } from './AnnouncementItem';
import { Box } from '@mui/material';
import { CustomButton } from '../../styles/App-styles';

const cache = new CellMeasurerCache({
  fixedWidth: true,
  defaultHeight: 50,
});

export const AnnouncementList = ({
  initialMessages,
  announcementData,
  setSelectedAnnouncement,
  disableComment,
  showLoadMore,
  loadMore,
  myName,
}) => {
  const listRef = useRef();
  const [messages, setMessages] = useState(initialMessages);

  useEffect(() => {
    cache.clearAll();
  }, []);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  return (
    <div
      style={{
        position: 'relative',
        flexGrow: 1,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 1,
        overflow: 'auto',
      }}
    >
      {messages.map((message) => {
        const messageData = message?.tempData
          ? {
              decryptedData: message?.tempData,
            }
          : announcementData[`${message.identifier}-${message.name}`];

        return (
          <div
            key={message?.identifier}
            style={{
              marginBottom: '10px',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <AnnouncementItem
              myName={myName}
              disableComment={disableComment}
              setSelectedAnnouncement={setSelectedAnnouncement}
              message={message}
              messageData={messageData}
            />
          </div>
        );
      })}
      {/* <AutoSizer>
        {({ height, width }) => (
          <List
            ref={listRef}
            width={width}
            height={height}
            rowCount={messages.length}
            rowHeight={cache.rowHeight}
            rowRenderer={rowRenderer}
            deferredMeasurementCache={cache}
          />
        )}
      </AutoSizer> */}
      <Box
        sx={{
          width: '100%',
          marginTop: '25px',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        {showLoadMore && (
          <CustomButton onClick={loadMore}>
            Load older announcements
          </CustomButton>
        )}
      </Box>
    </div>
  );
};
