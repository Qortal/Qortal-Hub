import { Box, ButtonBase, Typography } from '@mui/material';
import { Spacer } from '../../common/Spacer';

export const NewUsersCTA = ({ balance }) => {
  if (balance === undefined || +balance > 0) return null;
  return (
    <Box
      sx={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <Spacer height="40px" />

      <Box
        sx={{
          width: '320px',
          justifyContent: 'center',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '15px',
          outline: '1px solid gray',
          borderRadius: '4px',
        }}
      >
        <Typography
          sx={{
            textAlign: 'center',
            fontSize: '1.2rem',
            fontWeight: 'bold',
          }}
        >
          Are you a new user?
        </Typography>{' '}
        // TODO translate
        <Spacer height="20px" />
        <Typography>
          Please message us on Telegram or Discord if you need 4 QORT to start
          chatting without any limitations
        </Typography>
        <Spacer height="20px" />
        <Box
          sx={{
            width: '100%',
            display: 'flex',
            gap: '10px',
            justifyContent: 'center',
          }}
        >
          <ButtonBase
            sx={{
              textDecoration: 'underline',
            }}
            onClick={() => {
              if (window?.electronAPI?.openExternal) {
                window.electronAPI.openExternal(
                  'https://link.qortal.dev/telegram-invite'
                );
              } else {
                window.open(
                  'https://link.qortal.dev/telegram-invite',
                  '_blank'
                );
              }
            }}
          >
            Telegram
          </ButtonBase>
          <ButtonBase
            sx={{
              textDecoration: 'underline',
            }}
            onClick={() => {
              if (window?.electronAPI?.openExternal) {
                window.electronAPI.openExternal(
                  'https://link.qortal.dev/discord-invite'
                );
              } else {
                window.open('https://link.qortal.dev/discord-invite', '_blank');
              }
            }}
          >
            Discord
          </ButtonBase>
        </Box>
      </Box>
    </Box>
  );
};
