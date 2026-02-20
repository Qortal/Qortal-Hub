import { Box } from '@mui/material';
import { AppsPrivate } from '../AppsPrivate';

interface PrivateTabProps {
  myName: string;
  myAddress: string;
}

export const PrivateTab = ({ myName, myAddress }: PrivateTabProps) => {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-start', padding: '24px 0' }}>
      <AppsPrivate myName={myName} myAddress={myAddress} />
    </Box>
  );
};
