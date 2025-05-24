import { Box, ButtonBase, Typography } from '@mui/material';
import { Spacer } from '../common/Spacer';
import { useTranslation } from 'react-i18next';

export const NewUsersCTA = ({ balance }) => {
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  if (balance === undefined || +balance > 0) return null;

  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
      }}
    >
      <Spacer height="40px" />

      <Box
        sx={{
          alignItems: 'center',
          borderRadius: '4px',
          flexDirection: 'column',
          justifyContent: 'center',
          outline: '1px solid gray',
          padding: '15px',
          width: '320px',
        }}
      >
        <Typography
          sx={{
            fontSize: '1.2rem',
            fontWeight: 'bold',
            textAlign: 'center',
          }}
        >
          {t('core:message.question.new_user', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>

        <Spacer height="20px" />

        <Typography>
          {t('core:message_us', { postProcess: 'capitalizeFirstChar' })}
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
