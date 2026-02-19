import Snackbar, { SnackbarCloseReason } from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import { useTheme } from '@mui/material/styles';

const snackbarAlertSx = (theme) => ({
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
  '& .MuiAlert-action': {
    alignItems: 'center',
    paddingLeft: 1,
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
      autoHideDuration={info?.duration === null ? null : duration || 6000}
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
        onClose={handleClose}
        severity={info?.type}
        variant="filled"
        sx={snackbarAlertSx(theme)}
      >
        {info?.message}
      </Alert>
    </Snackbar>
  );
};
