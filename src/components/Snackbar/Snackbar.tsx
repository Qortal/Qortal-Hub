import * as React from 'react';
import Button from '@mui/material/Button';
import Snackbar, { SnackbarCloseReason } from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';

export const  CustomizedSnackbars = ({open, setOpen, info, setInfo, duration}) => {



  const handleClose = (
    event?: React.SyntheticEvent | Event,
    reason?: SnackbarCloseReason,
  ) => {
    if (reason === 'clickaway') {
      return;
    }

    setOpen(false);
    setInfo(null)
  };

  if(!open) return null
  return (
    <div>
      <Snackbar anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} open={open} autoHideDuration={info?.duration === null ? null : (duration || 6000)} onClose={handleClose}>
        <Alert
                

          onClose={handleClose}
          severity={info?.type}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {info?.message}
        </Alert>
      </Snackbar>
    </div>
  );
}