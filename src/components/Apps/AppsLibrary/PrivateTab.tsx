import { useState } from 'react';
import { Box } from '@mui/material';
import { AppsPrivate } from '../AppsPrivate';
import { PublishedPrivateApps } from '../PublishedPrivateApps';

interface PrivateTabProps {
  myName: string;
  myAddress: string;
}

export const PrivateTab = ({ myName, myAddress }: PrivateTabProps) => {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: '32px',
        padding: '24px 0',
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
        <AppsPrivate
          myName={myName}
          myAddress={myAddress}
          onPublished={() => setRefreshKey((key) => key + 1)}
        />
      </Box>

      <PublishedPrivateApps myAddress={myAddress} refreshKey={refreshKey} />
    </Box>
  );
};
