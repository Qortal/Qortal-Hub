import './customloader.css';
import { Box, useTheme } from '@mui/material';

export const CustomLoader = () => {
  const theme = useTheme();
  return (
    <Box
      sx={{
        '--text-primary': theme.palette.text.primary,
      }}
      className="lds-ellipsis"
    >
      <div></div>
      <div></div>
      <div></div>
      <div></div>
    </Box>
  );
};
