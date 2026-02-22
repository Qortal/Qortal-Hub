import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import { useTheme } from '@mui/material/styles';

const loadingSnackbarAlertSx = (theme) => ({
  width: '100%',
  maxWidth: '420px',
  fontFamily: 'Inter',
  fontSize: '15px',
  fontWeight: 500,
  borderRadius: '14px',
  boxShadow: theme.shadows[8],
  padding: '14px 18px',
  alignItems: 'center',
  '& .MuiAlert-icon': {
    alignItems: 'center',
    fontSize: '22px',
  },
  '& .MuiAlert-message': {
    padding: '0 4px',
    lineHeight: 1.4,
  },
});

export const LoadingSnackbar = ({ open, info }) => {
  const theme = useTheme();
  return (
    <Snackbar
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      open={open}
      sx={{
        bottom: { xs: 16, sm: 24 },
        '&.MuiSnackbar-root': {
          display: 'flex',
          justifyContent: 'center',
          left: '50%',
          right: 'auto',
          transform: 'translateX(-50%)',
        },
      }}
    >
      <Alert
        severity="info"
        variant="filled"
        sx={loadingSnackbarAlertSx(theme)}
      >
        {info?.message}
      </Alert>
    </Snackbar>
  );
};
