import { LoadingButton } from '@mui/lab';
import { Box, Input, MenuItem, Select, SelectChangeEvent } from '@mui/material';
import { useState } from 'react';
import { Spacer } from '../../common/Spacer';
import { Label } from './AddGroup';
import { getFee } from '../../background';
import { useTranslation } from 'react-i18next';

export const InviteMember = ({ groupId, setInfoSnack, setOpenSnack, show }) => {
  const [value, setValue] = useState('');
  const [expiryTime, setExpiryTime] = useState<string>('259200');
  const [isLoadingInvite, setIsLoadingInvite] = useState(false);
  const { t } = useTranslation(['core', 'group']);

  const inviteMember = async () => {
    try {
      const fee = await getFee('GROUP_INVITE');

      await show({
        message: t('core:question.perform_transaction', {
          action: 'GROUP_INVITE',
          postProcess: 'capitalizeFirst',
        }),
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
              setInfoSnack({
                type: 'success',
                message: t('group:message.success.group_invite', {
                  value: value,
                  postProcess: 'capitalizeFirst',
                }),
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
              message:
                error?.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirst',
                }),
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
      {t('group:action.invite_member', { postProcess: 'capitalizeFirst' })}

      <Spacer height="20px" />

      <Input
        value={value}
        placeholder="Name or address"
        onChange={(e) => setValue(e.target.value)}
      />

      <Spacer height="20px" />

      <Label>
        {t('group:invitation_expiry', { postProcess: 'capitalizeFirst' })}
      </Label>

      <Select
        labelId="demo-simple-select-label"
        id="demo-simple-select"
        value={expiryTime}
        label={t('group:invitation_expiry', { postProcess: 'capitalizeFirst' })}
        onChange={handleChange}
      >
        <MenuItem value={10800}>{t('core:time.hour', { count: 3 })}</MenuItem>
        <MenuItem value={21600}>{t('core:time.hour', { count: 6 })}</MenuItem>
        <MenuItem value={43200}>{t('core:time.hour', { count: 12 })}</MenuItem>
        <MenuItem value={86400}>{t('core:time.day', { count: 1 })}</MenuItem>
        <MenuItem value={259200}>{t('core:time.day', { count: 3 })}</MenuItem>
        <MenuItem value={432000}>{t('core:time.day', { count: 5 })}</MenuItem>
        <MenuItem value={604800}>{t('core:time.day', { count: 7 })}</MenuItem>
        <MenuItem value={864000}>{t('core:time.day', { count: 10 })}</MenuItem>
        <MenuItem value={1296000}>{t('core:time.day', { count: 15 })}</MenuItem>
        <MenuItem value={2592000}>{t('core:time.day', { count: 30 })}</MenuItem>
      </Select>

      <Spacer height="20px" />

      <LoadingButton
        variant="contained"
        loadingPosition="start"
        loading={isLoadingInvite}
        onClick={inviteMember}
      >
        {t('core:action.invite', { postProcess: 'capitalizeFirst' })}
      </LoadingButton>
    </Box>
  );
};
