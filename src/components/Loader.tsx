import { Box, CircularProgress } from '@mui/material';

export const Loader = () => {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
        height: '100%',
        position: 'fixed',
        top: '0px',
        left: '0px',
        right: '0px',
        bottom: '0px',
        zIndex: 10,
        background: 'rgba(0, 0, 0, 0.4)',
      }}
    >
      <CircularProgress color="success" size={25} />
    </Box>
  );
};
