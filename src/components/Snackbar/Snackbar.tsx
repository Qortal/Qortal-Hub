import Snackbar, { SnackbarCloseReason } from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import { useTheme } from '@mui/material/styles';

const snackbarAlertSx = (theme) => ({
  width: '100%',
  maxWidth: '292px',
  fontFamily: 'Inter',
  fontSize: '13px',
  fontWeight: 500,
  borderRadius: '10px',
  boxShadow: '0 10px 26px rgba(0,0,0,0.34)',
  padding: '8px 12px',
  alignItems: 'center',
  backgroundColor: '#1D1F27',
  color: '#FFFFFF',
  border: `1px solid ${theme.palette.border.subtle}`,
  '& .MuiAlert-icon': {
    alignItems: 'center',
    color: '#FFFFFF',
    fontSize: '18px',
    marginRight: '8px',
    padding: 0,
  },
  '& .MuiAlert-message': {
    padding: 0,
    lineHeight: 1.25,
  },
});

export const CustomizedSnackbars = ({
  open,
  setOpen,
  info,
  setInfo,
  duration = 6000,
}) => {
  const theme = useTheme();
  const handleClose = (
    event?: React.SyntheticEvent | Event,
    reason?: SnackbarCloseReason
  ) => {
    if (reason === 'clickaway') {
      return;
    }
    setOpen(false);
    setInfo(null);
  };

  if (!open) return null;

  return (
    <Snackbar
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      open={open}
      autoHideDuration={
        info?.duration === null ? null : info?.duration ?? duration ?? 6000
      }
      onClose={handleClose}
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
        onClose={undefined}
        severity={info?.type}
        variant="filled"
        sx={snackbarAlertSx(theme)}
      >
        {info?.message}
      </Alert>
    </Snackbar>
  );
};
