import { LoadingButton } from '@mui/lab';
import { Box, Input, MenuItem, Select, SelectChangeEvent } from '@mui/material';
import { useState } from 'react';
import { Spacer } from '../../common/Spacer';
import { Label } from './AddGroup';
import { getFee } from '../../background';

export const InviteMember = ({ groupId, setInfoSnack, setOpenSnack, show }) => {
  const [value, setValue] = useState('');
  const [expiryTime, setExpiryTime] = useState<string>('259200');
  const [isLoadingInvite, setIsLoadingInvite] = useState(false);
  const inviteMember = async () => {
    try {
      const fee = await getFee('GROUP_INVITE');
      await show({
        message: 'Would you like to perform a GROUP_INVITE transaction?',
        publishFee: fee.fee + ' QORT',
      });
      setIsLoadingInvite(true);
      if (!expiryTime || !value) return;
      new Promise((res, rej) => {
        window
          .sendMessage('inviteToGroup', {
            groupId,
            qortalAddress: value,
            inviteTime: +expiryTime,
          })
          .then((response) => {
            if (!response?.error) {
              // TODO translate
              setInfoSnack({
                type: 'success',
                message: `Successfully invited ${value}. It may take a couple of minutes for the changes to propagate`,
              });
              setOpenSnack(true);
              res(response);

              setValue('');
              return;
            }
            setInfoSnack({
              type: 'error',
              message: response?.error,
            });
            setOpenSnack(true);
            rej(response.error);
          })
          .catch((error) => {
            setInfoSnack({
              type: 'error',
              message: error?.message || 'An error occurred',
            });
            setOpenSnack(true);
            rej(error);
          });
      });
    } catch (error) {
      console.log(error);
    } finally {
      setIsLoadingInvite(false);
    }
  };

  const handleChange = (event: SelectChangeEvent) => {
    setExpiryTime(event.target.value as string);
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      Invite member
      <Spacer height="20px" />
      <Input
        value={value}
        placeholder="Name or address"
        onChange={(e) => setValue(e.target.value)}
      />
      <Spacer height="20px" />
      <Label>Invitation Expiry Time</Label>
      <Select
        labelId="demo-simple-select-label"
        id="demo-simple-select"
        value={expiryTime}
        label="Invitation Expiry Time"
        onChange={handleChange}
      >
        <MenuItem value={10800}>3 hours</MenuItem>
        <MenuItem value={21600}>6 hours</MenuItem>
        <MenuItem value={43200}>12 hours</MenuItem>
        <MenuItem value={86400}>1 day</MenuItem>
        <MenuItem value={259200}>3 days</MenuItem>
        <MenuItem value={432000}>5 days</MenuItem>
        <MenuItem value={604800}>7 days</MenuItem>
        <MenuItem value={864000}>10 days</MenuItem>
        <MenuItem value={1296000}>15 days</MenuItem>
        <MenuItem value={2592000}>30 days</MenuItem>
      </Select>
      <Spacer height="20px" />
      <LoadingButton
        variant="contained"
        loadingPosition="start"
        loading={isLoadingInvite}
        onClick={inviteMember}
      >
        Invite
      </LoadingButton>
    </Box>
  );
};
