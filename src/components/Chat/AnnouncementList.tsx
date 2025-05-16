import { useState, useEffect, useRef } from 'react';
import { CellMeasurerCache } from 'react-virtualized';
import { AnnouncementItem } from './AnnouncementItem';
import { Box } from '@mui/material';
import { CustomButton } from '../../styles/App-styles';
import { useTranslation } from 'react-i18next';

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
  const [messages, setMessages] = useState(initialMessages);
  const { t } = useTranslation(['auth', 'core', 'group']);

  useEffect(() => {
    cache.clearAll();
  }, []);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        flexShrink: 1,
        overflow: 'auto',
        position: 'relative',
        width: '100%',
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
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              marginBottom: '10px',
              width: '100%',
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

      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          marginTop: '25px',
          width: '100%',
        }}
      >
        {showLoadMore && (
          <CustomButton onClick={loadMore}>
            {t('core:action.load_announcements', {
              postProcess: 'capitalizeFirst',
            })}
          </CustomButton>
        )}
      </Box>
    </div>
  );
};
