import { useState } from 'react';
import QRCode from 'react-qr-code';
import { TextP } from '../styles/App-styles';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

export const AddressQRCode = ({ targetAddress }) => {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation(['auth', 'core', 'group', 'question']);

  return (
    <Box
      sx={{
        display: 'flex',
        gap: '10px',
        alignItems: 'center',
        flexDirection: 'column',
        marginTop: '10px',
      }}
    >
      <Typography
        sx={{
          cursor: 'pointer',
          fontSize: '14px',
        }}
        onClick={() => {
          setOpen((prev) => !prev);
        }}
      >
        {open
          ? t('core:action.hide_qr_code', {
              postProcess: 'capitalizeFirstChar',
            })
          : t('core:action.see_qr_code', {
              postProcess: 'capitalizeFirstChar',
            })}
      </Typography>

      {open && (
        <Box
          sx={{
            display: 'flex',
            gap: '10px',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              gap: '10px',
              width: '100%',
              alignItems: 'center',
              flexDirection: 'column',
              marginTop: '20px',
            }}
          >
            <TextP
              sx={{
                textAlign: 'center',
                lineHeight: 1.2,
                fontSize: '16px',
                fontWeight: 500,
              }}
            >
              {t('core:address_your', { postProcess: 'capitalizeFirstChar' })}
            </TextP>
            <QRCode
              value={targetAddress} // Your address here
              size={150} // Adjust size as needed
              level="M" // Error correction level (L, M, Q, H)
              bgColor="#FFFFFF" // Background color (white)
              fgColor="#000000" // Foreground color (black)
            />
          </Box>
        </Box>
      )}
    </Box>
  );
};
