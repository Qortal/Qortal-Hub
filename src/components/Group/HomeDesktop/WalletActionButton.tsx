import { Box, ButtonBase, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  APP_BLUE_SURFACE_TEXT,
  getBlueTier1ButtonSx,
} from '../groupActivityColorSystem';

export const WalletActionButton = ({ icon, label, onClick, theme }) => {
  const blueStrongHover = getBlueTier1ButtonSx()['&:hover'];
  const isDarkMode = theme.palette.mode === 'dark';

  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        alignItems: 'center',
        background: isDarkMode
          ? 'linear-gradient(145deg, rgba(53,58,68,0.99) 0%, rgba(41,45,54,1) 48%, rgba(30,34,41,1) 100%)'
          : 'linear-gradient(145deg, rgba(251,253,255,0.99) 0%, rgba(232,237,245,0.99) 48%, rgba(216,223,234,1) 100%)',
        border: `1px solid ${
          isDarkMode
            ? alpha(theme.palette.primary.main, 0.06)
            : alpha(theme.palette.text.primary, 0.072)
        }`,
        borderRadius: '12px',
        boxShadow: isDarkMode
          ? 'inset 0 1px 0 rgba(255,255,255,0.075), inset 0 0 0 1px rgba(255,255,255,0.012), inset 0 -1px 0 rgba(0,0,0,0.44), inset -1px -1px 0 rgba(0,0,0,0.18), 0 4px 8px rgba(0,0,0,0.17)'
          : 'inset 0 1px 0 rgba(255,255,255,0.86), inset 0 0 0 1px rgba(255,255,255,0.24), inset 0 -1px 0 rgba(104,116,140,0.22), inset -1px -1px 0 rgba(146,158,182,0.14), 0 4px 8px rgba(94,108,132,0.11)',
        display: 'flex',
        gap: '9px',
        height: '46px',
        justifyContent: 'center',
        overflow: 'hidden',
        px: 1.5,
        position: 'relative',
        transition:
          'background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease, color 140ms ease, transform 120ms ease, filter 140ms ease',
        width: '100%',
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: '1px',
          borderRadius: 'inherit',
          pointerEvents: 'none',
          background: isDarkMode
            ? 'linear-gradient(145deg, rgba(255,255,255,0.052) 0%, rgba(255,255,255,0.02) 24%, rgba(255,255,255,0) 58%)'
            : 'linear-gradient(145deg, rgba(255,255,255,0.58) 0%, rgba(255,255,255,0.22) 28%, rgba(255,255,255,0) 58%)',
          opacity: 0.92,
        },
        '&:hover': {
          ...blueStrongHover,
          borderColor: 'rgba(143, 184, 243, 0.22)',
          color: APP_BLUE_SURFACE_TEXT,
          transform: 'translateY(-1px)',
        },
        '&:active': {
          boxShadow:
            'inset 2px 2px 6px rgba(0, 0, 0, 0.7), inset -1px -1px 3px rgba(255, 255, 255, 0.04)',
          transform: 'scale(0.97)',
        },
      }}
    >
      <Box
        sx={{
          color: 'inherit',
          display: 'inline-flex',
        }}
      >
        {icon}
      </Box>
      <Typography
        sx={{
          color: 'inherit',
          fontSize: '0.8rem',
          fontWeight: 600,
        }}
      >
        {label}
      </Typography>
    </ButtonBase>
  );
};
